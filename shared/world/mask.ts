import { WORLD_TILE_COUNT } from "./constants.ts";
import { assertTileIndex } from "./coordinates.ts";
import { schoolBit } from "./registry.ts";

/** Dense school presence only. Rule-specific details live outside this array. */
export class KnowledgeMask {
  readonly #values = new Uint16Array(WORLD_TILE_COUNT);

  get byteLength(): number {
    return this.#values.byteLength;
  }

  get(index: number): number {
    assertTileIndex(index);
    return this.#values[index] ?? 0;
  }

  has(index: number, slot: number): boolean {
    return (this.get(index) & schoolBit(slot)) !== 0;
  }

  set(index: number, mask: number): boolean {
    assertTileIndex(index);
    if (!Number.isInteger(mask) || mask < 0 || mask > 0xffff)
      throw new RangeError("Invalid school mask");
    if (this.#values[index] === mask) return false;
    this.#values[index] = mask;
    return true;
  }

  setPresence(index: number, slot: number, present: boolean): boolean {
    const bit = schoolBit(slot);
    const current = this.get(index);
    return this.set(index, present ? current | bit : current & ~bit);
  }
}
