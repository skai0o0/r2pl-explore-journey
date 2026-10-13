import assert from "node:assert/strict";
import test from "node:test";
import type {
  CampaignBinding,
  CampaignIdentityResolver,
  CampaignProvider,
} from "../server/integration/CampaignProvider.ts";
import {
  CampaignIntegrationUnavailable,
  CampaignSyncService,
  type RunningSyncSink,
} from "../server/integration/CampaignSyncService.ts";
import {
  campaignWeekStart,
  parseRunningSnapshot,
  planRunningReconciliation,
  type RunningCheckpoint,
  snapshotWire,
} from "../shared/integration/running.ts";
import {
  CHEST_REFERENCE,
  UNISTOP_REFERENCE,
} from "../shared/rewards/catalog.ts";
import {
  hasCurrentWeekRunning,
  selectReferenceReward,
  uniStopAvailability,
} from "../shared/rewards/reference.ts";

const now = Date.parse("2026-10-13T03:00:00Z");
const wire = (overrides: Record<string, unknown> = {}) => ({
  provider: "synthetic",
  externalStudentId: "student-1",
  revision: "1",
  cumulativeMeters: "1500",
  observedAtMs: now,
  weekStartMs: campaignWeekStart(now),
  weeklyMeters: "500",
  ...overrides,
});
const conversion = {
  ruleVersion: "fixture-rate-v1",
  pointsNumerator: 3n,
  metersDenominator: 1000n,
};
const binding: CampaignBinding = {
  campaignId: "00000000-0000-0000-0000-000000000001",
  actorId: "00000000-0000-0000-0000-000000000002",
  provider: "synthetic",
  externalStudentId: "student-1",
  externalSchoolId: "school-1",
  schoolSlot: 15,
};

test("snapshot rejects precision loss, malformed identities, extra fields and inconsistent week", () => {
  for (const patch of [
    { revision: 1 },
    { revision: "01" },
    { cumulativeMeters: "9223372036854775808" },
    { cumulativeMeters: -1 },
    { weeklyMeters: "1501" },
    { observedAtMs: NaN },
    { provider: "../secrets" },
    { revision: "0" },
    { weekStartMs: now },
    { wallet: "1000" },
  ])
    assert.throws(() => parseRunningSnapshot(wire(patch)));
  assert.equal(
    parseRunningSnapshot(
      wire({ cumulativeMeters: "9007199254740993", weeklyMeters: "1" }),
    ).cumulativeMeters,
    9007199254740993n,
  );
  assert.deepEqual(snapshotWire(parseRunningSnapshot(wire())), wire());
});

test("Vietnam campaign week switches at local Monday midnight", () => {
  const boundary = Date.parse("2026-10-11T17:00:00Z");
  assert.equal(campaignWeekStart(boundary), boundary);
  assert.equal(
    campaignWeekStart(boundary - 1),
    boundary - 7 * 24 * 60 * 60 * 1000,
  );
  assert.equal(campaignWeekStart(boundary + 6 * 24 * 60 * 60 * 1000), boundary);
});

test("cumulative conversion preserves fractions across updates and reconciles downward corrections", () => {
  const first = parseRunningSnapshot(
    wire({ cumulativeMeters: "333", weeklyMeters: "0" }),
  );
  const p = planRunningReconciliation(first, conversion, null);
  assert.equal(p.delta, 0n);
  const previous: RunningCheckpoint = {
    snapshot: first,
    conversion,
    attributedPoints: p.targetPoints,
  };
  const second = parseRunningSnapshot(
    wire({ revision: "2", cumulativeMeters: "334", weeklyMeters: "0" }),
  );
  assert.equal(
    planRunningReconciliation(second, conversion, previous).delta,
    1n,
  );
  const checkpoint = { snapshot: second, conversion, attributedPoints: 1n };
  const corrected = parseRunningSnapshot(
    wire({ revision: "3", cumulativeMeters: "1", weeklyMeters: "0" }),
  );
  assert.equal(
    planRunningReconciliation(corrected, conversion, checkpoint).delta,
    -1n,
  );
  assert.throws(() =>
    planRunningReconciliation(second, conversion, checkpoint),
  );
  assert.throws(() =>
    planRunningReconciliation(
      corrected,
      { ...conversion, pointsNumerator: 4n },
      checkpoint,
    ),
  );
  assert.throws(() =>
    planRunningReconciliation(corrected, conversion, {
      ...checkpoint,
      attributedPoints: 2n,
    }),
  );
  assert.throws(() =>
    planRunningReconciliation(
      corrected,
      { ...conversion, metersDenominator: 0n },
      null,
    ),
  );
  assert.throws(() =>
    planRunningReconciliation(corrected, conversion, {
      ...checkpoint,
      snapshot: { ...second, externalStudentId: "student-2" },
    }),
  );
});

test("every one of 1000 tickets reproduces exact unnormalized Gamenote weights", () => {
  for (const tables of [UNISTOP_REFERENCE, CHEST_REFERENCE])
    for (const table of Object.values(tables)) {
      const counts = new Map<object, number>();
      for (let ticket = 0; ticket < 1000; ticket++) {
        const row = selectReferenceReward(table, ticket);
        counts.set(row, (counts.get(row) ?? 0) + 1);
      }
      for (const row of table.outcomes)
        assert.equal(counts.get(row) ?? 0, row.weight);
      assert.ok(Object.isFrozen(table.outcomes));
      assert.throws(() => selectReferenceReward(table, 1000));
      assert.throws(() => selectReferenceReward(table, -1));
      assert.throws(() => selectReferenceReward(table, 0.5));
      assert.throws(() =>
        selectReferenceReward(
          { ...table, outcomes: table.outcomes.slice(1) },
          0,
        ),
      );
    }
  assert.equal(
    UNISTOP_REFERENCE.nitro.outcomes.find((row) => row.kind === "gift")?.weight,
    1,
  );
  assert.equal(
    UNISTOP_REFERENCE.predator.outcomes.find((row) => row.kind === "gift")
      ?.weight,
    5,
  );
});

test("UniStop cooldown includes exact boundary and never accumulates missed spins", () => {
  const cooldown = 12 * 60 * 60 * 1000;
  assert.equal(
    uniStopAvailability("aspire", now, now + cooldown - 1).available,
    false,
  );
  assert.equal(
    uniStopAvailability("aspire", now, now + cooldown).available,
    true,
  );
  const late = now + 10 * cooldown;
  assert.equal(uniStopAvailability("aspire", now, late).available, true);
  assert.equal(
    uniStopAvailability("aspire", late, late + cooldown - 1).available,
    false,
  );
  assert.equal(
    uniStopAvailability("nitro", now, now + cooldown).available,
    false,
  );
  assert.throws(() => uniStopAvailability("aspire", now + 1, now));
  assert.equal(uniStopAvailability("predator", null, now).available, true);
});

test("weekly running fact expires without turning Gift policy into a reroll", () => {
  const snapshot = parseRunningSnapshot(wire());
  assert.equal(hasCurrentWeekRunning(snapshot, now), true);
  assert.equal(
    hasCurrentWeekRunning({ ...snapshot, weeklyMeters: 0n }, now),
    false,
  );
  assert.equal(
    hasCurrentWeekRunning(snapshot, now + 7 * 24 * 60 * 60 * 1000),
    false,
  );
  assert.equal(hasCurrentWeekRunning(null, now), false);
  assert.equal(
    hasCurrentWeekRunning({ ...snapshot, observedAtMs: now + 1 }, now),
    false,
  );
});

function fixture() {
  const identity = {
    provider: "synthetic",
    externalStudentId: "student-1",
    externalSchoolId: "school-1",
    sessionExpiresAtMs: now + 1000,
  };
  const provider: CampaignProvider = {
    providerId: "synthetic",
    verifySession: async () => identity,
    fetchRunningSnapshot: async () => wire(),
  };
  const resolver: CampaignIdentityResolver = { resolve: async () => binding };
  const calls: unknown[] = [];
  const sink: RunningSyncSink = {
    apply: async (bound, snapshot) => {
      calls.push({ bound, snapshot });
      return { kind: "stale" };
    },
  };
  const service = () =>
    new CampaignSyncService(provider, resolver, sink, {
      clock: () => now,
      maxSnapshotAgeMs: 60_000,
    });
  return { identity, provider, resolver, sink, calls, service };
}

test("adapter verifies session, maps school on server and passes validated snapshot to sink", async () => {
  const f = fixture();
  assert.deepEqual(
    await f.service().synchronize(binding.campaignId, "synthetic-token"),
    { kind: "stale" },
  );
  assert.deepEqual(f.calls, [{ bound: binding, snapshot: wire() }]);
});

test("failed provider returns no provider secret and causes no mutation", async () => {
  const f = fixture();
  f.provider.fetchRunningSnapshot = async () => {
    throw new Error("credential=do-not-leak");
  };
  await assert.rejects(
    () => f.service().synchronize(binding.campaignId, "synthetic-token"),
    (error) =>
      error instanceof CampaignIntegrationUnavailable &&
      !error.message.includes("do-not-leak"),
  );
  assert.equal(f.calls.length, 0);
});

test("unmapped, expired, wrong actor, stale and future provider feeds cannot reach the sink", async () => {
  const cases = [
    (f: ReturnType<typeof fixture>) => {
      f.resolver.resolve = async () => null;
    },
    (f: ReturnType<typeof fixture>) => {
      f.identity.sessionExpiresAtMs = now;
    },
    (f: ReturnType<typeof fixture>) => {
      f.provider.fetchRunningSnapshot = async () =>
        wire({ externalStudentId: "student-2" });
    },
    (f: ReturnType<typeof fixture>) => {
      f.provider.fetchRunningSnapshot = async () =>
        wire({ observedAtMs: now - 60_001 });
    },
    (f: ReturnType<typeof fixture>) => {
      f.provider.fetchRunningSnapshot = async () =>
        wire({ observedAtMs: now + 1 });
    },
  ];
  for (const setup of cases) {
    const f = fixture();
    setup(f);
    await assert.rejects(() =>
      f.service().synchronize(binding.campaignId, "synthetic-token"),
    );
    assert.equal(f.calls.length, 0);
  }
});

test("membership and session are rechecked after a slow fetch", async () => {
  const f = fixture();
  let count = 0;
  f.resolver.resolve = async () =>
    ++count === 1 ? binding : { ...binding, schoolSlot: 0 };
  await assert.rejects(() =>
    f.service().synchronize(binding.campaignId, "synthetic-token"),
  );
  assert.equal(f.calls.length, 0);
  const g = fixture();
  let clockCalls = 0;
  const service = new CampaignSyncService(g.provider, g.resolver, g.sink, {
    clock: () => (++clockCalls === 1 ? now : now + 1000),
    maxSnapshotAgeMs: 60_000,
  });
  await assert.rejects(() =>
    service.synchronize(binding.campaignId, "synthetic-token"),
  );
  assert.equal(g.calls.length, 0);
});

test("a session that expires during membership revalidation cannot reach the sink", async () => {
  const f = fixture();
  let calls = 0;
  const service = new CampaignSyncService(f.provider, f.resolver, f.sink, {
    clock: () => (++calls < 3 ? now : now + 1000),
    maxSnapshotAgeMs: 60_000,
  });
  await assert.rejects(() =>
    service.synchronize(binding.campaignId, "synthetic-token"),
  );
  assert.equal(f.calls.length, 0);
});
