/** QA-only private billing boundary. No transport, scheduler debit or departure.
 * OWNER GATE: school-level funding/lapse authority is unsigned. Explicit opt-in
 * by a verified participant is the ONLY payment capability implemented here.
 * Topology is imported through a trusted server callback, never a request object.
 * Adapter must authenticate its caller, read lawful current holders at asOfMs,
 * and assign isolated activation cohorts. No M3 chunk interpretation is assumed.
 * Activation fixes the cohort's tile scope; expanding/handoff across cohorts is
 * rejected until an authoritative topology lifecycle contract is approved.
 * Merge/split WITHIN that scope changes only the next frozen cycle snapshot.
 * Private outbox is finance audit, not a public relay or network delivery ACK.
 */
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type BillingSnapshot,
  KNOWLEDGE_CYCLE_MS as DAY,
  type EconomyWorld,
  freezeKnowledgeBillingV1,
  quoteKnowledgeUpkeepV1,
} from "../../shared/gameplay/knowledgeEconomyV1.ts";
import {
  CommittedResultInterrupted,
  type FaultHooks,
  IdempotencyConflict,
} from "./M3TestMutation.ts";

export interface SharedUpkeepOptionsV1<Session> {
  readonly qaOnly: true;
  /** Session is a server-owned authenticated context; never deserialize it from transport.
   * Adapter MUST hold membership/authorization stable through commit (lock its
   * verified membership record here, or use immutable campaign membership). */
  readonly identity: (
    client: PoolClient,
    campaignId: string,
    session: Session,
  ) => Promise<{
    readonly actorId: string;
    readonly schoolSlot: number;
    readonly verified: boolean;
  }>;
  /** Trusted provenance seam: return null unless an authorized cohort and an
   * exact boundary snapshot are available. Historical/recomputed live geometry
   * is NOT a substitute for the authoritative asOfMs snapshot. */
  readonly topology: (
    client: PoolClient,
    campaignId: string,
    cohortId: string,
    asOfMs: number,
  ) => Promise<{
    readonly asOfMs: number;
    readonly world: EconomyWorld;
  } | null>;
  /** Guarded again against the exact synthetic campaign code on every clock read. */
  readonly testClock?: () => number;
}
export interface SharedUpkeepRequestV1 {
  readonly campaignId: string;
  readonly cohortId: string;
  readonly periodStart: number;
  readonly commandKey: string;
  readonly optIn: true;
}
export interface SharedUpkeepReceiptV1 {
  readonly status: "paid" | "rejected";
  readonly reason: string;
  readonly chargedPoints: number;
  readonly paymentKeys: readonly string[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function ids(...values: string[]): void {
  if (values.some((v) => typeof v !== "string" || !uuid.test(v)))
    throw new Error("Expected canonical UUID");
}
function ms(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER - DAY
  )
    throw new Error("Invalid clock");
}
function hash(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}
/** Canonical immutable geometry/hash independent of source tile/pair ordering. */
export function canonicalSharedBillingV1(
  input: BillingSnapshot,
): BillingSnapshot {
  const valid = freezeKnowledgeBillingV1(input);
  return freezeKnowledgeBillingV1({
    ...valid,
    world: {
      width: valid.world.width,
      height: valid.world.height,
      serverVerified: true,
      tiles: valid.world.tiles
        .map((t) => ({
          tileIndex: t.tileIndex,
          holders: [...t.holders].sort((a, b) => a - b),
        }))
        .sort((a, b) => a.tileIndex - b.tileIndex),
    },
  });
}
/** Deliberately cannot authorize departure, even at equality or long after due. */
export function decideUnfundedSharedBoundaryV1(
  periodStart: number,
  now: number,
  funded: boolean,
): "not-due" | "funded" | "pending-operator-review" {
  ms(periodStart);
  ms(now);
  if (typeof funded !== "boolean") throw new Error("Invalid funding status");
  return now < periodStart
    ? "not-due"
    : funded
      ? "funded"
      : "pending-operator-review";
}

export class KnowledgeSharedUpkeepStoreV1<Session> {
  readonly #pool: Pool;
  readonly #options: SharedUpkeepOptionsV1<Session>;
  constructor(pool: Pool, options: SharedUpkeepOptionsV1<Session>) {
    const url = pool.options.connectionString;
    if (options.qaOnly !== true || typeof url !== "string")
      throw new Error("Normalized QA-only pool required");
    if (
      typeof options.identity !== "function" ||
      typeof options.topology !== "function"
    )
      throw new Error("Trusted server adapters required");
    this.#pool = pool;
    this.#options = options;
  }
  async #tx<T>(
    body: (client: PoolClient) => Promise<T>,
    hooks: FaultHooks = {},
  ): Promise<T> {
    // Lazy import keeps pure tests executable without installed pg. Guard before
    // connecting on EVERY operation, including after pool option mutation.
    const { disposableDatabaseUrl } = await import(
      "../../scripts/migrate-m4d2.ts"
    );
    const url = this.#pool.options.connectionString;
    if (typeof url !== "string" || disposableDatabaseUrl(url) !== url)
      throw new Error("Normalized QA-only pool required");
    const client = await this.#pool.connect();
    let committed = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path = r2pl_v2, pg_catalog");
      const result = await body(client);
      hooks.beforeCommit?.();
      await client.query("COMMIT");
      committed = true;
      hooks.afterCommit?.();
      return result;
    } catch (error) {
      if (committed)
        throw new CommittedResultInterrupted(
          "Shared upkeep committed; retry original key",
        );
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async #now(client: PoolClient, campaignId: string): Promise<number> {
    let now: number;
    if (this.#options.testClock) {
      const result = await client.query<{ code: string }>(
        "SELECT code FROM campaigns WHERE id=$1",
        [campaignId],
      );
      if (result.rows[0]?.code !== `m4d3b-test-${campaignId}`)
        throw new Error("Synthetic clock requires synthetic QA campaign");
      now = this.#options.testClock();
    } else {
      const result = await client.query<{ ms: string }>(
        "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS ms",
      );
      now = Number(result.rows[0]!.ms);
    }
    ms(now);
    return now;
  }
  async #world(
    client: PoolClient,
    campaignId: string,
    cohortId: string,
    asOfMs: number,
  ): Promise<EconomyWorld> {
    const imported = await this.#options.topology(
      client,
      campaignId,
      cohortId,
      asOfMs,
    );
    if (!imported || imported.asOfMs !== asOfMs)
      throw new Error("Authoritative boundary topology unavailable");
    // Reuse the pure validator, including verified flag, bounds and pair count.
    const world = canonicalSharedBillingV1({
      billingSnapshotId: "validation",
      sharedActivatedAt: asOfMs,
      periodStart: asOfMs + DAY,
      world: imported.world,
    }).world;
    const schools = await client.query<{ slot: number }>(
      "SELECT slot FROM campaign_schools WHERE campaign_id=$1",
      [campaignId],
    );
    const registered = new Set(schools.rows.map((row) => row.slot));
    if (
      world.tiles.some((tile) =>
        tile.holders.some((slot) => !registered.has(slot)),
      )
    )
      throw new Error("Unregistered topology school");
    return world;
  }
  /** Internal server operation. t0 is generated here, never accepted in payload. */
  async activate(campaignId: string, cohortId: string): Promise<number> {
    ids(campaignId, cohortId);
    return this.#tx(async (client) => {
      // Serializes disjoint scope admission, not a world-chunk write.
      await client.query("SELECT id FROM campaigns WHERE id=$1 FOR UPDATE", [
        campaignId,
      ]);
      const old = await client.query<{ activated_at_ms: string }>(
        "SELECT activated_at_ms FROM knowledge_shared_activations_v1 WHERE campaign_id=$1 AND cohort_id=$2",
        [campaignId, cohortId],
      );
      if (old.rows[0]) return Number(old.rows[0].activated_at_ms);
      const now = await this.#now(client, campaignId);
      const world = await this.#world(client, campaignId, cohortId, now);
      const scopes = await client.query<{ activation_world: EconomyWorld }>(
        "SELECT activation_world FROM knowledge_shared_activations_v1 WHERE campaign_id=$1",
        [campaignId],
      );
      if (
        scopes.rows.some(
          (row) =>
            row.activation_world.width !== world.width ||
            row.activation_world.height !== world.height,
        )
      )
        throw new Error("Campaign topology dimensions changed");
      const occupied = new Set(
        scopes.rows.flatMap((row) =>
          row.activation_world.tiles.map((t) => t.tileIndex),
        ),
      );
      // Conservative cohort seam: even adjoining scopes need a future handoff
      // contract. Otherwise a cross-cohort same-pair merge could bill twice.
      if (
        world.tiles.some((t) => {
          const index = t.tileIndex,
            x = index % world.width;
          const neighbors = [index, index - world.width, index + world.width];
          if (x > 0) neighbors.push(index - 1);
          if (x < world.width - 1) neighbors.push(index + 1);
          return neighbors.some((neighbor) => occupied.has(neighbor));
        })
      )
        throw new Error("Cross-cohort topology handoff unavailable");
      await client.query(
        "INSERT INTO knowledge_shared_activations_v1(campaign_id,cohort_id,activated_at_ms,activation_world,world_hash) VALUES($1,$2,$3,$4,$5)",
        [campaignId, cohortId, now, JSON.stringify(world), hash(world)],
      );
      return now;
    });
  }
  /** Boundary import is explicit. If adapter has no exact historical snapshot,
   * fail closed; scheduler latency cannot select fresh live geometry for the past. */
  async freezePeriod(
    campaignId: string,
    cohortId: string,
    periodStart: number,
  ): Promise<BillingSnapshot> {
    ids(campaignId, cohortId);
    ms(periodStart);
    return this.#tx(async (client) => {
      const activation = await client.query<{
        activated_at_ms: string;
        activation_world: EconomyWorld;
        world_hash: Buffer;
      }>(
        "SELECT * FROM knowledge_shared_activations_v1 WHERE campaign_id=$1 AND cohort_id=$2 FOR UPDATE",
        [campaignId, cohortId],
      );
      const a = activation.rows[0];
      if (!a) throw new Error("Unavailable activation");
      const old = await client.query<{
        snapshot: BillingSnapshot;
        snapshot_hash: Buffer;
      }>(
        "SELECT snapshot,snapshot_hash FROM knowledge_shared_snapshots_v1 WHERE campaign_id=$1 AND cohort_id=$2 AND period_start_ms=$3",
        [campaignId, cohortId, periodStart],
      );
      if (old.rows[0]) {
        const frozen = canonicalSharedBillingV1(old.rows[0].snapshot);
        if (!hash(frozen).equals(old.rows[0].snapshot_hash))
          throw new Error("Invalid billing snapshot");
        return frozen;
      }
      const now = await this.#now(client, campaignId);
      if (now < periodStart) throw new Error("Boundary not reached");
      const activationWorld = canonicalSharedBillingV1({
        billingSnapshotId: "validation",
        sharedActivatedAt: Number(a.activated_at_ms),
        periodStart: Number(a.activated_at_ms) + DAY,
        world: a.activation_world,
      }).world;
      if (!hash(activationWorld).equals(a.world_hash))
        throw new Error("Invalid activation hash");
      const world = await this.#world(
        client,
        campaignId,
        cohortId,
        periodStart,
      );
      const scope = new Set(a.activation_world.tiles.map((t) => t.tileIndex));
      if (
        world.width !== a.activation_world.width ||
        world.height !== a.activation_world.height ||
        world.tiles.length !== scope.size ||
        world.tiles.some((t) => !scope.has(t.tileIndex))
      )
        throw new Error("Cohort scope changed");
      const snapshot = canonicalSharedBillingV1({
        billingSnapshotId: `${cohortId}:${periodStart}`,
        sharedActivatedAt: Number(a.activated_at_ms),
        periodStart,
        world,
      });
      await client.query(
        "INSERT INTO knowledge_shared_snapshots_v1(campaign_id,cohort_id,period_start_ms,activated_at_ms,snapshot_id,snapshot,snapshot_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          campaignId,
          cohortId,
          periodStart,
          snapshot.sharedActivatedAt,
          snapshot.billingSnapshotId,
          JSON.stringify(snapshot),
          hash(snapshot),
        ],
      );
      return snapshot;
    });
  }
  /** Only explicit opt-in requests. Session resolves actor and school server-side.
   * Quote covers ALL unpaid components for this school atomically; never partial
   * debit. Different students serialize on snapshot then their own wallet.
   * No retroactive paying expired cycles: pending review is not legal departure. */
  async pay(
    session: Session,
    request: SharedUpkeepRequestV1,
    hooks: FaultHooks = {},
  ): Promise<SharedUpkeepReceiptV1> {
    ids(request.campaignId, request.cohortId, request.commandKey);
    ms(request.periodStart);
    if (request.optIn !== true)
      throw new Error("Explicit payment opt-in required");
    return this.#tx(async (client) => {
      const identity = await this.#options.identity(
        client,
        request.campaignId,
        session,
      );
      ids(identity.actorId);
      if (
        identity.verified !== true ||
        !Number.isInteger(identity.schoolSlot) ||
        identity.schoolSlot < 0 ||
        identity.schoolSlot > 15
      )
        throw new Error("Verified school participant required");
      const registered = await client.query(
        "SELECT slot FROM campaign_schools WHERE campaign_id=$1 AND slot=$2",
        [request.campaignId, identity.schoolSlot],
      );
      if (registered.rowCount !== 1)
        throw new Error("Verified school participant required");
      const payloadHash = hash([
        request.cohortId,
        request.periodStart,
        identity.schoolSlot,
        true,
      ]);
      // Serialize same actor/key even across different snapshot rows to make
      // conflict detection deterministic (hash collision only adds serialization).
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [
          JSON.stringify([
            request.campaignId,
            identity.actorId,
            request.commandKey,
          ]),
        ],
      );
      const prior = await client.query<{
        payload_hash: Buffer;
        result: SharedUpkeepReceiptV1;
      }>(
        "SELECT payload_hash,result FROM knowledge_shared_requests_v1 WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3",
        [request.campaignId, identity.actorId, request.commandKey],
      );
      if (prior.rows[0]) {
        if (!prior.rows[0].payload_hash.equals(payloadHash))
          throw new IdempotencyConflict("Shared upkeep payload conflict");
        return prior.rows[0].result;
      }
      const rows = await client.query<{
        snapshot: BillingSnapshot;
        snapshot_hash: Buffer;
      }>(
        "SELECT snapshot,snapshot_hash FROM knowledge_shared_snapshots_v1 WHERE campaign_id=$1 AND cohort_id=$2 AND period_start_ms=$3 FOR UPDATE",
        [request.campaignId, request.cohortId, request.periodStart],
      );
      const row = rows.rows[0];
      if (!row) throw new Error("Unavailable billing snapshot");
      const snapshot = canonicalSharedBillingV1(row.snapshot);
      if (
        !hash(snapshot).equals(row.snapshot_hash) ||
        snapshot.billingSnapshotId !==
          `${request.cohortId}:${request.periodStart}` ||
        snapshot.periodStart !== request.periodStart
      )
        throw new Error("Invalid billing snapshot");
      // Membership must actually participate in the frozen school-pair geometry.
      if (
        !snapshot.world.tiles.some(
          (t) =>
            t.holders.length === 2 && t.holders.includes(identity.schoolSlot),
        )
      )
        throw new Error("Verified school participant required");
      const wallets = await client.query<{ balance: string }>(
        "SELECT balance::text FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='points' FOR UPDATE",
        [request.campaignId, identity.actorId],
      );
      if (!wallets.rows[0]) throw new Error("Authorized wallet unavailable");
      const balance = Number(wallets.rows[0].balance);
      if (!Number.isSafeInteger(balance) || balance < 0)
        throw new Error("Invalid wallet balance");
      const now = await this.#now(client, request.campaignId);
      const paid = await client.query<{ payment_key: string }>(
        "SELECT payment_key FROM knowledge_shared_receipts_v1 WHERE campaign_id=$1 AND cohort_id=$2 AND period_start_ms=$3",
        [request.campaignId, request.cohortId, request.periodStart],
      );
      const quote = quoteKnowledgeUpkeepV1({
        actor: { ...identity, serverVerified: true, pointsBalance: balance },
        snapshot,
        now,
        paidKeys: paid.rows.map((r) => r.payment_key),
      });
      const expired = now >= snapshot.periodStart + DAY;
      const result: SharedUpkeepReceiptV1 = expired
        ? {
            status: "rejected",
            reason: "pending-operator-review",
            chargedPoints: 0,
            paymentKeys: [],
          }
        : {
            status: quote.status === "quoted" ? "paid" : "rejected",
            reason: quote.reason ?? "explicit-payment",
            chargedPoints: quote.feePoints,
            paymentKeys: quote.paymentKeys,
          };
      await client.query(
        "INSERT INTO knowledge_shared_requests_v1(campaign_id,actor_id,command_key,cohort_id,period_start_ms,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          request.campaignId,
          identity.actorId,
          request.commandKey,
          request.cohortId,
          request.periodStart,
          payloadHash,
          JSON.stringify(result),
        ],
      );
      if (result.status === "paid") {
        const debit = await client.query(
          "UPDATE wallet_accounts SET balance=balance-$3 WHERE campaign_id=$1 AND actor_id=$2 AND resource='points' AND balance>=$3",
          [request.campaignId, identity.actorId, result.chargedPoints],
        );
        if (debit.rowCount !== 1)
          throw new Error("Insufficient authorized wallet");
        for (const key of result.paymentKeys) {
          const parts = JSON.parse(key) as unknown[];
          await client.query(
            "INSERT INTO knowledge_shared_receipts_v1(campaign_id,cohort_id,period_start_ms,payment_key,school_slot,component_hash,actor_id,command_key,paid_at_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              request.campaignId,
              request.cohortId,
              request.periodStart,
              key,
              identity.schoolSlot,
              hash([parts[2], parts[3]]),
              identity.actorId,
              request.commandKey,
              now,
            ],
          );
        }
        await client.query(
          "INSERT INTO knowledge_shared_journal_v1(campaign_id,actor_id,command_key,amount,accepted_at_ms) VALUES($1,$2,$3,$4,$5)",
          [
            request.campaignId,
            identity.actorId,
            request.commandKey,
            -result.chargedPoints,
            now,
          ],
        );
        await client.query(
          "INSERT INTO knowledge_shared_outbox_v1(campaign_id,actor_id,command_key,receipt) VALUES($1,$2,$3,$4)",
          [
            request.campaignId,
            identity.actorId,
            request.commandKey,
            JSON.stringify(result),
          ],
        );
      }
      return result;
    }, hooks);
  }
}
