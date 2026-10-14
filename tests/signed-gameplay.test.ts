import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { cleanupBotFixture } from "../scripts/simulation/fixture.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { cleanupSchoolRewards } from "../server/integration/SchoolRewardFixture.ts";
import { SignedGameplay } from "../server/integration/SignedGameplay.ts";
import {
  GAME_CONFIG,
  SCHOOLS,
  STAGING_OBJECTS,
} from "../shared/gameplay/gameConfig.ts";
import { crc32 } from "../shared/world/checksum.ts";
import { chunkId, localIndex } from "../shared/world/coordinates.ts";

const url = process.env.R2PL_PREPARATION_DATABASE_URL;
test("signed config publishes exact roster, footprints, costs and unnormalized reward tables", () => {
  assert.equal(GAME_CONFIG.ruleVersion, 1);
  assert.deepEqual(
    SCHOOLS.map((s) => s.id),
    ["hcmut", "hcmcou", "dtu", "dhhp", "hsu", "huce", "ntu", "hcmiu"],
  );
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "hq").length, 8);
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "landmark").length, 10);
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "unistop").length, 24);
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "chest").length, 24);
  for (const source of [GAME_CONFIG.rewards.unistop, GAME_CONFIG.rewards.chest])
    for (const table of Object.values(source))
      assert.equal(
        table.outcomes.reduce((sum, r) => sum + r.weight, 0),
        1000,
      );
  for (let i = 0; i < STAGING_OBJECTS.length; i++)
    for (let j = i + 1; j < STAGING_OBJECTS.length; j++) {
      const a = STAGING_OBJECTS[i]!,
        b = STAGING_OBJECTS[j]!;
      assert(
        !(
          Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
          Math.abs(a.z - b.z) < (a.height + b.height) / 2
        ),
        "objects overlap",
      );
    }
  assert.equal(GAME_CONFIG.knowledge.sharedPoints, 2);
  assert.equal(GAME_CONFIG.landmark.baseCrystals, 1000);
});
test("signed routes keep chests private, persist Running into playable wallet, reject forged identity and replay once", {
  skip: !url,
  timeout: 30000,
}, async () => {
  const pool = new Pool({ connectionString: url, max: 16 }),
    campaign = randomUUID();
  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  try {
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    const base = `http://127.0.0.1:${server.webPort}`;
    const actor = server.fixture.players[0]!,
      headers = {
        Authorization: `Bearer ${actor.token}`,
        "Content-Type": "application/json",
      };
    const world = (await (await fetch(`${base}/api/fixture/world`)).json()) as {
      objects: { kind: string }[];
    };
    assert.equal(world.objects.length, 42);
    assert(world.objects.every((o) => o.kind !== "chest"));
    assert.equal((await fetch(`${base}/api/game`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin`)).status, 403);
    const before = await server.accounts.profile(actor.token);
    const command = {
      ruleVersion: 1,
      key: randomUUID(),
      action: "running",
      amount: 1000,
    };
    const send = () =>
      fetch(`${base}/api/game`, {
        method: "POST",
        headers,
        body: JSON.stringify(command),
      }).then((r) => r.json());
    const results = await Promise.all([send(), send()]);
    assert.deepEqual(results[0], results[1]);
    const after = await server.accounts.profile(actor.token);
    assert.equal(BigInt(after!.balance) - BigInt(before!.balance), 10n);
    assert(after!.ledgerConserved);
    const view = (await (
      await fetch(`${base}/api/game`, { headers })
    ).json()) as {
      weeklyKm: number;
      chests: { id: string }[];
      keys: { aspire: string };
      landmarks: { pot: number }[];
    };
    assert.equal(view.weeklyKm, 1);
    assert.equal(view.chests.length, 3);
    assert.equal(view.keys.aspire, "1");
    assert.equal(
      (
        await fetch(`${base}/api/game`, {
          method: "POST",
          headers: { ...headers, Origin: "https://example.invalid" },
          body: JSON.stringify(command),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/game`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...command,
            key: randomUUID(),
            actorId: "forged",
          }),
        })
      ).status,
      400,
    );
    const other = (await (
      await fetch(`${base}/api/game`, {
        headers: {
          Authorization: `Bearer ${server.fixture.players[2]!.token}`,
        },
      })
    ).json()) as { weeklyKm: number; chests: { id: string }[] };
    assert.equal(other.weeklyKm, 0);
    assert(other.chests.every((c) => !view.chests.some((v) => v.id === c.id)));
    await server.close();
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    assert.equal(
      (await server.accounts.profile(actor.token))!.balance,
      after!.balance,
    );
  } finally {
    await server?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});
async function path(pool: Pool, campaign: string, slot: number): Promise<void> {
  const x = 310,
    z = 280,
    id = chunkId(Math.floor(x / 64), Math.floor(z / 64));
  await pool.query(
    "INSERT INTO r2pl_v2.world_chunk_heads(campaign_id,chunk_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [campaign, id],
  );
  const row = (
    await pool.query<{ mask: Buffer }>(
      "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=$2",
      [campaign, id],
    )
  ).rows[0];
  const mask = Buffer.from(row?.mask ?? Buffer.alloc(8192));
  const local = localIndex(x, z);
  mask.writeUInt16LE(mask.readUInt16LE(local * 2) | (1 << slot), local * 2);
  await pool.query(
    "INSERT INTO r2pl_v2.world_chunks(campaign_id,chunk_id,mask,mask_crc) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,chunk_id) DO UPDATE SET mask=EXCLUDED.mask,mask_crc=EXCLUDED.mask_crc",
    [campaign, id, mask, crc32(mask)],
  );
}
test("signed rewards enforce cooldown, matching tier, finite Chest winner, Gift fallback, landmark cooldown and linear takeover", {
  skip: !url,
  timeout: 30000,
}, async () => {
  const pool = new Pool({ connectionString: url, max: 16 }),
    campaign = randomUUID();
  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  try {
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    let roll = 999;
    const g = new SignedGameplay(pool, server.fixture, () => roll);
    const a = server.fixture.actors[0]!,
      b = server.fixture.actors[1]!,
      rival = server.fixture.actors[5]!;
    const cmd = (
      action: string,
      target?: string,
      amount?: number,
      guess?: string,
    ) => ({
      ruleVersion: 1,
      key: randomUUID(),
      action,
      ...(target ? { target } : {}),
      ...(amount ? { amount } : {}),
      ...(guess ? { guess } : {}),
    });
    let result = await g.command(a, cmd("spin", "dev-predator-0"));
    assert.deepEqual(result.reward, {
      kind: "crystals",
      quantity: 4,
      weight: 5,
    });
    assert.equal(
      (await g.command(a, cmd("spin", "dev-predator-0"))).reason,
      "COOLDOWN",
    );
    const chest = "chest-predator-0";
    const winners = await Promise.all([
      g.command(a, cmd("open", chest)),
      g.command(b, cmd("open", chest)),
    ]);
    assert.equal(winners.filter((r) => r.status === "applied").length, 1);
    assert.equal(
      winners.find((r) => r.status === "applied")!.reward!.quantity,
      10,
    );
    assert.equal(
      winners.find((r) => r.status === "rejected")!.reason,
      "CHEST_COLLECTED",
    );
    assert.equal(
      (await g.command(rival, cmd("open", "chest-aspire-0"))).reason,
      "CHEST_NOT_DISCOVERED",
    );
    roll = 960;
    const map = await g.command(a, cmd("spin", "dev-aspire-0"));
    assert.equal(map.reward?.kind, "treasure_map");
    assert(map.discovery);
    assert((await g.view(a)).chests.some((c) => c.id === map.discovery!.id));
    assert(!(await g.view(b)).chests.some((c) => c.id === map.discovery!.id));
    await g.command(a, cmd("running", undefined, 1000));
    await pool.query(
      "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'gift-stock','aspire',$2)",
      [campaign, JSON.stringify({ remaining: 1 })],
    );
    roll = 999;
    const giftCommand = cmd("open", "chest-aspire-0");
    const gift = await g.command(a, giftCommand);
    assert.equal(gift.reward?.kind, "gift");
    assert.deepEqual(await g.command(a, giftCommand), gift);
    assert.equal((await g.view(a)).gifts.length, 1);
    assert.equal((await g.view(b)).gifts.length, 0);
    assert.equal((await g.view(a)).keys.aspire, "0");
    assert.equal(
      (
        await pool.query(
          "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='gift-stock' AND id='aspire'",
          [campaign],
        )
      ).rows[0].data.remaining,
      0,
    );

    assert.equal(
      (await g.command(a, cmd("contribute", "fansipan", 1))).reason,
      "KNOWLEDGE_PATH_REQUIRED",
    );
    await path(pool, campaign, 0);
    await path(pool, campaign, 1);
    result = await g.command(a, cmd("guess", "fansipan", undefined, "sai"));
    assert(result.nextAvailableAtMs! > Date.now());
    assert.equal(
      (await g.command(a, cmd("guess", "fansipan", undefined, "Đỉnh Fansipan")))
        .reason,
      "GUESS_COOLDOWN",
    );
    await pool.query(
      "UPDATE r2pl_v2.game_state SET data=jsonb_set(data,'{cooldowns,0}','0') WHERE campaign_id=$1 AND scope='beacon' AND id='fansipan'",
      [campaign],
    );
    await g.command(a, cmd("guess", "fansipan", undefined, "Đỉnh Fansipan"));
    assert.equal(
      (await g.view(a)).landmarks.find((l) => l.id === "fansipan")!.pot,
      100,
    );
    await g.command(a, cmd("guess", "fansipan", undefined, "Đỉnh Fansipan"));
    assert.equal(
      (await g.view(a)).landmarks.find((l) => l.id === "fansipan")!.pot,
      100,
    );
    await g.command(a, cmd("contribute", "fansipan", 900));
    assert.equal(
      (await g.view(a)).landmarks.find((l) => l.id === "fansipan")!.holder,
      0,
    );
    assert.equal(
      (await g.view(rival)).landmarks.find((l) => l.id === "fansipan")!.target,
      1050,
    );
    await g.command(
      rival,
      cmd("guess", "fansipan", undefined, "Đỉnh Fansipan"),
    );
    await g.command(rival, cmd("contribute", "fansipan", 945));
    assert.equal(
      (await g.view(a)).landmarks.find((l) => l.id === "fansipan")!.holder,
      1,
    );
    assert.equal(
      (await g.view(a)).landmarks.find((l) => l.id === "fansipan")!.target,
      1100,
    );
    assert((await server.accounts.profile(a.token))!.ledgerConserved);
  } finally {
    await server?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});

import { M3TestMutationService } from "../server/persistence/M3TestMutation.ts";

async function rivalTiles(
  pool: Pool,
  campaign: string,
  tiles: { x: number; z: number; mask: number }[],
): Promise<void> {
  for (const { x, z, mask: bits } of tiles) {
    const id = chunkId(Math.floor(x / 64), Math.floor(z / 64));
    const row = (
      await pool.query<{ mask: Buffer }>(
        "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=$2",
        [campaign, id],
      )
    ).rows[0]!;
    const mask = Buffer.from(row.mask);
    mask.writeUInt16LE(bits, localIndex(x, z) * 2);
    await pool.query(
      "UPDATE r2pl_v2.world_chunks SET mask=$3,mask_crc=$4 WHERE campaign_id=$1 AND chunk_id=$2",
      [campaign, id, mask, crc32(mask)],
    );
  }
}
test("shared join charges 2, rejects third school, keeps private cluster views, and refunds expired consolidation", {
  skip: !url,
  timeout: 30000,
}, async () => {
  const pool = new Pool({ connectionString: url, max: 16 }),
    campaign = randomUUID();
  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  try {
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    const a = server.fixture.actors[0]!,
      third = server.fixture.actors[10]!,
      g = new SignedGameplay(pool, server.fixture);
    const mutation = new M3TestMutationService(pool, {
      realtimeViews: true,
      boundary: { headquarters: server.fixture.headquarters, ruleVersion: 1 },
    });
    await rivalTiles(
      pool,
      campaign,
      [200, 201, 202].map((z) => ({ x: 210, z, mask: 2 })),
    );
    const before = (await server.accounts.profile(a.token))!.balance;
    for (const z of [200, 201, 202]) {
      const r = await mutation.apply({
        campaignId: campaign,
        actorId: a.actorId,
        schoolSlot: 0,
        key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
        tileIndex: z * 1000 + 210,
        cost: 1n,
      });
      assert.equal(r.result.status, "test_applied");
    }
    assert.equal(
      BigInt(before) -
        BigInt((await server.accounts.profile(a.token))!.balance),
      6n,
    );
    const view = await g.view(a);
    assert.equal(view.shared.length, 1);
    assert.equal(view.shared[0]!.tiles, 3);
    assert.equal((await g.view(third)).shared.length, 0);
    const noChange = await mutation.apply({
      campaignId: campaign,
      actorId: a.actorId,
      schoolSlot: 0,
      key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
      tileIndex: 200210,
      cost: 1n,
    });
    assert.equal(noChange.result.status, "test_no_change");
    const full = await mutation.apply({
      campaignId: campaign,
      actorId: third.actorId,
      schoolSlot: 2,
      key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
      tileIndex: 200210,
      cost: 1n,
    });
    assert.equal(full.result.reason, "shared_full");
    const id = view.shared[0]!.id;
    const beforeUpkeep = (await server.accounts.profile(a.token))!.balance;
    assert.equal(
      (
        await g.command(a, {
          ruleVersion: 1,
          key: randomUUID(),
          action: "upkeep",
          target: id,
          amount: 1,
        })
      ).status,
      "rejected",
    );
    await pool.query(
      "UPDATE r2pl_v2.game_state SET data=jsonb_set(data,'{createdAt}',to_jsonb($3::bigint)) WHERE campaign_id=$1 AND scope='shared-cluster' AND id=$2",
      [campaign, id, Date.now() - 25 * 3600000],
    );
    const dueBefore = (await g.view(a)).shared[0]!.due;
    assert.equal(
      (
        await g.command(a, {
          ruleVersion: 1,
          key: randomUUID(),
          action: "upkeep",
          target: id,
          amount: 1,
        })
      ).status,
      "applied",
    );
    assert.equal(
      (await g.view(a)).shared[0]!.due - dueBefore,
      GAME_CONFIG.knowledge.upkeepCycleMs,
    );
    assert.equal(
      BigInt(beforeUpkeep) -
        BigInt((await server.accounts.profile(a.token))!.balance),
      1n,
    );

    await pool.query(
      "UPDATE r2pl_v2.game_state SET data=jsonb_set(jsonb_set(data,'{due,1}',to_jsonb(0)),'{due,0}',to_jsonb($3::bigint)) WHERE campaign_id=$1 AND scope='shared-cluster' AND id=$2",
      [campaign, id, Date.now() + 86400000],
    );
    await g.settle();
    const pending = (await g.view(a)).shared[0]!;
    assert.equal(pending.status, "consolidating");
    assert.equal(pending.required, 2);
    const beforeEscrow = (await server.accounts.profile(a.token))!.balance;
    await g.command(a, {
      ruleVersion: 1,
      key: randomUUID(),
      action: "consolidate",
      target: id,
      amount: 1,
    });
    assert.equal(
      BigInt(beforeEscrow) -
        BigInt((await server.accounts.profile(a.token))!.balance),
      1n,
    );
    await pool.query(
      "UPDATE r2pl_v2.game_state SET data=jsonb_set(data,'{rollingUntil}',to_jsonb(0)) WHERE campaign_id=$1 AND scope='shared-cluster' AND id=$2",
      [campaign, id],
    );
    await g.settle();
    assert.equal((await g.view(a)).shared.length, 0);
    assert.equal(
      (await server.accounts.profile(a.token))!.balance,
      beforeEscrow,
    );
    assert((await server.accounts.profile(a.token))!.ledgerConserved);
    const mask = (
      await pool.query<{ mask: Buffer }>(
        "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=$2",
        [campaign, chunkId(3, 3)],
      )
    ).rows[0]!.mask;
    assert.equal(mask.readUInt16LE(localIndex(210, 200) * 2), 0);
    const fog = (
      await pool.query<{ fog: Buffer }>(
        "SELECT fog FROM r2pl_v2.school_fog_chunks WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=0",
        [campaign, chunkId(3, 3)],
      )
    ).rows[0]!.fog;
    const adjacent = localIndex(212, 202);
    assert(fog[adjacent >> 3]! & (1 << (adjacent & 7)));
    assert(
      (await g.view(a)).events.some(
        (e) => e.title === "Hoàn Points consolidation",
      ),
    );
    async function joinOne(z: number) {
      await rivalTiles(pool, campaign, [{ x: 210, z, mask: 2 }]);
      await mutation.apply({
        campaignId: campaign,
        actorId: a.actorId,
        schoolSlot: 0,
        key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
        tileIndex: z * 1000 + 210,
        cost: 1n,
      });
      return (await g.view(a)).shared[0]!.id;
    }
    async function lapse(id: string, slots: number[]) {
      for (const slot of slots)
        await pool.query(
          "UPDATE r2pl_v2.game_state SET data=jsonb_set(data,$3::text[],'0') WHERE campaign_id=$1 AND scope='shared-cluster' AND id=$2",
          [campaign, id, ["due", String(slot)]],
        );
      await g.settle();
    }
    async function maskAt(z: number) {
      return (
        await pool.query<{ mask: Buffer }>(
          "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=$2",
          [campaign, chunkId(3, 3)],
        )
      ).rows[0]!.mask.readUInt16LE(localIndex(210, z) * 2);
    }
    const guestLapse = await joinOne(204);
    await lapse(guestLapse, [0]);
    assert.equal(await maskAt(204), 2);
    assert.equal((await g.view(a)).shared.length, 0);
    const bothLapse = await joinOne(205);
    await lapse(bothLapse, [0, 1]);
    assert.equal(await maskAt(205), 2);
    const success = await joinOne(206);
    await lapse(success, [1]);
    assert.equal((await g.view(a)).shared[0]!.required, 1);
    assert.equal(
      (
        await g.command(a, {
          ruleVersion: 1,
          key: randomUUID(),
          action: "consolidate",
          target: success,
          amount: 1,
        })
      ).status,
      "applied",
    );
    assert.equal(await maskAt(206), 1);
    assert.equal((await g.view(a)).shared.length, 0);
  } finally {
    await server?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});
test("admin validates publish, moves protected HQ ownership, restores persisted homes and rollback; notifications are durable", {
  skip: !url,
  timeout: 30000,
}, async () => {
  const pool = new Pool({ connectionString: url, max: 16 }),
    campaign = randomUUID();
  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  try {
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    let base = `http://127.0.0.1:${server.webPort}`;
    const headers = {
      "X-Admin-Key": "dev-map-admin",
      "Content-Type": "application/json",
    };
    const old = (await (
      await fetch(`${base}/api/admin`, { headers })
    ).json()) as { objects: typeof STAGING_OBJECTS };
    const send = (body: unknown) =>
      fetch(`${base}/api/admin`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const bad = old.objects.map((o) =>
      o.id === "hq-hcmut" ? { ...o, x: 500, z: 160 } : o,
    );
    assert.equal((await send({ action: "publish", objects: bad })).status, 400);
    const moved = old.objects.map((o) =>
      o.id === "hq-hcmut" ? { ...o, x: 150, z: 200 } : o,
    );
    assert.equal(
      (await send({ action: "publish", objects: moved })).status,
      200,
    );
    assert.equal(server.fixture.players[0]!.home.x, 150);
    assert.equal(
      (
        await send({
          action: "notify",
          title: "Campaign",
          body: "Test notification",
        })
      ).status,
      200,
    );
    await server.close();
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    base = `http://127.0.0.1:${server.webPort}`;
    assert.equal(server.fixture.players[0]!.home.x, 150);
    assert.equal(
      (
        await new SignedGameplay(pool, server.fixture).view(
          server.fixture.actors[0]!,
        )
      ).events.some((e) => e.body === "Test notification"),
      true,
    );
    assert.equal((await send({ action: "rollback" })).status, 200);
    assert.equal(server.fixture.players[0]!.home.x, 200);
    const scores = (await (await fetch(`${base}/api/game/ranking`)).json()) as {
      rankings: { points: number }[];
    };
    assert.equal(scores.rankings.length, 8);
    assert(scores.rankings.every((s) => s.points === 400));
  } finally {
    await server?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});
