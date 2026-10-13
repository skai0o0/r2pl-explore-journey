/** Private server-side DEVELOPMENT persistence. No transport or production API.
 * Membership adapter is supplied by the server; request payload has no school slot,
 * wallet selector, clock or verified flag. actorId MUST be the server-authenticated
 * principal, not an actor ID copied from a transport payload.
 * Original wallet = campaign/actor/points.
 * State JSON retains immutable receipts so transitionKnowledge can validate clocks.
 * This correctness baseline rewrites that history; growth/hotspot profiling remains.
 */
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type ClaimingKnowledge,
  HARD_CLAIM_MS,
  type IncumbentTile,
  KNOWLEDGE_RULES_V1,
  type KnowledgeEffect,
  type KnowledgeState,
  type KnowledgeTransition,
  ROLLING_FADE_MS,
  startKnowledgeContest,
  transitionKnowledge,
} from "../../shared/gameplay/knowledgeRulesV1.ts";
import {
  CommittedResultInterrupted,
  type FaultHooks,
  IdempotencyConflict,
} from "./M3TestMutation.ts";

type CaseState =
  | ClaimingKnowledge
  | Extract<KnowledgeState, { phase: "success" | "failure" }>;
export interface KnowledgeReceiptV1 {
  readonly kind: KnowledgeTransition["kind"];
  readonly reason: string;
  readonly acceptedPoints: string;
  readonly revision: number;
  readonly status: CaseState["phase"] | "unavailable";
}
export interface KnowledgeIdentityV1 {
  readonly verified: boolean;
  readonly schoolSlot: number;
}
export interface KnowledgeStoreOptionsV1 {
  readonly developmentOnly: true;
  /** Trusted identity boundary, called within transaction; never supplied by client. */
  readonly identity: (
    client: PoolClient,
    campaignId: string,
    actorId: string,
  ) => Promise<KnowledgeIdentityV1>;
  /** Synthetic test clock only. Default reads PostgreSQL after acquiring locks. */
  readonly testClock?: (client: PoolClient) => Promise<bigint>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ids(...values: string[]): void {
  if (
    values.some((value) => !uuid.test(value) || value !== value.toLowerCase())
  )
    throw new Error("Expected canonical UUID");
}
function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}
const bigintFields = new Set([
  "openedAtMs",
  "t0Ms",
  "requiredPoints",
  "receivedPoints",
  "rollingDeadlineMs",
  "hardDeadlineMs",
  "requestedPoints",
  "acceptedPoints",
  "acceptedAtMs",
]);
function decode(value: unknown): CaseState {
  return JSON.parse(JSON.stringify(value), (key, item: unknown) =>
    bigintFields.has(key) ? BigInt(item as string) : item,
  ) as CaseState;
}
function digest(value: unknown): Buffer {
  return createHash("sha256").update(json(value)).digest();
}

export class KnowledgeCaseStoreV1 {
  readonly #pool: Pool;
  readonly #options: KnowledgeStoreOptionsV1;
  constructor(pool: Pool, options: KnowledgeStoreOptionsV1) {
    if (options.developmentOnly !== true) throw new Error("Development only");
    this.#pool = pool;
    this.#options = options;
  }
  async #tx<T>(
    body: (client: PoolClient) => Promise<T>,
    hooks: FaultHooks = {},
  ): Promise<T> {
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
      if (!committed) {
        await client.query("ROLLBACK");
        throw error;
      }
      throw new CommittedResultInterrupted(
        "Committed knowledge result interrupted; retry original key",
      );
    } finally {
      client.release();
    }
  }
  async #now(client: PoolClient): Promise<bigint> {
    if (this.#options.testClock) return this.#options.testClock(client);
    const result = await client.query<{ ms: string }>(
      "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS ms",
    );
    return BigInt(result.rows[0]!.ms);
  }
  async #lock(
    client: PoolClient,
    campaignId: string,
    caseId: string,
  ): Promise<CaseState> {
    const result = await client.query<{ state: unknown }>(
      "SELECT state FROM knowledge_cases_v1 WHERE campaign_id=$1 AND case_id=$2 FOR UPDATE",
      [campaignId, caseId],
    );
    if (!result.rows[0]) throw new Error("Unavailable knowledge case");
    return decode(result.rows[0].state);
  }
  async #effects(
    client: PoolClient,
    caseId: string,
    state: CaseState,
    effects: readonly KnowledgeEffect[],
  ): Promise<void> {
    await client.query(
      "INSERT INTO knowledge_effect_outbox_v1(campaign_id,case_id,revision,effects) VALUES($1,$2,$3,$4)",
      [state.campaignId, caseId, state.revision, json(effects)],
    );
    // Refund amount and original payer are derived from immutable debit receipts.
    for (const effect of effects)
      if (effect.kind === "refund_obligation") {
        await client.query(
          "INSERT INTO knowledge_refund_obligations_v1(campaign_id,case_id,contribution_id) VALUES($1,$2,$3)",
          [state.campaignId, caseId, effect.contributionId],
        );
      }
  }
  async #save(
    client: PoolClient,
    caseId: string,
    previous: CaseState,
    transition: KnowledgeTransition,
  ): Promise<CaseState> {
    const next = transition.state as CaseState;
    if (next.revision !== previous.revision) {
      await client.query(
        "UPDATE knowledge_cases_v1 SET state=$3,revision=$4,status=$5,received_points=$6,rolling_deadline_ms=$7 WHERE campaign_id=$1 AND case_id=$2",
        [
          next.campaignId,
          caseId,
          json(next),
          next.revision,
          next.phase,
          next.receivedPoints.toString(),
          next.rollingDeadlineMs.toString(),
        ],
      );
      await this.#effects(client, caseId, next, transition.effects);
    }
    return next;
  }
  /** Authority supplies frozen geometry/current holders, never a client snapshot.
   * No N=0 payable case; caller should persist the pure free-retention effects.
   */
  async open(input: {
    readonly campaignId: string;
    readonly caseId: string;
    readonly contestId: string;
    readonly schoolSlots: readonly [number, number];
    readonly tiles: readonly IncumbentTile[];
    readonly departingSchoolSlot: number;
  }): Promise<KnowledgeReceiptV1> {
    ids(input.campaignId, input.caseId, input.contestId);
    return this.#tx(async (client) => {
      // Serialize creation/retry before the row exists. All commands use case row thereafter.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`knowledge:${input.campaignId}:${input.caseId}`],
      );
      const snapshot = {
        ruleVersion: KNOWLEDGE_RULES_V1,
        ruleParameters: {
          rollingFadeMs: ROLLING_FADE_MS,
          hardClaimMs: HARD_CLAIM_MS,
          fee: "ceil(eligibleTileCount/2)",
        },
        contestId: input.contestId,
        schoolSlots: input.schoolSlots,
        tiles: input.tiles,
        departingSchoolSlot: input.departingSchoolSlot,
      };
      const hash = digest(snapshot);
      const prior = await client.query<{
        snapshot_hash: Buffer;
        state: unknown;
      }>(
        "SELECT snapshot_hash,state FROM knowledge_cases_v1 WHERE campaign_id=$1 AND case_id=$2 FOR UPDATE",
        [input.campaignId, input.caseId],
      );
      if (prior.rows[0]) {
        if (!prior.rows[0].snapshot_hash.equals(hash))
          throw new IdempotencyConflict("Case snapshot conflict");
        const state = decode(prior.rows[0].state);
        return {
          kind: "no_change",
          reason: "already_opened",
          acceptedPoints: "0",
          revision: state.revision,
          status: state.phase,
        };
      }
      const now = await this.#now(client);
      const shared = startKnowledgeContest({ ...input, openedAtMs: now });
      const transition = transitionKnowledge(shared, {
        kind: "departure",
        schoolSlot: input.departingSchoolSlot,
        remainingSchoolValid: true,
        atMs: now,
      });
      if (transition.state.phase !== "claiming")
        throw new Error("No payable succession case");
      const state = transition.state;
      await client.query(
        "INSERT INTO knowledge_cases_v1(campaign_id,case_id,rule_version,snapshot,snapshot_hash,state,revision,status,t0_ms,hard_deadline_ms,rolling_deadline_ms,required_points,received_points) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0)",
        [
          input.campaignId,
          input.caseId,
          KNOWLEDGE_RULES_V1,
          json(snapshot),
          hash,
          json(state),
          state.revision,
          state.phase,
          state.t0Ms.toString(),
          state.hardDeadlineMs.toString(),
          state.rollingDeadlineMs.toString(),
          state.requiredPoints.toString(),
        ],
      );
      await this.#effects(client, input.caseId, state, transition.effects);
      return {
        kind: transition.kind,
        reason: transition.reason,
        acceptedPoints: "0",
        revision: state.revision,
        status: state.phase,
      };
    });
  }
  async contribute(
    input: {
      readonly campaignId: string;
      readonly caseId: string;
      readonly contributionId: string;
      readonly actorId: string;
      readonly requestedPoints: bigint;
    },
    hooks: FaultHooks = {},
  ): Promise<KnowledgeReceiptV1> {
    ids(input.campaignId, input.caseId, input.contributionId, input.actorId);
    if (
      typeof input.requestedPoints !== "bigint" ||
      input.requestedPoints < 0n ||
      input.requestedPoints > 9223372036854775807n
    )
      throw new RangeError("Invalid points");
    const hash = digest([input.actorId, input.requestedPoints]);
    return this.#tx(async (client) => {
      const state = await this.#lock(client, input.campaignId, input.caseId);
      const identity = await this.#options.identity(
        client,
        input.campaignId,
        input.actorId,
      );
      // Check identity even on replay; only the original authenticated payer gets receipt.
      if (
        !identity.verified ||
        identity.schoolSlot !== state.claimantSchoolSlot
      )
        return {
          kind: "reject",
          reason: "ineligible_actor",
          acceptedPoints: "0",
          revision: 0,
          status: "unavailable",
        };
      const prior = await client.query<{
        actor_id: string;
        payload_hash: Buffer;
        result: KnowledgeReceiptV1;
      }>(
        "SELECT actor_id,payload_hash,result FROM knowledge_requests_v1 WHERE campaign_id=$1 AND case_id=$2 AND contribution_id=$3",
        [input.campaignId, input.caseId, input.contributionId],
      );
      if (prior.rows[0]) {
        if (
          prior.rows[0].actor_id !== input.actorId ||
          !prior.rows[0].payload_hash.equals(hash)
        )
          throw new IdempotencyConflict("Contribution payload conflict");
        return prior.rows[0].result;
      }
      const wallet = await client.query<{ balance: string }>(
        "SELECT balance FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='points' FOR UPDATE",
        [input.campaignId, input.actorId],
      );
      const transition = transitionKnowledge(state, {
        kind: "contribute",
        contributionId: input.contributionId,
        actorId: input.actorId,
        walletId: input.actorId,
        schoolSlot: identity.schoolSlot,
        verified: identity.verified,
        requestedPoints: input.requestedPoints,
        walletBalance: BigInt(wallet.rows[0]?.balance ?? "0"),
        atMs: await this.#now(client),
      });
      const next = transition.state as CaseState;
      const receipt: KnowledgeReceiptV1 = {
        kind: transition.kind,
        reason: transition.reason,
        acceptedPoints: transition.acceptedPoints.toString(),
        revision: next.revision,
        status: next.phase,
      };
      await client.query(
        "INSERT INTO knowledge_requests_v1(campaign_id,case_id,contribution_id,actor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6)",
        [
          input.campaignId,
          input.caseId,
          input.contributionId,
          input.actorId,
          hash,
          json(receipt),
        ],
      );
      if (transition.acceptedPoints > 0n) {
        const row = next.contributions.at(-1)!;
        await client.query(
          "UPDATE wallet_accounts SET balance=balance-$3 WHERE campaign_id=$1 AND actor_id=$2 AND resource='points'",
          [input.campaignId, input.actorId, row.acceptedPoints.toString()],
        );
        await client.query(
          "INSERT INTO knowledge_contributions_v1(campaign_id,case_id,contribution_id,actor_id,requested_points,accepted_points,accepted_at_ms) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            input.campaignId,
            input.caseId,
            input.contributionId,
            input.actorId,
            row.requestedPoints.toString(),
            row.acceptedPoints.toString(),
            row.acceptedAtMs.toString(),
          ],
        );
        await client.query(
          "INSERT INTO knowledge_journal_v1(campaign_id,case_id,contribution_id,kind,amount) VALUES($1,$2,$3,'debit',$4)",
          [
            input.campaignId,
            input.caseId,
            input.contributionId,
            (-row.acceptedPoints).toString(),
          ],
        );
      }
      await this.#save(client, input.caseId, state, transition);
      return receipt;
    }, hooks);
  }
  async expire(
    campaignId: string,
    caseId: string,
  ): Promise<KnowledgeReceiptV1> {
    ids(campaignId, caseId);
    return this.#tx(async (client) => {
      const previous = await this.#lock(client, campaignId, caseId);
      const transition = transitionKnowledge(previous, {
        kind: "expire",
        atMs: await this.#now(client),
      });
      const state = await this.#save(client, caseId, previous, transition);
      return {
        kind: transition.kind,
        reason: transition.reason,
        acceptedPoints: "0",
        revision: state.revision,
        status: state.phase,
      };
    });
  }
  /** One bounded batch for ONE case. Case before obligations before ordered wallets.
   * Other workers skip the locked case; transaction rollback restores all credits.
   */
  async refundBatch(
    campaignId: string,
    limit: number,
    hooks: FaultHooks = {},
  ): Promise<number> {
    ids(campaignId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError("Batch must be 1..100");
    return this.#tx(async (client) => {
      const cases = await client.query<{
        campaign_id: string;
        case_id: string;
      }>(
        "SELECT c.campaign_id,c.case_id FROM knowledge_cases_v1 c WHERE c.campaign_id=$1 AND c.status='failure' AND EXISTS(SELECT 1 FROM knowledge_refund_obligations_v1 r WHERE r.campaign_id=c.campaign_id AND r.case_id=c.case_id AND r.completed_at IS NULL) ORDER BY c.case_id LIMIT 1 FOR UPDATE OF c SKIP LOCKED",
        [campaignId],
      );
      const selected = cases.rows[0];
      if (!selected) return 0;
      const rows = await client.query<{
        contribution_id: string;
        actor_id: string;
        accepted_points: string;
      }>(
        "SELECT r.contribution_id,p.actor_id,p.accepted_points FROM knowledge_refund_obligations_v1 r JOIN knowledge_contributions_v1 p USING(campaign_id,case_id,contribution_id) WHERE r.campaign_id=$1 AND r.case_id=$2 AND r.completed_at IS NULL ORDER BY p.actor_id,r.contribution_id LIMIT $3 FOR UPDATE OF r SKIP LOCKED",
        [selected.campaign_id, selected.case_id, limit],
      );
      for (const row of rows.rows) {
        const wallet = await client.query(
          "SELECT balance FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='points' FOR UPDATE",
          [selected.campaign_id, row.actor_id],
        );
        if (wallet.rowCount !== 1)
          throw new Error("Original payer wallet missing");
        await client.query(
          "INSERT INTO knowledge_journal_v1(campaign_id,case_id,contribution_id,kind,amount) VALUES($1,$2,$3,'refund',$4)",
          [
            selected.campaign_id,
            selected.case_id,
            row.contribution_id,
            row.accepted_points,
          ],
        );
        await client.query(
          "UPDATE wallet_accounts SET balance=balance+$3 WHERE campaign_id=$1 AND actor_id=$2 AND resource='points'",
          [selected.campaign_id, row.actor_id, row.accepted_points],
        );
        await client.query(
          "UPDATE knowledge_refund_obligations_v1 SET completed_at=clock_timestamp() WHERE campaign_id=$1 AND case_id=$2 AND contribution_id=$3",
          [selected.campaign_id, selected.case_id, row.contribution_id],
        );
      }
      return rows.rowCount ?? 0;
    }, hooks);
  }
}
