import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createServer } from "vite";

test("bootstrap failure stays unavailable instead of inventing a playable identity or wallet", async () => {
  const w = new Window({ url: "http://localhost:5173/?standalone=1" });
  const originalFetch = globalThis.fetch;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    location: w.location,
    sessionStorage: w.sessionStorage,
  });
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response("unavailable", { status: 502 });
  };
  const vite = await createServer({
    configFile: false,
    root: "client",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const { loadGameSession } = await vite.ssrLoadModule(
      "/src/portalSession.ts",
    );
    let resolved = false;
    void loadGameSession().then(() => {
      resolved = true;
    });
    await new Promise(setImmediate);
    assert.equal(requests, 1, "query flags cannot bypass the session API");
    assert.equal(
      resolved,
      false,
      "API failure cannot resolve to a fake session",
    );
    assert.match(w.document.body.textContent!, /Hành trình đang tạm dừng/);
    assert.equal(
      w.document.querySelector(".boot-primary")?.textContent,
      "Thử kết nối lại",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    await w.happyDOM.close();
  }
});
