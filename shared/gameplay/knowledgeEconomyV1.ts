/** Development-only Knowledge v1 quotes. No wallet mutation, timers or ambient decay.
 * Inputs marked serverVerified must come from authenticated server state, never a
 * client assertion. Persistence, snapshot provenance and serialization are server duties.
 */
export const KNOWLEDGE_CYCLE_MS = 24 * 60 * 60 * 1000;

export interface EconomyActor {
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly serverVerified: boolean;
  readonly pointsBalance: number;
}

export interface EconomyTile {
  readonly tileIndex: number;
  readonly holders: readonly number[];
}

export interface EconomyWorld {
  readonly width: number;
  readonly height: number;
  readonly serverVerified: boolean;
  readonly tiles: readonly EconomyTile[];
}

export interface EntryRequest {
  readonly actor: EconomyActor;
  readonly world: EconomyWorld;
  readonly tileIndex: number;
  readonly knownTileIndices: readonly number[];
  readonly commandKey: string;
  readonly receipts: readonly EntryReceipt[];
}

export interface EntryReceipt {
  readonly commandKey: string;
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly tileIndex: number;
}

export type QuoteReason =
  | "invalid"
  | "unverified"
  | "no-funds"
  | "no-change"
  | "third-school"
  | "replay"
  | "replay-conflict"
  | "not-due";

export type EntryQuote =
  | {
      readonly status: "rejected";
      readonly reason: QuoteReason;
      readonly feePoints: 0;
    }
  | {
      readonly status: "quoted";
      readonly feePoints: 1 | 2;
      readonly effect: "discover" | "join";
      readonly receipt: EntryReceipt;
    };

function integer(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function slot(value: number): boolean {
  return integer(value) && value < 16;
}

function identifier(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validActor(actor: EconomyActor): boolean {
  return (
    actor != null &&
    identifier(actor.actorId) &&
    slot(actor.schoolSlot) &&
    integer(actor.pointsBalance) &&
    typeof actor.serverVerified === "boolean"
  );
}

function validWorld(world: EconomyWorld): boolean {
  if (
    world == null ||
    typeof world.serverVerified !== "boolean" ||
    !Array.isArray(world.tiles) ||
    !integer(world.width) ||
    !integer(world.height) ||
    world.width === 0 ||
    world.height === 0 ||
    !integer(world.width * world.height)
  )
    return false;
  const seen = new Set<number>();
  return world.tiles.every((tile) => {
    if (
      tile == null ||
      !Array.isArray(tile.holders) ||
      !integer(tile.tileIndex) ||
      tile.tileIndex >= world.width * world.height ||
      seen.has(tile.tileIndex) ||
      tile.holders.length > 2 ||
      !tile.holders.every(slot) ||
      new Set(tile.holders).size !== tile.holders.length
    )
      return false;
    seen.add(tile.tileIndex);
    return true;
  });
}

export function quoteKnowledgeEntryV1(request: EntryRequest): EntryQuote {
  const reject = (reason: QuoteReason): EntryQuote => ({
    status: "rejected",
    reason,
    feePoints: 0,
  });
  if (
    request == null ||
    !Array.isArray(request.knownTileIndices) ||
    !Array.isArray(request.receipts)
  )
    return reject("invalid");
  const { actor, world } = request;
  if (
    !validActor(actor) ||
    !validWorld(world) ||
    !identifier(request.commandKey) ||
    !integer(request.tileIndex) ||
    request.tileIndex >= world.width * world.height ||
    !request.knownTileIndices.every(
      (tile) => integer(tile) && tile < world.width * world.height,
    ) ||
    new Set(request.knownTileIndices).size !==
      request.knownTileIndices.length ||
    !request.receipts.every(
      (r) =>
        r != null &&
        identifier(r.commandKey) &&
        identifier(r.actorId) &&
        slot(r.schoolSlot) &&
        integer(r.tileIndex) &&
        r.tileIndex < world.width * world.height,
    ) ||
    new Set(
      request.receipts.map((r) => JSON.stringify([r.actorId, r.commandKey])),
    ).size !== request.receipts.length
  )
    return reject("invalid");
  if (actor.serverVerified !== true || world.serverVerified !== true)
    return reject("unverified");
  const previous = request.receipts.find(
    (r) => r.actorId === actor.actorId && r.commandKey === request.commandKey,
  );
  if (previous)
    return reject(
      previous.schoolSlot === actor.schoolSlot &&
        previous.tileIndex === request.tileIndex
        ? "replay"
        : "replay-conflict",
    );
  const tile = world.tiles.find((t) => t.tileIndex === request.tileIndex);
  // Missing authoritative tile state is never interpreted as unowned.
  if (!tile) return reject("invalid");
  if (tile.holders.includes(actor.schoolSlot)) return reject("no-change");
  if (tile.holders.length === 2) return reject("third-school");
  if (
    tile.holders.length === 0 &&
    request.knownTileIndices.includes(request.tileIndex)
  )
    return reject("no-change");
  const feePoints = tile.holders.length === 0 ? 1 : 2;
  if (actor.pointsBalance < feePoints) return reject("no-funds");
  return {
    status: "quoted",
    feePoints,
    effect: feePoints === 1 ? "discover" : "join",
    receipt: {
      commandKey: request.commandKey,
      actorId: actor.actorId,
      schoolSlot: actor.schoolSlot,
      tileIndex: request.tileIndex,
    },
  };
}

export interface BillingSnapshot {
  readonly billingSnapshotId: string;
  readonly sharedActivatedAt: number;
  /** Start of this paid 24h period, not the free period. */
  readonly periodStart: number;
  readonly world: EconomyWorld;
}

/** Copy authoritative geometry at the boundary. Never build this from client topology.
 * Caller persists a unique immutable ID and the snapshot for each period. Separate
 * activation cohorts must use separate snapshots; no implicit scheduling is performed.
 */
export function freezeKnowledgeBillingV1(
  input: BillingSnapshot,
): BillingSnapshot {
  if (
    input == null ||
    !identifier(input.billingSnapshotId) ||
    !validWorld(input.world) ||
    !input.world.serverVerified ||
    !integer(input.sharedActivatedAt) ||
    !integer(input.periodStart) ||
    input.periodStart < input.sharedActivatedAt ||
    input.periodStart - input.sharedActivatedAt < KNOWLEDGE_CYCLE_MS ||
    (input.periodStart - input.sharedActivatedAt) % KNOWLEDGE_CYCLE_MS !== 0 ||
    !integer(input.periodStart + KNOWLEDGE_CYCLE_MS)
  )
    throw new RangeError("Invalid authoritative billing snapshot");
  return Object.freeze({
    billingSnapshotId: input.billingSnapshotId,
    sharedActivatedAt: input.sharedActivatedAt,
    periodStart: input.periodStart,
    world: Object.freeze({
      ...input.world,
      tiles: Object.freeze(
        input.world.tiles.map((t) =>
          Object.freeze({
            tileIndex: t.tileIndex,
            holders: Object.freeze([...t.holders]),
          }),
        ),
      ),
    }),
  });
}

interface Component {
  readonly schools: readonly number[];
  readonly tiles: readonly number[];
}

function components(world: EconomyWorld): Component[] {
  const remaining = new Map(
    world.tiles
      .filter((t) => t.holders.length === 2)
      .map((t) => [t.tileIndex, t]),
  );
  const result: Component[] = [];
  for (const seed of [...remaining.keys()].sort((a, b) => a - b)) {
    const first = remaining.get(seed);
    if (!first) continue;
    const schools = [...first.holders].sort((a, b) => a - b);
    const tiles: number[] = [];
    const queue = [seed];
    remaining.delete(seed);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor]!;
      tiles.push(index);
      const x = index % world.width;
      const neighbors = [index - world.width, index + world.width];
      if (x > 0) neighbors.push(index - 1);
      if (x < world.width - 1) neighbors.push(index + 1);
      for (const neighbor of neighbors) {
        const tile = remaining.get(neighbor);
        if (
          tile?.holders.includes(schools[0]!) &&
          tile.holders.includes(schools[1]!)
        ) {
          remaining.delete(neighbor);
          queue.push(neighbor);
        }
      }
    }
    result.push({ schools, tiles: tiles.sort((a, b) => a - b) });
  }
  return result;
}

export interface UpkeepQuote {
  readonly status: "quoted" | "rejected";
  readonly reason?: QuoteReason;
  readonly feePoints: number;
  /** Proposed receipt keys only. Persist ONLY with an actual committed wallet debit. */
  readonly paymentKeys: readonly string[];
}

export function quoteKnowledgeUpkeepV1(input: {
  readonly actor: EconomyActor;
  readonly snapshot: BillingSnapshot;
  readonly now: number;
  /** Persisted committed payment keys, scoped to this snapshot. */
  readonly paidKeys: readonly string[];
}): UpkeepQuote {
  const reject = (reason: QuoteReason): UpkeepQuote => ({
    status: "rejected",
    reason,
    feePoints: 0,
    paymentKeys: [],
  });
  if (input == null || input.snapshot == null || !Array.isArray(input.paidKeys))
    return reject("invalid");
  if (!validActor(input.actor) || !integer(input.now)) return reject("invalid");
  if (
    input.actor.serverVerified !== true ||
    input.snapshot.world?.serverVerified !== true
  )
    return reject("unverified");
  let snapshot: BillingSnapshot;
  try {
    snapshot = freezeKnowledgeBillingV1(input.snapshot);
  } catch {
    return reject("invalid");
  }
  const groups = components(snapshot.world);
  const key = (group: Component, school: number): string =>
    JSON.stringify([
      snapshot.billingSnapshotId,
      snapshot.periodStart,
      group.schools,
      group.tiles,
      school,
    ]);
  const validKeys = new Set(
    groups.flatMap((group) =>
      group.schools.map((school) => key(group, school)),
    ),
  );
  if (
    new Set(input.paidKeys).size !== input.paidKeys.length ||
    !input.paidKeys.every((paid) => validKeys.has(paid))
  )
    return reject("invalid");
  if (input.now < snapshot.periodStart) return reject("not-due");
  const paymentKeys = groups
    .filter((g) => g.schools.includes(input.actor.schoolSlot))
    .map((g) => key(g, input.actor.schoolSlot))
    .filter((k) => !input.paidKeys.includes(k));
  if (paymentKeys.length === 0) return reject("no-change");
  if (input.actor.pointsBalance < paymentKeys.length) return reject("no-funds");
  return { status: "quoted", feePoints: paymentKeys.length, paymentKeys };
}
