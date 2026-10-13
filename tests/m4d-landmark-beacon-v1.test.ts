import assert from "node:assert/strict";
import test from "node:test";
import type {
  BeaconCommandV1,
  LandmarkBeaconStateV1,
} from "../shared/gameplay/landmarkBeaconV1.ts";
import {
  beaconThresholdCrystalsV1,
  createLandmarkBeaconV1,
  MAX_BEACON_DEPOSIT,
  publicBeaconV1,
  transitionLandmarkBeaconV1,
  validateLandmarkBeaconV1,
} from "../shared/gameplay/landmarkBeaconV1.ts";

function command(
  state: LandmarkBeaconStateV1,
  schoolSlot: number,
  crystals: number,
  commandId = `command-${state.revision}`,
): BeaconCommandV1 {
  return {
    commandId,
    actorId: `actor-${schoolSlot}`,
    schoolSlot,
    expectedRevision: state.revision,
    kind: crystals === 0 ? "claim" : "contribute",
    crystals,
  };
}

function apply(state: LandmarkBeaconStateV1, c: BeaconCommandV1) {
  return transitionLandmarkBeaconV1(state, c, {
    authorized: true,
    actorId: c.actorId,
    schoolSlot: c.schoolSlot,
  });
}

function accepted(
  state: LandmarkBeaconStateV1,
  school: number,
  crystals: number,
) {
  const result = apply(state, command(state, school, crystals));
  assert.equal(result.status, "accepted");
  assert.ok(validateLandmarkBeaconV1(result.state));
  return result.state;
}

test("R4-18/R4-19: integer linear thresholds and independent retained Crystal pots", () => {
  let state = createLandmarkBeaconV1();
  for (const [slot, threshold] of [1000, 1050, 1100, 1150].entries()) {
    assert.equal(state.requiredThresholdCrystals, threshold);
    state = accepted(state, slot, threshold);
    assert.equal(state.activeSchoolSlot, slot);
    assert.equal(state.takeoverSequence, slot);
    assert.equal(state.receipts.at(-1)?.resolvedThresholdCrystals, threshold);
    assert.equal(state.receipts.at(-1)?.activated, true);
  }
  assert.deepEqual(
    state.schoolPotsCrystals.slice(0, 4),
    [1000, 1050, 1100, 1150],
  );
  assert.equal(state.requiredThresholdCrystals, 1200);
  assert.equal(beaconThresholdCrystalsV1(2), 1100);
  assert.deepEqual(publicBeaconV1(state), {
    activeSchoolSlot: 3,
    requiredThresholdCrystals: 1200,
  });
  assert.equal(JSON.stringify(state).includes("Points"), false);
  assert.equal(JSON.stringify(state).includes("points"), false);
});

test("no early light; incumbent donation never relights or increments k", () => {
  const empty = createLandmarkBeaconV1();
  const partial = accepted(empty, 0, 999);
  assert.equal(partial.activeSchoolSlot, null);
  assert.equal(partial.requiredThresholdCrystals, 1000);
  const lit = accepted(partial, 0, 1);
  const donated = accepted(lit, 0, 5000);
  assert.equal(donated.takeoverSequence, 0);
  assert.equal(donated.requiredThresholdCrystals, 1050);
  assert.equal(donated.receipts.at(-1)?.activated, false);
  assert.equal(donated.schoolPotsCrystals[0], 6000);
  const claim = apply(donated, command(donated, 0, 0));
  assert.equal(claim.status, "rejected");
  if (claim.status === "rejected")
    assert.equal(claim.reason, "incumbent-claim");
  assert.equal(empty.schoolPotsCrystals[0], 0);
  assert.equal(empty.receipts.length, 0);
});

test("simultaneous rival bids are explicit serial transitions, not simulated database atomicity", () => {
  const lit = accepted(createLandmarkBeaconV1(), 0, 1000);
  const b = command(lit, 1, 1050, "bid-b");
  const c = command(lit, 2, 1050, "bid-c");
  const first = apply(lit, b);
  assert.equal(first.status, "accepted");
  assert.equal(first.state.activeSchoolSlot, 1);
  const stale = apply(first.state, c);
  assert.equal(stale.status, "rejected");
  if (stale.status === "rejected") assert.equal(stale.reason, "stale-revision");
  assert.equal(stale.state.schoolPotsCrystals[2], 0);
  const next = apply(first.state, {
    ...c,
    expectedRevision: first.state.revision,
  });
  assert.equal(next.status, "accepted");
  assert.equal(next.state.schoolPotsCrystals[2], 1050);
  assert.equal(next.state.activeSchoolSlot, 1);
  assert.equal(next.state.takeoverSequence, 1);
  const final = accepted(next.state, 2, 50);
  assert.equal(final.activeSchoolSlot, 2);
  assert.equal(final.takeoverSequence, 2);
  // Reversing the input order deterministically makes C first instead.
  assert.equal(apply(lit, c).state.activeSchoolSlot, 2);
});

test("high retained rival pot requires a fresh authorized action after activation", () => {
  const a = accepted(createLandmarkBeaconV1(), 0, 5000);
  const b = accepted(a, 1, 5000);
  assert.equal(b.activeSchoolSlot, 1);
  assert.equal(b.schoolPotsCrystals[0], 5000);
  assert.equal(b.schoolPotsCrystals[1], 5000);
  assert.equal(b.takeoverSequence, 1);
  const fresh = command(b, 0, 0, "fresh-a-claim");
  const denied = transitionLandmarkBeaconV1(b, fresh, {
    authorized: false,
    actorId: fresh.actorId,
    schoolSlot: 0,
  });
  assert.equal(denied.status, "rejected");
  assert.equal(denied.state, b);
  const reclaimed = apply(b, fresh);
  assert.equal(reclaimed.status, "accepted");
  assert.equal(reclaimed.state.activeSchoolSlot, 0);
  assert.equal(reclaimed.state.takeoverSequence, 2);
  assert.equal(reclaimed.state.requiredThresholdCrystals, 1150);
  assert.deepEqual(reclaimed.state.schoolPotsCrystals, b.schoolPotsCrystals);
  const replay = apply(reclaimed.state, fresh);
  assert.equal(replay.status, "replayed");
  assert.equal(replay.state, reclaimed.state);
  assert.equal(replay.state.takeoverSequence, 2);
  const bAgain = accepted(reclaimed.state, 1, 1);
  assert.equal(bAgain.activeSchoolSlot, 1);
  assert.equal(bAgain.takeoverSequence, 3);
  assert.equal(bAgain.schoolPotsCrystals[0], 5000);
  assert.equal(bAgain.schoolPotsCrystals[1], 5001);
});

test("replay after snapshot restore keeps original resolution and never donates/takes over twice", () => {
  const empty = createLandmarkBeaconV1();
  const c = command(empty, 0, 1000, "lost-ack");
  const first = apply(empty, c);
  const later = accepted(first.state, 1, 1050);
  const restored: LandmarkBeaconStateV1 = JSON.parse(JSON.stringify(later));
  const replay = apply(restored, c);
  assert.equal(replay.status, "replayed");
  assert.equal(replay.state, restored);
  if (replay.status === "replayed") {
    assert.deepEqual(
      replay.receipt,
      first.status === "accepted" ? first.receipt : null,
    );
    assert.equal(replay.receipt.resolvedThresholdCrystals, 1000);
  }
  assert.equal(replay.state.takeoverSequence, 1);
  for (const changed of [
    { ...c, crystals: 1001 },
    { ...c, expectedRevision: 2 },
  ]) {
    const conflict = apply(restored, changed);
    assert.equal(conflict.status, "rejected");
    if (conflict.status === "rejected")
      assert.equal(conflict.reason, "command-conflict");
  }
  // Command IDs are scoped to the actor within this landmark instance.
  const other = apply(restored, command(restored, 2, 1, "lost-ack"));
  assert.equal(other.status, "accepted");
});

test("authorization binds both verified actor and school even for replay", () => {
  const state = createLandmarkBeaconV1();
  const c = command(state, 0, 1000);
  for (const auth of [
    { authorized: false, actorId: c.actorId, schoolSlot: 0 },
    { authorized: true, actorId: "outsider", schoolSlot: 0 },
    { authorized: true, actorId: c.actorId, schoolSlot: 1 },
  ]) {
    for (const current of [state, apply(state, c).state]) {
      const result = transitionLandmarkBeaconV1(current, c, auth);
      assert.equal(result.status, "rejected");
      if (result.status === "rejected")
        assert.equal(result.reason, "unauthorized");
      assert.equal(result.state, current);
    }
  }
});

test("deposits are bounded positive safe integers; invalid amounts are rejected without partial credit", () => {
  const state = createLandmarkBeaconV1();
  for (const crystals of [
    -1,
    0,
    0.5,
    NaN,
    Infinity,
    MAX_BEACON_DEPOSIT + 1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    const result = apply(state, { ...command(state, 0, 1), crystals });
    assert.equal(result.status, "rejected");
    if (result.status === "rejected")
      assert.equal(result.reason, "invalid-command");
    assert.equal(result.state, state);
  }
  assert.equal(
    accepted(state, 15, MAX_BEACON_DEPOSIT).schoolPotsCrystals[15],
    MAX_BEACON_DEPOSIT,
  );
  for (const c of [
    { ...command(state, 0, 1), schoolSlot: 16 },
    { ...command(state, 0, 1), schoolSlot: -1 },
    { ...command(state, 0, 1), expectedRevision: 0.5 },
    { ...command(state, 0, 1), commandId: "" },
  ])
    assert.equal(apply(state, c).status, "rejected");
  const claim = apply(state, command(state, 0, 0));
  assert.equal(claim.status, "rejected");
  if (claim.status === "rejected")
    assert.equal(claim.reason, "below-threshold");
});

test("snapshots reject invalid bounds, missing history, forged sequence/pots and tampered receipts", () => {
  const state = accepted(createLandmarkBeaconV1(), 0, 1000);
  const receipt = state.receipts[0];
  assert.ok(receipt);
  const malformed: unknown[] = [
    null,
    {},
    { ...state, ruleVersion: "v2" },
    { ...state, revision: -1 },
    { ...state, activeSchoolSlot: 16 },
    { ...state, takeoverSequence: 1 },
    { ...state, requiredThresholdCrystals: 1103 },
    { ...state, schoolPotsCrystals: [1000] },
    { ...state, schoolPotsCrystals: Array(16) },
    {
      ...state,
      schoolPotsCrystals: Array(16).fill(Number.MAX_SAFE_INTEGER + 1),
    },
    { ...state, schoolPotsCrystals: Array(16).fill(0) },
    { ...state, receipts: [] },
    { ...state, receipts: [{ ...receipt, activated: false }] },
    { ...state, receipts: [{ ...receipt, resolvedThresholdCrystals: 1050 }] },
    {
      ...state,
      receipts: [
        { ...receipt, command: { ...receipt.command, expectedRevision: 1 } },
      ],
    },
  ];
  for (const snapshot of malformed)
    assert.equal(validateLandmarkBeaconV1(snapshot), false);
  assert.throws(() => beaconThresholdCrystalsV1(0.5), RangeError);
  assert.throws(
    () => publicBeaconV1({ ...state, takeoverSequence: 1 }),
    TypeError,
  );
  const invalid = { ...state, requiredThresholdCrystals: 1103 };
  const result = apply(invalid, command(invalid, 1, 1050));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected")
    assert.equal(result.reason, "invalid-state");
});

test("caller mutation of a submitted command cannot rewrite stored takeover history", () => {
  const empty = createLandmarkBeaconV1();
  const c = { ...command(empty, 0, 1000) };
  const result = apply(empty, c);
  c.crystals = 999;
  assert.equal(result.state.receipts[0]?.command.crystals, 1000);
  assert.ok(validateLandmarkBeaconV1(result.state));
});
