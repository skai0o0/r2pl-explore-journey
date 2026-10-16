import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { ColyseusSDK } from "@colyseus/sdk";
import { Pool } from "pg";
import { EditorStore } from "../server/integration/EditorStore.ts";
import {
  type PortalConfig,
  validatePortalConfig,
} from "../server/integration/PortalConfig.ts";
import { portalSignature } from "../server/integration/PortalSignature.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { SignedOperator } from "../server/integration/SignedOperator.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import type { EditorSnapshot } from "../shared/gameplay/editor.ts";
import {
  SCHOOLS,
  STAGING_OBJECTS,
  type WorldObject,
} from "../shared/gameplay/gameConfig.ts";
import {
  AMTECH_ACCOUNTS,
  isAmtechIdentity,
} from "../shared/integration/identity.ts";
import { campaignWeekStart } from "../shared/integration/running.ts";

test("confirmed schools retain all immutable slots; AMTECH accounts never add a competitive school", () => {
  assert.deepEqual(
    SCHOOLS.map((s) => [s.id, s.slot, s.shortName, s.emailDomains[0]]),
    [
      ["hcmut", 0, "HCMUT", "hcmut.edu.vn"],
      ["ou", 1, "OU", "ou.edu.vn"],
      ["dtu", 2, "DTU", "dtu.edu.vn"],
      ["hpuni", 3, "HPUNI", "hpuni.edu.vn"],
      ["hsu", 4, "HSU", "sinhvien.hoasen.edu.vn"],
      ["huce", 5, "HUCE", "st.huce.edu.vn"],
      ["ntu", 6, "NTU", "ntu.edu.vn"],
      ["hcmiu", 7, "HCMIU", "student.hcmiu.edu.vn"],
    ],
  );
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "hq").length, 8);
  assert.equal(AMTECH_ACCOUNTS.length, 12);
  for (const a of AMTECH_ACCOUNTS) {
    assert(isAmtechIdentity(a.email, true));
    assert(!isAmtechIdentity(a.email, false));
  }
  assert(isAmtechIdentity(" MARKETING@AMTECH-VN.COM ", true));
  assert(!isAmtechIdentity("person@amtech.vn.attacker.com", true));
  assert(!isAmtechIdentity("person@other.amtech.vn", true));
  assert(!isAmtechIdentity("outsider@gmail.com", true));
});

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("signed staff provisioning → PKCE admin-only editor → draft/publish/history/concurrency → revoke, without wallets or a ninth HQ", {
  skip: !database,
  timeout: 60000,
}, async () => {
  const target = new URL(database!);
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
      /^r2pl_(prep|bot)_test_/.test(target.pathname.slice(1)),
  );
  const pool = new Pool({ connectionString: database, max: 12 });
  const c: PortalConfig = validatePortalConfig({
    campaignId: randomUUID(),
    mode: "staging",
    publicOrigin: "http://127.0.0.1:4176",
    portalLoginUrl: "http://127.0.0.1:4180/login",
    websocketUrl: "ws://127.0.0.1:2568",
    keys: { test: randomBytes(32).toString("hex") },
    adminKey: randomBytes(32).toString("hex"),
  });
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined,
    origin = "";
  const call = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: c.publicOrigin,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : {},
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  const signed = (operation: string, payload: unknown) => {
    const path = `/api/partner/v1/${operation}`,
      timestamp = String(Date.now()),
      nonce = randomBytes(24).toString("hex"),
      raw = Buffer.from(JSON.stringify(payload));
    return call(path, payload, {
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
  const login = async (id: string) => {
    const codeVerifier = randomBytes(32).toString("base64url"),
      codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
    const launch = await signed("launches", {
      externalStudentId: id,
      codeChallenge,
    });
    assert.equal(launch.status, 200);
    const ticket = new URLSearchParams(
      new URL(launch.body.launchUrl).hash.slice(1),
    ).get("launch");
    const exchange = await call("/api/portal/session", {
      ticket,
      codeVerifier,
    });
    assert.equal(exchange.status, 200);
    const page = await call("/api/fixture/bootstrap", undefined, {
      Cookie: exchange.cookie,
    });
    assert.equal(page.status, 200);
    return {
      page: page.body,
      headers: {
        Cookie: exchange.cookie,
        "X-CSRF-Token": page.body.csrfToken as string,
      },
    };
  };
  try {
    await migratePortalDatabase(pool);
    await migratePortalDatabase(pool);
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      c.campaignId,
      { portal: c },
    );
    origin = `http://127.0.0.1:${play.webPort}`;
    const catalog = (await call("/api/portal/config")).body.schools;
    assert.deepEqual(
      catalog.map((s: { id: string }) => s.id),
      SCHOOLS.map((s) => s.id),
    );
    for (const [schoolId, oldId, slot] of [
      ["ou", "hcmcou", 1],
      ["hpuni", "dhhp", 3],
    ] as const) {
      const member = {
        externalStudentId: `confirmed-${schoolId}`,
        schoolId,
        displayName: schoolId,
        eduVerified: true,
        active: true,
      };
      const provisioned = await signed("members", member);
      assert.equal(provisioned.status, 200);
      assert.equal(provisioned.body.schoolId, schoolId);
      assert.equal(provisioned.body.role, "user");
      assert.equal(
        (await signed("members", { ...member, schoolId: oldId })).status,
        400,
      );
      const session = await login(member.externalStudentId);
      assert.equal(session.page.players[0].schoolName, schoolId.toUpperCase());
      assert.equal(session.page.players[0].slot, slot);
      assert.equal((await signed("members", member)).status, 200);
    }
    const outsider = {
      externalStudentId: "forged-admin",
      schoolId: "amtech",
      displayName: "Outsider",
      active: true,
      eduVerified: true,
    };
    assert.equal((await signed("members", outsider)).status, 403);
    assert.equal(
      (
        await signed("members", {
          ...outsider,
          email: "outsider@gmail.com",
          emailVerified: true,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await signed("members", {
          ...outsider,
          email: AMTECH_ACCOUNTS[0]!.email,
          emailVerified: false,
        })
      ).status,
      403,
    );
    for (const [i, a] of AMTECH_ACCOUNTS.entries()) {
      const r = await signed("members", {
        externalStudentId: `staff-${i}`,
        schoolId: i % 2 ? "amtech" : "hcmut",
        displayName: a.name,
        active: true,
        email: a.email,
        emailVerified: true,
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.role, "admin");
      assert.equal(r.body.schoolId, null);
      assert.equal(r.body.playable, false);
    }
    assert.equal(
      (
        await signed("members", {
          externalStudentId: "staff-domain",
          schoolId: "amtech",
          displayName: "Marketing",
          active: true,
          email: "marketing@amtech-vn.com",
          emailVerified: true,
        })
      ).status,
      200,
    );
    const admin = await login("staff-0");
    assert.equal(admin.page.mode, "admin");
    assert.equal(admin.page.principal.playable, false);
    assert(!("players" in admin.page));
    assert(!("schoolSlot" in admin.page.principal));
    const config = await call("/api/portal/config");
    assert.equal(config.body.schools.length, 8);
    assert.equal(config.body.organizations[0].id, "amtech");
    assert(!JSON.stringify(config.body).includes(AMTECH_ACCOUNTS[0]!.email));
    for (const path of [
      "/api/game",
      "/api/game/tile?index=1",
      "/api/fixture/me",
      "/api/fixture/chests",
    ])
      assert.equal(
        (await call(path, undefined, admin.headers)).status,
        403,
        path,
      );
    assert.equal((await call("/api/game", {}, admin.headers)).status, 403);
    assert.equal(
      (await call("/api/portal/ws-ticket", {}, admin.headers)).status,
      403,
    );
    assert.equal(
      (await signed("accounts", { externalStudentId: "staff-0" })).status,
      403,
    );
    assert.equal(
      (
        await signed("running", {
          externalStudentId: "staff-0",
          revision: "1",
          cumulativeMeters: "1000",
          weeklyMeters: "1000",
          observedAtMs: Date.now(),
          weekStartMs: campaignWeekStart(Date.now()),
        })
      ).status,
      403,
    );
    await assert.rejects(
      new ColyseusSDK(`ws://127.0.0.1:${play.websocketPort}`).joinOrCreate(
        "m2",
        { token: admin.headers.Cookie.split("=")[1] },
      ),
    );
    const player = {
      externalStudentId: "student-1",
      schoolId: "hcmut",
      displayName: "Sinh viên",
      eduVerified: true,
      active: true,
    };
    assert.equal((await signed("members", player)).body.role, "user");
    const user = await login(player.externalStudentId);
    assert.equal(user.page.role, "user");
    for (const path of [
      "/api/admin",
      "/api/admin/editor",
      "/api/admin/gifts",
    ]) {
      assert.equal((await call(path, undefined, user.headers)).status, 403);
      assert.equal(
        (await call(path, undefined, { "X-Admin-Key": c.adminKey })).status,
        403,
      );
    }
    assert.equal(
      (
        await call(
          "/api/admin",
          { action: "notify", title: "x", body: "x" },
          { Cookie: admin.headers.Cookie },
        )
      ).status,
      403,
    );
    let page = (await call("/api/admin/editor", undefined, admin.headers))
      .body as EditorSnapshot;
    assert.equal(page.revision, 0);
    assert.equal(page.objects.filter((o) => o.kind === "hq").length, 8);
    assert.equal(page.draft, null);
    const next: WorldObject[] = [
      ...page.objects,
      {
        id: "chest-marketing",
        kind: "chest",
        tier: "aspire",
        name: "Rương marketing",
        x: 120,
        z: 120,
        width: 2,
        height: 2,
      },
    ];
    // Use the signed config footprint, including future changes.
    const chest = STAGING_OBJECTS.find((o) => o.kind === "chest")!;
    Object.assign(next[next.length - 1]!, {
      width: chest.width,
      height: chest.height,
    });
    const bad = next.map((o) =>
      o.id === "chest-marketing"
        ? { ...o, x: page.objects[0]!.x, z: page.objects[0]!.z }
        : o,
    );
    assert.equal(
      (
        await call(
          "/api/admin/editor/draft",
          { objects: bad, baseRevision: 0, draftRevision: 0 },
          admin.headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/api/admin/editor/draft",
          { objects: next, baseRevision: 0, draftRevision: 0 },
          admin.headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/admin/editor/draft",
          { objects: next, baseRevision: 0, draftRevision: 0 },
          admin.headers,
        )
      ).status,
      409,
    );
    page = (await call("/api/admin/editor", undefined, admin.headers)).body;
    assert.equal(page.objects.length + 1, page.draft!.objects.length);
    assert.equal(
      (
        await call(
          "/api/admin",
          { action: "publish", objects: next, baseRevision: 0 },
          admin.headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/admin",
          { action: "publish", objects: next, baseRevision: 0 },
          admin.headers,
        )
      ).status,
      409,
    );
    page = (await call("/api/admin/editor", undefined, admin.headers)).body;
    assert.equal(page.revision, 1);
    assert.equal(page.history.length, 2);
    assert.equal(
      (
        await call(
          "/api/admin",
          { action: "rollback", baseRevision: 1, targetRevision: 0 },
          admin.headers,
        )
      ).status,
      200,
    );
    page = (await call("/api/admin/editor", undefined, admin.headers)).body;
    assert.equal(page.revision, 2);
    assert(!page.objects.some((o) => o.id === "chest-marketing"));
    assert.equal(
      (
        await call(
          "/api/admin",
          {
            action: "notify",
            title: "Marketing",
            body: "Thông báo thử nghiệm",
          },
          admin.headers,
        )
      ).status,
      200,
    );
    const counts = (
      await pool.query<{ wallets: string; bindings: string; schools: string }>(
        "SELECT (SELECT count(*) FROM r2pl_v2.wallet_accounts w JOIN r2pl_v2.portal_admins a USING(campaign_id,actor_id) WHERE w.campaign_id=$1)::text wallets,(SELECT count(*) FROM r2pl_prep.running_bindings b JOIN r2pl_v2.portal_admins a USING(campaign_id,actor_id) WHERE b.campaign_id=$1)::text bindings,(SELECT count(*) FROM r2pl_v2.campaign_schools WHERE campaign_id=$1)::text schools",
        [c.campaignId],
      )
    ).rows[0]!;
    assert.deepEqual(counts, { wallets: "0", bindings: "0", schools: "8" });
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM r2pl_v2.operator_audit WHERE campaign_id=$1 AND action='notify'",
          [c.campaignId],
        )
      ).rowCount,
      1,
    );
    // A formerly playable account becomes staff atomically, with its wallet history preserved.
    assert.equal(
      (
        await signed("members", {
          ...player,
          email: "former-player@amtech.vn",
          emailVerified: true,
        })
      ).body.role,
      "admin",
    );
    assert.equal(
      (await call("/api/fixture/bootstrap", undefined, user.headers)).status,
      401,
    );
    assert.equal((await signed("members", player)).status, 403);
    // The HTTP identity check may precede body parsing/lock waits. Transactions
    // must independently reject a session that has expired since that check.
    const expiring = await login("staff-0");
    const expiredToken = expiring.headers.Cookie.split("=")[1]!;
    await pool.query(
      "UPDATE r2pl_v2.portal_admin_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE campaign_id=$1 AND token_hash=$2",
      [c.campaignId, createHash("sha256").update(expiredToken).digest()],
    );
    const operator = new SignedOperator(
      pool,
      play.fixture,
      c.adminKey,
      async () => {},
    );
    await assert.rejects(
      operator.apply(
        {
          action: "notify",
          title: "Expired during request",
          body: "must not commit",
        },
        expiring.page.principal.actorId,
        expiredToken,
      ),
      { code: "ADMIN_REQUIRED" },
    );
    await assert.rejects(
      new EditorStore(pool, c.campaignId).save(
        expiring.page.principal.actorId,
        {
          objects: page.objects,
          baseRevision: page.revision,
          draftRevision: 1,
        },
        expiredToken,
      ),
      { code: "ADMIN_REQUIRED" },
    );
    const staff = AMTECH_ACCOUNTS[0]!;
    assert.equal(
      (
        await signed("members", {
          externalStudentId: "staff-0",
          schoolId: "amtech",
          displayName: staff.name,
          active: false,
          email: staff.email,
          emailVerified: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (await call("/api/admin/editor", undefined, admin.headers)).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/admin",
          { action: "notify", title: "revoked", body: "no" },
          admin.headers,
        )
      ).status,
      403,
    );
  } finally {
    await play?.close();
    await pool.end();
  }
});
