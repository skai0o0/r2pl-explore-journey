/** Server-only adapter boundary; implementation belongs to the external campaign team. */
export interface VerifiedCampaignIdentity {
  readonly provider: string;
  readonly externalStudentId: string;
  readonly externalSchoolId: string;
  readonly sessionExpiresAtMs: number;
}
export interface CampaignProvider {
  readonly providerId: string;
  /** Credentials are opaque and must never be logged or accepted as school proof. */
  verifySession(credential: string): Promise<VerifiedCampaignIdentity>;
  /** Raw provider response must pass parseRunningSnapshot before use. */
  fetchRunningSnapshot(externalStudentId: string): Promise<unknown>;
}
export interface CampaignBinding {
  readonly campaignId: string;
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly externalSchoolId: string;
  readonly provider: string;
  readonly externalStudentId: string;
}
/** The server resolves a verified external identity against an approved registry. */
export interface CampaignIdentityResolver {
  resolve(
    campaignId: string,
    identity: VerifiedCampaignIdentity,
  ): Promise<CampaignBinding | null>;
}
