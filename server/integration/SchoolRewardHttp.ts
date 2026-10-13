import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { Pool } from "pg";
import {
  type RewardProfile,
  UNISTOP_REFERENCE,
} from "../../shared/rewards/catalog.ts";
import {
  parseRewardCommand,
  REWARD_PREPARATION_VERSION,
  type RewardReceipt,
} from "../../shared/rewards/commands.ts";
import { uniStopAvailability } from "../../shared/rewards/reference.ts";
import { DevRewardWallet } from "./DevRewardWallet.ts";
import {
  PgRewardPreparation,
  RewardPayloadConflict,
} from "./PgRewardPreparation.ts";
import type { SchoolPlayFixture } from "./SchoolPlayFixture.ts";
import { schoolRewardBinding } from "./SchoolRewardFixture.ts";

class BadRewardRequest extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Invalid dev reward request");
    this.status = status;
  }
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new BadRewardRequest(415);
  return new Promise((resolve, reject) => {
    let size = 0;
    let rejected = false;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) {
        rejected = true;
        chunks.length = 0;
        reject(new BadRewardRequest(413));
      } else if (!rejected) chunks.push(chunk);
    });
    request.once("end", () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new BadRewardRequest(400));
      }
    });
    request.once("error", () => reject(new BadRewardRequest(400)));
  });
}
/** Same-origin synthetic HTTP adapter only. Binary v1 stays unchanged. */
export class SchoolRewardHttp {
  readonly #pool: Pool;
  readonly #fixture: SchoolPlayFixture;
  readonly #rewards: PgRewardPreparation;
  readonly #limits = new Map<string, { tokens: number; at: number }>();
  constructor(pool: Pool, fixture: SchoolPlayFixture) {
    this.#pool = pool;
    this.#fixture = fixture;
    this.#rewards = new PgRewardPreparation(pool, {
      mode: "synthetic-preparation",
      ruleVersion: REWARD_PREPARATION_VERSION,
      wallet: new DevRewardWallet(),
    });
  }
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    token: string | undefined,
  ): Promise<void> {
    const b = schoolRewardBinding(this.#fixture, token);
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(
        request.method === "HEAD" ? undefined : JSON.stringify(value),
      );
    };
    if (!b) {
      json({ error: "UNAUTHORIZED" }, 401);
      return;
    }
    try {
      if (
        url.pathname === "/api/fixture/rewards" &&
        request.method === "POST"
      ) {
        if (
          request.headers.origin &&
          request.headers.origin !== `http://${request.headers.host}`
        )
          throw new BadRewardRequest(403);
        const now = performance.now();
        const limit = this.#limits.get(b.actorId) ?? { tokens: 20, at: now };
        limit.tokens = Math.min(20, limit.tokens + (now - limit.at) * 0.002);
        limit.at = now;
        this.#limits.set(b.actorId, limit);
        if (limit.tokens < 1) throw new BadRewardRequest(429);
        limit.tokens--;
        const command = parseRewardCommand(await body(request));
        json({ fixtureOnly: true, ...(await this.#rewards.apply(b, command)) });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        throw new BadRewardRequest(405);
      if (url.pathname === "/api/fixture/rewards") {
        const rows = (
          await this.#pool.query<{
            target_id: string;
            kind: "unistop" | "chest";
            profile: RewardProfile | null;
            last_used_at_ms: string | null;
            claimed: boolean;
          }>(
            "SELECT t.target_id,t.kind,t.profile,c.last_used_at_ms::text,(q.target_id IS NOT NULL) AS claimed FROM r2pl_prep.reward_discoveries d JOIN r2pl_prep.reward_targets t ON t.campaign_id=d.campaign_id AND t.target_id=d.target_id LEFT JOIN r2pl_prep.reward_cooldowns c ON c.campaign_id=d.campaign_id AND c.actor_id=d.actor_id AND c.target_id=d.target_id LEFT JOIN r2pl_prep.reward_chest_claims q ON q.campaign_id=d.campaign_id AND q.target_id=d.target_id WHERE d.campaign_id=$1 AND d.actor_id=$2 ORDER BY t.target_id",
            [b.campaignId, b.actorId],
          )
        ).rows;
        const now = Number(
          (
            await this.#pool.query<{ now: string }>(
              "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint::text AS now",
            )
          ).rows[0]!.now,
        );
        json({
          fixtureOnly: true,
          ruleVersion: REWARD_PREPARATION_VERSION,
          targets: rows.map((row) => {
            const pending = row.profile
              ? UNISTOP_REFERENCE[row.profile].outcomes.some(
                  (x) => x.kind === "gift" && x.weight > 0,
                )
              : false;
            const availability = row.profile
              ? uniStopAvailability(
                  row.profile,
                  row.last_used_at_ms === null
                    ? null
                    : Number(row.last_used_at_ms),
                  now,
                )
              : null;
            return {
              targetId: row.target_id,
              kind: row.kind,
              profile: row.profile,
              policyPending: pending,
              claimed: row.claimed,
              available:
                !pending && !row.claimed && (availability?.available ?? true),
              nextAvailableAtMs: availability?.nextAvailableAtMs ?? null,
            };
          }),
        });
        return;
      }
      if (url.pathname === "/api/fixture/rewards/events") {
        const after = url.searchParams.get("after") ?? "0";
        if (
          !/^(0|[1-9][0-9]{0,18})$/.test(after) ||
          BigInt(after) > 9223372036854775807n
        )
          throw new BadRewardRequest(400);
        const events = (
          await this.#pool.query<{ id: string; payload: RewardReceipt }>(
            "SELECT id::text,payload FROM r2pl_prep.reward_outbox WHERE campaign_id=$1 AND actor_id=$2 AND id>$3 ORDER BY id LIMIT 50",
            [b.campaignId, b.actorId, after],
          )
        ).rows;
        json({
          fixtureOnly: true,
          events: events.map((e) => ({ id: e.id, receipt: e.payload })),
          nextCursor: events.at(-1)?.id ?? after,
        });
        return;
      }
      throw new BadRewardRequest(404);
    } catch (error) {
      if (error instanceof BadRewardRequest)
        json({ error: "INVALID_REQUEST" }, error.status);
      else if (error instanceof RewardPayloadConflict)
        json({ error: "IDEMPOTENCY_CONFLICT" }, 409);
      else if (error instanceof TypeError || error instanceof RangeError)
        json({ error: "INVALID_COMMAND" }, 400);
      else json({ error: "TEMPORARILY_UNAVAILABLE" }, 503);
    }
  }
}
