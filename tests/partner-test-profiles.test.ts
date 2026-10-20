import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { Pool } from "pg";
import { AdminAccessStore } from "../server/integration/AdminAccessStore.ts";
import { validatePortalConfig } from "../server/integration/PortalConfig.ts";
import { portalSignature } from "../server/integration/PortalSignature.ts";
import { PortalStore } from "../server/integration/PortalStore.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { SignedGameplay } from "../server/integration/SignedGameplay.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { GAME_CONFIG, SCHOOLS } from "../shared/gameplay/gameConfig.ts";
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
    const signedPartnerCall = async (operation: string, input: unknown) => {
      const path = `/api/partner/v1/${operation}`,
        timestamp = String(Date.now()),
        nonce = randomBytes(24).toString("hex"),
        raw = Buffer.from(JSON.stringify(input));
      // Partner backend sends no browser Origin header.
      const response = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-R2PL-Campaign": config.campaignId,
          "X-R2PL-Key-Id": "test",
          "X-R2PL-Timestamp": timestamp,
          "X-R2PL-Nonce": nonce,
          "X-R2PL-Signature": portalSignature(
            config.keys.test!,
            config.campaignId,
            "POST",
            path,
            timestamp,
            nonce,
            raw,
          ),
        },
        body: raw,
      });
      assert.equal(response.status, 200);
      return (await response.json()) as Record<string, unknown>;
    };
    const provisioned = await signedPartnerCall("members", member);
    assert.equal(provisioned.role, "admin");
    assert.equal(
      provisioned.playable,
      false,
      "legacy Portal staff contract is independent of internal test play",
    );
    assert.equal("permissions" in provisioned, false);
    let staffRevision = staff.data.account.revision;
    for (const grant of [
      { testProfiles: true, permissions: ADMIN_ROLES.partner.permissions },
      {
        testProfiles: false,
        permissions: ALL_ADMIN_PERMISSIONS.filter(
          (p) => p !== "notifications.send",
        ),
      },
      { testProfiles: true, permissions: [] },
    ]) {
      const saved = await call(
        "/api/admin/accounts",
        {
          email: staffEmail,
          name: "Partner staff",
          enabled: true,
          expectedRevision: staffRevision,
          ...grant,
        },
        root,
      );
      assert.equal(saved.status, 200);
      staffRevision = saved.data.account.revision;
      const identity = await signedPartnerCall("members", member);
      assert.equal(identity.role, "admin");
      assert.equal(
        identity.playable,
        false,
        "removing any admin right must preserve the v1 staff response",
      );
    }
    const verifier = randomBytes(32).toString("base64url");
    const launch = (await signedPartnerCall("launches", {
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
      "UPDATE r2pl_v2.test_point_pools SET opening_balance=37,balance=37 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
      [config.campaignId, initialActor],
    );
    const peerAccount = await call(
      "/api/admin/accounts",
      {
        ...input,
        email: "other-partner@example.test",
        name: "Other partner",
        permissions: [],
      },
      root,
    );
    assert.equal(peerAccount.status, 200);
    let peer = await login("other-partner@example.test", password);
    const peerActor = (await portal.authenticate(peer.Cookie.split("=")[1]!))!;
    assert.notEqual(
      peerActor.actorId,
      initialActor,
      "profiles and inventory stay private",
    );
    assert.equal(
      (await call("/api/fixture/me", undefined, peer)).data.balance,
      "37",
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
    let spentBalance = (await call("/api/fixture/me", undefined, partner)).data
      .balance;
    const peerMe = (await call("/api/fixture/me", undefined, peer)).data;
    assert.equal(
      peerMe.balance,
      spentBalance,
      "another login sees the same school pool after WS spend",
    );
    assert.equal(peerMe.ledgerConserved, true);
    assert.equal(
      (await call("/api/game", undefined, peer)).data.contributionCapacity,
      (
        BigInt(spentBalance) / BigInt(GAME_CONFIG.landmark.pointsPerCrystal)
      ).toString(),
    );
    assert(BigInt(spentBalance) < 37n);
    // HTTP contribution and automatic refund hit the same pool as WebSocket exploration.
    const clusterId = randomUUID(),
      now = Date.now();
    await pool.query(
      "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'shared-cluster',$2,$3)",
      [
        config.campaignId,
        clusterId,
        JSON.stringify({
          id: clusterId,
          pair: [0, 1],
          tiles: [],
          createdAt: now,
          due: { 0: now + 600000, 1: now + 600000 },
          status: "consolidating",
          guest: 0,
          required: 100,
          escrow: {},
          hardUntil: now + 600000,
          rollingUntil: now + 600000,
        }),
      ],
    );
    const contribution = {
      ruleVersion: 1,
      key: randomUUID(),
      action: "consolidate",
      target: clusterId,
      amount: 1,
    };
    const paid = await call("/api/game", contribution, peer);
    assert.equal(paid.status, 200);
    assert.equal(paid.data.status, "applied");
    assert.equal(
      (await call("/api/fixture/me", undefined, partner)).data.balance,
      String(BigInt(spentBalance) - 1n),
    );
    assert.equal(
      (await call("/api/game", contribution, peer)).data.status,
      "applied",
      "HTTP command replay cannot spend twice",
    );
    await pool.query(
      "UPDATE r2pl_v2.game_state SET data=jsonb_set(data,'{hardUntil}','0') WHERE campaign_id=$1 AND scope='shared-cluster' AND id=$2",
      [config.campaignId, clusterId],
    );
    await call(
      "/api/game",
      { ruleVersion: 1, key: randomUUID(), action: "running", amount: 1 },
      peer,
    );
    assert.equal(
      (await call("/api/fixture/me", undefined, partner)).data.balance,
      spentBalance,
      "expired consolidation refunds the common school pool",
    );
    assert.equal(
      (await call("/api/fixture/me", undefined, peer)).data.ledgerConserved,
      true,
    );
    // Shared debit serializes across distinct owner sessions, with actor-scoped replay.
    await pool.query(
      "UPDATE r2pl_v2.test_point_pools w SET balance=1,opening_balance=1-COALESCE((SELECT sum(amount) FROM r2pl_v2.test_point_ledger l WHERE l.campaign_id=w.campaign_id AND l.pool_actor_id=w.actor_id),0) WHERE campaign_id=$1 AND school_slot=0",
      [config.campaignId],
    );
    const raceCommands = [oldActor, peerActor].map((actor, i) => ({
      actor,
      key: randomBytes(16),
      tile: (hq.z + 1 + i) * 1000 + hq.x + hq.size,
      hash: createHash("sha256")
        .update((i ? peer : partner).Cookie.split("=")[1]!)
        .digest("hex"),
    }));
    const debits = await Promise.all(
      raceCommands.map((c) =>
        play!.realtime.authority.apply(
          c.actor.actorId,
          0,
          c.key,
          c.tile,
          "explore",
          c.hash,
        ),
      ),
    );
    assert.deepEqual(debits.map((d) => d.result.status).sort(), [
      "rejected",
      "test_applied",
    ]);
    const winner =
      raceCommands[
        debits.findIndex((d) => d.result.status === "test_applied")
      ]!;
    const replayed = await play!.realtime.authority.apply(
      winner.actor.actorId,
      0,
      winner.key,
      winner.tile,
      "explore",
      winner.hash,
    );
    assert.equal(replayed.metrics.replayed, true);
    spentBalance = "0";
    for (const h of [partner, peer]) {
      const me = (await call("/api/fixture/me", undefined, h)).data;
      assert.equal(me.balance, "0");
      assert.equal(me.ledgerConserved, true);
    }
    await pool.query(
      "UPDATE r2pl_v2.test_point_pools SET opening_balance=23,balance=23 WHERE campaign_id=$1 AND school_slot=1",
      [config.campaignId],
    );
    for (const schoolId of [SCHOOLS[1]!.id, SCHOOLS[0]!.id]) {
      const moved = await call("/api/test-profiles/switch", { schoolId }, peer);
      assert.equal(moved.status, 200);
      peer = await headersFor(moved.cookie);
      assert.equal(
        (await call("/api/fixture/me", undefined, peer)).data.balance,
        schoolId === SCHOOLS[1]!.id ? "23" : "0",
      );
    }
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
    assert.equal(
      (await call("/api/game", undefined, peer)).status,
      200,
      "revoking one owner never revokes another owner sharing Points",
    );
    assert.equal(
      (await call("/api/fixture/me", undefined, peer)).data.balance,
      spentBalance,
    );
    assert.equal(
      (await login("other-partner@example.test", password)).Cookie.length > 0,
      true,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM r2pl_v2.test_point_pools WHERE campaign_id=$1",
          [config.campaignId],
        )
      ).rows[0].n,
      8,
    );
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
