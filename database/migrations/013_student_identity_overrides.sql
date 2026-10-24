-- Operator-managed exceptions for verified staff emails testing ordinary student play.
CREATE TABLE r2pl_v2.portal_student_overrides (
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id),
 email text NOT NULL CHECK(email=lower(trim(email)) AND email <> 'admin@amtech.vn'),
 school_id text NOT NULL,
 external_student_id text,
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(campaign_id,email),
 UNIQUE(campaign_id,external_student_id),
 FOREIGN KEY(campaign_id,school_id) REFERENCES r2pl_v2.campaign_schools(campaign_id,school_id)
);
ALTER TABLE r2pl_v2.portal_student_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r2pl_v2.portal_student_overrides FROM PUBLIC;
