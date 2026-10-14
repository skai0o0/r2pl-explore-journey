/** Signed ruleVersion 1. Reward weights are integer thousandths, never normalized. */

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

export interface SchoolConfig {
  readonly id: string;
  readonly slot: number;
  readonly shortName: string;
  readonly fullName: string;
  readonly color: string;
  readonly accent: string;
  readonly hq: { readonly x: number; readonly z: number };
}
export const SCHOOLS = [
  {
    id: "hcmut",
    slot: 0,
    shortName: "HCMUT",
    fullName: "Trường Đại học Bách khoa – ĐHQG TP.HCM",
    color: "#0062FF",
    accent: "#00E5FF",
    hq: {
      x: 200,
      z: 200,
    },
  },
  {
    id: "hcmcou",
    slot: 1,
    shortName: "HCMCOU",
    fullName: "Trường Đại học Mở TP.HCM",
    color: "#FF8C00",
    accent: "#FFD700",
    hq: {
      x: 500,
      z: 160,
    },
  },
  {
    id: "dtu",
    slot: 2,
    shortName: "DTU",
    fullName: "Đại học Duy Tân",
    color: "#E60026",
    accent: "#FF4D6D",
    hq: {
      x: 800,
      z: 200,
    },
  },
  {
    id: "dhhp",
    slot: 3,
    shortName: "DHHP",
    fullName: "Trường Đại học Hải Phòng",
    color: "#00A86B",
    accent: "#00FF9D",
    hq: {
      x: 840,
      z: 500,
    },
  },
  {
    id: "hsu",
    slot: 4,
    shortName: "HSU",
    fullName: "Trường Đại học Hoa Sen",
    color: "#7928CA",
    accent: "#FF0080",
    hq: {
      x: 800,
      z: 800,
    },
  },
  {
    id: "huce",
    slot: 5,
    shortName: "HUCE",
    fullName: "Đại học Xây dựng Hà Nội",
    color: "#E7C547",
    accent: "#FFF0A0",
    hq: {
      x: 500,
      z: 840,
    },
  },
  {
    id: "ntu",
    slot: 6,
    shortName: "NTU",
    fullName: "Đại học Nha Trang",
    color: "#00B8D9",
    accent: "#80FFFF",
    hq: {
      x: 200,
      z: 800,
    },
  },
  {
    id: "hcmiu",
    slot: 7,
    shortName: "HCMIU",
    fullName: "Đại học Quốc tế – ĐHQG TP.HCM",
    color: "#E85D9E",
    accent: "#FFB8DD",
    hq: {
      x: 160,
      z: 500,
    },
  },
] as const satisfies readonly SchoolConfig[];
/** Metadata adapted from approved V1 landmarks.ts; numeric combat bonuses are not active V2 rules. */
export const LANDMARKS = [
  {
    id: "fansipan",
    name: "Đỉnh Fansipan",
    category: "scenic",
    buffDescription: "Nóc nhà Đông Dương — tri thức vùng cao.",
    gameplayRole: "highland_fortress",
    x: 330,
    z: 280,
  },
  {
    id: "halong",
    name: "Vịnh Hạ Long",
    category: "scenic",
    buffDescription: "Vịnh ngàn đảo — khám phá kỳ quan ven biển.",
    gameplayRole: "natural_barrier",
    x: 500,
    z: 300,
  },
  {
    id: "nguhanhson",
    name: "Núi Ngũ Hành Sơn",
    category: "scenic",
    buffDescription: "Ngũ Sơn Tinh Tú — kết nối tri thức lân cận.",
    gameplayRole: "healing_sanctuary",
    x: 680,
    z: 300,
  },
  {
    id: "phongnha",
    name: "Động Phong Nha",
    category: "scenic",
    buffDescription: "Mạng lưới địa đạo — hành trình tri thức ngầm.",
    gameplayRole: "hidden_corridor",
    x: 720,
    z: 450,
  },
  {
    id: "nuibaden",
    name: "Núi Bà Đen",
    category: "scenic",
    buffDescription: "Đỉnh cao Đông Nam Bộ — tầm nhìn học thuật.",
    gameplayRole: "strategic_overlook",
    x: 700,
    z: 650,
  },
  {
    id: "thanglong",
    name: "Hoàng thành Thăng Long",
    category: "iconic",
    buffDescription: "Kinh đô ngàn năm — truyền thống hiếu học.",
    gameplayRole: "capitol",
    x: 550,
    z: 720,
  },
  {
    id: "canghaiphong",
    name: "Cảng Hải Phòng",
    category: "iconic",
    buffDescription: "Đầu mối hàng hải — giao lưu tri thức biển.",
    gameplayRole: "logistics_port",
    x: 370,
    z: 700,
  },
  {
    id: "kinhthanhhue",
    name: "Kinh Thành Huế",
    category: "iconic",
    buffDescription: "Cố đô văn hiến — gìn giữ tri thức di sản.",
    gameplayRole: "citadel",
    x: 280,
    z: 550,
  },
  {
    id: "bitexco",
    name: "Toà nhà Bitexco",
    category: "iconic",
    buffDescription: "Biểu tượng hiện đại — năng lượng tri thức đô thị.",
    gameplayRole: "economic_hub",
    x: 300,
    z: 400,
  },
  {
    id: "cairang",
    name: "Chợ nổi Cái Răng",
    category: "iconic",
    buffDescription: "Giao thoa văn hóa — tri thức sông nước.",
    gameplayRole: "trade_market",
    x: 500,
    z: 550,
  },
] as const;
export const GAME_CONFIG = {
  ruleVersion: 1,
  world: { width: 1000, height: 1000, schoolSlots: 16, fogRevealRadius: 2 },
  footprints: {
    hq: { width: 20, height: 20 },
    landmark: { width: 40, height: 40 },
    unistop: { width: 10, height: 2 },
    chest: { width: 2, height: 2 },
  },
  knowledge: {
    explorePoints: 1,
    sharedPoints: 2,
    maxSchools: 2,
    upkeepPoints: 1,
    upkeepCycleMs: 86400000,
    freeUpkeepMs: 86400000,
    consolidationHardMs: 172800000,
    consolidationRollingMs: 7200000,
    consolidationTilesPerPoint: 2,
    soloDecay: false,
  },
  landmark: {
    baseCrystals: 1000,
    takeoverStepPercent: 5,
    puzzleBonusPercent: 10,
    wrongGuessCooldownMs: 600000,
    puzzleEnabled: true,
    contributionSteps: [10, 20, 50],
  },
  rewards: {
    unistop: UNISTOP_REFERENCE,
    chest: CHEST_REFERENCE,
    weightTotal: 1000,
    chestKeyCost: 1,
    unistopCooldownMs: {
      aspire: 43200000,
      nitro: 86400000,
      predator: 86400000,
    },
    giftFallback: { unistop: 4, chest: 10 },
  },
  running: {
    kmToPointsRate: 10,
    timeZone: "Asia/Ho_Chi_Minh",
    weekStartsOn: 1,
  },
  staging: {
    stationsUnlocked: true,
    initialPoints: 1000,
    initialBotPoints: 5000,
    initialCrystals: 1000,
    initialKeysPerTier: 1,
    initialGiftStock: 0,
  },
} as const;
export interface WorldObject {
  readonly id: string;
  readonly kind: "hq" | "landmark" | "unistop" | "chest";
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly name: string;
  readonly schoolSlot?: number;
  readonly tier?: RewardProfile;
}
export const STAGING_OBJECTS: readonly WorldObject[] = [
  ...SCHOOLS.map((s) => ({
    id: `hq-${s.id}`,
    kind: "hq" as const,
    name: `${s.shortName} HQ`,
    x: s.hq.x,
    z: s.hq.z,
    ...GAME_CONFIG.footprints.hq,
    schoolSlot: s.slot,
  })),
  ...LANDMARKS.map((l) => ({
    id: l.id,
    kind: "landmark" as const,
    name: l.name,
    x: l.x,
    z: l.z,
    ...GAME_CONFIG.footprints.landmark,
  })),
  ...SCHOOLS.flatMap((s) =>
    (["aspire", "nitro", "predator"] as const).map((tier, i) => ({
      id: `dev-${tier}-${s.slot}`,
      kind: "unistop" as const,
      name: `${s.shortName} ${tier}`,
      x: s.hq.x + 30 + i * 16,
      z: s.hq.z,
      ...GAME_CONFIG.footprints.unistop,
      tier,
    })),
  ),
  ...SCHOOLS.flatMap((s) =>
    (["aspire", "nitro", "predator"] as const).map((tier, i) => ({
      id: `chest-${tier}-${s.slot}`,
      kind: "chest" as const,
      name: `Chest ${tier}`,
      x: s.hq.x + 30 + i * 16,
      z: s.hq.z + 16,
      ...GAME_CONFIG.footprints.chest,
      tier,
    })),
  ),
];
export function objectAt(
  x: number,
  z: number,
  objects: readonly WorldObject[],
): WorldObject | undefined {
  return objects.find(
    (o) =>
      x >= o.x - o.width / 2 &&
      x < o.x + o.width / 2 &&
      z >= o.z - o.height / 2 &&
      z < o.z + o.height / 2,
  );
}
