import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { BotPeer, pause } from "../scripts/simulation/BotPeer.ts";
import { botDatabase } from "../scripts/simulation/config.ts";
import {
  cleanupBotFixture,
  fixtureMasks,
  migrateBotFixture,
  seedBotFixture,
} from "../scripts/simulation/fixture.ts";
import { createDurableSyntheticServer } from "../server/realtime/durableBootstrap.ts";
import { evaluateDevExplore } from "../shared/gameplay/devRules.ts";
import { ACK_STATUS } from "../shared/protocol/m2.ts";
import { botSchools } from "../shared/simulation/schoolBots.ts";
import { crc32 } from "../shared/world/checksum.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";

const url = process.env.R2PL_PREPARATION_DATABASE_URL;
test("eight real bot WebSocket clients isolate schools, retry/reconnect and conserve credit", {
  skip: !url && "Set disposable R2PL_PREPARATION_DATABASE_URL",
  timeout: 30_000,
}, async () => {
  const database = botDatabase(url, "1");
  migrateBotFixture(database, fileURLToPath(new URL("../", import.meta.url)));
  const pool = new Pool({ connectionString: database, max: 12 });
  const campaignId = randomUUID();
  const schools = botSchools("contact", 64);
  const peers: BotPeer[] = [];
  let fixture:
    | Awaited<ReturnType<typeof createDurableSyntheticServer>>
    | undefined;
  try {
    const identities = await seedBotFixture(pool, campaignId, schools, 1, 20);
    fixture = await createDurableSyntheticServer(
      pool,
      campaignId,
      new SchoolRegistry(
        schools.map((s) => ({ id: s.fixtureId, slot: s.slot })),
      ),
      identities,
      1n,
      {},
      undefined,
      evaluateDevExplore,
    );
    await fixture.server.listen(0, "127.0.0.1");
    const address = fixture.transport.server?.address();
    assert.ok(address && typeof address !== "string");
    let roomId: string | undefined;
    for (const identity of identities) {
      const peer = new BotPeer(
        `ws://127.0.0.1:${address.port}`,
        identity.token,
        schools[identity.schoolSlot]!,
        "connector",
        identity.schoolSlot + 1,
      );
      peers.push(peer);
      roomId = await peer.connect(roomId);
    }
    const key = (ordinal: number) => {
      const bytes = new Uint8Array(16);
      new DataView(bytes.buffer).setUint32(0, ordinal, true);
      return bytes;
    };
    await Promise.all(
      peers.map((peer, i) => peer.explore(peer.school.home, key(i + 1))),
    );
    const first = await peers[0]!.explore(schools[0]!.meeting, key(100));
    assert.equal(first.status, ACK_STATUS.TEST_APPLIED);
    const other = await peers[1]!.explore(schools[1]!.meeting, key(101));
    assert.equal(other.status, ACK_STATUS.TEST_APPLIED);
    const replay = await peers[0]!.replay(schools[0]!.meeting, key(100));
    assert.deepEqual(replay, first);
    assert.equal(peers[0]!.applied, 2);
    await peers[0]!.reconnect();
    assert.deepEqual(
      await peers[0]!.replay(schools[0]!.meeting, key(100)),
      first,
    );
    const deadline = Date.now() + 5000;
    let pending = 1;
    while (pending && Date.now() < deadline) {
      await fixture.core.drainOutbox();
      pending = Number(
        (
          await pool.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM r2pl_v2.outbox_events WHERE campaign_id=$1 AND delivered_at IS NULL",
            [campaignId],
          )
        ).rows[0]!.n,
      );
      await pause(10);
    }
    const expected = await Promise.all(
      peers.map(async (peer) =>
        Promise.all(
          peer.chunks.map(async (chunk) => {
            const snapshot = await fixture!.authority.snapshot(
              peer.school.slot,
              chunk,
            );
            return {
              slot: peer.school.slot,
              chunk,
              revision: snapshot.viewRevision.toString(),
              maskCrc: crc32(snapshot.mask),
              fogCrc: crc32(snapshot.fog),
            };
          }),
        ),
      ),
    );
    while (
      peers.some(
        (p, i) =>
          JSON.stringify(p.signatures()) !== JSON.stringify(expected[i]),
      ) &&
      Date.now() < deadline
    )
      await pause(10);
    peers.forEach((peer, i) => {
      assert.deepEqual(peer.signatures(), expected[i]);
    });
    const masks = await fixtureMasks(pool, campaignId);
    assert.equal(masks.get(schools[0]!.meeting), 3);
    for (let i = 0; i < identities.length; i++) {
      const balance = (
        await pool.query<{ balance: string }>(
          "SELECT balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2",
          [campaignId, identities[i]!.actorId],
        )
      ).rows[0]!.balance;
      assert.equal(Number(balance), 20 - peers[i]!.applied);
    }
    assert.equal(peers[0]!.reconnects, 1);
    assert.equal(pending, 0);
  } finally {
    await Promise.allSettled(peers.map((p) => p.close()));
    fixture?.core.stopRelay();
    if (fixture) await fixture.server.gracefullyShutdown(false);
    await cleanupBotFixture(pool, campaignId);
    const remaining = await pool.query(
      "SELECT 1 FROM r2pl_v2.campaigns WHERE id=$1",
      [campaignId],
    );
    assert.equal(remaining.rowCount, 0);
    await pool.end();
  }
});
