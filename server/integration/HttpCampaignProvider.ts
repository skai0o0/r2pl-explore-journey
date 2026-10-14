import {
  assertIdentifier,
  assertTimestamp,
  parseRunningSnapshot,
} from "../../shared/integration/running.ts";
import type {
  CampaignProvider,
  VerifiedCampaignIdentity,
} from "./CampaignProvider.ts";

/** Server contract: POST sessions/verify and GET running/:studentId. */
export class HttpCampaignProvider implements CampaignProvider {
  readonly providerId = "http-campaign";
  private readonly base: URL;
  private readonly secret: string;
  private readonly timeoutMs: number;
  constructor(apiUrl: string, secret: string, timeoutMs = 5000) {
    this.secret = secret;
    this.timeoutMs = timeoutMs;
    this.base = new URL(apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      !(
        this.base.protocol === "https:" ||
        (this.base.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(this.base.hostname))
      )
    )
      throw new TypeError(
        "Campaign API requires HTTPS (HTTP allowed only on loopback)",
      );
    if (!secret.trim())
      throw new TypeError("CAMPAIGN_SHARED_SECRET is required");
  }
  private async request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.base), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.secret}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error("Campaign provider unavailable or unauthorized");
    return response.json();
  }
  async verifySession(credential: string): Promise<VerifiedCampaignIdentity> {
    const data = (await this.request("sessions/verify", {
      credential,
    })) as Record<string, unknown>;
    if (!data || data.provider !== this.providerId)
      throw new TypeError("Invalid campaign identity");
    assertIdentifier(data.externalStudentId);
    assertIdentifier(data.externalSchoolId);
    assertTimestamp(data.sessionExpiresAtMs);
    if (data.sessionExpiresAtMs <= Date.now())
      throw new TypeError("Expired campaign session");
    return {
      provider: this.providerId,
      externalStudentId: data.externalStudentId,
      externalSchoolId: data.externalSchoolId,
      sessionExpiresAtMs: data.sessionExpiresAtMs,
    };
  }
  async fetchRunningSnapshot(externalStudentId: string): Promise<unknown> {
    assertIdentifier(externalStudentId);
    const data = await this.request(
      `running/${encodeURIComponent(externalStudentId)}`,
    );
    const snapshot = parseRunningSnapshot(data);
    if (
      snapshot.provider !== this.providerId ||
      snapshot.externalStudentId !== externalStudentId
    )
      throw new TypeError("Running identity mismatch");
    return data;
  }
}
export function campaignProviderFromEnv(): HttpCampaignProvider | undefined {
  const url = process.env.CAMPAIGN_API_URL,
    secret = process.env.CAMPAIGN_SHARED_SECRET;
  if (!url && !secret) return undefined;
  if (!url || !secret)
    throw new TypeError("Set both CAMPAIGN_API_URL and CAMPAIGN_SHARED_SECRET");
  return new HttpCampaignProvider(url, secret);
}
