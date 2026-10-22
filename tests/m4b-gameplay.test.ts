import assert from "node:assert/strict";
import test from "node:test";
import type {
  ContestCandidateRules,
  ContestRecord,
  KnowledgeDecayCandidateRules,
  LandmarkCandidateRules,
  LandmarkState,
} from "../shared/gameplay/candidates.ts";
import {
  evaluateContestDefense,
  evaluateKnowledgeDecay,
  evaluateLandmarkContribution,
  evaluateSharedKnowledgeEntry,
  resolveContestPhase,
} from "../shared/gameplay/candidates.ts";
import type {
  DevExploreConfig,
  DevExploreInput,
} from "../shared/gameplay/devContract.ts";
import { evaluateDevExplore } from "../shared/gameplay/devRules.ts";

const HOUR_MS = 3_600_000n;
const DAY_MS = 24n * HOUR_MS;

const devConfig = (cost: bigint): DevExploreConfig => ({
  ruleVersion: 0,
  resource: "fixture-credit",
  cost,
});

const exploreInput = (
  overrides: Partial<DevExploreInput> = {},
): DevExploreInput => ({
  tileIndex: 222_242,
  schoolSlot: 0,
  knownBySchool: false,
  discoveredBySchool: false,
  balance: 30n,
  ...overrides,
});

const contestRules = (
  overrides: Partial<ContestCandidateRules> = {},
): ContestCandidateRules => ({
  sharedEntryCost: 1n,
  defenseCost: 1n,
  contestDurationMs: DAY_MS,
  defenseAtDeadlineCounts: true,
  ...overrides,
});

const contestRecord = (
  overrides: Partial<ContestRecord> = {},
): ContestRecord => ({
  tileIndex: 1000,
  attackerSchoolSlot: 1,
  defenderSchoolSlot: 0,
  openedAtMs: 1_000n,
  defendedAtMs: null,
  ...overrides,
});

const decayRules = (
  overrides: Partial<KnowledgeDecayCandidateRules> = {},
): KnowledgeDecayCandidateRules => ({
  graceDurationMs: 12n * HOUR_MS,
  tickDurationMs: HOUR_MS,
  retentionLossPerTick: 10n,
  fullDecayDurationMs: 22n * HOUR_MS,
  ...overrides,
});

const landmarkRules = (
  overrides: Partial<LandmarkCandidateRules> = {},
): LandmarkCandidateRules => ({
  firstLightTarget: 100n,
  overtake: { kind: "absolute_margin", margin: 20n },
  ...overrides,
});

const emptyLandmark = (): LandmarkState => ({
  ownerSchoolSlot: null,
  contributions: [],
});

// --- evaluateDevExplore ------------------------------------------------------

test("evaluateDevExplore applies a new tile with exactly the configured cost", () => {
  const decision = evaluateDevExplore(exploreInput(), devConfig(1n));
  assert.deepEqual(decision, { kind: "apply", debit: 1n });
  const expensive = evaluateDevExplore(
    exploreInput({ balance: 30n }),
    devConfig(30n),
  );
  assert.deepEqual(expensive, { kind: "apply", debit: 30n });
});

test("evaluateDevExplore no_change for known and discovered before affordability", () => {
  const input = exploreInput({
    knownBySchool: true,
    discoveredBySchool: true,
    balance: 0n,
  });
  assert.deepEqual(evaluateDevExplore(input, devConfig(5n)), {
    kind: "no_change",
    debit: 0n,
  });
  assert.deepEqual(
    evaluateDevExplore(
      exploreInput({
        knownBySchool: true,
        discoveredBySchool: true,
        balance: 100n,
      }),
      devConfig(5n),
    ),
    { kind: "no_change", debit: 0n },
  );
});

test("evaluateDevExplore still applies when only one of known/discovered is set", () => {
  assert.deepEqual(
    evaluateDevExplore(
      exploreInput({ knownBySchool: true, discoveredBySchool: false }),
      devConfig(1n),
    ),
    { kind: "apply", debit: 1n },
  );
  assert.deepEqual(
    evaluateDevExplore(
      exploreInput({ knownBySchool: false, discoveredBySchool: true }),
      devConfig(1n),
    ),
    { kind: "apply", debit: 1n },
  );
});

test("evaluateDevExplore rejects insufficient fixture credit with zero debit", () => {
  assert.deepEqual(
    evaluateDevExplore(exploreInput({ balance: 0n }), devConfig(1n)),
    { kind: "reject", reason: "insufficient_fixture_credit", debit: 0n },
  );
  assert.deepEqual(
    evaluateDevExplore(exploreInput({ balance: 2n }), devConfig(3n)),
    { kind: "reject", reason: "insufficient_fixture_credit", debit: 0n },
  );
  assert.deepEqual(
    evaluateDevExplore(exploreInput({ balance: 3n }), devConfig(3n)),
    { kind: "apply", debit: 3n },
  );
});

test("evaluateDevExplore accepts zero cost and stays deterministic", () => {
  const input = exploreInput();
  const first = evaluateDevExplore(input, devConfig(0n));
  assert.deepEqual(first, { kind: "apply", debit: 0n });
  assert.deepEqual(evaluateDevExplore(input, devConfig(0n)), first);
});

test("evaluateDevExplore isolates schools on the same tile", () => {
  const config = devConfig(1n);
  const school0 = evaluateDevExplore(
    exploreInput({ schoolSlot: 0, balance: 10n }),
    config,
  );
  const school15 = evaluateDevExplore(
    exploreInput({
      schoolSlot: 15,
      balance: 10n,
      knownBySchool: true,
      discoveredBySchool: true,
    }),
    config,
  );
  assert.deepEqual(school0, { kind: "apply", debit: 1n });
  assert.deepEqual(school15, { kind: "no_change", debit: 0n });
});

test("evaluateDevExplore validates tile, school and nonnegative bigint fields", () => {
  const config = devConfig(1n);
  for (const tileIndex of [-1, 1_000_000, 0.5, Number.NaN]) {
    assert.throws(() =>
      evaluateDevExplore(exploreInput({ tileIndex }), config),
    );
  }
  for (const schoolSlot of [-1, 16, 1.5, Number.NaN]) {
    assert.throws(() =>
      evaluateDevExplore(exploreInput({ schoolSlot }), config),
    );
  }
  assert.throws(() =>
    evaluateDevExplore(exploreInput({ balance: -1n }), config),
  );
  assert.throws(() =>
    evaluateDevExplore(
      exploreInput({ balance: 0 as unknown as bigint }),
      config,
    ),
  );
  assert.throws(() => evaluateDevExplore(exploreInput(), devConfig(-1n)));
  assert.throws(() =>
    evaluateDevExplore(exploreInput(), devConfig(0 as unknown as bigint)),
  );
  assert.throws(() =>
    evaluateDevExplore(exploreInput(), {
      ruleVersion: 1,
      resource: "fixture-credit",
      cost: 1n,
    } as unknown as DevExploreConfig),
  );
  assert.throws(() =>
    evaluateDevExplore(exploreInput(), {
      ruleVersion: 0,
      resource: "points",
      cost: 1n,
    } as unknown as DevExploreConfig),
  );
});

// --- Shared Knowledge contest ------------------------------------------------

test("contest entry applies configured cost and rejects insufficient balance", () => {
  const rules = contestRules({ sharedEntryCost: 3n });
  const open = (balance: bigint) =>
    evaluateSharedKnowledgeEntry(
      {
        tileIndex: 5000,
        attackerSchoolSlot: 1,
        defenderSchoolSlot: 0,
        attackerBalance: balance,
        openedAtMs: 100n,
        existing: null,
      },
      rules,
    );
  assert.deepEqual(open(3n), {
    kind: "apply",
    debit: 3n,
    record: contestRecord({ tileIndex: 5000, openedAtMs: 100n }),
  });
  assert.deepEqual(open(2n), {
    kind: "reject",
    reason: "insufficient_balance",
    debit: 0n,
  });
});

test("contest entry rejects same school and an already open contest", () => {
  const rules = contestRules();
  const base = {
    tileIndex: 5000,
    attackerSchoolSlot: 1,
    defenderSchoolSlot: 0,
    attackerBalance: 10n,
    openedAtMs: 100n,
    existing: null,
  };
  assert.deepEqual(
    evaluateSharedKnowledgeEntry(
      { ...base, attackerSchoolSlot: 2, defenderSchoolSlot: 2 },
      rules,
    ),
    { kind: "reject", reason: "invalid_argument", debit: 0n },
  );
  assert.deepEqual(
    evaluateSharedKnowledgeEntry({ ...base, existing: contestRecord() }, rules),
    { kind: "reject", reason: "contest_already_open", debit: 0n },
  );
});

test("contest defense pays the defender cost and repeats are no_change", () => {
  const rules = contestRules({ defenseCost: 2n });
  const record = contestRecord({ openedAtMs: 100n });
  const defended = evaluateContestDefense(
    record,
    { actorSchoolSlot: 0, actorBalance: 2n, actedAtMs: 200n },
    rules,
  );
  assert.equal(defended.kind, "apply");
  assert.equal(defended.kind === "apply" && defended.debit, 2n);
  assert.equal(defended.kind === "apply" && defended.record.defendedAtMs, 200n);
  const again = evaluateContestDefense(
    defended.kind === "apply" ? defended.record : record,
    { actorSchoolSlot: 0, actorBalance: 2n, actedAtMs: 300n },
    rules,
  );
  assert.equal(again.kind, "no_change");
});

test("contest defense isolates schools and checks balance", () => {
  const rules = contestRules({ defenseCost: 5n });
  const record = contestRecord({ openedAtMs: 1_000n });
  assert.deepEqual(
    evaluateContestDefense(
      record,
      { actorSchoolSlot: 1, actorBalance: 10n, actedAtMs: 2_000n },
      rules,
    ),
    { kind: "reject", reason: "wrong_school_role", debit: 0n },
  );
  assert.deepEqual(
    evaluateContestDefense(
      record,
      { actorSchoolSlot: 2, actorBalance: 10n, actedAtMs: 2_000n },
      rules,
    ),
    { kind: "reject", reason: "wrong_school_role", debit: 0n },
  );
  assert.deepEqual(
    evaluateContestDefense(
      record,
      { actorSchoolSlot: 0, actorBalance: 4n, actedAtMs: 2_000n },
      rules,
    ),
    { kind: "reject", reason: "insufficient_balance", debit: 0n },
  );
});

test("contest defense respects inclusive and exclusive deadline boundaries", () => {
  const openedAtMs = 1_000n;
  const durationMs = DAY_MS;
  const deadline = openedAtMs + durationMs;
  const record = contestRecord({ openedAtMs });
  const defendAt = (atMs: bigint, inclusive: boolean) =>
    evaluateContestDefense(
      record,
      { actorSchoolSlot: 0, actorBalance: 10n, actedAtMs: atMs },
      contestRules({
        contestDurationMs: durationMs,
        defenseAtDeadlineCounts: inclusive,
      }),
    );

  assert.equal(defendAt(deadline - 1n, true).kind, "apply");
  assert.equal(defendAt(deadline, true).kind, "apply");
  assert.equal(defendAt(deadline + 1n, true).kind, "reject");
  assert.equal(defendAt(deadline - 1n, false).kind, "apply");
  assert.equal(defendAt(deadline, false).kind, "reject");
  assert.equal(defendAt(deadline + 1n, false).kind, "reject");
});

test("contest resolution reports remaining time and transfer at deadline", () => {
  const openedAtMs = 1_000n;
  const durationMs = DAY_MS;
  const deadline = openedAtMs + durationMs;
  const record = contestRecord({ openedAtMs });

  const inclusive = contestRules({
    contestDurationMs: durationMs,
    defenseAtDeadlineCounts: true,
  });
  assert.deepEqual(resolveContestPhase(record, deadline, inclusive), {
    phase: "shared",
    remainingMs: 0n,
  });
  assert.deepEqual(resolveContestPhase(record, deadline + 1n, inclusive), {
    phase: "transfer_to_attacker",
    remainingMs: 0n,
  });

  const exclusive = contestRules({
    contestDurationMs: durationMs,
    defenseAtDeadlineCounts: false,
  });
  assert.deepEqual(resolveContestPhase(record, deadline, exclusive), {
    phase: "transfer_to_attacker",
    remainingMs: 0n,
  });
  assert.deepEqual(resolveContestPhase(record, deadline - 1n, exclusive), {
    phase: "shared",
    remainingMs: 1n,
  });

  const defended = contestRecord({ openedAtMs, defendedAtMs: openedAtMs + 5n });
  assert.deepEqual(resolveContestPhase(defended, deadline, inclusive), {
    phase: "defended",
    remainingMs: 0n,
  });
});

test("contest state machines are deterministic and validate arguments", () => {
  const rules = contestRules();
  const openInput = {
    tileIndex: 42,
    attackerSchoolSlot: 3,
    defenderSchoolSlot: 7,
    attackerBalance: 1n,
    openedAtMs: 0n,
    existing: null,
  };
  assert.deepEqual(
    evaluateSharedKnowledgeEntry(openInput, rules),
    evaluateSharedKnowledgeEntry(openInput, rules),
  );
  assert.throws(() =>
    evaluateSharedKnowledgeEntry({ ...openInput, attackerBalance: -1n }, rules),
  );
  assert.throws(() =>
    evaluateSharedKnowledgeEntry({ ...openInput, tileIndex: 1_000_000 }, rules),
  );
  assert.throws(() =>
    evaluateContestDefense(
      contestRecord(),
      { actorSchoolSlot: 16, actorBalance: 1n, actedAtMs: 0n },
      rules,
    ),
  );
  assert.throws(() =>
    evaluateContestDefense(
      contestRecord({ openedAtMs: 100n }),
      { actorSchoolSlot: 0, actorBalance: 1n, actedAtMs: 50n },
      rules,
    ),
  );
});

// --- Knowledge decay ---------------------------------------------------------

test("decay holds during grace and applies loss per tick after", () => {
  const rules = decayRules();
  const state = { retention: 100n, lastMaintainedAtMs: 0n, isHqSeed: false };
  assert.deepEqual(evaluateKnowledgeDecay(state, 0n, rules), {
    retention: 100n,
    elapsedTicks: 0n,
    fullyDecayed: false,
  });
  assert.deepEqual(evaluateKnowledgeDecay(state, 12n * HOUR_MS, rules), {
    retention: 100n,
    elapsedTicks: 0n,
    fullyDecayed: false,
  });
  assert.deepEqual(evaluateKnowledgeDecay(state, 12n * HOUR_MS + 1n, rules), {
    retention: 100n,
    elapsedTicks: 0n,
    fullyDecayed: false,
  });
  assert.deepEqual(evaluateKnowledgeDecay(state, 13n * HOUR_MS, rules), {
    retention: 90n,
    elapsedTicks: 1n,
    fullyDecayed: false,
  });
  assert.deepEqual(evaluateKnowledgeDecay(state, 21n * HOUR_MS, rules), {
    retention: 10n,
    elapsedTicks: 9n,
    fullyDecayed: false,
  });
});

test("decay forces zero at the full-decay boundary and keeps HQ seeds", () => {
  const rules = decayRules();
  const mortal = { retention: 100n, lastMaintainedAtMs: 0n, isHqSeed: false };
  assert.deepEqual(evaluateKnowledgeDecay(mortal, 21n * HOUR_MS + 1n, rules), {
    retention: 10n,
    elapsedTicks: 9n,
    fullyDecayed: false,
  });
  assert.deepEqual(evaluateKnowledgeDecay(mortal, 22n * HOUR_MS, rules), {
    retention: 0n,
    elapsedTicks: 22n,
    fullyDecayed: true,
  });
  const hq = { ...mortal, isHqSeed: true };
  assert.deepEqual(evaluateKnowledgeDecay(hq, 100n * DAY_MS, rules), {
    retention: 100n,
    elapsedTicks: 0n,
    fullyDecayed: false,
  });
});

test("decay clamps at zero and honors a null forced cutoff", () => {
  const rules = decayRules({
    graceDurationMs: 0n,
    retentionLossPerTick: 30n,
    fullDecayDurationMs: null,
  });
  const state = { retention: 50n, lastMaintainedAtMs: 0n, isHqSeed: false };
  assert.deepEqual(evaluateKnowledgeDecay(state, 1n * HOUR_MS, rules), {
    retention: 20n,
    elapsedTicks: 1n,
    fullyDecayed: false,
  });
  assert.deepEqual(evaluateKnowledgeDecay(state, 2n * HOUR_MS, rules), {
    retention: 0n,
    elapsedTicks: 2n,
    fullyDecayed: true,
  });
});

test("decay is school-isolated, deterministic and validates arguments", () => {
  const rules = decayRules();
  const schoolA = { retention: 100n, lastMaintainedAtMs: 0n, isHqSeed: false };
  const schoolB = { retention: 80n, lastMaintainedAtMs: 5n, isHqSeed: false };
  const at = 13n * HOUR_MS;
  const outcomeA = evaluateKnowledgeDecay(schoolA, at, rules);
  const outcomeB = evaluateKnowledgeDecay(schoolB, at, rules);
  assert.equal(outcomeA.retention, 90n);
  assert.equal(outcomeB.retention, 80n);
  assert.deepEqual(evaluateKnowledgeDecay(schoolA, at, rules), outcomeA);
  assert.throws(() =>
    evaluateKnowledgeDecay({ ...schoolA, lastMaintainedAtMs: 10n }, 0n, rules),
  );
  assert.throws(() =>
    evaluateKnowledgeDecay(
      { retention: -1n, lastMaintainedAtMs: 0n, isHqSeed: false },
      1n,
      rules,
    ),
  );
  assert.throws(() =>
    evaluateKnowledgeDecay(schoolA, 1n, decayRules({ tickDurationMs: 0n })),
  );
  assert.throws(() =>
    evaluateKnowledgeDecay(
      schoolA,
      1n,
      decayRules({
        fullDecayDurationMs: 1n * HOUR_MS,
        graceDurationMs: 2n * HOUR_MS,
      }),
    ),
  );
});

// --- Landmark contribution ---------------------------------------------------

test("landmark first light requires the explicit target", () => {
  const rules = landmarkRules();
  const below = evaluateLandmarkContribution(
    emptyLandmark(),
    { schoolSlot: 0, crystalAmount: 99n, availableCrystals: 99n, atMs: 1n },
    rules,
  );
  assert.equal(below.kind, "apply");
  assert.equal(below.kind === "apply" && below.ownerSchoolSlot, null);

  const exact = evaluateLandmarkContribution(
    emptyLandmark(),
    { schoolSlot: 0, crystalAmount: 100n, availableCrystals: 100n, atMs: 1n },
    rules,
  );
  assert.equal(exact.kind, "apply");
  assert.equal(exact.kind === "apply" && exact.ownerSchoolSlot, 0);
});

test("landmark overtake uses absolute margin boundaries", () => {
  const rules = landmarkRules({
    overtake: { kind: "absolute_margin", margin: 20n },
  });
  const owned: LandmarkState = {
    ownerSchoolSlot: 0,
    contributions: [
      { schoolSlot: 0, crystals: 100n },
      { schoolSlot: 1, crystals: 0n },
    ],
  };
  const challenge = (crystalAmount: bigint) =>
    evaluateLandmarkContribution(
      owned,
      { schoolSlot: 1, crystalAmount, availableCrystals: 1_000n, atMs: 5n },
      rules,
    );

  // Owner example: 120 vs 100 is exactly the 20-crystal margin.
  const below = challenge(119n);
  assert.equal(below.kind === "apply" && below.ownerSchoolSlot, 0);
  const exact = challenge(120n);
  assert.equal(exact.kind === "apply" && exact.ownerSchoolSlot, 1);
  const above = challenge(121n);
  assert.equal(above.kind === "apply" && above.ownerSchoolSlot, 1);
});

test("landmark overtake supports relative percent and repeated contribution", () => {
  const rules = landmarkRules({
    firstLightTarget: 1_000n,
    overtake: { kind: "relative_percent", percent: 5n },
  });
  let state: LandmarkState = emptyLandmark();
  const first = evaluateLandmarkContribution(
    state,
    {
      schoolSlot: 0,
      crystalAmount: 1_000n,
      availableCrystals: 1_000n,
      atMs: 1n,
    },
    rules,
  );
  assert.equal(first.kind === "apply" && first.ownerSchoolSlot, 0);
  state = first.kind === "apply" ? first.next : state;

  const more = evaluateLandmarkContribution(
    state,
    { schoolSlot: 0, crystalAmount: 100n, availableCrystals: 100n, atMs: 2n },
    rules,
  );
  assert.equal(more.kind === "apply" && more.ownerSchoolSlot, 0);
  state = more.kind === "apply" ? more.next : state;
  assert.equal(
    state.contributions.find((row) => row.schoolSlot === 0)?.crystals,
    1_100n,
  );

  // ceil(1100 * 1.05) = 1155
  const justBelow = evaluateLandmarkContribution(
    state,
    {
      schoolSlot: 1,
      crystalAmount: 1_154n,
      availableCrystals: 1_154n,
      atMs: 3n,
    },
    rules,
  );
  assert.equal(justBelow.kind === "apply" && justBelow.ownerSchoolSlot, 0);
  const atThreshold = evaluateLandmarkContribution(
    state,
    {
      schoolSlot: 1,
      crystalAmount: 1_155n,
      availableCrystals: 1_155n,
      atMs: 3n,
    },
    rules,
  );
  assert.equal(atThreshold.kind === "apply" && atThreshold.ownerSchoolSlot, 1);
});

test("landmark contribution rejects insufficient crystals and zero amounts", () => {
  const rules = landmarkRules();
  assert.deepEqual(
    evaluateLandmarkContribution(
      emptyLandmark(),
      { schoolSlot: 0, crystalAmount: 10n, availableCrystals: 9n, atMs: 1n },
      rules,
    ),
    { kind: "reject", reason: "insufficient_crystals" },
  );
  assert.deepEqual(
    evaluateLandmarkContribution(
      emptyLandmark(),
      { schoolSlot: 0, crystalAmount: 0n, availableCrystals: 9n, atMs: 1n },
      rules,
    ),
    { kind: "reject", reason: "invalid_argument" },
  );
});

test("simultaneous first light is decided by serialized commit order", () => {
  const rules = landmarkRules();
  const atMs = 9n;
  const asSchool = (schoolSlot: number) =>
    evaluateLandmarkContribution(
      emptyLandmark(),
      { schoolSlot, crystalAmount: 100n, availableCrystals: 100n, atMs },
      rules,
    );
  const school0First = asSchool(0);
  assert.equal(
    school0First.kind === "apply" && school0First.ownerSchoolSlot,
    0,
  );
  const school1Second = evaluateLandmarkContribution(
    school0First.kind === "apply" ? school0First.next : emptyLandmark(),
    { schoolSlot: 1, crystalAmount: 100n, availableCrystals: 100n, atMs },
    rules,
  );
  assert.equal(
    school1Second.kind === "apply" && school1Second.ownerSchoolSlot,
    0,
  );

  const school1First = asSchool(1);
  assert.equal(
    school1First.kind === "apply" && school1First.ownerSchoolSlot,
    1,
  );
  const school0Second = evaluateLandmarkContribution(
    school1First.kind === "apply" ? school1First.next : emptyLandmark(),
    { schoolSlot: 0, crystalAmount: 100n, availableCrystals: 100n, atMs },
    rules,
  );
  assert.equal(
    school0Second.kind === "apply" && school0Second.ownerSchoolSlot,
    1,
  );
});
