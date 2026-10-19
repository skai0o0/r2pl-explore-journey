import { Pool } from "pg";
import { AdminAccessStore } from "../server/integration/AdminAccessStore.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";

// Supply the initial password through stdin; never store it in source or shell arguments.
if (!process.env.DATABASE_URL || !process.env.PORTAL_CAMPAIGN_ID)
  throw new Error("DATABASE_URL and PORTAL_CAMPAIGN_ID required");
let password = "";
for await (const part of process.stdin) {
  password += part;
  if (password.length > 256) throw new Error("Invalid password input");
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  await migratePortalDatabase(pool);
  await new AdminAccessStore(
    pool,
    process.env.PORTAL_CAMPAIGN_ID,
  ).provisionRoot(password.replace(/[\r\n]+$/, ""));
  console.log("Root admin is ready. Existing root credentials were preserved.");
} finally {
  password = "";
  await pool.end();
}
