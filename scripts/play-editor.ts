import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { validatePortalConfig } from "../server/integration/PortalConfig.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { createDummyPortal } from "../server/portal/DummyServer.ts";

const database = process.env.DATABASE_URL;
if (!database) throw new Error("DATABASE_URL is required");
const target = new URL(database);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  !/^r2pl_(prep|bot)_test_/.test(target.pathname.slice(1))
)
  throw new Error("Editor demo requires a disposable loopback database");
const port = Number(process.env.EDITOR_PORT ?? 4177),
  ws = Number(process.env.EDITOR_WS_PORT ?? 2569),
  loginPort = Number(process.env.EDITOR_LOGIN_PORT ?? 4181);
if (
  ![port, ws, loginPort].every(
    (p) => Number.isInteger(p) && p > 0 && p <= 65535,
  ) ||
  new Set([port, ws, loginPort]).size !== 3
)
  throw new Error("Invalid editor demo ports");
const config = validatePortalConfig({
  campaignId:
    process.env.EDITOR_CAMPAIGN_ID ?? "99000000-0000-4000-8000-000000000008",
  mode: "staging",
  publicOrigin: `http://127.0.0.1:${port}`,
  websocketUrl: `ws://127.0.0.1:${ws}`,
  portalLoginUrl: `http://127.0.0.1:${loginPort}/login`,
  keys: { local: randomBytes(32).toString("hex") },
  adminKey: randomBytes(32).toString("hex"),
});
const pool = new Pool({
  connectionString: database,
  max: 16,
  options: "-c search_path=r2pl_v2,public",
});
let game: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
let portal: Awaited<ReturnType<typeof createDummyPortal>> | undefined;
try {
  await migratePortalDatabase(pool);
  game = await createSchoolPlayServer(
    pool,
    { web: port, websocket: ws },
    config.campaignId,
    { portal: config },
  );
  portal = await createDummyPortal(pool, config, loginPort);
  const password = process.env.EDITOR_TEST_PASSWORD ?? "Amtech-local-test-only";
  await portal.store.seedAdminAccounts(password);
  console.log(`AMTECH Live Editor: ${config.publicOrigin}`);
  console.log(`Local staging account: acer@amtech.vn / ${password}`);
  console.log(
    "All 12 approved staff accounts use the same local test password on first creation. Production credentials are never changed.",
  );
} catch (error) {
  await portal?.close();
  await game?.close();
  await pool.end();
  throw error;
}
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await portal?.close();
  await game?.close();
  await pool.end();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
