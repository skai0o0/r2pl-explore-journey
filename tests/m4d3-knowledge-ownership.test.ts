import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateKnowledgeProjectionEffectsV1 } from "../server/persistence/KnowledgeOwnershipProjectorV1.ts";
import {
  HARD_CLAIM_MS,
  KNOWLEDGE_RULES_V1,
  ROLLING_FADE_MS,
  startKnowledgeContest,
  transitionKnowledge,
} from "../shared/gameplay/knowledgeRulesV1.ts";

function wire(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}
test("M4-D3 exact immutable effects, provisional zero and mixed retention", () => {
  const campaignId = randomUUID();
  const shared = startKnowledgeContest({
    campaignId,
    contestId: randomUUID(),
    schoolSlots: [0, 1],
    openedAtMs: 0n,
    tiles: [
      { tileIndex: 0, incumbentSchoolSlot: 1 },
      { tileIndex: 1, incumbentSchoolSlot: 0 },
    ],
  });
  const opened = transitionKnowledge(shared, {
    kind: "departure",
    schoolSlot: 0,
    atMs: 0n,
    remainingSchoolValid: true,
  });
  const snapshot = wire({
    ruleVersion: KNOWLEDGE_RULES_V1,
    ruleParameters: {
      rollingFadeMs: ROLLING_FADE_MS,
      hardClaimMs: HARD_CLAIM_MS,
      fee: "ceil(eligibleTileCount/2)",
    },
    contestId: shared.contestId,
    schoolSlots: shared.schoolSlots,
    tiles: shared.tiles,
    departingSchoolSlot: 0,
  });
  const input = {
    campaignId,
    snapshot,
    state: wire(opened.state),
    revision: 1,
    effects: wire(opened.effects),
  };
  assert.deepEqual(validateKnowledgeProjectionEffectsV1(input), [
    { kind: "ownership", tileIndex: 0, ownerSchoolSlot: 1 },
    { kind: "ownership", tileIndex: 1, ownerSchoolSlot: null },
  ]);
  for (const effects of [
    [],
    [...opened.effects, opened.effects[0]],
    [{ kind: "ownership", tileIndex: 1, ownerSchoolSlot: 1 }],
  ]) {
    assert.throws(() =>
      validateKnowledgeProjectionEffectsV1({
        ...input,
        effects: wire(effects),
      }),
    );
  }
  const failed = transitionKnowledge(opened.state, {
    kind: "expire",
    atMs: ROLLING_FADE_MS,
  });
  assert.deepEqual(
    validateKnowledgeProjectionEffectsV1({
      ...input,
      state: wire(failed.state),
      revision: 2,
      effects: wire(failed.effects),
    }),
    [{ kind: "ownership", tileIndex: 1, ownerSchoolSlot: null }],
  );
  const success = transitionKnowledge(opened.state, {
    kind: "contribute",
    contributionId: "receipt",
    actorId: "payer",
    walletId: "payer",
    schoolSlot: 1,
    verified: true,
    requestedPoints: 1n,
    walletBalance: 1n,
    atMs: 1n,
  });
  assert.deepEqual(
    validateKnowledgeProjectionEffectsV1({
      ...input,
      state: wire(success.state),
      revision: 2,
      effects: wire(success.effects),
    }),
    [{ kind: "ownership", tileIndex: 1, ownerSchoolSlot: 1 }],
  );
  // A lagging worker validates revision 1 even when the case has already settled.
  assert.deepEqual(
    validateKnowledgeProjectionEffectsV1({
      ...input,
      state: wire(success.state),
    }),
    opened.effects,
  );
  assert.throws(() =>
    validateKnowledgeProjectionEffectsV1({ ...input, revision: 3 }),
  );
  assert.throws(() =>
    validateKnowledgeProjectionEffectsV1({
      ...input,
      state: wire(success.state),
      revision: 2,
      effects: wire(
        success.effects.filter((effect) => effect.kind === "ownership"),
      ),
    }),
  );
});

test("M4-D3 PostgreSQL ownership, scores, ordered ACK, rollback and retry", {
  skip:
    !process.env.R2PL_TEST_DATABASE_URL &&
    "R2PL_TEST_DATABASE_URL absent; no database contacted",
}, async (t) => {
  const { Pool } = await import("pg");
  // Strict helper permits only local disposable databases OR exact approved Supabase QA.
  const { disposableDatabaseUrl } = await import("../scripts/migrate-m4d2.ts");
  const { KnowledgeCaseStoreV1 } = await import(
    "../server/persistence/KnowledgeCaseStoreV1.ts"
  );
  const { KnowledgeOwnershipProjectorV1 } = await import(
    "../server/persistence/KnowledgeOwnershipProjectorV1.ts"
  );
  const { CommittedResultInterrupted } = await import(
    "../server/persistence/M3TestMutation.ts"
  );
  const connectionString = disposableDatabaseUrl(
    process.env.R2PL_TEST_DATABASE_URL!,
  );
  // The imported disposableDatabaseUrl guard already rejects production and arbitrary hosts.

  const pool = new Pool({ connectionString, max: 8 });
  t.after(async () => {
    await pool.end();
  });
  const bootstrap = await pool.connect();
  try {
    await bootstrap.query("BEGIN");
    await bootstrap.query("SELECT pg_advisory_xact_lock(2189,3)");
    const exists = await bootstrap.query<{ name: string | null }>(
      "SELECT to_regclass('r2pl_v2.schema_migrations')::text AS name",
    );
    for (const [version, file] of [
      [1, "001_m3_foundation.sql"],
      [2, "002_m35_view_revisions.sql"],
      [3, "003_m4d2_knowledge_durable.sql"],
      [4, "004_m4d3_knowledge_projection.sql"],
    ] as const) {
      const sql = (
        await readFile(
          new URL(`../database/migrations/${file}`, import.meta.url),
          "utf8",
        )
      ).replace(/\r\n/g, "\n");
      const hash = createHash("sha256").update(sql).digest();
      const prior =
        exists.rows[0]!.name || version > 1
          ? await bootstrap.query<{ sha256: Buffer }>(
              "SELECT sha256 FROM r2pl_v2.schema_migrations WHERE version=$1",
              [version],
            )
          : { rows: [] };
      if (prior.rows[0])
        assert(
          prior.rows[0].sha256.equals(hash),
          `Migration ${version} checksum mismatch`,
        );
      else {
        await bootstrap.query(sql);
        await bootstrap.query(
          "INSERT INTO r2pl_v2.schema_migrations(version,sha256) VALUES($1,$2)",
          [version, hash],
        );
      }
    }
    await bootstrap.query("COMMIT");
  } catch (error) {
    await bootstrap.query("ROLLBACK");
    throw error;
  } finally {
    bootstrap.release();
  }
  const campaignId = randomUUID(),
    actorId = randomUUID();
  await pool.query(
    "INSERT INTO r2pl_v2.campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
    [campaignId, `m4d3-${campaignId}`],
  );
  await pool.query(
    "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'points',100,100)",
    [campaignId, actorId],
  );
  let now = 1000n;
  const store = new KnowledgeCaseStoreV1(pool, {
    developmentOnly: true,
    identity: async () => ({ verified: true, schoolSlot: 1 }),
    testClock: async () => now,
  });
  const makeProjector = () =>
    new KnowledgeOwnershipProjectorV1(pool, { developmentOnly: true });
  const counts = async () => {
    const result = await pool.query<{
      tiles: string;
      acks: string;
      score: string;
      public_events: string;
    }>(
      `SELECT (SELECT count(*) FROM r2pl_v2.knowledge_ownership_tiles_v1 WHERE campaign_id=$1)::text AS tiles,
       (SELECT count(*) FROM r2pl_v2.knowledge_projection_acks_v1 WHERE campaign_id=$1)::text AS acks,
       (SELECT coalesce(sum(active_tiles),0) FROM r2pl_v2.knowledge_school_scores_v1 WHERE campaign_id=$1)::text AS score,
       (SELECT count(*) FROM r2pl_v2.outbox_events WHERE campaign_id=$1)::text AS public_events`,
      [campaignId],
    );
    return result.rows[0]!;
  };
  const open = async (base: number) => {
    const caseId = randomUUID();
    await store.open({
      campaignId,
      caseId,
      contestId: randomUUID(),
      schoolSlots: [0, 1],
      departingSchoolSlot: 0,
      tiles: [
        { tileIndex: base, incumbentSchoolSlot: 1 },
        { tileIndex: base + 1, incumbentSchoolSlot: 0 },
      ],
    });
    return caseId;
  };
  const first = await open(10);
  // Synthetic authorized baseline seam: Shared membership contributes +1 per
  // school per tile. Seed and scores are one transaction; never read M3 masks.
  const seed = await pool.connect();
  try {
    await seed.query("BEGIN");
    await seed.query(
      "INSERT INTO r2pl_v2.knowledge_ownership_tiles_v1(campaign_id,tile_index,active_school_mask,case_id,case_revision) VALUES($1,10,3,$2,0),($1,11,3,$2,0)",
      [campaignId, first],
    );
    await seed.query(
      "INSERT INTO r2pl_v2.knowledge_school_scores_v1(campaign_id,school_slot,active_tiles) VALUES($1,0,2),($1,1,2)",
      [campaignId],
    );
    await seed.query("COMMIT");
  } catch (error) {
    await seed.query("ROLLBACK");
    throw error;
  } finally {
    seed.release();
  }
  assert.equal((await counts()).score, "4");
  await store.contribute({
    campaignId,
    caseId: first,
    actorId,
    contributionId: randomUUID(),
    requestedPoints: 1n,
  });
  const before = await counts();
  await assert.rejects(
    makeProjector().projectNext(campaignId, {
      beforeCommit: () => {
        throw new Error("crash");
      },
    }),
  );
  assert.deepEqual(await counts(), before);
  await assert.rejects(
    makeProjector().projectNext(campaignId, {
      afterCommit: () => {
        throw new Error("ACK lost");
      },
    }),
    CommittedResultInterrupted,
  );
  assert.equal((await counts()).score, "1"); // retained incumbent only; provisional scores zero
  assert.equal(await makeProjector().projectNext(campaignId), true);
  assert.equal((await counts()).score, "2");
  assert.equal(await makeProjector().projectNext(campaignId), false);
  const second = await open(20),
    third = await open(30);
  now += ROLLING_FADE_MS;
  await store.expire(campaignId, second);
  await store.expire(campaignId, third);
  for (;;) {
    const results = await Promise.all([
      makeProjector().projectNext(campaignId),
      makeProjector().projectNext(campaignId),
    ]);
    if (!results.some(Boolean)) break;
  }
  assert.deepEqual(await counts(), {
    tiles: "6",
    acks: "6",
    score: "4",
    public_events: "0",
  });
  const tiles = await pool.query<{
    tile_index: number;
    active_school_mask: number;
  }>(
    "SELECT tile_index,active_school_mask FROM r2pl_v2.knowledge_ownership_tiles_v1 WHERE campaign_id=$1 ORDER BY tile_index",
    [campaignId],
  );
  assert.deepEqual(
    tiles.rows.map((r) => [r.tile_index, r.active_school_mask]),
    [
      [10, 2],
      [11, 2],
      [20, 2],
      [21, 0],
      [30, 2],
      [31, 0],
    ],
  );
  // Unsupported overlapping successor cannot silently steal ownership or ACK.
  await open(10);
  const settled = await counts();
  await assert.rejects(makeProjector().projectNext(campaignId), /handoff/);
  assert.deepEqual(await counts(), settled);
  const privacy = await pool.query<{
    relrowsecurity: boolean;
    policies: string;
  }>(
    `SELECT c.relrowsecurity,(SELECT count(*)::text FROM pg_policy p WHERE p.polrelid=c.oid) AS policies
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='r2pl_v2'
     AND c.relname IN ('knowledge_ownership_tiles_v1','knowledge_school_scores_v1','knowledge_projection_acks_v1')`,
  );
  assert.equal(privacy.rowCount, 3);
  assert(privacy.rows.every((r) => r.relrowsecurity && r.policies === "0"));
});
