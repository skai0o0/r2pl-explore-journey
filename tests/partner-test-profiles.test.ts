import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { Pool } from "pg";
import { AdminAccessStore } from "../server/integration/AdminAccessStore.ts";
import { validatePortalConfig } from "../server/integration/PortalConfig.ts";
import { PortalStore } from "../server/integration/PortalStore.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { SignedGameplay } from "../server/integration/SignedGameplay.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { SCHOOLS } from "../shared/gameplay/gameConfig.ts";
import {
  ADMIN_ROLES,
  ALL_ADMIN_PERMISSIONS,
} from "../shared/integration/adminAccess.ts";
import {
  ACK_STATUS,
  decodeAck,
  decodeFrame,
  encodeExplore,
  M2_KIND,
} from "../shared/protocol/m2.ts";

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("partner login owns eight isolated profiles, read-only dashboard, atomic switch/revocation and restart", {
  skip: !database,
  timeout: 90000,
}, async () => {
  const url = new URL(database!);
  assert(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname.startsWith("/r2pl_prep_test_"),
  );
  const pool = new Pool({ connectionString: database, max: 12 });
  const config = validatePortalConfig({
    campaignId: randomUUID(),
    publicOrigin: "https://partner.example.test",
    portalLoginUrl: "https://event.example.test/login",
    websocketUrl: "wss://partner.example.test",
    mode: "production",
    keys: { test: randomBytes(32).toString("hex") },
    adminKey: randomBytes(32).toString("hex"),
  });
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined,
    base = "",
    room: Room | undefined;
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
      cookie:
        response.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .find((c) => c!.startsWith("__Host-r2pl_game=")) ?? "",
    };
  };
  const headersFor = async (cookie: string) => {
    const boot = await call("/api/fixture/bootstrap", undefined, {
      Cookie: cookie,
    });
    assert.equal(boot.status, 200);
    return { Cookie: cookie, "X-CSRF-Token": boot.data.csrfToken as string };
  };
  const login = async (email: string, password: string) => {
    const nonceResponse = await fetch(`${base}/api/admin-auth/config`);
    const nonce = (await nonceResponse.json()) as { csrfToken: string };
    const result = await call(
      "/api/admin-auth/login",
      { email, password },
      {
        Cookie: nonceResponse.headers.getSetCookie()[0]!.split(";")[0]!,
        "X-CSRF-Token": nonce.csrfToken,
      },
    );
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return headersFor(result.cookie);
  };
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
    const password = randomBytes(18).toString("hex");
    await store.provisionRoot(password);
    const root = await login("admin@amtech.vn", password);
    const input = {
      email: "partner@example.test",
      name: "Partner",
      enabled: true,
      testProfiles: true,
      permissions: ADMIN_ROLES.partner.permissions,
      expectedRevision: 0,
      password,
    };
    const created = await call("/api/admin/accounts", input, root);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const account = created.data.account;
    assert.equal(account.testProfiles, true);
    assert.equal((await call("/api/game", undefined, root)).status, 403);
    let partner = await login(input.email, password);
    let boot = await call("/api/fixture/bootstrap", undefined, partner);
    assert.equal(boot.data.mode, "portal");
    assert.equal(boot.data.testProfiles, true);
    assert.equal(boot.data.players.length, 1);
    const initialActor = boot.data.players[0].token as string;
    const admin = await call(
      "/api/fixture/bootstrap?view=admin",
      undefined,
      partner,
    );
    assert.equal(admin.data.mode, "admin");
    assert.equal(admin.data.principal.playable, true);
    assert.deepEqual(
      admin.data.principal.permissions,
      ADMIN_ROLES.partner.permissions,
    );
    for (const path of [
      "/api/admin/rankings",
      "/api/admin/editor",
      "/api/admin/gift-pool",
      "/api/admin/gifts",
      "/api/admin/audit",
      "/api/game",
      "/api/fixture/me",
      "/api/fixture/chests",
    ])
      assert.equal((await call(path, undefined, partner)).status, 200, path);
    assert.equal(
      (await call("/api/admin/accounts", undefined, partner)).status,
      403,
    );
    for (const [path, body] of [
      ["/api/admin", { action: "notify", title: "Forged", body: "No" }],
      ["/api/admin", { action: "publish", objects: [], baseRevision: 0 }],
      [
        "/api/admin",
        { action: "rollback", targetRevision: 0, baseRevision: 0 },
      ],
      [
        "/api/admin/editor/draft",
        { objects: [], baseRevision: 0, draftRevision: 0 },
      ],
      [
        "/api/admin/gift-pool",
        {
          action: "upsert",
          name: "Forged",
          tier: "nitro",
          remaining: 1,
          expectedRevision: 0,
        },
      ],
      ["/api/admin/gifts/redeem", { giftCode: "forged" }],
      [
        "/api/admin/accounts",
        {
          ...input,
          email: "escalated@example.test",
          testProfiles: false,
          permissions: ALL_ADMIN_PERMISSIONS,
        },
      ],
    ] as const)
      assert.equal((await call(path, body, partner)).status, 403, path);
    assert.equal(
      (
        await call(
          "/api/admin/accounts",
          {
            ...input,
            expectedRevision: account.revision,
            permissions: ALL_ADMIN_PERMISSIONS,
          },
          root,
        )
      ).status,
      400,
    );
    assert.equal(
      (await call("/api/test-profiles/switch", { schoolId: "amtech" }, partner))
        .status,
      400,
    );
    assert.equal(
      (
        await call(
          "/api/test-profiles/switch",
          { schoolId: "ou", actorId: initialActor },
          partner,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/api/test-profiles/switch",
          { schoolId: "ou" },
          { Cookie: partner.Cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/test-profiles/switch", { schoolId: "ou" }, root))
        .status,
      403,
    );
    // Pre-provisioned SSO staff can receive the same explicit, read-only test grant.
    const staffEmail = "partner-staff@amtech.vn";
    const staff = await call(
      "/api/admin/accounts",
      {
        email: staffEmail,
        password,
        name: "Partner staff",
        enabled: true,
        testProfiles: true,
        permissions: ADMIN_ROLES.testPlayer.permissions,
        expectedRevision: 0,
      },
      root,
    );
    assert.equal(staff.status, 200);
    const directStaff = await login(staffEmail, password);
    assert.equal((await call("/api/game", undefined, directStaff)).status, 200);
    assert.equal(
      (await call("/api/admin/rankings", undefined, directStaff)).status,
      403,
    );
    const deniedStaffPassword = await call(
      "/api/admin/accounts",
      {
        email: "admin-staff@amtech.vn",
        name: "Staff",
        enabled: true,
        testProfiles: false,
        permissions: ALL_ADMIN_PERMISSIONS,
        expectedRevision: 0,
        password,
      },
      root,
    );
    assert.equal(deniedStaffPassword.status, 400);
    assert.equal(deniedStaffPassword.data.error, "STAFF_USES_PORTAL");
    const member = {
      externalStudentId: "partner-staff-sso",
      schoolId: "amtech",
      email: staffEmail,
      emailVerified: true,
      active: true,
      displayName: "Partner staff",
      eduVerified: true,
    };
    const provisioned = (await portal.upsertMember(member)) as {
      playable: boolean;
    };
    assert.equal(provisioned.playable, true);
    const verifier = randomBytes(32).toString("base64url");
    const launch = (await portal.launch({
      externalStudentId: member.externalStudentId,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
    })) as { launchUrl: string };
    const exchanged = await portal.exchange({
      ticket: new URLSearchParams(new URL(launch.launchUrl).hash.slice(1)).get(
        "launch",
      ),
      codeVerifier: verifier,
    });
    const staffHeaders = await headersFor(
      `__Host-r2pl_game=${exchanged.token}`,
    );
    assert.equal(
      (await call("/api/game", undefined, staffHeaders)).status,
      200,
    );
    assert.equal(
      (await call("/api/admin/rankings", undefined, staffHeaders)).status,
      403,
    );
    const staffAdmin = await call(
      "/api/fixture/bootstrap?view=admin",
      undefined,
      staffHeaders,
    );
    assert.deepEqual(staffAdmin.data.principal.permissions, []);
    assert.equal(staffAdmin.data.principal.playable, true);
    const staffAfterSso = await login(staffEmail, password);
    assert.equal(
      (await call("/api/game", undefined, staffAfterSso)).status,
      200,
    );
    await portal.upsertMember({ ...member, active: false });
    assert.equal(
      (await call("/api/game", undefined, staffHeaders)).status,
      401,
    );
    assert.equal(
      (await call("/api/game", undefined, staffAfterSso)).status,
      401,
    );
    // Synthetic funding is restricted to this disposable loopback test database.
    await pool.query(
      "UPDATE r2pl_v2.wallet_accounts SET opening_balance=37,balance=37 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
      [config.campaignId, initialActor],
    );
    const before = (await call("/api/fixture/me", undefined, partner)).data;
    const oldHeaders = partner,
      oldToken = partner.Cookie.split("=")[1]!;
    const oldActor = (await portal.authenticate(oldToken))!;
    const ticket = await call("/api/portal/ws-ticket", {}, partner);
    assert.equal(ticket.status, 200);
    room = await new ColyseusSDK(`ws://127.0.0.1:${play.webPort}`).joinOrCreate(
      "m2",
      { token: ticket.data.ticket },
    );
    const hq = play.fixture.headquarters.find((h) => h.schoolSlot === 0)!;
    const exploredTile = hq.z * 1000 + hq.x + hq.size;
    const ack = new Promise<ReturnType<typeof decodeAck>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Partner exploration ACK timeout")),
        5000,
      );
      room!.onMessage("m2", (bytes: Uint8Array) => {
        const frame = decodeFrame(bytes);
        if (frame.kind === M2_KIND.ACK) {
          clearTimeout(timeout);
          resolve(decodeAck(frame.payload));
        }
      });
    });
    room.sendBytes(
      "m2",
      encodeExplore({
        key: randomBytes(16),
        tileIndex: exploredTile,
        ruleVersion: 1,
        intent: "explore",
      }),
    );
    assert.equal((await ack).status, ACK_STATUS.TEST_APPLIED);
    const spentBalance = (await call("/api/fixture/me", undefined, partner))
      .data.balance;
    assert(BigInt(spentBalance) < 37n);
    const delayed = await call("/api/portal/ws-ticket", {}, partner);
    let switched = await call(
      "/api/test-profiles/switch",
      { schoolId: SCHOOLS[1]!.id },
      partner,
    );
    assert.equal(switched.status, 200);
    partner = await headersFor(switched.cookie);
    assert.equal((await call("/api/game", undefined, oldHeaders)).status, 401);
    assert.equal(
      (await call("/api/admin/rankings", undefined, oldHeaders)).status,
      401,
    );
    await assert.rejects(() => portal.consumeSocketTicket(delayed.data.ticket));
    await assert.rejects(
      () =>
        new SignedGameplay(
          pool,
          play!.fixture,
          undefined,
          undefined,
          true,
        ).command(oldActor, {
          ruleVersion: 1,
          action: "running",
          key: randomUUID(),
          amount: 1,
        }),
      /UNAUTHORIZED/,
    );
    await assert.rejects(
      () =>
        play!.realtime.authority.apply(
          oldActor.actorId,
          oldActor.schoolSlot,
          randomBytes(16),
          0,
          "explore",
          createHash("sha256").update(oldToken).digest("hex"),
        ),
      /UNAUTHORIZED/,
    );
    const actorIds = new Set([initialActor]);
    for (const school of SCHOOLS.slice(1)) {
      switched = await call(
        "/api/test-profiles/switch",
        { schoolId: school.id },
        partner,
      );
      assert.equal(switched.status, 200);
      partner = await headersFor(switched.cookie);
      boot = await call("/api/fixture/bootstrap", undefined, partner);
      assert.equal(boot.data.players[0].slot, school.slot);
      actorIds.add(boot.data.players[0].token);
      assert.equal(
        (await call("/api/admin/rankings", undefined, partner)).status,
        200,
      );
    }
    assert.equal(actorIds.size, 8);
    switched = await call(
      "/api/test-profiles/switch",
      { schoolId: SCHOOLS[0]!.id },
      partner,
    );
    partner = await headersFor(switched.cookie);
    assert.equal(
      (await call("/api/fixture/bootstrap", undefined, partner)).data.players[0]
        .token,
      initialActor,
    );
    const restored = (await call("/api/fixture/me", undefined, partner)).data;
    assert.equal(restored.balance, spentBalance);
    assert.deepEqual(restored.inventory, {
      ...before.inventory,
      credits: spentBalance,
    });
    // Concurrent requests using one cookie can produce only one fresh session.
    const raced = await Promise.all(
      SCHOOLS.slice(1, 3).map((s) =>
        call("/api/test-profiles/switch", { schoolId: s.id }, partner),
      ),
    );
    assert.deepEqual(raced.map((r) => r.status).sort(), [200, 403]);
    partner = await headersFor(raced.find((r) => r.status === 200)!.cookie);
    await room.leave();
    room = undefined;
    await play.close();
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      config.campaignId,
      { portal: config },
    );
    base = `http://127.0.0.1:${play.webPort}`;
    assert.equal((await call("/api/game", undefined, partner)).status, 200);
    const profiles = await pool.query(
      "SELECT actor_id FROM r2pl_v2.partner_test_profiles WHERE campaign_id=$1 AND owner_actor_id=$2",
      [config.campaignId, account.actorId],
    );
    assert.deepEqual(new Set(profiles.rows.map((r) => r.actor_id)), actorIds);
    const freshRoot = await login("admin@amtech.vn", password);
    assert.equal(
      (
        await call(
          "/api/admin/accounts",
          { ...input, enabled: false, expectedRevision: account.revision },
          freshRoot,
        )
      ).status,
      200,
    );
    for (const path of [
      "/api/game",
      "/api/admin/rankings",
      "/api/fixture/bootstrap",
    ])
      assert.equal((await call(path, undefined, partner)).status, 401, path);
    const data = JSON.stringify(
      (await call("/api/admin/accounts", undefined, freshRoot)).data,
    );
    assert(
      !data.includes(password) &&
        !data.includes("password_hash") &&
        !data.includes("password_salt"),
    );
  } finally {
    await room?.leave();
    await play?.close();
    await pool.end();
  }
});
