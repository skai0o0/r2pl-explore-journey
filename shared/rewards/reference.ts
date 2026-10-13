import {
  assertTimestamp,
  campaignWeekStart,
  parseRunningSnapshot,
  type RunningSnapshot,
  snapshotWire,
} from "../integration/running.ts";
import type { RewardOutcome, RewardProfile, RewardTable } from "./catalog.ts";

/** Preparation sampler only. No wallet, stock reservation, key spending or reward grant. */
export function selectReferenceReward(
  table: RewardTable,
  ticket: number,
): RewardOutcome {
  if (!Number.isSafeInteger(ticket) || ticket < 0 || ticket >= 1000)
    throw new RangeError("Invalid reward ticket");
  if (
    table.outcomes.length < 1 ||
    table.outcomes.length > 64 ||
    table.outcomes.some(
      (row) =>
        !["points", "crystals", "treasure_map", "key", "gift"].includes(
          row.kind,
        ) ||
        !Number.isSafeInteger(row.weight) ||
        row.weight < 0 ||
        !Number.isSafeInteger(row.quantity) ||
        row.quantity < 1,
    ) ||
    table.outcomes.reduce((sum, row) => sum + row.weight, 0) !== 1000
  )
    throw new RangeError("Invalid unnormalized reference table");
  let boundary = 0;
  for (const row of table.outcomes) {
    boundary += row.weight;
    if (ticket < boundary) return row;
  }
  throw new RangeError("Reward table has a gap");
}
export const UNISTOP_COOLDOWN_MS: Readonly<Record<RewardProfile, number>> =
  Object.freeze({
    aspire: 12 * 60 * 60 * 1000,
    nitro: 24 * 60 * 60 * 1000,
    predator: 24 * 60 * 60 * 1000,
  });
/** No saved spins: only last committed use determines the next availability. */
export function uniStopAvailability(
  profile: RewardProfile,
  lastCommittedUseMs: number | null,
  nowMs: number,
): { readonly available: boolean; readonly nextAvailableAtMs: number } {
  assertTimestamp(nowMs);
  if (!Object.hasOwn(UNISTOP_COOLDOWN_MS, profile))
    throw new RangeError("Unknown UniStop profile");
  if (lastCommittedUseMs === null)
    return { available: true, nextAvailableAtMs: nowMs };
  assertTimestamp(lastCommittedUseMs);
  if (lastCommittedUseMs > nowMs)
    throw new RangeError("Future UniStop receipt");
  const nextAvailableAtMs = lastCommittedUseMs + UNISTOP_COOLDOWN_MS[profile];
  assertTimestamp(nextAvailableAtMs);
  return { available: nowMs >= nextAvailableAtMs, nextAvailableAtMs };
}
/** Gamenote allows ingame access without running; this fact concerns Gift eligibility only.
 * Verified means fetched server-side for the bound actor, not a browser assertion.
 * Final Gift/redraw/stock policy still requires C-10/C-11; never filter/reweight a table.
 */
export function hasCurrentWeekRunning(
  snapshot: RunningSnapshot | null,
  nowMs: number,
): boolean {
  assertTimestamp(nowMs);
  if (snapshot !== null) parseRunningSnapshot(snapshotWire(snapshot));
  return (
    snapshot !== null &&
    snapshot.observedAtMs <= nowMs &&
    snapshot.weekStartMs === campaignWeekStart(nowMs) &&
    snapshot.weeklyMeters > 0n
  );
}
