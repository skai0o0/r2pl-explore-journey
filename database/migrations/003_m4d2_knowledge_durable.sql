-- Development only. No Data API grants, roster, production commands or world writes.
SET LOCAL search_path = r2pl_v2, pg_catalog;
CREATE TABLE IF NOT EXISTS knowledge_cases_v1 (
 campaign_id uuid NOT NULL REFERENCES campaigns(id), case_id uuid NOT NULL,
 rule_version text NOT NULL CHECK (rule_version = 'knowledge-v1-development'),
 snapshot jsonb NOT NULL, snapshot_hash bytea NOT NULL CHECK (octet_length(snapshot_hash)=32),
 state jsonb NOT NULL, revision bigint NOT NULL CHECK (revision >= 1),
 status text NOT NULL CHECK (status IN ('claiming','success','failure')),
 t0_ms bigint NOT NULL, hard_deadline_ms bigint NOT NULL,
 rolling_deadline_ms bigint NOT NULL, required_points bigint NOT NULL CHECK (required_points > 0),
 received_points bigint NOT NULL CHECK (received_points >= 0 AND received_points <= required_points),
 PRIMARY KEY(campaign_id,case_id),
 CHECK ((state->>'revision')::bigint=revision AND state->>'phase'=status),
 CHECK ((state->>'receivedPoints')::bigint=received_points),
 CHECK ((state->>'rollingDeadlineMs')::bigint=rolling_deadline_ms),
 CHECK (hard_deadline_ms=t0_ms+172800000),
 CHECK (rolling_deadline_ms<=hard_deadline_ms),
 CHECK ((status='success')=(received_points=required_points))
);
-- One immutable successor event per contest, including creation races with new IDs.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_contest_case_v1
 ON knowledge_cases_v1(campaign_id,(snapshot->>'contestId'));
CREATE OR REPLACE FUNCTION knowledge_case_frozen_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.campaign_id,NEW.case_id,NEW.rule_version,NEW.snapshot,NEW.snapshot_hash,NEW.t0_ms,NEW.hard_deadline_ms,NEW.required_points)
 IS DISTINCT FROM ROW(OLD.campaign_id,OLD.case_id,OLD.rule_version,OLD.snapshot,OLD.snapshot_hash,OLD.t0_ms,OLD.hard_deadline_ms,OLD.required_points)
 THEN RAISE EXCEPTION 'Frozen knowledge case'; END IF;
 IF ROW(NEW.state->'ruleVersion',NEW.state->'campaignId',NEW.state->'contestId',NEW.state->'schoolSlots',NEW.state->'tiles',NEW.state->'openedAtMs',NEW.state->'claimantSchoolSlot',NEW.state->'t0Ms',NEW.state->'eligibleTileIndices',NEW.state->'requiredPoints',NEW.state->'hardDeadlineMs')
 IS DISTINCT FROM ROW(OLD.state->'ruleVersion',OLD.state->'campaignId',OLD.state->'contestId',OLD.state->'schoolSlots',OLD.state->'tiles',OLD.state->'openedAtMs',OLD.state->'claimantSchoolSlot',OLD.state->'t0Ms',OLD.state->'eligibleTileIndices',OLD.state->'requiredPoints',OLD.state->'hardDeadlineMs')
 THEN RAISE EXCEPTION 'Frozen knowledge state snapshot'; END IF;
 IF OLD.status <> 'claiming' OR NEW.revision <> OLD.revision+1 THEN RAISE EXCEPTION 'Invalid knowledge revision'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION knowledge_case_frozen_v1() FROM PUBLIC;
ALTER FUNCTION r2pl_v2.knowledge_case_frozen_v1() SET search_path = r2pl_v2, pg_catalog;
DROP TRIGGER IF EXISTS knowledge_case_frozen ON knowledge_cases_v1;
CREATE TRIGGER knowledge_case_frozen BEFORE UPDATE ON knowledge_cases_v1 FOR EACH ROW EXECUTE FUNCTION knowledge_case_frozen_v1();
CREATE TABLE IF NOT EXISTS knowledge_requests_v1 (
 campaign_id uuid NOT NULL, case_id uuid NOT NULL, contribution_id uuid NOT NULL,
 actor_id uuid NOT NULL, payload_hash bytea NOT NULL CHECK (octet_length(payload_hash)=32),
 result jsonb NOT NULL, PRIMARY KEY(campaign_id,case_id,contribution_id),
 FOREIGN KEY(campaign_id,case_id) REFERENCES knowledge_cases_v1(campaign_id,case_id)
);
CREATE TABLE IF NOT EXISTS knowledge_contributions_v1 (
 campaign_id uuid NOT NULL, case_id uuid NOT NULL, contribution_id uuid NOT NULL,
 actor_id uuid NOT NULL, resource text NOT NULL DEFAULT 'points' CHECK(resource='points'),
 requested_points bigint NOT NULL CHECK(requested_points>0),
 accepted_points bigint NOT NULL CHECK(accepted_points>0 AND accepted_points<=requested_points),
 accepted_at_ms bigint NOT NULL,
 PRIMARY KEY(campaign_id,case_id,contribution_id),
 FOREIGN KEY(campaign_id,case_id,contribution_id) REFERENCES knowledge_requests_v1(campaign_id,case_id,contribution_id),
 FOREIGN KEY(campaign_id,actor_id,resource) REFERENCES wallet_accounts(campaign_id,actor_id,resource)
);
CREATE TABLE IF NOT EXISTS knowledge_refund_obligations_v1 (
 campaign_id uuid NOT NULL, case_id uuid NOT NULL, contribution_id uuid NOT NULL,
 completed_at timestamptz,
 PRIMARY KEY(campaign_id,case_id,contribution_id),
 FOREIGN KEY(campaign_id,case_id,contribution_id) REFERENCES knowledge_contributions_v1(campaign_id,case_id,contribution_id)
);
CREATE INDEX IF NOT EXISTS knowledge_refunds_pending_v1 ON knowledge_refund_obligations_v1(campaign_id,case_id,contribution_id) WHERE completed_at IS NULL;
CREATE TABLE IF NOT EXISTS knowledge_journal_v1 (
 campaign_id uuid NOT NULL, case_id uuid NOT NULL, contribution_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('debit','refund')), amount bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,case_id,contribution_id,kind),
 CHECK ((kind='debit' AND amount<0) OR (kind='refund' AND amount>0)),
 FOREIGN KEY(campaign_id,case_id,contribution_id) REFERENCES knowledge_contributions_v1(campaign_id,case_id,contribution_id)
);
-- Finance/ownership effects are private. A future authorized projector must filter
-- and apply these in its own durable transaction; existing outbox relay cannot read them.
CREATE TABLE IF NOT EXISTS knowledge_effect_outbox_v1 (
 campaign_id uuid NOT NULL, case_id uuid NOT NULL, revision bigint NOT NULL,
 effects jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,case_id,revision),
 FOREIGN KEY(campaign_id,case_id) REFERENCES knowledge_cases_v1(campaign_id,case_id)
);
CREATE OR REPLACE FUNCTION knowledge_receipt_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable knowledge receipt'; END; $$;
REVOKE ALL ON FUNCTION knowledge_receipt_immutable_v1() FROM PUBLIC;
ALTER FUNCTION r2pl_v2.knowledge_receipt_immutable_v1() SET search_path = r2pl_v2, pg_catalog;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['knowledge_cases_v1','knowledge_requests_v1','knowledge_contributions_v1','knowledge_refund_obligations_v1','knowledge_journal_v1','knowledge_effect_outbox_v1'] LOOP
 EXECUTE format('ALTER TABLE r2pl_v2.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON r2pl_v2.%I FROM PUBLIC',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['knowledge_requests_v1','knowledge_contributions_v1','knowledge_journal_v1','knowledge_effect_outbox_v1'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS knowledge_receipt_immutable ON r2pl_v2.%I',tab);
 EXECUTE format('CREATE TRIGGER knowledge_receipt_immutable BEFORE UPDATE OR DELETE ON r2pl_v2.%I FOR EACH ROW EXECUTE FUNCTION r2pl_v2.knowledge_receipt_immutable_v1()',tab);
 END LOOP;
END; $$;
