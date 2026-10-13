/**
 * Unit Tests for M4-D2 Knowledge Wire Adapter (KnowledgeWireAdapterV1).
 *
 * Verifies server-authoritative realtime wire projections, zero-trust claims,
 * outbox delta fanout, replay/stale idempotency, gap resync, cross-school switching,
 * role segregation, and serializable Codex adapter seam integration.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AnonymousSession,
  AuthoritativeEvent,
  AuthoritativeWorldState,
  ContentEditorSession,
  ContestRecord,
  FinanceAdminSession,
  SpectatorSession,
  StudentProfile,
  StudentSession,
  TileRecord,
} from "../server/realtime/KnowledgeVisibilityV1.ts";
import {
  adaptKnowledgeTransitionToEvents,
  adaptSerializableToAuthoritativeEvent,
  InMemoryKnowledgeWireSink,
  KnowledgeWireAdapterV1,
  type SerializableAuthoritativeEvent,
  type SerializableKnowledgeOutboxEnvelope,
  safeDeserializeWireMessage,
  safeSerializeWireMessage,
  type WireKnowledgeDeltaMessage,
  type WireKnowledgeErrorMessage,
  type WireKnowledgeResyncMessage,
  type WireKnowledgeSnapshotMessage,
} from "../server/realtime/KnowledgeWireAdapterV1.ts";
import {
  type ClaimingKnowledge,
  startKnowledgeContest,
  transitionKnowledge,
} from "../shared/gameplay/knowledgeRulesV1.ts";

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
  // 13: neutral tile previously discovered by 0
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

describe("M4-D2 KnowledgeWireAdapterV1 - Realtime Projection & Wire Distribution", () => {
  const world = createTestWorldFixture();

  // ==========================================================================
  // Suite 1: Initial Snapshot Projection Across Roles
  // ==========================================================================
  describe("Suite 1: Server-Authoritative Initial Snapshot Projection Across Roles", () => {
    it("projects public view only for anonymous session", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 10n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      const session: AnonymousSession = { kind: "anonymous" };

      const snapshot = adapter.registerSession("session-anon", session, sink);
      assertDefined(snapshot);

      assert.equal(snapshot.kind, "snapshot");
      assert.equal(snapshot.revision, "10");
      assert.equal(snapshot.projection.kind, "public_projection");

      // Verify strict allowlist
      assert.equal(snapshot.projection.geometry.hqs.length, 2); // published only
      assert.equal(snapshot.projection.geometry.landmarks.length, 1);
      assert.equal(
        "schoolPots" in snapshot.projection.geometry.landmarks[0]!,
        false,
      );
      assert.equal("knowledge" in snapshot.projection, false);
      assert.equal("personal" in snapshot.projection, false);
      assert.equal("financialAudit" in snapshot.projection, false);

      assert.equal(sink.messages.length, 1);
      assert.equal(sink.messages[0]?.kind, "snapshot");
    });

    it("projects spectator view with beacons but without private pots/fog", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 10n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      const session: SpectatorSession = { kind: "spectator" };

      const snapshot = adapter.registerSession("session-spec", session, sink);
      assertDefined(snapshot);

      assert.equal(snapshot.projection.kind, "spectator_projection");
      assert.equal(snapshot.projection.landmarkBeacons.length, 1);
      assert.equal(
        "schoolPots" in snapshot.projection.landmarkBeacons[0]!,
        false,
      );
      assert.equal(
        "ownSchoolPot" in snapshot.projection.landmarkBeacons[0]!,
        false,
      );
    });

    it("projects own fog, own landmark pot, and personal receipts for Student A (School 0)", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 10n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      const session: StudentSession = {
        kind: "student",
        actorId: "student-a",
        schoolSlot: 0,
      };

      const snapshot = adapter.registerSession(
        "session-student-a",
        session,
        sink,
      );
      assertDefined(snapshot);

      assert.equal(snapshot.projection.kind, "student_projection");
      if (snapshot.projection.kind !== "student_projection")
        throw new Error("Expected student snapshot");
      assert.equal(snapshot.projection.sessionActorId, "student-a");
      assert.equal(snapshot.projection.sessionSchoolSlot, 0);

      // Knowledge
      const k = snapshot.projection.knowledge;
      assert.deepEqual(k.activeSoloTiles, [10]);
      assert.deepEqual(k.activeSharedTiles, [
        { tileIndex: 11, counterpartSchoolSlot: 1 },
      ]);
      assert.deepEqual(k.provisionalClaimTiles, [12]);
      assert.deepEqual(k.rememberedNeutralTiles, [13]);
      // Tile 14 (School 1 solo) strictly hidden
      assert.equal(k.activeSoloTiles.includes(14), false);

      // Landmark pot: sees own pot 1050; rival pot 600 hidden
      assert.equal(snapshot.projection.landmarks[0]?.ownSchoolPot, 1050);
      assert.equal("schoolPots" in snapshot.projection.landmarks[0]!, false);

      // Personal state
      const p = snapshot.projection.personal;
      assert.equal(p.wallet.pointsBalance, 25);
      assert.equal(p.discoveredChests.length, 1);
      assert.equal(p.discoveredChests[0]?.chestId, "chest-01");

      // Contests & Receipts: student-a sees cb-1 and ref-1; cb-2 (student-c) is hidden!
      const contest = snapshot.projection.contests[0];
      assertDefined(contest);
      assert.equal(contest.contestId, "contest-01");
      assert.equal(contest.myContributions.length, 1);
      assert.equal(contest.myContributions[0]?.contributionId, "cb-1");
      assert.equal(contest.myRefundReceipts.length, 1);
      assert.equal(contest.myRefundReceipts[0]?.refundId, "ref-1");
    });

    it("isolates rival fog, rival landmark pots, and hides all student A receipts from Student B (School 1)", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 10n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      const session: StudentSession = {
        kind: "student",
        actorId: "student-b",
        schoolSlot: 1,
      };

      const snapshot = adapter.registerSession(
        "session-student-b",
        session,
        sink,
      );
      assertDefined(snapshot);

      assert.equal(snapshot.projection.kind, "student_projection");
      assert.equal(snapshot.projection.sessionSchoolSlot, 1);

      // Knowledge: Sees solo tile 14, shared tile 11. Solo tile 10 strictly hidden!
      assert.deepEqual(snapshot.projection.knowledge.activeSoloTiles, [14]);
      assert.equal(
        snapshot.projection.knowledge.activeSoloTiles.includes(10),
        false,
      );

      // Landmark pot: sees School 1's pot 600, NOT School 0's pot 1050
      assert.equal(snapshot.projection.landmarks[0]?.ownSchoolPot, 600);

      // Contests: sees aggregate progress, but ZERO contributions or refund receipts
      const contest = snapshot.projection.contests[0];
      assertDefined(contest);
      assert.equal(contest.myContributions.length, 0);
      assert.equal(contest.myRefundReceipts.length, 0);

      // Personal: Chest 01 discovered by student-a is hidden; only sees chest-02
      assert.equal(
        snapshot.projection.personal.discoveredChests.some(
          (c) => c.chestId === "chest-01",
        ),
        false,
      );
    });

    it("Finance Admin sees full financial audit but zero draft objects or world chests", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 10n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      const session: FinanceAdminSession = {
        kind: "finance_admin",
        adminId: "admin-fin",
      };

      const snapshot = adapter.registerSession("session-fin", session, sink);
      assertDefined(snapshot);

      assert.equal(snapshot.projection.kind, "finance_admin_projection");
      assert.equal(snapshot.projection.financialAudit.cases.length, 2);
      assert.equal(snapshot.projection.financialAudit.studentWallets.length, 3);

      assert.equal("draftObjects" in snapshot.projection, false);
      assert.equal("worldChests" in snapshot.projection, false);
    });

    it("Content Editor sees draft objects and world chests but zero financial ledgers or student wallets", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 10n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      const session: ContentEditorSession = {
        kind: "content_editor",
        adminId: "admin-ed",
      };

      const snapshot = adapter.registerSession("session-ed", session, sink);
      assertDefined(snapshot);

      assert.equal(snapshot.projection.kind, "content_editor_projection");
      assert.equal(snapshot.projection.draftObjects.length, 1);
      assert.equal(snapshot.projection.worldChests.length, 2);

      assert.equal("financialAudit" in snapshot.projection, false);
      assert.equal("studentWallets" in snapshot.projection, false);
    });
  });

  // ==========================================================================
  // Suite 2: Outbox Delta Fanout & Confidentiality Guarantees
  // ==========================================================================
  describe("Suite 2: Outbox Delta Fanout & Confidentiality Guarantees", () => {
    it("fans out tile_explored: explorer gets own ACK, classmate gets sanitized notification, rival gets dropped", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 20n,
      });

      const sinkA = new InMemoryKnowledgeWireSink();
      const sinkC = new InMemoryKnowledgeWireSink();
      const sinkB = new InMemoryKnowledgeWireSink();

      adapter.registerSession(
        "s-a",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sinkA,
      );
      adapter.registerSession(
        "s-c",
        { kind: "student", actorId: "student-c", schoolSlot: 0 },
        sinkC,
      );
      adapter.registerSession(
        "s-b",
        { kind: "student", actorId: "student-b", schoolSlot: 1 },
        sinkB,
      );

      sinkA.clear();
      sinkC.clear();
      sinkB.clear();

      const event: AuthoritativeEvent = {
        kind: "tile_explored",
        tileIndex: 42,
        schoolSlot: 0,
        actorId: "student-a",
        cost: 1,
        timestampMs: 50_000n,
      };

      const outcome = adapter.publishAuthoritativeEvent(event, 21n);
      assert.equal(outcome.status, "published");
      assert.equal(outcome.revision, 21n);
      assert.equal(outcome.recipientCount, 2); // Student A and Student C only

      // Student A (Explorer) gets own_tile_explored with cost and actorId
      assert.equal(sinkA.messages.length, 1);
      const deltaA = sinkA.messages[0] as WireKnowledgeDeltaMessage;
      assert.equal(deltaA.kind, "delta");
      assert.equal(deltaA.revision, "21");
      assert.deepEqual(deltaA.event, {
        kind: "own_tile_explored",
        tileIndex: 42,
        schoolSlot: 0,
        actorId: "student-a",
        cost: 1,
        timestampMs: 50_000n,
      });

      // Student C (Classmate) gets sanitized school_tile_explored (actorId and cost omitted!)
      assert.equal(sinkC.messages.length, 1);
      const deltaC = sinkC.messages[0] as WireKnowledgeDeltaMessage;
      assert.deepEqual(deltaC.event, {
        kind: "school_tile_explored",
        tileIndex: 42,
        schoolSlot: 0,
        timestampMs: 50_000n,
      });

      // Student B (Rival) receives ZERO messages (confidential fog)
      assert.equal(sinkB.messages.length, 0);
    });

    it("fans out contribution_accepted: payer gets receipt, classmate and counterpart get aggregate progress, finance gets audit", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 30n,
      });

      const sinkPayer = new InMemoryKnowledgeWireSink();
      const sinkClassmate = new InMemoryKnowledgeWireSink();
      const sinkCounterpart = new InMemoryKnowledgeWireSink();
      const sinkFinance = new InMemoryKnowledgeWireSink();
      const sinkAnon = new InMemoryKnowledgeWireSink();

      adapter.registerSession(
        "s-payer",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sinkPayer,
      );
      adapter.registerSession(
        "s-classmate",
        { kind: "student", actorId: "student-c", schoolSlot: 0 },
        sinkClassmate,
      );
      adapter.registerSession(
        "s-counterpart",
        { kind: "student", actorId: "student-b", schoolSlot: 1 },
        sinkCounterpart,
      );
      adapter.registerSession(
        "s-fin",
        { kind: "finance_admin", adminId: "fin-1" },
        sinkFinance,
      );
      adapter.registerSession("s-anon", { kind: "anonymous" }, sinkAnon);

      sinkPayer.clear();
      sinkClassmate.clear();
      sinkCounterpart.clear();
      sinkFinance.clear();
      sinkAnon.clear();

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
        newRollingDecayDeadlineMs: 25_000n,
        timestampMs: 15_000n,
      };

      const outcome = adapter.publishAuthoritativeEvent(event, 31n);
      assert.equal(outcome.recipientCount, 4); // payer, classmate, counterpart, finance admin

      // Payer receives personal contribution receipt with amount
      assert.equal(sinkPayer.messages.length, 1);
      const payerDelta = sinkPayer.messages[0] as WireKnowledgeDeltaMessage;
      assert.deepEqual(payerDelta.event, {
        kind: "own_contribution_receipt",
        contestId: "contest-01",
        amount: 2,
        totalReceived: 3,
        remainingPoints: 1,
        newRollingDecayDeadlineMs: 25_000n,
        timestampMs: 15_000n,
      });

      // Classmate receives aggregate progress only (donor identity redacted)
      assert.equal(sinkClassmate.messages.length, 1);
      const classmateDelta = sinkClassmate
        .messages[0] as WireKnowledgeDeltaMessage;
      assert.deepEqual(classmateDelta.event, {
        kind: "consolidation_progress",
        contestId: "contest-01",
        totalReceived: 3,
        remainingPoints: 1,
        newRollingDecayDeadlineMs: 25_000n,
        timestampMs: 15_000n,
      });

      // Counterpart receives aggregate progress only (donor identity and wallet redacted)
      assert.equal(sinkCounterpart.messages.length, 1);
      const counterpartDelta = sinkCounterpart
        .messages[0] as WireKnowledgeDeltaMessage;
      assert.deepEqual(counterpartDelta.event, {
        kind: "consolidation_progress",
        contestId: "contest-01",
        totalReceived: 3,
        remainingPoints: 1,
        newRollingDecayDeadlineMs: 25_000n,
        timestampMs: 15_000n,
      });

      // Finance admin receives full transaction audit
      assert.equal(sinkFinance.messages.length, 1);
      const finDelta = sinkFinance.messages[0] as WireKnowledgeDeltaMessage;
      assert.equal(finDelta.event.kind, "audit_contribution_accepted");

      // Anonymous receives ZERO messages (public is not informed of private micro-payments)
      assert.equal(sinkAnon.messages.length, 0);
    });

    it("fans out refund_recorded: recipient gets personal receipt, classmates/rivals get null, finance gets audit", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 40n,
      });

      const sinkRecipient = new InMemoryKnowledgeWireSink();
      const sinkPeer = new InMemoryKnowledgeWireSink();
      const sinkFin = new InMemoryKnowledgeWireSink();

      adapter.registerSession(
        "s-recip",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sinkRecipient,
      );
      adapter.registerSession(
        "s-peer",
        { kind: "student", actorId: "student-c", schoolSlot: 0 },
        sinkPeer,
      );
      adapter.registerSession(
        "s-fin",
        { kind: "finance_admin", adminId: "fin-1" },
        sinkFin,
      );

      sinkRecipient.clear();
      sinkPeer.clear();
      sinkFin.clear();

      const event: AuthoritativeEvent = {
        kind: "refund_recorded",
        refundId: "ref-99",
        contestId: "contest-01",
        actorId: "student-a",
        schoolSlot: 0,
        walletId: "wallet-a",
        amount: 3,
        status: "pending",
        timestampMs: 60_000n,
      };

      const outcome = adapter.publishAuthoritativeEvent(event, 41n);
      assert.equal(outcome.recipientCount, 2);

      // Recipient gets own_refund_receipt
      assert.equal(sinkRecipient.messages.length, 1);
      const recipDelta = sinkRecipient.messages[0] as WireKnowledgeDeltaMessage;
      assert.deepEqual(recipDelta.event, {
        kind: "own_refund_receipt",
        refundId: "ref-99",
        contestId: "contest-01",
        amount: 3,
        status: "pending",
        timestampMs: 60_000n,
      });

      // Classmate receives null
      assert.equal(sinkPeer.messages.length, 0);

      // Finance admin receives audit
      assert.equal(sinkFin.messages.length, 1);
      const finDelta = sinkFin.messages[0] as WireKnowledgeDeltaMessage;
      assert.equal(finDelta.event.kind, "audit_refund_recorded");
    });

    it("fans out chest_discovered: discoverer gets coordinates, peers get null, editor gets audit without player id", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 50n,
      });

      const sinkDisc = new InMemoryKnowledgeWireSink();
      const sinkPeer = new InMemoryKnowledgeWireSink();
      const sinkEd = new InMemoryKnowledgeWireSink();

      adapter.registerSession(
        "s-disc",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sinkDisc,
      );
      adapter.registerSession(
        "s-peer",
        { kind: "student", actorId: "student-c", schoolSlot: 0 },
        sinkPeer,
      );
      adapter.registerSession(
        "s-ed",
        { kind: "content_editor", adminId: "ed-1" },
        sinkEd,
      );

      sinkDisc.clear();
      sinkPeer.clear();
      sinkEd.clear();

      const event: AuthoritativeEvent = {
        kind: "chest_discovered",
        chestId: "chest-01",
        actorId: "student-a",
        coordinates: { x: 120, z: 120 },
        tier: "Aspire",
        timestampMs: 70_000n,
      };

      const outcome = adapter.publishAuthoritativeEvent(event, 51n);
      assert.equal(outcome.recipientCount, 2);

      // Discoverer gets exact coordinates
      assert.equal(sinkDisc.messages.length, 1);
      const discDelta = sinkDisc.messages[0] as WireKnowledgeDeltaMessage;
      assert.deepEqual(discDelta.event, {
        kind: "own_chest_discovered",
        chestId: "chest-01",
        coordinates: { x: 120, z: 120 },
        tier: "Aspire",
        timestampMs: 70_000n,
      });

      // Classmate gets null (chests are per actor, not shared with school)
      assert.equal(sinkPeer.messages.length, 0);

      // Editor gets audit without player identity
      assert.equal(sinkEd.messages.length, 1);
      const edDelta = sinkEd.messages[0] as WireKnowledgeDeltaMessage;
      assert.deepEqual(edDelta.event, {
        kind: "editor_chest_discovered",
        chestId: "chest-01",
        tier: "Aspire",
        timestampMs: 70_000n,
      });
    });

    it("broadcasts landmark_beacon_switched to all active sessions", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 60n,
      });

      const sinkAnon = new InMemoryKnowledgeWireSink();
      const sinkStudent = new InMemoryKnowledgeWireSink();

      adapter.registerSession("s-anon", { kind: "anonymous" }, sinkAnon);
      adapter.registerSession(
        "s-student",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sinkStudent,
      );

      sinkAnon.clear();
      sinkStudent.clear();

      const event: AuthoritativeEvent = {
        kind: "landmark_beacon_switched",
        landmarkId: "landmark-fansipan",
        previousSchoolSlot: 0,
        newSchoolSlot: 1,
        newThreshold: 1100,
        timestampMs: 80_000n,
      };

      const outcome = adapter.publishAuthoritativeEvent(event, 61n);
      assert.equal(outcome.recipientCount, 2);

      assert.equal(sinkAnon.messages.length, 1);
      assert.equal(
        (sinkAnon.messages[0] as WireKnowledgeDeltaMessage).event.kind,
        "public_beacon_switched",
      );

      assert.equal(sinkStudent.messages.length, 1);
      assert.equal(
        (sinkStudent.messages[0] as WireKnowledgeDeltaMessage).event.kind,
        "public_beacon_switched",
      );
    });
  });

  // ==========================================================================
  // Suite 3: Replay, Idempotency, and Stale Revision Handling
  // ==========================================================================
  describe("Suite 3: Replay, Idempotency, and Stale Revision Handling", () => {
    it("drops replayed outbox row idempotently based on outboxId", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 100n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      adapter.registerSession(
        "s-1",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sink,
      );
      sink.clear();

      const envelope: SerializableKnowledgeOutboxEnvelope = {
        outboxId: "outbox-msg-001",
        revision: "101",
        event: {
          kind: "tile_explored",
          tileIndex: 55,
          schoolSlot: 0,
          actorId: "student-a",
          cost: 1,
          timestampMs: "1000",
        },
      };

      // First ingestion succeeds and publishes
      const first = adapter.ingestOutboxEnvelope(envelope);
      assert.equal(first.status, "published");
      assert.equal(first.recipientCount, 1);
      assert.equal(sink.messages.length, 1);

      // Replay of exact outboxId is dropped with 0 recipients
      const replay = adapter.ingestOutboxEnvelope(envelope);
      assert.equal(replay.status, "idempotent_duplicate");
      assert.equal(replay.recipientCount, 0);
      assert.equal(
        sink.messages.length,
        1,
        "Must not enqueue duplicate message to sink",
      );
    });

    it("drops stale event whose revision is less than or equal to session's lastRevision", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 105n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      adapter.registerSession(
        "s-1",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sink,
      );
      sink.clear();

      // Session is at revision 105. Event with revision 104 is stale.
      const event: AuthoritativeEvent = {
        kind: "tile_explored",
        tileIndex: 55,
        schoolSlot: 0,
        actorId: "student-a",
        cost: 1,
        timestampMs: 1000n,
      };

      adapter.publishAuthoritativeEvent(event, 104n);
      assert.equal(sink.messages.length, 0, "Stale revision must be dropped");

      // Event with revision 105 (already observed) is also dropped
      adapter.publishAuthoritativeEvent(event, 105n);
      assert.equal(
        sink.messages.length,
        0,
        "Already observed revision must be dropped",
      );
    });

    it("advances session revision even when event is unauthorized so future events do not falsely detect gaps", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 110n,
      });
      const sinkRival = new InMemoryKnowledgeWireSink();
      adapter.registerSession(
        "s-rival",
        { kind: "student", actorId: "student-b", schoolSlot: 1 },
        sinkRival,
      );
      sinkRival.clear();

      // Event 111 is confidential to school 0 (rival gets null)
      const eventSchool0: AuthoritativeEvent = {
        kind: "tile_explored",
        tileIndex: 55,
        schoolSlot: 0,
        actorId: "student-a",
        cost: 1,
        timestampMs: 1000n,
      };
      adapter.publishAuthoritativeEvent(eventSchool0, 111n);
      assert.equal(sinkRival.messages.length, 0);
      assert.equal(adapter.getSessionRevision("s-rival"), 111n);

      // Event 112 is a public beacon switch. Since session revision advanced to 111, 112 is sequential!
      const eventPublic: AuthoritativeEvent = {
        kind: "landmark_beacon_switched",
        landmarkId: "landmark-fansipan",
        previousSchoolSlot: 0,
        newSchoolSlot: 1,
        newThreshold: 1100,
        timestampMs: 2000n,
      };
      adapter.publishAuthoritativeEvent(eventPublic, 112n);
      assert.equal(sinkRival.messages.length, 1);
      assert.equal(sinkRival.messages[0]?.kind, "delta");
      assert.equal(
        (sinkRival.messages[0] as WireKnowledgeDeltaMessage).revision,
        "112",
      );
    });
  });

  // ==========================================================================
  // Suite 4: Gap Detection & Reconnect / Resync Projections
  // ==========================================================================
  describe("Suite 4: Gap Detection & Reconnect / Resync Projections", () => {
    it("detects revision gap and sends resync_required followed by a fresh snapshot", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 200n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      adapter.registerSession(
        "s-gap",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sink,
      );
      sink.clear();

      // Session is at 200. An event suddenly arrives at 205 (gap of 4 revisions missed)
      const event: AuthoritativeEvent = {
        kind: "landmark_beacon_switched",
        landmarkId: "landmark-fansipan",
        previousSchoolSlot: 0,
        newSchoolSlot: 1,
        newThreshold: 1100,
        timestampMs: 3000n,
      };

      adapter.publishAuthoritativeEvent(event, 205n);

      // Must receive resync_required notice AND immediate fresh snapshot
      assert.equal(sink.messages.length, 2);

      const resyncNotice = sink.messages[0] as WireKnowledgeResyncMessage;
      assert.equal(resyncNotice.kind, "resync_required");
      assert.equal(resyncNotice.reason, "gap_detected");
      assert.equal(resyncNotice.expectedRevision, "201");
      assert.equal(resyncNotice.currentRevision, "205");

      const snapshot = sink.messages[1] as WireKnowledgeSnapshotMessage;
      assert.equal(snapshot.kind, "snapshot");
      assert.equal(snapshot.revision, "205");
      assert.equal(snapshot.projection.kind, "student_projection");

      assert.equal(adapter.getSessionRevision("s-gap"), 205n);
    });

    it("client explicit resync request delivers clean snapshot matching current world revision", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 250n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      adapter.registerSession(
        "s-client-resync",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sink,
      );
      sink.clear();

      const outcome = adapter.handleClientMessage("s-client-resync", {
        kind: "resync",
      });
      assert.equal(outcome.ok, true);
      assert.equal(outcome.action, "resync");

      assert.equal(sink.messages.length, 1);
      const snapshot = sink.messages[0] as WireKnowledgeSnapshotMessage;
      assert.equal(snapshot.kind, "snapshot");
      assert.equal(snapshot.revision, "250");
      if (snapshot.projection.kind !== "student_projection")
        throw new Error("Expected student snapshot");
      assert.equal(snapshot.projection.sessionActorId, "student-a");
    });
  });

  // ==========================================================================
  // Suite 5: Zero-Trust Client Claims & Sanitized Error Security
  // ==========================================================================
  describe("Suite 5: Zero-Trust Client Claims & Sanitized Error Security", () => {
    it("rejects client claiming actorId on anonymous session without secret leakage", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 300n,
      });
      const sink = new InMemoryKnowledgeWireSink();

      assert.throws(
        () =>
          adapter.registerSession("s-anon-spoof", { kind: "anonymous" }, sink, {
            clientClaims: { claimedActorId: "student-a" },
          }),
        /Actor claim not permitted for session type/,
      );

      // Sink receives sanitized error frame
      assert.equal(sink.messages.length, 1);
      const err = sink.messages[0] as WireKnowledgeErrorMessage;
      assert.equal(err.kind, "error");
      assert.equal(err.code, "UNAUTHORIZED_CLAIM");
      assert.equal(err.message, "Actor claim not permitted for session type");
    });

    it("rejects student claiming mismatched actorId without leaking whether claimed actor exists", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 300n,
      });
      const sink = new InMemoryKnowledgeWireSink();

      assert.throws(
        () =>
          adapter.registerSession(
            "s-impostor",
            { kind: "student", actorId: "student-a", schoolSlot: 0 },
            sink,
            { clientClaims: { claimedActorId: "student-victim" } },
          ),
        /Actor claim does not match verified session identity/,
      );

      assert.equal(sink.messages.length, 1);
      const err = sink.messages[0] as WireKnowledgeErrorMessage;
      assert.equal(err.code, "UNAUTHORIZED_CLAIM");
      assert.equal(
        err.message,
        "Actor claim does not match verified session identity",
      );
    });

    it("rejects student claiming mismatched schoolSlot without data leakage", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 300n,
      });
      const sink = new InMemoryKnowledgeWireSink();

      assert.throws(
        () =>
          adapter.registerSession(
            "s-school-spoof",
            { kind: "student", actorId: "student-a", schoolSlot: 0 },
            sink,
            { clientClaims: { claimedSchoolSlot: 1 } },
          ),
        /School affiliation does not match verified session enrollment/,
      );

      assert.equal(sink.messages.length, 1);
      const err = sink.messages[0] as WireKnowledgeErrorMessage;
      assert.equal(err.code, "AFFILIATION_MISMATCH");
    });

    it("rejects production mutation attempt and delivers sanitized PRODUCTION_DISABLED error", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 300n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      adapter.registerSession(
        "s-mut",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sink,
      );
      sink.clear();

      const outcome = adapter.handleClientMessage("s-mut", {
        kind: "production_mutation",
      });
      assert.equal(outcome.ok, false);
      assert.equal(outcome.error, "PRODUCTION_DISABLED");

      assert.equal(sink.messages.length, 1);
      const err = sink.messages[0] as WireKnowledgeErrorMessage;
      assert.equal(err.code, "PRODUCTION_DISABLED");
    });
  });

  // ==========================================================================
  // Suite 6: Cross-School Switching Lifecycle
  // ==========================================================================
  describe("Suite 6: Cross-School Switching Lifecycle", () => {
    it("immediately switches projected fog, landmark pots, and event filtering on school switch", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 400n,
      });
      const sink = new InMemoryKnowledgeWireSink();

      // 1. Initial enrollment in School 0
      const session0: StudentSession = {
        kind: "student",
        actorId: "student-transfer",
        schoolSlot: 0,
      };
      const initialSnap = adapter.registerSession("s-transfer", session0, sink);
      assertDefined(initialSnap);

      if (initialSnap.projection.kind !== "student_projection")
        throw new Error("Expected student snapshot");
      assert.deepEqual(initialSnap.projection.knowledge.activeSoloTiles, [10]);
      assert.equal(initialSnap.projection.landmarks[0]?.ownSchoolPot, 1050);

      sink.clear();

      // 2. Verified transfer to School 1
      const session1: StudentSession = {
        kind: "student",
        actorId: "student-transfer",
        schoolSlot: 1,
      };
      const switchedSnap = adapter.switchSessionAffiliation(
        "s-transfer",
        session1,
      );

      // Immediately receives fresh snapshot for School 1
      if (switchedSnap.projection.kind !== "student_projection")
        throw new Error("Expected student snapshot");
      assert.equal(switchedSnap.projection.sessionSchoolSlot, 1);
      assert.deepEqual(switchedSnap.projection.knowledge.activeSoloTiles, [14]);
      // School 0 solo tile (10) is completely gone
      assert.equal(
        switchedSnap.projection.knowledge.activeSoloTiles.includes(10),
        false,
      );
      // Landmark pot now reflects School 1's pot 600
      assert.equal(switchedSnap.projection.landmarks[0]?.ownSchoolPot, 600);

      sink.clear();

      // 3. Subsequent event from School 0 is now treated as rival fog -> DROPPED
      adapter.publishAuthoritativeEvent(
        {
          kind: "tile_explored",
          tileIndex: 77,
          schoolSlot: 0,
          actorId: "student-a",
          cost: 1,
          timestampMs: 5000n,
        },
        401n,
      );
      assert.equal(
        sink.messages.length,
        0,
        "School 0 tile exploration must be dropped for School 1 student",
      );

      // 4. Subsequent event from School 1 is now DELIVERED
      adapter.publishAuthoritativeEvent(
        {
          kind: "tile_explored",
          tileIndex: 88,
          schoolSlot: 1,
          actorId: "student-other",
          cost: 1,
          timestampMs: 6000n,
        },
        402n,
      );
      assert.equal(
        sink.messages.length,
        1,
        "School 1 tile exploration must be delivered",
      );
      assert.equal(
        (sink.messages[0] as WireKnowledgeDeltaMessage).event.kind,
        "school_tile_explored",
      );
    });
  });

  // ==========================================================================
  // Suite 7: Serializable Outbox Envelope & Pure Rule Seam Integration
  // ==========================================================================
  describe("Suite 7: Serializable Outbox Envelope & Pure Rule Seam Integration", () => {
    it("safely serializes and deserializes wire messages without BigInt TypeError", () => {
      const adapter = new KnowledgeWireAdapterV1(world, {
        initialRevision: 500n,
      });
      const sink = new InMemoryKnowledgeWireSink();
      adapter.registerSession(
        "s-ser",
        { kind: "student", actorId: "student-a", schoolSlot: 0 },
        sink,
      );

      const msg = sink.messages[0];
      assertDefined(msg);

      // Safe serialize converts bigints to string
      const json = safeSerializeWireMessage(msg);
      assert.equal(typeof json, "string");
      assert.ok(json.includes('"revision":"500"'));

      // Safe deserialize recovers JSON structure
      const parsed = safeDeserializeWireMessage(json);
      assert.equal(parsed.kind, "snapshot");
      assert.equal(parsed.revision, "500");
    });

    it("adapts serializable outbox event contract with mixed string/number/bigint inputs", () => {
      const serializableEvent: SerializableAuthoritativeEvent = {
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
        newRollingDecayDeadlineMs: "25000000",
        timestampMs: 15000,
      };

      const adapted = adaptSerializableToAuthoritativeEvent(serializableEvent);
      assert.equal(adapted.kind, "contribution_accepted");
      assert.equal(adapted.newRollingDecayDeadlineMs, 25_000_000n);
      assert.equal(adapted.timestampMs, 15_000n);
    });

    it("seam helper adaptKnowledgeTransitionToEvents cleanly converts pure rules transition to events", () => {
      // 1. Setup pure contest
      const contest = startKnowledgeContest({
        campaignId: "test-campaign",
        contestId: "contest-test",
        schoolSlots: [0, 1],
        openedAtMs: 100n,
        tiles: [
          { tileIndex: 100, incumbentSchoolSlot: 0 },
          { tileIndex: 101, incumbentSchoolSlot: 0 },
          { tileIndex: 102, incumbentSchoolSlot: 0 },
        ],
      });

      // 2. School 0 departs -> Claim opens for School 1
      const departureTrans = transitionKnowledge(contest, {
        kind: "departure",
        schoolSlot: 0,
        atMs: 200n,
        remainingSchoolValid: true,
      });

      const openEvents = adaptKnowledgeTransitionToEvents(departureTrans, {
        contestId: "contest-test",
        participatingSchoolSlots: [0, 1],
        timestampMs: 200n,
      });

      assert.equal(openEvents.length, 1);
      assert.equal(openEvents[0]?.kind, "contest_stage_changed");
      assert.equal(
        (
          openEvents[0] as Extract<
            AuthoritativeEvent,
            { kind: "contest_stage_changed" }
          >
        ).newStage,
        "claiming",
      );

      // 3. School 1 contributes
      const claimState = departureTrans.state as ClaimingKnowledge;
      const contribTrans = transitionKnowledge(claimState, {
        kind: "contribute",
        contributionId: "cb-test-1",
        actorId: "student-b",
        walletId: "wallet-b",
        schoolSlot: 1,
        verified: true,
        requestedPoints: 1n,
        walletBalance: 10n,
        atMs: 300n,
      });

      const contribEvents = adaptKnowledgeTransitionToEvents(contribTrans, {
        contestId: "contest-test",
        participatingSchoolSlots: [0, 1],
        timestampMs: 300n,
      });

      assert.equal(contribEvents.length, 1);
      assert.equal(contribEvents[0]?.kind, "contribution_accepted");
      const ce = contribEvents[0] as Extract<
        AuthoritativeEvent,
        { kind: "contribution_accepted" }
      >;
      assert.equal(ce.actorId, "student-b");
      assert.equal(ce.amount, 1);
      assert.equal(ce.totalReceived, 1);
    });
  });
});
