import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { botDatabase } from "./simulation/config.ts";
import { migrateBotFixture } from "./simulation/fixture.ts";

const database = botDatabase(
  process.env.DATABASE_URL ?? process.env.R2PL_BOT_DATABASE_URL,
  process.env.R2PL_BOT_SIMULATION,
);
const workspace = fileURLToPath(new URL("../", import.meta.url));
migrateBotFixture(database, workspace);
const pool = new Pool({ connectionString: database, max: 16 });
await migratePortalDatabase(pool);
const port = Number(process.env.PORT ?? 4176);
const wsPort = Number(process.env.WS_PORT ?? 2568);
if (!Number.isInteger(wsPort) || wsPort < 1 || wsPort > 65535)
  throw new TypeError("Invalid WS_PORT");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new TypeError("Invalid PORT");
const play = await createSchoolPlayServer(pool, {
  web: port,
  websocket: wsPort,
});
console.log(`Eight-school playable fixture: http://127.0.0.1:${port}`);
console.log(
  "Local play: loading screen -> game. No portal login or dummy portal service. Open the URL above.",
);
console.log(
  "16 students; signed ruleVersion 1 Points/Crystal/Keys. Persistent isolated campaign; no reset on restart.",
);
if (process.env.ENABLE_BOTS === "1") {
  console.log("Starting 24 WebSocket simulation bots...");
  void play.startBots();
} else {
  console.log("Bots are disabled (ENABLE_BOTS!=1) for high-performance direct player testing.");
}
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await play.close();
  await pool.end();
}
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
