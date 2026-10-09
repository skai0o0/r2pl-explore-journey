import { MAX_SCHOOL_SLOTS } from "./constants.ts";

export interface SchoolSlot {
  readonly id: string;
  readonly slot: number;
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SCHOOL_SLOTS) {
    throw new RangeError("Invalid school slot");
  }
}

export function schoolBit(slot: number): number {
  assertSlot(slot);
  return 1 << slot;
}

/** A value object. No campaign roster is embedded in V2 source. */
export class SchoolRegistry {
  readonly #entries: readonly SchoolSlot[];
  readonly #byId: ReadonlyMap<string, number>;
  readonly #bySlot: ReadonlyMap<number, string>;
  readonly allowedMask: number;

  constructor(entries: readonly SchoolSlot[]) {
    if (entries.length > MAX_SCHOOL_SLOTS)
      throw new RangeError("Too many school slots");
    const byId = new Map<string, number>();
    const bySlot = new Map<number, string>();
    let allowedMask = 0;
    for (const entry of entries) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(entry.id))
        throw new Error("Invalid school id");
      assertSlot(entry.slot);
      if (byId.has(entry.id) || bySlot.has(entry.slot))
        throw new Error("Duplicate school id or slot");
      byId.set(entry.id, entry.slot);
      bySlot.set(entry.slot, entry.id);
      allowedMask |= schoolBit(entry.slot);
    }
    this.#entries = Object.freeze(
      [...entries]
        .sort((a, b) => a.slot - b.slot)
        .map((entry) => Object.freeze({ id: entry.id, slot: entry.slot })),
    );
    this.#byId = byId;
    this.#bySlot = bySlot;
    this.allowedMask = allowedMask;
    Object.freeze(this);
  }

  get size(): number {
    return this.#entries.length;
  }

  entries(): readonly SchoolSlot[] {
    return this.#entries;
  }

  slotOf(id: string): number {
    const slot = this.#byId.get(id);
    if (slot === undefined) throw new Error(`Unknown school id: ${id}`);
    return slot;
  }

  idAt(slot: number): string | undefined {
    assertSlot(slot);
    return this.#bySlot.get(slot);
  }

  hasSlot(slot: number): boolean {
    assertSlot(slot);
    return this.#bySlot.has(slot);
  }

  withSchool(entry: SchoolSlot): SchoolRegistry {
    if (this.#byId.has(entry.id) || this.#bySlot.has(entry.slot))
      throw new Error("Existing school mapping is immutable");
    return new SchoolRegistry([...this.#entries, entry]);
  }

  /** A saved world can be opened with newly added slots, never remapped old ones. */
  extends(saved: readonly SchoolSlot[]): boolean {
    return saved.every(
      ({ id, slot }) =>
        this.#byId.get(id) === slot && this.#bySlot.get(slot) === id,
    );
  }
}
