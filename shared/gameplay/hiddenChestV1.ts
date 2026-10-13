/**
 * M4-D hidden chest V1 pure deterministic reducer and projection engine.
 *
 * Technical specifications:
 * - docs/M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md (Section 2 C-08, Section 6, R4-22, R4-23)
 * - Pure deterministic strict TS reducer (unwired, no db, no Colyseus, no browser globals)
 * - BTC-created finite World Chest instances with 2x2 footprint property
 * - Hidden per-player exploration or private Treasure Map eligibility (no universal school-wide reveal)
 * - Matching KEY TIER mandatory to open; key consumed ONLY on success
 * - World instance removed ONE TIME globally on successful open with reward obligation as pure effect
 * - Serialized concurrency with expected revision (first opens, second retains key, no double-reward)
 * - Command idempotency keyed by command ID with rejection of replays with changed payload
 * - Server-controlled reveal rejecting forged browser claims; fail-closed for unpublished/draft chests
 * - Hidden coordinates not returned to unauthorized players, spectators, or opponents
 * - Key tiers use supplied opaque strings; reward obligations emitted without assuming gacha/probabilities
 */

import {
  MAX_SCHOOL_SLOTS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../world/constants.ts";
import { assertTileCoordinates, tileIndex } from "../world/coordinates.ts";

// --- Constants ---------------------------------------------------------------

export const CHEST_FOOTPRINT_WIDTH = 2 as const;
export const CHEST_FOOTPRINT_HEIGHT = 2 as const;
export const CHEST_OCCUPIED_TILES_COUNT = 4 as const;

// --- Actor & Identity Types --------------------------------------------------

export type ActorRole = "admin" | "student" | "spectator";

export interface ActorIdentity {
  readonly actorId: string;
  readonly studentId: string;
  readonly schoolSlot: number;
  readonly role: ActorRole;
}

// --- Chest State & Structure -------------------------------------------------

export type ChestStatus = "draft" | "published" | "opened" | "archived";

export interface WorldChestInstance {
  readonly chestId: string;
  readonly eventId: string;
  readonly x: number;
  readonly z: number;
  readonly footprintWidth: 2;
  readonly footprintHeight: 2;
  /** Opaque tier string (e.g. "copper", "iron", "gold", "tier_alpha"). */
  readonly keyTier: string;
  /** Opaque reward template reference emitted in obligations; no live gacha. */
  readonly rewardTemplateId: string;
  readonly status: ChestStatus;
  readonly revision: bigint;
  readonly openedBy: ChestOpenRecord | null;
  readonly createdAtMs: bigint;
}

export interface ChestOpenRecord {
  readonly studentId: string;
  readonly schoolSlot: number;
  readonly openedAtMs: bigint;
  readonly commandId: string;
}

export interface EventChestConfig {
  readonly eventId: string;
  /** Maximum number of non-archived chests permitted for this event. */
  readonly stockCap: number;
}

// --- Pure Effect: Reward Obligation ------------------------------------------

export interface RewardObligation {
  readonly obligationId: string;
  readonly chestId: string;
  readonly eventId: string;
  readonly recipientStudentId: string;
  readonly recipientSchoolSlot: number;
  readonly rewardTemplateId: string;
  readonly issuedAtMs: bigint;
  readonly sourceCommandId: string;
}

// --- Idempotency -------------------------------------------------------------

export interface IdempotencyRecord {
  readonly commandId: string;
  readonly actorId: string;
  readonly payloadHash: string;
  readonly decision: ChestCommandDecision;
  readonly effect?: RewardObligation | undefined;
  readonly recordedAtMs: bigint;
}

// --- World State -------------------------------------------------------------

export interface ChestWorldState {
  readonly chests: ReadonlyMap<string, WorldChestInstance>;
  readonly eventConfigs: ReadonlyMap<string, EventChestConfig>;
  /** studentId -> keyTier -> count */
  readonly playerKeys: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** studentId -> Set<chestId> discovered through physical exploration */
  readonly playerDiscoveredChests: ReadonlyMap<string, ReadonlySet<string>>;
  /** studentId -> Set<chestId> revealed through private Treasure Map */
  readonly playerTreasureMaps: ReadonlyMap<string, ReadonlySet<string>>;
  readonly rewardObligations: readonly RewardObligation[];
  readonly idempotencyRecords: ReadonlyMap<string, IdempotencyRecord>;
}

// --- Commands ----------------------------------------------------------------

export interface CreateChestCommand {
  readonly kind: "create_chest";
  readonly commandId: string;
  readonly actor: ActorIdentity;
  readonly chestId: string;
  readonly eventId: string;
  readonly x: number;
  readonly z: number;
  readonly keyTier: string;
  readonly rewardTemplateId: string;
  readonly initialStatus: "draft" | "published";
  readonly timestampMs: bigint;
}

export interface PublishChestCommand {
  readonly kind: "publish_chest";
  readonly commandId: string;
  readonly actor: ActorIdentity;
  readonly chestId: string;
  readonly expectedRevision: bigint;
  readonly timestampMs: bigint;
}

export interface RecordExplorationDiscoveryCommand {
  readonly kind: "record_exploration_discovery";
  readonly commandId: string;
  readonly actor: ActorIdentity;
  readonly chestId: string;
  readonly verifiedExploredTileIndices: readonly number[];
  readonly timestampMs: bigint;
}

export interface GrantTreasureMapCommand {
  readonly kind: "grant_treasure_map";
  readonly commandId: string;
  readonly actor: ActorIdentity;
  readonly recipientStudentId: string;
  readonly recipientSchoolSlot: number;
  readonly chestId: string;
  readonly timestampMs: bigint;
}

export interface CreditPlayerKeyCommand {
  readonly kind: "credit_player_key";
  readonly commandId: string;
  readonly actor: ActorIdentity;
  readonly studentId: string;
  readonly keyTier: string;
  readonly count: number;
  readonly timestampMs: bigint;
}

export interface OpenChestCommand {
  readonly kind: "open_chest";
  readonly commandId: string;
  readonly actor: ActorIdentity;
  readonly chestId: string;
  readonly keyTier: string;
  readonly expectedRevision: bigint;
  readonly timestampMs: bigint;
}

export type ChestCommand =
  | CreateChestCommand
  | PublishChestCommand
  | RecordExplorationDiscoveryCommand
  | GrantTreasureMapCommand
  | CreditPlayerKeyCommand
  | OpenChestCommand;

// --- Decision & Transitions --------------------------------------------------

export type ChestRejectReason =
  | "unauthorized_admin_role"
  | "unauthorized_student_role"
  | "unauthorized_discovery_claim"
  | "chest_already_exists"
  | "chest_not_found"
  | "chest_not_published"
  | "chest_already_opened"
  | "chest_not_discovered"
  | "chest_archived"
  | "event_not_found"
  | "event_stock_cap_exceeded"
  | "placement_out_of_bounds"
  | "footprint_collision"
  | "missing_or_mismatched_key"
  | "insufficient_keys"
  | "revision_mismatch"
  | "invalid_argument"
  | "idempotency_payload_mismatch";

export type ChestCommandDecision =
  | {
      readonly kind: "apply";
      readonly commandId: string;
      readonly chestId?: string | undefined;
      readonly isIdempotentReplay?: boolean | undefined;
      readonly details?: string | undefined;
    }
  | {
      readonly kind: "reject";
      readonly commandId: string;
      readonly reason: ChestRejectReason;
      readonly isIdempotentReplay?: boolean | undefined;
      readonly details?: string | undefined;
    };

export interface ChestTransitionResult {
  readonly state: ChestWorldState;
  readonly decision: ChestCommandDecision;
  readonly effect?: RewardObligation | undefined;
}

// --- Projections (Visibility Matrix C-08 / R4-23) ----------------------------

export type DiscoverySource = "exploration" | "treasure_map" | "admin";

export interface ProjectedChestView {
  readonly chestId: string;
  readonly eventId: string;
  readonly footprintWidth: 2;
  readonly footprintHeight: 2;
  readonly status: ChestStatus;
  readonly x: number | null;
  readonly z: number | null;
  readonly keyTier: string | null;
  readonly rewardTemplateId: string | null;
  readonly isDiscovered: boolean;
  readonly discoverySource: DiscoverySource | null;
  readonly isOpened: boolean;
  readonly openedBy: {
    readonly studentId: string;
    readonly schoolSlot: number;
  } | null;
}

// --- Spatial Utilities -------------------------------------------------------

export function isValidChestPlacement(x: number, z: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(z) &&
    x >= 0 &&
    z >= 0 &&
    x + CHEST_FOOTPRINT_WIDTH <= WORLD_WIDTH &&
    z + CHEST_FOOTPRINT_HEIGHT <= WORLD_HEIGHT
  );
}

export function getChestFootprintTiles(
  x: number,
  z: number,
): readonly number[] {
  assertTileCoordinates(x, z);
  assertTileCoordinates(
    x + CHEST_FOOTPRINT_WIDTH - 1,
    z + CHEST_FOOTPRINT_HEIGHT - 1,
  );
  return [
    tileIndex(x, z),
    tileIndex(x + 1, z),
    tileIndex(x, z + 1),
    tileIndex(x + 1, z + 1),
  ];
}

export function isTileInChestFootprint(
  tileX: number,
  tileZ: number,
  chestX: number,
  chestZ: number,
): boolean {
  return (
    tileX >= chestX &&
    tileX < chestX + CHEST_FOOTPRINT_WIDTH &&
    tileZ >= chestZ &&
    tileZ < chestZ + CHEST_FOOTPRINT_HEIGHT
  );
}

export function doChestFootprintsCollide(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): boolean {
  const noOverlapX =
    x1 + CHEST_FOOTPRINT_WIDTH <= x2 || x2 + CHEST_FOOTPRINT_WIDTH <= x1;
  const noOverlapZ =
    z1 + CHEST_FOOTPRINT_HEIGHT <= z2 || z2 + CHEST_FOOTPRINT_HEIGHT <= z1;
  return !noOverlapX && !noOverlapZ;
}

// --- Serialization & Canonical Hashing ---------------------------------------

export function canonicalPayloadString(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") {
      return `"${value.toString()}n"`;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalPayloadString).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const pairs = sortedKeys.map(
    (k) => `${JSON.stringify(k)}:${canonicalPayloadString(obj[k])}`,
  );
  return `{${pairs.join(",")}}`;
}

// --- Initial State Factory ---------------------------------------------------

export function createInitialChestWorldState(
  eventConfigs?: Iterable<EventChestConfig>,
): ChestWorldState {
  const configsMap = new Map<string, EventChestConfig>();
  if (eventConfigs) {
    for (const cfg of eventConfigs) {
      configsMap.set(cfg.eventId, cfg);
    }
  }
  return {
    chests: new Map(),
    eventConfigs: configsMap,
    playerKeys: new Map(),
    playerDiscoveredChests: new Map(),
    playerTreasureMaps: new Map(),
    rewardObligations: [],
    idempotencyRecords: new Map(),
  };
}

// --- Pure Deterministic Reducer ----------------------------------------------

export function reduceChestWorld(
  state: ChestWorldState,
  command: ChestCommand,
): ChestTransitionResult {
  const currentPayloadHash = canonicalPayloadString(command);

  // 1. Idempotency inspection
  const existing = state.idempotencyRecords.get(command.commandId);
  if (existing !== undefined) {
    if (existing.payloadHash !== currentPayloadHash) {
      return {
        state,
        decision: {
          kind: "reject",
          commandId: command.commandId,
          reason: "idempotency_payload_mismatch",
          details: "Replayed command with modified payload",
        },
      };
    }
    return {
      state,
      decision: {
        ...existing.decision,
        isIdempotentReplay: true,
      },
      ...(existing.effect !== undefined ? { effect: existing.effect } : {}),
    };
  }

  // Helper to record idempotency outcome in state
  const recordAndReturn = (
    nextState: ChestWorldState,
    decision: ChestCommandDecision,
    effect?: RewardObligation | undefined,
  ): ChestTransitionResult => {
    const record: IdempotencyRecord = {
      commandId: command.commandId,
      actorId: command.actor.actorId,
      payloadHash: currentPayloadHash,
      decision,
      ...(effect !== undefined ? { effect } : {}),
      recordedAtMs: command.timestampMs,
    };
    const nextRecords = new Map(nextState.idempotencyRecords);
    nextRecords.set(command.commandId, record);
    return {
      state: {
        ...nextState,
        idempotencyRecords: nextRecords,
      },
      decision,
      ...(effect !== undefined ? { effect } : {}),
    };
  };

  // 2. Command dispatch
  switch (command.kind) {
    case "create_chest": {
      if (command.actor.role !== "admin") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "unauthorized_admin_role",
          details: "Only admin/BTC can create world chests",
        });
      }
      if (state.chests.has(command.chestId)) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_already_exists",
          details: `Chest ${command.chestId} already exists`,
        });
      }
      if (!isValidChestPlacement(command.x, command.z)) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "placement_out_of_bounds",
          details: `Chest placement (${command.x}, ${command.z}) is out of world bounds`,
        });
      }
      for (const existingChest of state.chests.values()) {
        if (existingChest.status === "archived") continue;
        if (
          doChestFootprintsCollide(
            command.x,
            command.z,
            existingChest.x,
            existingChest.z,
          )
        ) {
          return recordAndReturn(state, {
            kind: "reject",
            commandId: command.commandId,
            reason: "footprint_collision",
            details: `Collision with existing chest ${existingChest.chestId}`,
          });
        }
      }
      const eventConfig = state.eventConfigs.get(command.eventId);
      if (!eventConfig) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "event_not_found",
          details: `Event ${command.eventId} configuration not registered`,
        });
      }
      let currentEventChestCount = 0;
      for (const c of state.chests.values()) {
        if (c.eventId === command.eventId && c.status !== "archived") {
          currentEventChestCount++;
        }
      }
      if (currentEventChestCount >= eventConfig.stockCap) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "event_stock_cap_exceeded",
          details: `Event ${command.eventId} stock cap ${eventConfig.stockCap} reached`,
        });
      }

      const newChest: WorldChestInstance = {
        chestId: command.chestId,
        eventId: command.eventId,
        x: command.x,
        z: command.z,
        footprintWidth: CHEST_FOOTPRINT_WIDTH,
        footprintHeight: CHEST_FOOTPRINT_HEIGHT,
        keyTier: command.keyTier,
        rewardTemplateId: command.rewardTemplateId,
        status: command.initialStatus,
        revision: 1n,
        openedBy: null,
        createdAtMs: command.timestampMs,
      };

      const nextChests = new Map(state.chests);
      nextChests.set(command.chestId, newChest);
      return recordAndReturn(
        { ...state, chests: nextChests },
        {
          kind: "apply",
          commandId: command.commandId,
          chestId: command.chestId,
        },
      );
    }

    case "publish_chest": {
      if (command.actor.role !== "admin") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "unauthorized_admin_role",
          details: "Only admin can publish chests",
        });
      }
      const chest = state.chests.get(command.chestId);
      if (!chest) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_not_found",
        });
      }
      if (chest.revision !== command.expectedRevision) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "revision_mismatch",
          details: `Expected revision ${command.expectedRevision} but found ${chest.revision}`,
        });
      }
      if (chest.status === "opened") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_already_opened",
        });
      }
      if (chest.status === "archived") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_archived",
        });
      }
      if (chest.status === "published") {
        return recordAndReturn(state, {
          kind: "apply",
          commandId: command.commandId,
          chestId: chest.chestId,
          details: "Chest is already published",
        });
      }

      const publishedChest: WorldChestInstance = {
        ...chest,
        status: "published",
        revision: chest.revision + 1n,
      };
      const nextChests = new Map(state.chests);
      nextChests.set(chest.chestId, publishedChest);
      return recordAndReturn(
        { ...state, chests: nextChests },
        {
          kind: "apply",
          commandId: command.commandId,
          chestId: chest.chestId,
        },
      );
    }

    case "record_exploration_discovery": {
      if (command.actor.role !== "student" && command.actor.role !== "admin") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "unauthorized_student_role",
        });
      }
      const chest = state.chests.get(command.chestId);
      if (!chest) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_not_found",
        });
      }
      if (chest.status !== "published" && chest.status !== "opened") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_not_published",
          details:
            "Draft or unpublished chests cannot be discovered via exploration",
        });
      }

      // Server-controlled reveal validation against verified explored tile indices
      const footprintTiles = getChestFootprintTiles(chest.x, chest.z);
      const intersects = footprintTiles.some((t) =>
        command.verifiedExploredTileIndices.includes(t),
      );
      if (!intersects) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "unauthorized_discovery_claim",
          details: "No verified explored tiles intersect chest 2x2 footprint",
        });
      }

      // Record discovery strictly for the individual student (no school-wide reveal)
      const nextDiscoveries = new Map(state.playerDiscoveredChests);
      const currentSet =
        nextDiscoveries.get(command.actor.studentId) ?? new Set<string>();
      const nextSet = new Set(currentSet);
      nextSet.add(chest.chestId);
      nextDiscoveries.set(command.actor.studentId, nextSet);

      return recordAndReturn(
        { ...state, playerDiscoveredChests: nextDiscoveries },
        {
          kind: "apply",
          commandId: command.commandId,
          chestId: chest.chestId,
        },
      );
    }

    case "grant_treasure_map": {
      if (command.actor.role !== "admin") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "unauthorized_admin_role",
          details: "Only admin/UniStop authority can grant treasure maps",
        });
      }
      const chest = state.chests.get(command.chestId);
      if (!chest) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_not_found",
        });
      }
      if (chest.status !== "published" && chest.status !== "opened") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_not_published",
          details: "Cannot grant map for unpublished chest",
        });
      }

      const nextMaps = new Map(state.playerTreasureMaps);
      const currentSet =
        nextMaps.get(command.recipientStudentId) ?? new Set<string>();
      const nextSet = new Set(currentSet);
      nextSet.add(chest.chestId);
      nextMaps.set(command.recipientStudentId, nextSet);

      return recordAndReturn(
        { ...state, playerTreasureMaps: nextMaps },
        {
          kind: "apply",
          commandId: command.commandId,
          chestId: chest.chestId,
        },
      );
    }

    case "credit_player_key": {
      if (command.actor.role !== "admin") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "unauthorized_admin_role",
        });
      }
      if (!Number.isInteger(command.count) || command.count <= 0) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "invalid_argument",
          details: "Key count must be positive integer",
        });
      }

      const nextPlayerKeys = new Map(state.playerKeys);
      const currentTierMap =
        nextPlayerKeys.get(command.studentId) ?? new Map<string, number>();
      const nextTierMap = new Map(currentTierMap);
      const currentCount = nextTierMap.get(command.keyTier) ?? 0;
      nextTierMap.set(command.keyTier, currentCount + command.count);
      nextPlayerKeys.set(command.studentId, nextTierMap);

      return recordAndReturn(
        { ...state, playerKeys: nextPlayerKeys },
        {
          kind: "apply",
          commandId: command.commandId,
        },
      );
    }

    case "open_chest": {
      if (command.actor.role !== "student") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "unauthorized_student_role",
          details: "Only authenticated students can open chests",
        });
      }
      if (
        !Number.isInteger(command.actor.schoolSlot) ||
        command.actor.schoolSlot < 0 ||
        command.actor.schoolSlot >= MAX_SCHOOL_SLOTS
      ) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "invalid_argument",
          details: "Invalid school slot",
        });
      }

      const chest = state.chests.get(command.chestId);
      if (!chest) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_not_found",
        });
      }

      // Fail-closed for draft
      if (chest.status === "draft") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_not_published",
          details: "Chest is in draft status",
        });
      }

      // Serialized revision check
      if (chest.revision !== command.expectedRevision) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "revision_mismatch",
          details: `Expected revision ${command.expectedRevision} but found ${chest.revision}`,
        });
      }

      if (chest.status === "opened") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_already_opened",
          details: "Chest already opened",
        });
      }

      if (chest.status !== "published") {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_not_published",
        });
      }

      // Discovery eligibility check (personal exploration or private treasure map)
      const hasExplored =
        state.playerDiscoveredChests
          .get(command.actor.studentId)
          ?.has(chest.chestId) ?? false;
      const hasMap =
        state.playerTreasureMaps
          .get(command.actor.studentId)
          ?.has(chest.chestId) ?? false;

      if (!hasExplored && !hasMap) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "chest_not_discovered",
          details: "Student has not discovered chest and has no treasure map",
        });
      }

      // Key tier match check
      if (command.keyTier !== chest.keyTier) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "missing_or_mismatched_key",
          details: `Supplied key tier ${command.keyTier} does not match required ${chest.keyTier}`,
        });
      }

      // Inventory check
      const studentKeys = state.playerKeys.get(command.actor.studentId);
      const currentKeyCount = studentKeys?.get(chest.keyTier) ?? 0;
      if (currentKeyCount < 1) {
        return recordAndReturn(state, {
          kind: "reject",
          commandId: command.commandId,
          reason: "insufficient_keys",
          details: `Player has 0 keys of tier ${chest.keyTier}`,
        });
      }

      // === SUCCESSFUL OPEN: ALL INVARIANTS SATISFIED ===
      // 1. World instance removed ONE TIME globally (status => opened, revision incremented)
      const openedChest: WorldChestInstance = {
        ...chest,
        status: "opened",
        revision: chest.revision + 1n,
        openedBy: {
          studentId: command.actor.studentId,
          schoolSlot: command.actor.schoolSlot,
          openedAtMs: command.timestampMs,
          commandId: command.commandId,
        },
      };
      const nextChests = new Map(state.chests);
      nextChests.set(chest.chestId, openedChest);

      // 2. Consume matching key ONLY on success
      const nextPlayerKeys = new Map(state.playerKeys);
      const nextTierMap = new Map(studentKeys ?? new Map<string, number>());
      nextTierMap.set(chest.keyTier, currentKeyCount - 1);
      nextPlayerKeys.set(command.actor.studentId, nextTierMap);

      // 3. Emit reward obligation as pure effect (no actual live stock/gacha)
      const obligation: RewardObligation = {
        obligationId: `obligation:${chest.chestId}:${command.commandId}`,
        chestId: chest.chestId,
        eventId: chest.eventId,
        recipientStudentId: command.actor.studentId,
        recipientSchoolSlot: command.actor.schoolSlot,
        rewardTemplateId: chest.rewardTemplateId,
        issuedAtMs: command.timestampMs,
        sourceCommandId: command.commandId,
      };
      const nextObligations = [...state.rewardObligations, obligation];

      return recordAndReturn(
        {
          ...state,
          chests: nextChests,
          playerKeys: nextPlayerKeys,
          rewardObligations: nextObligations,
        },
        {
          kind: "apply",
          commandId: command.commandId,
          chestId: chest.chestId,
        },
        obligation,
      );
    }
  }
}

export function evaluateOpenChest(
  state: ChestWorldState,
  command: OpenChestCommand,
): ChestTransitionResult {
  return reduceChestWorld(state, command);
}

// --- Projections & Visibility Filters (Section 2 C-08, R4-23) -----------------

export function projectChestForViewer(
  chest: WorldChestInstance,
  viewer: ActorIdentity,
  state: ChestWorldState,
): ProjectedChestView | null {
  // Admin role: full authorized visibility for editor and audit
  if (viewer.role === "admin") {
    return {
      chestId: chest.chestId,
      eventId: chest.eventId,
      footprintWidth: CHEST_FOOTPRINT_WIDTH,
      footprintHeight: CHEST_FOOTPRINT_HEIGHT,
      status: chest.status,
      x: chest.x,
      z: chest.z,
      keyTier: chest.keyTier,
      rewardTemplateId: chest.rewardTemplateId,
      isDiscovered: true,
      discoverySource: "admin",
      isOpened: chest.status === "opened",
      openedBy: chest.openedBy
        ? {
            studentId: chest.openedBy.studentId,
            schoolSlot: chest.openedBy.schoolSlot,
          }
        : null,
    };
  }

  // Spectator: C-08 matrix: Hidden
  if (viewer.role === "spectator") {
    return null;
  }

  // Fail-closed for draft or archived chests
  if (chest.status === "draft" || chest.status === "archived") {
    return null;
  }

  // Student: Check per-player discovery (no school-wide reveal)
  const hasExplored =
    state.playerDiscoveredChests.get(viewer.studentId)?.has(chest.chestId) ??
    false;
  const hasMap =
    state.playerTreasureMaps.get(viewer.studentId)?.has(chest.chestId) ?? false;

  if (!hasExplored && !hasMap) {
    // Hidden coordinate not returned to unauthorized player or rival!
    return null;
  }

  return {
    chestId: chest.chestId,
    eventId: chest.eventId,
    footprintWidth: CHEST_FOOTPRINT_WIDTH,
    footprintHeight: CHEST_FOOTPRINT_HEIGHT,
    status: chest.status,
    x: chest.x,
    z: chest.z,
    keyTier: chest.keyTier,
    rewardTemplateId: chest.rewardTemplateId,
    isDiscovered: true,
    discoverySource: hasMap ? "treasure_map" : "exploration",
    isOpened: chest.status === "opened",
    openedBy: chest.openedBy
      ? {
          studentId: chest.openedBy.studentId,
          schoolSlot: chest.openedBy.schoolSlot,
        }
      : null,
  };
}

export function projectVisibleChestsForViewer(
  state: ChestWorldState,
  viewer: ActorIdentity,
): readonly ProjectedChestView[] {
  const result: ProjectedChestView[] = [];
  for (const chest of state.chests.values()) {
    const projected = projectChestForViewer(chest, viewer, state);
    if (projected !== null) {
      result.push(projected);
    }
  }
  return result;
}

export function getChestCoordinatesIfAuthorized(
  chestId: string,
  viewer: ActorIdentity,
  state: ChestWorldState,
): { readonly x: number; readonly z: number } | null {
  const chest = state.chests.get(chestId);
  if (!chest) return null;
  const projection = projectChestForViewer(chest, viewer, state);
  if (!projection || projection.x === null || projection.z === null) {
    return null;
  }
  return { x: projection.x, z: projection.z };
}
