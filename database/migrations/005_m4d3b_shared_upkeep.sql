-- QA-only foundation. Apply transactionally after 001-004; NOT applied by this slice.
-- No scheduler debit, lapse/departure policy, transport grants or production enable.
SET LOCAL search_path = r2pl_v2, pg_catalog;
CREATE TABLE knowledge_shared_activations_v1 (
 campaign_id uuid NOT NULL REFERENCES campaigns(id), cohort_id uuid NOT NULL,
 activated_at_ms bigint NOT NULL CHECK(activated_at_ms BETWEEN 0 AND 9007199081940991),
 activation_world jsonb NOT NULL, world_hash bytea NOT NULL CHECK(octet_length(world_hash)=32),
 PRIMARY KEY(campaign_id,cohort_id), UNIQUE(campaign_id,cohort_id,activated_at_ms)
);
CREATE TABLE knowledge_shared_snapshots_v1 (
 campaign_id uuid NOT NULL, cohort_id uuid NOT NULL, period_start_ms bigint NOT NULL,
 activated_at_ms bigint NOT NULL, snapshot_id text NOT NULL, snapshot jsonb NOT NULL,
 snapshot_hash bytea NOT NULL CHECK(octet_length(snapshot_hash)=32),
 rule_version text NOT NULL DEFAULT 'knowledge-upkeep-v1-qa' CHECK(rule_version='knowledge-upkeep-v1-qa'),
 fee_per_school_component smallint NOT NULL DEFAULT 1 CHECK(fee_per_school_component=1),
 PRIMARY KEY(campaign_id,cohort_id,period_start_ms), UNIQUE(campaign_id,snapshot_id),
 FOREIGN KEY(campaign_id,cohort_id,activated_at_ms) REFERENCES knowledge_shared_activations_v1(campaign_id,cohort_id,activated_at_ms),
 CHECK(period_start_ms BETWEEN activated_at_ms+86400000 AND 9007199168340991),
 CHECK((period_start_ms-activated_at_ms)%86400000=0),
 CHECK((snapshot->>'sharedActivatedAt')::bigint=activated_at_ms),
 CHECK((snapshot->>'periodStart')::bigint=period_start_ms),
 CHECK(snapshot->>'billingSnapshotId'=snapshot_id),
 CHECK(snapshot_id=cohort_id::text||':'||period_start_ms::text)
);
CREATE TABLE knowledge_shared_requests_v1 (
 campaign_id uuid NOT NULL, actor_id uuid NOT NULL, command_key uuid NOT NULL,
 cohort_id uuid NOT NULL, period_start_ms bigint NOT NULL,
 payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32), result jsonb NOT NULL,
 PRIMARY KEY(campaign_id,actor_id,command_key),
 FOREIGN KEY(campaign_id,cohort_id,period_start_ms) REFERENCES knowledge_shared_snapshots_v1(campaign_id,cohort_id,period_start_ms)
);
-- Exactly one immutable receipt per SCHOOL / frozen component / cycle, not tile.
CREATE TABLE knowledge_shared_receipts_v1 (
 campaign_id uuid NOT NULL, cohort_id uuid NOT NULL, period_start_ms bigint NOT NULL,
 payment_key text NOT NULL, school_slot smallint NOT NULL CHECK(school_slot BETWEEN 0 AND 15),
 component_hash bytea NOT NULL CHECK(octet_length(component_hash)=32),
 actor_id uuid NOT NULL, command_key uuid NOT NULL,
 resource text NOT NULL DEFAULT 'points' CHECK(resource='points'),
 fee_points smallint NOT NULL DEFAULT 1 CHECK(fee_points=1), paid_at_ms bigint NOT NULL,
 PRIMARY KEY(campaign_id,cohort_id,period_start_ms,payment_key),
 UNIQUE(campaign_id,cohort_id,period_start_ms,school_slot,component_hash),
 FOREIGN KEY(campaign_id,cohort_id,period_start_ms) REFERENCES knowledge_shared_snapshots_v1(campaign_id,cohort_id,period_start_ms),
 FOREIGN KEY(campaign_id,actor_id,command_key) REFERENCES knowledge_shared_requests_v1(campaign_id,actor_id,command_key),
 FOREIGN KEY(campaign_id,actor_id,resource) REFERENCES wallet_accounts(campaign_id,actor_id,resource),
 FOREIGN KEY(campaign_id,school_slot) REFERENCES campaign_schools(campaign_id,slot),
 CHECK(paid_at_ms>=period_start_ms AND paid_at_ms<period_start_ms+86400000)
);
-- One monetary journal entry and private committed event per payment request.
CREATE TABLE knowledge_shared_journal_v1 (
 campaign_id uuid NOT NULL, actor_id uuid NOT NULL, command_key uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount<0), accepted_at_ms bigint NOT NULL,
 PRIMARY KEY(campaign_id,actor_id,command_key),
 FOREIGN KEY(campaign_id,actor_id,command_key) REFERENCES knowledge_shared_requests_v1(campaign_id,actor_id,command_key)
);
CREATE TABLE knowledge_shared_outbox_v1 (
 campaign_id uuid NOT NULL, actor_id uuid NOT NULL, command_key uuid NOT NULL,
 event_version smallint NOT NULL DEFAULT 1 CHECK(event_version=1), receipt jsonb NOT NULL,
 PRIMARY KEY(campaign_id,actor_id,command_key),
 FOREIGN KEY(campaign_id,actor_id,command_key) REFERENCES knowledge_shared_journal_v1(campaign_id,actor_id,command_key)
);
CREATE FUNCTION knowledge_shared_immutable_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path = r2pl_v2, pg_catalog AS $$
BEGIN
 -- Deterministic test cleanup only: explicit local opt-in AND a synthetic campaign.
 -- No table reset, trigger disable, or production campaign deletion is needed.
 IF TG_OP='DELETE' AND current_setting('r2pl_v2.synthetic_cleanup',true)='on'
 AND EXISTS(SELECT 1 FROM campaigns WHERE id=OLD.campaign_id AND code='m4d3b-test-'||OLD.campaign_id::text)
 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Immutable shared upkeep record';
END; $$;
REVOKE ALL ON FUNCTION knowledge_shared_immutable_v1() FROM PUBLIC;
DO $$ DECLARE tab text; role_name text; BEGIN
 FOREACH tab IN ARRAY ARRAY['knowledge_shared_activations_v1','knowledge_shared_snapshots_v1','knowledge_shared_requests_v1','knowledge_shared_receipts_v1','knowledge_shared_journal_v1','knowledge_shared_outbox_v1'] LOOP
 EXECUTE format('ALTER TABLE r2pl_v2.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON r2pl_v2.%I FROM PUBLIC',tab);
 EXECUTE format('CREATE TRIGGER shared_immutable BEFORE UPDATE OR DELETE ON r2pl_v2.%I FOR EACH ROW EXECUTE FUNCTION knowledge_shared_immutable_v1()',tab);
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
 EXECUTE format('REVOKE ALL ON r2pl_v2.%I FROM %I',tab,role_name);
 END IF;
 END LOOP;
 END LOOP;
END; $$;
