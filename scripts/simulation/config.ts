import { lstat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
export interface BotOptions {
  readonly duration: number;
  readonly botsPerSchool: number;
  readonly rates: readonly number[];
  readonly preset: string;
  readonly layout: "contact" | "spread" | "gather";
  readonly seed: number;
  readonly credits: number;
  readonly maxActions: number;
  readonly retryEvery: number;
  readonly reconnectEvery: number;
  readonly output: string;
  readonly regionSize: number;
  readonly keepData: boolean;
}
export const BOT_CAPABILITIES = Object.freeze({
  exploration: true,
  schoolFilteredViews: true,
  knowledgeOverlap: true,
  contest: false,
  defense: false,
  upkeep: false,
  decay: false,
  landmarkGameplay: false,
  rewards: false,
});
const presets: Readonly<Record<string, readonly number[]>> = {
  slow: [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75],
  mixed: [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5],
  fast: [1, 1.5, 2, 2.5, 3, 3.5, 4, 5],
  bursty: [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5],
};
export function parseBotOptions(
  args: readonly string[],
  workspace: string,
): BotOptions {
  const allowed = new Set([
    "duration",
    "bots-per-school",
    "rates",
    "preset",
    "layout",
    "seed",
    "credits",
    "max-actions",
    "retry-every",
    "reconnect-every",
    "output",
    "require-full-gameplay",
    "region-size",
    "keep-data",
  ]);
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]!) || values.has(match[1]!))
      throw new RangeError("Invalid or duplicate bot option");
    values.set(match[1]!, match[2]!);
  }
  if (
    values.has("require-full-gameplay") &&
    !["true", "false"].includes(values.get("require-full-gameplay")!)
  )
    throw new RangeError("Invalid full-gameplay option");
  if (values.get("require-full-gameplay") === "true")
    throw new Error(
      "Full social gameplay unavailable: protocol v1 has no contest/defense/upkeep command",
    );
  const number = (
    key: string,
    fallback: number,
    min: number,
    max: number,
    integer = false,
  ) => {
    const result = Number(values.get(key) ?? fallback);
    if (
      !Number.isFinite(result) ||
      result < min ||
      result > max ||
      (integer && !Number.isInteger(result))
    )
      throw new RangeError(`Invalid bot numeric option: ${key}`);
    return result;
  };
  if (
    values.has("keep-data") &&
    !["true", "false"].includes(values.get("keep-data")!)
  )
    throw new RangeError("Invalid keep-data option");
  const regionSize = number("region-size", 128, 64, 256, true);
  if (![64, 128, 256].includes(regionSize))
    throw new RangeError("Region size must be 64, 128 or 256");
  const preset = values.get("preset") ?? "mixed";
  if (!Object.hasOwn(presets, preset))
    throw new RangeError("Unknown bot speed preset");
  const rates = values.has("rates")
    ? values.get("rates")!.split(",").map(Number)
    : [...presets[preset]!];
  if (
    rates.length !== 8 ||
    rates.some((rate) => !Number.isFinite(rate) || rate < 0.05 || rate > 5)
  )
    throw new RangeError(
      "Expected eight per-bot school rates between 0.05 and 5 actions/s",
    );
  const layout = values.get("layout") ?? "gather";
  if (layout !== "contact" && layout !== "spread" && layout !== "gather")
    throw new RangeError("Unknown bot layout");
  const output = resolve(
    workspace,
    values.get("output") ?? "docs/benchmarks/bots",
  );
  const base = resolve(workspace, "docs/benchmarks/bots");
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  if (
    normalize(output) !== normalize(base) &&
    !normalize(output).startsWith(normalize(base) + sep)
  )
    throw new RangeError("Bot output must stay under docs/benchmarks/bots");
  return {
    duration: number("duration", 60, 1, 600),
    botsPerSchool: number("bots-per-school", 3, 1, 20, true),
    rates,
    preset,
    layout,
    seed: number("seed", 20261013, 0, 0xffffffff, true),
    credits: number("credits", 500, 1, 100000, true),
    maxActions: number("max-actions", 10000, 1, 100000, true),
    retryEvery: number("retry-every", 25, 0, 10000, true),
    reconnectEvery: number("reconnect-every", 0, 0, 10000, true),
    output,
    regionSize,
    keepData: values.get("keep-data") === "true",
  };
}
export function botDatabase(value: unknown, enabled: unknown): string {
  if (enabled !== "1" || typeof value !== "string")
    throw new Error(
      "Set R2PL_BOT_SIMULATION=1 and R2PL_BOT_DATABASE_URL to a disposable database",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid bot database URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !/^r2pl_(bot|prep)_test_[a-z0-9_]+$/.test(url.pathname.slice(1))
  )
    throw new Error(
      "Bot simulation requires a loopback r2pl_bot_test_* or r2pl_prep_test_* database",
    );
  return value;
}
export function botRate(
  options: BotOptions,
  slot: number,
  elapsed: number,
): number {
  const rate = options.rates[slot];
  if (
    rate === undefined ||
    !Number.isInteger(slot) ||
    !Number.isFinite(elapsed) ||
    elapsed < 0
  )
    throw new RangeError("Invalid bot schedule");
  return options.preset === "bursty"
    ? Math.min(5, rate * (elapsed % 15 < 5 ? 1.5 : 0.4))
    : rate;
}

/** Check existing components before mkdir; do not follow a junction into V1/worktrees. */
export async function assertBotOutputDirectory(
  workspace: string,
  directory: string,
): Promise<void> {
  let cursor = resolve(workspace);
  for (const component of relative(cursor, directory).split(sep)) {
    cursor = resolve(cursor, component);
    let entry: Awaited<ReturnType<typeof lstat>>;
    try {
      entry = await lstat(cursor);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        break;
      throw error;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error("Bot output cannot traverse links or files");
  }
}
