import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { type HTMLElement as TestElement, Window } from "happy-dom";
import { StatsOverlay } from "../client/src/ui/statsOverlay.ts";

async function fixture() {
  const window = new Window({
    url: "http://localhost:5173/",
    settings: {
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  window.document.write(
    await readFile(new URL("../client/index.html", import.meta.url), "utf8"),
  );
  Object.assign(globalThis, { window, document: window.document });
  const style = window.document.createElement("style");
  style.textContent =
    (
      await readFile(
        new URL("../client/src/style.css", import.meta.url),
        "utf8",
      )
    ).replace(/@import[^;]+;/g, "") +
    (await readFile(
      new URL("../client/src/ui/compactUI.css", import.meta.url),
      "utf8",
    ));
  window.document.head.append(style);
  return window;
}

test("compact toolbar preserves the actionable inventory and mobile tile confirmation", async () => {
  const w = await fixture();
  try {
    Object.defineProperty(w, "innerWidth", { value: 390 });
    const stats = new StatsOverlay();
    let inventory = 0;
    stats.onInventoryRequested = () => inventory++;
    stats.onExploreRequested = () => {
      (
        w.document.getElementById("tile-coordinates")! as TestElement
      ).textContent = "510, 280";
    };
    (w.document.getElementById("hud-tools-toggle")! as TestElement).click();
    (w.document.getElementById("tool-find-expansion")! as TestElement).click();
    assert.equal(
      (w.document.getElementById("tools-panel")! as TestElement).hidden,
      false,
      "the confirmation button must remain reachable on mobile",
    );
    assert.equal(
      (w.document.getElementById("tile-coordinates")! as TestElement)
        .textContent,
      "510, 280",
    );
    (w.document.getElementById("tool-inventory")! as TestElement).click();
    assert.equal(inventory, 1);
    assert.equal(
      stats.dialogOpen,
      false,
      "inventory delegates to the full gameplay inventory",
    );
    const menu = w.document.createElement("details");
    menu.className = "gameplay-menu";
    menu.open = true;
    w.document.body.append(menu);
    assert.notEqual(
      w.getComputedStyle(menu).display,
      "none",
      "legacy inventory must not be globally hidden by compact CSS",
    );
  } finally {
    await w.happyDOM.close();
  }
});

test("wallet refresh preserves dialog focus, backdrop consumes input, and close restores opener", async () => {
  const w = await fixture();
  try {
    const stats = new StatsOverlay();
    const opener = w.document.getElementById("hud-progress")! as TestElement;
    opener.focus();
    opener.click();
    assert.equal(stats.dialogOpen, true);
    const refresh = w.document.getElementById(
      "dialog-btn-refresh-wallet",
    )! as TestElement;
    refresh.focus();
    stats.updateStats({ points: 27 });
    assert.equal(w.document.activeElement?.id, "dialog-btn-refresh-wallet");
    assert.match(
      (w.document.getElementById("dialog-content")! as TestElement)
        .textContent!,
      /27/,
    );
    let leaked = 0;
    w.document.addEventListener("pointerup", () => leaked++);
    (w.document.getElementById("scrim")! as TestElement).dispatchEvent(
      new w.PointerEvent("pointerup", { bubbles: true }),
    );
    assert.equal(leaked, 0);
    (w.document.getElementById("scrim")! as TestElement).click();
    assert.equal(stats.dialogOpen, false);
    assert.equal(w.document.activeElement, opener);
  } finally {
    await w.happyDOM.close();
  }
});
