import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import type { PortalConfig } from "./PortalConfig.ts";

export class PortalError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export function portalSignature(
  secret: string,
  campaignId: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: Buffer,
): string {
  return createHmac("sha256", secret)
    .update(
      [
        "r2pl-v1",
        campaignId,
        method,
        path,
        timestamp,
        nonce,
        createHash("sha256").update(body).digest("hex"),
      ].join("\n"),
    )
    .digest("hex");
}
export function verifyPortalSignature(
  config: PortalConfig,
  headers: IncomingHttpHeaders,
  method: string,
  path: string,
  body: Buffer,
  now = Date.now(),
): { keyId: string; nonce: string } {
  const keyId = headers["x-r2pl-key-id"],
    timestamp = headers["x-r2pl-timestamp"],
    nonce = headers["x-r2pl-nonce"],
    signature = headers["x-r2pl-signature"];
  if (
    headers["x-r2pl-campaign"] !== config.campaignId ||
    typeof keyId !== "string" ||
    !Object.hasOwn(config.keys, keyId) ||
    typeof timestamp !== "string" ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > GAME_CONFIG.integration.requestSkewMs ||
    typeof nonce !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new PortalError(401, "INVALID_SIGNATURE");
  const expected = portalSignature(
    config.keys[keyId]!,
    config.campaignId,
    method,
    path,
    timestamp,
    nonce,
    body,
  );
  if (
    !timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    )
  )
    throw new PortalError(401, "INVALID_SIGNATURE");
  return { keyId, nonce };
}
