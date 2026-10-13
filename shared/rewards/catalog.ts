/** Exact Gamenote reference profiles. Not a published reward ruleVersion. */
export type RewardProfile = "aspire" | "nitro" | "predator";
export interface RewardOutcome {
  readonly kind: "points" | "crystals" | "treasure_map" | "key" | "gift";
  readonly quantity: number;
  readonly weight: number;
}
export interface RewardTable {
  readonly referenceVersion: "gamenote-2026-10-12";
  readonly outcomes: readonly RewardOutcome[];
}
function table(
  rows: readonly (readonly [RewardOutcome["kind"], number, number])[],
): RewardTable {
  const outcomes = rows.map(([kind, quantity, weight]) =>
    Object.freeze({ kind, quantity, weight }),
  );
  if (
    outcomes.some(
      (row) =>
        !Number.isSafeInteger(row.weight) ||
        row.weight < 0 ||
        !Number.isSafeInteger(row.quantity) ||
        row.quantity < 1,
    ) ||
    outcomes.reduce((sum, row) => sum + row.weight, 0) !== 1000
  ) {
    throw new RangeError(
      "Reward reference must total exactly 1000; normalization forbidden",
    );
  }
  return Object.freeze({
    referenceVersion: "gamenote-2026-10-12",
    outcomes: Object.freeze(outcomes),
  });
}
export const UNISTOP_REFERENCE: Readonly<Record<RewardProfile, RewardTable>> =
  Object.freeze({
    aspire: table([
      ["points", 1, 325],
      ["points", 2, 100],
      ["points", 3, 50],
      ["crystals", 1, 325],
      ["crystals", 2, 100],
      ["crystals", 4, 50],
      ["treasure_map", 1, 30],
      ["key", 1, 20],
      ["gift", 1, 0],
    ]),
    nitro: table([
      ["points", 1, 295],
      ["points", 2, 110],
      ["points", 3, 70],
      ["crystals", 1, 295],
      ["crystals", 2, 110],
      ["crystals", 4, 70],
      ["treasure_map", 1, 30],
      ["key", 1, 19],
      ["gift", 1, 1],
    ]),
    predator: table([
      ["points", 1, 250],
      ["points", 2, 125],
      ["points", 3, 100],
      ["crystals", 1, 250],
      ["crystals", 2, 125],
      ["crystals", 4, 100],
      ["treasure_map", 1, 30],
      ["key", 1, 15],
      ["gift", 1, 5],
    ]),
  });
export const CHEST_REFERENCE: Readonly<Record<RewardProfile, RewardTable>> =
  Object.freeze({
    aspire: table([
      ["points", 1, 300],
      ["points", 2, 135],
      ["points", 5, 50],
      ["crystals", 1, 300],
      ["crystals", 5, 135],
      ["crystals", 10, 50],
      ["gift", 1, 30],
    ]),
    nitro: table([
      ["points", 1, 250],
      ["points", 2, 150],
      ["points", 5, 75],
      ["crystals", 1, 250],
      ["crystals", 5, 150],
      ["crystals", 10, 75],
      ["gift", 1, 50],
    ]),
    predator: table([
      ["points", 1, 200],
      ["points", 2, 165],
      ["points", 5, 100],
      ["crystals", 1, 200],
      ["crystals", 5, 165],
      ["crystals", 10, 100],
      ["gift", 1, 70],
    ]),
  });
