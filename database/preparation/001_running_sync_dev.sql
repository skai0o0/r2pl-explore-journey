-- Explicit synthetic preparation only. Not included in migrate:m3/migrate:m35.
-- Apply ONLY to a disposable database for integration tests. No production identities.
CREATE SCHEMA IF NOT EXISTS r2pl_prep;
CREATE TABLE IF NOT EXISTS r2pl_prep.running_bindings (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  provider text NOT NULL,
  external_student_id text NOT NULL,
  school_slot smallint NOT NULL CHECK (school_slot BETWEEN 0 AND 15),
  external_school_id text NOT NULL,
  PRIMARY KEY (campaign_id, actor_id),
  UNIQUE (campaign_id, provider, external_student_id)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.running_accounts (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  resource text NOT NULL CHECK (resource = 'fixture-running-points'),
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  checkpoint jsonb,
  PRIMARY KEY (campaign_id, actor_id),
  FOREIGN KEY (campaign_id, actor_id) REFERENCES r2pl_prep.running_bindings(campaign_id,actor_id)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.running_receipts (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision > 0),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  result jsonb NOT NULL,
  PRIMARY KEY (campaign_id,actor_id,source_revision),
  FOREIGN KEY (campaign_id,actor_id) REFERENCES r2pl_prep.running_accounts(campaign_id,actor_id)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.running_ledger (
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  source_revision bigint NOT NULL,
  amount bigint NOT NULL CHECK (amount <> 0),
  resource text NOT NULL CHECK (resource = 'fixture-running-points'),
  PRIMARY KEY (campaign_id,actor_id,source_revision),
  FOREIGN KEY (campaign_id,actor_id,source_revision) REFERENCES r2pl_prep.running_receipts(campaign_id,actor_id,source_revision)
);
CREATE TABLE IF NOT EXISTS r2pl_prep.running_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  source_revision bigint NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'fixture.running_reconciled'),
  event_version smallint NOT NULL CHECK (event_version = 1),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id,actor_id,source_revision),
  FOREIGN KEY (campaign_id,actor_id,source_revision) REFERENCES r2pl_prep.running_receipts(campaign_id,actor_id,source_revision)
);
REVOKE ALL ON SCHEMA r2pl_prep FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA r2pl_prep FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA r2pl_prep FROM PUBLIC;
ALTER TABLE r2pl_prep.running_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.running_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.running_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.running_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_prep.running_outbox ENABLE ROW LEVEL SECURITY;
