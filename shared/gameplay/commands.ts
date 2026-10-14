import type { RewardOutcome, WorldObject } from "./gameConfig.ts";
export interface GameCommand {
  readonly ruleVersion: 1;
  readonly key: string;
  readonly action:
    | "contribute"
    | "guess"
    | "spin"
    | "open"
    | "running"
    | "upkeep"
    | "consolidate";
  readonly target?: string;
  readonly amount?: number;
  readonly guess?: string;
}
export interface LandmarkView {
  readonly id: string;
  readonly holder: number | null;
  readonly target: number;
  readonly pot: number;
  readonly solved: boolean;
  readonly cooldownUntil: number;
  readonly hasPath: boolean;
}
export interface GameView {
  readonly ruleVersion: 1;
  readonly crystals: string;
  readonly treasureMaps: string;
  readonly revealedTiles: number;
  readonly gifts: readonly { id: string; tier: string }[];
  readonly keys: Readonly<Record<"aspire" | "nitro" | "predator", string>>;
  readonly landmarks: readonly LandmarkView[];
  readonly chests: readonly WorldObject[];
  readonly cooldowns: Readonly<Record<string, number>>;
  readonly weeklyKm: number;
  readonly shared: readonly {
    id: string;
    pair: number[];
    tiles: number;
    due: number;
    freeUntil: number;
    guest: number | null;
    status: string;
    required: number;
    contributed: number;
    hardUntil: number;
    rollingUntil: number;
  }[];
  readonly events: readonly { id: string; title: string; body: string }[];
}
export interface GameReceipt {
  readonly status: "applied" | "rejected";
  readonly reason: string | null;
  readonly reward?: RewardOutcome;
  readonly discovery?: WorldObject;
  readonly nextAvailableAtMs?: number;
  readonly message: string;
}
export function parseGameCommand(input: unknown): GameCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid command");
  const v = input as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        !["ruleVersion", "key", "action", "target", "amount", "guess"].includes(
          k,
        ),
    ) ||
    v.ruleVersion !== 1 ||
    typeof v.key !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      v.key,
    ) ||
    typeof v.action !== "string" ||
    ![
      "contribute",
      "guess",
      "spin",
      "open",
      "running",
      "upkeep",
      "consolidate",
    ].includes(v.action)
  )
    throw new TypeError("Invalid command");
  if (
    v.target !== undefined &&
    (typeof v.target !== "string" || !/^[a-z0-9-]{1,100}$/.test(v.target))
  )
    throw new TypeError("Invalid target");
  if (
    v.amount !== undefined &&
    (!Number.isSafeInteger(v.amount) ||
      Number(v.amount) < 1 ||
      Number(v.amount) > 100000)
  )
    throw new RangeError("Invalid amount");
  if (
    v.guess !== undefined &&
    (typeof v.guess !== "string" || v.guess.length > 100)
  )
    throw new TypeError("Invalid guess");
  return {
    ruleVersion: 1,
    key: v.key as string,
    action: v.action as GameCommand["action"],
    ...(v.target === undefined ? {} : { target: v.target as string }),
    ...(v.amount === undefined ? {} : { amount: v.amount as number }),
    ...(v.guess === undefined ? {} : { guess: v.guess as string }),
  };
}
