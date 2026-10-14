import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TILE_PULSES,
  TILE_PULSE_SECONDS,
  TilePulses,
  tileTexel,
} from "../client/src/tileFx.ts";

test("tile texel maps chunk-local index to bottom-up texture rows", () => {
  assert.deepEqual(tileTexel(0), { col: 0, row: 63 });
  assert.deepEqual(tileTexel(63), { col: 63, row: 63 });
  assert.deepEqual(tileTexel(64 * 63 + 5), { col: 5, row: 0 });
});

test("pulses fill free slots, restart the same tile and recycle the oldest", () => {
  const pulses = new TilePulses();
  assert.equal(pulses.active(0), false);
  pulses.add(10, 100, "gain");
  assert.equal(pulses.active(100.1), true);
  assert.equal(pulses.active(100 + TILE_PULSE_SECONDS + 0.01), false);

  pulses.add(10, 100.5, "gain");
  const live = pulses.uniforms.filter((u) => u.z > 0);
  assert.equal(live.length, 1, "same tile restarts in place");
  assert.equal(live[0]!.z, 100.5);

  for (let i = 0; i < MAX_TILE_PULSES + 3; i++) {
    pulses.add(1000 + i, 200 + i * 0.01, i % 2 ? "loss" : "gain");
  }
  assert.equal(pulses.uniforms.length, MAX_TILE_PULSES);
  assert.ok(pulses.uniforms.every((u) => u.z >= 200));
  assert.equal(
    pulses.uniforms.some((u) => u.w === 1),
    true,
  );
});
