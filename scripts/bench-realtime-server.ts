import { cpus } from "node:os";
import { createSyntheticServer } from "../server/realtime/bootstrap.ts";
import { SyntheticVisibilityProjection } from "../server/realtime/VisibilityProjection.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";

const clients = Number(process.argv[2]);
const fanoutMode = process.argv[3] === "indexed" ? "indexed" : "scan";
if (!Number.isInteger(clients) || clients < 1 || clients > 2000)
  throw new Error("Invalid client count");
const fixture = createSyntheticServer(
  new SchoolRegistry([
    { id: "fixture-a", slot: 0 },
    { id: "fixture-b", slot: 15 },
  ]),
  Array.from({ length: clients }, (_, i) => ({
    token: `load-token-${i}`,
    actorId: `load-actor-${i}`,
    schoolSlot: i % 2 ? 15 : 0,
  })),
  { fanoutMode },
);
const cpuBefore = process.cpuUsage();
await fixture.server.listen(0, "127.0.0.1");
const address = fixture.transport.server?.address();
if (!address || typeof address === "string")
  throw new Error("No loopback port");
process.send?.({ type: "ready", port: address.port });
process.on("message", async (message: unknown) => {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  if (message.type === "summary") {
    const cpu = process.cpuUsage(cpuBefore);
    const projection = new SyntheticVisibilityProjection(fixture.core.world);
    const pairs =
      "pairs" in message && Array.isArray(message.pairs) ? message.pairs : [];
    const projections = pairs.map((pair: { slot: number; chunk: number }) => {
      const snapshot = projection.snapshot(pair.slot, pair.chunk, 0n);
      return {
        slot: pair.slot,
        chunk: pair.chunk,
        mask: Buffer.from(snapshot.mask).toString("base64"),
        fog: Buffer.from(snapshot.fog).toString("base64"),
      };
    });
    process.send?.({
      type: "summary",
      projections,
      metrics: fixture.core.metrics.snapshot(),
      resources: {
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        memory: process.memoryUsage(),
        logicalCpus: cpus().length,
      },
    });
  } else if (message.type === "stop") {
    await fixture.server.gracefullyShutdown(false);
    process.exit(0);
  }
});
