import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Pool } from "pg";
import { M3TestMutationService } from "../server/persistence/M3TestMutation.ts";
import type { EvaluateDevExplore } from "../shared/gameplay/devContract.ts";
import { tileIndex } from "../shared/world/coordinates.ts";

const url = process.env.R2PL_TEST_DATABASE_URL;
const execFileAsync = promisify(execFile);
function key(n: number): Uint8Array {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
}

test("development rule decision executes inside the durable transaction", {
  skip:
    !url && "Set R2PL_TEST_DATABASE_URL to a disposable PostgreSQL database",
  timeout: 30_000,
}, async () => {
  const pool = new Pool({
    connectionString: url,
    max: 4,
    options: "-c search_path=r2pl_v2,public",
  });
  const campaignId = randomUUID();
  const actorId = randomUUID();
  let seeded = false;
  try {
    for (const name of ["migrate-m3.ts", "migrate-m35.ts"])
      await execFileAsync(
        process.execPath,
        [
          "--experimental-strip-types",
          fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)),
        ],
        { env: process.env },
      );
    await pool.query(
      "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaignId, `m4b-rule-${campaignId}`],
    );
    seeded = true;
    await pool.query(
      "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-dawn',0)",
      [campaignId],
    );
    await pool.query(
      "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',2,2)",
      [campaignId, actorId],
    );
    let evaluations = 0;
    const rule: EvaluateDevExplore = (input, config) => {
      evaluations++;
      if (input.knownBySchool && input.discoveredBySchool)
        return { kind: "no_change", debit: 0n };
      if (input.balance < config.cost)
        return {
          kind: "reject",
          reason: "insufficient_fixture_credit",
          debit: 0n,
        };
      return { kind: "apply", debit: config.cost };
    };
    const service = new M3TestMutationService(pool, {
      realtimeViews: true,
      devExplore: rule,
    });
    const command = (n: number, x: number) => ({
      campaignId,
      actorId,
      schoolSlot: 0,
      key: key(n),
      tileIndex: tileIndex(x, 3),
      cost: 1n,
    });
    const first = await service.apply(command(1, 3));
    assert.equal(first.result.status, "test_applied");
    assert.equal(first.result.balance, "1");
    assert.equal(
      (await service.apply(command(1, 3))).result.status,
      "test_applied",
    );
    assert.equal(
      evaluations,
      1,
      "idempotent replay must bypass rule evaluation",
    );
    const repeatedTile = await service.apply(command(2, 3));
    assert.equal(repeatedTile.result.status, "test_no_change");
    assert.equal(repeatedTile.result.balance, "1");
    const second = await service.apply(command(3, 4));
    assert.equal(second.result.status, "test_applied");
    assert.equal(second.result.balance, "0");
    const insufficient = await service.apply(command(4, 5));
    assert.equal(insufficient.result.status, "rejected");
    assert.equal(insufficient.result.reason, "insufficient_fixture_credit");
    assert.equal(insufficient.result.balance, "0");
    assert.equal(evaluations, 4);
    const counts = await pool.query<{ ledger: string; events: string }>(
      "SELECT (SELECT count(*) FROM ledger_entries WHERE campaign_id=$1)::text AS ledger,(SELECT count(*) FROM outbox_events WHERE campaign_id=$1)::text AS events",
      [campaignId],
    );
    assert.deepEqual(counts.rows[0], { ledger: "2", events: "2" });
    const invalidRule = new M3TestMutationService(pool, {
      realtimeViews: true,
      devExplore: () => ({ kind: "apply", debit: 0n }),
    });
    await assert.rejects(
      invalidRule.apply(command(5, 6)),
      /Development rule disagrees/,
    );
    const rolledBack = await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM command_results WHERE campaign_id=$1 AND command_key=$2",
      [campaignId, Buffer.from(key(5))],
    );
    assert.equal(rolledBack.rows[0]?.count, "0");
  } finally {
    if (seeded) {
      for (const table of [
        "outbox_events",
        "ledger_entries",
        "world_mutations",
        "school_chunk_views",
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
