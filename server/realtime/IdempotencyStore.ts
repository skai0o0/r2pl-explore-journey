import type { Ack } from "../../shared/protocol/m2.ts";

interface Entry {
  readonly payload: Uint8Array;
  readonly result: Promise<Ack>;
}
export type IdempotencyResult =
  | { readonly kind: "new" | "duplicate"; readonly result: Promise<Ack> }
  | { readonly kind: "conflict" }
  | { readonly kind: "full" };

/** Ephemeral, bounded test-command results; M3 replaces with transactional records. */
export class IdempotencyStore {
  readonly #entries = new Map<string, Entry>();
  readonly #limit: number;
  constructor(limit = 100_000) {
    this.#limit = limit;
  }
  get size(): number {
    return this.#entries.size;
  }

  run(
    actorId: string,
    actionKey: Uint8Array,
    payload: Uint8Array,
    action: () => Promise<Ack>,
  ): IdempotencyResult {
    const key = `${actorId}:${Buffer.from(actionKey).toString("hex")}`;
    const previous = this.#entries.get(key);
    if (previous) {
      if (
        previous.payload.byteLength !== payload.byteLength ||
        !previous.payload.every((byte, i) => byte === payload[i])
      )
        return { kind: "conflict" };
      return { kind: "duplicate", result: previous.result };
    }
    if (this.#entries.size >= this.#limit) return { kind: "full" };
    const result = action();
    this.#entries.set(key, { payload: Uint8Array.from(payload), result });
    return { kind: "new", result };
  }
}
