import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const url = process.env.R2PL_TEST_DATABASE_URL;
if (!url) throw new Error("R2PL_TEST_DATABASE_URL is required");
const pool = new Pool({
  connectionString: url,
  max: 1,
  options: "-c search_path=r2pl_v2,public",
});
const sql = await readFile(
  new URL("../database/migrations/001_m3_foundation.sql", import.meta.url),
  "utf8",
);
const digest = createHash("sha256").update(sql).digest();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(2189, 3)");
  await client.query("CREATE SCHEMA IF NOT EXISTS r2pl_v2");
  await client.query("SET LOCAL search_path = r2pl_v2, pg_catalog");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, sha256 bytea NOT NULL CHECK (octet_length(sha256)=32), applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const existing = await client.query<{ sha256: Buffer }>(
    "SELECT sha256 FROM schema_migrations WHERE version = 1",
  );
  if (existing.rowCount === 0) {
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations(version,sha256) VALUES (1,$1)",
      [digest],
    );
  } else if (!existing.rows[0]?.sha256.equals(digest))
    throw new Error("M3 migration checksum mismatch");
  await client.query("COMMIT");
  console.log("M3 migration 1 applied or already present");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
