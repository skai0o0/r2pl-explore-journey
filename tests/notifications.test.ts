import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { R2plPartnerClient } from "../integration/partner-client.mjs";
import { AdminAccessStore } from "../server/integration/AdminAccessStore.ts";
import {
  emitNotification,
  NotificationStore,
} from "../server/integration/NotificationStore.ts";
import { validatePortalConfig } from "../server/integration/PortalConfig.ts";
import { portalSignature } from "../server/integration/PortalSignature.ts";
import { PortalStore } from "../server/integration/PortalStore.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { ACTIVITY_NOTIFICATION_KINDS } from "../shared/integration/notifications.ts";

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
const waitUntil = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++)
    await new Promise((r) => setTimeout(r, 20));
  assert(check(), "bounded asynchronous wait");
};
test("live-only activity stream and durable partner notifications: scope, rollback, dedup, lease, retry and restart", {
  skip: !database,
  timeout: 90000,
}, async () => {
  const url = new URL(database!);
  assert(
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.pathname.startsWith("/r2pl_prep_test_"),
  );
  const pool = new Pool({ connectionString: database, max: 12 }),
    campaign = randomUUID(),
    config = validatePortalConfig({
      campaignId: campaign,
      mode: "production",
      publicOrigin: "https://notifications.example.test",
      portalLoginUrl: "https://event.example.test/login",
      websocketUrl: "wss://notifications.example.test",
      keys: { test: randomBytes(32).toString("hex") },
      adminKey: randomBytes(32).toString("hex"),
    });
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined,
    base = "";
  const aborts: AbortController[] = [];
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
      cookies: r.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
  };
  const signed = async (op: string, input: unknown) => {
    const path = "/api/partner/v1/" + op,
      timestamp = String(Date.now()),
      nonce = randomBytes(24).toString("hex"),
      raw = Buffer.from(JSON.stringify(input));
    return call(path, input, {
      "X-R2PL-Campaign": campaign,
      "X-R2PL-Key-Id": "test",
      "X-R2PL-Timestamp": timestamp,
      "X-R2PL-Nonce": nonce,
      "X-R2PL-Signature": portalSignature(
        config.keys.test!,
        campaign,
        "POST",
        path,
        timestamp,
        nonce,
        raw,
      ),
    });
  };
  const stream = async (cookie: string) => {
    const abort = new AbortController();
    aborts.push(abort);
    const r = await fetch(base + "/api/notifications/live", {
      headers: { Cookie: cookie },
      signal: abort.signal,
    });
    assert.equal(r.status, 200);
    const reader = r.body!.getReader(),
      messages: { id: string; title: string; kind: string }[] = [];
    let closed = false;
    void (async () => {
      let buffer = "";
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          for (
            let split = buffer.indexOf("\n\n");
            split >= 0;
            split = buffer.indexOf("\n\n")
          ) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const data = frame.split("\n").find((l) => l.startsWith("data: "));
            if (data) messages.push(JSON.parse(data.slice(6)));
          }
        }
      } catch {
        /* Expected cancellation. */
      } finally {
        closed = true;
      }
    })();
    return { messages, abort, isClosed: () => closed };
  };
  try {
    await migratePortalDatabase(pool);
    await migratePortalDatabase(pool);
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
      { portal: config },
    );
    base = "http://127.0.0.1:" + play.webPort;
    const access = new AdminAccessStore(pool, campaign),
      portal = new PortalStore(pool, config),
      store = new NotificationStore(pool, campaign),
      password = randomBytes(18).toString("hex");
    await access.provisionRoot(password);
    const nonce = await call("/api/admin-auth/config"),
      login = await call(
        "/api/admin-auth/login",
        { email: "admin@amtech.vn", password },
        { Cookie: nonce.cookies, "X-CSRF-Token": nonce.data.csrfToken },
      );
    assert.equal(login.status, 200);
    const rootBoot = await call(
      "/api/fixture/bootstrap?view=admin",
      undefined,
      { Cookie: login.cookies },
    );
    const root = {
      Cookie: login.cookies,
      "X-CSRF-Token": rootBoot.data.csrfToken,
    };
    const student = async (id: string, schoolId: string) => {
      await portal.upsertMember({
        externalStudentId: id,
        schoolId,
        eduVerified: true,
        displayName: id,
        active: true,
      });
      const verifier = randomBytes(32).toString("base64url"),
        launch = (await portal.launch({
          externalStudentId: id,
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
        token: session.token,
        cookie: "__Host-r2pl_game=" + session.token,
      };
    };
    const a = await student("synthetic-one", "hcmut"),
      b = await student("synthetic-two", "ou");
    assert.equal((await call("/api/notifications/live")).status, 401);
    assert.equal(
      (await call("/api/admin/notifications", undefined, { Cookie: a.cookie }))
        .status,
      401,
    );
    assert.equal(
      (
        await call(
          "/api/admin/notifications",
          { action: "routing", routes: [] },
          root,
        )
      ).status,
      400,
    );
    const off = await call("/api/admin/notifications", undefined, root);
    assert(
      off.data.routes.every(
        (r: { forwardToPortal: boolean }) => !r.forwardToPortal,
      ),
    );
    await store.locked((db) =>
      emitNotification(db, campaign, {
        key: "old",
        kind: "chest_opened",
        title: "Old",
        body: "Offline event",
      }),
    );
    assert.equal(
      (await signed("notifications/pull", {})).data.deliveries.length,
      0,
      "forwarding defaults off",
    );
    const first = await stream(a.cookie),
      second = await stream(b.cookie);
    const cursor = await store.cursor();
    await assert.rejects(() =>
      store.locked(async (db) => {
        await emitNotification(db, campaign, {
          key: "rollback",
          kind: "rally",
          title: "Rollback",
          body: "Never published",
        });
        throw Error("rollback");
      }),
    );
    assert.equal(await store.cursor(), cursor);
    assert.equal(
      (
        await call(
          "/api/admin/notifications",
          {
            action: "routing",
            routes: ACTIVITY_NOTIFICATION_KINDS.map((kind) => ({
              kind,
              forwardToPortal: true,
            })),
          },
          root,
        )
      ).status,
      200,
    );
    await store.locked(async (db) => {
      await emitNotification(db, campaign, {
        key: "rally-1",
        kind: "rally",
        title: "School only",
        body: "School zero",
        schoolSlot: 0,
      });
      await emitNotification(db, campaign, {
        key: "chest-1",
        kind: "chest_opened",
        title: "Everyone",
        body: "Synthetic student opened a chest",
      });
    });
    await waitUntil(
      () => first.messages.length === 2 && second.messages.length === 1,
    );
    assert.deepEqual(
      first.messages.map((m) => m.title),
      ["School only", "Everyone"],
    );
    assert.equal(second.messages[0]!.title, "Everyone");
    assert(!first.messages.some((m) => m.title === "Old"));
    const compose = {
      action: "compose",
      key: randomUUID(),
      schoolId: null,
      title: "Return to play",
      body: "Admin content for event Portal",
    };
    const composed = await call("/api/admin/notifications", compose, root);
    assert.equal(composed.status, 200);
    assert.equal(
      (await call("/api/admin/notifications", compose, root)).data
        .notificationId,
      composed.data.notificationId,
    );
    assert.equal(
      (
        await call(
          "/api/admin/notifications",
          { ...compose, body: "Different" },
          root,
        )
      ).status,
      409,
    );
    const [p1, p2] = await Promise.all([
      signed("notifications/pull", { limit: 50 }),
      signed("notifications/pull", { limit: 50 }),
    ]);
    assert.equal(p1.status, 200);
    assert.equal(p2.status, 200);
    const batch = [...p1.data.deliveries, ...p2.data.deliveries];
    assert.equal(batch.length, 3);
    assert.equal(new Set(batch.map((d) => d.deliveryId)).size, 3);
    assert.deepEqual(
      batch.find((d) => d.notification.kind === "rally").notification.audience,
      { scope: "school", schoolId: "hcmut" },
    );
    assert.equal(
      (
        await signed("notifications/ack", {
          deliveries: [
            {
              deliveryId: batch[0].deliveryId,
              leaseToken: randomUUID(),
              delivered: true,
            },
          ],
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await signed("notifications/ack", {
          deliveries: [
            {
              deliveryId: batch[0].deliveryId,
              leaseToken: batch[0].leaseToken,
              delivered: false,
            },
          ],
        })
      ).status,
      200,
    );
    assert.equal(
      (await signed("notifications/pull", {})).data.deliveries.length,
      0,
    );
    await pool.query(
      "UPDATE r2pl_v2.notification_outbox SET available_at=clock_timestamp()-interval '1 second',lease_until=clock_timestamp()-interval '1 second' WHERE campaign_id=$1 AND status<>'delivered'",
      [campaign],
    );
    const retried = (await signed("notifications/pull", { limit: 50 })).data
      .deliveries;
    assert.equal(retried.length, 3);
    for (const item of retried) {
      assert(batch.some((d) => d.deliveryId === item.deliveryId));
      assert.equal(item.attempt, 2);
    }
    assert.equal(
      (
        await signed("notifications/ack", {
          deliveries: [
            {
              deliveryId: batch[1].deliveryId,
              leaseToken: batch[1].leaseToken,
              delivered: true,
            },
          ],
        })
      ).status,
      409,
      "stale adapter cannot acknowledge a fresh lease",
    );
    const acknowledgements = retried.map(
      (d: { deliveryId: string; leaseToken: string }) => ({
        deliveryId: d.deliveryId,
        leaseToken: d.leaseToken,
        delivered: true,
      }),
    );
    assert.equal(
      (await signed("notifications/ack", { deliveries: acknowledgements }))
        .status,
      200,
    );
    assert.equal(
      (await signed("notifications/ack", { deliveries: acknowledgements }))
        .status,
      200,
    );
    assert.equal(
      first.messages.length,
      2,
      "admin Portal content is not broadcast ingame",
    );
    first.abort.abort();
    second.abort.abort();
    await play.close();
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
      { portal: config },
    );
    base = "http://127.0.0.1:" + play.webPort;
    assert.equal(
      (await signed("notifications/pull", {})).data.deliveries.length,
      0,
    );
    await store.locked((db) =>
      emitNotification(db, campaign, {
        key: "offline-2",
        kind: "station_arrival",
        title: "Before reconnect",
        body: "Do not replay",
      }),
    );
    const after = await stream(a.cookie);
    await store.locked((db) =>
      emitNotification(db, campaign, {
        key: "online-2",
        kind: "station_arrival",
        title: "After reconnect",
        body: "Live",
      }),
    );
    await waitUntil(() => after.messages.length === 1);
    assert.equal(after.messages[0]!.title, "After reconnect");
    await portal.logout(a.token);
    await waitUntil(after.isClosed);
    assert.equal(
      (await call("/api/notifications/live", undefined, { Cookie: a.cookie }))
        .status,
      401,
    );
    const adapter = new R2plPartnerClient({
      origin: base,
      campaignId: campaign,
      keyId: "test",
      secret: config.keys.test!,
    });
    const sdkBatch = await adapter.pullNotifications(20);
    assert.equal(sdkBatch.deliveries.length, 2);
    assert.equal(
      (
        await adapter.acknowledgeNotifications(
          sdkBatch.deliveries.map((d) => ({
            deliveryId: d.deliveryId,
            leaseToken: d.leaseToken,
            delivered: true,
          })),
        )
      ).acknowledged,
      2,
    );
    for (const title of ["Expired", "Attempts exhausted"]) {
      const created = await call(
        "/api/admin/notifications",
        { ...compose, key: randomUUID(), title },
        root,
      );
      assert.equal(created.status, 200);
      await pool.query(
        title === "Expired"
          ? "UPDATE r2pl_v2.notification_outbox SET expires_at=clock_timestamp()-interval '1 second' WHERE event_id=$1"
          : "UPDATE r2pl_v2.notification_outbox SET attempts=8,lease_until=clock_timestamp()-interval '1 second' WHERE event_id=$1",
        [created.data.notificationId],
      );
    }
    assert.equal(
      (await adapter.pullNotifications(20)).deliveries.length,
      0,
      "expired and exhausted deliveries are never leased again",
    );
    assert.equal(
      (await signed("notifications/pull", { limit: 0 })).status,
      400,
    );
    assert.equal(
      (await call("/api/partner/v1/notifications/pull", { limit: 20 })).status,
      401,
      "partner API requires the backend signature",
    );
    const status = await call("/api/admin/notifications", undefined, root);
    assert.equal(status.status, 200);
    assert(
      status.data.counts.some(
        (c: { status: string; count: number }) =>
          c.status === "delivered" && c.count === 5,
      ),
    );
  } finally {
    for (const a of aborts) a.abort();
    await play?.close();
    await pool.end();
  }
});
