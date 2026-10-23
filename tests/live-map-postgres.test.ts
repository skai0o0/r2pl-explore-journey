import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { Pool } from "pg";
import { botDatabase } from "../scripts/simulation/config.ts";
import { cleanupBotFixture } from "../scripts/simulation/fixture.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { cleanupSchoolRewards } from "../server/integration/SchoolRewardFixture.ts";
import type { WorldObject } from "../shared/gameplay/gameConfig.ts";
import {
  decodeAck,
  decodeFrame,
  decodePublicSnapshot,
  decodeSnapshot,
  encodeExplore,
  encodeLiveSubscribe,
  M2_KIND,
} from "../shared/protocol/m2.ts";
import {
  decodeMapState,
  decodeTilePatch,
  type MapBeacon,
} from "../shared/protocol/mapStream.ts";
import {
  ProjectionReplica,
  PublicKnowledgeReplica,
} from "../shared/protocol/replica.ts";

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!predicate() && Date.now() < end) await pause(10);
  assert(predicate(), "stream state did not converge before deadline");
}

test("three real players stream committed territory, same-school beacons and delayed rival objects without fog leaks", {
  skip: !database,
  timeout: 35000,
}, async () => {
  const pool = new Pool({
    connectionString: botDatabase(database, "1"),
    max: 16,
  });
  const campaign = randomUUID();
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  const rooms: Room[] = [];
  try {
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      campaign,
      { actorsPerSchool: 2 },
    );
    const players = [
      play.fixture.players.filter((p) => p.slot === 0)[0]!,
      play.fixture.players.filter((p) => p.slot === 0)[1]!,
      play.fixture.players.find((p) => p.slot === 1)!,
    ];
    const owner = players[0]!,
      x = owner.home.x + 10,
      z = owner.home.z;
    const id = Math.floor(z / 64) * 16 + Math.floor(x / 64),
      local = (z % 64) * 64 + (x % 64);
    const states = players.map((p) => ({
      own: new ProjectionReplica(p.slot),
      pub: new PublicKnowledgeReplica(),
      objects: new Map<string, WorldObject>(),
      beacons: new Map<string, MapBeacon>(),
      patches: 0,
      ack: false,
    }));
    const sdk = new ColyseusSDK(`ws://127.0.0.1:${play.websocketPort}`);
    for (let i = 0; i < players.length; i++) {
      const room = rooms[0]
        ? await sdk.joinById(rooms[0].roomId, { token: players[i]!.token })
        : await sdk.joinOrCreate("m2", { token: players[i]!.token });
      rooms.push(room);
      const state = states[i]!;
      room.onMessage("m2", (raw: Uint8Array) => {
        const frame = decodeFrame(Uint8Array.from(raw));
        if (frame.kind === M2_KIND.SNAPSHOT)
          state.own.applySnapshot(decodeSnapshot(frame.payload));
        if (frame.kind === M2_KIND.PUBLIC_SNAPSHOT)
          state.pub.applySnapshot(decodePublicSnapshot(frame.payload));
        if (frame.kind === M2_KIND.SCHOOL_PATCH) {
          assert.notEqual(
            state.own.applyPatch(decodeTilePatch(frame.payload, true)),
            "resync",
          );
          state.patches++;
        }
        if (frame.kind === M2_KIND.PUBLIC_PATCH)
          assert.notEqual(
            state.pub.applyPatch(decodeTilePatch(frame.payload)),
            "resync",
          );
        if (frame.kind === M2_KIND.ACK)
          state.ack = decodeAck(frame.payload).status === 1;
        if (frame.kind === M2_KIND.MAP_STATE) {
          const batch = decodeMapState(frame.payload);
          assert(batch.objects.every((o) => o.kind !== "chest"));
          if (batch.reset) {
            state.objects.clear();
            state.beacons.clear();
          }
          for (const o of batch.objects) state.objects.set(o.id, o);
          for (const key of batch.removed) state.objects.delete(key);
          for (const b of batch.beacons) state.beacons.set(b.id, b);
        }
      });
      room.sendBytes("m2", encodeLiveSubscribe([id]));
    }
    await wait(() =>
      states.every(
        (s) => s.own.hasChunk(id) && s.pub.hasChunk(id) && s.objects.size > 0,
      ),
    );
    assert.equal(states[2]!.pub.maskAt(id, local), 0);
    const started = Date.now();
    rooms[0]!.sendBytes(
      "m2",
      encodeExplore({
        key: Uint8Array.from(
          Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
        ),
        tileIndex: z * 1000 + x,
        ruleVersion: 1,
        intent: "explore",
      }),
    );
    await wait(() => states[0]!.ack && states[1]!.own.maskAt(id, local) === 1);
    assert(Date.now() - started < 3000);
    assert(states[1]!.patches > 0);
    assert.equal(
      states[2]!.pub.maskAt(id, local),
      0,
      "rival layer must not bypass the slow batch",
    );
    await pause(700); // Let the post-commit stop capture finish before simulating an editor publication.
    const stop = [...states[0]!.objects.values()].find(
      (o) => o.kind === "unistop",
    )!;
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "UPDATE r2pl_v2.game_world_objects SET data=jsonb_set(data,'{ownerSchoolSlot}','0'::jsonb) WHERE campaign_id=$1 AND id=$2",
        [campaign, stop.id],
      );
      await db.query(
        `INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'beacon','fansipan','{"holder":0,"pots":{},"cooldowns":{},"takeovers":0}'::jsonb) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data`,
        [campaign],
      );
      await db.query("COMMIT");
    } finally {
      db.release();
    }
    await wait(
      () =>
        states[1]!.objects.get(stop.id)?.ownerSchoolSlot === 0 &&
        states[1]!.beacons.get("fansipan")?.holder === 0,
    );
    assert.notEqual(states[2]!.objects.get(stop.id)?.ownerSchoolSlot, 0);
    assert.notEqual(states[2]!.beacons.get("fansipan")?.holder, 0);
    await wait(
      () =>
        states[2]!.pub.maskAt(id, local) === 1 &&
        states[2]!.objects.get(stop.id)?.ownerSchoolSlot === 0 &&
        states[2]!.beacons.get("fansipan")?.holder === 0,
      16000,
    );
    assert.equal(states[2]!.own.maskAt(id, local), 0);
    assert.equal(states[2]!.own.isDiscovered(id, local), false);
  } finally {
    await Promise.all(rooms.map((r) => r.leave()));
    await play?.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});
