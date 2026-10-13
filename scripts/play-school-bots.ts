import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { botSchools } from "../shared/simulation/schoolBots.ts";
import {
  assertBotOutputDirectory,
  botDatabase,
  parseBotOptions,
} from "./simulation/config.ts";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const database = botDatabase(
  process.env.R2PL_BOT_DATABASE_URL,
  process.env.R2PL_BOT_SIMULATION,
);
const relativeOutput = `docs/benchmarks/bots/ui-${randomUUID()}`;
const directory = resolve(workspace, relativeOutput);
await assertBotOutputDirectory(workspace, directory);
await mkdir(directory, { recursive: true });
const supplied = process.argv.slice(2);
const defaults = [
  "--duration=600",
  "--credits=10000",
  "--max-actions=100000",
  "--retry-every=25",
  "--reconnect-every=0",
];
const args = [
  ...defaults.filter(
    (arg) =>
      !supplied.some((value) => value.split("=")[0] === arg.split("=")[0]),
  ),
  ...supplied,
  `--output=${relativeOutput}`,
];
const options = parseBotOptions(args, workspace);
const schools = botSchools(options.layout, options.regionSize);
const page = await readFile(
  new URL("./simulation/observer.html", import.meta.url),
);
let child: ReturnType<typeof spawn> | undefined;
let status = "starting";
let exitCode: number | null = null;
async function artifact(name: string): Promise<Buffer> {
  const entries = await readdir(directory, { withFileTypes: true });
  const run = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name))[0];
  if (!run) throw new Error("No run yet");
  return readFile(resolve(directory, run.name, name));
}
const web = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  try {
    const path = new URL(request.url ?? "/", "http://127.0.0.1:4175").pathname;
    if (path === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(page);
    } else if (path === "/api/live") {
      let live: unknown = null;
      let report: unknown = null;
      try {
        live = JSON.parse((await artifact("live.json")).toString());
      } catch {}
      if (status === "finished") {
        try {
          report = JSON.parse((await artifact("report.json")).toString());
        } catch {}
      }
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          status,
          exitCode,
          live,
          report,
          duration: options.duration,
          botsPerSchool: options.botsPerSchool,
          schools: schools.map((s) => ({
            label: s.label,
            color: s.color,
            slot: s.slot,
            rate: options.rates[s.slot],
          })),
        }),
      );
    } else if (path === "/map.svg") {
      response.setHeader("Content-Type", "image/svg+xml");
      response.end(await artifact("map.svg"));
    } else response.writeHead(404).end();
  } catch {
    response.writeHead(503).end("Simulation is starting; retry shortly.");
  }
});
await new Promise<void>((ready, reject) => {
  web.once("error", reject);
  web.listen(4175, "127.0.0.1", ready);
});
child = spawn(
  process.execPath,
  ["--experimental-strip-types", "scripts/simulate-school-bots.ts", ...args],
  {
    cwd: workspace,
    env: { ...process.env, R2PL_BOT_DATABASE_URL: database },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stdout?.on("data", (data: Buffer) => {
  if (data.toString().includes("[bots]")) status = "running";
  process.stdout.write(data);
});
child.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
child.once("error", () => {
  status = "failed";
});
child.once("exit", (code) => {
  exitCode = code;
  status = "finished";
});
console.log(
  "Bot observer UI: http://127.0.0.1:4175 — local synthetic admin view",
);
console.log(
  "24 bots by default, 8 schools; 10 minute run, snapshots every ~5 seconds.",
);
function stop(): void {
  child?.kill();
  web.close();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
