import assert from "node:assert/strict";
import test from "node:test";
import { TerrainBiomes } from "../client/src/terrainBiomes.ts";
import { writeTerrainTile } from "../client/src/terrainChunks.ts";
import type {
  CommittedFixtureDelta,
  M35FixtureAuthority,
} from "../server/persistence/M35FixtureAuthority.ts";
import { DurableRealtimeCore } from "../server/realtime/DurableRealtimeCore.ts";
import {
  MapStateBatcher,
  type MapStateSource,
} from "../server/realtime/MapStateBatcher.ts";
import {
  GAME_CONFIG,
  type WorldObject,
} from "../shared/gameplay/gameConfig.ts";
import {
  decodeFrame,
  encodeLiveSubscribe,
  M2_KIND,
} from "../shared/protocol/m2.ts";
import {
  decodeMapState,
  decodeTilePatch,
  encodeMapState,
  encodeTilePatch,
} from "../shared/protocol/mapStream.ts";
import {
  ProjectionReplica,
  PublicKnowledgeReplica,
} from "../shared/protocol/replica.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("tile patches coalesce revisions, reject truncation/private leaks, and recover gaps", () => {
  const own = new ProjectionReplica(0),
    pub = new PublicKnowledgeReplica();
  own.applySnapshot({
    chunkId: 0,
    viewRevision: 2n,
    mask: new Uint8Array(8192),
    fog: new Uint8Array(512),
  });
  pub.applySnapshot({ chunkId: 0, revision: 2n, mask: new Uint8Array(8192) });
  const patch = {
    chunkId: 0,
    baseRevision: 1n,
    nextRevision: 5n,
    tiles: [{ localIndex: 1, mask: 1, discovered: true }],
  };
  const bytes = encodeTilePatch(patch, true);
  assert.equal(
    own.applyPatch(decodeTilePatch(decodeFrame(bytes).payload, true)),
    "applied",
  );
  assert.equal(own.maskAt(0, 1), 1);
  assert.equal(own.isDiscovered(0, 1), true);
  assert.equal(own.applyPatch(patch), "duplicate");
  assert.equal(
    own.applyPatch({ ...patch, baseRevision: 6n, nextRevision: 7n }),
    "resync",
  );
  assert.throws(() =>
    decodeTilePatch(decodeFrame(bytes).payload.subarray(1), true),
  );
  assert.throws(() => encodeTilePatch(patch), /Invalid patch tile/);
  assert.throws(
    () =>
      own.applyPatch({
        ...patch,
        nextRevision: 6n,
        tiles: [{ localIndex: 2, mask: 2, discovered: true }],
      }),
    /Unauthorized/,
  );
  assert.equal(own.revision(0), 5n);
  const publicPatch = { ...patch, tiles: [{ localIndex: 1, mask: 2 }] };
  assert.equal(
    pub.applyPatch(
      decodeTilePatch(decodeFrame(encodeTilePatch(publicPatch)).payload),
    ),
    "applied",
  );
  assert.equal(pub.maskAt(0, 1), 2);
  assert.equal(own.isDiscovered(0, 2), false);
});

test("own terrain tint updates immediately while public snapshot is intentionally stale", () => {
  const own = new ProjectionReplica(0),
    pub = new PublicKnowledgeReplica();
  own.applySnapshot({
    chunkId: 0,
    viewRevision: 0n,
    mask: new Uint8Array(8192),
    fog: new Uint8Array(512),
  });
  pub.applySnapshot({ chunkId: 0, revision: 0n, mask: new Uint8Array(8192) });
  own.applyPatch({
    chunkId: 0,
    baseRevision: 0n,
    nextRevision: 1n,
    tiles: [{ localIndex: 1, mask: 1, discovered: true }],
  });
  const pixels = new Uint8Array(16384);
  writeTerrainTile(pixels, 0, 1, own, new TerrainBiomes(), 0, new Map(), pub);
  assert(
    pixels[63 * 256 + 7]! >= 128,
    "stale public state must not suppress immediate own Knowledge tint",
  );
});

test("a burst reads one school snapshot, sends one small patch to teammates, and delays rivals", async () => {
  let head = 0n,
    reads = 0;
  const mask = new Uint8Array(8192),
    fog = new Uint8Array(512),
    pending: CommittedFixtureDelta[] = [];
  const frames: Uint8Array[][] = [[], [], []];
  const authority = {
    fogRevealRadius: 1,
    snapshot: async (slot: number) => {
      reads++;
      return {
        chunkId: 0,
        viewRevision: slot === 0 ? head : 0n,
        mask: slot === 0 ? Uint8Array.from(mask) : new Uint8Array(8192),
        fog: slot === 0 ? Uint8Array.from(fog) : new Uint8Array(512),
      };
    },
    publicSnapshot: async () => ({
      chunkId: 0,
      revision: head,
      mask: Uint8Array.from(mask),
    }),
    drain: async (publish: (event: CommittedFixtureDelta) => Promise<void>) => {
      const events = pending.splice(0);
      for (const event of events) await publish(event);
      return events.length;
    },
  } as unknown as M35FixtureAuthority;
  const core = new DurableRealtimeCore(authority);
  for (let i = 0; i < 3; i++) {
    core.addSession(
      String(i),
      { actorId: String(i), schoolSlot: i === 2 ? 1 : 0 },
      {
        send: (bytes) => {
          frames[i]!.push(bytes);
        },
        close: (reason) => {
          if (reason !== "left") assert.fail(reason);
        },
      },
    );
    await core.handle(String(i), encodeLiveSubscribe([0]));
  }
  const initialReads = reads;
  for (let localIndex = 100; localIndex < 120; localIndex++) {
    head++;
    new DataView(mask.buffer).setUint16(localIndex * 2, 1, true);
    fog[localIndex >> 3]! |= 1 << (localIndex & 7);
    pending.push({
      eventId: String(head),
      actorId: "0",
      commandKeyHex: "key",
      chunkId: 0,
      schoolSlot: 0,
      viewRevision: head,
      publicRevision: head,
      localIndex,
      mask: 1,
      publicMask: 1,
      discovered: true,
      claimReturnedAtMs: 0,
      projectedAtMs: 0,
    });
  }
  await core.drainOutbox();
  await tick();
  assert.equal(
    reads,
    initialReads,
    "relay must defer DB snapshot reads until the school batch flush",
  );
  await core.flushSchoolChanges();
  await tick();
  assert.equal(
    reads,
    initialReads + 1,
    "two same-school viewers share a snapshot read",
  );
  for (const index of [0, 1]) {
    const patches = frames[index]!.map((b) => decodeFrame(b)).filter(
      (f) => f.kind === M2_KIND.SCHOOL_PATCH,
    );
    assert.equal(patches.length, 1);
    assert.equal(decodeTilePatch(patches[0]!.payload, true).tiles.length, 20);
    assert(patches[0]!.payload.length < 200);
  }
  assert.equal(
    frames[2]!
      .map((b) => decodeFrame(b))
      .filter(
        (f) =>
          f.kind === M2_KIND.SCHOOL_PATCH || f.kind === M2_KIND.PUBLIC_PATCH,
      ).length,
    0,
  );
  await core.flushPublicChanges();
  await tick();
  const rivalPatch = frames[2]!
    .map((b) => decodeFrame(b))
    .find((f) => f.kind === M2_KIND.PUBLIC_PATCH)!;
  assert.equal(decodeTilePatch(rivalPatch.payload).tiles.length, 20);
  assert(
    decodeTilePatch(rivalPatch.payload).tiles.every(
      (t) => t.discovered === undefined,
    ),
  );
  await core.handle("2", encodeLiveSubscribe([]));
  for (let i = 0; i < 3; i++) core.removeSession(String(i));
});

test("map batches prioritize takeover schools, delay rivals and omit private chests", () => {
  const stop: WorldObject = {
    id: "stop",
    kind: "unistop",
    name: "Stop",
    x: 10,
    z: 10,
    width: 2,
    height: 2,
    ownerSchoolSlot: 0,
  };
  const source: MapStateSource = {
    objects: [stop, { ...stop, id: "private", kind: "chest" }],
    beacons: [{ id: "fansipan", holder: null }],
  };
  const batcher = new MapStateBatcher();
  batcher.update(source, [0, 1, 2], 0);
  const changed: MapStateSource = {
    objects: [{ ...stop, ownerSchoolSlot: 1 }],
    beacons: [{ id: "fansipan", holder: 0 }],
  };
  const fast = batcher.update(changed, [0, 1, 2], 100);
  assert.deepEqual(
    fast.map((v) => v.slot),
    [0, 1],
  );
  assert.equal(fast.find((v) => v.slot === 0)!.batch.beacons[0]!.holder, 0);
  assert.equal(batcher.snapshot(1)!.beacons[0]!.holder, null);
  assert.equal(batcher.snapshot(2)!.objects[0]!.ownerSchoolSlot, 0);
  assert.equal(batcher.snapshot(2)!.beacons[0]!.holder, null);
  assert.equal(batcher.snapshot(0)!.objects.length, 1);
  assert.deepEqual(batcher.update(changed, [0, 1, 2], 11999), []);
  const slow = batcher.update(
    changed,
    [0, 1, 2],
    GAME_CONFIG.realtime.rivalBatchMs,
  );
  assert(slow.some((v) => v.slot === 2));
  assert.equal(batcher.snapshot(2)!.beacons[0]!.holder, 0);
  assert.equal(
    decodeMapState(decodeFrame(encodeMapState(batcher.snapshot(2)!)).payload)
      .beacons[0]!.holder,
    0,
  );
});
