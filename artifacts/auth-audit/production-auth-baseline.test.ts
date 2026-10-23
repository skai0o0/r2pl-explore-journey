import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { matchMaker } from "@colyseus/core";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { Pool } from "pg";
import { validatePortalConfig } from "../server/integration/PortalConfig.ts";
import { gameCsrf } from "../server/integration/PortalCookies.ts";
import { portalSignature } from "../server/integration/PortalSignature.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { GAME_CONFIG } from "../shared/gameplay/gameConfig.ts";

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("production auth rejects forged clients without DB writes; authentic PKCE and WS play still work", {
  skip: !database,
  timeout: 60000,
}, async () => {
  const url = new URL(database!);
  assert(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname.startsWith("/r2pl_prep_test_"),
  );
  const pool = new Pool({ connectionString: database, max: 12 });
  const config = validatePortalConfig({
    campaignId: randomUUID(),
    mode: "production",
    publicOrigin: "https://game.example.test",
    websocketUrl: "wss://game.example.test",
    portalLoginUrl: "https://event.example.test/login",
    keys: { test: randomBytes(32).toString("hex") },
    adminKey: randomBytes(32).toString("hex"),
  });
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  let room: Room | undefined;
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
    const raw = await response.text();
    return {
      status: response.status,
      data: raw ? JSON.parse(raw) : {},
      cookie: response.headers.get("set-cookie") ?? "",
    };
  };
  const signed = (op: string, body: unknown) => {
    const path = `/api/partner/v1/${op}`,
      timestamp = String(Date.now()),
      nonce = randomBytes(24).toString("hex");
    return call(path, body, {
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
        Buffer.from(JSON.stringify(body)),
      ),
    });
  };
  const fingerprint = async () => {
    const data: unknown[] = [];
    for (const table of [
      "portal_members",
      "portal_admins",
      "portal_sessions",
      "portal_admin_sessions",
      "portal_launches",
      "portal_nonces",
      "wallet_accounts",
      "ledger_entries",
      "command_results",
      "game_events",
      "game_state",
      "game_world_objects",
      "editor_drafts",
      "editor_versions",
      "operator_audit",
    ]) {
      const rows = await pool.query(
        `SELECT to_jsonb(t)::text value FROM r2pl_v2.${table} t WHERE campaign_id=$1 ORDER BY to_jsonb(t)::text`,
        [config.campaignId],
      );
      data.push([table, rows.rows]);
    }
    return JSON.stringify(data);
  };
  try {
    await migratePortalDatabase(pool);
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      config.campaignId,
      { portal: config },
    );
    base = `http://127.0.0.1:${play.webPort}`;
    const before = await fingerprint();
    const fake = "a".repeat(64),
      forged = {
        Cookie: `__Host-r2pl_game=${fake}`,
        "X-CSRF-Token": gameCsrf(fake),
        "X-Admin-Key": config.adminKey,
        Authorization: "Bearer dev-school-0-actor-0",
        "X-Role": "admin",
      };
    for (const headers of [
      {},
      forged,
      { Cookie: `r2pl_game=${fake}` },
      { Cookie: `__Host-r2pl_game=${fake}; __Host-r2pl_game=${fake}` },
    ]) {
      for (const path of [
        "/api/game",
        "/api/fixture/bootstrap",
        "/api/fixture/me",
        "/api/fixture/chests",
        "/api/fixture/receipts",
        "/api/fixture/world",
        "/api/game/tile?index=500500",
        "/api/admin",
        "/api/admin/editor",
        "/api/admin/gifts",
        ])
        assert(
          [401, 403, ...(path === "/api/admin/gift-pool" ? [404] : [])].includes((await call(path, undefined, headers)).status),
          path,
        );
      for (const path of [
        "/api/game",
        "/api/admin",
        "/api/admin/editor/draft",
          "/api/admin/gifts/redeem",
        "/api/portal/ws-ticket",
        "/api/portal/logout",
      ])
        assert(
          [401, 403, ...(path === "/api/admin/gift-pool" ? [404] : [])].includes((await call(path, {}, headers)).status),
          path,
        );
    }
    for (const path of [
      "/api/fixture/bots/start",
      "/api/fixture/bots/stop",
      "/api/fixture/rewards",
    ])
      assert.equal((await call(path, {})).status, 404);
    for (const operation of ["members", "running", "accounts", "launches"])
      assert.equal(
        (
          await call(`/api/partner/v1/${operation}`, {
            role: "admin",
            active: true,
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await call("/api/portal/session", {
          ticket: fake,
          codeVerifier: "a".repeat(43),
        })
      ).status,
      401,
    );
    for (const endpoint of [base, `http://127.0.0.1:${play.websocketPort}`]) {
      const response = await fetch(endpoint + "/matchmake/joinOrCreate/m2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: fake,
          actorId: randomUUID(),
          schoolSlot: 0,
          role: "admin",
        }),
      });
      assert(
        response.status >= 400,
        "invalid auth must fail before seat reservation on either port",
      );
    }
    assert.equal((await call("/matchmake/create/m2", {})).status, 404);
    assert.equal(
      (
        await call(
          "/matchmake/joinOrCreate/m2",
          {},
          { Origin: "https://attacker.example.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/matchmake/joinOrCreate/m2", {
          padding: "a".repeat(GAME_CONFIG.integration.maxBodyBytes),
        })
      ).status,
      413,
    );
    assert.equal((await matchMaker.query({ name: "m2" })).length, 0, "invalid clients must not allocate rooms");
    assert.equal(
      await fingerprint(),
      before,
      "forged requests cannot change campaign records",
    );

    for (const id of ["student-a", "student-b"])
      assert.equal(
        (
          await signed("members", {
            externalStudentId: id,
            schoolId: "hcmut",
            displayName: id,
            active: true,
            eduVerified: true,
          })
        ).status,
        200,
      );
    const verifier = randomBytes(32).toString("base64url");
    const launch = await signed("launches", {
      externalStudentId: "student-a",
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
    });
    const ticket = new URLSearchParams(
      new URL(launch.data.launchUrl).hash.slice(1),
    ).get("launch");
    assert.equal(
      (
        await call("/api/portal/session", {
          ticket,
          codeVerifier: "b".repeat(43),
        })
      ).status,
      401,
    );
    const session = await call("/api/portal/session", {
      ticket,
      codeVerifier: verifier,
    });
    assert.equal(session.status, 200);
    assert(session.cookie.startsWith("__Host-r2pl_game="));
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
      assert(session.cookie.includes(attribute));
    assert.equal(
      (await call("/api/portal/session", { ticket, codeVerifier: verifier }))
        .status,
      401,
    );
    const cookie = session.cookie.split(";")[0]!;
    const bootstrap = await call("/api/fixture/bootstrap", undefined, {
      Cookie: cookie,
    });
    const headers = {
      Cookie: cookie,
      "X-CSRF-Token": bootstrap.data.csrfToken,
    };
    const command = {
      ruleVersion: 1,
      key: randomUUID(),
      action: "running",
      amount: 99999,
    };
    assert.equal(
      (await call("/api/game", command, { Cookie: cookie })).status,
      403,
    );
    assert.equal(
      (
        await call("/api/game", command, {
          ...headers,
          Origin: "https://attacker.example.test",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/game",
          { ...command, actorId: randomUUID(), schoolSlot: 7, balance: 999999 },
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (await call("/api/game", command, headers)).data.status,
      "rejected",
    );
    assert.equal(
      (await signed("accounts", { externalStudentId: "student-a" })).data
        .spendablePoints,
      "0",
    );
    for (const path of [
      "/api/admin",
      "/api/admin/editor/draft",
      "/api/admin/gifts/redeem",
    ])
      assert.equal(
        (await call(path, {}, { ...headers, "X-Admin-Key": config.adminKey }))
          .status,
        path === "/api/admin/gift-pool" ? 404 : 403,
      );
    assert.equal(
      (
        await call("/api/fixture/bootstrap", undefined, {
          Authorization: `Bearer ${cookie.split("=")[1]}`,
        })
      ).status,
      401,
    );
    assert.equal(
      (await call("/api/fixture/world", undefined, headers)).status,
      200,
    );
    const socket = await call("/api/portal/ws-ticket", {}, headers);
    assert.equal(socket.status, 200);
    room = await new ColyseusSDK(`ws://127.0.0.1:${play.webPort}`).joinOrCreate(
      "m2",
      { token: socket.data.ticket },
    );
    await assert.rejects(
      new ColyseusSDK(`ws://127.0.0.1:${play.webPort}`).joinOrCreate("m2", {
        token: socket.data.ticket,
      }),
    );
    const delayedTicket = await call("/api/portal/ws-ticket", {}, headers);
    const delayedSeat = await call("/matchmake/joinOrCreate/m2", {
      token: delayedTicket.data.ticket,
    });
    assert.equal(delayedSeat.status, 200);
    assert.equal((await call("/api/portal/logout", {}, headers)).status, 200);
    await assert.rejects(
      new ColyseusSDK(`ws://127.0.0.1:${play.webPort}`).consumeSeatReservation(
        delayedSeat.data,
      ),
      "a reserved seat cannot outlive logout",
    );
    assert.equal((await call("/api/game", undefined, headers)).status, 401);
    assert.equal(
      (await call("/api/game", { ...command, key: randomUUID() }, headers))
        .status,
      401,
    );
    assert.equal(
      (await call("/api/portal/ws-ticket", {}, headers)).status,
      401,
    );
  } finally {
    await room?.leave();
    await play?.close();
    await pool.end();
  }
});
