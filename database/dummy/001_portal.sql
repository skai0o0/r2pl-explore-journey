CREATE SCHEMA IF NOT EXISTS r2pl_dummy;
CREATE TABLE IF NOT EXISTS r2pl_dummy.students (
 campaign_id uuid NOT NULL, id uuid NOT NULL, email text NOT NULL, display_name text NOT NULL, school_id text NOT NULL,
 password_hash bytea NOT NULL, password_salt bytea NOT NULL, revision bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(campaign_id,id), UNIQUE(campaign_id,email)
);
CREATE TABLE IF NOT EXISTS r2pl_dummy.sessions (
 campaign_id uuid NOT NULL, token_hash bytea NOT NULL, student_id uuid NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(campaign_id,token_hash), FOREIGN KEY(campaign_id,student_id) REFERENCES r2pl_dummy.students(campaign_id,id)
);
CREATE TABLE IF NOT EXISTS r2pl_dummy.activities (
 campaign_id uuid NOT NULL, id uuid NOT NULL, student_id uuid NOT NULL, meters bigint NOT NULL CHECK(meters>0), occurred_at bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(campaign_id,id), FOREIGN KEY(campaign_id,student_id) REFERENCES r2pl_dummy.students(campaign_id,id)
);
CREATE TABLE IF NOT EXISTS r2pl_dummy.sync_jobs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, campaign_id uuid NOT NULL, student_id uuid NOT NULL, revision bigint NOT NULL,
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','synced','failed','superseded')),
 attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, next_attempt timestamptz NOT NULL DEFAULT clock_timestamp(), error_code text, receipt jsonb,
 UNIQUE(campaign_id,student_id,revision), FOREIGN KEY(campaign_id,student_id) REFERENCES r2pl_dummy.students(campaign_id,id)
);
CREATE TABLE IF NOT EXISTS r2pl_dummy.rate_windows (
 campaign_id uuid NOT NULL, source_hash bytea NOT NULL, window_id bigint NOT NULL, requests integer NOT NULL,
 PRIMARY KEY(campaign_id,source_hash,window_id)
);
ALTER TABLE r2pl_dummy.sync_jobs ADD COLUMN IF NOT EXISTS lease_token uuid;
REVOKE ALL ON SCHEMA r2pl_dummy FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA r2pl_dummy FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA r2pl_dummy FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['students','sessions','activities','sync_jobs','rate_windows'] LOOP
  EXECUTE format('ALTER TABLE r2pl_dummy.%I ENABLE ROW LEVEL SECURITY',tab);
 END LOOP;
END; $$;
