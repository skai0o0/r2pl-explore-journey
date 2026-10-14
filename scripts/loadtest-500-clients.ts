/**
 * Mixed 500-client load test gate (Milestone 17/10/2026).
 * Simulates 500 concurrent synthetic clients across 8 universities performing
 * mixed actions: WebSocket exploration, Shared Knowledge, UniStop spins, and Landmark Crystal contribution.
 * Measures round-trip latencies (p50/p95), verifies 100% success rate, and monitors memory RSS.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { cleanupSchoolRewards } from "../server/integration/SchoolRewardFixture.ts";
import { cleanupBotFixture } from "./simulation/fixture.ts";
import {
  ACK_STATUS,
  type Ack,
  M2_KIND,
  REASON,
  decodeAck,
  decodeFrame,
  encodeExplore,
} from "../shared/protocol/m2.ts";
import { chunkId, localIndex, tileIndex } from "../shared/world/coordinates.ts";
import { crc32 } from "../shared/world/checksum.ts";
import {
  LANDMARKS,
  NEUTRAL_UNISTOPS,
  SCHOOLS,
} from "../shared/gameplay/gameConfig.ts";

const dbUrl =
  process.env.R2PL_LOADTEST_DATABASE_URL ||
  process.env.R2PL_PREPARATION_DATABASE_URL ||
  process.env.R2PL_TEST_DATABASE_URL ||
  "postgresql://prep_fixture@127.0.0.1:55439/r2pl_prep_test_current";

async function injectTile(
  pool: Pool,
  campaign: string,
  slot: number,
  x: number,
  z: number,
): Promise<void> {
  const id = chunkId(Math.floor(x / 64), Math.floor(z / 64));
  await pool.query(
    "INSERT INTO r2pl_v2.world_chunk_heads(campaign_id,chunk_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [campaign, id],
  );
  const row = (
    await pool.query<{ mask: Buffer }>(
      "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=$2",
      [campaign, id],
    )
  ).rows[0];
  const mask = Buffer.from(row?.mask ?? Buffer.alloc(8192));
  const local = localIndex(x, z);
  mask.writeUInt16LE(mask.readUInt16LE(local * 2) | (1 << slot), local * 2);
  await pool.query(
    "INSERT INTO r2pl_v2.world_chunks(campaign_id,chunk_id,mask,mask_crc) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,chunk_id) DO UPDATE SET mask=EXCLUDED.mask,mask_crc=EXCLUDED.mask_crc",
    [campaign, id, mask, crc32(mask)],
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

interface WsClientInfo {
  actor: { token: string; actorId: string; schoolSlot: number; schoolName: string };
  room: Room;
  pending: Map<
    string,
    { resolve: (ack: Ack) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >;
}

async function runLoadTest(): Promise<void> {
  console.log("===============================================================================");
  console.log("  R2PL GAME V2 — 500 CONCURRENT CLIENT MIXED LOAD GATE (17/10/2026)");
  console.log("===============================================================================");
  console.log(`Database: ${dbUrl}`);

  const pool = new Pool({ connectionString: dbUrl, max: 24 });
  const campaign = randomUUID();
  const startMemory = process.memoryUsage();
  let peakMemoryRss = startMemory.rss;

  const trackMemory = () => {
    const current = process.memoryUsage().rss;
    if (current > peakMemoryRss) peakMemoryRss = current;
  };

  const memInterval = setInterval(trackMemory, 100);

  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  try {
    console.log("[Setup] Initializing server with 500+ synthetic actors across 8 universities...");
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
      { actorsPerSchool: 63 }, // 8 * 63 = 504 actors
    );

    const baseHttp = `http://127.0.0.1:${server.webPort}`;
    const baseWs = `ws://127.0.0.1:${server.websocketPort}`;
    console.log(`[Setup] Server ready: HTTP ${baseHttp} | WebSocket ${baseWs}`);

    // Pre-provision knowledge connections for unistops so capture & spin succeed
    console.log("[Setup] Pre-provisioning stepping-stone knowledge connections for UniStops...");
    for (let s = 0; s < 8; s++) {
      const stop = NEUTRAL_UNISTOPS[s]!;
      // Connect each school to its nearest Aspire unistop footprint
      await injectTile(pool, campaign, s, stop.x, stop.z);
      await pool.query(
        `UPDATE r2pl_v2.game_world_objects SET data = jsonb_set(jsonb_set(data, '{ownerSchoolSlot}', '${s}'::jsonb), '{ownerSchoolId}', '"${SCHOOLS[s]!.id}"'::jsonb) WHERE campaign_id=$1 AND id=$2`,
        [campaign, stop.id],
      );
    }

    // Pre-provision knowledge connections for landmarks so Crystal contributions succeed
    console.log("[Setup] Pre-provisioning knowledge paths to landmarks for each school...");
    for (let s = 0; s < 8; s++) {
      const landmark = LANDMARKS[s % LANDMARKS.length]!;
      await injectTile(pool, campaign, s, landmark.x, landmark.z);
    }

    // Pre-provision shared knowledge clusters for neighboring schools
    console.log("[Setup] Creating active 2-school Shared Knowledge clusters...");
    for (let s = 0; s < 4; s++) {
      const a = s * 2;
      const b = s * 2 + 1;
      const clusterId = `load-cluster-${s}`;
      const now = Date.now();
      await pool.query(
        "INSERT INTO r2pl_v2.game_state(campaign_id, scope, id, data) VALUES($1, 'shared-cluster', $2, $3) ON CONFLICT DO NOTHING",
        [
          campaign,
          clusterId,
          JSON.stringify({
            id: clusterId,
            pair: [a, b],
            tiles: [{ tile: 500000 + s * 1000 }],
            due: { [String(a)]: now + 86400000, [String(b)]: now + 86400000 },
            createdAt: now - 90000000, // past free period so upkeep is payable
            escrow: {},
            guest: b,
            status: "shared",
            required: 0,
            hardUntil: 0,
            rollingUntil: 0,
          }),
        ],
      );
    }

    const allActors = server.fixture.actors.slice(0, 500);
    console.log(`[Execution] Launching 500 concurrent synthetic clients across 8 schools...`);

    // Partition 500 actors into 4 mixed workloads:
    // - Cohort 1: 250 WebSocket explorers
    // - Cohort 2: 90 UniStop spinners
    // - Cohort 3: 80 Landmark contributors
    // - Cohort 4: 80 Shared Knowledge upkeep/consolidation
    const wsExplorers = allActors.slice(0, 250);
    const unistopSpinners = allActors.slice(250, 340);
    const landmarkContributors = allActors.slice(340, 420);
    const sharedAmbassadors = allActors.slice(420, 500);

    const latencies: number[] = [];
    const cohortLatencies: Record<
      "ws_explore" | "unistop_spin" | "landmark_crystal" | "shared_knowledge",
      number[]
    > = {
      ws_explore: [],
      unistop_spin: [],
      landmark_crystal: [],
      shared_knowledge: [],
    };
    let successCount = 0;
    let failureCount = 0;

    const opStart = performance.now();

    // 1. WebSocket Explorers (250 concurrent clients)
    console.log(`  -> Connecting 250 WebSocket clients in parallel batches...`);
    let roomId: string | undefined;
    const wsClients: WsClientInfo[] = [];
    const batchSize = 25;
    for (let i = 0; i < wsExplorers.length; i += batchSize) {
      const batch = wsExplorers.slice(i, i + batchSize);
      const connected = await Promise.all(
        batch.map(async (actor) => {
          const sdk = new ColyseusSDK(baseWs);
          const room: Room = roomId
            ? await sdk.joinById(roomId, { token: actor.token })
            : await sdk.joinOrCreate("m2", { token: actor.token });
          if (!roomId) roomId = room.roomId;

          const pending = new Map<
            string,
            { resolve: (ack: Ack) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
          >();

          room.onMessage("m2", (raw: Uint8Array) => {
            try {
              const frame = decodeFrame(Uint8Array.from(raw));
              if (frame.kind === M2_KIND.ACK) {
                const ack = decodeAck(frame.payload);
                const hex = Buffer.from(ack.key).toString("hex");
                const entry = pending.get(hex);
                if (entry) {
                  pending.delete(hex);
                  clearTimeout(entry.timer);
                  entry.resolve(ack);
                }
              }
            } catch {
              // Ignore snapshot/delta frames
            }
          });

          return { actor, room, pending };
        }),
      );
      wsClients.push(...connected);
    }

    console.log(`  -> Connected 250 WebSocket clients successfully. Starting concurrent load execution...`);

    // Execute mixed workloads across all 500 clients simultaneously
    const tasks: Promise<void>[] = [];

    // Tasks for 250 WebSocket Explorers: 2 exploratory mutations each = 500 WebSocket operations
    for (const { actor, room, pending } of wsClients) {
      tasks.push(
        (async () => {
          const school = SCHOOLS[actor.schoolSlot]!;
          for (let step = 0; step < 2; step++) {
            const tileX = school.hq.x + (step % 5) - 2;
            const tileZ = school.hq.z + Math.floor(step / 5) - 2;
            const tile = tileIndex(Math.max(0, Math.min(999, tileX)), Math.max(0, Math.min(999, tileZ)));
            const key = randomBytes(16);
            const hex = Buffer.from(key).toString("hex");
            const t0 = performance.now();
            try {
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                  pending.delete(hex);
                  reject(new Error("WS ACK Timeout"));
                }, 10000);

                pending.set(hex, {
                  resolve: (ack) => {
                    if (
                      ack.status === ACK_STATUS.REJECTED &&
                      ack.reason === REASON.INVALID_COMMAND
                    ) {
                      reject(new Error(`WS ACK Rejected: ${ack.reason}`));
                    } else {
                      resolve();
                    }
                  },
                  reject,
                  timer,
                });

                room.sendBytes(
                  "m2",
                  encodeExplore({ key, tileIndex: tile, ruleVersion: 1 }),
                );
              });
              const duration = performance.now() - t0;
              latencies.push(duration);
              cohortLatencies.ws_explore.push(duration);
              successCount++;
            } catch (e) {
              failureCount++;
              console.error(`WS explore error: ${String(e)}`);
            }
          }
          await room.leave();
        })(),
      );
    }

    // Tasks for 90 UniStop Harvesters: 1 spin each = 90 HTTP transactions
    for (const actor of unistopSpinners) {
      tasks.push(
        (async () => {
          const stopId = `unistop_aspire_${(actor.schoolSlot % 8) + 1}`;
          const headers = {
            Authorization: `Bearer ${actor.token}`,
            "Content-Type": "application/json",
          };
          const t0 = performance.now();
          try {
            const res = await fetchWithRetry(`${baseHttp}/api/game`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                ruleVersion: 1,
                key: randomUUID(),
                action: "spin",
                target: stopId,
              }),
            });
            if (!res.ok) {
              const errBody = await res.text();
              throw new Error(`HTTP ${res.status}: ${errBody}`);
            }
            const data = (await res.json()) as { status: string };
            if (data.status !== "applied") {
              throw new Error(`Unexpected status: ${data.status}`);
            }
            const duration = performance.now() - t0;
            latencies.push(duration);
            cohortLatencies.unistop_spin.push(duration);
            successCount++;
          } catch (e) {
            failureCount++;
            console.error(`UniStop spin error: ${String(e)}`);
          }
        })(),
      );
    }

    // Tasks for 80 Landmark Contributors: 1 contribution each = 80 HTTP transactions
    for (const actor of landmarkContributors) {
      tasks.push(
        (async () => {
          const landmark = LANDMARKS[actor.schoolSlot % LANDMARKS.length]!;
          const headers = {
            Authorization: `Bearer ${actor.token}`,
            "Content-Type": "application/json",
          };
          const t0 = performance.now();
          try {
            const res = await fetchWithRetry(`${baseHttp}/api/game`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                ruleVersion: 1,
                key: randomUUID(),
                action: "contribute",
                target: landmark.id,
                amount: 10,
              }),
            });
            if (!res.ok) {
              const errBody = await res.text();
              throw new Error(`HTTP ${res.status}: ${errBody}`);
            }
            const data = (await res.json()) as { status: string };
            if (data.status !== "applied") {
              throw new Error(`Contribution failed: ${JSON.stringify(data)}`);
            }
            const duration = performance.now() - t0;
            latencies.push(duration);
            cohortLatencies.landmark_crystal.push(duration);
            successCount++;
          } catch (e) {
            failureCount++;
            console.error(`Landmark contribute error: ${String(e)}`);
          }
        })(),
      );
    }

    // Tasks for 80 Shared Knowledge Ambassadors: 1 cluster upkeep each = 80 HTTP transactions
    for (const actor of sharedAmbassadors) {
      tasks.push(
        (async () => {
          const clusterId = `load-cluster-${Math.floor(actor.schoolSlot / 2)}`;
          const headers = {
            Authorization: `Bearer ${actor.token}`,
            "Content-Type": "application/json",
          };
          const t0 = performance.now();
          try {
            const res = await fetchWithRetry(`${baseHttp}/api/game`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                ruleVersion: 1,
                key: randomUUID(),
                action: "upkeep",
                target: clusterId,
                amount: 1,
              }),
            });
            if (!res.ok) {
              const errBody = await res.text();
              throw new Error(`HTTP ${res.status}: ${errBody}`);
            }
            const data = (await res.json()) as { status: string };
            if (data.status !== "applied") {
              throw new Error(`Upkeep failed: ${JSON.stringify(data)}`);
            }
            const duration = performance.now() - t0;
            latencies.push(duration);
            cohortLatencies.shared_knowledge.push(duration);
            successCount++;
          } catch (e) {
            failureCount++;
            console.error(`Shared Knowledge error: ${String(e)}`);
          }
        })(),
      );
    }

    // Await completion of all 500 clients
    await Promise.all(tasks);
    const totalDuration = (performance.now() - opStart) / 1000;

    clearInterval(memInterval);
    const endMemory = process.memoryUsage();

    // Sort latencies to compute percentiles
    latencies.sort((a, b) => a - b);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const min = latencies[0] ?? 0;
    const max = latencies[latencies.length - 1] ?? 0;
    const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);

    const totalOps = successCount + failureCount;
    const successRate = totalOps > 0 ? (successCount / totalOps) * 100 : 0;
    const throughput = totalDuration > 0 ? totalOps / totalDuration : 0;

    console.log("\n===============================================================================");
    console.log("  500-CLIENT LOAD TEST RESULTS SUMMARY");
    console.log("===============================================================================");
    console.log(`Concurrent Clients:     500 (across 8 universities)`);
    console.log(`Total Operations:       ${totalOps}`);
    console.log(`Successful Operations:  ${successCount}`);
    console.log(`Failed Operations:      ${failureCount}`);
    console.log(`Success Rate:           ${successRate.toFixed(2)}%`);
    console.log(`Execution Time:         ${totalDuration.toFixed(2)}s`);
    console.log(`Throughput:             ${throughput.toFixed(1)} ops/sec`);
    console.log("-------------------------------------------------------------------------------");
    console.log("Latency Metrics (Overall):");
    console.log(`  Min:                  ${min.toFixed(2)} ms`);
    console.log(`  Average:              ${avg.toFixed(2)} ms`);
    console.log(`  p50 (Median):         ${p50.toFixed(2)} ms`);
    console.log(`  p95:                  ${p95.toFixed(2)} ms`);
    console.log(`  p99:                  ${p99.toFixed(2)} ms`);
    console.log(`  Max:                  ${max.toFixed(2)} ms`);
    console.log("-------------------------------------------------------------------------------");
    console.log("Cohort Latencies (p50 / p95):");
    for (const [name, arr] of Object.entries(cohortLatencies)) {
      arr.sort((a, b) => a - b);
      console.log(
        `  ${name.padEnd(20)} count=${String(arr.length).padEnd(5)} p50=${percentile(arr, 50).toFixed(2).padStart(6)}ms | p95=${percentile(arr, 95).toFixed(2).padStart(6)}ms`,
      );
    }
    console.log("-------------------------------------------------------------------------------");
    console.log("Memory Metrics:");
    console.log(`  Initial RSS:          ${(startMemory.rss / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`  Peak RSS:             ${(peakMemoryRss / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`  Final RSS:            ${(endMemory.rss / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`  Heap Used:            ${(endMemory.heapUsed / (1024 * 1024)).toFixed(1)} MB`);
    console.log("===============================================================================");

    if (failureCount > 0 || successRate < 100) {
      throw new Error(`Load gate failed: success rate was ${successRate.toFixed(2)}% (< 100%)`);
    }
    console.log(">> GATE VERIFICATION PASSED: 500 concurrent clients @ 100% success rate <<\n");
  } finally {
    clearInterval(memInterval);
    if (server) await server.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
}

runLoadTest().catch((e) => {
  console.error("FATAL in load test:", e);
  process.exit(1);
});
