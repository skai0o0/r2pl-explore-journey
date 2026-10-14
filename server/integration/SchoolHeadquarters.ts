import type { PoolClient } from "pg";
import {
  type HeadquartersArea,
  headquartersTiles,
} from "../../shared/gameplay/expansion.ts";
import {
  type BotSchool,
  botSchools,
} from "../../shared/simulation/schoolBots.ts";
import { crc32 } from "../../shared/world/checksum.ts";
import {
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
} from "../../shared/world/constants.ts";
import {
  chunkCoordinatesForIndex,
  chunkId,
  localIndex,
  tileCoordinates,
  tileIndex,
} from "../../shared/world/coordinates.ts";
import { schoolBit } from "../../shared/world/registry.ts";
/** Versioned development placement; not official school coordinates. */
export function schoolPlayLayout(): {
  schools: readonly BotSchool[];
  headquarters: readonly HeadquartersArea[];
} {
  const centers = [
    [472, 472],
    [512, 472],
    [552, 472],
    [472, 512],
    [552, 512],
    [472, 552],
    [512, 552],
    [552, 552],
  ] as const;
  const schools = botSchools("gather").map((school, index) => ({
    ...school,
    home: tileIndex(centers[index]![0], centers[index]![1]),
  }));
  const headquarters = centers.map(([x, z], schoolSlot) => ({
    schoolSlot,
    x: x - 10,
    z: z - 10,
    size: 20,
  }));
  return {
    schools: schools.map((school) => ({
      ...school,
      protectedHeadquarters: headquarters,
    })),
    headquarters,
  };
}
/** Initial state only: atomic with campaign creation, revision zero and no resource spend. */
export async function seedHeadquarters(
  db: PoolClient,
  campaign: string,
  areas: readonly HeadquartersArea[],
): Promise<void> {
  const masks = new Map<number, Buffer>();
  const fogs = new Map<string, { id: number; slot: number; fog: Buffer }>();
  const occupied = new Set<number>();
  for (const area of areas)
    for (const tile of headquartersTiles(area)) {
      if (occupied.has(tile))
        throw new Error("Overlapping development headquarters");
      occupied.add(tile);
      const { x, z } = tileCoordinates(tile);
      const { chunkX, chunkZ } = chunkCoordinatesForIndex(tile);
      const id = chunkId(chunkX, chunkZ);
      const local = localIndex(x, z);
      let mask = masks.get(id);
      if (!mask) {
        mask = Buffer.alloc(CHUNK_MASK_BYTES);
        masks.set(id, mask);
      }
      mask.writeUInt16LE(
        mask.readUInt16LE(local * 2) | schoolBit(area.schoolSlot),
        local * 2,
      );
      const key = `${id}:${area.schoolSlot}`;
      let view = fogs.get(key);
      if (!view) {
        view = {
          id,
          slot: area.schoolSlot,
          fog: Buffer.alloc(CHUNK_FOG_BYTES),
        };
        fogs.set(key, view);
      }
      view.fog[local >> 3]! |= 1 << (local & 7);
    }
  for (const [id, mask] of masks) {
    await db.query(
      "INSERT INTO r2pl_v2.world_chunk_heads(campaign_id,chunk_id) VALUES($1,$2)",
      [campaign, id],
    );
    await db.query(
      "INSERT INTO r2pl_v2.world_chunks(campaign_id,chunk_id,mask,mask_crc) VALUES($1,$2,$3,$4)",
      [campaign, id, mask, crc32(mask)],
    );
  }
  for (const { id, slot, fog } of fogs.values()) {
    await db.query(
      "INSERT INTO r2pl_v2.school_fog_chunks(campaign_id,chunk_id,school_slot,fog,fog_crc) VALUES($1,$2,$3,$4,$5)",
      [campaign, id, slot, fog, crc32(fog)],
    );
    await db.query(
      "INSERT INTO r2pl_v2.school_chunk_views(campaign_id,chunk_id,school_slot) VALUES($1,$2,$3)",
      [campaign, id, slot],
    );
  }
}
