import assert from "node:assert/strict";
import test from "node:test";
import { type HTMLElement as TestElement, Window } from "happy-dom";
import { createServer } from "vite";
import type { GameView } from "../shared/gameplay/commands.ts";
import { NEUTRAL_UNISTOPS } from "../shared/gameplay/gameConfig.ts";

test("inventory refresh keeps destinations expanded and opening an object removes the covering panel", async () => {
  const w = new Window({ url: "http://localhost:5173/" });
  const previousFetch = globalThis.fetch;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    sessionStorage: w.sessionStorage,
  });
  let view: GameView = {
    ruleVersion: 1,
    runningMode: "synthetic",
    crystals: "5",
    treasureMaps: "0",
    keys: { aspire: "1", nitro: "0", predator: "0" },
    landmarks: [],
    chests: [],
    cooldowns: {},
    weeklyKm: 0,
    events: [],
    shared: [],
    revealedTiles: 400,
    gifts: [],
  };
  globalThis.fetch = async () => new Response(JSON.stringify(view));
  const vite = await createServer({
    configFile: false,
    root: "client",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const { GameplayUI } = await vite.ssrLoadModule("/src/gameplayUI.ts");
    const ui = new GameplayUI(
      NEUTRAL_UNISTOPS,
      () => {},
      () => {},
      () => {},
    );
    ui.select({
      token: "synthetic-test",
      label: "Synthetic",
      schoolName: "HCMUT",
      slot: 0,
      home: { x: 500, z: 280 },
    });
    await ui.refresh();
    ui.openInventory();
    const details = w.document.querySelector(
      'details[data-section="destinations"]',
    )!;
    details.setAttribute("open", "");
    await ui.refresh();
    assert.equal(
      w.document.querySelector('details[data-section="destinations"]'),
      details,
      "unchanged polling must retain actual DOM controls while the user is interacting",
    );
    assert(
      w.document.querySelector('details[data-section="destinations"][open]'),
    );
    const destination =
      w.document.querySelector<TestElement>("[data-object-id]")!;
    destination.focus();
    view = { ...view, revealedTiles: 401 };
    await ui.refresh();
    assert.equal(
      w.document.activeElement?.getAttribute("data-object-id"),
      destination.dataset.objectId,
    );
    globalThis.fetch = async () => {
      throw new Error("Synthetic offline");
    };
    await ui.refresh();
    assert(w.document.querySelector('[data-section="destinations"]'));
    assert(w.document.querySelector(".journey-sync-status"));
    globalThis.fetch = async () => new Response(JSON.stringify(view));
    await ui.refresh();
    assert(!w.document.querySelector(".journey-sync-status"));
    ui.pick(NEUTRAL_UNISTOPS[0]);
    assert(w.document.querySelector(".gameplay-menu[hidden]"));
    assert(w.document.querySelector(".unistop-modal-overlay"));
    const dev = new GameplayUI(
      NEUTRAL_UNISTOPS,
      () => {},
      () => {},
      () => {},
      "dev-ui",
      undefined,
      true,
    );
    const devPanel = w.document
      .querySelectorAll<TestElement>(".gameplay-menu")
      .item(1)!;
    assert(devPanel.hidden, "the closed dev drawer must not cover the toolbar");
    dev.openInventory();
    assert(!devPanel.hidden && devPanel.hasAttribute("open"));
    w.document.dispatchEvent(
      new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert(
      devPanel.hidden,
      "Escape must release both the dev drawer and its backdrop",
    );
  } finally {
    globalThis.fetch = previousFetch;
    await vite.close();
    await w.happyDOM.close();
  }
});
