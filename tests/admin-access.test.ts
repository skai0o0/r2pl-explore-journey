import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { AdminAccessStore } from "../server/integration/AdminAccessStore.ts";
import { validatePortalConfig } from "../server/integration/PortalConfig.ts";
import { PortalStore } from "../server/integration/PortalStore.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { GAME_CONFIG } from "../shared/gameplay/gameConfig.ts";
import {
  ADMIN_ROLES,
  ALL_ADMIN_PERMISSIONS,
  defaultAdminPermissions,
} from "../shared/integration/adminAccess.ts";
import { isAmtechIdentity } from "../shared/integration/identity.ts";

test("AMTECH defaults full; exact verified Acer/Dava domains default observer", () => {
  for (const domain of ["amtech.vn", "amtech-vn.com", "acer.com", "dava.vn"]) {
    assert(isAmtechIdentity(`staff@${domain}`, true));
    assert(!isAmtechIdentity(`staff@${domain}`, false));
    assert(!isAmtechIdentity(`staff@${domain}.evil.test`, true));
  }
  assert.deepEqual(defaultAdminPermissions("staff@acer.com"), [
    "rankings.view",
  ]);
  assert.deepEqual(defaultAdminPermissions("staff@dava.vn"), ["rankings.view"]);
  assert.deepEqual(
    defaultAdminPermissions("staff@amtech.vn"),
    ALL_ADMIN_PERMISSIONS,
  );
});
const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("admin dashboard auth: protected root, local accounts, permission matrix, revocation and SSO defaults", {
  skip: !database,
  timeout: 90000,
}, async () => {
  const url = new URL(database!);
  assert(
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
      /^r2pl_prep_test_/.test(url.pathname.slice(1)),
  );
  const pool = new Pool({ connectionString: database, max: 12 });
  const config = validatePortalConfig({
    campaignId: randomUUID(),
    publicOrigin: "https://admin.example.test",
    portalLoginUrl: "https://event.example.test/login",
    websocketUrl: "wss://admin.example.test",
    mode: "production",
    keys: { test: randomBytes(32).toString("hex") },
    adminKey: randomBytes(32).toString("hex"),
  });
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  let base = "";
  const call = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: config.publicOrigin,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await r.text();
    return {
      status: r.status,
      data: raw ? JSON.parse(raw) : {},
      cookie: r.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .filter(Boolean)
        .join("; "),
      cookies: r.headers.getSetCookie(),
    };
  };
  const login = async (email: string, password: string) => {
    const nonce = await call("/api/admin-auth/config");
    const result = await call(
      "/api/admin-auth/login",
      { email, password },
      { Cookie: nonce.cookie, "X-CSRF-Token": nonce.data.csrfToken },
    );
    assert.equal(result.status, 200);
    const cookie = result.cookie
      .split("; ")
      .find((c) => c.startsWith("__Host-r2pl_game="))!;
    const page = await call("/api/fixture/bootstrap", undefined, {
      Cookie: cookie,
    });
    assert.equal(page.data.mode, "admin");
    return { Cookie: cookie, "X-CSRF-Token": page.data.csrfToken as string };
  };
  const password = randomBytes(18).toString("hex");
  try {
    await migratePortalDatabase(pool);
    await migratePortalDatabase(pool);
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      config.campaignId,
      { portal: config },
    );
    base = `http://127.0.0.1:${play.webPort}`;
    const store = new AdminAccessStore(pool, config.campaignId),
      portal = new PortalStore(pool, config);
    await store.provisionRoot(password);
    await store.provisionRoot("DifferentPassword123"); // repeated bootstrap cannot replace credentials
    assert.equal((await call("/api/admin/accounts")).status, 401);
    assert.equal(
      (
        await call("/api/admin-auth/login", {
          email: "admin@amtech.vn",
          password,
        })
      ).status,
      403,
    );
    const nonce = await call("/api/admin-auth/config");
    assert(
      nonce.cookies[0]!.includes("HttpOnly") &&
        nonce.cookies[0]!.includes("Secure"),
    );
    assert.equal(
      (
        await call(
          "/api/admin-auth/login",
          { email: "admin@amtech.vn", password },
          {
            Cookie: nonce.cookie,
            "X-CSRF-Token": nonce.data.csrfToken,
            Origin: "https://evil.test",
          },
        )
      ).status,
      403,
    );
    const root = await login("admin@amtech.vn", password);
    const rootPage = await call("/api/fixture/bootstrap", undefined, root);
    assert.equal(rootPage.data.principal.protectedRoot, true);
    assert.deepEqual(
      rootPage.data.principal.permissions,
      ALL_ADMIN_PERMISSIONS,
    );
    assert.equal(
      (
        await call(
          "/api/admin/accounts",
          {
            email: "admin@amtech.vn",
            name: "Root",
            enabled: false,
            permissions: [],
            expectedRevision: 0,
          },
          root,
        )
      ).status,
      403,
    );
    await assert.rejects(
      () =>
        portal.upsertMember({
          externalStudentId: "root-spoof",
          schoolId: "amtech",
          email: "admin@amtech.vn",
          emailVerified: true,
          active: false,
          displayName: "Spoof",
          eduVerified: true,
        }),
      /ROOT_ADMIN_PROTECTED/,
    );
    const create = async (email: string, permissions: readonly string[]) => {
      const r = await call(
        "/api/admin/accounts",
        {
          email,
          name: email.split("@")[0],
          permissions,
          enabled: true,
          expectedRevision: 0,
          password,
        },
        root,
      );
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.account;
    };
    const viewerAccount = await create(
      "outside@gmail.com",
      ADMIN_ROLES.viewer.permissions,
    );
    const viewer = await login("outside@gmail.com", password);
    assert.equal(
      (await call("/api/admin/rankings", undefined, viewer)).status,
      200,
    );
    for (const path of [
      "/api/admin/accounts",
      "/api/admin/audit",
      "/api/admin/editor",
      "/api/admin/gift-pool",
      "/api/admin/gifts",
      "/api/fixture/world",
    ])
      assert.equal((await call(path, undefined, viewer)).status, 403, path);
    for (const [path, body] of [
      ["/api/admin", { action: "notify", title: "Forged", body: "Test" }],
      [
        "/api/admin/editor/draft",
        { objects: [], baseRevision: 0, draftRevision: 0 },
      ],
      ["/api/admin/gifts/redeem", { giftCode: "forged" }],
      ["/api/admin/accounts", { email: "evil@gmail.com" }],
    ] as const)
      assert(
        [400, 403].includes((await call(path, body, viewer)).status),
        path,
      );
    await create("editor@gmail.com", ADMIN_ROLES.editor.permissions);
    const editor = await login("editor@gmail.com", password);
    const snapshot = await call("/api/admin/editor", undefined, editor);
    assert.equal(snapshot.status, 200);
    assert.equal(
      (
        await call(
          "/api/admin/editor/draft",
          {
            objects: snapshot.data.objects,
            baseRevision: snapshot.data.revision,
            draftRevision: 0,
          },
          editor,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/admin",
          {
            action: "publish",
            objects: snapshot.data.objects,
            baseRevision: snapshot.data.revision,
          },
          editor,
        )
      ).status,
      403,
    );
    await create("rewards@gmail.com", ADMIN_ROLES.rewards.permissions);
    const rewards = await login("rewards@gmail.com", password);
    const poolSnapshot = await call("/api/admin/gift-pool", undefined, rewards);
    assert.equal(poolSnapshot.status, 200);
    assert.equal(
      (
        await call(
          "/api/admin/gift-pool",
          {
            action: "upsert",
            name: "Test Gift",
            tier: "nitro",
            remaining: 2,
            expectedRevision: poolSnapshot.data.revision,
          },
          rewards,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/admin",
          { action: "notify", title: "No", body: "No" },
          rewards,
        )
      ).status,
      403,
    );
    await create("comms@gmail.com", ADMIN_ROLES.communications.permissions);
    const comms = await login("comms@gmail.com", password);
    assert.equal(
      (
        await call(
          "/api/admin",
          { action: "notify", title: "Test", body: "Isolated campaign" },
          comms,
        )
      ).status,
      200,
    );
    assert.equal(
      (await call("/api/admin/gifts", undefined, comms)).status,
      403,
    );
    const limited = await create("limited@gmail.com", ["admins.manage"]),
      limitedSession = await login(limited.email, password);
    assert.equal(
      (
        await call(
          "/api/admin/accounts",
          {
            email: "escalate@gmail.com",
            name: "Escalation",
            permissions: ALL_ADMIN_PERMISSIONS,
            enabled: true,
            expectedRevision: 0,
            password,
          },
          limitedSession,
        )
      ).status,
      403,
    );
    const disable = {
      email: viewerAccount.email,
      name: viewerAccount.name,
      enabled: false,
      permissions: [],
      expectedRevision: viewerAccount.revision,
    };
    assert.equal(
      (await call("/api/admin/accounts", disable, root)).status,
      200,
    );
    assert.equal(
      (await call("/api/admin/rankings", undefined, viewer)).status,
      401,
    );
    assert.equal(
      (await call("/api/admin/accounts", disable, root)).status,
      409,
    );
    assert.equal(
      (await call("/api/admin/accounts", undefined, root)).data.accounts.some(
        (a: Record<string, unknown>) =>
          "password_hash" in a || "password_salt" in a,
      ),
      false,
    );
    const sso = async (email: string) => {
      const externalStudentId = `sso-${randomUUID()}`;
      const member = {
        externalStudentId,
        schoolId: "amtech",
        email,
        emailVerified: true,
        active: true,
        displayName: email,
        eduVerified: true,
      };
      await portal.upsertMember(member);
      const verifier = randomBytes(32).toString("base64url");
      const launch = (await portal.launch({
        externalStudentId,
        codeChallenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      })) as { launchUrl: string };
      const session = await portal.exchange({
        ticket: new URLSearchParams(
          new URL(launch.launchUrl).hash.slice(1),
        ).get("launch"),
        codeVerifier: verifier,
      });
      return {
        member,
        token: session.token,
        principal: (await portal.authenticateAdmin(session.token))!,
      };
    };
    const acer = await sso("new-staff@acer.com"),
      dava = await sso("staff@dava.vn"),
      amtech = await sso("staff@amtech-vn.com");
    assert.deepEqual(acer.principal.permissions, ["rankings.view"]);
    assert.deepEqual(dava.principal.permissions, ["rankings.view"]);
    assert.deepEqual(amtech.principal.permissions, ALL_ADMIN_PERMISSIONS);
    await store.save(
      rootPage.data.principal.actorId,
      root.Cookie.split("=")[1]!,
      {
        email: amtech.member.email,
        name: "Disabled staff",
        permissions: [],
        enabled: false,
        expectedRevision: 0,
      },
    );
    await portal.upsertMember(amtech.member); // signed provider cannot undo Game-side ban
    assert.equal(await portal.authenticateAdmin(amtech.token), undefined);
    await assert.rejects(() =>
      portal.launch({
        externalStudentId: amtech.member.externalStudentId,
        codeChallenge: randomBytes(32).toString("base64url"),
      }),
    );
    const formerStaff = await sso("sv001@amtech.vn");
    for (const [email, schoolId, slot] of [
      ["sv001@amtech.vn", "hcmut", 0],
      ["sv002@amtech.vn", "hcmiu", 7],
      ["sv003@amtech.vn", "ou", 1],
    ] as const) {
      await pool.query(
        "INSERT INTO r2pl_v2.portal_student_overrides(campaign_id,email,school_id) VALUES($1,$2,$3)",
        [config.campaignId, email, schoolId],
      );
      const member = {
        externalStudentId:
          email === "sv001@amtech.vn"
            ? formerStaff.member.externalStudentId
            : randomUUID(),
        email: email.toUpperCase(),
        emailVerified: true,
        eduVerified: false,
        schoolId: "amtech",
        active: true,
        displayName: email,
      };
      await assert.rejects(() =>
        portal.upsertMember({ ...member, emailVerified: false }),
      );
      assert.deepEqual(await portal.upsertMember(member), {
        externalStudentId: member.externalStudentId,
        schoolId,
        active: true,
        role: "user",
        playable: true,
      });
      const verifier = randomBytes(32).toString("base64url");
      const launch = (await portal.launch({
        externalStudentId: member.externalStudentId,
        codeChallenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      })) as { launchUrl: string };
      const session = await portal.exchange({
        ticket: new URLSearchParams(
          new URL(launch.launchUrl).hash.slice(1),
        ).get("launch"),
        codeVerifier: verifier,
      });
      assert.equal(
        (await portal.authenticate(session.token))?.schoolSlot,
        slot,
      );
      assert.equal(await portal.authenticateAdmin(session.token), undefined);
      assert.equal(
        (
          await call("/api/admin/rankings", undefined, {
            Cookie: `__Host-r2pl_game=${session.token}`,
          })
        ).status,
        401,
      );
      const actorId = (await portal.authenticate(session.token))!.actorId;
      const wallet = await pool.query(
        "SELECT balance FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
        [config.campaignId, actorId],
      );
      await portal.upsertMember(member);
      assert.equal(
        (await portal.authenticate(session.token))?.actorId,
        actorId,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT balance FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
            [config.campaignId, actorId],
          )
        ).rows[0].balance,
        wallet.rows[0].balance,
      );
      await assert.rejects(
        () =>
          portal.upsertMember({ ...member, externalStudentId: randomUUID() }),
        /IDENTITY_ALREADY_BOUND/,
      );
    }
    assert.equal(await portal.authenticateAdmin(formerStaff.token), undefined);
    assert.equal(
      (await portal.authenticateAdmin(acer.token))?.permissions?.includes(
        "rankings.view",
      ),
      true,
    );
    const audit = await call("/api/admin/audit", undefined, root);
    assert.equal(audit.status, 200);
    assert(!JSON.stringify(audit.data).includes(password));
    for (let i = 0; i < GAME_CONFIG.adminAccess.maxEmailAttempts; i++)
      await assert.rejects(() =>
        store.login("no-account@gmail.com", "wrong-password", "test-source"),
      );
    await assert.rejects(
      () => store.login("no-account@gmail.com", password, "test-source"),
      /LOGIN_RATE_LIMITED/,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM r2pl_v2.portal_members WHERE campaign_id=$1 AND external_student_id LIKE 'local-admin:%'",
          [config.campaignId],
        )
      ).rowCount,
      0,
    );
  } finally {
    await play?.close();
    await pool
      .query("DELETE FROM r2pl_v2.campaigns WHERE id=$1", [config.campaignId])
      .catch(() => {});
    await pool.end();
  }
});
