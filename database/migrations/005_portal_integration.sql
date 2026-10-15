-- Partner integration v1. All tables are server-private; no browser DB access.
-- Retain the existing gameplay membership bridge without creating demo accounts.
CREATE SCHEMA IF NOT EXISTS r2pl_prep;
CREATE TABLE IF NOT EXISTS r2pl_prep.running_bindings (
 campaign_id uuid NOT NULL, actor_id uuid NOT NULL, provider text NOT NULL,
 external_student_id text NOT NULL, school_slot smallint NOT NULL CHECK(school_slot BETWEEN 0 AND 15), external_school_id text NOT NULL,
 PRIMARY KEY(campaign_id,actor_id), UNIQUE(campaign_id,provider,external_student_id)
);
ALTER TABLE r2pl_prep.running_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA r2pl_prep FROM PUBLIC;
REVOKE ALL ON r2pl_prep.running_bindings FROM PUBLIC;
CREATE TABLE IF NOT EXISTS r2pl_v2.portal_members (
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id),
 external_student_id text NOT NULL,
 actor_id uuid NOT NULL,
 school_id text NOT NULL,
 school_slot smallint NOT NULL,
 display_name text NOT NULL,
 active boolean NOT NULL,
 PRIMARY KEY(campaign_id,external_student_id),
 UNIQUE(campaign_id,actor_id),
 FOREIGN KEY(campaign_id,school_id) REFERENCES r2pl_v2.campaign_schools(campaign_id,school_id),
 FOREIGN KEY(campaign_id,school_slot) REFERENCES r2pl_v2.campaign_schools(campaign_id,slot)
);
CREATE TABLE IF NOT EXISTS r2pl_v2.portal_nonces (
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id),
 key_id text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(campaign_id,key_id,nonce)
);
CREATE TABLE IF NOT EXISTS r2pl_v2.portal_rate_windows (
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id),
 key_id text NOT NULL, window_id bigint NOT NULL, requests integer NOT NULL,
 PRIMARY KEY(campaign_id,key_id,window_id)
);
CREATE TABLE IF NOT EXISTS r2pl_v2.portal_launches (
 campaign_id uuid NOT NULL, ticket_hash bytea NOT NULL,
 actor_id uuid NOT NULL, challenge text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(campaign_id,ticket_hash),
 FOREIGN KEY(campaign_id,actor_id) REFERENCES r2pl_v2.portal_members(campaign_id,actor_id)
);
CREATE TABLE IF NOT EXISTS r2pl_v2.portal_sessions (
 campaign_id uuid NOT NULL, token_hash bytea NOT NULL,
 actor_id uuid NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(campaign_id,token_hash),
 FOREIGN KEY(campaign_id,actor_id) REFERENCES r2pl_v2.portal_members(campaign_id,actor_id)
);
CREATE TABLE IF NOT EXISTS r2pl_v2.portal_running_receipts (
 campaign_id uuid NOT NULL, actor_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 payload_hash bytea NOT NULL, receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,actor_id,revision),
 FOREIGN KEY(campaign_id,actor_id) REFERENCES r2pl_v2.portal_members(campaign_id,actor_id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['portal_members','portal_nonces','portal_rate_windows','portal_launches','portal_sessions','portal_running_receipts'] LOOP
  EXECUTE format('ALTER TABLE r2pl_v2.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON r2pl_v2.%I FROM PUBLIC',tab);
 END LOOP;
END; $$;
