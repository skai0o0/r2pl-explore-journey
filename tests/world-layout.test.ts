import assert from "node:assert/strict";
import test from "node:test";
import { directionLabel } from "../client/src/ui/compassCard.ts";
import {
  FIRST_LANDMARK_BY_SLOT,
  LANDMARKS,
  SCHOOLS,
  STAGING_OBJECTS,
  type WorldObject,
} from "../shared/gameplay/gameConfig.ts";

const byId = (id: string): WorldObject => {
  const o = STAGING_OBJECTS.find((x) => x.id === id);
  assert.ok(o, id);
  return o;
};
const gap = (a: WorldObject, b: WorldObject): number =>
  Math.max(
    Math.abs(a.x - b.x) - (a.width + b.width) / 2,
    Math.abs(a.z - b.z) - (a.height + b.height) / 2,
  );

test("8 HQs form the signed concentric ring around (500,500)", () => {
  const expected: Record<string, [number, number]> = {
    hcmut: [500, 280],
    hcmcou: [655, 345],
    dtu: [720, 500],
    dhhp: [655, 655],
    hsu: [500, 720],
    huce: [345, 655],
    ntu: [280, 500],
    hcmiu: [345, 345],
  };
  for (const s of SCHOOLS) {
    assert.deepEqual([s.hq.x, s.hq.z], expected[s.id], s.id);
    const radius = Math.hypot(s.hq.x - 500, s.hq.z - 500);
    assert.ok(radius > 215 && radius < 225, `${s.id} radius ${radius}`);
  }
});

test("10 Landmarks sit between school pairs and at the centre", () => {
  const expected: Record<string, [number, number]> = {
    halong: [575, 330],
    canghaiphong: [670, 425],
    nguhanhson: [670, 575],
    kinhthanhhue: [575, 670],
    bitexco: [425, 670],
    cairang: [330, 575],
    phongnha: [330, 425],
    nuibaden: [425, 330],
    fansipan: [500, 450],
    thanglong: [500, 550],
  };
  assert.equal(LANDMARKS.length, 10);
  for (const l of LANDMARKS) assert.deepEqual([l.x, l.z], expected[l.id], l.id);
});

test("stepping-stone layout: no overlap and fully inside the world", () => {
  for (const o of STAGING_OBJECTS) {
    assert.ok(o.x - o.width / 2 >= 0 && o.x + o.width / 2 <= 1000, o.id);
    assert.ok(o.z - o.height / 2 >= 0 && o.z + o.height / 2 <= 1000, o.id);
  }
  for (let i = 0; i < STAGING_OBJECTS.length; i++)
    for (let j = i + 1; j < STAGING_OBJECTS.length; j++) {
      const a = STAGING_OBJECTS[i]!;
      const b = STAGING_OBJECTS[j]!;
      assert.ok(gap(a, b) >= 0, `${a.id} overlaps ${b.id}`);
    }
});

test("Aspire UniStop and Chest are 15-20 tiles off every HQ edge", () => {
  for (const s of SCHOOLS) {
    const hq = byId(`hq-${s.id}`);
    for (const id of [`dev-aspire-${s.slot}`, `chest-aspire-${s.slot}`]) {
      const g = gap(hq, byId(id));
      // Chest hangs 6 tiles off its station, so only the station is held to the band.
      if (id.startsWith("dev-"))
        assert.ok(g >= 15 && g <= 20, `${id} edge gap ${g}`);
      else assert.ok(g >= 10 && g <= 26, `${id} edge gap ${g}`);
    }
  }
});

test("Nitro UniStop and Chest lie 40-50 tiles out on the way to the first Landmark", () => {
  for (const s of SCHOOLS) {
    const hq = byId(`hq-${s.id}`);
    const lm = byId(FIRST_LANDMARK_BY_SLOT[s.slot]!);
    const nitro = byId(`dev-nitro-${s.slot}`);
    const chest = byId(`chest-nitro-${s.slot}`);
    const out = Math.hypot(nitro.x - hq.x, nitro.z - hq.z);
    assert.ok(out >= 40 && out <= 50, `${nitro.id} ${out}`);
    assert.ok(
      Math.hypot(nitro.x - lm.x, nitro.z - lm.z) <
        Math.hypot(hq.x - lm.x, hq.z - lm.z),
      `${nitro.id} heads toward ${lm.id}`,
    );
    assert.ok(Math.hypot(chest.x - nitro.x, chest.z - nitro.z) <= 8);
    assert.ok(
      Math.hypot(nitro.x - hq.x, nitro.z - hq.z) >
        Math.hypot(
          byId(`dev-aspire-${s.slot}`).x - hq.x,
          byId(`dev-aspire-${s.slot}`).z - hq.z,
        ),
      "Nitro is farther than Aspire",
    );
  }
});

test("8 Predator UniStops and Chests ring the central Landmarks inside 430..570", () => {
  const predators = STAGING_OBJECTS.filter((o) => o.tier === "predator");
  assert.equal(predators.length, 16);
  for (const o of predators) {
    assert.ok(o.x >= 430 && o.x <= 570 && o.z >= 430 && o.z <= 570, o.id);
  }
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "unistop").length, 24);
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "chest").length, 24);
});

test("compass direction labels follow map orientation (z grows southwards)", () => {
  assert.equal(directionLabel(10, 0), "Đông");
  assert.equal(directionLabel(0, -10), "Bắc");
  assert.equal(directionLabel(0, 10), "Nam");
  assert.equal(directionLabel(-10, 0), "Tây");
  assert.equal(directionLabel(10, -10), "Đông Bắc");
  assert.equal(directionLabel(-10, 10), "Tây Nam");
});
