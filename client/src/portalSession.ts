import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import {
  type DevSessionConfig,
  LEGACY_DEV_SESSION,
  parseDevSession,
} from "../../shared/integration/devSession.ts";
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
export async function loadGameSession(): Promise<
  DevSessionConfig | PortalSessionConfig
> {
  loadingStage(0);
  try {
    const response = await request("/api/portal/config");
    if (response.status === 404) {
      const bootstrap = await request("/api/fixture/bootstrap");
      if (bootstrap.status === 404) {
        completeStage(0);
        return LEGACY_DEV_SESSION;
      }
      if (!bootstrap.ok) throw new Error("Session unavailable");
      completeStage(0);
      loadingStage(1);
      return parseDevSession(await bootstrap.json());
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
      new URLSearchParams(location.search).get("entry") === "portal"
    ) {
      history.replaceState(null, "", location.pathname);
      await login();
      return new Promise<never>(() => {});
    }
    const bootstrap = await request("/api/fixture/bootstrap");
    if (bootstrap.status === 401 || bootstrap.status === 403) {
      // The event portal owns login. Reuse its existing student session through
      // a browser-bound handoff instead of asking for a second login in game.
      await login();
      return new Promise<never>(() => {});
    }
    if (!bootstrap.ok) throw new Error("Bootstrap unavailable");
    const raw = (await bootstrap.json()) as Record<string, unknown>;
    if (raw.mode === "admin") {
      const p = raw.principal as Record<string, unknown> | undefined;
      if (
        raw.version !== 1 ||
        !p ||
        p.role !== "admin" ||
        p.organizationId !== "amtech" ||
        p.playable !== false ||
        typeof p.actorId !== "string" ||
        typeof p.name !== "string" ||
        typeof raw.csrfToken !== "string" ||
        !/^[a-f0-9]{64}$/.test(raw.csrfToken) ||
        !["staging", "production"].includes(String(raw.environment))
      )
        throw new Error("Invalid admin bootstrap");
      configureGameHttp(raw.csrfToken);
      const { mountLiveEditor } = await import("./liveEditor.ts");
      await mountLiveEditor(
        {
          actorId: p.actorId,
          name: p.name,
          organizationId: "amtech",
          role: "admin",
          playable: false,
        },
        raw.environment as "staging" | "production",
      );
      return new Promise<never>(() => {});
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
  const response = await request("/api/portal/config");
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
  location.assign(config.portalLoginUrl);
}
