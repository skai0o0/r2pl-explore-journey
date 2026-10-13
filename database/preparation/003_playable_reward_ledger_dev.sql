-- Playable synthetic reward detail ledger ONLY; not a production migration.
-- Net balances/ledger use the existing r2pl_v2 wallet. Keep spend/grant detail when net is zero.
CREATE TABLE IF NOT EXISTS r2pl_prep.playable_reward_ledger (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_key bytea NOT NULL CHECK (octet_length(command_key)=16),
  resource text NOT NULL CHECK (resource IN ('fixture-credit','fixture-crystals','fixture-treasure-map','fixture-key')),
  entry_kind text NOT NULL CHECK (entry_kind IN ('spend','grant')),
  amount bigint NOT NULL CHECK ((entry_kind='spend' AND amount<0) OR (entry_kind='grant' AND amount>0)),
  PRIMARY KEY(campaign_id,actor_id,command_key,resource,entry_kind),
  FOREIGN KEY(campaign_id,actor_id,command_key) REFERENCES r2pl_v2.command_results(campaign_id,actor_id,command_key),
  FOREIGN KEY(campaign_id,actor_id,resource) REFERENCES r2pl_v2.wallet_accounts(campaign_id,actor_id,resource)
);
REVOKE ALL ON r2pl_prep.playable_reward_ledger FROM PUBLIC;
ALTER TABLE r2pl_prep.playable_reward_ledger ENABLE ROW LEVEL SECURITY;
