/**
 * M4-D1 Pure Knowledge Visibility v1 Unit Tests.
 *
 * Verifies field-level authorization, safe allowlists, role segregation,
 * and zero-trust affiliation constraints according to M4-D0 canonical freeze.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AnonymousSession,
  type AuditCaseRecord,
  type AuthoritativeEvent,
  type AuthoritativeWorldState,
  type ContentEditorSession,
  type ContestRecord,
  computeKnowledgeScores,
  type FinanceAdminSession,
  projectKnowledgeEvent,
  projectKnowledgeState,
  type SpectatorSession,
  type StudentProfile,
  type StudentSession,
  type TileRecord,
  VisibilityAuthorizationError,
  validateClientClaims,
} from "../server/realtime/KnowledgeVisibilityV1.ts";

function assertDefined<T>(val: T): asserts val is NonNullable<T> {
  assert.ok(val !== undefined && val !== null);
}

function createTestWorldFixture(): AuthoritativeWorldState {
  const hqs = [
    {
      schoolSlot: 0,
      x: 100,
      z: 100,
      width: 30,
      height: 30,
      published: true,
    },
    {
      schoolSlot: 1,
      x: 200,
      z: 200,
      width: 30,
      height: 30,
      published: true,
    },
    {
      schoolSlot: 2,
      x: 300,
      z: 300,
      width: 30,
      height: 30,
      published: false, // Draft unpublished HQ
    },
  ];

  const landmarks = [
    {
      id: "landmark-fansipan",
      name: "Đỉnh Fansipan",
      x: 500,
      z: 500,
      width: 40,
      height: 40,
      activeSchoolSlot: 0,
      threshold: 1050,
      schoolPots: new Map<number, number>([
        [0, 1050],
        [1, 600],
      ]),
      published: true,
    },
    {
      id: "landmark-draft-ba-den",
      name: "Núi Bà Đen (Draft)",
      x: 700,
      z: 700,
      width: 40,
      height: 40,
      activeSchoolSlot: null,
      threshold: 1000,
      schoolPots: new Map<number, number>(),
      published: false, // Unpublished landmark
    },
  ];

  const uniStops = [
    {
      id: "unistop-aspire",
      name: "UniStop Aspire",
      x: 150,
      z: 150,
      width: 10,
      height: 2,
      published: true,
    },
  ];

  const draftObjects = [
    {
      id: "draft-prefab-01",
      type: "building_prefab",
      x: 800,
      z: 800,
      metadata: { author: "editor-bob", version: "0.1-draft" },
    },
  ];

  const worldChests = [
    {
      chestId: "chest-01",
      x: 120,
      z: 120,
      tier: "Aspire",
      opened: false,
      discoveredByActorIds: new Set<string>(["student-a"]),
    },
    {
      chestId: "chest-02",
      x: 220,
      z: 220,
      tier: "Nitro",
      opened: false,
      discoveredByActorIds: new Set<string>(["student-b", "student-c"]),
    },
  ];

  // Tiles:
  // 10: solo owned by school 0, discovered by school 0
  // 11: shared between 0 and 1, discovered by 0 and 1
  // 12: provisional claim by 0 (incumbent 1), discovered by 0 and 1
  // 13: neutral tile previously discovered by 0 (abandoned/remembered)
  // 14: solo owned by 1, discovered by 1 only (secret to 0)
  const tiles: TileRecord[] = [
    {
      tileIndex: 10,
      discoveredSchools: new Set([0]),
      ownership: { kind: "solo", schoolSlot: 0 },
    },
    {
      tileIndex: 11,
      discoveredSchools: new Set([0, 1]),
      ownership: {
        kind: "shared",
        schoolSlots: [0, 1],
        contestId: "contest-01",
      },
    },
    {
      tileIndex: 12,
      discoveredSchools: new Set([0, 1]),
      ownership: {
        kind: "provisional_claim",
        claimantSchoolSlot: 0,
        incumbentSchoolSlot: 1,
        caseId: "case-01",
      },
    },
    {
      tileIndex: 13,
      discoveredSchools: new Set([0]),
      ownership: { kind: "neutral" },
    },
    {
      tileIndex: 14,
      discoveredSchools: new Set([1]),
      ownership: { kind: "solo", schoolSlot: 1 },
    },
  ];

  const contests: ContestRecord[] = [
    {
      contestId: "contest-01",
      participatingSchoolSlots: [0, 1],
      incumbentSchoolSlot: 0,
      claimantSchoolSlot: 1,
      tileIndices: [11],
      stage: "claiming",
      t0Ms: 10_000n,
      upkeepDueMs: 86_400_000n,
      rollingDecayDeadlineMs: 17_200_000n,
      hardDeadlineMs: 182_800_000n,
      consolidation: {
        requiredPoints: 4,
        receivedPoints: 3,
        contributions: [
          {
            contributionId: "cb-1",
            caseId: "contest-01",
            actorId: "student-a",
            schoolSlot: 0,
            walletId: "wallet-a",
            amount: 2,
            acceptedAtMs: 11_000n,
          },
          {
            contributionId: "cb-2",
            caseId: "contest-01",
            actorId: "student-c",
            schoolSlot: 0,
            walletId: "wallet-c",
            amount: 1,
            acceptedAtMs: 12_000n,
          },
        ],
        refundObligations: [
          {
            refundId: "ref-1",
            caseId: "contest-01",
            actorId: "student-a",
            schoolSlot: 0,
            walletId: "wallet-a",
            amount: 2,
            status: "pending",
          },
        ],
      },
    },
    {
      contestId: "contest-private-23",
      participatingSchoolSlots: [2, 3],
      incumbentSchoolSlot: 2,
      claimantSchoolSlot: 3,
      tileIndices: [99],
      stage: "shared",
      t0Ms: 5_000n,
      upkeepDueMs: 90_000_000n,
      rollingDecayDeadlineMs: null,
      hardDeadlineMs: null,
      consolidation: null,
    },
  ];

  const studentProfiles = new Map<string, StudentProfile>([
    [
      "student-a",
      {
        actorId: "student-a",
        schoolSlot: 0,
        wallet: { pointsBalance: 25, crystalsBalance: 120 },
        keys: [{ keyId: "key-a1", tier: "Aspire" }],
        uniStopSync: {
          weeklyRunningKm: 5.2,
          weeklySyncQualified: true,
          stationCooldowns: new Map([["unistop-aspire", 43_200_000n]]),
        },
        personalTreasureMaps: [
          {
            mapId: "map-01",
            chestId: "chest-01",
            coordinates: { x: 120, z: 120 },
          },
        ],
      },
    ],
    [
      "student-b",
      {
        actorId: "student-b",
        schoolSlot: 1,
        wallet: { pointsBalance: 10, crystalsBalance: 50 },
        keys: [],
        uniStopSync: {
          weeklyRunningKm: 0.0,
          weeklySyncQualified: false,
          stationCooldowns: new Map(),
        },
        personalTreasureMaps: [],
      },
    ],
    [
      "student-c",
      {
        actorId: "student-c",
        schoolSlot: 0,
        wallet: { pointsBalance: 15, crystalsBalance: 80 },
        keys: [],
        uniStopSync: {
          weeklyRunningKm: 2.1,
          weeklySyncQualified: true,
          stationCooldowns: new Map(),
        },
        personalTreasureMaps: [],
      },
    ],
  ]);

  const schoolScoreTimestamps = new Map<number, bigint>([
    [0, 100n],
    [1, 150n],
  ]);

  return {
    geometry: {
      worldWidth: 1000,
      worldHeight: 1000,
      hqs,
      landmarks,
      uniStops,
      draftObjects,
      worldChests,
    },
    tiles,
    contests,
    studentProfiles,
    schoolScoreTimestamps,
  };
}

describe("KnowledgeVisibilityV1 - Field-Level Authorization & Projections", () => {
  const world = createTestWorldFixture();

  // ==========================================================================
  // 1. Anonymous / Public Projection
  // ==========================================================================
  describe("Anonymous / Public View", () => {
    const session: AnonymousSession = { kind: "anonymous" };

    it("projects published geometry only (filters unpublished drafts)", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "public_projection");

      // Published HQs only (school 0, 1; school 2 was draft)
      assert.equal(projection.geometry.hqs.length, 2);
      assert.deepEqual(
        projection.geometry.hqs.map((h) => h.schoolSlot),
        [0, 1],
      );

      // Published landmarks only (fansipan only; ba-den was draft)
      assert.equal(projection.geometry.landmarks.length, 1);
      assert.equal(projection.geometry.landmarks[0]?.id, "landmark-fansipan");

      // Published UniStops
      assert.equal(projection.geometry.uniStops.length, 1);
      assert.equal(projection.geometry.uniStops[0]?.id, "unistop-aspire");
    });

    it("omits school pots, chests, draft objects, and raw masks", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "public_projection");

      const landmark = projection.geometry.landmarks[0];
      assertDefined(landmark);
      assert.equal("schoolPots" in landmark, false);

      assert.equal("draftObjects" in projection, false);
      assert.equal("worldChests" in projection, false);
      assert.equal("knowledge" in projection, false);
      assert.equal("personal" in projection, false);
      assert.equal("financialAudit" in projection, false);
    });

    it("projects public aggregate scoreboard and contest count without private debt", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "public_projection");

      assert.ok(projection.scoreboard.rankings.length >= 2);
      // Active contests (claiming + shared) = 2
      assert.equal(projection.activeContestCount, 2);
      assert.equal("deadlines" in projection, false);
      assert.equal("contests" in projection, false);
    });
  });

  // ==========================================================================
  // 2. Spectator Projection
  // ==========================================================================
  describe("Spectator View", () => {
    const session: SpectatorSession = { kind: "spectator" };

    it("projects published geometry, delayed scoreboard and landmark beacons without pots", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "spectator_projection");

      assert.equal(projection.landmarkBeacons.length, 1);
      const beacon = projection.landmarkBeacons[0];
      assertDefined(beacon);
      assert.equal(beacon.id, "landmark-fansipan");
      assert.equal(beacon.activeSchoolSlot, 0);
      assert.equal(beacon.threshold, 1050);
      assert.equal("schoolPots" in beacon, false);
      assert.equal("ownSchoolPot" in beacon, false);

      // No raw masks, no private wallets
      assert.equal("knowledge" in projection, false);
      assert.equal("personal" in projection, false);
      assert.equal("financialAudit" in projection, false);
    });
  });

  // ==========================================================================
  // 3. Own Student A (School 0) Projection
  // ==========================================================================
  describe("Own Student A (School 0)", () => {
    const session: StudentSession = {
      kind: "student",
      actorId: "student-a",
      schoolSlot: 0,
    };

    it("projects school fog and distinguishes active owned vs provisional vs remembered neutral", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "student_projection");
      assert.equal(projection.sessionActorId, "student-a");
      assert.equal(projection.sessionSchoolSlot, 0);

      const k = projection.knowledge;
      assert.equal(k.schoolSlot, 0);
      // School 0 discovered tiles 10, 11, 12, 13 (total 4)
      assert.equal(k.discoveredTileCount, 4);

      // Tile 10: solo owned by school 0
      assert.deepEqual(k.activeSoloTiles, [10]);

      // Tile 11: shared with school 1
      assert.deepEqual(k.activeSharedTiles, [
        { tileIndex: 11, counterpartSchoolSlot: 1 },
      ]);

      // Tile 12: provisional claim by school 0
      assert.deepEqual(k.provisionalClaimTiles, [12]);

      // Tile 13: neutral tile remembered by school 0 (remembered != active ownership!)
      assert.deepEqual(k.rememberedNeutralTiles, [13]);

      // Tile 14 was discovered only by school 1: strictly hidden from school 0!
      assert.equal(k.activeSoloTiles.includes(14), false);
      assert.equal(k.rememberedNeutralTiles.includes(14), false);
    });

    it("projects own school pot on landmarks while omitting rival pots", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "student_projection");

      const landmark = projection.landmarks[0];
      assertDefined(landmark);
      assert.equal(landmark.id, "landmark-fansipan");
      // School 0 pot = 1050
      assert.equal(landmark.ownSchoolPot, 1050);
      // Rival pot (school 1 pot = 600) is strictly omitted!
      assert.equal("schoolPots" in landmark, false);
    });

    it("projects personal wallet, keys, unistop cooldown and chests discovered by actor A only", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "student_projection");

      const p = projection.personal;
      assert.equal(p.actorId, "student-a");
      assert.equal(p.schoolSlot, 0);
      assert.equal(p.wallet.pointsBalance, 25);
      assert.equal(p.wallet.crystalsBalance, 120);
      assert.deepEqual(p.keys, [{ keyId: "key-a1", tier: "Aspire" }]);
      assert.equal(p.uniStop.weeklySyncQualified, true);
      assert.equal(p.uniStop.weeklyRunningKm, 5.2);
      assert.equal(p.uniStop.stationCooldowns.length, 1);

      // Chest-01 was discovered by student-a
      assert.equal(p.discoveredChests.length, 1);
      assert.equal(p.discoveredChests[0]?.chestId, "chest-01");

      // Chest-02 was discovered by student-b and student-c: hidden from student-a!
      assert.equal(
        p.discoveredChests.some(
          (c: { chestId: string }) => c.chestId === "chest-02",
        ),
        false,
      );

      // Personal treasure map for student-a
      assert.equal(p.personalTreasureMaps.length, 1);
      assert.equal(p.personalTreasureMaps[0]?.chestId, "chest-01");
    });

    it("projects own contest, counterpart info, aggregate progress, but only personal contributions/refunds", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "student_projection");

      // Only contest-01 involves school 0; contest-private-23 is excluded
      assert.equal(projection.contests.length, 1);
      const c = projection.contests[0];
      assertDefined(c);
      assert.equal(c.contestId, "contest-01");
      assert.equal(c.counterpartSchoolSlot, 1);
      assert.equal(c.role, "incumbent");
      assert.equal(c.tileCount, 1);
      assert.deepEqual(c.sharedTileIndices, [11]);

      // Deadlines
      assert.equal(c.deadlines.rollingDecayDeadlineMs, 17_200_000n);
      assert.equal(c.deadlines.hardDeadlineMs, 182_800_000n);

      // Aggregate progress
      assertDefined(c.consolidation);
      assert.equal(c.consolidation.requiredPoints, 4);
      assert.equal(c.consolidation.receivedPoints, 3);
      assert.equal(c.consolidation.remainingPoints, 1);

      // Personal contributions: student-a contributed cb-1 (amount 2)
      // cb-2 was contributed by classmate student-c (amount 1): hidden from student-a!
      assert.equal(c.myContributions.length, 1);
      assert.equal(c.myContributions[0]?.contributionId, "cb-1");
      assert.equal(c.myContributions[0]?.amount, 2);

      // Personal refund receipts: ref-1 belongs to student-a
      assert.equal(c.myRefundReceipts.length, 1);
      assert.equal(c.myRefundReceipts[0]?.refundId, "ref-1");
      assert.equal(c.myRefundReceipts[0]?.amount, 2);
    });
  });

  // ==========================================================================
  // 4. Rival Student B (School 1) Projection
  // ==========================================================================
  describe("Rival Student B (School 1)", () => {
    const session: StudentSession = {
      kind: "student",
      actorId: "student-b",
      schoolSlot: 1,
    };

    it("isolates fog, prevents rival raw bitmask leakage, and shows School 1's pot", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "student_projection");
      assert.equal(projection.sessionSchoolSlot, 1);

      // School 1's knowledge:
      // Tile 14 (solo), Tile 11 (shared), Tile 12 (provisional incumbent)
      // Tile 10 was discovered only by School 0: strictly invisible to School 1!
      const k = projection.knowledge;
      assert.equal(k.activeSoloTiles.includes(10), false);
      assert.equal(k.rememberedNeutralTiles.includes(10), false);
      assert.deepEqual(k.activeSoloTiles, [14]);
      assert.deepEqual(k.activeSharedTiles, [
        { tileIndex: 11, counterpartSchoolSlot: 0 },
      ]);

      // Landmark pot: School 1 pot = 600; School 0 pot = 1050 is hidden!
      const landmark = projection.landmarks[0];
      assertDefined(landmark);
      assert.equal(landmark.ownSchoolPot, 600);
    });

    it("shows shared contest facts with counterpart A, but zero A contributions or A wallets", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "student_projection");

      assert.equal(projection.contests.length, 1);
      const c = projection.contests[0];
      assertDefined(c);
      assert.equal(c.contestId, "contest-01");
      assert.equal(c.counterpartSchoolSlot, 0);
      assert.equal(c.role, "claimant");

      // Student B made no personal contributions to contest-01
      assert.equal(c.myContributions.length, 0);
      assert.equal(c.myRefundReceipts.length, 0);

      // Student B cannot inspect student-a's wallet
      assert.equal(projection.personal.wallet.pointsBalance, 10);
    });

    it("does not leak chests discovered by student A", () => {
      const projection = projectKnowledgeState(session, world);
      assert.equal(projection.kind, "student_projection");

      // Student B discovered chest-02, but NOT chest-01
      const discovered = projection.personal.discoveredChests;
      assert.equal(discovered.length, 1);
      assert.equal(discovered[0]?.chestId, "chest-02");
    });
  });

  // ==========================================================================
  // 5. Finance Admin vs Content Editor (Segregation of Roles)
  // ==========================================================================
  describe("Role Segregation: Finance Admin vs Content Editor", () => {
    const financeSession: FinanceAdminSession = {
      kind: "finance_admin",
      adminId: "admin-finance-01",
    };
    const editorSession: ContentEditorSession = {
      kind: "content_editor",
      adminId: "admin-editor-01",
    };

    it("Finance Admin sees full financial audit, all donor rows and wallets, but NO drafts or chests", () => {
      const proj = projectKnowledgeState(financeSession, world);
      assert.equal(proj.kind, "finance_admin_projection");
      assert.equal(proj.adminId, "admin-finance-01");

      const audit = proj.financialAudit;
      assert.ok(audit.cases.length >= 1);
      const case01 = audit.cases.find(
        (c: AuditCaseRecord) => c.contestId === "contest-01",
      );
      assertDefined(case01);
      assertDefined(case01.consolidation);

      // Full contribution rows visible to finance admin
      assert.equal(case01.consolidation.contributions.length, 2);
      assert.equal(case01.consolidation.contributions[0]?.actorId, "student-a");
      assert.equal(case01.consolidation.contributions[1]?.actorId, "student-c");

      // Full refund obligations visible
      assert.equal(case01.consolidation.refundObligations.length, 1);
      assert.equal(
        case01.consolidation.refundObligations[0]?.actorId,
        "student-a",
      );

      // All student wallets visible
      assert.equal(audit.studentWallets.length, 3);

      // FORBIDDEN: Draft map objects and hidden chest locations
      assert.equal("draftObjects" in proj, false);
      assert.equal("worldChests" in proj, false);
    });

    it("Content Editor sees draft map objects and finite world chests, but NO financial wallets or ledgers", () => {
      const proj = projectKnowledgeState(editorSession, world);
      assert.equal(proj.kind, "content_editor_projection");
      assert.equal(proj.adminId, "admin-editor-01");

      // Draft prefabs visible to editor
      assert.equal(proj.draftObjects.length, 1);
      assert.equal(proj.draftObjects[0]?.id, "draft-prefab-01");

      // World chests visible to editor
      assert.equal(proj.worldChests.length, 2);
      assert.equal(proj.worldChests[0]?.chestId, "chest-01");

      // FORBIDDEN: Financial wallets and donor ledgers
      assert.equal("financialAudit" in proj, false);
      assert.equal("studentWallets" in proj, false);
      assert.equal("contributions" in proj, false);
    });
  });

  // ==========================================================================
  // 6. School Switching
  // ==========================================================================
  describe("School Switching Behavior", () => {
    it("switches projected fog and landmark pots immediately when verified session updates", () => {
      // 1. Student initially enrolled in School 0
      const sessionSchool0: StudentSession = {
        kind: "student",
        actorId: "student-transfer",
        schoolSlot: 0,
      };
      const proj0 = projectKnowledgeState(sessionSchool0, world);
      assert.equal(proj0.kind, "student_projection");
      assert.equal(proj0.knowledge.schoolSlot, 0);
      assert.deepEqual(proj0.knowledge.activeSoloTiles, [10]);
      assert.equal(proj0.landmarks[0]?.ownSchoolPot, 1050);

      // 2. Student transfers to School 1
      const sessionSchool1: StudentSession = {
        kind: "student",
        actorId: "student-transfer",
        schoolSlot: 1,
      };
      const proj1 = projectKnowledgeState(sessionSchool1, world);
      assert.equal(proj1.kind, "student_projection");
      assert.equal(proj1.knowledge.schoolSlot, 1);
      // Now sees School 1's solo tile (14) and does not have School 0's private solo tile (10)
      assert.deepEqual(proj1.knowledge.activeSoloTiles, [14]);
      assert.equal(proj1.landmarks[0]?.ownSchoolPot, 600);
    });
  });

  // ==========================================================================
  // 7. Reconnect / Snapshot vs Event Visibility
  // ==========================================================================
  describe("Reconnect / Snapshot vs Event Visibility", () => {
    it("delivers clean snapshot on reconnect without past confidential leaks", () => {
      const studentSession: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };
      const reconnectSnapshot = projectKnowledgeState(studentSession, world, {
        nowMs: 50_000n,
      });
      assert.equal(reconnectSnapshot.kind, "student_projection");
      assert.equal(reconnectSnapshot.generatedAtMs, 50_000n);
      // Clean allowlist guarantees no rival secrets
      assert.equal(
        reconnectSnapshot.knowledge.activeSoloTiles.includes(14),
        false,
      );
    });

    it("filters tile_explored event: explorer gets own ACK, classmate gets sanitized notification, rival gets null", () => {
      const event: AuthoritativeEvent = {
        kind: "tile_explored",
        tileIndex: 42,
        schoolSlot: 0,
        actorId: "student-a",
        cost: 1,
        timestampMs: 1_000n,
      };

      const explorerSession: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };
      const classmateSession: StudentSession = {
        kind: "student",
        actorId: "student-c",
        schoolSlot: 0,
      };
      const rivalSession: StudentSession = {
        kind: "student",
        actorId: "student-b",
        schoolSlot: 1,
      };

      // Explorer receives own event with cost and actorId
      const explorerProj = projectKnowledgeEvent(explorerSession, event);
      assert.deepEqual(explorerProj, {
        kind: "own_tile_explored",
        tileIndex: 42,
        schoolSlot: 0,
        actorId: "student-a",
        cost: 1,
        timestampMs: 1_000n,
      });

      // Classmate receives sanitized school event: actorId and cost are omitted!
      const classmateProj = projectKnowledgeEvent(classmateSession, event);
      assert.deepEqual(classmateProj, {
        kind: "school_tile_explored",
        tileIndex: 42,
        schoolSlot: 0,
        timestampMs: 1_000n,
      });

      // Rival receives null (confidential fog)
      assert.equal(projectKnowledgeEvent(rivalSession, event), null);
    });

    it("filters contribution_accepted event: contributor gets receipt, classmate gets aggregate progress, rival gets null", () => {
      const event: AuthoritativeEvent = {
        kind: "contribution_accepted",
        contestId: "contest-01",
        participatingSchoolSlots: [0, 1],
        actorId: "student-a",
        schoolSlot: 0,
        walletId: "wallet-a",
        amount: 2,
        totalRequired: 4,
        totalReceived: 3,
        remainingPoints: 1,
        newRollingDecayDeadlineMs: 20_000n,
        timestampMs: 12_000n,
      };

      const payerSession: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };
      const classmateSession: StudentSession = {
        kind: "student",
        actorId: "student-c",
        schoolSlot: 0,
      };
      const rivalSession: StudentSession = {
        kind: "student",
        actorId: "student-b",
        schoolSlot: 1,
      };
      const financeSession: FinanceAdminSession = {
        kind: "finance_admin",
        adminId: "fin-1",
      };

      // Payer gets personal receipt with contribution amount
      const payerProj = projectKnowledgeEvent(payerSession, event);
      assert.deepEqual(payerProj, {
        kind: "own_contribution_receipt",
        contestId: "contest-01",
        amount: 2,
        totalReceived: 3,
        remainingPoints: 1,
        newRollingDecayDeadlineMs: 20_000n,
        timestampMs: 12_000n,
      });

      // Classmate gets aggregate progress only: actorId, walletId, and amount are redacted!
      const classmateProj = projectKnowledgeEvent(classmateSession, event);
      assert.deepEqual(classmateProj, {
        kind: "consolidation_progress",
        contestId: "contest-01",
        totalReceived: 3,
        remainingPoints: 1,
        newRollingDecayDeadlineMs: 20_000n,
        timestampMs: 12_000n,
      });

      // Rival student B (in school 1, participating in contest-01) receives aggregate progress for the contest
      const rivalProj = projectKnowledgeEvent(rivalSession, event);
      assert.deepEqual(rivalProj, {
        kind: "consolidation_progress",
        contestId: "contest-01",
        totalReceived: 3,
        remainingPoints: 1,
        newRollingDecayDeadlineMs: 20_000n,
        timestampMs: 12_000n,
      });

      // Finance admin gets full transaction audit
      const financeProj = projectKnowledgeEvent(financeSession, event);
      assert.equal(financeProj?.kind, "audit_contribution_accepted");
    });

    it("filters chest_discovered event: discovering actor gets event, classmate and rival get null, editor gets audit", () => {
      const event: AuthoritativeEvent = {
        kind: "chest_discovered",
        chestId: "chest-01",
        actorId: "student-a",
        coordinates: { x: 120, z: 120 },
        tier: "Aspire",
        timestampMs: 5_000n,
      };

      const discovererSession: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };
      const classmateSession: StudentSession = {
        kind: "student",
        actorId: "student-c",
        schoolSlot: 0,
      };
      const rivalSession: StudentSession = {
        kind: "student",
        actorId: "student-b",
        schoolSlot: 1,
      };
      const editorSession: ContentEditorSession = {
        kind: "content_editor",
        adminId: "ed-1",
      };

      // Discoverer receives coordinates and tier
      const discovererProj = projectKnowledgeEvent(discovererSession, event);
      assert.deepEqual(discovererProj, {
        kind: "own_chest_discovered",
        chestId: "chest-01",
        coordinates: { x: 120, z: 120 },
        tier: "Aspire",
        timestampMs: 5_000n,
      });

      // Classmate in same school receives null (chests are NOT broadcast to peers!)
      assert.equal(projectKnowledgeEvent(classmateSession, event), null);

      // Rival receives null
      assert.equal(projectKnowledgeEvent(rivalSession, event), null);

      // Content editor receives audit event (no player identity leak)
      const editorProj = projectKnowledgeEvent(editorSession, event);
      assert.deepEqual(editorProj, {
        kind: "editor_chest_discovered",
        chestId: "chest-01",
        tier: "Aspire",
        timestampMs: 5_000n,
      });
    });

    it("filters refund_recorded event: recipient gets receipt, classmates and rivals get null, finance admin gets audit", () => {
      const event: AuthoritativeEvent = {
        kind: "refund_recorded",
        refundId: "ref-1",
        contestId: "contest-01",
        actorId: "student-a",
        schoolSlot: 0,
        walletId: "wallet-a",
        amount: 2,
        status: "pending",
        timestampMs: 14_000n,
      };

      const recipientSession: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };
      const classmateSession: StudentSession = {
        kind: "student",
        actorId: "student-c",
        schoolSlot: 0,
      };
      const financeSession: FinanceAdminSession = {
        kind: "finance_admin",
        adminId: "fin-1",
      };

      // Recipient gets refund receipt
      assert.deepEqual(projectKnowledgeEvent(recipientSession, event), {
        kind: "own_refund_receipt",
        refundId: "ref-1",
        contestId: "contest-01",
        amount: 2,
        status: "pending",
        timestampMs: 14_000n,
      });

      // Classmate receives null
      assert.equal(projectKnowledgeEvent(classmateSession, event), null);

      // Finance admin gets full audit
      assert.equal(
        projectKnowledgeEvent(financeSession, event)?.kind,
        "audit_refund_recorded",
      );
    });

    it("broadcasts landmark_beacon_switched to all roles", () => {
      const event: AuthoritativeEvent = {
        kind: "landmark_beacon_switched",
        landmarkId: "landmark-fansipan",
        previousSchoolSlot: 0,
        newSchoolSlot: 1,
        newThreshold: 1100,
        timestampMs: 15_000n,
      };

      const anonSession: AnonymousSession = { kind: "anonymous" };
      const studentSession: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };

      assert.deepEqual(projectKnowledgeEvent(anonSession, event), {
        kind: "public_beacon_switched",
        landmarkId: "landmark-fansipan",
        previousSchoolSlot: 0,
        newSchoolSlot: 1,
        newThreshold: 1100,
        timestampMs: 15_000n,
      });

      assert.deepEqual(projectKnowledgeEvent(studentSession, event), {
        kind: "public_beacon_switched",
        landmarkId: "landmark-fansipan",
        previousSchoolSlot: 0,
        newSchoolSlot: 1,
        newThreshold: 1100,
        timestampMs: 15_000n,
      });
    });
  });

  // ==========================================================================
  // 8. Reject Unauthorized Actor Claims (Zero-Trust & Sanitized Errors)
  // ==========================================================================
  describe("Zero-Trust Affiliation & Sanitized Errors", () => {
    it("rejects client claiming actorId on anonymous session", () => {
      const session: AnonymousSession = { kind: "anonymous" };
      assert.throws(
        () =>
          validateClientClaims(session, { claimedActorId: "student-impostor" }),
        (err: unknown) => {
          if (!(err instanceof VisibilityAuthorizationError)) return false;
          assert.equal(err.code, "UNAUTHORIZED_CLAIM");
          assert.equal(
            err.message,
            "Actor claim not permitted for session type",
          );
          return true;
        },
      );
    });

    it("rejects client claiming actorId that differs from verified session identity", () => {
      const session: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };
      assert.throws(
        () => validateClientClaims(session, { claimedActorId: "student-b" }),
        (err: unknown) => {
          if (!(err instanceof VisibilityAuthorizationError)) return false;
          assert.equal(err.code, "UNAUTHORIZED_CLAIM");
          assert.equal(
            err.message,
            "Actor claim does not match verified session identity",
          );
          return true;
        },
      );
    });

    it("rejects client claiming schoolSlot that differs from verified session enrollment", () => {
      const session: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };
      assert.throws(
        () => validateClientClaims(session, { claimedSchoolSlot: 1 }),
        (err: unknown) => {
          if (!(err instanceof VisibilityAuthorizationError)) return false;
          assert.equal(err.code, "AFFILIATION_MISMATCH");
          assert.equal(
            err.message,
            "School affiliation does not match verified session enrollment",
          );
          return true;
        },
      );
    });

    it("rejects client claiming schoolSlot on non-student session", () => {
      const session: ContentEditorSession = {
        kind: "content_editor",
        adminId: "ed-1",
      };
      assert.throws(
        () => validateClientClaims(session, { claimedSchoolSlot: 0 }),
        (err: unknown) => {
          if (!(err instanceof VisibilityAuthorizationError)) return false;
          assert.equal(err.code, "AFFILIATION_MISMATCH");
          return true;
        },
      );
    });

    it("rejects claims via projectKnowledgeState entrypoint", () => {
      const session: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };
      assert.throws(
        () =>
          projectKnowledgeState(session, world, {
            clientClaims: { claimedSchoolSlot: 7 },
          }),
        (err: unknown) => {
          if (!(err instanceof VisibilityAuthorizationError)) return false;
          assert.equal(err.code, "AFFILIATION_MISMATCH");
          return true;
        },
      );
    });
  });

  // ==========================================================================
  // 9. Pure Scoring Rules (D4 & D5)
  // ==========================================================================
  describe("Pure Knowledge Scoring Invariants (D4 & D5)", () => {
    it("awards +1 to each school on shared tiles and +0 for provisional claims/neutral", () => {
      const testTiles: TileRecord[] = [
        {
          tileIndex: 1,
          discoveredSchools: new Set([0]),
          ownership: { kind: "solo", schoolSlot: 0 },
        },
        {
          tileIndex: 2,
          discoveredSchools: new Set([0, 1]),
          ownership: { kind: "shared", schoolSlots: [0, 1], contestId: "c1" },
        },
        {
          tileIndex: 3,
          discoveredSchools: new Set([1]),
          ownership: {
            kind: "provisional_claim",
            claimantSchoolSlot: 1,
            incumbentSchoolSlot: 0,
            caseId: "case1",
          },
        },
        {
          tileIndex: 4,
          discoveredSchools: new Set([0, 1, 2]),
          ownership: { kind: "neutral" },
        },
      ];

      // Tile 1: solo 0 -> 0: +1
      // Tile 2: shared 0+1 -> 0: +1, 1: +1 (both get +1!)
      // Tile 3: provisional 1 -> 1: +0 (anti-gaming rule D4!)
      // Tile 4: neutral -> +0
      // Result: School 0 = 2, School 1 = 1, others = 0
      const scores = computeKnowledgeScores(testTiles);
      const score0 = scores.find((s) => s.schoolSlot === 0);
      const score1 = scores.find((s) => s.schoolSlot === 1);
      const score2 = scores.find((s) => s.schoolSlot === 2);

      assert.equal(score0?.score, 2);
      assert.equal(score1?.score, 1);
      assert.equal(score2?.score, 0);

      // Ranking: School 0 is rank 1, School 1 is rank 2
      assert.equal(score0?.rank, 1);
      assert.equal(score1?.rank, 2);
    });

    it("breaks score ties by earliest reachedAtMs, then schoolSlot ascending", () => {
      const testTiles: TileRecord[] = [
        {
          tileIndex: 1,
          discoveredSchools: new Set([0]),
          ownership: { kind: "solo", schoolSlot: 0 },
        },
        {
          tileIndex: 2,
          discoveredSchools: new Set([1]),
          ownership: { kind: "solo", schoolSlot: 1 },
        },
      ];

      // Both have score 1.
      // School 1 reached score 1 at timestamp 100n, School 0 at 200n.
      const timestamps = new Map([
        [0, 200n],
        [1, 100n],
      ]);

      const scores = computeKnowledgeScores(testTiles, timestamps);
      assert.equal(scores[0]?.schoolSlot, 1); // Earliest reached wins tie
      assert.equal(scores[0]?.rank, 1);
      assert.equal(scores[1]?.schoolSlot, 0);
      assert.equal(scores[1]?.rank, 2);
    });
  });

  // ==========================================================================
  // 10. Deep Immutability & Allowlist Verification
  // ==========================================================================
  describe("Immutability of Outputs", () => {
    it("ensures projected states are deeply frozen", () => {
      const session: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };
      const proj = projectKnowledgeState(session, world);
      assert.ok(Object.isFrozen(proj));
      assert.ok(Object.isFrozen(proj.geometry));
      assert.ok(Object.isFrozen(proj.knowledge));
      assert.ok(Object.isFrozen(proj.knowledge.activeSoloTiles));
      assert.ok(Object.isFrozen(proj.personal));
      assert.ok(Object.isFrozen(proj.personal.wallet));

      // Attempting mutation throws in strict mode
      assert.throws(() => {
        (proj as unknown as Record<string, unknown>).hacked = true;
      });
      assert.throws(() => {
        (
          proj.personal.wallet as unknown as Record<string, unknown>
        ).pointsBalance = 9999;
      });
    });
  });
});
