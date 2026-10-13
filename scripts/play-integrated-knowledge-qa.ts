/** Opt-in QA bridge. Requires existing verified migrations 1-5; never migrates. */
import { randomUUID } from "node:crypto";
import type { RequestListener, Server } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  createKnowledgeQaServer,
  createPostgresKnowledgeQa,
} from "../server/qa/KnowledgeQaGatewayV1.ts";
import { createDurableSyntheticServer } from "../server/realtime/durableBootstrap.ts";
import { evaluateDevExplore } from "../shared/gameplay/devRules.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";
import { disposableDatabaseUrl } from "./migrate-m4d2.ts";

export function integratedDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (
    env.R2PL_DEV_PLAY !== "1" ||
    env.R2PL_M4D4_INTEGRATED_QA !== "1" ||
    !env.R2PL_TEST_DATABASE_URL
  )
    throw new Error(
      "Integrated QA requires both development flags and a disposable database",
    );
  return disposableDatabaseUrl(env.R2PL_TEST_DATABASE_URL);
}
export const m3Fixtures = [
  {
    token: "dawn-one",
    actorId: "90000000-0000-4000-8000-000000000001",
    schoolSlot: 0,
    name: "Dawn Explorer 1",
    schoolName: "Dawn University",
  },
  {
    token: "dawn-two",
    actorId: "90000000-0000-4000-8000-000000000002",
    schoolSlot: 0,
    name: "Dawn Explorer 2",
    schoolName: "Dawn University",
  },
  {
    token: "dusk-one",
    actorId: "90000000-0000-4000-8000-000000000003",
    schoolSlot: 15,
    name: "Dusk Explorer 1",
    schoolName: "Dusk University",
  },
  {
    token: "dusk-two",
    actorId: "90000000-0000-4000-8000-000000000004",
    schoolSlot: 15,
    name: "Dusk Explorer 2",
    schoolName: "Dusk University",
  },
] as const;

/** Intercept only the two bridge GET routes; all Knowledge validation remains in the gateway. */
export function attachIntegratedRoutes(
  server: Server,
  profile: (token: string | undefined) => Promise<unknown>,
): void {
  const listeners = server.listeners("request") as RequestListener[];
  server.removeAllListeners("request");
  server.on("request", (request, response) => {
    const originalHeader = response.setHeader.bind(response);
    response.setHeader = (name, value) =>
      originalHeader(
        name,
        name.toLowerCase() === "content-security-policy"
          ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:2567; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
          : value,
      );
    if (
      request.url !== "/api/qa/integrated-mode" &&
      request.url !== "/api/fixture/me"
    ) {
      for (const listener of listeners) listener(request, response);
      return;
    }
    const host = request.headers.host;
    if (
      request.socket.localAddress !== "127.0.0.1" ||
      request.socket.remoteAddress !== "127.0.0.1" ||
      !host ||
      !/^127\.0\.0\.1:\d+$/.test(host) ||
      (request.headers.origin && request.headers.origin !== `http://${host}`) ||
      request.headers["sec-fetch-site"] === "cross-site"
    ) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.url === "/api/qa/integrated-mode") {
      response.end(
        JSON.stringify({
          enabled: true,
          fixtureOnly: true,
          exploreEnabled: process.env.R2PL_M4FINAL_EXPLORE_QA === "1",
        }),
      );
      return;
    }
    void profile(request.headers.authorization?.replace(/^Bearer /, ""))
      .then((value) => {
        if (!value) {
          response.writeHead(401).end();
          return;
        }
        response.end(JSON.stringify(value));
      })
      .catch(() => response.writeHead(500).end());
  });
}

export async function playIntegratedKnowledgeQa(
  env: NodeJS.ProcessEnv = process.env,
): Promise<() => Promise<void>> {
  const connectionString = integratedDatabaseUrl(env);
  // Gateway verifies schema checksums before any M3 fixture is created.
  const knowledge = await createPostgresKnowledgeQa({
    ...env,
    NODE_EXTRA_CA_CERTS:
      env.NODE_EXTRA_CA_CERTS ??
      (new URL(connectionString).hostname === "localhost" ||
      new URL(connectionString).hostname === "127.0.0.1" ||
      new URL(connectionString).hostname === "[::1]"
        ? "local-disposable"
        : undefined),
  });
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    options: "-c search_path=r2pl_v2,pg_catalog",
  });
  let realtime:
    | Awaited<ReturnType<typeof createDurableSyntheticServer>>
    | undefined;
  let web: Server | undefined;
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (web?.listening)
      await new Promise<void>((resolve) => {
        web?.close(() => resolve());
        web?.closeIdleConnections();
      });
    realtime?.core.stopRelay();
    if (realtime) await realtime.server.gracefullyShutdown(false);
    await pool.end();
    await knowledge.close();
  };
  try {
    const campaignId = randomUUID();
    await pool.query(
      "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaignId, `m4d4-m3-${campaignId}`],
    );
    await pool.query(
      "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-dawn',0),($1,'fixture-dusk',15)",
      [campaignId],
    );
    for (const fixture of m3Fixtures)
      await pool.query(
        "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',30,30)",
        [campaignId, fixture.actorId],
      );
    realtime = await createDurableSyntheticServer(
      pool,
      campaignId,
      new SchoolRegistry([
        { id: "fixture-dawn", slot: 0 },
        { id: "fixture-dusk", slot: 15 },
      ]),
      m3Fixtures,
      1n,
      {},
      undefined,
      evaluateDevExplore,
    );
    await realtime.server.listen(2567, "127.0.0.1");
    web = createKnowledgeQaServer(
      knowledge.backend,
      fileURLToPath(new URL("../dist/client/", import.meta.url)),
    );
    attachIntegratedRoutes(web, async (token) => {
      const fixture = m3Fixtures.find((f) => f.token === token);
      if (!fixture) return undefined;
      const wallet = await pool.query<{ balance: string }>(
        "SELECT balance::text FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
        [campaignId, fixture.actorId],
      );
      return {
        name: fixture.name,
        schoolName: fixture.schoolName,
        schoolSlot: fixture.schoolSlot,
        balance: wallet.rows[0]?.balance ?? "0",
        cost: "1",
        fixtureOnly: true,
      };
    });
    await new Promise<void>((resolve, reject) => {
      web?.once("error", reject);
      web?.listen(4173, "127.0.0.1", resolve);
    });
    console.log(
      "M4-D4 synthetic integrated QA: http://127.0.0.1:4173 (M3 websocket 2567). Separate campaigns, fixture-credit / Points wallets, read-only Knowledge rings. Existing migrations 1-5 required.",
    );
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const stop = await playIntegratedKnowledgeQa();
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}
