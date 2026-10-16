import type { Pool } from "pg";
import type { WorldObject } from "../../shared/gameplay/gameConfig.ts";
import { SchoolRegistry } from "../../shared/world/registry.ts";
import type { PortalConfig } from "./PortalConfig.ts";
import {
  schoolPlayLayout,
  seedHeadquarters,
  seedWorldObjects,
} from "./SchoolHeadquarters.ts";
import type { SchoolPlayFixture } from "./SchoolPlayFixture.ts";

/** An isolated campaign with actual portal members and zero synthetic wallets/bots. */
export async function seedPortalCampaign(
  pool: Pool,
  config: PortalConfig,
): Promise<SchoolPlayFixture> {
  const { schools, headquarters } = schoolPlayLayout(),
    db = await pool.connect();
  try {
    await db.query("BEGIN");
    const migrated = await db.query(
      "SELECT 1 FROM r2pl_v2.schema_migrations WHERE version=8",
    );
    if (!migrated.rowCount)
      throw new Error(
        "Run npm run migrate:portal before starting the portal server",
      );
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('signed-game-schema',0))",
    );
    const created = await db.query(
      "INSERT INTO r2pl_v2.campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk') ON CONFLICT DO NOTHING RETURNING id",
      [config.campaignId, `portal-v1-${config.campaignId}`],
    );
    const existing = (
      await db.query<{ code: string }>(
        "SELECT code FROM r2pl_v2.campaigns WHERE id=$1 FOR UPDATE",
        [config.campaignId],
      )
    ).rows[0];
    if (existing?.code !== `portal-v1-${config.campaignId}`)
      throw new Error("Portal campaign must not reuse a synthetic campaign");
    for (const school of schools)
      await db.query(
        "INSERT INTO r2pl_v2.campaign_schools(campaign_id,school_id,slot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [config.campaignId, school.fixtureId, school.slot],
      );
    if (created.rowCount)
      await seedHeadquarters(db, config.campaignId, headquarters);
    await seedWorldObjects(db, config.campaignId);
    const saved = (
      await db.query<{ data: WorldObject }>(
        "SELECT data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 AND data->>'kind'='hq'",
        [config.campaignId],
      )
    ).rows;
    for (const { data } of saved) {
      const hq = headquarters.find((h) => h.schoolSlot === data.schoolSlot);
      if (hq)
        Object.assign(hq, {
          x: data.x - data.width / 2,
          z: data.z - data.height / 2,
        });
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  return {
    campaignId: config.campaignId,
    schools,
    headquarters,
    registry: new SchoolRegistry(
      schools.map((school) => ({ id: school.fixtureId, slot: school.slot })),
    ),
    actors: [],
    players: [],
  };
}
