import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { GAME_CONFIG, SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import { PortalError } from "./PortalSignature.ts";

const digest = (token: string) => createHash("sha256").update(token).digest();

/** Caller holds the campaign transaction lock. Never resets an existing wallet. */
export async function provisionTestProfiles(
  db: PoolClient,
  campaign: string,
  owner: string,
  name: string,
): Promise<void> {
  for (const school of SCHOOLS) {
    const existing = await db.query(
      "SELECT 1 FROM r2pl_v2.partner_test_profiles WHERE campaign_id=$1 AND owner_actor_id=$2 AND school_slot=$3",
      [campaign, owner, school.slot],
    );
    if (existing.rowCount) continue;
    const actor = randomUUID(),
      external = `partner-test:${actor}`;
    await db.query(
      "INSERT INTO r2pl_v2.portal_members(campaign_id,external_student_id,actor_id,school_id,school_slot,display_name,active) VALUES($1,$2,$3,$4,$5,$6,false)",
      [
        campaign,
        external,
        actor,
        school.id,
        school.slot,
        `${name} · ${school.shortName}`.slice(0, 100),
      ],
    );
    await db.query(
      "INSERT INTO r2pl_v2.partner_test_profiles(campaign_id,owner_actor_id,school_slot,actor_id) VALUES($1,$2,$3,$4)",
      [campaign, owner, school.slot, actor],
    );
    await db.query(
      "INSERT INTO r2pl_prep.running_bindings(campaign_id,actor_id,provider,external_student_id,school_slot,external_school_id) VALUES($1,$2,'portal-v1',$3,$4,$5)",
      [campaign, actor, external, school.slot, school.id],
    );
    for (const [resource, opening] of [
      ["fixture-credit", GAME_CONFIG.integration.initialPoints],
      ["fixture-crystals", GAME_CONFIG.integration.initialCrystals],
      ["fixture-treasure-map", 0],
      ...["aspire", "nitro", "predator"].map(
        (tier) =>
          [`key-${tier}`, GAME_CONFIG.integration.initialKeysPerTier] as const,
      ),
    ] as const) {
      await db.query(
        "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,$3,$4,$4)",
        [campaign, actor, resource, opening],
      );
    }
    await db.query(
      "INSERT INTO r2pl_v2.test_point_pools(campaign_id,actor_id,school_slot,opening_balance,balance) SELECT campaign_id,actor_id,$3,balance,balance FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit' ON CONFLICT(campaign_id,school_slot) DO NOTHING",
      [campaign, actor, school.slot],
    );
  }
}

/** Deactivate old profiles inside the gameplay lock, including queued commands. */
export async function revokeTestPlay(
  db: PoolClient,
  campaign: string,
  owner: string,
): Promise<void> {
  await db.query(
    "DELETE FROM r2pl_v2.portal_sessions s USING r2pl_v2.partner_test_profiles p WHERE s.campaign_id=$1 AND p.campaign_id=s.campaign_id AND p.actor_id=s.actor_id AND p.owner_actor_id=$2",
    [campaign, owner],
  );
  await db.query(
    "UPDATE r2pl_v2.portal_members m SET active=false FROM r2pl_v2.partner_test_profiles p WHERE m.campaign_id=$1 AND p.campaign_id=m.campaign_id AND p.actor_id=m.actor_id AND p.owner_actor_id=$2",
    [campaign, owner],
  );
}

/** Bind a fresh admin cookie to exactly one owned game profile. Same transaction. */
export async function bindTestProfile(
  db: PoolClient,
  campaign: string,
  owner: string,
  token: string,
  slot?: number,
): Promise<void> {
  const target = (
    await db.query<{ actor_id: string; school_slot: number }>(
      `SELECT p.actor_id,p.school_slot FROM r2pl_v2.partner_test_profiles p
     JOIN r2pl_v2.portal_members m USING(campaign_id,actor_id)
     WHERE p.campaign_id=$1 AND p.owner_actor_id=$2 AND ($3::smallint IS NULL OR p.school_slot=$3)
     ORDER BY m.active DESC,p.school_slot LIMIT 1`,
      [campaign, owner, slot ?? null],
    )
  ).rows[0];
  if (!target) throw new PortalError(403, "TEST_PROFILE_REQUIRED");
  await revokeTestPlay(db, campaign, owner);
  await db.query(
    "DELETE FROM r2pl_v2.portal_admin_sessions WHERE campaign_id=$1 AND actor_id=$2 AND token_hash<>$3",
    [campaign, owner, digest(token)],
  );
  await db.query(
    "UPDATE r2pl_v2.portal_members SET active=true WHERE campaign_id=$1 AND actor_id=$2",
    [campaign, target.actor_id],
  );
  await db.query(
    `INSERT INTO r2pl_v2.portal_sessions(campaign_id,token_hash,actor_id,expires_at)
     SELECT campaign_id,token_hash,$3,expires_at FROM r2pl_v2.portal_admin_sessions
     WHERE campaign_id=$1 AND actor_id=$2 AND token_hash=$4`,
    [campaign, owner, target.actor_id, digest(token)],
  );
}

export async function switchTestProfile(
  pool: Pool,
  campaign: string,
  token: string,
  input: unknown,
): Promise<{ token: string; expiresInSeconds: number }> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => k !== "schoolId")
  )
    throw new PortalError(400, "INVALID_BODY");
  const school = SCHOOLS.find(
    (s) => s.id === (input as Record<string, unknown>).schoolId,
  );
  if (!school) throw new PortalError(400, "INVALID_SCHOOL");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `signed-game:${campaign}`,
    ]);
    const session = (
      await db.query<{ actor_id: string; expires: number }>(
        `SELECT a.actor_id,extract(epoch FROM s.expires_at)*1000 AS expires
       FROM r2pl_v2.portal_admins a JOIN r2pl_v2.portal_admin_sessions s USING(campaign_id,actor_id)
       WHERE a.campaign_id=$1 AND s.token_hash=$2 AND s.expires_at>clock_timestamp()
       AND a.active AND a.access_enabled AND a.test_profiles FOR UPDATE OF a,s`,
        [campaign, digest(token)],
      )
    ).rows[0];
    if (!session) throw new PortalError(403, "TEST_PROFILE_REQUIRED");
    const next = randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO r2pl_v2.portal_admin_sessions(campaign_id,token_hash,actor_id,expires_at)
       SELECT campaign_id,$3,actor_id,expires_at FROM r2pl_v2.portal_admin_sessions WHERE campaign_id=$1 AND token_hash=$2`,
      [campaign, digest(token), digest(next)],
    );
    await bindTestProfile(db, campaign, session.actor_id, next, school.slot);
    await db.query(
      "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,'test-profile-switch',$3)",
      [campaign, session.actor_id, JSON.stringify({ schoolId: school.id })],
    );
    await db.query("COMMIT");
    return {
      token: next,
      expiresInSeconds: Math.max(
        0,
        Math.floor((Number(session.expires) - Date.now()) / 1000),
      ),
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
