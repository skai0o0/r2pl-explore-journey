import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  assertConversion,
  assertIdentifier,
  parseRunningSnapshot,
  planRunningReconciliation,
  type RunningCheckpoint,
  type RunningConversion,
  snapshotWire,
} from "../../shared/integration/running.ts";
import type { CampaignBinding } from "./CampaignProvider.ts";

export interface RunningSyncReceipt {
  readonly status: "applied" | "no_change" | "reconciliation_required";
  readonly revision: string;
  readonly delta: string;
  readonly balance: string;
  readonly attributedPoints: string;
}
export type RunningSyncResult =
  | {
      readonly kind: "committed" | "replay";
      readonly receipt: RunningSyncReceipt;
    }
  | { readonly kind: "stale" };
export class RunningPayloadConflict extends Error {
  constructor() {
    super("Running revision reused with different payload or conversion");
  }
}
interface StoredCheckpoint {
  snapshot: Record<string, unknown>;
  conversion: {
    ruleVersion: string;
    pointsNumerator: string;
    metersDenominator: string;
  };
  attributedPoints: string;
}
function decodeCheckpoint(
  value: StoredCheckpoint | null,
): RunningCheckpoint | null {
  if (value === null) return null;
  return {
    snapshot: parseRunningSnapshot(value.snapshot),
    conversion: {
      ruleVersion: value.conversion.ruleVersion,
      pointsNumerator: BigInt(value.conversion.pointsNumerator),
      metersDenominator: BigInt(value.conversion.metersDenominator),
    },
    attributedPoints: BigInt(value.attributedPoints),
  };
}
export function assertBinding(binding: CampaignBinding): void {
  for (const value of [binding.campaignId, binding.actorId]) {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new RangeError("Invalid internal identity");
  }
  assertIdentifier(binding.provider);
  assertIdentifier(binding.externalStudentId);
  assertIdentifier(binding.externalSchoolId);
  if (
    !Number.isInteger(binding.schoolSlot) ||
    binding.schoolSlot < 0 ||
    binding.schoolSlot >= 16
  )
    throw new RangeError("Invalid bound school slot");
}

/** Isolated disposable-DB adapter. Never registered in Colyseus or the live economy.
 * Caller must provision bindings server-side; there is no auto-onboarding from API fields.
 */
export class PgRunningPreparation {
  readonly #pool: Pool;
  readonly #conversion: RunningConversion;
  constructor(
    pool: Pool,
    config: {
      readonly mode: "synthetic-preparation";
      readonly conversion: RunningConversion;
    },
  ) {
    if (config.mode !== "synthetic-preparation")
      throw new RangeError("Only synthetic preparation is enabled");
    assertConversion(config.conversion);
    this.#pool = pool;
    this.#conversion = Object.freeze({ ...config.conversion });
  }
  async apply(
    binding: CampaignBinding,
    rawSnapshot: unknown,
  ): Promise<RunningSyncResult> {
    assertBinding(binding);
    binding = Object.freeze({ ...binding });
    const snapshot = parseRunningSnapshot(rawSnapshot);
    if (
      snapshot.provider !== binding.provider ||
      snapshot.externalStudentId !== binding.externalStudentId
    )
      throw new RangeError("Snapshot does not match verified identity");
    const wire = snapshotWire(snapshot);
    const conversion = {
      ruleVersion: this.#conversion.ruleVersion,
      pointsNumerator: this.#conversion.pointsNumerator.toString(),
      metersDenominator: this.#conversion.metersDenominator.toString(),
    };
    const hash = createHash("sha256")
      .update(JSON.stringify({ snapshot: wire, conversion }))
      .digest();
    const db = await this.#pool.connect();
    try {
      await db.query("BEGIN");
      const bound = await db.query<{
        provider: string;
        external_student_id: string;
        school_slot: number;
        external_school_id: string;
      }>(
        "SELECT provider,external_student_id,school_slot,external_school_id FROM r2pl_prep.running_bindings WHERE campaign_id=$1 AND actor_id=$2 FOR UPDATE",
        [binding.campaignId, binding.actorId],
      );
      const source = bound.rows[0];
      if (
        !source ||
        source.provider !== binding.provider ||
        source.external_student_id !== binding.externalStudentId ||
        source.school_slot !== binding.schoolSlot ||
        source.external_school_id !== binding.externalSchoolId
      )
        throw new RangeError("Unprovisioned campaign identity");
      const existing = await db.query<{
        payload_hash: Buffer;
        result: RunningSyncReceipt;
      }>(
        "SELECT payload_hash,result FROM r2pl_prep.running_receipts WHERE campaign_id=$1 AND actor_id=$2 AND source_revision=$3",
        [binding.campaignId, binding.actorId, snapshot.revision.toString()],
      );
      const replay = existing.rows[0];
      if (replay) {
        if (!replay.payload_hash.equals(hash))
          throw new RunningPayloadConflict();
        await db.query("COMMIT");
        return { kind: "replay", receipt: replay.result };
      }
      const accounts = await db.query<{
        balance: string;
        checkpoint: StoredCheckpoint | null;
      }>(
        "SELECT balance,checkpoint FROM r2pl_prep.running_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-running-points' FOR UPDATE",
        [binding.campaignId, binding.actorId],
      );
      const account = accounts.rows[0];
      if (!account) throw new RangeError("Unprovisioned fixture account");
      const previous = decodeCheckpoint(account.checkpoint);
      if (previous && snapshot.revision <= previous.snapshot.revision) {
        await db.query("COMMIT");
        return { kind: "stale" };
      }
      const plan = planRunningReconciliation(
        snapshot,
        this.#conversion,
        previous,
      );
      const nextBalance = BigInt(account.balance) + plan.delta;
      if (nextBalance > 9_223_372_036_854_775_807n)
        throw new RangeError("Fixture balance overflow");
      const blocked = nextBalance < 0n;
      const receipt: RunningSyncReceipt = {
        status: blocked
          ? "reconciliation_required"
          : plan.delta === 0n
            ? "no_change"
            : "applied",
        revision: snapshot.revision.toString(),
        delta: blocked ? "0" : plan.delta.toString(),
        balance: blocked ? account.balance : nextBalance.toString(),
        attributedPoints: blocked
          ? (previous?.attributedPoints ?? 0n).toString()
          : plan.targetPoints.toString(),
      };
      await db.query(
        "INSERT INTO r2pl_prep.running_receipts(campaign_id,actor_id,source_revision,payload_hash,result) VALUES($1,$2,$3,$4,$5)",
        [
          binding.campaignId,
          binding.actorId,
          receipt.revision,
          hash,
          JSON.stringify(receipt),
        ],
      );
      if (!blocked) {
        const checkpoint = {
          snapshot: wire,
          conversion,
          attributedPoints: plan.targetPoints.toString(),
        };
        await db.query(
          "UPDATE r2pl_prep.running_accounts SET balance=$3,checkpoint=$4 WHERE campaign_id=$1 AND actor_id=$2",
          [
            binding.campaignId,
            binding.actorId,
            receipt.balance,
            JSON.stringify(checkpoint),
          ],
        );
        if (plan.delta !== 0n)
          await db.query(
            "INSERT INTO r2pl_prep.running_ledger(campaign_id,actor_id,source_revision,amount,resource) VALUES($1,$2,$3,$4,'fixture-running-points')",
            [
              binding.campaignId,
              binding.actorId,
              receipt.revision,
              receipt.delta,
            ],
          );
      }
      // Actor-private payload: no external ID, school affiliation, raw km, or credential.
      await db.query(
        "INSERT INTO r2pl_prep.running_outbox(campaign_id,actor_id,source_revision,event_type,event_version,payload) VALUES($1,$2,$3,'fixture.running_reconciled',1,$4)",
        [
          binding.campaignId,
          binding.actorId,
          receipt.revision,
          JSON.stringify(receipt),
        ],
      );
      await db.query("COMMIT");
      return { kind: "committed", receipt };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}
