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
  readonly emailDomains: readonly string[];
  readonly color: string;
  readonly accent: string;
  readonly hq: { readonly x: number; readonly z: number };
}
export const SCHOOLS = [
  {
    id: "hcmut",
    slot: 0,
    shortName: "HCMUT",
    fullName: "Đại Học Bách Khoa_Hồ Chí Minh",
    emailDomains: ["hcmut.edu.vn"],
    color: "#0062FF",
    accent: "#00E5FF",
    hq: {
      x: 500,
      z: 280,
    },
  },
  {
    id: "ou",
    slot: 1,
    shortName: "OU",
    fullName: "Đại Học Mở_Hồ Chí Minh",
    emailDomains: ["ou.edu.vn"],
    color: "#FF8C00",
    accent: "#FFD700",
    hq: {
      x: 655,
      z: 345,
    },
  },
  {
    id: "dtu",
    slot: 2,
    shortName: "DTU",
    fullName: "Đại Học Duy Tân_Đà Nẵng",
    emailDomains: ["dtu.edu.vn"],
    color: "#E60026",
    accent: "#FF4D6D",
    hq: {
      x: 720,
      z: 500,
    },
  },
  {
    id: "hpuni",
    slot: 3,
    shortName: "HPUNI",
    fullName: "Đại Học Hải Phòng",
    emailDomains: ["hpuni.edu.vn"],
    color: "#00A86B",
    accent: "#00FF9D",
    hq: {
      x: 655,
      z: 655,
    },
  },
  {
    id: "hsu",
    slot: 4,
    shortName: "HSU",
    fullName: "Đại Học Hoa Sen_Hồ Chí Minh",
    emailDomains: ["sinhvien.hoasen.edu.vn"],
    color: "#7928CA",
    accent: "#FF0080",
    hq: {
      x: 500,
      z: 720,
    },
  },
  {
    id: "huce",
    slot: 5,
    shortName: "HUCE",
    fullName: "Đại Học Xây Dựng_Hà Nội",
    emailDomains: ["st.huce.edu.vn"],
    color: "#E7C547",
    accent: "#FFF0A0",
    hq: {
      x: 345,
      z: 655,
    },
  },
  {
    id: "ntu",
    slot: 6,
    shortName: "NTU",
    fullName: "Đại Học Nha Trang",
    emailDomains: ["ntu.edu.vn"],
    color: "#00B8D9",
    accent: "#80FFFF",
    hq: {
      x: 280,
      z: 500,
    },
  },
  {
    id: "hcmiu",
    slot: 7,
    shortName: "HCMIU",
    fullName: "Đại Học Quốc Tế",
    emailDomains: ["student.hcmiu.edu.vn"],
    color: "#E85D9E",
    accent: "#FFB8DD",
    hq: {
      x: 345,
      z: 345,
    },
  },
] as const satisfies readonly SchoolConfig[];
/** Stable internal identifiers and placement for the ten intentionally unnamed sites. */
export const LANDMARKS = [
  {
    id: "fansipan",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 500,
    z: 450,
  },
  {
    id: "halong",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 575,
    z: 330,
  },
  {
    id: "nguhanhson",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 670,
    z: 575,
  },
  {
    id: "phongnha",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 330,
    z: 425,
  },
  {
    id: "nuibaden",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 425,
    z: 330,
  },
  {
    id: "thanglong",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 500,
    z: 550,
  },
  {
    id: "canghaiphong",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 670,
    z: 425,
  },
  {
    id: "kinhthanhhue",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 575,
    z: 670,
  },
  {
    id: "bitexco",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 425,
    z: 670,
  },
  {
    id: "cairang",
    name: "Công trình bí ẩn",
    buffDescription: "Đặc quyền tri thức dành cho trường đang thắp Đèn hiệu.",
    x: 330,
    z: 575,
  },
] as const;
/** Server consumers only. A separate export keeps the private pool out of client bundles. */
export const BEACON_BUFF_CONFIG = {
  dayMs: 86400000,
  dayOffsetMs: 25200000,
  rankBands: [3, 5],
  scoutRadius: 3,
  rates: {
    vanguard: { every: 2, limit: 10, cap: 5 },
    assault: { every: 2, limit: 10, cap: 5 },
    thrift: { every: 20, cap: 5 },
    breakthrough: { every: 5, cap: 20 },
    foothold: { every: 2, cap: 10 },
  },
  vision: { radius: 3, burstLimit: 20 },
  scouts: { dailyCap: 1 },
  crystals: {
    urgent: { flat: 1, limit: 10, cap: 10 },
    excavation: { flat: 2, limit: 5, cap: 10 },
    reserve: { percent: 10, cap: 10 },
    harvest: { percent: 10, cap: 10 },
    reinforcement: { percent: 25, cap: 20 },
    revival: { percent: 25, cap: 20 },
  },
  cooldown: { supply: 10, return: 20 },
  upkeep: { percent: 10, cap: 10 },
  consolidation: { percent: 10, cap: 10 },
  cohort: { students: 10, points: 5 },
  comeback: { tiles: 10, spins: 1, points: 5 },
} as const;
export const GAME_CONFIG = {
  realtime: {
    schoolBatchMs: 100,
    rivalBatchMs: 12_000,
    objectPollMs: 500,
    fallbackPollMs: 60_000,
  },
  notifications: {
    liveTtlMs: 60_000,
    queueTtlMs: 30_000,
    maxQueued: 10,
    bannerMs: 6000,
    streamPollMs: 1000,
    streamBatch: 100,
    portalBatch: 50,
    portalLeaseMs: 90_000,
    portalTtlMs: 7 * 24 * 60 * 60 * 1000,
    portalMaxAttempts: 8,
  },
  adminAccess: {
    minPasswordLength: 10,
    maxPasswordLength: 128,
    loginWindowMs: 15 * 60 * 1000,
    maxEmailAttempts: 10,
    maxOriginAttempts: 100,
    accountLimit: 500,
    auditLimit: 100,
  },
  editor: {
    maxObjects: 200,
    maxUndo: 60,
    pollMs: 3000,
    maxHistory: 30,
    maxBodyBytes: 131072,
  },
  integration: {
    contractVersion: 1,
    requestSkewMs: 300_000,
    maxBodyBytes: 16_384,
    launchTtlMs: 60_000,
    sessionTtlMs: 3_600_000,
    sessionRecheckMs: 5_000,
    profileRefreshMs: 5_000,
    socketTicketTtlMs: 60_000,
    bootstrapTimeoutMs: 20_000,
    dummySessionTtlMs: 28_800_000,
    dummySyncPollMs: 3_000,
    dummySyncBatchSize: 8,
    dummyMaxActivityMeters: 100_000,
    dummyAuthRequestsPerMinute: 12,
    requestsPerMinute: 300,
    initialPoints: 0,
    initialCrystals: 0,
    initialKeysPerTier: 0,
  },
  ruleVersion: 1,
  world: { width: 1000, height: 1000, schoolSlots: 16, fogRevealRadius: 2 },
  presentation: { labelNameSpan: 160, labelGap: 8, markerIconSize: 22 },
  terrain: {
    heightSeed: 1337,
    moistureSeed: 9999,
    heightFrequency: 0.009,
    moistureFrequency: 0.013,
    hillThresholds: [0.12, 0.36, 0.62],
    hillHeights: [0.4, 0.85, 1.35],
    waterHeight: -0.35,
    sandHeight: -0.05,
    shoreWidth: 2,
    lakeRadius: 26,
    riverHalfWidth: 5,
    meadowMoisture: 0.58,
    schoolTintOpacity: 0.68,
    territoryEdgeWidth: 0.07,
    mistColors: [0x0b1620, 0x132330],
    foundations: {
      hqRadius: 13,
      landmark: [44, 44],
      unistop: [14, 6],
      chest: [4, 4],
    },
    detailSpan: 400,
    coarseStep: 8,
    detailCacheChunks: 48,
    propCacheChunks: 64,
    buildRowsPerFrame: 8,
    grassSpacing: 2,
    treeSpacing: 6,
  },
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
    activationStepCrystals: 100,
    pointsPerCrystal: 1,
    rallyCooldownMs: 900000,
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
    emptyGiftPoolCrystals: 1,
    giftPool: {
      maxItems: 200,
      maxRemainingPerItem: 100000,
      maxTotal: 1000000,
      maxNameLength: 100,
    },
  },
  running: {
    kmToPointsRate: 10,
    timeZone: "Asia/Ho_Chi_Minh",
    weekStartsOn: 1,
  },
  staging: {
    stationsUnlocked: false,
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
  readonly ownerSchoolSlot?: number | null;
  readonly ownerSchoolId?: string | null;
}
/** Nearest (clockwise) ring Landmark each school pushes toward first. */
export const FIRST_LANDMARK_BY_SLOT: readonly string[] = [
  "halong",
  "canghaiphong",
  "nguhanhson",
  "kinhthanhhue",
  "bitexco",
  "cairang",
  "phongnha",
  "nuibaden",
];
/** Default 15 neutral UniStops: 8 Aspire outer, 5 Nitro middle, 2 Predator central. */
export const NEUTRAL_UNISTOPS: readonly WorldObject[] = [
  // 8 Aspire in outer ring (stepping stones near each school)
  {
    id: "unistop_aspire_1",
    kind: "unistop",
    name: "UniStop - Aspire #1",
    x: 532,
    z: 301,
    width: 10,
    height: 2,
    tier: "aspire",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_aspire_2",
    kind: "unistop",
    name: "UniStop - Aspire #2",
    x: 660,
    z: 373,
    width: 10,
    height: 2,
    tier: "aspire",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_aspire_3",
    kind: "unistop",
    name: "UniStop - Aspire #3",
    x: 701,
    z: 528,
    width: 10,
    height: 2,
    tier: "aspire",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_aspire_4",
    kind: "unistop",
    name: "UniStop - Aspire #4",
    x: 623,
    z: 661,
    width: 10,
    height: 2,
    tier: "aspire",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_aspire_5",
    kind: "unistop",
    name: "UniStop - Aspire #5",
    x: 468,
    z: 699,
    width: 10,
    height: 2,
    tier: "aspire",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_aspire_6",
    kind: "unistop",
    name: "UniStop - Aspire #6",
    x: 340,
    z: 627,
    width: 10,
    height: 2,
    tier: "aspire",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_aspire_7",
    kind: "unistop",
    name: "UniStop - Aspire #7",
    x: 299,
    z: 472,
    width: 10,
    height: 2,
    tier: "aspire",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_aspire_8",
    kind: "unistop",
    name: "UniStop - Aspire #8",
    x: 377,
    z: 339,
    width: 10,
    height: 2,
    tier: "aspire",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  // 5 Nitro in middle ring
  {
    id: "unistop_nitro_1",
    kind: "unistop",
    name: "UniStop - Nitro #1",
    x: 500,
    z: 360,
    width: 10,
    height: 2,
    tier: "nitro",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_nitro_2",
    kind: "unistop",
    name: "UniStop - Nitro #2",
    x: 630,
    z: 460,
    width: 10,
    height: 2,
    tier: "nitro",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_nitro_3",
    kind: "unistop",
    name: "UniStop - Nitro #3",
    x: 580,
    z: 600,
    width: 10,
    height: 2,
    tier: "nitro",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_nitro_4",
    kind: "unistop",
    name: "UniStop - Nitro #4",
    x: 420,
    z: 600,
    width: 10,
    height: 2,
    tier: "nitro",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_nitro_5",
    kind: "unistop",
    name: "UniStop - Nitro #5",
    x: 370,
    z: 460,
    width: 10,
    height: 2,
    tier: "nitro",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  // 2 Predator in central area (430..570)
  {
    id: "unistop_predator_1",
    kind: "unistop",
    name: "UniStop - Predator #1",
    x: 450,
    z: 500,
    width: 10,
    height: 2,
    tier: "predator",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
  {
    id: "unistop_predator_2",
    kind: "unistop",
    name: "UniStop - Predator #2",
    x: 550,
    z: 500,
    width: 10,
    height: 2,
    tier: "predator",
    ownerSchoolSlot: null,
    ownerSchoolId: null,
  },
];
/** Default 15 neutral Chests: 8 Aspire outer, 5 Nitro middle, 2 Predator central. */
export const NEUTRAL_CHESTS: readonly WorldObject[] = [
  // 8 Aspire Chests
  {
    id: "chest_aspire_1",
    kind: "chest",
    name: "Rương Aspire #1",
    x: 532,
    z: 307,
    width: 2,
    height: 2,
    tier: "aspire",
  },
  {
    id: "chest_aspire_2",
    kind: "chest",
    name: "Rương Aspire #2",
    x: 660,
    z: 379,
    width: 2,
    height: 2,
    tier: "aspire",
  },
  {
    id: "chest_aspire_3",
    kind: "chest",
    name: "Rương Aspire #3",
    x: 701,
    z: 534,
    width: 2,
    height: 2,
    tier: "aspire",
  },
  {
    id: "chest_aspire_4",
    kind: "chest",
    name: "Rương Aspire #4",
    x: 623,
    z: 667,
    width: 2,
    height: 2,
    tier: "aspire",
  },
  {
    id: "chest_aspire_5",
    kind: "chest",
    name: "Rương Aspire #5",
    x: 468,
    z: 705,
    width: 2,
    height: 2,
    tier: "aspire",
  },
  {
    id: "chest_aspire_6",
    kind: "chest",
    name: "Rương Aspire #6",
    x: 340,
    z: 633,
    width: 2,
    height: 2,
    tier: "aspire",
  },
  {
    id: "chest_aspire_7",
    kind: "chest",
    name: "Rương Aspire #7",
    x: 299,
    z: 478,
    width: 2,
    height: 2,
    tier: "aspire",
  },
  {
    id: "chest_aspire_8",
    kind: "chest",
    name: "Rương Aspire #8",
    x: 377,
    z: 345,
    width: 2,
    height: 2,
    tier: "aspire",
  },
  // 5 Nitro Chests
  {
    id: "chest_nitro_1",
    kind: "chest",
    name: "Rương Nitro #1",
    x: 500,
    z: 366,
    width: 2,
    height: 2,
    tier: "nitro",
  },
  {
    id: "chest_nitro_2",
    kind: "chest",
    name: "Rương Nitro #2",
    x: 630,
    z: 466,
    width: 2,
    height: 2,
    tier: "nitro",
  },
  {
    id: "chest_nitro_3",
    kind: "chest",
    name: "Rương Nitro #3",
    x: 580,
    z: 606,
    width: 2,
    height: 2,
    tier: "nitro",
  },
  {
    id: "chest_nitro_4",
    kind: "chest",
    name: "Rương Nitro #4",
    x: 420,
    z: 606,
    width: 2,
    height: 2,
    tier: "nitro",
  },
  {
    id: "chest_nitro_5",
    kind: "chest",
    name: "Rương Nitro #5",
    x: 370,
    z: 466,
    width: 2,
    height: 2,
    tier: "nitro",
  },
  // 2 Predator Chests
  {
    id: "chest_predator_1",
    kind: "chest",
    name: "Rương Predator #1",
    x: 450,
    z: 506,
    width: 2,
    height: 2,
    tier: "predator",
  },
  {
    id: "chest_predator_2",
    kind: "chest",
    name: "Rương Predator #2",
    x: 550,
    z: 506,
    width: 2,
    height: 2,
    tier: "predator",
  },
];
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
  ...NEUTRAL_UNISTOPS,
  ...NEUTRAL_CHESTS,
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
