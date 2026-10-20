import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import {
  type AdminPermission,
  canAdmin,
} from "../../shared/integration/adminAccess.ts";
import {
  type DevSessionConfig,
  LEGACY_DEV_SESSION,
  parseDevSession,
} from "../../shared/integration/devSession.ts";
import type { AdminPrincipal } from "../../shared/integration/identity.ts";
import {
  type PortalSessionConfig,
  parsePortalSession,
} from "../../shared/integration/portalSession.ts";
import {
  bootFailure,
  completeStage,
  loadingStage,
  loginScreen,
} from "./bootScreen.ts";
import { configureGameHttp, gameFetch } from "./gameHttp.ts";

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
async function request(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(GAME_CONFIG.integration.bootstrapTimeoutMs),
    ...options,
  });
}
async function openAdminBootstrap(
  raw: Record<string, unknown>,
): Promise<never> {
  const p = raw.principal as Record<string, unknown> | undefined;
  if (
    raw.version !== 1 ||
    !p ||
    p.role !== "admin" ||
    p.organizationId !== "amtech" ||
    typeof p.playable !== "boolean" ||
    typeof p.actorId !== "string" ||
    typeof p.name !== "string" ||
    typeof raw.csrfToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.csrfToken) ||
    !["staging", "production"].includes(String(raw.environment))
  )
    throw new Error("Invalid admin bootstrap");
  configureGameHttp(raw.csrfToken);
  const principal: AdminPrincipal = {
    actorId: p.actorId,
    name: p.name,
    organizationId: "amtech",
    role: "admin",
    playable: p.playable,
    email: typeof p.email === "string" ? p.email : "",
    permissions: Array.isArray(p.permissions)
      ? (p.permissions as AdminPermission[])
      : [],
    protectedRoot: p.protectedRoot === true,
  };
  if (
    location.pathname === "/admin/editor" &&
    canAdmin(principal, "map.view")
  ) {
    const { mountLiveEditor } = await import("./liveEditor.ts");
    await mountLiveEditor(
      principal,
      raw.environment as "staging" | "production",
    );
  } else {
    const { mountAdminDashboard } = await import("./adminDashboard.ts");
    await mountAdminDashboard(
      principal,
      raw.environment as "staging" | "production",
      raw.testProfilesSupported === true,
    );
  }
  return new Promise<never>(() => {});
}
export async function loadGameSession(): Promise<
  DevSessionConfig | PortalSessionConfig
> {
  loadingStage(0);
  try {
    if (
      ["/admin", "/admin/login", "/admin/editor"].includes(location.pathname)
    ) {
      const bootstrap = await request("/api/fixture/bootstrap?view=admin");
      if (bootstrap.ok) {
        const raw = (await bootstrap.json()) as Record<string, unknown>;
        if (raw.mode === "admin") return openAdminBootstrap(raw);
      } else if (![401, 403].includes(bootstrap.status))
        throw new Error("Admin unavailable");
      const { mountAdminLogin } = await import("./adminDashboard.ts");
      await mountAdminLogin();
      return new Promise<never>(() => {});
    }
    const adminEntry =
      new URLSearchParams(location.search).get("entry") === "admin";
    if (adminEntry) sessionStorage.setItem("r2pl-demo-admin-entry", "1");
    const returningAdmin =
      new URLSearchParams(location.hash.slice(1)).has("launch") &&
      sessionStorage.getItem("r2pl-demo-admin-entry") === "1";
    const response = await request(
      `/api/portal/config${adminEntry || returningAdmin ? "?entry=admin" : ""}`,
    );
    if (response.status === 404) {
      if (adminEntry || returningAdmin)
        throw new Error("Admin handoff unavailable");
      const bootstrap = await request("/api/fixture/bootstrap");
      if (bootstrap.status === 404) {
        completeStage(0);
        return LEGACY_DEV_SESSION;
      }
      if (!bootstrap.ok) throw new Error("Session unavailable");
      completeStage(0);
      loadingStage(1);
      const raw = (await bootstrap.json()) as Record<string, unknown>;
      if (raw.mode === "admin") return openAdminBootstrap(raw);
      return parseDevSession(raw);
    }
    if (!response.ok) throw new Error("Portal unavailable");
    const config = (await response.json()) as {
      portalLoginUrl: string;
      campaignId: string;
      returnUrl: string;
    };
    const login = async () => {
      const verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
      sessionStorage.setItem("r2pl-portal-verifier", verifier);
      const challenge = b64(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      );
      const url = new URL(config.portalLoginUrl);
      url.searchParams.set("game_campaign", config.campaignId);
      url.searchParams.set("game_challenge", challenge);
      url.searchParams.set("game_return", config.returnUrl);
      location.assign(url.href);
    };
    sessionStorage.removeItem("r2pl-portal-session");
    const ticket = new URLSearchParams(location.hash.slice(1)).get("launch");
    if (ticket) {
      history.replaceState(null, "", location.pathname);
      const codeVerifier = sessionStorage.getItem("r2pl-portal-verifier");
      sessionStorage.removeItem("r2pl-portal-verifier");
      const exchange = await request("/api/portal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, codeVerifier }),
      });
      if (exchange.status === 401 || exchange.status === 403)
        return loginScreen(
          "Lượt đăng nhập đã hết hạn hoặc không thuộc trình duyệt này. Vui lòng đăng nhập lại.",
          login,
          config.portalLoginUrl,
        );
      if (!exchange.ok) throw new Error("Session exchange unavailable");
    }
    if (
      !ticket &&
      (adminEntry ||
        new URLSearchParams(location.search).get("entry") === "portal")
    ) {
      history.replaceState(null, "", location.pathname);
      await login();
      return new Promise<never>(() => {});
    }
    const bootstrap = await request(
      adminEntry || returningAdmin
        ? "/api/fixture/bootstrap?view=admin"
        : "/api/fixture/bootstrap",
    );
    if (bootstrap.status === 401 || bootstrap.status === 403) {
      // The event portal owns login. Reuse its existing student session through
      // a browser-bound handoff instead of asking for a second login in game.
      await login();
      return new Promise<never>(() => {});
    }
    if (!bootstrap.ok) throw new Error("Bootstrap unavailable");
    const raw = (await bootstrap.json()) as Record<string, unknown>;
    if (raw.mode === "admin") {
      return openAdminBootstrap(raw);
    }
    const session = parsePortalSession(raw);
    configureGameHttp(session.csrfToken);
    completeStage(0);
    loadingStage(1);
    return session;
  } catch {
    bootFailure(
      "Chưa thể kết nối đến hệ thống. Thông tin tài khoản của bạn vẫn được giữ nguyên.",
    );
    return new Promise<never>(() => {});
  }
}

/** Leave the game session without immediately auto-signing back in on reload. */
export async function returnToEventPortal(): Promise<void> {
  let response = await request("/api/portal/config");
  if (response.status === 404)
    response = await request("/api/portal/config?entry=admin");
  if (!response.ok) throw new Error("Portal unavailable");
  const config = (await response.json()) as { portalLoginUrl: string };
  const logout = await gameFetch("/api/portal/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!logout.ok && logout.status !== 401)
    throw new Error("Logout unavailable");
  sessionStorage.removeItem("r2pl-portal-verifier");
  sessionStorage.removeItem("r2pl-portal-session");
  sessionStorage.removeItem("r2pl-demo-admin-entry");
  location.assign(config.portalLoginUrl);
}
