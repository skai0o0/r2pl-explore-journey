import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import {
  M3TestMutationService,
  readAuthoritativeChunk,
  type WriteStrategy,
} from "../server/persistence/M3TestMutation.ts";
import { materializeChunk } from "../server/persistence/MaterializeChunk.ts";
import { tileIndex } from "../shared/world/coordinates.ts";

const url = process.env.R2PL_TEST_DATABASE_URL;
if (!url) throw new Error("R2PL_TEST_DATABASE_URL is required");
const count = Number(
  process.argv.find((arg) => arg.startsWith("--count="))?.split("=")[1] ?? 200,
);
const concurrency = Number(
  process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] ??
    16,
);
if (
  !Number.isInteger(count) ||
  count < 16 ||
  count > 1000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 64
)
  throw new Error("Invalid benchmark size");
const pool = new Pool({
  connectionString: url,
  max: concurrency + 2,
  connectionTimeoutMillis: 5000,
  options: "-c search_path=r2pl_v2,public",
});
const percentile = (values: number[], part: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.ceil(sorted.length * part) - 1] ?? 0).toFixed(3));
};
const actionKey = (n: number) => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
};
const wal = async (): Promise<string | null> => {
  try {
    return (
      (
        await pool.query<{ lsn: string }>(
          "SELECT pg_current_wal_lsn()::text AS lsn",
        )
      ).rows[0]?.lsn ?? null
    );
  } catch {
    return null;
  }
};
const deadlocks = async (): Promise<number> =>
  Number(
    (
      await pool.query<{ deadlocks: string }>(
        "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()",
      )
    ).rows[0]?.deadlocks ?? 0,
  );
const recoveryRead = async (campaignId: string, ids: readonly number[]) => {
  const client = await pool.connect();
  try {
    const started = performance.now();
    for (const id of ids)
      await readAuthoritativeChunk(client, campaignId, id, 0);
    return performance.now() - started;
  } finally {
    client.release();
  }
};
const cleanup = async (campaignId: string) => {
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
    await pool.query(`DELETE FROM ${table} WHERE campaign_id=$1`, [campaignId]);
  await pool.query("DELETE FROM campaigns WHERE id=$1", [campaignId]);
};

const results: unknown[] = [];
try {
  const version = (await pool.query<{ version: string }>("SHOW server_version"))
    .rows[0]?.version;
  const fsync = (await pool.query<{ fsync: string }>("SHOW fsync")).rows[0]
    ?.fsync;
  const fullPageWrites = (
    await pool.query<{ full_page_writes: string }>("SHOW full_page_writes")
  ).rows[0]?.full_page_writes;
  for (const strategy of [
    "full_chunk",
    "mutation_log",
  ] as const satisfies readonly WriteStrategy[]) {
    for (const mode of ["balanced", "hotspot"] as const) {
      const campaignId = randomUUID();
      const actors = Array.from({ length: concurrency }, () => randomUUID());
      try {
        await pool.query(
          "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,$3)",
          [campaignId, `bench-${campaignId}`, strategy],
        );
        await pool.query(
          "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-a',0)",
          [campaignId],
        );
        for (const actor of actors)
          await pool.query(
            "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',$3,$3)",
            [campaignId, actor, count],
          );
        const beforeWal = await wal();
        const beforeDeadlocks = await deadlocks();
        const service = new M3TestMutationService(pool);
        const latencies: number[] = [],
          lockWaits: number[] = [],
          reads: number[] = [],
          writes: number[] = [];
        const started = performance.now();
        for (let start = 0; start < count; start += concurrency) {
          const batch = await Promise.all(
            Array.from(
              { length: Math.min(concurrency, count - start) },
              async (_, i) => {
                const n = start + i;
                const sector = mode === "hotspot" ? 0 : n % 16;
                const ordinal = mode === "hotspot" ? n : Math.floor(n / 16);
                const x = (sector % 4) * 256 + (ordinal % 64);
                const z =
                  Math.floor(sector / 4) * 256 + Math.floor(ordinal / 64);
                return service.apply({
                  campaignId,
                  actorId: actors[n % actors.length]!,
                  schoolSlot: 0,
                  key: actionKey(n),
                  tileIndex: tileIndex(x, z),
                  cost: 1n,
                });
              },
            ),
          );
          for (const item of batch) {
            if (item.result.status !== "test_applied")
              throw new Error("Benchmark mutation was not applied");
            latencies.push(item.metrics.transactionMs);
            lockWaits.push(item.metrics.headLockWaitMs);
            reads.push(item.metrics.worldReadMs);
            writes.push(item.metrics.worldWriteMs);
          }
        }
        const elapsed = performance.now() - started;
        const afterWal = await wal();
        const walBytes =
          beforeWal && afterWal
            ? Number(
                (
                  await pool.query<{ bytes: string }>(
                    "SELECT pg_wal_lsn_diff($1::pg_lsn,$2::pg_lsn)::text AS bytes",
                    [afterWal, beforeWal],
                  )
                ).rows[0]?.bytes,
              )
            : null;
        const checkpoint = await pool.query<{ bytes: string }>(
          "SELECT (coalesce((SELECT sum(octet_length(mask)) FROM world_chunks WHERE campaign_id=$1),0)+coalesce((SELECT sum(octet_length(fog)) FROM school_fog_chunks WHERE campaign_id=$1),0))::text AS bytes",
          [campaignId],
        );
        const mutationRows = Number(
          (
            await pool.query<{ count: string }>(
              "SELECT count(*)::text AS count FROM world_mutations WHERE campaign_id=$1",
              [campaignId],
            )
          ).rows[0]?.count ?? 0,
        );
        const ledgerRows = Number(
          (
            await pool.query<{ count: string }>(
              "SELECT count(*)::text AS count FROM ledger_entries WHERE campaign_id=$1",
              [campaignId],
            )
          ).rows[0]?.count ?? 0,
        );
        const outboxRows = Number(
          (
            await pool.query<{ count: string }>(
              "SELECT count(*)::text AS count FROM outbox_events WHERE campaign_id=$1",
              [campaignId],
            )
          ).rows[0]?.count ?? 0,
        );
        const ids =
          mode === "hotspot"
            ? [0]
            : Array.from(
                { length: 16 },
                (_, sector) => Math.floor(sector / 4) * 64 + (sector % 4) * 4,
              );
        const recoveryReplayMs = await recoveryRead(campaignId, ids);
        const materializeStarted = performance.now();
        if (strategy === "mutation_log") {
          for (const id of ids) await materializeChunk(pool, campaignId, id);
        }
        const materializeMs = performance.now() - materializeStarted;
        const recoveryCheckpointMs = await recoveryRead(campaignId, ids);
        results.push({
          strategy,
          mode,
          count,
          concurrency,
          seconds: elapsed / 1000,
          actionsPerSecond: count / (elapsed / 1000),
          transactionMs: {
            p50: percentile(latencies, 0.5),
            p95: percentile(latencies, 0.95),
            p99: percentile(latencies, 0.99),
          },
          headLockWaitMs: {
            p50: percentile(lockWaits, 0.5),
            p95: percentile(lockWaits, 0.95),
            p99: percentile(lockWaits, 0.99),
          },
          worldReadMs: {
            p50: percentile(reads, 0.5),
            p95: percentile(reads, 0.95),
            p99: percentile(reads, 0.99),
          },
          worldWriteMs: {
            p50: percentile(writes, 0.5),
            p95: percentile(writes, 0.95),
            p99: percentile(writes, 0.99),
          },
          walBytes,
          walBytesPerAction: walBytes === null ? null : walBytes / count,
          checkpointBytesBeforeMaterialize: Number(
            checkpoint.rows[0]?.bytes ?? 0,
          ),
          mutationRows,
          ledgerRows,
          outboxRows,
          materializeMs,
          recoveryReplayMs,
          recoveryCheckpointMs,
          deadlocks: (await deadlocks()) - beforeDeadlocks,
        });
      } finally {
        await cleanup(campaignId);
      }
    }
  }
  const report = {
    environment: {
      node: process.version,
      postgres: version,
      fsync,
      fullPageWrites,
      synchronousCommit: "on (forced per mutation transaction)",
      platform: process.platform,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      generator: "same host/process as DB client; disposable test database",
    },
    results,
  };
  await mkdir("docs/benchmarks", { recursive: true });
  await writeFile(
    "docs/benchmarks/M3_postgres.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
