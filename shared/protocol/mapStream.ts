import type { WorldObject } from "../gameplay/gameConfig.ts";
import { MAX_REVISION } from "../world/constants.ts";
import { chunkBounds, chunkCoordinatesForId } from "../world/coordinates.ts";
import { encodeFrame, M2_KIND } from "./m2.ts";

export interface TilePatch {
  readonly chunkId: number;
  readonly baseRevision: bigint;
  readonly nextRevision: bigint;
  readonly tiles: readonly {
    localIndex: number;
    mask: number;
    discovered?: boolean;
  }[];
}

function validate(patch: TilePatch, privateSchool: boolean): void {
  if (
    !Number.isInteger(patch.chunkId) ||
    patch.chunkId < 0 ||
    patch.chunkId > 255 ||
    patch.baseRevision < 0n ||
    patch.nextRevision <= patch.baseRevision ||
    patch.nextRevision > MAX_REVISION ||
    patch.tiles.length < 1 ||
    patch.tiles.length > 4096
  )
    throw new Error("Invalid tile patch");
  const { chunkX, chunkZ } = chunkCoordinatesForId(patch.chunkId);
  const bounds = chunkBounds(chunkX, chunkZ);
  const seen = new Set<number>();
  for (const tile of patch.tiles) {
    if (
      !Number.isInteger(tile.localIndex) ||
      tile.localIndex < 0 ||
      tile.localIndex > 4095 ||
      tile.localIndex % 64 >= bounds.width ||
      Math.floor(tile.localIndex / 64) >= bounds.height ||
      !Number.isInteger(tile.mask) ||
      tile.mask < 0 ||
      tile.mask > 65535 ||
      seen.has(tile.localIndex) ||
      (privateSchool && typeof tile.discovered !== "boolean") ||
      (!privateSchool && tile.discovered !== undefined)
    )
      throw new Error("Invalid patch tile");
    seen.add(tile.localIndex);
  }
}

export function encodeTilePatch(
  patch: TilePatch,
  privateSchool = false,
): Uint8Array {
  validate(patch, privateSchool);
  const stride = privateSchool ? 5 : 4;
  const payload = new Uint8Array(20 + stride * patch.tiles.length);
  const view = new DataView(payload.buffer);
  view.setUint16(0, patch.chunkId, true);
  view.setBigUint64(2, patch.baseRevision, true);
  view.setBigUint64(10, patch.nextRevision, true);
  view.setUint16(18, patch.tiles.length, true);
  patch.tiles.forEach((tile, i) => {
    const offset = 20 + stride * i;
    view.setUint16(offset, tile.localIndex, true);
    view.setUint16(offset + 2, tile.mask, true);
    if (privateSchool) payload[offset + 4] = Number(tile.discovered);
  });
  return encodeFrame(
    privateSchool ? M2_KIND.SCHOOL_PATCH : M2_KIND.PUBLIC_PATCH,
    payload,
  );
}

export function decodeTilePatch(
  payload: Uint8Array,
  privateSchool = false,
): TilePatch {
  if (payload.length < 20) throw new Error("Truncated tile patch");
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const count = view.getUint16(18, true),
    stride = privateSchool ? 5 : 4;
  if (payload.length !== 20 + count * stride)
    throw new Error("Invalid patch length");
  const patch: TilePatch = {
    chunkId: view.getUint16(0, true),
    baseRevision: view.getBigUint64(2, true),
    nextRevision: view.getBigUint64(10, true),
    tiles: Array.from({ length: count }, (_, i) => {
      const offset = 20 + stride * i;
      if (privateSchool && payload[offset + 4]! > 1)
        throw new Error("Invalid fog bit");
      return {
        localIndex: view.getUint16(offset, true),
        mask: view.getUint16(offset + 2, true),
        ...(privateSchool ? { discovered: payload[offset + 4] === 1 } : {}),
      };
    }),
  };
  validate(patch, privateSchool);
  return patch;
}

/** No wallets, player chests, puzzle state or fog enter this feed. */
export interface MapBeacon {
  readonly id: string;
  readonly holder: number | null;
}
export interface MapStateBatch {
  readonly reset: boolean;
  readonly objects: readonly WorldObject[];
  readonly removed: readonly string[];
  readonly beacons: readonly MapBeacon[];
}
export function encodeMapState(batch: MapStateBatch): Uint8Array {
  return encodeFrame(
    M2_KIND.MAP_STATE,
    new TextEncoder().encode(JSON.stringify(batch)),
  );
}
export function decodeMapState(payload: Uint8Array): MapStateBatch {
  const batch = JSON.parse(new TextDecoder().decode(payload)) as MapStateBatch;
  if (
    typeof batch.reset !== "boolean" ||
    !Array.isArray(batch.objects) ||
    !Array.isArray(batch.removed) ||
    !Array.isArray(batch.beacons) ||
    batch.objects.some((o) => !o || o.kind === "chest")
  )
    throw new Error("Invalid map state");
  return batch;
}
