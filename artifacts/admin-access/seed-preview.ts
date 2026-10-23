import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { AdminAccessStore } from "../../server/integration/AdminAccessStore.ts";
import { ALL_ADMIN_PERMISSIONS } from "../../shared/integration/adminAccess.ts";
if (!process.env.DATABASE_URL?.includes("r2pl_prep_test_admin_preview_") || process.env.PORTAL_MODE !== "staging") throw new Error("Disposable preview only");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const campaign = process.env.PORTAL_CAMPAIGN_ID!;
try {
  // Disposable UI fixtures, never provisioned into a real campaign.
  const access = new AdminAccessStore(pool, campaign);
  const root = (await pool.query("SELECT actor_id FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND protected_root", [campaign])).rows[0]!;
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO r2pl_v2.portal_admin_sessions(campaign_id,actor_id,token_hash,expires_at) VALUES($1,$2,sha256($3::bytea),clock_timestamp()+interval '1 minute')", [campaign, root.actor_id, Buffer.from(token)]);
  for (const [email, permissions] of [["operator@preview.test", ALL_ADMIN_PERMISSIONS], ["viewer@preview.test", ["rankings.view"]]] as const) {
    await access.save(root.actor_id, token, { email, name: email.startsWith("viewer") ? "Quan sát viên thử nghiệm" : "Điều phối thử nghiệm", permissions, enabled: true, expectedRevision: 0, password: "Disposable-Preview-2026!" });
  }
  await pool.query("DELETE FROM r2pl_v2.portal_admin_sessions WHERE campaign_id=$1 AND token_hash=sha256($2::bytea)", [campaign, Buffer.from(token)]);
  console.log("Disposable preview fixtures ready");
} finally { await pool.end(); }
