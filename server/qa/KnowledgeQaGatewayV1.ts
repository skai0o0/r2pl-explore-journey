/** Local synthetic succession/contribution QA only. No Shared upkeep or M3 integration. */
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Pool } from "pg";
import { disposableDatabaseUrl } from "../../scripts/migrate-m4d2.ts";
import { WORLD_TILE_COUNT } from "../../shared/world/constants.ts";
import {
  KnowledgeCaseStoreV1,
  type KnowledgeReceiptV1,
} from "../persistence/KnowledgeCaseStoreV1.ts";
import {
  KnowledgeDeadlineSchedulerV1,
  PostgresKnowledgeDueCaseRepositoryV1,
} from "../persistence/KnowledgeDeadlineSchedulerV1.ts";
import { KnowledgeOwnershipProjectorV1 } from "../persistence/KnowledgeOwnershipProjectorV1.ts";
import { IdempotencyConflict } from "../persistence/M3TestMutation.ts";

export interface QaFixtureV1 {
  token: string;
  label: string;
  schoolSlot: number;
  actorId: string;
}
export interface QaStateV1 {
  campaignId: string;
  viewer: { label: string; schoolSlot: number };
  walletPoints: string;
  case: null | {
    caseId: string;
    status: string;
    revision: number;
    requiredPoints: string;
    receivedPoints: string;
    remainingPoints: string;
    rollingDeadlineMs: string;
    hardDeadlineMs: string;
  };
  tiles: { tileIndex: number; schoolSlots: number[] }[];
  scores: { schoolSlot: number; score: string }[];
  projectionPending: boolean;
  updatedAtMs: number;
}
/** Dependency seam for HTTP validation tests; the runnable entry point always uses PostgreSQL. */
export interface QaBackendV1 {
  fixtures: readonly QaFixtureV1[];
  state(fixture: QaFixtureV1): Promise<QaStateV1>;
  start(): Promise<KnowledgeReceiptV1>;
  contribute(
    fixture: QaFixtureV1,
    input: { caseId: string; contributionId: string; points: string },
  ): Promise<KnowledgeReceiptV1>;
  sync(): Promise<void>;
}
class HttpFailure extends Error {
  readonly status: number;
  constructor(status: number) {
    super("QA request rejected");
    this.status = status;
  }
}
export function qaDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (
    env.R2PL_DEV_PLAY !== "1" ||
    !env.R2PL_TEST_DATABASE_URL ||
    !env.NODE_EXTRA_CA_CERTS
  )
    throw new Error(
      "QA requires development opt-in, disposable database URL and NODE_EXTRA_CA_CERTS",
    );
  try {
    return disposableDatabaseUrl(env.R2PL_TEST_DATABASE_URL);
  } catch {
    throw new Error("Disallowed QA database configuration");
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new HttpFailure(400);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 4096) throw new HttpFailure(413);
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpFailure(400);
  }
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new HttpFailure(400);
}
function receipt(value: KnowledgeReceiptV1): KnowledgeReceiptV1 {
  return {
    kind: value.kind,
    reason: value.reason,
    acceptedPoints: value.acceptedPoints,
    revision: value.revision,
    status: value.status,
  };
}
export function createKnowledgeQaServer(
  backend: QaBackendV1,
  staticRoot: string,
): Server {
  const root = resolve(staticRoot);
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (status: number, value: unknown): void => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(value));
    };
    try {
      const host = request.headers.host;
      if (
        request.socket.localAddress !== "127.0.0.1" ||
        request.socket.remoteAddress !== "127.0.0.1" ||
        !host ||
        !/^127\.0\.0\.1:\d+$/.test(host)
      )
        throw new HttpFailure(403);
      if (request.headers.origin && request.headers.origin !== `http://${host}`)
        throw new HttpFailure(403);
      if (request.headers["sec-fetch-site"] === "cross-site")
        throw new HttpFailure(403);
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (url.host !== host || url.search) throw new HttpFailure(400);
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/qa/fixtures" && request.method === "GET") {
          send(200, {
            fixtures: backend.fixtures.map(({ token, label, schoolSlot }) => ({
              token,
              label,
              schoolSlot,
            })),
          });
          return;
        }
        const fixture = backend.fixtures.find(
          (item) => item.token === request.headers["x-qa-token"],
        );
        if (!fixture) throw new HttpFailure(401);
        if (url.pathname === "/api/qa/state" && request.method === "GET") {
          send(200, await backend.state(fixture));
          return;
        }
        if (request.method !== "POST") throw new HttpFailure(405);
        const input = await body(request);
        if (url.pathname === "/api/qa/scenario/start") {
          keys(input, []);
          if (fixture.schoolSlot !== 0) throw new HttpFailure(403);
          const result = await backend.start();
          send(200, {
            receipt: receipt(result),
            state: await backend.state(fixture),
          });
          return;
        }
        if (url.pathname === "/api/qa/knowledge/contribute") {
          keys(input, ["caseId", "contributionId", "points"]);
          if (
            typeof input.caseId !== "string" ||
            !uuid.test(input.caseId) ||
            typeof input.contributionId !== "string" ||
            !uuid.test(input.contributionId) ||
            typeof input.points !== "string" ||
            !/^(?:[1-9]|[1-4][0-9]|50)$/.test(input.points)
          )
            throw new HttpFailure(400);
          const result = await backend.contribute(fixture, {
            caseId: input.caseId,
            contributionId: input.contributionId,
            points: input.points,
          });
          send(200, {
            receipt: receipt(result),
            state: await backend.state(fixture),
          });
          return;
        }
        if (url.pathname === "/api/qa/sync") {
          keys(input, []);
          await backend.sync();
          send(200, await backend.state(fixture));
          return;
        }
        throw new HttpFailure(404);
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        throw new HttpFailure(405);
      const pathname = decodeURIComponent(url.pathname);
      if (
        pathname.includes("\\") ||
        pathname.includes("\0") ||
        pathname.split("/").includes("..")
      )
        throw new HttpFailure(403);
      const file = resolve(
        root,
        `.${pathname === "/" ? "/index.html" : pathname}`,
      );
      if (!file.startsWith(`${root}${sep}`)) throw new HttpFailure(403);
      try {
        const [actualRoot, actualFile] = await Promise.all([
          realpath(root),
          realpath(file),
        ]);
        if (!actualFile.startsWith(`${actualRoot}${sep}`))
          throw new HttpFailure(403);
        const bytes = await readFile(actualFile);
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
        };
        response.writeHead(200, {
          "Content-Type": types[extname(file)] ?? "application/octet-stream",
        });
        response.end(request.method === "HEAD" ? undefined : bytes);
      } catch (error) {
        if (error instanceof HttpFailure) throw error;
        throw new HttpFailure(404);
      }
    } catch (error) {
      send(
        error instanceof HttpFailure
          ? error.status
          : error instanceof IdempotencyConflict
            ? 409
            : 500,
        {
          error:
            error instanceof IdempotencyConflict
              ? "Contribution key conflict"
              : "QA request failed",
        },
      );
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

export async function createPostgresKnowledgeQa(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ backend: QaBackendV1; close(): Promise<void> }> {
  const pool = new Pool({
    connectionString: qaDatabaseUrl(env),
    max: 6,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    options: "-c search_path=r2pl_v2,pg_catalog",
  });
  try {
    const files = [
      "001_m3_foundation.sql",
      "002_m35_view_revisions.sql",
      "003_m4d2_knowledge_durable.sql",
      "004_m4d3_knowledge_projection.sql",
      "005_m4d3b_shared_upkeep.sql",
    ];
    for (const [index, file] of files.entries()) {
      const sql = (
        await readFile(
          new URL(`../../database/migrations/${file}`, import.meta.url),
          "utf8",
        )
      ).replace(/\r\n/g, "\n");
      const result = await pool.query<{ sha256: Buffer }>(
        "SELECT sha256 FROM schema_migrations WHERE version=$1",
        [index + 1],
      );
      if (
        !result.rows[0]?.sha256.equals(
          createHash("sha256").update(sql).digest(),
        )
      )
        throw new Error("QA migrations 1-5 must be installed and verified");
    }
    const campaignId = randomUUID();
    const fixtures = [0, 1].map((schoolSlot) => ({
      schoolSlot,
      actorId: randomUUID(),
      token: randomBytes(32).toString("hex"),
      label:
        schoolSlot === 0
          ? "Synthetic training operator (school 0)"
          : "Synthetic claimant (school 1)",
    }));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
        [campaignId, `m4d3c-qa-${campaignId}`],
      );
      for (const fixture of fixtures) {
        await client.query(
          "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,$2,$3)",
          [campaignId, `synthetic-${randomUUID()}`, fixture.schoolSlot],
        );
        await client.query(
          "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'points',50,50)",
          [campaignId, fixture.actorId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const store = new KnowledgeCaseStoreV1(pool, {
      developmentOnly: true,
      identity: async (_client, campaign, actor) => {
        const fixture =
          campaign === campaignId
            ? fixtures.find((item) => item.actorId === actor)
            : undefined;
        return { verified: !!fixture, schoolSlot: fixture?.schoolSlot ?? -1 };
      },
    });
    const projector = new KnowledgeOwnershipProjectorV1(pool, {
      developmentOnly: true,
    });
    const scheduler = new KnowledgeDeadlineSchedulerV1(
      new PostgresKnowledgeDueCaseRepositoryV1(pool),
      store,
      { developmentOnly: true },
    );
    let currentCase: string | null = null;
    let starting = false;
    const backend: QaBackendV1 = {
      fixtures,
      async start() {
        if (starting) throw new HttpFailure(409);
        starting = true;
        try {
          if (currentCase) {
            const prior = await pool.query<{ status: string }>(
              "SELECT status FROM knowledge_cases_v1 WHERE campaign_id=$1 AND case_id=$2",
              [campaignId, currentCase],
            );
            if (prior.rows[0]?.status === "claiming")
              throw new HttpFailure(409);
          }
          const caseId = randomUUID();
          const used = await pool.query<{ tile_index: number }>(
            "SELECT tile_index FROM knowledge_ownership_tiles_v1 WHERE campaign_id=$1 UNION SELECT (t->>'tileIndex')::integer FROM knowledge_cases_v1, jsonb_array_elements(snapshot->'tiles') t WHERE campaign_id=$1",
            [campaignId],
          );
          const occupied = new Set(used.rows.map((row) => row.tile_index));
          const tiles: { tileIndex: number; incumbentSchoolSlot: number }[] =
            [];
          let cursor = randomInt(WORLD_TILE_COUNT);
          for (
            let attempts = 0;
            tiles.length < 3 && attempts < WORLD_TILE_COUNT;
            attempts++, cursor = (cursor + 1) % WORLD_TILE_COUNT
          )
            if (!occupied.has(cursor))
              tiles.push({
                tileIndex: cursor,
                incumbentSchoolSlot: tiles.length === 2 ? 1 : 0,
              });
          if (tiles.length !== 3) throw new HttpFailure(409);
          const result = await store.open({
            campaignId,
            caseId,
            contestId: randomUUID(),
            schoolSlots: [0, 1],
            departingSchoolSlot: 0,
            tiles,
          });
          currentCase = caseId;
          return result;
        } finally {
          starting = false;
        }
      },
      async contribute(fixture, input) {
        if (input.caseId !== currentCase) throw new HttpFailure(404);
        return store.contribute({
          campaignId,
          caseId: input.caseId,
          contributionId: input.contributionId,
          actorId: fixture.actorId,
          requestedPoints: BigInt(input.points),
        });
      },
      async sync() {
        const tick = await scheduler.tick(campaignId, {
          expiryLimit: 4,
          refundLimit: 4,
        });
        if (tick.expiryFailed) throw new Error("QA settlement pending");
        for (let cycle = 0; cycle < 8; cycle++)
          if (!(await projector.projectNext(campaignId))) break;
      },
      async state(fixture) {
        const visibleCase = currentCase;
        const connection = await pool.connect();
        try {
          await connection.query(
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
          );
          const wallet = await connection.query<{ balance: string }>(
            "SELECT balance::text FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='points'",
            [campaignId, fixture.actorId],
          );
          const cases = await connection.query<{
            status: string;
            revision: string;
            required_points: string;
            received_points: string;
            rolling_deadline_ms: string;
            hard_deadline_ms: string;
          }>(
            "SELECT status,revision::text,required_points::text,received_points::text,rolling_deadline_ms::text,hard_deadline_ms::text FROM knowledge_cases_v1 WHERE campaign_id=$1 AND case_id=$2",
            [campaignId, visibleCase],
          );
          const tiles = await connection.query<{
            tile_index: number;
            active_school_mask: number;
          }>(
            "SELECT tile_index,active_school_mask FROM knowledge_ownership_tiles_v1 WHERE campaign_id=$1 ORDER BY tile_index",
            [campaignId],
          );
          const scores = await connection.query<{
            school_slot: number;
            score: string;
          }>(
            "SELECT school_slot,active_tiles::text AS score FROM knowledge_school_scores_v1 WHERE campaign_id=$1 AND school_slot IN (0,1) ORDER BY school_slot",
            [campaignId],
          );
          const pending = await connection.query<{ pending: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM knowledge_effect_outbox_v1 o WHERE campaign_id=$1 AND NOT EXISTS(SELECT 1 FROM knowledge_projection_acks_v1 a WHERE (a.campaign_id,a.case_id,a.revision)=(o.campaign_id,o.case_id,o.revision))) AS pending",
            [campaignId],
          );
          await connection.query("COMMIT");
          const row = cases.rows[0];
          return {
            campaignId,
            viewer: { label: fixture.label, schoolSlot: fixture.schoolSlot },
            walletPoints: wallet.rows[0]?.balance ?? "0",
            case:
              row && visibleCase
                ? {
                    caseId: visibleCase,
                    status: row.status,
                    revision: Number(row.revision),
                    requiredPoints: row.required_points,
                    receivedPoints: row.received_points,
                    remainingPoints: (
                      BigInt(row.required_points) - BigInt(row.received_points)
                    ).toString(),
                    rollingDeadlineMs: row.rolling_deadline_ms,
                    hardDeadlineMs: row.hard_deadline_ms,
                  }
                : null,
            tiles: tiles.rows.map((row) => ({
              tileIndex: row.tile_index,
              schoolSlots: [0, 1].filter(
                (slot) => (row.active_school_mask & (1 << slot)) !== 0,
              ),
            })),
            scores: [0, 1].map((slot) => ({
              schoolSlot: slot,
              score:
                scores.rows.find((row) => row.school_slot === slot)?.score ??
                "0",
            })),
            projectionPending: pending.rows[0]!.pending,
            updatedAtMs: Date.now(),
          };
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        } finally {
          connection.release();
        }
      },
    };
    return { backend, close: () => pool.end() };
  } catch {
    await pool.end();
    throw new Error(
      "QA database startup failed; verify disposable configuration and migrations 1-5",
    );
  }
}
