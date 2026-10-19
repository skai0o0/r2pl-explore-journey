import assert from "node:assert/strict";
import test from "node:test";
import {
  type HTMLButtonElement as TestButton,
  type HTMLInputElement as TestInput,
  Window,
} from "happy-dom";
import { mountGiftPoolEditor } from "../client/src/giftPoolEditor.ts";
import { GAME_CONFIG } from "../shared/gameplay/gameConfig.ts";
import {
  effectiveRewardOutcomes,
  GIFT_TIERS,
  type GiftPoolSnapshot,
  parseGiftPoolCommand,
} from "../shared/gameplay/giftPool.ts";

test("all six reward tables conserve probability and keep zero Gift visible; restock restores reference odds", () => {
  const before = JSON.stringify(GAME_CONFIG.rewards);
  for (const kind of ["unistop", "chest"] as const)
    for (const tier of GIFT_TIERS) {
      const original = GAME_CONFIG.rewards[kind][tier].outcomes;
      const giftWeight = original.find((r) => r.kind === "gift")!.weight;
      for (const eligible of [true, false]) {
        const empty = effectiveRewardOutcomes(kind, tier, 0, eligible);
        assert.equal(empty.length, original.length);
        assert.equal(
          empty.reduce((n, r) => n + r.weight, 0),
          1000,
        );
        for (let i = 0; i < original.length; i++) {
          const row = original[i]!;
          assert.deepEqual(empty[i], {
            ...row,
            weight:
              row.kind === "gift"
                ? 0
                : row.weight +
                  (row.kind === "crystals" && row.quantity === 1
                    ? giftWeight
                    : 0),
          });
        }
      }
      assert.deepEqual(effectiveRewardOutcomes(kind, tier, 1, true), original);
      const ineligible = effectiveRewardOutcomes(kind, tier, 1, false);
      assert.equal(ineligible.find((r) => r.kind === "gift")!.weight, 0);
      const max = GAME_CONFIG.rewards.giftFallback[kind];
      assert.equal(
        ineligible.find((r) => r.kind === "crystals" && r.quantity === max)!
          .weight,
        original.find((r) => r.kind === "crystals" && r.quantity === max)!
          .weight + giftWeight,
      );
    }
  assert.equal(JSON.stringify(GAME_CONFIG.rewards), before);
});

test("pool commands reject malformed and unbounded stock edits", () => {
  const command = {
    action: "upsert",
    expectedRevision: 0,
    tier: "nitro",
    name: "  Áo chạy  ",
    remaining: 1,
  };
  assert.equal(parseGiftPoolCommand(command).name, "Áo chạy");
  for (const override of [
    { remaining: -1 },
    { remaining: 1.5 },
    { remaining: 100001 },
    { name: "" },
    { tier: "other" },
    { expectedRevision: -1 },
    { admin: true },
    { id: "../secret" },
  ])
    assert.throws(() => parseGiftPoolCommand({ ...command, ...override }));
  assert.throws(() =>
    parseGiftPoolCommand({ action: "archive", expectedRevision: 0 }),
  );
});

test("Live Editor preserves safe gift names and requires review after a competing stock change", async () => {
  const w = new Window();
  const oldDocument = globalThis.document;
  Object.assign(globalThis, { document: w.document });
  const root = w.document.createElement("div");
  w.document.body.append(root);
  let state: GiftPoolSnapshot = {
    revision: 1,
    items: [
      {
        id: "test-gift",
        tier: "nitro",
        name: '<img src=x onerror="bad()">',
        remaining: 3,
        awarded: 0,
        active: true,
      },
    ],
    totals: { aspire: 0, nitro: 3, predator: 0 },
  };
  let writes = 0;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  try {
    mountGiftPoolEditor(
      root as unknown as HTMLElement,
      async <T>(_path: string, body?: unknown): Promise<T> => {
        if (body) {
          writes++;
          state = {
            ...state,
            revision: 2,
            items: state.items.map((item) => ({
              ...item,
              remaining: 2,
              awarded: 1,
            })),
            totals: { ...state.totals, nitro: 2 },
          };
          throw new Error("GIFT_POOL_CHANGED");
        }
        return state as T;
      },
    );
    root.querySelector<TestButton>("[data-refresh]")!.click();
    await settle();
    assert.equal(root.querySelector("img"), null);
    assert(root.textContent.includes("<img src=x"));
    root.querySelector<TestButton>("[data-items] button")!.click();
    root
      .querySelector("form")!
      .dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal(writes, 1);
    assert(root.textContent.includes("Kho vừa thay đổi"));
    root
      .querySelector("form")!
      .dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal(
      writes,
      1,
      "stale unsaved quantities cannot overwrite an awarded unit on retry",
    );
    root.querySelector<TestButton>("[data-items] button")!.click();
    assert.equal(
      root.querySelector<TestInput>('[name="remaining"]')!.value,
      "2",
    );
  } finally {
    Object.assign(globalThis, { document: oldDocument });
    await w.happyDOM.close();
  }
});
