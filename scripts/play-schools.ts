import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { botDatabase } from "./simulation/config.ts";
import { migrateBotFixture } from "./simulation/fixture.ts";

const database = botDatabase(
  process.env.R2PL_BOT_DATABASE_URL,
  process.env.R2PL_BOT_SIMULATION,
);
const workspace = fileURLToPath(new URL("../", import.meta.url));
migrateBotFixture(database, workspace);
const pool = new Pool({ connectionString: database, max: 16 });
const play = await createSchoolPlayServer(pool, { web: 4176, websocket: 2568 });
console.log("Eight-school playable fixture: http://127.0.0.1:4176");
console.log(
  "16 students + 24 WebSocket bots; signed ruleVersion 1 Points/Crystal/Keys. Persistent isolated campaign; no reset on restart.",
);
void play.startBots();
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await play.close();
  await pool.end();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
