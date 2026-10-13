/** Knowledge v1 development domain only; no production authorization or wallet I/O.
 * Callers serialize authoritative commands and persist state + effects atomically.
 * Verified membership and wallet balance must come from the server, never clients.
 */
import { MAX_SCHOOL_SLOTS } from "../world/constants.ts";
import { assertTileIndex } from "../world/coordinates.ts";

export const KNOWLEDGE_RULES_V1 = "knowledge-v1-development" as const;
export const ROLLING_FADE_MS = 2n * 60n * 60n * 1000n;
export const HARD_CLAIM_MS = 48n * 60n * 60n * 1000n;

export interface IncumbentTile {
  readonly tileIndex: number;
  readonly incumbentSchoolSlot: number;
}
export interface Contribution {
  readonly contributionId: string;
  readonly actorId: string;
  readonly walletId: string;
  readonly schoolSlot: number;
  readonly requestedPoints: bigint;
  readonly acceptedPoints: bigint;
  readonly acceptedAtMs: bigint;
}
interface Snapshot {
  readonly ruleVersion: typeof KNOWLEDGE_RULES_V1;
  readonly campaignId: string;
  readonly contestId: string;
  readonly schoolSlots: readonly [number, number];
  readonly tiles: readonly IncumbentTile[];
  readonly openedAtMs: bigint;
  readonly revision: number;
}
export interface SharedKnowledge extends Snapshot {
  readonly phase: "shared";
}
interface Succession extends Snapshot {
  readonly claimantSchoolSlot: number;
  readonly t0Ms: bigint;
  readonly eligibleTileIndices: readonly number[];
  readonly requiredPoints: bigint;
  readonly receivedPoints: bigint;
  readonly rollingDeadlineMs: bigint;
  readonly hardDeadlineMs: bigint;
  readonly contributions: readonly Contribution[];
}
export interface ClaimingKnowledge extends Succession {
  readonly phase: "claiming";
}
export interface SettledClaim extends Succession {
  readonly phase: "success" | "failure";
}
export interface SoleKnowledge extends Snapshot {
  readonly phase: "sole";
  readonly ownerSchoolSlot: number;
}
export interface ReviewKnowledge extends Snapshot {
  readonly phase: "operator_review";
  /** Preserve monetary liabilities while an operator resolves unsupported events. */
  readonly suspendedClaim: ClaimingKnowledge | null;
}
export type KnowledgeState =
  | SharedKnowledge
  | ClaimingKnowledge
  | SettledClaim
  | SoleKnowledge
  | ReviewKnowledge;

export type KnowledgeEffect =
  | {
      readonly kind: "ownership";
      readonly tileIndex: number;
      readonly ownerSchoolSlot: number | null;
    }
  | { readonly kind: "debit_obligation"; readonly contribution: Contribution }
  | { readonly kind: "consume_escrow"; readonly points: bigint }
  | {
      readonly kind: "refund_obligation";
      readonly contributionId: string;
      readonly actorId: string;
      readonly walletId: string;
      readonly points: bigint;
    };
export type KnowledgeCommand =
  | {
      readonly kind: "departure";
      readonly schoolSlot: number;
      readonly atMs: bigint;
      readonly remainingSchoolValid: boolean;
    }
  | { readonly kind: "unresolved_departure_conflict"; readonly atMs: bigint }
  | { readonly kind: "expire"; readonly atMs: bigint }
  | {
      readonly kind: "contribute";
      readonly contributionId: string;
      readonly actorId: string;
      readonly walletId: string;
      readonly schoolSlot: number;
      readonly verified: boolean;
      readonly requestedPoints: bigint;
      readonly walletBalance: bigint;
      readonly atMs: bigint;
    };
export interface KnowledgeTransition {
  readonly kind: "apply" | "reject" | "no_change";
  readonly reason: string;
  readonly state: KnowledgeState;
  readonly effects: readonly KnowledgeEffect[];
  /** Actual proposed charge, zero on retry/rejection; not proof of committed debit. */
  readonly acceptedPoints: bigint;
}

function slot(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= MAX_SCHOOL_SLOTS)
    throw new RangeError("Invalid school slot");
}
function natural(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n)
    throw new RangeError("Expected nonnegative bigint");
}
function id(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new TypeError("Expected nonempty identifier");
}
function flag(value: boolean): void {
  if (typeof value !== "boolean") throw new TypeError("Expected boolean");
}

/** Freeze lawful current holders at contest entry, never historical explorers.
 * Connected-component geometry is supplied by the authority; this module does
 * not scan mutable world data or import another agent's clustering module.
 */
export function startKnowledgeContest(input: {
  readonly campaignId: string;
  readonly contestId: string;
  readonly schoolSlots: readonly [number, number];
  readonly tiles: readonly IncumbentTile[];
  readonly openedAtMs: bigint;
}): SharedKnowledge {
  id(input.campaignId);
  id(input.contestId);
  natural(input.openedAtMs);
  if (input.schoolSlots.length !== 2)
    throw new RangeError("Exactly two schools required");
  const [a, b] = input.schoolSlots;
  slot(a);
  slot(b);
  if (a === b || input.tiles.length === 0)
    throw new RangeError("Invalid contest snapshot");
  const seen = new Set<number>();
  const tiles = input.tiles.map((tile) => {
    assertTileIndex(tile.tileIndex);
    if (
      !Number.isSafeInteger(tile.tileIndex) ||
      tile.tileIndex < 0 ||
      seen.has(tile.tileIndex)
    )
      throw new RangeError("Invalid or duplicate tile");
    slot(tile.incumbentSchoolSlot);
    if (tile.incumbentSchoolSlot !== a && tile.incumbentSchoolSlot !== b)
      throw new RangeError("Incumbent outside contest");
    seen.add(tile.tileIndex);
    return Object.freeze({ ...tile });
  });
  return Object.freeze({
    ruleVersion: KNOWLEDGE_RULES_V1,
    campaignId: input.campaignId,
    contestId: input.contestId,
    schoolSlots: Object.freeze([a, b] as const),
    tiles: Object.freeze(tiles),
    openedAtMs: input.openedAtMs,
    revision: 0,
    phase: "shared",
  });
}

function result(
  state: KnowledgeState,
  kind: KnowledgeTransition["kind"],
  reason: string,
  effects: readonly KnowledgeEffect[] = [],
  acceptedPoints = 0n,
): KnowledgeTransition {
  return { state, kind, reason, effects, acceptedPoints };
}
function own(
  indices: readonly number[],
  ownerSchoolSlot: number | null,
): KnowledgeEffect[] {
  return indices.map((tileIndex) => ({
    kind: "ownership",
    tileIndex,
    ownerSchoolSlot,
  }));
}
function fail(state: ClaimingKnowledge): KnowledgeTransition {
  const effects: KnowledgeEffect[] = own(state.eligibleTileIndices, null);
  for (const row of state.contributions)
    effects.push({
      kind: "refund_obligation",
      contributionId: row.contributionId,
      actorId: row.actorId,
      walletId: row.walletId,
      points: row.acceptedPoints,
    });
  return result(
    Object.freeze({ ...state, phase: "failure", revision: state.revision + 1 }),
    "apply",
    "expired",
    effects,
  );
}

/** Validate persisted snapshots and reconstruct clocks from immutable receipts. */
function validateState(state: KnowledgeState): void {
  startKnowledgeContest(state);
  if (!Number.isSafeInteger(state.revision) || state.revision < 0)
    throw new RangeError("Invalid revision");
  if (state.phase === "sole") {
    slot(state.ownerSchoolSlot);
    if (!state.schoolSlots.includes(state.ownerSchoolSlot))
      throw new RangeError("Invalid sole owner");
  }
  if (state.phase === "operator_review") {
    if (state.suspendedClaim) validateState(state.suspendedClaim);
    return;
  }
  if (!("contributions" in state)) return;
  slot(state.claimantSchoolSlot);
  natural(state.t0Ms);
  if (
    !state.schoolSlots.includes(state.claimantSchoolSlot) ||
    state.t0Ms < state.openedAtMs
  )
    throw new RangeError("Invalid claim origin");
  const eligible = state.tiles
    .filter((tile) => tile.incumbentSchoolSlot !== state.claimantSchoolSlot)
    .map((tile) => tile.tileIndex);
  if (
    eligible.length === 0 ||
    eligible.length !== state.eligibleTileIndices.length ||
    eligible.some((tile, index) => tile !== state.eligibleTileIndices[index])
  )
    throw new RangeError("Changed eligible snapshot");
  const required = (BigInt(eligible.length) + 1n) / 2n;
  const hard = state.t0Ms + HARD_CLAIM_MS;
  let rolling = state.t0Ms + ROLLING_FADE_MS;
  let latest = state.t0Ms;
  let total = 0n;
  const ids = new Set<string>();
  for (const row of state.contributions) {
    id(row.contributionId);
    id(row.actorId);
    id(row.walletId);
    natural(row.acceptedAtMs);
    natural(row.requestedPoints);
    natural(row.acceptedPoints);
    const remaining = required - total;
    const capped =
      row.requestedPoints < remaining ? row.requestedPoints : remaining;
    if (
      ids.has(row.contributionId) ||
      row.schoolSlot !== state.claimantSchoolSlot ||
      row.acceptedPoints < 1n ||
      row.acceptedPoints !== capped ||
      row.acceptedAtMs < latest ||
      row.acceptedAtMs >= rolling ||
      row.acceptedAtMs >= hard
    )
      throw new RangeError("Invalid contribution history");
    ids.add(row.contributionId);
    total += row.acceptedPoints;
    latest = row.acceptedAtMs;
    rolling = latest + ROLLING_FADE_MS < hard ? latest + ROLLING_FADE_MS : hard;
  }
  if (
    state.requiredPoints !== required ||
    state.receivedPoints !== total ||
    state.hardDeadlineMs !== hard ||
    state.rollingDeadlineMs !== rolling ||
    (state.phase === "success" ? total !== required : total >= required)
  )
    throw new RangeError("Invalid claim totals or clocks");
}

/** Deterministic proposals only. Terminal/reconnect calls emit no repeated effects.
 * Idempotency is scoped by campaign + contest + contributionId. Persist snapshots
 * intact; reconstructing a contest to replay a claim would reset its frozen t0.
 */
export function transitionKnowledge(
  state: KnowledgeState,
  command: KnowledgeCommand,
): KnowledgeTransition {
  if (
    ![
      "departure",
      "unresolved_departure_conflict",
      "expire",
      "contribute",
    ].includes(command.kind)
  )
    throw new TypeError("Unsupported command");
  if (state.ruleVersion !== KNOWLEDGE_RULES_V1)
    throw new RangeError("Unsupported rule version");
  validateState(state);
  natural(command.atMs);
  if (command.kind === "contribute") {
    id(command.contributionId);
    id(command.actorId);
    id(command.walletId);
    slot(command.schoolSlot);
    flag(command.verified);
    natural(command.requestedPoints);
    natural(command.walletBalance);
    if ("contributions" in state) {
      const prior = state.contributions.find(
        (row) => row.contributionId === command.contributionId,
      );
      if (prior) {
        const same =
          prior.actorId === command.actorId &&
          prior.walletId === command.walletId &&
          prior.schoolSlot === command.schoolSlot &&
          prior.requestedPoints === command.requestedPoints;
        return result(
          state,
          same ? "no_change" : "reject",
          same ? "already_accepted" : "idempotency_payload_conflict",
        );
      }
    }
  }
  if (command.kind === "departure") {
    slot(command.schoolSlot);
    flag(command.remainingSchoolValid);
  }
  if (
    command.kind === "departure" &&
    !state.schoolSlots.includes(command.schoolSlot)
  )
    return result(state, "reject", "outsider");
  if (state.phase !== "shared" && state.phase !== "claiming")
    return result(state, "no_change", "terminal");
  const latest =
    state.phase === "claiming"
      ? (state.contributions.at(-1)?.acceptedAtMs ?? state.t0Ms)
      : state.openedAtMs;
  if (command.atMs < latest)
    return result(state, "reject", "non_authoritative_order");
  if (
    state.phase === "claiming" &&
    (command.atMs >= state.rollingDeadlineMs ||
      command.atMs >= state.hardDeadlineMs)
  ) {
    const failure = fail(state);
    // Expiry effects still need committing when a payment discovers expiry.
    return command.kind === "contribute"
      ? { ...failure, kind: "reject" }
      : failure;
  }
  if (
    command.kind === "unresolved_departure_conflict" ||
    (command.kind === "departure" && !command.remainingSchoolValid)
  ) {
    // Keep escrow and ownership untouched pending audited operator resolution.
    return result(
      Object.freeze({
        ...state,
        phase: "operator_review",
        suspendedClaim: state.phase === "claiming" ? state : null,
        revision: state.revision + 1,
      }),
      "apply",
      "unresolved_departure",
    );
  }
  if (state.phase === "shared") {
    if (command.kind !== "departure")
      return result(state, "no_change", "not_claiming");
    if (!state.schoolSlots.includes(command.schoolSlot))
      return result(state, "reject", "outsider");
    const claimant =
      state.schoolSlots[0] === command.schoolSlot
        ? state.schoolSlots[1]
        : state.schoolSlots[0];
    const eligible = Object.freeze(
      state.tiles
        .filter((tile) => tile.incumbentSchoolSlot !== claimant)
        .map((tile) => tile.tileIndex),
    );
    const retained = state.tiles
      .filter((tile) => tile.incumbentSchoolSlot === claimant)
      .map((tile) => tile.tileIndex);
    if (eligible.length === 0)
      return result(
        Object.freeze({
          ...state,
          phase: "sole",
          ownerSchoolSlot: claimant,
          revision: state.revision + 1,
        }),
        "apply",
        "incumbent_retains_free",
        own(retained, claimant),
      );
    const claim: ClaimingKnowledge = Object.freeze({
      ...state,
      phase: "claiming",
      revision: state.revision + 1,
      claimantSchoolSlot: claimant,
      t0Ms: command.atMs,
      eligibleTileIndices: eligible,
      requiredPoints: (BigInt(eligible.length) + 1n) / 2n,
      receivedPoints: 0n,
      rollingDeadlineMs: command.atMs + ROLLING_FADE_MS,
      hardDeadlineMs: command.atMs + HARD_CLAIM_MS,
      contributions: Object.freeze([]),
    });
    return result(claim, "apply", "claim_opened", [
      ...own(retained, claimant),
      ...own(eligible, null),
    ]);
  }
  if (command.kind === "departure") {
    if (!state.schoolSlots.includes(command.schoolSlot))
      return result(state, "reject", "outsider");
    if (command.schoolSlot !== state.claimantSchoolSlot)
      return result(state, "no_change", "already_departed");
    return result(
      Object.freeze({
        ...state,
        phase: "operator_review",
        suspendedClaim: state,
        revision: state.revision + 1,
      }),
      "apply",
      "claimant_departure_policy_unresolved",
    );
  }
  if (command.kind !== "contribute")
    return result(state, "no_change", "not_due");
  if (!command.verified || command.schoolSlot !== state.claimantSchoolSlot)
    return result(state, "reject", "ineligible_actor");
  if (command.requestedPoints === 0n)
    return result(state, "reject", "empty_contribution");
  const remaining = state.requiredPoints - state.receivedPoints;
  const accepted =
    command.requestedPoints < remaining ? command.requestedPoints : remaining;
  if (command.walletBalance < accepted)
    return result(state, "reject", "insufficient_wallet");
  const row: Contribution = Object.freeze({
    contributionId: command.contributionId,
    actorId: command.actorId,
    walletId: command.walletId,
    schoolSlot: command.schoolSlot,
    requestedPoints: command.requestedPoints,
    acceptedPoints: accepted,
    acceptedAtMs: command.atMs,
  });
  const rolling = command.atMs + ROLLING_FADE_MS;
  const next = Object.freeze({
    ...state,
    receivedPoints: state.receivedPoints + accepted,
    rollingDeadlineMs:
      rolling < state.hardDeadlineMs ? rolling : state.hardDeadlineMs,
    contributions: Object.freeze([...state.contributions, row]),
    revision: state.revision + 1,
  });
  const debit: KnowledgeEffect = {
    kind: "debit_obligation",
    contribution: row,
  };
  if (next.receivedPoints === next.requiredPoints)
    return result(
      Object.freeze({ ...next, phase: "success" }),
      "apply",
      "fully_funded",
      [
        debit,
        ...own(state.eligibleTileIndices, state.claimantSchoolSlot),
        { kind: "consume_escrow", points: next.receivedPoints },
      ],
      accepted,
    );
  return result(next, "apply", "contribution_accepted", [debit], accepted);
}
