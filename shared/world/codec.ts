import { crc32 } from "./checksum.ts";
import {
  CHUNK_CELL_COUNT,
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
  CHUNK_SIZE,
  MAX_REVISION,
  WORLD_FORMAT_VERSION,
  WORLD_WIDTH,
} from "./constants.ts";
import { assertChunkCoordinates, chunkBounds } from "./coordinates.ts";
import type { KnowledgeMask } from "./mask.ts";
import { schoolBit } from "./registry.ts";

export interface KnowledgeChunkRecord {
  readonly formatVersion: number;
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly revision: bigint;
  readonly checksum: number;
  readonly payload: Uint8Array;
}

export interface FogChunkRecord extends KnowledgeChunkRecord {
  readonly schoolSlot: number;
}

export function assertRevision(revision: bigint): void {
  if (
    typeof revision !== "bigint" ||
    revision < 0n ||
    revision > MAX_REVISION
  ) {
    throw new RangeError("Invalid chunk revision");
  }
}

function validateEnvelope(
  record: KnowledgeChunkRecord,
  byteLength: number,
): void {
  assertChunkCoordinates(record.chunkX, record.chunkZ);
  assertRevision(record.revision);
  if (
    record.formatVersion !== WORLD_FORMAT_VERSION ||
    record.payload.byteLength !== byteLength
  ) {
    throw new Error("Incompatible chunk format or length");
  }
  if (
    !Number.isInteger(record.checksum) ||
    record.checksum < 0 ||
    record.checksum > 0xffffffff ||
    crc32(record.payload) !== record.checksum
  ) {
    throw new Error("Chunk checksum mismatch");
  }
}

export function encodeKnowledgeChunk(
  mask: KnowledgeMask,
  chunkX: number,
  chunkZ: number,
  revision: bigint,
): KnowledgeChunkRecord {
  assertRevision(revision);
  const bounds = chunkBounds(chunkX, chunkZ);
  const payload = new Uint8Array(CHUNK_MASK_BYTES);
  const view = new DataView(payload.buffer);
  for (let localZ = 0; localZ < bounds.height; localZ++) {
    for (let localX = 0; localX < bounds.width; localX++) {
      const index = (bounds.z + localZ) * WORLD_WIDTH + bounds.x + localX;
      view.setUint16((localZ * CHUNK_SIZE + localX) * 2, mask.get(index), true);
    }
  }
  return {
    formatVersion: WORLD_FORMAT_VERSION,
    chunkX,
    chunkZ,
    revision,
    checksum: crc32(payload),
    payload,
  };
}

export function decodeKnowledgeChunk(
  record: KnowledgeChunkRecord,
): Uint16Array {
  validateEnvelope(record, CHUNK_MASK_BYTES);
  const bounds = chunkBounds(record.chunkX, record.chunkZ);
  const view = new DataView(
    record.payload.buffer,
    record.payload.byteOffset,
    record.payload.byteLength,
  );
  const values = new Uint16Array(CHUNK_CELL_COUNT);
  for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
    for (let localX = 0; localX < CHUNK_SIZE; localX++) {
      const local = localZ * CHUNK_SIZE + localX;
      const value = view.getUint16(local * 2, true);
      if ((localX >= bounds.width || localZ >= bounds.height) && value !== 0) {
        throw new Error("Nonzero knowledge edge padding");
      }
      values[local] = value;
    }
  }
  return values;
}

export function encodeFogChunk(
  data: Uint8Array,
  schoolSlot: number,
  chunkX: number,
  chunkZ: number,
  revision: bigint,
): FogChunkRecord {
  schoolBit(schoolSlot);
  assertRevision(revision);
  const copy = Uint8Array.from(data);
  const record = {
    formatVersion: WORLD_FORMAT_VERSION,
    schoolSlot,
    chunkX,
    chunkZ,
    revision,
    checksum: crc32(copy),
    payload: copy,
  };
  decodeFogChunk(record);
  return record;
}

export function decodeFogChunk(record: FogChunkRecord): Uint8Array {
  schoolBit(record.schoolSlot);
  validateEnvelope(record, CHUNK_FOG_BYTES);
  const bounds = chunkBounds(record.chunkX, record.chunkZ);
  for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
    for (let localX = 0; localX < CHUNK_SIZE; localX++) {
      if (localX < bounds.width && localZ < bounds.height) continue;
      const local = localZ * CHUNK_SIZE + localX;
      if (record.payload[local >> 3]! & (1 << (local & 7)))
        throw new Error("Nonzero fog edge padding");
    }
  }
  return Uint8Array.from(record.payload);
}
