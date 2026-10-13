import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalSharedBillingV1,
  decideUnfundedSharedBoundaryV1,
  KnowledgeSharedUpkeepStoreV1,
} from "../server/persistence/KnowledgeSharedUpkeepStoreV1.ts";
import {
  CommittedResultInterrupted,
  IdempotencyConflict,
} from "../server/persistence/M3TestMutation.ts";
import {
  type BillingSnapshot,
  KNOWLEDGE_CYCLE_MS as DAY,
  type EconomyWorld,
  quoteKnowledgeUpkeepV1,
} from "../shared/gameplay/knowledgeEconomyV1.ts";

function world(
  indices: readonly number[],
  holders: readonly number[] = [0, 1],
): EconomyWorld {
  return {
    width: 5,
    height: 5,
    serverVerified: true,
    tiles: indices.map((tileIndex) => ({ tileIndex, holders })),
  };
}
function snapshot(w = world([0]), periodStart = DAY): BillingSnapshot {
  return canonicalSharedBillingV1({
    billingSnapshotId: "synthetic-cycle",
    sharedActivatedAt: 0,
    periodStart,
    world: w,
  });
}
function quote(
  s: BillingSnapshot,
  now = DAY,
  schoolSlot = 0,
  paidKeys: readonly string[] = [],
) {
  return quoteKnowledgeUpkeepV1({
    snapshot: s,
    now,
    paidKeys,
    actor: {
      actorId: "verified-synthetic",
      schoolSlot,
      serverVerified: true,
      pointsBalance: 10,
    },
  });
}
test("one or five orthogonal tiles: first 24h free, exact due, one Point per school", () => {
  for (const indices of [[0], [0, 1, 2, 3, 4]]) {
    const s = snapshot(world(indices));
    assert.equal(quote(s, 0).reason, "not-due");
    assert.equal(quote(s, DAY - 1).feePoints, 0);
    assert.equal(quote(s, DAY).feePoints, 1);
    assert.equal(quote(s, DAY, 1).feePoints, 1);
    assert.notDeepEqual(quote(s).paymentKeys, quote(s, DAY, 1).paymentKeys);
  }
});
test("diagonal only, row wrap, and AB versus BC remain separate school-pair components", () => {
  assert.equal(quote(snapshot(world([0, 6]))).feePoints, 2);
  assert.equal(quote(snapshot(world([4, 5]))).feePoints, 2);
  const s = snapshot({
    ...world([]),
    tiles: [
      { tileIndex: 0, holders: [0, 1] },
      { tileIndex: 1, holders: [1, 2] },
    ],
  });
  assert.equal(quote(s, DAY, 1).feePoints, 2);
  assert.equal(quote(s).feePoints, 1);
  assert.equal(quote(s, DAY, 2).feePoints, 1);
});
test("canonical stable receipt keys; replay suppresses fees; conflicting keys fail closed", () => {
  const s = snapshot(world([0, 1, 2]));
  const reordered = snapshot(world([2, 0, 1], [1, 0]));
  assert.deepEqual(s, reordered);
  // jsonb changes object property order on read; hashing must remain canonical.
  assert.deepEqual(
    s,
    canonicalSharedBillingV1({
      world: {
        tiles: s.world.tiles,
        serverVerified: true,
        height: 5,
        width: 5,
      },
      periodStart: DAY,
      sharedActivatedAt: 0,
      billingSnapshotId: s.billingSnapshotId,
    }),
  );
  assert(Object.isFrozen(s.world.tiles));
  const keys = quote(s).paymentKeys;
  assert.deepEqual(keys, quote(reordered).paymentKeys);
  assert.equal(quote(s, DAY, 0, keys).feePoints, 0);
  assert.equal(quote(s, DAY, 0, [...keys, ...keys]).reason, "invalid");
  assert.equal(quote(snapshot(world([0, 2])), DAY, 0, keys).reason, "invalid");
  assert.equal(
    quote(snapshot(world([0, 1, 2]), 2 * DAY), 2 * DAY, 0, keys).reason,
    "invalid",
  );
});
test("legitimate participant only; malformed or unverified snapshots rejected", () => {
  const s = snapshot();
  assert.equal(quote(s, DAY, 2).feePoints, 0);
  assert.equal(quote(s, DAY, 16).reason, "invalid");
  for (const w of [
    world([25]),
    world([0, 0]),
    world([0], [0, 1, 2]),
    { ...world([0]), serverVerified: false },
  ])
    assert.throws(() => snapshot(w));
  assert.throws(() => snapshot(world([0]), DAY + 1));
  assert.equal(quote({ ...s, periodStart: 0 }).reason, "invalid");
});
test("unfunded equality and later boundaries require operator review, never departure", () => {
  assert.equal(decideUnfundedSharedBoundaryV1(DAY, DAY - 1, false), "not-due");
  assert.equal(
    decideUnfundedSharedBoundaryV1(DAY, DAY, false),
    "pending-operator-review",
  );
  assert.equal(
    decideUnfundedSharedBoundaryV1(DAY, 100 * DAY, false),
    "pending-operator-review",
  );
  assert.equal(decideUnfundedSharedBoundaryV1(DAY, DAY, true), "funded");
  assert.throws(() => decideUnfundedSharedBoundaryV1(DAY, NaN, false));
});
test("frozen period merge/split only affects next cycle", () => {
  const input = {
    ...world([0, 2]),
    tiles: [
      { tileIndex: 0, holders: [0, 1] },
      { tileIndex: 2, holders: [0, 1] },
    ],
  };
  const first = snapshot(input);
  input.tiles.push({ tileIndex: 1, holders: [0, 1] });
  assert.equal(quote(first).feePoints, 2);
  const next = snapshot(input, 2 * DAY);
  assert.equal(quote(next, 2 * DAY).feePoints, 1);
  input.tiles.pop();
  assert.equal(quote(next, 2 * DAY).feePoints, 1);
  assert.equal(quote(snapshot(input, 3 * DAY), 3 * DAY).feePoints, 2);
});

// This suite NEVER applies migrations, including on approved QA cloud. Owner
// must separately provision 005. Verify all five immutable checksums before writes.
// No URL means no pg import, no connection and no database checks claimed.
test("QA PostgreSQL durable shared upkeep atomicity, authorization and replay", {
  skip:
    !process.env.R2PL_TEST_DATABASE_URL &&
    "R2PL_TEST_DATABASE_URL absent; database checks not run",
}, async (t) => {
  const { Pool } = await import("pg");
  const { disposableDatabaseUrl } = await import("../scripts/migrate-m4d2.ts");
  const connectionString = disposableDatabaseUrl(
    process.env.R2PL_TEST_DATABASE_URL!,
  );
  const pool = new Pool({ connectionString, max: 4 });
  let cleanupCampaign: () => Promise<void> = async () => {};
  t.after(async () => {
    try {
      await cleanupCampaign();
    } finally {
      await pool.end();
    }
  });
  for (const [version, file] of [
    [1, "001_m3_foundation.sql"],
    [2, "002_m35_view_revisions.sql"],
    [3, "003_m4d2_knowledge_durable.sql"],
    [4, "004_m4d3_knowledge_projection.sql"],
    [5, "005_m4d3b_shared_upkeep.sql"],
  ] as const) {
    const sql = (
      await readFile(
        new URL(`../database/migrations/${file}`, import.meta.url),
        "utf8",
      )
    ).replace(/\r\n/g, "\n");
    const prior = await pool.query<{ sha256: Buffer }>(
      "SELECT sha256 FROM r2pl_v2.schema_migrations WHERE version=$1",
      [version],
    );
    assert(
      prior.rows[0]?.sha256.equals(createHash("sha256").update(sql).digest()),
      `Migration ${version} must be separately provisioned with exact checksum; suite never applies SQL`,
    );
  }
  const campaignId = randomUUID(),
    cohortId = randomUUID();
  const a = randomUUID(),
    b = randomUUID(),
    poor = randomUUID(),
    outsider = randomUUID(),
    unverified = randomUUID();
  const base = 1800000000000;
  let now = base;
  const initial = world([0, 1, 2, 6]); // tile 1 is a solo-owned bridge, not shared yet
  const split = {
    ...initial,
    tiles: initial.tiles.map((tile) =>
      tile.tileIndex === 1 ? { ...tile, holders: [0] } : tile,
    ),
  };
  const history = new Map<number, EconomyWorld>([
    [base, split],
    [base + DAY, split],
    [base + 2 * DAY, initial],
    [base + 3 * DAY, split],
  ]);
  let schoolOverride: number | undefined;
  const makeStore = () =>
    new KnowledgeSharedUpkeepStoreV1<string>(pool, {
      qaOnly: true,
      identity: async (_client, campaign, session) => ({
        actorId: session,
        schoolSlot:
          schoolOverride ?? (session === outsider ? 2 : session === b ? 1 : 0),
        verified:
          campaign === campaignId &&
          session !== unverified &&
          new Set<string>([a, b, poor, outsider, unverified]).has(session),
      }),
      topology: async (_client, campaign, cohort, asOfMs) => {
        const w = history.get(asOfMs);
        return campaign === campaignId && cohort === cohortId && w
          ? { asOfMs, world: w }
          : null;
      },
      testClock: () => now,
    });
  let store = makeStore();
  const request = (commandKey = randomUUID(), periodStart = base + DAY) => ({
    campaignId,
    cohortId,
    periodStart,
    commandKey,
    optIn: true as const,
  });
  await pool.query(
    "INSERT INTO r2pl_v2.campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
    [campaignId, `m4d3b-test-${campaignId}`],
  );
  cleanupCampaign = async () => {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query("SET LOCAL r2pl_v2.synthetic_cleanup='on'");
      for (const table of [
        "knowledge_shared_outbox_v1",
        "knowledge_shared_journal_v1",
        "knowledge_shared_receipts_v1",
        "knowledge_shared_requests_v1",
        "knowledge_shared_snapshots_v1",
        "knowledge_shared_activations_v1",
        "wallet_accounts",
        "campaign_schools",
        "campaigns",
      ])
        await cleanup.query(
          `DELETE FROM r2pl_v2.${table} WHERE ${table === "campaigns" ? "id" : "campaign_id"}=$1`,
          [campaignId],
        );
      await cleanup.query("COMMIT");
    } catch (error) {
      await cleanup.query("ROLLBACK");
      throw error;
    } finally {
      cleanup.release();
    }
  };
  for (const slot of [0, 1, 2])
    await pool.query(
      "INSERT INTO r2pl_v2.campaign_schools(campaign_id,school_id,slot) VALUES($1,$2,$3)",
      [campaignId, `synthetic-${slot}`, slot],
    );
  for (const actor of [a, b, poor, outsider, unverified])
    await pool.query(
      "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'points',$3,$3)",
      [campaignId, actor, actor === poor ? 1 : 20],
    );
  async function balances() {
    const result = await pool.query<{ actor_id: string; balance: string }>(
      "SELECT actor_id,balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1",
      [campaignId],
    );
    return new Map(result.rows.map((r) => [r.actor_id, Number(r.balance)]));
  }
  async function count(table: string) {
    const result = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM r2pl_v2.${table} WHERE campaign_id=$1`,
      [campaignId],
    );
    return Number(result.rows[0]!.n);
  }
  await t.test(
    "server t0, free first day, verified exact-boundary import",
    async () => {
      assert.equal(await store.activate(campaignId, cohortId), base);
      assert.equal(await store.activate(campaignId, cohortId), base);
      await assert.rejects(
        store.freezePeriod(campaignId, cohortId, base + DAY),
        /Boundary not reached/,
      );
      await assert.rejects(
        store.freezePeriod(campaignId, cohortId, base),
        /Invalid authoritative billing snapshot/,
      );
      assert.equal(await count("knowledge_shared_snapshots_v1"), 0);
      now = base + DAY;
      history.delete(now);
      await assert.rejects(
        store.freezePeriod(campaignId, cohortId, now),
        /topology unavailable/,
      );
      history.set(now, { ...split, serverVerified: false });
      await assert.rejects(
        store.freezePeriod(campaignId, cohortId, now),
        /Invalid authoritative billing snapshot/,
      );
      history.set(now, world([0], [0, 3]));
      await assert.rejects(
        store.freezePeriod(campaignId, cohortId, now),
        /Unregistered topology school/,
      );
      history.set(now, split);
      assert.equal(await count("knowledge_shared_snapshots_v1"), 0);
      const frozen = await store.freezePeriod(campaignId, cohortId, now);
      assert.equal(quote(frozen, now).feePoints, 3); // [0], [2], [6] are separate.
    },
  );
  await t.test(
    "membership, explicit opt-in, insufficient funds, no unauthorized debit",
    async () => {
      const before = await balances();
      await assert.rejects(store.pay(outsider, request()), /participant/);
      await assert.rejects(store.pay(unverified, request()), /participant/);
      await assert.rejects(
        store.pay(a, { ...request(), optIn: false } as unknown as ReturnType<
          typeof request
        >),
        /opt-in/,
      );
      const noFunds = await store.pay(poor, request());
      assert.equal(noFunds.reason, "no-funds");
      assert.equal(noFunds.chargedPoints, 0);
      assert.deepEqual(await balances(), before);
      assert.equal(await count("knowledge_shared_receipts_v1"), 0);
    },
  );
  await t.test(
    "atomic multi-component debit and receipt rollback then retry",
    async () => {
      const req = request();
      const before = await balances();
      await assert.rejects(
        store.pay(a, req, {
          beforeCommit: () => {
            throw new Error("injected rollback");
          },
        }),
        /injected rollback/,
      );
      assert.deepEqual(await balances(), before);
      assert.equal(await count("knowledge_shared_receipts_v1"), 0);
      store = makeStore();
      const paid = await store.pay(a, req);
      assert.equal(paid.status, "paid");
      assert.equal(paid.chargedPoints, 3);
      assert.equal((await balances()).get(a), 17);
      assert.equal(await count("knowledge_shared_receipts_v1"), 3);
      assert.equal(await count("knowledge_shared_journal_v1"), 1);
      assert.equal(await count("knowledge_shared_outbox_v1"), 1);
      assert.deepEqual(await store.pay(a, req), paid);
      schoolOverride = 1;
      await assert.rejects(store.pay(a, req), IdempotencyConflict);
      schoolOverride = undefined;
      await assert.rejects(
        store.pay(a, { ...req, periodStart: base + 2 * DAY }),
        IdempotencyConflict,
      );
    },
  );
  await t.test(
    "concurrent duplicate and competing school payers cannot double debit",
    async () => {
      const req = request();
      const result = await Promise.all([
        store.pay(b, req),
        makeStore().pay(b, req),
        store.pay(b, request()),
      ]);
      assert.equal(result[0]!.chargedPoints + result[2]!.chargedPoints, 3);
      assert.deepEqual(result[0], result[1]);
      assert.equal((await balances()).get(b), 17);
      assert.equal(await count("knowledge_shared_receipts_v1"), 6);
      assert.equal(await count("knowledge_shared_journal_v1"), 2);
    },
  );
  await t.test(
    "immutable receipts and snapshot, unique school/component/cycle",
    async () => {
      for (const table of [
        "knowledge_shared_activations_v1",
        "knowledge_shared_snapshots_v1",
        "knowledge_shared_receipts_v1",
        "knowledge_shared_journal_v1",
        "knowledge_shared_outbox_v1",
      ]) {
        await assert.rejects(
          pool.query(`DELETE FROM r2pl_v2.${table} WHERE campaign_id=$1`, [
            campaignId,
          ]),
          /Immutable/,
        );
      }
      await assert.rejects(
        pool.query(
          "UPDATE r2pl_v2.knowledge_shared_snapshots_v1 SET snapshot=snapshot WHERE campaign_id=$1",
          [campaignId],
        ),
        /Immutable/,
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO r2pl_v2.knowledge_shared_receipts_v1 SELECT * FROM r2pl_v2.knowledge_shared_receipts_v1 WHERE campaign_id=$1 LIMIT 1",
          [campaignId],
        ),
        /duplicate key/,
      );
      const rls = await pool.query<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='r2pl_v2' AND c.relname LIKE 'knowledge_shared_%' AND c.relkind='r'",
      );
      assert.equal(rls.rowCount, 6);
      assert(rls.rows.every((r) => r.relrowsecurity));
    },
  );
  await t.test(
    "next-cycle merge/split; commit ACK loss retry; expired unfunded is review",
    async () => {
      // Modify trusted adapter data midcycle; stored geometry cannot change.
      history.set(base + DAY, initial);
      assert.equal(
        quote(
          await store.freezePeriod(campaignId, cohortId, base + DAY),
          base + DAY,
        ).feePoints,
        3,
      );
      now = base + 2 * DAY;
      const merged = await store.freezePeriod(campaignId, cohortId, now);
      assert.equal(quote(merged, now).feePoints, 1); // Bridge 1 joins 0, 2 and 6.
      const req = request(randomUUID(), now);
      await assert.rejects(
        store.pay(a, req, {
          afterCommit: () => {
            throw new Error("lost ack");
          },
        }),
        CommittedResultInterrupted,
      );
      const replay = await makeStore().pay(a, req);
      assert.equal(replay.chargedPoints, 1);
      assert.equal((await balances()).get(a), 16);
      now = base + 3 * DAY;
      assert.equal(
        (await store.pay(poor, request(randomUUID(), base + 2 * DAY))).reason,
        "pending-operator-review",
      );
      const splitAgain = await store.freezePeriod(campaignId, cohortId, now);
      assert.equal(quote(splitAgain, now).feePoints, 3);
      assert.equal(
        (await store.pay(a, request(randomUUID(), now))).chargedPoints,
        3,
      );
      assert.equal((await balances()).get(a), 13);
      const sum = await pool.query<{ amount: string }>(
        "SELECT sum(amount)::text AS amount FROM r2pl_v2.knowledge_shared_journal_v1 WHERE campaign_id=$1",
        [campaignId],
      );
      assert.equal(Number(sum.rows[0]!.amount), -10);
      assert.equal(await count("knowledge_shared_receipts_v1"), 10);
      assert.equal(await count("knowledge_shared_outbox_v1"), 4);
    },
  );
});
