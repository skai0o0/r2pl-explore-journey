/** Real HTTP/WebSocket synthetic account loop. Removes only its random fixture. */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { DevRewardClient } from "../client/src/rewardClient.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { cleanupSchoolRewards } from "../server/integration/SchoolRewardFixture.ts";
import { REWARD_PREPARATION_VERSION } from "../shared/rewards/commands.ts";
import { tileIndex } from "../shared/world/coordinates.ts";
import { BotPeer } from "./simulation/BotPeer.ts";
import { botDatabase } from "./simulation/config.ts";
import { cleanupBotFixture, migrateBotFixture } from "./simulation/fixture.ts";

const database = botDatabase(
  process.env.R2PL_BOT_DATABASE_URL,
  process.env.R2PL_BOT_SIMULATION,
);
migrateBotFixture(database, fileURLToPath(new URL("../", import.meta.url)));
const pool = new Pool({ connectionString: database, max: 12 });
const campaignId = randomUUID();
const server = await createSchoolPlayServer(
  pool,
  { web: 0, websocket: 0 },
  campaignId,
);
let peer: BotPeer | undefined;
try {
  const actor = server.fixture.players[0]!;
  const base = `http://127.0.0.1:${server.webPort}`;
  const client = new DevRewardClient(actor.token, (input, init) =>
    fetch(new URL(String(input), base), init),
  );
  const before = await client.inventory();
  const c = {
    kind: "open_chest",
    targetId: "dev-chest-0",
    key: randomUUID(),
    ruleVersion: REWARD_PREPARATION_VERSION,
  } as const;
  const committed = await client.apply(c);
  const replay = await client.apply(c);
  const rewardInventory = await client.inventory();
  peer = new BotPeer(
    `ws://127.0.0.1:${server.websocketPort}`,
    actor.token,
    server.fixture.schools[0]!,
    "explorer",
    42,
  );
  await peer.connect();
  const intent = { tile: tileIndex(actor.home.x + 10, actor.home.z) };
  const ack = await peer.explore(
    intent.tile,
    Uint8Array.from(Buffer.from(randomUUID().replaceAll("-", ""), "hex")),
  );
  console.log(
    JSON.stringify(
      {
        fixtureOnly: true,
        before,
        reward: committed.receipt.reward,
        retry: replay.kind,
        afterReward: rewardInventory,
        explorationStatus: ack.status,
        afterExplore: await client.inventory(),
        privateRewardEvents: (await client.events()).events.length,
        catalog: (await client.catalog()).map((t) => ({
          targetId: t.targetId,
          policyPending: t.policyPending,
          claimed: t.claimed,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await peer?.close();
  await server.close();
  await cleanupSchoolRewards(pool, campaignId);
  await cleanupBotFixture(pool, campaignId);
  await pool.end();
}
