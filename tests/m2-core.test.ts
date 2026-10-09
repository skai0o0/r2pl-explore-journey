import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeMetrics } from "../server/realtime/metrics.ts";
import { OutboundQueue } from "../server/realtime/OutboundQueue.ts";
import { RealtimeCore } from "../server/realtime/RealtimeCore.ts";
import { SyntheticAuth } from "../server/realtime/SyntheticAuth.ts";
import {
  ACK_STATUS,
  decodeAck,
  decodeDelta,
  decodeError,
  decodeFrame,
  decodeSnapshot,
  encodeExplore,
  encodeFrame,
  encodeSubscribe,
  M2_KIND,
  REASON,
} from "../shared/protocol/m2.ts";
import { ProjectionReplica } from "../shared/protocol/replica.ts";
import { chunkId, localIndex, tileIndex } from "../shared/world/coordinates.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";
import { WorldState } from "../shared/world/world.ts";

const key = (value: number) =>
  Uint8Array.from({ length: 16 }, (_, i) => (value + i) & 255);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const registry = () =>
  new SchoolRegistry([
    { id: "fixture-a", slot: 0 },
    { id: "fixture-b", slot: 15 },
  ]);

test("indexed fanout preserves subscription and school isolation", async () => {
  const core = new RealtimeCore(new WorldState(registry()), {
    fanoutMode: "indexed",
  });
  const sent: Record<string, Uint8Array[]> = { a: [], b: [], c: [] };
  for (const [id, schoolSlot] of [
    ["a", 0],
    ["b", 0],
    ["c", 15],
  ] as const)
    core.addSession(
      id,
      { actorId: id, schoolSlot },
      {
        send: (bytes) => {
          sent[id]!.push(bytes);
        },
        close: () => {},
      },
    );
  const id = chunkId(0, 0);
  for (const peer of ["a", "b", "c"])
    await core.handle(peer, encodeSubscribe([id]));
  await flush();
  await core.handle("b", encodeSubscribe([]));
  await core.handle(
    "a",
    encodeExplore({ key: key(77), tileIndex: tileIndex(2, 2), ruleVersion: 0 }),
  );
  await flush();
  assert.equal(
    sent.a!.filter((bytes) => decodeFrame(bytes).kind === M2_KIND.DELTA).length,
    1,
  );
  assert.equal(
    sent.b!.filter((bytes) => decodeFrame(bytes).kind === M2_KIND.DELTA).length,
    0,
  );
  assert.equal(
    sent.c!.filter((bytes) => decodeFrame(bytes).kind === M2_KIND.DELTA).length,
    0,
  );
  core.removeSession("a");
  assert.equal(core.connected, 2);
});

test("synthetic authentication binds school server-side and rejects unknown tokens", () => {
  const auth = new SyntheticAuth(registry(), [
    { token: "fixture-secret", actorId: "actor", schoolSlot: 15 },
  ]);
  assert.deepEqual(auth.authenticate("fixture-secret"), {
    actorId: "actor",
    schoolSlot: 15,
  });
  assert.throws(() => auth.authenticate("wrong"), /Unauthorized/);
  assert.throws(() => auth.authenticate(undefined), /required/);
});

test("same-tile clients converge, duplicate keys do not repeat effects, opposing school sees no event", async () => {
  const world = new WorldState(registry());
  const core = new RealtimeCore(world);
  const sent: Record<string, Uint8Array[]> = { a: [], b: [], c: [] };
  for (const [id, schoolSlot] of [
    ["a", 0],
    ["b", 0],
    ["c", 15],
  ] as const) {
    core.addSession(
      id,
      { actorId: id, schoolSlot },
      {
        send: (bytes) => {
          sent[id]!.push(bytes);
        },
        close: () => {},
      },
    );
  }
  const tile = tileIndex(7, 8),
    id = chunkId(0, 0);
  await Promise.all(
    ["a", "b", "c"].map((session) =>
      core.handle(session, encodeSubscribe([id])),
    ),
  );
  await flush();
  const commands = [
    core.handle(
      "a",
      encodeExplore({ key: key(1), tileIndex: tile, ruleVersion: 0 }),
    ),
    core.handle(
      "b",
      encodeExplore({ key: key(2), tileIndex: tile, ruleVersion: 0 }),
    ),
  ];
  await Promise.all(commands);
  await core.handle(
    "a",
    encodeExplore({ key: key(1), tileIndex: tile, ruleVersion: 0 }),
  );
  await flush();
  assert.equal(world.maskAt(tile), 1);
  assert.equal(world.chunkRevision(0, 0), 1n);
  const frames = (session: string) =>
    sent[session]!.map((bytes) => decodeFrame(bytes));
  const acksA = frames("a")
    .filter((frame) => frame.kind === M2_KIND.ACK)
    .map((frame) => decodeAck(frame.payload));
  const acksB = frames("b")
    .filter((frame) => frame.kind === M2_KIND.ACK)
    .map((frame) => decodeAck(frame.payload));
  assert.deepEqual(
    acksA.map((ack) => ack.status),
    [ACK_STATUS.TEST_APPLIED, ACK_STATUS.TEST_APPLIED],
  );
  assert.deepEqual(
    acksB.map((ack) => ack.status),
    [ACK_STATUS.TEST_NO_CHANGE],
  );
  assert.equal(
    frames("c").filter((frame) => frame.kind === M2_KIND.DELTA).length,
    0,
  );
  for (const session of ["a", "b"] as const) {
    const replica = new ProjectionReplica(0);
    for (const frame of frames(session)) {
      if (frame.kind === M2_KIND.SNAPSHOT)
        replica.applySnapshot(decodeSnapshot(frame.payload));
      if (frame.kind === M2_KIND.DELTA)
        assert.equal(replica.applyDelta(decodeDelta(frame.payload)), "applied");
    }
    assert.equal(replica.maskAt(id, localIndex(7, 8)), 1);
    assert.equal(replica.isDiscovered(id, localIndex(7, 8)), true);
  }
  const rival = new ProjectionReplica(15);
  for (const frame of frames("c"))
    if (frame.kind === M2_KIND.SNAPSHOT)
      rival.applySnapshot(decodeSnapshot(frame.payload));
  assert.equal(rival.maskAt(id, localIndex(7, 8)), 0);
});

test("idempotency conflict and production mutation fail closed", async () => {
  const world = new WorldState(registry());
  const core = new RealtimeCore(world);
  const sent: Uint8Array[] = [];
  core.addSession(
    "a",
    { actorId: "same-actor", schoolSlot: 0 },
    {
      send: (bytes) => {
        sent.push(bytes);
      },
      close: () => {},
    },
  );
  await core.handle(
    "a",
    encodeExplore({ key: key(9), tileIndex: 0, ruleVersion: 0 }),
  );
  await core.handle(
    "a",
    encodeExplore({ key: key(9), tileIndex: 1, ruleVersion: 0 }),
  );
  await core.handle(
    "a",
    encodeFrame(M2_KIND.PRODUCTION_MUTATION, new Uint8Array()),
  );
  await flush();
  assert.equal(world.maskAt(0), 1);
  assert.equal(world.maskAt(1), 0);
  assert.equal(core.idempotencyRecords, 1);
  const frames = sent.map((bytes) => decodeFrame(bytes));
  const acks = frames
    .filter((frame) => frame.kind === M2_KIND.ACK)
    .map((frame) => decodeAck(frame.payload));
  assert.equal(acks[1]?.status, ACK_STATUS.REJECTED);
  assert.equal(acks[1]?.reason, REASON.IDEMPOTENCY_CONFLICT);
  assert.deepEqual(
    frames
      .filter((frame) => frame.kind === M2_KIND.ERROR)
      .map((frame) => decodeError(frame.payload)),
    [REASON.PRODUCTION_DISABLED],
  );
});

test("subscription replacement cancels queued stale snapshot and reconnect gets current state", async () => {
  const world = new WorldState(registry());
  const core = new RealtimeCore(world);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: Uint8Array[] = [];
  core.addSession(
    "old",
    { actorId: "actor", schoolSlot: 0 },
    {
      send: async (bytes) => {
        if (sent.length === 0) await gate;
        sent.push(bytes);
      },
      close: () => {},
    },
  );
  await core.handle("old", encodeSubscribe([0]));
  await core.handle("old", encodeSubscribe([]));
  release();
  await flush();
  assert.equal(
    sent.some((bytes) => decodeFrame(bytes).kind === M2_KIND.SNAPSHOT),
    false,
  );
  core.removeSession("old");
  await core.handle(
    "old",
    encodeExplore({ key: key(4), tileIndex: 0, ruleVersion: 0 }),
  );
  world.setPresence(0, 0, true);
  const resumed: Uint8Array[] = [];
  core.addSession(
    "new",
    { actorId: "actor", schoolSlot: 0 },
    {
      send: (bytes) => {
        resumed.push(bytes);
      },
      close: () => {},
    },
  );
  await core.handle("new", encodeSubscribe([0]));
  await flush();
  const snapshot = resumed
    .map((bytes) => decodeFrame(bytes))
    .find((frame) => frame.kind === M2_KIND.SNAPSHOT);
  assert.ok(snapshot);
  const replica = new ProjectionReplica(0);
  replica.applySnapshot(decodeSnapshot(snapshot.payload));
  assert.equal(replica.maskAt(0, 0), 1);
});

test("slow outbound sink is closed at a bounded queue and invalid commands are rejected", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed: string[] = [];
  const queue = new OutboundQueue(
    {
      send: () => gate,
      close: (reason) => {
        closed.push(reason);
      },
    },
    new RealtimeMetrics(),
    2,
    100,
  );
  assert.equal(queue.enqueue(Uint8Array.of(1)), true);
  await flush();
  assert.equal(queue.enqueue(Uint8Array.of(2)), true);
  assert.equal(queue.enqueue(Uint8Array.of(3)), true);
  assert.equal(queue.enqueue(Uint8Array.of(4)), false);
  assert.deepEqual(closed, ["slow_client"]);
  release();
  const core = new RealtimeCore(new WorldState(registry()));
  const sent: Uint8Array[] = [];
  core.addSession(
    "a",
    { actorId: "a", schoolSlot: 0 },
    {
      send: (bytes) => {
        sent.push(bytes);
      },
      close: () => {},
    },
  );
  await core.handle("a", Uint8Array.of(1, 2, 3));
  await core.handle("a", encodeFrame(M2_KIND.RESYNC, Uint8Array.of(0, 0)));
  await flush();
  assert.deepEqual(
    sent
      .map((bytes) => decodeFrame(bytes))
      .filter((frame) => frame.kind === M2_KIND.ERROR)
      .map((frame) => decodeError(frame.payload)),
    [REASON.INVALID_FRAME, REASON.NOT_SUBSCRIBED],
  );
});

test("hot chunk and four sectors serialize 800 concurrent synthetic writes without loss", async () => {
  const world = new WorldState(registry());
  const core = new RealtimeCore(world);
  const tiles: number[] = [];
  for (let i = 0; i < 800; i++) {
    const sector = i % 4;
    const baseX = (sector % 2) * 256;
    const baseZ = Math.floor(sector / 2) * 256;
    const tile = tileIndex(baseX + (i % 50), baseZ + Math.floor(i / 50));
    tiles.push(tile);
    core.addSession(
      `s${i}`,
      { actorId: `a${i}`, schoolSlot: 0 },
      { send: () => {}, close: () => {} },
    );
  }
  await Promise.all(
    tiles.map((tile, i) =>
      core.handle(
        `s${i}`,
        encodeExplore({ key: key(i), tileIndex: tile, ruleVersion: 0 }),
      ),
    ),
  );
  assert.equal(new Set(tiles).size, 800);
  for (const tile of tiles) assert.equal(world.maskAt(tile), 1);
  assert.equal(core.metrics.snapshot().counters.actions_applied, 800);
  assert.ok(core.queueDepths.every((depth) => depth === 0));
});
