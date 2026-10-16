import { createHash, createHmac, randomBytes } from "node:crypto";

/** Server-side only. Never bundle a partner key in a browser or mobile app. */
export class R2plPartnerClient {
  async provisionMember(payload) {
    return this.request("members", payload);
  }
  constructor({ origin, campaignId, keyId, secret, timeoutMs = 10000 }) {
    const url = new URL(origin);
    if (url.origin !== origin || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("An HTTPS origin is required (loopback HTTP for sandbox)");
    this.origin = origin; this.campaignId = campaignId; this.keyId = keyId; this.secret = secret; this.timeoutMs = timeoutMs;
  }
  async request(operation, payload) {
    if (!["members", "running", "accounts", "launches"].includes(operation)) throw new Error("Unknown operation");
    const path = `/api/partner/v1/${operation}`, body = JSON.stringify(payload);
    const timestamp = String(Date.now()), nonce = randomBytes(24).toString("base64url");
    const canonical = ["r2pl-v1", this.campaignId, "POST", path, timestamp, nonce, createHash("sha256").update(body).digest("hex")].join("\n");
    const response = await fetch(this.origin + path, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
      headers: { "Content-Type": "application/json", "X-R2PL-Campaign": this.campaignId, "X-R2PL-Key-Id": this.keyId, "X-R2PL-Timestamp": timestamp, "X-R2PL-Nonce": nonce, "X-R2PL-Signature": createHmac("sha256", this.secret).update(canonical).digest("hex") },
      body,
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error ?? "R2PL_REQUEST_FAILED");
      error.status = response.status; error.requestId = result.requestId;
      throw error;
    }
    return result;
  }
}
