import {
  assertIdentifier,
  assertTimestamp,
  parseRunningSnapshot,
  snapshotWire,
} from "../../shared/integration/running.ts";
import type {
  CampaignBinding,
  CampaignIdentityResolver,
  CampaignProvider,
  VerifiedCampaignIdentity,
} from "./CampaignProvider.ts";
import {
  assertBinding,
  type RunningSyncResult,
} from "./PgRunningPreparation.ts";
export interface RunningSyncSink {
  apply(
    binding: CampaignBinding,
    snapshot: unknown,
  ): Promise<RunningSyncResult>;
}
export class CampaignIntegrationUnavailable extends Error {
  constructor() {
    super("Campaign provider unavailable");
  }
}
/** Preparation orchestration. No HTTP endpoint, browser identity or production session fallback. */
export class CampaignSyncService {
  readonly #provider: CampaignProvider;
  readonly #resolver: CampaignIdentityResolver;
  readonly #sink: RunningSyncSink;
  readonly #clock: () => number;
  readonly #maxSnapshotAgeMs: number;
  constructor(
    provider: CampaignProvider,
    resolver: CampaignIdentityResolver,
    sink: RunningSyncSink,
    config: { readonly clock: () => number; readonly maxSnapshotAgeMs: number },
  ) {
    assertIdentifier(provider.providerId);
    if (
      !Number.isSafeInteger(config.maxSnapshotAgeMs) ||
      config.maxSnapshotAgeMs <= 0
    )
      throw new RangeError("Explicit snapshot freshness required");
    this.#provider = provider;
    this.#resolver = resolver;
    this.#sink = sink;
    this.#clock = config.clock;
    this.#maxSnapshotAgeMs = config.maxSnapshotAgeMs;
  }
  async synchronize(
    campaignId: string,
    credential: string,
  ): Promise<RunningSyncResult> {
    if (
      typeof credential !== "string" ||
      credential.length < 1 ||
      credential.length > 8192
    )
      throw new RangeError("Invalid campaign credential");
    let identity: VerifiedCampaignIdentity;
    try {
      identity = await this.#provider.verifySession(credential);
    } catch {
      throw new CampaignIntegrationUnavailable();
    }
    assertIdentifier(identity.provider);
    assertIdentifier(identity.externalStudentId);
    assertIdentifier(identity.externalSchoolId);
    assertTimestamp(identity.sessionExpiresAtMs);
    const now = this.#clock();
    assertTimestamp(now);
    if (
      identity.provider !== this.#provider.providerId ||
      identity.sessionExpiresAtMs <= now
    )
      throw new RangeError("Invalid verified campaign session");
    // Keep a detached identity: a provider must not change it while fetching a snapshot.
    identity = Object.freeze({
      provider: identity.provider,
      externalStudentId: identity.externalStudentId,
      externalSchoolId: identity.externalSchoolId,
      sessionExpiresAtMs: identity.sessionExpiresAtMs,
    });
    const binding = await this.#resolver.resolve(campaignId, identity);
    if (!binding) throw new RangeError("Campaign membership not mapped");
    assertBinding(binding);
    if (
      binding.campaignId !== campaignId ||
      binding.provider !== identity.provider ||
      binding.externalStudentId !== identity.externalStudentId ||
      binding.externalSchoolId !== identity.externalSchoolId
    )
      throw new RangeError("Invalid resolved membership");
    const bound = Object.freeze({ ...binding });
    let raw: unknown;
    try {
      raw = await this.#provider.fetchRunningSnapshot(
        identity.externalStudentId,
      );
    } catch {
      throw new CampaignIntegrationUnavailable();
    }
    const snapshot = parseRunningSnapshot(raw);
    const afterFetch = this.#clock();
    assertTimestamp(afterFetch);
    if (
      identity.sessionExpiresAtMs <= afterFetch ||
      snapshot.observedAtMs > afterFetch ||
      afterFetch - snapshot.observedAtMs > this.#maxSnapshotAgeMs
    )
      throw new RangeError("Expired campaign session or running snapshot");
    if (
      snapshot.provider !== bound.provider ||
      snapshot.externalStudentId !== bound.externalStudentId
    )
      throw new RangeError("Running source identity mismatch");
    const current = await this.#resolver.resolve(campaignId, identity);
    if (
      !current ||
      current.campaignId !== bound.campaignId ||
      current.actorId !== bound.actorId ||
      current.schoolSlot !== bound.schoolSlot ||
      current.externalSchoolId !== bound.externalSchoolId ||
      current.provider !== bound.provider ||
      current.externalStudentId !== bound.externalStudentId
    )
      throw new RangeError(
        "Campaign membership changed during synchronization",
      );
    const beforeCommit = this.#clock();
    assertTimestamp(beforeCommit);
    if (
      identity.sessionExpiresAtMs <= beforeCommit ||
      beforeCommit - snapshot.observedAtMs > this.#maxSnapshotAgeMs
    )
      throw new RangeError(
        "Campaign authorization expired before synchronization",
      );
    return this.#sink.apply(bound, snapshotWire(snapshot));
  }
}
