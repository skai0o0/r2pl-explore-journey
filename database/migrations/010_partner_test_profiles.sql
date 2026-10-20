-- Independent game identities, owned by a read-only dashboard account.
ALTER TABLE r2pl_v2.portal_admins ADD COLUMN test_profiles boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT partner_read_only CHECK (NOT test_profiles OR
    (NOT protected_root AND permissions IS NOT NULL AND
     permissions <@ ARRAY['rankings.view','map.view','gifts.view','audit.view']::text[]));
CREATE TABLE r2pl_v2.partner_test_profiles (
  campaign_id uuid NOT NULL,
  owner_actor_id uuid NOT NULL,
  school_slot smallint NOT NULL CHECK (school_slot BETWEEN 0 AND 7),
  actor_id uuid NOT NULL,
  PRIMARY KEY (campaign_id,owner_actor_id,school_slot),
  UNIQUE (campaign_id,actor_id),
  FOREIGN KEY (campaign_id,owner_actor_id) REFERENCES r2pl_v2.portal_admins(campaign_id,actor_id),
  FOREIGN KEY (campaign_id,actor_id) REFERENCES r2pl_v2.portal_members(campaign_id,actor_id)
);
ALTER TABLE r2pl_v2.partner_test_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r2pl_v2.partner_test_profiles FROM PUBLIC;
