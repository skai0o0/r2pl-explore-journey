import {
  CHUNK_SIZE,
  CHUNKS_PER_AXIS,
  SECTOR_CHUNKS_PER_AXIS,
  SECTORS_PER_AXIS,
  WORLD_HEIGHT,
  WORLD_TILE_COUNT,
  WORLD_WIDTH,
} from "./constants.ts";

export interface TileCoordinates {
  readonly x: number;
  readonly z: number;
}

export interface ChunkCoordinates {
  readonly chunkX: number;
  readonly chunkZ: number;
}

export interface SectorCoordinates {
  readonly sectorX: number;
  readonly sectorZ: number;
}

export interface ChunkBounds {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
}

export function assertTileCoordinates(x: number, z: number): void {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(z) ||
    x < 0 ||
    z < 0 ||
    x >= WORLD_WIDTH ||
    z >= WORLD_HEIGHT
  ) {
    throw new RangeError("Tile coordinates outside world");
  }
}

export function assertTileIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= WORLD_TILE_COUNT) {
    throw new RangeError("Tile index outside world");
  }
}

export function assertChunkCoordinates(chunkX: number, chunkZ: number): void {
  if (
    !Number.isInteger(chunkX) ||
    !Number.isInteger(chunkZ) ||
    chunkX < 0 ||
    chunkZ < 0 ||
    chunkX >= CHUNKS_PER_AXIS ||
    chunkZ >= CHUNKS_PER_AXIS
  ) {
    throw new RangeError("Chunk coordinates outside world");
  }
}

export function assertSectorCoordinates(
  sectorX: number,
  sectorZ: number,
): void {
  if (
    !Number.isInteger(sectorX) ||
    !Number.isInteger(sectorZ) ||
    sectorX < 0 ||
    sectorZ < 0 ||
    sectorX >= SECTORS_PER_AXIS ||
    sectorZ >= SECTORS_PER_AXIS
  ) {
    throw new RangeError("Sector coordinates outside world");
  }
}

export function tileIndex(x: number, z: number): number {
  assertTileCoordinates(x, z);
  return z * WORLD_WIDTH + x;
}

export function tileCoordinates(index: number): TileCoordinates {
  assertTileIndex(index);
  return { x: index % WORLD_WIDTH, z: Math.floor(index / WORLD_WIDTH) };
}

export function chunkCoordinates(x: number, z: number): ChunkCoordinates {
  assertTileCoordinates(x, z);
  return {
    chunkX: Math.floor(x / CHUNK_SIZE),
    chunkZ: Math.floor(z / CHUNK_SIZE),
  };
}

export function chunkCoordinatesForIndex(index: number): ChunkCoordinates {
  const { x, z } = tileCoordinates(index);
  return chunkCoordinates(x, z);
}

export function chunkId(chunkX: number, chunkZ: number): number {
  assertChunkCoordinates(chunkX, chunkZ);
  return chunkZ * CHUNKS_PER_AXIS + chunkX;
}

export function chunkCoordinatesForId(id: number): ChunkCoordinates {
  if (
    !Number.isInteger(id) ||
    id < 0 ||
    id >= CHUNKS_PER_AXIS * CHUNKS_PER_AXIS
  ) {
    throw new RangeError("Chunk id outside world");
  }
  return {
    chunkX: id % CHUNKS_PER_AXIS,
    chunkZ: Math.floor(id / CHUNKS_PER_AXIS),
  };
}

export function localIndex(x: number, z: number): number {
  assertTileCoordinates(x, z);
  return (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE);
}

export function chunkBounds(chunkX: number, chunkZ: number): ChunkBounds {
  assertChunkCoordinates(chunkX, chunkZ);
  const x = chunkX * CHUNK_SIZE;
  const z = chunkZ * CHUNK_SIZE;
  return {
    x,
    z,
    width: Math.min(CHUNK_SIZE, WORLD_WIDTH - x),
    height: Math.min(CHUNK_SIZE, WORLD_HEIGHT - z),
  };
}

export function sectorCoordinates(
  chunkX: number,
  chunkZ: number,
): SectorCoordinates {
  assertChunkCoordinates(chunkX, chunkZ);
  return {
    sectorX: Math.floor(chunkX / SECTOR_CHUNKS_PER_AXIS),
    sectorZ: Math.floor(chunkZ / SECTOR_CHUNKS_PER_AXIS),
  };
}

export function sectorId(sectorX: number, sectorZ: number): number {
  assertSectorCoordinates(sectorX, sectorZ);
  return sectorZ * SECTORS_PER_AXIS + sectorX;
}

export function sectorIdForTile(index: number): number {
  const { chunkX, chunkZ } = chunkCoordinatesForIndex(index);
  const { sectorX, sectorZ } = sectorCoordinates(chunkX, chunkZ);
  return sectorId(sectorX, sectorZ);
}
