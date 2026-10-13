/** Reversible synthetic transaction demo; no browser route or campaign data. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import type { CampaignBinding } from "../server/integration/CampaignProvider.ts";
import { PgRewardPreparation } from "../server/integration/PgRewardPreparation.ts";
import { REWARD_PREPARATION_VERSION } from "../shared/rewards/commands.ts";

const value = process.env.R2PL_PREPARATION_DATABASE_URL;
if (!value || process.env.R2PL_REWARD_DEMO !== "1")
  throw new Error(
    "Set R2PL_REWARD_DEMO=1 and a disposable R2PL_PREPARATION_DATABASE_URL",
  );
const url = new URL(value);
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !/^r2pl_prep_test_[a-z0-9_]+$/.test(url.pathname.slice(1))
)
  throw new Error("Demo requires a loopback r2pl_prep_test_* database");
const pool = new Pool({ connectionString: value, max: 4 });
const campaignId = randomUUID();
const actors: CampaignBinding[] = [0, 15].map((schoolSlot) => ({
  campaignId,
  actorId: randomUUID(),
  provider: "synthetic",
  externalStudentId: randomUUID(),
  externalSchoolId: `fixture-school-${schoolSlot}`,
  schoolSlot,
}));
const stop = `fixture-aspire-${randomUUID()}`;
const chest = `fixture-chest-${randomUUID()}`;
try {
  for (const file of [
    "001_running_sync_dev.sql",
    "002_reward_transactions_dev.sql",
  ])
    await pool.query(
      await readFile(
        new URL(`../database/preparation/${file}`, import.meta.url),
        "utf8",
      ),
    );
  for (const actor of actors) {
    await pool.query(
      "INSERT INTO r2pl_prep.running_bindings VALUES($1,$2,$3,$4,$5,$6)",
      [
        campaignId,
        actor.actorId,
        actor.provider,
        actor.externalStudentId,
        actor.schoolSlot,
        actor.externalSchoolId,
      ],
    );
    await pool.query(
      "INSERT INTO r2pl_prep.reward_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-key',1,1)",
      [campaignId, actor.actorId],
    );
  }
  await pool.query(
    "INSERT INTO r2pl_prep.reward_targets VALUES($1,$2,'unistop',$3,'aspire',NULL),($1,$4,'chest',$3,NULL,$5)",
    [
      campaignId,
      stop,
      REWARD_PREPARATION_VERSION,
      chest,
      JSON.stringify({ kind: "points", quantity: 2 }),
    ],
  );
  for (const actor of actors)
    for (const id of [stop, chest])
      await pool.query(
        "INSERT INTO r2pl_prep.reward_discoveries VALUES($1,$2,$3)",
        [campaignId, actor.actorId, id],
      );
  const service = new PgRewardPreparation(pool, {
    mode: "synthetic-preparation",
    ruleVersion: REWARD_PREPARATION_VERSION,
  });
  const spin = {
    key: randomUUID(),
    kind: "use_unistop",
    targetId: stop,
    ruleVersion: REWARD_PREPARATION_VERSION,
  };
  const first = await service.apply(actors[0]!, spin);
  const replay = await service.apply(actors[0]!, spin);
  const retryWithNewKey = await service.apply(actors[0]!, {
    ...spin,
    key: randomUUID(),
  });
  const race = await Promise.all(
    actors.map((actor) =>
      service.apply(actor, {
        key: randomUUID(),
        kind: "open_chest",
        targetId: chest,
        ruleVersion: REWARD_PREPARATION_VERSION,
      }),
    ),
  );
  const inventories = [];
  for (let i = 0; i < actors.length; i++)
    inventories.push({
      explorer: i + 1,
      inventory: (
        await pool.query<{ resource: string; balance: string }>(
          "SELECT resource,balance::text FROM r2pl_prep.reward_accounts WHERE campaign_id=$1 AND actor_id=$2 ORDER BY resource",
          [campaignId, actors[i]!.actorId],
        )
      ).rows,
    });
  console.log(
    JSON.stringify(
      {
        fixtureOnly: true,
        unistopReward: first.receipt.reward,
        repeat: replay.kind,
        newActionDuringCooldown: retryWithNewKey.receipt.reason,
        chestRace: race.map((result, i) => ({
          explorer: i + 1,
          status: result.receipt.status,
          reason: result.receipt.reason,
          reward: result.receipt.reward,
        })),
        inventories,
      },
      null,
      2,
    ),
  );
} finally {
  for (const table of [
    "reward_outbox",
    "reward_ledger",
    "reward_chest_claims",
    "reward_receipts",
    "reward_cooldowns",
    "reward_accounts",
    "reward_discoveries",
    "reward_targets",
    "running_bindings",
  ])
    await pool
      .query(`DELETE FROM r2pl_prep.${table} WHERE campaign_id=$1`, [
        campaignId,
      ])
      .catch(() => {});
  await pool.end();
}
