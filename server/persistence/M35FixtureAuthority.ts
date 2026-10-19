import type { Pool } from "pg";
import type { EvaluateDevExplore } from "../../shared/gameplay/devContract.ts";
import { BEACON_BUFF_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import type { PublicSnapshot, Snapshot } from "../../shared/protocol/m2.ts";
import { crc32 } from "../../shared/world/checksum.ts";
import {
  decodeFogChunk,
  decodeKnowledgeChunk,
} from "../../shared/world/codec.ts";
import {
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
  CHUNK_SIZE,
  MAX_REVISION,
  WORLD_FORMAT_VERSION,
} from "../../shared/world/constants.ts";
import {
  chunkBounds,
  chunkCoordinatesForId,
} from "../../shared/world/coordinates.ts";
import type { SchoolRegistry } from "../../shared/world/registry.ts";
import { schoolBit } from "../../shared/world/registry.ts";
import type { ExploreBoundary } from "./ExploreBoundary.ts";
import {
  type ApplyOutcome,
  type FaultHooks,
  type M3TestCommand,
  M3TestMutationService,
} from "./M3TestMutation.ts";
import { type OutboxEvent, OutboxRelay } from "./OutboxRelay.ts";

const ZERO_MASK = Buffer.alloc(CHUNK_MASK_BYTES);
const ZERO_FOG = Buffer.alloc(CHUNK_FOG_BYTES);
class InvalidOutboxProjection extends Error {}

export interface CommittedFixtureDelta {
  readonly eventId: string;
  readonly actorId: string;
  readonly commandKeyHex: string;
  readonly chunkId: number;
  readonly schoolSlot: number;
  readonly viewRevision: bigint;
  readonly localIndex: number;
  readonly mask: number;
  readonly publicMask: number;
  readonly discovered: boolean;
  readonly publicRevision: bigint;
  readonly committedAtMs?: number;
  readonly claimReturnedAtMs: number;
  readonly projectedAtMs: number;
}

interface RelayTelemetry {
  count(name: string, amount?: number): void;
  observe(name: string, value: number): void;
}

/** PostgreSQL-backed adapter for the explicitly synthetic M3.5 network fixture. */
export class M35FixtureAuthority {
  readonly fogRevealRadius: number;
  readonly #pool: Pool;
  readonly #campaignId: string;
  readonly #cost: bigint;
  readonly #mutations: M3TestMutationService;
  readonly #relay: OutboxRelay;
  readonly #faultHooks: FaultHooks;
  readonly #commitTimes = new Map<string, number>();
  #draining: Promise<number> | undefined;

  constructor(
    pool: Pool,
    campaignId: string,
    explicitFixtureCost: bigint,
    faultHooks: FaultHooks = {},
    devExplore?: EvaluateDevExplore,
    boundary?: ExploreBoundary,
  ) {
    if (explicitFixtureCost < 0n)
      throw new RangeError("Invalid explicit fixture cost");
    this.fogRevealRadius =
      boundary?.ruleVersion === 1 ? BEACON_BUFF_CONFIG.scoutRadius : 0;
    this.#pool = pool;
    this.#campaignId = campaignId;
    this.#cost = explicitFixtureCost;
    this.#mutations = new M3TestMutationService(pool, {
      realtimeViews: true,
      ...(devExplore ? { devExplore } : {}),
      ...(boundary ? { boundary } : {}),
    });
    this.#relay = new OutboxRelay(pool);
    this.#faultHooks = faultHooks;
  }

  async validateCampaign(registry: SchoolRegistry): Promise<void> {
    const campaign = await this.#pool.query<{ write_strategy: string }>(
      "SELECT write_strategy FROM r2pl_v2.campaigns WHERE id=$1",
      [this.#campaignId],
    );
    if (campaign.rows[0]?.write_strategy !== "full_chunk")
      throw new Error("M3.5 requires the approved full-chunk baseline");
    const schools = await this.#pool.query<{ school_id: string; slot: number }>(
      "SELECT school_id,slot FROM r2pl_v2.campaign_schools WHERE campaign_id=$1 ORDER BY slot",
      [this.#campaignId],
    );
    const expected = registry.entries().map(({ id, slot }) => ({
      school_id: id,
      slot,
    }));
    if (JSON.stringify(schools.rows) !== JSON.stringify(expected))
      throw new Error(
        "Fixture campaign school registry differs from server registry",
      );
  }

  async apply(
    actorId: string,
    schoolSlot: number,
    key: Uint8Array,
    tileIndex: number,
    intent?: "explore" | "study",
  ): Promise<ApplyOutcome> {
    const command: M3TestCommand = {
      campaignId: this.#campaignId,
      actorId,
      schoolSlot,
      key,
      tileIndex,
      cost: this.#cost,
      ...(intent ? { intent } : {}),
    };
    const outcome = await this.#mutations.apply(command, this.#faultHooks);
    if (outcome.outboxId) {
      this.#commitTimes.set(
        outcome.outboxId,
        outcome.metrics.committedAtMonotonicMs,
      );
      if (this.#commitTimes.size > 8192)
        this.#commitTimes.delete(this.#commitTimes.keys().next().value!);
    }
    return outcome;
  }

  async snapshot(schoolSlot: number, id: number): Promise<Snapshot> {
    const bit = schoolBit(schoolSlot);
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    const result = await this.#pool.query<{
      head_revision: string;
      chunk_revision: string;
      mask: Buffer;
      mask_crc: string;
      fog_revision: string | null;
      fog: Buffer | null;
      fog_crc: string | null;
      view_revision: string | null;
    }>(
      "SELECT h.revision AS head_revision,w.revision AS chunk_revision,w.mask,w.mask_crc,f.revision AS fog_revision,f.fog,f.fog_crc,v.view_revision FROM r2pl_v2.world_chunk_heads h JOIN r2pl_v2.world_chunks w ON w.campaign_id=h.campaign_id AND w.chunk_id=h.chunk_id LEFT JOIN r2pl_v2.school_fog_chunks f ON f.campaign_id=h.campaign_id AND f.chunk_id=h.chunk_id AND f.school_slot=$3 LEFT JOIN r2pl_v2.school_chunk_views v ON v.campaign_id=h.campaign_id AND v.chunk_id=h.chunk_id AND v.school_slot=$3 WHERE h.campaign_id=$1 AND h.chunk_id=$2",
      [this.#campaignId, id, schoolSlot],
    );
    const row = result.rows[0];
    if (!row) {
      const head = await this.#pool.query(
        "SELECT 1 FROM r2pl_v2.world_chunk_heads WHERE campaign_id=$1 AND chunk_id=$2",
        [this.#campaignId, id],
      );
      if (head.rowCount) throw new Error("Missing durable chunk checkpoint");
      return {
        chunkId: id,
        viewRevision: 0n,
        mask: Uint8Array.from(ZERO_MASK),
        fog: Uint8Array.from(ZERO_FOG),
      };
    }
    if (row.head_revision !== row.chunk_revision)
      throw new Error("Full-chunk checkpoint is stale");
    const decoded = decodeKnowledgeChunk({
      formatVersion: WORLD_FORMAT_VERSION,
      chunkX,
      chunkZ,
      revision: BigInt(row.chunk_revision),
      checksum: Number(row.mask_crc),
      payload: row.mask,
    });
    const mask = new Uint8Array(CHUNK_MASK_BYTES);
    const projected = new DataView(mask.buffer);
    for (let local = 0; local < decoded.length; local++)
      projected.setUint16(local * 2, decoded[local]! & bit, true);
    const fog = row.fog ?? ZERO_FOG;
    decodeFogChunk({
      formatVersion: WORLD_FORMAT_VERSION,
      chunkX,
      chunkZ,
      schoolSlot,
      revision: BigInt(row.fog_revision ?? "0"),
      checksum: Number(row.fog_crc ?? crc32(ZERO_FOG)),
      payload: fog,
    });
    return {
      chunkId: id,
      viewRevision: BigInt(row.view_revision ?? "0"),
      mask,
      fog: Uint8Array.from(fog),
    };
  }

  /** Shared map overlay: active school membership only, never fog or private views. */
  async publicSnapshot(id: number): Promise<PublicSnapshot> {
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    const result = await this.#pool.query<{
      head_revision: string;
      chunk_revision: string;
      mask: Buffer;
      mask_crc: string;
    }>(
      "SELECT h.revision AS head_revision,w.revision AS chunk_revision,w.mask,w.mask_crc FROM r2pl_v2.world_chunk_heads h JOIN r2pl_v2.world_chunks w ON w.campaign_id=h.campaign_id AND w.chunk_id=h.chunk_id WHERE h.campaign_id=$1 AND h.chunk_id=$2",
      [this.#campaignId, id],
    );
    const row = result.rows[0];
    if (!row)
      return { chunkId: id, revision: 0n, mask: Uint8Array.from(ZERO_MASK) };
    if (row.head_revision !== row.chunk_revision)
      throw new Error("Full-chunk checkpoint is stale");
    const mask = decodeKnowledgeChunk({
      formatVersion: WORLD_FORMAT_VERSION,
      chunkX,
      chunkZ,
      revision: BigInt(row.chunk_revision),
      checksum: Number(row.mask_crc),
      payload: row.mask,
    });
    const bytes = new Uint8Array(CHUNK_MASK_BYTES),
      data = new DataView(bytes.buffer);
    mask.forEach((value, local) => {
      data.setUint16(local * 2, value, true);
    });
    return { chunkId: id, revision: BigInt(row.head_revision), mask: bytes };
  }

  drain(
    publish: (delta: CommittedFixtureDelta) => Promise<void>,
    recoverSubscribers: () => Promise<void>,
    telemetry?: RelayTelemetry,
  ): Promise<number> {
    if (this.#draining) return this.#draining;
    const run = async (): Promise<number> => {
      let delivered = 0;
      for (;;) {
        const events = await this.#relay.claim(this.#campaignId, 50);
        telemetry?.count("outbox_claim_queries");
        telemetry?.observe(
          "outbox_claim_query_ms",
          this.#relay.lastClaimQueryMs,
        );
        telemetry?.observe("outbox_claim_batch_size", events.length);
        telemetry?.count("outbox_events_claimed", events.length);
        if (events.length === 0) return delivered;
        try {
          for (const event of events) {
            let delta: CommittedFixtureDelta;
            const projectionStarted = Number(process.hrtime.bigint()) / 1e6;
            try {
              delta = this.#decodeEvent(event);
              telemetry?.observe(
                "projection_decode_ms",
                Number(process.hrtime.bigint()) / 1e6 - projectionStarted,
              );
              if (delta.committedAtMs !== undefined)
                telemetry?.observe(
                  "commit_to_claim_return_ms",
                  event.claimReturnedAtMs - delta.committedAtMs,
                );
            } catch (error) {
              if (!(error instanceof InvalidOutboxProjection)) throw error;
              await recoverSubscribers();
              await this.#relay.quarantine(event.id, event.leaseToken);
              this.#commitTimes.delete(event.id);
              continue;
            }
            await publish(delta);
            const markStarted = Number(process.hrtime.bigint()) / 1e6;
            await this.#relay.markDelivered(event.id, event.leaseToken);
            telemetry?.observe(
              "outbox_mark_delivered_ms",
              Number(process.hrtime.bigint()) / 1e6 - markStarted,
            );
            telemetry?.observe(
              "outbox_claim_to_delivered_ms",
              Number(process.hrtime.bigint()) / 1e6 - event.claimReturnedAtMs,
            );
            telemetry?.count("outbox_events_delivered");
            this.#commitTimes.delete(event.id);
            delivered++;
          }
        } catch (error) {
          // Release the failing event AND the unprocessed batch tail.
          // The token fences this cleanup against a newer worker's lease.
          try {
            const released = await this.#relay.releaseClaim(
              this.#campaignId,
              events[0]!.leaseToken,
            );
            telemetry?.count("outbox_batch_leases_released", released);
          } catch {
            // DB outage still recovers by lease expiry; preserve the original failure.
            telemetry?.count("outbox_batch_release_failures");
          }
          throw error;
        }
      }
    };
    this.#draining = run().finally(() => {
      this.#draining = undefined;
    });
    return this.#draining;
  }

  #decodeEvent(event: OutboxEvent): CommittedFixtureDelta {
    if (
      event.eventType !== "m35_fixture_world_changed" ||
      event.eventVersion !== 2
    )
      throw new InvalidOutboxProjection("Unexpected M3.5 outbox event");
    if (
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    )
      throw new InvalidOutboxProjection("Invalid M3.5 outbox payload");
    const payload = event.payload as Record<string, unknown>;
    const chunkId = Number(payload.chunkId);
    const schoolSlot = Number(payload.schoolSlot);
    const localIndex = Number(payload.localIndex);
    const mask = Number(payload.mask);
    const revision = payload.viewRevision,
      publicRevision = payload.publicRevision,
      publicMask = Number(payload.publicMask);
    if (
      !Number.isInteger(chunkId) ||
      chunkId < 0 ||
      chunkId > 255 ||
      !Number.isInteger(schoolSlot) ||
      schoolSlot < 0 ||
      schoolSlot > 15 ||
      !Number.isInteger(localIndex) ||
      localIndex < 0 ||
      localIndex >= 4096 ||
      !Number.isInteger(mask) ||
      mask < 0 ||
      mask > 0xffff ||
      (mask !== 0 && mask !== schoolBit(schoolSlot)) ||
      !Number.isInteger(publicMask) ||
      publicMask < 0 ||
      publicMask > 0xffff ||
      typeof revision !== "string" ||
      typeof publicRevision !== "string" ||
      !/^[1-9][0-9]*$/.test(revision) ||
      !/^[1-9][0-9]*$/.test(publicRevision) ||
      payload.discovered !== true
    )
      throw new InvalidOutboxProjection("Invalid M3.5 outbox projection");
    const { chunkX, chunkZ } = chunkCoordinatesForId(chunkId);
    const bounds = chunkBounds(chunkX, chunkZ);
    if (
      localIndex % CHUNK_SIZE >= bounds.width ||
      Math.floor(localIndex / CHUNK_SIZE) >= bounds.height ||
      BigInt(revision) > MAX_REVISION ||
      BigInt(publicRevision) > MAX_REVISION
    )
      throw new InvalidOutboxProjection("Invalid M3.5 outbox edge or revision");
    const committedAtMs = this.#commitTimes.get(event.id);
    return {
      eventId: event.id,
      actorId: event.actorId,
      commandKeyHex: event.commandKeyHex,
      chunkId,
      schoolSlot,
      viewRevision: BigInt(revision),
      publicRevision: BigInt(publicRevision),
      localIndex,
      mask,
      publicMask,
      discovered: true,
      claimReturnedAtMs: event.claimReturnedAtMs,
      projectedAtMs: Number(process.hrtime.bigint()) / 1e6,
      ...(committedAtMs !== undefined ? { committedAtMs } : {}),
    };
  }
}
