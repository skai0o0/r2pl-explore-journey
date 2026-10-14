import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { botDatabase } from "./simulation/config.ts";

// Isolated synthetic acceptance campaign. RNG injection is server-owned; clients cannot supply tickets.
const database = botDatabase(
  process.env.R2PL_BOT_DATABASE_URL,
  process.env.R2PL_BOT_SIMULATION,
);
const pool = new Pool({ connectionString: database, max: 16 });
const tickets = process.argv[2] ? [] : [969, 999, 999, 0, 0, 0];
const play = await createSchoolPlayServer(
  pool,
  {
    web: Number(process.argv[3] ?? 0),
    websocket: Number(process.argv[4] ?? 0),
  },
  process.argv[2] ?? randomUUID(),
  { rewardDraw: () => tickets.shift() ?? 0 },
);
const a = play.fixture.actors[0]!,
  b = play.fixture.actors[5]!;
const key = () => crypto.getRandomValues(new Uint8Array(16));
async function explore(actor: typeof a, x: number, z: number) {
  const r = await play.realtime.authority.apply(
    actor.actorId,
    actor.schoolSlot,
    key(),
    z * 1000 + x,
  );
  if (r.result.status === "rejected")
    throw new Error(`Acceptance path rejected: ${x},${z} ${r.result.reason}`);
}
// Build real adjacent Knowledge using the same wallet/transaction/relay as browser players.
for (let x = 200; x <= 309; x++) await explore(a, x, 200);
for (let z = 201; z <= 280; z++) await explore(a, 309, z);
for (let z = 281; z <= 400; z++) await explore(a, 309, z);
for (let x = 310; x <= 350; x++) await explore(a, x, 200);
for (let z = 201; z <= 204; z++) await explore(a, 350, z);
for (let z = 160; z <= 200; z++) await explore(b, 500, z);
for (let x = 499; x >= 351; x--) await explore(b, x, 200);
for (let z = 201; z <= 280; z++) await explore(b, 351, z);
await explore(b, 350, 280);
console.log(
  JSON.stringify({
    url: `http://127.0.0.1:${play.webPort}`,
    websocketPort: play.websocketPort,
    campaignId: play.fixture.campaignId,
    landmark: "fansipan",
    sharedTile: { x: 350, z: 200 },
    guestToken: b.token,
  }),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await play.close();
  await pool.end();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
