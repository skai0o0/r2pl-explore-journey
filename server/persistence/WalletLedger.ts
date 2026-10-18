import type { PoolClient } from "pg";

/** Net one resource per command; cancel exact offsets without inserting forbidden zero rows. */
export async function recordLedger(
  db: PoolClient,
  campaign: string,
  actor: string,
  key: Buffer,
  resource: string,
  amount: number | bigint,
): Promise<void> {
  if (BigInt(amount) === 0n) return;
  await db.query(
    `WITH cancelled AS (
      DELETE FROM r2pl_v2.ledger_entries WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3 AND resource=$4 AND amount=-$5::bigint RETURNING 1
    ) INSERT INTO r2pl_v2.ledger_entries(campaign_id,actor_id,command_key,resource,amount)
      SELECT $1,$2,$3,$4,$5::bigint WHERE NOT EXISTS(SELECT 1 FROM cancelled)
      ON CONFLICT(campaign_id,actor_id,command_key,resource) DO UPDATE SET amount=ledger_entries.amount+EXCLUDED.amount`,
    [campaign, actor, key, resource, amount.toString()],
  );
}
