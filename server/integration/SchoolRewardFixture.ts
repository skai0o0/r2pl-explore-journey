import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import { REWARD_PREPARATION_VERSION } from "../../shared/rewards/commands.ts";
import type { CampaignBinding } from "./CampaignProvider.ts";
import type { SchoolPlayFixture } from "./SchoolPlayFixture.ts";
export function schoolRewardBinding(
  fixture: SchoolPlayFixture,
  token: string | undefined,
): CampaignBinding | null {
  const actor = fixture.actors.find(
    (a) => a.token === token && a.role === "human",
  );
  return actor
    ? {
        campaignId: fixture.campaignId,
        actorId: actor.actorId,
        schoolSlot: actor.schoolSlot,
        provider: "school-play-dev",
        externalStudentId: actor.actorId,
        externalSchoolId: fixture.schools[actor.schoolSlot]!.fixtureId,
      }
    : null;
}
export async function provisionSchoolRewards(
  pool: Pool,
  fixture: SchoolPlayFixture,
): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('signed-game-schema',0))",
    );
    for (const file of [
      "001_running_sync_dev.sql",
      "002_reward_transactions_dev.sql",
      "003_playable_reward_ledger_dev.sql",
    ])
      await db.query(
        await readFile(
          new URL(`../../database/preparation/${file}`, import.meta.url),
          "utf8",
        ),
      );
    for (const school of fixture.schools) {
      for (const profile of ["aspire", "nitro", "predator"])
        await db.query(
          "INSERT INTO r2pl_prep.reward_targets(campaign_id,target_id,kind,rule_version,profile) VALUES($1,$2,'unistop',$3,$4) ON CONFLICT DO NOTHING",
          [
            fixture.campaignId,
            `dev-${profile}-${school.slot}`,
            REWARD_PREPARATION_VERSION,
            profile,
          ],
        );
      await db.query(
        "INSERT INTO r2pl_prep.reward_targets(campaign_id,target_id,kind,rule_version,fixed_reward) VALUES($1,$2,'chest',$3,$4) ON CONFLICT DO NOTHING",
        [
          fixture.campaignId,
          `dev-chest-${school.slot}`,
          REWARD_PREPARATION_VERSION,
          JSON.stringify({ kind: "points", quantity: 2 }),
        ],
      );
    }
    // Neutral UniStops: 8 Aspire, 5 Nitro, 2 Predator
    const neutralUniStops = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `unistop_aspire_${i + 1}`, profile: "aspire" })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `unistop_nitro_${i + 1}`, profile: "nitro" })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `unistop_predator_${i + 1}`, profile: "predator" })),
    ];
    for (const stop of neutralUniStops) {
      await db.query(
        "INSERT INTO r2pl_prep.reward_targets(campaign_id,target_id,kind,rule_version,profile) VALUES($1,$2,'unistop',$3,$4) ON CONFLICT DO NOTHING",
        [fixture.campaignId, stop.id, REWARD_PREPARATION_VERSION, stop.profile],
      );
    }
    // Neutral Chests: 8 Aspire, 5 Nitro, 2 Predator
    const neutralChests = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `chest_aspire_${i + 1}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `chest_nitro_${i + 1}` })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `chest_predator_${i + 1}` })),
    ];
    for (const chest of neutralChests) {
      await db.query(
        "INSERT INTO r2pl_prep.reward_targets(campaign_id,target_id,kind,rule_version,fixed_reward) VALUES($1,$2,'chest',$3,$4) ON CONFLICT DO NOTHING",
        [
          fixture.campaignId,
          chest.id,
          REWARD_PREPARATION_VERSION,
          JSON.stringify({ kind: "points", quantity: 2 }),
        ],
      );
    }
    // Existing immutable targets must match the published dev fixture exactly.
    for (const school of fixture.schools) {
      const ids = ["aspire", "nitro", "predator", "chest"].map(
        (kind) => `dev-${kind}-${school.slot}`,
      );
      const rows = (
        await db.query<{
          target_id: string;
          kind: string;
          rule_version: string;
          profile: string | null;
          fixed_reward: { kind?: unknown; quantity?: unknown } | null;
        }>(
          "SELECT target_id,kind,rule_version,profile,fixed_reward FROM r2pl_prep.reward_targets WHERE campaign_id=$1 AND target_id=ANY($2::text[])",
          [fixture.campaignId, ids],
        )
      ).rows;
      if (
        rows.length !== 4 ||
        rows.some(
          (row) =>
            row.rule_version !== REWARD_PREPARATION_VERSION ||
            (row.target_id === ids[3]
              ? row.kind !== "chest" ||
                row.profile !== null ||
                row.fixed_reward?.kind !== "points" ||
                row.fixed_reward?.quantity !== 2
              : row.kind !== "unistop" ||
                row.fixed_reward !== null ||
                !["aspire", "nitro", "predator"].some(
                  (profile) =>
                    row.profile === profile &&
                    row.target_id === `dev-${profile}-${school.slot}`,
                )),
        )
      )
        throw new Error("Conflicting immutable reward target fixture");
    }
    for (const actor of fixture.actors.filter((a) => a.role === "human")) {
      const b = schoolRewardBinding(fixture, actor.token)!;
      await db.query(
        "INSERT INTO r2pl_prep.running_bindings(campaign_id,actor_id,provider,external_student_id,school_slot,external_school_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
        [
          b.campaignId,
          b.actorId,
          b.provider,
          b.externalStudentId,
          b.schoolSlot,
          b.externalSchoolId,
        ],
      );
      const binding = (
        await db.query<{
          provider: string;
          external_student_id: string;
          school_slot: number;
          external_school_id: string;
        }>(
          "SELECT provider,external_student_id,school_slot,external_school_id FROM r2pl_prep.running_bindings WHERE campaign_id=$1 AND actor_id=$2",
          [b.campaignId, b.actorId],
        )
      ).rows[0]!;
      if (
        binding.provider !== b.provider ||
        binding.external_student_id !== b.externalStudentId ||
        binding.school_slot !== b.schoolSlot ||
        binding.external_school_id !== b.externalSchoolId
      )
        throw new Error("Conflicting fixture reward binding");
      for (const [resource, opening] of [
        ["fixture-crystals", GAME_CONFIG.staging.initialCrystals],
        ["fixture-treasure-map", 0],
        ["fixture-key", 1],
      ] as const)
        await db.query(
          "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING",
          [fixture.campaignId, actor.actorId, resource, opening],
        );
      // Explicit starter fixture discoveries, not a production map/visibility/access policy.
      for (const target of ["aspire", "nitro", "predator", "chest"])
        await db.query(
          "INSERT INTO r2pl_prep.reward_discoveries(campaign_id,actor_id,target_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [
            fixture.campaignId,
            actor.actorId,
            `dev-${target}-${actor.schoolSlot}`,
          ],
        );
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function cleanupSchoolRewards(
  pool: Pool,
  campaignId: string,
): Promise<void> {
  const code = (
    await pool.query<{ code: string }>(
      "SELECT code FROM r2pl_v2.campaigns WHERE id=$1",
      [campaignId],
    )
  ).rows[0]?.code;
  if (code !== `bot-sim-${campaignId}`)
    throw new Error("Only random test fixture reward cleanup allowed");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const table of [
      "playable_reward_ledger",
      "reward_outbox",
      "reward_ledger",
      "reward_chest_claims",
      "reward_cooldowns",
      "reward_receipts",
      "reward_accounts",
      "reward_discoveries",
      "reward_targets",
      "running_bindings",
    ])
      await db.query(`DELETE FROM r2pl_prep.${table} WHERE campaign_id=$1`, [
        campaignId,
      ]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
