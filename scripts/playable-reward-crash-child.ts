/** Explicit disposable-DB recovery fixture: exits after committed reward, before returning to caller. */
import { Pool } from "pg";
import { DevRewardWallet } from "../server/integration/DevRewardWallet.ts";
import { PgRewardPreparation } from "../server/integration/PgRewardPreparation.ts";
import { seedSchoolPlay } from "../server/integration/SchoolPlayFixture.ts";
import { schoolRewardBinding } from "../server/integration/SchoolRewardFixture.ts";
import { REWARD_PREPARATION_VERSION } from "../shared/rewards/commands.ts";
import { botDatabase } from "./simulation/config.ts";

if (process.env.R2PL_PLAYABLE_REWARD_CRASH_CHILD !== "1")
  throw new Error("Recovery fixture flag required");
const url = botDatabase(process.env.R2PL_PREPARATION_DATABASE_URL, "1");
const pool = new Pool({ connectionString: url, max: 2 });
const campaignId = process.argv[2],
  key = process.argv[3];
if (!campaignId || !key) throw new Error("Missing recovery fixture arguments");
const fixture = await seedSchoolPlay(pool, campaignId);
const binding = schoolRewardBinding(fixture, fixture.players[0]!.token)!;
const service = new PgRewardPreparation(pool, {
  mode: "synthetic-preparation",
  ruleVersion: REWARD_PREPARATION_VERSION,
  wallet: new DevRewardWallet(),
});
await service.apply(binding, {
  kind: "open_chest",
  targetId: "dev-chest-0",
  key,
  ruleVersion: REWARD_PREPARATION_VERSION,
});
process.exit(86);
