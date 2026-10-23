import { Pool } from "pg";
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
const target = new URL(process.env.DATABASE_URL!);
const backup = "/opt/r2pl-admin-20261019-k6gt99n4/production-before-admin.dump";
const pool = new Pool({ connectionString: target.href, max: 1 });
try {
  const migration = (await pool.query("SELECT max(version) AS version FROM r2pl_v2.schema_migrations")).rows[0];
  const root = (await pool.query("SELECT count(*) AS count FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND email='admin@amtech.vn'", [process.env.PORTAL_CAMPAIGN_ID])).rows[0];
  const owner = (await pool.query("SELECT current_user,relowner::regrole::text AS owner FROM pg_class WHERE oid='r2pl_v2.portal_admins'::regclass")).rows[0];
  const result = spawnSync("pg_dump", ["-Fc", "--no-owner", "--no-acl", "-h", target.hostname, "-p", target.port || "5432", "-U", decodeURIComponent(target.username), "-d", target.pathname.slice(1), "-f", backup], { env: { ...process.env, PGPASSWORD: decodeURIComponent(target.password) }, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Database backup failed");
  chmodSync(backup, 0o600);
  console.log(JSON.stringify({ migration: migration.version, rootExists: Number(root.count)>0, owner, backup }));
} finally { await pool.end(); }
