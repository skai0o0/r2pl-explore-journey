import { mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { type Room as ClientRoom, ColyseusSDK } from "@colyseus/sdk";
import { createSyntheticServer } from "../server/realtime/bootstrap.ts";
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
import { CHUNK_SIZE, WORLD_WIDTH } from "../shared/world/constants.ts";
import { chunkCoordinatesForId, chunkId } from "../shared/world/coordinates.ts";
import { SchoolRegistry, schoolBit } from "../shared/world/registry.ts";

function option(name: string, fallback: string): string {
  return (
    process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] ??
    fallback
  );
}
const clients = Number(option("clients", "100"));
const mode = option("mode", "balanced");
const durationSeconds = Number(option("duration", "6"));
const rate = Number(option("rate", "20"));
if (
  !Number.isInteger(clients) ||
  clients < 1 ||
  clients > 1000 ||
  !["balanced", "hotspot"].includes(mode) ||
  !Number.isFinite(durationSeconds) ||
  durationSeconds <= 0 ||
  !Number.isFinite(rate) ||
  rate <= 0
)
  throw new Error("Invalid benchmark arguments");

const targetChunks = Array.from({ length: 16 }, (_, sector) =>
  chunkId((sector % 4) * 4, Math.floor(sector / 4) * 4),
);
const percentile = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) =>
    Number((sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0).toFixed(3));
  return {
    count: values.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
  };
};
const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, Math.max(0, milliseconds)),
  );
const actionKey = (n: number) => {
  const key = new Uint8Array(16);
  new DataView(key.buffer).setUint32(0, n, true);
  key[15] = 0xa5;
  return key;
};

class LoadPeer {
  readonly room: ClientRoom;
  readonly slot: number;
  readonly chunk: number;
  readonly replica: ProjectionReplica;
  readonly timings: number[] = [];
  readonly #pending = new Map<
    string,
    {
      sentAt: number;
      resolve: (ack: Ack) => void;
      reject: (error: Error) => void;
    }
  >();
  bytesReceived = 0;
  framesReceived = 0;
  resyncs = 0;
  errors = 0;
  snapshotReady = false;

  constructor(room: ClientRoom, slot: number, chunk: number) {
    this.room = room;
    this.slot = slot;
    this.chunk = chunk;
    this.replica = new ProjectionReplica(slot);
    room.onMessage("m2", (raw: Uint8Array) => {
      const bytes = Uint8Array.from(raw);
      this.bytesReceived += bytes.byteLength;
      this.framesReceived++;
      const frame = decodeFrame(bytes);
      if (frame.kind === M2_KIND.SNAPSHOT) {
        const snapshot = decodeSnapshot(frame.payload);
        this.replica.applySnapshot(snapshot);
        this.snapshotReady = true;
      } else if (frame.kind === M2_KIND.DELTA) {
        const delta = decodeDelta(frame.payload);
        if (this.replica.applyDelta(delta) === "resync") {
          this.resyncs++;
          this.room.sendBytes("m2", encodeResync(delta.chunkId));
        }
      } else if (frame.kind === M2_KIND.ACK) {
        const ack = decodeAck(frame.payload);
        const pending = this.#pending.get(Buffer.from(ack.key).toString("hex"));
        if (pending) {
          this.timings.push(performance.now() - pending.sentAt);
          this.#pending.delete(Buffer.from(ack.key).toString("hex"));
          pending.resolve(ack);
        }
      } else if (frame.kind === M2_KIND.ERROR) this.errors++;
    });
  }

  subscribe(): void {
    this.room.sendBytes("m2", encodeSubscribe([this.chunk]));
  }
  explore(tileIndex: number, key: Uint8Array): Promise<Ack> {
    const hex = Buffer.from(key).toString("hex");
    return new Promise<Ack>((resolve, reject) => {
      this.#pending.set(hex, { sentAt: performance.now(), resolve, reject });
      this.room.sendBytes(
        "m2",
        encodeExplore({ key, tileIndex, ruleVersion: 0 }),
      );
    });
  }
  rejectPending(): void {
    for (const pending of this.#pending.values())
      pending.reject(new Error("Benchmark ended before ack"));
    this.#pending.clear();
  }
}

const registry = new SchoolRegistry([
  { id: "fixture-a", slot: 0 },
  { id: "fixture-b", slot: 15 },
]);
const fixtures = Array.from({ length: clients }, (_, i) => ({
  token: `load-token-${i}`,
  actorId: `load-actor-${i}`,
  schoolSlot: i % 2 ? 15 : 0,
}));
const server = createSyntheticServer(registry, fixtures);
const peers: LoadPeer[] = [];
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();
const cpuBefore = process.cpuUsage();
const runStarted = performance.now();
let connectionSeconds = 0,
  actionSeconds = 0,
  disconnectSeconds = 0;
let result: Record<string, unknown> | undefined;
try {
  await server.server.listen(0, "127.0.0.1");
  const address = server.transport.server?.address();
  if (!address || typeof address === "string")
    throw new Error("Missing loopback port");
  const sdk = new ColyseusSDK(`ws://127.0.0.1:${address.port}`);
  const connectStarted = performance.now();
  const firstRoom = await sdk.joinOrCreate("m2", { token: fixtures[0]!.token });
  peers.push(
    new LoadPeer(firstRoom, fixtures[0]!.schoolSlot, targetChunks[0]!),
  );
  for (let start = 1; start < clients; start += 25) {
    const batch = fixtures.slice(start, Math.min(clients, start + 25));
    const rooms = await Promise.all(
      batch.map((fixture) =>
        sdk.joinById(firstRoom.roomId, { token: fixture.token }),
      ),
    );
    rooms.forEach((room, i) => {
      const index = start + i;
      const chunk =
        mode === "hotspot" && index % 10 < 7
          ? targetChunks[0]!
          : targetChunks[index % 16]!;
      peers.push(new LoadPeer(room, fixtures[index]!.schoolSlot, chunk));
    });
  }
  connectionSeconds = (performance.now() - connectStarted) / 1000;
  for (const peer of peers) peer.subscribe();
  const snapshotDeadline = Date.now() + 20_000;
  while (
    peers.some((peer) => !peer.snapshotReady) &&
    Date.now() < snapshotDeadline
  )
    await sleep(10);
  if (peers.some((peer) => !peer.snapshotReady))
    throw new Error("Initial snapshot timeout");

  const count = Math.round(rate * durationSeconds);
  const actionStarted = performance.now();
  const acks: Promise<Ack>[] = [];
  for (let n = 0; n < count; n++) {
    const targetTime = actionStarted + (n * 1000) / rate;
    if (performance.now() < targetTime)
      await sleep(targetTime - performance.now());
    const chunk =
      mode === "hotspot" && n % 10 < 7
        ? targetChunks[0]!
        : targetChunks[n % 16]!;
    const { chunkX, chunkZ } = chunkCoordinatesForId(chunk);
    const local = (n * 17) % 4096;
    const tile =
      (chunkZ * CHUNK_SIZE + Math.floor(local / CHUNK_SIZE)) * WORLD_WIDTH +
      chunkX * CHUNK_SIZE +
      (local % CHUNK_SIZE);
    acks.push(peers[n % peers.length]!.explore(tile, actionKey(n)));
  }
  let ackTimeout: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    ackTimeout = setTimeout(() => reject(new Error("Ack timeout")), 20_000);
  });
  let outcomes: Ack[];
  try {
    outcomes = await Promise.race([Promise.all(acks), timeout]);
  } finally {
    if (ackTimeout) clearTimeout(ackTimeout);
  }
  actionSeconds = (performance.now() - actionStarted) / 1000;
  if (outcomes.some((ack) => ack.status === ACK_STATUS.REJECTED))
    throw new Error("Rejected synthetic action under load");

  const converged = () =>
    peers.every((peer) => {
      const { chunkX, chunkZ } = chunkCoordinatesForId(peer.chunk);
      for (let local = 0; local < 4096; local++) {
        const tile =
          (chunkZ * CHUNK_SIZE + Math.floor(local / CHUNK_SIZE)) * WORLD_WIDTH +
          chunkX * CHUNK_SIZE +
          (local % CHUNK_SIZE);
        if (
          peer.replica.maskAt(peer.chunk, local) !==
          (server.core.world.maskAt(tile) & schoolBit(peer.slot))
        )
          return false;
        if (
          peer.replica.isDiscovered(peer.chunk, local) !==
          server.core.world.isRevealed(tile, peer.slot)
        )
          return false;
      }
      return true;
    });
  const convergenceStarted = performance.now();
  while (!converged() && performance.now() - convergenceStarted < 10_000)
    await sleep(20);
  const convergenceMs = performance.now() - convergenceStarted;
  if (!converged())
    throw new Error("Client replicas diverged from authoritative projection");

  const memory = process.memoryUsage();
  const cpu = process.cpuUsage(cpuBefore);
  result = {
    environment: {
      node: process.version,
      platform: process.platform,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      ramBytes: totalmem(),
      generator: "same Node process and host as server",
    },
    workload: {
      clients,
      mode,
      durationSeconds,
      targetActions: count,
      requestedActionsPerSecond: rate,
      hotspotSectorShare: mode === "hotspot" ? 0.7 : 0.0625,
      schools: 2,
      subscribedChunksPerClient: 1,
    },
    outcomes: {
      connected: peers.length,
      acknowledged: outcomes.length,
      applied: outcomes.filter((ack) => ack.status === ACK_STATUS.TEST_APPLIED)
        .length,
      noChange: outcomes.filter(
        (ack) => ack.status === ACK_STATUS.TEST_NO_CHANGE,
      ).length,
      converged: true,
      convergenceCheckMs: convergenceMs,
      resyncs: peers.reduce((sum, peer) => sum + peer.resyncs, 0),
      clientErrors: peers.reduce((sum, peer) => sum + peer.errors, 0),
    },
    timings: {
      connectionSeconds,
      connectionRatePerSecond: clients / connectionSeconds,
      actionSeconds,
      acknowledgedActionsPerSecond: outcomes.length / actionSeconds,
      clientAckMs: percentile(peers.flatMap((peer) => peer.timings)),
      server: server.core.metrics.snapshot().histograms,
    },
    traffic: {
      receivedBytesPerClient: percentile(
        peers.map((peer) => peer.bytesReceived),
      ),
      receivedFramesPerClient: percentile(
        peers.map((peer) => peer.framesReceived),
      ),
      serverCounters: server.core.metrics.snapshot().counters,
    },
    resources: {
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      arrayBufferBytes: memory.arrayBuffers,
      eventLoopLagP95Ms: lag.percentile(95) / 1e6,
    },
    limitations: [
      "Single-host loopback and same-process load generator; not a production CCU claim",
      "M2 state and idempotency are ephemeral; no database or durable acknowledgements",
      "M2 payload byte counts exclude Colyseus/WebSocket framing overhead",
    ],
  };
} finally {
  const disconnectStarted = performance.now();
  for (let start = 0; start < peers.length; start += 50)
    await Promise.allSettled(
      peers.slice(start, start + 50).map((peer) => peer.room.leave()),
    );
  disconnectSeconds = (performance.now() - disconnectStarted) / 1000;
  await server.server.gracefullyShutdown(false);
  lag.disable();
  for (const peer of peers) peer.rejectPending();
}
if (result) {
  result.disconnectSeconds = disconnectSeconds;
  result.totalWallSeconds = (performance.now() - runStarted) / 1000;
  const path = `docs/benchmarks/M2_${clients}_${mode}.json`;
  await mkdir("docs/benchmarks", { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ path, ...result }, null, 2));
}
