import { readFile, writeFile } from "node:fs/promises";
import { chunkId } from "../shared/world/coordinates.ts";

const measured = JSON.parse(
  await readFile("docs/benchmarks/M25_1000_hotspot_scan_20s.json", "utf8"),
);
const {
  clients,
  durationSeconds,
  requestedActionsPerSecond: rate,
} = measured.workload;
const targetChunks = Array.from({ length: 16 }, (_, sector) =>
  chunkId((sector % 4) * 4, Math.floor(sector / 4) * 4),
);
const subscriberCount = new Map<string, number>();
for (let i = 0; i < clients; i++) {
  const slot = i % 2 ? 15 : 0;
  const chunk = i % 10 < 7 ? targetChunks[0]! : targetChunks[i % 16]!;
  const key = `${slot}:${chunk}`;
  subscriberCount.set(key, (subscriberCount.get(key) ?? 0) + 1);
}
const seen = new Set<string>();
const windows = new Map<string, { records: number; recipients: number }>();
let originalFrames = 0,
  applied = 0,
  noChange = 0;
for (let n = 0; n < Math.round(rate * durationSeconds); n++) {
  const slot = n % 2 ? 15 : 0;
  const chunk = n % 10 < 7 ? targetChunks[0]! : targetChunks[n % 16]!;
  const local = (n * 17) % 4096;
  const tileKey = `${slot}:${chunk}:${local}`;
  if (seen.has(tileKey)) {
    noChange++;
    continue;
  }
  seen.add(tileKey);
  applied++;
  const recipients = subscriberCount.get(`${slot}:${chunk}`) ?? 0;
  originalFrames += recipients;
  const window = Math.floor((n * 1000) / rate / 20);
  const groupKey = `${window}:${slot}:${chunk}`;
  const prior = windows.get(groupKey);
  windows.set(groupKey, { records: (prior?.records ?? 0) + 1, recipients });
}
let batchedFrames = 0,
  batchedPayloadBytes = 0;
for (const group of windows.values()) {
  batchedFrames += group.recipients;
  batchedPayloadBytes += group.recipients * (23 + group.records * 5);
}
const actualFanout = measured.traffic.serverCounters.fanout_recipients;
if (actualFanout !== originalFrames || measured.outcomes.applied !== applied)
  throw new Error(
    "Ideal workload model does not match measured action/fanout counts",
  );
const result = {
  basis:
    "Ideal scheduled 20 ms windows applied to the measured deterministic 1,000-client/20-second hotspot workload; modeling only, no batch wire implementation",
  validation: {
    measuredApplied: applied,
    measuredNoChange: noChange,
    measuredFanoutRecipients: actualFanout,
  },
  current: {
    deltaFrames: originalFrames,
    deltaPayloadBytes: originalFrames * 35,
  },
  hypotheticalV2Batch: {
    windowMs: 20,
    frameCount: batchedFrames,
    frameReductionPercent: Number(
      ((1 - batchedFrames / originalFrames) * 100).toFixed(2),
    ),
    payloadBytes: batchedPayloadBytes,
    payloadReductionPercent: Number(
      ((1 - batchedPayloadBytes / (originalFrames * 35)) * 100).toFixed(2),
    ),
    description:
      "12-byte envelope + 11-byte batch header + 5 bytes per ordered tile change; contiguous per-school revisions implied by record order",
  },
  sameTileCoalescing:
    "Not modeled as safe with M2's single-record revisioned DELTA. Skipping intermediate revisions would trigger a client gap and require a new versioned snapshot/batch contract.",
};
await writeFile(
  "docs/benchmarks/M25_batching_model.json",
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
