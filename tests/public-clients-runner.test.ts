import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("public client runner refuses Production and bypass endpoints before sending traffic", () => {
  for (const host of [
    "https://skai0o0.id.vn",
    "http://127.0.0.1:4191",
    "https://play.skai0o0.id.vn.evil.example",
    "https://play.skai0o0.id.vn/?token=private",
  ]) {
    const child = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/simulate-public-clients.ts",
        `--host=${host}`,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /targets only the public synthetic Demo/);
    assert(!child.stdout.includes("Public Demo:"));
  }
});

test("public client runner bounds load and rejects mistyped options", () => {
  for (const [option, message] of [
    ["--count=201", /count must be/],
    ["--duration=3600", /duration must be/],
    ["--ramp=0", /ramp must be/],
    ["--cout=20", /Unknown option/],
  ] as const) {
    const child = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/simulate-public-clients.ts",
        option,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, message);
    assert(!child.stdout.includes("Public Demo:"));
  }
});
