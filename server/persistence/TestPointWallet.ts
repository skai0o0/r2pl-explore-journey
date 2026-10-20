import type { Pool, PoolClient } from "pg";
export interface PointWalletTarget {
  readonly table: "r2pl_v2.wallet_accounts" | "r2pl_v2.test_point_pools";
  readonly actorId: string;
  readonly pooled: boolean;
}
/** Resolve only server-owned test membership; ordinary users keep their private wallet.
 * Older synthetic foundation databases intentionally do not install Portal tables. */
export async function pointWalletTarget(
  db: Pool | PoolClient,
  campaign: string,
  actor: string,
): Promise<PointWalletTarget> {
  const schema = await db.query<{ ready: boolean }>(
    "SELECT to_regclass('r2pl_v2.test_point_pools') IS NOT NULL AS ready",
  );
  if (schema.rows[0]?.ready) {
    const row = (
      await db.query<{ actor_id: string }>(
        "SELECT w.actor_id FROM r2pl_v2.partner_test_profiles p LEFT JOIN r2pl_v2.test_point_pools w USING(campaign_id,school_slot) WHERE p.campaign_id=$1 AND p.actor_id=$2",
        [campaign, actor],
      )
    ).rows[0];
    if (row && !row.actor_id) throw new Error("Missing shared test point pool");
    if (row)
      return {
        table: "r2pl_v2.test_point_pools",
        actorId: row.actor_id,
        pooled: true,
      };
  }
  return { table: "r2pl_v2.wallet_accounts", actorId: actor, pooled: false };
}
