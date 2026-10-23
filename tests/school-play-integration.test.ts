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
  LEGACY_DEV_SESSION,
  parseDevSession,
} from "../shared/integration/devSession.ts";
import { ACK_STATUS } from "../shared/protocol/m2.ts";
import { tileIndex } from "../shared/world/coordinates.ts";

test("dev session contract validates synthetic identities, homes and transport bounds", () => {
  assert.deepEqual(parseDevSession(LEGACY_DEV_SESSION), LEGACY_DEV_SESSION);
  assert.throws(() =>
    parseDevSession({ ...LEGACY_DEV_SESSION, fixtureOnly: false }),
  );
  assert.throws(() =>
    parseDevSession({ ...LEGACY_DEV_SESSION, websocketPort: 65536 }),
  );
  assert.throws(() =>
    parseDevSession({
      ...LEGACY_DEV_SESSION,
      players: [LEGACY_DEV_SESSION.players[0], LEGACY_DEV_SESSION.players[0]],
    }),
  );
  assert.throws(() =>
    parseDevSession({
      ...LEGACY_DEV_SESSION,
      players: [{ ...LEGACY_DEV_SESSION.players[0], home: { x: 1000, z: 0 } }],
    }),
  );
});
const url = process.env.R2PL_PREPARATION_DATABASE_URL;
test("eight-school playable server shares durable bot/student world with actor-private profiles and retry receipts", {
  skip: !url && "Disposable PostgreSQL required",
  timeout: 30000,
}, async () => {
  const pool = new Pool({ connectionString: botDatabase(url, "1"), max: 16 });
  const campaignId = randomUUID();
  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  let peer: BotPeer | undefined;
  try {
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaignId,
    );
    await assert.rejects(
      createSchoolPlayServer(pool, { web: 0, websocket: 0 }, campaignId),
      /already has a local writer/,
    );
    const base = `http://127.0.0.1:${server.webPort}`;
    // Local play never advertises the external login flow or mounts dummy auth.
    assert.equal((await fetch(`${base}/api/portal/config`)).status, 404);
    assert.equal((await fetch(`${base}/api/dummy/v1/me`)).status, 404);
    const config = parseDevSession(
      await (await fetch(`${base}/api/fixture/bootstrap`)).json(),
    );
    assert.equal(config.players.length, 16);
    assert.equal(new Set(config.players.map((p) => p.slot)).size, 8);
    assert.equal(config.websocketPort, server.websocketPort);
    assert.equal((await fetch(`${base}/api/fixture/me`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/fixture/receipts`, {
          headers: { Authorization: "Bearer forged" },
        })
      ).status,
      401,
    );
    assert.equal(
      (await fetch(`${base}/api/fixture/me`, { method: "POST" })).status,
      405,
    );
    const actor = config.players[0]!;
    const headers = { Authorization: `Bearer ${actor.token}` };
    const before = await server.accounts.profile(actor.token);
    assert(before?.ledgerConserved);
    assert.equal(before.hasSpentPoints, false);
    peer = new BotPeer(
      `ws://127.0.0.1:${server.websocketPort}`,
      actor.token,
      server.fixture.schools[0]!,
      "explorer",
      987,
    );
    await peer.connect();
    const rejected = await peer.explore(
      tileIndex(0, 0),
      Uint8Array.from(Buffer.from(randomUUID().replaceAll("-", ""), "hex")),
    );
    assert.equal(rejected.status, ACK_STATUS.REJECTED);
    assert.equal(
      (await server.accounts.profile(actor.token))?.hasSpentPoints,
      false,
      "rejected requests do not end onboarding",
    );
    const intent = { tile: tileIndex(actor.home.x + 10, actor.home.z) };
    const key = Uint8Array.from(
      Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
    );
    const ack = await peer.explore(intent.tile, key);
    assert.equal(ack.status, ACK_STATUS.TEST_APPLIED);
    assert.deepEqual(await peer.replay(intent.tile, key), ack);
    const profile = (await (
      await fetch(`${base}/api/fixture/me`, { headers })
    ).json()) as {
      balance: string;
      ledgerConserved: boolean;
      schoolSlot: number;
      hasSpentPoints: boolean;
    };
    assert.equal(BigInt(profile.balance), BigInt(before.balance) - 1n);
    assert.equal(profile.schoolSlot, 0);
    assert.equal(profile.ledgerConserved, true);
    assert.equal(profile.hasSpentPoints, true);
    assert.equal(
      (await server.accounts.profile(config.players[1]!.token))?.hasSpentPoints,
      false,
    );
    const receipts = (await (
      await fetch(`${base}/api/fixture/receipts`, { headers })
    ).json()) as { receipts: { status: string; amount: string }[] };
    assert.ok(
      receipts.receipts.some(
        (r) => r.status === "test_applied" && r.amount === "-1",
      ),
    );
    // Synthetic incoming credit restores the opening balance; it must not reset onboarding.
    const creditKey = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
    const credit = await pool.connect();
    try {
      await credit.query("BEGIN");
      await credit.query(
        "INSERT INTO r2pl_v2.command_results(campaign_id,actor_id,command_key,payload_hash,status,result) VALUES($1,$2,$3,$4,'test_applied','{}')",
        [
          campaignId,
          server.fixture.actors[0]!.actorId,
          creditKey,
          Buffer.alloc(32),
        ],
      );
      await credit.query(
        "INSERT INTO r2pl_v2.ledger_entries(campaign_id,actor_id,command_key,resource,amount) VALUES($1,$2,$3,'fixture-credit',1)",
        [campaignId, server.fixture.actors[0]!.actorId, creditKey],
      );
      await credit.query(
        "UPDATE r2pl_v2.wallet_accounts SET balance=balance+1 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
        [campaignId, server.fixture.actors[0]!.actorId],
      );
      await credit.query("COMMIT");
    } catch (error) {
      await credit.query("ROLLBACK");
      throw error;
    } finally {
      credit.release();
    }
    const credited = await server.accounts.profile(actor.token);
    assert.equal(credited?.balance, before.balance);
    assert.equal(
      credited?.hasSpentPoints,
      true,
      "incoming credit never erases a committed debit",
    );
    assert.equal(credited?.ledgerConserved, true);
    const bots = server.startBots({ count: 24, durationSeconds: 2 });
    const botDeadline = Date.now() + 5000;
    while (
      server.getBotTelemetry().status === "starting" &&
      Date.now() < botDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(server.getBotTelemetry().status, "running");
    const schoolStats = (await (
      await fetch(`${base}/api/fixture/bots`, { headers })
    ).json()) as { schoolSlot: number; bots: unknown[] };
    assert.equal(schoolStats.schoolSlot, 0);
    assert.equal(schoolStats.bots.length, 3);
    await bots;
    assert.equal(server.getBotTelemetry().status, "idle");
    assert.equal(server.getBotTelemetry().bots.length, 0);
    assert.equal(await server.accounts.profile("forged"), null);
    await peer.close();
    peer = undefined;
    await server.close();
    server = undefined;
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaignId,
    );
    const restored = await server.accounts.profile(actor.token);
    assert.equal(restored?.balance, credited?.balance);
    assert.equal(restored?.ledgerConserved, true);
    assert.equal(
      restored?.hasSpentPoints,
      true,
      "spend history survives server restart",
    );
    const rebuilt = parseDevSession(
      await (
        await fetch(`http://127.0.0.1:${server.webPort}/api/fixture/bootstrap`)
      ).json(),
    );
    assert.deepEqual(rebuilt.players, config.players);
  } finally {
    await peer?.close();
    await server?.close();
    await cleanupSchoolRewards(pool, campaignId);
    await cleanupBotFixture(pool, campaignId);
    await pool.end();
  }
});

test("expansion bootstrap rejects malformed HQ geometry, duplicate schools and campaign scope", () => {
  const areas = [
    { schoolSlot: 0, x: 205, z: 225, size: 20 },
    { schoolSlot: 15, x: 775, z: 755, size: 20 },
  ];
  const value = {
    ...LEGACY_DEV_SESSION,
    adjacentOnly: true,
    headquarters: areas,
    campaignId: "94000000-0000-4000-8000-000000000000",
  };
  assert.equal(parseDevSession(value).headquarters?.length, 2);
  assert.throws(() => parseDevSession({ ...value, campaignId: "untrusted" }));
  assert.throws(() =>
    parseDevSession({ ...value, headquarters: [areas[0], areas[0]] }),
  );
  assert.throws(() =>
    parseDevSession({
      ...value,
      headquarters: [areas[0], { ...areas[1], x: 210, z: 230 }],
    }),
  );
  assert.throws(() =>
    parseDevSession({
      ...value,
      headquarters: [areas[0], { ...areas[1], x: 999 }],
    }),
  );
});
