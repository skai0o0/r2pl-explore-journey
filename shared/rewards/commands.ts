/** Internal synthetic preparation commands; not an extension of binary protocol v1. */
import { assertIdentifier } from "../integration/running.ts";
export const REWARD_PREPARATION_VERSION = "fixture-rewards-v1";
export interface RewardPreparationCommand {
  readonly key: string;
  readonly kind: "use_unistop" | "open_chest";
  readonly targetId: string;
  readonly ruleVersion: typeof REWARD_PREPARATION_VERSION;
}
export type FixtureRewardKind = "points" | "crystals" | "treasure_map" | "key";
export interface FixtureReward {
  readonly kind: FixtureRewardKind;
  readonly quantity: number;
}
export type RewardRejection =
  | "NOT_AVAILABLE"
  | "COOLDOWN"
  | "KEY_REQUIRED"
  | "POLICY_PENDING";
export interface RewardReceipt {
  readonly status: "applied" | "rejected";
  readonly command: RewardPreparationCommand;
  readonly reason: RewardRejection | null;
  readonly reward: FixtureReward | null;
  readonly processedAtMs: number;
  readonly nextAvailableAtMs: number | null;
}
export function parseRewardCommand(input: unknown): RewardPreparationCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid reward command");
  const row = input as Record<string, unknown>;
  const keys = ["key", "kind", "targetId", "ruleVersion"];
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key))
  )
    throw new TypeError("Unexpected reward command fields");
  if (
    typeof row.key !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      row.key,
    )
  )
    throw new RangeError("Invalid reward command key");
  assertIdentifier(row.targetId);
  if (row.kind !== "use_unistop" && row.kind !== "open_chest")
    throw new RangeError("Unknown preparation reward command");
  if (row.ruleVersion !== REWARD_PREPARATION_VERSION)
    throw new RangeError("Unsupported reward preparation version");
  return {
    key: row.key.toLowerCase(),
    kind: row.kind,
    targetId: row.targetId,
    ruleVersion: row.ruleVersion,
  };
}
export function parseFixtureReward(input: unknown): FixtureReward {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid fixed fixture reward");
  const row = input as Record<string, unknown>;
  if (
    Object.keys(row).length !== 2 ||
    !Object.hasOwn(row, "kind") ||
    !Object.hasOwn(row, "quantity") ||
    !["points", "crystals", "treasure_map", "key"].includes(
      row.kind as string,
    ) ||
    typeof row.quantity !== "number" ||
    !Number.isSafeInteger(row.quantity) ||
    row.quantity < 1
  )
    throw new RangeError("Invalid fixed fixture reward");
  return { kind: row.kind as FixtureRewardKind, quantity: row.quantity };
}
