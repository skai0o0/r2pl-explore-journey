import { SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import { AMTECH } from "../../shared/integration/identity.ts";

export interface PortalConfig {
  readonly campaignId: string;
  readonly publicOrigin: string;
  readonly portalLoginUrl: string;
  readonly websocketUrl: string;
  readonly keys: Readonly<Record<string, string>>;
  readonly adminKey: string;
  readonly mode: "staging" | "production";
}
export function validatePortalConfig(config: PortalConfig): PortalConfig {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      config.campaignId,
    )
  )
    throw new TypeError("Invalid PORTAL_CAMPAIGN_ID");
  if (!["production", "staging"].includes(config.mode))
    throw new TypeError("Invalid portal mode");
  for (const [value, websocket] of [
    [config.publicOrigin, false],
    [config.portalLoginUrl, false],
    [config.websocketUrl, true],
  ] as const) {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.protocol !== (websocket ? "wss:" : "https:") &&
        !(
          config.mode === "staging" &&
          local &&
          url.protocol === (websocket ? "ws:" : "http:")
        ))
    )
      throw new TypeError(
        "Portal URLs require TLS; staging permits loopback HTTP only",
      );
  }
  if (new URL(config.publicOrigin).origin !== config.publicOrigin)
    throw new TypeError("PUBLIC_ORIGIN must be an exact origin");
  if (
    config.adminKey.length < 32 ||
    config.adminKey.startsWith("REPLACE_") ||
    config.adminKey === "dev-map-admin"
  )
    throw new TypeError(
      "A private ADMIN_KEY of at least 32 characters is required",
    );
  const keys = Object.entries(config.keys);
  if (
    !keys.length ||
    keys.some(
      ([id, secret]) =>
        !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
        typeof secret !== "string" ||
        secret.startsWith("REPLACE_") ||
        Buffer.byteLength(secret) < 32,
    )
  )
    throw new TypeError(
      "PORTAL_KEYS_JSON requires key IDs with secrets of at least 32 bytes",
    );
  return Object.freeze({ ...config, keys: Object.freeze({ ...config.keys }) });
}
export function portalConfigFromEnv(): PortalConfig {
  const env = process.env;
  return validatePortalConfig({
    campaignId: env.PORTAL_CAMPAIGN_ID ?? "",
    publicOrigin: env.PUBLIC_ORIGIN ?? "",
    portalLoginUrl: env.PORTAL_LOGIN_URL ?? "",
    websocketUrl: env.PUBLIC_WEBSOCKET_URL ?? "",
    keys: JSON.parse(env.PORTAL_KEYS_JSON ?? "{}") as Record<string, string>,
    adminKey: env.ADMIN_KEY ?? "",
    mode: env.PORTAL_MODE as PortalConfig["mode"],
  });
}
export const portalSchools = () =>
  SCHOOLS.map(({ id, slot, shortName, fullName, emailDomains }) => ({
    id,
    slot,
    name: shortName,
    shortName,
    fullName,
    emailDomains,
    role: "user",
    playable: true,
  }));
export const portalOrganizations = () => [AMTECH];
