-- Staff identities deliberately have no school slot, wallet or running binding.
CREATE TABLE r2pl_v2.portal_admins (
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id),
 external_student_id text NOT NULL, actor_id uuid NOT NULL,
 organization_id text NOT NULL CHECK(organization_id='amtech'),
 email text NOT NULL, display_name text NOT NULL, active boolean NOT NULL,
 PRIMARY KEY(campaign_id,external_student_id), UNIQUE(campaign_id,actor_id),
 UNIQUE(campaign_id,email)
);
CREATE TABLE r2pl_v2.portal_admin_launches (
 campaign_id uuid NOT NULL, ticket_hash bytea NOT NULL, actor_id uuid NOT NULL,
 challenge text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(campaign_id,ticket_hash),
 FOREIGN KEY(campaign_id,actor_id) REFERENCES r2pl_v2.portal_admins(campaign_id,actor_id)
);
CREATE TABLE r2pl_v2.portal_admin_sessions (
 campaign_id uuid NOT NULL, token_hash bytea NOT NULL, actor_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(campaign_id,token_hash),
 FOREIGN KEY(campaign_id,actor_id) REFERENCES r2pl_v2.portal_admins(campaign_id,actor_id)
);
CREATE TABLE r2pl_v2.editor_drafts (
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id), actor_id uuid NOT NULL,
 revision integer NOT NULL DEFAULT 0, base_revision integer NOT NULL,
 objects jsonb NOT NULL CHECK(jsonb_typeof(objects)='array'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,actor_id)
);
CREATE TABLE r2pl_v2.editor_versions (
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id), revision integer NOT NULL,
 actor_id uuid, objects jsonb NOT NULL CHECK(jsonb_typeof(objects)='array'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,revision)
);
CREATE TABLE r2pl_v2.operator_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id), actor_id uuid NOT NULL,
 action text NOT NULL, detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['portal_admins','portal_admin_launches','portal_admin_sessions','editor_drafts','editor_versions','operator_audit'] LOOP
  EXECUTE format('ALTER TABLE r2pl_v2.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON r2pl_v2.%I FROM PUBLIC',tab);
 END LOOP;
END; $$;
