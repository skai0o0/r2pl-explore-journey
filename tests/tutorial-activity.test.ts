import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { BotPeer } from "../scripts/simulation/BotPeer.ts";
import { botDatabase } from "../scripts/simulation/config.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { ACK_STATUS } from "../shared/protocol/m2.ts";
import { tileIndex } from "../shared/world/coordinates.ts";

const url = process.env.R2PL_PREPARATION_DATABASE_URL;
test("private tutorial activity excludes rejected/replayed commands and caps at ten successful tiles", {
  skip: !url,
  timeout: 30000,
}, async () => {
  const pool = new Pool({ connectionString: botDatabase(url, "1"), max: 12 });
  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined,
    peer: BotPeer | undefined;
  try {
    await migratePortalDatabase(pool);
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      randomUUID(),
    );
    const actor = server.fixture.actors[0]!;
    const bootstrap = await (
      await fetch(`http://127.0.0.1:${server.webPort}/api/fixture/bootstrap`)
    ).json();
    const player = bootstrap.players[0];
    assert.equal(
      (await server.accounts.profile(actor.token))!.exploredTiles,
      0,
    );
    peer = new BotPeer(
      `ws://127.0.0.1:${server.websocketPort}`,
      actor.token,
      server.fixture.schools[0]!,
      "explorer",
      987,
    );
    await peer.connect();
    const key = () =>
      Uint8Array.from(Buffer.from(randomUUID().replaceAll("-", ""), "hex"));
    assert.equal(
      (await peer.explore(tileIndex(0, 0), key())).status,
      ACK_STATUS.REJECTED,
    );
    assert.equal(
      (await server.accounts.profile(actor.token))!.exploredTiles,
      0,
    );
    for (let i = 0; i < 11; i++) {
      // Respect the gateway's input budget while also replaying every command.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const tile = tileIndex(player.home.x + 10 + i, player.home.z),
        command = key();
      const result: Awaited<ReturnType<BotPeer["explore"]>> =
        await peer.explore(tile, command);
      assert.equal(result.status, ACK_STATUS.TEST_APPLIED);
      assert.deepEqual(await peer.replay(tile, command), result);
      assert.equal(
        (await server.accounts.profile(actor.token))!.exploredTiles,
        Math.min(i + 1, 10),
      );
    }
    assert.equal(
      (await server.accounts.profile(server.fixture.actors[1]!.token))!
        .exploredTiles,
      0,
    );
  } finally {
    if (peer) await peer.close();
    if (server) await server.close();
    await pool.end();
  }
});
