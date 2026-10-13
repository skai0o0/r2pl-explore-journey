import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Existing DB suites require both baseline migrations before execution.
// Restrict this convenience runner to an explicitly named disposable loopback DB.
const value = process.env.R2PL_TEST_DATABASE_URL;
if (!value)
  throw new Error(
    "R2PL_TEST_DATABASE_URL is required for disposable PostgreSQL verification",
  );
const url = new URL(value);
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !url.pathname.startsWith("/r2pl_prep_test_") ||
  !/^r2pl_prep_test_[a-z0-9_]+$/.test(url.pathname.slice(1))
)
  throw new Error("Verification requires a loopback r2pl_prep_test_* database");
const cwd = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env, R2PL_PREPARATION_DATABASE_URL: value };
function execute(args: string[]): void {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
    timeout: 240_000,
  });
  if (result.error || result.status !== 0)
    throw new Error("Disposable PostgreSQL verification step failed");
}
execute(["--experimental-strip-types", "scripts/migrate-m3.ts"]);
execute(["--experimental-strip-types", "scripts/migrate-m35.ts"]);
const tests = (await readdir(new URL("../tests/", import.meta.url)))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => `tests/${name}`);
execute([
  "--experimental-strip-types",
  "--test",
  "--test-concurrency=1",
  ...tests,
]);
