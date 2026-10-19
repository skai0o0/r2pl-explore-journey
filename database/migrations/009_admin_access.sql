ALTER TABLE r2pl_v2.portal_admins
  ADD COLUMN access_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN permissions text[],
  ADD COLUMN access_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN protected_root boolean NOT NULL DEFAULT false,
  ADD COLUMN password_hash bytea,
  ADD COLUMN password_salt bytea,
  ADD CONSTRAINT admin_password_pair CHECK ((password_hash IS NULL) = (password_salt IS NULL)),
  ADD CONSTRAINT admin_protected_email CHECK (NOT protected_root OR email='admin@amtech.vn');
CREATE TABLE r2pl_v2.admin_login_limits (
  campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id),
  bucket text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY(campaign_id,bucket)
);
ALTER TABLE r2pl_v2.admin_login_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r2pl_v2.admin_login_limits FROM PUBLIC;
