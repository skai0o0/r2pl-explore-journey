import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

/** Explicit deployment step, never invoked by a public HTTP request. */
export async function migratePortalDatabase(pool: Pool): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(2189,3)");
    await db.query("CREATE SCHEMA IF NOT EXISTS r2pl_v2");
    await db.query("SET LOCAL search_path=r2pl_v2,pg_catalog");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,sha256 bytea NOT NULL CHECK(octet_length(sha256)=32),applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = [
      "001_m3_foundation.sql",
      "002_m35_view_revisions.sql",
      "003_signed_world.sql",
      "004_gift_checkin.sql",
      "005_portal_integration.sql",
      "006_browser_sessions.sql",
      "007_admin_editor.sql",
      "008_canonical_school_ids.sql",
      "009_admin_access.sql",
      "010_partner_test_profiles.sql",
    ];
    for (const [index, file] of files.entries()) {
      const sql = await readFile(
        new URL(`../../database/migrations/${file}`, import.meta.url),
        "utf8",
      );
      const hash = createHash("sha256")
        .update(sql.replace(/\r\n/g, "\n"))
        .digest();
      const existing = (
        await db.query<{ sha256: Buffer }>(
          "SELECT sha256 FROM r2pl_v2.schema_migrations WHERE version=$1",
          [index + 1],
        )
      ).rows[0];
      if (existing && !existing.sha256.equals(hash))
        throw new Error(`Migration ${index + 1} checksum mismatch`);
      if (!existing) {
        await db.query(sql);
        await db.query(
          "INSERT INTO r2pl_v2.schema_migrations(version,sha256) VALUES($1,$2)",
          [index + 1, hash],
        );
      }
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
