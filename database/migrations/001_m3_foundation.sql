-- M3 disposable-schema foundation. Apply once, transactionally, to a dedicated V2 database.
-- Campaigns and actors used by M3 tests are synthetic; no production roster is seeded.
CREATE SCHEMA IF NOT EXISTS r2pl_v2;
SET LOCAL search_path = r2pl_v2, pg_catalog;
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  world_format smallint NOT NULL DEFAULT 1 CHECK (world_format = 1),
  write_strategy text NOT NULL CHECK (write_strategy IN ('full_chunk', 'mutation_log')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaign_schools (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  school_id text NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 15),
  PRIMARY KEY (campaign_id, school_id),
  UNIQUE (campaign_id, slot)
);
CREATE FUNCTION forbid_school_slot_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Campaign school slots are immutable';
END;
$$;
CREATE TRIGGER campaign_school_immutable BEFORE UPDATE ON campaign_schools
FOR EACH ROW EXECUTE FUNCTION forbid_school_slot_reassignment();
CREATE TABLE wallet_accounts (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  actor_id uuid NOT NULL,
  resource text NOT NULL,
  opening_balance bigint NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  balance bigint NOT NULL CHECK (balance >= 0),
  PRIMARY KEY (campaign_id, actor_id, resource)
);
CREATE TABLE command_results (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  actor_id uuid NOT NULL,
  command_key bytea NOT NULL CHECK (octet_length(command_key) = 16),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  status text NOT NULL CHECK (status IN ('processing', 'test_applied', 'test_no_change', 'rejected')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, actor_id, command_key)
);
CREATE TABLE world_chunk_heads (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  chunk_id smallint NOT NULL CHECK (chunk_id BETWEEN 0 AND 255),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (campaign_id, chunk_id)
);
CREATE TABLE world_chunks (
  campaign_id uuid NOT NULL,
  chunk_id smallint NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  mask bytea NOT NULL CHECK (octet_length(mask) = 8192),
  mask_crc bigint NOT NULL CHECK (mask_crc BETWEEN 0 AND 4294967295),
  PRIMARY KEY (campaign_id, chunk_id),
  FOREIGN KEY (campaign_id, chunk_id) REFERENCES world_chunk_heads(campaign_id, chunk_id)
);
CREATE TABLE school_fog_chunks (
  campaign_id uuid NOT NULL,
  chunk_id smallint NOT NULL,
  school_slot smallint NOT NULL CHECK (school_slot BETWEEN 0 AND 15),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  fog bytea NOT NULL CHECK (octet_length(fog) = 512),
  fog_crc bigint NOT NULL CHECK (fog_crc BETWEEN 0 AND 4294967295),
  PRIMARY KEY (campaign_id, chunk_id, school_slot),
  FOREIGN KEY (campaign_id, chunk_id) REFERENCES world_chunk_heads(campaign_id, chunk_id),
  FOREIGN KEY (campaign_id, school_slot) REFERENCES campaign_schools(campaign_id, slot)
);
CREATE TABLE world_mutations (
  campaign_id uuid NOT NULL,
  chunk_id smallint NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  local_index smallint NOT NULL CHECK (local_index BETWEEN 0 AND 4095),
  school_slot smallint NOT NULL CHECK (school_slot BETWEEN 0 AND 15),
  new_mask integer NOT NULL CHECK (new_mask BETWEEN 0 AND 65535),
  discovered boolean NOT NULL,
  command_actor uuid NOT NULL,
  command_key bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, chunk_id, revision),
  FOREIGN KEY (campaign_id, chunk_id) REFERENCES world_chunk_heads(campaign_id, chunk_id),
  FOREIGN KEY (campaign_id, command_actor, command_key) REFERENCES command_results(campaign_id, actor_id, command_key)
);
CREATE INDEX world_mutations_tile_latest ON world_mutations (campaign_id, chunk_id, local_index, revision DESC);
CREATE INDEX world_mutations_school_tile_latest ON world_mutations (campaign_id, chunk_id, school_slot, local_index, revision DESC);
CREATE TABLE ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_key bytea NOT NULL,
  resource text NOT NULL,
  amount bigint NOT NULL CHECK (amount <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, actor_id, command_key, resource),
  FOREIGN KEY (campaign_id, actor_id, command_key) REFERENCES command_results(campaign_id, actor_id, command_key),
  FOREIGN KEY (campaign_id, actor_id, resource) REFERENCES wallet_accounts(campaign_id, actor_id, resource)
);
CREATE TABLE outbox_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_key bytea NOT NULL,
  event_type text NOT NULL,
  event_version smallint NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  UNIQUE (campaign_id, actor_id, command_key, event_type),
  FOREIGN KEY (campaign_id, actor_id, command_key) REFERENCES command_results(campaign_id, actor_id, command_key)
);
CREATE INDEX outbox_pending ON outbox_events (id) WHERE delivered_at IS NULL;

-- Private test schema. Direct owner connections bypass these deny-by-default policies;
-- no Data API role receives table access.
REVOKE ALL ON SCHEMA r2pl_v2 FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA r2pl_v2 FROM PUBLIC;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_chunk_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_fog_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
