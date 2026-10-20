import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createServer } from "vite";

test("one banner at a time, bounded queue expires, live visibility clears state and markup is escaped", async () => {
  const w = new Window({ url: "http://127.0.0.1/" });
  let hidden = false;
  Object.defineProperty(w.document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  const instances: FakeSource[] = [];
  class FakeSource extends w.EventTarget {
    closed = false;
    onerror: (() => void) | undefined;
    readonly url: string;
    constructor(url: string) {
      super();
      this.url = url;
      instances.push(this);
    }
    close() {
      this.closed = true;
    }
    send(input: unknown) {
      this.dispatchEvent(
        new w.MessageEvent("notification", { data: JSON.stringify(input) }),
      );
    }
  }
  const values = {
    window: w,
    document: w.document,
    EventSource: FakeSource,
    requestAnimationFrame: (callback: (t: number) => void) => {
      callback(0);
      return 0;
    },
  };
  const old = Object.fromEntries(
    Object.keys(values).map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  const vite = await createServer({
    configFile: false,
    root: "client",
    cacheDir: "../.vite/notification-tests",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  let banner:
      | {
          show: (options: Record<string, unknown>) => HTMLElement;
          dismiss: (element: HTMLElement) => void;
          clearAll: () => void;
        }
      | undefined,
    close: (() => void) | undefined;
  try {
    const module = await vite.ssrLoadModule("/src/ui/notificationBanner.ts");
    banner = module.NotificationBanner;
    const first = banner!.show({
      title: "<img src=x onerror=alert(1)>",
      body: "First",
      durationMs: 100000,
    });
    banner!.show({
      title: "Expired in queue",
      body: "Old",
      expiresAtMs: Date.now() + 50,
    });
    banner!.show({ title: "Next fresh", body: "Third", durationMs: 100000 });
    assert.equal(
      w.document.querySelectorAll(".predator-push-banner").length,
      1,
    );
    assert.equal(w.document.querySelector(".banner-title img"), null);
    assert.equal(
      w.document.querySelector(".banner-title")!.textContent,
      "<img src=x onerror=alert(1)>",
    );
    await new Promise((r) => setTimeout(r, 60));
    banner!.dismiss(first);
    assert.equal(
      w.document.querySelectorAll(".predator-push-banner").length,
      1,
    );
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(
      w.document.querySelectorAll(".predator-push-banner").length,
      1,
    );
    assert.equal(
      w.document.querySelector(".banner-title")!.textContent,
      "Next fresh",
    );
    banner!.show({ title: "Will be cleared", body: "Queued" });
    banner!.clearAll();
    assert.equal(
      w.document.querySelectorAll(".predator-push-banner").length,
      0,
    );
    const { startLiveNotifications } = await vite.ssrLoadModule(
      "/src/liveNotifications.ts",
    );
    close = startLiveNotifications();
    assert.equal(instances.length, 1);
    assert.equal(instances[0]!.url, "/api/notifications/live");
    const message = {
      id: "1",
      kind: "rally",
      title: "Live",
      body: "New",
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 60000,
      schoolSlot: 0,
    };
    instances[0]!.send(message);
    instances[0]!.send(message);
    instances[0]!.send({ ...message, id: "2" });
    assert.equal(
      w.document.querySelectorAll(".predator-push-banner").length,
      1,
    );
    hidden = true;
    w.document.dispatchEvent(new w.Event("visibilitychange"));
    assert(instances[0]!.closed);
    assert.equal(
      w.document.querySelectorAll(".predator-push-banner").length,
      0,
    );
    hidden = false;
    w.document.dispatchEvent(new w.Event("visibilitychange"));
    assert.equal(instances.length, 2);
    instances[1]!.send({ ...message, id: "3", expiresAtMs: Date.now() - 1 });
    assert.equal(
      w.document.querySelectorAll(".predator-push-banner").length,
      0,
    );
    instances[1]!.send({ ...message, id: "4" });
    assert.equal(
      w.document.querySelectorAll(".predator-push-banner").length,
      1,
    );
    instances[1]!.onerror?.();
    assert.equal(
      w.document.querySelectorAll(".predator-push-banner").length,
      0,
    );
  } finally {
    close?.();
    banner?.clearAll();
    await vite.close();
    await w.happyDOM.close();
    for (const [key, descriptor] of Object.entries(old)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
