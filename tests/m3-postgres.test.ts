import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Pool } from "pg";
import {
  IdempotencyConflict,
  M3TestMutationService,
  readAuthoritativeChunk,
  type WriteStrategy,
} from "../server/persistence/M3TestMutation.ts";
import { materializeChunk } from "../server/persistence/MaterializeChunk.ts";
import { OutboxRelay } from "../server/persistence/OutboxRelay.ts";
import { localIndex, tileIndex } from "../shared/world/coordinates.ts";

const url = process.env.R2PL_TEST_DATABASE_URL;
const execFileAsync = promisify(execFile);
const key = (n: number) => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
};

test("PostgreSQL M3 atomicity, retries, materialization and restart", {
  skip:
    !url && "Set R2PL_TEST_DATABASE_URL to a disposable PostgreSQL database",
  timeout: 120_000,
}, async () => {
  const pool = new Pool({
    connectionString: url,
    max: 12,
    options: "-c search_path=r2pl_v2,public",
  });
  const campaigns: string[] = [];
  try {
    await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        fileURLToPath(new URL("../scripts/migrate-m3.ts", import.meta.url)),
      ],
      { env: process.env },
    );
    for (const strategy of [
      "full_chunk",
      "mutation_log",
    ] as const satisfies readonly WriteStrategy[]) {
      const campaignId = randomUUID();
      const actorId = randomUUID();
      campaigns.push(campaignId);
      await pool.query(
        "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,$3)",
        [campaignId, `fixture-${campaignId}`, strategy],
      );
      await pool.query(
        "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-a',0),($1,'fixture-b',15)",
        [campaignId],
      );
      await pool.query(
        "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',1000,1000)",
        [campaignId, actorId],
      );
      const service = new M3TestMutationService(pool);
      const first = {
        campaignId,
        actorId,
        schoolSlot: 0,
        key: key(1),
        tileIndex: tileIndex(2, 3),
        cost: 7n,
      };
      await assert.rejects(
        service.apply(first, {
          beforeCommit: () => {
            throw new Error("simulated precommit crash");
          },
        }),
        /precommit/,
      );
      assert.equal(
        (
          await pool.query<{ balance: string }>(
            "SELECT balance FROM wallet_accounts WHERE campaign_id=$1",
            [campaignId],
          )
        ).rows[0]?.balance,
        "1000",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM command_results WHERE campaign_id=$1",
            [campaignId],
          )
        ).rowCount,
        0,
      );
      await assert.rejects(
        service.apply(first, {
          afterCommit: () => {
            throw new Error("simulated lost ACK");
          },
        }),
        /lost ACK/,
      );
      const child = await execFileAsync(
        process.execPath,
        [
          "--experimental-strip-types",
          fileURLToPath(
            new URL("../scripts/m3-retry-child.ts", import.meta.url),
          ),
          campaignId,
          actorId,
          "0",
          Buffer.from(first.key).toString("hex"),
          String(first.tileIndex),
          String(first.cost),
        ],
        { env: process.env },
      );
      const replay = JSON.parse(child.stdout) as {
        status: string;
        balance: string;
        revision: string;
      };
      assert.equal(replay.status, "test_applied");
      assert.equal(replay.balance, "993");
      assert.equal(
        (await service.apply(first)).result.revision,
        replay.revision,
      );
      await assert.rejects(
        service.apply({ ...first, tileIndex: tileIndex(3, 3) }),
        IdempotencyConflict,
      );
      const sameTile = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          service.apply({ ...first, key: key(100 + i) }),
        ),
      );
      assert(
        sameTile.every((outcome) => outcome.result.status === "test_no_change"),
      );
      const hot = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          service.apply({
            ...first,
            key: key(200 + i),
            tileIndex: tileIndex(10 + i, 10),
            cost: 1n,
          }),
        ),
      );
      assert.equal(
        hot.filter((outcome) => outcome.result.status === "test_applied")
          .length,
        30,
      );
      assert.equal(
        (
          await pool.query<{ balance: string }>(
            "SELECT balance FROM wallet_accounts WHERE campaign_id=$1",
            [campaignId],
          )
        ).rows[0]?.balance,
        "963",
      );
      const reconciled = await pool.query<{
        balance: string;
        expected: string;
      }>(
        "SELECT w.balance::text AS balance, (w.opening_balance + coalesce(sum(l.amount),0))::text AS expected FROM wallet_accounts w LEFT JOIN ledger_entries l ON l.campaign_id=w.campaign_id AND l.actor_id=w.actor_id AND l.resource=w.resource WHERE w.campaign_id=$1 GROUP BY w.campaign_id,w.actor_id,w.resource",
        [campaignId],
      );
      assert.equal(reconciled.rows[0]?.balance, reconciled.rows[0]?.expected);
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM ledger_entries WHERE campaign_id=$1",
            [campaignId],
          )
        ).rowCount,
        31,
      );
      assert.equal(
        (
          await pool.query("SELECT 1 FROM outbox_events WHERE campaign_id=$1", [
            campaignId,
          ])
        ).rowCount,
        31,
      );
      const relay = new OutboxRelay(pool);
      const firstClaim = (await relay.claim(campaignId, 1))[0]!;
      assert.equal(firstClaim.attempts, 1);
      await relay.release(firstClaim.id, firstClaim.leaseToken);
      const secondClaim = (await relay.claim(campaignId, 1))[0]!;
      assert.equal(secondClaim.id, firstClaim.id);
      assert.equal(secondClaim.attempts, 2);
      await assert.rejects(
        relay.markDelivered(firstClaim.id, firstClaim.leaseToken),
        /Outbox lease/,
      );
      await relay.markDelivered(secondClaim.id, secondClaim.leaseToken);
      const client = await pool.connect();
      try {
        const chunk = await readAuthoritativeChunk(client, campaignId, 0, 0);
        assert.equal(chunk.revision, 31n);
        assert.equal(chunk.mask.readUInt16LE(localIndex(2, 3) * 2), 1);
        assert.equal(
          !!(chunk.fog[localIndex(2, 3) >> 3]! & (1 << (localIndex(2, 3) & 7))),
          true,
        );
      } finally {
        client.release();
      }
      if (strategy === "mutation_log") {
        const done = await materializeChunk(pool, campaignId, 0);
        assert.equal(done.to, 31n);
        assert.equal(done.mutations, 31);
        assert.equal(
          (await materializeChunk(pool, campaignId, 0)).mutations,
          0,
        );
      }
      const persisted = await pool.query<{ status: string; count: string }>(
        "SELECT status,count(*)::text AS count FROM command_results WHERE campaign_id=$1 GROUP BY status",
        [campaignId],
      );
      assert.equal(
        persisted.rows.find((row) => row.status === "test_applied")?.count,
        "31",
      );
      const duplicateRetries = await Promise.all(
        Array.from({ length: 12 }, () => service.apply(first)),
      );
      assert(
        duplicateRetries.every(
          (outcome) =>
            outcome.metrics.replayed &&
            outcome.result.revision === replay.revision &&
            outcome.result.balance === replay.balance,
        ),
      );
      const otherActor = randomUUID();
      await pool.query(
        "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',10,10)",
        [campaignId, otherActor],
      );
      const otherSchool = await service.apply({
        ...first,
        actorId: otherActor,
        schoolSlot: 15,
        key: key(500),
        cost: 1n,
      });
      assert.equal(otherSchool.result.status, "test_applied");
      const client2 = await pool.connect();
      try {
        const school0 = await readAuthoritativeChunk(client2, campaignId, 0, 0);
        const school15 = await readAuthoritativeChunk(
          client2,
          campaignId,
          0,
          15,
        );
        assert.equal(school0.mask.readUInt16LE(localIndex(2, 3) * 2), 0x8001);
        assert.equal(school15.mask.readUInt16LE(localIndex(2, 3) * 2), 0x8001);
        assert.equal(
          !!(
            school15.fog[localIndex(10, 10) >> 3]! &
            (1 << (localIndex(10, 10) & 7))
          ),
          false,
        );
        assert.equal(
          !!(
            school0.fog[localIndex(10, 10) >> 3]! &
            (1 << (localIndex(10, 10) & 7))
          ),
          true,
        );
      } finally {
        client2.release();
      }
    }
  } finally {
    for (const campaignId of campaigns) {
      for (const table of [
        "outbox_events",
        "ledger_entries",
        "world_mutations",
        "school_fog_chunks",
        "world_chunks",
        "world_chunk_heads",
        "command_results",
        "wallet_accounts",
        "campaign_schools",
      ])
        await pool.query(`DELETE FROM ${table} WHERE campaign_id=$1`, [
          campaignId,
        ]);
      await pool.query("DELETE FROM campaigns WHERE id=$1", [campaignId]);
    }
    await pool.end();
  }
});
