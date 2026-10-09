import type { SchoolRegistry } from "../../shared/world/registry.ts";

export interface SyntheticIdentity {
  readonly actorId: string;
  readonly schoolSlot: number;
}

/** Tokens exist only in local/test bootstrap input and are never logged or sent to peers. */
export class SyntheticAuth {
  readonly #byToken: ReadonlyMap<string, SyntheticIdentity>;

  constructor(
    registry: SchoolRegistry,
    fixtures: readonly { token: string; actorId: string; schoolSlot: number }[],
  ) {
    const tokens = new Map<string, SyntheticIdentity>();
    for (const fixture of fixtures) {
      if (
        !fixture.token ||
        !fixture.actorId ||
        !registry.hasSlot(fixture.schoolSlot) ||
        tokens.has(fixture.token)
      )
        throw new Error("Invalid synthetic identity fixture");
      tokens.set(
        fixture.token,
        Object.freeze({
          actorId: fixture.actorId,
          schoolSlot: fixture.schoolSlot,
        }),
      );
    }
    this.#byToken = tokens;
  }

  authenticate(token: unknown): SyntheticIdentity {
    if (typeof token !== "string")
      throw new Error("Synthetic test token required");
    const identity = this.#byToken.get(token);
    if (!identity) throw new Error("Unauthorized synthetic session");
    return identity;
  }
}
