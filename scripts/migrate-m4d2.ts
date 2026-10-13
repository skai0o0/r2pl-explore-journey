import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

/** Allow only local disposable PostgreSQL and the exact owner-approved QA Supabase project. */
export function disposableDatabaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.password ||
    url.hash
  ) {
    throw new Error("Invalid or missing QA PostgreSQL credentials");
  }
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.search === "" &&
    /^\/(r2pl_)?(test|disposable)[a-z0-9_-]*$/i.test(url.pathname);
  const qaRef = "asthukrgcnbskbhhjiiu";
  const supabaseDirect =
    url.hostname === `db.${qaRef}.supabase.co` && url.username === "postgres";
  const supabaseSession =
    url.hostname.endsWith(".pooler.supabase.com") &&
    url.username === `postgres.${qaRef}`;
  const qa =
    (supabaseDirect || supabaseSession) &&
    (url.port === "" || url.port === "5432") &&
    url.pathname === "/postgres" &&
    ["require", "verify-ca", "verify-full"].includes(
      url.searchParams.get("sslmode") ?? "",
    );
  if (!local && !qa) {
    throw new Error(
      "Allowed targets: local disposable PostgreSQL or exact r2pl-m4d-qa Supabase database over TLS",
    );
  }
  return value;
}

export async function migrateM4D2(pool: Pool): Promise<void> {
  // Validate the exported entry point too, before acquiring any connection.
  const configuredUrl = pool.options.connectionString;
  if (typeof configuredUrl !== "string")
    throw new Error("Explicit disposable connection URL required");
  disposableDatabaseUrl(configuredUrl);
  const sql = (
    await readFile(
      new URL(
        "../database/migrations/003_m4d2_knowledge_durable.sql",
        import.meta.url,
      ),
      "utf8",
    )
  ).replace(/\r\n/g, "\n");
  const digest = createHash("sha256").update(sql).digest();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Same lock as 001/002 migration scripts: serialize schema upgrades.
    await client.query("SELECT pg_advisory_xact_lock(2189,3)");
    const prerequisites = await client.query(
      "SELECT version FROM r2pl_v2.schema_migrations WHERE version IN (1,2)",
    );
    if (prerequisites.rowCount !== 2)
      throw new Error("Migrations 1 and 2 required");
    const prior = await client.query<{ sha256: Buffer }>(
      "SELECT sha256 FROM r2pl_v2.schema_migrations WHERE version=3",
    );
    if (prior.rowCount === 0) {
      await client.query(sql);
      await client.query(
        "INSERT INTO r2pl_v2.schema_migrations(version,sha256) VALUES(3,$1)",
        [digest],
      );
    } else if (!prior.rows[0]?.sha256.equals(digest))
      throw new Error("Migration 3 checksum mismatch");
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
  const value = process.env.R2PL_TEST_DATABASE_URL;
  if (!value)
    throw new Error(
      "R2PL_TEST_DATABASE_URL is required; no migration performed",
    );
  const pool = new Pool({
    connectionString: disposableDatabaseUrl(value),
    max: 1,
  });
  try {
    await migrateM4D2(pool);
    console.log("Development migration 3 applied or verified");
  } finally {
    await pool.end();
  }
}
