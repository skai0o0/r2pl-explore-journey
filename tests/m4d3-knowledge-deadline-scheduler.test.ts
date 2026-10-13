import assert from "node:assert/strict";
import test from "node:test";
import {
  KnowledgeDeadlineSchedulerV1,
  PostgresKnowledgeDueCaseRepositoryV1,
} from "../server/persistence/KnowledgeDeadlineSchedulerV1.ts";

const campaign = "11111111-1111-4111-8111-111111111111";
const caseA = "22222222-2222-4222-8222-222222222222";
const caseB = "33333333-3333-4333-8333-333333333333";

test("M4-D3 due repository uses database clock, strict equality and bounded query", async () => {
  const calls: { sql: string; args: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, args: unknown[]) => {
      calls.push({ sql, args });
      return { rows: [{ case_id: caseA }, { case_id: caseB }] };
    },
  };
  const repo = new PostgresKnowledgeDueCaseRepositoryV1(pool as never);
  assert.deepEqual(await repo.listDue(campaign, 2), [caseA, caseB]);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /clock_timestamp/);
  assert.match(calls[0]!.sql, /<=/);
  assert.match(calls[0]!.sql, /status='claiming'/);
  assert.deepEqual(calls[0]!.args, [campaign, 2]);
});

test("M4-D3 scheduler expires bounded cases, isolates errors and still credits refunds", async () => {
  const called: string[] = [];
  const repo = {
    listDue: async (_campaign: string, limit: number) =>
      [caseA, caseB].slice(0, limit),
  };
  const store = {
    expire: async (_campaign: string, id: string) => {
      called.push(id);
      if (id === caseB) throw Error("transient db error");
    },
    refundBatch: async (_campaign: string, limit: number) => {
      assert.equal(limit, 1);
      return 1;
    },
  };
  const scheduler = new KnowledgeDeadlineSchedulerV1(repo, store, {
    developmentOnly: true,
  });
  const result = await scheduler.tick(campaign, {
    expiryLimit: 2,
    refundLimit: 1,
  });
  assert.deepEqual(called, [caseA, caseB]);
  assert.deepEqual(result, {
    dueCount: 2,
    expiryAttempted: 2,
    expiryFailed: 1,
    refundCount: 1,
    failedCaseIds: [caseB],
  });
});

test("M4-D3 scheduler recovers after restart and only handles cases still due", async () => {
  const due = new Set([caseA]);
  let expired = 0;
  let refunds = 0;
  const repo = { listDue: async () => Array.from(due) };
  const store = {
    expire: async (_campaign: string, id: string) => {
      expired++;
      due.delete(id);
    },
    refundBatch: async () => {
      refunds++;
      return refunds === 2 ? 1 : 0;
    },
  };
  const first = new KnowledgeDeadlineSchedulerV1(repo, store, {
    developmentOnly: true,
  });
  assert.equal((await first.tick(campaign)).dueCount, 1);
  const restarted = new KnowledgeDeadlineSchedulerV1(repo, store, {
    developmentOnly: true,
  });
  assert.equal((await restarted.tick(campaign)).dueCount, 0);
  assert.equal(expired, 1);
  assert.equal(refunds, 2);
});

test("M4-D3 scheduler rejects forged targets and malformed due entries", async () => {
  const repo = { listDue: async () => [caseA, caseA] };
  const store = { expire: async () => undefined, refundBatch: async () => 0 };
  const scheduler = new KnowledgeDeadlineSchedulerV1(repo, store, {
    developmentOnly: true,
  });
  await assert.rejects(() => scheduler.tick("bad"));
  await assert.rejects(() => scheduler.tick(campaign, { expiryLimit: 33 }));
  await assert.rejects(() => scheduler.tick(campaign));
  const tooMany = new KnowledgeDeadlineSchedulerV1(
    { listDue: async () => [caseA, caseB] },
    store,
    { developmentOnly: true },
  );
  await assert.rejects(() => tooMany.tick(campaign, { expiryLimit: 1 }));
});

test("M4-D3 scheduler refuses non-development configuration", () => {
  assert.throws(
    () =>
      new KnowledgeDeadlineSchedulerV1(
        { listDue: async () => [] },
        { expire: async () => undefined, refundBatch: async () => 0 },
        { developmentOnly: false } as never,
      ),
  );
});
