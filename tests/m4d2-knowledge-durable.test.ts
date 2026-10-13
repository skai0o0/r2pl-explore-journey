import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Dynamic imports keep a credential-free checkout executable even without pg.
// This suite ONLY connects to explicitly named loopback disposable databases.
test("M4-D2 PostgreSQL durable Knowledge K15-K20 and financial invariants", {
  skip:
    !process.env.R2PL_TEST_DATABASE_URL &&
    "R2PL_TEST_DATABASE_URL absent; no database contacted",
}, async (t) => {
  const { Pool } = await import("pg");
  const { disposableDatabaseUrl, migrateM4D2 } = await import(
    "../scripts/migrate-m4d2.ts"
  );
  const { KnowledgeCaseStoreV1 } = await import(
    "../server/persistence/KnowledgeCaseStoreV1.ts"
  );
  const { IdempotencyConflict, CommittedResultInterrupted } = await import(
    "../server/persistence/M3TestMutation.ts"
  );
  const url = disposableDatabaseUrl(process.env.R2PL_TEST_DATABASE_URL!);
  const pool = new Pool({ connectionString: url, max: 8 });
  t.after(async () => {
    await pool.end();
  });
  // Bootstrap only an empty disposable schema. Never reset/drop existing data.
  const bootstrap = await pool.connect();
  try {
    await bootstrap.query("BEGIN");
    await bootstrap.query("SELECT pg_advisory_xact_lock(2189,3)");
    const exists = await bootstrap.query<{ exists: string | null }>(
      "SELECT to_regclass('r2pl_v2.schema_migrations')::text AS exists",
    );
    if (!exists.rows[0]?.exists) {
      for (const [version, file] of [
        [1, "001_m3_foundation.sql"],
        [2, "002_m35_view_revisions.sql"],
      ] as const) {
        const sql = (
          await readFile(
            new URL(`../database/migrations/${file}`, import.meta.url),
            "utf8",
          )
        ).replace(/\r\n/g, "\n");
        await bootstrap.query(sql);
        await bootstrap.query(
          "INSERT INTO r2pl_v2.schema_migrations(version,sha256) VALUES($1,$2)",
          [version, createHash("sha256").update(sql).digest()],
        );
      }
    }
    await bootstrap.query("COMMIT");
  } catch (error) {
    await bootstrap.query("ROLLBACK");
    throw error;
  } finally {
    bootstrap.release();
  }
  await migrateM4D2(pool);
  await migrateM4D2(pool);
  const campaignId = randomUUID();
  const p1 = randomUUID(),
    p2 = randomUUID(),
    outsider = randomUUID(),
    poor = randomUUID();
  await pool.query(
    "INSERT INTO r2pl_v2.campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
    [campaignId, `m4d2-${campaignId}`],
  );
  for (const actor of [p1, p2, outsider, poor])
    await pool.query(
      "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'points',$3,$3)",
      [campaignId, actor, actor === poor ? "0" : "1000"],
    );
  let now = 1800000000000n;
  let movedPayer: string | undefined;
  const hour = 3600000n;
  const makeStore = () =>
    new KnowledgeCaseStoreV1(pool, {
      developmentOnly: true,
      identity: async (_client, _campaign, actor) => ({
        verified: new Set<string>([p1, p2, outsider, poor]).has(actor),
        schoolSlot: actor === outsider || actor === movedPayer ? 2 : 1,
      }),
      testClock: async () => now,
    });
  let store = makeStore();
  async function open(n: number) {
    const caseId = randomUUID(),
      contestId = randomUUID();
    const input = {
      campaignId,
      caseId,
      contestId,
      schoolSlots: [0, 1] as const,
      tiles: Array.from({ length: n }, (_, tileIndex) => ({
        tileIndex,
        incumbentSchoolSlot: 0,
      })),
      departingSchoolSlot: 0,
    };
    await store.open(input);
    return { caseId, input };
  }
  const command = (
    caseId: string,
    actorId: string,
    requestedPoints: bigint,
    contributionId = randomUUID(),
  ) => ({ campaignId, caseId, actorId, requestedPoints, contributionId });
  async function balances() {
    const result = await pool.query<{ actor_id: string; balance: string }>(
      "SELECT actor_id,balance FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND resource='points'",
      [campaignId],
    );
    return new Map(
      result.rows.map((row) => [row.actor_id, BigInt(row.balance)]),
    );
  }
  async function conservation() {
    const wallets = await pool.query<{
      actor_id: string;
      opening_balance: string;
      balance: string;
    }>(
      "SELECT actor_id,opening_balance,balance FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND resource='points'",
      [campaignId],
    );
    const journal = await pool.query<{ actor_id: string; net: string }>(
      "SELECT p.actor_id,sum(j.amount)::text AS net FROM r2pl_v2.knowledge_journal_v1 j JOIN r2pl_v2.knowledge_contributions_v1 p USING(campaign_id,case_id,contribution_id) WHERE j.campaign_id=$1 GROUP BY p.actor_id",
      [campaignId],
    );
    const nets = new Map(
      journal.rows.map((row) => [row.actor_id, BigInt(row.net)]),
    );
    for (const wallet of wallets.rows) {
      assert(BigInt(wallet.balance) >= 0n);
      assert.equal(
        BigInt(wallet.balance),
        BigInt(wallet.opening_balance) + (nets.get(wallet.actor_id) ?? 0n),
      );
    }
    const cases = await pool.query<{
      case_id: string;
      status: string;
      received_points: string;
    }>(
      "SELECT case_id,status,received_points FROM r2pl_v2.knowledge_cases_v1 WHERE campaign_id=$1",
      [campaignId],
    );
    let heldOrConsumed = 0n;
    for (const row of cases.rows) {
      const receipts = await pool.query<{
        accepted: string;
        refunded: string;
        pending: string;
      }>(
        `SELECT
        coalesce(sum(p.accepted_points),0)::text AS accepted,
        coalesce(sum(CASE WHEN r.completed_at IS NOT NULL THEN p.accepted_points ELSE 0 END),0)::text AS refunded,
        coalesce(sum(CASE WHEN r.contribution_id IS NOT NULL AND r.completed_at IS NULL THEN p.accepted_points ELSE 0 END),0)::text AS pending
        FROM r2pl_v2.knowledge_contributions_v1 p LEFT JOIN r2pl_v2.knowledge_refund_obligations_v1 r USING(campaign_id,case_id,contribution_id)
        WHERE p.campaign_id=$1 AND p.case_id=$2`,
        [campaignId, row.case_id],
      );
      const receipt = receipts.rows[0]!;
      assert.equal(BigInt(receipt.accepted), BigInt(row.received_points));
      const refunds = await pool.query<{ amount: string }>(
        "SELECT coalesce(sum(amount),0)::text AS amount FROM r2pl_v2.knowledge_journal_v1 WHERE campaign_id=$1 AND case_id=$2 AND kind='refund'",
        [campaignId, row.case_id],
      );
      assert.equal(BigInt(refunds.rows[0]!.amount), BigInt(receipt.refunded));
      if (row.status === "failure")
        assert.equal(
          BigInt(receipt.accepted),
          BigInt(receipt.refunded) + BigInt(receipt.pending),
        );
      else assert.equal(BigInt(receipt.refunded) + BigInt(receipt.pending), 0n);
      heldOrConsumed += BigInt(receipt.accepted) - BigInt(receipt.refunded);
    }
    assert.equal(
      wallets.rows.reduce((sum, w) => sum + BigInt(w.balance), 0n) +
        heldOrConsumed,
      wallets.rows.reduce((sum, w) => sum + BigInt(w.opening_balance), 0n),
    );
  }
  await t.test(
    "K17 parallel last-point race, cap, one success effect and nonnegative wallets",
    async () => {
      const { caseId } = await open(1);
      const before = await balances();
      const results = await Promise.all([
        store.contribute(command(caseId, p1, 10n)),
        store.contribute(command(caseId, p2, 10n)),
      ]);
      assert.equal(
        results.reduce((sum, r) => sum + BigInt(r.acceptedPoints), 0n),
        1n,
      );
      assert.equal(
        results.filter((r) => r.reason === "fully_funded").length,
        1,
      );
      const after = await balances();
      assert.equal(
        before.get(p1)! + before.get(p2)! - after.get(p1)! - after.get(p2)!,
        1n,
      );
      await store.expire(campaignId, caseId);
      const effects = await pool.query<{ count: string }>(
        'SELECT count(*)::text FROM r2pl_v2.knowledge_effect_outbox_v1 WHERE campaign_id=$1 AND case_id=$2 AND effects @> \'[{"kind":"consume_escrow"}]\'::jsonb',
        [campaignId, caseId],
      );
      assert.equal(effects.rows[0]?.count, "1");
      await conservation();
    },
  );
  await t.test(
    "outsider, insufficient and empty denied without debit/revision; frozen snapshot",
    async () => {
      const { caseId, input } = await open(7);
      const before = await balances();
      assert.equal(
        (await store.contribute(command(caseId, outsider, 1n))).reason,
        "ineligible_actor",
      );
      assert.equal(
        (await store.contribute(command(caseId, outsider, 1n))).status,
        "unavailable",
      );
      assert.equal(
        (await store.contribute(command(caseId, poor, 1n))).reason,
        "insufficient_wallet",
      );
      assert.equal(
        (await store.contribute(command(caseId, p1, 0n))).reason,
        "empty_contribution",
      );
      assert.equal((await store.open(input)).revision, 1);
      await assert.rejects(
        store.open({ ...input, tiles: input.tiles.slice(1) }),
        IdempotencyConflict,
      );
      await assert.rejects(
        pool.query(
          "UPDATE r2pl_v2.knowledge_cases_v1 SET required_points=99 WHERE campaign_id=$1 AND case_id=$2",
          [campaignId, caseId],
        ),
      );
      assert.deepEqual(await balances(), before);
      now += 2n * hour;
      const result = await store.contribute(command(caseId, p1, 1n));
      assert.equal(result.reason, "expired");
      assert.equal(result.acceptedPoints, "0");
      assert.equal(result.status, "failure");
      assert.deepEqual(await balances(), before);
      await conservation();

      // Both workers start while liabilities exist, rather than only at empty queue.
      const second = await open(20);
      await store.contribute(command(second.caseId, p1, 3n));
      await store.contribute(command(second.caseId, p2, 2n));
      now += 2n * hour;
      await store.expire(campaignId, second.caseId);
      const batches = await Promise.all([
        store.refundBatch(campaignId, 2),
        store.refundBatch(campaignId, 1),
      ]);
      assert.equal(
        batches.reduce((sum, size) => sum + size, 0),
        2,
      );
      assert.deepEqual(await balances(), before);
      await conservation();
    },
  );
  await t.test(
    "K18/K19 original payer 3/2 exact refunds; rollback, one/two batches, ACK loss and concurrent workers",
    async () => {
      const { caseId } = await open(20);
      const before = await balances();
      await store.contribute(command(caseId, p1, 3n));
      await store.contribute(command(caseId, p2, 2n));
      movedPayer = p1; // Refund never depends on the donor's current school.
      now += 2n * hour;
      assert.equal((await store.expire(campaignId, caseId)).status, "failure");
      await store.expire(campaignId, caseId);
      await conservation();
      const debited = await balances();
      assert.equal(before.get(p1)! - debited.get(p1)!, 3n);
      assert.equal(before.get(p2)! - debited.get(p2)!, 2n);
      await assert.rejects(
        store.refundBatch(campaignId, 2, {
          beforeCommit: () => {
            throw new Error("simulated crash before COMMIT");
          },
        }),
      );
      assert.deepEqual(await balances(), debited);
      await conservation();
      assert.equal(await store.refundBatch(campaignId, 1), 1);
      await conservation();
      await assert.rejects(
        store.refundBatch(campaignId, 2, {
          afterCommit: () => {
            throw new Error("lost worker ACK");
          },
        }),
        CommittedResultInterrupted,
      );
      store = makeStore();
      assert.deepEqual(
        await Promise.all([
          store.refundBatch(campaignId, 1),
          store.refundBatch(campaignId, 2),
        ]),
        [0, 0],
      );
      assert.deepEqual(await balances(), before);
      await conservation();
      movedPayer = undefined;
    },
  );
  await t.test(
    "K20 contribution rollback and restart retry after committed ACK loss; payload conflict",
    async () => {
      const { caseId } = await open(7);
      const input = command(caseId, p1, 99n);
      const before = await balances();
      await assert.rejects(
        store.contribute(input, {
          beforeCommit: () => {
            throw new Error("crash");
          },
        }),
      );
      assert.deepEqual(await balances(), before);
      await assert.rejects(
        store.contribute(input, {
          afterCommit: () => {
            throw new Error("ACK lost");
          },
        }),
        CommittedResultInterrupted,
      );
      store = makeStore();
      const result = await store.contribute(input);
      assert.equal(result.acceptedPoints, "4");
      assert.equal(result.status, "success");
      assert.deepEqual(await store.contribute(input), result);
      await assert.rejects(
        store.contribute({ ...input, requestedPoints: 98n }),
        IdempotencyConflict,
      );
      await assert.rejects(
        store.contribute({ ...input, actorId: p2 }),
        IdempotencyConflict,
      );
      assert.equal(before.get(p1)! - (await balances()).get(p1)!, 4n);
      await conservation();
    },
  );
  await t.test(
    "rolling reset, hard equality at 48h and never repriced after t0",
    async () => {
      const { caseId, input } = await open(101);
      const t0 = now;
      for (let h = 1n; h <= 47n; h++) {
        now = t0 + h * hour;
        assert.equal(
          (await store.contribute(command(caseId, p1, 1n))).acceptedPoints,
          "1",
        );
      }
      const rows = await pool.query<{
        hard_deadline_ms: string;
        rolling_deadline_ms: string;
        required_points: string;
      }>(
        "SELECT hard_deadline_ms,rolling_deadline_ms,required_points FROM r2pl_v2.knowledge_cases_v1 WHERE campaign_id=$1 AND case_id=$2",
        [campaignId, caseId],
      );
      assert.equal(BigInt(rows.rows[0]!.hard_deadline_ms), t0 + 48n * hour);
      assert.equal(
        rows.rows[0]!.rolling_deadline_ms,
        rows.rows[0]!.hard_deadline_ms,
      );
      assert.equal(rows.rows[0]!.required_points, "51");
      await store.open(input);
      now = t0 + 48n * hour;
      const before = await balances();
      const result = await store.contribute(command(caseId, p2, 4n));
      assert.equal(result.status, "failure");
      assert.equal(result.acceptedPoints, "0");
      assert.deepEqual(await balances(), before);
      await conservation();
      assert.equal(await store.refundBatch(campaignId, 1), 1);
      await conservation();
      assert.equal(await store.refundBatch(campaignId, 100), 46);
      await conservation();
    },
  );
  await t.test(
    "mixed incumbents retain claimant-owned tiles in failure effects; DB clock persisted",
    async () => {
      const caseId = randomUUID();
      await store.open({
        campaignId,
        caseId,
        contestId: randomUUID(),
        schoolSlots: [0, 1],
        tiles: [
          { tileIndex: 100, incumbentSchoolSlot: 1 },
          { tileIndex: 101, incumbentSchoolSlot: 0 },
        ],
        departingSchoolSlot: 0,
      });
      now += 2n * hour;
      await store.expire(campaignId, caseId);
      const result = await pool.query<{
        effects: {
          kind: string;
          tileIndex?: number;
          ownerSchoolSlot?: number | null;
        }[];
      }>(
        "SELECT effects FROM r2pl_v2.knowledge_effect_outbox_v1 WHERE campaign_id=$1 AND case_id=$2 AND revision=2",
        [campaignId, caseId],
      );
      assert.deepEqual(result.rows[0]!.effects, [
        { kind: "ownership", tileIndex: 101, ownerSchoolSlot: null },
      ]);
      const realClockStore = new KnowledgeCaseStoreV1(pool, {
        developmentOnly: true,
        identity: async () => ({ verified: true, schoolSlot: 1 }),
      });
      const realId = randomUUID();
      await realClockStore.open({
        campaignId,
        caseId: realId,
        contestId: randomUUID(),
        schoolSlots: [0, 1],
        tiles: [{ tileIndex: 200, incumbentSchoolSlot: 0 }],
        departingSchoolSlot: 0,
      });
      const clock = await pool.query<{ valid: boolean }>(
        "SELECT abs(t0_ms-floor(extract(epoch FROM clock_timestamp())*1000))<10000 AND hard_deadline_ms=t0_ms+172800000 AND rolling_deadline_ms=t0_ms+7200000 AS valid FROM r2pl_v2.knowledge_cases_v1 WHERE campaign_id=$1 AND case_id=$2",
        [campaignId, realId],
      );
      assert.equal(clock.rows[0]!.valid, true);
      await conservation();
    },
  );
});
