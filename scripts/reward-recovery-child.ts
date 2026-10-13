/** Disposable test helper: terminate after commit before returning a result to the caller. */
import { Pool } from "pg";
import type { CampaignBinding } from "../server/integration/CampaignProvider.ts";
import { PgRewardPreparation } from "../server/integration/PgRewardPreparation.ts";
import { REWARD_PREPARATION_VERSION } from "../shared/rewards/commands.ts";

const value = process.env.R2PL_PREPARATION_DATABASE_URL;
if (!value || process.env.R2PL_REWARD_RECOVERY_TEST !== "1")
  throw new Error("Explicit disposable reward recovery test required");
const url = new URL(value);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !/^r2pl_prep_test_[a-z0-9_]+$/.test(url.pathname.slice(1))
)
  throw new Error("Disposable loopback database required");
const binding = JSON.parse(process.argv[2] ?? "null") as CampaignBinding;
const command = JSON.parse(process.argv[3] ?? "null") as unknown;
const pool = new Pool({ connectionString: value, max: 1 });
await new PgRewardPreparation(pool, {
  mode: "synthetic-preparation",
  ruleVersion: REWARD_PREPARATION_VERSION,
  ticketSource: () => 0,
}).apply(binding, command);
process.exit(86);
