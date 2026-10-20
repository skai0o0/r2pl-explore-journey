import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import { canAdmin } from "../../shared/integration/adminAccess.ts";
import {
  AdminAccessStore,
  authenticateAdminAccess,
} from "./AdminAccessStore.ts";
import { knowledgeRanking } from "./KnowledgeScore.ts";
import { NotificationStore } from "./NotificationStore.ts";
import { switchTestProfile } from "./PartnerTestProfiles.ts";
import type { PortalConfig } from "./PortalConfig.ts";
import {
  gameCookie,
  gameCsrf,
  readCookie,
  validGameCsrf,
} from "./PortalCookies.ts";
import { PortalError } from "./PortalSignature.ts";

export class AdminHttp {
  private pool: Pool;
  private config: PortalConfig;
  private store: AdminAccessStore;
  private testProfilesSupported: boolean;
  constructor(pool: Pool, config: PortalConfig, testProfilesSupported = true) {
    this.pool = pool;
    this.config = config;
    this.store = new AdminAccessStore(pool, config.campaignId);
    this.testProfilesSupported = testProfilesSupported;
  }
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    token?: string,
  ): Promise<boolean> {
    const path = url.pathname;
    if (
      ![
        "/api/admin-auth/config",
        "/api/admin-auth/login",
        "/api/admin/accounts",
        "/api/admin/audit",
        "/api/admin/rankings",
        "/api/admin/notifications",
        "/api/test-profiles/switch",
      ].includes(path)
    )
      return false;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const config = this.config,
      nonceName =
        config.mode === "production"
          ? "__Host-r2pl_admin_login"
          : "r2pl_admin_login";
    try {
      if (url.search) throw new PortalError(400, "QUERY_NOT_SUPPORTED");
      if (path === "/api/admin-auth/config" && request.method === "GET") {
        const nonce = randomBytes(32).toString("hex");
        response.setHeader(
          "Set-Cookie",
          `${nonceName}=${nonce}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${config.mode === "production" ? "; Secure" : ""}`,
        );
        response.end(
          JSON.stringify({
            csrfToken: gameCsrf(nonce),
            portalEntry: "/?entry=admin",
          }),
        );
        return true;
      }
      if (request.method !== "GET" && request.method !== "POST")
        throw new PortalError(405, "METHOD_NOT_ALLOWED");
      const login = path === "/api/admin-auth/login";
      if (login && request.method !== "POST")
        throw new PortalError(405, "METHOD_NOT_ALLOWED");
      if (
        request.method === "POST" &&
        !validGameCsrf(
          request,
          config,
          login ? readCookie(request, nonceName) : token,
        )
      )
        throw new PortalError(403, "CSRF_REJECTED");
      const admin = login
        ? undefined
        : await authenticateAdminAccess(this.pool, config.campaignId, token);
      if (!login && !admin) throw new PortalError(401, "ADMIN_REQUIRED");
      let input: unknown;
      if (request.method === "POST") {
        if (!request.headers["content-type"]?.startsWith("application/json"))
          throw new PortalError(415, "JSON_REQUIRED");
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const part of request) {
          const bytes = Buffer.from(part);
          size += bytes.length;
          if (size > GAME_CONFIG.integration.maxBodyBytes)
            throw new PortalError(413, "BODY_TOO_LARGE");
          chunks.push(bytes);
        }
        input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      let result: unknown;
      if (login) {
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new PortalError(400, "INVALID_BODY");
        const value = input as Record<string, unknown>;
        if (Object.keys(value).some((k) => !["email", "password"].includes(k)))
          throw new PortalError(400, "INVALID_BODY");
        const next = await this.store.login(
          value.email,
          value.password,
          request.socket.remoteAddress ?? "unknown",
        );
        response.setHeader("Set-Cookie", [
          gameCookie(config, next, GAME_CONFIG.integration.sessionTtlMs / 1000),
          `${nonceName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.mode === "production" ? "; Secure" : ""}`,
        ]);
        result = { signedIn: true };
      } else if (path === "/api/admin/notifications") {
        result = await new NotificationStore(
          this.pool,
          config.campaignId,
        ).admin(
          admin!.actorId,
          token!,
          request.method === "GET" ? undefined : input,
        );
      } else if (path === "/api/test-profiles/switch") {
        if (request.method !== "POST")
          throw new PortalError(405, "METHOD_NOT_ALLOWED");
        if (!this.testProfilesSupported || !admin?.playable)
          throw new PortalError(403, "TEST_PROFILE_REQUIRED");
        const session = await switchTestProfile(
          this.pool,
          config.campaignId,
          token!,
          input,
        );
        response.setHeader(
          "Set-Cookie",
          gameCookie(config, session.token, session.expiresInSeconds),
        );
        result = { switched: true };
      } else if (path === "/api/admin/accounts") {
        if (
          !this.testProfilesSupported &&
          input &&
          typeof input === "object" &&
          (input as Record<string, unknown>).testProfiles === true
        )
          throw new PortalError(400, "TEST_PROFILES_REQUIRE_PORTAL");
        result =
          request.method === "GET"
            ? { accounts: await this.store.list(admin!.actorId, token!) }
            : { account: await this.store.save(admin!.actorId, token!, input) };
      } else if (request.method !== "GET")
        throw new PortalError(405, "METHOD_NOT_ALLOWED");
      else if (path === "/api/admin/audit")
        result = { events: await this.store.audit(admin!.actorId, token!) };
      else {
        if (!canAdmin(admin!, "rankings.view"))
          throw new PortalError(403, "PERMISSION_DENIED");
        const db = await this.pool.connect();
        try {
          result = { rankings: await knowledgeRanking(db, config.campaignId) };
        } finally {
          db.release();
        }
      }
      response.end(JSON.stringify(result));
    } catch (error) {
      const status =
        error instanceof PortalError
          ? error.status
          : error instanceof SyntaxError || error instanceof TypeError
            ? 400
            : 503;
      if (status === 429)
        response.setHeader(
          "Retry-After",
          String(GAME_CONFIG.adminAccess.loginWindowMs / 1000),
        );
      response.writeHead(status).end(
        JSON.stringify({
          error:
            error instanceof PortalError
              ? error.code
              : status === 400
                ? "INVALID_BODY"
                : "TEMPORARILY_UNAVAILABLE",
        }),
      );
    }
    return true;
  }
}
