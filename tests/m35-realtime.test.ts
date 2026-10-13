import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { type Room as ClientRoom, ColyseusSDK } from "@colyseus/sdk";
import { Pool } from "pg";
import { M35FixtureAuthority } from "../server/persistence/M35FixtureAuthority.ts";
import { createDurableSyntheticServer } from "../server/realtime/durableBootstrap.ts";
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
  REASON,
} from "../shared/protocol/m2.ts";
import { ProjectionReplica } from "../shared/protocol/replica.ts";
import { tileIndex } from "../shared/world/coordinates.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";

const url = process.env.R2PL_TEST_DATABASE_URL;
const key = (n: number): Uint8Array => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
};
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

class Peer {
  readonly room: ClientRoom;
  readonly frames: Frame[] = [];
  constructor(room: ClientRoom) {
    this.room = room;
    room.onMessage("m2", (raw: Uint8Array) =>
      this.frames.push(decodeFrame(Uint8Array.from(raw))),
    );
  }
  send(bytes: Uint8Array): void {
    this.room.sendBytes("m2", bytes);
  }
  async wait(kind: number, after = 0): Promise<Frame> {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const frame = this.frames.slice(after).find((item) => item.kind === kind);
      if (frame) return frame;
      await pause(5);
    }
    throw new Error(`Timed out waiting for frame ${kind}`);
  }
  async ack(
    actionKey: Uint8Array,
    after = 0,
  ): Promise<ReturnType<typeof decodeAck>> {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      for (const frame of this.frames.slice(after))
        if (frame.kind === M2_KIND.ACK) {
          const ack = decodeAck(frame.payload);
          if (hex(ack.key) === hex(actionKey)) return ack;
        }
      await pause(5);
    }
    throw new Error("Timed out waiting for keyed ACK");
  }
}

test("M3.5 network ACK, outbox delta, school isolation and restart retry", {
  skip:
    !url && "Set R2PL_TEST_DATABASE_URL to a disposable PostgreSQL database",
  timeout: 45_000,
}, async () => {
  const pool = new Pool({
    connectionString: url,
    max: 12,
    options: "-c search_path=r2pl_v2,public",
  });
  const campaignId = randomUUID();
  const a = randomUUID(),
    b = randomUUID(),
    c = randomUUID();
  const registry = new SchoolRegistry([
    { id: "fixture-a", slot: 0 },
    { id: "fixture-b", slot: 15 },
  ]);
  const identities = [
    { token: "m35-a", actorId: a, schoolSlot: 0 },
    { token: "m35-b", actorId: b, schoolSlot: 0 },
    { token: "m35-c", actorId: c, schoolSlot: 15 },
  ];
  let fixture:
    | Awaited<ReturnType<typeof createDurableSyntheticServer>>
    | undefined;
  const peers: Peer[] = [];
  try {
    await pool.query(
      "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaignId, `m35-${campaignId}`],
    );
    await pool.query(
      "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-a',0),($1,'fixture-b',15)",
      [campaignId],
    );
    for (const actor of [a, b, c])
      await pool.query(
        "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',20,20)",
        [campaignId, actor],
      );
    fixture = await createDurableSyntheticServer(
      pool,
      campaignId,
      registry,
      identities,
      3n,
    );
    await fixture.server.listen(0, "127.0.0.1");
    const address = fixture.transport.server?.address();
    if (!address || typeof address === "string")
      throw new Error("Missing loopback port");
    const sdk = new ColyseusSDK(`ws://127.0.0.1:${address.port}`);
    const ra = await sdk.joinOrCreate("m2", { token: "m35-a" });
    const rb = await sdk.joinById(ra.roomId, { token: "m35-b" });
    const rc = await sdk.joinById(ra.roomId, { token: "m35-c" });
    const pa = new Peer(ra),
      pb = new Peer(rb),
      pc = new Peer(rc);
    peers.push(pa, pb, pc);
    for (const peer of peers) peer.send(encodeSubscribe([0]));
    const replicas = [
      new ProjectionReplica(0),
      new ProjectionReplica(0),
      new ProjectionReplica(15),
    ];
    for (let i = 0; i < peers.length; i++)
      replicas[i]!.applySnapshot(
        decodeSnapshot((await peers[i]!.wait(M2_KIND.SNAPSHOT)).payload),
      );

    const firstTile = tileIndex(3, 4);
    const firstKey = key(1);
    pa.send(
      encodeExplore({ key: firstKey, tileIndex: firstTile, ruleVersion: 0 }),
    );
    const firstAck = await pa.ack(firstKey);
    assert.equal(firstAck.status, ACK_STATUS.TEST_APPLIED);
    assert.equal(firstAck.viewRevision, 1n);
    const durable = await pool.query<{ balance: string }>(
      "SELECT balance FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2",
      [campaignId, a],
    );
    assert.equal(
      durable.rows[0]?.balance,
      "17",
      "client ACK followed the durable debit",
    );
    for (let i = 0; i < 2; i++) {
      const delta = decodeDelta((await peers[i]!.wait(M2_KIND.DELTA)).payload);
      assert.equal(replicas[i]!.applyDelta(delta), "applied");
      assert.equal(delta.mask, 1);
    }
    assert.equal(
      pc.frames.some((frame) => frame.kind === M2_KIND.DELTA),
      false,
    );

    const beforeDuplicate = pa.frames.length;
    pa.send(
      encodeExplore({ key: firstKey, tileIndex: firstTile, ruleVersion: 0 }),
    );
    assert.deepEqual(await pa.ack(firstKey, beforeDuplicate), firstAck);
    const count = await pool.query<{ ledger: string; events: string }>(
      "SELECT (SELECT count(*) FROM ledger_entries WHERE campaign_id=$1)::text AS ledger,(SELECT count(*) FROM outbox_events WHERE campaign_id=$1)::text AS events",
      [campaignId],
    );
    assert.deepEqual(count.rows[0], { ledger: "1", events: "1" });
    const beforeConflict = pa.frames.length;
    pa.send(
      encodeExplore({
        key: firstKey,
        tileIndex: tileIndex(4, 4),
        ruleVersion: 0,
      }),
    );
    const conflict = await pa.ack(firstKey, beforeConflict);
    assert.equal(conflict.status, ACK_STATUS.REJECTED);
    assert.equal(conflict.reason, REASON.IDEMPOTENCY_CONFLICT);

    const otherKey = key(2);
    pb.send(
      encodeExplore({ key: otherKey, tileIndex: firstTile, ruleVersion: 0 }),
    );
    assert.equal((await pb.ack(otherKey)).status, ACK_STATUS.TEST_NO_CHANGE);
    const hiddenKey = key(3);
    pc.send(
      encodeExplore({ key: hiddenKey, tileIndex: firstTile, ruleVersion: 0 }),
    );
    assert.equal((await pc.ack(hiddenKey)).viewRevision, 1n);
    const hiddenDelta = decodeDelta((await pc.wait(M2_KIND.DELTA)).payload);
    assert.equal(hiddenDelta.mask, 0x8000);
    assert.equal(replicas[2]!.applyDelta(hiddenDelta), "applied");
    assert.equal(
      pa.frames.filter((frame) => frame.kind === M2_KIND.DELTA).length,
      1,
    );

    const beforeResync = pa.frames.length;
    pa.send(encodeResync(0));
    const resynced = decodeSnapshot(
      (await pa.wait(M2_KIND.SNAPSHOT, beforeResync)).payload,
    );
    assert.equal(resynced.viewRevision, 1n);
    replicas[0]!.applySnapshot(resynced);
    assert.equal(replicas[0]!.maskAt(0, 3 + 4 * 64), 1);
    assert.equal(replicas[2]!.maskAt(0, 3 + 4 * 64), 0x8000);

    await Promise.allSettled(peers.map((peer) => peer.room.leave()));
    peers.length = 0;
    fixture.core.stopRelay();
    await fixture.server.gracefullyShutdown(false);
    fixture = await createDurableSyntheticServer(
      pool,
      campaignId,
      registry,
      identities,
      3n,
    );
    await fixture.server.listen(0, "127.0.0.1");
    const restarted = fixture.transport.server?.address();
    if (!restarted || typeof restarted === "string")
      throw new Error("Missing restart port");
    const nextSdk = new ColyseusSDK(`ws://127.0.0.1:${restarted.port}`);
    const rejoined = new Peer(
      await nextSdk.joinOrCreate("m2", { token: "m35-a" }),
    );
    peers.push(rejoined);
    rejoined.send(encodeSubscribe([0]));
    const recovered = decodeSnapshot(
      (await rejoined.wait(M2_KIND.SNAPSHOT)).payload,
    );
    assert.equal(recovered.viewRevision, 1n);
    const recoveredReplica = new ProjectionReplica(0);
    recoveredReplica.applySnapshot(recovered);
    assert.equal(recoveredReplica.maskAt(0, 3 + 4 * 64), 1);
    const beforeRetry = rejoined.frames.length;
    rejoined.send(
      encodeExplore({ key: firstKey, tileIndex: firstTile, ruleVersion: 0 }),
    );
    assert.deepEqual(await rejoined.ack(firstKey, beforeRetry), firstAck);
    const afterRestart = await pool.query<{ ledger: string; events: string }>(
      "SELECT (SELECT count(*) FROM ledger_entries WHERE campaign_id=$1)::text AS ledger,(SELECT count(*) FROM outbox_events WHERE campaign_id=$1)::text AS events",
      [campaignId],
    );
    assert.deepEqual(afterRestart.rows[0], { ledger: "2", events: "2" });
  } finally {
    await Promise.allSettled(peers.map((peer) => peer.room.leave()));
    fixture?.core.stopRelay();
    if (fixture) await fixture.server.gracefullyShutdown(false);
    await pool.end();
  }
});

test("M3.5 concurrent wallet and hot-chunk commands keep contiguous school views", {
  skip:
    !url && "Set R2PL_TEST_DATABASE_URL to a disposable PostgreSQL database",
  timeout: 30_000,
}, async () => {
  const pool = new Pool({
    connectionString: url,
    // QA Supavisor Session pooler allows 15 sessions; keep headroom for relays.
    // Still exercises 30 concurrent writes queued through eight DB clients.
    max: 8,
    options: "-c search_path=r2pl_v2,public",
  });
  const campaignId = randomUUID(),
    actorId = randomUUID();
  try {
    await pool.query(
      "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaignId, `m35-hot-${campaignId}`],
    );
    await pool.query(
      "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-a',0)",
      [campaignId],
    );
    await pool.query(
      "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',100,100)",
      [campaignId, actorId],
    );
    const authority = new M35FixtureAuthority(pool, campaignId, 1n);
    await authority.validateCampaign(
      new SchoolRegistry([{ id: "fixture-a", slot: 0 }]),
    );
    const writes = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        authority.apply(actorId, 0, key(1000 + i), tileIndex(10 + i, 10)),
      ),
    );
    assert(writes.every((outcome) => outcome.result.status === "test_applied"));
    assert.deepEqual(
      writes
        .map((outcome) => Number(outcome.result.viewRevision))
        .sort((a, b) => a - b),
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    const sameTile = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        authority.apply(actorId, 0, key(2000 + i), tileIndex(10, 10)),
      ),
    );
    assert(
      sameTile.every((outcome) => outcome.result.status === "test_no_change"),
    );
    const state = await pool.query<{
      balance: string;
      view_revision: string;
      ledger: string;
      outbox: string;
    }>(
      "SELECT w.balance,v.view_revision,(SELECT count(*)::text FROM ledger_entries WHERE campaign_id=$1) AS ledger,(SELECT count(*)::text FROM outbox_events WHERE campaign_id=$1) AS outbox FROM wallet_accounts w JOIN school_chunk_views v ON v.campaign_id=w.campaign_id WHERE w.campaign_id=$1 AND w.actor_id=$2",
      [campaignId, actorId],
    );
    assert.deepEqual(state.rows[0], {
      balance: "70",
      view_revision: "30",
      ledger: "30",
      outbox: "30",
    });
  } finally {
    await pool.end();
  }
});

test("M3.5 quarantines malformed outbox projection after subscriber recovery", {
  skip:
    !url && "Set R2PL_TEST_DATABASE_URL to a disposable PostgreSQL database",
  timeout: 20_000,
}, async () => {
  const pool = new Pool({
    connectionString: url,
    max: 6,
    options: "-c search_path=r2pl_v2,public",
  });
  const campaignId = randomUUID(),
    actorId = randomUUID();
  try {
    await pool.query(
      "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaignId, `m35-poison-${campaignId}`],
    );
    await pool.query(
      "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-a',0)",
      [campaignId],
    );
    await pool.query(
      "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',10,10)",
      [campaignId, actorId],
    );
    const authority = new M35FixtureAuthority(pool, campaignId, 1n);
    await authority.validateCampaign(
      new SchoolRegistry([{ id: "fixture-a", slot: 0 }]),
    );
    const outcome = await authority.apply(
      actorId,
      0,
      key(4001),
      tileIndex(1, 1),
    );
    assert(outcome.outboxId);
    await pool.query(
      "UPDATE outbox_events SET payload='{}'::jsonb WHERE id=$1",
      [outcome.outboxId],
    );
    let recovered = 0,
      published = 0;
    assert.equal(
      await authority.drain(
        async () => {
          published++;
        },
        async () => {
          recovered++;
        },
      ),
      0,
    );
    assert.equal(recovered, 1);
    assert.equal(published, 0);
    const dead = await pool.query<{ reason: string; delivered: boolean }>(
      "SELECT d.reason,(o.delivered_at IS NOT NULL) AS delivered FROM outbox_dead_letters d JOIN outbox_events o ON o.id=d.event_id WHERE d.event_id=$1",
      [outcome.outboxId],
    );
    assert.deepEqual(dead.rows[0], {
      reason: "invalid_projection",
      delivered: true,
    });
    const snapshot = await authority.snapshot(0, 0);
    assert.equal(snapshot.viewRevision, 1n);
    assert.equal(new DataView(snapshot.mask.buffer).getUint16(65 * 2, true), 1);
    assert.equal(
      await authority.drain(
        async () => {
          published++;
        },
        async () => {
          recovered++;
        },
      ),
      0,
    );
  } finally {
    await pool.end();
  }
});

test("M3.5 process termination after commit replays the same ACK on retry", {
  skip:
    !url && "Set R2PL_TEST_DATABASE_URL to a disposable PostgreSQL database",
  timeout: 30_000,
}, async () => {
  const pool = new Pool({
    connectionString: url,
    max: 6,
    options: "-c search_path=r2pl_v2,public",
  });
  const campaignId = randomUUID(),
    actorId = randomUUID();
  const registry = new SchoolRegistry([{ id: "fixture-a", slot: 0 }]);
  const identity = [{ token: "m35-crash-token", actorId, schoolSlot: 0 }];
  let child: ChildProcess | undefined;
  let fixture:
    | Awaited<ReturnType<typeof createDurableSyntheticServer>>
    | undefined;
  let rejoined: Peer | undefined;
  try {
    await pool.query(
      "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaignId, `m35-crash-${campaignId}`],
    );
    await pool.query(
      "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-a',0)",
      [campaignId],
    );
    await pool.query(
      "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',10,10)",
      [campaignId, actorId],
    );
    child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        fileURLToPath(
          new URL("../scripts/m35-crash-child.ts", import.meta.url),
        ),
        campaignId,
        actorId,
      ],
      { env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Crash child startup timeout")),
        7000,
      );
      child!.on("message", (message) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "port" in message
        ) {
          clearTimeout(timer);
          resolve(Number(message.port));
        }
      });
      child!.once("error", reject);
      child!.once("exit", (code) =>
        reject(new Error(`Child exited before ready: ${code}`)),
      );
    });
    const sdk = new ColyseusSDK(`ws://127.0.0.1:${port}`);
    const peer = new Peer(
      await sdk.joinOrCreate("m2", { token: "m35-crash-token" }),
    );
    peer.send(encodeSubscribe([0]));
    await peer.wait(M2_KIND.SNAPSHOT);
    const commandKey = key(555);
    const target = tileIndex(8, 8);
    peer.send(
      encodeExplore({ key: commandKey, tileIndex: target, ruleVersion: 0 }),
    );
    const exitCode =
      child.exitCode ??
      (await new Promise<number | null>((resolve) =>
        child!.once("exit", resolve),
      ));
    assert.equal(exitCode, 42);
    assert.equal(
      peer.frames.some((frame) => frame.kind === M2_KIND.ACK),
      false,
    );
    const committed = await pool.query<{ balance: string; status: string }>(
      "SELECT w.balance,c.status FROM wallet_accounts w JOIN command_results c ON c.campaign_id=w.campaign_id AND c.actor_id=w.actor_id WHERE w.campaign_id=$1 AND w.actor_id=$2",
      [campaignId, actorId],
    );
    assert.deepEqual(committed.rows[0], {
      balance: "7",
      status: "test_applied",
    });

    fixture = await createDurableSyntheticServer(
      pool,
      campaignId,
      registry,
      identity,
      3n,
    );
    await fixture.server.listen(0, "127.0.0.1");
    const address = fixture.transport.server?.address();
    if (!address || typeof address === "string")
      throw new Error("Missing restart port");
    const nextSdk = new ColyseusSDK(`ws://127.0.0.1:${address.port}`);
    rejoined = new Peer(
      await nextSdk.joinOrCreate("m2", { token: "m35-crash-token" }),
    );
    rejoined.send(encodeSubscribe([0]));
    const snapshot = decodeSnapshot(
      (await rejoined.wait(M2_KIND.SNAPSHOT)).payload,
    );
    assert.equal(snapshot.viewRevision, 1n);
    rejoined.send(
      encodeExplore({ key: commandKey, tileIndex: target, ruleVersion: 0 }),
    );
    const replay = await rejoined.ack(commandKey);
    assert.equal(replay.status, ACK_STATUS.TEST_APPLIED);
    assert.equal(replay.viewRevision, 1n);
    const counts = await pool.query<{ ledger: string; events: string }>(
      "SELECT (SELECT count(*) FROM ledger_entries WHERE campaign_id=$1)::text AS ledger,(SELECT count(*) FROM outbox_events WHERE campaign_id=$1)::text AS events",
      [campaignId],
    );
    assert.deepEqual(counts.rows[0], { ledger: "1", events: "1" });
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (rejoined) await Promise.allSettled([rejoined.room.leave()]);
    fixture?.core.stopRelay();
    if (fixture) await fixture.server.gracefullyShutdown(false);
    await pool.end();
  }
});
