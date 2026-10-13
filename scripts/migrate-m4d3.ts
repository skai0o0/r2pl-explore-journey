import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { disposableDatabaseUrl } from "./migrate-m4d2.ts";

/** QA-only projection schema; reject unknown targets before network I/O. */
export async function migrateM4D3(pool: Pool): Promise<void> {
  const configured = pool.options.connectionString;
  if (
    typeof configured !== "string" ||
    disposableDatabaseUrl(configured) !== configured
  ) {
    throw new Error("Explicit normalized, approved QA PostgreSQL URI required");
  }
  const sql = (
    await readFile(
      new URL(
        "../database/migrations/004_m4d3_knowledge_projection.sql",
        import.meta.url,
      ),
      "utf8",
    )
  ).replace(/\r\n/g, "\n");
  const digest = createHash("sha256").update(sql).digest();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(2189,3)");
    const prerequisites = await client.query(
      "SELECT version FROM r2pl_v2.schema_migrations WHERE version IN (1,2,3)",
    );
    if (prerequisites.rowCount !== 3)
      throw new Error("Migrations 1-3 required");
    const previous = await client.query<{ sha256: Buffer }>(
      "SELECT sha256 FROM r2pl_v2.schema_migrations WHERE version=4",
    );
    if (!previous.rows[0]) {
      await client.query(sql);
      await client.query(
        "INSERT INTO r2pl_v2.schema_migrations(version,sha256) VALUES (4,$1)",
        [digest],
      );
    } else if (!previous.rows[0].sha256.equals(digest)) {
      throw new Error("Migration 4 checksum mismatch");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const configured = process.env.R2PL_TEST_DATABASE_URL;
  if (!configured) throw new Error("R2PL_TEST_DATABASE_URL required");
  const pool = new Pool({
    connectionString: disposableDatabaseUrl(configured),
    max: 1,
  });
  try {
    await migrateM4D3(pool);
    console.log("QA projection migration 4 applied or checksum verified");
  } finally {
    await pool.end();
  }
}
