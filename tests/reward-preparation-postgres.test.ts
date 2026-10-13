import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Pool } from "pg";
import type { CampaignBinding } from "../server/integration/CampaignProvider.ts";
import {
  PgRewardPreparation,
  RewardPayloadConflict,
} from "../server/integration/PgRewardPreparation.ts";
import {
  type FixtureReward,
  REWARD_PREPARATION_VERSION,
} from "../shared/rewards/commands.ts";

const url = process.env.R2PL_PREPARATION_DATABASE_URL;
const execFileAsync = promisify(execFile);
const origin = Date.parse("2026-10-13T03:00:00Z");
const command = (
  kind: "use_unistop" | "open_chest",
  targetId: string,
  key = randomUUID(),
) => ({ key, kind, targetId, ruleVersion: REWARD_PREPARATION_VERSION });

test("disposable PostgreSQL reward transactions and recovery", {
  skip:
    !url &&
    "Set R2PL_PREPARATION_DATABASE_URL to a loopback r2pl_prep_test_* database",
  timeout: 60_000,
}, async (t) => {
  const parsed = new URL(url!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.match(parsed.pathname.slice(1), /^r2pl_prep_test_[a-z0-9_]+$/);
  const pool = new Pool({ connectionString: url, max: 12 });
  const campaignId = randomUUID();
  let at = origin;
  let rolls = 0;
  let ticket = 0;
  const service = () =>
    new PgRewardPreparation(pool, {
      mode: "synthetic-preparation",
      ruleVersion: REWARD_PREPARATION_VERSION,
      clock: () => at,
      ticketSource: () => {
        rolls++;
        return ticket;
      },
    });
  const actor = async (keyCount = 0n) => {
    const b: CampaignBinding = {
      campaignId,
      actorId: randomUUID(),
      provider: "synthetic",
      externalStudentId: randomUUID(),
      externalSchoolId: "fixture-school",
      schoolSlot: 0,
    };
    await pool.query(
      "INSERT INTO r2pl_prep.running_bindings VALUES($1,$2,$3,$4,$5,$6)",
      [
        campaignId,
        b.actorId,
        b.provider,
        b.externalStudentId,
        b.schoolSlot,
        b.externalSchoolId,
      ],
    );
    if (keyCount > 0n)
      await pool.query(
        "INSERT INTO r2pl_prep.reward_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-key',$3,$3)",
        [campaignId, b.actorId, keyCount.toString()],
      );
    return b;
  };
  const target = async (
    kind: "unistop" | "chest",
    profile: string | null = "aspire",
    reward: FixtureReward | null = null,
  ) => {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO r2pl_prep.reward_targets VALUES($1,$2,$3,$4,$5,$6)",
      [
        campaignId,
        id,
        kind,
        REWARD_PREPARATION_VERSION,
        profile,
        reward ? JSON.stringify(reward) : null,
      ],
    );
    return id;
  };
  const discover = async (b: CampaignBinding, id: string) => {
    await pool.query(
      "INSERT INTO r2pl_prep.reward_discoveries VALUES($1,$2,$3)",
      [campaignId, b.actorId, id],
    );
  };
  const balance = async (b: CampaignBinding, resource: string) =>
    (
      await pool.query<{ balance: string }>(
        "SELECT balance FROM r2pl_prep.reward_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource=$3",
        [campaignId, b.actorId, resource],
      )
    ).rows[0]?.balance ?? "0";
  const count = async (table: string, b: CampaignBinding) =>
    (
      await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM r2pl_prep.${table} WHERE campaign_id=$1 AND actor_id=$2`,
        [campaignId, b.actorId],
      )
    ).rows[0]!.n;
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
    await t.test(
      "duplicate spins persist one sampled result and replay without reroll",
      async () => {
        const b = await actor();
        const id = await target("unistop");
        await discover(b, id);
        const c = command("use_unistop", id);
        const before = rolls;
        const results = await Promise.all(
          Array.from({ length: 16 }, () => service().apply(b, c)),
        );
        assert.equal(results.filter((r) => r.kind === "committed").length, 1);
        assert.equal(rolls - before, 1);
        assert.equal(await balance(b, "fixture-points"), "1");
        for (const result of results)
          assert.deepEqual(result.receipt, results[0]!.receipt);
        for (const table of [
          "reward_receipts",
          "reward_ledger",
          "reward_outbox",
          "reward_cooldowns",
        ])
          assert.equal(await count(table, b), "1");
        const replay = await service().apply(b, {
          ...c,
          key: c.key.toUpperCase(),
        });
        assert.equal(replay.kind, "replay");
        assert.equal(rolls - before, 1);
        await assert.rejects(
          () => service().apply(b, { ...c, targetId: "another-target" }),
          RewardPayloadConflict,
        );
        const audit = (
          await pool.query<{ roll_ticket: number }>(
            "SELECT roll_ticket FROM r2pl_prep.reward_receipts WHERE campaign_id=$1 AND actor_id=$2",
            [campaignId, b.actorId],
          )
        ).rows[0]!;
        assert.equal(audit.roll_ticket, 0);
      },
    );
    await t.test(
      "different keys race one cooldown, exact boundary works and missed turns do not accumulate",
      async () => {
        const b = await actor();
        const id = await target("unistop");
        await discover(b, id);
        at = origin;
        const before = rolls;
        const results = await Promise.all(
          Array.from({ length: 16 }, () =>
            service().apply(b, command("use_unistop", id)),
          ),
        );
        assert.equal(
          results.filter((r) => r.receipt.status === "applied").length,
          1,
        );
        assert.equal(
          results.filter((r) => r.receipt.reason === "COOLDOWN").length,
          15,
        );
        assert.equal(rolls - before, 1);
        at = origin + 12 * 60 * 60 * 1000 - 1;
        assert.equal(
          (await service().apply(b, command("use_unistop", id))).receipt.reason,
          "COOLDOWN",
        );
        at++;
        assert.equal(
          (await service().apply(b, command("use_unistop", id))).receipt.status,
          "applied",
        );
        at = origin + 10 * 12 * 60 * 60 * 1000;
        assert.equal(
          (await service().apply(b, command("use_unistop", id))).receipt.status,
          "applied",
        );
        assert.equal(
          (await service().apply(b, command("use_unistop", id))).receipt.reason,
          "COOLDOWN",
        );
        assert.equal(await balance(b, "fixture-points"), "3");
      },
    );
    await t.test(
      "Gift-bearing profiles fail closed without reroll, cooldown or inventory effect",
      async () => {
        const b = await actor();
        const before = rolls;
        for (const profile of ["nitro", "predator"]) {
          const id = await target("unistop", profile);
          await discover(b, id);
          assert.equal(
            (await service().apply(b, command("use_unistop", id))).receipt
              .reason,
            "POLICY_PENDING",
          );
        }
        assert.equal(rolls, before);
        for (const table of [
          "reward_ledger",
          "reward_outbox",
          "reward_cooldowns",
        ])
          assert.equal(await count(table, b), "0");
      },
    );
    await t.test(
      "twenty discovered actors race one finite Chest; only winner spends a Key",
      async () => {
        const id = await target("chest", null, { kind: "points", quantity: 2 });
        const actors = await Promise.all(
          Array.from({ length: 20 }, () => actor(1n)),
        );
        for (const b of actors) await discover(b, id);
        const results = await Promise.all(
          actors.map((b) => service().apply(b, command("open_chest", id))),
        );
        assert.equal(
          results.filter((r) => r.receipt.status === "applied").length,
          1,
        );
        for (let i = 0; i < actors.length; i++) {
          const won = results[i]!.receipt.status === "applied";
          assert.equal(
            await balance(actors[i]!, "fixture-key"),
            won ? "0" : "1",
          );
          assert.equal(
            await balance(actors[i]!, "fixture-points"),
            won ? "2" : "0",
          );
          if (!won) assert.equal(results[i]!.receipt.reason, "NOT_AVAILABLE");
        }
      },
    );
    await t.test(
      "one Key cannot open two Chests concurrently; missing Key leaves Chest available",
      async () => {
        const b = await actor(1n);
        const ids = await Promise.all([
          target("chest", null, { kind: "crystals", quantity: 3 }),
          target("chest", null, { kind: "crystals", quantity: 3 }),
        ]);
        for (const id of ids) await discover(b, id);
        const results = await Promise.all(
          ids.map((id) => service().apply(b, command("open_chest", id))),
        );
        assert.equal(
          results.filter((r) => r.receipt.status === "applied").length,
          1,
        );
        assert.equal(
          results.filter((r) => r.receipt.reason === "KEY_REQUIRED").length,
          1,
        );
        assert.equal(await balance(b, "fixture-key"), "0");
        assert.equal(await balance(b, "fixture-crystals"), "3");
        const other = await actor(1n);
        const remaining =
          ids[results.findIndex((r) => r.receipt.reason === "KEY_REQUIRED")]!;
        await discover(other, remaining);
        assert.equal(
          (await service().apply(other, command("open_chest", remaining)))
            .receipt.status,
          "applied",
        );
      },
    );
    await t.test(
      "Chest Key reward records separate spend/grant legs even for zero net change",
      async () => {
        const b = await actor(1n);
        const id = await target("chest", null, { kind: "key", quantity: 1 });
        await discover(b, id);
        const c = command("open_chest", id);
        assert.equal((await service().apply(b, c)).receipt.status, "applied");
        assert.equal(await balance(b, "fixture-key"), "1");
        assert.equal(await count("reward_ledger", b), "2");
        assert.equal((await service().apply(b, c)).kind, "replay");
        assert.equal(await count("reward_ledger", b), "2");
      },
    );
    await t.test(
      "same-school discovery is actor-private; hidden and missing IDs share a rejection",
      async () => {
        const owner = await actor(1n);
        const stranger = await actor(1n);
        const id = await target("chest", null, { kind: "points", quantity: 1 });
        await discover(owner, id);
        for (const targetId of [id, "missing-hidden-target"]) {
          const r = await service().apply(
            stranger,
            command("open_chest", targetId),
          );
          assert.equal(r.receipt.reason, "NOT_AVAILABLE");
          assert.equal(r.receipt.reward, null);
        }
        assert.equal(await balance(stranger, "fixture-key"), "1");
        await assert.rejects(() =>
          service().apply(
            { ...owner, schoolSlot: 15 },
            command("open_chest", id),
          ),
        );
        assert.equal(
          (await service().apply(owner, command("open_chest", id))).receipt
            .status,
          "applied",
        );
      },
    );
    await t.test(
      "outbox failure rolls back Key, Chest, cooldown, receipt and reward together",
      async () => {
        const chestActor = await actor(1n);
        const stopActor = await actor();
        const chest = await target("chest", null, {
          kind: "points",
          quantity: 2,
        });
        const stop = await target("unistop");
        await discover(chestActor, chest);
        await discover(stopActor, stop);
        const chestCommand = command("open_chest", chest);
        const stopCommand = command("use_unistop", stop);
        await pool.query(
          "CREATE OR REPLACE FUNCTION r2pl_prep.test_reward_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END; $$",
        );
        await pool.query(
          "CREATE TRIGGER test_reward_failure BEFORE INSERT ON r2pl_prep.reward_outbox FOR EACH ROW EXECUTE FUNCTION r2pl_prep.test_reward_failure()",
        );
        try {
          for (const [b, c] of [
            [chestActor, chestCommand],
            [stopActor, stopCommand],
          ] as const) {
            await assert.rejects(() => service().apply(b, c));
            for (const table of [
              "reward_receipts",
              "reward_ledger",
              "reward_outbox",
              "reward_cooldowns",
              "reward_chest_claims",
            ])
              assert.equal(await count(table, b), "0");
            assert.equal(await balance(b, "fixture-points"), "0");
          }
          assert.equal(await balance(chestActor, "fixture-key"), "1");
        } finally {
          await pool.query(
            "DROP TRIGGER test_reward_failure ON r2pl_prep.reward_outbox",
          );
          await pool.query("DROP FUNCTION r2pl_prep.test_reward_failure()");
        }
        assert.equal(
          (await service().apply(chestActor, chestCommand)).receipt.status,
          "applied",
        );
        assert.equal(
          (await service().apply(stopActor, stopCommand)).receipt.status,
          "applied",
        );
      },
    );
    await t.test(
      "overflow rolls back reward and cooldown rather than acknowledging partial effect",
      async () => {
        const b = await actor();
        const id = await target("unistop");
        await discover(b, id);
        await pool.query(
          "INSERT INTO r2pl_prep.reward_accounts VALUES($1,$2,'fixture-points',9223372036854775807,9223372036854775807)",
          [campaignId, b.actorId],
        );
        await assert.rejects(() =>
          service().apply(b, command("use_unistop", id)),
        );
        for (const table of [
          "reward_receipts",
          "reward_ledger",
          "reward_outbox",
          "reward_cooldowns",
        ])
          assert.equal(await count(table, b), "0");
      },
    );
    await t.test(
      "actual process termination after commit returns the same durable reward on retry",
      async () => {
        const b = await actor();
        const id = await target("unistop");
        await discover(b, id);
        const c = command("use_unistop", id);
        await assert.rejects(
          () =>
            execFileAsync(
              process.execPath,
              [
                "--experimental-strip-types",
                fileURLToPath(
                  new URL(
                    "../scripts/reward-recovery-child.ts",
                    import.meta.url,
                  ),
                ),
                JSON.stringify(b),
                JSON.stringify(c),
              ],
              {
                env: { ...process.env, R2PL_REWARD_RECOVERY_TEST: "1" },
                windowsHide: true,
              },
            ),
          (error) =>
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === 86,
        );
        const before = rolls;
        const r = await service().apply(b, c);
        assert.equal(r.kind, "replay");
        assert.equal(r.receipt.status, "applied");
        assert.equal(await balance(b, "fixture-points"), "1");
        assert.equal(rolls, before);
        for (const table of [
          "reward_receipts",
          "reward_ledger",
          "reward_outbox",
        ])
          assert.equal(await count(table, b), "1");
      },
    );
    await t.test(
      "inventory conservation holds; invalid random ticket rolls back; default clock comes from DB",
      async () => {
        const mismatch = await pool.query(
          "SELECT 1 FROM r2pl_prep.reward_accounts a WHERE campaign_id=$1 AND balance<>opening_balance+COALESCE((SELECT sum(amount) FROM r2pl_prep.reward_ledger l WHERE l.campaign_id=a.campaign_id AND l.actor_id=a.actor_id AND l.resource=a.resource),0)",
          [campaignId],
        );
        assert.equal(mismatch.rowCount, 0);
        const b = await actor();
        const id = await target("unistop");
        await discover(b, id);
        ticket = 1000;
        await assert.rejects(() =>
          service().apply(b, command("use_unistop", id)),
        );
        assert.equal(await count("reward_receipts", b), "0");
        ticket = 0;
        const realClockService = new PgRewardPreparation(pool, {
          mode: "synthetic-preparation",
          ruleVersion: REWARD_PREPARATION_VERSION,
        });
        const real = await realClockService.apply(
          b,
          command("use_unistop", id),
        );
        assert.ok(Math.abs(real.receipt.processedAtMs - Date.now()) < 5000);
      },
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
});
