import { Pool } from "pg";
import { portalConfigFromEnv } from "../server/integration/PortalConfig.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";

const config = portalConfigFromEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 16,
  options: "-c search_path=r2pl_v2,public",
  connectionTimeoutMillis: 5000,
});
const port = Number(process.env.PORT ?? 4176),
  websocket = Number(process.env.WS_PORT ?? 2568);
if (![port, websocket].every((p) => Number.isInteger(p) && p > 0 && p <= 65535))
  throw new Error("Invalid PORT or WS_PORT");
let play: Awaited<ReturnType<typeof createSchoolPlayServer>>;
try {
  play = await createSchoolPlayServer(
    pool,
    { web: port, websocket },
    config.campaignId,
    { portal: config },
  );
} catch (error) {
  await pool.end();
  throw error;
}
console.log(
  `Portal integration v1 (${config.mode}) listening on loopback ${port}/${websocket}; public origin ${config.publicOrigin}`,
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await play.close();
  await pool.end();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
