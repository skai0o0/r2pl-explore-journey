-- Signed v1 world catalog and actor-private staging discoveries.
CREATE TABLE IF NOT EXISTS r2pl_v2.game_world_objects (campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id) ON DELETE CASCADE,id text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(campaign_id,id));
CREATE TABLE IF NOT EXISTS r2pl_v2.game_chest_discoveries (campaign_id uuid NOT NULL,actor_id uuid NOT NULL,object_id text NOT NULL,PRIMARY KEY(campaign_id,actor_id,object_id),FOREIGN KEY(campaign_id,object_id) REFERENCES r2pl_v2.game_world_objects(campaign_id,id) ON DELETE CASCADE);
ALTER TABLE r2pl_v2.game_world_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_v2.game_chest_discoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r2pl_v2.game_world_objects,r2pl_v2.game_chest_discoveries FROM PUBLIC;

CREATE TABLE IF NOT EXISTS r2pl_v2.game_state(campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id) ON DELETE CASCADE,scope text NOT NULL,id text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(campaign_id,scope,id));
CREATE TABLE IF NOT EXISTS r2pl_v2.game_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id) ON DELETE CASCADE,actor_id uuid,school_slot smallint,title text NOT NULL,body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE r2pl_v2.game_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_v2.game_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r2pl_v2.game_state,r2pl_v2.game_events FROM PUBLIC;
