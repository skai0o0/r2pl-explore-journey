import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createServer } from "vite";

test("play-only staff skip empty dashboard after direct login and admin SSO; portal entry clears stale routing", async () => {
  const w = new Window({ url: "http://127.0.0.1/admin" });
  const keys = [
    "window",
    "document",
    "location",
    "sessionStorage",
    "history",
    "fetch",
  ] as const;
  const original = Object.fromEntries(
    keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  const redirects: string[] = [],
    requests: string[] = [];
  const location = {
    pathname: "/admin",
    search: "",
    hash: "",
    replace: (url: string) => redirects.push(url),
    assign: (url: string) => redirects.push(url),
  };
  const globals = {
    window: w,
    document: w.document,
    sessionStorage: w.sessionStorage,
    history: { replaceState() {} },
    location,
    fetch: async (input: unknown) => {
      const path = String(input);
      requests.push(path);
      return new Response(
        JSON.stringify(
          path.startsWith("/api/portal/config")
            ? {
                portalLoginUrl: "https://event.example.test/login",
                campaignId: "campaign",
                returnUrl: "http://127.0.0.1/",
              }
            : path === "/api/portal/session"
              ? {}
              : {
                  version: 1,
                  mode: "admin",
                  environment: "production",
                  csrfToken: "a".repeat(64),
                  principal: {
                    actorId: "staff",
                    name: "Test",
                    role: "admin",
                    organizationId: "amtech",
                    playable: true,
                    permissions: [],
                  },
                },
        ),
      );
    },
  };
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  const vite = await createServer({
    configFile: false,
    root: "client",
    cacheDir: "../.vite/play-only-login-tests",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const flush = async () => {
    for (let i = 0; i < 20; i++)
      await new Promise((resolve) => setImmediate(resolve));
  };
  try {
    const { loadGameSession } = await vite.ssrLoadModule(
      "/src/portalSession.ts",
    );
    for (const entry of ["direct", "sso"]) {
      location.pathname = entry === "direct" ? "/admin" : "/";
      location.hash = entry === "sso" ? "#launch=ticket" : "";
      w.sessionStorage.setItem("r2pl-demo-admin-entry", "1");
      w.sessionStorage.setItem("r2pl-portal-verifier", "test-verifier");
      void loadGameSession();
      await flush();
      assert.equal(redirects.at(-1), "/");
      assert.equal(w.sessionStorage.getItem("r2pl-demo-admin-entry"), null);
      assert.equal(w.document.querySelector(".admin-console"), null);
    }
    assert(requests.includes("/api/portal/session"));
    location.search = "?entry=portal";
    location.hash = "";
    w.sessionStorage.setItem("r2pl-demo-admin-entry", "1");
    void loadGameSession();
    for (
      let i = 0;
      i < 100 &&
      !redirects.at(-1)?.startsWith("https://event.example.test/login?");
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(w.sessionStorage.getItem("r2pl-demo-admin-entry"), null);
    assert.equal(
      requests.filter((p) => p.startsWith("/api/portal/config")).at(-1),
      "/api/portal/config",
    );
    assert(redirects.at(-1)!.startsWith("https://event.example.test/login?"));
  } finally {
    await vite.close();
    await w.happyDOM.close();
    for (const key of keys) {
      const descriptor = original[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
