import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Pool } from "pg";
import {
  type ExploreReceiptV1,
  KnowledgeExploreQaV1,
} from "../server/gameplay/KnowledgeExploreQaV1.ts";
import { IdempotencyConflict } from "../server/persistence/M3TestMutation.ts";
import {
  createKnowledgeQaServer,
  createPostgresKnowledgeQa,
  type QaBackendV1,
  type QaStateV1,
  qaDatabaseUrl,
} from "../server/qa/KnowledgeQaGatewayV1.ts";

test("PostgreSQL selected Knowledge explore: atomic action, retry and forged school", {
  skip: !process.env.R2PL_TEST_DATABASE_URL && "Disposable database URL absent",
}, async (t) => {
  const env = { ...process.env, R2PL_M4FINAL_EXPLORE_QA: "1" };
  // Exact existing guard, including development opt-in and CA, before any SQL.
  const pool = new Pool({
    connectionString: qaDatabaseUrl(env),
    options: "-c search_path=r2pl_v2,pg_catalog",
  });
  t.after(() => pool.end());
  // Validate installed prerequisites using the existing gateway before migration 6.
  const prerequisite = await createPostgresKnowledgeQa({
    ...env,
    R2PL_M4FINAL_EXPLORE_QA: "0",
  });
  await prerequisite.close();
  for (const [version, file] of [
    [6, "006_m4final_explore_qa.sql"],
    [7, "007_m4_selected_qa_explore.sql"],
  ] as const) {
    const sql = (
      await readFile(
        new URL(`../database/migrations/${file}`, import.meta.url),
        "utf8",
      )
    ).replace(/\r\n/g, "\n");
    const hash = createHash("sha256").update(sql).digest();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(2189,3)");
      const prior = await client.query<{ sha256: Buffer }>(
        "SELECT sha256 FROM schema_migrations WHERE version=$1",
        [version],
      );
      if (prior.rows[0]) assert(prior.rows[0].sha256.equals(hash));
      else {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(version,sha256) VALUES($1,$2)",
          [version, hash],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const runtime = await createPostgresKnowledgeQa(env);
  t.after(() => runtime.close());
  const server = createKnowledgeQaServer(runtime.backend, "dist/knowledge-qa");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const actor = runtime.backend.fixtures[0]!;
  const other = runtime.backend.fixtures[1]!;
  const commandId = randomUUID();
  const call = (input: unknown) =>
    fetch(`${base}/api/qa/knowledge/explore`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-qa-token": actor.token,
      },
      body: JSON.stringify(input),
    });
  assert.equal((await call({ commandId, schoolSlot: 1 })).status, 400);
  assert.equal((await call({ commandId, actorId: other.actorId })).status, 400);
  for (const tileIndex of [-1, 1000000, 0.5, "1", null])
    assert.equal((await call({ commandId, tileIndex })).status, 400);
  const replies = await Promise.all([
    call({ commandId, tileIndex: 0 }),
    call({ commandId, tileIndex: 0 }),
  ]);
  assert(replies.every((reply) => reply.status === 200));
  const values = await Promise.all(
    replies.map(
      async (reply) =>
        (await reply.json()) as { receipt: ExploreReceiptV1; state: QaStateV1 },
    ),
  );
  assert.deepEqual(values[0]!.receipt, {
    kind: "apply",
    reason: "owned",
    spentPoints: "1",
    tileIndex: 0,
  });
  assert.deepEqual(values[1]!.receipt, values[0]!.receipt);
  assert.equal(values[0]!.state.walletPoints, "49");
  assert.deepEqual(values[0]!.state.tiles, [
    { tileIndex: 0, schoolSlots: [0] },
  ]);
  assert.equal(
    values[0]!.state.scores.find((s) => s.schoolSlot === 0)?.score,
    "1",
  );
  assert.deepEqual((await runtime.backend.state(other)).tiles, []);
  assert.equal((await runtime.backend.state(other)).walletPoints, "50");
  await assert.rejects(() =>
    runtime.backend.explore!({ ...actor, schoolSlot: 1 }, randomUUID()),
  );
  const durable = await pool.query<{
    balance: string;
    ledger: string;
    events: string;
    receipts: string;
  }>(
    "SELECT balance::text,(SELECT count(*)::text FROM ledger_entries WHERE campaign_id=$1) ledger,(SELECT count(*)::text FROM knowledge_explore_outbox_qa_v1 WHERE campaign_id=$1) events,(SELECT count(*)::text FROM command_results WHERE campaign_id=$1) receipts FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='points'",
    [values[0]!.state.campaignId, actor.actorId],
  );
  assert.deepEqual(durable.rows[0], {
    balance: "49",
    ledger: "1",
    events: "1",
    receipts: "1",
  });
  // Inject failure through the connection seam, without changing database schema.
  const failingPool = {
    connect: async () => {
      const connection = await pool.connect();
      return {
        query: (sql: string, args?: unknown[]) => {
          if (sql.startsWith("INSERT INTO knowledge_explore_outbox"))
            throw new Error("synthetic outbox failure");
          return connection.query(sql, args);
        },
        release: () => connection.release(),
      };
    },
  } as unknown as Pool;
  const interruptedId = randomUUID();
  const failingExplore = new KnowledgeExploreQaV1(
    failingPool,
    values[0]!.state.campaignId,
    runtime.backend.fixtures,
  );
  await assert.rejects(
    () => failingExplore.execute(actor, interruptedId, 123456),
    /synthetic outbox failure/,
  );
  const rolledBack = await pool.query(
    "SELECT balance::text,(SELECT count(*)::text FROM ledger_entries WHERE campaign_id=$1) ledger,(SELECT count(*)::text FROM knowledge_explore_outbox_qa_v1 WHERE campaign_id=$1) events,(SELECT count(*)::text FROM command_results WHERE campaign_id=$1) receipts FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='points'",
    [values[0]!.state.campaignId, actor.actorId],
  );
  assert.deepEqual(rolledBack.rows, durable.rows);
  assert.deepEqual(
    (await runtime.backend.state(actor)).tiles,
    values[0]!.state.tiles,
  );
  assert.equal(
    (await runtime.backend.state(actor)).scores.find((s) => s.schoolSlot === 0)
      ?.score,
    "1",
  );
  assert.equal((await call({ commandId, tileIndex: 1 })).status, 409);
  const race = await Promise.all([
    runtime.backend.explore!(actor, randomUUID(), 999999),
    runtime.backend.explore!(other, randomUUID(), 999999),
  ]);
  assert.equal(race.filter((r) => r.kind === "apply").length, 1);
  assert.equal(race.filter((r) => r.kind === "reject").length, 1);
  const legacy = await runtime.backend.explore!(actor, randomUUID());
  assert.equal(legacy.kind, "reject");
  await runtime.backend.start();
  const campaignId = values[0]!.state.campaignId;
  const snapshots = await pool.query<{ tile: number }>(
    "SELECT (t->>'tileIndex')::integer tile FROM knowledge_cases_v1 c, jsonb_array_elements(c.snapshot->'tiles') t WHERE campaign_id=$1",
    [campaignId],
  );
  const before = await runtime.backend.state(actor);
  assert(before.projectionPending);
  for (const row of snapshots.rows)
    assert.equal(
      (await runtime.backend.explore!(actor, randomUUID(), row.tile)).kind,
      "reject",
    );
  assert.equal(
    (await runtime.backend.state(actor)).walletPoints,
    before.walletPoints,
  );
  const bytes = await pool.query<{
    command_key: Buffer;
    payload_hash: Buffer;
    amount: string;
    tile_index: number;
  }>(
    "SELECT r.command_key,r.payload_hash,l.amount::text,o.tile_index FROM command_results r JOIN ledger_entries l USING(campaign_id,actor_id,command_key) JOIN knowledge_explore_outbox_qa_v1 o USING(campaign_id,actor_id,command_key) WHERE r.campaign_id=$1 AND r.actor_id=$2 AND r.command_key=$3",
    [
      campaignId,
      actor.actorId,
      Buffer.from(commandId.replaceAll("-", ""), "hex"),
    ],
  );
  assert.equal(bytes.rows[0]!.amount, "-1");
  assert.equal(bytes.rows[0]!.tile_index, 0);
  assert(
    bytes.rows[0]!.payload_hash.equals(
      createHash("sha256").update("knowledge-explore-qa-v1:0:0:1").digest(),
    ),
  );
});

test("selected explore HTTP validates optional tile and preserves legacy fixture API", async (t) => {
  const fixture = {
    token: randomUUID(),
    actorId: randomUUID(),
    label: "Synthetic",
    schoolSlot: 0,
  };
  const calls: (number | undefined)[] = [];
  const backend: QaBackendV1 = {
    fixtures: [fixture],
    state: async () => ({
      campaignId: randomUUID(),
      viewer: fixture,
      walletPoints: "50",
      case: null,
      tiles: [],
      scores: [],
      projectionPending: false,
      updatedAtMs: 1,
    }),
    start: async () => {
      throw new Error("unused");
    },
    contribute: async () => {
      throw new Error("unused");
    },
    sync: async () => {},
    explore: async (actor, _key, tile) => {
      assert.equal(actor, fixture);
      calls.push(tile);
      return {
        kind: "apply",
        reason: "owned",
        spentPoints: "1",
        tileIndex: tile ?? 999999,
      };
    },
  };
  const server = createKnowledgeQaServer(backend, "dist/knowledge-qa");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const commandId = randomUUID();
  const call = (input: unknown) =>
    fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/qa/knowledge/explore`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-qa-token": fixture.token,
        },
        body: JSON.stringify(input),
      },
    );
  for (const tileIndex of [-1, 1000000, 0.1, "0", null, true])
    assert.equal((await call({ commandId, tileIndex })).status, 400);
  for (const extra of [
    { actorId: fixture.actorId },
    { schoolSlot: 0 },
    { cost: 1 },
  ])
    assert.equal(
      (await call({ commandId, tileIndex: 0, ...extra })).status,
      400,
    );
  assert.equal((await call({ commandId: "bad", tileIndex: 0 })).status, 400);
  assert.equal(calls.length, 0);
  for (const tileIndex of [0, 999999])
    assert.equal((await call({ commandId, tileIndex })).status, 200);
  assert.equal((await call({ commandId })).status, 200);
  assert.deepEqual(calls, [0, 999999, undefined]);
});

test("explore validates before SQL and rolls back failure after debit", async () => {
  const fixture = {
    token: "synthetic",
    actorId: randomUUID(),
    label: "Synthetic",
    schoolSlot: 0,
  };
  const queries: string[] = [];
  let released = false;
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith("INSERT INTO knowledge_explore_outbox"))
        throw new Error("synthetic outbox failure");
      return {
        rows: [],
        rowCount: sql.startsWith("UPDATE wallet_accounts") ? 1 : 0,
      };
    },
    release: () => {
      released = true;
    },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const explore = new KnowledgeExploreQaV1(pool, randomUUID(), [fixture]);
  for (const tile of [-1, 1000000, NaN, Infinity, 0.1])
    await assert.rejects(() => explore.execute(fixture, randomUUID(), tile));
  await assert.rejects(() => explore.execute({ ...fixture }, randomUUID(), 0));
  assert.equal(queries.length, 0);
  await assert.rejects(
    () => explore.execute(fixture, randomUUID(), 0),
    /synthetic outbox failure/,
  );
  assert(queries.some((sql) => sql.startsWith("UPDATE wallet_accounts")));
  assert(
    queries.some((sql) => sql.includes("jsonb_array_elements(c.snapshot")),
  );
  assert.equal(queries.at(-1), "ROLLBACK");
  assert(!queries.includes("COMMIT"));
  assert(released);
});

test("snapshot reservation rejects without debit; stored retry compares tile hash before availability", async () => {
  const fixture = {
    token: "synthetic",
    actorId: randomUUID(),
    label: "Synthetic",
    schoolSlot: 1,
  };
  const commandId = randomUUID();
  const stored: ExploreReceiptV1 = {
    kind: "apply",
    reason: "owned",
    spentPoints: "1",
    tileIndex: 42,
  };
  const hash = createHash("sha256")
    .update("knowledge-explore-qa-v1:1:42:1")
    .digest();
  let replay = false;
  const queries: string[] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      if (sql.startsWith("SELECT payload_hash"))
        return {
          rows: replay ? [{ payload_hash: hash, result: stored }] : [],
          rowCount: replay ? 1 : 0,
        };
      if (sql.includes("jsonb_array_elements"))
        return { rows: [{ reserved: 1 }], rowCount: 1 };
      if (sql.startsWith("UPDATE command_results"))
        assert.deepEqual(values?.[4], {
          kind: "reject",
          reason: "unavailable",
          spentPoints: "0",
          tileIndex: null,
        });
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  const explore = new KnowledgeExploreQaV1(
    { connect: async () => client } as unknown as Pool,
    randomUUID(),
    [fixture],
  );
  assert.equal((await explore.execute(fixture, commandId, 42)).kind, "reject");
  assert(!queries.some((sql) => sql.startsWith("UPDATE wallet_accounts")));
  replay = true;
  queries.length = 0;
  assert.deepEqual(await explore.execute(fixture, commandId, 42), stored);
  assert(!queries.some((sql) => sql.includes("jsonb_array_elements")));
  await assert.rejects(
    () => explore.execute(fixture, commandId, 43),
    IdempotencyConflict,
  );
  assert.equal(queries.at(-1), "ROLLBACK");
});
