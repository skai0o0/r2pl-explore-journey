import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { M35FixtureAuthority } from "../server/persistence/M35FixtureAuthority.ts";
import { DurableRealtimeCore } from "../server/realtime/DurableRealtimeCore.ts";
import {
  decodeFrame,
  decodeSnapshot,
  encodeResync,
  encodeSubscribe,
  M2_KIND,
} from "../shared/protocol/m2.ts";
import { tileIndex } from "../shared/world/coordinates.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";

const url = process.env.R2PL_TEST_DATABASE_URL;
const actionKey = (n: number): Uint8Array => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
};

test("M3.6 relay backlog survives authority replacement and burst resync stays school isolated", {
  skip:
    !url && "Set R2PL_TEST_DATABASE_URL to a disposable PostgreSQL database",
  timeout: 30_000,
}, async () => {
  const pool = new Pool({
    connectionString: url,
    max: 8,
    options: "-c search_path=r2pl_v2,public",
  });
  const campaignId = randomUUID();
  const actorId = randomUUID();
  const registry = new SchoolRegistry([
    { id: "fixture-a", slot: 0 },
    { id: "fixture-b", slot: 15 },
  ]);
  try {
    await pool.query(
      "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaignId, `m36-${campaignId}`],
    );
    await pool.query(
      "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-a',0),($1,'fixture-b',15)",
      [campaignId],
    );
    await pool.query(
      "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',20,20)",
      [campaignId, actorId],
    );
    const authority = new M35FixtureAuthority(pool, campaignId, 1n);
    await authority.validateCampaign(registry);
    for (let n = 0; n < 3; n++) {
      const outcome = await authority.apply(
        actorId,
        0,
        actionKey(n),
        tileIndex(n + 1, 1),
      );
      assert.equal(outcome.result.status, "test_applied");
    }
    const pending = await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM outbox_events WHERE campaign_id=$1 AND delivered_at IS NULL",
      [campaignId],
    );
    assert.equal(pending.rows[0]?.count, "3");

    // New authority/core stand in for a restarted process before publication.
    const restarted = new DurableRealtimeCore(
      new M35FixtureAuthority(pool, campaignId, 1n),
    );
    const own: Uint8Array[] = [];
    const other: Uint8Array[] = [];
    restarted.addSession(
      "own",
      { actorId, schoolSlot: 0 },
      {
        send: (bytes) => {
          own.push(bytes);
        },
        close: () => {},
      },
    );
    restarted.addSession(
      "other",
      { actorId: randomUUID(), schoolSlot: 15 },
      {
        send: (bytes) => {
          other.push(bytes);
        },
        close: () => {},
      },
    );
    await restarted.handle("own", encodeSubscribe([0]));
    await restarted.handle("other", encodeSubscribe([0]));
    const delivered = await restarted.drainOutbox();
    assert.equal(delivered, 3);
    assert.equal(await restarted.drainOutbox(), 0);
    for (let n = 0; n < 10; n++) await restarted.handle("own", encodeResync(0));
    await new Promise((resolve) => setImmediate(resolve));
    const ownSnapshots = own
      .map((bytes) => decodeFrame(bytes))
      .filter((frame) => frame.kind === M2_KIND.SNAPSHOT)
      .map((frame) => decodeSnapshot(frame.payload));
    assert.equal(ownSnapshots.length, 11);
    assert(ownSnapshots.every((snapshot) => snapshot.viewRevision === 3n));
    const otherSnapshot = other
      .map((bytes) => decodeFrame(bytes))
      .find((frame) => frame.kind === M2_KIND.SNAPSHOT);
    assert(otherSnapshot);
    const isolated = decodeSnapshot(otherSnapshot.payload);
    assert.equal(isolated.viewRevision, 0n);
    assert(isolated.mask.every((value) => value === 0));
    assert.equal(
      other.some((bytes) => decodeFrame(bytes).kind === M2_KIND.DELTA),
      false,
    );
    const final = await pool.query<{
      balance: string;
      ledger: string;
      pending: string;
    }>(
      "SELECT (SELECT balance::text FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2) AS balance,(SELECT count(*)::text FROM ledger_entries WHERE campaign_id=$1) AS ledger,(SELECT count(*)::text FROM outbox_events WHERE campaign_id=$1 AND delivered_at IS NULL) AS pending",
      [campaignId, actorId],
    );
    assert.deepEqual(final.rows[0], {
      balance: "17",
      ledger: "3",
      pending: "0",
    });
    restarted.removeSession("own");
    restarted.removeSession("other");
  } finally {
    await pool.end();
  }
});

test("M3.6 slow subscriber closes at a bounded backlog while healthy subscriber catches up", {
  skip:
    !url && "Set R2PL_TEST_DATABASE_URL to a disposable PostgreSQL database",
  timeout: 30_000,
}, async () => {
  const pool = new Pool({
    connectionString: url,
    max: 8,
    options: "-c search_path=r2pl_v2,public",
  });
  const campaignId = randomUUID();
  const actorId = randomUUID();
  let releaseBlockedSend: (() => void) | undefined;
  const blockedSend = new Promise<void>((resolve) => {
    releaseBlockedSend = resolve;
  });
  try {
    await pool.query(
      "INSERT INTO campaigns(id,code,write_strategy) VALUES($1,$2,'full_chunk')",
      [campaignId, `m36-slow-${campaignId}`],
    );
    await pool.query(
      "INSERT INTO campaign_schools(campaign_id,school_id,slot) VALUES($1,'fixture-a',0)",
      [campaignId],
    );
    await pool.query(
      "INSERT INTO wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,'fixture-credit',20,20)",
      [campaignId, actorId],
    );
    const authority = new M35FixtureAuthority(pool, campaignId, 1n);
    const core = new DurableRealtimeCore(authority, {
      maxOutboundFrames: 4,
    });
    let slowClosed = false;
    const healthy: Uint8Array[] = [];
    core.addSession(
      "slow",
      { actorId: randomUUID(), schoolSlot: 0 },
      {
        send: () => blockedSend,
        close: () => {
          slowClosed = true;
        },
      },
    );
    core.addSession(
      "healthy",
      { actorId, schoolSlot: 0 },
      {
        send: (bytes) => {
          healthy.push(bytes);
        },
        close: () => {},
      },
    );
    await core.handle("slow", encodeSubscribe([0]));
    await core.handle("healthy", encodeSubscribe([0]));
    for (let n = 0; n < 8; n++)
      assert.equal(
        (
          await authority.apply(
            actorId,
            0,
            actionKey(n + 100),
            tileIndex(n + 1, 2),
          )
        ).result.status,
        "test_applied",
      );
    assert.equal(await core.drainOutbox(), 8);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(slowClosed, true);
    const deltas = healthy
      .map((bytes) => decodeFrame(bytes))
      .filter((frame) => frame.kind === M2_KIND.DELTA);
    assert.equal(deltas.length, 8);
    assert.equal(await core.drainOutbox(), 0);
    const pending = await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM outbox_events WHERE campaign_id=$1 AND delivered_at IS NULL",
      [campaignId],
    );
    assert.equal(pending.rows[0]?.count, "0");
    core.removeSession("slow");
    core.removeSession("healthy");
  } finally {
    releaseBlockedSend?.();
    await pool.end();
  }
});
