import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { Pool } from "pg";
import { cleanupBotFixture } from "../scripts/simulation/fixture.ts";
import { HttpCampaignProvider } from "../server/integration/HttpCampaignProvider.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { cleanupSchoolRewards } from "../server/integration/SchoolRewardFixture.ts";
import { campaignWeekStart } from "../shared/integration/running.ts";

test("HTTP provider verifies session, validates running payload, and fails closed", async () => {
  let mode = "valid";
  const api = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-secret");
    const now = Date.now();
    if (req.url === "/v1/sessions/verify") {
      let body = "";
      for await (const part of req) body += part;
      assert.equal(JSON.parse(body).credential, "opaque-session");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          provider: "http-campaign",
          externalStudentId: "student-1",
          externalSchoolId: "school-1",
          sessionExpiresAtMs: mode === "expired" ? now - 1 : now + 60000,
        }),
      );
    } else if (mode === "failure") res.writeHead(503).end();
    else
      res.end(
        JSON.stringify({
          provider: "http-campaign",
          externalStudentId: mode === "mismatch" ? "other" : "student-1",
          revision: "1",
          cumulativeMeters: "1500",
          weeklyMeters: "1500",
          observedAtMs: now,
          weekStartMs: campaignWeekStart(now),
        }),
      );
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  try {
    const provider = new HttpCampaignProvider(
      `http://127.0.0.1:${address.port}/v1`,
      "test-secret",
    );
    assert.equal(
      (await provider.verifySession("opaque-session")).externalStudentId,
      "student-1",
    );
    assert.ok(await provider.fetchRunningSnapshot("student-1"));
    mode = "mismatch";
    await assert.rejects(provider.fetchRunningSnapshot("student-1"));
    mode = "failure";
    await assert.rejects(provider.fetchRunningSnapshot("student-1"));
    mode = "expired";
    await assert.rejects(provider.verifySession("opaque-session"));
    assert.throws(
      () => new HttpCampaignProvider("http://remote.invalid", "secret"),
    );
    assert.throws(
      () => new HttpCampaignProvider("https://example.invalid", ""),
    );
  } finally {
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("mounted HTTP running sync credits verified meters once and rejects identity/revision forgery", {
  skip: !process.env.R2PL_PREPARATION_DATABASE_URL,
}, async () => {
  const pool = new Pool({
    connectionString: process.env.R2PL_PREPARATION_DATABASE_URL,
  });
  const campaign = randomUUID();
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  let revision = "1",
    meters = "1000",
    wrongSchool = false;
  const api = createServer(async (req, res) => {
    const actor = play!.fixture.actors[0]!,
      now = Date.now();
    assert.equal(req.headers.authorization, "Bearer local-test-secret");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/sessions/verify")
      res.end(
        JSON.stringify({
          provider: "http-campaign",
          externalStudentId: actor.actorId,
          externalSchoolId: wrongSchool
            ? "wrong"
            : play!.fixture.schools[0]!.fixtureId,
          sessionExpiresAtMs: now + 60000,
        }),
      );
    else
      res.end(
        JSON.stringify({
          provider: "http-campaign",
          externalStudentId: actor.actorId,
          revision,
          cumulativeMeters: meters,
          weeklyMeters: meters,
          observedAtMs: now,
          weekStartMs: campaignWeekStart(now),
        }),
      );
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  try {
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
      {
        campaignProvider: new HttpCampaignProvider(
          `http://127.0.0.1:${address.port}`,
          "local-test-secret",
        ),
      },
    );
    const actor = play.fixture.actors[0]!,
      base = `http://127.0.0.1:${play.webPort}`,
      headers = {
        Authorization: `Bearer ${actor.token}`,
        "Content-Type": "application/json",
      };
    const sync = async () => {
      const res = await fetch(`${base}/api/game`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ruleVersion: 1,
          key: randomUUID(),
          action: "running",
          amount: 100000,
        }),
      });
      assert.equal(res.status, 200);
      return res.json() as Promise<{ status: string; reason: string }>;
    };
    assert.equal((await sync()).status, "applied");
    assert.equal((await sync()).status, "applied");
    assert.equal(
      (
        await pool.query(
          "SELECT balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
          [campaign, actor.actorId],
        )
      ).rows[0].balance,
      "1010",
    );
    revision = "2";
    meters = "2500";
    assert.equal((await sync()).status, "applied");
    revision = "1";
    assert.equal((await sync()).reason, "STALE_RUNNING_SNAPSHOT");
    wrongSchool = true;
    assert.equal((await sync()).reason, "CAMPAIGN_IDENTITY_MISMATCH");
    const view = (await (
      await fetch(`${base}/api/game`, { headers })
    ).json()) as { runningMode: string; weeklyKm: number };
    assert.equal(view.runningMode, "http");
    assert.equal(view.weeklyKm, 2.5);
    assert.equal(
      (
        await pool.query(
          "SELECT balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
          [campaign, actor.actorId],
        )
      ).rows[0].balance,
      "1025",
    );
  } finally {
    await play?.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});
