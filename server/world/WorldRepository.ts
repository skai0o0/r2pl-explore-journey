import type { WorldSnapshot } from "../../shared/world/world.ts";

/** M1 snapshot adapter contract. Durable transaction design remains ADR-011/M3. */
export interface WorldRepository {
  save(snapshot: WorldSnapshot): Promise<void>;
  load(): Promise<WorldSnapshot | undefined>;
}

export class InMemoryWorldRepository implements WorldRepository {
  #snapshot: WorldSnapshot | undefined;

  async save(snapshot: WorldSnapshot): Promise<void> {
    this.#snapshot = structuredClone(snapshot);
  }

  async load(): Promise<WorldSnapshot | undefined> {
    return this.#snapshot && structuredClone(this.#snapshot);
  }
}
