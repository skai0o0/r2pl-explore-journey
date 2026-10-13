import type { PoolClient } from "pg";
import type {
  RewardPreparationCommand,
  RewardReceipt,
} from "../../shared/rewards/commands.ts";
import type { CampaignBinding } from "./CampaignProvider.ts";
export type PreparationResource =
  | "fixture-points"
  | "fixture-crystals"
  | "fixture-treasure-map"
  | "fixture-key";
/** Internal synthetic wallet boundary. Both wallet effects and reward receipt share one DB transaction. */
export interface RewardWalletAdapter {
  readonly version: "shared-playable-v0";
  reserve(
    db: PoolClient,
    binding: CampaignBinding,
    command: RewardPreparationCommand,
    hash: Buffer,
  ): Promise<void>;
  keyBalance(db: PoolClient, binding: CampaignBinding): Promise<bigint>;
  spendKey(db: PoolClient, binding: CampaignBinding): Promise<void>;
  grant(
    db: PoolClient,
    binding: CampaignBinding,
    resource: PreparationResource,
    amount: bigint,
  ): Promise<void>;
  ledger(
    db: PoolClient,
    binding: CampaignBinding,
    command: RewardPreparationCommand,
    resource: PreparationResource,
    kind: "spend" | "grant",
    amount: bigint,
  ): Promise<void>;
  finish(
    db: PoolClient,
    binding: CampaignBinding,
    command: RewardPreparationCommand,
    receipt: RewardReceipt,
  ): Promise<void>;
}
