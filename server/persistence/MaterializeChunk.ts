import type { Pool } from "pg";
import { crc32 } from "../../shared/world/checksum.ts";
import {
  decodeFogChunk,
  decodeKnowledgeChunk,
} from "../../shared/world/codec.ts";
import {
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
  WORLD_FORMAT_VERSION,
} from "../../shared/world/constants.ts";
import { chunkCoordinatesForId } from "../../shared/world/coordinates.ts";

/** Materializes a mutation-log checkpoint without changing the durable head or deleting the log. */
export async function materializeChunk(
  pool: Pool,
  campaignId: string,
  chunkId: number,
): Promise<{ from: bigint; to: bigint; mutations: number }> {
  if (!Number.isInteger(chunkId) || chunkId < 0 || chunkId > 255)
    throw new RangeError("Invalid chunk id");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = r2pl_v2, pg_catalog");
    const head = await client.query<{ revision: string }>(
      "SELECT revision FROM world_chunk_heads WHERE campaign_id=$1 AND chunk_id=$2 FOR UPDATE",
      [campaignId, chunkId],
    );
    const checkpoint = await client.query<{
      revision: string;
      mask: Buffer;
      mask_crc: string;
    }>(
      "SELECT revision,mask,mask_crc FROM world_chunks WHERE campaign_id=$1 AND chunk_id=$2 FOR UPDATE",
      [campaignId, chunkId],
    );
    if (!head.rows[0] || !checkpoint.rows[0]) throw new Error("Missing chunk");
    const from = BigInt(checkpoint.rows[0].revision);
    const to = BigInt(head.rows[0].revision);
    if (from > to || checkpoint.rows[0].mask.length !== CHUNK_MASK_BYTES)
      throw new Error("Corrupt chunk checkpoint");
    const mask = Buffer.from(checkpoint.rows[0].mask);
    const { chunkX, chunkZ } = chunkCoordinatesForId(chunkId);
    decodeKnowledgeChunk({
      formatVersion: WORLD_FORMAT_VERSION,
      chunkX,
      chunkZ,
      revision: from,
      checksum: Number(checkpoint.rows[0].mask_crc),
      payload: mask,
    });
    const mutations = await client.query<{
      revision: string;
      local_index: number;
      school_slot: number;
      new_mask: number;
      discovered: boolean;
    }>(
      "SELECT revision,local_index,school_slot,new_mask,discovered FROM world_mutations WHERE campaign_id=$1 AND chunk_id=$2 AND revision>$3 ORDER BY revision",
      [campaignId, chunkId, from.toString()],
    );
    const fogs = new Map<number, Buffer>();
    let expected = from;
    for (const row of mutations.rows) {
      if (BigInt(row.revision) !== ++expected)
        throw new Error("World mutation revision gap");
      mask.writeUInt16LE(row.new_mask, row.local_index * 2);
      if (!row.discovered) continue;
      let fog = fogs.get(row.school_slot);
      if (!fog) {
        const existing = await client.query<{
          revision: string;
          fog: Buffer;
          fog_crc: string;
        }>(
          "SELECT revision,fog,fog_crc FROM school_fog_chunks WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3 FOR UPDATE",
          [campaignId, chunkId, row.school_slot],
        );
        if (
          !existing.rows[0] ||
          existing.rows[0].fog.length !== CHUNK_FOG_BYTES
        )
          throw new Error("Missing school fog checkpoint");
        fog = Buffer.from(existing.rows[0].fog);
        const fogRevision = BigInt(existing.rows[0].revision);
        if (fogRevision > from) throw new Error("Fog checkpoint ahead of mask");
        decodeFogChunk({
          formatVersion: WORLD_FORMAT_VERSION,
          chunkX,
          chunkZ,
          schoolSlot: row.school_slot,
          revision: fogRevision,
          checksum: Number(existing.rows[0].fog_crc),
          payload: fog,
        });
        fogs.set(row.school_slot, fog);
      }
      fog[row.local_index >> 3]! |= 1 << (row.local_index & 7);
    }
    if (expected !== to) throw new Error("World materialization incomplete");
    if (from !== to) {
      await client.query(
        "UPDATE world_chunks SET revision=$3,mask=$4,mask_crc=$5 WHERE campaign_id=$1 AND chunk_id=$2",
        [campaignId, chunkId, to.toString(), mask, crc32(mask)],
      );
      for (const [slot, fog] of fogs)
        await client.query(
          "UPDATE school_fog_chunks SET revision=$4,fog=$5,fog_crc=$6 WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3",
          [campaignId, chunkId, slot, to.toString(), fog, crc32(fog)],
        );
    }
    await client.query("COMMIT");
    return { from, to, mutations: mutations.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
