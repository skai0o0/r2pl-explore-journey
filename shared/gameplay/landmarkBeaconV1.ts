/** Testable owner-approved rules only; callers must authenticate, serialize and
 * atomically persist Crystal spending, this state and durable replay/outbox data.
 * Full state is private. Only publicBeaconV1 is suitable for public projection.
 */
export const LANDMARK_BEACON_V1 = "landmark-beacon-v1";
// Defensive development storage bounds, not production economic parameters.
export const MAX_BEACON_DEPOSIT = 1_000_000;
export const MAX_BEACON_COMMANDS = 10_000;

export interface BeaconCommandV1 {
  readonly commandId: string;
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly expectedRevision: number;
  readonly kind: "contribute" | "claim";
  readonly crystals: number;
}

/** Trusted adapter input, never a client-provided authorization flag. */
export interface BeaconAuthorizationV1 {
  readonly authorized: boolean;
  readonly actorId: string;
  readonly schoolSlot: number;
}

export interface BeaconReceiptV1 {
  readonly command: BeaconCommandV1;
  readonly revision: number;
  readonly acceptedCrystals: number;
  readonly resolvedThresholdCrystals: number;
  readonly activated: boolean;
  readonly takeoverSequence: number;
}

export interface LandmarkBeaconStateV1 {
  readonly ruleVersion: typeof LANDMARK_BEACON_V1;
  readonly revision: number;
  readonly activeSchoolSlot: number | null;
  /** First activation is k=0; each subsequent switch increments exactly once. */
  readonly takeoverSequence: number;
  /** Public threshold for the NEXT authorized activation attempt. */
  readonly requiredThresholdCrystals: number;
  readonly schoolPotsCrystals: readonly number[];
  readonly receipts: readonly BeaconReceiptV1[];
}

export type BeaconTransitionV1 =
  | {
      readonly status: "accepted" | "replayed";
      readonly state: LandmarkBeaconStateV1;
      readonly receipt: BeaconReceiptV1;
    }
  | {
      readonly status: "rejected";
      readonly state: LandmarkBeaconStateV1;
      readonly reason:
        | "invalid-state"
        | "invalid-command"
        | "unauthorized"
        | "command-conflict"
        | "stale-revision"
        | "capacity"
        | "incumbent-claim"
        | "below-threshold";
    };

function integer(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export function beaconThresholdCrystalsV1(k: number): number {
  if (!integer(k, MAX_BEACON_COMMANDS))
    throw new RangeError("Invalid beacon sequence");
  return 1000 + 50 * k;
}

export function createLandmarkBeaconV1(): LandmarkBeaconStateV1 {
  return {
    ruleVersion: LANDMARK_BEACON_V1,
    revision: 0,
    activeSchoolSlot: null,
    takeoverSequence: 0,
    requiredThresholdCrystals: 1000,
    schoolPotsCrystals: Array<number>(16).fill(0),
    receipts: [],
  };
}

function validCommand(command: BeaconCommandV1): boolean {
  return (
    command !== null &&
    typeof command === "object" &&
    identifier(command.commandId) &&
    identifier(command.actorId) &&
    integer(command.schoolSlot, 15) &&
    integer(command.expectedRevision, MAX_BEACON_COMMANDS) &&
    ((command.kind === "contribute" &&
      integer(command.crystals, MAX_BEACON_DEPOSIT) &&
      command.crystals > 0) ||
      (command.kind === "claim" && command.crystals === 0))
  );
}

function sameCommand(a: BeaconCommandV1, b: BeaconCommandV1): boolean {
  return (
    a.commandId === b.commandId &&
    a.actorId === b.actorId &&
    a.schoolSlot === b.schoolSlot &&
    a.expectedRevision === b.expectedRevision &&
    a.kind === b.kind &&
    a.crystals === b.crystals
  );
}

function advance(
  state: LandmarkBeaconStateV1,
  input: BeaconCommandV1,
): {
  state: LandmarkBeaconStateV1;
  receipt: BeaconReceiptV1;
} {
  const command: BeaconCommandV1 = {
    commandId: input.commandId,
    actorId: input.actorId,
    schoolSlot: input.schoolSlot,
    expectedRevision: input.expectedRevision,
    kind: input.kind,
    crystals: input.crystals,
  };
  const pots = [...state.schoolPotsCrystals];
  pots[command.schoolSlot] = (pots[command.schoolSlot] ?? 0) + command.crystals;
  const threshold = state.requiredThresholdCrystals;
  const activated =
    command.schoolSlot !== state.activeSchoolSlot &&
    (pots[command.schoolSlot] ?? 0) >= threshold;
  const k =
    state.takeoverSequence +
    (activated && state.activeSchoolSlot !== null ? 1 : 0);
  const receipt: BeaconReceiptV1 = {
    command,
    revision: state.revision + 1,
    acceptedCrystals: command.crystals,
    resolvedThresholdCrystals: threshold,
    activated,
    takeoverSequence: k,
  };
  return {
    receipt,
    state: {
      ruleVersion: LANDMARK_BEACON_V1,
      revision: receipt.revision,
      activeSchoolSlot: activated ? command.schoolSlot : state.activeSchoolSlot,
      takeoverSequence: k,
      requiredThresholdCrystals: beaconThresholdCrystalsV1(
        k + (activated || state.activeSchoolSlot !== null ? 1 : 0),
      ),
      schoolPotsCrystals: pots,
      receipts: [...state.receipts, receipt],
    },
  };
}

/** Validate restored private snapshots by replaying bounded successful history.
 * Receipts preserve immutable sequence history; no input object is mutated.
 */
export function validateLandmarkBeaconV1(
  value: unknown,
): value is LandmarkBeaconStateV1 {
  if (value === null || typeof value !== "object") return false;
  const state = value as LandmarkBeaconStateV1;
  if (
    state.ruleVersion !== LANDMARK_BEACON_V1 ||
    !integer(state.revision, MAX_BEACON_COMMANDS) ||
    !integer(state.takeoverSequence, MAX_BEACON_COMMANDS - 1) ||
    !(state.activeSchoolSlot === null || integer(state.activeSchoolSlot, 15)) ||
    !integer(state.requiredThresholdCrystals) ||
    !Array.isArray(state.schoolPotsCrystals) ||
    state.schoolPotsCrystals.length !== 16 ||
    !Array.from(state.schoolPotsCrystals).every((pot) => integer(pot)) ||
    !Array.isArray(state.receipts) ||
    state.receipts.length !== state.revision
  )
    return false;
  let rebuilt = createLandmarkBeaconV1();
  const keys = new Set<string>();
  for (const receipt of state.receipts) {
    if (
      receipt === null ||
      typeof receipt !== "object" ||
      !validCommand(receipt.command)
    )
      return false;
    const c = receipt.command;
    const key = JSON.stringify([c.actorId, c.commandId]);
    if (
      keys.has(key) ||
      c.expectedRevision !== rebuilt.revision ||
      (c.kind === "claim" &&
        (c.schoolSlot === rebuilt.activeSchoolSlot ||
          (rebuilt.schoolPotsCrystals[c.schoolSlot] ?? 0) <
            rebuilt.requiredThresholdCrystals))
    )
      return false;
    keys.add(key);
    const next = advance(rebuilt, c);
    if (
      receipt.revision !== next.receipt.revision ||
      receipt.acceptedCrystals !== next.receipt.acceptedCrystals ||
      receipt.resolvedThresholdCrystals !==
        next.receipt.resolvedThresholdCrystals ||
      receipt.activated !== next.receipt.activated ||
      receipt.takeoverSequence !== next.receipt.takeoverSequence
    )
      return false;
    rebuilt = next.state;
  }
  return (
    state.activeSchoolSlot === rebuilt.activeSchoolSlot &&
    state.takeoverSequence === rebuilt.takeoverSequence &&
    state.requiredThresholdCrystals === rebuilt.requiredThresholdCrystals &&
    state.schoolPotsCrystals.every(
      (pot, slot) => pot === rebuilt.schoolPotsCrystals[slot],
    )
  );
}

export function transitionLandmarkBeaconV1(
  state: LandmarkBeaconStateV1,
  command: BeaconCommandV1,
  authorization: BeaconAuthorizationV1,
): BeaconTransitionV1 {
  const reject = (
    reason: Extract<BeaconTransitionV1, { status: "rejected" }>["reason"],
  ): BeaconTransitionV1 => ({ status: "rejected", state, reason });
  if (!validateLandmarkBeaconV1(state)) return reject("invalid-state");
  if (!validCommand(command)) return reject("invalid-command");
  if (
    authorization?.authorized !== true ||
    authorization.actorId !== command.actorId ||
    authorization.schoolSlot !== command.schoolSlot
  )
    return reject("unauthorized");
  const prior = state.receipts.find(
    (r) =>
      r.command.actorId === command.actorId &&
      r.command.commandId === command.commandId,
  );
  if (prior)
    return sameCommand(prior.command, command)
      ? { status: "replayed", state, receipt: prior }
      : reject("command-conflict");
  if (command.expectedRevision !== state.revision)
    return reject("stale-revision");
  if (
    state.revision >= MAX_BEACON_COMMANDS ||
    !integer(
      (state.schoolPotsCrystals[command.schoolSlot] ?? 0) + command.crystals,
    )
  )
    return reject("capacity");
  if (command.kind === "claim") {
    if (command.schoolSlot === state.activeSchoolSlot)
      return reject("incumbent-claim");
    if (
      (state.schoolPotsCrystals[command.schoolSlot] ?? 0) <
      state.requiredThresholdCrystals
    )
      return reject("below-threshold");
  }
  return { status: "accepted", ...advance(state, command) };
}

export function publicBeaconV1(state: LandmarkBeaconStateV1): {
  readonly activeSchoolSlot: number | null;
  readonly requiredThresholdCrystals: number;
} {
  if (!validateLandmarkBeaconV1(state))
    throw new TypeError("Invalid beacon state");
  return {
    activeSchoolSlot: state.activeSchoolSlot,
    requiredThresholdCrystals: state.requiredThresholdCrystals,
  };
}
