/** Disposable loopback campaign; deterministic draws exercise map discovery and a real chest command. */
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { botDatabase } from "../../scripts/simulation/config.ts";
import { createSchoolPlayServer } from "../../server/integration/SchoolPlayServer.ts";

const pool = new Pool({ connectionString: botDatabase(process.env.DATABASE_URL, "1"), max: 16 });
const resume = process.env.UI_PREVIEW_CAMPAIGN;
if (resume && !/^[0-9a-f-]{36}$/.test(resume)) throw new Error("Invalid preview campaign");
if (resume) {
  const guard = (await pool.query("SELECT code FROM r2pl_v2.campaigns WHERE id=$1", [resume])).rows[0];
  if (guard?.code !== `bot-sim-${resume}`) throw new Error("Not a synthetic preview campaign");
}
const campaign = resume ?? randomUUID();
const draws = [969, 999];
const play = await createSchoolPlayServer(pool, { web: 4182, websocket: 2573 }, campaign, { rewardDraw: () => draws.shift() ?? 0 });
const [student, builder] = play.fixture.actors;
if (!student || !builder) throw new Error("Missing synthetic actors");
if (!resume) await pool.query("UPDATE r2pl_v2.wallet_accounts SET opening_balance=0,balance=0 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-crystals'", [campaign, student.actorId]);
const path = [
  ...Array.from({ length: 46 }, (_, i) => ({ x: 510 + i, z: 280 })),
  ...Array.from({ length: 29 }, (_, i) => ({ x: 555, z: 281 + i })),
  ...Array.from({ length: 140 }, (_, i) => ({ x: 500, z: 290 + i })),
  ...Array.from({ length: 20 }, (_, i) => ({ x: 532, z: 281 + i })),
];
for (const tile of resume ? [] : path) {
  const receipt = await play.realtime.authority.apply(builder.actorId, 0, randomBytes(16), tile.z * 1000 + tile.x);
  if (receipt.result.status === "rejected") throw new Error("Synthetic fixture path rejected");
}
console.log(JSON.stringify({ campaign, url: "http://127.0.0.1:4182/", syntheticOnly: true, preparationCommands: resume ? 0 : path.length, deterministicDraws: "treasure-map, chest-gift-fallback" }));
process.once("SIGINT", () => void play.close().then(() => pool.end()));
process.once("SIGTERM", () => void play.close().then(() => pool.end()));
