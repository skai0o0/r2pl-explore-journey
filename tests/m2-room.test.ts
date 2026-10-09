import assert from "node:assert/strict";
import test from "node:test";
import { type Room as ClientRoom, ColyseusSDK } from "@colyseus/sdk";
import { createSyntheticServer } from "../server/realtime/bootstrap.ts";
import {
  ACK_STATUS,
  decodeAck,
  decodeDelta,
  decodeFrame,
  decodeSnapshot,
  encodeExplore,
  encodeResync,
  encodeSubscribe,
  type Frame,
  M2_KIND,
} from "../shared/protocol/m2.ts";
import { ProjectionReplica } from "../shared/protocol/replica.ts";
import { chunkId, localIndex, tileIndex } from "../shared/world/coordinates.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";

const key = (value: number) =>
  Uint8Array.from({ length: 16 }, (_, i) => (value + i) & 255);
class Peer {
  readonly room: ClientRoom;
  readonly frames: Frame[] = [];
  constructor(room: ClientRoom) {
    this.room = room;
    room.onMessage("m2", (bytes: Uint8Array) =>
      this.frames.push(decodeFrame(Uint8Array.from(bytes))),
    );
  }
  send(bytes: Uint8Array): void {
    this.room.sendBytes("m2", bytes);
  }
  async wait(kind: number, after = 0): Promise<Frame> {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const frame = this.frames
        .slice(after)
        .find((candidate) => candidate.kind === kind);
      if (frame) return frame;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for M2 frame ${kind}`);
  }
}

test("Colyseus clients converge, isolate schools, and recover after reconnect", {
  timeout: 15_000,
}, async () => {
  const registry = new SchoolRegistry([
    { id: "fixture-a", slot: 0 },
    { id: "fixture-b", slot: 15 },
  ]);
  const fixture = createSyntheticServer(registry, [
    { token: "test-token-a", actorId: "a", schoolSlot: 0 },
    { token: "test-token-b", actorId: "b", schoolSlot: 0 },
    { token: "test-token-c", actorId: "c", schoolSlot: 15 },
  ]);
  const peers: Peer[] = [];
  try {
    await fixture.server.listen(0, "127.0.0.1");
    const address = fixture.transport.server?.address();
    if (!address || typeof address === "string")
      throw new Error("Missing loopback port");
    const sdk = new ColyseusSDK(`ws://127.0.0.1:${address.port}`);
    const [a, b, c] = await Promise.all([
      sdk.joinOrCreate("m2", { token: "test-token-a" }),
      sdk.joinOrCreate("m2", { token: "test-token-b" }),
      sdk.joinOrCreate("m2", { token: "test-token-c" }),
    ]);
    const pa = new Peer(a),
      pb = new Peer(b),
      pc = new Peer(c);
    peers.push(pa, pb, pc);
    assert.equal(fixture.core.connected, 3);
    const id = chunkId(0, 0),
      first = tileIndex(3, 4),
      second = tileIndex(4, 4);
    for (const peer of peers) peer.send(encodeSubscribe([id]));
    const snapshots = await Promise.all(
      peers.map((peer) => peer.wait(M2_KIND.SNAPSHOT)),
    );
    const replicas = [
      new ProjectionReplica(0),
      new ProjectionReplica(0),
      new ProjectionReplica(15),
    ];
    snapshots.forEach((frame, i) => {
      replicas[i]!.applySnapshot(decodeSnapshot(frame.payload));
    });
    pa.send(encodeExplore({ key: key(1), tileIndex: first, ruleVersion: 0 }));
    pb.send(encodeExplore({ key: key(2), tileIndex: first, ruleVersion: 0 }));
    const [ackA, ackB, deltaA, deltaB] = await Promise.all([
      pa.wait(M2_KIND.ACK),
      pb.wait(M2_KIND.ACK),
      pa.wait(M2_KIND.DELTA),
      pb.wait(M2_KIND.DELTA),
    ]);
    assert.deepEqual(
      new Set([decodeAck(ackA.payload).status, decodeAck(ackB.payload).status]),
      new Set([ACK_STATUS.TEST_APPLIED, ACK_STATUS.TEST_NO_CHANGE]),
    );
    assert.equal(
      replicas[0]!.applyDelta(decodeDelta(deltaA.payload)),
      "applied",
    );
    assert.equal(
      replicas[1]!.applyDelta(decodeDelta(deltaB.payload)),
      "applied",
    );
    assert.equal(replicas[0]!.maskAt(id, localIndex(3, 4)), 1);
    assert.equal(replicas[1]!.maskAt(id, localIndex(3, 4)), 1);
    assert.equal(replicas[2]!.maskAt(id, localIndex(3, 4)), 0);
    assert.equal(
      pc.frames.some((frame) => frame.kind === M2_KIND.DELTA),
      false,
    );

    await a.leave();
    peers.splice(peers.indexOf(pa), 1);
    const beforeSecond = pb.frames.length;
    pb.send(encodeExplore({ key: key(3), tileIndex: second, ruleVersion: 0 }));
    const next = await pb.wait(M2_KIND.DELTA, beforeSecond);
    assert.equal(replicas[1]!.applyDelta(decodeDelta(next.payload)), "applied");
    const rejoined = new Peer(
      await sdk.joinOrCreate("m2", { token: "test-token-a" }),
    );
    peers.push(rejoined);
    rejoined.send(encodeSubscribe([id]));
    const recovered = decodeSnapshot(
      (await rejoined.wait(M2_KIND.SNAPSHOT)).payload,
    );
    const recoveredReplica = new ProjectionReplica(0);
    recoveredReplica.applySnapshot(recovered);
    assert.equal(recoveredReplica.revision(id), 2n);
    assert.equal(recoveredReplica.maskAt(id, localIndex(3, 4)), 1);
    assert.equal(recoveredReplica.maskAt(id, localIndex(4, 4)), 1);
    const beforeResync = rejoined.frames.length;
    rejoined.send(encodeResync(id));
    assert.equal(
      decodeSnapshot(
        (await rejoined.wait(M2_KIND.SNAPSHOT, beforeResync)).payload,
      ).viewRevision,
      2n,
    );
    assert.equal(fixture.core.world.maskAt(first), 1);
    assert.equal(fixture.core.world.maskAt(second), 1);
  } finally {
    await Promise.allSettled(peers.map((peer) => peer.room.leave()));
    await fixture.server.gracefullyShutdown(false);
  }
});
