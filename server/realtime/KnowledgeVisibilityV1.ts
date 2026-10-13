/**
 * Pure field-level authorization and projection utility for Knowledge v1 (M4-D1).
 *
 * Implements authoritative visibility filtering based on:
 * - docs/M4D0_KNOWLEDGE_RULES_V1_FREEZE_CANDIDATE_2026-10-12.md (sections D1-D5)
 * - docs/M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md (section 2)
 * - docs/VISIBILITY_POLICY_PROPOSAL.md
 *
 * Invariants:
 * 1. Never trust client-provided affiliation claims; bind exclusively to verified session.
 * 2. Sanitize and isolate errors: never leak secrets, tokens, or private coordinates in messages.
 * 3. Enforce strict allowlists: every projected output is explicitly constructed and deeply frozen.
 * 4. Separate roles strictly: content editor cannot inspect financial wallets/donor ledgers;
 *    finance admin cannot inspect unpublished draft map objects or hidden chest locations.
 * 5. School fog and discovery history remain isolated to the owning school.
 * 6. Remembered geography does NOT imply present ownership or Knowledge score (+0).
 * 7. Chest discoveries and treasure maps are per verified actor, not broadcast to school peers.
 * 8. Personal wallets, contribution rows, and refund receipts are strictly per actor.
 */

import {
  MAX_SCHOOL_SLOTS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../../shared/world/constants.ts";

// ============================================================================
// 1. Error Types and Sanitization
// ============================================================================

export type VisibilityErrorCode =
  | "UNAUTHORIZED_CLAIM"
  | "AFFILIATION_MISMATCH"
  | "FORBIDDEN_ROLE"
  | "INVALID_SESSION";

/**
 * Thrown when an untrusted client request attempts identity spoofing,
 * unauthorized affiliation claims, or forbidden data access.
 * Error messages are deliberately generic to prevent secret leakage.
 */
export class VisibilityAuthorizationError extends Error {
  readonly code: VisibilityErrorCode;

  constructor(code: VisibilityErrorCode, message: string) {
    super(message);
    this.name = "VisibilityAuthorizationError";
    this.code = code;
    Object.freeze(this);
  }
}

// ============================================================================
// 2. Verified Session & Untrusted Claim Validation
// ============================================================================

export type ViewerRole =
  | "anonymous"
  | "student"
  | "spectator"
  | "finance_admin"
  | "content_editor";

export interface AnonymousSession {
  readonly kind: "anonymous";
}

export interface StudentSession {
  readonly kind: "student";
  readonly actorId: string;
  readonly schoolSlot: number;
}

export interface SpectatorSession {
  readonly kind: "spectator";
  readonly actorId?: string;
}

export interface FinanceAdminSession {
  readonly kind: "finance_admin";
  readonly adminId: string;
}

export interface ContentEditorSession {
  readonly kind: "content_editor";
  readonly adminId: string;
}

export type ViewerSession =
  | AnonymousSession
  | StudentSession
  | SpectatorSession
  | FinanceAdminSession
  | ContentEditorSession;

export interface ClientClaims {
  readonly claimedActorId?: string;
  readonly claimedSchoolSlot?: number;
}

/**
 * Validates untrusted client-supplied claims against the server-verified session.
 * Fails closed if any claimed identity or affiliation does not match.
 */
export function validateClientClaims(
  session: ViewerSession,
  claims?: ClientClaims,
): void {
  if (!claims) return;

  if (claims.claimedActorId !== undefined) {
    if (session.kind !== "student" && session.kind !== "spectator") {
      throw new VisibilityAuthorizationError(
        "UNAUTHORIZED_CLAIM",
        "Actor claim not permitted for session type",
      );
    }
    if (
      session.kind === "student" &&
      claims.claimedActorId !== session.actorId
    ) {
      throw new VisibilityAuthorizationError(
        "UNAUTHORIZED_CLAIM",
        "Actor claim does not match verified session identity",
      );
    }
  }

  if (claims.claimedSchoolSlot !== undefined) {
    if (session.kind !== "student") {
      throw new VisibilityAuthorizationError(
        "AFFILIATION_MISMATCH",
        "School affiliation claim not permitted for session type",
      );
    }
    if (claims.claimedSchoolSlot !== session.schoolSlot) {
      throw new VisibilityAuthorizationError(
        "AFFILIATION_MISMATCH",
        "School affiliation does not match verified session enrollment",
      );
    }
  }
}

// ============================================================================
// 3. Authoritative World & Gameplay State Model (Input)
// ============================================================================

export interface WorldHQ {
  readonly schoolSlot: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly published: boolean;
}

export interface WorldLandmark {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly activeSchoolSlot: number | null;
  readonly threshold: number;
  readonly schoolPots: ReadonlyMap<number, number>;
  readonly published: boolean;
}

export interface WorldUniStop {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly published: boolean;
}

export interface DraftObject {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly z: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface WorldChest {
  readonly chestId: string;
  readonly x: number;
  readonly z: number;
  readonly tier: string;
  readonly opened: boolean;
  readonly discoveredByActorIds: ReadonlySet<string>;
}

export interface WorldGeometryState {
  readonly worldWidth?: number;
  readonly worldHeight?: number;
  readonly hqs: readonly WorldHQ[];
  readonly landmarks: readonly WorldLandmark[];
  readonly uniStops: readonly WorldUniStop[];
  readonly draftObjects?: readonly DraftObject[];
  readonly worldChests?: readonly WorldChest[];
}

export type TileOwnership =
  | { readonly kind: "neutral" }
  | { readonly kind: "solo"; readonly schoolSlot: number }
  | {
      readonly kind: "shared";
      readonly schoolSlots: readonly [number, number];
      readonly contestId: string;
    }
  | {
      readonly kind: "provisional_claim";
      readonly claimantSchoolSlot: number;
      readonly incumbentSchoolSlot: number;
      readonly caseId: string;
    };

export interface TileRecord {
  readonly tileIndex: number;
  readonly discoveredSchools: ReadonlySet<number>;
  readonly ownership: TileOwnership;
}

export interface RawContribution {
  readonly contributionId: string;
  readonly caseId: string;
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly walletId: string;
  readonly amount: number;
  readonly acceptedAtMs: bigint;
}

export interface RawRefund {
  readonly refundId: string;
  readonly caseId: string;
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly walletId: string;
  readonly amount: number;
  readonly status: "pending" | "completed";
}

export interface ContestRecord {
  readonly contestId: string;
  readonly participatingSchoolSlots: readonly [number, number];
  readonly incumbentSchoolSlot: number;
  readonly claimantSchoolSlot?: number;
  readonly tileIndices: readonly number[];
  readonly stage: "shared" | "claiming" | "success" | "failed";
  readonly t0Ms: bigint;
  readonly upkeepDueMs: bigint | null;
  readonly rollingDecayDeadlineMs: bigint | null;
  readonly hardDeadlineMs: bigint | null;
  readonly consolidation: {
    readonly requiredPoints: number;
    readonly receivedPoints: number;
    readonly contributions: readonly RawContribution[];
    readonly refundObligations: readonly RawRefund[];
  } | null;
}

export interface StudentProfile {
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly wallet: {
    readonly pointsBalance: number;
    readonly crystalsBalance: number;
  };
  readonly keys: readonly { readonly keyId: string; readonly tier: string }[];
  readonly uniStopSync: {
    readonly weeklyRunningKm: number;
    readonly weeklySyncQualified: boolean;
    readonly stationCooldowns: ReadonlyMap<string, bigint>;
  };
  readonly personalTreasureMaps: readonly {
    readonly mapId: string;
    readonly chestId: string;
    readonly coordinates: { readonly x: number; readonly z: number };
  }[];
}

export interface AuthoritativeWorldState {
  readonly geometry: WorldGeometryState;
  readonly tiles: ReadonlyMap<number, TileRecord> | readonly TileRecord[];
  readonly contests:
    | ReadonlyMap<string, ContestRecord>
    | readonly ContestRecord[];
  readonly studentProfiles?: ReadonlyMap<string, StudentProfile>;
  readonly schoolScoreTimestamps?: ReadonlyMap<number, bigint>;
}

// ============================================================================
// 4. Pure Scoring Functions (D4 / D5)
// ============================================================================

export interface SchoolScoreEntry {
  readonly rank: number;
  readonly schoolSlot: number;
  readonly score: number;
  readonly reachedAtMs: bigint;
}

/**
 * Pure calculation of Knowledge scores under canonical rules D4 & D5.
 * - Active solo owned tile yields +1 to owner school.
 * - Active shared tile yields +1 to EACH legally sharing school.
 * - Neutral / forgotten tiles yield 0.
 * - Provisional claimant yields 0 until SUCCESS (anti-gaming rule D4).
 * - Discovered fog history alone scores 0.
 * - Leaderboard tie breaking: earliest reachedAtMs ascending, then schoolSlot ascending.
 */
export function computeKnowledgeScores(
  tiles: ReadonlyMap<number, TileRecord> | readonly TileRecord[],
  schoolScoreTimestamps?: ReadonlyMap<number, bigint>,
): readonly SchoolScoreEntry[] {
  const scoreMap = new Map<number, number>();
  for (let s = 0; s < MAX_SCHOOL_SLOTS; s++) {
    scoreMap.set(s, 0);
  }

  const iterateTiles = (): Iterable<TileRecord> => {
    if (Array.isArray(tiles)) return tiles;
    return (tiles as ReadonlyMap<number, TileRecord>).values();
  };

  for (const tile of iterateTiles()) {
    const ownership = tile.ownership;
    if (ownership.kind === "solo") {
      const cur = scoreMap.get(ownership.schoolSlot) ?? 0;
      scoreMap.set(ownership.schoolSlot, cur + 1);
    } else if (ownership.kind === "shared") {
      for (const slot of ownership.schoolSlots) {
        const cur = scoreMap.get(slot) ?? 0;
        scoreMap.set(slot, cur + 1);
      }
    }
    // "provisional_claim", "neutral", and unowned fog yield 0
  }

  const entries: {
    schoolSlot: number;
    score: number;
    reachedAtMs: bigint;
  }[] = [];

  for (let s = 0; s < MAX_SCHOOL_SLOTS; s++) {
    const score = scoreMap.get(s) ?? 0;
    const reachedAtMs = schoolScoreTimestamps?.get(s) ?? 0n;
    entries.push({ schoolSlot: s, score, reachedAtMs });
  }

  // Sort descending by score, tie earliest timestamp, tie schoolSlot
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.reachedAtMs !== b.reachedAtMs) {
      return a.reachedAtMs < b.reachedAtMs ? -1 : 1;
    }
    return a.schoolSlot - b.schoolSlot;
  });

  return Object.freeze(
    entries.map((entry, index) =>
      Object.freeze({
        rank: index + 1,
        schoolSlot: entry.schoolSlot,
        score: entry.score,
        reachedAtMs: entry.reachedAtMs,
      }),
    ),
  );
}

// ============================================================================
// 5. Projected Tagged Types & Output Allowlists
// ============================================================================

export interface PublishedHQ {
  readonly schoolSlot: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
}

export interface PublishedLandmark {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly activeSchoolSlot: number | null;
  readonly threshold: number;
}

export interface PublishedUniStop {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
}

export interface PublishedGeometry {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly hqs: readonly PublishedHQ[];
  readonly landmarks: readonly PublishedLandmark[];
  readonly uniStops: readonly PublishedUniStop[];
}

export interface ScoreboardRanking {
  readonly rank: number;
  readonly schoolSlot: number;
  readonly score: number;
}

export interface AggregateScoreboard {
  readonly rankings: readonly ScoreboardRanking[];
  readonly publishedAtMs: bigint;
}

export interface PublicProjection {
  readonly kind: "public_projection";
  readonly geometry: PublishedGeometry;
  readonly scoreboard: AggregateScoreboard;
  readonly activeContestCount: number;
  readonly generatedAtMs: bigint;
}

export interface SpectatorProjection {
  readonly kind: "spectator_projection";
  readonly geometry: PublishedGeometry;
  readonly scoreboard: AggregateScoreboard;
  readonly activeContestCount: number;
  readonly landmarkBeacons: readonly {
    readonly id: string;
    readonly activeSchoolSlot: number | null;
    readonly threshold: number;
  }[];
  readonly generatedAtMs: bigint;
}

export interface StudentLandmarkView {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly activeSchoolSlot: number | null;
  readonly threshold: number;
  /** Amount accumulated exclusively by the viewer's school. Rival pots are omitted. */
  readonly ownSchoolPot: number;
}

export interface StudentKnowledgeView {
  readonly schoolSlot: number;
  readonly discoveredTileCount: number;
  readonly activeSoloTiles: readonly number[];
  readonly activeSharedTiles: readonly {
    readonly tileIndex: number;
    readonly counterpartSchoolSlot: number;
  }[];
  readonly provisionalClaimTiles: readonly number[];
  readonly rememberedNeutralTiles: readonly number[];
}

export interface StudentContestView {
  readonly contestId: string;
  readonly role: "incumbent" | "counterpart" | "claimant";
  readonly counterpartSchoolSlot: number;
  readonly stage: "shared" | "claiming" | "success" | "failed";
  readonly tileCount: number;
  readonly sharedTileIndices: readonly number[];
  readonly deadlines: {
    readonly upkeepDueMs: bigint | null;
    readonly rollingDecayDeadlineMs: bigint | null;
    readonly hardDeadlineMs: bigint | null;
  };
  readonly consolidation: {
    readonly requiredPoints: number;
    readonly receivedPoints: number;
    readonly remainingPoints: number;
  } | null;
  /** Visible strictly to the contributing actor; classmates cannot inspect. */
  readonly myContributions: readonly {
    readonly contributionId: string;
    readonly amount: number;
    readonly acceptedAtMs: bigint;
  }[];
  /** Visible strictly to the refund recipient actor. */
  readonly myRefundReceipts: readonly {
    readonly refundId: string;
    readonly amount: number;
    readonly status: "pending" | "completed";
  }[];
}

export interface StudentPersonalState {
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly wallet: {
    readonly pointsBalance: number;
    readonly crystalsBalance: number;
  };
  readonly keys: readonly { readonly keyId: string; readonly tier: string }[];
  readonly uniStop: {
    readonly weeklyRunningKm: number;
    readonly weeklySyncQualified: boolean;
    readonly stationCooldowns: readonly {
      readonly stationId: string;
      readonly readyAtMs: bigint;
    }[];
  };
  /** Chests discovered by this actor only; classmates cannot inspect. */
  readonly discoveredChests: readonly {
    readonly chestId: string;
    readonly coordinates: { readonly x: number; readonly z: number };
    readonly tier: string;
  }[];
  /** Treasure maps owned by this actor only. */
  readonly personalTreasureMaps: readonly {
    readonly mapId: string;
    readonly chestId: string;
    readonly coordinates: { readonly x: number; readonly z: number };
  }[];
}

export interface StudentProjection {
  readonly kind: "student_projection";
  readonly sessionActorId: string;
  readonly sessionSchoolSlot: number;
  readonly geometry: PublishedGeometry;
  readonly scoreboard: AggregateScoreboard;
  readonly landmarks: readonly StudentLandmarkView[];
  readonly knowledge: StudentKnowledgeView;
  readonly contests: readonly StudentContestView[];
  readonly personal: StudentPersonalState;
  readonly generatedAtMs: bigint;
}

export interface AuditCaseRecord {
  readonly contestId: string;
  readonly stage: "shared" | "claiming" | "success" | "failed";
  readonly participatingSchoolSlots: readonly [number, number];
  readonly consolidation: {
    readonly requiredPoints: number;
    readonly receivedPoints: number;
    readonly remainingPoints: number;
    readonly contributions: readonly RawContribution[];
    readonly refundObligations: readonly RawRefund[];
  } | null;
}

export interface AuditWalletRecord {
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly pointsBalance: number;
  readonly crystalsBalance: number;
}

export interface FinanceAdminProjection {
  readonly kind: "finance_admin_projection";
  readonly adminId: string;
  readonly geometry: PublishedGeometry;
  readonly scoreboard: AggregateScoreboard;
  readonly financialAudit: {
    readonly cases: readonly AuditCaseRecord[];
    readonly studentWallets: readonly AuditWalletRecord[];
  };
  readonly generatedAtMs: bigint;
}

export interface ContentEditorProjection {
  readonly kind: "content_editor_projection";
  readonly adminId: string;
  readonly geometry: PublishedGeometry;
  readonly scoreboard: AggregateScoreboard;
  readonly draftObjects: readonly DraftObject[];
  readonly worldChests: readonly {
    readonly chestId: string;
    readonly x: number;
    readonly z: number;
    readonly tier: string;
    readonly opened: boolean;
    readonly discoveryCount: number;
  }[];
  readonly generatedAtMs: bigint;
}

export type ViewerProjection =
  | PublicProjection
  | SpectatorProjection
  | StudentProjection
  | FinanceAdminProjection
  | ContentEditorProjection;

// ============================================================================
// 6. Deep Immutability Helper
// ============================================================================

function deepFreeze<T>(item: T): Readonly<T> {
  if (item === null || typeof item !== "object") {
    return item;
  }
  if (Object.isFrozen(item)) {
    return item as Readonly<T>;
  }

  if (Array.isArray(item)) {
    for (const elem of item) {
      deepFreeze(elem);
    }
  } else if (item instanceof Map || item instanceof Set) {
    // Map and Set do not need recursive freezing of keys/values for allowlists
    return Object.freeze(item) as Readonly<T>;
  } else {
    for (const key of Object.keys(item)) {
      const val = (item as Record<string, unknown>)[key];
      if (val !== null && typeof val === "object") {
        deepFreeze(val);
      }
    }
  }

  return Object.freeze(item) as Readonly<T>;
}

// ============================================================================
// 7. Projection Builder Functions
// ============================================================================

function buildPublishedGeometry(
  geometry: WorldGeometryState,
): PublishedGeometry {
  const hqs: PublishedHQ[] = geometry.hqs
    .filter((hq) => hq.published)
    .map((hq) =>
      Object.freeze({
        schoolSlot: hq.schoolSlot,
        x: hq.x,
        z: hq.z,
        width: hq.width,
        height: hq.height,
      }),
    );

  const landmarks: PublishedLandmark[] = geometry.landmarks
    .filter((l) => l.published)
    .map((l) =>
      Object.freeze({
        id: l.id,
        name: l.name,
        x: l.x,
        z: l.z,
        width: l.width,
        height: l.height,
        activeSchoolSlot: l.activeSchoolSlot,
        threshold: l.threshold,
      }),
    );

  const uniStops: PublishedUniStop[] = geometry.uniStops
    .filter((u) => u.published)
    .map((u) =>
      Object.freeze({
        id: u.id,
        name: u.name,
        x: u.x,
        z: u.z,
        width: u.width,
        height: u.height,
      }),
    );

  return Object.freeze({
    worldWidth: geometry.worldWidth ?? WORLD_WIDTH,
    worldHeight: geometry.worldHeight ?? WORLD_HEIGHT,
    hqs: Object.freeze(hqs),
    landmarks: Object.freeze(landmarks),
    uniStops: Object.freeze(uniStops),
  });
}

function countActiveContests(
  contests: ReadonlyMap<string, ContestRecord> | readonly ContestRecord[],
): number {
  let count = 0;
  const iter = Array.isArray(contests)
    ? contests
    : (contests as ReadonlyMap<string, ContestRecord>).values();
  for (const c of iter) {
    if (c.stage === "shared" || c.stage === "claiming") {
      count++;
    }
  }
  return count;
}

function getContestList(
  contests: ReadonlyMap<string, ContestRecord> | readonly ContestRecord[],
): readonly ContestRecord[] {
  if (Array.isArray(contests)) return contests;
  return Array.from((contests as ReadonlyMap<string, ContestRecord>).values());
}

function getTileList(
  tiles: ReadonlyMap<number, TileRecord> | readonly TileRecord[],
): readonly TileRecord[] {
  if (Array.isArray(tiles)) return tiles;
  return Array.from((tiles as ReadonlyMap<number, TileRecord>).values());
}

/**
 * Projects full authoritative state into a strict allowlist according to the verified session.
 */
export function projectKnowledgeState(
  session: AnonymousSession,
  world: AuthoritativeWorldState,
  options?: {
    readonly clientClaims?: ClientClaims;
    readonly nowMs?: bigint;
  },
): PublicProjection;
export function projectKnowledgeState(
  session: SpectatorSession,
  world: AuthoritativeWorldState,
  options?: {
    readonly clientClaims?: ClientClaims;
    readonly nowMs?: bigint;
  },
): SpectatorProjection;
export function projectKnowledgeState(
  session: StudentSession,
  world: AuthoritativeWorldState,
  options?: {
    readonly clientClaims?: ClientClaims;
    readonly nowMs?: bigint;
  },
): StudentProjection;
export function projectKnowledgeState(
  session: FinanceAdminSession,
  world: AuthoritativeWorldState,
  options?: {
    readonly clientClaims?: ClientClaims;
    readonly nowMs?: bigint;
  },
): FinanceAdminProjection;
export function projectKnowledgeState(
  session: ContentEditorSession,
  world: AuthoritativeWorldState,
  options?: {
    readonly clientClaims?: ClientClaims;
    readonly nowMs?: bigint;
  },
): ContentEditorProjection;
export function projectKnowledgeState(
  session: ViewerSession,
  world: AuthoritativeWorldState,
  options?: {
    readonly clientClaims?: ClientClaims;
    readonly nowMs?: bigint;
  },
): ViewerProjection;
export function projectKnowledgeState(
  session: ViewerSession,
  world: AuthoritativeWorldState,
  options?: {
    readonly clientClaims?: ClientClaims;
    readonly nowMs?: bigint;
  },
): ViewerProjection {
  // Enforce zero trust on client-supplied claims
  validateClientClaims(session, options?.clientClaims);

  const nowMs = options?.nowMs ?? 0n;
  const publishedGeo = buildPublishedGeometry(world.geometry);
  const scoredEntries = computeKnowledgeScores(
    world.tiles,
    world.schoolScoreTimestamps,
  );
  const scoreboard: AggregateScoreboard = Object.freeze({
    rankings: Object.freeze(
      scoredEntries.map((e) =>
        Object.freeze({
          rank: e.rank,
          schoolSlot: e.schoolSlot,
          score: e.score,
        }),
      ),
    ),
    publishedAtMs: nowMs,
  });

  const activeContestCount = countActiveContests(world.contests);

  switch (session.kind) {
    case "anonymous": {
      return deepFreeze<PublicProjection>({
        kind: "public_projection",
        geometry: publishedGeo,
        scoreboard,
        activeContestCount,
        generatedAtMs: nowMs,
      });
    }

    case "spectator": {
      const landmarkBeacons = world.geometry.landmarks
        .filter((l) => l.published)
        .map((l) =>
          Object.freeze({
            id: l.id,
            activeSchoolSlot: l.activeSchoolSlot,
            threshold: l.threshold,
          }),
        );

      return deepFreeze<SpectatorProjection>({
        kind: "spectator_projection",
        geometry: publishedGeo,
        scoreboard,
        activeContestCount,
        landmarkBeacons: Object.freeze(landmarkBeacons),
        generatedAtMs: nowMs,
      });
    }

    case "student": {
      const schoolSlot = session.schoolSlot;
      const actorId = session.actorId;

      // 1. Landmarks: viewer sees published landmarks PLUS own school pot only
      const landmarks: StudentLandmarkView[] = world.geometry.landmarks
        .filter((l) => l.published)
        .map((l) =>
          Object.freeze({
            id: l.id,
            name: l.name,
            x: l.x,
            z: l.z,
            width: l.width,
            height: l.height,
            activeSchoolSlot: l.activeSchoolSlot,
            threshold: l.threshold,
            ownSchoolPot: l.schoolPots.get(schoolSlot) ?? 0,
          }),
        );

      // 2. Tile knowledge: partition discovered tiles for viewer's school
      let discoveredCount = 0;
      const activeSoloTiles: number[] = [];
      const activeSharedTiles: {
        tileIndex: number;
        counterpartSchoolSlot: number;
      }[] = [];
      const provisionalClaimTiles: number[] = [];
      const rememberedNeutralTiles: number[] = [];

      for (const tile of getTileList(world.tiles)) {
        if (!tile.discoveredSchools.has(schoolSlot)) {
          // Undiscovered tile: strictly hidden from this school
          continue;
        }

        discoveredCount++;
        const own = tile.ownership;
        if (own.kind === "solo") {
          if (own.schoolSlot === schoolSlot) {
            activeSoloTiles.push(tile.tileIndex);
          } else {
            // Discovered in the past, but now solely held by another school
            rememberedNeutralTiles.push(tile.tileIndex);
          }
        } else if (own.kind === "shared") {
          if (own.schoolSlots.includes(schoolSlot as 0)) {
            const counterpart =
              own.schoolSlots[0] === schoolSlot
                ? own.schoolSlots[1]
                : own.schoolSlots[0];
            activeSharedTiles.push({
              tileIndex: tile.tileIndex,
              counterpartSchoolSlot: counterpart,
            });
          } else {
            // Discovered in the past, but shared between other schools
            rememberedNeutralTiles.push(tile.tileIndex);
          }
        } else if (own.kind === "provisional_claim") {
          if (own.claimantSchoolSlot === schoolSlot) {
            provisionalClaimTiles.push(tile.tileIndex);
          } else {
            rememberedNeutralTiles.push(tile.tileIndex);
          }
        } else {
          // Neutral tile that was discovered
          rememberedNeutralTiles.push(tile.tileIndex);
        }
      }

      const knowledge: StudentKnowledgeView = Object.freeze({
        schoolSlot,
        discoveredTileCount: discoveredCount,
        activeSoloTiles: Object.freeze(activeSoloTiles),
        activeSharedTiles: Object.freeze(activeSharedTiles),
        provisionalClaimTiles: Object.freeze(provisionalClaimTiles),
        rememberedNeutralTiles: Object.freeze(rememberedNeutralTiles),
      });

      // 3. Contests involving viewer's school only
      const studentContests: StudentContestView[] = [];
      for (const c of getContestList(world.contests)) {
        if (!c.participatingSchoolSlots.includes(schoolSlot as 0)) {
          // Rival private contest: completely excluded
          continue;
        }

        const isIncumbent = c.incumbentSchoolSlot === schoolSlot;
        const isClaimant = c.claimantSchoolSlot === schoolSlot;
        const role = isIncumbent
          ? "incumbent"
          : isClaimant
            ? "claimant"
            : "counterpart";

        const counterpartSchoolSlot =
          c.participatingSchoolSlots[0] === schoolSlot
            ? c.participatingSchoolSlots[1]
            : c.participatingSchoolSlots[0];

        let consolidation: StudentContestView["consolidation"] = null;
        let myContributions: StudentContestView["myContributions"] = [];
        let myRefundReceipts: StudentContestView["myRefundReceipts"] = [];

        if (c.consolidation) {
          consolidation = Object.freeze({
            requiredPoints: c.consolidation.requiredPoints,
            receivedPoints: c.consolidation.receivedPoints,
            remainingPoints: Math.max(
              0,
              c.consolidation.requiredPoints - c.consolidation.receivedPoints,
            ),
          });

          // Filter contributions: strictly viewer's actorId
          myContributions = Object.freeze(
            c.consolidation.contributions
              .filter((contrib) => contrib.actorId === actorId)
              .map((contrib) =>
                Object.freeze({
                  contributionId: contrib.contributionId,
                  amount: contrib.amount,
                  acceptedAtMs: contrib.acceptedAtMs,
                }),
              ),
          );

          // Filter refund obligations: strictly viewer's actorId
          myRefundReceipts = Object.freeze(
            c.consolidation.refundObligations
              .filter((ref) => ref.actorId === actorId)
              .map((ref) =>
                Object.freeze({
                  refundId: ref.refundId,
                  amount: ref.amount,
                  status: ref.status,
                }),
              ),
          );
        }

        studentContests.push(
          Object.freeze({
            contestId: c.contestId,
            role,
            counterpartSchoolSlot,
            stage: c.stage,
            tileCount: c.tileIndices.length,
            sharedTileIndices: Object.freeze([...c.tileIndices]),
            deadlines: Object.freeze({
              upkeepDueMs: c.upkeepDueMs,
              rollingDecayDeadlineMs: c.rollingDecayDeadlineMs,
              hardDeadlineMs: c.hardDeadlineMs,
            }),
            consolidation,
            myContributions,
            myRefundReceipts,
          }),
        );
      }

      // 4. Personal actor state
      const profile = world.studentProfiles?.get(actorId);

      const discoveredChests = (world.geometry.worldChests ?? [])
        .filter((chest) => chest.discoveredByActorIds.has(actorId))
        .map((chest) =>
          Object.freeze({
            chestId: chest.chestId,
            coordinates: Object.freeze({ x: chest.x, z: chest.z }),
            tier: chest.tier,
          }),
        );

      const personalTreasureMaps = (profile?.personalTreasureMaps ?? []).map(
        (map) =>
          Object.freeze({
            mapId: map.mapId,
            chestId: map.chestId,
            coordinates: Object.freeze({ ...map.coordinates }),
          }),
      );

      const stationCooldowns: { stationId: string; readyAtMs: bigint }[] = [];
      if (profile?.uniStopSync.stationCooldowns) {
        for (const [stId, readyAt] of profile.uniStopSync.stationCooldowns) {
          stationCooldowns.push(
            Object.freeze({ stationId: stId, readyAtMs: readyAt }),
          );
        }
      }

      const personal: StudentPersonalState = Object.freeze({
        actorId,
        schoolSlot,
        wallet: Object.freeze({
          pointsBalance: profile?.wallet.pointsBalance ?? 0,
          crystalsBalance: profile?.wallet.crystalsBalance ?? 0,
        }),
        keys: Object.freeze(
          (profile?.keys ?? []).map((k) => Object.freeze({ ...k })),
        ),
        uniStop: Object.freeze({
          weeklyRunningKm: profile?.uniStopSync.weeklyRunningKm ?? 0,
          weeklySyncQualified:
            profile?.uniStopSync.weeklySyncQualified ?? false,
          stationCooldowns: Object.freeze(stationCooldowns),
        }),
        discoveredChests: Object.freeze(discoveredChests),
        personalTreasureMaps: Object.freeze(personalTreasureMaps),
      });

      return deepFreeze<StudentProjection>({
        kind: "student_projection",
        sessionActorId: actorId,
        sessionSchoolSlot: schoolSlot,
        geometry: publishedGeo,
        scoreboard,
        landmarks: Object.freeze(landmarks),
        knowledge,
        contests: Object.freeze(studentContests),
        personal,
        generatedAtMs: nowMs,
      });
    }

    case "finance_admin": {
      // Finance admin sees full consolidation audit, donor ledgers and wallets.
      // Denied access to draft objects or hidden chests.
      const cases: AuditCaseRecord[] = [];
      for (const c of getContestList(world.contests)) {
        cases.push(
          Object.freeze({
            contestId: c.contestId,
            stage: c.stage,
            participatingSchoolSlots: c.participatingSchoolSlots,
            consolidation: c.consolidation
              ? Object.freeze({
                  requiredPoints: c.consolidation.requiredPoints,
                  receivedPoints: c.consolidation.receivedPoints,
                  remainingPoints: Math.max(
                    0,
                    c.consolidation.requiredPoints -
                      c.consolidation.receivedPoints,
                  ),
                  contributions: Object.freeze(
                    c.consolidation.contributions.map((cb) =>
                      Object.freeze({ ...cb }),
                    ),
                  ),
                  refundObligations: Object.freeze(
                    c.consolidation.refundObligations.map((rf) =>
                      Object.freeze({ ...rf }),
                    ),
                  ),
                })
              : null,
          }),
        );
      }

      const studentWallets: AuditWalletRecord[] = [];
      if (world.studentProfiles) {
        for (const p of world.studentProfiles.values()) {
          studentWallets.push(
            Object.freeze({
              actorId: p.actorId,
              schoolSlot: p.schoolSlot,
              pointsBalance: p.wallet.pointsBalance,
              crystalsBalance: p.wallet.crystalsBalance,
            }),
          );
        }
      }

      return deepFreeze<FinanceAdminProjection>({
        kind: "finance_admin_projection",
        adminId: session.adminId,
        geometry: publishedGeo,
        scoreboard,
        financialAudit: Object.freeze({
          cases: Object.freeze(cases),
          studentWallets: Object.freeze(studentWallets),
        }),
        generatedAtMs: nowMs,
      });
    }

    case "content_editor": {
      // Content editor sees map drafts and finite world chest placements.
      // Denied access to private money, donor lists, or student wallets.
      const draftObjects = (world.geometry.draftObjects ?? []).map((d) =>
        Object.freeze({
          id: d.id,
          type: d.type,
          x: d.x,
          z: d.z,
          metadata: Object.freeze({ ...d.metadata }),
        }),
      );

      const worldChests = (world.geometry.worldChests ?? []).map((c) =>
        Object.freeze({
          chestId: c.chestId,
          x: c.x,
          z: c.z,
          tier: c.tier,
          opened: c.opened,
          discoveryCount: c.discoveredByActorIds.size,
        }),
      );

      return deepFreeze<ContentEditorProjection>({
        kind: "content_editor_projection",
        adminId: session.adminId,
        geometry: publishedGeo,
        scoreboard,
        draftObjects: Object.freeze(draftObjects),
        worldChests: Object.freeze(worldChests),
        generatedAtMs: nowMs,
      });
    }
  }
}

// ============================================================================
// 8. Realtime Event Filtering & Projection
// ============================================================================

export type AuthoritativeEvent =
  | {
      readonly kind: "tile_explored";
      readonly tileIndex: number;
      readonly schoolSlot: number;
      readonly actorId: string;
      readonly cost: number;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "contest_stage_changed";
      readonly contestId: string;
      readonly participatingSchoolSlots: readonly [number, number];
      readonly previousStage: string;
      readonly newStage: "shared" | "claiming" | "success" | "failed";
      readonly rollingDecayDeadlineMs: bigint | null;
      readonly hardDeadlineMs: bigint | null;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "contribution_accepted";
      readonly contestId: string;
      readonly participatingSchoolSlots: readonly [number, number];
      readonly actorId: string;
      readonly schoolSlot: number;
      readonly walletId: string;
      readonly amount: number;
      readonly totalRequired: number;
      readonly totalReceived: number;
      readonly remainingPoints: number;
      readonly newRollingDecayDeadlineMs: bigint;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "refund_recorded";
      readonly refundId: string;
      readonly contestId: string;
      readonly actorId: string;
      readonly schoolSlot: number;
      readonly walletId: string;
      readonly amount: number;
      readonly status: "pending" | "completed";
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "chest_discovered";
      readonly chestId: string;
      readonly actorId: string;
      readonly coordinates: { readonly x: number; readonly z: number };
      readonly tier: string;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "landmark_beacon_switched";
      readonly landmarkId: string;
      readonly previousSchoolSlot: number | null;
      readonly newSchoolSlot: number;
      readonly newThreshold: number;
      readonly timestampMs: bigint;
    };

export type ProjectedEvent =
  | {
      readonly kind: "own_tile_explored";
      readonly tileIndex: number;
      readonly schoolSlot: number;
      readonly actorId: string;
      readonly cost: number;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "school_tile_explored";
      readonly tileIndex: number;
      readonly schoolSlot: number;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "contest_stage_changed";
      readonly contestId: string;
      readonly stage: "shared" | "claiming" | "success" | "failed";
      readonly rollingDecayDeadlineMs: bigint | null;
      readonly hardDeadlineMs: bigint | null;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "own_contribution_receipt";
      readonly contestId: string;
      readonly amount: number;
      readonly totalReceived: number;
      readonly remainingPoints: number;
      readonly newRollingDecayDeadlineMs: bigint;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "consolidation_progress";
      readonly contestId: string;
      readonly totalReceived: number;
      readonly remainingPoints: number;
      readonly newRollingDecayDeadlineMs: bigint;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "audit_contribution_accepted";
      readonly contestId: string;
      readonly actorId: string;
      readonly schoolSlot: number;
      readonly walletId: string;
      readonly amount: number;
      readonly totalReceived: number;
      readonly remainingPoints: number;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "own_refund_receipt";
      readonly refundId: string;
      readonly contestId: string;
      readonly amount: number;
      readonly status: "pending" | "completed";
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "audit_refund_recorded";
      readonly refundId: string;
      readonly contestId: string;
      readonly actorId: string;
      readonly schoolSlot: number;
      readonly walletId: string;
      readonly amount: number;
      readonly status: "pending" | "completed";
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "own_chest_discovered";
      readonly chestId: string;
      readonly coordinates: { readonly x: number; readonly z: number };
      readonly tier: string;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "editor_chest_discovered";
      readonly chestId: string;
      readonly tier: string;
      readonly timestampMs: bigint;
    }
  | {
      readonly kind: "public_beacon_switched";
      readonly landmarkId: string;
      readonly previousSchoolSlot: number | null;
      readonly newSchoolSlot: number;
      readonly newThreshold: number;
      readonly timestampMs: bigint;
    };

/**
 * Projects a realtime delta event to the safe allowlist view of the given session.
 * Returns `null` if the session is unauthorized to observe this event.
 */
export function projectKnowledgeEvent(
  session: ViewerSession,
  event: AuthoritativeEvent,
): ProjectedEvent | null {
  switch (event.kind) {
    case "tile_explored": {
      if (session.kind === "student") {
        if (session.schoolSlot !== event.schoolSlot) {
          // Rival school exploration is confidential fog
          return null;
        }
        if (session.actorId === event.actorId) {
          return deepFreeze({
            kind: "own_tile_explored",
            tileIndex: event.tileIndex,
            schoolSlot: event.schoolSlot,
            actorId: event.actorId,
            cost: event.cost,
            timestampMs: event.timestampMs,
          });
        }
        // Classmates see tile discovered, but explorer identity and cost are omitted
        return deepFreeze({
          kind: "school_tile_explored",
          tileIndex: event.tileIndex,
          schoolSlot: event.schoolSlot,
          timestampMs: event.timestampMs,
        });
      }
      return null;
    }

    case "contest_stage_changed": {
      if (session.kind === "student") {
        if (!event.participatingSchoolSlots.includes(session.schoolSlot as 0)) {
          return null;
        }
        return deepFreeze({
          kind: "contest_stage_changed",
          contestId: event.contestId,
          stage: event.newStage,
          rollingDecayDeadlineMs: event.rollingDecayDeadlineMs,
          hardDeadlineMs: event.hardDeadlineMs,
          timestampMs: event.timestampMs,
        });
      }
      if (session.kind === "finance_admin") {
        return deepFreeze({
          kind: "contest_stage_changed",
          contestId: event.contestId,
          stage: event.newStage,
          rollingDecayDeadlineMs: event.rollingDecayDeadlineMs,
          hardDeadlineMs: event.hardDeadlineMs,
          timestampMs: event.timestampMs,
        });
      }
      return null;
    }

    case "contribution_accepted": {
      if (session.kind === "student") {
        if (!event.participatingSchoolSlots.includes(session.schoolSlot as 0)) {
          return null;
        }
        if (session.actorId === event.actorId) {
          // Payer receives personal contribution receipt
          return deepFreeze({
            kind: "own_contribution_receipt",
            contestId: event.contestId,
            amount: event.amount,
            totalReceived: event.totalReceived,
            remainingPoints: event.remainingPoints,
            newRollingDecayDeadlineMs: event.newRollingDecayDeadlineMs,
            timestampMs: event.timestampMs,
          });
        }
        // Classmate sees aggregate progress only (donor identity and wallet redacted)
        return deepFreeze({
          kind: "consolidation_progress",
          contestId: event.contestId,
          totalReceived: event.totalReceived,
          remainingPoints: event.remainingPoints,
          newRollingDecayDeadlineMs: event.newRollingDecayDeadlineMs,
          timestampMs: event.timestampMs,
        });
      }

      if (session.kind === "finance_admin") {
        return deepFreeze({
          kind: "audit_contribution_accepted",
          contestId: event.contestId,
          actorId: event.actorId,
          schoolSlot: event.schoolSlot,
          walletId: event.walletId,
          amount: event.amount,
          totalReceived: event.totalReceived,
          remainingPoints: event.remainingPoints,
          timestampMs: event.timestampMs,
        });
      }

      if (session.kind === "content_editor") {
        return deepFreeze({
          kind: "consolidation_progress",
          contestId: event.contestId,
          totalReceived: event.totalReceived,
          remainingPoints: event.remainingPoints,
          newRollingDecayDeadlineMs: event.newRollingDecayDeadlineMs,
          timestampMs: event.timestampMs,
        });
      }

      return null;
    }

    case "refund_recorded": {
      if (session.kind === "student" && session.actorId === event.actorId) {
        return deepFreeze({
          kind: "own_refund_receipt",
          refundId: event.refundId,
          contestId: event.contestId,
          amount: event.amount,
          status: event.status,
          timestampMs: event.timestampMs,
        });
      }

      if (session.kind === "finance_admin") {
        return deepFreeze({
          kind: "audit_refund_recorded",
          refundId: event.refundId,
          contestId: event.contestId,
          actorId: event.actorId,
          schoolSlot: event.schoolSlot,
          walletId: event.walletId,
          amount: event.amount,
          status: event.status,
          timestampMs: event.timestampMs,
        });
      }

      return null;
    }

    case "chest_discovered": {
      if (session.kind === "student" && session.actorId === event.actorId) {
        return deepFreeze({
          kind: "own_chest_discovered",
          chestId: event.chestId,
          coordinates: event.coordinates,
          tier: event.tier,
          timestampMs: event.timestampMs,
        });
      }

      if (session.kind === "content_editor") {
        return deepFreeze({
          kind: "editor_chest_discovered",
          chestId: event.chestId,
          tier: event.tier,
          timestampMs: event.timestampMs,
        });
      }

      return null;
    }

    case "landmark_beacon_switched": {
      // Beacon color change is public knowledge
      return deepFreeze({
        kind: "public_beacon_switched",
        landmarkId: event.landmarkId,
        previousSchoolSlot: event.previousSchoolSlot,
        newSchoolSlot: event.newSchoolSlot,
        newThreshold: event.newThreshold,
        timestampMs: event.timestampMs,
      });
    }
  }
}
