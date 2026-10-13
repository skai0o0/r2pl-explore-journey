import { randomInt } from "node:crypto";
import {
  CHEST_REFERENCE,
  type RewardOutcome,
  type RewardProfile,
  UNISTOP_REFERENCE,
} from "../../shared/rewards/catalog.ts";
import { selectReferenceReward } from "../../shared/rewards/reference.ts";

export function sampleReferenceReward(
  source: "unistop" | "chest",
  profile: RewardProfile,
): RewardOutcome {
  const tables =
    source === "unistop"
      ? UNISTOP_REFERENCE
      : source === "chest"
        ? CHEST_REFERENCE
        : null;
  if (!tables || !Object.hasOwn(tables, profile))
    throw new RangeError("Unknown reward reference profile");
  return selectReferenceReward(tables[profile], randomInt(1000));
}
