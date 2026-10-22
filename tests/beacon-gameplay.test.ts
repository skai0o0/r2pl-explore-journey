import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { botDatabase } from "../scripts/simulation/config.ts";
import { cleanupBotFixture } from "../scripts/simulation/fixture.ts";
import {
  BUFF_POOL,
  bandForRank,
  emptySchoolBeacon,
} from "../server/integration/BeaconBuffs.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { cleanupSchoolRewards } from "../server/integration/SchoolRewardFixture.ts";
import { SignedGameplay } from "../server/integration/SignedGameplay.ts";
import { M3TestMutationService } from "../server/persistence/M3TestMutation.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import type { GameCommand, GameReceipt } from "../shared/gameplay/commands.ts";
import { GAME_CONFIG, STAGING_OBJECTS } from "../shared/gameplay/gameConfig.ts";
import { crc32 } from "../shared/world/checksum.ts";
import { chunkId, localIndex } from "../shared/world/coordinates.ts";

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
type Play = Awaited<ReturnType<typeof createSchoolPlayServer>>;
type Context = {
  pool: Pool;
  play: Play;
  campaign: string;
  game: SignedGameplay;
  setRoll: (n: number) => void;
};
async function fixture(run: (context: Context) => Promise<void>) {
  const pool = new Pool({
      connectionString: botDatabase(database, "1"),
      max: 16,
    }),
    campaign = randomUUID();
  let play: Play | undefined,
    roll = 625;
  try {
    await migratePortalDatabase(pool);
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
      { actorsPerSchool: 10, rewardDraw: () => roll },
    );
    await run({
      pool,
      play,
      campaign,
      game: new SignedGameplay(pool, play.fixture, () => roll),
      setRoll: (n) => {
        roll = n;
      },
    });
  } finally {
    await play?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
}
const command = (
  action: GameCommand["action"],
  target?: string,
  amount?: number,
): GameCommand => ({
  ruleVersion: 1,
  key: randomUUID(),
  action,
  ...(target ? { target } : {}),
  ...(amount ? { amount } : {}),
});
async function seedTile(c: Context, x: number, z: number, bits = 1) {
  const id = chunkId(Math.floor(x / 64), Math.floor(z / 64));
  await c.pool.query(
    "INSERT INTO r2pl_v2.world_chunk_heads(campaign_id,chunk_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [c.campaign, id],
  );
  const existing = (
    await c.pool.query<{ mask: Buffer }>(
      "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=$2",
      [c.campaign, id],
    )
  ).rows[0];
  const mask = Buffer.from(existing?.mask ?? Buffer.alloc(8192));
  mask.writeUInt16LE(bits, localIndex(x, z) * 2);
  await c.pool.query(
    "INSERT INTO r2pl_v2.world_chunks(campaign_id,chunk_id,mask,mask_crc) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,chunk_id) DO UPDATE SET mask=EXCLUDED.mask,mask_crc=EXCLUDED.mask_crc",
    [c.campaign, id, mask, crc32(mask)],
  );
}
async function save(c: Context, scope: string, id: string, data: unknown) {
  await c.pool.query(
    "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data",
    [c.campaign, scope, id, JSON.stringify(data)],
  );
}
async function state(c: Context, scope: string, id: string) {
  return (
    await c.pool.query<{ data: Record<string, unknown> }>(
      "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope=$2 AND id=$3",
      [c.campaign, scope, id],
    )
  ).rows[0]?.data;
}
async function active(c: Context, id: string) {
  await save(c, "school-beacon", "0", {
    ...emptySchoolBeacon(),
    active: "fansipan",
    buffId: id,
    lastCost: 1000,
    activations: 1,
  });
  await save(c, "beacon", "fansipan", {
    holder: 0,
    takeovers: 0,
    lastCost: 1000,
    pots: { 0: 1000 },
    solved: [],
    cooldowns: {},
  });
}
async function points(c: Context, actor = c.play.fixture.actors[0]!) {
  return BigInt((await c.play.accounts.profile(actor.token))!.balance);
}
async function http(
  c: Context,
  actor: Context["play"]["fixture"]["actors"][number],
  cmd: GameCommand,
): Promise<GameReceipt> {
  const base = `http://127.0.0.1:${c.play.webPort}`;
  const r = await fetch(`${base}/api/game`, {
    method: "POST",
    headers: {
      Origin: base,
      Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  assert.equal(r.status, 200);
  return r.json() as Promise<GameReceipt>;
}

test("private 20-buff pool partitions all eight schools at rank boundaries", () => {
  assert.equal(new Set(BUFF_POOL.map((b) => b.id)).size, 20);
  assert.deepEqual([1, 3, 4, 5, 6, 8].map(bandForRank), [
    "front",
    "front",
    "middle",
    "middle",
    "comeback",
    "comeback",
  ]);
  assert.deepEqual(
    ["front", "middle", "comeback"].map(
      (b) => BUFF_POOL.filter((v) => v.band === b).length,
    ),
    [6, 7, 7],
  );
});

test(
  "each actual rank receives only its server-side pool on illumination",
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async (c) => {
      for (let slot = 0; slot < 8; slot++) {
        const actor = c.play.fixture.actors[slot * 10]!;
        await seedTile(c, 480, 450, 1 << slot);
        await http(
          c,
          actor,
          command("contribute", "fansipan", 1000),
        );
        const target = (await c.game.view(actor)).landmarks.find(
          (l) => l.id === "fansipan",
        )!.target;
        assert.equal(
          (
            await http(
              c,
              actor,
              command("contribute", "fansipan", target),
            )
          ).status,
          "applied",
        );
        const view = await c.game.view(actor),
          buff = BUFF_POOL.find((b) => b.name === view.activeBeacon?.name)!;
        assert.equal(buff.band, bandForRank(slot + 1));
        const persisted = await state(c, "school-beacon", String(slot));
        assert.equal(persisted!.rankAtActivation, slot + 1);
        if (slot > 0)
          assert.equal(
            (await c.game.view(c.play.fixture.actors[(slot - 1) * 10]!))
              .activeBeacon,
            undefined,
          );
      }
    }),
);

test(
  "HTTP contributions auto-convert only the shortage; switching beacons burns old pot and survives restart",
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async (c) => {
      const a = c.play.fixture.actors[0]!,
        b = c.play.fixture.actors[1]!;
      await seedTile(c, 480, 450);
      await seedTile(c, 555, 330);
      await c.pool.query(
        "UPDATE r2pl_v2.wallet_accounts SET balance=0,opening_balance=0 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-crystals'",
        [c.campaign, a.actorId],
      );
      assert.equal(
        (await c.game.view(a)).landmarks.find((l) => l.id === "fansipan")!.pot,
        0,
      );
      const before = await points(c, a),
        cmd = command("contribute", "fansipan", 1000);
      const receipt = await http(c, a, cmd);
      assert.equal(receipt.status, "applied");
      assert.deepEqual(await http(c, a, cmd), receipt);
      assert.equal(before - (await points(c, a)), 1000n);
      let view = await c.game.view(a);
      assert.equal(view.activeBeacon?.landmarkId, "fansipan");
      assert.equal(view.crystals, "0");
      assert.equal(view.beaconTarget, 1100);
      const firstBuff = view.activeBeacon;
      await c.pool.query(
        "UPDATE r2pl_v2.game_state SET data=jsonb_set(data,'{points}','99999') WHERE campaign_id=$1 AND scope='knowledge-score' AND id='7'",
        [c.campaign],
      );
      assert.deepEqual(
        (await c.game.view(a)).activeBeacon,
        firstBuff,
        "rank changes never reroll an active buff",
      );
      assert.equal(
        (await http(c, b, command("rally", "halong"))).status,
        "applied",
      );
      assert.equal(
        (
          await c.pool.query(
            "SELECT count(*)::int AS n FROM r2pl_v2.notification_events WHERE campaign_id=$1 AND kind='rally' AND school_slot=0",
            [c.campaign],
          )
        ).rows[0].n,
        1,
      );
      assert(
        (await c.game.view(a)).events.some(
          (e) => e.title === "Hiệu triệu thắp đèn hiệu",
        ),
      );
      assert(
        !(await c.game.view(c.play.fixture.actors[10]!)).events.some(
          (e) => e.title === "Hiệu triệu thắp đèn hiệu",
        ),
      );
      assert.equal(
        (await http(c, a, command("rally", "fansipan"))).reason,
        "BEACON_ALREADY_ACTIVE",
      );
      assert.equal(
        (await http(c, b, command("contribute", "halong", 1000))).status,
        "applied",
      );
      view = await c.game.view(a);
      assert.equal(view.activeBeacon?.landmarkId, "halong");
      assert.equal(
        view.rally,
        undefined,
        "a completed rally must not resurface as a new objective",
      );
      assert.equal(
        (await http(c, b, command("rally", "fansipan"))).reason,
        "RALLY_COOLDOWN",
        "hiding a completed rally must preserve its cooldown",
      );
      assert.equal(view.beaconTarget, 1200);
      assert.equal(
        view.landmarks.find((l) => l.id === "fansipan")!.holder,
        null,
      );
      assert.equal(view.landmarks.find((l) => l.id === "fansipan")!.pot, 0);
      const restarted = new SignedGameplay(c.pool, c.play.fixture);
      await restarted.initialize();
      assert.deepEqual(
        (await restarted.view(a)).activeBeacon,
        view.activeBeacon,
      );
      const publicView = JSON.stringify(view);
      for (const field of [
        "rankAtActivation",
        "buffId",
        "previous",
        "front",
        "comeback",
      ])
        assert(!publicView.includes(`"${field}"`));
      assert((await c.play.accounts.profile(a.token))!.ledgerConserved);
      assert((await c.play.accounts.profile(b.token))!.ledgerConserved);
    }),
);

test(
  "racing deposits ignite once; insufficient funds and missing contact roll back both currencies",
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async (c) => {
      const [a, b] = c.play.fixture.actors;
      assert(a && b);
      await seedTile(c, 480, 450);
      await save(c, "beacon", "fansipan", {
        holder: null,
        takeovers: 0,
        pots: { 0: 990 },
        solved: [],
        cooldowns: {},
      });
      const before = [
        (await c.game.view(a)).crystals,
        (await c.game.view(b)).crystals,
      ].map(BigInt);
      const results = await Promise.all([
        http(c, a, command("contribute", "fansipan", 10)),
        http(c, b, command("contribute", "fansipan", 10)),
      ]);
      assert.equal(results.filter((r) => r.status === "applied").length, 1);
      const after = [
        (await c.game.view(a)).crystals,
        (await c.game.view(b)).crystals,
      ].map(BigInt);
      assert.equal(before[0]! + before[1]! - after[0]! - after[1]!, 10n);
      assert.equal((await state(c, "school-beacon", "0"))!.activations, 1);
      const old = await c.game.view(a),
        balance = await points(c, a);
      assert.equal(
        (await http(c, a, command("contribute", "halong", 10))).reason,
        "KNOWLEDGE_PATH_REQUIRED",
      );
      assert.equal(await points(c, a), balance);
      assert.equal((await c.game.view(a)).crystals, old.crystals);
      await seedTile(c, 555, 330);
      await c.pool.query(
        "UPDATE r2pl_v2.wallet_accounts SET balance=0,opening_balance=0 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
        [c.campaign, b.actorId],
      );
      const saved = await c.game.view(b);
      assert.equal(
        (await http(c, b, command("contribute", "halong", 1100))).reason,
        "INSUFFICIENT_BALANCE",
      );
      assert.equal((await c.game.view(b)).crystals, saved.crystals);
      assert.equal(
        (await c.game.view(b)).landmarks.find((l) => l.id === "halong")!.pot,
        0,
      );
    }),
);

test(
  "legacy multiple beacons migrate once to a single effect without granting resources",
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async (c) => {
      const a = c.play.fixture.actors[0]!,
        before = await points(c, a);
      for (const id of ["fansipan", "halong"])
        await save(c, "beacon", id, {
          holder: 0,
          takeovers: 0,
          pots: { 0: 1000 },
          solved: [0],
          cooldowns: {},
        });
      await c.pool.query(
        "DELETE FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='beacon-schema'",
        [c.campaign],
      );
      await c.game.initialize();
      const view = await c.game.view(a);
      assert.equal(view.landmarks.filter((l) => l.holder === 0).length, 1);
      assert.equal(view.landmarks.find((l) => l.id === "halong")!.pot, 0);
      await c.game.initialize();
      assert.deepEqual((await c.game.view(a)).activeBeacon, view.activeBeacon);
      assert.equal(await points(c, a), before);
    }),
);

test(
  "exploration buff families use real authority, retain adjacency and daily caps, including cohort and scout",
  { skip: !database, timeout: 60000 },
  async (t) =>
    fixture(async (c) => {
      const a = c.play.fixture.actors[0]!;
      const mutation = new M3TestMutationService(c.pool, {
        realtimeViews: true,
        boundary: { headquarters: c.play.fixture.headquarters, ruleVersion: 1 },
      });
      let row = 100;
      for (const [id, n, shared, rebate] of [
        ["vanguard", 12, false, 5],
        ["assault", 12, true, 5],
        ["thrift", 40, false, 2],
        ["breakthrough", 10, false, 2],
        ["foothold", 6, true, 3],
        ["wide", 1, false, 0],
        ["vision", 1, false, 0],
        ["cohort", 10, false, 5],
      ] as const) {
        await t.test(id, async () => {
          await active(c, id);
          await c.pool.query(
            "DELETE FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='buff-usage'",
            [c.campaign],
          );
          const z = row++;
          await seedTile(c, 49, z);
          const actors =
            id === "cohort" ? c.play.fixture.actors.slice(0, 10) : [a];
          const before = await Promise.all(actors.map((v) => points(c, v)));
          for (let i = 0; i < n; i++) {
            const x = 50 + i,
              actor = actors[i % actors.length]!;
            if (shared) await seedTile(c, x, z, 2);
            const cmd = {
              campaignId: c.campaign,
              actorId: actor.actorId,
              schoolSlot: 0,
              key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
              tileIndex: z * 1000 + x,
              cost: 1n,
            };
            const result = await mutation.apply(cmd);
            assert.equal(result.result.status, "test_applied");
            if (i === n - 1)
              assert.deepEqual(
                (await mutation.apply(cmd)).result,
                result.result,
                "retry never repeats the bonus",
              );
          }
          const after = await Promise.all(actors.map((v) => points(c, v)));
          assert.equal(
            before.reduce((a, b) => a + b, 0n) -
              after.reduce((a, b) => a + b, 0n),
            BigInt(n * (shared ? 2 : 1) - rebate),
          );
          if (id === "wide" || id === "vision") {
            const fog = (
              await c.pool.query<{ fog: Buffer }>(
                "SELECT fog FROM r2pl_v2.school_fog_chunks WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=0",
                [c.campaign, chunkId(0, Math.floor(z / 64))],
              )
            ).rows[0]!.fog;
            const local = localIndex(53, z);
            assert(fog[local >> 3]! & (1 << (local & 7)));
          }
          assert((await c.play.accounts.profile(a.token))!.ledgerConserved);
        });
      }
      await t.test("scout", async () => {
        await active(c, "scout");
        const before = await c.pool.query(
          "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 ORDER BY chunk_id",
          [c.campaign],
        );
        const privateBefore = (await c.game.view(a)).chests;
        const cmd = command("scout");
        assert.equal((await http(c, a, cmd)).status, "applied");
        assert.equal((await http(c, a, cmd)).status, "applied");
        assert.equal(
          (await http(c, a, command("scout"))).reason,
          "SCOUT_COOLDOWN",
        );
        const after = await c.pool.query(
          "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND mask<>$2 ORDER BY chunk_id",
          [c.campaign, Buffer.alloc(8192)],
        );
        assert.deepEqual(
          after.rows,
          before.rows.filter(
            (r) => !(r.mask as Buffer).equals(Buffer.alloc(8192)),
          ),
        );
        assert.deepEqual((await c.game.view(a)).chests, privateBefore);
        assert.equal((await c.game.view(a)).canScout, false);
      });
    }),
);

test(
  "reward buff families apply after RNG, keep keys/claims/cooldowns, and never reset past cooldowns",
  { skip: !database, timeout: 60000 },
  async (t) =>
    fixture(async (c) => {
      const a = c.play.fixture.actors[0]!,
        stop = STAGING_OBJECTS.find(
          (o) => o.kind === "unistop" && o.tier === "aspire",
        )!;
      await seedTile(c, stop.x, stop.z);
      const spin = async () => {
        await save(c, "cooldowns", a.actorId, {});
        return http(c, a, command("spin", stop.id));
      };
      for (const [id, n, extra] of [
        ["urgent", 11, 10],
        ["reserve", 10, 1],
        ["reinforcement", 4, 1],
      ] as const)
        await t.test(id, async () => {
          await active(c, id);
          await c.pool.query(
            "DELETE FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='buff-usage'",
            [c.campaign],
          );
          const before = BigInt((await c.game.view(a)).crystals);
          for (let i = 0; i < n; i++)
            assert.equal((await spin()).status, "applied");
          assert.equal(
            BigInt((await c.game.view(a)).crystals) - before,
            BigInt(n + extra),
          );
        });
      for (const [id, percent] of [
        ["supply", 10],
        ["return", 20],
      ] as const)
        await t.test(id, async () => {
          await active(c, id);
          const now = Date.now(),
            receipt = await spin();
          assert(
            Math.abs(
              receipt.nextAvailableAtMs! -
                now -
                (GAME_CONFIG.rewards.unistopCooldownMs.aspire *
                  (100 - percent)) /
                  100,
            ) < 1000,
          );
          await active(c, "thrift");
          assert.equal(
            (await http(c, a, command("spin", stop.id))).reason,
            "COOLDOWN",
          );
        });
      c.setRoll(999);
      const chests = STAGING_OBJECTS.filter((o) => o.kind === "chest");
      let index = 0;
      for (const [id, extra] of [
        ["excavation", 2],
        ["harvest", 1],
        ["revival", 2],
      ] as const)
        await t.test(id, async () => {
          await active(c, id);
          const chest = chests[index++]!;
          await c.pool.query(
            "INSERT INTO r2pl_v2.game_chest_discoveries(campaign_id,actor_id,object_id) VALUES($1,$2,$3)",
            [c.campaign, a.actorId, chest.id],
          );
          await c.pool.query(
            "UPDATE r2pl_v2.wallet_accounts SET opening_balance=opening_balance+(10-balance),balance=10 WHERE campaign_id=$1 AND actor_id=$2 AND resource=$3",
            [c.campaign, a.actorId, `key-${chest.tier}`],
          );
          const result = await http(c, a, command("open", chest.id));
          assert.equal(
            (
              await c.pool.query(
                "SELECT count(*)::int AS n FROM r2pl_v2.notification_events WHERE campaign_id=$1 AND event_key=$2 AND kind='chest_opened'",
                [c.campaign, `chest:${chest.id}`],
              )
            ).rows[0].n,
            1,
          );
          assert.equal(result.reward?.quantity, 10 + extra);
          assert.equal(
            (await http(c, a, command("open", chest.id))).reason,
            "CHEST_COLLECTED",
          );
        });
      await t.test("comeback", async () => {
        await active(c, "comeback");
        const m = new M3TestMutationService(c.pool, {
          realtimeViews: true,
          boundary: {
            headquarters: c.play.fixture.headquarters,
            ruleVersion: 1,
          },
        });
        await seedTile(c, 49, 160);
        const before = await points(c, a);
        for (let x = 50; x < 60; x++)
          await m.apply({
            campaignId: c.campaign,
            actorId: a.actorId,
            schoolSlot: 0,
            key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
            tileIndex: 160000 + x,
            cost: 1n,
          });
        c.setRoll(625);
        await spin();
        assert.equal(before - (await points(c, a)), 5n);
        await spin();
        assert.equal(
          before - (await points(c, a)),
          5n,
          "mission pays once per day",
        );
      });
    }),
);

test(
  "upkeep and consolidation buffs refund real successful payments without creating refundable bonus escrow",
  { skip: !database, timeout: 30000 },
  async (t) =>
    fixture(async (c) => {
      const a = c.play.fixture.actors[0]!,
        now = Date.now();
      await t.test("upkeep", async () => {
        await active(c, "upkeep");
        await save(c, "shared-cluster", "upkeep-test", {
          id: "upkeep-test",
          pair: [0, 1],
          tiles: [],
          createdAt: now - 90000000,
          due: { 0: now + 86400000, 1: now + 86400000 },
          status: "shared",
          escrow: {},
        });
        const before = await points(c, a);
        for (let i = 0; i < 10; i++)
          assert.equal(
            (await http(c, a, command("upkeep", "upkeep-test", 1))).status,
            "applied",
          );
        assert.equal(before - (await points(c, a)), 9n);
        assert((await c.play.accounts.profile(a.token))!.ledgerConserved);
      });
      await t.test("consolidation", async () => {
        await active(c, "consolidation");
        await save(c, "shared-cluster", "consolidation-test", {
          id: "consolidation-test",
          pair: [0, 1],
          tiles: [],
          createdAt: now - 90000000,
          due: { 0: now + 86400000, 1: 0 },
          status: "consolidating",
          guest: 0,
          hardUntil: now + 86400000,
          rollingUntil: now + 3600000,
          required: 10,
          escrow: {},
        });
        const before = await points(c, a),
          cmd = command("consolidate", "consolidation-test", 10);
        assert.equal((await http(c, a, cmd)).status, "applied");
        await http(c, a, cmd);
        assert.equal(before - (await points(c, a)), 9n);
        assert.equal(
          await state(c, "shared-cluster", "consolidation-test"),
          undefined,
        );
        await save(c, "shared-cluster", "expiry-test", {
          id: "expiry-test",
          pair: [0, 1],
          tiles: [],
          createdAt: now - 90000000,
          due: { 0: now + 86400000, 1: 0 },
          status: "consolidating",
          guest: 0,
          hardUntil: now + 86400000,
          rollingUntil: now + 3600000,
          required: 10,
          escrow: {},
        });
        const saved = await points(c, a);
        await http(c, a, command("consolidate", "expiry-test", 5));
        await c.pool.query(
          "UPDATE r2pl_v2.game_state SET data=jsonb_set(data,'{rollingUntil}','0') WHERE campaign_id=$1 AND scope='shared-cluster' AND id='expiry-test'",
          [c.campaign],
        );
        await c.game.settle();
        assert.equal(
          await points(c, a),
          saved,
          "expiry refunds principal only, no buff was issued",
        );
        assert((await c.play.accounts.profile(a.token))!.ledgerConserved);
      });
    }),
);

test(
  "7x7 scout and exploration snapshots cross four chunks and never relay rival masks or private chests",
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async (c) => {
      const { ProjectionReplica } = await import(
        "../shared/protocol/replica.ts"
      );
      const {
        M2_KIND,
        decodeFrame,
        decodeSnapshot,
        encodeSubscribe,
        encodeExplore,
      } = await import("../shared/protocol/m2.ts");
      await seedTile(c, 63, 63);
      await active(c, "scout");
      const replicas = [new ProjectionReplica(0), new ProjectionReplica(1)],
        ids = [0, 1, 16, 17];
      for (let slot = 0; slot < 2; slot++) {
        c.play.realtime.core.addSession(
          `beacon-${slot}`,
          c.play.fixture.actors[slot * 10]!,
          {
            send(bytes) {
              const frame = decodeFrame(bytes);
              if (frame.kind === M2_KIND.SNAPSHOT)
                replicas[slot]!.applySnapshot(decodeSnapshot(frame.payload));
            },
            close() {},
          },
        );
        await c.play.realtime.core.handle(
          `beacon-${slot}`,
          encodeSubscribe(ids),
        );
      }
      try {
        assert.equal(
          (await http(c, c.play.fixture.actors[0]!, command("scout"))).status,
          "applied",
        );
        await c.play.realtime.core.drainOutbox();
        for (let z = 60; z <= 66; z++)
          for (let x = 60; x <= 66; x++) {
            const id = chunkId(Math.floor(x / 64), Math.floor(z / 64)),
              local = localIndex(x, z);
            assert.equal(replicas[0]!.isDiscovered(id, local), true);
            assert.equal(replicas[1]!.isDiscovered(id, local), false);
            if (x !== 63 || z !== 63)
              assert.equal(replicas[0]!.maskAt(id, local), 0);
          }
        await active(c, "vision");
        await c.play.realtime.core.handle(
          "beacon-0",
          encodeExplore({
            key: Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
            tileIndex: 63064,
            ruleVersion: 1,
          }),
        );
        await c.play.realtime.core.drainOutbox();
        for (let slot = 0; slot < 2; slot++)
          for (const id of ids) {
            const expected = await c.play.realtime.authority.snapshot(slot, id);
            assert.equal(replicas[slot]!.revision(id), expected.viewRevision);
            for (let local = 0; local < 4096; local++) {
              assert.equal(
                replicas[slot]!.maskAt(id, local),
                Buffer.from(expected.mask).readUInt16LE(local * 2),
              );
              assert.equal(
                replicas[slot]!.isDiscovered(id, local),
                !!(expected.fog[local >> 3]! & (1 << (local & 7))),
              );
            }
          }
      } finally {
        c.play.realtime.core.removeSession("beacon-0");
        c.play.realtime.core.removeSession("beacon-1");
      }
    }),
);

test(
  "station arrival emits once for new school contact, not for every view refresh",
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async (c) => {
      const actor = c.play.fixture.actors[0]!,
        hq =
          STAGING_OBJECTS.find((o) => o.kind === "hq" && o.schoolSlot === 0) ??
          STAGING_OBJECTS.find((o) => o.kind === "hq")!,
        template = STAGING_OBJECTS.find((o) => o.kind === "unistop")!;
      const stop = {
        ...template,
        id: "notification-stop",
        name: "Synthetic arrival station",
        x: hq.x + hq.width / 2 + template.width / 2,
        z: hq.z,
        ownerSchoolSlot: null,
        ownerSchoolId: null,
      };
      await c.pool.query(
        "INSERT INTO r2pl_v2.game_world_objects(campaign_id,id,data) VALUES($1,$2,$3)",
        [c.campaign, stop.id, JSON.stringify(stop)],
      );
      await c.game.view(actor);
      await c.game.view(actor);
      const events = async () =>
        (
          await c.pool.query(
            "SELECT count(*)::int AS n FROM r2pl_v2.notification_events WHERE campaign_id=$1 AND kind='station_arrival' AND event_key LIKE 'station:notification-stop:0:%'",
            [c.campaign],
          )
        ).rows[0].n;
      assert.equal(await events(), 1);
      await c.pool.query(
        "UPDATE r2pl_v2.game_world_objects SET data=$3 WHERE campaign_id=$1 AND id=$2",
        [c.campaign, stop.id, JSON.stringify({ ...stop, x: 500, z: 500 })],
      );
      await c.game.view(actor);
      await c.pool.query(
        "UPDATE r2pl_v2.game_world_objects SET data=$3 WHERE campaign_id=$1 AND id=$2",
        [c.campaign, stop.id, JSON.stringify(stop)],
      );
      await c.game.view(actor);
      assert.equal(await events(), 2);
    }),
);
