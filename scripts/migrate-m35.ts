import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const url = process.env.R2PL_TEST_DATABASE_URL;
if (!url) throw new Error("R2PL_TEST_DATABASE_URL is required");
const sql = await readFile(
  new URL("../database/migrations/002_m35_view_revisions.sql", import.meta.url),
  "utf8",
);
const digest = createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest();
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(2189, 3)");
  const previous = await client.query<{ version: number }>(
    "SELECT version FROM r2pl_v2.schema_migrations WHERE version=1",
  );
  if (previous.rowCount !== 1) throw new Error("M3 migration 1 is required");
  const existing = await client.query<{ sha256: Buffer }>(
    "SELECT sha256 FROM r2pl_v2.schema_migrations WHERE version=2",
  );
  if (existing.rowCount === 0) {
    await client.query(sql);
    await client.query(
      "INSERT INTO r2pl_v2.schema_migrations(version,sha256) VALUES(2,$1)",
      [digest],
    );
  } else if (!existing.rows[0]?.sha256.equals(digest))
    throw new Error("M3.5 migration checksum mismatch");
  await client.query("COMMIT");
  console.log("M3.5 migration 2 applied or already present");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
