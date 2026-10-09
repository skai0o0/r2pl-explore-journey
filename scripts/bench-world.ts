import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import {
  CHUNK_COUNT,
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
  WORLD_TILE_COUNT,
} from "../shared/world/constants.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";
import { WorldState } from "../shared/world/world.ts";

const registry = new SchoolRegistry([
  { id: "fixture-a", slot: 0 },
  { id: "fixture-b", slot: 15 },
]);
const sample = <T>(
  count: number,
  action: () => T,
): { values: number[]; last: T } => {
  const values: number[] = [];
  let last!: T;
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    last = action();
    values.push(performance.now() - start);
  }
  return { values, last };
};
const percentiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    p50Ms: Number(sorted[Math.floor((sorted.length - 1) * 0.5)]!.toFixed(3)),
    p95Ms: Number(sorted[Math.floor((sorted.length - 1) * 0.95)]!.toFixed(3)),
    maxMs: Number(sorted.at(-1)!.toFixed(3)),
  };
};
const memory = () => {
  global.gc?.();
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapUsed, external, arrayBuffers };
};

const baseline = memory();
const world = new WorldState(registry);
const emptyWorld = memory();
sample(3, () => new WorldState(registry));
const initialization = sample(20, () => new WorldState(registry));
// Sparse, deterministic fixture: 50,000 presence cells; two isolated fog chunks.
for (let n = 0; n < 50_000; n++)
  world.setPresence((n * 19) % WORLD_TILE_COUNT, n & 1 ? 15 : 0, true);
world.reveal(0, 0);
world.reveal(WORLD_TILE_COUNT - 1, 15);
world.setMetadata({
  tileIndex: 0,
  schoolSlot: 0,
  formatVersion: 1,
  payload: Uint8Array.of(1, 2, 3, 4),
});
const populatedWorld = memory();
sample(2, () => world.snapshot());
const serialization = sample(15, () => world.snapshot());
const snapshot = serialization.last;
const withSnapshot = memory();
sample(2, () => WorldState.restore(snapshot, registry));
const restoration = sample(10, () => WorldState.restore(snapshot, registry));
if (
  restoration.last.maskAt(0) !== world.maskAt(0) ||
  !restoration.last.isRevealed(WORLD_TILE_COUNT - 1, 15)
) {
  throw new Error("Benchmark fixture failed round-trip");
}
const payloadBytes =
  snapshot.chunks.reduce((sum, record) => sum + record.payload.byteLength, 0) +
  snapshot.fog.reduce((sum, record) => sum + record.payload.byteLength, 0) +
  snapshot.metadata.reduce((sum, record) => sum + record.payload.byteLength, 0);

console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        ramBytes: totalmem(),
        gcExposed: !!global.gc,
      },
      workload: {
        cells: WORLD_TILE_COUNT,
        presenceMutations: 50_000,
        fogReveals: 2,
        metadataRecords: 1,
      },
      representation: {
        maskBytes: world.maskByteLength,
        fogAllocatedChunks: world.allocatedFogChunkCount,
        fogBytes: world.fogByteLength,
        metadataPayloadBytes: world.metadataByteLength,
        serializedChunkCount: CHUNK_COUNT,
        maskChunkBytes: CHUNK_MASK_BYTES,
        fogChunkBytes: CHUNK_FOG_BYTES,
        snapshotPayloadBytes: payloadBytes,
      },
      memoryBytes: { baseline, emptyWorld, populatedWorld, withSnapshot },
      timings: {
        initialize: percentiles(initialization.values),
        serialize: percentiles(serialization.values),
        restore: percentiles(restoration.values),
      },
    },
    null,
    2,
  ),
);
