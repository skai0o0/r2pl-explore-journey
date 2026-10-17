import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

const derive = promisify(scrypt);

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(`
Cách sử dụng:
  node --env-file=.env.portal --experimental-strip-types scripts/add-admin.ts "<Họ tên>" "<Email>" "[Mật khẩu]"

Ví dụ:
  node --env-file=.env.portal --experimental-strip-types scripts/add-admin.ts "Nguyen Van A" "vana@amtech.vn" "Amtech@2026"
`);
  process.exit(1);
}

const displayName = args[0]!.trim();
const email = args[1]!.trim().toLowerCase();
const password = args[2] ?? "Amtech@2026";

if (password.length < 10 || password.length > 128) {
  console.error("Lỗi: Mật khẩu phải từ 10 đến 128 ký tự.");
  process.exit(1);
}

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://r2pl_user:r2pl_secure_pass_2026@127.0.0.1:5432/r2pl_prep_test_current";

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 5000,
});

try {
  const campaignRes = await pool.query<{ id: string }>(
    "SELECT id FROM r2pl_v2.campaigns ORDER BY created_at ASC LIMIT 1",
  );
  if (!campaignRes.rows.length) {
    throw new Error("Không tìm thấy campaign trong database.");
  }
  const campaignId = process.env.PORTAL_CAMPAIGN_ID ?? campaignRes.rows[0]!.id;

  const salt = randomBytes(32);
  const encoded = (await derive(password, salt, 64)) as Buffer;

  // 1. Thêm vào r2pl_dummy.students (để đăng nhập portal)
  const studentRes = await pool.query<{ id: string }>(
    `INSERT INTO r2pl_dummy.students(campaign_id, id, email, display_name, school_id, password_hash, password_salt)
     VALUES($1, $2, $3, $4, 'amtech', $5, $6)
     ON CONFLICT (campaign_id, email)
     DO UPDATE SET school_id = 'amtech',
                   display_name = EXCLUDED.display_name,
                   password_hash = EXCLUDED.password_hash,
                   password_salt = EXCLUDED.password_salt
     RETURNING id`,
    [campaignId, randomUUID(), email, displayName, encoded, salt],
  );
  const externalStudentId = studentRes.rows[0]!.id;

  // 2. Làm sạch bản ghi cũ nếu có xung đột email
  await pool.query(
    "DELETE FROM r2pl_v2.portal_admins WHERE campaign_id = $1 AND email = $2 AND external_student_id <> $3",
    [campaignId, email, externalStudentId],
  );

  // 3. Thêm vào r2pl_v2.portal_admins
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
    [campaignId, externalStudentId, actorId, email, displayName],
  );

  console.log(`
======================================================
  THÊM TÀI KHOẢN ADMIN THÀNH CÔNG!
======================================================
- Họ tên:        ${displayName}
- Email:         ${email}
- Mật khẩu:      ${password}
- Tổ chức:       Đại học AMTECH (amtech)
- Quyền:         Admin (Quản trị viên)
- External ID:   ${externalStudentId}
- Actor ID:      ${actorId}
======================================================
Tài khoản đã sẵn sàng! Có thể F5 lại Pgweb và đăng nhập Portal ngay.
`);
} finally {
  await pool.end();
}
