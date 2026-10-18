import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import type { ActiveBeaconView } from "../../shared/gameplay/commands.ts";
import {
  BEACON_BUFF_CONFIG as C,
  GAME_CONFIG,
  SCHOOLS,
} from "../../shared/gameplay/gameConfig.ts";

export interface BeaconState {
  holder: number | null;
  takeovers: number;
  lastCost?: number;
  pots: Record<string, number>;
  solved: number[];
  cooldowns: Record<string, number>;
}
export interface SchoolBeacon {
  version: 2;
  activations: number;
  lastCost: number;
  active: string | null;
  buffId: string | null;
  previous: string[];
  rankAtActivation?: number;
  activatedAt?: number;
}
type Band = "front" | "middle" | "comeback";
interface Buff {
  id: string;
  band: Band;
  name: string;
  description: string;
}
// This table and the rank decision are deliberately server-only.
export const BUFF_POOL: readonly Buff[] = [
  {
    id: "vanguard",
    band: "front",
    name: "Tiên phong",
    description:
      "10 ô đơn đầu mỗi ngày: mở 2 ô hoàn 1 Point, tối đa 5 Points/trường.",
  },
  {
    id: "wide",
    band: "front",
    name: "Tầm nhìn rộng",
    description:
      "20 lần mở ô đầu mỗi ngày vén sương 7×7; không cấp quyền sở hữu.",
  },
  {
    id: "scout",
    band: "front",
    name: "Trinh sát nhanh",
    description: "Mỗi ngày trinh sát một vùng 7×7 sát biên tri thức trường.",
  },
  {
    id: "urgent",
    band: "front",
    name: "Tiếp tế khẩn",
    description:
      "10 lượt UniStop trúng Tinh thể đầu mỗi ngày được thêm 1 Tinh thể/lượt/trường.",
  },
  {
    id: "excavation",
    band: "front",
    name: "Khai quật nhanh",
    description:
      "5 rương trúng Tinh thể đầu mỗi ngày được thêm 2 Tinh thể/rương/trường.",
  },
  {
    id: "assault",
    band: "front",
    name: "Mũi tiến công",
    description:
      "10 lần tham gia ô chung đầu mỗi ngày: 2 lần hoàn 1 Point, tối đa 5 Points/trường.",
  },
  {
    id: "thrift",
    band: "middle",
    name: "Tích tiểu thành đại",
    description: "Mở 20 ô đơn hoàn 1 Point, tối đa 5 Points/trường/ngày.",
  },
  {
    id: "supply",
    band: "middle",
    name: "Nhịp tiếp tế",
    description: "Cooldown UniStop của lượt quay mới giảm 10%.",
  },
  {
    id: "reserve",
    band: "middle",
    name: "Kho dự trữ",
    description:
      "Tinh thể từ UniStop +10%, tối đa thêm 10 Tinh thể/trường/ngày.",
  },
  {
    id: "harvest",
    band: "middle",
    name: "Thu hoạch đều",
    description: "Tinh thể từ rương +10%, tối đa thêm 10 Tinh thể/trường/ngày.",
  },
  {
    id: "upkeep",
    band: "middle",
    name: "Hậu phương vững",
    description:
      "Hoàn 10% Points duy trì ô chung, tối đa 10 Points/trường/ngày; tích lũy đủ đơn vị mới hoàn.",
  },
  {
    id: "consolidation",
    band: "middle",
    name: "Củng cố bền vững",
    description:
      "Hoàn tất củng cố vùng được hoàn 10% tổng Points cần góp, tối đa 10 Points/trường/ngày.",
  },
  {
    id: "cohort",
    band: "middle",
    name: "Đồng lòng",
    description:
      "10 sinh viên khác nhau mở ô hợp lệ trong ngày: người hoàn thành cuối nhận 5 Points, một lần/trường/ngày.",
  },
  {
    id: "breakthrough",
    band: "comeback",
    name: "Bứt phá",
    description: "Mở 5 ô đơn hoàn 1 Point, tối đa 20 Points/trường/ngày.",
  },
  {
    id: "vision",
    band: "comeback",
    name: "Mở đường",
    description: "Mở ô thành công vén sương 7×7; không cấp quyền sở hữu.",
  },
  {
    id: "reinforcement",
    band: "comeback",
    name: "Tiếp viện",
    description:
      "Tinh thể từ UniStop +25%, tối đa thêm 20 Tinh thể/trường/ngày.",
  },
  {
    id: "revival",
    band: "comeback",
    name: "Kho báu hồi sinh",
    description: "Tinh thể từ rương +25%, tối đa thêm 20 Tinh thể/trường/ngày.",
  },
  {
    id: "return",
    band: "comeback",
    name: "Nhịp trở lại",
    description: "Cooldown UniStop của lượt quay mới giảm 20%.",
  },
  {
    id: "foothold",
    band: "comeback",
    name: "Giành chỗ đứng",
    description:
      "Tham gia ô chung 2 lần hoàn 1 Point, tối đa 10 Points/trường/ngày.",
  },
  {
    id: "comeback",
    band: "comeback",
    name: "Tái xuất",
    description:
      "Mở 10 ô mới và quay 1 UniStop hợp lệ trong ngày: người hoàn thành cuối nhận 5 Points, một lần/trường/ngày.",
  },
];
export const emptySchoolBeacon = (): SchoolBeacon => ({
  version: 2,
  activations: 0,
  lastCost: 0,
  active: null,
  buffId: null,
  previous: [],
});
export const emptyBeacon = (): BeaconState => ({
  holder: null,
  takeovers: 0,
  pots: {},
  solved: [],
  cooldowns: {},
});
export async function readState<T>(
  db: PoolClient,
  campaign: string,
  scope: string,
  id: string,
  fallback: T,
): Promise<T> {
  return (
    (
      await db.query<{ data: T }>(
        "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope=$2 AND id=$3",
        [campaign, scope, id],
      )
    ).rows[0]?.data ?? fallback
  );
}
export async function writeState(
  db: PoolClient,
  campaign: string,
  scope: string,
  id: string,
  data: unknown,
): Promise<void> {
  await db.query(
    "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data",
    [campaign, scope, id, JSON.stringify(data)],
  );
}
export function schoolBeacon(db: PoolClient, campaign: string, slot: number) {
  return readState(
    db,
    campaign,
    "school-beacon",
    String(slot),
    emptySchoolBeacon(),
  );
}
export function nextBeaconTarget(
  beacon: BeaconState,
  school: SchoolBeacon,
): number {
  return Math.max(
    GAME_CONFIG.landmark.baseCrystals,
    school.lastCost
      ? school.lastCost + GAME_CONFIG.landmark.activationStepCrystals
      : 0,
    beacon.lastCost
      ? beacon.lastCost + GAME_CONFIG.landmark.activationStepCrystals
      : 0,
  );
}
export function activeView(state: SchoolBeacon): ActiveBeaconView | undefined {
  const buff = BUFF_POOL.find((b) => b.id === state.buffId);
  return state.active && buff
    ? {
        landmarkId: state.active,
        name: buff.name,
        description: buff.description,
      }
    : undefined;
}
export function bandForRank(rank: number): Band {
  return rank <= C.rankBands[0]
    ? "front"
    : rank <= C.rankBands[1]
      ? "middle"
      : "comeback";
}
export async function chooseBuff(
  db: PoolClient,
  campaign: string,
  slot: number,
  previous: readonly string[],
) {
  const rows = (
    await db.query<{
      id: string;
      data: { points: number; reachedAtMs: number };
    }>(
      "SELECT id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='knowledge-score'",
      [campaign],
    )
  ).rows;
  const ranking = SCHOOLS.map((s) => ({
    slot: s.slot,
    ...(rows.find((r) => Number(r.id) === s.slot)?.data ?? {
      points: 0,
      reachedAtMs: 0,
    }),
  })).sort(
    (a, b) =>
      b.points - a.points || a.reachedAtMs - b.reachedAtMs || a.slot - b.slot,
  );
  const rank = ranking.findIndex((r) => r.slot === slot) + 1;
  const candidates = BUFF_POOL.filter(
    (b) => b.band === bandForRank(rank) && !previous.slice(-2).includes(b.id),
  );
  return { buff: candidates[randomInt(candidates.length)]!, rank };
}
/** One-time durable migration of old per-landmark ownership, with no wallet grants. */
export async function migrateBeacons(
  db: PoolClient,
  campaign: string,
): Promise<void> {
  if ((await readState(db, campaign, "beacon-schema", "version", 0)) === 2)
    return;
  const rows = (
    await db.query<{ id: string; data: BeaconState }>(
      "SELECT id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='beacon' ORDER BY id",
      [campaign],
    )
  ).rows;
  for (const s of SCHOOLS) {
    const held = rows.filter((r) => r.data.holder === s.slot);
    const school = emptySchoolBeacon();
    for (const [index, row] of held.entries()) {
      row.data.lastCost =
        GAME_CONFIG.landmark.baseCrystals +
        row.data.takeovers * GAME_CONFIG.landmark.activationStepCrystals;
      if (index === 0) {
        const { buff, rank } = await chooseBuff(db, campaign, s.slot, []);
        Object.assign(school, {
          active: row.id,
          buffId: buff.id,
          activations: 1,
          lastCost: row.data.lastCost,
          rankAtActivation: rank,
          previous: [buff.id],
          activatedAt: Date.now(),
        });
      } else {
        row.data.holder = null;
        row.data.pots[String(s.slot)] = 0;
      }
      await writeState(db, campaign, "beacon", row.id, row.data);
    }
    await writeState(db, campaign, "school-beacon", String(s.slot), school);
  }
  await writeState(db, campaign, "beacon-schema", "version", 2);
}
interface Daily {
  counts: Record<string, number>;
  fractions: Record<string, number>;
  earned: Record<string, number>;
  actors: string[];
  tiles: number;
  spins: number;
}
export async function dailyBuff(
  db: PoolClient,
  campaign: string,
  slot: number,
  now = Date.now(),
) {
  const id = `${slot}:${Math.floor((now + C.dayOffsetMs) / C.dayMs)}`;
  const data = await readState<Daily>(db, campaign, "buff-usage", id, {
    counts: {},
    fractions: {},
    earned: {},
    actors: [],
    tiles: 0,
    spins: 0,
  });
  return { data, save: () => writeState(db, campaign, "buff-usage", id, data) };
}
function award(d: Daily, key: string, quantity: number, cap: number): number {
  const n = Math.max(0, Math.min(quantity, cap - (d.earned[key] ?? 0)));
  d.earned[key] = (d.earned[key] ?? 0) + n;
  return n;
}
function percent(
  d: Daily,
  key: string,
  amount: number,
  rate: number,
  cap: number,
): number {
  const units = (d.fractions[key] ?? 0) + amount * rate;
  d.fractions[key] = units % 100;
  return award(d, key, Math.floor(units / 100), cap);
}
function count(d: Daily, key: string) {
  d.counts[key] = (d.counts[key] ?? 0) + 1;
  return d.counts[key];
}
export async function currentBuff(
  db: PoolClient,
  campaign: string,
  slot: number,
) {
  const state = await schoolBeacon(db, campaign, slot);
  return state.active
    ? BUFF_POOL.find((b) => b.id === state.buffId)
    : undefined;
}
/** Runs only after a genuine authoritative success, inside its existing transaction. */
export async function explorationBuff(
  db: PoolClient,
  campaign: string,
  slot: number,
  actor: string,
  shared: boolean,
) {
  const buff = await currentBuff(db, campaign, slot);
  const usage = await dailyBuff(db, campaign, slot),
    d = usage.data;
  let points = 0,
    radius = GAME_CONFIG.world.fogRevealRadius as number;
  if (buff) {
    const id = buff.id;
    const rate = C.rates[id as keyof typeof C.rates];
    if (rate && shared === (id === "assault" || id === "foothold")) {
      const n = count(d, id);
      if (!("limit" in rate) || n <= rate.limit)
        if (n % rate.every === 0)
          points += award(
            d,
            shared ? "shared-rebate" : "solo-rebate",
            1,
            rate.cap,
          );
    }
    if (
      id === "vision" ||
      (id === "wide" && count(d, "wide") <= C.vision.burstLimit)
    )
      radius = C.vision.radius;
    if (id === "cohort") {
      if (!d.actors.includes(actor)) d.actors.push(actor);
      if (d.actors.length >= C.cohort.students)
        points += award(d, "cohort", C.cohort.points, C.cohort.points);
    }
    if (id === "comeback") d.tiles++;
  }
  if (
    buff?.id === "comeback" &&
    d.tiles >= C.comeback.tiles &&
    d.spins >= C.comeback.spins
  )
    points += award(d, "comeback", C.comeback.points, C.comeback.points);
  await usage.save();
  return { points, radius };
}
export async function rewardBuff(
  db: PoolClient,
  campaign: string,
  slot: number,
  kind: "unistop" | "chest",
  crystals: number,
) {
  const buff = await currentBuff(db, campaign, slot);
  if (!buff) return { crystals: 0, points: 0, cooldownPercent: 0 };
  const usage = await dailyBuff(db, campaign, slot),
    d = usage.data,
    id = buff.id;
  let extra = 0,
    points = 0;
  const isStop = kind === "unistop";
  const applicable = isStop
    ? ["urgent", "reserve", "reinforcement"]
    : ["excavation", "harvest", "revival"];
  const rule = C.crystals[id as keyof typeof C.crystals];
  if (crystals > 0 && rule && applicable.includes(id)) {
    const family = isStop ? "stop-crystals" : "chest-crystals";
    if ("flat" in rule) {
      if (count(d, id) <= rule.limit)
        extra = award(d, family, rule.flat, rule.cap);
    } else extra = percent(d, family, crystals, rule.percent, rule.cap);
  }
  if (isStop && id === "comeback") d.spins++;
  if (
    id === "comeback" &&
    d.tiles >= C.comeback.tiles &&
    d.spins >= C.comeback.spins
  )
    points = award(d, "comeback", C.comeback.points, C.comeback.points);
  const cooldownPercent = isStop
    ? (C.cooldown[id as keyof typeof C.cooldown] ?? 0)
    : 0;
  await usage.save();
  return { crystals: extra, points, cooldownPercent };
}
export async function sharedPaymentBuff(
  db: PoolClient,
  campaign: string,
  slot: number,
  kind: "upkeep" | "consolidation",
  amount: number,
) {
  const buff = await currentBuff(db, campaign, slot);
  if (buff?.id !== kind) return 0;
  const usage = await dailyBuff(db, campaign, slot),
    rule = C[kind];
  const points = percent(usage.data, kind, amount, rule.percent, rule.cap);
  await usage.save();
  return points;
}
