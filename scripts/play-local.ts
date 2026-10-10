import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createDurableSyntheticServer } from "../server/realtime/durableBootstrap.ts";
import { evaluateDevExplore } from "../shared/gameplay/devRules.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";

const databaseUrl = process.env.R2PL_TEST_DATABASE_URL;
if (process.env.R2PL_DEV_PLAY !== "1" || !databaseUrl)
  throw new Error(
    "Local play requires R2PL_DEV_PLAY=1 and R2PL_TEST_DATABASE_URL",
  );
const databaseHost = new URL(databaseUrl).hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseHost))
  throw new Error("Local play only accepts a loopback PostgreSQL database");

const campaignId = "90000000-0000-4000-8000-000000000000";
const fixtures = [
  {
    token: "dawn-one",
    actorId: "90000000-0000-4000-8000-000000000001",
    schoolSlot: 0,
    name: "Dawn Explorer 1",
    schoolName: "Dawn University",
  },
  {
    token: "dawn-two",
    actorId: "90000000-0000-4000-8000-000000000002",
    schoolSlot: 0,
    name: "Dawn Explorer 2",
    schoolName: "Dawn University",
  },
  {
    token: "dusk-one",
    actorId: "90000000-0000-4000-8000-000000000003",
    schoolSlot: 15,
    name: "Dusk Explorer 1",
    schoolName: "Dusk University",
  },
  {
    token: "dusk-two",
    actorId: "90000000-0000-4000-8000-000000000004",
    schoolSlot: 15,
    name: "Dusk Explorer 2",
    schoolName: "Dusk University",
  },
] as const;
const registry = new SchoolRegistry([
  { id: "fixture-dawn", slot: 0 },
  { id: "fixture-dusk", slot: 15 },
]);
for (const migration of ["migrate-m3.ts", "migrate-m35.ts"])
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL(migration, import.meta.url)),
    ],
    { stdio: "inherit", env: process.env },
  );

const pool = new Pool({
  connectionString: databaseUrl,
  max: 16,
  options: "-c search_path=r2pl_v2,public",
});
await pool.query(
  "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,'m4a-local-fixture','full_chunk') ON CONFLICT (id) DO NOTHING",
  [campaignId],
);
const campaign = await pool.query<{ code: string; write_strategy: string }>(
  "SELECT code,write_strategy FROM campaigns WHERE id=$1",
  [campaignId],
);
if (
  campaign.rows[0]?.code !== "m4a-local-fixture" ||
  campaign.rows[0]?.write_strategy !== "full_chunk"
)
  throw new Error("Local fixture campaign differs from expected schema");
await pool.query(
  "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-dawn',0),($1,'fixture-dusk',15) ON CONFLICT DO NOTHING",
  [campaignId],
);
for (const fixture of fixtures)
  await pool.query(
    "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',30,30) ON CONFLICT DO NOTHING",
    [campaignId, fixture.actorId],
  );

const realtime = await createDurableSyntheticServer(
  pool,
  campaignId,
  registry,
  fixtures,
  1n,
  {},
  undefined,
  evaluateDevExplore,
);
await realtime.server.listen(2567, "127.0.0.1");

const clientRoot = resolve(
  fileURLToPath(new URL("../dist/client/", import.meta.url)),
);
const contentType: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const web = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:4173");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (url.pathname === "/api/fixture/me") {
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      const fixture = fixtures.find((item) => item.token === token);
      if (!fixture) {
        response.writeHead(401).end();
        return;
      }
      const wallet = await pool.query<{ balance: string }>(
        "SELECT balance::text FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
        [campaignId, fixture.actorId],
      );
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          name: fixture.name,
          schoolName: fixture.schoolName,
          schoolSlot: fixture.schoolSlot,
          balance: wallet.rows[0]?.balance ?? "0",
          cost: "1",
          fixtureOnly: true,
        }),
      );
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(
      join(clientRoot, pathname === "/" ? "index.html" : `.${pathname}`),
    );
    if (file !== clientRoot && !file.startsWith(`${clientRoot}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const bytes = await readFile(file);
      response.setHeader(
        "Content-Type",
        contentType[extname(file)] ?? "application/octet-stream",
      );
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(404).end();
    }
  } catch {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});
await new Promise<void>((resolveListen) =>
  web.listen(4173, "127.0.0.1", resolveListen),
);
console.log("R2PL M4-A development fixture: http://127.0.0.1:4173");
console.log(
  "Four synthetic players, two universities, 30 fixture credits each; one credit per new tile.",
);

async function stop(): Promise<void> {
  web.close();
  realtime.core.stopRelay();
  await realtime.server.gracefullyShutdown(false);
  await pool.end();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
