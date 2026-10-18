import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { botDatabase } from "../../scripts/simulation/config.ts";

const database = botDatabase(process.env.DATABASE_URL, "1");
const files = ["map-camera", "m4c-asset-pipeline", "selected-tile-panel", "ui-surfaces", "beacon-ui", "beacon-gameplay", "signed-gameplay", "compact-gameplay-ui", "gameplay-inventory-ui", "gameplay-ui-postgres", "player-presentation", "scene-presentation", "terrain-biomes", "dynamic-hitbox", "vite-gameplay-transport", "amtech-editor", "portal-integration", "school-play-integration"];
const run = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-reporter=tap", "--test-concurrency=1", ...files.map(file => `tests/${file}.test.ts`)], {
  env: { ...process.env, R2PL_PREPARATION_DATABASE_URL: database },
  encoding: "utf8", timeout: 240000, windowsHide: true,
});
mkdirSync("artifacts/ui-refactor", { recursive: true });
writeFileSync("artifacts/ui-refactor/regression.tap", run.stdout + run.stderr);
console.log((run.stdout + run.stderr).split("\n").slice(-18).join("\n"));
process.exitCode = run.status ?? 1;
