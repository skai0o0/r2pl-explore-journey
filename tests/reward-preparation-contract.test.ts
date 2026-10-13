import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFixtureReward,
  parseRewardCommand,
  REWARD_PREPARATION_VERSION,
} from "../shared/rewards/commands.ts";

const command = {
  key: "ABCDEF00-0000-0000-0000-000000000001",
  kind: "use_unistop",
  targetId: "fixture-aspire",
  ruleVersion: REWARD_PREPARATION_VERSION,
};
test("reward commands canonicalize UUID identity and reject client-authoritative fields", () => {
  assert.equal(
    parseRewardCommand(command).key,
    "abcdef00-0000-0000-0000-000000000001",
  );
  for (const patch of [
    { schoolSlot: 0 },
    { cost: 0 },
    { reward: { kind: "gift", quantity: 1 } },
    { kind: "grant_gift" },
    { ruleVersion: "production-v1" },
    { key: "bad-key" },
    { targetId: "../hidden" },
    { targetId: "x".repeat(129) },
  ])
    assert.throws(() => parseRewardCommand({ ...command, ...patch }));
  for (const input of [null, [], "command", {}])
    assert.throws(() => parseRewardCommand(input));
});
test("fixed fixture rewards accept only bounded nonphysical inventory outcomes", () => {
  for (const kind of ["points", "crystals", "treasure_map", "key"])
    assert.deepEqual(parseFixtureReward({ kind, quantity: 1 }), {
      kind,
      quantity: 1,
    });
  for (const input of [
    { kind: "gift", quantity: 1 },
    { kind: "key", quantity: 0 },
    { kind: "crystals", quantity: 1.2 },
    { kind: "points", quantity: "1" },
    { kind: "points", quantity: Number.MAX_SAFE_INTEGER + 1 },
    { kind: "key", quantity: 1, weight: 1000 },
    null,
    [],
  ])
    assert.throws(() => parseFixtureReward(input));
});
