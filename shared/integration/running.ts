/** Preparation contract only: no provider endpoint or production conversion default. */
export interface RunningSnapshot {
  readonly provider: string;
  readonly externalStudentId: string;
  readonly revision: bigint;
  readonly cumulativeMeters: bigint;
  readonly observedAtMs: number;
  readonly weekStartMs: number;
  readonly weeklyMeters: bigint;
}

export interface RunningConversion {
  readonly ruleVersion: string;
  readonly pointsNumerator: bigint;
  readonly metersDenominator: bigint;
}

export interface RunningCheckpoint {
  readonly snapshot: RunningSnapshot;
  readonly conversion: RunningConversion;
  readonly attributedPoints: bigint;
}

export function assertIdentifier(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
  ) {
    throw new RangeError("Invalid integration identifier");
  }
}

function unsigned(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value)) {
    throw new RangeError("Expected canonical unsigned decimal");
  }
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n)
    throw new RangeError("Value outside bigint storage range");
  return parsed;
}

export function assertTimestamp(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 8_640_000_000_000_000
  ) {
    throw new RangeError("Invalid integration timestamp");
  }
}

/** Monday 00:00 Asia/Ho_Chi_Minh (UTC+7); host/browser timezone is irrelevant. */
export function campaignWeekStart(atMs: number): number {
  assertTimestamp(atMs);
  const offset = 7 * 60 * 60 * 1000;
  if (atMs > 8_640_000_000_000_000 - offset)
    throw new RangeError("Campaign week outside Date range");
  const dayMs = 24 * 60 * 60 * 1000;
  const local = new Date(atMs + offset);
  const localDay = Math.floor((atMs + offset) / dayMs) * dayMs;
  return localDay - ((local.getUTCDay() + 6) % 7) * dayMs - offset;
}

/** Wire integers are strings, avoiding precision loss in JSON and PostgreSQL. */
export function parseRunningSnapshot(input: unknown): RunningSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid running snapshot");
  const row = input as Record<string, unknown>;
  const keys = [
    "provider",
    "externalStudentId",
    "revision",
    "cumulativeMeters",
    "observedAtMs",
    "weekStartMs",
    "weeklyMeters",
  ];
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key))
  )
    throw new TypeError("Unexpected snapshot fields");
  assertIdentifier(row.provider);
  assertIdentifier(row.externalStudentId);
  assertTimestamp(row.observedAtMs);
  assertTimestamp(row.weekStartMs);
  const revision = unsigned(row.revision);
  const cumulativeMeters = unsigned(row.cumulativeMeters);
  const weeklyMeters = unsigned(row.weeklyMeters);
  if (
    revision === 0n ||
    weeklyMeters > cumulativeMeters ||
    row.weekStartMs !== campaignWeekStart(row.observedAtMs)
  ) {
    throw new RangeError("Inconsistent running snapshot");
  }
  return {
    provider: row.provider,
    externalStudentId: row.externalStudentId,
    revision,
    cumulativeMeters,
    observedAtMs: row.observedAtMs,
    weekStartMs: row.weekStartMs,
    weeklyMeters,
  };
}

export function snapshotWire(
  snapshot: RunningSnapshot,
): Record<string, string | number> {
  return {
    provider: snapshot.provider,
    externalStudentId: snapshot.externalStudentId,
    revision: snapshot.revision.toString(),
    cumulativeMeters: snapshot.cumulativeMeters.toString(),
    observedAtMs: snapshot.observedAtMs,
    weekStartMs: snapshot.weekStartMs,
    weeklyMeters: snapshot.weeklyMeters.toString(),
  };
}

export function assertConversion(rule: RunningConversion): void {
  assertIdentifier(rule.ruleVersion);
  for (const value of [rule.pointsNumerator, rule.metersDenominator]) {
    if (
      typeof value !== "bigint" ||
      value <= 0n ||
      value > 9_223_372_036_854_775_807n
    )
      throw new RangeError("Invalid explicit running conversion");
  }
}

export function sameConversion(
  a: RunningConversion,
  b: RunningConversion,
): boolean {
  return (
    a.ruleVersion === b.ruleVersion &&
    a.pointsNumerator === b.pointsNumerator &&
    a.metersDenominator === b.metersDenominator
  );
}

export function planRunningReconciliation(
  snapshot: RunningSnapshot,
  rule: RunningConversion,
  previous: RunningCheckpoint | null,
): { readonly targetPoints: bigint; readonly delta: bigint } {
  parseRunningSnapshot(snapshotWire(snapshot));
  assertConversion(rule);
  if (previous) {
    if (
      previous.snapshot.provider !== snapshot.provider ||
      previous.snapshot.externalStudentId !== snapshot.externalStudentId
    )
      throw new RangeError("Running source binding changed");
    if (!sameConversion(previous.conversion, rule))
      throw new RangeError("Conversion change requires explicit rebase");
    if (
      snapshot.revision <= previous.snapshot.revision ||
      snapshot.observedAtMs < previous.snapshot.observedAtMs
    )
      throw new RangeError("Nonmonotonic running revision");
    const expected =
      (previous.snapshot.cumulativeMeters * rule.pointsNumerator) /
      rule.metersDenominator;
    if (previous.attributedPoints !== expected)
      throw new RangeError("Inconsistent checkpoint attribution");
  }
  const targetPoints =
    (snapshot.cumulativeMeters * rule.pointsNumerator) / rule.metersDenominator;
  if (targetPoints > 9_223_372_036_854_775_807n)
    throw new RangeError("Converted balance outside storage range");
  return {
    targetPoints,
    delta: targetPoints - (previous?.attributedPoints ?? 0n),
  };
}
