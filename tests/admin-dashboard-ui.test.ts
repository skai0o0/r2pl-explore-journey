import assert from "node:assert/strict";
import test from "node:test";
import {
  type HTMLButtonElement as TestButton,
  type HTMLInputElement as TestInput,
  type HTMLSelectElement as TestSelect,
  Window,
} from "happy-dom";
import { createServer } from "vite";
import { ALL_ADMIN_PERMISSIONS } from "../shared/integration/adminAccess.ts";

test("admin dashboard hides privileged tabs, protects root and selects the correct email defaults", async () => {
  const w = new Window({ url: "http://127.0.0.1:4318/admin" });
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  Object.assign(globalThis, { window: w, document: w.document });
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const path = String(input);
    calls.push(path);
    return new Response(
      JSON.stringify(
        path === "/api/admin/accounts"
          ? {
              accounts: [
                {
                  actorId: "root",
                  email: "admin@amtech.vn",
                  name: "Root",
                  enabled: true,
                  protectedRoot: true,
                  permissions: ALL_ADMIN_PERMISSIONS,
                  login: "password",
                  revision: 0,
                },
              ],
            }
          : { rankings: [{ schoolId: "hcmut", points: 400 }] },
      ),
    );
  };
  const vite = await createServer({
    configFile: false,
    root: "client",
    cacheDir: "../.vite/admin-dashboard-tests",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const flush = async () => {
    for (let i = 0; i < 8; i++)
      await new Promise((resolve) => setImmediate(resolve));
  };
  try {
    const { mountAdminDashboard } = await vite.ssrLoadModule(
      "/src/adminDashboard.ts",
    );
    const principal = {
      actorId: "test",
      name: "<img src=x>",
      organizationId: "amtech",
      role: "admin",
      playable: false,
    };
    await mountAdminDashboard(
      { ...principal, permissions: ["rankings.view"] },
      "staging",
    );
    await flush();
    assert.deepEqual(
      [...w.document.querySelectorAll(".admin-nav button")].map(
        (b) => b.textContent,
      ),
      ["BXH"],
    );
    assert.equal(w.document.querySelector(".admin-identity img"), null);
    assert(!calls.includes("/api/admin/accounts"));
    w.document.querySelector(".admin-console")!.remove();
    await mountAdminDashboard(
      { ...principal, permissions: ALL_ADMIN_PERMISSIONS },
      "production",
    );
    await flush();
    const tab = [
      ...w.document.querySelectorAll<TestButton>(".admin-nav button"),
    ].find((b) => b.textContent === "Tài khoản & quyền")!;
    tab.click();
    await flush();
    assert(
      w.document.querySelector<TestButton>(".admin-account-row")!.disabled,
    );
    w.document.querySelector<TestButton>(".admin-new")!.click();
    const email = w.document.querySelector<TestInput>('input[name="email"]')!,
      password = w.document.querySelector<TestInput>('input[name="password"]')!,
      role = w.document.querySelector<TestSelect>('select[name="preset"]')!;
    email.value = "staff@amtech.vn";
    email.dispatchEvent(new w.Event("input"));
    assert(password.disabled);
    assert.equal(role.value, "full");
    assert.equal(
      w.document.querySelectorAll("fieldset input:checked").length,
      ALL_ADMIN_PERMISSIONS.length,
    );
    email.value = "staff@acer.com";
    email.dispatchEvent(new w.Event("input"));
    assert(!password.disabled);
    assert.equal(role.value, "viewer");
    assert.equal(
      w.document.querySelectorAll("fieldset input:checked").length,
      1,
    );
    role.value = "editor";
    role.dispatchEvent(new w.Event("change"));
    assert.equal(
      w.document.querySelectorAll("fieldset input:checked").length,
      3,
    );
    email.value = "staff@amtech-vn.com";
    email.dispatchEvent(new w.Event("input"));
    assert.equal(
      role.value,
      "editor",
      "intentional overrides survive email changes",
    );
  } finally {
    await vite.close();
    await w.happyDOM.close();
    Object.assign(globalThis, original);
  }
});
