import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { type HTMLElement as TestElement, Window } from "happy-dom";
import { SelectedTilePanel } from "../client/src/ui/selectedTilePanel.ts";

test("tile panel is opt-in for experienced students and remains visible until a novice spends Points", async () => {
  const window = new Window({
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  try {
    window.document.write(
      await readFile(new URL("../client/index.html", import.meta.url), "utf8"),
    );
    const controller = new SelectedTilePanel(
      window.document as unknown as Document,
    );
    const panel = window.document.getElementById(
      "selected-tile-panel",
    )! as TestElement;
    const toggle = window.document.getElementById(
      "tile-panel-toggle",
    )! as TestElement;
    const close = window.document.getElementById("tile-close")! as TestElement;
    assert.equal(
      panel.hidden,
      true,
      "unknown profile must not flash a large panel",
    );
    controller.updateProfile(true);
    window.document.getElementById("tile-coordinates")!.textContent =
      "510, 280";
    assert.equal(
      panel.hidden,
      true,
      "selection does not implicitly open the panel",
    );
    toggle.click();
    assert.equal(panel.hidden, false);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    close.click();
    assert.equal(panel.hidden, true);
    assert.equal(
      window.document.getElementById("tile-coordinates")!.textContent,
      "510, 280",
      "collapse preserves selected tile",
    );
    controller.updateProfile(true);
    assert.equal(panel.hidden, true, "wallet polling does not reopen it");
    controller.reset();
    controller.updateProfile(false);
    assert.equal(panel.hidden, false);
    assert.equal(
      close.hidden,
      true,
      "onboarding remains visible before first spend",
    );
    controller.open(); // Find-expansion must not pin an already visible onboarding panel.
    controller.updateProfile(true);
    assert.equal(
      panel.hidden,
      true,
      "first committed debit ends automatic onboarding",
    );
    controller.open();
    controller.updateProfile(true);
    assert.equal(
      panel.hidden,
      false,
      "explicitly opened panel survives profile refresh",
    );
    controller.reset();
    assert.equal(
      panel.hidden,
      true,
      "account switches do not leak the previous visibility preference",
    );
  } finally {
    await window.happyDOM.close();
  }
});
