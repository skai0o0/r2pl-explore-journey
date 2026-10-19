import {
  GAME_CONFIG,
  type RewardOutcome,
  type RewardProfile,
} from "./gameConfig.ts";

export const GIFT_TIERS = ["aspire", "nitro", "predator"] as const;
export interface GiftPoolItem {
  readonly id: string;
  readonly tier: RewardProfile;
  readonly name: string;
  readonly remaining: number;
  readonly awarded: number;
  readonly active: boolean;
}
export interface GiftPoolSnapshot {
  readonly revision: number;
  readonly items: readonly GiftPoolItem[];
  readonly totals: Readonly<Record<RewardProfile, number>>;
}
export type GiftPoolCommand = {
  readonly action: "upsert" | "archive";
  readonly expectedRevision: number;
  readonly id?: string;
  readonly tier?: RewardProfile;
  readonly name?: string;
  readonly remaining?: number;
};

/** Keep the reference and its zero-weight Gift row intact; never normalize. */
export function effectiveRewardOutcomes(
  kind: "unistop" | "chest",
  tier: RewardProfile,
  stock: number,
  weeklyEligible = true,
): readonly RewardOutcome[] {
  const rows = GAME_CONFIG.rewards[kind][tier].outcomes;
  if (stock > 0 && weeklyEligible) return rows;
  const quantity =
    stock > 0
      ? GAME_CONFIG.rewards.giftFallback[kind]
      : GAME_CONFIG.rewards.emptyGiftPoolCrystals;
  const giftWeight = rows
    .filter((r) => r.kind === "gift")
    .reduce((sum, r) => sum + r.weight, 0);
  return rows.map((r) =>
    r.kind === "gift"
      ? { ...r, weight: 0 }
      : r.kind === "crystals" && r.quantity === quantity
        ? { ...r, weight: r.weight + giftWeight }
        : r,
  );
}

export function giftPoolTotals(
  items: readonly GiftPoolItem[],
): Record<RewardProfile, number> {
  return Object.fromEntries(
    GIFT_TIERS.map((tier) => [
      tier,
      items
        .filter((item) => item.active && item.tier === tier)
        .reduce((sum, item) => sum + item.remaining, 0),
    ]),
  ) as Record<RewardProfile, number>;
}

export function parseGiftPoolCommand(input: unknown): GiftPoolCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("INVALID_GIFT_POOL_COMMAND");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "action",
          "expectedRevision",
          "id",
          "tier",
          "name",
          "remaining",
        ].includes(key),
    ) ||
    !["upsert", "archive"].includes(String(value.action)) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 0 ||
    (value.id !== undefined &&
      (typeof value.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(value.id)))
  )
    throw new TypeError("INVALID_GIFT_POOL_COMMAND");
  if (value.action === "archive") {
    if (
      !value.id ||
      value.tier !== undefined ||
      value.name !== undefined ||
      value.remaining !== undefined
    )
      throw new TypeError("INVALID_GIFT_POOL_COMMAND");
  } else if (
    !GIFT_TIERS.includes(value.tier as RewardProfile) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.trim().length > GAME_CONFIG.rewards.giftPool.maxNameLength ||
    Array.from(value.name).some((char) => char.charCodeAt(0) < 32) ||
    !Number.isSafeInteger(value.remaining) ||
    Number(value.remaining) < 0 ||
    Number(value.remaining) > GAME_CONFIG.rewards.giftPool.maxRemainingPerItem
  )
    throw new TypeError("INVALID_GIFT_POOL_COMMAND");
  return {
    ...value,
    ...(typeof value.name === "string" ? { name: value.name.trim() } : {}),
  } as GiftPoolCommand;
}
