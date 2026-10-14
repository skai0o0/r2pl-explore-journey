import {
  assertTileIndex,
  tileCoordinates,
  tileIndex,
} from "../world/coordinates.ts";
export interface HeadquartersArea {
  readonly schoolSlot: number;
  readonly x: number;
  readonly z: number;
  readonly size: number;
}
/** Orthogonal neighbors only; no diagonals and no row wrapping. */
export function edgeNeighbors(tile: number): readonly number[] {
  assertTileIndex(tile);
  const { x, z } = tileCoordinates(tile);
  const result: number[] = [];
  if (x > 0) result.push(tile - 1);
  if (x < 999) result.push(tile + 1);
  if (z > 0) result.push(tile - 1000);
  if (z < 999) result.push(tile + 1000);
  return result;
}
export function headquartersTiles(area: HeadquartersArea): readonly number[] {
  if (
    !Number.isInteger(area.schoolSlot) ||
    area.schoolSlot < 0 ||
    area.schoolSlot > 15 ||
    !Number.isInteger(area.size) ||
    area.size < 1 ||
    area.size > 64
  )
    throw new RangeError("Invalid headquarters area");
  tileIndex(area.x, area.z);
  tileIndex(area.x + area.size - 1, area.z + area.size - 1);
  const result: number[] = [];
  for (let z = area.z; z < area.z + area.size; z++)
    for (let x = area.x; x < area.x + area.size; x++)
      result.push(tileIndex(x, z));
  return result;
}
export function headquartersOwner(
  tile: number,
  areas: readonly HeadquartersArea[],
): number | undefined {
  const { x, z } = tileCoordinates(tile);
  return areas.find(
    (area) =>
      x >= area.x &&
      x < area.x + area.size &&
      z >= area.z &&
      z < area.z + area.size,
  )?.schoolSlot;
}
export function isExpansionEdge(
  tile: number,
  knows: (neighbor: number) => boolean,
): boolean {
  return edgeNeighbors(tile).some(knows);
}
