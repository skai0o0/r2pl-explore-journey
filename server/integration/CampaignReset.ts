import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { migrateBeacons } from "./BeaconBuffs.ts";
import { seedHeadquarters } from "./SchoolHeadquarters.ts";

interface HeadquartersObject {
  schoolSlot: number;
  x: number;
  z: number;
  width: number;
  height: number;
}
/** Caller holds the campaign lock and transaction. Preserve identities, external Running and issued Gifts. */
export async function resetCampaign(
  db: PoolClient,
  campaign: string,
): Promise<Record<string, unknown>> {
  const resetId = randomUUID(),
    details: Record<string, number | null> = {};
  const campaignRow = (
    await db.query(
      "SELECT code,write_strategy FROM r2pl_v2.campaigns WHERE id=$1 FOR UPDATE",
      [campaign],
    )
  ).rows[0];
  assert.equal(campaignRow?.code, `portal-v1-${campaign}`);
  assert.equal(campaignRow.write_strategy, "full_chunk");
  const oldHq = (
    await db.query<{ data: HeadquartersObject }>(
      "SELECT data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 AND data->>'kind'='hq' ORDER BY (data->>'schoolSlot')::int",
      [campaign],
    )
  ).rows.map((r) => r.data);
  assert.equal(oldHq.length, 8);
  const areas = oldHq.map((h, i) => {
    assert.equal(h.schoolSlot, i);
    assert(
      Number.isInteger(h.width) &&
        h.width > 0 &&
        h.width === h.height &&
        Number.isInteger(h.x - h.width / 2) &&
        Number.isInteger(h.z - h.height / 2),
    );
    return {
      schoolSlot: i,
      x: h.x - h.width / 2,
      z: h.z - h.height / 2,
      size: h.width,
    };
  });
  const protectedState = async () =>
    JSON.stringify({
      members: (
        await db.query(
          "SELECT count(*)::int n FROM r2pl_v2.portal_members WHERE campaign_id=$1",
          [campaign],
        )
      ).rows[0].n,
      admins: (
        await db.query(
          "SELECT count(*)::int n FROM r2pl_v2.portal_admins WHERE campaign_id=$1",
          [campaign],
        )
      ).rows[0].n,
      profiles: (
        await db.query(
          "SELECT count(*)::int n FROM r2pl_v2.partner_test_profiles WHERE campaign_id=$1",
          [campaign],
        )
      ).rows[0].n,
      running: (
        await db.query(
          "SELECT id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='running' ORDER BY id",
          [campaign],
        )
      ).rows,
      gifts: (
        await db.query(
          "SELECT scope,id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope IN ('gift-entitlement','gift-pool','gift-stock') ORDER BY scope,id",
          [campaign],
        )
      ).rows,
      overrides: (
        await db.query(
          "SELECT count(*)::int n FROM r2pl_v2.portal_student_overrides WHERE campaign_id=$1",
          [campaign],
        )
      ).rows[0].n,
    });
  const preserved = await protectedState();
  const nonzero = (
    await db.query<{ actor_id: string; resource: string; balance: string }>(
      "SELECT actor_id,resource,balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND balance>0 FOR UPDATE",
      [campaign],
    )
  ).rows;
  for (const w of nonzero) {
    const key = randomBytes(16),
      hash = createHash("sha256")
        .update(`campaign-reset:${resetId}:${w.actor_id}:${w.resource}`)
        .digest();
    await db.query(
      "INSERT INTO r2pl_v2.command_results(campaign_id,actor_id,command_key,payload_hash,status,result) VALUES($1,$2,$3,$4,'test_applied',$5)",
      [
        campaign,
        w.actor_id,
        key,
        hash,
        JSON.stringify({
          action: "campaign-reset",
          resetId,
          resource: w.resource,
        }),
      ],
    );
    await db.query(
      "INSERT INTO r2pl_v2.ledger_entries(campaign_id,actor_id,command_key,resource,amount) VALUES($1,$2,$3,$4,$5)",
      [campaign, w.actor_id, key, w.resource, (-BigInt(w.balance)).toString()],
    );
    await db.query(
      "UPDATE r2pl_v2.wallet_accounts SET balance=0 WHERE campaign_id=$1 AND actor_id=$2 AND resource=$3",
      [campaign, w.actor_id, w.resource],
    );
  }
  const pools = (
    await db.query<{ actor_id: string; school_slot: number; balance: string }>(
      "SELECT actor_id,school_slot,balance::text FROM r2pl_v2.test_point_pools WHERE campaign_id=$1 FOR UPDATE",
      [campaign],
    )
  ).rows;
  for (const w of pools) {
    if (BigInt(w.balance) === 0n) continue;
    const key = randomBytes(16),
      hash = createHash("sha256")
        .update(`campaign-reset-pool:${resetId}:${w.school_slot}`)
        .digest();
    await db.query(
      "INSERT INTO r2pl_v2.command_results(campaign_id,actor_id,command_key,payload_hash,status,result) VALUES($1,$2,$3,$4,'test_applied',$5)",
      [
        campaign,
        w.actor_id,
        key,
        hash,
        JSON.stringify({
          action: "campaign-reset",
          resetId,
          schoolSlot: w.school_slot,
        }),
      ],
    );
    await db.query(
      "INSERT INTO r2pl_v2.test_point_ledger(campaign_id,actor_id,command_key,resource,amount,pool_actor_id) VALUES($1,$2,$3,'fixture-credit',$4,$2)",
      [campaign, w.actor_id, key, (-BigInt(w.balance)).toString()],
    );
    await db.query(
      "UPDATE r2pl_v2.test_point_pools SET balance=0 WHERE campaign_id=$1 AND school_slot=$2",
      [campaign, w.school_slot],
    );
  }
  await db.query(
    "INSERT INTO r2pl_v2.student_history_archive(campaign_id,actor_id,kind,detail,occurred_at) SELECT campaign_id,actor_id,'event',jsonb_build_object('title',title,'body',body),created_at FROM r2pl_v2.game_events WHERE campaign_id=$1 AND actor_id IS NOT NULL",
    [campaign],
  );
  await db.query(
    "INSERT INTO r2pl_v2.student_history_archive(campaign_id,actor_id,kind,detail,occurred_at) SELECT campaign_id,command_actor,'map',jsonb_build_object('tiles',count(*),'commandKey',encode(command_key,'hex')),min(created_at) FROM r2pl_v2.world_mutations WHERE campaign_id=$1 GROUP BY campaign_id,command_actor,command_key",
    [campaign],
  );
  for (const table of [
    "world_mutations",
    "school_chunk_views",
    "school_fog_chunks",
    "world_chunks",
    "world_chunk_heads",
  ]) {
    const result = await db.query(
      `DELETE FROM r2pl_v2.${table} WHERE campaign_id=$1`,
      [campaign],
    );
    details[table] = result.rowCount;
  }
  await seedHeadquarters(db, campaign, areas);
  const scopes = [
    "beacon",
    "beacon-rally",
    "beacon-schema",
    "buff-usage",
    "knowledge-score",
    "school-beacon",
    "shared-cluster",
    "cooldowns",
    "chest-claim",
    "unistop-arrivals",
  ];
  details.gameStates = (
    await db.query(
      "DELETE FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope=ANY($2::text[])",
      [campaign, scopes],
    )
  ).rowCount;
  const now = Date.now();
  for (const hq of areas)
    await db.query(
      "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'knowledge-score',$2,$3)",
      [
        campaign,
        String(hq.schoolSlot),
        JSON.stringify({ points: hq.size * hq.size, reachedAtMs: now }),
      ],
    );
  details.discoveries = (
    await db.query(
      "DELETE FROM r2pl_v2.game_chest_discoveries WHERE campaign_id=$1",
      [campaign],
    )
  ).rowCount;
  await db.query(
    "UPDATE r2pl_v2.game_world_objects SET data=jsonb_set(jsonb_set(data,'{ownerSchoolSlot}','null'::jsonb),'{ownerSchoolId}','null'::jsonb) WHERE campaign_id=$1 AND data->>'kind'='unistop'",
    [campaign],
  );
  details.events = (
    await db.query("DELETE FROM r2pl_v2.game_events WHERE campaign_id=$1", [
      campaign,
    ])
  ).rowCount;
  details.outboxSettled = (
    await db.query(
      "UPDATE r2pl_v2.outbox_events SET delivered_at=clock_timestamp(),lease_until=NULL,lease_token=NULL WHERE campaign_id=$1 AND delivered_at IS NULL",
      [campaign],
    )
  ).rowCount;
  details.obsoleteNotifications = (
    await db.query(
      "UPDATE r2pl_v2.notification_outbox o SET status='failed',lease_until=NULL WHERE o.campaign_id=$1 AND o.status IN ('pending','leased') AND EXISTS(SELECT 1 FROM r2pl_v2.notification_events e WHERE e.id=o.event_id AND e.kind<>'admin')",
      [campaign],
    )
  ).rowCount;
  await db.query(
    "UPDATE r2pl_v2.notification_events SET live_expires_at=LEAST(live_expires_at,clock_timestamp()) WHERE campaign_id=$1 AND kind<>'admin'",
    [campaign],
  );
  details.playerSessions = (
    await db.query("DELETE FROM r2pl_v2.portal_sessions WHERE campaign_id=$1", [
      campaign,
    ])
  ).rowCount;
  await db.query("DELETE FROM r2pl_v2.portal_launches WHERE campaign_id=$1", [
    campaign,
  ]);
  await db.query(
    "DELETE FROM r2pl_v2.portal_admin_sessions s USING r2pl_v2.portal_admins a WHERE s.campaign_id=$1 AND a.campaign_id=s.campaign_id AND a.actor_id=s.actor_id AND a.test_profiles",
    [campaign],
  );
  await db.query(
    "DELETE FROM r2pl_v2.portal_admin_launches WHERE campaign_id=$1 AND actor_id IN (SELECT actor_id FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND test_profiles)",
    [campaign],
  );
  assert.equal(await protectedState(), preserved);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND balance<>0",
        [campaign],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM r2pl_v2.test_point_pools WHERE campaign_id=$1 AND balance<>0",
        [campaign],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='knowledge-score'",
        [campaign],
      )
    ).rows[0].n,
    8,
  );
  const mismatch = (
    await db.query(
      "SELECT count(*)::int n FROM r2pl_v2.wallet_accounts w WHERE w.campaign_id=$1 AND w.balance<>w.opening_balance+COALESCE((SELECT sum(amount) FROM r2pl_v2.ledger_entries l WHERE l.campaign_id=w.campaign_id AND l.actor_id=w.actor_id AND l.resource=w.resource),0)",
      [campaign],
    )
  ).rows[0].n;
  assert.equal(mismatch, 0, "Wallet ledger conservation failed");
  const poolMismatch = (
    await db.query(
      "SELECT count(*)::int n FROM r2pl_v2.test_point_pools w WHERE w.campaign_id=$1 AND w.balance<>w.opening_balance+COALESCE((SELECT sum(amount) FROM r2pl_v2.test_point_ledger l WHERE l.campaign_id=w.campaign_id AND l.pool_actor_id=w.actor_id),0)",
      [campaign],
    )
  ).rows[0].n;
  assert.equal(poolMismatch, 0, "Shared ledger conservation failed");
  await migrateBeacons(db, campaign);
  return {
    resetId,
    walletsReset: nonzero.length,
    poolsReset: pools.length,
    headquarters: areas.length,
    details,
  };
}
