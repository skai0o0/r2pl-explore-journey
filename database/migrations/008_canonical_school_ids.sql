-- Canonical school codes change; school slots, wallets and tile/fog bytes do not.
-- Run only through the transactional deployment migration runner, before restart.
LOCK TABLE r2pl_v2.campaign_schools IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM r2pl_v2.campaign_schools
    WHERE (school_id='hcmcou' AND slot<>1) OR (school_id='dhhp' AND slot<>3)
  ) THEN RAISE EXCEPTION 'Legacy university has an unexpected immutable slot'; END IF;
END $$;

-- Defer referencing FKs just for this transaction; restore their original guards.
CREATE TEMP TABLE school_code_migration_fks ON COMMIT DROP AS
SELECT conrelid, conname FROM pg_constraint
WHERE contype='f' AND NOT condeferrable
  AND confrelid IN ('r2pl_v2.campaign_schools'::regclass,
                   'r2pl_v2.game_world_objects'::regclass);
DO $$ DECLARE fk record; BEGIN
  FOR fk IN SELECT * FROM school_code_migration_fks LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE',fk.conrelid::regclass,fk.conname);
  END LOOP;
END $$;
SET CONSTRAINTS ALL DEFERRED;
ALTER TABLE r2pl_v2.campaign_schools DISABLE TRIGGER campaign_school_immutable;
UPDATE r2pl_v2.campaign_schools SET school_id=CASE school_id
  WHEN 'hcmcou' THEN 'ou' WHEN 'dhhp' THEN 'hpuni' END
WHERE school_id IN ('hcmcou','dhhp');
UPDATE r2pl_v2.portal_members SET school_id=CASE school_id
  WHEN 'hcmcou' THEN 'ou' WHEN 'dhhp' THEN 'hpuni' END
WHERE school_id IN ('hcmcou','dhhp');
UPDATE r2pl_prep.running_bindings SET external_school_id=CASE external_school_id
  WHEN 'hcmcou' THEN 'ou' WHEN 'dhhp' THEN 'hpuni' END
WHERE external_school_id IN ('hcmcou','dhhp');

-- Only exact identifier values/keys and generated labels, never substring replace.
CREATE FUNCTION pg_temp.canonical_school_code(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT CASE value
  WHEN 'hcmcou' THEN 'ou' WHEN 'dhhp' THEN 'hpuni'
  WHEN 'hq-hcmcou' THEN 'hq-ou' WHEN 'hq-dhhp' THEN 'hq-hpuni'
  WHEN 'HCMCOU' THEN 'OU' WHEN 'DHHP' THEN 'HPUNI'
  WHEN 'HCMCOU HQ' THEN 'OU HQ' WHEN 'DHHP HQ' THEN 'HPUNI HQ'
  ELSE value END $$;
CREATE FUNCTION pg_temp.canonical_school_json(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT AS $$ BEGIN
  CASE jsonb_typeof(value)
    WHEN 'string' THEN RETURN to_jsonb(pg_temp.canonical_school_code(value #>> '{}'));
    WHEN 'array' THEN RETURN COALESCE((SELECT jsonb_agg(pg_temp.canonical_school_json(item) ORDER BY ordinal)
      FROM jsonb_array_elements(value) WITH ORDINALITY AS a(item,ordinal)), '[]'::jsonb);
    WHEN 'object' THEN RETURN COALESCE((SELECT jsonb_object_agg(pg_temp.canonical_school_code(key),pg_temp.canonical_school_json(item))
      FROM jsonb_each(value) AS o(key,item)), '{}'::jsonb);
    ELSE RETURN value;
  END CASE;
END $$;
UPDATE r2pl_v2.game_world_objects
SET id=pg_temp.canonical_school_code(id),data=pg_temp.canonical_school_json(data)
WHERE data IS DISTINCT FROM pg_temp.canonical_school_json(data)
   OR id<>pg_temp.canonical_school_code(id);
UPDATE r2pl_v2.game_chest_discoveries SET object_id=pg_temp.canonical_school_code(object_id)
WHERE object_id<>pg_temp.canonical_school_code(object_id);
UPDATE r2pl_v2.game_state SET data=pg_temp.canonical_school_json(data)
WHERE scope='layout-backup' AND data IS DISTINCT FROM pg_temp.canonical_school_json(data);
UPDATE r2pl_v2.editor_drafts SET objects=pg_temp.canonical_school_json(objects)
WHERE objects IS DISTINCT FROM pg_temp.canonical_school_json(objects);
UPDATE r2pl_v2.editor_versions SET objects=pg_temp.canonical_school_json(objects)
WHERE objects IS DISTINCT FROM pg_temp.canonical_school_json(objects);
DO $$ BEGIN
  IF to_regclass('r2pl_dummy.students') IS NOT NULL THEN
    EXECUTE 'UPDATE r2pl_dummy.students SET school_id=pg_temp.canonical_school_code(school_id) WHERE school_id IN (''hcmcou'',''dhhp'')';
    EXECUTE 'UPDATE r2pl_dummy.sync_jobs SET payload=jsonb_set(payload,''{schoolId}'',to_jsonb(pg_temp.canonical_school_code(payload->>''schoolId''))) WHERE payload->>''schoolId'' IN (''hcmcou'',''dhhp'') AND state IN (''pending'',''sending'',''failed'')';
  END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE r2pl_v2.campaign_schools ENABLE TRIGGER campaign_school_immutable;
DO $$ DECLARE fk record; BEGIN
  FOR fk IN SELECT * FROM school_code_migration_fks LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I NOT DEFERRABLE',fk.conrelid::regclass,fk.conname);
  END LOOP;
END $$;
DROP FUNCTION pg_temp.canonical_school_json(jsonb);
DROP FUNCTION pg_temp.canonical_school_code(text);
