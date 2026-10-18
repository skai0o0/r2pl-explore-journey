import type { Pool } from "pg";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
export interface DevIdentity {
  readonly token: string;
  readonly actorId: string;
  readonly schoolSlot: number;
  readonly name: string;
  readonly schoolName: string;
}
/** Read-only actor-private account projection over the existing durable v0 wallet. */
export class DevAccountService {
  readonly #pool: Pool;
  readonly #campaignId: string;
  readonly #actors: ReadonlyMap<string, DevIdentity>;
  constructor(pool: Pool, campaignId: string, actors: readonly DevIdentity[]) {
    if (new Set(actors.map((a) => a.token)).size !== actors.length)
      throw new RangeError("Duplicate dev identity");
    this.#pool = pool;
    this.#campaignId = campaignId;
    this.#actors = new Map(actors.map((a) => [a.token, a]));
  }
  async profile(token: string | undefined): Promise<{
    name: string;
    schoolName: string;
    schoolSlot: number;
    balance: string;
    hasSpentPoints: boolean;
    cost: string;
    fixtureOnly: true;
    resource: "fixture-credit";
    openingBalance: string;
    ledgerNet: string;
    ledgerConserved: boolean;
    inventory: {
      credits: string;
      crystals: string;
      treasureMaps: string;
      keys: string;
    };
  } | null> {
    const actor = token ? this.#actors.get(token) : undefined;
    if (!actor) return null;
    const rows = (
      await this.#pool.query<{
        resource: string;
        balance: string;
        opening_balance: string;
        ledger_net: string;
        has_spent_points: boolean;
      }>(
        "SELECT w.resource,w.balance::text,w.opening_balance::text,COALESCE((SELECT sum(amount) FROM r2pl_v2.ledger_entries l WHERE l.campaign_id=w.campaign_id AND l.actor_id=w.actor_id AND l.resource=w.resource),0)::text AS ledger_net,EXISTS(SELECT 1 FROM r2pl_v2.ledger_entries spent WHERE spent.campaign_id=w.campaign_id AND spent.actor_id=w.actor_id AND spent.resource='fixture-credit' AND spent.amount<0) AS has_spent_points FROM r2pl_v2.wallet_accounts w JOIN r2pl_v2.campaign_schools s ON s.campaign_id=w.campaign_id AND s.slot=$3 WHERE w.campaign_id=$1 AND w.actor_id=$2 AND w.resource IN ('fixture-credit','fixture-crystals','fixture-treasure-map','fixture-key','key-aspire','key-nitro','key-predator')",
        [this.#campaignId, actor.actorId, actor.schoolSlot],
      )
    ).rows;
    const row = rows.find((r) => r.resource === "fixture-credit");
    const balance = (resource: string) =>
      rows.find((r) => r.resource === resource)?.balance ?? "0";
    if (!row) return null;
    return {
      name: actor.name,
      schoolName: actor.schoolName,
      schoolSlot: actor.schoolSlot,
      balance: row.balance,
      hasSpentPoints: row.has_spent_points,
      cost: String(GAME_CONFIG.knowledge.explorePoints),
      fixtureOnly: true,
      resource: "fixture-credit",
      openingBalance: row.opening_balance,
      ledgerNet: row.ledger_net,
      ledgerConserved: rows.every(
        (r) =>
          BigInt(r.balance) ===
          BigInt(r.opening_balance) + BigInt(r.ledger_net),
      ),
      inventory: {
        credits: balance("fixture-credit"),
        crystals: balance("fixture-crystals"),
        treasureMaps: balance("fixture-treasure-map"),
        keys: balance("fixture-key"),
      },
    };
  }
  async receipts(
    token: string | undefined,
  ): Promise<
    readonly { status: string; resource: string; amount: string }[] | null
  > {
    const actor = token ? this.#actors.get(token) : undefined;
    if (!actor || !(await this.profile(token))) return null;
    return (
      await this.#pool.query<{
        status: string;
        resource: string;
        amount: string;
      }>(
        "SELECT c.status,COALESCE(l.resource,'fixture-credit')::text AS resource,COALESCE(l.amount,0)::text AS amount FROM r2pl_v2.command_results c LEFT JOIN r2pl_v2.ledger_entries l ON l.campaign_id=c.campaign_id AND l.actor_id=c.actor_id AND l.command_key=c.command_key WHERE c.campaign_id=$1 AND c.actor_id=$2 ORDER BY c.created_at DESC LIMIT 10",
        [this.#campaignId, actor.actorId],
      )
    ).rows;
  }
}
