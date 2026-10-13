/**
 * Knowledge Rules v1 shared-cluster geometry tests (M4-D0 A3 / K03 / K04 / K05).
 *
 * Pure deterministic fixtures only. These cases validate 4-edge connected
 * components and exact unordered school-pair grouping; they are not an
 * authorization to enable production Knowledge billing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeSharedKnowledgeComponentsV1,
  normalizeSchoolPairV1,
  type SharedKnowledgeMembership,
} from "../shared/gameplay/knowledgeComponentsV1.ts";
import { WORLD_TILE_COUNT, WORLD_WIDTH } from "../shared/world/constants.ts";

function membership(
  tileIndex: number,
  schoolSlotA: number,
  schoolSlotB: number,
): SharedKnowledgeMembership {
  return { tileIndex, schoolSlotA, schoolSlotB };
}

function componentSummaries(rows: readonly SharedKnowledgeMembership[]): Array<{
  componentId: number;
  schoolSlotA: number;
  schoolSlotB: number;
  tileCount: number;
  tileIndices: readonly number[];
}> {
  return computeSharedKnowledgeComponentsV1(rows).map((component) => ({
    componentId: component.componentId,
    schoolSlotA: component.schoolSlotA,
    schoolSlotB: component.schoolSlotB,
    tileCount: component.tileCount,
    tileIndices: component.tileIndices,
  }));
}

test("empty input yields no components", () => {
  assert.deepEqual(computeSharedKnowledgeComponentsV1([]), []);
});

test("single tile is one one-tile component with stable id 0", () => {
  const result = componentSummaries([membership(42, 1, 2)]);
  assert.deepEqual(result, [
    {
      componentId: 0,
      schoolSlotA: 1,
      schoolSlotB: 2,
      tileCount: 1,
      tileIndices: [42],
    },
  ]);
});

test("duplicate (tile, pair) rows collapse to one tile in one component", () => {
  const result = componentSummaries([
    membership(10, 1, 2),
    membership(10, 1, 2),
    membership(10, 2, 1),
    membership(11, 1, 2),
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.tileIndices, [10, 11]);
  assert.equal(result[0]!.tileCount, 2);
});

test("exact unordered pair (1,2) and (2,1) share one grouping", () => {
  // 5=(5,0), 6=(6,0) touch; 5005=(5,5) is a distant same-pair cell.
  const result = componentSummaries([
    membership(5, 1, 2),
    membership(6, 2, 1),
    membership(5005, 1, 2),
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0]!, {
    componentId: 0,
    schoolSlotA: 1,
    schoolSlotB: 2,
    tileCount: 2,
    tileIndices: [5, 6],
  });
  assert.deepEqual(result[1]!, {
    componentId: 1,
    schoolSlotA: 1,
    schoolSlotB: 2,
    tileCount: 1,
    tileIndices: [5005],
  });
});

test("K03 five-tile 4-neighbor cluster is one component (fee per component)", () => {
  // Cross shape centered at (5,5) = 5*1000+5 = 5005.
  const center = 5 * WORLD_WIDTH + 5;
  const result = componentSummaries([
    membership(center, 0, 3),
    membership(center - 1, 0, 3),
    membership(center + 1, 0, 3),
    membership(center - WORLD_WIDTH, 0, 3),
    membership(center + WORLD_WIDTH, 0, 3),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.tileCount, 5);
  assert.deepEqual(result[0]!.tileIndices, [
    center - WORLD_WIDTH,
    center - 1,
    center,
    center + 1,
    center + WORLD_WIDTH,
  ]);
});

test("K04 diagonal-only tiles stay separate components", () => {
  const a = 2 * WORLD_WIDTH + 2;
  const d = 3 * WORLD_WIDTH + 3;
  const result = componentSummaries([membership(a, 1, 2), membership(d, 1, 2)]);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.tileCount, 1);
  assert.equal(result[1]!.tileCount, 1);
  assert.deepEqual(
    result.map((c) => c.tileIndices),
    [[a], [d]],
  );
});

test("no row wrap: x=999 does not join x=0 on the next row", () => {
  const rightEdge = 0 * WORLD_WIDTH + (WORLD_WIDTH - 1);
  const nextRowLeft = 1 * WORLD_WIDTH + 0;
  const result = componentSummaries([
    membership(rightEdge, 1, 2),
    membership(nextRowLeft, 1, 2),
  ]);
  assert.equal(result.length, 2);
});

test("no row wrap: x=999 does not join x=0 on the same row", () => {
  const left = 7 * WORLD_WIDTH + 0;
  const right = 7 * WORLD_WIDTH + (WORLD_WIDTH - 1);
  const result = componentSummaries([
    membership(left, 1, 2),
    membership(right, 1, 2),
  ]);
  assert.equal(result.length, 2);
});

test("sparse distant cells produce separate stable components sorted by min tile", () => {
  const far = 900 * WORLD_WIDTH + 900;
  const near = 1 * WORLD_WIDTH + 1;
  const mid = 500 * WORLD_WIDTH + 10;
  const result = componentSummaries([
    membership(far, 4, 5),
    membership(near, 4, 5),
    membership(mid, 4, 5),
  ]);
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((c) => c.componentId),
    [0, 1, 2],
  );
  assert.deepEqual(
    result.map((c) => c.tileIndices[0]!),
    [near, mid, far],
  );
});

test("bridge tile merges two clusters into one component (K05 merge)", () => {
  const leftA = 10 * WORLD_WIDTH + 10;
  const leftB = 10 * WORLD_WIDTH + 11;
  const bridge = 10 * WORLD_WIDTH + 12;
  const rightA = 10 * WORLD_WIDTH + 13;
  const rightB = 10 * WORLD_WIDTH + 14;

  const withoutBridge = componentSummaries([
    membership(leftA, 0, 1),
    membership(leftB, 0, 1),
    membership(rightA, 0, 1),
    membership(rightB, 0, 1),
  ]);
  assert.equal(withoutBridge.length, 2);
  assert.equal(withoutBridge[0]!.tileCount, 2);
  assert.equal(withoutBridge[1]!.tileCount, 2);

  const withBridge = componentSummaries([
    membership(leftA, 0, 1),
    membership(leftB, 0, 1),
    membership(bridge, 0, 1),
    membership(rightA, 0, 1),
    membership(rightB, 0, 1),
  ]);
  assert.equal(withBridge.length, 1);
  assert.equal(withBridge[0]!.tileCount, 5);
});

test("removing the bridge splits one component into two (K05 split)", () => {
  const tiles = [
    20 * WORLD_WIDTH + 20,
    20 * WORLD_WIDTH + 21,
    20 * WORLD_WIDTH + 22,
    20 * WORLD_WIDTH + 23,
    20 * WORLD_WIDTH + 24,
  ];
  const joined = componentSummaries(tiles.map((t) => membership(t, 2, 3)));
  assert.equal(joined.length, 1);

  const split = componentSummaries(
    tiles.filter((t) => t !== tiles[2]!).map((t) => membership(t, 2, 3)),
  );
  assert.equal(split.length, 2);
  assert.deepEqual(split[0]!.tileIndices, [tiles[0]!, tiles[1]!]);
  assert.deepEqual(split[1]!.tileIndices, [tiles[3]!, tiles[4]!]);
});

test("K04 pair isolation: adjacent B+C never merges with A+B", () => {
  const sharedAB = 50 * WORLD_WIDTH + 50;
  const sharedBC = 50 * WORLD_WIDTH + 51;
  const result = componentSummaries([
    membership(sharedAB, 1, 2),
    membership(sharedBC, 2, 3),
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0]!, {
    componentId: 0,
    schoolSlotA: 1,
    schoolSlotB: 2,
    tileCount: 1,
    tileIndices: [sharedAB],
  });
  assert.deepEqual(result[1]!, {
    componentId: 1,
    schoolSlotA: 2,
    schoolSlotB: 3,
    tileCount: 1,
    tileIndices: [sharedBC],
  });
});

test("same tile under different pairs stays in separate pair groups", () => {
  const tile = 9;
  const result = componentSummaries([
    membership(tile, 1, 2),
    membership(tile, 2, 3),
    membership(tile + 1, 2, 3),
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.schoolSlotA, 1);
  assert.equal(result[0]!.schoolSlotB, 2);
  assert.deepEqual(result[0]!.tileIndices, [tile]);
  assert.equal(result[1]!.schoolSlotA, 2);
  assert.equal(result[1]!.schoolSlotB, 3);
  assert.deepEqual(result[1]!.tileIndices, [tile, tile + 1]);
});

test("edge and corner cells cluster only through in-range orthogonal sides", () => {
  const corner = 0;
  const belowCorner = WORLD_WIDTH;
  const besideCorner = 1;
  const diagonalFromCorner = WORLD_WIDTH + 1;

  const cornerPair = componentSummaries([
    membership(corner, 0, 7),
    membership(belowCorner, 0, 7),
    membership(besideCorner, 0, 7),
    membership(diagonalFromCorner, 0, 7),
  ]);
  // Corner joins below and beside; the diagonal cell is only diagonal to
  // corner but is 4-adjacent to below and beside, so all four form one
  // component.
  assert.equal(cornerPair.length, 1);
  assert.equal(cornerPair[0]!.tileCount, 4);

  const loneCorner = componentSummaries([membership(corner, 0, 7)]);
  assert.deepEqual(loneCorner[0]!.tileIndices, [0]);

  const maxTile = WORLD_TILE_COUNT - 1;
  const loneMax = componentSummaries([membership(maxTile, 0, 7)]);
  assert.deepEqual(loneMax[0]!.tileIndices, [maxTile]);
});

test("lower-right world edge neighbors do not wrap", () => {
  const maxTile = WORLD_TILE_COUNT - 1;
  const leftOfMax = maxTile - 1;
  const aboveMax = maxTile - WORLD_WIDTH;
  const result = componentSummaries([
    membership(maxTile, 0, 1),
    membership(leftOfMax, 0, 1),
    membership(aboveMax, 0, 1),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.tileCount, 3);
});

test("long sparse corridor is one component; gaps split it", () => {
  const row = 40;
  const corridor = Array.from(
    { length: 20 },
    (_, i) => row * WORLD_WIDTH + i * 2,
  );
  const gapped = componentSummaries(corridor.map((t) => membership(t, 0, 1)));
  assert.equal(gapped.length, 20);

  const filled: number[] = [];
  for (let x = 0; x < 39; x += 1) {
    filled.push(row * WORLD_WIDTH + x);
  }
  const solid = componentSummaries(filled.map((t) => membership(t, 0, 1)));
  assert.equal(solid.length, 1);
  assert.equal(solid[0]!.tileCount, 39);
});

test("result is deterministic across repeated calls and input order", () => {
  // Pair (1,2): row-0 run 1..3 plus distant 2003=(3,2). Pair (3,4): adjacent 0,1.
  const rows = [
    membership(3, 2, 1),
    membership(1, 2, 1),
    membership(2, 1, 2),
    membership(2003, 1, 2),
    membership(1, 3, 4),
    membership(0, 3, 4),
  ];
  const first = computeSharedKnowledgeComponentsV1(rows);
  const shuffled = [rows[4]!, rows[2]!, rows[0]!, rows[5]!, rows[1]!, rows[3]!];
  const second = computeSharedKnowledgeComponentsV1(shuffled);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [
    {
      componentId: 0,
      schoolSlotA: 1,
      schoolSlotB: 2,
      tileCount: 3,
      tileIndices: [1, 2, 3],
    },
    {
      componentId: 1,
      schoolSlotA: 1,
      schoolSlotB: 2,
      tileCount: 1,
      tileIndices: [2003],
    },
    {
      componentId: 2,
      schoolSlotA: 3,
      schoolSlotB: 4,
      tileCount: 2,
      tileIndices: [0, 1],
    },
  ]);
});

test("normalizeSchoolPairV1 orders slots and rejects invalid pairs", () => {
  assert.deepEqual(normalizeSchoolPairV1(2, 1), [1, 2]);
  assert.deepEqual(normalizeSchoolPairV1(1, 2), [1, 2]);
  assert.throws(() => normalizeSchoolPairV1(1, 1), RangeError);
  assert.throws(() => normalizeSchoolPairV1(-1, 2), RangeError);
  assert.throws(() => normalizeSchoolPairV1(1, 16), RangeError);
  assert.throws(() => normalizeSchoolPairV1(1.5, 2), RangeError);
});

test("rejects bad tile indices", () => {
  const bad = [-1, WORLD_TILE_COUNT, 1.5, Number.NaN];
  for (const tileIndex of bad) {
    assert.throws(
      () => computeSharedKnowledgeComponentsV1([membership(tileIndex, 1, 2)]),
      RangeError,
      `expected RangeError for tileIndex=${tileIndex}`,
    );
  }
});

test("rejects invalid school slots and non-distinct pairs", () => {
  assert.throws(
    () => computeSharedKnowledgeComponentsV1([membership(0, -1, 2)]),
    RangeError,
  );
  assert.throws(
    () => computeSharedKnowledgeComponentsV1([membership(0, 1, 16)]),
    RangeError,
  );
  assert.throws(
    () => computeSharedKnowledgeComponentsV1([membership(0, 1.5, 2)]),
    RangeError,
  );
  assert.throws(
    () => computeSharedKnowledgeComponentsV1([membership(0, 2, 2)]),
    RangeError,
  );
});

test("memory-bounded sparse input stays correct without whole-world allocation", () => {
  // 5_000 pairwise non-adjacent tiles on even/even cells, plus one 1_000-tile
  // row on an odd row far below. Indexing is sparse over input tiles only.
  const rows: SharedKnowledgeMembership[] = [];
  for (let i = 0; i < 5_000; i += 1) {
    const x = (i % 500) * 2;
    const z = Math.floor(i / 500) * 2;
    rows.push(membership(z * WORLD_WIDTH + x, 8, 9));
  }
  const lineRow = 801;
  const lineStart = lineRow * WORLD_WIDTH;
  for (let x = 0; x < 1_000; x += 1) {
    rows.push(membership(lineStart + x, 8, 9));
  }
  const result = computeSharedKnowledgeComponentsV1(rows);
  const lineComponent = result.find((c) => c.tileCount === 1_000);
  assert.ok(lineComponent !== undefined);
  assert.equal(lineComponent.tileIndices[0]!, lineStart);
  assert.equal(result.length, 5_001);
  assert.equal(
    result.reduce((sum, c) => sum + c.tileCount, 0),
    6_000,
  );
});
