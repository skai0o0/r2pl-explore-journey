import assert from "node:assert/strict";
import test from "node:test";
import { SyntheticVisibilityProjection } from "../server/realtime/VisibilityProjection.ts";
import {
  ACK_STATUS,
  type Delta,
  decodeAck,
  decodeDelta,
  decodeExplore,
  decodeFrame,
  decodeSnapshot,
  decodePublicDelta,
  decodePublicSnapshot,
  encodeAck,
  encodeDelta,
  encodeExplore,
  encodeFrame,
  encodeResync,
  encodeSnapshot,
  encodePublicDelta,
  encodePublicSnapshot,
  encodeSubscribe,
  M2_KIND,
  REASON,
} from "../shared/protocol/m2.ts";
import {
  ProjectionReplica,
  PublicKnowledgeReplica,
} from "../shared/protocol/replica.ts";
import { chunkId, localIndex, tileIndex } from "../shared/world/coordinates.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";
import { WorldState } from "../shared/world/world.ts";

test("M2 binary command golden bytes and malformed-frame rejection", () => {
  const key = Uint8Array.from({ length: 16 }, (_, i) => i);
  const frame = encodeExplore({ key, tileIndex: 999_999, ruleVersion: 0 });
  assert.equal(
    Buffer.from(frame).toString("hex"),
    "5232010116000000000102030405060708090a0b0c0d0e0f3f420f0000004cefb947",
  );
  assert.deepEqual(decodeExplore(decodeFrame(frame, 1024).payload), {
    key,
    tileIndex: 999_999,
    ruleVersion: 0,
  });
  const corrupt = Uint8Array.from(frame);
  corrupt[10] = (corrupt[10] ?? 0) ^ 1;
  assert.throws(() => decodeFrame(corrupt), /checksum/);
  assert.throws(() => decodeFrame(frame.subarray(1)), /header|length/);
  assert.throws(() => decodeFrame(frame, 20), /length/);
  assert.throws(() =>
    encodeExplore({ key, tileIndex: 1_000_000, ruleVersion: 0 }),
  );
  assert.throws(() => encodeExplore({ key, tileIndex: 0, ruleVersion: 2 }));
});

test("M2 subscribe, resync, ack and delta wire fixtures stay byte stable", () => {
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  assert.equal(
    hex(encodeSubscribe([0, 255])),
    "5232010205000000020000ff008388b8f8",
  );
  assert.equal(hex(encodeResync(255)), "5232010302000000ff002d90027d");
  const ack = encodeAck({
    key: Uint8Array.from({ length: 16 }, (_, i) => i),
    status: ACK_STATUS.TEST_APPLIED,
    reason: REASON.NONE,
    chunkId: 255,
    viewRevision: 1n,
  });
  assert.equal(
    hex(ack),
    "523201111c000000000102030405060708090a0b0c0d0e0f0100ff0001000000000000002f52b3db",
  );
  assert.equal(decodeAck(decodeFrame(ack).payload).viewRevision, 1n);
  assert.equal(
    hex(
      encodeDelta({
        chunkId: 255,
        baseRevision: 0n,
        nextRevision: 1n,
        localIndex: 2599,
        mask: 32768,
        discovered: true,
      }),
    ),
    "5232011317000000ff0000000000000000000100000000000000270a008001f2b0f57c",
  );
});

test("synthetic visibility projects only caller's bit and fog, including edge padding", () => {
  const registry = new SchoolRegistry([
    { id: "fixture-a", slot: 0 },
    { id: "fixture-b", slot: 15 },
  ]);
  const world = new WorldState(registry);
  const tile = tileIndex(999, 999);
  world.setPresence(tile, 0, true);
  world.setPresence(tile, 15, true);
  world.reveal(tile, 15);
  world.setMetadata({
    tileIndex: tile,
    schoolSlot: 15,
    formatVersion: 1,
    payload: Uint8Array.of(99),
  });
  const projection = new SyntheticVisibilityProjection(world);
  const id = chunkId(15, 15),
    local = localIndex(999, 999);
  const a = projection.snapshot(0, id, 0n),
    b = projection.snapshot(15, id, 0n);
  const replicaA = new ProjectionReplica(0),
    replicaB = new ProjectionReplica(15);
  replicaA.applySnapshot(
    decodeSnapshot(decodeFrame(encodeSnapshot(a)).payload),
  );
  replicaB.applySnapshot(
    decodeSnapshot(decodeFrame(encodeSnapshot(b)).payload),
  );
  assert.equal(replicaA.maskAt(id, local), 1);
  assert.equal(replicaB.maskAt(id, local), 0x8000);
  assert.equal(replicaA.isDiscovered(id, local), false);
  assert.equal(replicaB.isDiscovered(id, local), true);
  assert.equal(a.mask.includes(99), false);
  const leaked = structuredClone(a);
  leaked.mask[local * 2 + 1] = 0x80;
  assert.throws(() => replicaA.applySnapshot(leaked), /Unauthorized/);
});

test("replica ignores duplicate deltas and requests resync on gaps or reorder", () => {
  const id = chunkId(0, 0),
    local = 5;
  const replica = new ProjectionReplica(0);
  replica.applySnapshot({
    chunkId: id,
    viewRevision: 0n,
    mask: new Uint8Array(8192),
    fog: new Uint8Array(512),
  });
  const first: Delta = {
    chunkId: id,
    baseRevision: 0n,
    nextRevision: 1n,
    localIndex: local,
    mask: 1,
    discovered: true,
  };
  const second: Delta = {
    ...first,
    baseRevision: 1n,
    nextRevision: 2n,
    localIndex: 6,
  };
  const binary = encodeDelta(first);
  assert.equal(decodeFrame(binary).kind, M2_KIND.DELTA);
  assert.deepEqual(decodeDelta(decodeFrame(binary).payload), first);
  assert.equal(replica.applyDelta(second), "resync");
  assert.equal(replica.applyDelta(first), "applied");
  assert.equal(replica.applyDelta(first), "duplicate");
  assert.equal(replica.maskAt(id, local), 1);
  assert.equal(replica.isDiscovered(id, local), true);
  assert.equal(
    replica.applyDelta({ ...second, baseRevision: 3n, nextRevision: 4n }),
    "resync",
  );
  replica.applySnapshot({
    chunkId: id,
    viewRevision: 4n,
    mask: new Uint8Array(8192),
    fog: new Uint8Array(512),
  });
  assert.equal(replica.revision(id), 4n);
  assert.equal(replica.maskAt(id, local), 0);
  assert.throws(
    () => encodeFrame(M2_KIND.DELTA, new Uint8Array(65_536)),
    /large/,
  );
});

test("public Knowledge is mask-only, supports shared membership, and recovers gaps", () => {
  const id = chunkId(0, 0),
    publicReplica = new PublicKnowledgeReplica();
  const privateA = new ProjectionReplica(0),
    privateB = new ProjectionReplica(1);
  privateA.applySnapshot({
    chunkId: id,
    viewRevision: 0n,
    mask: new Uint8Array(8192),
    fog: new Uint8Array(512),
  });
  privateB.applySnapshot({
    chunkId: id,
    viewRevision: 0n,
    mask: new Uint8Array(8192),
    fog: new Uint8Array(512),
  });
  const snapshot = { chunkId: id, revision: 0n, mask: new Uint8Array(8192) };
  publicReplica.applySnapshot(
    decodePublicSnapshot(decodeFrame(encodePublicSnapshot(snapshot)).payload),
  );
  const first = {
    chunkId: id,
    baseRevision: 0n,
    nextRevision: 1n,
    localIndex: 3,
    mask: 3,
  };
  assert.equal(
    publicReplica.applyDelta(
      decodePublicDelta(decodeFrame(encodePublicDelta(first)).payload),
    ),
    "applied",
  );
  assert.equal(
    publicReplica.maskAt(id, 3),
    3,
    "both schools are visible without choosing an owner",
  );
  assert.equal(privateA.isDiscovered(id, 3), false);
  assert.equal(
    privateB.isDiscovered(id, 3),
    false,
    "public membership cannot alter private fog",
  );
  assert.equal(
    publicReplica.applyDelta({ ...first, baseRevision: 2n, nextRevision: 3n }),
    "resync",
  );
  assert.equal(publicReplica.applyDelta(first), "duplicate");
  publicReplica.remove(id);
  assert.equal(
    publicReplica.hasChunk(id),
    false,
    "campaign/session reset drops old public state",
  );
});
