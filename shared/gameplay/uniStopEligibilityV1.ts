/** Pure UniStop eligibility/cooldown proposal; external running proof is server-supplied. No wallet or API side effects. */
export const VN_UTC_OFFSET_MS = 7n * 60n * 60n * 1000n;
export const DAY_MS_V1 = 24n * 60n * 60n * 1000n;
export const HOUR_MS_V1 = 60n * 60n * 1000n;
export const FIRST_PARTIAL_WEEK_MS = BigInt(
  Date.parse("2026-10-06T17:00:00.000Z"),
);

export type UniStopStationKindV1 = "Aspire" | "Nitro" | "Predator";
export interface VerifiedWeeklyRunV1 {
  readonly studentId: string;
  readonly verified: boolean;
  readonly weekStartUtcMs: bigint;
  readonly positiveGamePoints: bigint;
}
export interface UniStopUsageV1 {
  readonly studentId: string;
  readonly stationId: string;
  readonly stationKind: UniStopStationKindV1;
  readonly lastOpenedAtUtcMs: bigint;
  readonly lastRequestId: string;
}
export type UniStopDecisionV1 =
  | {
      readonly kind: "apply";
      readonly newUsage: UniStopUsageV1;
      readonly nextAvailableUtcMs: bigint;
    }
  | {
      readonly kind: "no_change";
      readonly reason: string;
      readonly nextAvailableUtcMs: bigint;
    }
  | {
      readonly kind: "reject";
      readonly reason: string;
      readonly nextAvailableUtcMs: bigint | null;
    };

function validId(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 180)
    throw new TypeError(`Invalid ${label}`);
}
function validTimestamp(time: bigint): void {
  if (
    typeof time !== "bigint" ||
    time < FIRST_PARTIAL_WEEK_MS ||
    time > 8_640_000_000_000_000n
  ) {
    throw new RangeError("Invalid campaign timestamp");
  }
}
function mod(n: bigint, m: bigint): bigint {
  return ((n % m) + m) % m;
}
export function currentVietnamRunWeekV1(atUtcMs: bigint): {
  startUtcMs: bigint;
  endUtcMs: bigint;
} {
  validTimestamp(atUtcMs);
  const localDay = (atUtcMs + VN_UTC_OFFSET_MS) / DAY_MS_V1;
  const weekdayIndexMondayZero = mod(localDay + 3n, 7n);
  const normalWeekStart =
    (localDay - weekdayIndexMondayZero) * DAY_MS_V1 - VN_UTC_OFFSET_MS;
  const startUtcMs =
    normalWeekStart < FIRST_PARTIAL_WEEK_MS
      ? FIRST_PARTIAL_WEEK_MS
      : normalWeekStart;
  return { startUtcMs, endUtcMs: normalWeekStart + 7n * DAY_MS_V1 };
}
export function uniStopCooldownMsV1(kind: UniStopStationKindV1): bigint {
  if (kind === "Aspire") return 12n * HOUR_MS_V1;
  if (kind === "Nitro" || kind === "Predator") return 24n * HOUR_MS_V1;
  throw new TypeError("Invalid UniStop kind");
}
/** Validated actor/student/station state MUST be loaded by server, never accepted as client proof. */
export function evaluateUniStopUseV1(input: {
  readonly studentId: string;
  readonly verifiedActorStudentId: string | null;
  readonly stationId: string;
  readonly stationKind: UniStopStationKindV1;
  readonly atUtcMs: bigint;
  readonly requestId: string;
  readonly weekRun: VerifiedWeeklyRunV1 | null;
  readonly usage: UniStopUsageV1 | null;
}): UniStopDecisionV1 {
  validId(input.studentId, "student");
  validId(input.stationId, "station");
  validId(input.requestId, "request");
  validTimestamp(input.atUtcMs);
  const cooldown = uniStopCooldownMsV1(input.stationKind);
  if (input.usage !== null) {
    validId(input.usage.studentId, "stored student");
    validId(input.usage.stationId, "stored station");
    validId(input.usage.lastRequestId, "stored request");
    validTimestamp(input.usage.lastOpenedAtUtcMs);
    uniStopCooldownMsV1(input.usage.stationKind);
    if (
      input.usage.studentId !== input.studentId ||
      input.usage.stationId !== input.stationId ||
      input.usage.stationKind !== input.stationKind
    ) {
      throw new RangeError("Mismatched authoritative usage key");
    }
    if (input.atUtcMs < input.usage.lastOpenedAtUtcMs)
      return {
        kind: "reject",
        reason: "out_of_order",
        nextAvailableUtcMs: input.usage.lastOpenedAtUtcMs + cooldown,
      };
  }
  if (input.verifiedActorStudentId !== input.studentId)
    return {
      kind: "reject",
      reason: "unauthorized_student",
      nextAvailableUtcMs: null,
    };
  const previous = input.usage;
  const nextAvailable =
    previous === null ? null : previous.lastOpenedAtUtcMs + cooldown;
  if (previous !== null && previous.lastRequestId === input.requestId) {
    return {
      kind: "no_change",
      reason: "idempotent_retry",
      nextAvailableUtcMs: nextAvailable!,
    };
  }
  const week = currentVietnamRunWeekV1(input.atUtcMs);
  const run = input.weekRun;
  if (
    run === null ||
    run.studentId !== input.studentId ||
    run.verified !== true ||
    run.weekStartUtcMs !== week.startUtcMs ||
    typeof run.positiveGamePoints !== "bigint" ||
    run.positiveGamePoints <= 0n
  ) {
    return {
      kind: "reject",
      reason: "no_positive_verified_current_week_run",
      nextAvailableUtcMs: nextAvailable,
    };
  }
  if (nextAvailable !== null && input.atUtcMs < nextAvailable) {
    return {
      kind: "reject",
      reason: "cooldown_active",
      nextAvailableUtcMs: nextAvailable,
    };
  }
  return {
    kind: "apply",
    newUsage: {
      studentId: input.studentId,
      stationId: input.stationId,
      stationKind: input.stationKind,
      lastOpenedAtUtcMs: input.atUtcMs,
      lastRequestId: input.requestId,
    },
    nextAvailableUtcMs: input.atUtcMs + cooldown,
  };
}
