import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { Pool } from "pg";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { cleanupSchoolRewards } from "../server/integration/SchoolRewardFixture.ts";
import {
  LANDMARKS,
  NEUTRAL_UNISTOPS,
  SCHOOLS,
} from "../shared/gameplay/gameConfig.ts";
import {
  ACK_STATUS,
  type Ack,
  decodeAck,
  decodeDelta,
  decodeFrame,
  decodeSnapshot,
  encodeExplore,
  encodeResync,
  encodeSubscribe,
  M2_KIND,
} from "../shared/protocol/m2.ts";
import { ProjectionReplica } from "../shared/protocol/replica.ts";
import { crc32 } from "../shared/world/checksum.ts";
import { chunkId, localIndex, tileIndex } from "../shared/world/coordinates.ts";
import { botDatabase } from "./simulation/config.ts";
import { cleanupBotFixture, migrateBotFixture } from "./simulation/fixture.ts";

const dbUrl = botDatabase(
  process.env.R2PL_LOADTEST_DATABASE_URL ??
    process.env.R2PL_PREPARATION_DATABASE_URL ??
    "postgresql://prep_fixture@127.0.0.1:55439/r2pl_prep_test_current",
  "1",
);
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
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

interface Peer {
  actor: { token: string; actorId: string; schoolSlot: number };
  room: Room;
  replica: ProjectionReplica;
  chunks: number[];
  error: string | null;
  x: number;
  z: number;
  cohort: number;
  pending: Map<
    string,
    {
      resolve: (ack: Ack) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >;
}
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((sorted.length * p) / 100) - 1)] ?? 0;
}
async function main(): Promise<void> {
  migrateBotFixture(dbUrl, fileURLToPath(new URL("../", import.meta.url)));
  const pool = new Pool({ connectionString: dbUrl, max: 24 });
  const campaign = randomUUID();
  const peers: Peer[] = [];
  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  let live = 0,
    peakConnections = 0,
    peakRss = process.memoryUsage().rss;
  const initialRss = peakRss;
  const memoryTimer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 100);
  const latencies: Record<string, number[]> = {};
  const failures: string[] = [];
  async function measure(
    name: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const start = performance.now();
    try {
      await task();
      latencies[name] ??= [];
      latencies[name].push(performance.now() - start);
    } catch (e) {
      failures.push(`${name}: ${String(e)}`);
    }
  }
  async function explore(peer: Peer, x: number, z: number): Promise<void> {
    const key = randomBytes(16),
      hex = key.toString("hex");
    const ack = await new Promise<Ack>((resolve, reject) => {
      const timer = setTimeout(() => {
        peer.pending.delete(hex);
        reject(new Error("ACK timeout"));
      }, 30000);
      peer.pending.set(hex, { resolve, reject, timer });
      peer.room.sendBytes(
        "m2",
        encodeExplore({ key, tileIndex: tileIndex(x, z), ruleVersion: 1 }),
      );
    });
    assert.equal(
      ack.status,
      ACK_STATUS.TEST_APPLIED,
      "must mutate, no-change/rejections fail gate",
    );
  }
  try {
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
      { actorsPerSchool: 63 },
    );
    const http = `http://127.0.0.1:${server.webPort}`,
      ws = `ws://127.0.0.1:${server.websocketPort}`;
    // Round robin gives 63/63/63/63/62/62/62/62 active school sessions.
    const actors = Array.from(
      { length: 500 },
      (_, i) =>
        server!.fixture.actors.filter((a) => a.schoolSlot === i % 8)[
          Math.floor(i / 8)
        ]!,
    );
    const assignments = actors.map((actor, i) => ({
      actor,
      x: 50 + actor.schoolSlot * 110,
      z: 30 + Math.floor(i / 8) * 3,
      cohort: Math.floor(i / 8) % 4,
    }));
    for (const p of assignments) {
      await injectTile(pool, campaign, p.actor.schoolSlot, p.x, p.z);
      if (p.cohort === 0)
        await injectTile(
          pool,
          campaign,
          (p.actor.schoolSlot + 1) % 8,
          p.x + 2,
          p.z,
        );
    }
    for (let s = 0; s < 8; s++) {
      const stop = NEUTRAL_UNISTOPS[s]!,
        landmark = LANDMARKS[s]!;
      await injectTile(pool, campaign, s, stop.x - stop.width / 2 - 2, stop.z);
      await injectTile(pool, campaign, s, landmark.x, landmark.z);
    }
    // Upkeep fixtures exercise persistent lifecycle payment; shared joins above are real WS mutations.
    for (let s = 0; s < 4; s++)
      await pool.query(
        "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'shared-cluster',$2,$3)",
        [
          campaign,
          `load-cluster-${s}`,
          JSON.stringify({
            id: `load-cluster-${s}`,
            pair: [s * 2, s * 2 + 1],
            tiles: [{ tile: 900000 + s * 1000 }],
            due: {
              [s * 2]: Date.now() + 86400000,
              [s * 2 + 1]: Date.now() + 86400000,
            },
            createdAt: Date.now() - 90000000,
            escrow: {},
            guest: s * 2 + 1,
            status: "shared",
            required: 0,
            hardUntil: 0,
            rollingUntil: 0,
          }),
        ],
      );
    let roomId: string | undefined;
    console.log("Connecting 500 authenticated WebSocket peers...");
    // Establish first room once; all remaining sessions join it in bounded batches.
    for (let offset = 0; offset < 500; offset += offset === 0 ? 1 : 25) {
      const batch =
        offset === 0
          ? assignments.slice(0, 1)
          : assignments.slice(offset, offset + 25);
      await Promise.all(
        batch.map(async (p) => {
          const sdk = new ColyseusSDK(ws);
          const room: Room = roomId
            ? await sdk.joinById(roomId, { token: p.actor.token })
            : await sdk.joinOrCreate("m2", { token: p.actor.token });
          roomId ??= room.roomId;
          room.reconnection.enabled = false;
          const stop = NEUTRAL_UNISTOPS[p.actor.schoolSlot]!;
          const chunks = [
            ...new Set([
              chunkId(Math.floor(p.x / 64), Math.floor(p.z / 64)),
              chunkId(Math.floor((p.x + 2) / 64), Math.floor(p.z / 64)),
              chunkId(
                Math.floor((stop.x - stop.width / 2 - 1) / 64),
                Math.floor(stop.z / 64),
              ),
            ]),
          ].sort((a, b) => a - b);
          const peer: Peer = {
            ...p,
            room,
            replica: new ProjectionReplica(p.actor.schoolSlot),
            chunks,
            pending: new Map(),
            error: null,
          };
          peers.push(peer);
          live++;
          peakConnections = Math.max(peakConnections, live);
          room.onLeave(() => {
            live--;
            peer.error ??= "unexpected disconnect";
          });
          room.onError(() => {
            peer.error ??= "transport error";
          });
          room.onMessage("m2", (raw: Uint8Array) => {
            try {
              const frame = decodeFrame(Uint8Array.from(raw));
              if (frame.kind === M2_KIND.SNAPSHOT)
                peer.replica.applySnapshot(decodeSnapshot(frame.payload));
              else if (frame.kind === M2_KIND.DELTA) {
                const d = decodeDelta(frame.payload);
                if (peer.replica.applyDelta(d) === "resync")
                  room.sendBytes("m2", encodeResync(d.chunkId));
              } else if (frame.kind === M2_KIND.ACK) {
                const ack = decodeAck(frame.payload),
                  hex = Buffer.from(ack.key).toString("hex"),
                  pending = peer.pending.get(hex);
                if (pending) {
                  clearTimeout(pending.timer);
                  peer.pending.delete(hex);
                  pending.resolve(ack);
                }
              } else if (frame.kind === M2_KIND.ERROR)
                peer.error = "protocol error";
            } catch (e) {
              peer.error = String(e);
            }
          });
          room.sendBytes("m2", encodeSubscribe(chunks));
        }),
      );
    }
    const readyDeadline = performance.now() + 30000;
    while (
      peers.some((p) => p.chunks.some((c) => !p.replica.hasChunk(c))) &&
      performance.now() < readyDeadline
    )
      await pause(20);
    assert.equal(server.realtime.core.connected, 500);
    assert.equal(live, 500);
    assert.equal(peers.length, 500);
    assert.ok(peers.every((p) => p.chunks.every((c) => p.replica.hasChunk(c))));
    const start = performance.now();
    await Promise.all(
      SCHOOLS.map((school, s) =>
        measure("capture", () => {
          const stop = NEUTRAL_UNISTOPS[s]!;
          return explore(
            peers.find((p) => p.actor.schoolSlot === school.slot)!,
            stop.x - stop.width / 2 - 1,
            stop.z,
          );
        }),
      ),
    );
    async function command(
      peer: Peer,
      body: Record<string, unknown>,
    ): Promise<void> {
      const response = await fetch(`${http}/api/game`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${peer.actor.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ruleVersion: 1, key: randomUUID(), ...body }),
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(response.status, 200);
      const result = (await response.json()) as { status: string };
      assert.equal(result.status, "applied");
    }
    await Promise.all(
      peers.map(async (p) => {
        await measure("explore", () => explore(p, p.x + 1, p.z));
        if (p.cohort === 0)
          await measure("shared_join", () => explore(p, p.x + 2, p.z));
        else if (p.cohort === 1)
          await measure("unistop_spin", () =>
            command(p, {
              action: "spin",
              target: NEUTRAL_UNISTOPS[p.actor.schoolSlot]!.id,
            }),
          );
        else if (p.cohort === 2)
          await measure("landmark_crystal", () =>
            command(p, {
              action: "contribute",
              target: LANDMARKS[p.actor.schoolSlot]!.id,
              amount: 10,
            }),
          );
        else
          await measure("shared_upkeep", () =>
            command(p, {
              action: "upkeep",
              target: `load-cluster-${Math.floor(p.actor.schoolSlot / 2)}`,
              amount: 1,
            }),
          );
      }),
    );
    const durationMs = performance.now() - start;
    assert.equal(live, 500, "all connections held through mixed mutations");
    // Drain relay, then compare EVERY subscribed mask/fog bit and revision with PostgreSQL.
    const convergeStart = performance.now(),
      deadline = convergeStart + 30000;
    let mismatches = 0,
      pendingOutbox = 0;
    do {
      await pause(100);
      const masks = (
        await pool.query<{ chunk_id: number; mask: Buffer }>(
          "SELECT chunk_id,mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1",
          [campaign],
        )
      ).rows;
      const fogs = (
        await pool.query<{
          chunk_id: number;
          school_slot: number;
          fog: Buffer;
        }>(
          "SELECT chunk_id,school_slot,fog FROM r2pl_v2.school_fog_chunks WHERE campaign_id=$1",
          [campaign],
        )
      ).rows;
      const revisions = (
        await pool.query<{
          chunk_id: number;
          school_slot: number;
          view_revision: string;
        }>(
          "SELECT chunk_id,school_slot,view_revision::text FROM r2pl_v2.school_chunk_views WHERE campaign_id=$1",
          [campaign],
        )
      ).rows;
      pendingOutbox = Number(
        (
          await pool.query(
            "SELECT count(*) FROM r2pl_v2.outbox_events WHERE campaign_id=$1 AND delivered_at IS NULL",
            [campaign],
          )
        ).rows[0].count,
      );
      mismatches = 0;
      for (const p of peers)
        for (const c of p.chunks) {
          const mask =
              masks.find((r) => r.chunk_id === c)?.mask ?? Buffer.alloc(8192),
            fog =
              fogs.find(
                (r) => r.chunk_id === c && r.school_slot === p.actor.schoolSlot,
              )?.fog ?? Buffer.alloc(512);
          const revision = BigInt(
            revisions.find(
              (r) => r.chunk_id === c && r.school_slot === p.actor.schoolSlot,
            )?.view_revision ?? "0",
          );
          let mismatch = p.replica.revision(c) !== revision;
          for (let local = 0; local < 4096 && !mismatch; local++)
            mismatch =
              p.replica.maskAt(c, local) !==
                (mask.readUInt16LE(local * 2) & (1 << p.actor.schoolSlot)) ||
              p.replica.isDiscovered(c, local) !==
                !!(fog[local >> 3]! & (1 << (local & 7)));
          if (mismatch) mismatches++;
        }
    } while ((mismatches || pendingOutbox) && performance.now() < deadline);
    const stops = (
      await pool.query<{
        id: string;
        data: { ownerSchoolSlot: number; ownerSchoolId: string };
      }>(
        "SELECT id,data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 AND data->>'kind'='unistop'",
        [campaign],
      )
    ).rows;
    for (let s = 0; s < 8; s++) {
      const stop = stops.find((r) => r.id === NEUTRAL_UNISTOPS[s]!.id)!;
      assert.equal(stop.data.ownerSchoolSlot, s);
      assert.equal(stop.data.ownerSchoolId, SCHOOLS[s]!.id);
    }
    const ledgerMismatches = Number(
      (
        await pool.query(
          "SELECT count(*) FROM r2pl_v2.wallet_accounts w WHERE campaign_id=$1 AND balance<>opening_balance+COALESCE((SELECT sum(amount) FROM r2pl_v2.ledger_entries l WHERE l.campaign_id=w.campaign_id AND l.actor_id=w.actor_id AND l.resource=w.resource),0)",
          [campaign],
        )
      ).rows[0].count,
    );
    const samples = Object.values(latencies).flat(),
      errors = peers.filter((p) => p.error).map((p) => p.error);
    const summary = {
      runAt: new Date().toISOString(),
      gate: "17/10/2026",
      clients: 500,
      peakConnections,
      liveAtCompletion: live,
      serverConnectionsAtCompletion: server.realtime.core.connected,
      schools: SCHOOLS.map((s) => ({
        school: s.id,
        clients: peers.filter((p) => p.actor.schoolSlot === s.slot).length,
      })),
      operations: samples.length + failures.length,
      success: samples.length,
      failed: failures.length,
      successRate: (samples.length / (samples.length + failures.length)) * 100,
      durationMs,
      throughput: samples.length / (durationMs / 1000),
      p50Ms: percentile(samples, 50),
      p95Ms: percentile(samples, 95),
      cohorts: Object.fromEntries(
        Object.entries(latencies).map(([k, v]) => [
          k,
          {
            count: v.length,
            p50Ms: percentile(v, 50),
            p95Ms: percentile(v, 95),
          },
        ]),
      ),
      memory: {
        initialRssMB: initialRss / 1048576,
        peakRssMB: peakRss / 1048576,
        finalRssMB: process.memoryUsage().rss / 1048576,
        heapUsedMB: process.memoryUsage().heapUsed / 1048576,
        scope: "combined in-process server + 500 clients; not a leak/soak test",
      },
      convergence: {
        mismatches,
        pendingOutbox,
        ledgerMismatches,
        ms: performance.now() - convergeStart,
        transportErrors: errors,
      },
      failures,
    };
    console.log(JSON.stringify(summary, null, 2));
    assert.equal(failures.length, 0);
    assert.equal(errors.length, 0);
    assert.equal(mismatches, 0);
    assert.equal(pendingOutbox, 0);
    assert.equal(ledgerMismatches, 0);
    console.log("500-CONNECTION MIXED GATE PASS");
  } finally {
    clearInterval(memoryTimer);
    await Promise.allSettled(peers.map((p) => p.room.leave()));
    await server?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
