import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currentVietnamRunWeekV1,
  evaluateUniStopUseV1,
  HOUR_MS_V1,
  type UniStopUsageV1,
  uniStopCooldownMsV1,
} from "../shared/gameplay/uniStopEligibilityV1.ts";

const ms = (iso: string): bigint => BigInt(Date.parse(iso));
const WEEK_OCT7 = ms("2026-10-06T17:00:00Z");
const WEEK_OCT12 = ms("2026-10-11T17:00:00Z");
const WEEK_OCT19 = ms("2026-10-18T17:00:00Z");
function run(studentId: string, start: bigint, points = 1n) {
  return {
    studentId,
    verified: true as const,
    weekStartUtcMs: start,
    positiveGamePoints: points,
  };
}
function request(overrides: Record<string, unknown> = {}) {
  return {
    studentId: "student-A",
    verifiedActorStudentId: "student-A",
    stationId: "stop-1",
    stationKind: "Aspire" as const,
    atUtcMs: ms("2026-10-12T06:00:00Z"),
    requestId: "req-1",
    weekRun: run("student-A", WEEK_OCT12),
    usage: null as UniStopUsageV1 | null,
    ...overrides,
  };
}
test("R4-20 campaign initial Wed Oct7–Sun Oct11 partial week and next Monday Oct12", () => {
  const oct7 = currentVietnamRunWeekV1(ms("2026-10-06T17:00:00Z"));
  assert.deepEqual(oct7, { startUtcMs: WEEK_OCT7, endUtcMs: WEEK_OCT12 });
  assert.deepEqual(
    currentVietnamRunWeekV1(ms("2026-10-11T16:59:59.999Z")),
    oct7,
  );
  assert.deepEqual(currentVietnamRunWeekV1(ms("2026-10-11T17:00:00Z")), {
    startUtcMs: WEEK_OCT12,
    endUtcMs: WEEK_OCT19,
  });
});
test("R4-20 stale previous-week points do NOT permit UniStop, but current week does", () => {
  const stale = evaluateUniStopUseV1(
    request({ weekRun: run("student-A", WEEK_OCT7) }),
  );
  assert.deepEqual(stale.kind, "reject");
  assert.equal(stale.reason, "no_positive_verified_current_week_run");
  assert.equal(evaluateUniStopUseV1(request()).kind, "apply");
});
test("zero, negative and unverified running data are ineligible", () => {
  for (const weekRun of [
    run("student-A", WEEK_OCT12, 0n),
    run("student-A", WEEK_OCT12, -1n),
    { ...run("student-A", WEEK_OCT12), verified: false },
    run("another-student", WEEK_OCT12),
    null,
  ]) {
    const decision = evaluateUniStopUseV1(request({ weekRun }));
    assert.equal(decision.kind, "reject");
    assert.equal(decision.reason, "no_positive_verified_current_week_run");
  }
});
test("Aspire 12h; Nitro and Predator 24h", () => {
  assert.equal(uniStopCooldownMsV1("Aspire"), 12n * HOUR_MS_V1);
  assert.equal(uniStopCooldownMsV1("Nitro"), 24n * HOUR_MS_V1);
  assert.equal(uniStopCooldownMsV1("Predator"), 24n * HOUR_MS_V1);
});
test("R4-21 per student per station cooldown, no new opening before 12h", () => {
  const first = evaluateUniStopUseV1(request());
  assert.equal(first.kind, "apply");
  if (first.kind !== "apply") return;
  const usage = first.newUsage;
  const almost = evaluateUniStopUseV1(
    request({
      usage,
      requestId: "req-2",
      atUtcMs: usage.lastOpenedAtUtcMs + 12n * HOUR_MS_V1 - 1n,
    }),
  );
  assert.equal(almost.kind, "reject");
  assert.equal(almost.reason, "cooldown_active");
  const atBoundary = evaluateUniStopUseV1(
    request({
      usage,
      requestId: "req-2",
      atUtcMs: usage.lastOpenedAtUtcMs + 12n * HOUR_MS_V1,
    }),
  );
  assert.equal(atBoundary.kind, "apply");
});
test("retry after reconnect/device change cannot reset cooldown or claim twice", () => {
  const first = evaluateUniStopUseV1(request());
  assert.equal(first.kind, "apply");
  if (first.kind !== "apply") return;
  const retry = evaluateUniStopUseV1(request({ usage: first.newUsage }));
  assert.equal(retry.kind, "no_change");
  const anotherDevice = evaluateUniStopUseV1(
    request({ usage: first.newUsage, requestId: "different-device" }),
  );
  assert.equal(anotherDevice.kind, "reject");
});
test("same student may use another station but not stack missed opportunities", () => {
  assert.equal(
    evaluateUniStopUseV1(request({ stationId: "stop-2" })).kind,
    "apply",
  );
  const first = evaluateUniStopUseV1(request());
  assert.equal(first.kind, "apply");
  if (first.kind !== "apply") return;
  const after26Hours = evaluateUniStopUseV1(
    request({
      usage: first.newUsage,
      requestId: "later",
      atUtcMs: first.newUsage.lastOpenedAtUtcMs + 26n * HOUR_MS_V1,
    }),
  );
  assert.equal(after26Hours.kind, "apply");
  if (after26Hours.kind !== "apply") return;
  assert.equal(
    after26Hours.newUsage.lastOpenedAtUtcMs,
    first.newUsage.lastOpenedAtUtcMs + 26n * HOUR_MS_V1,
  );
});
test("another student's personal cooldown is independent", () => {
  const other = evaluateUniStopUseV1(
    request({
      studentId: "student-B",
      verifiedActorStudentId: "student-B",
      weekRun: run("student-B", WEEK_OCT12),
    }),
  );
  assert.equal(other.kind, "apply");
});
test("unverified identity and mismatched authoritative stored usage reject safely", () => {
  const wrong = evaluateUniStopUseV1(
    request({ verifiedActorStudentId: "other-user" }),
  );
  assert.equal(wrong.kind, "reject");
  const first = evaluateUniStopUseV1(request());
  assert.equal(first.kind, "apply");
  if (first.kind !== "apply") return;
  assert.throws(
    () =>
      evaluateUniStopUseV1(
        request({ stationId: "stop-2", usage: first.newUsage }),
      ),
    RangeError,
  );
});
test("no running eligibility on new Monday even after prior-week use", () => {
  const oldUsed = evaluateUniStopUseV1(
    request({
      atUtcMs: ms("2026-10-11T16:00:00Z"),
      weekRun: run("student-A", WEEK_OCT7),
    }),
  );
  assert.equal(oldUsed.kind, "apply");
  if (oldUsed.kind !== "apply") return;
  const newWeek = evaluateUniStopUseV1(
    request({
      usage: oldUsed.newUsage,
      requestId: "new-week-attempt",
      weekRun: run("student-A", WEEK_OCT7),
    }),
  );
  assert.equal(newWeek.kind, "reject");
});
test("out-of-order timestamps, invalid station kind and invalid campaign timestamps reject", () => {
  const first = evaluateUniStopUseV1(request());
  assert.equal(first.kind, "apply");
  if (first.kind !== "apply") return;
  assert.equal(
    evaluateUniStopUseV1(
      request({
        usage: first.newUsage,
        atUtcMs: first.newUsage.lastOpenedAtUtcMs - 1n,
      }),
    ).kind,
    "reject",
  );
  assert.throws(
    () => evaluateUniStopUseV1(request({ stationKind: "Unknown" })),
    TypeError,
  );
  assert.throws(
    () => currentVietnamRunWeekV1(ms("2026-01-01T00:00:00Z")),
    RangeError,
  );
});
