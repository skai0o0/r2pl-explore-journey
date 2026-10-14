import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DevRewardClient } from "../client/src/rewardClient.ts";
import {
  parseDevInventory,
  parsePrivateRewardPage,
  parseRewardCatalog,
  parseRewardReceipt,
} from "../shared/rewards/playable.ts";
import { tileIndex } from "../shared/world/coordinates.ts";

const execFileAsync = promisify(execFile);

import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { BotPeer } from "../scripts/simulation/BotPeer.ts";
import { botDatabase } from "../scripts/simulation/config.ts";
import { cleanupBotFixture } from "../scripts/simulation/fixture.ts";
import { DevRewardWallet } from "../server/integration/DevRewardWallet.ts";
import { PgRewardPreparation } from "../server/integration/PgRewardPreparation.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import {
  cleanupSchoolRewards,
  schoolRewardBinding,
} from "../server/integration/SchoolRewardFixture.ts";
import { ACK_STATUS } from "../shared/protocol/m2.ts";
import type {
  RewardPreparationCommand,
  RewardReceipt,
} from "../shared/rewards/commands.ts";
import { REWARD_PREPARATION_VERSION } from "../shared/rewards/commands.ts";

const url = process.env.R2PL_PREPARATION_DATABASE_URL;
const options = {
  skip: !url && "Disposable PostgreSQL required",
  timeout: 30000,
};
const command = (
  kind: "use_unistop" | "open_chest",
  targetId: string,
  key: string = randomUUID(),
): RewardPreparationCommand => ({
  kind,
  targetId,
  key,
  ruleVersion: REWARD_PREPARATION_VERSION,
});
async function fixture() {
  const pool = new Pool({ connectionString: botDatabase(url, "1"), max: 12 });
  const campaignId = randomUUID();
  const server = await createSchoolPlayServer(
    pool,
    { web: 0, websocket: 0 },
    campaignId,
  );
  const base = `http://127.0.0.1:${server.webPort}`;
  const request = (
    path: string,
    token: string | null,
    input?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(input === undefined ? {} : { "Content-Type": "application/json" }),
        ...extra,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  const close = async () => {
    await server.close();
    await cleanupSchoolRewards(pool, campaignId);
    await cleanupBotFixture(pool, campaignId);
    await pool.end();
  };
  return { pool, campaignId, server, request, close };
}
test(
  "playable reward HTTP grants spendable exploration credit once and retains private events/inventory after restart",
  options,
  async () => {
    const f = await fixture();
    let peer: BotPeer | undefined;
    try {
      const actor = f.server.fixture.players[0]!,
        other = f.server.fixture.players[1]!;
      const before = await f.server.accounts.profile(actor.token);
      assert(before);
      const chest = command("open_chest", "dev-chest-0");
      const response = await f.request(
        "/api/fixture/rewards",
        actor.token,
        chest,
      );
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        kind: string;
        receipt: RewardReceipt;
      };
      assert.equal(result.receipt.status, "applied");
      assert.deepEqual(result.receipt.reward, { kind: "points", quantity: 2 });
      const replay = (await (
        await f.request("/api/fixture/rewards", actor.token, chest)
      ).json()) as { kind: string; receipt: RewardReceipt };
      assert.equal(replay.kind, "replay");
      assert.deepEqual(replay.receipt, result.receipt);
      const transport = new DevRewardClient(actor.token, (input, init) =>
        fetch(
          new URL(String(input), `http://127.0.0.1:${f.server.webPort}`),
          init,
        ),
      );
      assert.equal((await transport.catalog()).length, 4);
      assert.equal((await transport.inventory()).keys, "0");
      assert.equal((await transport.apply(chest)).kind, "replay");
      assert.equal((await transport.events()).events.length, 1);
      const after = await f.server.accounts.profile(actor.token);
      assert(after);
      assert.equal(BigInt(after.balance), BigInt(before.balance) + 2n);
      assert.equal(after.inventory.keys, "0");
      assert.equal(after.ledgerConserved, true);
      peer = new BotPeer(
        `ws://127.0.0.1:${f.server.websocketPort}`,
        actor.token,
        f.server.fixture.schools[0]!,
        "explorer",
        45,
      );
      await peer.connect();
      const intent = { tile: tileIndex(actor.home.x + 10, actor.home.z) };
      const conflict = await peer.explore(
        intent.tile,
        Uint8Array.from(Buffer.from(chest.key.replaceAll("-", ""), "hex")),
      );
      assert.equal(conflict.status, ACK_STATUS.REJECTED);
      assert.equal(
        (await f.server.accounts.profile(actor.token))!.balance,
        (BigInt(before.balance) + 2n).toString(),
      );
      const ack = await peer.explore(
        intent.tile,
        Uint8Array.from(Buffer.from(randomUUID().replaceAll("-", ""), "hex")),
      );
      assert.equal(ack.status, ACK_STATUS.TEST_APPLIED);
      assert.equal(
        (await f.server.accounts.profile(actor.token))!.balance,
        (BigInt(before.balance) + 1n).toString(),
      );
      const events = (await (
        await f.request("/api/fixture/rewards/events", actor.token)
      ).json()) as {
        events: { id: string; receipt: RewardReceipt }[];
        nextCursor: string;
      };
      assert.equal(events.events.length, 1);
      assert.deepEqual(events.events[0]!.receipt, result.receipt);
      assert.equal(
        (
          await (
            await f.request(
              `/api/fixture/rewards/events?after=${events.nextCursor}`,
              actor.token,
            )
          ).json()
        ).events.length,
        0,
      );
      assert.equal(
        (
          await (
            await f.request("/api/fixture/rewards/events", other.token)
          ).json()
        ).events.length,
        0,
      );
      assert.equal(
        (await f.server.accounts.profile(other.token))!.inventory.keys,
        "1",
      );
      assert.equal(
        (
          await (
            await f.request(
              "/api/fixture/rewards",
              other.token,
              command("open_chest", "dev-chest-0"),
            )
          ).json()
        ).receipt.reason,
        "NOT_AVAILABLE",
      );
      assert.equal(
        (await f.server.accounts.profile(other.token))!.inventory.keys,
        "1",
      );
      await peer.close();
      peer = undefined;
      await f.server.close();
      const restarted = await createSchoolPlayServer(
        f.pool,
        { web: 0, websocket: 0 },
        f.campaignId,
      );
      try {
        assert.equal(
          (await restarted.accounts.profile(actor.token))!.balance,
          (BigInt(before.balance) + 1n).toString(),
        );
        assert.equal(
          (await restarted.accounts.profile(actor.token))!.inventory.keys,
          "0",
        );
      } finally {
        await restarted.close();
      }
    } finally {
      await peer?.close();
      await f.close();
    }
  },
);
test(
  "playable reward boundary refuses forged inputs, hidden targets, Gift policies and command-key reuse",
  options,
  async () => {
    const f = await fixture();
    try {
      const actor = f.server.fixture.players[0]!;
      assert.equal(
        (
          await f.request(
            "/api/fixture/rewards",
            null,
            command("open_chest", "dev-chest-0"),
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await f.request("/api/fixture/rewards", actor.token, {
            ...command("open_chest", "dev-chest-0"),
            actorId: randomUUID(),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await f.request(
            "/api/fixture/rewards",
            actor.token,
            command("open_chest", "dev-chest-0"),
            { Origin: "https://foreign.example" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await f.request("/api/fixture/rewards", actor.token, {
            ...command("open_chest", "dev-chest-0"),
            padding: "x".repeat(5000),
          })
        ).status,
        413,
      );
      assert.equal(
        (await f.request("/api/fixture/rewards/events?after=-1", actor.token))
          .status,
        400,
      );
      const before = await f.server.accounts.profile(actor.token);
      for (const target of ["hidden-target", "dev-chest-7"]) {
        const receipt = (
          await (
            await f.request(
              "/api/fixture/rewards",
              actor.token,
              command("open_chest", target),
            )
          ).json()
        ).receipt;
        assert.equal(receipt.reason, "NOT_AVAILABLE");
      }
      for (const target of ["dev-nitro-0", "dev-predator-0"])
        assert.equal(
          (
            await (
              await f.request(
                "/api/fixture/rewards",
                actor.token,
                command("use_unistop", target),
              )
            ).json()
          ).receipt.reason,
          "POLICY_PENDING",
        );
      assert.deepEqual(await f.server.accounts.profile(actor.token), before);
      const catalog = (await (
        await f.request("/api/fixture/rewards", actor.token)
      ).json()) as { targets: { targetId: string }[] };
      assert.equal(catalog.targets.length, 4);
      assert.ok(catalog.targets.every((x) => x.targetId.endsWith("-0")));
      const spin = command("use_unistop", "dev-aspire-0");
      const first = await (
        await f.request("/api/fixture/rewards", actor.token, spin)
      ).json();
      assert.equal(first.receipt.status, "applied");
      assert.equal(
        (
          await (
            await f.request(
              "/api/fixture/rewards",
              actor.token,
              command("use_unistop", "dev-aspire-0"),
            )
          ).json()
        ).receipt.reason,
        "COOLDOWN",
      );
      assert.equal(
        (
          await f.request("/api/fixture/rewards", actor.token, {
            ...spin,
            targetId: "dev-nitro-0",
          })
        ).status,
        409,
      );
      const counts = (
        await f.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM r2pl_prep.reward_outbox WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0]!;
      assert.equal(counts.n, "1");
      assert.equal(
        (await f.server.accounts.profile(actor.token))!.ledgerConserved,
        true,
      );
    } finally {
      await f.close();
    }
  },
);
test(
  "shared reward wallet handles same-Key spend/grant net zero and rolls back after outbox failure",
  options,
  async () => {
    const f = await fixture();
    const trigger = `play_outbox_${randomUUID().replaceAll("-", "")}`;
    try {
      const actor = f.server.fixture.players[0]!;
      const b = schoolRewardBinding(f.server.fixture, actor.token)!;
      const service = new PgRewardPreparation(f.pool, {
        mode: "synthetic-preparation",
        ruleVersion: REWARD_PREPARATION_VERSION,
        wallet: new DevRewardWallet(),
        ticketSource: () => 0,
      });
      const id = "dev-key-chest";
      await f.pool.query(
        "INSERT INTO r2pl_prep.reward_targets(campaign_id,target_id,kind,rule_version,fixed_reward) VALUES($1,$2,'chest',$3,$4)",
        [
          f.campaignId,
          id,
          REWARD_PREPARATION_VERSION,
          JSON.stringify({ kind: "key", quantity: 1 }),
        ],
      );
      await f.pool.query(
        "INSERT INTO r2pl_prep.reward_discoveries VALUES($1,$2,$3)",
        [f.campaignId, b.actorId, id],
      );
      const c = command("open_chest", id);
      const first = await service.apply(b, c);
      assert.equal(first.receipt.status, "applied");
      assert.equal(
        (await f.server.accounts.profile(actor.token))!.inventory.keys,
        "1",
      );
      assert.equal(
        (await f.server.accounts.profile(actor.token))!.ledgerConserved,
        true,
      );
      const details = await f.pool.query<{ amount: string }>(
        "SELECT amount::text FROM r2pl_prep.playable_reward_ledger WHERE campaign_id=$1 ORDER BY amount",
        [f.campaignId],
      );
      assert.deepEqual(
        details.rows.map((r) => r.amount),
        ["-1", "1"],
      );
      assert.equal(
        (
          await f.pool.query(
            "SELECT 1 FROM r2pl_v2.ledger_entries WHERE campaign_id=$1",
            [f.campaignId],
          )
        ).rowCount,
        0,
      );
      const before = await f.server.accounts.profile(actor.token);
      await f.pool.query(
        `CREATE FUNCTION r2pl_prep.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.campaign_id='${f.campaignId}'::uuid THEN RAISE EXCEPTION 'injected playable outbox failure'; END IF; RETURN NEW; END; $$`,
      );
      await f.pool.query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON r2pl_prep.reward_outbox FOR EACH ROW EXECUTE FUNCTION r2pl_prep.${trigger}()`,
      );
      const failed = command("use_unistop", "dev-aspire-0");
      await assert.rejects(
        service.apply(b, failed),
        /injected playable outbox failure/,
      );
      assert.deepEqual(await f.server.accounts.profile(actor.token), before);
      const exists = await f.pool.query(
        "SELECT 1 FROM r2pl_v2.command_results WHERE campaign_id=$1 AND command_key=$2",
        [f.campaignId, Buffer.from(failed.key.replaceAll("-", ""), "hex")],
      );
      assert.equal(exists.rowCount, 0);
      await f.pool.query(`DROP TRIGGER ${trigger} ON r2pl_prep.reward_outbox`);
      await f.pool.query(`DROP FUNCTION r2pl_prep.${trigger}()`);
      assert.equal((await service.apply(b, failed)).receipt.status, "applied");
      assert.equal(
        (await f.server.accounts.profile(actor.token))!.balance,
        (BigInt(before!.balance) + 1n).toString(),
      );
      assert.equal(
        (await f.server.accounts.profile(actor.token))!.ledgerConserved,
        true,
      );
    } finally {
      await f.pool.query(
        `DROP TRIGGER IF EXISTS ${trigger} ON r2pl_prep.reward_outbox`,
      );
      await f.pool.query(`DROP FUNCTION IF EXISTS r2pl_prep.${trigger}()`);
      await f.close();
    }
  },
);

test(
  "playable reward concurrency grants once per key and one actor wins the shared Chest",
  options,
  async () => {
    const f = await fixture();
    try {
      const a = f.server.fixture.players[0]!,
        b = f.server.fixture.players[1]!,
        c = f.server.fixture.players[2]!;
      const results = await Promise.all(
        [a, b].map(
          async (actor) =>
            await (
              await f.request(
                "/api/fixture/rewards",
                actor.token,
                command("open_chest", "dev-chest-0"),
              )
            ).json(),
        ),
      );
      assert.equal(
        results.filter((r) => r.receipt.status === "applied").length,
        1,
      );
      const inventories = await Promise.all(
        [a, b].map((actor) => f.server.accounts.profile(actor.token)),
      );
      assert.equal(
        inventories.reduce((n, p) => n + Number(p!.inventory.keys), 0),
        1,
      );
      assert.ok(inventories.every((p) => p!.ledgerConserved));
      const cmd = command("open_chest", "dev-chest-1");
      const duplicate = await Promise.all(
        Array.from(
          { length: 16 },
          async () =>
            await (
              await f.request("/api/fixture/rewards", c.token, cmd)
            ).json(),
        ),
      );
      assert.equal(duplicate.filter((r) => r.kind === "committed").length, 1);
      assert.equal(duplicate.filter((r) => r.kind === "replay").length, 15);
      for (const result of duplicate)
        assert.deepEqual(result.receipt, duplicate[0]!.receipt);
      const after = await f.server.accounts.profile(c.token);
      assert.equal(after!.balance, "1002");
      assert.equal(after!.inventory.keys, "0");
      assert.equal(after!.ledgerConserved, true);
    } finally {
      await f.close();
    }
  },
);
test(
  "playable reward wallet overflow rolls back Key, claim, net/detail ledger and both receipt namespaces",
  options,
  async () => {
    const f = await fixture();
    try {
      const actor = f.server.fixture.players[0]!;
      const b = schoolRewardBinding(f.server.fixture, actor.token)!;
      await f.pool.query(
        "UPDATE r2pl_v2.wallet_accounts SET balance=9223372036854775807,opening_balance=9223372036854775807 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
        [f.campaignId, b.actorId],
      );
      const before = await f.server.accounts.profile(actor.token);
      const service = new PgRewardPreparation(f.pool, {
        mode: "synthetic-preparation",
        ruleVersion: REWARD_PREPARATION_VERSION,
        wallet: new DevRewardWallet(),
      });
      const c = command("open_chest", "dev-chest-0");
      await assert.rejects(service.apply(b, c), /out of range/);
      assert.deepEqual(await f.server.accounts.profile(actor.token), before);
      for (const table of [
        "reward_chest_claims",
        "reward_receipts",
        "reward_outbox",
        "playable_reward_ledger",
      ])
        assert.equal(
          (
            await f.pool.query(
              `SELECT 1 FROM r2pl_prep.${table} WHERE campaign_id=$1`,
              [f.campaignId],
            )
          ).rowCount,
          0,
        );
      assert.equal(
        (
          await f.pool.query(
            "SELECT 1 FROM r2pl_v2.command_results WHERE campaign_id=$1",
            [f.campaignId],
          )
        ).rowCount,
        0,
      );
    } finally {
      await f.close();
    }
  },
);

test("synthetic reward contracts reject forged fields, inconsistent receipts and invalid balances/cursors", () => {
  const receipt = {
    status: "applied",
    command: command("open_chest", "dev-chest-0"),
    reason: null,
    reward: { kind: "points", quantity: 2 },
    processedAtMs: 1,
    nextAvailableAtMs: null,
  };
  const target = {
    targetId: "dev-aspire-0",
    kind: "unistop",
    profile: "aspire",
    policyPending: false,
    claimed: false,
    available: true,
    nextAvailableAtMs: null,
  };
  assert.equal(
    parseRewardCatalog({
      fixtureOnly: true,
      ruleVersion: REWARD_PREPARATION_VERSION,
      targets: [target],
    }).length,
    1,
  );
  assert.throws(() =>
    parseRewardCatalog({
      fixtureOnly: true,
      ruleVersion: REWARD_PREPARATION_VERSION,
      targets: [target, target],
    }),
  );
  assert.throws(() =>
    parseRewardCatalog({
      fixtureOnly: true,
      ruleVersion: REWARD_PREPARATION_VERSION,
      targets: [{ ...target, policyPending: true }],
    }),
  );
  assert.deepEqual(parseRewardReceipt(receipt), receipt);
  assert.throws(() => parseRewardReceipt({ ...receipt, actorId: "secret" }));
  assert.throws(() => parseRewardReceipt({ ...receipt, status: "rejected" }));
  assert.throws(() =>
    parseRewardReceipt({ ...receipt, reward: { kind: "gift", quantity: 1 } }),
  );
  assert.throws(() =>
    parseDevInventory({
      credits: "9223372036854775808",
      crystals: "0",
      treasureMaps: "0",
      keys: "1",
    }),
  );
  assert.throws(() =>
    parseDevInventory({
      credits: "1",
      crystals: "0",
      treasureMaps: "0",
      keys: "1",
      rivalBalance: "100",
    }),
  );
  assert.throws(() =>
    parsePrivateRewardPage({
      fixtureOnly: true,
      events: [
        { id: "2", receipt },
        { id: "1", receipt },
      ],
      nextCursor: "1",
    }),
  );
  assert.throws(() =>
    parsePrivateRewardPage({
      fixtureOnly: true,
      events: [{ id: "2", receipt }],
      nextCursor: "3",
    }),
  );
});
test(
  "real process exits after unified reward commit; HTTP retry returns the original receipt without another Key spend",
  options,
  async () => {
    const f = await fixture();
    try {
      const key = randomUUID(),
        actor = f.server.fixture.players[0]!;
      const exit = await execFileAsync(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/playable-reward-crash-child.ts",
          f.campaignId,
          key,
        ],
        {
          env: { ...process.env, R2PL_PLAYABLE_REWARD_CRASH_CHILD: "1" },
          windowsHide: true,
          timeout: 15000,
        },
      ).then(
        () => 0,
        (error) => Number(error.code),
      );
      assert.equal(exit, 86);
      const before = await f.server.accounts.profile(actor.token);
      assert.equal(before!.balance, "1002");
      assert.equal(before!.inventory.keys, "0");
      const replay = await (
        await f.request(
          "/api/fixture/rewards",
          actor.token,
          command("open_chest", "dev-chest-0", key),
        )
      ).json();
      assert.equal(replay.kind, "replay");
      assert.equal(replay.receipt.status, "applied");
      assert.deepEqual(await f.server.accounts.profile(actor.token), before);
      assert.equal(
        (
          await f.pool.query(
            "SELECT 1 FROM r2pl_prep.reward_chest_claims WHERE campaign_id=$1",
            [f.campaignId],
          )
        ).rowCount,
        1,
      );
    } finally {
      await f.close();
    }
  },
);
