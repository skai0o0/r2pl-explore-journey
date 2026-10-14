import {
  GAME_CONFIG,
  LANDMARKS,
  type RewardProfile,
  SCHOOLS,
} from "../../../shared/gameplay/gameConfig.ts";
export const SCHOOL_IDS = SCHOOLS.map((s) => s.id);
export const SCHOOL_ROSTER: Record<
  string,
  {
    id: string;
    name: string;
    shortName: string;
    colorHex: string;
    accentHex: string;
  }
> = Object.fromEntries(
  SCHOOLS.map((s) => [
    s.id,
    {
      id: s.id,
      name: s.shortName,
      shortName: s.shortName,
      colorHex: s.color,
      accentHex: s.accent,
    },
  ]),
);
export const getSchoolColor = (id: string) =>
  SCHOOL_ROSTER[id]?.colorHex ?? "#94a3b8";
export const LANDMARK_ROSTER = Object.fromEntries(
  LANDMARKS.map((l) => [l.id, l]),
);
export const BEACON_CRYSTALS = GAME_CONFIG.landmark.baseCrystals;
export const landmarkGuessReward = (target: number) =>
  Math.floor((target * GAME_CONFIG.landmark.puzzleBonusPercent) / 100);
export const beaconOvertakeTarget = (current: number) =>
  current +
  Math.round(
    (BEACON_CRYSTALS * GAME_CONFIG.landmark.takeoverStepPercent) / 100,
  );
export type UniStopTier = RewardProfile;
export type LootRarity = "common" | "rare" | "epic" | "legendary";
export interface LootItem {
  id: string;
  name: string;
  type: "points" | "crystal" | "key" | "treasure_map" | "real_gift";
  rarity: LootRarity;
  amount?: number;
  isRealGift?: boolean;
  weight: number;
  description?: string;
}
export const UNISTOP_CONFIGS = Object.fromEntries(
  (["aspire", "nitro", "predator"] as const).map((tier) => [
    tier,
    {
      name: `UniStop ${tier}`,
      cooldownMs: GAME_CONFIG.rewards.unistopCooldownMs[tier],
    },
  ]),
) as Record<RewardProfile, { name: string; cooldownMs: number }>;
export const durationText = (seconds: number) =>
  `${Math.ceil(seconds / 60)} phút`;
/** Signed V2: school contact or staging unlock is supplied by server; weekly km affects Gift only. */
export function uniStopAvailability(
  _owner: string,
  _school: string,
  cooldown: number,
  now: number,
  ready: boolean,
): {
  status: "syncing" | "cooldown" | "ready";
  remainingSeconds: number;
  canClaim: boolean;
} {
  const remainingSeconds = Math.max(0, Math.ceil((cooldown - now) / 1000));
  return {
    status: !ready ? "syncing" : remainingSeconds ? "cooldown" : "ready",
    remainingSeconds,
    canClaim: ready && !remainingSeconds,
  };
}
