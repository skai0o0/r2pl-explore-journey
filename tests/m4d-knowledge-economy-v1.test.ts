import assert from "node:assert/strict";
import test from "node:test";
import {
  type BillingSnapshot,
  KNOWLEDGE_CYCLE_MS as DAY,
  type EconomyActor,
  type EconomyWorld,
  type EntryRequest,
  freezeKnowledgeBillingV1,
  quoteKnowledgeEntryV1,
  quoteKnowledgeUpkeepV1,
} from "../shared/gameplay/knowledgeEconomyV1.ts";

const actor: EconomyActor = {
  actorId: "student-a",
  schoolSlot: 0,
  serverVerified: true,
  pointsBalance: 10,
};
function world(
  indices: readonly number[],
  holders: readonly number[] = [0, 1],
): EconomyWorld {
  return {
    width: 5,
    height: 5,
    serverVerified: true,
    tiles: indices.map((tileIndex) => ({ tileIndex, holders })),
  };
}
function snapshot(
  indices: readonly number[],
  periodStart = DAY,
  id = "period-1",
): BillingSnapshot {
  return freezeKnowledgeBillingV1({
    billingSnapshotId: id,
    sharedActivatedAt: 0,
    periodStart,
    world: world(indices),
  });
}
function entry(overrides: Partial<EntryRequest> = {}): EntryRequest {
  return {
    actor,
    world: world([0], []),
    tileIndex: 0,
    knownTileIndices: [],
    commandKey: "discover-0",
    receipts: [],
    ...overrides,
  };
}
function upkeep(
  s: BillingSnapshot,
  now = DAY,
  payer = actor,
  paidKeys: readonly string[] = [],
) {
  return quoteKnowledgeUpkeepV1({ actor: payer, snapshot: s, now, paidKeys });
}

test("K01: first exploration quotes exactly 1 Point; known reentry has no effects", () => {
  const request = entry();
  const before = JSON.stringify(request);
  assert.equal(quoteKnowledgeEntryV1(request).feePoints, 1);
  assert.equal(JSON.stringify(request), before);
  assert.deepEqual(quoteKnowledgeEntryV1(entry({ knownTileIndices: [0] })), {
    status: "rejected",
    reason: "no-change",
    feePoints: 0,
  });
  assert.equal(
    quoteKnowledgeEntryV1(entry({ world: world([0], [0]) })).feePoints,
    0,
  );
});

test("K02: guest fee is 2 even with remembered geography; active membership is no-change", () => {
  const guest = quoteKnowledgeEntryV1(
    entry({ world: world([0], [1]), knownTileIndices: [0] }),
  );
  assert.equal(guest.status, "quoted");
  assert.equal(guest.feePoints, 2);
  assert.deepEqual(
    quoteKnowledgeEntryV1(entry({ world: world([0], [0, 1]) })),
    { status: "rejected", reason: "no-change", feePoints: 0 },
  );
});

test("K24: third school is denied before funds evaluation", () => {
  assert.deepEqual(
    quoteKnowledgeEntryV1(
      entry({
        actor: { ...actor, schoolSlot: 2, pointsBalance: 0 },
        world: world([0]),
      }),
    ),
    { status: "rejected", reason: "third-school", feePoints: 0 },
  );
});

test("entry quotes reject unverified, insufficient funds and conflicting replay", () => {
  assert.equal(
    quoteKnowledgeEntryV1(entry({ actor: { ...actor, serverVerified: false } }))
      .status,
    "rejected",
  );
  assert.equal(
    quoteKnowledgeEntryV1(
      entry({ world: { ...world([0], []), serverVerified: false } }),
    ).status,
    "rejected",
  );
  assert.deepEqual(
    quoteKnowledgeEntryV1(entry({ actor: { ...actor, pointsBalance: 0 } })),
    { status: "rejected", reason: "no-funds", feePoints: 0 },
  );
  assert.equal(
    quoteKnowledgeEntryV1(
      entry({ actor: { ...actor, pointsBalance: 1 }, world: world([0], [1]) }),
    ).feePoints,
    0,
  );
  const quote = quoteKnowledgeEntryV1(entry());
  assert.equal(quote.status, "quoted");
  if (quote.status !== "quoted") throw new Error("Expected quote");
  assert.deepEqual(
    quoteKnowledgeEntryV1(entry({ receipts: [quote.receipt] })),
    { status: "rejected", reason: "replay", feePoints: 0 },
  );
  assert.equal(
    quoteKnowledgeEntryV1(
      entry({
        tileIndex: 1,
        world: world([0, 1], []),
        receipts: [quote.receipt],
      }),
    ).status,
    "rejected",
  );
  const conflict = quoteKnowledgeEntryV1(
    entry({ actor: { ...actor, schoolSlot: 1 }, receipts: [quote.receipt] }),
  );
  assert.equal(
    conflict.status === "rejected" && conflict.reason,
    "replay-conflict",
  );
  // Another actor's same command key is not a replay of this actor's command.
  assert.equal(
    quoteKnowledgeEntryV1(
      entry({ receipts: [{ ...quote.receipt, actorId: "other" }] }),
    ).feePoints,
    1,
  );
});

test("invalid school slots, wallet values, indices, holder arrays and receipt data fail closed", () => {
  for (const schoolSlot of [-1, 16, 0.5, Number.NaN])
    assert.equal(
      quoteKnowledgeEntryV1(entry({ actor: { ...actor, schoolSlot } }))
        .feePoints,
      0,
    );
  for (const pointsBalance of [-1, 1.5, Number.POSITIVE_INFINITY])
    assert.equal(
      quoteKnowledgeEntryV1(entry({ actor: { ...actor, pointsBalance } }))
        .feePoints,
      0,
    );
  for (const tileIndex of [-1, 25, 0.5])
    assert.equal(quoteKnowledgeEntryV1(entry({ tileIndex })).feePoints, 0);
  for (const holders of [[0, 0], [0, 1, 2], [16]])
    assert.equal(
      quoteKnowledgeEntryV1(entry({ world: world([0], holders) })).feePoints,
      0,
    );
  for (const invalid of [
    entry({ knownTileIndices: [25] }),
    entry({ knownTileIndices: [0, 0] }),
    entry({ world: world([]) }),
    entry({ world: world([0, 0]) }),
    entry({ commandKey: " " }),
    entry({ actor: { ...actor, actorId: "" } }),
  ])
    assert.equal(quoteKnowledgeEntryV1(invalid).feePoints, 0);
  const receipt = {
    commandKey: "x",
    actorId: actor.actorId,
    schoolSlot: 0,
    tileIndex: 0,
  };
  assert.equal(
    quoteKnowledgeEntryV1(entry({ receipts: [receipt, receipt] })).feePoints,
    0,
  );
  assert.equal(
    quoteKnowledgeEntryV1(entry({ receipts: [{ ...receipt, tileIndex: 25 }] }))
      .feePoints,
    0,
  );
});

test("K03/K06: one or five edge-connected cells cost 1 per school, due exactly at 24h", () => {
  for (const indices of [[0], [0, 1, 2, 3, 4]]) {
    const s = snapshot(indices);
    assert.deepEqual(upkeep(s, DAY - 1), {
      status: "rejected",
      reason: "not-due",
      feePoints: 0,
      paymentKeys: [],
    });
    assert.equal(upkeep(s, 0).feePoints, 0);
    assert.equal(upkeep(s, DAY).feePoints, 1);
    assert.equal(upkeep(s, DAY + 1).feePoints, 1);
    assert.equal(upkeep(s, DAY, { ...actor, schoolSlot: 1 }).feePoints, 1);
  }
});

test("committed paid keys suppress duplicate quotes; each school pays separately", () => {
  const s = snapshot([0, 1, 2, 3, 4]);
  const a = upkeep(s);
  assert.equal(upkeep(s, DAY, actor, a.paymentKeys).feePoints, 0);
  const b = upkeep(s, DAY, { ...actor, schoolSlot: 1 }, a.paymentKeys);
  assert.equal(b.feePoints, 1);
  assert.notDeepEqual(a.paymentKeys, b.paymentKeys);
  assert.equal(
    upkeep(s, DAY, actor, [...a.paymentKeys, ...b.paymentKeys]).feePoints,
    0,
  );
  assert.equal(
    upkeep(s, DAY, actor, [...a.paymentKeys, ...a.paymentKeys]).reason,
    "invalid",
  );
  assert.equal(upkeep(s, DAY, actor, ["forged"]).reason, "invalid");
});

test("one/two consecutive paid cycles follow free cycle; old keys cannot pay next cycle", () => {
  const first = snapshot([0]);
  const second = snapshot([0], 2 * DAY, "period-2");
  const firstQuote = upkeep(first);
  assert.equal(firstQuote.feePoints, 1);
  assert.equal(
    upkeep(first, 2 * DAY, actor, firstQuote.paymentKeys).feePoints,
    0,
  );
  assert.equal(upkeep(second, 2 * DAY - 1).feePoints, 0);
  const secondQuote = upkeep(second, 2 * DAY);
  assert.equal(secondQuote.feePoints, 1);
  assert.notDeepEqual(firstQuote.paymentKeys, secondQuote.paymentKeys);
  assert.equal(
    upkeep(second, 2 * DAY, actor, firstQuote.paymentKeys).reason,
    "invalid",
  );
  assert.equal(
    upkeep(second, 3 * DAY, actor, secondQuote.paymentKeys).feePoints,
    0,
  );
  assert.equal(firstQuote.feePoints + secondQuote.feePoints, 2);
});

test("four edges only: diagonal and row wrap do not connect; A+B and B+C stay separate", () => {
  assert.equal(upkeep(snapshot([0, 6])).feePoints, 2);
  assert.equal(upkeep(snapshot([4, 5])).feePoints, 2);
  const s = freezeKnowledgeBillingV1({
    billingSnapshotId: "pairs",
    sharedActivatedAt: 0,
    periodStart: DAY,
    world: {
      ...world([]),
      tiles: [
        { tileIndex: 0, holders: [0, 1] },
        { tileIndex: 1, holders: [1, 2] },
      ],
    },
  });
  assert.equal(upkeep(s, DAY, { ...actor, schoolSlot: 1 }).feePoints, 2);
  assert.equal(upkeep(s).feePoints, 1);
  assert.equal(upkeep(s, DAY, { ...actor, schoolSlot: 2 }).feePoints, 1);
});

test("K05: merge and split use frozen period-start geometry until next cycle", () => {
  const mutable = {
    ...world([0, 2]),
    tiles: [
      { tileIndex: 0, holders: [0, 1] },
      { tileIndex: 2, holders: [0, 1] },
    ],
  };
  const frozen = freezeKnowledgeBillingV1({
    billingSnapshotId: "before-merge",
    sharedActivatedAt: 0,
    periodStart: DAY,
    world: mutable,
  });
  mutable.tiles.push({ tileIndex: 1, holders: [0, 1] });
  assert.equal(upkeep(frozen, DAY + DAY / 2).feePoints, 2);
  const merged = freezeKnowledgeBillingV1({
    billingSnapshotId: "after-merge",
    sharedActivatedAt: 0,
    periodStart: 2 * DAY,
    world: mutable,
  });
  assert.equal(upkeep(merged, 2 * DAY).feePoints, 1);
  mutable.tiles.splice(2, 1);
  assert.equal(upkeep(merged, 2 * DAY + DAY / 2).feePoints, 1);
  const split = freezeKnowledgeBillingV1({
    billingSnapshotId: "after-split",
    sharedActivatedAt: 0,
    periodStart: 3 * DAY,
    world: mutable,
  });
  assert.equal(upkeep(split, 3 * DAY).feePoints, 2);
  assert.equal(Object.isFrozen(merged.world.tiles[0]?.holders), true);
});

test("upkeep rejects unverified, no funds, nonparticipants and invalid snapshots", () => {
  const s = snapshot([0]);
  assert.equal(
    upkeep(s, DAY, { ...actor, serverVerified: false }).reason,
    "unverified",
  );
  assert.equal(
    upkeep(s, DAY, { ...actor, pointsBalance: 0 }).reason,
    "no-funds",
  );
  assert.equal(upkeep(s, DAY, { ...actor, schoolSlot: 2 }).reason, "no-change");
  assert.equal(upkeep(snapshot([])).reason, "no-change");
  const solo = freezeKnowledgeBillingV1({ ...s, world: world([0], [0]) });
  assert.equal(upkeep(solo, 100 * DAY).feePoints, 0);
  for (const invalid of [
    { ...s, periodStart: 0 },
    { ...s, periodStart: DAY + 1 },
    { ...s, sharedActivatedAt: -1 },
    { ...s, billingSnapshotId: "" },
    { ...s, world: world([25]) },
  ]) {
    assert.throws(() => freezeKnowledgeBillingV1(invalid), RangeError);
    assert.equal(upkeep(invalid).reason, "invalid");
  }
  assert.equal(upkeep(s, Number.NaN).reason, "invalid");
});

test("activation timestamps anchor initial free day, not wall-clock midnight", () => {
  const activated = 12345;
  const s = freezeKnowledgeBillingV1({
    ...snapshot([0]),
    sharedActivatedAt: activated,
    periodStart: activated + DAY,
  });
  assert.equal(upkeep(s, activated + DAY - 1).reason, "not-due");
  assert.equal(upkeep(s, activated + DAY).feePoints, 1);
});

// Persistent wallet debits, immutable snapshot provenance, race/replay ordering,
// and upkeep scheduling still require PostgreSQL integration tests. Quotes alone
// neither pay upkeep nor establish legal Knowledge ownership.

test("malformed runtime arrays fail closed and insufficient upkeep produces no payment keys", () => {
  for (const malformed of [
    { ...entry(), knownTileIndices: null },
    { ...entry(), receipts: [null] },
    { ...entry(), world: { ...world([0]), tiles: null } },
    { ...entry(), world: { ...world([0]), width: 0 } },
    {
      ...entry(),
      world: { ...world([0]), tiles: [{ tileIndex: 0, holders: null }] },
    },
  ]) {
    assert.equal(
      quoteKnowledgeEntryV1(malformed as unknown as EntryRequest).feePoints,
      0,
    );
  }
  assert.deepEqual(
    upkeep(snapshot([0, 2]), DAY, { ...actor, pointsBalance: 1 }),
    {
      status: "rejected",
      reason: "no-funds",
      feePoints: 0,
      paymentKeys: [],
    },
  );
  assert.equal(
    upkeep({
      ...snapshot([0]),
      world: { ...world([0]), serverVerified: false },
    }).reason,
    "unverified",
  );
});

test("pair ordering and tile input ordering do not change receipt keys", () => {
  const s = snapshot([0, 1, 2]);
  const reordered = freezeKnowledgeBillingV1({
    ...s,
    world: world([2, 0, 1], [1, 0]),
  });
  assert.deepEqual(upkeep(s), upkeep(reordered));
});
