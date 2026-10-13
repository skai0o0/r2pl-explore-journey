-- Synthetic rewards ONLY. Never included in the live migration chain.
-- Requires preparation/001_running_sync_dev.sql for server-provisioned bindings.
CREATE TABLE IF NOT EXISTS r2pl_prep.reward_targets (
  campaign_id uuid NOT NULL,
  target_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('unistop','chest')),
  rule_version text NOT NULL CHECK (rule_version = 'fixture-rewards-v1'),
  profile text CHECK (profile IN ('aspire','nitro','predator')),
  fixed_reward jsonb,
  PRIMARY KEY (campaign_id,target_id),
  CHECK ((kind='unistop' AND profile IS NOT NULL AND fixed_reward IS NULL) OR
         (kind='chest' AND profile IS NULL AND fixed_reward IS NOT NULL))
);
CREATE OR REPLACE FUNCTION r2pl_prep.reward_catalog_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Fixture reward configuration is immutable; publish a new target'; END;
$$;
DROP TRIGGER IF EXISTS reward_catalog_immutable ON r2pl_prep.reward_targets;
CREATE TRIGGER reward_catalog_immutable BEFORE UPDATE ON r2pl_prep.reward_targets
FOR EACH ROW EXECUTE FUNCTION r2pl_prep.reward_catalog_immutable();
CREATE TABLE IF NOT EXISTS r2pl_prep.reward_discoveries (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  target_id text NOT NULL,
  PRIMARY KEY (campaign_id,actor_id,target_id),
  FOREIGN KEY (campaign_id,actor_id) REFERENCES r2pl_prep.running_bindings(campaign_id,actor_id),
  FOREIGN KEY (campaign_id,target_id) REFERENCES r2pl_prep.reward_targets(campaign_id,target_id)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.reward_accounts (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  resource text NOT NULL CHECK (resource IN ('fixture-points','fixture-crystals','fixture-treasure-map','fixture-key')),
  opening_balance bigint NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  balance bigint NOT NULL CHECK (balance >= 0),
  PRIMARY KEY (campaign_id,actor_id,resource),
  FOREIGN KEY (campaign_id,actor_id) REFERENCES r2pl_prep.running_bindings(campaign_id,actor_id)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.reward_receipts (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_key uuid NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash)=32),
  roll_ticket smallint CHECK (roll_ticket BETWEEN 0 AND 999),
  result jsonb NOT NULL,
  PRIMARY KEY (campaign_id,actor_id,command_key),
  FOREIGN KEY (campaign_id,actor_id) REFERENCES r2pl_prep.running_bindings(campaign_id,actor_id)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.reward_cooldowns (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  target_id text NOT NULL,
  last_used_at_ms bigint NOT NULL CHECK (last_used_at_ms>=0),
  PRIMARY KEY (campaign_id,actor_id,target_id),
  FOREIGN KEY (campaign_id,actor_id,target_id) REFERENCES r2pl_prep.reward_discoveries(campaign_id,actor_id,target_id)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.reward_chest_claims (
  campaign_id uuid NOT NULL,
  target_id text NOT NULL,
  actor_id uuid NOT NULL,
  command_key uuid NOT NULL,
  PRIMARY KEY (campaign_id,target_id),
  FOREIGN KEY (campaign_id,target_id) REFERENCES r2pl_prep.reward_targets(campaign_id,target_id),
  FOREIGN KEY (campaign_id,actor_id,command_key) REFERENCES r2pl_prep.reward_receipts(campaign_id,actor_id,command_key)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.reward_ledger (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_key uuid NOT NULL,
  resource text NOT NULL,
  entry_kind text NOT NULL CHECK (entry_kind IN ('spend','grant')),
  amount bigint NOT NULL CHECK ((entry_kind='spend' AND amount<0) OR (entry_kind='grant' AND amount>0)),
  PRIMARY KEY (campaign_id,actor_id,command_key,resource,entry_kind),
  FOREIGN KEY (campaign_id,actor_id,command_key) REFERENCES r2pl_prep.reward_receipts(campaign_id,actor_id,command_key),
  FOREIGN KEY (campaign_id,actor_id,resource) REFERENCES r2pl_prep.reward_accounts(campaign_id,actor_id,resource)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.reward_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_key uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type='fixture.reward_committed'),
  event_version smallint NOT NULL CHECK (event_version=1),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id,actor_id,command_key),
  FOREIGN KEY (campaign_id,actor_id,command_key) REFERENCES r2pl_prep.reward_receipts(campaign_id,actor_id,command_key)
);
REVOKE ALL ON ALL TABLES IN SCHEMA r2pl_prep FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA r2pl_prep FROM PUBLIC;
REVOKE ALL ON FUNCTION r2pl_prep.reward_catalog_immutable() FROM PUBLIC;
ALTER TABLE r2pl_prep.reward_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.reward_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.reward_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.reward_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.reward_cooldowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.reward_chest_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.reward_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.reward_outbox ENABLE ROW LEVEL SECURITY;
