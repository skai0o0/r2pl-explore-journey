import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { Pool } from "pg";
import { createSyntheticServer } from "../server/realtime/bootstrap.ts";
import { createDurableSyntheticServer } from "../server/realtime/durableBootstrap.ts";
import { SyntheticVisibilityProjection } from "../server/realtime/VisibilityProjection.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";

const clients = Number(process.argv[2]);
const fanoutMode = process.argv[3] === "indexed" ? "indexed" : "scan";
const durable = process.argv[4] === "durable";
if (!Number.isInteger(clients) || clients < 1 || clients > 2000)
  throw new Error("Invalid client count");
const registry = new SchoolRegistry([
  { id: "fixture-a", slot: 0 },
  { id: "fixture-b", slot: 15 },
]);
const identities = Array.from({ length: clients }, (_, i) => ({
  token: `load-token-${i}`,
  actorId: durable
    ? `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`
    : `load-actor-${i}`,
  schoolSlot: i % 2 ? 15 : 0,
}));
const url = process.env.R2PL_TEST_DATABASE_URL;
if (durable && !url) throw new Error("Disposable PostgreSQL URL required");
const pool = durable ? new Pool({ connectionString: url, max: 16 }) : undefined;
const campaignId = durable ? randomUUID() : undefined;
if (pool && campaignId) {
  await pool.query(
    "INSERT INTO r2pl_v2.campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
    [campaignId, `m35-load-${campaignId}`],
  );
  await pool.query(
    "INSERT INTO r2pl_v2.campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-a',0),($1,'fixture-b',15)",
    [campaignId],
  );
  for (const identity of identities)
    await pool.query(
      "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',100000,100000)",
      [campaignId, identity.actorId],
    );
}
const durableFixture =
  pool && campaignId
    ? await createDurableSyntheticServer(
        pool,
        campaignId,
        registry,
        identities,
        1n,
      )
    : undefined;
const ephemeralFixture = durableFixture
  ? undefined
  : createSyntheticServer(registry, identities, { fanoutMode });
const fixture = durableFixture ?? ephemeralFixture!;
let walStart: string | undefined;
let deadlocksStart = 0;
let poolMaxTotal = 0,
  poolMaxWaiting = 0,
  poolMaxBusy = 0;
const poolSampler =
  pool &&
  setInterval(() => {
    poolMaxTotal = Math.max(poolMaxTotal, pool.totalCount);
    poolMaxWaiting = Math.max(poolMaxWaiting, pool.waitingCount);
    poolMaxBusy = Math.max(poolMaxBusy, pool.totalCount - pool.idleCount);
  }, 20);
poolSampler?.unref();
const cpuBefore = process.cpuUsage();
await fixture.server.listen(0, "127.0.0.1");
const address = fixture.transport.server?.address();
if (!address || typeof address === "string")
  throw new Error("No loopback port");
process.send?.({ type: "ready", port: address.port });
process.on("message", async (message: unknown) => {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  if (message.type === "baseline" && pool) {
    poolMaxTotal = pool.totalCount;
    poolMaxWaiting = pool.waitingCount;
    poolMaxBusy = pool.totalCount - pool.idleCount;
    const baseline = await pool.query<{ lsn: string; deadlocks: string }>(
      "SELECT pg_current_wal_lsn()::text AS lsn,(SELECT deadlocks::text FROM pg_stat_database WHERE datname=current_database()) AS deadlocks",
    );
    walStart = baseline.rows[0]?.lsn;
    deadlocksStart = Number(baseline.rows[0]?.deadlocks ?? 0);
    process.send?.({ type: "baseline" });
  } else if (message.type === "summary") {
    const cpu = process.cpuUsage(cpuBefore);
    const projection = ephemeralFixture
      ? new SyntheticVisibilityProjection(ephemeralFixture.core.world)
      : undefined;
    const pairs =
      "pairs" in message && Array.isArray(message.pairs) ? message.pairs : [];
    const projections = await Promise.all(
      pairs.map(async (pair: { slot: number; chunk: number }) => {
        const snapshot = durableFixture
          ? await durableFixture.authority.snapshot(pair.slot, pair.chunk)
          : projection!.snapshot(pair.slot, pair.chunk, 0n);
        return {
          slot: pair.slot,
          chunk: pair.chunk,
          mask: Buffer.from(snapshot.mask).toString("base64"),
          fog: Buffer.from(snapshot.fog).toString("base64"),
        };
      }),
    );
    const database =
      pool && walStart
        ? (
            await pool.query<{
              wal_bytes: string;
              deadlocks: string;
              pending: string;
            }>(
              "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),$1)::text AS wal_bytes,(SELECT deadlocks::text FROM pg_stat_database WHERE datname=current_database()) AS deadlocks,(SELECT count(*)::text FROM r2pl_v2.outbox_events WHERE campaign_id=$2 AND delivered_at IS NULL) AS pending",
              [walStart, campaignId],
            )
          ).rows[0]
        : undefined;
    process.send?.({
      type: "summary",
      projections,
      metrics: fixture.core.metrics.snapshot(),
      ...(durableFixture
        ? {
            commitTimeline: durableFixture.core.commitTimeline,
            ackCommitTimeline: durableFixture.core.ackCommitTimeline,
          }
        : {}),
      ...(database
        ? {
            database: {
              walBytes: Number(database.wal_bytes),
              deadlocks: Number(database.deadlocks) - deadlocksStart,
              pendingOutbox: Number(database.pending),
              poolMaxTotal,
              poolMaxWaiting,
              poolMaxBusy,
            },
          }
        : {}),
      resources: {
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        memory: process.memoryUsage(),
        logicalCpus: cpus().length,
      },
    });
  } else if (message.type === "stop") {
    if (poolSampler) clearInterval(poolSampler);
    durableFixture?.core.stopRelay();
    await fixture.server.gracefullyShutdown(false);
    await pool?.end();
    process.exit(0);
  }
});
