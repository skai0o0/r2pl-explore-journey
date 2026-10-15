import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { ColyseusSDK } from "@colyseus/sdk";
import { Pool } from "pg";
import {
  type PortalConfig,
  validatePortalConfig,
} from "../server/integration/PortalConfig.ts";
import {
  portalSignature,
  verifyPortalSignature,
} from "../server/integration/PortalSignature.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { parsePortalSession } from "../shared/integration/portalSession.ts";
import { campaignWeekStart } from "../shared/integration/running.ts";
import {
  ACK_STATUS,
  decodeAck,
  decodeFrame,
  encodeExplore,
  M2_KIND,
} from "../shared/protocol/m2.ts";

function config(): PortalConfig {
  return validatePortalConfig({
    campaignId: randomUUID(),
    mode: "staging",
    publicOrigin: "http://127.0.0.1:4176",
    websocketUrl: "ws://127.0.0.1:2568",
    portalLoginUrl: "http://127.0.0.1:4180/login",
    keys: { test: randomBytes(32).toString("hex") },
    adminKey: randomBytes(32).toString("hex"),
  });
}
test("portal auth binds raw bytes, request target, campaign, timestamp, and key rotation", () => {
  const c = config(),
    now = Date.now(),
    timestamp = String(now),
    nonce = randomBytes(24).toString("hex"),
    body = Buffer.from('{"externalStudentId":"student-1"}'),
    path = "/api/partner/v1/accounts";
  const headers = {
    "x-r2pl-campaign": c.campaignId,
    "x-r2pl-key-id": "test",
    "x-r2pl-timestamp": timestamp,
    "x-r2pl-nonce": nonce,
    "x-r2pl-signature": portalSignature(
      c.keys.test!,
      c.campaignId,
      "POST",
      path,
      timestamp,
      nonce,
      body,
    ),
  };
  assert.equal(
    verifyPortalSignature(c, headers, "POST", path, body, now).keyId,
    "test",
  );
  assert.throws(() =>
    verifyPortalSignature(c, headers, "POST", path, Buffer.from("{}"), now),
  );
  assert.throws(() =>
    verifyPortalSignature(
      c,
      headers,
      "POST",
      "/api/partner/v1/members",
      body,
      now,
    ),
  );
  assert.throws(() =>
    verifyPortalSignature(
      { ...c, campaignId: randomUUID() },
      headers,
      "POST",
      path,
      body,
      now,
    ),
  );
  assert.throws(() =>
    verifyPortalSignature(c, headers, "POST", path, body, now + 300001),
  );
  assert.throws(() =>
    verifyPortalSignature(
      c,
      { ...headers, "x-r2pl-key-id": "toString" },
      "POST",
      path,
      body,
      now,
    ),
  );
  assert.throws(() => validatePortalConfig({ ...c, mode: "production" }));
  assert.throws(() =>
    validatePortalConfig({
      ...c,
      keys: { test: "REPLACE_WITH_RANDOM_PARTNER_SECRET" },
    }),
  );
  const rotated = { ...c, keys: { old: "old".repeat(16), test: c.keys.test! } };
  assert.equal(
    verifyPortalSignature(rotated, headers, "POST", path, body, now).keyId,
    "test",
  );
});

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("mounted partner API -> PKCE session -> actual WebSocket spend -> restart, replay, correction and suspension", {
  skip: !database,
  timeout: 45000,
}, async () => {
  // Always a fresh test campaign; no cleanup or mutation of an existing campaign.
  const target = new URL(database!);
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
      /^r2pl_(prep|bot)_test_/.test(target.pathname.slice(1)),
    "Requires a disposable local test database",
  );
  const pool = new Pool({ connectionString: database, max: 12 });
  const c = config();
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  let room: Awaited<ReturnType<ColyseusSDK["joinOrCreate"]>> | undefined;
  let origin = "";
  const post = async (
    path: string,
    body: unknown,
    extra: Record<string, string> = {},
  ) => {
    const response = await fetch(origin + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: c.publicOrigin,
        ...extra,
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  const signed = (
    operation: string,
    payload: unknown,
    nonce = randomBytes(24).toString("hex"),
  ) => {
    const path = `/api/partner/v1/${operation}`,
      raw = Buffer.from(JSON.stringify(payload)),
      timestamp = String(Date.now());
    return post(path, payload, {
      "X-R2PL-Campaign": c.campaignId,
      "X-R2PL-Key-Id": "test",
      "X-R2PL-Timestamp": timestamp,
      "X-R2PL-Nonce": nonce,
      "X-R2PL-Signature": portalSignature(
        c.keys.test!,
        c.campaignId,
        "POST",
        path,
        timestamp,
        nonce,
        raw,
      ),
    });
  };
  try {
    await migratePortalDatabase(pool);
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      c.campaignId,
      { portal: c },
    );
    origin = `http://127.0.0.1:${play.webPort}`;
    assert.equal(play.fixture.actors.length, 0);
    assert.equal((await fetch(origin + "/api/fixture/bootstrap")).status, 401);
    assert.equal(
      (
        await fetch(origin + "/api/fixture/me", {
          headers: { Authorization: "Bearer dev-school-0-actor-0" },
        })
      ).status,
      401,
    );
    assert.equal((await post("/api/partner/v1/members", {})).status, 401);
    assert.equal(
      (await fetch(origin + "/api/partner/v1/openapi.json")).status,
      200,
    );
    const member = {
      externalStudentId: "student-1",
      schoolId: "hcmut",
      displayName: "Student One",
      eduVerified: true,
      active: true,
    };
    assert.equal(
      (await signed("members", { ...member, eduVerified: false })).status,
      400,
    );
    assert.equal(
      (await signed("members", { ...member, schoolId: "unknown" })).status,
      400,
    );
    assert.equal((await signed("members", member)).status, 200);
    assert.equal(
      (await signed("members", { ...member, schoolId: "dtu" })).status,
      409,
    );
    const nonce = randomBytes(24).toString("hex");
    assert.equal(
      (await signed("accounts", { externalStudentId: "student-1" }, nonce)).body
        .spendablePoints,
      "0",
    );
    assert.equal(
      (await signed("accounts", { externalStudentId: "student-1" }, nonce)).body
        .error,
      "REQUEST_REPLAY",
    );
    const now = Date.now(),
      snapshot = {
        externalStudentId: "student-1",
        revision: "1",
        cumulativeMeters: "1500",
        weeklyMeters: "1500",
        observedAtMs: now,
        weekStartMs: campaignWeekStart(now),
      };
    const receipts = await Promise.all(
      Array.from({ length: 5 }, () => signed("running", snapshot)),
    );
    assert.ok(receipts.every((result) => result.status === 200));
    assert.equal(
      receipts.filter((result) => result.body.replay === false).length,
      1,
    );
    assert.equal(
      (await signed("running", { ...snapshot, cumulativeMeters: "1600" })).body
        .error,
      "REVISION_CONFLICT",
    );
    const verifier = randomBytes(32).toString("base64url"),
      codeChallenge = createHash("sha256").update(verifier).digest("base64url");
    const launch = await signed("launches", {
      externalStudentId: "student-1",
      codeChallenge,
    });
    const ticket = new URL(launch.body.launchUrl as string).hash.slice(
      "#launch=".length,
    );
    assert.equal(
      (
        await post("/api/portal/session", {
          ticket,
          codeVerifier: "x".repeat(43),
        })
      ).status,
      401,
    );
    const session = await post("/api/portal/session", {
      ticket,
      codeVerifier: verifier,
    });
    assert.equal(session.status, 200);
    assert.equal(
      (await post("/api/portal/session", { ticket, codeVerifier: verifier }))
        .status,
      401,
    );
    assert.equal(session.body.token, undefined);
    assert.ok(session.cookie.startsWith("r2pl_game="));
    const headers: Record<string, string> = { Cookie: session.cookie };
    const bootstrap = await (
      await fetch(origin + "/api/fixture/bootstrap", { headers })
    ).json();
    assert.equal(parsePortalSession(bootstrap).players.length, 1);
    assert.equal(bootstrap.players[0].slot, 0);
    headers["X-CSRF-Token"] = bootstrap.csrfToken;
    assert.equal(
      (await post("/api/portal/ws-ticket", {}, { Cookie: session.cookie }))
        .status,
      403,
    );
    const socket = await post("/api/portal/ws-ticket", {}, headers);
    assert.equal(socket.status, 200);
    const token = socket.body.ticket as string;
    const view = await (await fetch(origin + "/api/game", { headers })).json();
    assert.equal(
      (await (await fetch(origin + "/api/fixture/me", { headers })).json())
        .balance,
      "15",
    );
    assert.equal(view.runningMode, "portal");
    assert.equal(view.keys.aspire, "0");
    const forbiddenRunning = await post(
      "/api/game",
      { ruleVersion: 1, key: randomUUID(), action: "running", amount: 100000 },
      headers,
    );
    assert.equal(forbiddenRunning.body.status, "rejected");
    room = await new ColyseusSDK(
      `ws://127.0.0.1:${play.websocketPort}`,
    ).joinOrCreate("m2", { token });
    const hq = play.fixture.headquarters[0]!;
    const frame = encodeExplore({
      key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
      tileIndex: hq.z * 1000 + hq.x - 1,
      ruleVersion: 1,
      intent: "explore",
    });
    const ack = new Promise<ReturnType<typeof decodeAck>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Missing WebSocket ACK")),
        5000,
      );
      room!.onMessage("m2", (bytes: Uint8Array) => {
        const result = decodeFrame(bytes);
        if (result.kind === M2_KIND.ACK) {
          clearTimeout(timeout);
          resolve(decodeAck(result.payload));
        }
      });
    });
    room.sendBytes("m2", frame);
    assert.equal((await ack).status, ACK_STATUS.TEST_APPLIED);
    const account = await signed("accounts", {
      externalStudentId: "student-1",
    });
    assert.equal(account.body.spendablePoints, "14");
    assert.equal(account.body.earnedRunningPoints, "15");
    assert.equal((await signed("running", snapshot)).body.replay, true);
    assert.equal(
      (await signed("accounts", { externalStudentId: "student-1" })).body
        .spendablePoints,
      "14",
    );
    const correction = await signed("running", {
      ...snapshot,
      revision: "2",
      cumulativeMeters: "0",
      weeklyMeters: "0",
    });
    assert.equal(correction.body.error, "CORRECTION_REQUIRES_REVIEW");
    assert.equal(
      (await signed("accounts", { externalStudentId: "student-1" })).body
        .earnedRunningPoints,
      "15",
    );
    const adjusted = await signed("running", {
      ...snapshot,
      revision: "3",
      cumulativeMeters: "1400",
      weeklyMeters: "1400",
    });
    assert.equal(adjusted.body.delta, "-1");
    assert.equal(adjusted.body.spendablePoints, "13");
    assert.equal(
      (await signed("running", { ...snapshot, revision: "2" })).body.error,
      "STALE_REVISION",
    );
    await room.leave();
    room = undefined;
    await play.close();
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      c.campaignId,
      { portal: c },
    );
    origin = `http://127.0.0.1:${play.webPort}`;
    assert.equal((await fetch(origin + "/api/game", { headers })).status, 200);
    assert.equal(
      (await signed("accounts", { externalStudentId: "student-1" })).body
        .spendablePoints,
      "13",
    );
    assert.equal((await signed("running", snapshot)).body.replay, true);
    await signed("members", { ...member, active: false });
    assert.equal((await fetch(origin + "/api/game", { headers })).status, 401);
    assert.equal(
      (
        await signed("launches", {
          externalStudentId: "student-1",
          codeChallenge,
        })
      ).status,
      403,
    );
    await signed("members", member);
    assert.equal(
      (await fetch(origin + "/api/game", { headers })).status,
      401,
      "Reactivation must not restore revoked sessions",
    );
    const nextLaunch = await signed("launches", {
      externalStudentId: "student-1",
      codeChallenge,
    });
    const nextTicket = new URL(nextLaunch.body.launchUrl as string).hash.slice(
      "#launch=".length,
    );
    const nextSession = await post("/api/portal/session", {
      ticket: nextTicket,
      codeVerifier: verifier,
    });
    const nextHeaders = {
      Cookie: nextSession.cookie,
      "X-CSRF-Token": (
        await (
          await fetch(`${origin}/api/fixture/bootstrap`, {
            headers: { Cookie: nextSession.cookie },
          })
        ).json()
      ).csrfToken,
    };
    assert.equal(
      (await post("/api/portal/logout", {}, nextHeaders)).status,
      200,
    );
    assert.equal(
      (await fetch(`${origin}/api/game`, { headers: nextHeaders })).status,
      401,
    );
    const expiredLaunch = await signed("launches", {
      externalStudentId: "student-1",
      codeChallenge,
    });
    const expiredTicket = new URL(
      expiredLaunch.body.launchUrl as string,
    ).hash.slice("#launch=".length);
    await pool.query(
      "UPDATE r2pl_v2.portal_launches SET expires_at=clock_timestamp()-interval '1 second' WHERE campaign_id=$1",
      [c.campaignId],
    );
    assert.equal(
      (
        await post("/api/portal/session", {
          ticket: expiredTicket,
          codeVerifier: verifier,
        })
      ).status,
      401,
    );
    const ledger = (
      await pool.query<{ balance: string; net: string }>(
        "SELECT w.balance::text,(w.opening_balance+COALESCE(sum(l.amount),0))::text AS net FROM r2pl_v2.wallet_accounts w LEFT JOIN r2pl_v2.ledger_entries l USING(campaign_id,actor_id,resource) WHERE w.campaign_id=$1 AND w.resource='fixture-credit' GROUP BY w.campaign_id,w.actor_id,w.resource",
        [c.campaignId],
      )
    ).rows[0]!;
    assert.equal(ledger.balance, ledger.net);
  } finally {
    await room?.leave();
    await play?.close();
    const row = (
      await pool.query<{ code: string }>(
        "SELECT code FROM r2pl_v2.campaigns WHERE id=$1",
        [c.campaignId],
      )
    ).rows[0];
    if (row?.code === `portal-v1-${c.campaignId}`) {
      await pool.query(
        "DELETE FROM r2pl_v2.outbox_dead_letters WHERE event_id IN (SELECT id FROM r2pl_v2.outbox_events WHERE campaign_id=$1)",
        [c.campaignId],
      );
      for (const table of [
        "portal_launches",
        "portal_sessions",
        "portal_nonces",
        "portal_rate_windows",
        "portal_running_receipts",
        "portal_members",
        "outbox_events",
        "ledger_entries",
        "world_mutations",
        "school_chunk_views",
        "school_fog_chunks",
        "world_chunks",
        "world_chunk_heads",
        "command_results",
        "wallet_accounts",
        "campaign_schools",
      ])
        await pool.query(`DELETE FROM r2pl_v2.${table} WHERE campaign_id=$1`, [
          c.campaignId,
        ]);
      await pool.query(
        "DELETE FROM r2pl_prep.running_bindings WHERE campaign_id=$1",
        [c.campaignId],
      );
      await pool.query("DELETE FROM r2pl_v2.campaigns WHERE id=$1", [
        c.campaignId,
      ]);
    }
    await pool.end();
  }
});
