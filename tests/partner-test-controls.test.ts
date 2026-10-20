import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createServer } from "vite";
import { SCHOOLS } from "../shared/gameplay/gameConfig.ts";

test("partner controls switch only by school ID, reload after cookie rotation, and recover from failures", async () => {
  const w = new Window({ url: "http://127.0.0.1:4318/" });
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    location: globalThis.location,
  };
  let redirect = "",
    succeeds = true;
  const calls: { path: string; options: RequestInit | undefined }[] = [];
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    location: {
      assign: (path: string) => {
        redirect = path;
      },
    },
  });
  globalThis.fetch = async (input, options) => {
    calls.push({ path: String(input), options });
    return new Response("{}", { status: succeeds ? 200 : 403 });
  };
  const vite = await createServer({
    configFile: false,
    root: "client",
    cacheDir: "../.vite/partner-controls-tests",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
  };
  try {
    const { mountPartnerTestControls } = await vite.ssrLoadModule(
      "/src/partnerTestControls.ts",
    );
    mountPartnerTestControls(0);
    const select = w.document.querySelector("select")!;
    assert.equal(select.options.length, 8);
    assert.equal(select.value, SCHOOLS[0]!.id);
    assert.equal(w.document.querySelector("a")!.getAttribute("href"), "/admin");
    select.value = SCHOOLS[1]!.id;
    select.dispatchEvent(new w.Event("change"));
    await flush();
    assert.equal(calls[0]!.path, "/api/test-profiles/switch");
    assert.equal(calls[0]!.options!.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]!.options!.body)), {
      schoolId: SCHOOLS[1]!.id,
    });
    assert.equal(redirect, "/");
    assert(select.disabled);
    w.document.querySelector("nav")!.remove();
    mountPartnerTestControls(0);
    succeeds = false;
    redirect = "";
    const retry = w.document.querySelector("select")!;
    retry.value = SCHOOLS[1]!.id;
    retry.dispatchEvent(new w.Event("change"));
    await flush();
    assert.equal(redirect, "");
    assert.equal(retry.value, SCHOOLS[0]!.id);
    assert(!retry.disabled);
    assert(
      w.document
        .querySelector('[role="status"]')!
        .textContent!.includes("Tải lại trang"),
    );
  } finally {
    await vite.close();
    await w.happyDOM.close();
    Object.assign(globalThis, original);
  }
});
