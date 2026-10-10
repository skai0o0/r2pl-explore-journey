-- M3.5 synthetic realtime projection revisions. No production roster or rules.
CREATE TABLE r2pl_v2.school_chunk_views (
  campaign_id uuid NOT NULL,
  chunk_id smallint NOT NULL CHECK (chunk_id BETWEEN 0 AND 255),
  school_slot smallint NOT NULL CHECK (school_slot BETWEEN 0 AND 15),
  view_revision bigint NOT NULL DEFAULT 0 CHECK (view_revision >= 0),
  PRIMARY KEY (campaign_id, chunk_id, school_slot),
  FOREIGN KEY (campaign_id, chunk_id) REFERENCES r2pl_v2.world_chunk_heads(campaign_id, chunk_id),
  FOREIGN KEY (campaign_id, school_slot) REFERENCES r2pl_v2.campaign_schools(campaign_id, slot)
);
REVOKE ALL ON r2pl_v2.school_chunk_views FROM PUBLIC;
ALTER TABLE r2pl_v2.school_chunk_views ENABLE ROW LEVEL SECURITY;

-- Quarantined projection events remain auditable; the original outbox row is retained.
CREATE TABLE r2pl_v2.outbox_dead_letters (
  event_id bigint PRIMARY KEY REFERENCES r2pl_v2.outbox_events(id),
  reason text NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON r2pl_v2.outbox_dead_letters FROM PUBLIC;
ALTER TABLE r2pl_v2.outbox_dead_letters ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION r2pl_v2.forbid_campaign_strategy_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.write_strategy <> OLD.write_strategy THEN
    RAISE EXCEPTION 'Campaign write strategy is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_strategy_immutable BEFORE UPDATE OF write_strategy
ON r2pl_v2.campaigns FOR EACH ROW
EXECUTE FUNCTION r2pl_v2.forbid_campaign_strategy_change();
