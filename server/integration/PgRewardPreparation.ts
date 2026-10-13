import { createHash, randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { assertTimestamp } from "../../shared/integration/running.ts";
import {
  type RewardProfile,
  UNISTOP_REFERENCE,
} from "../../shared/rewards/catalog.ts";
import {
  type FixtureReward,
  parseFixtureReward,
  parseRewardCommand,
  REWARD_PREPARATION_VERSION,
  type RewardPreparationCommand,
  type RewardReceipt,
  type RewardRejection,
} from "../../shared/rewards/commands.ts";
import {
  selectReferenceReward,
  uniStopAvailability,
} from "../../shared/rewards/reference.ts";
import type { CampaignBinding } from "./CampaignProvider.ts";
import { assertBinding } from "./PgRunningPreparation.ts";

const resources = {
  points: "fixture-points",
  crystals: "fixture-crystals",
  treasure_map: "fixture-treasure-map",
  key: "fixture-key",
} as const;
export class RewardPayloadConflict extends Error {
  constructor() {
    super("Reward command key reused with different payload");
  }
}
interface Target {
  kind: "unistop" | "chest";
  profile: RewardProfile | null;
  fixed_reward: unknown;
  rule_version: string;
}
export interface RewardPreparationResult {
  readonly kind: "committed" | "replay";
  readonly receipt: RewardReceipt;
}
/** Synthetic authoritative transaction adapter only; never mounted in the live room/API.
 * Inventory, discovery and Key catalog are fixtures, not production tier mappings.
 */
export class PgRewardPreparation {
  readonly #pool: Pool;
  readonly #ticket: () => number;
  readonly #clock: (() => number) | undefined;
  constructor(
    pool: Pool,
    config: {
      readonly mode: "synthetic-preparation";
      readonly ruleVersion: typeof REWARD_PREPARATION_VERSION;
      readonly ticketSource?: () => number;
      readonly clock?: () => number;
    },
  ) {
    if (
      config.mode !== "synthetic-preparation" ||
      config.ruleVersion !== REWARD_PREPARATION_VERSION
    )
      throw new RangeError("Only synthetic reward preparation is enabled");
    this.#pool = pool;
    this.#ticket = config.ticketSource ?? (() => randomInt(1000));
    this.#clock = config.clock;
  }
  async apply(
    binding: CampaignBinding,
    input: unknown,
  ): Promise<RewardPreparationResult> {
    assertBinding(binding);
    binding = Object.freeze({ ...binding });
    const command = parseRewardCommand(input);
    const hash = createHash("sha256").update(JSON.stringify(command)).digest();
    const db = await this.#pool.connect();
    try {
      await db.query("BEGIN");
      const bound = await db.query<{
        provider: string;
        external_student_id: string;
        external_school_id: string;
        school_slot: number;
      }>(
        "SELECT provider,external_student_id,external_school_id,school_slot FROM r2pl_prep.running_bindings WHERE campaign_id=$1 AND actor_id=$2 FOR UPDATE",
        [binding.campaignId, binding.actorId],
      );
      const actor = bound.rows[0];
      if (
        !actor ||
        actor.provider !== binding.provider ||
        actor.external_student_id !== binding.externalStudentId ||
        actor.external_school_id !== binding.externalSchoolId ||
        actor.school_slot !== binding.schoolSlot
      )
        throw new RangeError("Unprovisioned reward identity");
      const previous = await db.query<{
        payload_hash: Buffer;
        result: RewardReceipt;
      }>(
        "SELECT payload_hash,result FROM r2pl_prep.reward_receipts WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3",
        [binding.campaignId, binding.actorId, command.key],
      );
      if (previous.rows[0]) {
        if (!previous.rows[0].payload_hash.equals(hash))
          throw new RewardPayloadConflict();
        await db.query("COMMIT");
        return { kind: "replay", receipt: previous.rows[0].result };
      }
      // Discovery first: hidden and nonexistent target IDs have the same actor-private result.
      const discovered = await db.query(
        "SELECT 1 FROM r2pl_prep.reward_discoveries WHERE campaign_id=$1 AND actor_id=$2 AND target_id=$3 FOR SHARE",
        [binding.campaignId, binding.actorId, command.targetId],
      );
      const targetRows = discovered.rowCount
        ? await db.query<Target>(
            "SELECT kind,profile,fixed_reward,rule_version FROM r2pl_prep.reward_targets WHERE campaign_id=$1 AND target_id=$2 " +
              (command.kind === "open_chest" ? "FOR UPDATE" : "FOR SHARE"),
            [binding.campaignId, command.targetId],
          )
        : null;
      const target = targetRows?.rows[0];
      // Take server time after actor/target serialization locks for deadline decisions.
      const now = this.#clock
        ? this.#clock()
        : Number(
            (
              await db.query<{ now_ms: string }>(
                "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint::text AS now_ms",
              )
            ).rows[0]!.now_ms,
          );
      assertTimestamp(now);
      let rejection: RewardRejection | null = null;
      let reward: FixtureReward | null = null;
      let ticket: number | null = null;
      let nextAvailableAtMs: number | null = null;
      if (
        !target ||
        target.rule_version !== command.ruleVersion ||
        (command.kind === "use_unistop"
          ? target.kind !== "unistop"
          : target.kind !== "chest")
      )
        rejection = "NOT_AVAILABLE";
      else if (command.kind === "use_unistop") {
        if (
          !target.profile ||
          !Object.hasOwn(UNISTOP_REFERENCE, target.profile)
        )
          throw new RangeError("Invalid fixture UniStop profile");
        const table = UNISTOP_REFERENCE[target.profile];
        // Do not remove/reweight Gifts, invent fallback, or consume a turn for an unsupported policy.
        if (table.outcomes.some((row) => row.kind === "gift" && row.weight > 0))
          rejection = "POLICY_PENDING";
        else {
          const cooldown = await db.query<{ last_used_at_ms: string }>(
            "SELECT last_used_at_ms FROM r2pl_prep.reward_cooldowns WHERE campaign_id=$1 AND actor_id=$2 AND target_id=$3",
            [binding.campaignId, binding.actorId, command.targetId],
          );
          const last = cooldown.rows[0]
            ? Number(cooldown.rows[0].last_used_at_ms)
            : null;
          const availability = uniStopAvailability(target.profile, last, now);
          if (!availability.available) {
            rejection = "COOLDOWN";
            nextAvailableAtMs = availability.nextAvailableAtMs;
          } else {
            ticket = this.#ticket();
            reward = parseFixtureReward(
              (({ kind, quantity }) => ({ kind, quantity }))(
                selectReferenceReward(table, ticket),
              ),
            );
            nextAvailableAtMs = uniStopAvailability(
              target.profile,
              now,
              now,
            ).nextAvailableAtMs;
          }
        }
      } else {
        const claimed = await db.query(
          "SELECT 1 FROM r2pl_prep.reward_chest_claims WHERE campaign_id=$1 AND target_id=$2",
          [binding.campaignId, command.targetId],
        );
        if (claimed.rowCount) rejection = "NOT_AVAILABLE";
        else {
          const key = await db.query<{ balance: string }>(
            "SELECT balance FROM r2pl_prep.reward_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-key' FOR UPDATE",
            [binding.campaignId, binding.actorId],
          );
          if (!key.rows[0] || BigInt(key.rows[0].balance) < 1n)
            rejection = "KEY_REQUIRED";
          else reward = parseFixtureReward(target.fixed_reward);
        }
      }
      const receipt: RewardReceipt = {
        status: rejection ? "rejected" : "applied",
        command,
        reason: rejection,
        reward,
        processedAtMs: now,
        nextAvailableAtMs,
      };
      await db.query(
        "INSERT INTO r2pl_prep.reward_receipts(campaign_id,actor_id,command_key,payload_hash,roll_ticket,result) VALUES($1,$2,$3,$4,$5,$6)",
        [
          binding.campaignId,
          binding.actorId,
          command.key,
          hash,
          ticket,
          JSON.stringify(receipt),
        ],
      );
      if (!rejection) {
        if (!reward) throw new Error("Missing planned fixture reward");
        if (command.kind === "open_chest") {
          const spend = await db.query(
            "UPDATE r2pl_prep.reward_accounts SET balance=balance-1 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-key' AND balance>=1 RETURNING balance",
            [binding.campaignId, binding.actorId],
          );
          if (spend.rowCount !== 1)
            throw new Error("Fixture Key spend lost serialization");
          await this.#ledger(db, binding, command, "fixture-key", "spend", -1n);
          await db.query(
            "INSERT INTO r2pl_prep.reward_chest_claims(campaign_id,target_id,actor_id,command_key) VALUES($1,$2,$3,$4)",
            [
              binding.campaignId,
              command.targetId,
              binding.actorId,
              command.key,
            ],
          );
        } else
          await db.query(
            "INSERT INTO r2pl_prep.reward_cooldowns(campaign_id,actor_id,target_id,last_used_at_ms) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,actor_id,target_id) DO UPDATE SET last_used_at_ms=EXCLUDED.last_used_at_ms",
            [binding.campaignId, binding.actorId, command.targetId, now],
          );
        const resource = resources[reward.kind];
        await db.query(
          "INSERT INTO r2pl_prep.reward_accounts(campaign_id,actor_id,resource,balance) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,actor_id,resource) DO UPDATE SET balance=r2pl_prep.reward_accounts.balance+EXCLUDED.balance",
          [
            binding.campaignId,
            binding.actorId,
            resource,
            reward.quantity.toString(),
          ],
        );
        await this.#ledger(
          db,
          binding,
          command,
          resource,
          "grant",
          BigInt(reward.quantity),
        );
        // Separate private outbox. No shared map coordinates, rival wallets, or donor IDs.
        await db.query(
          "INSERT INTO r2pl_prep.reward_outbox(campaign_id,actor_id,command_key,event_type,event_version,payload) VALUES($1,$2,$3,'fixture.reward_committed',1,$4)",
          [
            binding.campaignId,
            binding.actorId,
            command.key,
            JSON.stringify(receipt),
          ],
        );
      }
      await db.query("COMMIT");
      return { kind: "committed", receipt };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async #ledger(
    db: PoolClient,
    binding: CampaignBinding,
    command: RewardPreparationCommand,
    resource: string,
    kind: "spend" | "grant",
    amount: bigint,
  ): Promise<void> {
    await db.query(
      "INSERT INTO r2pl_prep.reward_ledger(campaign_id,actor_id,command_key,resource,entry_kind,amount) VALUES($1,$2,$3,$4,$5,$6)",
      [
        binding.campaignId,
        binding.actorId,
        command.key,
        resource,
        kind,
        amount.toString(),
      ],
    );
  }
}
