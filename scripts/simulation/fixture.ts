import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { BotSchool } from "../../shared/simulation/schoolBots.ts";
import { chunkCoordinatesForId } from "../../shared/world/coordinates.ts";
export interface BotIdentity {
  readonly actorId: string;
  readonly token: string;
  readonly schoolSlot: number;
  readonly ordinal: number;
}
export function migrateBotFixture(database: string, workspace: string): void {
  for (const script of ["migrate-m3.ts", "migrate-m35.ts"]) {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", `scripts/${script}`],
      {
        cwd: workspace,
        env: { ...process.env, R2PL_TEST_DATABASE_URL: database },
        stdio: "inherit",
        windowsHide: true,
        timeout: 30000,
      },
    );
    if (result.error || result.status !== 0)
      throw new Error("Bot fixture migration failed");
  }
}
export async function seedBotFixture(
  pool: Pool,
  campaignId: string,
  schools: readonly BotSchool[],
  count: number,
  credits: number,
): Promise<readonly BotIdentity[]> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO r2pl_v2.campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaignId, `bot-sim-${campaignId}`],
    );
    for (const school of schools)
      await db.query(
        "INSERT INTO r2pl_v2.campaign_schools(campaign_id,school_id,slot) VALUES($1,$2,$3)",
        [campaignId, school.fixtureId, school.slot],
      );
    const identities: BotIdentity[] = [];
    for (const school of schools)
      for (let n = 0; n < count; n++) {
        const actorId = randomUUID();
        identities.push({
          actorId,
          token: `synthetic-bot-${randomUUID()}`,
          schoolSlot: school.slot,
          ordinal: identities.length,
        });
        await db.query(
          "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',$3,$3)",
          [campaignId, actorId, credits],
        );
      }
    await db.query("COMMIT");
    return identities;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function fixtureMasks(
  pool: Pool,
  campaignId: string,
): Promise<Map<number, number>> {
  const rows = await pool.query<{ chunk_id: number; mask: Buffer }>(
    "SELECT chunk_id,mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1",
    [campaignId],
  );
  const result = new Map<number, number>();
  for (const row of rows.rows) {
    if (row.mask.length !== 8192)
      throw new Error("Invalid simulation checkpoint");
    const { chunkX, chunkZ } = chunkCoordinatesForId(row.chunk_id);
    for (let local = 0; local < 4096; local++) {
      const mask = row.mask.readUInt16LE(local * 2);
      if (mask & 0xff00) throw new Error("Unexpected school in bot fixture");
      if (mask) {
        const x = chunkX * 64 + (local % 64);
        const z = chunkZ * 64 + Math.floor(local / 64);
        if (x >= 1000 || z >= 1000)
          throw new Error("Nonzero bot checkpoint padding");
        result.set(z * 1000 + x, mask);
      }
    }
  }
  return result;
}
export async function cleanupBotFixture(
  pool: Pool,
  campaignId: string,
): Promise<void> {
  const row = (
    await pool.query<{ code: string }>(
      "SELECT code FROM r2pl_v2.campaigns WHERE id=$1",
      [campaignId],
    )
  ).rows[0];
  if (!row) return;
  if (row.code !== `bot-sim-${campaignId}`)
    throw new Error("Refusing cleanup outside this generated bot campaign");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "DELETE FROM r2pl_v2.outbox_dead_letters WHERE event_id IN (SELECT id FROM r2pl_v2.outbox_events WHERE campaign_id=$1)",
      [campaignId],
    );
    for (const table of [
      "outbox_events",
      "ledger_entries",
      "world_mutations",
      "school_chunk_views",
      "school_fog_chunks",
      "world_chunks",
      "world_chunk_heads",
      "command_results",
      "wallet_accounts",
      "campaign_schools",
    ])
      await db.query(`DELETE FROM r2pl_v2.${table} WHERE campaign_id=$1`, [
        campaignId,
      ]);
    await db.query("DELETE FROM r2pl_v2.campaigns WHERE id=$1", [campaignId]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
