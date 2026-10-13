import type { PoolClient } from "pg";
import type {
  RewardPreparationCommand,
  RewardReceipt,
} from "../../shared/rewards/commands.ts";
import type { CampaignBinding } from "./CampaignProvider.ts";
import { RewardPayloadConflict } from "./PgRewardPreparation.ts";
import type {
  PreparationResource,
  RewardWalletAdapter,
} from "./RewardWalletAdapter.ts";

const names: Readonly<Record<PreparationResource, string>> = {
  "fixture-points": "fixture-credit",
  "fixture-crystals": "fixture-crystals",
  "fixture-treasure-map": "fixture-treasure-map",
  "fixture-key": "fixture-key",
};
export class DevRewardWallet implements RewardWalletAdapter {
  readonly version = "shared-playable-v0" as const;
  async reserve(
    db: PoolClient,
    b: CampaignBinding,
    c: RewardPreparationCommand,
    hash: Buffer,
  ): Promise<void> {
    const key = Buffer.from(c.key.replaceAll("-", ""), "hex");
    const inserted = await db.query(
      "INSERT INTO r2pl_v2.command_results(campaign_id,actor_id,command_key,payload_hash,status) VALUES($1,$2,$3,$4,'processing') ON CONFLICT DO NOTHING RETURNING 1",
      [b.campaignId, b.actorId, key, hash],
    );
    if (inserted.rowCount !== 1) throw new RewardPayloadConflict();
    // Never grant into an unprovisioned playable actor account.
    const actor = await db.query(
      "SELECT 1 FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit' FOR UPDATE",
      [b.campaignId, b.actorId],
    );
    if (actor.rowCount !== 1)
      throw new RangeError("Playable actor not provisioned");
  }
  async keyBalance(db: PoolClient, b: CampaignBinding): Promise<bigint> {
    const row = (
      await db.query<{ balance: string }>(
        "SELECT balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-key' FOR UPDATE",
        [b.campaignId, b.actorId],
      )
    ).rows[0];
    return BigInt(row?.balance ?? "0");
  }
  async spendKey(db: PoolClient, b: CampaignBinding): Promise<void> {
    const spent = await db.query(
      "UPDATE r2pl_v2.wallet_accounts SET balance=balance-1 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-key' AND balance>=1 RETURNING 1",
      [b.campaignId, b.actorId],
    );
    if (spent.rowCount !== 1)
      throw new Error("Playable Key spend lost serialization");
  }
  async grant(
    db: PoolClient,
    b: CampaignBinding,
    resource: PreparationResource,
    amount: bigint,
  ): Promise<void> {
    await db.query(
      "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,balance) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,actor_id,resource) DO UPDATE SET balance=r2pl_v2.wallet_accounts.balance+EXCLUDED.balance",
      [b.campaignId, b.actorId, names[resource], amount.toString()],
    );
  }
  async ledger(
    db: PoolClient,
    b: CampaignBinding,
    c: RewardPreparationCommand,
    resource: PreparationResource,
    kind: "spend" | "grant",
    amount: bigint,
  ): Promise<void> {
    const key = Buffer.from(c.key.replaceAll("-", ""), "hex");
    const name = names[resource];
    await db.query(
      "INSERT INTO r2pl_prep.playable_reward_ledger(campaign_id,actor_id,command_key,resource,entry_kind,amount) VALUES($1,$2,$3,$4,$5,$6)",
      [b.campaignId, b.actorId, key, name, kind, amount.toString()],
    );
    const prior = (
      await db.query<{ amount: string }>(
        "SELECT amount::text FROM r2pl_v2.ledger_entries WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3 AND resource=$4 FOR UPDATE",
        [b.campaignId, b.actorId, key, name],
      )
    ).rows[0];
    const net = BigInt(prior?.amount ?? "0") + amount;
    // v0 ledger has one nonzero net row per command/resource. Detail ledger preserves spend and grant.
    if (net === 0n)
      await db.query(
        "DELETE FROM r2pl_v2.ledger_entries WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3 AND resource=$4",
        [b.campaignId, b.actorId, key, name],
      );
    else
      await db.query(
        "INSERT INTO r2pl_v2.ledger_entries(campaign_id,actor_id,command_key,resource,amount) VALUES($1,$2,$3,$4,$5) ON CONFLICT(campaign_id,actor_id,command_key,resource) DO UPDATE SET amount=EXCLUDED.amount",
        [b.campaignId, b.actorId, key, name, net.toString()],
      );
  }
  async finish(
    db: PoolClient,
    b: CampaignBinding,
    c: RewardPreparationCommand,
    receipt: RewardReceipt,
  ): Promise<void> {
    await db.query(
      "UPDATE r2pl_v2.command_results SET status=$4,result=$5 WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3",
      [
        b.campaignId,
        b.actorId,
        Buffer.from(c.key.replaceAll("-", ""), "hex"),
        receipt.status === "applied" ? "test_applied" : "rejected",
        JSON.stringify(receipt),
      ],
    );
  }
}
