import type { PoolClient } from "pg";
import { PortalError } from "./PortalSignature.ts";

/** Recheck after acquiring the gameplay lock, so queued work cannot outlive a switch. */
export async function requirePortalActorSession(
  db: PoolClient,
  campaign: string,
  actor: string,
  slot: number,
  hash: string,
): Promise<void> {
  const row = await db.query(
    `SELECT 1 FROM r2pl_v2.portal_sessions s JOIN r2pl_v2.portal_members m USING(campaign_id,actor_id)
     LEFT JOIN r2pl_v2.partner_test_profiles p USING(campaign_id,actor_id)
     LEFT JOIN r2pl_v2.portal_admins a ON a.campaign_id=p.campaign_id AND a.actor_id=p.owner_actor_id
     WHERE s.campaign_id=$1 AND s.actor_id=$2 AND m.school_slot=$3 AND s.token_hash=$4
     AND s.expires_at>clock_timestamp() AND m.active AND (p.actor_id IS NULL OR
       (a.active AND a.access_enabled AND a.test_profiles AND EXISTS(
         SELECT 1 FROM r2pl_v2.portal_admin_sessions ads WHERE ads.campaign_id=a.campaign_id AND ads.actor_id=a.actor_id
         AND ads.token_hash=s.token_hash AND ads.expires_at>clock_timestamp())))`,
    [campaign, actor, slot, Buffer.from(hash, "hex")],
  );
  if (!row.rowCount) throw new PortalError(401, "UNAUTHORIZED");
}
