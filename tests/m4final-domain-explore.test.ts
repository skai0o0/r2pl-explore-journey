import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Pool } from "pg";
import type { ExploreReceiptV1 } from "../server/gameplay/KnowledgeExploreQaV1.ts";
import {
  createKnowledgeQaServer,
  createPostgresKnowledgeQa,
  type QaStateV1,
  qaDatabaseUrl,
} from "../server/qa/KnowledgeQaGatewayV1.ts";

test("PostgreSQL fixed Knowledge explore: atomic action, retry and forged school", {
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
  const sql = (
    await readFile(
      new URL(
        "../database/migrations/006_m4final_explore_qa.sql",
        import.meta.url,
      ),
      "utf8",
    )
  ).replace(/\r\n/g, "\n");
  const hash = createHash("sha256").update(sql).digest();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(2189,3)");
    const prior = await client.query<{ sha256: Buffer }>(
      "SELECT sha256 FROM schema_migrations WHERE version=6",
    );
    if (prior.rows[0]) assert(prior.rows[0].sha256.equals(hash));
    else {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(version,sha256) VALUES(6,$1)",
        [hash],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
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
  assert.equal((await call({ commandId, tileIndex: 1 })).status, 400);
  const replies = await Promise.all([call({ commandId }), call({ commandId })]);
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
    tileIndex: 999999,
  });
  assert.deepEqual(values[1]!.receipt, values[0]!.receipt);
  assert.equal(values[0]!.state.walletPoints, "49");
  assert.deepEqual(values[0]!.state.tiles, [
    { tileIndex: 999999, schoolSlots: [0] },
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
});
