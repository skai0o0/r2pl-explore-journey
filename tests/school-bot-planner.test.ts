import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  botDatabase,
  botRate,
  parseBotOptions,
} from "../scripts/simulation/config.ts";
import { botMapSvg, mapCoverage } from "../scripts/simulation/report.ts";
import {
  BotPlanner,
  botSchools,
  regionChunks,
  regionContains,
  seededRandom,
} from "../shared/simulation/schoolBots.ts";
import { tileCoordinates } from "../shared/world/coordinates.ts";

const workspace = fileURLToPath(new URL("../", import.meta.url));

test("eight synthetic schools have immutable-format slots, bounded public starts and shared rendezvous", () => {
  for (const layout of ["contact", "spread", "gather"] as const)
    for (const size of [64, 128, 256]) {
      const schools = botSchools(layout, size);
      assert.equal(schools.length, 8);
      assert.equal(new Set(schools.map((s) => s.fixtureId)).size, 8);
      assert.equal(new Set(schools.map((s) => s.home)).size, 8);
      assert.equal(
        new Set(schools.map((s) => s.meeting)).size,
        layout === "gather" ? 1 : 4,
      );
      for (const s of schools) {
        assert.ok(s.fixtureId.startsWith("fixture-school-"));
        assert.ok(regionContains(s.region, s.home));
        assert.ok(regionContains(s.region, s.meeting));
        assert.ok(regionChunks(s.region).length <= 64);
        assert.equal(s.meeting, schools[s.slot ^ 1]!.meeting);
      }
    }
  assert.throws(() => botSchools("contact", 65));
});

test("planner expands by four edges from authorized knowledge without committing pending actions", () => {
  const s = botSchools("contact")[0]!;
  const planner = new BotPlanner(s, 12);
  assert.deepEqual(planner.next("connector"), {
    tile: s.home,
    intent: "rendezvous",
  });
  assert.equal(planner.knownTiles, 0);
  planner.learn(s.home);
  const known = new Set([s.home]);
  for (let i = 0; i < 200; i++) {
    const intent = planner.next("explorer")!;
    assert.ok(regionContains(s.region, intent.tile));
    if (!known.has(intent.tile)) {
      const c = tileCoordinates(intent.tile);
      assert.ok(
        [...known].some((t) => {
          const p = tileCoordinates(t);
          return Math.abs(c.x - p.x) + Math.abs(c.z - p.z) === 1;
        }),
      );
    }
    assert.equal(planner.knownTiles, known.size);
    planner.learn(intent.tile);
    known.add(intent.tile);
    assert.equal(planner.knownTiles, known.size);
  }
});

test("connector follows the public meeting goal and separate bot views learn independently", () => {
  const s = botSchools("contact")[0]!;
  const a = new BotPlanner(s, 123);
  const b = new BotPlanner(s, 123);
  a.learn(s.home);
  for (let i = 0; i < 20; i++) {
    const intent = a.next("connector")!;
    a.learn(intent.tile);
    if (intent.tile === s.meeting) break;
  }
  assert.ok(a.knownTiles > 1);
  assert.equal(b.knownTiles, 0);
  assert.equal(b.next("connector")!.tile, s.home);
  const p = new BotPlanner(s, 456);
  p.learn(s.home);
  let reached = false;
  for (let i = 0; i < 20; i++) {
    const intent = p.next("connector")!;
    p.learn(intent.tile);
    reached ||= intent.tile === s.meeting;
  }
  assert.ok(reached);
});

test("seeded intentions reproduce under the same supplied observations", () => {
  const rngA = seededRandom(0);
  const rngB = seededRandom(0);
  for (let i = 0; i < 100; i++) assert.equal(rngA(), rngB());
  const s = botSchools("contact")[0]!;
  const a = new BotPlanner(s, 789);
  const b = new BotPlanner(s, 789);
  a.learn(s.home);
  b.learn(s.home);
  for (let i = 0; i < 50; i++) {
    const x = a.next("steward")!;
    const y = b.next("steward")!;
    assert.deepEqual(x, y);
    a.learn(x.tile);
    b.learn(y.tile);
  }
  assert.throws(() => seededRandom(-1));
});

test("CLI validates rates and budgets and rejects protected output destinations", () => {
  const options = parseBotOptions([], workspace);
  assert.equal(options.botsPerSchool, 3);
  assert.equal(options.rates.length, 8);
  assert.equal(options.keepData, false);
  for (const args of [
    ["--rates=1,2"],
    ["--rates=1,1,1,1,1,1,1,6"],
    ["--duration=NaN"],
    ["--bots-per-school=21"],
    ["--duration=1", "--duration=2"],
    ["--output=land-rush-prototype"],
    ["--output=.agent-worktrees/mimo"],
    ["--output=.git"],
    ["--output=../outside"],
    ["--region-size=65"],
    ["--unknown=1"],
  ])
    assert.throws(() => parseBotOptions(args, workspace));
  assert.equal(
    parseBotOptions(["--output=docs/benchmarks/bots/custom"], workspace).output,
    resolve(workspace, "docs/benchmarks/bots/custom"),
  );
  assert.throws(
    () => parseBotOptions(["--require-full-gameplay=true"], workspace),
    /no contest/,
  );
});

test("database guard refuses remote or production-shaped databases and burst rates stay bounded", () => {
  assert.throws(() =>
    botDatabase("postgresql://fixture@remote/r2pl_bot_test_local", "1"),
  );
  assert.throws(() =>
    botDatabase("postgresql://fixture@127.0.0.1/production", "1"),
  );
  assert.throws(() =>
    botDatabase("postgresql://fixture@127.0.0.1/r2pl_bot_test_local", "0"),
  );
  assert.ok(
    botDatabase("postgresql://fixture@127.0.0.1/r2pl_bot_test_local", "1"),
  );
  const options = parseBotOptions(["--preset=bursty"], workspace);
  assert.ok(botRate(options, 7, 1) <= 5);
  assert.ok(botRate(options, 7, 10) < botRate(options, 7, 1));
});

test("overlap reporting counts each school presence without claiming contest gameplay", () => {
  const schools = botSchools("contact");
  const map = new Map([
    [schools[0]!.home, 1],
    [schools[0]!.meeting, 3],
  ]);
  const coverage = mapCoverage(map);
  assert.equal(coverage.uniqueTiles, 2);
  assert.equal(coverage.overlapTiles, 1);
  assert.deepEqual(coverage.schoolTiles.slice(0, 2), [2, 1]);
  assert.equal(coverage.pairCounts["0:1"], 1);
  const svg = botMapSvg(schools, map);
  assert.match(svg, /not live contest/);
  assert.match(svg, /HCMUT/);
  assert.match(svg, /synthetic/);
});
