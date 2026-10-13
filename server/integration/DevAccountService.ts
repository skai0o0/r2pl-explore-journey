import type { Pool } from "pg";
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
    cost: string;
    fixtureOnly: true;
    resource: "fixture-credit";
    openingBalance: string;
    ledgerNet: string;
    ledgerConserved: boolean;
  } | null> {
    const actor = token ? this.#actors.get(token) : undefined;
    if (!actor) return null;
    const row = (
      await this.#pool.query<{
        balance: string;
        opening_balance: string;
        ledger_net: string;
      }>(
        "SELECT balance::text,opening_balance::text,COALESCE((SELECT sum(amount) FROM r2pl_v2.ledger_entries l WHERE l.campaign_id=w.campaign_id AND l.actor_id=w.actor_id AND l.resource=w.resource),0)::text AS ledger_net FROM r2pl_v2.wallet_accounts w JOIN r2pl_v2.campaign_schools s ON s.campaign_id=w.campaign_id AND s.slot=$3 WHERE w.campaign_id=$1 AND w.actor_id=$2 AND w.resource='fixture-credit'",
        [this.#campaignId, actor.actorId, actor.schoolSlot],
      )
    ).rows[0];
    if (!row) return null;
    return {
      name: actor.name,
      schoolName: actor.schoolName,
      schoolSlot: actor.schoolSlot,
      balance: row.balance,
      cost: "1",
      fixtureOnly: true,
      resource: "fixture-credit",
      openingBalance: row.opening_balance,
      ledgerNet: row.ledger_net,
      ledgerConserved:
        BigInt(row.balance) ===
        BigInt(row.opening_balance) + BigInt(row.ledger_net),
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
        "SELECT c.status,'fixture-credit'::text AS resource,COALESCE(l.amount,0)::text AS amount FROM r2pl_v2.command_results c LEFT JOIN r2pl_v2.ledger_entries l ON l.campaign_id=c.campaign_id AND l.actor_id=c.actor_id AND l.command_key=c.command_key AND l.resource='fixture-credit' WHERE c.campaign_id=$1 AND c.actor_id=$2 ORDER BY c.created_at DESC LIMIT 10",
        [this.#campaignId, actor.actorId],
      )
    ).rows;
  }
}
