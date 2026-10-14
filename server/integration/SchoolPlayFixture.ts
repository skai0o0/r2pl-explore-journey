import type { Pool } from "pg";
import type { HeadquartersArea } from "../../shared/gameplay/expansion.ts";
import type { DevPlayer } from "../../shared/integration/devSession.ts";
import type { BotRole, BotSchool } from "../../shared/simulation/schoolBots.ts";
import { tileCoordinates } from "../../shared/world/coordinates.ts";
import { SchoolRegistry } from "../../shared/world/registry.ts";
import type { DevIdentity } from "./DevAccountService.ts";
import { schoolPlayLayout, seedHeadquarters } from "./SchoolHeadquarters.ts";
export const SCHOOL_PLAY_CAMPAIGN = "94000000-0000-4000-8000-000000000000";
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
): Promise<SchoolPlayFixture> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      campaignId,
    )
  )
    throw new RangeError("Invalid fixture campaign");
  const code =
    campaignId === SCHOOL_PLAY_CAMPAIGN
      ? "school-play-expansion-v1"
      : `bot-sim-${campaignId}`;
  const { schools, headquarters } = schoolPlayLayout();
  const actors: SchoolPlayActor[] = [];
  const players: DevPlayer[] = [];
  for (const school of schools)
    for (let n = 0; n < 5; n++) {
      const role = (
        ["human", "human", "explorer", "connector", "steward"] as const
      )[n]!;
      const actor = {
        token: `dev-school-${school.slot}-actor-${n}`,
        actorId: `93000000-0000-4000-8000-${String(school.slot * 5 + n + 1).padStart(12, "0")}`,
        schoolSlot: school.slot,
        name: `${school.label} · ${role === "human" ? "Explorer" : role} ${n + 1}`,
        schoolName: school.label,
        role,
        ordinal: actors.length,
      };
      actors.push(actor);
      if (role === "human")
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
        [campaignId, actor.actorId, actor.role === "human" ? 1000 : 5000],
      );
    if (created.rowCount === 1)
      await seedHeadquarters(db, campaignId, headquarters);
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
