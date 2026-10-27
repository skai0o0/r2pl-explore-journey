import type { Pool } from "pg";
import type { HeadquartersArea } from "../../shared/gameplay/expansion.ts";
import {
  GAME_CONFIG,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import type { DevPlayer } from "../../shared/integration/devSession.ts";
import type { BotRole, BotSchool } from "../../shared/simulation/schoolBots.ts";
import { tileCoordinates } from "../../shared/world/coordinates.ts";
import { SchoolRegistry } from "../../shared/world/registry.ts";
import type { DevIdentity } from "./DevAccountService.ts";
import {
  schoolBotRegion,
  schoolPlayLayout,
  seedHeadquarters,
  seedWorldObjects,
} from "./SchoolHeadquarters.ts";
export const SCHOOL_PLAY_CAMPAIGN = "98000000-0000-4000-8000-000000000000";
export interface SchoolPlayActor extends DevIdentity {
  readonly role: "human" | BotRole;
  readonly ordinal: number;
}
export interface SchoolPlayFixture {
  readonly campaignId: string;
  readonly schools: readonly BotSchool[];
  readonly headquarters: readonly HeadquartersArea[];
  readonly registry: SchoolRegistry;
  readonly actors: readonly SchoolPlayActor[];
  readonly players: readonly DevPlayer[];
}
export async function seedSchoolPlay(
  pool: Pool,
  campaignId = SCHOOL_PLAY_CAMPAIGN,
  actorsPerSchool = campaignId === SCHOOL_PLAY_CAMPAIGN ? 27 : 5,
): Promise<SchoolPlayFixture> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      campaignId,
    )
  )
    throw new RangeError("Invalid fixture campaign");
  const code =
    campaignId === SCHOOL_PLAY_CAMPAIGN
      ? "school-play-rule1-layout3-20261014"
      : `bot-sim-${campaignId}`;
  const { schools, headquarters } = schoolPlayLayout();
  const actors: SchoolPlayActor[] = [];
  const players: DevPlayer[] = [];
  for (const school of schools)
    for (let n = 0; n < actorsPerSchool; n++) {
      const isHuman = n < 2;
      const role: BotRole | "human" = isHuman
        ? "human"
        : (["explorer", "connector", "steward"] as const)[n % 3]!;
      const actor = {
        token: `dev-school-${school.slot}-actor-${n}`,
        actorId: `93000000-0000-4000-8000-${String(school.slot * 100 + n + 1).padStart(12, "0")}`,
        schoolSlot: school.slot,
        name: `${school.label} · ${isHuman ? "Explorer" : role} ${isHuman ? n + 1 : n - 1}`,
        schoolName: school.label,
        role,
        ordinal: actors.length,
      };
      actors.push(actor);
      if (isHuman)
        players.push({
          token: actor.token,
          label: actor.name,
          schoolName: school.label,
          slot: school.slot,
          home: tileCoordinates(school.home),
        });
    }
  const registry = new SchoolRegistry(
    schools.map((s) => ({ id: s.fixtureId, slot: s.slot })),
  );
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const created = await db.query(
      "INSERT INTO r2pl_v2.campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk') ON CONFLICT DO NOTHING RETURNING id",
      [campaignId, code],
    );
    const campaign = (
      await db.query<{ code: string; write_strategy: string }>(
        "SELECT code,write_strategy FROM r2pl_v2.campaigns WHERE id=$1 FOR UPDATE",
        [campaignId],
      )
    ).rows[0];
    if (campaign?.code !== code || campaign.write_strategy !== "full_chunk")
      throw new Error("Refusing nonfixture campaign");
    for (const school of schools)
      await db.query(
        "INSERT INTO r2pl_v2.campaign_schools(campaign_id,school_id,slot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [campaignId, school.fixtureId, school.slot],
      );
    const persisted = (
      await db.query<{ school_id: string; slot: number }>(
        "SELECT school_id,slot FROM r2pl_v2.campaign_schools WHERE campaign_id=$1 ORDER BY slot",
        [campaignId],
      )
    ).rows;
    if (
      JSON.stringify(persisted) !==
      JSON.stringify(
        schools.map((s) => ({ school_id: s.fixtureId, slot: s.slot })),
      )
    )
      throw new Error("Fixture roster differs");
    for (const actor of actors)
      await db.query(
        "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',$3,$3) ON CONFLICT DO NOTHING",
        [
          campaignId,
          actor.actorId,
          actor.role === "human"
            ? GAME_CONFIG.staging.initialPoints
            : GAME_CONFIG.staging.initialBotPoints,
        ],
      );
    if (created.rowCount === 1)
      await seedHeadquarters(db, campaignId, headquarters);
    await seedWorldObjects(db, campaignId);
    const savedHQs = (
      await db.query<{ data: WorldObject }>(
        "SELECT data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 AND data->>'kind'='hq'",
        [campaignId],
      )
    ).rows;
    for (const { data: h } of savedHQs) {
      const area = headquarters.find((a) => a.schoolSlot === h.schoolSlot);
      if (area)
        Object.assign(area, { x: h.x - h.width / 2, z: h.z - h.height / 2 });
      for (const player of players.filter((p) => p.slot === h.schoolSlot))
        Object.assign(player.home, { x: h.x, z: h.z });
      const school = schools.find((s) => s.slot === h.schoolSlot);
      if (school) {
        Object.assign(school, {
          home: h.z * 1000 + h.x,
          region: schoolBotRegion(h.x, h.z),
          meeting: 500 * 1000 + 500,
        });
      }
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  return {
    campaignId,
    schools,
    headquarters,
    registry,
    actors,
    players,
  };
}
