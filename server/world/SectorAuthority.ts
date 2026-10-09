import type { KnowledgeChunkRecord } from "../../shared/world/codec.ts";
import { CHUNK_COUNT, SECTOR_COUNT } from "../../shared/world/constants.ts";
import {
  chunkCoordinatesForId,
  sectorCoordinates,
  sectorId,
  sectorIdForTile,
} from "../../shared/world/coordinates.ts";
import type { WorldState } from "../../shared/world/world.ts";

/** In-process M1 world authority only. No gameplay command or durable ack. */
export interface SectorAuthority {
  readonly id: number;
  readChunk(chunkX: number, chunkZ: number): KnowledgeChunkRecord;
  setPresence(tileIndex: number, schoolSlot: number, present: boolean): boolean;
}

export class InProcessSectorAuthority implements SectorAuthority {
  readonly id: number;
  readonly #world: WorldState;

  constructor(id: number, world: WorldState) {
    if (!Number.isInteger(id) || id < 0 || id >= SECTOR_COUNT)
      throw new RangeError("Invalid sector id");
    this.id = id;
    this.#world = world;
  }

  readChunk(chunkX: number, chunkZ: number): KnowledgeChunkRecord {
    const address = sectorCoordinates(chunkX, chunkZ);
    if (sectorId(address.sectorX, address.sectorZ) !== this.id)
      throw new Error("Chunk belongs to another sector");
    return this.#world.knowledgeChunk(chunkX, chunkZ);
  }

  setPresence(
    tileIndex: number,
    schoolSlot: number,
    present: boolean,
  ): boolean {
    if (sectorIdForTile(tileIndex) !== this.id)
      throw new Error("Tile belongs to another sector");
    return this.#world.setPresence(tileIndex, schoolSlot, present);
  }
}

export class InProcessSectorRouter {
  readonly #sectors: readonly SectorAuthority[];

  constructor(world: WorldState) {
    this.#sectors = Object.freeze(
      Array.from(
        { length: SECTOR_COUNT },
        (_, id) => new InProcessSectorAuthority(id, world),
      ),
    );
  }

  forTile(tileIndex: number): SectorAuthority {
    return this.#sectors[sectorIdForTile(tileIndex)]!;
  }

  forChunk(chunkX: number, chunkZ: number): SectorAuthority {
    const address = sectorCoordinates(chunkX, chunkZ);
    return this.#sectors[sectorId(address.sectorX, address.sectorZ)]!;
  }

  sectorCount(): number {
    return this.#sectors.length;
  }

  chunkCount(): number {
    return CHUNK_COUNT;
  }

  /** Stable test-only inventory for checking the 4×4 routing partition. */
  chunkIdsForSector(id: number): readonly number[] {
    if (!Number.isInteger(id) || id < 0 || id >= SECTOR_COUNT)
      throw new RangeError("Invalid sector id");
    return Array.from({ length: CHUNK_COUNT }, (_, chunkId) => chunkId).filter(
      (chunkId) => {
        const { chunkX, chunkZ } = chunkCoordinatesForId(chunkId);
        const address = sectorCoordinates(chunkX, chunkZ);
        return sectorId(address.sectorX, address.sectorZ) === id;
      },
    );
  }
}
