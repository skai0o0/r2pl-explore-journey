import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createServer } from "vite";

test("ambient overlay uses Vietnam hours, stays decorative and pauses with page visibility", async () => {
  const window = new Window();
  const original = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  const vite = await createServer({
    configFile: false,
    root: "client",
    cacheDir: "../.vite/ambient-tests",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const { ambientPeriod, mountAmbientOverlay } = await vite.ssrLoadModule(
      "/src/ambientOverlay.ts",
    );
    assert.equal(ambientPeriod(new Date("2026-10-26T22:59:00Z")), "night");
    assert.equal(ambientPeriod(new Date("2026-10-26T23:00:00Z")), "day");
    assert.equal(ambientPeriod(new Date("2026-10-27T11:00:00Z")), "night");
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const dispose = mountAmbientOverlay(host);
    const layer = host.querySelector(".map-atmosphere")!;
    assert.equal(layer.getAttribute("aria-hidden"), "true");
    assert.equal(layer.querySelectorAll(".map-atmosphere-leaf").length, 3);
    Object.defineProperty(window.document, "hidden", {
      configurable: true,
      value: true,
    });
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(layer.getAttribute("data-paused"), "true");
    dispose();
    assert.equal(host.children.length, 0);
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(host.children.length, 0);
  } finally {
    globalThis.document = original;
    await vite.close();
    await window.happyDOM.close();
  }
});
