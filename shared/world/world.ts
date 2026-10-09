import {
  assertRevision,
  decodeFogChunk,
  decodeKnowledgeChunk,
  encodeFogChunk,
  encodeKnowledgeChunk,
  type FogChunkRecord,
  type KnowledgeChunkRecord,
} from "./codec.ts";
import {
  CHUNK_COUNT,
  CHUNK_FOG_BYTES,
  CHUNK_SIZE,
  MAX_REVISION,
  WORLD_FORMAT_VERSION,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./constants.ts";
import {
  assertTileIndex,
  chunkBounds,
  chunkCoordinatesForId,
  chunkCoordinatesForIndex,
  chunkId,
  localIndex,
  tileCoordinates,
} from "./coordinates.ts";
import { KnowledgeMask } from "./mask.ts";
import { SchoolRegistry, type SchoolSlot, schoolBit } from "./registry.ts";

export interface SparseMetadataRecord {
  readonly tileIndex: number;
  readonly schoolSlot: number;
  readonly formatVersion: number;
  readonly payload: Uint8Array;
}

export interface WorldSnapshot {
  readonly formatVersion: number;
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
  readonly registry: readonly SchoolSlot[];
  readonly chunks: readonly KnowledgeChunkRecord[];
  readonly fog: readonly FogChunkRecord[];
  readonly metadata: readonly SparseMetadataRecord[];
}

interface FogState {
  readonly data: Uint8Array;
  revision: bigint;
}

interface MetadataState {
  readonly formatVersion: number;
  readonly payload: Uint8Array;
}

function nextRevision(revision: bigint): bigint {
  if (revision === MAX_REVISION)
    throw new RangeError("Chunk revision exhausted");
  return revision + 1n;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

/** M1 world state: no gameplay rules, transport, database, or production roster. */
export class WorldState {
  readonly registry: SchoolRegistry;
  readonly #mask = new KnowledgeMask();
  readonly #chunkRevisions = Array<bigint>(CHUNK_COUNT).fill(0n);
  readonly #fog = new Map<number, Map<number, FogState>>();
  readonly #metadata = new Map<number, Map<number, MetadataState>>();

  constructor(registry: SchoolRegistry) {
    this.registry = registry;
  }

  get maskByteLength(): number {
    return this.#mask.byteLength;
  }

  get fogByteLength(): number {
    let count = 0;
    for (const chunks of this.#fog.values()) count += chunks.size;
    return count * CHUNK_FOG_BYTES;
  }

  get metadataByteLength(): number {
    let count = 0;
    for (const slots of this.#metadata.values())
      for (const record of slots.values()) count += record.payload.byteLength;
    return count;
  }

  get allocatedFogChunkCount(): number {
    return this.fogByteLength / CHUNK_FOG_BYTES;
  }

  maskAt(index: number): number {
    return this.#mask.get(index);
  }

  hasKnowledge(index: number, schoolSlot: number): boolean {
    this.#assertRegistered(schoolSlot);
    return this.#mask.has(index, schoolSlot);
  }

  setPresence(index: number, schoolSlot: number, present: boolean): boolean {
    this.#assertRegistered(schoolSlot);
    if (this.#mask.has(index, schoolSlot) === present) return false;
    this.#bumpChunk(index);
    this.#mask.setPresence(index, schoolSlot, present);
    if (!present) {
      const slots = this.#metadata.get(index);
      slots?.delete(schoolSlot);
      if (slots?.size === 0) this.#metadata.delete(index);
    }
    return true;
  }

  setMetadata(record: SparseMetadataRecord): boolean {
    assertTileIndex(record.tileIndex);
    this.#assertRegistered(record.schoolSlot);
    if (!this.#mask.has(record.tileIndex, record.schoolSlot))
      throw new Error("Metadata without school presence");
    if (
      !Number.isInteger(record.formatVersion) ||
      record.formatVersion < 1 ||
      record.formatVersion > 0xffff ||
      record.payload.byteLength > 1024
    ) {
      throw new RangeError("Invalid sparse metadata format or length");
    }
    const slots =
      this.#metadata.get(record.tileIndex) ?? new Map<number, MetadataState>();
    const previous = slots.get(record.schoolSlot);
    if (
      previous?.formatVersion === record.formatVersion &&
      equalBytes(previous.payload, record.payload)
    )
      return false;
    this.#bumpChunk(record.tileIndex);
    slots.set(record.schoolSlot, {
      formatVersion: record.formatVersion,
      payload: Uint8Array.from(record.payload),
    });
    this.#metadata.set(record.tileIndex, slots);
    return true;
  }

  metadataAt(
    index: number,
    schoolSlot: number,
  ): SparseMetadataRecord | undefined {
    assertTileIndex(index);
    this.#assertRegistered(schoolSlot);
    const record = this.#metadata.get(index)?.get(schoolSlot);
    return (
      record && {
        tileIndex: index,
        schoolSlot,
        formatVersion: record.formatVersion,
        payload: Uint8Array.from(record.payload),
      }
    );
  }

  reveal(index: number, schoolSlot: number): boolean {
    assertTileIndex(index);
    this.#assertRegistered(schoolSlot);
    const { x, z } = tileCoordinates(index);
    const { chunkX, chunkZ } = chunkCoordinatesForIndex(index);
    const id = chunkId(chunkX, chunkZ);
    const chunks = this.#fog.get(schoolSlot) ?? new Map<number, FogState>();
    const state = chunks.get(id) ?? {
      data: new Uint8Array(CHUNK_FOG_BYTES),
      revision: 0n,
    };
    const local = localIndex(x, z);
    const byteIndex = local >> 3;
    const bit = 1 << (local & 7);
    if (state.data[byteIndex]! & bit) return false;
    const revision = nextRevision(state.revision);
    state.data[byteIndex]! |= bit;
    state.revision = revision;
    chunks.set(id, state);
    this.#fog.set(schoolSlot, chunks);
    return true;
  }

  isRevealed(index: number, schoolSlot: number): boolean {
    assertTileIndex(index);
    this.#assertRegistered(schoolSlot);
    const { x, z } = tileCoordinates(index);
    const { chunkX, chunkZ } = chunkCoordinatesForIndex(index);
    const state = this.#fog.get(schoolSlot)?.get(chunkId(chunkX, chunkZ));
    const local = localIndex(x, z);
    return !!(state && state.data[local >> 3]! & (1 << (local & 7)));
  }

  chunkRevision(chunkX: number, chunkZ: number): bigint {
    return this.#chunkRevisions[chunkId(chunkX, chunkZ)]!;
  }

  knowledgeChunk(chunkX: number, chunkZ: number): KnowledgeChunkRecord {
    return encodeKnowledgeChunk(
      this.#mask,
      chunkX,
      chunkZ,
      this.chunkRevision(chunkX, chunkZ),
    );
  }

  fogChunk(
    schoolSlot: number,
    chunkX: number,
    chunkZ: number,
  ): FogChunkRecord | undefined {
    this.#assertRegistered(schoolSlot);
    const state = this.#fog.get(schoolSlot)?.get(chunkId(chunkX, chunkZ));
    return (
      state &&
      encodeFogChunk(state.data, schoolSlot, chunkX, chunkZ, state.revision)
    );
  }

  snapshot(): WorldSnapshot {
    const chunks = Array.from({ length: CHUNK_COUNT }, (_, id) => {
      const { chunkX, chunkZ } = chunkCoordinatesForId(id);
      return this.knowledgeChunk(chunkX, chunkZ);
    });
    const fog: FogChunkRecord[] = [];
    for (const [schoolSlot, chunkMap] of [...this.#fog].sort(
      ([a], [b]) => a - b,
    )) {
      for (const [id, state] of [...chunkMap].sort(([a], [b]) => a - b)) {
        const { chunkX, chunkZ } = chunkCoordinatesForId(id);
        fog.push(
          encodeFogChunk(
            state.data,
            schoolSlot,
            chunkX,
            chunkZ,
            state.revision,
          ),
        );
      }
    }
    const metadata: SparseMetadataRecord[] = [];
    for (const [index, slotMap] of [...this.#metadata].sort(
      ([a], [b]) => a - b,
    )) {
      for (const [schoolSlot, record] of [...slotMap].sort(
        ([a], [b]) => a - b,
      )) {
        metadata.push({
          tileIndex: index,
          schoolSlot,
          formatVersion: record.formatVersion,
          payload: Uint8Array.from(record.payload),
        });
      }
    }
    return {
      formatVersion: WORLD_FORMAT_VERSION,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      chunkSize: CHUNK_SIZE,
      registry: this.registry.entries(),
      chunks,
      fog,
      metadata,
    };
  }

  static restore(
    snapshot: WorldSnapshot,
    registry: SchoolRegistry,
  ): WorldState {
    if (
      snapshot.formatVersion !== WORLD_FORMAT_VERSION ||
      snapshot.width !== WORLD_WIDTH ||
      snapshot.height !== WORLD_HEIGHT ||
      snapshot.chunkSize !== CHUNK_SIZE
    ) {
      throw new Error("Incompatible world snapshot");
    }
    const savedRegistry = new SchoolRegistry(snapshot.registry);
    if (!registry.extends(savedRegistry.entries()))
      throw new Error("School registry mapping changed");
    if (snapshot.chunks.length !== CHUNK_COUNT)
      throw new Error("Incomplete world chunks");
    const world = new WorldState(registry);
    const seenChunks = new Set<number>();
    for (const record of snapshot.chunks) {
      const id = chunkId(record.chunkX, record.chunkZ);
      if (seenChunks.has(id)) throw new Error("Duplicate world chunk");
      seenChunks.add(id);
      const values = decodeKnowledgeChunk(record);
      const bounds = chunkBounds(record.chunkX, record.chunkZ);
      for (let localZ = 0; localZ < bounds.height; localZ++) {
        for (let localX = 0; localX < bounds.width; localX++) {
          const value = values[localZ * CHUNK_SIZE + localX]!;
          if ((value & ~savedRegistry.allowedMask) !== 0)
            throw new Error("Mask contains unknown school slot");
          world.#mask.set(
            (bounds.z + localZ) * WORLD_WIDTH + bounds.x + localX,
            value,
          );
        }
      }
      assertRevision(record.revision);
      world.#chunkRevisions[id] = record.revision;
    }
    const seenFog = new Set<string>();
    for (const record of snapshot.fog) {
      if (!savedRegistry.hasSlot(record.schoolSlot))
        throw new Error("Fog contains unknown school slot");
      const id = chunkId(record.chunkX, record.chunkZ);
      const key = `${record.schoolSlot}:${id}`;
      if (seenFog.has(key)) throw new Error("Duplicate fog chunk");
      seenFog.add(key);
      const chunks =
        world.#fog.get(record.schoolSlot) ?? new Map<number, FogState>();
      chunks.set(id, {
        data: decodeFogChunk(record),
        revision: record.revision,
      });
      world.#fog.set(record.schoolSlot, chunks);
    }
    for (const record of snapshot.metadata) {
      if (
        !savedRegistry.hasSlot(record.schoolSlot) ||
        !world.#mask.has(record.tileIndex, record.schoolSlot)
      ) {
        throw new Error("Sparse metadata/mask mismatch");
      }
      if (
        !Number.isInteger(record.formatVersion) ||
        record.formatVersion < 1 ||
        record.formatVersion > 0xffff ||
        record.payload.byteLength > 1024
      ) {
        throw new Error("Invalid sparse metadata");
      }
      const slots =
        world.#metadata.get(record.tileIndex) ??
        new Map<number, MetadataState>();
      if (slots.has(record.schoolSlot))
        throw new Error("Duplicate sparse metadata");
      slots.set(record.schoolSlot, {
        formatVersion: record.formatVersion,
        payload: Uint8Array.from(record.payload),
      });
      world.#metadata.set(record.tileIndex, slots);
    }
    return world;
  }

  #assertRegistered(slot: number): void {
    schoolBit(slot);
    if (!this.registry.hasSlot(slot))
      throw new Error("School slot is not registered");
  }

  #bumpChunk(index: number): void {
    const { chunkX, chunkZ } = chunkCoordinatesForIndex(index);
    const id = chunkId(chunkX, chunkZ);
    this.#chunkRevisions[id] = nextRevision(this.#chunkRevisions[id]!);
  }
}
