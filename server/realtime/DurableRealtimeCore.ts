import { performance } from "node:perf_hooks";
import {
  ACK_STATUS,
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
import { CHUNK_SIZE } from "../../shared/world/constants.ts";
import {
  chunkCoordinatesForId,
  chunkCoordinatesForIndex,
  chunkId,
  sectorIdForTile,
  tileIndex,
} from "../../shared/world/coordinates.ts";
import { schoolBit } from "../../shared/world/registry.ts";
import {
  CommittedResultInterrupted,
  IdempotencyConflict,
} from "../persistence/M3TestMutation.ts";
import type {
  CommittedFixtureDelta,
  M35FixtureAuthority,
} from "../persistence/M35FixtureAuthority.ts";
import {
  RealtimeMetrics,
  type StructuredLogger,
  silentLogger,
} from "./metrics.ts";
import { OutboundQueue, type OutboundSink } from "./OutboundQueue.ts";
import { SectorQueues } from "./SectorQueue.ts";
import type { SyntheticIdentity } from "./SyntheticAuth.ts";

interface Session {
  readonly identity: SyntheticIdentity;
  readonly outbound: OutboundQueue;
  readonly subscriptions: Map<number, number>;
  readonly revisions: Map<number, bigint>;
  generation: number;
  tokens: number;
  lastRefill: number;
}

export interface CorrelatedActionTrace {
  readonly correlationId: string;
  readonly gatewayReceiveMs: number;
  chunkId?: number;
  viewRevision?: string;
  sectorQueueEnterMs?: number;
  poolAcquiredMs?: number;
  commitMs?: number;
  ackEnqueueMs?: number;
  ackSinkSendResolvedMs?: number;
  outboxClaimReturnedMs?: number;
  projectionDecodedMs?: number;
  deltaEnqueueMs?: number;
  deltaSinkSendResolvedMs?: number;
}

/** Test-only v1 transport wired to the durable M3.5 fixture transaction. */
export class DurableRealtimeCore {
  readonly metrics: RealtimeMetrics;
  readonly #authority: M35FixtureAuthority;
  readonly #logger: StructuredLogger;
  readonly #queues: SectorQueues;
  readonly #sessions = new Map<string, Session>();
  readonly #subscribers = new Map<string, Set<Session>>();
  readonly #commitTimeline = new Map<string, number>();
  readonly #ackCommitTimeline = new Map<string, number>();
  readonly #traces = new Map<string, CorrelatedActionTrace>();
  readonly #traceCorrelationIds: ReadonlySet<string> | undefined;
  #relayTimer: NodeJS.Timeout | undefined;

  constructor(
    authority: M35FixtureAuthority,
    options: {
      readonly metrics?: RealtimeMetrics;
      readonly logger?: StructuredLogger;
      readonly maxSectorQueueDepth?: number;
      readonly maxOutboundFrames?: number;
      readonly maxOutboundBytes?: number;
      readonly traceCorrelationIds?: ReadonlySet<string>;
    } = {},
  ) {
    this.#authority = authority;
    this.metrics = options.metrics ?? new RealtimeMetrics();
    this.#logger = options.logger ?? silentLogger;
    this.#traceCorrelationIds = options.traceCorrelationIds;
    this.#queues = new SectorQueues(
      this.metrics,
      options.maxSectorQueueDepth ?? 4096,
    );
    this.maxOutboundFrames = options.maxOutboundFrames ?? 128;
    this.maxOutboundBytes = options.maxOutboundBytes ?? 1_048_576;
  }

  readonly maxOutboundFrames: number;
  readonly maxOutboundBytes: number;

  get connected(): number {
    return this.#sessions.size;
  }
  get queueDepths(): readonly number[] {
    return this.#queues.depths();
  }
  get commitTimeline(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.#commitTimeline);
  }
  get ackCommitTimeline(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.#ackCommitTimeline);
  }
  get correlatedTraces(): readonly CorrelatedActionTrace[] {
    return [...this.#traces.values()].map((trace) => ({ ...trace }));
  }

  startRelay(intervalMs = 20): void {
    if (this.#relayTimer) throw new Error("Relay already started");
    this.#relayTimer = setInterval(() => this.#pollRelay(), intervalMs);
    this.#relayTimer.unref();
    this.#pollRelay();
  }

  stopRelay(): void {
    if (this.#relayTimer) clearInterval(this.#relayTimer);
    this.#relayTimer = undefined;
  }

  async drainOutbox(): Promise<number> {
    return this.#authority.drain(
      (event) => this.#publish(event),
      () => this.#resyncAll(),
      this.metrics,
    );
  }

  async resyncViews(): Promise<void> {
    await this.#resyncAll();
  }

  async #resyncAll(): Promise<void> {
    this.metrics.count("outbox_quarantined_projection");
    for (const session of this.#sessions.values()) {
      for (const id of session.subscriptions.keys()) {
        const generation = ++session.generation;
        session.subscriptions.set(id, generation);
        session.revisions.delete(id);
        await this.#queues.enqueue(
          this.#sectorForChunk(id),
          () => this.#sendSnapshot(session, id, generation),
          "snapshot",
        );
      }
    }
  }

  #pollRelay(): void {
    this.metrics.count("relay_poll_triggers");
    void this.drainOutbox().catch(() => {
      this.metrics.count("outbox_relay_errors");
      this.#logger.log({ event: "m35_outbox_relay_error" });
    });
  }

  addSession(
    sessionId: string,
    identity: SyntheticIdentity,
    sink: OutboundSink,
  ): void {
    schoolBit(identity.schoolSlot);
    if (this.#sessions.has(sessionId))
      throw new Error("Duplicate synthetic session");
    const session: Session = {
      identity,
      outbound: new OutboundQueue(
        sink,
        this.metrics,
        this.maxOutboundFrames,
        this.maxOutboundBytes,
      ),
      subscriptions: new Map(),
      revisions: new Map(),
      generation: 0,
      tokens: 20,
      lastRefill: performance.now(),
    };
    this.#sessions.set(sessionId, session);
    session.outbound.enqueue(encodeHello(identity.schoolSlot));
    this.metrics.count("connections");
  }

  removeSession(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    for (const id of session.subscriptions.keys()) this.#unindex(session, id);
    session.subscriptions.clear();
    session.revisions.clear();
    session.outbound.close("left");
    this.#sessions.delete(sessionId);
    this.metrics.count("disconnects");
  }

  async handle(sessionId: string, bytes: Uint8Array): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (!session || session.outbound.closed) return;
    const receivedAt = performance.now();
    const receivedAtMono = Number(process.hrtime.bigint()) / 1e6;
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
        case M2_KIND.EXPLORE:
          await this.#explore(
            session,
            decodeExplore(frame.payload),
            receivedAt,
            receivedAtMono,
          );
          break;
        case M2_KIND.SUBSCRIBE:
          await this.#subscribe(session, decodeSubscribe(frame.payload));
          break;
        case M2_KIND.RESYNC:
          await this.#resync(session, decodeResync(frame.payload));
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
    session.tokens--;
    return true;
  }

  #error(session: Session, reason: Reason): void {
    this.metrics.count("command_errors");
    session.outbound.enqueue(encodeError(reason));
  }

  async #subscribe(session: Session, ids: readonly number[]): Promise<void> {
    const wanted = new Set(ids);
    for (const id of session.subscriptions.keys())
      if (!wanted.has(id)) {
        session.subscriptions.delete(id);
        session.revisions.delete(id);
        this.#unindex(session, id);
      }
    for (const id of ids) {
      if (session.subscriptions.has(id)) continue;
      const generation = ++session.generation;
      session.subscriptions.set(id, generation);
      const key = `${session.identity.schoolSlot}:${id}`;
      const subscribers = this.#subscribers.get(key) ?? new Set<Session>();
      subscribers.add(session);
      this.#subscribers.set(key, subscribers);
      await this.#queues.enqueue(
        this.#sectorForChunk(id),
        () => this.#sendSnapshot(session, id, generation),
        "snapshot",
      );
    }
    this.metrics.count("subscription_changes");
  }

  #unindex(session: Session, id: number): void {
    const key = `${session.identity.schoolSlot}:${id}`;
    const subscribers = this.#subscribers.get(key);
    subscribers?.delete(session);
    if (subscribers?.size === 0) this.#subscribers.delete(key);
  }

  async #resync(session: Session, id: number): Promise<void> {
    if (!session.subscriptions.has(id)) {
      this.#error(session, REASON.NOT_SUBSCRIBED);
      return;
    }
    const generation = ++session.generation;
    session.subscriptions.set(id, generation);
    session.revisions.delete(id);
    await this.#queues.enqueue(
      this.#sectorForChunk(id),
      () => this.#sendSnapshot(session, id, generation),
      "snapshot",
    );
    this.metrics.count("resync_requests");
  }

  async #sendSnapshot(
    session: Session,
    id: number,
    generation: number,
  ): Promise<void> {
    const snapshot = await this.#authority.snapshot(
      session.identity.schoolSlot,
      id,
    );
    if (session.subscriptions.get(id) !== generation || session.outbound.closed)
      return;
    if (
      session.outbound.enqueue(
        encodeSnapshot(snapshot),
        () => session.subscriptions.get(id) === generation,
      )
    ) {
      session.revisions.set(id, snapshot.viewRevision);
      this.metrics.count("snapshots_enqueued");
    }
  }

  async #explore(
    session: Session,
    command: ExploreCommand,
    receivedAt: number,
    receivedAtMono: number,
  ): Promise<void> {
    const { chunkX, chunkZ } = chunkCoordinatesForIndex(command.tileIndex);
    const id = chunkId(chunkX, chunkZ);
    const keyHex = Buffer.from(command.key).toString("hex");
    const firstObserved = !this.#traces.has(keyHex);
    if (
      this.#traces.size < 32 &&
      firstObserved &&
      (this.#traceCorrelationIds?.has(keyHex) ?? true)
    )
      this.#traces.set(keyHex, {
        correlationId: keyHex,
        gatewayReceiveMs: receivedAtMono,
      });
    const trace = firstObserved ? this.#traces.get(keyHex) : undefined;
    try {
      const outcome = await this.#queues.enqueue(
        sectorIdForTile(command.tileIndex),
        () => {
          if (trace)
            trace.sectorQueueEnterMs = Number(process.hrtime.bigint()) / 1e6;
          return this.#authority.apply(
            session.identity.actorId,
            session.identity.schoolSlot,
            command.key,
            command.tileIndex,
          );
        },
        "command",
      );
      if (trace) {
        trace.chunkId = id;
        trace.viewRevision = outcome.result.viewRevision ?? "0";
        trace.poolAcquiredMs = outcome.metrics.poolAcquiredAtMonotonicMs;
        trace.commitMs = outcome.metrics.committedAtMonotonicMs;
      }
      const result = outcome.result;
      const viewRevision = BigInt(result.viewRevision ?? "0");
      const status =
        result.status === "test_applied"
          ? ACK_STATUS.TEST_APPLIED
          : result.status === "test_no_change"
            ? ACK_STATUS.TEST_NO_CHANGE
            : ACK_STATUS.REJECTED;
      if (!outcome.metrics.replayed) {
        const key = Buffer.from(command.key).toString("hex");
        this.#ackCommitTimeline.set(
          key,
          outcome.metrics.committedAtMonotonicMs,
        );
        if (this.#ackCommitTimeline.size > 100_000)
          this.#ackCommitTimeline.delete(
            this.#ackCommitTimeline.keys().next().value!,
          );
      }
      session.outbound.enqueue(
        encodeAck({
          key: command.key,
          status,
          reason:
            result.reason === "none" ? REASON.NONE : REASON.INVALID_COMMAND,
          chunkId: id,
          viewRevision,
        }),
        undefined,
        trace
          ? () => {
              trace.ackSinkSendResolvedMs =
                Number(process.hrtime.bigint()) / 1e6;
            }
          : undefined,
      );
      if (trace) trace.ackEnqueueMs = Number(process.hrtime.bigint()) / 1e6;
      this.metrics.observe("durable_pool_wait_ms", outcome.metrics.poolWaitMs);
      this.metrics.observe(
        "durable_transaction_ms",
        outcome.metrics.dbTransactionMs,
      );
      this.metrics.observe(
        "durable_chunk_lock_ms",
        outcome.metrics.headLockWaitMs,
      );
      this.metrics.observe(
        "commit_to_ack_enqueue_ms",
        performance.now() - outcome.metrics.committedAtMs,
      );
      this.metrics.observe("command_ack_ms", performance.now() - receivedAt);
      this.metrics.count(
        outcome.metrics.replayed ? "durable_retries" : "durable_commands",
      );
      this.#pollRelay();
    } catch (error) {
      if (error instanceof CommittedResultInterrupted) {
        this.metrics.count("post_commit_disconnects");
        session.outbound.close("post_commit_retry_required");
        return;
      }
      this.metrics.count(
        error instanceof IdempotencyConflict
          ? "idempotency_conflicts"
          : "durable_failures",
      );
      session.outbound.enqueue(
        encodeAck({
          key: command.key,
          status: ACK_STATUS.REJECTED,
          reason:
            error instanceof IdempotencyConflict
              ? REASON.IDEMPOTENCY_CONFLICT
              : REASON.INTERNAL,
          chunkId: id,
          viewRevision: 0n,
        }),
      );
    }
  }

  async #publish(event: CommittedFixtureDelta): Promise<void> {
    const trace = this.#traces.get(event.commandKeyHex);
    if (trace) {
      trace.outboxClaimReturnedMs = event.claimReturnedAtMs;
      trace.projectionDecodedMs = event.projectedAtMs;
    }
    if (this.#authority.fogRevealRadius > 0) {
      // Signed exploration reveals a square of fog, possibly across chunk boundaries.
      // A single-tile delta cannot represent it. Read one private snapshot per affected
      // chunk and share its bytes only with subscribers of the same school.
      const { chunkX, chunkZ } = chunkCoordinatesForId(event.chunkId);
      const x = chunkX * CHUNK_SIZE + (event.localIndex % CHUNK_SIZE);
      const z = chunkZ * CHUNK_SIZE + Math.floor(event.localIndex / CHUNK_SIZE);
      const radius = this.#authority.fogRevealRadius;
      for (
        let cz = Math.floor(Math.max(0, z - radius) / CHUNK_SIZE);
        cz <= Math.floor(Math.min(999, z + radius) / CHUNK_SIZE);
        cz++
      )
        for (
          let cx = Math.floor(Math.max(0, x - radius) / CHUNK_SIZE);
          cx <= Math.floor(Math.min(999, x + radius) / CHUNK_SIZE);
          cx++
        ) {
          const id = chunkId(cx, cz);
          await this.#queues.enqueue(
            this.#sectorForChunk(id),
            async () => {
              const subscribers = this.#subscribers.get(
                `${event.schoolSlot}:${id}`,
              );
              if (!subscribers?.size) return;
              const snapshot = await this.#authority.snapshot(
                event.schoolSlot,
                id,
              );
              const bytes = encodeSnapshot(snapshot);
              for (const session of subscribers) {
                const generation = session.subscriptions.get(id);
                if (
                  generation === undefined ||
                  session.outbound.closed ||
                  (session.revisions.get(id) ?? -1n) >= snapshot.viewRevision
                )
                  continue;
                if (
                  session.outbound.enqueue(
                    bytes,
                    () => session.subscriptions.get(id) === generation,
                  )
                )
                  session.revisions.set(id, snapshot.viewRevision);
              }
            },
            "relay",
          );
        }
      return;
    }
    await this.#queues.enqueue(
      this.#sectorForChunk(event.chunkId),
      async () => {
        if (event.committedAtMs !== undefined) {
          this.#commitTimeline.set(
            `${event.schoolSlot}:${event.chunkId}:${event.viewRevision}`,
            event.committedAtMs,
          );
          if (this.#commitTimeline.size > 100_000)
            this.#commitTimeline.delete(
              this.#commitTimeline.keys().next().value!,
            );
        }
        const key = `${event.schoolSlot}:${event.chunkId}`;
        const subscribers = this.#subscribers.get(key);
        if (!subscribers?.size) return;
        const encodeStart = performance.now();
        const delta = encodeDelta({
          chunkId: event.chunkId,
          baseRevision: event.viewRevision - 1n,
          nextRevision: event.viewRevision,
          localIndex: event.localIndex,
          mask: event.mask,
          discovered: event.discovered,
        });
        this.metrics.observe(
          "delta_encode_ms",
          performance.now() - encodeStart,
        );
        const fanoutStart = performance.now();
        this.metrics.observe("fanout_candidates", subscribers.size);
        let recipients = 0;
        for (const session of subscribers) {
          const generation = session.subscriptions.get(event.chunkId);
          if (generation === undefined || session.outbound.closed) continue;
          const current = session.revisions.get(event.chunkId);
          if (current !== undefined && event.viewRevision <= current) continue;
          if (current === undefined || event.viewRevision !== current + 1n) {
            await this.#sendSnapshot(session, event.chunkId, generation);
            this.metrics.count("durable_gap_snapshots");
            continue;
          }
          if (
            session.outbound.enqueue(
              delta,
              () => session.subscriptions.get(event.chunkId) === generation,
              trace && session.identity.actorId === event.actorId
                ? () => {
                    trace.deltaSinkSendResolvedMs =
                      Number(process.hrtime.bigint()) / 1e6;
                  }
                : undefined,
            )
          ) {
            if (trace && session.identity.actorId === event.actorId)
              trace.deltaEnqueueMs = Number(process.hrtime.bigint()) / 1e6;
            session.revisions.set(event.chunkId, event.viewRevision);
            recipients++;
          }
        }
        this.metrics.count("fanout_recipients", recipients);
        this.metrics.observe(
          "fanout_enqueue_ms",
          performance.now() - fanoutStart,
        );
        if (event.committedAtMs !== undefined)
          this.metrics.observe(
            "commit_to_delta_enqueue_ms",
            Number(process.hrtime.bigint()) / 1e6 - event.committedAtMs,
          );
      },
      "relay",
    );
  }

  #sectorForChunk(id: number): number {
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    return sectorIdForTile(tileIndex(chunkX * CHUNK_SIZE, chunkZ * CHUNK_SIZE));
  }
}
