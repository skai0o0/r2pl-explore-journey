import type { PoolClient } from "pg";
import { SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import { activeView, type SchoolBeacon } from "./BeaconBuffs.ts";
export interface SchoolScore {
  points: number;
  reachedAtMs: number;
}
/** One authoritative score transition per changed school bit, in the world transaction. */
export async function adjustKnowledgeScore(
  db: PoolClient,
  campaign: string,
  slot: number,
  delta: number,
): Promise<void> {
  if (!delta) return;
  const row = (
    await db.query<{ data: SchoolScore }>(
      "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='knowledge-score' AND id=$2 FOR UPDATE",
      [campaign, String(slot)],
    )
  ).rows[0];
  if (!row) throw new Error("Signed school score not initialized");
  const next = row.data.points + delta;
  if (next < 0 || !Number.isSafeInteger(next))
    throw new RangeError("Invalid Knowledge score");
  await db.query(
    "UPDATE r2pl_v2.game_state SET data=jsonb_build_object('points',$3::integer,'reachedAtMs',floor(extract(epoch FROM clock_timestamp())*1000)::bigint) WHERE campaign_id=$1 AND scope='knowledge-score' AND id=$2",
    [campaign, String(slot), next],
  );
}
export async function initializeKnowledgeScores(
  db: PoolClient,
  campaign: string,
): Promise<void> {
  const existing = (
    await db.query<{ id: string }>(
      "SELECT id FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='knowledge-score'",
      [campaign],
    )
  ).rows;
  if (existing.length === SCHOOLS.length) return;
  const counts = SCHOOLS.map(() => 0);
  for (const row of (
    await db.query<{ mask: Buffer }>(
      "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1",
      [campaign],
    )
  ).rows)
    for (let local = 0; local < 4096; local++) {
      const mask = row.mask.readUInt16LE(local * 2);
      for (const s of SCHOOLS) if (mask & (1 << s.slot)) counts[s.slot]!++;
    }
  const reached = (
    await db.query<{ slot: string; ms: string }>(
      `SELECT payload->>'schoolSlot' AS slot,max(extract(epoch FROM created_at)*1000)::text AS ms FROM r2pl_v2.outbox_events WHERE campaign_id=$1 AND payload ? 'schoolSlot' GROUP BY payload->>'schoolSlot'`,
      [campaign],
    )
  ).rows;
  const initial = Number(
    (
      await db.query<{ ms: string }>(
        "SELECT (extract(epoch FROM created_at)*1000)::text AS ms FROM r2pl_v2.campaigns WHERE id=$1",
        [campaign],
      )
    ).rows[0]!.ms,
  );
  for (const s of SCHOOLS)
    await db.query(
      "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'knowledge-score',$2,$3) ON CONFLICT DO NOTHING",
      [
        campaign,
        String(s.slot),
        JSON.stringify({
          points: counts[s.slot],
          reachedAtMs: Number(
            reached.find((r) => Number(r.slot) === s.slot)?.ms ?? initial,
          ),
        }),
      ],
    );
}
export async function knowledgeRanking(db: PoolClient, campaign: string) {
  const rows = (
    await db.query<{ id: string; data: SchoolScore }>(
      "SELECT id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='knowledge-score'",
      [campaign],
    )
  ).rows;
  const beacons = (
    await db.query<{ id: string; data: SchoolBeacon }>(
      "SELECT id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='school-beacon'",
      [campaign],
    )
  ).rows;
  return SCHOOLS.map((s) => {
    const score = rows.find((r) => Number(r.id) === s.slot)?.data ?? {
      points: 0,
      reachedAtMs: 0,
    };
    return {
      schoolId: s.id,
      slot: s.slot,
      points: score.points,
      reachedAt: score.reachedAtMs,
      buffs: beacons
        .filter((b) => Number(b.id) === s.slot)
        .flatMap((b) => {
          const buff = activeView(b.data);
          return buff
            ? [
                {
                  id: buff.landmarkId,
                  name: buff.name,
                  description: buff.description,
                },
              ]
            : [];
        }),
    };
  }).sort(
    (a, b) =>
      b.points - a.points || a.reachedAt - b.reachedAt || a.slot - b.slot,
  );
}
