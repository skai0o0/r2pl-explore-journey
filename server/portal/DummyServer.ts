import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { GAME_CONFIG, SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import type { PortalConfig } from "../integration/PortalConfig.ts";
import { readCookie } from "../integration/PortalCookies.ts";
import { PortalError } from "../integration/PortalSignature.ts";
import { DummyStore } from "./DummyStore.ts";

const csrf = (token: string) =>
  createHash("sha256").update(`dummy-csrf:${token}`).digest("hex");
const cookie = (token: string) =>
  `r2pl_dummy=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${GAME_CONFIG.integration.dummySessionTtlMs / 1000}`;
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new PortalError(415, "JSON_REQUIRED");
  let size = 0;
  const parts: Buffer[] = [];
  for await (const part of request) {
    const bytes = Buffer.from(part);
    size += bytes.length;
    if (size > GAME_CONFIG.integration.maxBodyBytes)
      throw new PortalError(413, "BODY_TOO_LARGE");
    parts.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new PortalError(400, "INVALID_JSON");
  }
}
export async function createDummyPortal(
  pool: Pool,
  config: PortalConfig,
  port = Number(new URL(config.portalLoginUrl).port || 4180),
) {
  if (
    config.mode !== "staging" ||
    ![config.publicOrigin, config.portalLoginUrl].every((value) =>
      ["127.0.0.1", "localhost"].includes(new URL(value).hostname),
    )
  )
    throw new Error("Dummy portal only runs on loopback staging");
  const store = new DummyStore(pool, config);
  await store.initialize();
  const root = resolve(
    fileURLToPath(new URL("../../dist/portal/", import.meta.url)),
  );
  let origin = new URL(config.portalLoginUrl).origin,
    busy = false,
    stopped = false;
  const sync = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (
        let n = 0;
        n < GAME_CONFIG.integration.dummySyncBatchSize && !stopped;
        n++
      ) {
        if (!(await store.syncNext())) break;
      }
    } finally {
      busy = false;
    }
  };
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    try {
      const url = new URL(request.url ?? "/", origin),
        path = url.pathname;
      if (!path.startsWith("/api/dummy/")) {
        if (request.method !== "GET")
          throw new PortalError(405, "METHOD_NOT_ALLOWED");
        const file = resolve(
          root,
          path === "/" || path === "/login"
            ? "index.html"
            : `.${decodeURIComponent(path)}`,
        );
        if (!file.startsWith(root + sep))
          throw new PortalError(403, "NOT_FOUND");
        const mime: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        };
        response.setHeader(
          "Content-Type",
          mime[extname(file)] ?? "application/octet-stream",
        );
        response.end(await readFile(file));
        return;
      }
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      let token = readCookie(request, "r2pl_dummy");
      if (!token || !/^[a-f0-9]{64}$/.test(token)) {
        token = randomBytes(32).toString("hex");
        response.setHeader("Set-Cookie", cookie(token));
      }
      const student = await store.authenticate(token);
      if (path === "/api/dummy/v1/me" && request.method === "GET") {
        response.end(
          JSON.stringify({
            csrfToken: csrf(token),
            schools: SCHOOLS.map((s) => ({ id: s.id, name: s.shortName })),
            gameOrigin: config.publicOrigin,
            ...(student
              ? ((await store.dashboard(student)) as object)
              : { student: null }),
          }),
        );
        return;
      }
      if (request.method !== "POST")
        throw new PortalError(405, "METHOD_NOT_ALLOWED");
      const provided = request.headers["x-csrf-token"];
      if (
        request.headers.origin !== origin ||
        typeof provided !== "string" ||
        !/^[a-f0-9]{64}$/.test(provided) ||
        !timingSafeEqual(
          Buffer.from(provided, "hex"),
          Buffer.from(csrf(token), "hex"),
        )
      )
        throw new PortalError(403, "CSRF_REJECTED");
      const body = await jsonBody(request);
      if (path === "/api/dummy/v1/register" || path === "/api/dummy/v1/login") {
        await store.rateLimit(request.socket.remoteAddress ?? "loopback");
        const user = path.endsWith("register")
          ? await store.register(body)
          : await store.login(body);
        await store.logout(token);
        const nextToken = await store.createSession(user);
        response.setHeader("Set-Cookie", cookie(nextToken));
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (!student) throw new PortalError(401, "UNAUTHORIZED");
      if (path === "/api/dummy/v1/logout") {
        await store.logout(token);
        response.setHeader(
          "Set-Cookie",
          "r2pl_dummy=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        );
        response.end("{}");
        return;
      }
      if (path === "/api/dummy/v1/activities") {
        await store.addActivity(student, body);
        void sync().catch(() => {});
        response.end(JSON.stringify({ queued: true }));
        return;
      }
      if (path === "/api/dummy/v1/retry") {
        await store.retry(student);
        void sync().catch(() => {});
        response.end("{}");
        return;
      }
      if (path === "/api/dummy/v1/play") {
        const value = body as Record<string, unknown>;
        if (
          !value ||
          value.gameCampaign !== config.campaignId ||
          value.gameReturn !== `${config.publicOrigin}/` ||
          typeof value.gameChallenge !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.gameChallenge)
        )
          throw new PortalError(400, "INVALID_GAME_HANDOFF");
        await store.provision(student);
        const launch = await store.partner.request("launches", {
          externalStudentId: student.id,
          codeChallenge: value.gameChallenge,
        });
        response.end(JSON.stringify(launch));
        return;
      }
      throw new PortalError(404, "NOT_FOUND");
    } catch (error) {
      const status = error instanceof PortalError ? error.status : 503;
      if (status === 429) response.setHeader("Retry-After", "60");
      response.writeHead(status).end(
        JSON.stringify({
          error:
            error instanceof PortalError
              ? error.code
              : "Hệ thống đang bận. Dữ liệu của bạn vẫn được giữ lại.",
        }),
      );
    }
  });
  server.requestTimeout = 15000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No dummy address");
  origin = `http://127.0.0.1:${address.port}`;
  const timer = setInterval(() => {
    void sync().catch(() => {});
  }, GAME_CONFIG.integration.dummySyncPollMs);
  timer.unref();
  return {
    store,
    origin,
    sync,
    close: async () => {
      stopped = true;
      clearInterval(timer);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      while (busy) await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}
