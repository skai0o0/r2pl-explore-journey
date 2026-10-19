import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { matchMaker } from "@colyseus/core";
import type { Pool } from "pg";
import { BotPeer, pause } from "../../scripts/simulation/BotPeer.ts";
import { EDITOR_CONFIG } from "../../shared/gameplay/editor.ts";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import type { AdminPrincipal } from "../../shared/integration/identity.ts";
import { ACK_STATUS } from "../../shared/protocol/m2.ts";
import type { BotRole } from "../../shared/simulation/schoolBots.ts";
import { createDurableSyntheticServer } from "../realtime/durableBootstrap.ts";
import type { CampaignProvider } from "./CampaignProvider.ts";
import { DemoAdminStore } from "./DemoAdminPortal.ts";
import { DevAccountService } from "./DevAccountService.ts";
import { EditorStore } from "./EditorStore.ts";
import { GiftPoolStore } from "./GiftPoolStore.ts";
import { knowledgeRanking } from "./KnowledgeScore.ts";
import { seedPortalCampaign } from "./PortalCampaign.ts";
import { type PortalConfig, validatePortalConfig } from "./PortalConfig.ts";
import {
  gameCookieName,
  gameCsrf,
  readCookie,
  validGameCsrf,
} from "./PortalCookies.ts";
import { PortalHttp } from "./PortalHttp.ts";
import { PortalError } from "./PortalSignature.ts";
import { PortalStore } from "./PortalStore.ts";
import {
  SCHOOL_PLAY_CAMPAIGN,
  type SchoolPlayActor,
  seedSchoolPlay,
} from "./SchoolPlayFixture.ts";
import { provisionSchoolRewards } from "./SchoolRewardFixture.ts";
import { SchoolRewardHttp } from "./SchoolRewardHttp.ts";
import { SignedGameplay } from "./SignedGameplay.ts";
import { SignedOperator } from "./SignedOperator.ts";

interface PlayServerOptions {
  readonly rewardDraw?: () => number;
  readonly campaignProvider?: CampaignProvider;
  readonly actorsPerSchool?: number;
  readonly portal?: PortalConfig;
  readonly adminPortal?: PortalConfig;
}

/** One local dev writer per persistent campaign. Not distributed lease/fencing. */
export async function createSchoolPlayServer(
  pool: Pool,
  ports: { web: number; websocket: number },
  campaignId = SCHOOL_PLAY_CAMPAIGN,
  options: PlayServerOptions = {},
): Promise<Awaited<ReturnType<typeof startSchoolPlayServer>>> {
  if (options.portal) {
    validatePortalConfig(options.portal);
    if (campaignId !== options.portal.campaignId)
      throw new Error("Portal campaign mismatch");
  }
  if (options.adminPortal) {
    validatePortalConfig(options.adminPortal);
    if (
      options.portal ||
      options.adminPortal.mode !== "staging" ||
      options.adminPortal.campaignId !== campaignId
    )
      throw new Error(
        "Admin bridge requires its own synthetic staging campaign",
      );
  }
  const writer = await pool.connect();
  const key = `school-play:${campaignId}`;
  let acquired = false;
  try {
    acquired = (
      await writer.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [key],
      )
    ).rows[0]!.locked;
    if (!acquired)
      throw new Error("Synthetic campaign already has a local writer");
    const play = await startSchoolPlayServer(pool, ports, campaignId, options);
    let closed = false;
    const lost = () => {
      void close().catch(() => {});
    };
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      writer.off("error", lost);
      try {
        await play.close();
      } finally {
        try {
          await writer.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [key],
          );
        } finally {
          writer.release();
        }
      }
    };
    writer.on("error", lost);
    return { ...play, close };
  } catch (error) {
    try {
      if (acquired)
        await writer.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,0))",
          [key],
        );
    } finally {
      writer.release();
    }
    throw error;
  }
}

async function startSchoolPlayServer(
  pool: Pool,
  ports: { web: number; websocket: number },
  campaignId?: string,
  options: PlayServerOptions = {},
) {
  const fixture = options.portal
    ? await seedPortalCampaign(pool, options.portal)
    : await seedSchoolPlay(pool, campaignId, options.actorsPerSchool);
  if (!options.portal) await provisionSchoolRewards(pool, fixture);
  const portal = options.portal
    ? new PortalStore(pool, options.portal)
    : undefined;
  const adminPortal = options.adminPortal
    ? new DemoAdminStore(pool, options.adminPortal)
    : undefined;
  const authConfig = options.portal ?? options.adminPortal;
  const portalHttp =
    portal || adminPortal
      ? new PortalHttp((portal ?? adminPortal)!)
      : undefined;
  const rewardHttp = new SchoolRewardHttp(pool, fixture);
  const gameplay = new SignedGameplay(
    pool,
    fixture,
    options.rewardDraw,
    options.campaignProvider,
    !!portal,
  );
  await gameplay.initialize();
  const accounts = new DevAccountService(
    pool,
    fixture.campaignId,
    fixture.actors,
  );
  const realtime = await createDurableSyntheticServer(
    pool,
    fixture.campaignId,
    fixture.registry,
    fixture.actors,
    BigInt(GAME_CONFIG.knowledge.explorePoints),
    {},
    undefined,
    undefined,
    {
      headquarters: fixture.headquarters,
      ruleVersion: 1,
      ...(portal ? { requirePortalMember: true as const } : {}),
    },
    portal
      ? {
          revalidate: true,
          authenticate: async (token) => {
            const { actor, sessionHash } =
              await portal.consumeSocketTicket(token);
            return {
              actorId: actor.actorId,
              schoolSlot: actor.schoolSlot,
              authReference: sessionHash,
            };
          },
          validate: async (identity) => {
            if (
              !identity.authReference ||
              !(await portal.authenticateHash(identity.authReference))
            )
              throw new Error("Session expired");
          },
        }
      : undefined,
  );
  await realtime.server.listen(ports.websocket, "127.0.0.1");
  const address = realtime.transport.server?.address();
  if (!address || typeof address === "string")
    throw new Error("Missing WebSocket address");
  const operator = new SignedOperator(
    pool,
    fixture,
    authConfig?.adminKey ?? process.env.ADMIN_KEY ?? "dev-map-admin",
    () => realtime.core.resyncViews(),
  );
  const editor = new EditorStore(pool, fixture.campaignId);
  const giftPool = new GiftPoolStore(pool, fixture.campaignId);
  const clientRoot = resolve(
    fileURLToPath(new URL("../../dist/client/", import.meta.url)),
  );
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
    ".gltf": "model/gltf+json",
    ".glb": "model/gltf-binary",
  };
  const peers: BotPeer[] = [];
  let stopped = false;
  let botTask: Promise<void> | undefined;
  let botStatus = "idle";
  const web = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      response.writeHead(400).end();
      return;
    }
    const path = url.pathname;
    if (path.startsWith("/matchmake/")) {
      const parts = path.split("/").filter(Boolean);
      const method = parts[1];
      const roomName = parts[2] ?? "";
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization",
      );
      response.setHeader(
        "Access-Control-Allow-Methods",
        "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
      );
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      if (request.method !== "POST") {
        response
          .writeHead(405)
          .end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
        return;
      }
      try {
        let bodyBytes = "";
        for await (const chunk of request) bodyBytes += chunk;
        const options = bodyBytes ? JSON.parse(bodyBytes) : {};
        const result = await matchMaker.controller.invokeMethod(
          method as any,
          roomName,
          options,
        );
        response.writeHead(200).end(JSON.stringify(result));
      } catch (err: any) {
        response
          .writeHead(err.code || 500)
          .end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    const cookieToken = authConfig
      ? readCookie(request, gameCookieName(authConfig))
      : undefined;
    const token = options.portal
      ? cookieToken
      : (request.headers.authorization?.replace(/^Bearer /, "") ?? cookieToken);
    if (
      adminPortal &&
      path === "/api/portal/config" &&
      url.searchParams.get("entry") !== "admin"
    ) {
      response.writeHead(404).end();
      return;
    }
    if (portalHttp && (await portalHttp.handle(request, response, url, token)))
      return;
    let portalActor: Awaited<ReturnType<PortalStore["authenticate"]>>;
    let admin: AdminPrincipal | undefined;
    if (adminPortal) {
      try {
        admin = await adminPortal.authenticateAdmin(cookieToken);
      } catch {
        response.writeHead(503).end();
        return;
      }
      if (
        admin &&
        (path === "/api/game" ||
          path.startsWith("/api/game/") ||
          [
            "/api/fixture/me",
            "/api/fixture/chests",
            "/api/fixture/receipts",
            "/api/fixture/rewards",
          ].includes(path))
      ) {
        response
          .writeHead(403)
          .end(JSON.stringify({ error: "ADMIN_CANNOT_PLAY" }));
        return;
      }
      if (
        path.startsWith("/api/admin") &&
        request.method !== "GET" &&
        !validGameCsrf(request, authConfig!, cookieToken)
      ) {
        response.writeHead(403).end(JSON.stringify({ error: "CSRF_REJECTED" }));
        return;
      }
    }
    if (portal) {
      try {
        portalActor = await portal.authenticate(token);
        admin = await portal.authenticateAdmin(token);
      } catch {
        response.writeHead(503).end();
        return;
      }
      if (path.startsWith("/api/fixture/bots")) {
        response.writeHead(404).end();
        return;
      }
      if (
        admin &&
        (path === "/api/game" ||
          path.startsWith("/api/game/") ||
          [
            "/api/fixture/me",
            "/api/fixture/chests",
            "/api/fixture/receipts",
            "/api/fixture/rewards",
          ].includes(path))
      ) {
        response
          .writeHead(403)
          .end(JSON.stringify({ error: "ADMIN_CANNOT_PLAY" }));
        return;
      }
      if (
        path.startsWith("/api/admin") &&
        request.method !== "GET" &&
        !validGameCsrf(request, options.portal!, token)
      ) {
        response.writeHead(403).end(JSON.stringify({ error: "CSRF_REJECTED" }));
        return;
      }
      if (
        path === "/api/game" &&
        request.method === "POST" &&
        !validGameCsrf(request, options.portal!, token)
      ) {
        response.writeHead(403).end(JSON.stringify({ error: "CSRF_REJECTED" }));
        return;
      }
    }
    const actorForRequest = () =>
      portal ? portalActor : gameplay.actor(token);
    const expectedOrigin =
      authConfig?.publicOrigin ?? `http://${request.headers.host}`;
    if (path === "/api/admin/gift-pool") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      if (!admin) {
        response
          .writeHead(403)
          .end(JSON.stringify({ error: "ADMIN_REQUIRED" }));
        return;
      }
      try {
        if (request.method === "GET") {
          response.end(
            JSON.stringify(
              await giftPool.snapshot(admin.actorId, cookieToken!),
            ),
          );
          return;
        }
        if (request.method !== "POST") {
          response.writeHead(405).end();
          return;
        }
        if (!request.headers["content-type"]?.startsWith("application/json"))
          throw new PortalError(415, "JSON_REQUIRED");
        let size = 0;
        const parts: Buffer[] = [];
        for await (const part of request) {
          const bytes = Buffer.from(part);
          size += bytes.length;
          if (size > EDITOR_CONFIG.maxBodyBytes)
            throw new PortalError(413, "BODY_TOO_LARGE");
          parts.push(bytes);
        }
        response.end(
          JSON.stringify(
            await giftPool.update(
              admin.actorId,
              cookieToken!,
              JSON.parse(Buffer.concat(parts).toString("utf8")),
            ),
          ),
        );
      } catch (error) {
        response
          .writeHead(
            error instanceof PortalError
              ? error.status
              : error instanceof TypeError || error instanceof SyntaxError
                ? 400
                : 503,
          )
          .end(
            JSON.stringify({
              error:
                error instanceof PortalError
                  ? error.code
                  : error instanceof TypeError || error instanceof SyntaxError
                    ? "INVALID_GIFT_POOL_COMMAND"
                    : "TEMPORARILY_UNAVAILABLE",
            }),
          );
      }
      return;
    }
    if (path === "/api/admin/editor" || path === "/api/admin/editor/draft") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      if (!admin) {
        response
          .writeHead(403)
          .end(JSON.stringify({ error: "ADMIN_REQUIRED" }));
        return;
      }
      try {
        if (path === "/api/admin/editor" && request.method === "GET") {
          response.end(
            JSON.stringify(await editor.snapshot(admin.actorId, token!)),
          );
          return;
        }
        if (path !== "/api/admin/editor/draft" || request.method !== "POST") {
          response
            .writeHead(405)
            .end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > EDITOR_CONFIG.maxBodyBytes)
            throw new PortalError(413, "BODY_TOO_LARGE");
          chunks.push(bytes);
        }
        response.end(
          JSON.stringify(
            await editor.save(
              admin.actorId,
              JSON.parse(Buffer.concat(chunks).toString("utf8")),
              token!,
            ),
          ),
        );
      } catch (error) {
        const status =
          error instanceof PortalError
            ? error.status
            : error instanceof TypeError ||
                error instanceof RangeError ||
                error instanceof SyntaxError
              ? 400
              : 503;
        response.writeHead(status).end(
          JSON.stringify({
            error:
              error instanceof PortalError
                ? error.code
                : status === 400
                  ? (error as Error).message
                  : "TEMPORARILY_UNAVAILABLE",
          }),
        );
      }
      return;
    }
    if (
      path === "/api/fixture/rewards" ||
      path === "/api/fixture/rewards/events"
    ) {
      if (portal) {
        response.writeHead(404).end();
        return;
      }
      await rewardHttp.handle(request, response, url, token);
      return;
    }
    if (path === "/api/fixture/bots" && request.method === "GET") {
      if (portal) {
        response.writeHead(404).end();
        return;
      }
      const profile = token ? await accounts.profile(token) : null;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response
        .writeHead(200)
        .end(JSON.stringify(getBotTelemetry(profile?.schoolSlot)));
      return;
    }
    if (path === "/api/fixture/bots/start" && request.method === "POST") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        let body = "";
        for await (const chunk of request) body += chunk;
        const opts = body ? JSON.parse(body) : {};
        void startBots({
          count: Number(opts.count ?? 200),
          speed: opts.speed ?? "realistic",
          durationSeconds: Number(opts.durationSeconds ?? 3600),
        });
        response
          .writeHead(200)
          .end(JSON.stringify({ ok: true, ...getBotTelemetry() }));
      } catch (err: any) {
        response.writeHead(400).end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (path === "/api/fixture/bots/stop" && request.method === "POST") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        await stopBots();
        response
          .writeHead(200)
          .end(JSON.stringify({ ok: true, ...getBotTelemetry() }));
      } catch (err: any) {
        response.writeHead(500).end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (path === "/api/admin") {
      if (
        !(portal || adminPortal
          ? !!admin
          : operator.authorized(
              typeof request.headers["x-admin-key"] === "string"
                ? request.headers["x-admin-key"]
                : undefined,
            ))
      ) {
        response.writeHead(403).end();
        return;
      }
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        if (request.method === "GET") {
          response.end(JSON.stringify({ objects: await operator.layout() }));
          return;
        }
        if (request.method !== "POST") {
          response.writeHead(405).end();
          return;
        }
        const origin = request.headers.origin;
        if (origin && origin !== expectedOrigin) {
          response.writeHead(403).end();
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > EDITOR_CONFIG.maxBodyBytes) {
            response.writeHead(413).end();
            return;
          }
          chunks.push(bytes);
        }
        const command = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          action?: string;
        };
        if (
          command.action === "gift-stock" &&
          options.portal?.mode === "production"
        )
          throw new PortalError(403, "STAGING_ONLY");
        await operator.apply(command, admin?.actorId, token);
        response.end(JSON.stringify({ status: "applied" }));
      } catch (e) {
        response
          .writeHead(
            e instanceof PortalError
              ? e.status
              : e instanceof TypeError || e instanceof RangeError
                ? 400
                : 503,
          )
          .end(
            JSON.stringify({
              error:
                e instanceof PortalError
                  ? e.code
                  : e instanceof TypeError || e instanceof RangeError
                    ? e.message
                    : "TEMPORARILY_UNAVAILABLE",
            }),
          );
      }
      return;
    }
    if (path === "/api/models/manifest") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          models: [
            "/models/hqs/hcmut_hq.glb",
            "/models/hqs/ou_hq.glb",
            "/models/hqs/dtu_hq.glb",
            "/models/hqs/hpuni_hq.glb",
            "/models/hqs/hsu_hq.glb",
            "/models/hqs/huce_hq.glb",
            "/models/hqs/ntu_hq.glb",
            "/models/hqs/hcmiu_hq.glb",
            "/models/hq.gltf",
            "/models/landmark.gltf",
          ],
        }),
      );
      return;
    }
    if (path === "/api/admin/gifts") {
      if (
        !(portal || adminPortal
          ? !!admin
          : operator.authorized(
              typeof request.headers["x-admin-key"] === "string"
                ? request.headers["x-admin-key"]
                : undefined,
            ))
      ) {
        response.writeHead(403).end();
        return;
      }
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      const code = url.searchParams.get("code");
      if (code) {
        const gift = await gameplay.findGiftByCode(code);
        if (!gift) {
          response
            .writeHead(404)
            .end(JSON.stringify({ error: "GIFT_NOT_FOUND" }));
          return;
        }
        response.end(JSON.stringify({ gift }));
        return;
      }
      const gifts = await gameplay.listGifts(50);
      response.end(JSON.stringify({ gifts }));
      return;
    }
    if (path === "/api/admin/gifts/redeem") {
      if (
        !(portal || adminPortal
          ? !!admin
          : operator.authorized(
              typeof request.headers["x-admin-key"] === "string"
                ? request.headers["x-admin-key"]
                : undefined,
            ))
      ) {
        response.writeHead(403).end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 4096) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(bytes);
      }
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          giftCode?: string;
        };
        if (!payload.giftCode) {
          response
            .writeHead(400)
            .end(JSON.stringify({ error: "MISSING_GIFT_CODE" }));
          return;
        }
        const result = await gameplay.redeemGift(
          payload.giftCode,
          admin?.actorId,
          token,
        );
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (!result.success && !result.alreadyRedeemed) {
          response.writeHead(404).end(JSON.stringify(result));
          return;
        }
        response.end(JSON.stringify(result));
      } catch (e) {
        response.writeHead(500).end(JSON.stringify({ error: String(e) }));
      }
      return;
    }
    if (path === "/api/game") {
      const actor = actorForRequest();
      if (!actor) {
        response.writeHead(401).end();
        return;
      }
      try {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (request.method === "GET") {
          response.end(JSON.stringify(await gameplay.view(actor)));
          return;
        }
        if (request.method !== "POST") {
          response.writeHead(405).end();
          return;
        }
        const origin = request.headers.origin;
        if (origin && origin !== expectedOrigin) {
          response.writeHead(403).end();
          return;
        }
        if (!request.headers["content-type"]?.startsWith("application/json")) {
          response.writeHead(415).end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > 4096) {
            response.writeHead(413).end();
            return;
          }
          chunks.push(bytes);
        }
        const result = await gameplay.command(
          actor,
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        response.end(JSON.stringify(result));
      } catch (e) {
        response
          .writeHead(
            e instanceof TypeError || e instanceof RangeError ? 400 : 503,
          )
          .end(
            JSON.stringify({
              error:
                e instanceof TypeError || e instanceof RangeError
                  ? "INVALID_COMMAND"
                  : "TEMPORARILY_UNAVAILABLE",
            }),
          );
      }
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    const json = (value: unknown) => {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        request.method === "HEAD" ? undefined : JSON.stringify(value),
      );
    };
    try {
      if (path === "/api/game/tile") {
        const actor = actorForRequest();
        if (!actor) {
          response.writeHead(401).end();
          return;
        }
        const raw = url.searchParams.get("index");
        if (
          raw === null ||
          !/^\d{1,6}$/.test(raw) ||
          Number(raw) >= GAME_CONFIG.world.width * GAME_CONFIG.world.height
        ) {
          response.writeHead(400).end();
          return;
        }
        json(await gameplay.tileAction(actor, Number(raw)));
        return;
      }
      if (path === "/api/fixture/chests") {
        const actor = portal
          ? portalActor
          : fixture.actors.find((a) => a.token === token && a.role === "human");
        if (!actor) {
          response.writeHead(401).end();
          return;
        }
        const rows = await pool.query<{ data: unknown }>(
          "SELECT o.data FROM r2pl_v2.game_world_objects o JOIN r2pl_v2.game_chest_discoveries d ON d.campaign_id=o.campaign_id AND d.object_id=o.id WHERE o.campaign_id=$1 AND d.actor_id=$2 ORDER BY o.id",
          [fixture.campaignId, actor.actorId],
        );
        json({
          ruleVersion: GAME_CONFIG.ruleVersion,
          objects: rows.rows.map((r) => r.data),
        });
        return;
      }
      if (path === "/api/game/ranking") {
        const db = await pool.connect();
        try {
          await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const rankings = await knowledgeRanking(db, fixture.campaignId);
          await db.query("COMMIT");
          json({ rankings });
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
        return;
      }
      if (path === "/api/fixture/world") {
        await gameplay.syncStops();
        const rows = await pool.query<{ data: unknown }>(
          "SELECT data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 AND data->>'kind' <> 'chest' ORDER BY id",
          [fixture.campaignId],
        );
        json({
          ruleVersion: GAME_CONFIG.ruleVersion,
          objects: rows.rows.map((r) => r.data),
        });
        return;
      }
      if (path === "/api/fixture/bootstrap") {
        if (admin) {
          json({
            mode: "admin",
            version: 1,
            campaignId: fixture.campaignId,
            principal: admin,
            csrfToken: gameCsrf(token!),
            environment: authConfig!.mode,
            ...(adminPortal ? { demoAdminBridge: true } : {}),
          });
          return;
        }
        if (portal) {
          if (!portalActor) {
            response.writeHead(401).end();
            return;
          }
          const home = fixture.headquarters.find(
            (h) => h.schoolSlot === portalActor.schoolSlot,
          )!;
          json({
            mode: "portal",
            role: "user",
            playable: true,
            fixtureOnly: false,
            version: 1,
            websocketPort: address.port,
            websocketUrl: options.portal!.websocketUrl,
            csrfToken: gameCsrf(token!),
            players: [
              {
                token: portalActor.actorId,
                label: portalActor.name,
                schoolName: portalActor.schoolName,
                slot: portalActor.schoolSlot,
                home: { x: home.x + home.size / 2, z: home.z + home.size / 2 },
              },
            ],
            campaignId: fixture.campaignId,
            adjacentOnly: true,
            headquarters: fixture.headquarters,
          });
          return;
        }
        const publicWs = process.env.PUBLIC_WEBSOCKET_URL;
        json({
          fixtureOnly: true,
          version: 1,
          websocketPort: address.port,
          ...(publicWs ? { websocketUrl: publicWs } : {}),
          players: fixture.players,
          campaignId: fixture.campaignId,
          adjacentOnly: true,
          headquarters: fixture.headquarters,
        });
        return;
      }
      if (path === "/api/fixture/me" || path === "/api/fixture/receipts") {
        const actorAccounts =
          portal && portalActor
            ? new DevAccountService(pool, fixture.campaignId, [portalActor])
            : accounts;
        const profile =
          portal && !portalActor ? null : await actorAccounts.profile(token);
        if (!profile) {
          response.writeHead(401).end();
          return;
        }
        if (path === "/api/fixture/me") {
          const running =
            portal && portalActor
              ? (
                  await pool.query<{ data: { attributedPoints?: number } }>(
                    "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='running' AND id=$2",
                    [fixture.campaignId, portalActor.actorId],
                  )
                ).rows[0]?.data
              : undefined;
          json({
            ...profile,
            fixtureOnly: !portal,
            earnedRunningPoints: String(running?.attributedPoints ?? 0),
          });
        } else if (path === "/api/fixture/receipts") {
          json({
            fixtureOnly: !portal,
            receipts: await actorAccounts.receipts(token),
          });
        }
        return;
      }
      if (path === "/health") {
        await pool.query("SELECT 1");
        json({
          mode: portal ? options.portal!.mode : "synthetic",
          contractVersion: 1,
          fixtureOnly: !portal,
          schools: 8,
          botStatus,
        });
        return;
      }
      // Disabled/unknown APIs must not fall through to static files and look
      // like a database outage. The client uses 404 to detect local play.
      if (path.startsWith("/api/")) {
        response.writeHead(404).end();
        return;
      }
      const file = resolve(
        clientRoot,
        path === "/" ? "index.html" : `.${decodeURIComponent(path)}`,
      );
      if (!file.startsWith(clientRoot + sep) && file !== clientRoot) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(file);
      response.setHeader(
        "Content-Type",
        mime[extname(file)] ?? "application/octet-stream",
      );
      // Existing UI presentation is retained; only its fixture roster note is corrected.
      const body =
        path === "/"
          ? Buffer.from(
              bytes
                .toString()
                .replace(
                  "Two synthetic universities · four local test explorers",
                  "Eight synthetic schools · 16 explorers · 24 bots",
                ),
            )
          : bytes;
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      if (!response.headersSent)
        response.writeHead(path.startsWith("/api/") ? 503 : 404);
      response.end();
    }
  });
  web.requestTimeout = 10000;
  (realtime.transport as any).listenForUpgrade(web);
  try {
    await new Promise<void>((ready, reject) => {
      web.once("error", reject);
      web.listen(ports.web, "127.0.0.1", ready);
    });
  } catch (error) {
    realtime.core.stopRelay();
    await realtime.server.gracefullyShutdown(false);
    throw error;
  }
  let settling = false;
  const lifecycleTimer = setInterval(() => {
    if (settling) return;
    settling = true;
    void gameplay
      .settle()
      .catch(() => {})
      .finally(() => {
        settling = false;
      });
  }, 1000);
  lifecycleTimer.unref();
  const webAddress = web.address();
  if (!webAddress || typeof webAddress === "string")
    throw new Error("Missing HTTP address");
  let botStopRequested = false;
  let totalBotActions = 0;
  let recentBotActions = 0;
  let actionsPerSecond = 0;
  let rateMeasureTimer: NodeJS.Timeout | undefined;

  const getBotTelemetry = (schoolSlot?: number) => ({
    fixtureOnly: true,
    status: botStatus,
    activeBots: peers.length,
    totalActions: totalBotActions,
    actionsPerSecond: Math.round(actionsPerSecond * 10) / 10,
    schoolSlot: schoolSlot ?? 0,
    bots: peers
      .filter((p) => schoolSlot === undefined || p.school.slot === schoolSlot)
      .map((p) => ({
        role: p.role,
        applied: p.applied,
        noChange: p.noChange,
        rejected: p.rejected,
      })),
    schools: fixture.schools.map((s) => ({
      slot: s.slot,
      label: s.label,
      activeBots: peers.filter((p) => p.school.slot === s.slot).length,
      applied: peers
        .filter((p) => p.school.slot === s.slot)
        .reduce((sum, p) => sum + p.applied, 0),
    })),
  });

  const stopBots = async (): Promise<void> => {
    botStopRequested = true;
    botStatus = "stopping";
    if (rateMeasureTimer) {
      clearInterval(rateMeasureTimer);
      rateMeasureTimer = undefined;
    }
    await Promise.allSettled(peers.map((peer) => peer.close()));
    peers.length = 0;
    botStatus = "idle";
    botTask = undefined;
    actionsPerSecond = 0;
  };

  const startBots = async (
    params?:
      | number
      | {
          count?: number;
          speed?: "slow" | "realistic" | "fast";
          durationSeconds?: number;
        },
  ): Promise<void> => {
    if (portal) throw new Error("Bots are disabled in portal campaigns");
    if (botStatus === "running" || botStatus === "starting") return;
    botStopRequested = false;
    botStatus = "starting";
    const opts =
      typeof params === "number" ? { durationSeconds: params } : params;
    const requestedCount = Math.max(1, Math.min(opts?.count ?? 200, 200));
    const speed = opts?.speed ?? "realistic";
    const durationSeconds = opts?.durationSeconds ?? 3600;

    botTask = (async () => {
      const botActors = fixture.actors
        .filter(
          (a): a is SchoolPlayActor & { role: BotRole } => a.role !== "human",
        )
        .slice(0, requestedCount);
      let roomId: string | undefined;

      for (let i = 0; i < botActors.length; i += 25) {
        if (botStopRequested || stopped) break;
        const batch = botActors.slice(i, i + 25);
        await Promise.all(
          batch.map(async (actor) => {
            const peer = new BotPeer(
              `ws://127.0.0.1:${address.port}`,
              actor.token,
              fixture.schools[actor.schoolSlot]!,
              actor.role,
              (20261013 ^ actor.ordinal) >>> 0,
            );
            peers.push(peer);
            roomId = await peer.connect(roomId);
          }),
        );
        await pause(40);
      }

      if (botStopRequested || stopped) {
        await stopBots();
        return;
      }

      botStatus = "running";
      const deadline = performance.now() + durationSeconds * 1000;

      recentBotActions = 0;
      rateMeasureTimer = setInterval(() => {
        actionsPerSecond = recentBotActions;
        recentBotActions = 0;
      }, 1000);
      rateMeasureTimer.unref();

      await Promise.all(
        peers.map(async (peer) => {
          while (
            !botStopRequested &&
            !stopped &&
            performance.now() < deadline
          ) {
            const intent = peer.planner.next(peer.role);
            if (!intent) break;
            const begun = performance.now();
            try {
              const ack = await peer.explore(
                intent.tile,
                Uint8Array.from(
                  Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
                ),
              );
              totalBotActions++;
              recentBotActions++;
              if (ack.status === ACK_STATUS.REJECTED) {
                await pause(300);
              }
            } catch {
              // Graceful catch for transient network jitter
            }
            const baseWait =
              speed === "slow"
                ? 2500 + peer.planner.random() * 2500
                : speed === "fast"
                  ? 400 + peer.planner.random() * 500
                  : 1200 + peer.planner.random() * 1600;
            const elapsed = performance.now() - begun;
            const sleepMs = Math.max(50, baseWait - elapsed);
            await pause(
              Math.min(sleepMs, Math.max(0, deadline - performance.now())),
            );
          }
        }),
      );
      if (rateMeasureTimer) {
        clearInterval(rateMeasureTimer);
        rateMeasureTimer = undefined;
      }
      botStatus = "finished";
    })()
      .catch((err) => {
        console.error("Bot simulation error:", err);
        botStatus = "failed";
      })
      .finally(async () => {
        if (rateMeasureTimer) clearInterval(rateMeasureTimer);
        await Promise.allSettled(peers.map((peer) => peer.close()));
        peers.length = 0;
        if (botStatus !== "failed") botStatus = "idle";
        botTask = undefined;
      });
    return botTask;
  };
  const close = async (): Promise<void> => {
    clearInterval(lifecycleTimer);
    stopped = true;
    await stopBots();
    await new Promise<void>((ready) => {
      web.close(() => ready());
      web.closeIdleConnections();
    });
    realtime.core.stopRelay();
    await realtime.server.gracefullyShutdown(false);
  };
  return {
    fixture,
    accounts,
    realtime,
    webPort: webAddress.port,
    websocketPort: address.port,
    startBots,
    stopBots,
    getBotTelemetry,
    close,
  };
}
