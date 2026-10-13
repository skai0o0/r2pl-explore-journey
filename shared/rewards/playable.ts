/** Synthetic frontend integration contract. Does not define production gameplay rules. */
import { assertTimestamp } from "../integration/running.ts";
import {
  parseFixtureReward,
  parseRewardCommand,
  type RewardReceipt,
} from "./commands.ts";

const record = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid reward response");
  return input as Record<string, unknown>;
};
const fields = (row: Record<string, unknown>, allowed: readonly string[]) => {
  if (
    Object.keys(row).length !== allowed.length ||
    allowed.some((key) => !Object.hasOwn(row, key))
  )
    throw new TypeError("Unexpected reward response fields");
};
export function parseRewardReceipt(input: unknown): RewardReceipt {
  const row = record(input);
  fields(row, [
    "status",
    "command",
    "reason",
    "reward",
    "processedAtMs",
    "nextAvailableAtMs",
  ]);
  if (row.status !== "applied" && row.status !== "rejected")
    throw new TypeError("Invalid reward status");
  const reason = row.reason;
  if (
    reason !== null &&
    !["NOT_AVAILABLE", "COOLDOWN", "KEY_REQUIRED", "POLICY_PENDING"].includes(
      reason as string,
    )
  )
    throw new TypeError("Invalid reward reason");
  assertTimestamp(row.processedAtMs);
  if (row.nextAvailableAtMs !== null) assertTimestamp(row.nextAvailableAtMs);
  const reward = row.reward === null ? null : parseFixtureReward(row.reward);
  if (
    (row.status === "applied" && (reason !== null || reward === null)) ||
    (row.status === "rejected" && (reason === null || reward !== null))
  )
    throw new TypeError("Inconsistent reward receipt");
  return {
    status: row.status,
    command: parseRewardCommand(row.command),
    reason: reason as RewardReceipt["reason"],
    reward,
    processedAtMs: row.processedAtMs,
    nextAvailableAtMs: row.nextAvailableAtMs,
  };
}
export function parseBalance(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^(0|[1-9][0-9]{0,18})$/.test(input) ||
    BigInt(input) > 9223372036854775807n
  )
    throw new RangeError("Invalid fixture balance");
  return input;
}
export interface DevInventory {
  readonly credits: string;
  readonly crystals: string;
  readonly treasureMaps: string;
  readonly keys: string;
}
export function parseDevInventory(input: unknown): DevInventory {
  const row = record(input);
  fields(row, ["credits", "crystals", "treasureMaps", "keys"]);
  return {
    credits: parseBalance(row.credits),
    crystals: parseBalance(row.crystals),
    treasureMaps: parseBalance(row.treasureMaps),
    keys: parseBalance(row.keys),
  };
}
export interface PrivateRewardPage {
  readonly events: readonly {
    readonly id: string;
    readonly receipt: RewardReceipt;
  }[];
  readonly nextCursor: string;
}
export function parsePrivateRewardPage(input: unknown): PrivateRewardPage {
  const row = record(input);
  fields(row, ["fixtureOnly", "events", "nextCursor"]);
  if (
    row.fixtureOnly !== true ||
    !Array.isArray(row.events) ||
    row.events.length > 50
  )
    throw new RangeError("Invalid private reward page");
  const events = row.events.map((raw) => {
    const event = record(raw);
    fields(event, ["id", "receipt"]);
    const id = parseBalance(event.id);
    if (id === "0") throw new RangeError("Invalid reward event");
    return { id, receipt: parseRewardReceipt(event.receipt) };
  });
  for (let i = 1; i < events.length; i++)
    if (BigInt(events[i]!.id) <= BigInt(events[i - 1]!.id))
      throw new RangeError("Unordered reward events");
  const nextCursor = parseBalance(row.nextCursor);
  if (events.length && nextCursor !== events.at(-1)!.id)
    throw new RangeError("Invalid reward cursor");
  return { events, nextCursor };
}

import { assertIdentifier } from "../integration/running.ts";
import { REWARD_PREPARATION_VERSION } from "./commands.ts";
export interface DevRewardTarget {
  readonly targetId: string;
  readonly kind: "unistop" | "chest";
  readonly profile: "aspire" | "nitro" | "predator" | null;
  readonly policyPending: boolean;
  readonly claimed: boolean;
  readonly available: boolean;
  readonly nextAvailableAtMs: number | null;
}
export function parseRewardCatalog(input: unknown): readonly DevRewardTarget[] {
  const page = record(input);
  fields(page, ["fixtureOnly", "ruleVersion", "targets"]);
  if (
    page.fixtureOnly !== true ||
    page.ruleVersion !== REWARD_PREPARATION_VERSION ||
    !Array.isArray(page.targets) ||
    page.targets.length > 64
  )
    throw new RangeError("Invalid reward catalog");
  const ids = new Set<string>();
  return page.targets.map((raw) => {
    const row = record(raw);
    fields(row, [
      "targetId",
      "kind",
      "profile",
      "policyPending",
      "claimed",
      "available",
      "nextAvailableAtMs",
    ]);
    assertIdentifier(row.targetId);
    if (ids.has(row.targetId)) throw new RangeError("Duplicate reward target");
    ids.add(row.targetId);
    if (
      (row.kind !== "unistop" && row.kind !== "chest") ||
      (row.kind === "chest"
        ? row.profile !== null
        : !["aspire", "nitro", "predator"].includes(row.profile as string)) ||
      typeof row.policyPending !== "boolean" ||
      typeof row.claimed !== "boolean" ||
      typeof row.available !== "boolean" ||
      ((row.policyPending || row.claimed) && row.available)
    )
      throw new TypeError("Invalid reward target");
    if (row.nextAvailableAtMs !== null) assertTimestamp(row.nextAvailableAtMs);
    return {
      targetId: row.targetId,
      kind: row.kind,
      profile: row.profile as DevRewardTarget["profile"],
      policyPending: row.policyPending,
      claimed: row.claimed,
      available: row.available,
      nextAvailableAtMs: row.nextAvailableAtMs,
    };
  });
}
