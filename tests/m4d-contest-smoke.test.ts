/**
 * M4D contest smoke tests for candidate gameplay functions.
 *
 * Explicit test-only rule configuration below; these values are fixtures for
 * deterministic unit tests and are NOT approved production rules.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ContestCandidateRules,
  type ContestRecord,
  evaluateContestDefense,
  evaluateSharedKnowledgeEntry,
  resolveContestPhase,
} from "../shared/gameplay/candidates.ts";

const testOnlyRules: ContestCandidateRules = {
  sharedEntryCost: 3n,
  defenseCost: 2n,
  contestDurationMs: 1_000n,
  defenseAtDeadlineCounts: true,
};

const baseRecord: ContestRecord = {
  tileIndex: 42,
  attackerSchoolSlot: 1,
  defenderSchoolSlot: 0,
  openedAtMs: 100n,
  defendedAtMs: null,
};

test("evaluateSharedKnowledgeEntry applies test cost or rejects by contract", () => {
  const applied = evaluateSharedKnowledgeEntry(
    {
      tileIndex: 42,
      attackerSchoolSlot: 1,
      defenderSchoolSlot: 0,
      attackerBalance: 3n,
      openedAtMs: 100n,
      existing: null,
    },
    testOnlyRules,
  );
  assert.deepEqual(applied, {
    kind: "apply",
    debit: 3n,
    record: baseRecord,
  });

  assert.deepEqual(
    evaluateSharedKnowledgeEntry(
      {
        tileIndex: 42,
        attackerSchoolSlot: 1,
        defenderSchoolSlot: 0,
        attackerBalance: 2n,
        openedAtMs: 100n,
        existing: null,
      },
      testOnlyRules,
    ),
    { kind: "reject", reason: "insufficient_balance", debit: 0n },
  );

  assert.deepEqual(
    evaluateSharedKnowledgeEntry(
      {
        tileIndex: 42,
        attackerSchoolSlot: 1,
        defenderSchoolSlot: 1,
        attackerBalance: 10n,
        openedAtMs: 100n,
        existing: null,
      },
      testOnlyRules,
    ),
    { kind: "reject", reason: "invalid_argument", debit: 0n },
  );

  assert.deepEqual(
    evaluateSharedKnowledgeEntry(
      {
        tileIndex: 42,
        attackerSchoolSlot: 1,
        defenderSchoolSlot: 0,
        attackerBalance: 10n,
        openedAtMs: 100n,
        existing: baseRecord,
      },
      testOnlyRules,
    ),
    { kind: "reject", reason: "contest_already_open", debit: 0n },
  );
});

test("evaluateContestDefense pays test defense cost and rejects role/expiry", () => {
  const applied = evaluateContestDefense(
    baseRecord,
    { actorSchoolSlot: 0, actorBalance: 2n, actedAtMs: 200n },
    testOnlyRules,
  );
  assert.deepEqual(applied, {
    kind: "apply",
    debit: 2n,
    record: { ...baseRecord, defendedAtMs: 200n },
  });

  assert.deepEqual(
    evaluateContestDefense(
      baseRecord,
      { actorSchoolSlot: 1, actorBalance: 10n, actedAtMs: 200n },
      testOnlyRules,
    ),
    { kind: "reject", reason: "wrong_school_role", debit: 0n },
  );

  // deadline = 100 + 1000; inclusive flag treats >deadline as expired
  assert.deepEqual(
    evaluateContestDefense(
      baseRecord,
      { actorSchoolSlot: 0, actorBalance: 10n, actedAtMs: 1_101n },
      testOnlyRules,
    ),
    { kind: "reject", reason: "contest_expired", debit: 0n },
  );
});

test("resolveContestPhase reports remaining time and terminal phases", () => {
  assert.deepEqual(resolveContestPhase(baseRecord, 100n, testOnlyRules), {
    phase: "shared",
    remainingMs: 1_000n,
  });

  assert.deepEqual(resolveContestPhase(baseRecord, 1_100n, testOnlyRules), {
    phase: "shared",
    remainingMs: 0n,
  });

  assert.deepEqual(resolveContestPhase(baseRecord, 1_101n, testOnlyRules), {
    phase: "transfer_to_attacker",
    remainingMs: 0n,
  });

  assert.deepEqual(
    resolveContestPhase(
      { ...baseRecord, defendedAtMs: 200n },
      500n,
      testOnlyRules,
    ),
    { phase: "defended", remainingMs: 0n },
  );

  const exclusive: ContestCandidateRules = {
    ...testOnlyRules,
    defenseAtDeadlineCounts: false,
  };
  assert.deepEqual(resolveContestPhase(baseRecord, 1_100n, exclusive), {
    phase: "transfer_to_attacker",
    remainingMs: 0n,
  });
});
