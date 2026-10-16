import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("canonical school migration preserves slots, identity, balances, world/fog and editor rollback data", {
  skip: !database,
}, async () => {
  const target = new URL(database!);
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
      /^r2pl_(prep|bot)_test_/.test(target.pathname.slice(1)),
  );
  const pool = new Pool({ connectionString: database });
  await migratePortalDatabase(pool);
  const db = await pool.connect();
  const campaign = randomUUID(),
    actor = randomUUID();
  try {
    // Transaction rollback also restores any unrelated legacy rows in this test DB.
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO r2pl_v2.campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaign, campaign],
    );
    await db.query(
      "INSERT INTO r2pl_v2.campaign_schools VALUES($1,'hcmcou',1),($1,'dhhp',3)",
      [campaign],
    );
    await db.query(
      "INSERT INTO r2pl_v2.portal_members VALUES($1,'existing-student',$2,'hcmcou',1,'Existing student',true)",
      [campaign, actor],
    );
    await db.query(
      "INSERT INTO r2pl_prep.running_bindings VALUES($1,$2,'portal-v1','existing-student',1,'hcmcou')",
      [campaign, actor],
    );
    await db.query(
      "INSERT INTO r2pl_v2.wallet_accounts VALUES($1,$2,'fixture-credit',1000,731)",
      [campaign, actor],
    );
    await db.query("INSERT INTO r2pl_v2.world_chunk_heads VALUES($1,0,19)", [
      campaign,
    ]);
    const mask = Buffer.alloc(8192, 2),
      fog = Buffer.alloc(512, 53);
    await db.query("INSERT INTO r2pl_v2.world_chunks VALUES($1,0,19,$2,1234)", [
      campaign,
      mask,
    ]);
    await db.query(
      "INSERT INTO r2pl_v2.school_fog_chunks VALUES($1,0,1,19,$2,5678)",
      [campaign, fog],
    );
    const objects = [
      {
        id: "hq-hcmcou",
        kind: "hq",
        schoolId: "hcmcou",
        schoolSlot: 1,
        name: "HCMCOU HQ",
        x: 655,
        z: 345,
      },
      {
        id: "hq-dhhp",
        kind: "hq",
        schoolId: "dhhp",
        schoolSlot: 3,
        name: "Custom campus",
        x: 655,
        z: 655,
      },
    ];
    for (const object of objects)
      await db.query(
        "INSERT INTO r2pl_v2.game_world_objects VALUES($1,$2,$3)",
        [campaign, object.id, JSON.stringify(object)],
      );
    await db.query(
      "INSERT INTO r2pl_v2.editor_drafts(campaign_id,actor_id,revision,base_revision,objects) VALUES($1,$2,3,2,$3)",
      [campaign, actor, JSON.stringify(objects)],
    );
    await db.query(
      "INSERT INTO r2pl_v2.editor_versions(campaign_id,revision,actor_id,objects) VALUES($1,2,$2,$3)",
      [campaign, actor, JSON.stringify(objects)],
    );
    await db.query(
      "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'layout-backup','previous',$2)",
      [campaign, JSON.stringify(objects)],
    );
    const fks = await db.query(
      "SELECT conrelid,conname,condeferrable,condeferred FROM pg_constraint WHERE contype='f' ORDER BY conrelid,conname",
    );
    const sql = await readFile(
      new URL(
        "../database/migrations/008_canonical_school_ids.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(sql);
    assert.deepEqual(
      (
        await db.query(
          "SELECT school_id,slot FROM r2pl_v2.campaign_schools WHERE campaign_id=$1 ORDER BY slot",
          [campaign],
        )
      ).rows,
      [
        { school_id: "ou", slot: 1 },
        { school_id: "hpuni", slot: 3 },
      ],
    );
    const member = (
      await db.query(
        "SELECT * FROM r2pl_v2.portal_members WHERE campaign_id=$1",
        [campaign],
      )
    ).rows[0];
    assert.equal(member.actor_id, actor);
    assert.equal(member.school_id, "ou");
    assert.equal(member.school_slot, 1);
    assert.equal(
      (
        await db.query(
          "SELECT external_school_id FROM r2pl_prep.running_bindings WHERE campaign_id=$1",
          [campaign],
        )
      ).rows[0].external_school_id,
      "ou",
    );
    assert.equal(
      (
        await db.query(
          "SELECT balance FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1",
          [campaign],
        )
      ).rows[0].balance,
      "731",
    );
    const world = (
      await db.query(
        "SELECT mask,revision FROM r2pl_v2.world_chunks WHERE campaign_id=$1",
        [campaign],
      )
    ).rows[0];
    assert.deepEqual(world.mask, mask);
    assert.equal(world.revision, "19");
    assert.deepEqual(
      (
        await db.query(
          "SELECT fog FROM r2pl_v2.school_fog_chunks WHERE campaign_id=$1",
          [campaign],
        )
      ).rows[0].fog,
      fog,
    );
    const expected = [
      { ...objects[0], id: "hq-ou", schoolId: "ou", name: "OU HQ" },
      { ...objects[1], id: "hq-hpuni", schoolId: "hpuni" },
    ];
    for (const table of ["editor_drafts", "editor_versions"])
      assert.deepEqual(
        (
          await db.query(
            `SELECT objects FROM r2pl_v2.${table} WHERE campaign_id=$1`,
            [campaign],
          )
        ).rows[0].objects,
        expected,
      );
    assert.deepEqual(
      (
        await db.query(
          "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1",
          [campaign],
        )
      ).rows[0].data,
      expected,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 ORDER BY data->>'schoolSlot'",
          [campaign],
        )
      ).rows.map((r) => r.data),
      expected,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT conrelid,conname,condeferrable,condeferred FROM pg_constraint WHERE contype='f' ORDER BY conrelid,conname",
        )
      ).rows,
      fks.rows,
    );
    await db.query("SAVEPOINT immutable_guard");
    await assert.rejects(
      db.query(
        "UPDATE r2pl_v2.campaign_schools SET slot=2 WHERE campaign_id=$1 AND school_id='ou'",
        [campaign],
      ),
      /slots are immutable/,
    );
    await db.query("ROLLBACK TO SAVEPOINT immutable_guard");
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
});
