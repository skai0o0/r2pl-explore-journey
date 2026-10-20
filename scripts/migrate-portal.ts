import { Pool } from "pg";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await migratePortalDatabase(pool);
  console.log("Portal migrations verified");
} finally {
  await pool.end();
}
