/**
 * M4-B candidate gameplay state machines. Development-only pure functions.
 * Not approved production rules and not wired to transport, services or persistence.
 * Every duration, cost and reward is an explicit required parameter; there are no
 * hidden defaults. Outcomes are proposals an authoritative service may later apply.
 *
 * Source alternatives remain unresolved (see GAME_SPEC G-04..G-06, C-01..C-03):
 * owner proposal vs V1 values must be supplied as config, never assumed.
 */
import { MAX_SCHOOL_SLOTS } from "../world/constants.ts";
import { assertTileIndex } from "../world/coordinates.ts";

// --- shared validation -------------------------------------------------------

function assertSchoolSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SCHOOL_SLOTS) {
    throw new RangeError("School slot outside registry");
  }
}

function assertFlag(value: boolean, label: string): void {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be boolean`);
  }
}

function assertNonnegativeBigInt(value: bigint, label: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(`${label} must be bigint`);
  }
  if (value < 0n) {
    throw new RangeError(`${label} must be nonnegative`);
  }
}

function assertPositiveBigInt(value: bigint, label: string): void {
  assertNonnegativeBigInt(value, label);
  if (value === 0n) {
    throw new RangeError(`${label} must be positive`);
  }
}

// --- Shared Knowledge contest (G-04 / C-01 / C-03) ---------------------------

export interface ContestCandidateRules {
  /** Cost the attacker spends to open the contest. */
  readonly sharedEntryCost: bigint;
  /** Cost the defender spends to keep the tile. */
  readonly defenseCost: bigint;
  /** How long the defender has to answer. */
  readonly contestDurationMs: bigint;
  /**
   * If true, a defense at exactly openedAt+duration still counts.
   * If false, that instant is already expired.
   */
  readonly defenseAtDeadlineCounts: boolean;
}

export interface ContestOpenInput {
  readonly tileIndex: number;
  readonly attackerSchoolSlot: number;
  readonly defenderSchoolSlot: number;
  readonly attackerBalance: bigint;
  readonly openedAtMs: bigint;
  /** Caller-supplied prior contest on the tile, if one is still tracked. */
  readonly existing: ContestRecord | null;
}

export interface ContestDefenseInput {
  readonly actorSchoolSlot: number;
  readonly actorBalance: bigint;
  readonly actedAtMs: bigint;
}

export interface ContestRecord {
  readonly tileIndex: number;
  readonly attackerSchoolSlot: number;
  readonly defenderSchoolSlot: number;
  readonly openedAtMs: bigint;
  readonly defendedAtMs: bigint | null;
}

export type ContestPhase = "shared" | "defended" | "transfer_to_attacker";

export type ContestRejectReason =
  | "invalid_argument"
  | "insufficient_balance"
  | "wrong_school_role"
  | "contest_expired"
  | "contest_already_open";

export type ContestDecision =
  | {
      readonly kind: "apply";
      readonly debit: bigint;
      readonly record: ContestRecord;
    }
  | {
      readonly kind: "no_change";
      readonly debit: 0n;
      readonly record: ContestRecord;
    }
  | {
      readonly kind: "reject";
      readonly reason: ContestRejectReason;
      readonly debit: 0n;
    };

export interface ContestResolution {
  readonly phase: ContestPhase;
  /** Remaining open time; 0n when the phase is terminal. */
  readonly remainingMs: bigint;
}

function assertContestRules(rules: ContestCandidateRules): void {
  assertNonnegativeBigInt(rules.sharedEntryCost, "sharedEntryCost");
  assertNonnegativeBigInt(rules.defenseCost, "defenseCost");
  assertPositiveBigInt(rules.contestDurationMs, "contestDurationMs");
  assertFlag(rules.defenseAtDeadlineCounts, "defenseAtDeadlineCounts");
}

function contestExpiredAt(
  record: ContestRecord,
  atMs: bigint,
  rules: ContestCandidateRules,
): boolean {
  const deadline = record.openedAtMs + rules.contestDurationMs;
  return rules.defenseAtDeadlineCounts ? atMs > deadline : atMs >= deadline;
}

export function resolveContestPhase(
  record: ContestRecord,
  nowMs: bigint,
  rules: ContestCandidateRules,
): ContestResolution {
  assertContestRules(rules);
  assertNonnegativeBigInt(nowMs, "nowMs");
  if (nowMs < record.openedAtMs) {
    throw new RangeError("nowMs precedes contest open time");
  }
  if (record.defendedAtMs !== null) {
    return { phase: "defended", remainingMs: 0n };
  }
  if (contestExpiredAt(record, nowMs, rules)) {
    return { phase: "transfer_to_attacker", remainingMs: 0n };
  }
  return {
    phase: "shared",
    remainingMs: record.openedAtMs + rules.contestDurationMs - nowMs,
  };
}

export function evaluateSharedKnowledgeEntry(
  input: ContestOpenInput,
  rules: ContestCandidateRules,
): ContestDecision {
  assertContestRules(rules);
  assertTileIndex(input.tileIndex);
  assertSchoolSlot(input.attackerSchoolSlot);
  assertSchoolSlot(input.defenderSchoolSlot);
  assertNonnegativeBigInt(input.attackerBalance, "attackerBalance");
  assertNonnegativeBigInt(input.openedAtMs, "openedAtMs");
  if (input.attackerSchoolSlot === input.defenderSchoolSlot) {
    return { kind: "reject", reason: "invalid_argument", debit: 0n };
  }
  if (input.existing !== null) {
    return { kind: "reject", reason: "contest_already_open", debit: 0n };
  }
  if (input.attackerBalance < rules.sharedEntryCost) {
    return { kind: "reject", reason: "insufficient_balance", debit: 0n };
  }
  return {
    kind: "apply",
    debit: rules.sharedEntryCost,
    record: {
      tileIndex: input.tileIndex,
      attackerSchoolSlot: input.attackerSchoolSlot,
      defenderSchoolSlot: input.defenderSchoolSlot,
      openedAtMs: input.openedAtMs,
      defendedAtMs: null,
    },
  };
}

export function evaluateContestDefense(
  record: ContestRecord,
  input: ContestDefenseInput,
  rules: ContestCandidateRules,
): ContestDecision {
  assertContestRules(rules);
  assertSchoolSlot(input.actorSchoolSlot);
  assertNonnegativeBigInt(input.actorBalance, "actorBalance");
  assertNonnegativeBigInt(input.actedAtMs, "actedAtMs");
  if (input.actedAtMs < record.openedAtMs) {
    throw new RangeError("Defense time precedes contest open time");
  }
  if (record.defendedAtMs !== null) {
    return { kind: "no_change", debit: 0n, record };
  }
  if (input.actorSchoolSlot !== record.defenderSchoolSlot) {
    return { kind: "reject", reason: "wrong_school_role", debit: 0n };
  }
  if (contestExpiredAt(record, input.actedAtMs, rules)) {
    return { kind: "reject", reason: "contest_expired", debit: 0n };
  }
  if (input.actorBalance < rules.defenseCost) {
    return { kind: "reject", reason: "insufficient_balance", debit: 0n };
  }
  return {
    kind: "apply",
    debit: rules.defenseCost,
    record: {
      tileIndex: record.tileIndex,
      attackerSchoolSlot: record.attackerSchoolSlot,
      defenderSchoolSlot: record.defenderSchoolSlot,
      openedAtMs: record.openedAtMs,
      defendedAtMs: input.actedAtMs,
    },
  };
}

// --- Knowledge decay (G-05 / C-03) -------------------------------------------

export interface KnowledgeDecayCandidateRules {
  /** No retention loss before this age since last maintenance. */
  readonly graceDurationMs: bigint;
  /** Retention period between losses. */
  readonly tickDurationMs: bigint;
  /** Retention lost per elapsed tick after grace. */
  readonly retentionLossPerTick: bigint;
  /** Force retention to zero at this age, or null for no forced cutoff. */
  readonly fullDecayDurationMs: bigint | null;
}

export interface KnowledgeRetentionState {
  readonly retention: bigint;
  readonly lastMaintainedAtMs: bigint;
  readonly isHqSeed: boolean;
}

export interface KnowledgeDecayOutcome {
  readonly retention: bigint;
  readonly elapsedTicks: bigint;
  readonly fullyDecayed: boolean;
}

export function evaluateKnowledgeDecay(
  state: KnowledgeRetentionState,
  nowMs: bigint,
  rules: KnowledgeDecayCandidateRules,
): KnowledgeDecayOutcome {
  assertNonnegativeBigInt(state.retention, "retention");
  assertNonnegativeBigInt(state.lastMaintainedAtMs, "lastMaintainedAtMs");
  assertFlag(state.isHqSeed, "isHqSeed");
  assertNonnegativeBigInt(nowMs, "nowMs");
  assertNonnegativeBigInt(rules.graceDurationMs, "graceDurationMs");
  assertPositiveBigInt(rules.tickDurationMs, "tickDurationMs");
  assertNonnegativeBigInt(rules.retentionLossPerTick, "retentionLossPerTick");
  if (rules.fullDecayDurationMs !== null) {
    assertNonnegativeBigInt(rules.fullDecayDurationMs, "fullDecayDurationMs");
    if (rules.fullDecayDurationMs < rules.graceDurationMs) {
      throw new RangeError("fullDecayDurationMs precedes graceDurationMs");
    }
  }
  if (nowMs < state.lastMaintainedAtMs) {
    throw new RangeError("nowMs precedes last maintenance time");
  }
  if (state.isHqSeed) {
    return {
      retention: state.retention,
      elapsedTicks: 0n,
      fullyDecayed: false,
    };
  }
  const ageMs = nowMs - state.lastMaintainedAtMs;
  if (
    rules.fullDecayDurationMs !== null &&
    ageMs >= rules.fullDecayDurationMs
  ) {
    return {
      retention: 0n,
      elapsedTicks: ageMs / rules.tickDurationMs,
      fullyDecayed: true,
    };
  }
  if (ageMs < rules.graceDurationMs) {
    return {
      retention: state.retention,
      elapsedTicks: 0n,
      fullyDecayed: false,
    };
  }
  const elapsedTicks = (ageMs - rules.graceDurationMs) / rules.tickDurationMs;
  const loss = elapsedTicks * rules.retentionLossPerTick;
  const retention = loss >= state.retention ? 0n : state.retention - loss;
  return {
    retention,
    elapsedTicks,
    fullyDecayed: retention === 0n,
  };
}

// --- Landmark contribution (G-06 / C-02 / C-09) ------------------------------

export type LandmarkOvertakeRule =
  | { readonly kind: "absolute_margin"; readonly margin: bigint }
  | { readonly kind: "relative_percent"; readonly percent: bigint };

export interface LandmarkCandidateRules {
  /** Crystals needed for first light when no school owns the landmark. */
  readonly firstLightTarget: bigint;
  readonly overtake: LandmarkOvertakeRule;
}

export interface LandmarkSchoolContribution {
  readonly schoolSlot: number;
  readonly crystals: bigint;
}

export interface LandmarkState {
  readonly ownerSchoolSlot: number | null;
  readonly contributions: readonly LandmarkSchoolContribution[];
}

export interface LandmarkContributionInput {
  readonly schoolSlot: number;
  readonly crystalAmount: bigint;
  readonly availableCrystals: bigint;
  readonly atMs: bigint;
}

export type LandmarkRejectReason =
  | "invalid_argument"
  | "insufficient_crystals";

export type LandmarkDecision =
  | {
      readonly kind: "apply";
      readonly crystalsAdded: bigint;
      readonly next: LandmarkState;
      readonly ownerSchoolSlot: number | null;
    }
  | {
      readonly kind: "reject";
      readonly reason: LandmarkRejectReason;
    };

function assertLandmarkRules(rules: LandmarkCandidateRules): void {
  assertPositiveBigInt(rules.firstLightTarget, "firstLightTarget");
  const overtake = rules.overtake;
  if (overtake.kind === "absolute_margin") {
    assertNonnegativeBigInt(overtake.margin, "overtake.margin");
  } else if (overtake.kind === "relative_percent") {
    assertNonnegativeBigInt(overtake.percent, "overtake.percent");
  } else {
    throw new TypeError("overtake must be a discriminated rule");
  }
}

function contributionOf(state: LandmarkState, schoolSlot: number): bigint {
  for (const row of state.contributions) {
    if (row.schoolSlot === schoolSlot) return row.crystals;
  }
  return 0n;
}

function withContribution(
  state: LandmarkState,
  schoolSlot: number,
  crystals: bigint,
): LandmarkState {
  const rows = state.contributions
    .filter((row) => row.schoolSlot !== schoolSlot)
    .concat({ schoolSlot, crystals })
    .sort((a, b) => a.schoolSlot - b.schoolSlot);
  return { ...state, contributions: rows };
}

function overtakeThreshold(
  ownerTotal: bigint,
  rules: LandmarkCandidateRules,
): bigint {
  const overtake = rules.overtake;
  if (overtake.kind === "absolute_margin") {
    return ownerTotal + overtake.margin;
  }
  const numerator = ownerTotal * (100n + overtake.percent);
  const relative = (numerator + 99n) / 100n;
  return relative > rules.firstLightTarget ? relative : rules.firstLightTarget;
}

function proposedOwner(
  state: LandmarkState,
  actorSchoolSlot: number,
  actorTotal: bigint,
  rules: LandmarkCandidateRules,
): number | null {
  const owner = state.ownerSchoolSlot;
  if (owner === null) {
    return actorTotal >= rules.firstLightTarget ? actorSchoolSlot : null;
  }
  if (owner === actorSchoolSlot) {
    return owner;
  }
  const required = overtakeThreshold(contributionOf(state, owner), rules);
  return actorTotal >= required ? actorSchoolSlot : owner;
}

function assertLandmarkState(state: LandmarkState): void {
  if (state.ownerSchoolSlot !== null) {
    assertSchoolSlot(state.ownerSchoolSlot);
  }
  for (const row of state.contributions) {
    assertSchoolSlot(row.schoolSlot);
    assertNonnegativeBigInt(row.crystals, "contribution.crystals");
  }
}

export function evaluateLandmarkContribution(
  state: LandmarkState,
  input: LandmarkContributionInput,
  rules: LandmarkCandidateRules,
): LandmarkDecision {
  assertLandmarkRules(rules);
  assertLandmarkState(state);
  assertSchoolSlot(input.schoolSlot);
  assertNonnegativeBigInt(input.crystalAmount, "crystalAmount");
  assertNonnegativeBigInt(input.availableCrystals, "availableCrystals");
  assertNonnegativeBigInt(input.atMs, "atMs");
  if (input.crystalAmount === 0n) {
    return { kind: "reject", reason: "invalid_argument" };
  }
  if (input.crystalAmount > input.availableCrystals) {
    return { kind: "reject", reason: "insufficient_crystals" };
  }
  const actorTotal =
    contributionOf(state, input.schoolSlot) + input.crystalAmount;
  const ownerSchoolSlot = proposedOwner(
    state,
    input.schoolSlot,
    actorTotal,
    rules,
  );
  const next = {
    ...withContribution(state, input.schoolSlot, actorTotal),
    ownerSchoolSlot,
  };
  return {
    kind: "apply",
    crystalsAdded: input.crystalAmount,
    next,
    ownerSchoolSlot,
  };
}

