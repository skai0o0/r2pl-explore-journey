import { Pool } from "pg";
import { portalConfigFromEnv } from "../server/integration/PortalConfig.ts";
import { createDummyPortal } from "../server/portal/DummyServer.ts";

const config = portalConfigFromEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const database = new URL(process.env.DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
  !/^r2pl_(prep|bot)_test_/.test(database.pathname.slice(1))
)
  throw new Error("Dummy portal requires a local disposable test database");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  connectionTimeoutMillis: 5000,
});
try {
  const portal = await createDummyPortal(pool, config);
  console.log(`Student sandbox portal: ${portal.origin}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await portal.close();
    await pool.end();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
} catch (error) {
  await pool.end();
  throw error;
}
