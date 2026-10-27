CREATE TABLE r2pl_v2.student_history_archive (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,
 kind text NOT NULL,
 detail jsonb NOT NULL,
 occurred_at timestamptz NOT NULL
);
CREATE INDEX student_history_archive_actor_time ON r2pl_v2.student_history_archive(campaign_id,actor_id,occurred_at DESC,id DESC);
CREATE INDEX game_events_actor_time ON r2pl_v2.game_events(campaign_id,actor_id,created_at DESC,id DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX ledger_actor_time ON r2pl_v2.ledger_entries(campaign_id,actor_id,created_at DESC,id DESC);
CREATE INDEX world_mutations_actor_time ON r2pl_v2.world_mutations(campaign_id,command_actor,created_at DESC);
ALTER TABLE r2pl_v2.student_history_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r2pl_v2.student_history_archive FROM PUBLIC;
