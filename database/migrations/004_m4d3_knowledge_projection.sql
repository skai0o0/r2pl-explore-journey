-- DEVELOPMENT private projection only; apply transactionally after migrations 1-3.
-- TODO: integrate M3 world_chunks through an approved, versioned codec adapter.
-- Never reinterpret its mask as current ownership or overwrite fog history.
SET LOCAL search_path = r2pl_v2, pg_catalog;
CREATE TABLE knowledge_ownership_tiles_v1 (
 campaign_id uuid NOT NULL, tile_index integer NOT NULL CHECK(tile_index BETWEEN 0 AND 999999),
 projection_version smallint NOT NULL DEFAULT 1 CHECK(projection_version=1),
 -- Active membership only: zero neutral/provisional, one bit sole, two bits SHARED.
 -- A future authorized Shared seed must add +1 to EACH set school bit atomically.
 active_school_mask integer NOT NULL CHECK(active_school_mask BETWEEN 0 AND 65535),
 CHECK (((active_school_mask & (active_school_mask-1)) &
         ((active_school_mask & (active_school_mask-1))-1))=0),
 -- Revision 0 is reserved for a separately authorized atomic Shared baseline import.
 case_id uuid NOT NULL, case_revision bigint NOT NULL CHECK(case_revision>=0),
 PRIMARY KEY(campaign_id,tile_index),
 FOREIGN KEY(campaign_id,case_id) REFERENCES knowledge_cases_v1(campaign_id,case_id)
);
CREATE INDEX knowledge_ownership_case_v1 ON knowledge_ownership_tiles_v1(campaign_id,case_id,case_revision);
CREATE TABLE knowledge_school_scores_v1 (
 campaign_id uuid NOT NULL REFERENCES campaigns(id),
 school_slot smallint NOT NULL CHECK(school_slot BETWEEN 0 AND 15),
 projection_version smallint NOT NULL DEFAULT 1 CHECK(projection_version=1),
 active_tiles bigint NOT NULL DEFAULT 0 CHECK(active_tiles>=0),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 reached_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,school_slot)
);
-- This ACK means ONLY the private projection committed, never network delivery.
-- Row locks are transaction-scoped claims: crash/rollback releases them without ACK.
CREATE TABLE knowledge_projection_acks_v1 (
 campaign_id uuid NOT NULL, case_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>=1),
 projection_version smallint NOT NULL DEFAULT 1 CHECK(projection_version=1),
 projected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,case_id,revision),
 FOREIGN KEY(campaign_id,case_id) REFERENCES knowledge_cases_v1(campaign_id,case_id),
 FOREIGN KEY(campaign_id,case_id,revision) REFERENCES knowledge_effect_outbox_v1(campaign_id,case_id,revision)
);
CREATE TRIGGER knowledge_projection_ack_immutable BEFORE UPDATE OR DELETE ON knowledge_projection_acks_v1
 FOR EACH ROW EXECUTE FUNCTION knowledge_receipt_immutable_v1();
DO $$ DECLARE tab text; role_name text; BEGIN
 FOREACH tab IN ARRAY ARRAY['knowledge_ownership_tiles_v1','knowledge_school_scores_v1','knowledge_projection_acks_v1'] LOOP
 EXECUTE format('ALTER TABLE r2pl_v2.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON r2pl_v2.%I FROM PUBLIC',tab);
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
 EXECUTE format('REVOKE ALL ON r2pl_v2.%I FROM %I',tab,role_name);
 END IF;
 END LOOP;
 END LOOP;
END; $$;
