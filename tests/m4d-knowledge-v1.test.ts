import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ClaimingKnowledge,
  HARD_CLAIM_MS,
  type KnowledgeCommand,
  type KnowledgeState,
  ROLLING_FADE_MS,
  startKnowledgeContest,
  transitionKnowledge,
} from "../shared/gameplay/knowledgeRulesV1.ts";

const HOUR = 3_600_000n;
const T0 = 100n;
function shared(n = 7, retained = 0) {
  return startKnowledgeContest({
    campaignId: "synthetic-campaign",
    contestId: "synthetic-contest",
    schoolSlots: [1, 2],
    openedAtMs: 0n,
    tiles: Array.from({ length: n + retained }, (_, tileIndex) => ({
      tileIndex,
      incumbentSchoolSlot: tileIndex < n ? 1 : 2,
    })),
  });
}
function claiming(n = 7, retained = 0): ClaimingKnowledge {
  const state = transitionKnowledge(shared(n, retained), {
    kind: "departure",
    schoolSlot: 1,
    atMs: T0,
    remainingSchoolValid: true,
  }).state;
  assert.equal(state.phase, "claiming");
  if (state.phase !== "claiming") throw new Error("Expected claim");
  return state;
}
function deposit(
  atMs: bigint,
  requestedPoints = 1n,
  contributionId = "p1",
): Extract<KnowledgeCommand, { kind: "contribute" }> {
  return {
    kind: "contribute",
    contributionId,
    actorId: `actor-${contributionId}`,
    walletId: `wallet-${contributionId}`,
    schoolSlot: 2,
    verified: true,
    requestedPoints,
    walletBalance: 100n,
    atMs,
  };
}

test("K07 guest exit retains incumbent free with no claim timers; replay has no effects", () => {
  const command = {
    kind: "departure",
    schoolSlot: 2,
    atMs: T0,
    remainingSchoolValid: true,
  } as const;
  const result = transitionKnowledge(shared(), command);
  assert.equal(result.state.phase, "sole");
  assert.equal(result.acceptedPoints, 0n);
  assert.equal("hardDeadlineMs" in result.state, false);
  assert.equal(result.effects.length, 7);
  assert.ok(
    result.effects.every(
      (effect) => effect.kind === "ownership" && effect.ownerSchoolSlot === 1,
    ),
  );
  assert.deepEqual(transitionKnowledge(result.state, command).effects, []);
});

test("K08/K09 frozen t0, eligible N and ceil fee; mixed incumbent tiles excluded", () => {
  for (const [n, fee] of [
    [1, 1n],
    [7, 4n],
    [20, 10n],
    [21, 11n],
  ] as const) {
    const state = claiming(n, 3);
    assert.equal(state.requiredPoints, fee);
    assert.equal(state.eligibleTileIndices.length, n);
    assert.equal(state.t0Ms, T0);
    assert.equal(state.rollingDeadlineMs, T0 + ROLLING_FADE_MS);
    assert.equal(state.hardDeadlineMs, T0 + HARD_CLAIM_MS);
  }
  const zero = transitionKnowledge(shared(0, 3), {
    kind: "departure",
    schoolSlot: 1,
    atMs: T0,
    remainingSchoolValid: true,
  });
  assert.equal(zero.state.phase, "sole");
  assert.equal(zero.acceptedPoints, 0n);
});

test("K21 incumbent is lawful current B, snapshot cannot be changed by caller", () => {
  const tiles = [{ tileIndex: 42, incumbentSchoolSlot: 1 }]; // B=1; historical A is irrelevant.
  const state = startKnowledgeContest({
    campaignId: "c",
    contestId: "t",
    schoolSlots: [1, 2],
    tiles,
    openedAtMs: 0n,
  });
  tiles[0]!.incumbentSchoolSlot = 2;
  tiles.push({ tileIndex: 43, incumbentSchoolSlot: 2 });
  assert.equal(state.tiles.length, 1);
  assert.equal(state.tiles[0]?.incumbentSchoolSlot, 1);
  assert.throws(() => {
    (state.tiles[0] as { incumbentSchoolSlot: number }).incumbentSchoolSlot = 2;
  }, TypeError);
  assert.equal(
    transitionKnowledge(state, {
      kind: "departure",
      schoolSlot: 2,
      atMs: T0,
      remainingSchoolValid: true,
    }).state.phase,
    "sole",
  );
});

test("K10/K11 one-point deposits reset only rolling clock; input remains unchanged", () => {
  const original = claiming();
  const first = transitionKnowledge(original, deposit(T0 + HOUR));
  assert.equal(original.receivedPoints, 0n);
  assert.equal(original.contributions.length, 0);
  assert.equal(first.state.phase, "claiming");
  const second = transitionKnowledge(
    first.state,
    deposit(T0 + 2n * HOUR, 1n, "p2"),
  );
  assert.ok("rollingDeadlineMs" in second.state);
  if (!("rollingDeadlineMs" in second.state)) return;
  assert.equal(second.state.rollingDeadlineMs, T0 + 4n * HOUR);
  assert.equal(second.state.hardDeadlineMs, T0 + 48n * HOUR);
});

test("K12 exact rolling cutoff rejects debit and produces failure settlement", () => {
  for (const offset of [0n, 1n]) {
    const result = transitionKnowledge(
      claiming(),
      deposit(T0 + 2n * HOUR + offset),
    );
    assert.equal(result.kind, "reject");
    assert.equal(result.state.phase, "failure");
    assert.equal(result.acceptedPoints, 0n);
    assert.ok(result.effects.every((effect) => effect.kind === "ownership"));
  }
  assert.equal(
    transitionKnowledge(claiming(), deposit(T0 + 2n * HOUR - 1n)).state.phase,
    "claiming",
  );
});

function nearHardDeadline(): KnowledgeState {
  let state: KnowledgeState = claiming(200);
  for (let hour = 1; hour <= 47; hour++)
    state = transitionKnowledge(
      state,
      deposit(T0 + BigInt(hour) * HOUR, 1n, `hour-${hour}`),
    ).state;
  return state;
}
test("K13 hard cutoff and cap at same t0+48h; no hard deadline reset", () => {
  const state = nearHardDeadline();
  assert.ok("rollingDeadlineMs" in state);
  if (!("rollingDeadlineMs" in state)) return;
  assert.equal(state.rollingDeadlineMs, T0 + 48n * HOUR);
  assert.equal(state.hardDeadlineMs, T0 + 48n * HOUR);
  const justBefore = transitionKnowledge(
    state,
    deposit(T0 + 48n * HOUR - 1n, 1n, "last"),
  );
  assert.equal(justBefore.state.phase, "claiming");
  const exact = transitionKnowledge(
    state,
    deposit(T0 + 48n * HOUR, 1n, "last"),
  );
  assert.equal(exact.kind, "reject");
  assert.equal(exact.state.phase, "failure");
  assert.equal(exact.acceptedPoints, 0n);
  assert.equal(
    exact.effects.filter((effect) => effect.kind === "refund_obligation")
      .length,
    47,
  );
});

test("K14 early rolling failure at hour6, not hour48; only inherited tiles neutralize", () => {
  let state: KnowledgeState = claiming(21, 2);
  for (const hour of [1, 2, 3, 4])
    state = transitionKnowledge(
      state,
      deposit(T0 + BigInt(hour) * HOUR, 1n, `p${hour}`),
    ).state;
  const failed = transitionKnowledge(state, {
    kind: "expire",
    atMs: T0 + 6n * HOUR,
  });
  assert.equal(failed.state.phase, "failure");
  const ownership = failed.effects.filter(
    (effect) => effect.kind === "ownership",
  );
  assert.equal(ownership.length, 21);
  assert.ok(
    ownership.every(
      (effect) => effect.ownerSchoolSlot === null && effect.tileIndex < 21,
    ),
  );
  assert.equal(
    transitionKnowledge(failed.state, deposit(T0 + 7n * HOUR)).kind,
    "no_change",
  );
  assert.deepEqual(
    transitionKnowledge(failed.state, { kind: "expire", atMs: T0 + 48n * HOUR })
      .effects,
    [],
  );
});

test("K15/K16 immediate success, capped actual charge, one escrow consumption", () => {
  const first = transitionKnowledge(claiming(), deposit(T0 + HOUR, 2n));
  const paid = transitionKnowledge(
    first.state,
    deposit(T0 + HOUR + 1n, 9n, "p2"),
  );
  assert.equal(paid.acceptedPoints, 2n);
  assert.equal(paid.state.phase, "success");
  assert.deepEqual(
    paid.effects.filter((effect) => effect.kind === "consume_escrow"),
    [{ kind: "consume_escrow", points: 4n }],
  );
  assert.equal(
    paid.effects.filter((effect) => effect.kind === "ownership").length,
    7,
  );
  assert.deepEqual(
    transitionKnowledge(paid.state, { kind: "expire", atMs: T0 + 48n * HOUR })
      .effects,
    [],
  );
  assert.deepEqual(
    transitionKnowledge(
      paid.state,
      deposit(T0 + HOUR + 2n, 1n, "racing-last-point"),
    ).effects,
    [],
  );
});

test("failure records exact original-wallet obligations, never paid credits, exactly once", () => {
  const p1 = transitionKnowledge(claiming(21), deposit(T0 + HOUR, 3n));
  const p2 = transitionKnowledge(p1.state, deposit(T0 + HOUR + 1n, 2n, "p2"));
  const failed = transitionKnowledge(p2.state, {
    kind: "expire",
    atMs: T0 + 3n * HOUR + 1n,
  });
  assert.deepEqual(
    failed.effects.filter((effect) => effect.kind === "refund_obligation"),
    [
      {
        kind: "refund_obligation",
        contributionId: "p1",
        actorId: "actor-p1",
        walletId: "wallet-p1",
        points: 3n,
      },
      {
        kind: "refund_obligation",
        contributionId: "p2",
        actorId: "actor-p2",
        walletId: "wallet-p2",
        points: 2n,
      },
    ],
  );
  const replay = transitionKnowledge(
    failed.state,
    deposit(T0 + 10n * HOUR, 3n),
  );
  assert.equal(replay.kind, "no_change");
  assert.deepEqual(replay.effects, []);
});

test("reconnect/idempotency rejects changed payload, does not reset fade or re-debit", () => {
  const command = deposit(T0 + HOUR);
  const paid = transitionKnowledge(claiming(), command);
  const replay = transitionKnowledge(paid.state, {
    ...command,
    atMs: T0 + 10n * HOUR,
  });
  assert.equal(replay.state, paid.state);
  assert.equal(replay.kind, "no_change");
  assert.equal(replay.acceptedPoints, 0n);
  assert.deepEqual(replay.effects, []);
  for (const changed of [
    { requestedPoints: 2n },
    { actorId: "other" },
    { walletId: "other" },
    { schoolSlot: 1 },
  ]) {
    assert.equal(
      transitionKnowledge(paid.state, { ...command, ...changed }).reason,
      "idempotency_payload_conflict",
    );
  }
});

test("ineligible, empty, poor and out-of-order deposits have no effects/reset", () => {
  const state = claiming();
  for (const changed of [
    { verified: false },
    { schoolSlot: 1 },
    { requestedPoints: 0n },
    { walletBalance: 0n },
    { atMs: T0 - 1n },
  ]) {
    const result = transitionKnowledge(state, {
      ...deposit(T0 + HOUR),
      ...changed,
    });
    assert.equal(result.kind, "reject");
    assert.equal(result.state, state);
    assert.deepEqual(result.effects, []);
  }
  assert.equal(
    transitionKnowledge(state, { kind: "expire", atMs: T0 + HOUR }).kind,
    "no_change",
  );
});

test("unresolved departures fail closed with no arbitrary ownership or money", () => {
  const state = claiming();
  const result = transitionKnowledge(state, {
    kind: "unresolved_departure_conflict",
    atMs: T0 + HOUR,
  });
  assert.equal(result.state.phase, "operator_review");
  assert.deepEqual(result.effects, []);
  assert.equal(
    transitionKnowledge(result.state, deposit(T0 + HOUR)).kind,
    "no_change",
  );
});

test("invalid snapshot and untrusted scalar bounds rejected", () => {
  const input = {
    campaignId: "c",
    contestId: "t",
    schoolSlots: [1, 2] as const,
    tiles: [{ tileIndex: 0, incumbentSchoolSlot: 1 }],
    openedAtMs: 0n,
  };
  for (const changed of [
    { tiles: [] },
    { tiles: [input.tiles[0]!, input.tiles[0]!] },
    { schoolSlots: [1, 1] as const },
    { schoolSlots: [1, 16] as const },
    { openedAtMs: -1n },
    { tiles: [{ tileIndex: -1, incumbentSchoolSlot: 1 }] },
    { tiles: [{ tileIndex: 0, incumbentSchoolSlot: 3 }] },
  ]) {
    assert.throws(() => startKnowledgeContest({ ...input, ...changed }));
  }
  assert.throws(() =>
    transitionKnowledge(claiming(), { ...deposit(T0), requestedPoints: -1n }),
  );
});

test("persisted clocks, frozen fee and receipt corruption fail closed on replay", () => {
  const state = claiming();
  for (const changed of [
    { hardDeadlineMs: state.hardDeadlineMs + 1n },
    { rollingDeadlineMs: state.rollingDeadlineMs + 1n },
    { requiredPoints: 3n },
    { eligibleTileIndices: [0] },
    { receivedPoints: 1n },
  ]) {
    assert.throws(() =>
      transitionKnowledge({ ...state, ...changed }, deposit(T0 + HOUR)),
    );
  }
  const paid = transitionKnowledge(state, deposit(T0 + HOUR)).state;
  if (paid.phase !== "claiming") throw new Error("Expected partial claim");
  assert.throws(() =>
    transitionKnowledge(
      {
        ...paid,
        contributions: [...paid.contributions, ...paid.contributions],
      },
      deposit(T0 + HOUR),
    ),
  );
  assert.throws(() =>
    startKnowledgeContest({
      campaignId: "c",
      contestId: "t",
      schoolSlots: [1, 2],
      tiles: [{ tileIndex: 1_000_000, incumbentSchoolSlot: 1 }],
      openedAtMs: 0n,
    }),
  );
});

test("unsupported claimant departure preserves escrow in operator review", () => {
  const paid = transitionKnowledge(claiming(), deposit(T0 + HOUR)).state;
  const reviewed = transitionKnowledge(paid, {
    kind: "departure",
    schoolSlot: 2,
    atMs: T0 + HOUR + 1n,
    remainingSchoolValid: true,
  });
  assert.equal(reviewed.state.phase, "operator_review");
  if (reviewed.state.phase !== "operator_review")
    throw new Error("Expected review");
  assert.equal(reviewed.state.suspendedClaim, paid);
  assert.deepEqual(reviewed.effects, []);
  assert.equal(
    transitionKnowledge(reviewed.state, deposit(T0 + HOUR + 2n)).kind,
    "no_change",
  );
  const outsider = transitionKnowledge(shared(), {
    kind: "departure",
    schoolSlot: 3,
    atMs: T0,
    remainingSchoolValid: false,
  });
  assert.equal(outsider.kind, "reject");
  assert.equal(outsider.state.phase, "shared");
});

test("K17: serialized simultaneous last-Point contributors cannot overfund or settle twice (pure only)", () => {
  const open = claiming(3); // ceil(3/2)=2
  const a = transitionKnowledge(open, deposit(T0 + HOUR, 1n, "contributor-A"));
  assert.equal(a.kind, "apply");
  assert.equal(a.acceptedPoints, 1n);
  const b = transitionKnowledge(
    a.state,
    deposit(T0 + HOUR, 1n, "contributor-B"),
  );
  assert.equal(b.state.phase, "success");
  assert.equal(b.acceptedPoints, 1n);
  assert.equal(b.effects.filter((e) => e.kind === "consume_escrow").length, 1);
  const concurrentLate = transitionKnowledge(
    b.state,
    deposit(T0 + HOUR, 1n, "contributor-C"),
  );
  assert.equal(concurrentLate.acceptedPoints, 0n);
  assert.equal(concurrentLate.effects.length, 0);
  const retry = transitionKnowledge(
    b.state,
    deposit(T0 + HOUR, 1n, "contributor-B"),
  );
  assert.equal(retry.acceptedPoints, 0n);
  assert.equal(retry.effects.length, 0);
});
test("K18: failed succession refunds exact original-wallet obligations, not old owner", () => {
  const open = claiming(9); // ceil(9/2)=5
  const first = transitionKnowledge(open, deposit(T0 + HOUR, 3n, "payer-A"));
  const second = transitionKnowledge(
    first.state,
    deposit(T0 + 2n * HOUR, 1n, "payer-B"),
  );
  const failed = transitionKnowledge(second.state, {
    kind: "expire",
    atMs: T0 + 4n * HOUR,
  });
  assert.equal(failed.state.phase, "failure");
  const obligations = failed.effects.filter(
    (e) => e.kind === "refund_obligation",
  );
  assert.deepEqual(obligations, [
    {
      kind: "refund_obligation",
      contributionId: "payer-A",
      actorId: "actor-payer-A",
      walletId: "wallet-payer-A",
      points: 3n,
    },
    {
      kind: "refund_obligation",
      contributionId: "payer-B",
      actorId: "actor-payer-B",
      walletId: "wallet-payer-B",
      points: 1n,
    },
  ]);
  const afterRestart = structuredClone(failed.state);
  const replay = transitionKnowledge(afterRestart, {
    kind: "expire",
    atMs: T0 + 5n * HOUR,
  });
  assert.equal(replay.effects.length, 0);
});
