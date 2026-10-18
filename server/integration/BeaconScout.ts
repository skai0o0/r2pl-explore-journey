import type { PoolClient } from "pg";
import {
  BEACON_BUFF_CONFIG as C,
  GAME_CONFIG,
} from "../../shared/gameplay/gameConfig.ts";
import { crc32 } from "../../shared/world/checksum.ts";
import {
  chunkCoordinatesForId,
  chunkId,
  localIndex,
} from "../../shared/world/coordinates.ts";
import { lockExploreNeighborhood } from "../persistence/ExploreBoundary.ts";
import { currentBuff, dailyBuff } from "./BeaconBuffs.ts";

/** Own-school fog only. No ownership, score, or actor-private chest discoveries change. */
export async function scoutFrontier(
  db: PoolClient,
  campaign: string,
  slot: number,
  actor: string,
  key: Buffer,
): Promise<void> {
  if ((await currentBuff(db, campaign, slot))?.id !== "scout")
    throw new RangeError("SCOUT_UNAVAILABLE");
  const usage = await dailyBuff(db, campaign, slot);
  if ((usage.data.earned.scout ?? 0) >= C.scouts.dailyCap)
    throw new RangeError("SCOUT_COOLDOWN");
  const rows = (
    await db.query<{ chunk_id: number; mask: Buffer }>(
      "SELECT chunk_id,mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 ORDER BY chunk_id",
      [campaign],
    )
  ).rows;
  const owned = new Set<number>();
  for (const row of rows) {
    const { chunkX, chunkZ } = chunkCoordinatesForId(row.chunk_id);
    for (let local = 0; local < 4096; local++)
      if (row.mask.readUInt16LE(local * 2) & (1 << slot)) {
        const x = chunkX * 64 + (local % 64),
          z = chunkZ * 64 + Math.floor(local / 64);
        if (x < 1000 && z < 1000) owned.add(z * 1000 + x);
      }
  }
  // Find the own-school boundary with the most unrevealed cells; never inspect rival fog.
  const fogs = new Map(
    (
      await db.query<{ chunk_id: number; fog: Buffer }>(
        "SELECT chunk_id,fog FROM r2pl_v2.school_fog_chunks WHERE campaign_id=$1 AND school_slot=$2",
        [campaign, slot],
      )
    ).rows.map((r) => [r.chunk_id, r.fog]),
  );
  let tile = -1,
    best = -1;
  for (const index of owned) {
    const x = index % 1000,
      z = Math.floor(index / 1000);
    if (
      (x === 0 || owned.has(index - 1)) &&
      (x === 999 || owned.has(index + 1)) &&
      (z === 0 || owned.has(index - 1000)) &&
      (z === 999 || owned.has(index + 1000))
    )
      continue;
    let unknown = 0;
    for (let dz = -C.scoutRadius; dz <= C.scoutRadius; dz++)
      for (let dx = -C.scoutRadius; dx <= C.scoutRadius; dx++) {
        const nx = x + dx,
          nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= 1000 || nz >= 1000) continue;
        const fog = fogs.get(chunkId(Math.floor(nx / 64), Math.floor(nz / 64))),
          local = localIndex(nx, nz);
        if (!((fog?.[local >> 3] ?? 0) & (1 << (local & 7)))) unknown++;
      }
    if (unknown > best) {
      best = unknown;
      tile = index;
    }
  }
  if (tile < 0 || best === 0) throw new RangeError("SCOUT_NO_FRONTIER");
  await db.query("SET LOCAL search_path=r2pl_v2,public");
  await lockExploreNeighborhood(db, campaign, tile, C.scoutRadius);
  const x = tile % 1000,
    z = Math.floor(tile / 1000),
    center = chunkId(Math.floor(x / 64), Math.floor(z / 64));
  const changes = new Map<number, Buffer>();
  for (let dz = -C.scoutRadius; dz <= C.scoutRadius; dz++)
    for (let dx = -C.scoutRadius; dx <= C.scoutRadius; dx++) {
      const nx = x + dx,
        nz = z + dz;
      if (
        nx < 0 ||
        nz < 0 ||
        nx >= GAME_CONFIG.world.width ||
        nz >= GAME_CONFIG.world.height
      )
        continue;
      const id = chunkId(Math.floor(nx / 64), Math.floor(nz / 64));
      let fog = changes.get(id);
      if (!fog) {
        fog = Buffer.from(fogs.get(id) ?? Buffer.alloc(512));
        changes.set(id, fog);
      }
      const local = localIndex(nx, nz);
      fog[local >> 3]! |= 1 << (local & 7);
    }
  let revision = "0";
  for (const [id, fog] of changes) {
    await db.query(
      "INSERT INTO r2pl_v2.school_fog_chunks(campaign_id,chunk_id,school_slot,revision,fog,fog_crc) SELECT $1,$2,$3,revision,$4,$5 FROM r2pl_v2.world_chunk_heads WHERE campaign_id=$1 AND chunk_id=$2 ON CONFLICT(campaign_id,chunk_id,school_slot) DO UPDATE SET revision=EXCLUDED.revision,fog=EXCLUDED.fog,fog_crc=EXCLUDED.fog_crc",
      [campaign, id, slot, fog, crc32(fog)],
    );
    const view = (
      await db.query<{ view_revision: string }>(
        "INSERT INTO r2pl_v2.school_chunk_views(campaign_id,chunk_id,school_slot,view_revision) VALUES($1,$2,$3,1) ON CONFLICT(campaign_id,chunk_id,school_slot) DO UPDATE SET view_revision=school_chunk_views.view_revision+1 RETURNING view_revision::text",
        [campaign, id, slot],
      )
    ).rows[0]!;
    if (id === center) revision = view.view_revision;
  }
  await db.query(
    "INSERT INTO r2pl_v2.outbox_events(campaign_id,actor_id,command_key,event_type,event_version,payload) VALUES($1,$2,$3,'m35_fixture_world_changed',2,$4)",
    [
      campaign,
      actor,
      key,
      JSON.stringify({
        chunkId: center,
        schoolSlot: slot,
        localIndex: localIndex(x, z),
        viewRevision: revision,
        mask: 1 << slot,
        discovered: true,
      }),
    ],
  );
  usage.data.earned.scout = (usage.data.earned.scout ?? 0) + 1;
  await usage.save();
}
