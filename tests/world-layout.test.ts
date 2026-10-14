import assert from "node:assert/strict";
import test from "node:test";
import { directionLabel } from "../client/src/ui/compassCard.ts";
import {
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

test("15 neutral UniStops (8 Aspire, 5 Nitro, 2 Predator) and 15 neutral Chests: all neutral and valid stepping stones", () => {
  const unistops = STAGING_OBJECTS.filter((o) => o.kind === "unistop");
  const chests = STAGING_OBJECTS.filter((o) => o.kind === "chest");
  assert.equal(unistops.length, 15);
  assert.equal(chests.length, 15);
  assert.equal(unistops.filter((o) => o.tier === "aspire").length, 8);
  assert.equal(unistops.filter((o) => o.tier === "nitro").length, 5);
  assert.equal(unistops.filter((o) => o.tier === "predator").length, 2);
  assert.equal(chests.filter((o) => o.tier === "aspire").length, 8);
  assert.equal(chests.filter((o) => o.tier === "nitro").length, 5);
  assert.equal(chests.filter((o) => o.tier === "predator").length, 2);

  for (const u of unistops) {
    assert.equal(u.ownerSchoolSlot, null);
    assert.equal(u.ownerSchoolId, null);
  }

  for (const s of SCHOOLS) {
    const hq = byId(`hq-${s.id}`);
    const nearestAspire = unistops
      .filter((u) => u.tier === "aspire")
      .map((u) => ({ u, g: gap(hq, u) }))
      .sort((a, b) => a.g - b.g)[0]!;
    assert.ok(
      nearestAspire.g >= 15 && nearestAspire.g <= 20,
      `${s.id} nearest aspire stop gap ${nearestAspire.g}`,
    );

    const nearestChest = chests
      .filter((c) => c.tier === "aspire")
      .map((c) => ({ c, g: gap(hq, c) }))
      .sort((a, b) => a.g - b.g)[0]!;
    assert.ok(
      nearestChest.g >= 10 && nearestChest.g <= 26,
      `${s.id} nearest aspire chest gap ${nearestChest.g}`,
    );
  }

  for (const p of [...unistops, ...chests].filter(
    (o) => o.tier === "predator",
  )) {
    assert.ok(p.x >= 430 && p.x <= 570 && p.z >= 430 && p.z <= 570, p.id);
  }
});

test("compass direction labels follow map orientation (z grows southwards)", () => {
  assert.equal(directionLabel(10, 0), "Đông");
  assert.equal(directionLabel(0, -10), "Bắc");
  assert.equal(directionLabel(0, 10), "Nam");
  assert.equal(directionLabel(-10, 0), "Tây");
  assert.equal(directionLabel(10, -10), "Đông Bắc");
  assert.equal(directionLabel(-10, 10), "Tây Nam");
});
