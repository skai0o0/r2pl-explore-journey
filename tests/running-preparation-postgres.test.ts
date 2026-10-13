import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import type { CampaignBinding } from "../server/integration/CampaignProvider.ts";
import {
  PgRunningPreparation,
  RunningPayloadConflict,
} from "../server/integration/PgRunningPreparation.ts";
import { campaignWeekStart } from "../shared/integration/running.ts";

const url = process.env.R2PL_PREPARATION_DATABASE_URL;
const conversion = {
  ruleVersion: "fixture-rate-v1",
  pointsNumerator: 3n,
  metersDenominator: 1000n,
};
const now = Date.parse("2026-10-13T03:00:00Z");
const snapshot = (revision: string, meters: string) => ({
  provider: "synthetic",
  externalStudentId: "student-1",
  revision,
  cumulativeMeters: meters,
  weeklyMeters: "0",
  observedAtMs: now,
  weekStartMs: campaignWeekStart(now),
});

test("disposable PostgreSQL running preparation transaction invariants", {
  skip:
    !url &&
    "Set R2PL_PREPARATION_DATABASE_URL to a loopback r2pl_prep_test_* database",
  timeout: 60_000,
}, async (t) => {
  const parsed = new URL(url!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.ok(parsed.pathname.startsWith("/r2pl_prep_test_"));
  assert.match(parsed.pathname.slice(1), /^r2pl_prep_test_[a-z0-9_]+$/);
  const pool = new Pool({ connectionString: url, max: 8 });
  const campaignId = randomUUID();
  const service = () =>
    new PgRunningPreparation(pool, {
      mode: "synthetic-preparation",
      conversion,
    });
  const provision = async () => {
    const bound: CampaignBinding = {
      campaignId,
      actorId: randomUUID(),
      schoolSlot: 15,
      externalSchoolId: "school-1",
      provider: "synthetic",
      externalStudentId: randomUUID(),
    };
    await pool.query(
      "INSERT INTO r2pl_prep.running_bindings VALUES($1,$2,$3,$4,$5,$6)",
      [
        campaignId,
        bound.actorId,
        bound.provider,
        bound.externalStudentId,
        bound.schoolSlot,
        bound.externalSchoolId,
      ],
    );
    await pool.query(
      "INSERT INTO r2pl_prep.running_accounts(campaign_id,actor_id,resource) VALUES($1,$2,'fixture-running-points')",
      [campaignId, bound.actorId],
    );
    return bound;
  };
  const feed = (bound: CampaignBinding, revision: string, meters: string) => ({
    ...snapshot(revision, meters),
    externalStudentId: bound.externalStudentId,
  });
  const balance = async (bound: CampaignBinding) =>
    (
      await pool.query<{ balance: string }>(
        "SELECT balance FROM r2pl_prep.running_accounts WHERE campaign_id=$1 AND actor_id=$2",
        [campaignId, bound.actorId],
      )
    ).rows[0]!.balance;
  try {
    await pool.query(
      await readFile(
        new URL(
          "../database/preparation/001_running_sync_dev.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await t.test(
      "concurrent duplicate feed credits once with one receipt, ledger and private outbox",
      async () => {
        const b = await provision();
        const s = service();
        const results = await Promise.all(
          Array.from({ length: 16 }, () => s.apply(b, feed(b, "1", "1500"))),
        );
        assert.equal(results.filter((r) => r.kind === "committed").length, 1);
        assert.equal(results.filter((r) => r.kind === "replay").length, 15);
        assert.equal(await balance(b), "4");
        for (const table of [
          "running_receipts",
          "running_ledger",
          "running_outbox",
        ]) {
          const row = await pool.query<{ count: string }>(
            `SELECT count(*) FROM r2pl_prep.${table} WHERE campaign_id=$1 AND actor_id=$2`,
            [campaignId, b.actorId],
          );
          assert.equal(row.rows[0]!.count, "1");
        }
        const event = (
          await pool.query<{ payload: Record<string, unknown> }>(
            "SELECT payload FROM r2pl_prep.running_outbox WHERE campaign_id=$1 AND actor_id=$2",
            [campaignId, b.actorId],
          )
        ).rows[0]!.payload;
        assert.deepEqual(Object.keys(event).sort(), [
          "attributedPoints",
          "balance",
          "delta",
          "revision",
          "status",
        ]);
        await assert.rejects(
          () => s.apply(b, feed(b, "1", "1501")),
          RunningPayloadConflict,
        );
        const replay = await service().apply(b, feed(b, "1", "1500"));
        assert.equal(replay.kind, "replay");
        assert.equal(await balance(b), "4");
      },
    );
    await t.test(
      "late older revisions cannot overwrite checkpoints; corrections reconcile exactly",
      async () => {
        const b = await provision();
        const s = service();
        await s.apply(b, feed(b, "3", "2000"));
        assert.deepEqual(await s.apply(b, feed(b, "2", "1500")), {
          kind: "stale",
        });
        const corrected = await s.apply(b, feed(b, "4", "1000"));
        assert.ok(corrected.kind !== "stale");
        assert.equal(corrected.receipt.delta, "-3");
        assert.equal(await balance(b), "3");
      },
    );
    await t.test(
      "spent balance correction records review receipt without negative balance or checkpoint advance",
      async () => {
        const b = await provision();
        const s = service();
        await s.apply(b, feed(b, "1", "1500"));
        await pool.query(
          "UPDATE r2pl_prep.running_accounts SET balance=0 WHERE campaign_id=$1 AND actor_id=$2",
          [campaignId, b.actorId],
        );
        const r = await s.apply(b, feed(b, "2", "0"));
        assert.ok(r.kind !== "stale");
        assert.equal(r.receipt.status, "reconciliation_required");
        assert.equal(r.receipt.delta, "0");
        assert.equal(await balance(b), "0");
        const cp = (
          await pool.query<{ checkpoint: { snapshot: { revision: string } } }>(
            "SELECT checkpoint FROM r2pl_prep.running_accounts WHERE campaign_id=$1 AND actor_id=$2",
            [campaignId, b.actorId],
          )
        ).rows[0]!.checkpoint;
        assert.equal(cp.snapshot.revision, "1");
        assert.equal(
          (await service().apply(b, feed(b, "2", "0"))).kind,
          "replay",
        );
      },
    );
    await t.test(
      "rounding-only revisions advance checkpoint without inventing a ledger debit",
      async () => {
        const b = await provision();
        const s = service();
        const r = await s.apply(b, feed(b, "1", "333"));
        assert.ok(r.kind !== "stale");
        assert.equal(r.receipt.status, "no_change");
        const second = await s.apply(b, feed(b, "2", "334"));
        assert.ok(second.kind !== "stale");
        assert.equal(second.receipt.delta, "1");
        assert.equal(await balance(b), "1");
      },
    );
    await t.test(
      "forged binding and conversion changes cannot mutate an account",
      async () => {
        const b = await provision();
        const s = service();
        await s.apply(b, feed(b, "1", "1500"));
        await assert.rejects(() =>
          s.apply({ ...b, schoolSlot: 0 }, feed(b, "2", "2000")),
        );
        await assert.rejects(() =>
          s.apply(b, {
            ...feed(b, "2", "2000"),
            externalStudentId: "student-2",
          }),
        );
        const changed = new PgRunningPreparation(pool, {
          mode: "synthetic-preparation",
          conversion: { ...conversion, pointsNumerator: 4n },
        });
        await assert.rejects(
          () => changed.apply(b, feed(b, "1", "1500")),
          RunningPayloadConflict,
        );
        await assert.rejects(() => changed.apply(b, feed(b, "2", "2000")));
        assert.equal(await balance(b), "4");
      },
    );
    await t.test(
      "outbox failure rolls back balance, checkpoint, receipt and ledger before acknowledgement",
      async () => {
        const b = await provision();
        await pool.query(
          "CREATE OR REPLACE FUNCTION r2pl_prep.test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END; $$",
        );
        await pool.query(
          "CREATE TRIGGER test_fail_outbox BEFORE INSERT ON r2pl_prep.running_outbox FOR EACH ROW EXECUTE FUNCTION r2pl_prep.test_fail_outbox()",
        );
        try {
          await assert.rejects(() => service().apply(b, feed(b, "1", "1500")));
          assert.equal(await balance(b), "0");
          for (const table of [
            "running_receipts",
            "running_ledger",
            "running_outbox",
          ]) {
            const rows = await pool.query(
              `SELECT 1 FROM r2pl_prep.${table} WHERE campaign_id=$1 AND actor_id=$2`,
              [campaignId, b.actorId],
            );
            assert.equal(rows.rowCount, 0);
          }
        } finally {
          await pool.query(
            "DROP TRIGGER test_fail_outbox ON r2pl_prep.running_outbox",
          );
          await pool.query("DROP FUNCTION r2pl_prep.test_fail_outbox()");
        }
        assert.equal(
          (await service().apply(b, feed(b, "1", "1500"))).kind,
          "committed",
        );
        assert.equal(await balance(b), "4");
      },
    );
  } finally {
    for (const table of [
      "running_outbox",
      "running_ledger",
      "running_receipts",
      "running_accounts",
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
