import { readFile, writeFile } from "node:fs/promises";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output)
  throw new Error(
    "usage: node scripts/summarize-cpuprofile.mjs input.cpuprofile output.json",
  );
const profile = JSON.parse(await readFile(input, "utf8"));
const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
const selfMicros = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i];
  selfMicros.set(
    id,
    (selfMicros.get(id) ?? 0) + (profile.timeDeltas?.[i] ?? 0),
  );
}
const totalMicros = [...selfMicros.values()].reduce(
  (sum, value) => sum + value,
  0,
);
const top = [...selfMicros.entries()]
  .map(([id, micros]) => ({
    function: nodes.get(id)?.functionName ?? "unknown",
    url: nodes.get(id)?.url ?? "",
    line: (nodes.get(id)?.lineNumber ?? -1) + 1,
    selfMs: Math.round(micros / 1000),
    sharePercent: Number(((micros / totalMicros) * 100).toFixed(2)),
  }))
  .sort((a, b) => b.selfMs - a.selfMs)
  .slice(0, 30);
await writeFile(
  output,
  `${JSON.stringify({ source: input, samples: profile.samples.length, totalSampledMs: Math.round(totalMicros / 1000), top }, null, 2)}\n`,
);
