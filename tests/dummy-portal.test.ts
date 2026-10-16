import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { Pool } from "pg";
import { validatePortalConfig } from "../server/integration/PortalConfig.ts";
import { gameCsrf } from "../server/integration/PortalCookies.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { createDummyPortal } from "../server/portal/DummyServer.ts";

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
test("self-service dummy persists accounts, queues offline runs, isolates students and signs the real game handoff", {
  skip: !database,
  timeout: 60000,
}, async () => {
  const target = new URL(database!);
  assert.ok(
    ["127.0.0.1", "localhost"].includes(target.hostname) &&
      /^r2pl_(prep|bot)_test_/.test(target.pathname.slice(1)),
  );
  const pool = new Pool({ connectionString: database, max: 12 }),
    campaign = randomUUID(),
    [web, ws, dummyPort] = await Promise.all([port(), port(), port()]);
  const config = validatePortalConfig({
    campaignId: campaign,
    mode: "staging",
    publicOrigin: `http://127.0.0.1:${web}`,
    websocketUrl: `ws://127.0.0.1:${ws}`,
    portalLoginUrl: `http://127.0.0.1:${dummyPort}/login`,
    adminKey: randomBytes(32).toString("hex"),
    keys: { test: randomBytes(32).toString("hex") },
  });
  let game: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined,
    portal: Awaited<ReturnType<typeof createDummyPortal>> | undefined;
  const jar = { cookie: "", csrf: "" };
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`${portal!.origin}/api/dummy/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: jar.cookie,
        Origin: portal!.origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": jar.csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) jar.cookie = cookie.split(";")[0]!;
    const result = await response.json();
    if (result.csrfToken) jar.csrf = result.csrfToken;
    return { status: response.status, body: result };
  };
  try {
    await migratePortalDatabase(pool);
    portal = await createDummyPortal(pool, config, dummyPort);
    const page = await fetch(`http://127.0.0.1:${dummyPort}/login`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type")!, /text\/html/);
    assert.match(await page.text(), /Portal sinh viên/);
    await call("me");
    const a = {
      email: "student-a@example.edu.vn",
      password: "test-password-for-A",
      displayName: "Nguyễn Minh Anh <test>",
      schoolId: "hcmut",
    };
    assert.equal((await call("register", a)).status, 200);
    const firstSession = jar.cookie;
    const initial = await call("me");
    assert.equal(initial.body.student.displayName, a.displayName);
    assert.equal(initial.body.activities.length, 0);
    const run = {
      id: randomUUID(),
      meters: 1500,
      occurredAtMs: Date.now() - 60000,
    };
    assert.equal((await call("activities", run)).status, 200);
    assert.equal((await call("activities", run)).status, 200);
    assert.equal((await call("me")).body.activities.length, 1);
    await portal.close();
    portal = await createDummyPortal(pool, config, dummyPort);
    assert.equal((await call("me")).body.student.email, a.email);
    assert.equal((await call("me")).body.activities.length, 1);
    game = await createSchoolPlayServer(
      pool,
      { web, websocket: ws },
      campaign,
      { portal: config },
    );
    await call("retry", {});
    await portal.sync();
    // A timed worker may own the job; bounded polling observes the same durable receipt.
    let dashboard = await call("me");
    for (
      let n = 0;
      n < 20 &&
      (dashboard.body.account?.spendablePoints !== "15" ||
        dashboard.body.jobs[0]?.state !== "synced");
      n++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await portal.sync();
      dashboard = await call("me");
    }
    assert.equal(dashboard.body.account.spendablePoints, "15");
    assert.equal(dashboard.body.jobs[0].state, "synced");
    const verifier = randomBytes(32).toString("base64url"),
      challenge = createHash("sha256").update(verifier).digest("base64url");
    assert.equal(
      (
        await call("play", {
          gameCampaign: campaign,
          gameReturn: "https://evil.invalid/",
          gameChallenge: challenge,
        })
      ).status,
      400,
    );
    const launch = await call("play", {
      gameCampaign: campaign,
      gameReturn: `${config.publicOrigin}/`,
      gameChallenge: challenge,
    });
    const ticket = new URL(launch.body.launchUrl).hash.slice(8);
    const exchange = await fetch(`${config.publicOrigin}/api/portal/session`, {
      method: "POST",
      headers: {
        Origin: config.publicOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ticket, codeVerifier: verifier }),
    });
    assert.equal(exchange.status, 200);
    const gameCookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    assert.ok(exchange.headers.get("set-cookie")!.includes("HttpOnly"));
    assert.equal((await exchange.json()).token, undefined);
    const profile = await (
      await fetch(`${config.publicOrigin}/api/fixture/me`, {
        headers: { Cookie: gameCookie },
      })
    ).json();
    assert.equal(profile.name, a.displayName);
    assert.equal(profile.balance, "15");
    assert.equal(
      (
        await fetch(`${config.publicOrigin}/api/portal/ws-ticket`, {
          method: "POST",
          headers: {
            Cookie: gameCookie,
            Origin: config.publicOrigin,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    const token = gameCookie.split("=")[1]!;
    const socket = await (
      await fetch(`${config.publicOrigin}/api/portal/ws-ticket`, {
        method: "POST",
        headers: {
          Cookie: gameCookie,
          Origin: config.publicOrigin,
          "Content-Type": "application/json",
          "X-CSRF-Token": gameCsrf(token),
        },
        body: "{}",
      })
    ).json();
    const { PortalStore } = await import(
      "../server/integration/PortalStore.ts"
    );
    const store = new PortalStore(pool, config);
    assert.equal(
      (await store.consumeSocketTicket(socket.ticket)).actor.name,
      a.displayName,
    );
    await assert.rejects(store.consumeSocketTicket(socket.ticket));
    await call("logout", {});
    await call("me");
    assert.equal(
      (
        await call("register", {
          ...a,
          email: "student-b@example.edu.vn",
          displayName: "Trần Bảo Bình",
          schoolId: "dtu",
        })
      ).status,
      200,
    );
    const second = await call("me");
    assert.equal(second.body.activities.length, 0);
    assert.equal(second.body.account.spendablePoints, "0");
    await call("logout", {});
    await call("me");
    assert.equal(
      (await call("login", { email: a.email, password: "invalid-password" }))
        .status,
      401,
    );
    assert.equal(
      (await call("login", { email: a.email, password: a.password })).status,
      200,
    );
    assert.notEqual(jar.cookie, firstSession);
    assert.equal((await call("me")).body.account.spendablePoints, "15");
  } finally {
    await portal?.close();
    await game?.close();
    for (const table of [
      "sync_jobs",
      "activities",
      "sessions",
      "students",
      "rate_windows",
    ])
      await pool.query(`DELETE FROM r2pl_dummy.${table} WHERE campaign_id=$1`, [
        campaign,
      ]);
    const row = (
      await pool.query("SELECT code FROM r2pl_v2.campaigns WHERE id=$1", [
        campaign,
      ])
    ).rows[0];
    if (row?.code === `portal-v1-${campaign}`) {
      await pool.query(
        "DELETE FROM r2pl_v2.outbox_dead_letters WHERE event_id IN (SELECT id FROM r2pl_v2.outbox_events WHERE campaign_id=$1)",
        [campaign],
      );
      for (const table of [
        "portal_socket_tickets",
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
          campaign,
        ]);
      await pool.query(
        "DELETE FROM r2pl_prep.running_bindings WHERE campaign_id=$1",
        [campaign],
      );
      await pool.query("DELETE FROM r2pl_v2.campaigns WHERE id=$1", [campaign]);
    }
    await pool.end();
  }
});
