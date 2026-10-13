-- Opt-in synthetic QA only. Apply transactionally with checksum version 6.
SET LOCAL search_path = r2pl_v2, pg_catalog;
ALTER TABLE knowledge_ownership_tiles_v1 ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE knowledge_ownership_tiles_v1 ADD COLUMN explore_actor_id uuid;
ALTER TABLE knowledge_ownership_tiles_v1 ADD COLUMN explore_command_key bytea;
ALTER TABLE knowledge_ownership_tiles_v1 ADD CONSTRAINT knowledge_explore_source_v1
 CHECK ((case_id IS NOT NULL AND explore_actor_id IS NULL AND explore_command_key IS NULL)
 OR (case_id IS NULL AND explore_actor_id IS NOT NULL AND explore_command_key IS NOT NULL AND case_revision=0));
ALTER TABLE knowledge_ownership_tiles_v1 ADD FOREIGN KEY(campaign_id,explore_actor_id,explore_command_key)
 REFERENCES command_results(campaign_id,actor_id,command_key);
-- Separate private outbox: never consumed by the public M3 relay.
CREATE TABLE knowledge_explore_outbox_qa_v1 (
 campaign_id uuid NOT NULL, actor_id uuid NOT NULL, command_key bytea NOT NULL,
 school_slot smallint NOT NULL CHECK(school_slot BETWEEN 0 AND 15),
 tile_index integer NOT NULL CHECK(tile_index=999999),
 event_version smallint NOT NULL DEFAULT 1 CHECK(event_version=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,actor_id,command_key),
 FOREIGN KEY(campaign_id,actor_id,command_key) REFERENCES command_results(campaign_id,actor_id,command_key)
);
ALTER TABLE knowledge_explore_outbox_qa_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON knowledge_explore_outbox_qa_v1 FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
 EXECUTE format('REVOKE ALL ON r2pl_v2.knowledge_explore_outbox_qa_v1 FROM %I',role_name);
 END IF;
 END LOOP;
END; $$;
