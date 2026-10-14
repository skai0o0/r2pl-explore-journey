import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { BotPeer } from "../scripts/simulation/BotPeer.ts";
import { botDatabase } from "../scripts/simulation/config.ts";
import { cleanupBotFixture } from "../scripts/simulation/fixture.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { cleanupSchoolRewards } from "../server/integration/SchoolRewardFixture.ts";
import {
  edgeNeighbors,
  headquartersTiles,
  isExpansionEdge,
} from "../shared/gameplay/expansion.ts";
import { ACK_STATUS } from "../shared/protocol/m2.ts";
import { chunkId, tileIndex } from "../shared/world/coordinates.ts";

test("expansion neighbors never wrap rows, admit diagonals or exceed the map", () => {
  assert.deepEqual(edgeNeighbors(0), [1, 1000]);
  assert.deepEqual(edgeNeighbors(999999), [999998, 998999]);
  assert.deepEqual(edgeNeighbors(999), [998, 1999]);
  assert.equal(
    isExpansionEdge(tileIndex(1, 1), (tile) => tile === 0),
    false,
  );
  assert.equal(
    isExpansionEdge(tileIndex(1, 0), (tile) => tile === 0),
    true,
  );
  assert.throws(() => edgeNeighbors(1000000));
  assert.throws(() =>
    headquartersTiles({ schoolSlot: 0, x: 995, z: 995, size: 20 }),
  );
});
const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("HQ baseline, authoritative frontier, protected schools, cross-chunk races and restart", {
  skip: !database && "Disposable PostgreSQL required",
  timeout: 30000,
}, async () => {
  const pool = new Pool({
    connectionString: botDatabase(database, "1"),
    max: 16,
  });
  const campaign = randomUUID();
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  let peer: BotPeer | undefined;
  try {
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    const initial = play;
    const actor = initial.fixture.actors[0]!;
    const second = initial.fixture.actors[1]!;
    const apply = (
      tile: number,
      key = Uint8Array.from(
        Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
      ),
      actorId = actor.actorId,
    ) => initial.realtime.authority.apply(actorId, 0, key, tile);
    for (const school of initial.fixture.schools) {
      const tiles = headquartersTiles(
        initial.fixture.headquarters[school.slot]!,
      );
      assert.equal(tiles.length, 400);
      const masks = new Map<
        number,
        Awaited<ReturnType<typeof initial.realtime.authority.snapshot>>
      >();
      for (const id of new Set(
        tiles.map((tile) =>
          chunkId(
            Math.floor((tile % 1000) / 64),
            Math.floor(Math.floor(tile / 1000) / 64),
          ),
        ),
      ))
        masks.set(
          id,
          await initial.realtime.authority.snapshot(school.slot, id),
        );
      let owned = 0;
      for (const snapshot of masks.values()) {
        const view = new DataView(snapshot.mask.buffer);
        for (let local = 0; local < 4096; local++)
          if (view.getUint16(local * 2, true)) {
            owned++;
            assert.ok(snapshot.fog[local >> 3]! & (1 << (local & 7)));
            assert.equal(view.getUint16(local * 2, true), 1 << school.slot);
          }
      }
      assert.equal(owned, 400);
    }
    assert.equal(
      (await apply(initial.fixture.schools[0]!.home)).result.status,
      "test_no_change",
    );
    assert.equal(
      (await apply(tileIndex(510, 290))).result.reason,
      "not_adjacent",
    );
    assert.equal(
      (await apply(tileIndex(645, 355))).result.reason,
      "not_adjacent",
    ); // rival knowledge alone cannot anchor growth
    assert.equal(
      (await apply(tileIndex(655, 345))).result.reason,
      "protected_hq",
    );
    assert.equal((await apply(tileIndex(0, 0))).result.reason, "not_adjacent");
    assert.equal(
      (await initial.accounts.profile(actor.token))!.balance,
      "1000",
    );
    const rejectedKey = Uint8Array.from(
      Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
    );
    const rejection = await apply(tileIndex(512, 280), rejectedKey);
    assert.equal(rejection.result.reason, "not_adjacent");
    assert.equal(
      (await apply(tileIndex(510, 280))).result.status,
      "test_applied",
    );
    assert.equal(
      (await apply(tileIndex(511, 280))).result.status,
      "test_applied",
    );
    assert.deepEqual(
      (await apply(tileIndex(512, 280), rejectedKey)).result,
      rejection.result,
    );
    assert.equal(
      (await apply(tileIndex(512, 280))).result.status,
      "test_applied",
    );
    for (let x = 489; x >= 475; x--)
      assert.equal(
        (await apply(tileIndex(x, 280))).result.status,
        "test_applied",
      );
    const race = await Promise.all([
      apply(tileIndex(474, 280)),
      apply(tileIndex(474, 280), undefined, second.actorId),
    ]);
    assert.deepEqual(race.map((result) => result.result.status).sort(), [
      "test_applied",
      "test_no_change",
    ]);
    const balances = await Promise.all([
      initial.accounts.profile(actor.token),
      initial.accounts.profile(second.token),
    ]);
    assert.equal(
      balances.reduce((sum, row) => sum + BigInt(row!.balance), 0n),
      1981n,
    );
    assert.ok(balances.every((row) => row!.ledgerConserved));
    peer = new BotPeer(
      `ws://127.0.0.1:${initial.websocketPort}`,
      actor.token,
      initial.fixture.schools[0]!,
      "explorer",
      123,
    );
    await peer.connect();
    assert.equal(
      (
        await peer.explore(
          tileIndex(570, 570),
          Uint8Array.from(Buffer.from(randomUUID().replaceAll("-", ""), "hex")),
        )
      ).status,
      ACK_STATUS.REJECTED,
    );
    await peer.close();
    peer = undefined;
    await initial.close();
    play = undefined;
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    assert.equal(
      (await play.accounts.profile(actor.token))!.balance,
      balances[0]!.balance,
    );
    assert.deepEqual(
      (
        await play.realtime.authority.apply(
          actor.actorId,
          0,
          rejectedKey,
          tileIndex(512, 280),
        )
      ).result,
      rejection.result,
    );
    const resumed = await play.realtime.authority.apply(
      actor.actorId,
      0,
      Uint8Array.from(Buffer.from(randomUUID().replaceAll("-", ""), "hex")),
      tileIndex(473, 280),
    );
    assert.equal(resumed.result.status, "test_applied");
  } finally {
    await peer?.close();
    await play?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});
