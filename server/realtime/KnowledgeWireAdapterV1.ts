/**
 * KnowledgeWireAdapterV1 - Server-Authoritative Realtime & Event Projection Adapter.
 *
 * Implements M4-D2 development-only wire projection and event distribution according to:
 * - docs/M4D0_KNOWLEDGE_RULES_V1_FREEZE_CANDIDATE_2026-10-12.md (sections C08, D1-D5)
 * - server/realtime/KnowledgeVisibilityV1.ts (pure allowlists and projections)
 * - shared/gameplay/knowledgeRulesV1.ts (pure transition semantics)
 *
 * Invariants & Seams:
 * 1. Server-authoritative inputs only: snapshots and verified ViewerSession.
 * 2. Zero-trust client claims: client-supplied actor/school claims are validated
 *    against verified session and fail closed with sanitized error messages.
 * 3. Field-level allowlists: reuses projectKnowledgeState and projectKnowledgeEvent
 *    from KnowledgeVisibilityV1 instead of leaking internal DB/case rows.
 * 4. Confidentiality guarantees:
 *    - Anonymous/spectator/rival never receive payer IDs, wallet balances, escrow/refund
 *      rows, unpublished chest coordinates, or rival fog/history.
 *    - Contributing actor receives personal receipts (own_contribution_receipt, own_refund_receipt).
 *    - Counterpart receives aggregate contest progress (consolidation_progress) only.
 * 5. Reconnect & resync consistency: reconnect snapshots and outbox deltas enforce the
 *    exact same privacy boundary.
 * 6. Revision idempotency: outbox deduplication, replay safety, and stale event dropping.
 * 7. Gap detection: out-of-order or skipped revisions trigger an immediate resync snapshot.
 * 8. Future Adapter Seam: defines explicit serializable server event contracts for
 *    Codex PostgreSQL outbox integration without altering production runtime or inventing DB columns.
 */

import type {
  KnowledgeEffect,
  KnowledgeTransition,
} from "../../shared/gameplay/knowledgeRulesV1.ts";
import {
  type AuthoritativeEvent,
  type AuthoritativeWorldState,
  type ClientClaims,
  type ProjectedEvent,
  projectKnowledgeEvent,
  projectKnowledgeState,
  type ViewerProjection,
  type ViewerSession,
  VisibilityAuthorizationError,
  validateClientClaims,
} from "./KnowledgeVisibilityV1.ts";

// ============================================================================
// 1. Serializable Server Event Contract & Future Adapter Seam
// ============================================================================

/**
 * Explicit serializable server event contract for authoritative events emitted by
 * database outbox tables, transactional state transitions, or rule processors.
 *
 * FUTURE ADAPTER SEAM (Codex PostgreSQL Integration):
 * Codex is developing authoritative PostgreSQL persistence for Case V1 and outbox_events.
 * When Codex finalizes the PostgreSQL schema and case table types:
 * - Ingest the raw JSONB outbox payload into `SerializableKnowledgeOutboxEnvelope`.
 * - Pass it to `adapter.ingestOutboxEnvelope(envelope)` or `adapter.publishAuthoritativeEvent(...)`.
 * - This seam decouples realtime client projection from Codex's internal database column layout.
 */
export type SerializableAuthoritativeEvent =
  | {
      readonly kind: "tile_explored";
      readonly tileIndex: number;
      readonly schoolSlot: number;
      readonly actorId: string;
      readonly cost: number;
      readonly timestampMs: string | bigint | number;
    }
  | {
      readonly kind: "contest_stage_changed";
      readonly contestId: string;
      readonly participatingSchoolSlots: readonly [number, number];
      readonly previousStage: string;
      readonly newStage: "shared" | "claiming" | "success" | "failed";
      readonly rollingDecayDeadlineMs: string | bigint | number | null;
      readonly hardDeadlineMs: string | bigint | number | null;
      readonly timestampMs: string | bigint | number;
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
      readonly newRollingDecayDeadlineMs: string | bigint | number;
      readonly timestampMs: string | bigint | number;
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
      readonly timestampMs: string | bigint | number;
    }
  | {
      readonly kind: "chest_discovered";
      readonly chestId: string;
      readonly actorId: string;
      readonly coordinates: { readonly x: number; readonly z: number };
      readonly tier: string;
      readonly timestampMs: string | bigint | number;
    }
  | {
      readonly kind: "landmark_beacon_switched";
      readonly landmarkId: string;
      readonly previousSchoolSlot: number | null;
      readonly newSchoolSlot: number;
      readonly newThreshold: number;
      readonly timestampMs: string | bigint | number;
    };

/**
 * Standard envelope for serialized outbox rows arriving from persistence.
 */
export interface SerializableKnowledgeOutboxEnvelope {
  readonly outboxId: string;
  readonly campaignId?: string;
  readonly revision: string | bigint | number;
  readonly event: SerializableAuthoritativeEvent;
  readonly committedAtMs?: string | bigint | number;
}

function toBigInt(val: string | bigint | number): bigint {
  if (typeof val === "bigint") return val;
  if (typeof val === "number") return BigInt(Math.floor(val));
  return BigInt(val);
}

function toNullableBigInt(
  val: string | bigint | number | null | undefined,
): bigint | null {
  if (val === null || val === undefined) return null;
  return toBigInt(val);
}

/**
 * Pure adapter converting serializable event contract to AuthoritativeEvent.
 */
export function adaptSerializableToAuthoritativeEvent(
  event: SerializableAuthoritativeEvent,
): AuthoritativeEvent {
  switch (event.kind) {
    case "tile_explored":
      return Object.freeze({
        kind: "tile_explored",
        tileIndex: event.tileIndex,
        schoolSlot: event.schoolSlot,
        actorId: event.actorId,
        cost: event.cost,
        timestampMs: toBigInt(event.timestampMs),
      });

    case "contest_stage_changed":
      return Object.freeze({
        kind: "contest_stage_changed",
        contestId: event.contestId,
        participatingSchoolSlots: event.participatingSchoolSlots,
        previousStage: event.previousStage,
        newStage: event.newStage,
        rollingDecayDeadlineMs: toNullableBigInt(event.rollingDecayDeadlineMs),
        hardDeadlineMs: toNullableBigInt(event.hardDeadlineMs),
        timestampMs: toBigInt(event.timestampMs),
      });

    case "contribution_accepted":
      return Object.freeze({
        kind: "contribution_accepted",
        contestId: event.contestId,
        participatingSchoolSlots: event.participatingSchoolSlots,
        actorId: event.actorId,
        schoolSlot: event.schoolSlot,
        walletId: event.walletId,
        amount: event.amount,
        totalRequired: event.totalRequired,
        totalReceived: event.totalReceived,
        remainingPoints: event.remainingPoints,
        newRollingDecayDeadlineMs: toBigInt(event.newRollingDecayDeadlineMs),
        timestampMs: toBigInt(event.timestampMs),
      });

    case "refund_recorded":
      return Object.freeze({
        kind: "refund_recorded",
        refundId: event.refundId,
        contestId: event.contestId,
        actorId: event.actorId,
        schoolSlot: event.schoolSlot,
        walletId: event.walletId,
        amount: event.amount,
        status: event.status,
        timestampMs: toBigInt(event.timestampMs),
      });

    case "chest_discovered":
      return Object.freeze({
        kind: "chest_discovered",
        chestId: event.chestId,
        actorId: event.actorId,
        coordinates: Object.freeze({ ...event.coordinates }),
        tier: event.tier,
        timestampMs: toBigInt(event.timestampMs),
      });

    case "landmark_beacon_switched":
      return Object.freeze({
        kind: "landmark_beacon_switched",
        landmarkId: event.landmarkId,
        previousSchoolSlot: event.previousSchoolSlot,
        newSchoolSlot: event.newSchoolSlot,
        newThreshold: event.newThreshold,
        timestampMs: toBigInt(event.timestampMs),
      });
  }
}

/**
 * Future Seam: Converts pure KnowledgeTransition effects from shared/gameplay/knowledgeRulesV1.ts
 * into AuthoritativeEvent models for wire dispatch.
 */
export function adaptKnowledgeTransitionToEvents(
  transition: KnowledgeTransition,
  context: {
    readonly contestId: string;
    readonly participatingSchoolSlots: readonly [number, number];
    readonly timestampMs: bigint;
  },
): readonly AuthoritativeEvent[] {
  const events: AuthoritativeEvent[] = [];
  const state = transition.state;

  if (state.phase === "claiming") {
    if (transition.reason === "claim_opened") {
      events.push(
        Object.freeze({
          kind: "contest_stage_changed",
          contestId: context.contestId,
          participatingSchoolSlots: context.participatingSchoolSlots,
          previousStage: "shared",
          newStage: "claiming",
          rollingDecayDeadlineMs: state.rollingDeadlineMs,
          hardDeadlineMs: state.hardDeadlineMs,
          timestampMs: context.timestampMs,
        }),
      );
    } else if (transition.reason === "contribution_accepted") {
      const debitEffect = transition.effects.find(
        (e): e is Extract<KnowledgeEffect, { kind: "debit_obligation" }> =>
          e.kind === "debit_obligation",
      );
      if (debitEffect) {
        const c = debitEffect.contribution;
        events.push(
          Object.freeze({
            kind: "contribution_accepted",
            contestId: context.contestId,
            participatingSchoolSlots: context.participatingSchoolSlots,
            actorId: c.actorId,
            schoolSlot: c.schoolSlot,
            walletId: c.walletId,
            amount: Number(c.acceptedPoints),
            totalRequired: Number(state.requiredPoints),
            totalReceived: Number(state.receivedPoints),
            remainingPoints: Math.max(
              0,
              Number(state.requiredPoints - state.receivedPoints),
            ),
            newRollingDecayDeadlineMs: state.rollingDeadlineMs,
            timestampMs: context.timestampMs,
          }),
        );
      }
    }
  } else if (state.phase === "success") {
    const debitEffect = transition.effects.find(
      (e): e is Extract<KnowledgeEffect, { kind: "debit_obligation" }> =>
        e.kind === "debit_obligation",
    );
    if (debitEffect) {
      const c = debitEffect.contribution;
      events.push(
        Object.freeze({
          kind: "contribution_accepted",
          contestId: context.contestId,
          participatingSchoolSlots: context.participatingSchoolSlots,
          actorId: c.actorId,
          schoolSlot: c.schoolSlot,
          walletId: c.walletId,
          amount: Number(c.acceptedPoints),
          totalRequired: Number(state.requiredPoints),
          totalReceived: Number(state.receivedPoints),
          remainingPoints: 0,
          newRollingDecayDeadlineMs: state.rollingDeadlineMs,
          timestampMs: context.timestampMs,
        }),
      );
    }
    events.push(
      Object.freeze({
        kind: "contest_stage_changed",
        contestId: context.contestId,
        participatingSchoolSlots: context.participatingSchoolSlots,
        previousStage: "claiming",
        newStage: "success",
        rollingDecayDeadlineMs: null,
        hardDeadlineMs: null,
        timestampMs: context.timestampMs,
      }),
    );
  } else if (state.phase === "failure") {
    events.push(
      Object.freeze({
        kind: "contest_stage_changed",
        contestId: context.contestId,
        participatingSchoolSlots: context.participatingSchoolSlots,
        previousStage: "claiming",
        newStage: "failed",
        rollingDecayDeadlineMs: null,
        hardDeadlineMs: null,
        timestampMs: context.timestampMs,
      }),
    );
    for (const effect of transition.effects) {
      if (effect.kind === "refund_obligation") {
        events.push(
          Object.freeze({
            kind: "refund_recorded",
            refundId: `ref-${effect.contributionId}`,
            contestId: context.contestId,
            actorId: effect.actorId,
            schoolSlot: context.participatingSchoolSlots[0],
            walletId: effect.walletId,
            amount: Number(effect.points),
            status: "pending",
            timestampMs: context.timestampMs,
          }),
        );
      }
    }
  }

  return Object.freeze(events);
}

// ============================================================================
// 2. Wire Messages & Framing
// ============================================================================

export interface WireKnowledgeSnapshotMessage {
  readonly kind: "snapshot";
  readonly revision: string;
  readonly generatedAtMs: string;
  readonly projection: ViewerProjection;
}

export interface WireKnowledgeDeltaMessage {
  readonly kind: "delta";
  readonly revision: string;
  readonly timestampMs: string;
  readonly event: ProjectedEvent;
}

export interface WireKnowledgeAckMessage {
  readonly kind: "ack";
  readonly ackId: string;
  readonly status: "applied" | "rejected" | "no_change";
  readonly revision: string;
  readonly reason?: string;
}

export interface WireKnowledgeErrorMessage {
  readonly kind: "error";
  readonly code: string;
  readonly message: string;
}

export interface WireKnowledgeResyncMessage {
  readonly kind: "resync_required";
  readonly reason: "gap_detected" | "client_resync" | "session_switched";
  readonly expectedRevision: string;
  readonly currentRevision: string;
}

export type WireKnowledgeMessage =
  | WireKnowledgeSnapshotMessage
  | WireKnowledgeDeltaMessage
  | WireKnowledgeAckMessage
  | WireKnowledgeErrorMessage
  | WireKnowledgeResyncMessage;

/**
 * Outbound transport sink for a connected client session.
 */
export interface KnowledgeWireSink {
  send(message: WireKnowledgeMessage): void | Promise<void>;
  close?(reason: string): void;
}

/**
 * In-memory sink for testing and headless verification.
 */
export class InMemoryKnowledgeWireSink implements KnowledgeWireSink {
  readonly #messages: WireKnowledgeMessage[] = [];
  #closed = false;
  #closeReason?: string;

  get messages(): readonly WireKnowledgeMessage[] {
    return this.#messages;
  }

  get closed(): boolean {
    return this.#closed;
  }

  get closeReason(): string | undefined {
    return this.#closeReason;
  }

  send(message: WireKnowledgeMessage): void {
    if (this.#closed) return;
    this.#messages.push(message);
  }

  close(reason = "closed"): void {
    this.#closed = true;
    this.#closeReason = reason;
  }

  clear(): void {
    this.#messages.length = 0;
  }
}

/**
 * Safe JSON serialization converting BigInt values to string to prevent TypeError.
 */
export function safeSerializeWireMessage(
  message: WireKnowledgeMessage,
): string {
  return JSON.stringify(message, (_key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  });
}

/**
 * Safe deserialization helper.
 */
export function safeDeserializeWireMessage(json: string): WireKnowledgeMessage {
  return JSON.parse(json) as WireKnowledgeMessage;
}

// ============================================================================
// 3. Adapter Core: State & Session Management
// ============================================================================

interface SessionRecord {
  readonly sessionId: string;
  session: ViewerSession;
  readonly sink: KnowledgeWireSink;
  lastRevision: bigint;
  connectedAtMs: bigint;
  active: boolean;
}

export interface IngestOutcome {
  readonly status: "published" | "idempotent_duplicate" | "stale_outbox";
  readonly revision: bigint;
  readonly recipientCount: number;
}

export interface PublishOutcome {
  readonly status: "published" | "stale_revision";
  readonly revision: bigint;
  readonly recipientCount: number;
}

export interface ClientMessageOutcome {
  readonly ok: boolean;
  readonly action?: string;
  readonly error?: string;
}

export interface KnowledgeWireAdapterOptions {
  readonly initialRevision?: bigint;
  readonly nowProvider?: () => bigint;
  readonly maxSeenOutboxIds?: number;
}

/**
 * KnowledgeWireAdapterV1
 * Server-authoritative realtime wire projection adapter.
 */
export class KnowledgeWireAdapterV1 {
  #world: AuthoritativeWorldState;
  #currentRevision: bigint;
  readonly #nowProvider: () => bigint;
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #seenOutboxIds = new Set<string>();
  readonly #maxSeenOutboxIds: number;

  constructor(
    initialWorld: AuthoritativeWorldState,
    options: KnowledgeWireAdapterOptions = {},
  ) {
    this.#world = initialWorld;
    this.#currentRevision = options.initialRevision ?? 1n;
    this.#nowProvider = options.nowProvider ?? (() => BigInt(Date.now()));
    this.#maxSeenOutboxIds = options.maxSeenOutboxIds ?? 10_000;
  }

  get world(): AuthoritativeWorldState {
    return this.#world;
  }

  get currentRevision(): bigint {
    return this.#currentRevision;
  }

  get activeSessionCount(): number {
    return this.#sessions.size;
  }

  /**
   * Replaces authoritative state snapshot (e.g. after database load or world mutation).
   */
  updateWorld(world: AuthoritativeWorldState, newRevision?: bigint): void {
    this.#world = world;
    if (newRevision !== undefined && newRevision > this.#currentRevision) {
      this.#currentRevision = newRevision;
    }
  }

  /**
   * Registers a connected viewer session.
   * Untrusted clientClaims are validated against verified session; on failure,
   * sanitized error frame is sent to sink and VisibilityAuthorizationError is thrown.
   */
  registerSession(
    sessionId: string,
    session: ViewerSession,
    sink: KnowledgeWireSink,
    options: {
      readonly sendInitialSnapshot?: boolean;
      readonly clientClaims?: ClientClaims;
    } = {},
  ): WireKnowledgeSnapshotMessage | null {
    if (!sessionId || sessionId.trim().length === 0) {
      throw new RangeError("Invalid sessionId");
    }

    // Zero-trust client claim validation
    try {
      validateClientClaims(session, options.clientClaims);
    } catch (err) {
      if (err instanceof VisibilityAuthorizationError) {
        sink.send(
          Object.freeze({
            kind: "error",
            code: err.code,
            message: err.message,
          }),
        );
      }
      throw err;
    }

    const nowMs = this.#nowProvider();
    const record: SessionRecord = {
      sessionId,
      session,
      sink,
      lastRevision: this.#currentRevision,
      connectedAtMs: nowMs,
      active: true,
    };

    this.#sessions.set(sessionId, record);

    if (options.sendInitialSnapshot ?? true) {
      return this.#sendSnapshotToSession(record, options.clientClaims);
    }

    return null;
  }

  /**
   * Unregisters a disconnected session.
   */
  unregisterSession(sessionId: string, reason = "disconnected"): boolean {
    const record = this.#sessions.get(sessionId);
    if (!record) return false;
    record.active = false;
    record.sink.close?.(reason);
    this.#sessions.delete(sessionId);
    return true;
  }

  hasSession(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  getSession(sessionId: string): ViewerSession | undefined {
    return this.#sessions.get(sessionId)?.session;
  }

  getSessionRevision(sessionId: string): bigint | undefined {
    return this.#sessions.get(sessionId)?.lastRevision;
  }

  /**
   * Switches school affiliation or role for an already connected session.
   * Immediately delivers a fresh snapshot corresponding strictly to the new session,
   * cutting off all previous confidential data (fog, landmark pots, receipts).
   */
  switchSessionAffiliation(
    sessionId: string,
    newSession: ViewerSession,
    options: { readonly clientClaims?: ClientClaims } = {},
  ): WireKnowledgeSnapshotMessage {
    const record = this.#sessions.get(sessionId);
    if (!record?.active) {
      throw new Error(`Session ${sessionId} not found or inactive`);
    }

    // Validate claims against new session
    validateClientClaims(newSession, options.clientClaims);

    record.session = newSession;
    record.lastRevision = this.#currentRevision;

    return this.#sendSnapshotToSession(record, options.clientClaims);
  }

  /**
   * Explicit client resync / reconnect request.
   */
  requestResync(
    sessionId: string,
    options: { readonly clientClaims?: ClientClaims } = {},
  ): WireKnowledgeSnapshotMessage {
    const record = this.#sessions.get(sessionId);
    if (!record?.active) {
      throw new Error(`Session ${sessionId} not found or inactive`);
    }

    validateClientClaims(record.session, options.clientClaims);
    record.lastRevision = this.#currentRevision;

    return this.#sendSnapshotToSession(record, options.clientClaims);
  }

  /**
   * Handles inbound client messages (resync, subscriptions, queries).
   * Rejects production mutations immediately.
   * Sanitizes all errors: zero secret leakage on mismatched identity claims.
   */
  handleClientMessage(
    sessionId: string,
    message: {
      readonly kind: string;
      readonly clientClaims?: ClientClaims;
      readonly payload?: unknown;
    },
  ): ClientMessageOutcome {
    const record = this.#sessions.get(sessionId);
    if (!record?.active) {
      return { ok: false, error: "SESSION_NOT_FOUND" };
    }

    // Explicitly reject production mutation attempts
    if (message.kind === "production_mutation") {
      record.sink.send(
        Object.freeze({
          kind: "error",
          code: "PRODUCTION_DISABLED",
          message: "Production mutations are disabled in development runtime",
        }),
      );
      return { ok: false, error: "PRODUCTION_DISABLED" };
    }

    // Validate client claims with fail-closed sanitized error
    if (message.clientClaims) {
      try {
        validateClientClaims(record.session, message.clientClaims);
      } catch (err) {
        if (err instanceof VisibilityAuthorizationError) {
          record.sink.send(
            Object.freeze({
              kind: "error",
              code: err.code,
              message: err.message,
            }),
          );
          return { ok: false, error: err.code };
        }
        record.sink.send(
          Object.freeze({
            kind: "error",
            code: "UNAUTHORIZED_CLAIM",
            message: "Authorization verification failed",
          }),
        );
        return { ok: false, error: "UNAUTHORIZED_CLAIM" };
      }
    }

    if (message.kind === "resync") {
      this.requestResync(
        sessionId,
        message.clientClaims ? { clientClaims: message.clientClaims } : {},
      );
      return { ok: true, action: "resync" };
    }

    return { ok: true, action: message.kind };
  }

  /**
   * Ingests a raw serializable outbox row from persistence (Codex Seam).
   * Enforces outboxId idempotency and revision order.
   */
  ingestOutboxEnvelope(
    envelope: SerializableKnowledgeOutboxEnvelope,
  ): IngestOutcome {
    if (!envelope.outboxId || envelope.outboxId.trim().length === 0) {
      throw new RangeError("Invalid outboxId");
    }

    // 1. Idempotency check: duplicate outboxId is dropped with 0 recipients
    if (this.#seenOutboxIds.has(envelope.outboxId)) {
      return {
        status: "idempotent_duplicate",
        revision: toBigInt(envelope.revision),
        recipientCount: 0,
      };
    }

    // Bound memory for deduplication set
    if (this.#seenOutboxIds.size >= this.#maxSeenOutboxIds) {
      const first = this.#seenOutboxIds.values().next().value;
      if (first !== undefined) this.#seenOutboxIds.delete(first);
    }
    this.#seenOutboxIds.add(envelope.outboxId);

    const revision = toBigInt(envelope.revision);

    // 2. Outbox row older than current state is considered stale
    if (revision < this.#currentRevision) {
      return {
        status: "stale_outbox",
        revision,
        recipientCount: 0,
      };
    }

    // 3. Adapt serializable event to pure AuthoritativeEvent
    const authEvent = adaptSerializableToAuthoritativeEvent(envelope.event);

    // 4. Publish to active sessions
    const outcome = this.publishAuthoritativeEvent(authEvent, revision);

    return {
      status:
        outcome.status === "stale_revision" ? "stale_outbox" : outcome.status,
      revision: outcome.revision,
      recipientCount: outcome.recipientCount,
    };
  }

  /**
   * Publishes an authoritative event to all connected sessions.
   * Filters events via projectKnowledgeEvent per verified session allowlist.
   * Stale events (revision <= session.lastRevision) are dropped.
   * Gaps (revision > session.lastRevision + 1) trigger resync snapshot.
   */
  publishAuthoritativeEvent(
    event: AuthoritativeEvent,
    targetRevision?: bigint,
  ): PublishOutcome {
    const revision = targetRevision ?? this.#currentRevision + 1n;

    // Advance current authoritative revision
    if (revision > this.#currentRevision) {
      this.#currentRevision = revision;
    }

    let recipientCount = 0;

    for (const record of this.#sessions.values()) {
      if (!record.active) continue;

      // Invariant: Stale events dropped (idempotent replay)
      if (revision <= record.lastRevision) {
        continue;
      }

      // Invariant: Gap detected -> trigger resync snapshot to maintain consistency
      if (revision > record.lastRevision + 1n) {
        record.sink.send(
          Object.freeze({
            kind: "resync_required",
            reason: "gap_detected",
            expectedRevision: (record.lastRevision + 1n).toString(),
            currentRevision: revision.toString(),
          }),
        );
        this.#sendSnapshotToSession(record);
        record.lastRevision = revision;
        continue;
      }

      // Sequential event: project via field-level allowlist
      const projected = projectKnowledgeEvent(record.session, event);

      // Advance session revision so next revision won't be flagged as a gap
      record.lastRevision = revision;

      if (projected === null) {
        // Session unauthorized to observe this event; zero data leaked
        continue;
      }

      const deltaMessage: WireKnowledgeDeltaMessage = Object.freeze({
        kind: "delta",
        revision: revision.toString(),
        timestampMs: event.timestampMs.toString(),
        event: projected,
      });

      record.sink.send(deltaMessage);
      recipientCount++;
    }

    return {
      status: "published",
      revision,
      recipientCount,
    };
  }

  /**
   * Generates and transmits a fresh safe-allowlist snapshot to the session.
   */
  #sendSnapshotToSession(
    record: SessionRecord,
    clientClaims?: ClientClaims,
  ): WireKnowledgeSnapshotMessage {
    const nowMs = this.#nowProvider();
    const projection = projectKnowledgeState(record.session, this.#world, {
      ...(clientClaims ? { clientClaims } : {}),
      nowMs,
    });

    const snapshotMessage: WireKnowledgeSnapshotMessage = Object.freeze({
      kind: "snapshot",
      revision: this.#currentRevision.toString(),
      generatedAtMs: nowMs.toString(),
      projection,
    });

    record.lastRevision = this.#currentRevision;
    record.sink.send(snapshotMessage);

    return snapshotMessage;
  }
}
