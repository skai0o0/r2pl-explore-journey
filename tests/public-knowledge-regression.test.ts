import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ColyseusSDK } from "@colyseus/sdk";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { migratePortalDatabase } from "../server/persistence/PortalMigrations.ts";
import { DiscoveryFog } from "../client/src/discoveryFog.ts";
import { TerrainBiomes } from "../client/src/terrainBiomes.ts";
import {
  terrainMaterial,
  writeTerrainTile,
} from "../client/src/terrainChunks.ts";
import type {
  CommittedFixtureDelta,
  M35FixtureAuthority,
} from "../server/persistence/M35FixtureAuthority.ts";
import { DurableRealtimeCore } from "../server/realtime/DurableRealtimeCore.ts";
import {
  decodeFrame,
  decodeAck,
  decodePublicDelta,
  decodePublicSnapshot,
  decodeSnapshot,
  encodeExplore,
  encodeSubscribe,
  M2_KIND,
} from "../shared/protocol/m2.ts";
import {
  ProjectionReplica,
  PublicKnowledgeReplica,
} from "../shared/protocol/replica.ts";

function event(revision: bigint): CommittedFixtureDelta {
  return {
    eventId: String(revision),
    actorId: "actor",
    commandKeyHex: "key",
    chunkId: 0,
    schoolSlot: 0,
    viewRevision: revision,
    publicRevision: revision,
    localIndex: 1,
    mask: 1,
    publicMask: 3,
    discovered: true,
    claimReturnedAtMs: 0,
    projectedAtMs: 0,
  };
}

function harness() {
  let head = 100n,
    reads = 0;
  const pending: CommittedFixtureDelta[] = [];
  const frames: Uint8Array[][] = [[], []];
  const closed: string[] = [];
  const authority = {
    fogRevealRadius: 2,
    snapshot: async () => ({
      chunkId: 0,
      viewRevision: 100n,
      mask: new Uint8Array(8192),
      fog: new Uint8Array(512),
    }),
    publicSnapshot: async () => {
      reads++;
      return { chunkId: 0, revision: head, mask: new Uint8Array(8192) };
    },
    drain: async (publish: (e: CommittedFixtureDelta) => Promise<void>) => {
      const batch = pending.splice(0);
      for (const e of batch) await publish(e);
      return batch.length;
    },
  } as unknown as M35FixtureAuthority;
  const core = new DurableRealtimeCore(authority);
  for (let slot = 0; slot < 2; slot++)
    core.addSession(
      String(slot),
      { actorId: `actor-${slot}`, schoolSlot: slot },
      {
        send: (bytes) => {
          frames[slot]!.push(bytes);
        },
        close: (reason) => {
          closed.push(reason);
        },
      },
    );
  return {
    core,
    pending,
    frames,
    closed,
    reads: () => reads,
    setHead: (value: bigint) => {
      head = value;
    },
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const publicFrames = (frames: Uint8Array[]) =>
  frames
    .map((bytes) => decodeFrame(bytes))
    .filter(
      (f) =>
        f.kind === M2_KIND.PUBLIC_SNAPSHOT || f.kind === M2_KIND.PUBLIC_DELTA,
    );

test("relay backlog already covered by snapshots never resends public chunks or disconnects peers", async () => {
  const h = harness();
  await h.core.handle("0", encodeSubscribe([0]));
  await h.core.handle("1", encodeSubscribe([0]));
  await flush();
  const reads = h.reads();
  for (let n = 1n; n <= 100n; n++) h.pending.push(event(n));
  await h.core.drainOutbox();
  await flush();
  assert.equal(
    h.reads(),
    reads,
    "old revisions must not refetch complete chunks",
  );

  for (const frames of h.frames) assert.equal(publicFrames(frames).length, 1);
  assert.deepEqual(h.closed, []);
  h.setHead(101n);
  h.pending.push(event(101n), event(101n));
  await h.core.drainOutbox();
  await flush();
  for (const frames of h.frames) {
    assert.deepEqual(
      publicFrames(frames).map((f) => f.kind),
      [M2_KIND.PUBLIC_SNAPSHOT, M2_KIND.PUBLIC_DELTA],
    );
  }
});

test("a real public revision gap shares one recovery read and skips the recovered batch tail", async () => {
  const h = harness();
  await h.core.handle("0", encodeSubscribe([0]));
  await h.core.handle("1", encodeSubscribe([0]));
  const reads = h.reads();
  h.setHead(110n);
  h.pending.push(event(105n), event(106n), event(110n));
  await h.core.drainOutbox();
  await flush();
  assert.equal(h.reads(), reads + 1);
  for (const frames of h.frames) assert.equal(publicFrames(frames).length, 2);
  assert.deepEqual(h.closed, []);
});

test("public membership paints unknown terrain without revealing fog and can be revoked", () => {
  const own = new ProjectionReplica(0),
    pub = new PublicKnowledgeReplica();
  own.applySnapshot({
    chunkId: 0,
    viewRevision: 0n,
    mask: new Uint8Array(8192),
    fog: new Uint8Array(512),
  });
  const mask = new Uint8Array(8192);
  new DataView(mask.buffer).setUint16(2, 2, true);
  pub.applySnapshot({ chunkId: 0, revision: 10n, mask });
  const pixels = new Uint8Array(16384),
    field = new TerrainBiomes();
  writeTerrainTile(pixels, 0, 1, own, field, 0, new Map(), pub);
  assert(pixels[63 * 256 + 7]! >= 128);
  assert.equal(own.isDiscovered(0, 1), false);
  assert.equal(own.maskAt(0, 1), 0);
  pub.applySnapshot({ chunkId: 0, revision: 9n, mask: new Uint8Array(8192) });
  assert.equal(
    pub.maskAt(0, 1),
    2,
    "late snapshots cannot roll back newer knowledge",
  );
  pub.applyDelta({
    chunkId: 0,
    baseRevision: 10n,
    nextRevision: 11n,
    localIndex: 1,
    mask: 0,
  });
  writeTerrainTile(pixels, 0, 1, own, field, 0, new Map(), pub);
  assert.equal(pixels[63 * 256 + 7], 0);
  pub.clear();
  assert.equal(pub.hasChunk(0), false);
});

test("territory tint is composited after cosmetic fog without modifying the discovery atlas", () => {
  const fog = new DiscoveryFog(),
    texture = new THREE.DataTexture(new Uint8Array(16384), 64, 64);
  const material = terrainMaterial(texture, fog);
  const shader = {
    ...THREE.ShaderLib.lambert,
    uniforms: { ...THREE.ShaderLib.lambert.uniforms },
  };
  material.onBeforeCompile(
    shader as Parameters<typeof material.onBeforeCompile>[0],
    {} as THREE.WebGLRenderer,
  );
  const text = shader.fragmentShader;
  assert(
    text.indexOf("Public membership is legible") >
      text.indexOf("float landscapeAmount = landscapeFog()"),
  );
  assert(text.includes("state >= 128.0"));
  assert(fog.pixels.every((value) => value === 0));
  material.dispose();
  texture.dispose();
  fog.dispose();
});

test("signed WebSocket exploration reaches another school's public layer without revealing its fog", {
  skip: !process.env.R2PL_PREPARATION_DATABASE_URL,
  timeout: 15000,
}, async () => {
  const url = new URL(process.env.R2PL_PREPARATION_DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert(url.pathname.startsWith("/r2pl_prep_test_"));
  const pool = new Pool({ connectionString: url.href, max: 12 });
  let play: Awaited<ReturnType<typeof createSchoolPlayServer>> | undefined;
  const rooms: Awaited<ReturnType<ColyseusSDK["joinOrCreate"]>>[] = [];
  const wait = async (predicate: () => boolean) => {
    const end = Date.now() + 5000;
    while (!predicate() && Date.now() < end)
      await new Promise((r) => setTimeout(r, 10));
    assert(predicate(), "expected live public update before timeout");
  };
  try {
    await migratePortalDatabase(pool);
    play = await createSchoolPlayServer(
      pool,
      { web: 0, websocket: 0 },
      randomUUID(),
      { actorsPerSchool: 2 },
    );
    const owner = play.fixture.players.find((a) => a.slot === 0)!;
    const viewer = play.fixture.players.find((a) => a.slot === 1)!;
    const tile = owner.home.z * 1000 + owner.home.x + 10;
    const id =
      Math.floor(owner.home.z / 64) * 16 + Math.floor((owner.home.x + 10) / 64);
    const local = (owner.home.z % 64) * 64 + ((owner.home.x + 10) % 64);
    const sdk = new ColyseusSDK(`ws://127.0.0.1:${play.websocketPort}`);
    const own = await sdk.joinOrCreate("m2", { token: owner.token });
    rooms.push(own);
    const other = await sdk.joinById(own.roomId, { token: viewer.token });
    rooms.push(other);
    const pub = new PublicKnowledgeReplica(),
      priv = new ProjectionReplica(1);
    let applied = false;
    own.onMessage("m2", (raw: Uint8Array) => {
      const frame = decodeFrame(raw);
      if (frame.kind === M2_KIND.ACK)
        applied = decodeAck(frame.payload).status === 1;
    });
    other.onMessage("m2", (raw: Uint8Array) => {
      const frame = decodeFrame(raw);
      if (frame.kind === M2_KIND.PUBLIC_SNAPSHOT)
        pub.applySnapshot(decodePublicSnapshot(frame.payload));
      if (frame.kind === M2_KIND.PUBLIC_DELTA)
        pub.applyDelta(decodePublicDelta(frame.payload));
      if (frame.kind === M2_KIND.SNAPSHOT)
        priv.applySnapshot(decodeSnapshot(frame.payload));
    });
    own.sendBytes("m2", encodeSubscribe([id]));
    other.sendBytes("m2", encodeSubscribe([id]));
    await wait(() => pub.hasChunk(id) && priv.hasChunk(id));
    assert.equal(pub.maskAt(id, local), 0);
    own.sendBytes(
      "m2",
      encodeExplore({
        key: Uint8Array.from(
          Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
        ),
        tileIndex: tile,
        ruleVersion: 1,
        intent: "explore",
      }),
    );
    await wait(() => applied);
    await wait(() => pub.maskAt(id, local) === 1);
    assert.equal(priv.maskAt(id, local), 0);
    assert.equal(priv.isDiscovered(id, local), false);
  } finally {
    await Promise.all(rooms.map((room) => room.leave()));
    await play?.close();
    await pool.end();
  }
});
