import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { Pool } from "pg";
import { R2plPartnerClient } from "../integration/partner-client.mjs";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { validatePortalConfig } from "../server/integration/PortalConfig.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { createDummyPortal } from "../server/portal/DummyServer.ts";
import { AMTECH_ACCOUNTS } from "../shared/integration/identity.ts";

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const address = s.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((r) => s.close(() => r()));
  return address.port;
}
const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("dummy admin → one-use handoff → synthetic Demo editor, while anonymous play and campaign isolation remain intact", {
  skip: !database,
  timeout: 60000,
}, async () => {
  const url = new URL(database!);
  assert(
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.pathname.startsWith("/r2pl_prep_test_"),
  );
  const pool = new Pool({ connectionString: database, max: 12 });
  const [web, ws, portalPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  const gameOrigin = `http://127.0.0.1:${web}`,
    portalOrigin = `http://127.0.0.1:${portalPort}`;
  const adminConfig = validatePortalConfig({
    campaignId: randomUUID(),
    publicOrigin: gameOrigin,
    websocketUrl: `ws://127.0.0.1:${ws}`,
    portalLoginUrl: `${portalOrigin}/login`,
    keys: { demo: randomBytes(32).toString("hex") },
    adminKey: randomBytes(32).toString("hex"),
    mode: "staging",
  });
  const portalConfig = {
    ...adminConfig,
    campaignId: randomUUID(),
    keys: { normal: randomBytes(32).toString("hex") },
  };
  let game: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  let portal: Awaited<ReturnType<typeof createDummyPortal>> | undefined;
  let portalCookie = "",
    portalCsrf = "";
  const portalCall = async (path: string, body?: unknown) => {
    const r = await fetch(`${portalOrigin}/api/dummy/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: portalOrigin,
        Cookie: portalCookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": portalCsrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const cookie = r.headers.get("set-cookie");
    if (cookie) portalCookie = cookie.split(";")[0]!;
    const data = await r.json();
    if (data.csrfToken) portalCsrf = data.csrfToken;
    return { status: r.status, data };
  };
  const gameCall = async (
    path: string,
    body?: unknown,
    cookie = "",
    csrf = "",
  ) => {
    const r = await fetch(gameOrigin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: gameOrigin,
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    return {
      status: r.status,
      data: text ? JSON.parse(text) : {},
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  try {
    await migratePortalDatabase(pool);
    game = await createSchoolPlayServer(
      pool,
      { web, websocket: ws },
      adminConfig.campaignId,
      { actorsPerSchool: 2, adminPortal: adminConfig },
    );
    portal = await createDummyPortal(
      pool,
      portalConfig,
      portalPort,
      adminConfig,
    );
    const password = randomBytes(24).toString("hex");
    await portal.store.seedAdminAccounts(password);
    assert.equal((await gameCall("/api/portal/config")).status, 404);
    assert.equal(
      (await gameCall("/api/portal/config?entry=admin")).data.campaignId,
      adminConfig.campaignId,
    );
    assert.equal(
      (await gameCall("/api/fixture/bootstrap")).data.fixtureOnly,
      true,
    );
    assert.equal((await gameCall("/api/admin/editor")).status, 403);
    await portalCall("me");
    assert.equal(
      (await portalCall("login", { email: AMTECH_ACCOUNTS[1].email, password }))
        .status,
      200,
    );
    assert.equal((await portalCall("me")).data.student.role, "admin");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const launch = await portalCall("play", {
      gameCampaign: adminConfig.campaignId,
      gameChallenge: codeChallenge,
      gameReturn: gameOrigin + "/",
    });
    assert.equal(launch.status, 200);
    const ticket = new URLSearchParams(
      new URL(launch.data.launchUrl).hash.slice(1),
    ).get("launch");
    const exchange = await gameCall("/api/portal/session", {
      ticket,
      codeVerifier,
    });
    assert.equal(exchange.status, 200);
    assert.equal(
      (await gameCall("/api/portal/session", { ticket, codeVerifier })).status,
      401,
    );
    const bootstrap = await gameCall(
      "/api/fixture/bootstrap",
      undefined,
      exchange.cookie,
    );
    assert.equal(bootstrap.data.mode, "admin");
    assert.equal(bootstrap.data.principal.playable, false);
    assert.equal(bootstrap.data.campaignId, adminConfig.campaignId);
    const snapshot = await gameCall(
      "/api/admin/editor",
      undefined,
      exchange.cookie,
    );
    assert.equal(snapshot.status, 200);
    assert(snapshot.data.objects.length > 0);
    const draft = {
      objects: snapshot.data.objects,
      baseRevision: snapshot.data.revision,
      draftRevision: 0,
    };
    assert.equal(
      (await gameCall("/api/admin/editor/draft", draft, exchange.cookie))
        .status,
      403,
    );
    assert.equal(
      (
        await gameCall(
          "/api/admin/editor/draft",
          draft,
          exchange.cookie,
          bootstrap.data.csrfToken,
        )
      ).status,
      200,
    );
    assert.equal(
      (await gameCall("/api/game", undefined, exchange.cookie)).status,
      403,
    );
    assert.equal(
      (
        await gameCall(
          "/api/portal/ws-ticket",
          {},
          exchange.cookie,
          bootstrap.data.csrfToken,
        )
      ).status,
      403,
    );
    const signed = new R2plPartnerClient({
      origin: gameOrigin,
      campaignId: adminConfig.campaignId,
      keyId: "demo",
      secret: adminConfig.keys.demo!,
    });
    await assert.rejects(
      signed.request("members", {
        externalStudentId: "not-admin",
        schoolId: "hcmut",
        displayName: "Student",
        active: true,
        eduVerified: true,
      }),
    );
    const untouched = await pool.query(
      "SELECT count(*)::integer AS n FROM r2pl_v2.portal_admins WHERE campaign_id=$1",
      [portalConfig.campaignId],
    );
    assert.equal(untouched.rows[0].n, 0);
    const publicBootstrap = await gameCall("/api/fixture/bootstrap");
    assert.equal(publicBootstrap.data.fixtureOnly, true);
    assert.equal(publicBootstrap.data.players.length, 16);
    assert.equal(
      (
        await gameCall(
          "/api/portal/logout",
          {},
          exchange.cookie,
          bootstrap.data.csrfToken,
        )
      ).status,
      200,
    );
    assert.equal(
      (await gameCall("/api/admin/editor", undefined, exchange.cookie)).status,
      403,
    );
  } finally {
    await portal?.close();
    await game?.close();
    await pool.end();
  }
});
