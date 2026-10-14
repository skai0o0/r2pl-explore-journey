import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import {
  type HeadquartersArea,
  headquartersTiles,
} from "../../shared/gameplay/expansion.ts";
import {
  GAME_CONFIG,
  SCHOOLS,
  STAGING_OBJECTS,
} from "../../shared/gameplay/gameConfig.ts";
import type { BotSchool } from "../../shared/simulation/schoolBots.ts";
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
import { initializeKnowledgeScores } from "./KnowledgeScore.ts";
/** Signed staging placement shared by PostgreSQL, public objects and browser. */
export function schoolPlayLayout(): {
  schools: readonly BotSchool[];
  headquarters: readonly HeadquartersArea[];
} {
  const size = GAME_CONFIG.footprints.hq.width;
  const headquarters = SCHOOLS.map((s) => ({
    schoolSlot: s.slot,
    x: s.hq.x - size / 2,
    z: s.hq.z - size / 2,
    size,
  }));
  const schools = SCHOOLS.map((s) => ({
    slot: s.slot,
    fixtureId: s.id,
    label: s.shortName,
    color: s.color,
    region: { x: s.hq.x - 128, z: s.hq.z - 128, size: 256 },
    home: tileIndex(s.hq.x, s.hq.z),
    meeting: tileIndex(s.hq.x + 60, s.hq.z),
    protectedHeadquarters: headquarters,
  }));
  return { schools, headquarters };
}
export async function seedWorldObjects(
  db: PoolClient,
  campaign: string,
): Promise<void> {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('signed-game-schema',0))",
  );
  await db.query(
    await readFile(
      new URL(
        "../../database/migrations/003_signed_world.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await initializeKnowledgeScores(db, campaign);
  if (
    (
      await db.query(
        "SELECT 1 FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 LIMIT 1",
        [campaign],
      )
    ).rowCount
  )
    return;
  for (const object of STAGING_OBJECTS)
    await db.query(
      "INSERT INTO r2pl_v2.game_world_objects(campaign_id,id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [campaign, object.id, JSON.stringify(object)],
    );
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
