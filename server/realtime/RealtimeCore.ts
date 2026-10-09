import { performance } from "node:perf_hooks";
import {
  ACK_STATUS,
  type Ack,
  decodeExplore,
  decodeFrame,
  decodeResync,
  decodeSubscribe,
  type ExploreCommand,
  encodeAck,
  encodeDelta,
  encodeError,
  encodeHello,
  encodeSnapshot,
  M2_KIND,
  MAX_COMMAND_BYTES,
  REASON,
  type Reason,
} from "../../shared/protocol/m2.ts";
import { MAX_REVISION } from "../../shared/world/constants.ts";
import {
  chunkCoordinatesForIndex,
  chunkId,
  localIndex,
  sectorIdForTile,
  tileCoordinates,
} from "../../shared/world/coordinates.ts";
import { schoolBit } from "../../shared/world/registry.ts";
import type { WorldState } from "../../shared/world/world.ts";
import { InProcessSectorRouter } from "../world/SectorAuthority.ts";
import { IdempotencyStore } from "./IdempotencyStore.ts";
import {
  RealtimeMetrics,
  type StructuredLogger,
  silentLogger,
} from "./metrics.ts";
import { OutboundQueue, type OutboundSink } from "./OutboundQueue.ts";
import { SectorQueues } from "./SectorQueue.ts";
import type { SyntheticIdentity } from "./SyntheticAuth.ts";
import { SyntheticVisibilityProjection } from "./VisibilityProjection.ts";

interface Session {
  readonly identity: SyntheticIdentity;
  readonly outbound: OutboundQueue;
  readonly subscriptions: Map<number, number>;
  generation: number;
  tokens: number;
  lastRefill: number;
}

export interface RealtimeCoreOptions {
  readonly metrics?: RealtimeMetrics;
  readonly logger?: StructuredLogger;
  readonly maxSectorQueueDepth?: number;
  readonly maxOutboundFrames?: number;
  readonly maxOutboundBytes?: number;
}

/** M2-only deterministic in-memory simulator behind a versioned binary boundary. */
export class RealtimeCore {
  readonly world: WorldState;
  readonly metrics: RealtimeMetrics;
  readonly #logger: StructuredLogger;
  readonly #router: InProcessSectorRouter;
  readonly #queues: SectorQueues;
  readonly #projection: SyntheticVisibilityProjection;
  readonly #idempotency = new IdempotencyStore();
  readonly #sessions = new Map<string, Session>();
  readonly #viewRevisions = new Map<string, bigint>();
  readonly #maxOutboundFrames: number;
  readonly #maxOutboundBytes: number;

  constructor(world: WorldState, options: RealtimeCoreOptions = {}) {
    this.world = world;
    this.metrics = options.metrics ?? new RealtimeMetrics();
    this.#logger = options.logger ?? silentLogger;
    this.#router = new InProcessSectorRouter(world);
    this.#queues = new SectorQueues(
      this.metrics,
      options.maxSectorQueueDepth ?? 4096,
    );
    this.#projection = new SyntheticVisibilityProjection(world);
    this.#maxOutboundFrames = options.maxOutboundFrames ?? 128;
    this.#maxOutboundBytes = options.maxOutboundBytes ?? 1_048_576;
  }

  get connected(): number {
    return this.#sessions.size;
  }
  get queueDepths(): readonly number[] {
    return this.#queues.depths();
  }
  get idempotencyRecords(): number {
    return this.#idempotency.size;
  }

  addSession(
    sessionId: string,
    identity: SyntheticIdentity,
    sink: OutboundSink,
  ): void {
    if (
      this.#sessions.has(sessionId) ||
      !this.world.registry.hasSlot(identity.schoolSlot)
    )
      throw new Error("Invalid synthetic session");
    const session: Session = {
      identity,
      outbound: new OutboundQueue(
        sink,
        this.metrics,
        this.#maxOutboundFrames,
        this.#maxOutboundBytes,
      ),
      subscriptions: new Map(),
      generation: 0,
      tokens: 20,
      lastRefill: performance.now(),
    };
    this.#sessions.set(sessionId, session);
    session.outbound.enqueue(encodeHello(identity.schoolSlot));
    this.metrics.count("connections");
    this.#logger.log({ event: "m2_connected", connected: this.connected });
  }

  removeSession(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    session.subscriptions.clear();
    session.outbound.close("left");
    this.#sessions.delete(sessionId);
    this.metrics.count("disconnects");
    this.#logger.log({ event: "m2_disconnected", connected: this.connected });
  }

  async handle(sessionId: string, bytes: Uint8Array): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (!session || session.outbound.closed) return;
    const receivedAt = performance.now();
    if (!this.#consumeToken(session)) {
      this.#error(session, REASON.RATE_LIMITED);
      return;
    }
    let frame: ReturnType<typeof decodeFrame>;
    try {
      frame = decodeFrame(bytes, MAX_COMMAND_BYTES);
    } catch {
      this.#error(session, REASON.INVALID_FRAME);
      return;
    }
    this.metrics.count("inbound_frames");
    try {
      switch (frame.kind) {
        case M2_KIND.EXPLORE: {
          const command = decodeExplore(frame.payload);
          await this.#explore(session, command, frame.payload, receivedAt);
          break;
        }
        case M2_KIND.SUBSCRIBE:
          this.#subscribe(session, decodeSubscribe(frame.payload));
          break;
        case M2_KIND.RESYNC:
          this.#resync(session, decodeResync(frame.payload));
          break;
        case M2_KIND.PRODUCTION_MUTATION:
          this.#error(session, REASON.PRODUCTION_DISABLED);
          break;
        default:
          this.#error(session, REASON.INVALID_COMMAND);
      }
    } catch {
      this.#error(session, REASON.INVALID_COMMAND);
    }
  }

  #consumeToken(session: Session): boolean {
    const now = performance.now();
    session.tokens = Math.min(
      20,
      session.tokens + (now - session.lastRefill) * 0.01,
    );
    session.lastRefill = now;
    if (session.tokens < 1) {
      this.metrics.count("rate_limited");
      return false;
    }
    session.tokens -= 1;
    return true;
  }

  #error(session: Session, reason: Reason): void {
    this.metrics.count("command_errors");
    session.outbound.enqueue(encodeError(reason));
  }

  #subscribe(session: Session, ids: readonly number[]): void {
    const wanted = new Set(ids);
    for (const id of session.subscriptions.keys())
      if (!wanted.has(id)) session.subscriptions.delete(id);
    for (const id of ids) {
      if (session.subscriptions.has(id)) continue;
      const generation = ++session.generation;
      session.subscriptions.set(id, generation);
      this.#sendSnapshot(session, id, generation);
    }
    this.metrics.count("subscription_changes");
  }

  #resync(session: Session, id: number): void {
    const generation = session.subscriptions.get(id);
    if (generation === undefined) {
      this.#error(session, REASON.NOT_SUBSCRIBED);
      return;
    }
    this.#sendSnapshot(session, id, generation);
    this.metrics.count("resync_requests");
  }

  #sendSnapshot(session: Session, id: number, generation: number): void {
    const revision = this.#viewRevision(session.identity.schoolSlot, id);
    const projected = this.#projection.snapshot(
      session.identity.schoolSlot,
      id,
      revision,
    );
    session.outbound.enqueue(
      encodeSnapshot(projected),
      () => session.subscriptions.get(id) === generation,
    );
    this.metrics.count("snapshots_enqueued");
  }

  #viewRevision(slot: number, id: number): bigint {
    return this.#viewRevisions.get(`${slot}:${id}`) ?? 0n;
  }

  async #explore(
    session: Session,
    command: ExploreCommand,
    payload: Uint8Array,
    receivedAt: number,
  ): Promise<void> {
    const result = this.#idempotency.run(
      session.identity.actorId,
      command.key,
      payload,
      () => this.#applySynthetic(session.identity.schoolSlot, command),
    );
    if (result.kind === "conflict" || result.kind === "full") {
      const { chunkX, chunkZ } = chunkCoordinatesForIndex(command.tileIndex);
      session.outbound.enqueue(
        encodeAck({
          key: command.key,
          status: ACK_STATUS.REJECTED,
          reason:
            result.kind === "conflict"
              ? REASON.IDEMPOTENCY_CONFLICT
              : REASON.QUEUE_FULL,
          chunkId: chunkId(chunkX, chunkZ),
          viewRevision: 0n,
        }),
      );
      this.metrics.count(
        result.kind === "conflict"
          ? "idempotency_conflicts"
          : "idempotency_full",
      );
      return;
    }
    if (result.kind === "duplicate") this.metrics.count("duplicate_commands");
    const ack = await result.result;
    session.outbound.enqueue(encodeAck(ack));
    this.metrics.observe("command_ack_ms", performance.now() - receivedAt);
  }

  async #applySynthetic(slot: number, command: ExploreCommand): Promise<Ack> {
    const { chunkX, chunkZ } = chunkCoordinatesForIndex(command.tileIndex);
    const id = chunkId(chunkX, chunkZ);
    const sector = sectorIdForTile(command.tileIndex);
    try {
      return await this.#queues.enqueue(sector, () => {
        if (this.#viewRevision(slot, id) === MAX_REVISION)
          throw new RangeError("View revision exhausted");
        const changed = this.#router
          .forTile(command.tileIndex)
          .setPresence(command.tileIndex, slot, true);
        const revealed = this.world.reveal(command.tileIndex, slot);
        let revision = this.#viewRevision(slot, id);
        if (changed || revealed) {
          const baseRevision = revision;
          revision++;
          this.#viewRevisions.set(`${slot}:${id}`, revision);
          const { x, z } = tileCoordinates(command.tileIndex);
          const delta = encodeDelta({
            chunkId: id,
            baseRevision,
            nextRevision: revision,
            localIndex: localIndex(x, z),
            mask: this.world.maskAt(command.tileIndex) & schoolBit(slot),
            discovered: this.world.isRevealed(command.tileIndex, slot),
          });
          let recipients = 0;
          for (const peer of this.#sessions.values()) {
            if (peer.identity.schoolSlot !== slot) continue;
            const generation = peer.subscriptions.get(id);
            if (
              generation !== undefined &&
              peer.outbound.enqueue(
                delta,
                () => peer.subscriptions.get(id) === generation,
              )
            )
              recipients++;
          }
          this.metrics.count("fanout_recipients", recipients);
          this.metrics.count("actions_applied");
        } else this.metrics.count("actions_no_change");
        return {
          key: command.key,
          status:
            changed || revealed
              ? ACK_STATUS.TEST_APPLIED
              : ACK_STATUS.TEST_NO_CHANGE,
          reason: REASON.NONE,
          chunkId: id,
          viewRevision: revision,
        };
      });
    } catch (error) {
      this.metrics.count("sector_failures");
      this.#logger.log({ event: "m2_sector_failure", sector });
      return {
        key: command.key,
        status: ACK_STATUS.REJECTED,
        reason:
          error instanceof Error && error.message === "Sector queue full"
            ? REASON.QUEUE_FULL
            : REASON.INTERNAL,
        chunkId: id,
        viewRevision: this.#viewRevision(slot, id),
      };
    }
  }
}
