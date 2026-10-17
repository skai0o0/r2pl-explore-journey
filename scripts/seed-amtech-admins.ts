import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { AMTECH_ACCOUNTS } from "../shared/integration/identity.ts";

const derive = promisify(scrypt);

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://r2pl_user:r2pl_secure_pass_2026@127.0.0.1:5432/r2pl_prep_test_current";

const password = process.env.ADMIN_PASSWORD ?? "Amtech@2026";

const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  connectionTimeoutMillis: 5000,
});

try {
  const campaignRes = await pool.query<{ id: string }>(
    "SELECT id FROM r2pl_v2.campaigns ORDER BY created_at ASC LIMIT 1",
  );
  if (!campaignRes.rows.length) {
    throw new Error("No campaign found in r2pl_v2.campaigns");
  }
  const campaignId = process.env.PORTAL_CAMPAIGN_ID ?? campaignRes.rows[0]!.id;
  console.log(`Target database: ${databaseUrl}`);
  console.log(`Using campaign ID: ${campaignId}`);
  console.log(`Setting default password for seeded accounts: ${password}`);

  for (const account of AMTECH_ACCOUNTS) {
    const salt = randomBytes(32);
    const encoded = (await derive(password, salt, 64)) as Buffer;

    // 1. Upsert into r2pl_dummy.students (for portal web login)
    const studentRes = await pool.query<{ id: string }>(
      `INSERT INTO r2pl_dummy.students(campaign_id, id, email, display_name, school_id, password_hash, password_salt)
       VALUES($1, $2, $3, $4, 'amtech', $5, $6)
       ON CONFLICT (campaign_id, email)
       DO UPDATE SET school_id = 'amtech',
                     display_name = EXCLUDED.display_name,
                     password_hash = EXCLUDED.password_hash,
                     password_salt = EXCLUDED.password_salt
       RETURNING id`,
      [campaignId, randomUUID(), account.email, account.name, encoded, salt],
    );
    const externalStudentId = studentRes.rows[0]!.id;

    // 2. Clean up any stale admin record with same email but different external_student_id
    await pool.query(
      "DELETE FROM r2pl_v2.portal_admins WHERE campaign_id = $1 AND email = $2 AND external_student_id <> $3",
      [campaignId, account.email, externalStudentId],
    );

    // 3. Upsert into r2pl_v2.portal_admins
    const existingAdmin = await pool.query<{ actor_id: string }>(
      "SELECT actor_id FROM r2pl_v2.portal_admins WHERE campaign_id = $1 AND external_student_id = $2",
      [campaignId, externalStudentId],
    );
    const actorId = existingAdmin.rows[0]?.actor_id ?? randomUUID();

    await pool.query(
      `INSERT INTO r2pl_v2.portal_admins(campaign_id, external_student_id, actor_id, organization_id, email, display_name, active)
       VALUES($1, $2, $3, 'amtech', $4, $5, true)
       ON CONFLICT (campaign_id, external_student_id)
       DO UPDATE SET email = EXCLUDED.email,
                     display_name = EXCLUDED.display_name,
                     organization_id = 'amtech',
                     active = true`,
      [campaignId, externalStudentId, actorId, account.email, account.name],
    );

    console.log(
      `✓ Admin seeded: ${account.name.padEnd(18)} <${account.email.padEnd(28)}> [ĐH AMTECH]`,
    );
  }

  // Summary verification
  const dummyCount = await pool.query<{ count: string }>(
    "SELECT count(*) FROM r2pl_dummy.students WHERE campaign_id = $1 AND school_id = 'amtech'",
    [campaignId],
  );
  const adminCount = await pool.query<{ count: string }>(
    "SELECT count(*) FROM r2pl_v2.portal_admins WHERE campaign_id = $1 AND organization_id = 'amtech'",
    [campaignId],
  );
  console.log(`\nSuccessfully verified:`);
  console.log(
    `- r2pl_dummy.students (school_id='amtech'): ${dummyCount.rows[0]!.count} accounts`,
  );
  console.log(
    `- r2pl_v2.portal_admins (organization_id='amtech'): ${adminCount.rows[0]!.count} accounts`,
  );
} finally {
  await pool.end();
}
