import type { Pool } from "pg";

/**
 * M4-D3 QA-only due-case polling. This does not create timers or start a worker.
 * Any authorized scheduler must call tick() on its own explicit cadence.
 * The due query uses PostgreSQL clock time, never a client/browser clock.
 *
 * No lock is held across the store.expire() call: KnowledgeCaseStoreV1
 * serializes the case row and owns the authoritative expiry transition.
 */
export interface KnowledgeDueCaseRepositoryV1 {
  listDue(campaignId: string, limit: number): Promise<readonly string[]>;
}

export interface KnowledgeSettlementServiceV1 {
  expire(campaignId: string, caseId: string): Promise<unknown>;
  refundBatch(campaignId: string, limit: number): Promise<number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class PostgresKnowledgeDueCaseRepositoryV1
  implements KnowledgeDueCaseRepositoryV1
{
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listDue(campaignId: string, limit: number): Promise<readonly string[]> {
    const rows = await this.#pool.query<{ case_id: string }>(
      "SELECT case_id FROM r2pl_v2.knowledge_cases_v1 " +
        "WHERE campaign_id=$1 AND status='claiming' " +
        "AND least(rolling_deadline_ms,hard_deadline_ms) <= " +
        "floor(extract(epoch FROM clock_timestamp())*1000)::bigint " +
        "ORDER BY least(rolling_deadline_ms,hard_deadline_ms),case_id LIMIT $2",
      [campaignId, limit],
    );
    return rows.rows.map((row) => row.case_id);
  }
}

export interface KnowledgeDeadlineTickResultV1 {
  readonly dueCount: number;
  readonly expiryAttempted: number;
  readonly expiryFailed: number;
  readonly refundCount: number;
  /** Private operator-only identifiers; never put these into public events. */
  readonly failedCaseIds: readonly string[];
}

/**
 * Bounded, caller-invoked scheduler. Repeated or concurrent ticks are safe
 * because the existing store expires each case under PostgreSQL row lock
 * and processes refund obligations with FOR UPDATE SKIP LOCKED.
 */
export class KnowledgeDeadlineSchedulerV1 {
  readonly #repo: KnowledgeDueCaseRepositoryV1;
  readonly #store: KnowledgeSettlementServiceV1;

  constructor(
    repo: KnowledgeDueCaseRepositoryV1,
    store: KnowledgeSettlementServiceV1,
    options: { readonly developmentOnly: true },
  ) {
    if (options.developmentOnly !== true)
      throw new Error("Development-only scheduler");
    this.#repo = repo;
    this.#store = store;
  }

  async tick(
    campaignId: string,
    options: {
      readonly expiryLimit?: number;
      readonly refundLimit?: number;
    } = {},
  ): Promise<KnowledgeDeadlineTickResultV1> {
    if (!UUID.test(campaignId))
      throw new Error("Expected canonical campaign UUID");
    const expiryLimit = options.expiryLimit ?? 8;
    const refundLimit = options.refundLimit ?? 8;
    if (
      ![expiryLimit, refundLimit].every(
        (value) => Number.isInteger(value) && value >= 1 && value <= 32,
      )
    ) {
      throw new RangeError("Scheduler batch sizes must be 1..32");
    }

    const selected = await this.#repo.listDue(campaignId, expiryLimit);
    if (
      selected.length > expiryLimit ||
      new Set(selected).size !== selected.length ||
      selected.some((value) => !UUID.test(value))
    ) {
      throw new Error("Invalid due-case repository response");
    }
    const failedCaseIds: string[] = [];
    for (const caseId of selected) {
      try {
        await this.#store.expire(campaignId, caseId);
      } catch {
        // Fail closed for this case; retry from durable claiming state next tick.
        failedCaseIds.push(caseId);
      }
    }
    // Refunds are independently durable; due-case failures must not starve them.
    const refundCount = await this.#store.refundBatch(campaignId, refundLimit);
    return Object.freeze({
      dueCount: selected.length,
      expiryAttempted: selected.length,
      expiryFailed: failedCaseIds.length,
      refundCount,
      failedCaseIds: Object.freeze(failedCaseIds),
    });
  }
}

/**
 * Explicitly NOT implemented: Shared Knowledge 24h upkeep scheduler.
 * M4-D2 has no persisted per-pair frozen component-cycle authority.
 * Never debit wallets by recomputing current geometry in a polling worker.
 */
