import type { PoolClient } from "pg";
import {
  edgeNeighbors,
  type HeadquartersArea,
  headquartersOwner,
} from "../../shared/gameplay/expansion.ts";
import { crc32 } from "../../shared/world/checksum.ts";
import { decodeKnowledgeChunk } from "../../shared/world/codec.ts";
import {
  CHUNK_MASK_BYTES,
  WORLD_FORMAT_VERSION,
} from "../../shared/world/constants.ts";
import {
  chunkCoordinatesForId,
  chunkCoordinatesForIndex,
  chunkId,
  localIndex,
  tileCoordinates,
} from "../../shared/world/coordinates.ts";
import { schoolBit } from "../../shared/world/registry.ts";
export interface ExploreBoundary {
  readonly headquarters: readonly HeadquartersArea[];
  readonly ruleVersion?: 1;
  readonly requirePortalMember?: true;
}
const idFor = (tile: number): number => {
  const { chunkX, chunkZ } = chunkCoordinatesForIndex(tile);
  return chunkId(chunkX, chunkZ);
};
/** Lock target and cross-chunk neighbors in one global order before any world/wallet writes. */
export async function lockExploreNeighborhood(
  db: PoolClient,
  campaign: string,
  tile: number,
  revealRadius = 0,
): Promise<void> {
  const neighborhood = [tile, ...edgeNeighbors(tile)];
  const center = tileCoordinates(tile);
  for (let dz = -revealRadius; dz <= revealRadius; dz++)
    for (let dx = -revealRadius; dx <= revealRadius; dx++) {
      const x = center.x + dx,
        z = center.z + dz;
      if (x >= 0 && z >= 0 && x < 1000 && z < 1000)
        neighborhood.push(z * 1000 + x);
    }
  const ids = [...new Set(neighborhood.map(idFor))].sort((a, b) => a - b);
  const zero = Buffer.alloc(CHUNK_MASK_BYTES);
  for (const id of ids) {
    const created = await db.query(
      "INSERT INTO world_chunk_heads(campaign_id,chunk_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING chunk_id",
      [campaign, id],
    );
    if (created.rowCount)
      await db.query(
        "INSERT INTO world_chunks(campaign_id,chunk_id,mask,mask_crc) VALUES($1,$2,$3,$4)",
        [campaign, id, zero, crc32(zero)],
      );
    await db.query(
      "SELECT revision FROM world_chunk_heads WHERE campaign_id=$1 AND chunk_id=$2 FOR UPDATE",
      [campaign, id],
    );
  }
}
export async function checkExploreBoundary(
  db: PoolClient,
  campaign: string,
  slot: number,
  tile: number,
  boundary: ExploreBoundary,
): Promise<"not_adjacent" | "protected_hq" | undefined> {
  const owner = headquartersOwner(tile, boundary.headquarters);
  if (owner !== undefined && owner !== slot) return "protected_hq";
  const neighbors = edgeNeighbors(tile);
  const ids = [...new Set(neighbors.map(idFor))];
  const rows = await db.query<{
    chunk_id: number;
    revision: string;
    mask: Buffer;
    mask_crc: string;
    head_revision: string;
  }>(
    "SELECT w.chunk_id,w.revision,w.mask,w.mask_crc,h.revision AS head_revision FROM world_chunks w JOIN world_chunk_heads h USING(campaign_id,chunk_id) WHERE w.campaign_id=$1 AND w.chunk_id=ANY($2::smallint[])",
    [campaign, ids],
  );
  const masks = new Map<number, Uint16Array>();
  for (const row of rows.rows) {
    if (row.revision !== row.head_revision)
      throw new Error("Expansion requires full-chunk checkpoint");
    const { chunkX, chunkZ } = chunkCoordinatesForId(row.chunk_id);
    masks.set(
      row.chunk_id,
      decodeKnowledgeChunk({
        formatVersion: WORLD_FORMAT_VERSION,
        chunkX,
        chunkZ,
        revision: BigInt(row.revision),
        checksum: Number(row.mask_crc),
        payload: row.mask,
      }),
    );
  }
  const bit = schoolBit(slot);
  return neighbors.some((neighbor) => {
    const { x, z } = tileCoordinates(neighbor);
    return !!((masks.get(idFor(neighbor))?.[localIndex(x, z)] ?? 0) & bit);
  })
    ? undefined
    : "not_adjacent";
}
