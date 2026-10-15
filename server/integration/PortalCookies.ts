import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { PortalConfig } from "./PortalConfig.ts";

export function gameCookieName(config: PortalConfig): string {
  return config.mode === "production" ? "__Host-r2pl_game" : "r2pl_game";
}
export function readCookie(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const parts = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim());
  const matches = parts.filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : undefined;
}
export function gameCookie(
  config: PortalConfig,
  token: string,
  seconds: number,
): string {
  return `${gameCookieName(config)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.mode === "production" ? "; Secure" : ""}`;
}
export const gameCsrf = (token: string): string =>
  createHash("sha256").update(`csrf:${token}`).digest("hex");
export function validGameCsrf(
  request: IncomingMessage,
  config: PortalConfig,
  token: string | undefined,
): boolean {
  const actual = request.headers["x-csrf-token"];
  if (
    !token ||
    request.headers.origin !== config.publicOrigin ||
    typeof actual !== "string" ||
    !/^[a-f0-9]{64}$/.test(actual)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(gameCsrf(token), "hex"),
    Buffer.from(actual, "hex"),
  );
}
