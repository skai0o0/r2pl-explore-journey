import {
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
  CHUNK_SIZE,
} from "../world/constants.ts";
import { chunkBounds, chunkCoordinatesForId } from "../world/coordinates.ts";
import { schoolBit } from "../world/registry.ts";
import type { Delta, PublicDelta, PublicSnapshot, Snapshot } from "./m2.ts";

interface ReplicaChunk {
  readonly mask: Uint8Array;
  readonly fog: Uint8Array;
  revision: bigint;
}
export type DeltaResult = "applied" | "duplicate" | "resync";

/** Client-side deterministic state machine. Only projected, single-school data is accepted. */
export class ProjectionReplica {
  readonly #slot: number;
  readonly #chunks = new Map<number, ReplicaChunk>();

  constructor(slot: number) {
    schoolBit(slot);
    this.#slot = slot;
  }

  hasChunk(chunkId: number): boolean {
    return this.#chunks.has(chunkId);
  }
  revision(chunkId: number): bigint | undefined {
    return this.#chunks.get(chunkId)?.revision;
  }
  remove(chunkId: number): void {
    this.#chunks.delete(chunkId);
  }

  applySnapshot(snapshot: Snapshot): void {
    const { chunkX, chunkZ } = chunkCoordinatesForId(snapshot.chunkId);
    const bounds = chunkBounds(chunkX, chunkZ);
    if (
      snapshot.mask.byteLength !== CHUNK_MASK_BYTES ||
      snapshot.fog.byteLength !== CHUNK_FOG_BYTES
    )
      throw new Error("Invalid projected snapshot size");
    const data = new DataView(
      snapshot.mask.buffer,
      snapshot.mask.byteOffset,
      snapshot.mask.byteLength,
    );
    for (let local = 0; local < 4096; local++) {
      const x = local % CHUNK_SIZE,
        z = Math.floor(local / CHUNK_SIZE);
      const mask = data.getUint16(local * 2, true);
      const fog = !!(snapshot.fog[local >> 3]! & (1 << (local & 7)));
      if (
        (mask & ~schoolBit(this.#slot)) !== 0 ||
        ((x >= bounds.width || z >= bounds.height) && (mask !== 0 || fog))
      )
        throw new Error("Unauthorized or padded snapshot data");
    }
    this.#chunks.set(snapshot.chunkId, {
      mask: Uint8Array.from(snapshot.mask),
      fog: Uint8Array.from(snapshot.fog),
      revision: snapshot.viewRevision,
    });
  }

  applyDelta(delta: Delta): DeltaResult {
    const chunk = this.#chunks.get(delta.chunkId);
    if (!chunk) return "resync";
    if (delta.nextRevision <= chunk.revision) return "duplicate";
    if (
      delta.baseRevision !== chunk.revision ||
      delta.nextRevision !== delta.baseRevision + 1n
    )
      return "resync";
    const { chunkX, chunkZ } = chunkCoordinatesForId(delta.chunkId);
    const bounds = chunkBounds(chunkX, chunkZ);
    const x = delta.localIndex % CHUNK_SIZE,
      z = Math.floor(delta.localIndex / CHUNK_SIZE);
    if (
      x >= bounds.width ||
      z >= bounds.height ||
      (delta.mask & ~schoolBit(this.#slot)) !== 0
    )
      throw new Error("Unauthorized or padded delta");
    new DataView(
      chunk.mask.buffer,
      chunk.mask.byteOffset,
      chunk.mask.byteLength,
    ).setUint16(delta.localIndex * 2, delta.mask, true);
    if (delta.discovered)
      chunk.fog[delta.localIndex >> 3]! |= 1 << (delta.localIndex & 7);
    chunk.revision = delta.nextRevision;
    return "applied";
  }

  maskAt(chunkId: number, localIndex: number): number {
    const chunk = this.#chunks.get(chunkId);
    if (
      !chunk ||
      !Number.isInteger(localIndex) ||
      localIndex < 0 ||
      localIndex >= 4096
    )
      throw new RangeError("Unknown chunk or local index");
    return new DataView(
      chunk.mask.buffer,
      chunk.mask.byteOffset,
      chunk.mask.byteLength,
    ).getUint16(localIndex * 2, true);
  }

  isDiscovered(chunkId: number, localIndex: number): boolean {
    const chunk = this.#chunks.get(chunkId);
    if (
      !chunk ||
      !Number.isInteger(localIndex) ||
      localIndex < 0 ||
      localIndex >= 4096
    )
      throw new RangeError("Unknown chunk or local index");
    return !!(chunk.fog[localIndex >> 3]! & (1 << (localIndex & 7)));
  }
}

/** Public active-Knowledge layer. It is intentionally mask-only and cannot reveal fog. */
export class PublicKnowledgeReplica {
  readonly #chunks = new Map<number, { mask: Uint8Array; revision: bigint }>();
  hasChunk(id: number): boolean {
    return this.#chunks.has(id);
  }
  remove(id: number): void {
    this.#chunks.delete(id);
  }
  revision(id: number): bigint | undefined {
    return this.#chunks.get(id)?.revision;
  }
  applySnapshot(snapshot: PublicSnapshot): void {
    if (snapshot.mask.byteLength !== CHUNK_MASK_BYTES)
      throw new Error("Invalid public snapshot size");
    const { chunkX, chunkZ } = chunkCoordinatesForId(snapshot.chunkId),
      bounds = chunkBounds(chunkX, chunkZ),
      data = new DataView(
        snapshot.mask.buffer,
        snapshot.mask.byteOffset,
        snapshot.mask.byteLength,
      );
    for (let local = 0; local < 4096; local++) {
      const x = local % CHUNK_SIZE,
        z = Math.floor(local / CHUNK_SIZE);
      if (
        (x >= bounds.width || z >= bounds.height) &&
        data.getUint16(local * 2, true) !== 0
      )
        throw new Error("Padded public snapshot data");
    }
    this.#chunks.set(snapshot.chunkId, {
      mask: Uint8Array.from(snapshot.mask),
      revision: snapshot.revision,
    });
  }
  applyDelta(delta: PublicDelta): DeltaResult {
    const chunk = this.#chunks.get(delta.chunkId);
    if (!chunk) return "resync";
    if (delta.nextRevision <= chunk.revision) return "duplicate";
    if (delta.baseRevision !== chunk.revision) return "resync";
    new DataView(chunk.mask.buffer).setUint16(
      delta.localIndex * 2,
      delta.mask,
      true,
    );
    chunk.revision = delta.nextRevision;
    return "applied";
  }
  maskAt(id: number, local: number): number {
    const chunk = this.#chunks.get(id);
    if (!chunk || local < 0 || local >= 4096)
      throw new RangeError("Unknown public chunk or local index");
    return new DataView(chunk.mask.buffer).getUint16(local * 2, true);
  }
}
