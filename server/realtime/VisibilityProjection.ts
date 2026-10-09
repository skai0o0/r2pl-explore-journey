import type { Snapshot } from "../../shared/protocol/m2.ts";
import {
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
  CHUNK_SIZE,
  WORLD_WIDTH,
} from "../../shared/world/constants.ts";
import {
  chunkBounds,
  chunkCoordinatesForId,
} from "../../shared/world/coordinates.ts";
import { schoolBit } from "../../shared/world/registry.ts";
import type { WorldState } from "../../shared/world/world.ts";

/** M2 synthetic policy: only the caller's school bit/fog. No metadata or public overview. */
export class SyntheticVisibilityProjection {
  readonly #world: WorldState;
  constructor(world: WorldState) {
    this.#world = world;
  }

  snapshot(schoolSlot: number, id: number, viewRevision: bigint): Snapshot {
    const bit = schoolBit(schoolSlot);
    if (!this.#world.registry.hasSlot(schoolSlot))
      throw new Error("Unregistered school slot");
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    const bounds = chunkBounds(chunkX, chunkZ);
    const mask = new Uint8Array(CHUNK_MASK_BYTES);
    const data = new DataView(mask.buffer);
    for (let localZ = 0; localZ < bounds.height; localZ++) {
      for (let localX = 0; localX < bounds.width; localX++) {
        const local = localZ * CHUNK_SIZE + localX;
        const index = (bounds.z + localZ) * WORLD_WIDTH + bounds.x + localX;
        data.setUint16(local * 2, this.#world.maskAt(index) & bit, true);
      }
    }
    const fog =
      this.#world.fogChunk(schoolSlot, chunkX, chunkZ)?.payload ??
      new Uint8Array(CHUNK_FOG_BYTES);
    return { chunkId: id, viewRevision, mask, fog: Uint8Array.from(fog) };
  }
}
