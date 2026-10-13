/**
 * Tests for M4-D hidden chest V1 pure deterministic reducer and projections.
 *
 * Verifies:
 * - Admin creation only, 2x2 footprint bounds, footprint collisions, event stock cap
 * - Draft / publish lifecycle fail-closed for unpublished chest
 * - Per-player reveal (no universal school-wide reveal)
 * - Private Treasure Map eligibility
 * - Matching key tier mandatory, distinct keys, key consumed ONLY on success
 * - Open twice rejection and one-time global removal
 * - Concurrent last-chest serialized processing with expected revision
 * - Idempotency (same command ID replay vs replay with changed payload)
 * - Server-controlled reveal rejecting forged browser claims
 * - Unauthorized actors (spectators, undiscovered attempts)
 * - Privacy outputs matrix (Section 2 C-08, R4-22, R4-23)
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ActorIdentity,
  CHEST_FOOTPRINT_HEIGHT,
  CHEST_FOOTPRINT_WIDTH,
  type CreateChestCommand,
  type CreditPlayerKeyCommand,
  createInitialChestWorldState,
  type GrantTreasureMapCommand,
  getChestCoordinatesIfAuthorized,
  getChestFootprintTiles,
  isTileInChestFootprint,
  isValidChestPlacement,
  type OpenChestCommand,
  type PublishChestCommand,
  projectChestForViewer,
  projectVisibleChestsForViewer,
  type RecordExplorationDiscoveryCommand,
  reduceChestWorld,
} from "../shared/gameplay/hiddenChestV1.ts";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../shared/world/constants.ts";
import { tileIndex } from "../shared/world/coordinates.ts";

// --- Fixture Helpers ---------------------------------------------------------

const adminActor: ActorIdentity = {
  actorId: "admin-btc-1",
  studentId: "admin-btc-1",
  schoolSlot: 0,
  role: "admin",
};

const studentA: ActorIdentity = {
  actorId: "student-hcmut-alpha",
  studentId: "student-hcmut-alpha",
  schoolSlot: 0,
  role: "student",
};

const studentBTeammate: ActorIdentity = {
  actorId: "student-hcmut-beta",
  studentId: "student-hcmut-beta",
  schoolSlot: 0,
  role: "student",
};

const studentCRival: ActorIdentity = {
  actorId: "student-dtu-gamma",
  studentId: "student-dtu-gamma",
  schoolSlot: 2,
  role: "student",
};

const spectatorViewer: ActorIdentity = {
  actorId: "spectator-anon",
  studentId: "spectator-anon",
  schoolSlot: 0,
  role: "spectator",
};

const defaultEventConfig = {
  eventId: "event-fall-2026",
  stockCap: 10,
};

// --- Test 1: Admin creation only & 2x2 footprint bounds -----------------------

test("admin creation only, 2x2 footprint property, and placement bounds", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  // 1. Admin creates valid chest
  const createCmd: CreateChestCommand = {
    kind: "create_chest",
    commandId: "cmd-create-1",
    actor: adminActor,
    chestId: "chest-001",
    eventId: "event-fall-2026",
    x: 100,
    z: 200,
    keyTier: "tier_gold",
    rewardTemplateId: "tmpl_prize_a",
    initialStatus: "published",
    timestampMs: 1_000n,
  };

  const res1 = reduceChestWorld(state0, createCmd);
  assert.equal(res1.decision.kind, "apply");
  const chest = res1.state.chests.get("chest-001");
  assert.ok(chest);
  assert.equal(chest.footprintWidth, 2);
  assert.equal(chest.footprintHeight, 2);
  assert.equal(chest.x, 100);
  assert.equal(chest.z, 200);
  assert.equal(chest.status, "published");
  assert.equal(chest.revision, 1n);

  // 2. Non-admin student attempts creation -> rejected
  const studentCreateCmd: CreateChestCommand = {
    ...createCmd,
    commandId: "cmd-create-fail-1",
    actor: studentA,
    chestId: "chest-student-forged",
  };
  const resStudent = reduceChestWorld(state0, studentCreateCmd);
  assert.equal(resStudent.decision.kind, "reject");
  assert.equal(resStudent.decision.reason, "unauthorized_admin_role");

  // 3. Placement bounds validation
  assert.equal(isValidChestPlacement(0, 0), true);
  assert.equal(
    isValidChestPlacement(
      WORLD_WIDTH - CHEST_FOOTPRINT_WIDTH,
      WORLD_HEIGHT - CHEST_FOOTPRINT_HEIGHT,
    ),
    true,
  );
  assert.equal(isValidChestPlacement(-1, 0), false);
  assert.equal(isValidChestPlacement(0, -1), false);
  assert.equal(
    isValidChestPlacement(WORLD_WIDTH - 1, 0),
    false,
    "Chest of width 2 spills out of world at WORLD_WIDTH - 1",
  );
  assert.equal(
    isValidChestPlacement(0, WORLD_HEIGHT - 1),
    false,
    "Chest of height 2 spills out of world at WORLD_HEIGHT - 1",
  );

  const outOfBoundsCmd: CreateChestCommand = {
    ...createCmd,
    commandId: "cmd-create-oob",
    chestId: "chest-oob",
    x: WORLD_WIDTH - 1,
    z: 50,
  };
  const resOob = reduceChestWorld(state0, outOfBoundsCmd);
  assert.equal(resOob.decision.kind, "reject");
  assert.equal(resOob.decision.reason, "placement_out_of_bounds");

  // 4. Exact 4 footprint tile indices
  const footprintTiles = getChestFootprintTiles(100, 200);
  assert.equal(footprintTiles.length, 4);
  assert.deepEqual(footprintTiles, [
    tileIndex(100, 200),
    tileIndex(101, 200),
    tileIndex(100, 201),
    tileIndex(101, 201),
  ]);
  assert.equal(isTileInChestFootprint(100, 200, 100, 200), true);
  assert.equal(isTileInChestFootprint(101, 201, 100, 200), true);
  assert.equal(isTileInChestFootprint(102, 200, 100, 200), false);
});

// --- Test 2: Footprint collision and event stock cap -------------------------

test("footprint collision check and event stock cap enforcement", () => {
  const state0 = createInitialChestWorldState([
    { eventId: "capped-event", stockCap: 2 },
  ]);

  // Place 1st chest at (10, 10)
  const cmd1: CreateChestCommand = {
    kind: "create_chest",
    commandId: "c1",
    actor: adminActor,
    chestId: "ch-1",
    eventId: "capped-event",
    x: 10,
    z: 10,
    keyTier: "tier_bronze",
    rewardTemplateId: "tmpl_1",
    initialStatus: "published",
    timestampMs: 100n,
  };
  const res1 = reduceChestWorld(state0, cmd1);
  assert.equal(res1.decision.kind, "apply");

  // Place overlapping 2x2 chest at (11, 11) -> rejected collision
  const cmdOverlap: CreateChestCommand = {
    kind: "create_chest",
    commandId: "c-overlap",
    actor: adminActor,
    chestId: "ch-overlap",
    eventId: "capped-event",
    x: 11,
    z: 11,
    keyTier: "tier_bronze",
    rewardTemplateId: "tmpl_1",
    initialStatus: "published",
    timestampMs: 110n,
  };
  const resOverlap = reduceChestWorld(res1.state, cmdOverlap);
  assert.equal(resOverlap.decision.kind, "reject");
  assert.equal(resOverlap.decision.reason, "footprint_collision");

  // Place adjacent (non-overlapping) chest at (12, 10) -> succeeds
  const cmd2: CreateChestCommand = {
    kind: "create_chest",
    commandId: "c2",
    actor: adminActor,
    chestId: "ch-2",
    eventId: "capped-event",
    x: 12,
    z: 10,
    keyTier: "tier_bronze",
    rewardTemplateId: "tmpl_1",
    initialStatus: "published",
    timestampMs: 120n,
  };
  const res2 = reduceChestWorld(res1.state, cmd2);
  assert.equal(res2.decision.kind, "apply");

  // Stock cap is 2: 3rd chest placement rejected
  const cmd3: CreateChestCommand = {
    kind: "create_chest",
    commandId: "c3",
    actor: adminActor,
    chestId: "ch-3",
    eventId: "capped-event",
    x: 20,
    z: 20,
    keyTier: "tier_bronze",
    rewardTemplateId: "tmpl_1",
    initialStatus: "published",
    timestampMs: 130n,
  };
  const res3 = reduceChestWorld(res2.state, cmd3);
  assert.equal(res3.decision.kind, "reject");
  assert.equal(res3.decision.reason, "event_stock_cap_exceeded");
});

// --- Test 3: Draft/Publish lifecycle & Fail-closed for draft -----------------

test("draft and publish flags fail-closed for unpublished chest", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  // Admin creates draft chest
  const createDraft: CreateChestCommand = {
    kind: "create_chest",
    commandId: "cmd-draft-create",
    actor: adminActor,
    chestId: "chest-draft-1",
    eventId: "event-fall-2026",
    x: 50,
    z: 50,
    keyTier: "tier_iron",
    rewardTemplateId: "tmpl_iron",
    initialStatus: "draft",
    timestampMs: 200n,
  };
  const resDraft = reduceChestWorld(state0, createDraft);
  assert.equal(resDraft.decision.kind, "apply");

  // Credit key to student
  const creditKey: CreditPlayerKeyCommand = {
    kind: "credit_player_key",
    commandId: "cmd-credit-draft",
    actor: adminActor,
    studentId: studentA.studentId,
    keyTier: "tier_iron",
    count: 1,
    timestampMs: 210n,
  };
  const resKey = reduceChestWorld(resDraft.state, creditKey);

  // Student attempts exploration discovery on draft chest -> rejected
  const discCmd: RecordExplorationDiscoveryCommand = {
    kind: "record_exploration_discovery",
    commandId: "cmd-disc-draft",
    actor: studentA,
    chestId: "chest-draft-1",
    verifiedExploredTileIndices: [tileIndex(50, 50)],
    timestampMs: 220n,
  };
  const resDisc = reduceChestWorld(resKey.state, discCmd);
  assert.equal(resDisc.decision.kind, "reject");
  assert.equal(resDisc.decision.reason, "chest_not_published");

  // Student attempts to open draft chest -> rejected
  const openCmd: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-open-draft",
    actor: studentA,
    chestId: "chest-draft-1",
    keyTier: "tier_iron",
    expectedRevision: 1n,
    timestampMs: 230n,
  };
  const resOpen = reduceChestWorld(resKey.state, openCmd);
  assert.equal(resOpen.decision.kind, "reject");
  assert.equal(resOpen.decision.reason, "chest_not_published");

  // Non-admin viewer cannot project draft chest
  assert.equal(
    projectChestForViewer(
      resKey.state.chests.get("chest-draft-1")!,
      studentA,
      resKey.state,
    ),
    null,
  );

  // Admin publishes chest with expected revision 1n
  const pubCmd: PublishChestCommand = {
    kind: "publish_chest",
    commandId: "cmd-publish-1",
    actor: adminActor,
    chestId: "chest-draft-1",
    expectedRevision: 1n,
    timestampMs: 240n,
  };
  const resPub = reduceChestWorld(resKey.state, pubCmd);
  assert.equal(resPub.decision.kind, "apply");
  const pubChest = resPub.state.chests.get("chest-draft-1")!;
  assert.equal(pubChest.status, "published");
  assert.equal(pubChest.revision, 2n);
});

// --- Test 4: Per-player reveal (No universal school-wide reveal) -------------

test("per-player reveal ensures no universal school-wide chest reveal", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  // Create published chest at (300, 400)
  const createCmd: CreateChestCommand = {
    kind: "create_chest",
    commandId: "cmd-c-reveal",
    actor: adminActor,
    chestId: "chest-reveal-1",
    eventId: "event-fall-2026",
    x: 300,
    z: 400,
    keyTier: "tier_silver",
    rewardTemplateId: "tmpl_silver",
    initialStatus: "published",
    timestampMs: 300n,
  };
  const resCreate = reduceChestWorld(state0, createCmd);

  // Student A explores the chest footprint
  const discCmdA: RecordExplorationDiscoveryCommand = {
    kind: "record_exploration_discovery",
    commandId: "cmd-disc-a",
    actor: studentA,
    chestId: "chest-reveal-1",
    verifiedExploredTileIndices: [tileIndex(301, 401)],
    timestampMs: 310n,
  };
  const resDiscA = reduceChestWorld(resCreate.state, discCmdA);
  assert.equal(resDiscA.decision.kind, "apply");

  const chest = resDiscA.state.chests.get("chest-reveal-1")!;

  // 1. Student A projection includes coordinates
  const projA = projectChestForViewer(chest, studentA, resDiscA.state);
  assert.ok(projA);
  assert.equal(projA.isDiscovered, true);
  assert.equal(projA.discoverySource, "exploration");
  assert.equal(projA.x, 300);
  assert.equal(projA.z, 400);

  // 2. Student B (same school Slot 0) has NOT explored: projection is NULL!
  const projB = projectChestForViewer(chest, studentBTeammate, resDiscA.state);
  assert.equal(projB, null, "No universal school-wide reveal to teammate");

  // 3. Opponent Student C (School Slot 2): projection is NULL!
  const projC = projectChestForViewer(chest, studentCRival, resDiscA.state);
  assert.equal(projC, null, "Opponent cannot see rival hidden chest");

  // 4. getChestCoordinatesIfAuthorized filters
  assert.deepEqual(
    getChestCoordinatesIfAuthorized("chest-reveal-1", studentA, resDiscA.state),
    { x: 300, z: 400 },
  );
  assert.equal(
    getChestCoordinatesIfAuthorized(
      "chest-reveal-1",
      studentBTeammate,
      resDiscA.state,
    ),
    null,
  );
  assert.equal(
    getChestCoordinatesIfAuthorized(
      "chest-reveal-1",
      studentCRival,
      resDiscA.state,
    ),
    null,
  );
});

// --- Test 5: Private Treasure Map eligibility --------------------------------

test("private Treasure Map reveals chest to specific student only", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  const createCmd: CreateChestCommand = {
    kind: "create_chest",
    commandId: "cmd-c-map",
    actor: adminActor,
    chestId: "chest-map-1",
    eventId: "event-fall-2026",
    x: 150,
    z: 250,
    keyTier: "tier_gold",
    rewardTemplateId: "tmpl_gold",
    initialStatus: "published",
    timestampMs: 400n,
  };
  const resCreate = reduceChestWorld(state0, createCmd);

  // Grant private treasure map to Student B
  const grantMap: GrantTreasureMapCommand = {
    kind: "grant_treasure_map",
    commandId: "cmd-grant-map-b",
    actor: adminActor,
    recipientStudentId: studentBTeammate.studentId,
    recipientSchoolSlot: studentBTeammate.schoolSlot,
    chestId: "chest-map-1",
    timestampMs: 410n,
  };
  const resMap = reduceChestWorld(resCreate.state, grantMap);
  assert.equal(resMap.decision.kind, "apply");

  const chest = resMap.state.chests.get("chest-map-1")!;

  // Student B can see chest via treasure map
  const projB = projectChestForViewer(chest, studentBTeammate, resMap.state);
  assert.ok(projB);
  assert.equal(projB.isDiscovered, true);
  assert.equal(projB.discoverySource, "treasure_map");
  assert.equal(projB.x, 150);
  assert.equal(projB.z, 250);

  // Student A (same school, no map) cannot see it
  assert.equal(projectChestForViewer(chest, studentA, resMap.state), null);

  // Opponent Student C cannot see it
  assert.equal(projectChestForViewer(chest, studentCRival, resMap.state), null);
});

// --- Test 6: Matching Key Tier & Distinct Keys & Key consumed only on success -

test("matching key tier mandatory and key consumed ONLY on success", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  // Setup chest requiring opaque tier "TIER_SIGMA"
  const createCmd: CreateChestCommand = {
    kind: "create_chest",
    commandId: "cmd-c-keys",
    actor: adminActor,
    chestId: "chest-keys-1",
    eventId: "event-fall-2026",
    x: 40,
    z: 40,
    keyTier: "TIER_SIGMA",
    rewardTemplateId: "tmpl_sigma",
    initialStatus: "published",
    timestampMs: 500n,
  };
  const res1 = reduceChestWorld(state0, createCmd);

  // Discover chest for Student A
  const discCmd: RecordExplorationDiscoveryCommand = {
    kind: "record_exploration_discovery",
    commandId: "cmd-disc-keys",
    actor: studentA,
    chestId: "chest-keys-1",
    verifiedExploredTileIndices: [tileIndex(40, 40)],
    timestampMs: 510n,
  };
  const res2 = reduceChestWorld(res1.state, discCmd);

  // Credit Student A: 2 "TIER_BETA" keys, 0 "TIER_SIGMA" keys
  const creditBeta: CreditPlayerKeyCommand = {
    kind: "credit_player_key",
    commandId: "cmd-credit-beta",
    actor: adminActor,
    studentId: studentA.studentId,
    keyTier: "TIER_BETA",
    count: 2,
    timestampMs: 520n,
  };
  const res3 = reduceChestWorld(res2.state, creditBeta);

  // 1. Attempt open with wrong tier "TIER_BETA" -> rejected
  const openWrongTier: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-open-wrong",
    actor: studentA,
    chestId: "chest-keys-1",
    keyTier: "TIER_BETA",
    expectedRevision: 1n,
    timestampMs: 530n,
  };
  const resWrong = reduceChestWorld(res3.state, openWrongTier);
  assert.equal(resWrong.decision.kind, "reject");
  assert.equal(resWrong.decision.reason, "missing_or_mismatched_key");
  // KEY NOT CONSUMED: still 2 "TIER_BETA" keys
  assert.equal(
    resWrong.state.playerKeys.get(studentA.studentId)?.get("TIER_BETA"),
    2,
  );

  // 2. Attempt open with correct tier "TIER_SIGMA" but 0 balance -> rejected
  const openInsufficient: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-open-insufficient",
    actor: studentA,
    chestId: "chest-keys-1",
    keyTier: "TIER_SIGMA",
    expectedRevision: 1n,
    timestampMs: 540n,
  };
  const resInsuff = reduceChestWorld(res3.state, openInsufficient);
  assert.equal(resInsuff.decision.kind, "reject");
  assert.equal(resInsuff.decision.reason, "insufficient_keys");

  // 3. Credit 1 "TIER_SIGMA" key
  const creditSigma: CreditPlayerKeyCommand = {
    kind: "credit_player_key",
    commandId: "cmd-credit-sigma",
    actor: adminActor,
    studentId: studentA.studentId,
    keyTier: "TIER_SIGMA",
    count: 1,
    timestampMs: 550n,
  };
  const res4 = reduceChestWorld(res3.state, creditSigma);
  assert.equal(
    res4.state.playerKeys.get(studentA.studentId)?.get("TIER_SIGMA"),
    1,
  );

  // 4. Open with matching tier succeeds!
  const openSuccess: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-open-success",
    actor: studentA,
    chestId: "chest-keys-1",
    keyTier: "TIER_SIGMA",
    expectedRevision: 1n,
    timestampMs: 560n,
  };
  const resSuccess = reduceChestWorld(res4.state, openSuccess);
  assert.equal(resSuccess.decision.kind, "apply");

  // Exactly 1 "TIER_SIGMA" key consumed (now 0)
  assert.equal(
    resSuccess.state.playerKeys.get(studentA.studentId)?.get("TIER_SIGMA"),
    0,
  );
  // "TIER_BETA" keys remain completely untouched (still 2)
  assert.equal(
    resSuccess.state.playerKeys.get(studentA.studentId)?.get("TIER_BETA"),
    2,
  );
  // Pure effect: Reward obligation emitted
  assert.ok(resSuccess.effect);
  assert.equal(resSuccess.effect.recipientStudentId, studentA.studentId);
  assert.equal(resSuccess.effect.rewardTemplateId, "tmpl_sigma");
});

// --- Test 7: Open twice & Single global destruction -------------------------

test("open twice is rejected and chest is removed one time globally", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  const createCmd: CreateChestCommand = {
    kind: "create_chest",
    commandId: "cmd-c-once",
    actor: adminActor,
    chestId: "chest-once-1",
    eventId: "event-fall-2026",
    x: 60,
    z: 60,
    keyTier: "tier_gold",
    rewardTemplateId: "tmpl_gold",
    initialStatus: "published",
    timestampMs: 600n,
  };
  const res1 = reduceChestWorld(state0, createCmd);

  // Discover and credit key for Student A
  const discA: RecordExplorationDiscoveryCommand = {
    kind: "record_exploration_discovery",
    commandId: "cmd-disc-once-a",
    actor: studentA,
    chestId: "chest-once-1",
    verifiedExploredTileIndices: [tileIndex(60, 60)],
    timestampMs: 610n,
  };
  const res2 = reduceChestWorld(res1.state, discA);

  const creditA: CreditPlayerKeyCommand = {
    kind: "credit_player_key",
    commandId: "cmd-cred-once-a",
    actor: adminActor,
    studentId: studentA.studentId,
    keyTier: "tier_gold",
    count: 2,
    timestampMs: 620n,
  };
  const res3 = reduceChestWorld(res2.state, creditA);

  // First open succeeds
  const openCmd1: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-open-once-1",
    actor: studentA,
    chestId: "chest-once-1",
    keyTier: "tier_gold",
    expectedRevision: 1n,
    timestampMs: 630n,
  };
  const resOpen1 = reduceChestWorld(res3.state, openCmd1);
  assert.equal(resOpen1.decision.kind, "apply");
  assert.equal(resOpen1.state.chests.get("chest-once-1")?.status, "opened");
  assert.equal(resOpen1.state.chests.get("chest-once-1")?.revision, 2n);
  assert.equal(resOpen1.state.rewardObligations.length, 1);
  assert.equal(
    resOpen1.state.playerKeys.get(studentA.studentId)?.get("tier_gold"),
    1,
  );

  // Second open on same chest (with next revision 2n) -> rejected chest_already_opened
  const openCmd2: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-open-once-2",
    actor: studentA,
    chestId: "chest-once-1",
    keyTier: "tier_gold",
    expectedRevision: 2n,
    timestampMs: 640n,
  };
  const resOpen2 = reduceChestWorld(resOpen1.state, openCmd2);
  assert.equal(resOpen2.decision.kind, "reject");
  assert.equal(resOpen2.decision.reason, "chest_already_opened");

  // Key is NOT consumed on second attempt (still 1)
  assert.equal(
    resOpen2.state.playerKeys.get(studentA.studentId)?.get("tier_gold"),
    1,
  );
  // No second reward obligation
  assert.equal(resOpen2.state.rewardObligations.length, 1);
});

// --- Test 8: Concurrent last-chest (serialized race with revision) ------------

test("two concurrent opens processed serialized with expected revision: only first opens", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  // Setup finite single world chest at revision 1n
  const createCmd: CreateChestCommand = {
    kind: "create_chest",
    commandId: "cmd-c-race",
    actor: adminActor,
    chestId: "chest-last-1",
    eventId: "event-fall-2026",
    x: 80,
    z: 80,
    keyTier: "tier_gold",
    rewardTemplateId: "tmpl_last_prize",
    initialStatus: "published",
    timestampMs: 700n,
  };
  let curState = reduceChestWorld(state0, createCmd).state;

  // Both Student A and Student B discover chest
  curState = reduceChestWorld(curState, {
    kind: "record_exploration_discovery",
    commandId: "cmd-disc-race-a",
    actor: studentA,
    chestId: "chest-last-1",
    verifiedExploredTileIndices: [tileIndex(80, 80)],
    timestampMs: 710n,
  }).state;

  curState = reduceChestWorld(curState, {
    kind: "grant_treasure_map",
    commandId: "cmd-map-race-b",
    actor: adminActor,
    recipientStudentId: studentBTeammate.studentId,
    recipientSchoolSlot: studentBTeammate.schoolSlot,
    chestId: "chest-last-1",
    timestampMs: 720n,
  }).state;

  // Credit 1 key to each student
  curState = reduceChestWorld(curState, {
    kind: "credit_player_key",
    commandId: "cmd-cred-race-a",
    actor: adminActor,
    studentId: studentA.studentId,
    keyTier: "tier_gold",
    count: 1,
    timestampMs: 730n,
  }).state;

  curState = reduceChestWorld(curState, {
    kind: "credit_player_key",
    commandId: "cmd-cred-race-b",
    actor: adminActor,
    studentId: studentBTeammate.studentId,
    keyTier: "tier_gold",
    count: 1,
    timestampMs: 740n,
  }).state;

  // Both students concurrently prepared open commands with expectedRevision = 1n
  const cmdOpenA: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-race-a",
    actor: studentA,
    chestId: "chest-last-1",
    keyTier: "tier_gold",
    expectedRevision: 1n,
    timestampMs: 750n,
  };

  const cmdOpenB: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-race-b",
    actor: studentBTeammate,
    chestId: "chest-last-1",
    keyTier: "tier_gold",
    expectedRevision: 1n,
    timestampMs: 750n,
  };

  // Serialized execution: Student A processed first
  const resStep1 = reduceChestWorld(curState, cmdOpenA);
  assert.equal(resStep1.decision.kind, "apply");
  assert.equal(resStep1.state.chests.get("chest-last-1")?.status, "opened");
  assert.equal(resStep1.state.chests.get("chest-last-1")?.revision, 2n);
  assert.equal(
    resStep1.state.playerKeys.get(studentA.studentId)?.get("tier_gold"),
    0,
    "Student A key consumed",
  );
  assert.equal(resStep1.state.rewardObligations.length, 1);

  // Student B processed second against resulting state
  const resStep2 = reduceChestWorld(resStep1.state, cmdOpenB);
  assert.equal(resStep2.decision.kind, "reject");
  assert.equal(
    resStep2.decision.reason,
    "revision_mismatch",
    "Student B rejected due to revision mismatch against modified chest",
  );

  // Invariants: Student B retains key, no double-reward, no duplicate chest destruction
  assert.equal(
    resStep2.state.playerKeys.get(studentBTeammate.studentId)?.get("tier_gold"),
    1,
    "Student B retains key",
  );
  assert.equal(
    resStep2.state.rewardObligations.length,
    1,
    "Exactly one reward obligation globally",
  );
  assert.equal(
    resStep2.state.chests.get("chest-last-1")?.revision,
    2n,
    "Revision unchanged after rejected second attempt",
  );
});

// --- Test 9: Idempotency: replay identical vs changed payload -----------------

test("idempotent command replay returns cached decision; changed payload rejected", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  let curState = reduceChestWorld(state0, {
    kind: "create_chest",
    commandId: "c-idem-init",
    actor: adminActor,
    chestId: "ch-idem",
    eventId: "event-fall-2026",
    x: 90,
    z: 90,
    keyTier: "tier_copper",
    rewardTemplateId: "tmpl_copper",
    initialStatus: "published",
    timestampMs: 800n,
  }).state;

  curState = reduceChestWorld(curState, {
    kind: "record_exploration_discovery",
    commandId: "c-idem-disc",
    actor: studentA,
    chestId: "ch-idem",
    verifiedExploredTileIndices: [tileIndex(90, 90)],
    timestampMs: 810n,
  }).state;

  curState = reduceChestWorld(curState, {
    kind: "credit_player_key",
    commandId: "c-idem-cred",
    actor: adminActor,
    studentId: studentA.studentId,
    keyTier: "tier_copper",
    count: 2,
    timestampMs: 820n,
  }).state;

  const openCmd: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-idempotent-open",
    actor: studentA,
    chestId: "ch-idem",
    keyTier: "tier_copper",
    expectedRevision: 1n,
    timestampMs: 830n,
  };

  // First execution -> success
  const res1 = reduceChestWorld(curState, openCmd);
  assert.equal(res1.decision.kind, "apply");
  assert.equal(res1.decision.isIdempotentReplay, undefined);
  assert.equal(
    res1.state.playerKeys.get(studentA.studentId)?.get("tier_copper"),
    1,
  );
  assert.equal(res1.state.rewardObligations.length, 1);

  // 1. Replay identical command -> idempotent return, NO second debit
  const resReplay = reduceChestWorld(res1.state, openCmd);
  assert.equal(resReplay.decision.kind, "apply");
  assert.equal(resReplay.decision.isIdempotentReplay, true);
  assert.equal(
    resReplay.state.playerKeys.get(studentA.studentId)?.get("tier_copper"),
    1,
    "Key count still 1 (not decremented twice)",
  );
  assert.equal(
    resReplay.state.rewardObligations.length,
    1,
    "No second reward obligation",
  );

  // 2. Replay with SAME command ID but CHANGED payload -> rejected!
  const forgedPayloadCmd: OpenChestCommand = {
    ...openCmd,
    keyTier: "tier_gold", // changed payload
  };
  const resForged = reduceChestWorld(res1.state, forgedPayloadCmd);
  assert.equal(resForged.decision.kind, "reject");
  assert.equal(resForged.decision.reason, "idempotency_payload_mismatch");
});

// --- Test 10: Server-controlled reveal rejecting forged browser claims --------

test("server-controlled reveal rejects forged browser discovery claims", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  const curState = reduceChestWorld(state0, {
    kind: "create_chest",
    commandId: "c-forge-init",
    actor: adminActor,
    chestId: "ch-forge",
    eventId: "event-fall-2026",
    x: 500,
    z: 500,
    keyTier: "tier_gold",
    rewardTemplateId: "tmpl_gold",
    initialStatus: "published",
    timestampMs: 900n,
  }).state;

  // Student sends forged exploration claim with tiles outside chest 2x2 footprint
  const forgedDiscovery: RecordExplorationDiscoveryCommand = {
    kind: "record_exploration_discovery",
    commandId: "cmd-forge-disc",
    actor: studentA,
    chestId: "ch-forge",
    verifiedExploredTileIndices: [tileIndex(10, 10), tileIndex(20, 20)],
    timestampMs: 910n,
  };
  const res = reduceChestWorld(curState, forgedDiscovery);
  assert.equal(res.decision.kind, "reject");
  assert.equal(res.decision.reason, "unauthorized_discovery_claim");

  // Chest remains undiscovered for student
  assert.equal(
    res.state.playerDiscoveredChests.get(studentA.studentId)?.has("ch-forge"),
    undefined,
  );
  assert.equal(
    getChestCoordinatesIfAuthorized("ch-forge", studentA, res.state),
    null,
  );
});

// --- Test 11: Unauthorized actors and undiscovered open attempts --------------

test("unauthorized actors and undiscovered open attempts are rejected", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  const curState = reduceChestWorld(state0, {
    kind: "create_chest",
    commandId: "c-unauth-init",
    actor: adminActor,
    chestId: "ch-unauth",
    eventId: "event-fall-2026",
    x: 200,
    z: 200,
    keyTier: "tier_gold",
    rewardTemplateId: "tmpl_gold",
    initialStatus: "published",
    timestampMs: 1_000n,
  }).state;

  // 1. Spectator attempts open -> rejected unauthorized_student_role
  const specOpen: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-spec-open",
    actor: spectatorViewer,
    chestId: "ch-unauth",
    keyTier: "tier_gold",
    expectedRevision: 1n,
    timestampMs: 1_010n,
  };
  const resSpec = reduceChestWorld(curState, specOpen);
  assert.equal(resSpec.decision.kind, "reject");
  assert.equal(resSpec.decision.reason, "unauthorized_student_role");

  // 2. Student with key attempts open without having discovered chest -> rejected
  const stateWithKey = reduceChestWorld(curState, {
    kind: "credit_player_key",
    commandId: "cmd-cred-undisc",
    actor: adminActor,
    studentId: studentA.studentId,
    keyTier: "tier_gold",
    count: 1,
    timestampMs: 1_020n,
  }).state;

  const undiscOpen: OpenChestCommand = {
    kind: "open_chest",
    commandId: "cmd-undisc-open",
    actor: studentA,
    chestId: "ch-unauth",
    keyTier: "tier_gold",
    expectedRevision: 1n,
    timestampMs: 1_030n,
  };
  const resUndisc = reduceChestWorld(stateWithKey, undiscOpen);
  assert.equal(resUndisc.decision.kind, "reject");
  assert.equal(resUndisc.decision.reason, "chest_not_discovered");
  // Key retained
  assert.equal(
    resUndisc.state.playerKeys.get(studentA.studentId)?.get("tier_gold"),
    1,
  );
});

// --- Test 12: Privacy outputs matrix (Section 2 C-08, R4-23) -----------------

test("privacy outputs matrix denies rival opponents and spectators (C-08 & R4-23)", () => {
  const state0 = createInitialChestWorldState([defaultEventConfig]);

  // Setup chest 1 published, chest 2 draft
  let curState = reduceChestWorld(state0, {
    kind: "create_chest",
    commandId: "c-priv-1",
    actor: adminActor,
    chestId: "ch-priv-pub",
    eventId: "event-fall-2026",
    x: 400,
    z: 400,
    keyTier: "tier_gold",
    rewardTemplateId: "tmpl_gold",
    initialStatus: "published",
    timestampMs: 1_100n,
  }).state;

  curState = reduceChestWorld(curState, {
    kind: "create_chest",
    commandId: "c-priv-2",
    actor: adminActor,
    chestId: "ch-priv-draft",
    eventId: "event-fall-2026",
    x: 600,
    z: 600,
    keyTier: "tier_gold",
    rewardTemplateId: "tmpl_gold",
    initialStatus: "draft",
    timestampMs: 1_110n,
  }).state;

  // Student A discovers published chest
  curState = reduceChestWorld(curState, {
    kind: "record_exploration_discovery",
    commandId: "c-priv-disc",
    actor: studentA,
    chestId: "ch-priv-pub",
    verifiedExploredTileIndices: [tileIndex(400, 400)],
    timestampMs: 1_120n,
  }).state;

  // 1. Student A sees only the published discovered chest
  const visibleA = projectVisibleChestsForViewer(curState, studentA);
  assert.equal(visibleA.length, 1);
  assert.equal(visibleA[0]?.chestId, "ch-priv-pub");
  assert.equal(visibleA[0]?.x, 400);
  assert.equal(visibleA[0]?.z, 400);

  // 2. Teammate Student B (same school) sees 0 chests
  const visibleB = projectVisibleChestsForViewer(curState, studentBTeammate);
  assert.equal(visibleB.length, 0);

  // 3. Opponent Student C (rival school) sees 0 chests (R4-23)
  const visibleC = projectVisibleChestsForViewer(curState, studentCRival);
  assert.equal(visibleC.length, 0);

  // 4. Spectator sees 0 chests
  const visibleSpec = projectVisibleChestsForViewer(curState, spectatorViewer);
  assert.equal(visibleSpec.length, 0);

  // 5. Admin sees ALL chests, including draft
  const visibleAdmin = projectVisibleChestsForViewer(curState, adminActor);
  assert.equal(visibleAdmin.length, 2);
  const draftView = visibleAdmin.find((c) => c.chestId === "ch-priv-draft");
  assert.ok(draftView);
  assert.equal(draftView.status, "draft");
  assert.equal(draftView.x, 600);
  assert.equal(draftView.z, 600);
});
