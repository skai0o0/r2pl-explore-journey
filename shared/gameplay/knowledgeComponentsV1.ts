/**
 * Knowledge Rules v1 shared-cluster geometry (M4-D0 / A3).
 * Development-only pure functions. Not approved production rules and not wired
 * to transport, services or persistence.
 *
 * A Shared cluster is a connected component of tiles belonging to one exact
 * unordered school pair, using FOUR orthogonal tile sides only (K04 diagonal
 * corners do not connect) and no row wrap. Billing is fee per component per
 * school (K03), so the result exposes one record per component.
 *
 * Memory model: only tiles present in the input are indexed. Never allocate a
 * whole-world 1_000_000 per-tile structure for clustering.
 */
import {
  MAX_SCHOOL_SLOTS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../world/constants.ts";
import { assertTileIndex } from "../world/coordinates.ts";

export interface SharedKnowledgeMembership {
  /** Logical world tile index in [0, WORLD_WIDTH * WORLD_HEIGHT). */
  readonly tileIndex: number;
  /** One participating school slot in the shared pair. */
  readonly schoolSlotA: number;
  /** The other participating school slot in the shared pair. */
  readonly schoolSlotB: number;
}

export interface SharedClusterComponentV1 {
  /** Stable id: 0..n-1 after deterministic component ordering. */
  readonly componentId: number;
  /** Unordered pair low slot. */
  readonly schoolSlotA: number;
  /** Unordered pair high slot. */
  readonly schoolSlotB: number;
  /** Unique tiles in this component (fee unit is per component, not per tile). */
  readonly tileCount: number;
  /** Unique tile indices, ascending. */
  readonly tileIndices: readonly number[];
}

function assertSchoolSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SCHOOL_SLOTS) {
    throw new RangeError("School slot outside registry");
  }
}

/**
 * Canonical unordered school pair (low slot, high slot).
 * Throws when either slot is invalid or the two slots are not distinct.
 */
export function normalizeSchoolPairV1(
  schoolSlotA: number,
  schoolSlotB: number,
): readonly [number, number] {
  assertSchoolSlot(schoolSlotA);
  assertSchoolSlot(schoolSlotB);
  if (schoolSlotA === schoolSlotB) {
    throw new RangeError("School pair requires two distinct slots");
  }
  return schoolSlotA < schoolSlotB
    ? [schoolSlotA, schoolSlotB]
    : [schoolSlotB, schoolSlotA];
}

/** Four-edge neighbors only; no diagonals, no row wrap. In-range result. */
function forEachOrthogonalNeighbor(
  tileIndex: number,
  visit: (neighbor: number) => void,
): void {
  const x = tileIndex % WORLD_WIDTH;
  const z = Math.floor(tileIndex / WORLD_WIDTH);
  if (x > 0) visit(tileIndex - 1);
  if (x < WORLD_WIDTH - 1) visit(tileIndex + 1);
  if (z > 0) visit(tileIndex - WORLD_WIDTH);
  if (z < WORLD_HEIGHT - 1) visit(tileIndex + WORLD_WIDTH);
}

function pairKey(schoolSlotA: number, schoolSlotB: number): number {
  return schoolSlotA * MAX_SCHOOL_SLOTS + schoolSlotB;
}

function componentsOfPairTiles(tiles: ReadonlySet<number>): number[][] {
  const sortedTiles = Array.from(tiles).sort((a, b) => a - b);
  const visited = new Set<number>();
  const components: number[][] = [];
  for (const start of sortedTiles) {
    if (visited.has(start)) continue;
    const component: number[] = [];
    const stack: number[] = [start];
    visited.add(start);
    while (stack.length > 0) {
      const current = stack.pop() as number;
      component.push(current);
      forEachOrthogonalNeighbor(current, (neighbor) => {
        if (tiles.has(neighbor) && !visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      });
    }
    component.sort((a, b) => a - b);
    components.push(component);
  }
  return components;
}

/**
 * Group memberships by exact unordered school pair, then split each pair's
 * tiles into 4-edge connected components.
 *
 * Duplicate (tile, pair) rows collapse. The same tile under two different pairs
 * stays in separate pair groups and never merges them (A3: B+C does not merge
 * A+B). Output is deterministic: components ordered by (pairA, pairB, min
 * tile), tiles ascending inside each component.
 */
export function computeSharedKnowledgeComponentsV1(
  memberships: Iterable<SharedKnowledgeMembership>,
): SharedClusterComponentV1[] {
  const tilesByPair = new Map<
    number,
    { schoolSlotA: number; schoolSlotB: number; tiles: Set<number> }
  >();
  for (const membership of memberships) {
    if (membership === null || typeof membership !== "object") {
      throw new TypeError("membership must be an object");
    }
    assertTileIndex(membership.tileIndex);
    const [schoolSlotA, schoolSlotB] = normalizeSchoolPairV1(
      membership.schoolSlotA,
      membership.schoolSlotB,
    );
    const key = pairKey(schoolSlotA, schoolSlotB);
    let group = tilesByPair.get(key);
    if (group === undefined) {
      group = { schoolSlotA, schoolSlotB, tiles: new Set<number>() };
      tilesByPair.set(key, group);
    }
    group.tiles.add(membership.tileIndex);
  }

  type PendingComponent = {
    schoolSlotA: number;
    schoolSlotB: number;
    minTileIndex: number;
    tileIndices: number[];
  };
  const pending: PendingComponent[] = [];
  for (const group of tilesByPair.values()) {
    for (const tileIndices of componentsOfPairTiles(group.tiles)) {
      pending.push({
        schoolSlotA: group.schoolSlotA,
        schoolSlotB: group.schoolSlotB,
        minTileIndex: tileIndices[0]!,
        tileIndices,
      });
    }
  }

  pending.sort((a, b) => {
    if (a.schoolSlotA !== b.schoolSlotA) return a.schoolSlotA - b.schoolSlotA;
    if (a.schoolSlotB !== b.schoolSlotB) return a.schoolSlotB - b.schoolSlotB;
    return a.minTileIndex - b.minTileIndex;
  });

  return pending.map((component, componentId) => ({
    componentId,
    schoolSlotA: component.schoolSlotA,
    schoolSlotB: component.schoolSlotB,
    tileCount: component.tileIndices.length,
    tileIndices: component.tileIndices,
  }));
}
