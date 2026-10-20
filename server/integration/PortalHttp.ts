import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import { portalOrganizations, portalSchools } from "./PortalConfig.ts";
import { gameCookie, validGameCsrf } from "./PortalCookies.ts";
import { PortalError, verifyPortalSignature } from "./PortalSignature.ts";
import type { PortalStore } from "./PortalStore.ts";

export class PortalHttp {
  readonly store: PortalStore;
  constructor(store: PortalStore) {
    this.store = store;
  }
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    token?: string,
  ): Promise<boolean> {
    const path = url.pathname;
    if (!path.startsWith("/api/partner/") && !path.startsWith("/api/portal/"))
      return false;
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    try {
      if (path === "/api/partner/v1/openapi.json" && request.method === "GET") {
        response.end(
          await readFile(
            new URL("../../integration/openapi.json", import.meta.url),
            "utf8",
          ),
        );
        return true;
      }
      if (path === "/api/portal/config" && request.method === "GET") {
        response.end(
          JSON.stringify({
            mode: "portal",
            contractVersion: 1,
            campaignId: this.store.config.campaignId,
            portalLoginUrl: this.store.config.portalLoginUrl,
            returnUrl: `${this.store.config.publicOrigin}/`,
            schools: portalSchools(),
            organizations: portalOrganizations(),
          }),
        );
        return true;
      }
      if (request.method !== "POST")
        throw new PortalError(405, "METHOD_NOT_ALLOWED");
      if (url.search) throw new PortalError(400, "QUERY_NOT_SUPPORTED");
      if (!request.headers["content-type"]?.startsWith("application/json"))
        throw new PortalError(415, "JSON_REQUIRED");
      if (
        request.headers.origin &&
        request.headers.origin !== this.store.config.publicOrigin
      )
        throw new PortalError(403, "ORIGIN_REJECTED");
      if (
        path === "/api/portal/session" &&
        request.headers.origin !== this.store.config.publicOrigin
      )
        throw new PortalError(403, "ORIGIN_REJECTED");
      if (
        ["/api/portal/logout", "/api/portal/ws-ticket"].includes(path) &&
        !validGameCsrf(request, this.store.config, token)
      )
        throw new PortalError(403, "CSRF_REJECTED");
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const part of request) {
        const bytes = Buffer.from(part);
        size += bytes.length;
        if (size > GAME_CONFIG.integration.maxBodyBytes)
          throw new PortalError(413, "BODY_TOO_LARGE");
        chunks.push(bytes);
      }
      const raw = Buffer.concat(chunks);
      if (path.startsWith("/api/partner/")) {
        const auth = verifyPortalSignature(
          this.store.config,
          request.headers,
          request.method,
          request.url!,
          raw,
        );
        await this.store.acceptRequest(auth.keyId, auth.nonce);
      }
      let input: unknown;
      try {
        input = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new PortalError(400, "INVALID_JSON");
      }
      let result: unknown;
      switch (path) {
        case "/api/partner/v1/members":
          result = await this.store.upsertMember(input);
          break;
        case "/api/partner/v1/running":
          result = await this.store.running(input);
          break;
        case "/api/partner/v1/accounts":
          result = await this.store.account(input);
          break;
        case "/api/partner/v1/notifications/pull":
          result = await this.store.notifications().pull(input);
          break;
        case "/api/partner/v1/notifications/ack":
          result = await this.store.notifications().ack(input);
          break;
        case "/api/partner/v1/launches":
          result = await this.store.launch(input);
          break;
        case "/api/portal/session": {
          const session = await this.store.exchange(input);
          if (token) await this.store.logout(token);
          response.setHeader(
            "Set-Cookie",
            gameCookie(
              this.store.config,
              session.token,
              session.expiresInSeconds,
            ),
          );
          result = { expiresInSeconds: session.expiresInSeconds };
          break;
        }
        case "/api/portal/ws-ticket": {
          if (!token) throw new PortalError(401, "UNAUTHORIZED");
          result = { ticket: await this.store.socketTicket(token) };
          break;
        }
        case "/api/portal/logout": {
          if (
            !token ||
            (!(await this.store.authenticate(token)) &&
              !(await this.store.authenticateAdmin(token)))
          )
            throw new PortalError(401, "UNAUTHORIZED");
          await this.store.logout(token);
          response.setHeader(
            "Set-Cookie",
            gameCookie(this.store.config, "", 0),
          );
          result = { loggedOut: true };
          break;
        }
        default:
          throw new PortalError(404, "NOT_FOUND");
      }
      response.end(JSON.stringify(result));
    } catch (error) {
      const status =
        error instanceof PortalError
          ? error.status
          : error instanceof TypeError || error instanceof RangeError
            ? 400
            : 503;
      if (status === 503)
        console.error(
          JSON.stringify({
            component: "portal",
            requestId,
            path,
            error: "TEMPORARILY_UNAVAILABLE",
          }),
        );
      if (status === 429) response.setHeader("Retry-After", "60");
      response.writeHead(status).end(
        JSON.stringify({
          error:
            error instanceof PortalError
              ? error.code
              : status === 400
                ? "INVALID_BODY"
                : "TEMPORARILY_UNAVAILABLE",
          requestId,
        }),
      );
    }
    return true;
  }
}
