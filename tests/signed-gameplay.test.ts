import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { TerrainBiomes } from "../client/src/terrainBiomes.ts";
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
import {
  chunkId,
  localIndex,
  tileCoordinates,
} from "../shared/world/coordinates.ts";

const url = process.env.R2PL_PREPARATION_DATABASE_URL;
test("signed config publishes exact roster, footprints, costs and unnormalized reward tables", () => {
  assert.equal(GAME_CONFIG.ruleVersion, 1);
  assert.deepEqual(
    SCHOOLS.map((s) => s.id),
    ["hcmut", "ou", "dtu", "hpuni", "hsu", "huce", "ntu", "hcmiu"],
  );
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "hq").length, 8);
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "landmark").length, 10);
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "unistop").length, 15);
  assert.equal(STAGING_OBJECTS.filter((o) => o.kind === "chest").length, 15);
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
    assert.equal(world.objects.length, 33);
    assert(world.objects.every((o) => o.kind !== "chest"));
    assert.equal((await fetch(`${base}/api/game`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin`)).status, 403);
    assert.equal((await fetch(`${base}/api/game/tile?index=1`)).status, 401);
    for (const index of ["-1", "1000000", "1.5", ""]) {
      assert.equal(
        (await fetch(`${base}/api/game/tile?index=${index}`, { headers }))
          .status,
        400,
      );
    }
    const readAction = (index: number) =>
      fetch(`${base}/api/game/tile?index=${index}`, { headers }).then((r) =>
        r.json(),
      );
    const home = tileCoordinates(server.fixture.schools[0]!.home);
    assert.equal((await readAction(home.z * 1000 + home.x)).action, "owned");
    const rivalHome = tileCoordinates(server.fixture.schools[1]!.home);
    assert.deepEqual(await readAction(rivalHome.z * 1000 + rivalHome.x), {
      tileIndex: rivalHome.z * 1000 + rivalHome.x,
      action: "blocked",
      points: 0,
    });
    await path(pool, campaign, 0, 63, 63);
    assert.deepEqual(await readAction(63 * 1000 + 64), {
      tileIndex: 63064,
      action: "explore",
      points: 1,
    });
    await path(pool, campaign, 1, 64, 63);
    assert.deepEqual(await readAction(63064), {
      tileIndex: 63064,
      action: "study",
      points: 2,
    });
    assert.deepEqual(await readAction(64064), {
      tileIndex: 64064,
      action: "blocked",
      points: 0,
    });
    await path(pool, campaign, 2, 64, 63);
    assert.deepEqual(await readAction(63064), {
      tileIndex: 63064,
      action: "blocked",
      points: 0,
    });
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
    assert.equal(view.chests.length, 0);
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
async function path(
  pool: Pool,
  campaign: string,
  slot: number,
  x = 480,
  z = 450,
): Promise<void> {
  const id = chunkId(Math.floor(x / 64), Math.floor(z / 64));
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

    // 1. unistop_predator_1 is initially neutral -> rejected with KNOWLEDGE_PATH_REQUIRED
    assert.equal(
      (await g.command(a, cmd("spin", "unistop_predator_1"))).reason,
      "KNOWLEDGE_PATH_REQUIRED",
    );
    // School A (slot 0) expands knowledge into footprint of unistop_predator_1 (450, 500)
    await path(pool, campaign, 0, 450, 500);

    // 2. Student a from School A spins captured unistop_predator_1 -> applied
    let result = await g.command(a, cmd("spin", "unistop_predator_1"));
    assert.deepEqual(result.reward, {
      kind: "crystals",
      quantity: 4,
      weight: 5,
    });
    // Student a immediately spins again -> rejected with COOLDOWN
    assert.equal(
      (await g.command(a, cmd("spin", "unistop_predator_1"))).reason,
      "COOLDOWN",
    );
    // Rival school student tries to spin -> rejected with KNOWLEDGE_PATH_REQUIRED
    assert.equal(
      (await g.command(rival, cmd("spin", "unistop_predator_1"))).reason,
      "KNOWLEDGE_PATH_REQUIRED",
    );
    // Student b from School A has their own personal cooldown -> applied
    const studentBResult = await g.command(
      b,
      cmd("spin", "unistop_predator_1"),
    );
    assert.equal(studentBResult.status, "applied");

    // 3. Finite Chest winner under race conditions (Predator chest consumes key-predator)
    const predatorChest = "chest_predator_1";
    await pool.query(
      "INSERT INTO r2pl_v2.game_chest_discoveries(campaign_id,actor_id,object_id) VALUES($1,$2,$3),($1,$4,$3)",
      [campaign, a.actorId, predatorChest, b.actorId],
    );
    const winners = await Promise.all([
      g.command(a, cmd("open", predatorChest)),
      g.command(b, cmd("open", predatorChest)),
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
      (await g.command(rival, cmd("open", "chest_aspire_1"))).reason,
      "CHEST_NOT_DISCOVERED",
    );

    // 4. Treasure Map on unistop_aspire_1 reveals an uncollected Aspire chest
    await path(pool, campaign, 0, 532, 301);
    roll = 960;
    const map = await g.command(a, cmd("spin", "unistop_aspire_1"));
    assert.equal(map.reward?.kind, "treasure_map");
    assert(map.discovery);
    const aspireChest = map.discovery.id;
    assert((await g.view(a)).chests.some((c) => c.id === aspireChest));
    assert(!(await g.view(b)).chests.some((c) => c.id === aspireChest));

    // 5. Staging Gift entitlement on chest opening (consumes key-aspire)
    await g.command(a, cmd("running", undefined, 1000));
    await pool.query(
      "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'gift-stock','aspire',$2)",
      [campaign, JSON.stringify({ remaining: 1 })],
    );
    roll = 999;
    const giftCommand = cmd("open", aspireChest);
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
      1100,
    );
    await g.command(
      rival,
      cmd("guess", "fansipan", undefined, "Đỉnh Fansipan"),
    );
    await g.command(rival, cmd("contribute", "fansipan", 1000));
    assert.equal(
      (await g.view(a)).landmarks.find((l) => l.id === "fansipan")!.holder,
      1,
    );
    assert.equal(
      (await g.view(a)).landmarks.find((l) => l.id === "fansipan")!.target,
      1200,
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

test("rendered river tiles remain ordinary adjacent exploration with a single PostgreSQL Point debit", {
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
    const field = new TerrainBiomes();
    const z = 100;
    let x = 1;
    while (x < 999 && field.getTerrainBiome(x, z) !== "river") x++;
    assert(x < 999);
    assert.equal(field.getTerrainHeight(x, z), -0.35);
    await path(pool, campaign, 0, x - 1, z);
    const actor = server.fixture.actors[0]!;
    const response = await fetch(
      `http://127.0.0.1:${server.webPort}/api/game/tile?index=${z * 1000 + x}`,
      {
        headers: { Authorization: `Bearer ${actor.token}` },
      },
    );
    assert.deepEqual(await response.json(), {
      tileIndex: z * 1000 + x,
      action: "explore",
      points: 1,
    });
    const before = BigInt(
      (await server.accounts.profile(actor.token))!.balance,
    );
    const mutation = new M3TestMutationService(pool, {
      realtimeViews: true,
      boundary: { headquarters: server.fixture.headquarters, ruleVersion: 1 },
    });
    const command = {
      campaignId: campaign,
      actorId: actor.actorId,
      schoolSlot: 0,
      key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
      tileIndex: z * 1000 + x,
      cost: 1n,
      intent: "explore" as const,
    };
    assert.equal((await mutation.apply(command)).result.status, "test_applied");
    assert.equal((await mutation.apply(command)).result.status, "test_applied");
    assert.equal(
      before - BigInt((await server.accounts.profile(actor.token))!.balance),
      1n,
    );
    assert((await server.accounts.profile(actor.token))!.ledgerConserved);
  } finally {
    await server?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});

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
      [280, 281, 282].map((z) => ({ x: 510, z, mask: 2 })),
    );
    const before = (await server.accounts.profile(a.token))!.balance;
    for (const z of [280, 281, 282]) {
      const r = await mutation.apply({
        campaignId: campaign,
        actorId: a.actorId,
        schoolSlot: 0,
        key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
        tileIndex: z * 1000 + 510,
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
      tileIndex: 280510,
      cost: 1n,
    });
    assert.equal(noChange.result.status, "test_no_change");
    const full = await mutation.apply({
      campaignId: campaign,
      actorId: third.actorId,
      schoolSlot: 2,
      key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
      tileIndex: 280510,
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
        [campaign, chunkId(7, 4)],
      )
    ).rows[0]!.mask;
    assert.equal(mask.readUInt16LE(localIndex(510, 280) * 2), 0);
    const fog = (
      await pool.query<{ fog: Buffer }>(
        "SELECT fog FROM r2pl_v2.school_fog_chunks WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=0",
        [campaign, chunkId(7, 4)],
      )
    ).rows[0]!.fog;
    const adjacent = localIndex(511, 282);
    assert(fog[adjacent >> 3]! & (1 << (adjacent & 7)));
    assert(
      (await g.view(a)).events.some(
        (e) => e.title === "Hoàn Points consolidation",
      ),
    );
    async function joinOne(z: number) {
      await rivalTiles(pool, campaign, [{ x: 510, z, mask: 2 }]);
      await mutation.apply({
        campaignId: campaign,
        actorId: a.actorId,
        schoolSlot: 0,
        key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
        tileIndex: z * 1000 + 510,
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
          [campaign, chunkId(7, 4)],
        )
      ).rows[0]!.mask.readUInt16LE(localIndex(510, z) * 2);
    }
    const guestLapse = await joinOne(284);
    await lapse(guestLapse, [0]);
    assert.equal(await maskAt(284), 2);
    assert.equal((await g.view(a)).shared.length, 0);
    const bothLapse = await joinOne(285);
    await lapse(bothLapse, [0, 1]);
    assert.equal(await maskAt(285), 2);
    const success = await joinOne(286);
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
    assert.equal(await maskAt(286), 1);
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
      o.id === "hq-hcmut" ? { ...o, x: 655, z: 345 } : o,
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
    assert.equal(server.fixture.players[0]!.home.x, 500);
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

test("gift check-in redemption generates giftCode, retrieves by code, and redeems once idempotently", {
  skip: !url,
}, async () => {
  const pool = new Pool({ connectionString: url });
  const campaign = randomUUID();
  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  try {
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
      { rewardDraw: () => 999 }, // Draw gift
    );
    const base = `http://127.0.0.1:${server.webPort}`;
    const actor = server.fixture.actors.find(
      (a) => a.role === "human" && a.schoolSlot === 0,
    )!;
    const headers = {
      Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json",
    };
    const adminHeaders = {
      "X-Admin-Key": "dev-map-admin",
      "Content-Type": "application/json",
    };

    // Set gift stock
    await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ action: "gift-stock", tier: "nitro", amount: 10 }),
    });

    // Make actor eligible by running
    await fetch(`${base}/api/game`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ruleVersion: 1,
        key: randomUUID(),
        action: "running",
        amount: 1000,
      }),
    });

    // Expand School 0 knowledge to touch unistop_nitro_1 (500, 360) footprint
    await path(pool, campaign, 0, 500, 360);

    // Spin unistop to roll a gift
    const spinRes = await fetch(`${base}/api/game`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ruleVersion: 1,
        key: randomUUID(),
        action: "spin",
        target: "unistop_nitro_1",
      }),
    });
    assert.equal(spinRes.status, 200);
    const receipt = (await spinRes.json()) as {
      status: string;
      reason?: string;
      message?: string;
      reward?: { kind: string };
      giftCode?: string;
    };
    assert.equal(receipt.status, "applied");
    assert.equal(receipt.reward?.kind, "gift");
    assert.ok(receipt.giftCode, "receipt must contain giftCode");
    assert.match(receipt.giftCode!, /^R2PL-GIFT-[A-F0-9]{6}$/);

    const giftCode = receipt.giftCode!;

    // Verify in player view
    const viewRes = await fetch(`${base}/api/game`, { headers });
    const view = (await viewRes.json()) as {
      gifts: Array<{
        giftCode?: string;
        redeemedAt?: number | null;
        tier: string;
      }>;
    };
    const playerGift = view.gifts.find((g) => g.giftCode === giftCode);
    assert.ok(playerGift, "player gifts must include the rolled giftCode");
    assert.equal(playerGift!.redeemedAt, null);

    // Admin lookup by giftCode
    const lookupRes = await fetch(
      `${base}/api/admin/gifts?code=${encodeURIComponent(giftCode)}`,
      { headers: adminHeaders },
    );
    assert.equal(lookupRes.status, 200);
    const lookupData = (await lookupRes.json()) as {
      gift: { giftCode: string; actorId: string; redeemedAt: number | null };
    };
    assert.equal(lookupData.gift.giftCode, giftCode);
    assert.equal(lookupData.gift.actorId, actor.actorId);
    assert.equal(lookupData.gift.redeemedAt, null);

    // Admin lookup non-existent code
    const notFoundRes = await fetch(
      `${base}/api/admin/gifts?code=R2PL-GIFT-NOTEXIST`,
      { headers: adminHeaders },
    );
    assert.equal(notFoundRes.status, 404);

    // Database refuses a duplicate code even under a different entitlement ID.
    await assert.rejects(
      pool.query(
        "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) SELECT campaign_id,scope,'duplicate-test',data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='gift-entitlement' AND data->>'giftCode'=$2",
        [campaign, giftCode],
      ),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );

    // A Chest award also creates a distinct code in the same private inventory.
    const chest = (
      await pool.query<{ id: string; data: { x: number; z: number } }>(
        "SELECT id,data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 AND data->>'kind'='chest' AND data->>'tier'='nitro' LIMIT 1",
        [campaign],
      )
    ).rows[0]!;
    await pool.query(
      "INSERT INTO r2pl_v2.game_chest_discoveries(campaign_id,actor_id,object_id) VALUES($1,$2,$3)",
      [campaign, actor.actorId, chest.id],
    );
    await path(pool, campaign, 0, chest.data.x, chest.data.z);
    const chestResult = (await (
      await fetch(`${base}/api/game`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ruleVersion: 1,
          key: randomUUID(),
          action: "open",
          target: chest.id,
        }),
      })
    ).json()) as { status: string; giftCode: string; reward: { kind: string } };
    assert.equal(chestResult.status, "applied");
    assert.equal(chestResult.reward.kind, "gift");
    assert.match(chestResult.giftCode, /^R2PL-GIFT-[A-F0-9]{6}$/);
    assert.notEqual(chestResult.giftCode, giftCode);

    // Concurrent check-in attempts must produce exactly one winner.
    const raced = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const response = await fetch(`${base}/api/admin/gifts/redeem`, {
          method: "POST",
          headers: adminHeaders,
          body: JSON.stringify({ giftCode }),
        });
        assert.equal(response.status, 200);
        return response.json() as Promise<{
          success: boolean;
          alreadyRedeemed?: boolean;
        }>;
      }),
    );
    assert.equal(raced.filter((r) => r.success).length, 1);
    assert.equal(raced.filter((r) => r.alreadyRedeemed).length, 7);
    const durable = (
      await pool.query<{ redeemed_at: Date }>(
        "SELECT redeemed_at FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='gift-entitlement' AND data->>'giftCode'=$2",
        [campaign, giftCode],
      )
    ).rows[0]!;
    assert.ok(durable.redeemed_at instanceof Date);

    // Admin redeem gift
    const redeemRes = await fetch(`${base}/api/admin/gifts/redeem`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ giftCode }),
    });
    assert.equal(redeemRes.status, 200);
    const redeemData = (await redeemRes.json()) as {
      success: boolean;
      gift: { redeemedAt: number };
    };
    assert.equal(redeemData.success, false);
    assert.ok(
      redeemData.gift.redeemedAt > 0,
      "redeemedAt must be a positive timestamp",
    );

    // Second redemption attempt must report alreadyRedeemed (idempotency / anti-double claim)
    const secondRedeemRes = await fetch(`${base}/api/admin/gifts/redeem`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ giftCode }),
    });
    assert.equal(secondRedeemRes.status, 200);
    const secondData = (await secondRedeemRes.json()) as {
      success: boolean;
      alreadyRedeemed: boolean;
    };
    assert.equal(secondData.success, false);
    assert.equal(secondData.alreadyRedeemed, true);

    // Player view now shows redeemedAt
    const updatedViewRes = await fetch(`${base}/api/game`, { headers });
    const updatedView = (await updatedViewRes.json()) as {
      gifts: Array<{ giftCode?: string; redeemedAt?: number | null }>;
    };
    const updatedGift = updatedView.gifts.find((g) => g.giftCode === giftCode);
    assert.ok(
      updatedGift?.redeemedAt,
      "player gift view must show redeemedAt timestamp",
    );
  } finally {
    await server?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});

test("signed 5x5 fog relay converges across four chunks without exposing rival masks", {
  skip: !url,
}, async () => {
  const { ProjectionReplica } = await import("../shared/protocol/replica.ts");
  const {
    M2_KIND,
    decodeFrame,
    decodeSnapshot,
    encodeSubscribe,
    encodeExplore,
  } = await import("../shared/protocol/m2.ts");
  const pool = new Pool({ connectionString: url }),
    campaign = randomUUID();
  let server: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  try {
    server = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    await path(pool, campaign, 0, 61, 63);
    const replicas = [new ProjectionReplica(0), new ProjectionReplica(1)],
      ids = [0, 1, 16, 17];
    for (let slot = 0; slot < 2; slot++) {
      const actor = server.fixture.actors.find((a) => a.schoolSlot === slot)!;
      server.realtime.core.addSession(`fog-test-${slot}`, actor, {
        send(bytes) {
          const frame = decodeFrame(bytes);
          if (frame.kind === M2_KIND.SNAPSHOT)
            replicas[slot]!.applySnapshot(decodeSnapshot(frame.payload));
        },
        close() {},
      });
      await server.realtime.core.handle(
        `fog-test-${slot}`,
        encodeSubscribe(ids),
      );
    }
    await server.realtime.core.handle(
      "fog-test-0",
      encodeExplore({
        key: Uint8Array.from(
          Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
        ),
        tileIndex: 63 * 1000 + 62,
        ruleVersion: 1,
      }),
    );
    await server.realtime.core.drainOutbox();
    for (let slot = 0; slot < 2; slot++)
      for (const id of ids) {
        const expected = await server.realtime.authority.snapshot(slot, id),
          replica = replicas[slot]!;
        assert.equal(replica.revision(id), expected.viewRevision);
        const masks = new DataView(
          expected.mask.buffer,
          expected.mask.byteOffset,
          expected.mask.byteLength,
        );
        for (let local = 0; local < 4096; local++) {
          assert.equal(
            replica.maskAt(id, local),
            masks.getUint16(local * 2, true),
          );
          assert.equal(
            replica.isDiscovered(id, local),
            !!(expected.fog[local >> 3]! & (1 << (local & 7))),
          );
        }
      }
    for (let z = 61; z <= 65; z++)
      for (let x = 60; x <= 64; x++)
        assert.equal(
          replicas[0]!.isDiscovered(
            chunkId(Math.floor(x / 64), Math.floor(z / 64)),
            localIndex(x, z),
          ),
          true,
        );
    server.realtime.core.removeSession("fog-test-0");
    server.realtime.core.removeSession("fog-test-1");
  } finally {
    await server?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});

test("manual Dock intent is validated before debit and protected by stable-key replay", {
  skip: !url,
}, async () => {
  const { decodeFrame, decodeAck, encodeExplore, M2_KIND, ACK_STATUS, REASON } =
    await import("../shared/protocol/m2.ts");
  const pool = new Pool({ connectionString: url }),
    campaign = randomUUID();
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  try {
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
    );
    await path(pool, campaign, 0, 61, 63);
    await path(pool, campaign, 1, 63, 63);
    const actor = play.fixture.actors.find(
        (a) => a.schoolSlot === 0 && a.role === "human",
      )!,
      acks: ReturnType<typeof decodeAck>[] = [];
    play.realtime.core.addSession("manual-dock", actor, {
      send(bytes) {
        const frame = decodeFrame(bytes);
        if (frame.kind === M2_KIND.ACK) acks.push(decodeAck(frame.payload));
      },
      close() {},
    });
    const send = async (
      tile: number,
      intent: "study" | "explore",
      key = Uint8Array.from(
        Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
      ),
    ) => {
      await play!.realtime.core.handle(
        "manual-dock",
        encodeExplore({ key, tileIndex: tile, ruleVersion: 1, intent }),
      );
      return { ack: acks.at(-1)!, key };
    };
    const initial = (
      await pool.query(
        "SELECT balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
        [campaign, actor.actorId],
      )
    ).rows[0].balance;
    assert.equal((await send(63062, "study")).ack.reason, REASON.WRONG_ACTION);
    assert.equal(
      (await send(63062, "explore")).ack.status,
      ACK_STATUS.TEST_APPLIED,
    );
    assert.equal(
      (await send(63063, "explore")).ack.reason,
      REASON.WRONG_ACTION,
    );
    const shared = await send(63063, "study");
    assert.equal(shared.ack.status, ACK_STATUS.TEST_APPLIED);
    assert.equal(
      (await send(63063, "study", shared.key)).ack.status,
      ACK_STATUS.TEST_APPLIED,
    );
    assert.equal(
      (await send(63063, "explore", shared.key)).ack.reason,
      REASON.IDEMPOTENCY_CONFLICT,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
          [campaign, actor.actorId],
        )
      ).rows[0].balance,
      String(BigInt(initial) - 3n),
    );
    play.realtime.core.removeSession("manual-dock");
  } finally {
    await play?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});
