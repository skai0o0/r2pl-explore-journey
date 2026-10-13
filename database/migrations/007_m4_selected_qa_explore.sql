-- Opt-in synthetic QA only. Apply transactionally with checksum version 7.
SET LOCAL search_path = r2pl_v2, pg_catalog;
-- Preserve existing rows and all private RLS/privilege settings from migration 006.
ALTER TABLE knowledge_explore_outbox_qa_v1
 DROP CONSTRAINT knowledge_explore_outbox_qa_v1_tile_index_check,
 ADD CONSTRAINT knowledge_explore_outbox_qa_v1_tile_index_check
 CHECK (tile_index BETWEEN 0 AND 999999);
