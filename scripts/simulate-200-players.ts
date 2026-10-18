import { performance } from "node:perf_hooks";

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1]!;
  return fallback;
}

const host = (
  getArg("host", process.env.TARGET_HOST ?? "http://127.0.0.1:4191")
).replace(/\/$/, "");
const count = Number(getArg("count", "200"));
const speed = getArg("speed", "realistic") as "slow" | "realistic" | "fast";
const duration = Number(getArg("duration", "3600"));

interface BotTelemetry {
  fixtureOnly: boolean;
  status: string;
  activeBots: number;
  totalActions: number;
  actionsPerSecond: number;
  schools: Array<{
    slot: number;
    label: string;
    activeBots: number;
    applied: number;
  }>;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(rm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderProgressBar(current: number, max: number, width = 20): string {
  const safeMax = Math.max(1, max);
  const ratio = Math.min(1, Math.max(0, current / safeMax));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

async function fetchTelemetry(): Promise<BotTelemetry | null> {
  try {
    const res = await fetch(`${host}/api/fixture/bots`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as BotTelemetry;
  } catch {
    return null;
  }
}

async function startSimulation(): Promise<boolean> {
  try {
    const res = await fetch(`${host}/api/fixture/bots/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, speed, durationSeconds: duration }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err: any) {
    console.error(`Failed to connect to ${host}:`, err.message);
    return false;
  }
}

async function stopSimulation(): Promise<void> {
  try {
    await fetch(`${host}/api/fixture/bots/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Ignore network error on shutdown
  }
}

function clearScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1B[2J\x1B[0f");
  }
}

async function main(): Promise<void> {
  console.log(`\x1b[36mConnecting to ${host} to start ${count} realistic bots (${speed} pacing)...\x1b[0m`);

  const started = await startSimulation();
  if (!started) {
    console.error(`\x1b[31m[ERROR] Could not start bots on ${host}. Ensure the server is running with fixture mode.\x1b[0m`);
    process.exit(1);
  }

  const startTime = performance.now();
  let stopping = false;

  const handleExit = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\n\x1b[33mStopping all bot actors gracefully...\x1b[0m");
    await stopSimulation();
    console.log("\x1b[32mAll bots stopped cleanly. Goodbye!\x1b[0m\n");
    process.exit(0);
  };

  process.on("SIGINT", () => void handleExit());
  process.on("SIGTERM", () => void handleExit());

  while (!stopping) {
    const elapsedSeconds = (performance.now() - startTime) / 1000;
    if (elapsedSeconds >= duration) {
      console.log("\nSimulation target duration reached.");
      await handleExit();
      break;
    }

    const telemetry = await fetchTelemetry();
    if (telemetry) {
      clearScreen();
      const statusColor =
        telemetry.status === "running"
          ? "\x1b[32mRUNNING\x1b[0m"
          : telemetry.status === "starting"
            ? "\x1b[33mSTARTING\x1b[0m"
            : telemetry.status === "stopping"
              ? "\x1b[31mSTOPPING\x1b[0m"
              : "\x1b[90mIDLE\x1b[0m";

      const maxApplied = Math.max(
        1,
        ...telemetry.schools.map((s) => s.applied),
      );

      console.log("========================================================================================");
      console.log(`                     \x1b[1m\x1b[36mR2PL 200-PLAYER REALISTIC BOT SIMULATION\x1b[0m`);
      console.log("========================================================================================");
      console.log(
        ` Target Host: \x1b[33m${host}\x1b[0m | Status: ${statusColor} | Elapsed: \x1b[1m${formatDuration(elapsedSeconds)}\x1b[0m`,
      );
      console.log(
        ` Bots Target: \x1b[1m${count}\x1b[0m | Active Bots: \x1b[32m${telemetry.activeBots}\x1b[0m | Rate: \x1b[36m${telemetry.actionsPerSecond}\x1b[0m actions/s | Total Explored: \x1b[35m${telemetry.totalActions.toLocaleString()}\x1b[0m tiles`,
      );
      console.log("----------------------------------------------------------------------------------------");
      console.log(" Slot | School Name              | Active Bots | Tiles Opened | Progress");
      console.log("------+--------------------------+-------------+--------------+-------------------------");

      for (const s of telemetry.schools) {
        const slotStr = String(s.slot).padStart(4, " ");
        const nameStr = s.label.padEnd(24, " ").slice(0, 24);
        const botsStr = String(s.activeBots).padStart(11, " ");
        const appliedStr = s.applied.toLocaleString().padStart(12, " ");
        const bar = renderProgressBar(s.applied, maxApplied, 20);
        console.log(` ${slotStr} | ${nameStr} | ${botsStr} | ${appliedStr} | ${bar}`);
      }

      console.log("----------------------------------------------------------------------------------------");
      console.log(" Pacing: " + speed + " | Press [Ctrl+C] to stop all simulation bots and exit");
      console.log("========================================================================================");
    }

    await new Promise((r) => setTimeout(r, 1000));
  }
}

void main();
