import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { botDatabase } from "../../scripts/simulation/config.ts";

const campaign = "55762177-6f9a-43ac-9d14-2f695124a274";
const pool = new Pool({ connectionString: botDatabase(process.env.DATABASE_URL, "1") });
try {
  const guard = (await pool.query("SELECT code FROM r2pl_v2.campaigns WHERE id=$1", [campaign])).rows[0];
  assert.equal(guard?.code, `bot-sim-${campaign}`);
  const wallets = (await pool.query(`SELECT w.actor_id,w.resource,w.balance::text,w.opening_balance::text AS opening,COALESCE(sum(l.amount),0)::text AS ledger FROM r2pl_v2.wallet_accounts w LEFT JOIN r2pl_v2.ledger_entries l USING(campaign_id,actor_id,resource) WHERE w.campaign_id=$1 AND w.actor_id=ANY($2::uuid[]) GROUP BY w.campaign_id,w.actor_id,w.resource ORDER BY w.actor_id,w.resource`, [campaign, ["93000000-0000-4000-8000-000000000001", "93000000-0000-4000-8000-000000000002"]])).rows;
  for (const wallet of wallets) assert.equal(BigInt(wallet.balance), BigInt(wallet.opening) + BigInt(wallet.ledger));
  const beacons = (await pool.query("SELECT id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='beacon' AND id=ANY($2::text[]) ORDER BY id", [campaign, ["fansipan", "halong"]])).rows;
  const school = (await pool.query("SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='school-beacon' AND id='0'", [campaign])).rows[0].data;
  assert.equal(school.active, "halong");
  assert.equal(school.activations, 2);
  assert.equal(school.lastCost, 1100);
  assert.equal(beacons.find(b => b.id === "fansipan").data.holder, null);
  assert.equal(beacons.find(b => b.id === "fansipan").data.pots["0"], 0);
  assert.equal(beacons.find(b => b.id === "halong").data.pots["0"], 1100);
  const claims = (await pool.query("SELECT id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='chest-claim'", [campaign])).rows;
  assert(claims.some(c => c.id === "chest_aspire_1"));
  const tap = await readFile(new URL("regression.tap", import.meta.url), "utf8");
  const tests = Object.fromEntries(["tests", "pass", "fail", "skipped"].map(k => [k, Number(tap.match(new RegExp(`^# ${k} (\\d+)`, "m"))?.[1])]));
  assert(tests.tests >= 85 && tests.pass === tests.tests && tests.fail === 0 && tests.skipped === 0);
  const assets = new URL("../../dist/client/assets/", import.meta.url);
  for (const name of await readdir(assets)) if (name.endsWith(".js")) assert(!/rankAtActivation|BEACON_BUFF_CONFIG/.test(await readFile(new URL(name, assets), "utf8")));
  await writeFile(new URL("verification.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), campaign, syntheticOnly: true, wallets, walletsConserved: true, beacons, activeBeacon: school.active, activationCount: school.activations, lastCost: school.lastCost, nextCost: school.lastCost + 100, chestClaims: claims.map(c => c.id), tests, privatePoolAbsentFromClient: true }, null, 2));
  console.log(JSON.stringify({ tests, walletsConserved: true, activeBeacon: school.active, oldPotBurned: true, chestClaimed: true }));
} finally { await pool.end(); }
