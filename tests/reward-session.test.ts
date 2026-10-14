import assert from "node:assert/strict";
import test from "node:test";
import { RewardSession } from "../client/src/rewardSession.ts";
import type {
  RewardPreparationCommand,
  RewardReceipt,
} from "../shared/rewards/commands.ts";
import type { DevRewardTarget } from "../shared/rewards/playable.ts";

const target: DevRewardTarget = {
  targetId: "dev-chest-0",
  kind: "chest",
  profile: null,
  policyPending: false,
  claimed: false,
  available: true,
  nextAvailableAtMs: null,
};
const inventory = {
  credits: "1000",
  crystals: "0",
  treasureMaps: "0",
  keys: "1",
};
const key = "a1000000-0000-4000-8000-000000000001";
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function receipt(command: RewardPreparationCommand): RewardReceipt {
  return {
    command,
    status: "applied",
    reason: null,
    reward: { kind: "points", quantity: 2 },
    processedAtMs: 1000,
    nextAvailableAtMs: null,
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function client(
  apply: (
    command: RewardPreparationCommand,
  ) => Promise<{ kind: "committed" | "replay"; receipt: RewardReceipt }>,
) {
  return {
    inventory: async () => inventory,
    catalog: async () => [target],
    events: async (after = "0") => ({ events: [], nextCursor: after }),
    apply,
  };
}
test("uncertain reward survives reload and retries identical payload", async () => {
  const saved = storage();
  const commands: RewardPreparationCommand[] = [];
  const first = new RewardSession(
    saved,
    () => {},
    () => {},
    () =>
      client(async (command) => {
        commands.push(command);
        throw new Error("lost response after commit");
      }),
    () => key,
  );
  first.select("actor-a");
  await tick();
  await first.act(target);
  assert.equal(first.state.pending?.key, key);
  assert.equal(first.state.inventory?.credits, "1000");
  const recovered = new RewardSession(
    saved,
    () => {},
    () => {},
    () =>
      client(async (command) => {
        commands.push(command);
        return { kind: "replay", receipt: receipt(command) };
      }),
  );
  recovered.select("actor-a");
  await tick();
  await recovered.retry();
  assert.deepEqual(commands[0], commands[1]);
  assert.equal(recovered.state.pending, undefined);
  assert.equal(recovered.state.receipt?.reward?.quantity, 2);
});
test("late reward reply cannot leak into another actor and clears only its own recovery", async () => {
  const saved = storage();
  let finish!: (value: { kind: "committed"; receipt: RewardReceipt }) => void;
  let command!: RewardPreparationCommand;
  const refreshed: string[] = [];
  const session = new RewardSession(
    saved,
    () => {},
    (token) => refreshed.push(token),
    () =>
      client(async (input) => {
        command = input;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }),
    () => key,
  );
  session.select("actor-a");
  await tick();
  const applying = session.act(target);
  session.select("actor-b");
  await tick();
  finish({ kind: "committed", receipt: receipt(command) });
  await applying;
  assert.equal(session.state.receipt, undefined);
  assert.equal(session.state.pending, undefined);
  assert.deepEqual(refreshed, []);
  assert.equal(saved.getItem("r2pl-rewards-v1:actor-a:pending"), null);
  session.select("actor-a");
  assert.equal(
    (session.state.receipt as RewardReceipt | undefined)?.command.key,
    key,
  );
});
test("late catalog and private cursor are isolated across A to B to A switches", async () => {
  const saved = storage();
  let finish!: (value: typeof inventory) => void;
  let first = true;
  const session = new RewardSession(
    saved,
    () => {},
    () => {},
    (token) => ({
      ...client(async (command) => ({
        kind: "committed",
        receipt: receipt(command),
      })),
      inventory: async () => {
        if (token === "actor-a" && first) {
          first = false;
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        return { ...inventory, credits: token === "actor-b" ? "2000" : "3000" };
      },
      events: async () => ({
        events: [],
        nextCursor: token === "actor-b" ? "8" : "5",
      }),
    }),
  );
  session.select("actor-a");
  session.select("actor-b");
  await tick();
  session.select("actor-a");
  await tick();
  finish(inventory);
  await tick();
  assert.equal(session.state.inventory?.credits, "3000");
  assert.equal(saved.getItem("r2pl-rewards-v1:actor-a:cursor"), '"5"');
  assert.equal(saved.getItem("r2pl-rewards-v1:actor-b:cursor"), '"8"');
});
test("unavailable, policy pending and keyless actions never create commands", async () => {
  let calls = 0;
  const api = client(async (command) => {
    calls++;
    return { kind: "committed", receipt: receipt(command) };
  });
  api.inventory = async () => ({ ...inventory, keys: "0" });
  const session = new RewardSession(
    storage(),
    () => {},
    () => {},
    () => api,
  );
  session.select("actor-a");
  await tick();
  await session.act(target);
  await session.act({ ...target, available: false });
  await session.act({
    ...target,
    kind: "unistop",
    profile: "nitro",
    policyPending: true,
  });
  assert.equal(calls, 0);
  assert.equal(session.state.pending, undefined);
});

test("an old completion never deletes a newer recovery command after returning to the actor", async () => {
  const saved = storage();
  let finish!: (value: { kind: "committed"; receipt: RewardReceipt }) => void;
  let old!: RewardPreparationCommand;
  let calls = 0;
  let ids = 0;
  const session = new RewardSession(
    saved,
    () => {},
    () => {},
    () =>
      client(async (command) => {
        calls++;
        if (calls === 1) {
          old = command;
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        if (calls === 2) return { kind: "replay", receipt: receipt(command) };
        throw new Error("next response uncertain");
      }),
    () => (ids++ === 0 ? key : "a1000000-0000-4000-8000-000000000002"),
  );
  session.select("actor-a");
  await tick();
  const original = session.act(target);
  session.select("actor-b");
  session.select("actor-a");
  await tick();
  await session.retry();
  await session.act(target);
  const next = session.state.pending;
  assert.ok(next);
  finish({ kind: "committed", receipt: receipt(old) });
  await original;
  assert.equal(session.state.pending?.key, next.key);
  assert.equal(
    JSON.parse(saved.getItem("r2pl-rewards-v1:actor-a:pending")!).key,
    next.key,
  );
});
