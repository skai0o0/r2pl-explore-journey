import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { AdminAccessStore } from "../server/integration/AdminAccessStore.ts";
import { validatePortalConfig } from "../server/integration/PortalConfig.ts";
import { PortalStore } from "../server/integration/PortalStore.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { ALL_ADMIN_PERMISSIONS } from "../shared/integration/adminAccess.ts";

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("only protected root can adjust shared and student points and reset safely", {
  skip: !database,
  timeout: 90000,
}, async () => {
  const url = new URL(database!);
  assert(
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.pathname.startsWith("/r2pl_prep_test_"),
  );
  const pool = new Pool({ connectionString: database, max: 12 });
  const config = validatePortalConfig({
    campaignId: randomUUID(),
    publicOrigin: "https://test.example",
    portalLoginUrl: "https://event.example/login",
    websocketUrl: "wss://test.example",
    mode: "production",
    keys: { test: randomBytes(32).toString("hex") },
    adminKey: randomBytes(32).toString("hex"),
  });
  let backups = 0,
    failBackup = false;
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  let base = "";
  const call = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: config.publicOrigin,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      data: text ? JSON.parse(text) : {},
      cookie: response.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    };
  };
  const login = async (email: string, password: string) => {
    const nonce = await call("/api/admin-auth/config");
    const loginResult = await call(
      "/api/admin-auth/login",
      { email, password },
      { Cookie: nonce.cookie, "X-CSRF-Token": nonce.data.csrfToken },
    );
    assert.equal(loginResult.status, 200);
    const cookie = loginResult.cookie
      .split("; ")
      .find((c) => c.startsWith("__Host-r2pl_game="))!;
    const boot = await call("/api/fixture/bootstrap", undefined, {
      Cookie: cookie,
    });
    return { Cookie: cookie, "X-CSRF-Token": boot.data.csrfToken as string };
  };
  try {
    await migratePortalDatabase(pool);
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      config.campaignId,
      {
        portal: config,
        campaignBackup: async () => {
          backups++;
          if (failBackup) {
            const { PortalError } = await import(
              "../server/integration/PortalSignature.ts"
            );
            throw new PortalError(503, "BACKUP_FAILED");
          }
          return "/synthetic/test.dump";
        },
      },
    );
    base = `http://127.0.0.1:${play.webPort}`;
    const password = randomBytes(18).toString("hex"),
      store = new AdminAccessStore(pool, config.campaignId),
      portal = new PortalStore(pool, config);
    await store.provisionRoot(password);
    const root = await login("admin@amtech.vn", password);
    assert.equal((await call("/api/admin/campaign")).status, 401);
    assert.equal(
      (
        await call(
          "/api/admin/campaign",
          { action: "reset", key: randomUUID(), confirmation: "RESET" },
          { Cookie: root.Cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/admin/accounts",
          {
            email: "full@example.test",
            name: "Full",
            enabled: true,
            permissions: ALL_ADMIN_PERMISSIONS,
            expectedRevision: 0,
            password,
          },
          root,
        )
      ).status,
      200,
    );
    const full = await login("full@example.test", password);
    assert.equal(
      (await call("/api/admin/campaign", undefined, full)).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/admin/campaign",
          { action: "reset", key: randomUUID(), confirmation: "RESET" },
          full,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/admin/accounts",
          {
            email: "partner@example.test",
            name: "Partner",
            enabled: true,
            permissions: [],
            testProfiles: true,
            expectedRevision: 0,
            password,
          },
          root,
        )
      ).status,
      200,
    );
    await login("partner@example.test", password);
    const member = {
      externalStudentId: "student-123",
      schoolId: "hcmut",
      email: "student@example.test",
      emailVerified: true,
      active: true,
      displayName: "Synthetic Student",
      eduVerified: true,
    };
    await portal.upsertMember(member);
    const list = await call("/api/admin/campaign", undefined, root);
    assert.equal(list.status, 200);
    assert.equal(list.data.pools.length, 8);
    const first = list.data.pools[0];
    const setPool = {
      action: "set_pool",
      key: randomUUID(),
      schoolId: first.schoolId,
      expectedBalance: first.balance,
      balance: "8888",
    };
    assert.equal(
      (await call("/api/admin/campaign", setPool, root)).status,
      200,
    );
    assert.equal(
      (await call("/api/admin/campaign", setPool, root)).data.replayed,
      true,
    );
    assert.equal(
      (
        await call(
          "/api/admin/campaign",
          { ...setPool, key: randomUUID(), balance: "20" },
          root,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          "/api/admin/campaign",
          {
            ...setPool,
            key: randomUUID(),
            expectedBalance: "8888",
            balance: "-1",
          },
          root,
        )
      ).status,
      400,
    );
    const found = await call(
      "/api/admin/campaign",
      { action: "search", query: "student-123" },
      root,
    );
    assert.equal(found.status, 200);
    assert.equal(found.data.students.length, 1);
    const student = found.data.students[0];
    const profile = (
      await pool.query(
        "SELECT actor_id FROM r2pl_v2.partner_test_profiles WHERE campaign_id=$1 LIMIT 1",
        [config.campaignId],
      )
    ).rows[0].actor_id;
    assert.equal(
      (
        await call(
          "/api/admin/campaign",
          {
            action: "set_student",
            key: randomUUID(),
            actorId: profile,
            expectedBalance: "0",
            balance: "500",
            reason: "Đối soát",
          },
          root,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          "/api/admin/campaign",
          {
            action: "set_student",
            key: randomUUID(),
            actorId: student.actorId,
            expectedBalance: student.balance,
            balance: "500",
            reason: "Đối soát",
          },
          root,
        )
      ).status,
      200,
    );
    const note = {
      action: "note",
      key: randomUUID(),
      actorId: student.actorId,
      note: "Kiểm tra thành tích",
    };
    assert.equal((await call("/api/admin/campaign", note, root)).status, 200);
    assert.equal(
      (await call("/api/admin/campaign", note, root)).data.replayed,
      true,
    );
    assert.equal(
      (
        await call(
          "/api/admin/campaign",
          { action: "history", actorId: student.actorId, offset: 0 },
          full,
        )
      ).status,
      403,
    );
    await pool.query(
      "INSERT INTO r2pl_v2.game_events(campaign_id,actor_id,title,body) VALUES($1,$2,'Test activity','Synthetic')",
      [config.campaignId, student.actorId],
    );
    const reset = { action: "reset", key: randomUUID(), confirmation: "RESET" };
    failBackup = true;
    assert.equal((await call("/api/admin/campaign", reset, root)).status, 503);
    assert.equal(
      (await call("/api/admin/campaign", undefined, root)).data.pools[0]
        .balance,
      "8888",
    );
    const history = await call(
      "/api/admin/campaign",
      { action: "history", actorId: student.actorId, offset: 0 },
      root,
    );
    assert.equal(history.status, 200, JSON.stringify(history.data));
    assert(
      history.data.entries.some(
        (e: { kind: string; detail: { title?: string } }) =>
          e.kind === "event" && e.detail.title === "Test activity",
      ),
    );
    assert(
      history.data.entries.some((e: { kind: string }) => e.kind === "note"),
    );
    assert(
      history.data.entries.some((e: { kind: string }) => e.kind === "points"),
    );
    failBackup = false;
    const done = await call("/api/admin/campaign", reset, root);
    assert.equal(done.status, 200, JSON.stringify(done.data));
    const afterReset = await call(
      "/api/admin/campaign",
      { action: "history", actorId: student.actorId, offset: 0 },
      root,
    );
    assert(
      afterReset.data.entries.some(
        (e: { kind: string; detail: { title?: string } }) =>
          e.kind === "event" && e.detail.title === "Test activity",
      ),
    );
    const filtered = await call(
      "/api/admin/campaign",
      {
        action: "history",
        actorId: student.actorId,
        offset: 0,
        kind: "note",
        from: "2000-01-01",
        to: "2100-01-01",
      },
      root,
    );
    assert.equal(filtered.status, 200);
    assert(
      filtered.data.entries.length > 0 &&
        filtered.data.entries.every((e: { kind: string }) => e.kind === "note"),
    );
    assert.equal(
      (
        await call(
          "/api/admin/campaign",
          {
            action: "history",
            actorId: student.actorId,
            offset: 0,
            from: "2026-02-30",
          },
          root,
        )
      ).status,
      400,
    );
    assert.equal(
      (await call("/api/admin/campaign", reset, root)).data.replayed,
      true,
    );
    assert.equal(backups, 2);
    assert.equal(
      (await call("/api/admin/campaign", undefined, root)).data.pools[0]
        .balance,
      "0",
    );
    assert.equal(
      (
        await call(
          "/api/admin/campaign",
          { action: "search", query: "student-123" },
          root,
        )
      ).data.students[0].balance,
      "0",
    );
    const scores = await pool.query(
      "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='knowledge-score'",
      [config.campaignId],
    );
    assert.equal(scores.rowCount, 8);
    assert(scores.rows.every((r) => r.data.points === 400));
    const audit = await pool.query(
      "SELECT action,count(*)::int n FROM r2pl_v2.operator_audit WHERE campaign_id=$1 AND action IN ('campaign-reset','campaign-points-adjustment') GROUP BY action",
      [config.campaignId],
    );
    assert.equal(audit.rows.find((r) => r.action === "campaign-reset").n, 1);
    assert.equal(
      audit.rows.find((r) => r.action === "campaign-points-adjustment").n,
      2,
    );
  } finally {
    if (play) await play.close();
    await pool.end();
  }
});
