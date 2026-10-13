import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { botDatabase } from "../scripts/simulation/config.ts";
import {
  cleanupBotFixture,
  seedBotFixture,
} from "../scripts/simulation/fixture.ts";
import { M35FixtureAuthority } from "../server/persistence/M35FixtureAuthority.ts";
import { OutboxRelay } from "../server/persistence/OutboxRelay.ts";
import { botSchools } from "../shared/simulation/schoolBots.ts";

const url = process.env.R2PL_PREPARATION_DATABASE_URL;
for (const mode of ["publish", "recovery"] as const)
  test(`outbox batch releases pending leases immediately after ${mode} failure`, {
    skip: !url && "Disposable PostgreSQL required",
    timeout: 20000,
  }, async () => {
    const pool = new Pool({ connectionString: botDatabase(url, "1") });
    const campaignId = randomUUID();
    try {
      const schools = botSchools("gather");
      const actors = await seedBotFixture(pool, campaignId, schools, 1, 10);
      const authority = new M35FixtureAuthority(pool, campaignId, 1n);
      for (let i = 0; i < 3; i++) {
        const key = new Uint8Array(16);
        key[0] = i + 1;
        await authority.apply(actors[i]!.actorId, i, key, schools[i]!.home);
      }
      if (mode === "recovery")
        await pool.query(
          "UPDATE r2pl_v2.outbox_events SET payload='{}'::jsonb WHERE campaign_id=$1",
          [campaignId],
        );
      const failure = new Error("Injected publication failure");
      await assert.rejects(
        authority.drain(
          async () => {
            throw failure;
          },
          async () => {
            throw failure;
          },
        ),
        (e) => e === failure,
      );
      const pending = await pool.query<{ n: string; leased: string }>(
        "SELECT count(*)::text AS n,count(*) FILTER(WHERE lease_until IS NOT NULL)::text AS leased FROM r2pl_v2.outbox_events WHERE campaign_id=$1 AND delivered_at IS NULL",
        [campaignId],
      );
      assert.deepEqual(pending.rows[0], { n: "3", leased: "0" });
      let published = 0,
        recovered = 0;
      await authority.drain(
        async () => {
          published++;
        },
        async () => {
          recovered++;
        },
      );
      assert.equal(mode === "publish" ? published : recovered, 3);
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM r2pl_v2.outbox_events WHERE campaign_id=$1 AND delivered_at IS NULL",
            [campaignId],
          )
        ).rowCount,
        0,
      );
    } finally {
      await cleanupBotFixture(pool, campaignId);
      await pool.end();
    }
  });
test("outbox batch cleanup preserves delivered rows and newer lease ownership", {
  skip: !url && "Disposable PostgreSQL required",
  timeout: 20000,
}, async () => {
  const pool = new Pool({ connectionString: botDatabase(url, "1") });
  const campaignId = randomUUID();
  try {
    const schools = botSchools("gather");
    const actors = await seedBotFixture(pool, campaignId, schools, 1, 10);
    const authority = new M35FixtureAuthority(pool, campaignId, 1n);
    for (let i = 0; i < 3; i++) {
      const key = new Uint8Array(16);
      key[0] = i + 1;
      await authority.apply(actors[i]!.actorId, i, key, schools[i]!.home);
    }
    const relay = new OutboxRelay(pool);
    const events = await relay.claim(campaignId);
    await relay.markDelivered(events[0]!.id, events[0]!.leaseToken);
    const replacement = randomUUID();
    await pool.query(
      "UPDATE r2pl_v2.outbox_events SET lease_token=$2 WHERE id=$1",
      [events[1]!.id, replacement],
    );
    await relay.releaseClaim(campaignId, events[0]!.leaseToken);
    const rows = await pool.query<{
      id: string;
      delivered: boolean;
      lease_token: string | null;
    }>(
      "SELECT id::text,(delivered_at IS NOT NULL) AS delivered,lease_token::text FROM r2pl_v2.outbox_events WHERE campaign_id=$1",
      [campaignId],
    );
    assert.equal(
      rows.rows.find((r) => r.id === events[0]!.id)!.delivered,
      true,
    );
    assert.equal(
      rows.rows.find((r) => r.id === events[1]!.id)!.lease_token,
      replacement,
    );
    assert.equal(
      rows.rows.find((r) => r.id === events[2]!.id)!.lease_token,
      null,
    );
  } finally {
    await cleanupBotFixture(pool, campaignId);
    await pool.end();
  }
});
