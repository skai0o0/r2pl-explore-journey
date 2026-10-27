import assert from "node:assert/strict";
import test from "node:test";
import {
  type HTMLTextAreaElement as TestArea,
  type HTMLButtonElement as TestButton,
  type HTMLInputElement as TestInput,
  type HTMLSelectElement as TestSelect,
  Window,
} from "happy-dom";
import { createServer } from "vite";
import {
  ADMIN_ROLES,
  ALL_ADMIN_PERMISSIONS,
} from "../shared/integration/adminAccess.ts";

test("admin dashboard hides privileged tabs, protects root and selects the correct email defaults", async () => {
  const w = new Window({ url: "http://127.0.0.1:4318/admin" });
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    confirm: globalThis.confirm,
  };
  Object.assign(globalThis, { window: w, document: w.document });
  const calls: string[] = [];
  const submitted: Record<string, unknown>[] = [];
  globalThis.confirm = () => true;
  globalThis.fetch = async (input, init) => {
    if (init?.body) submitted.push(JSON.parse(String(init.body)));
    const path = String(input);
    calls.push(path);
    return new Response(
      JSON.stringify(
        path === "/api/admin/notifications"
          ? { routes: [], counts: [], recent: [] }
          : path === "/api/admin/accounts"
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
            : path === "/api/admin/gift-pool"
              ? {
                  items: [
                    {
                      name: "Test gift",
                      tier: "nitro",
                      remaining: 3,
                      awarded: 1,
                      active: true,
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
      true,
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
    role.value = "testPlayer";
    role.dispatchEvent(new w.Event("change"));
    assert(
      w.document.querySelector<TestInput>('input[name="testProfiles"]')!
        .checked,
    );
    assert.equal(
      w.document.querySelectorAll("fieldset input:checked").length,
      0,
    );
    assert(
      w.document.querySelector<TestInput>('input[name="enabled"]')!.checked,
    );
    assert(!password.disabled);
    role.value = "partner";
    role.dispatchEvent(new w.Event("change"));
    assert(
      w.document.querySelector<TestInput>('input[name="testProfiles"]')!
        .checked,
    );
    assert.equal(
      w.document.querySelectorAll("fieldset input:checked").length,
      4,
    );
    assert(password.disabled);
    for (const checkbox of w.document.querySelectorAll<TestInput>(
      "fieldset input",
    )) {
      if (!ADMIN_ROLES.partner.permissions.some((p) => p === checkbox.value))
        assert(checkbox.disabled);
    }
    [...w.document.querySelectorAll<TestButton>(".admin-nav button")]
      .find((b) => b.textContent === "Thông báo")!
      .click();
    await flush();
    const routing = w.document.querySelector(".notification-routing")!;
    w.document.querySelector<TestInput>('input[name="rally"]')!.checked = true;
    routing.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await flush();
    assert(
      submitted.some(
        (v) =>
          v.action === "routing" &&
          Array.isArray(v.routes) &&
          v.routes.length === 3,
      ),
    );
    const compose = w.document.querySelector(".notification-compose")!;
    compose.querySelector<TestInput>('input[name="title"]')!.value =
      "Campaign message";
    compose.querySelector<TestArea>('textarea[name="body"]')!.value =
      "Join the game";
    compose.querySelector<TestSelect>('select[name="school"]')!.value = "ou";
    compose.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await flush();
    assert(
      submitted.some(
        (v) =>
          v.action === "compose" &&
          v.schoolId === "ou" &&
          v.title === "Campaign message" &&
          typeof v.key === "string",
      ),
    );
    w.document.querySelector(".admin-console")!.remove();
    await mountAdminDashboard(
      {
        ...principal,
        playable: true,
        permissions: ADMIN_ROLES.partner.permissions,
      },
      "production",
      true,
    );
    await flush();
    assert(w.document.querySelector('a[href="/"]'));
    assert.deepEqual(
      [...w.document.querySelectorAll(".admin-nav button")].map(
        (b) => b.textContent,
      ),
      ["BXH", "Live Editor ↗", "Kho quà", "Tra cứu & trao quà", "Lịch sử"],
    );
    [...w.document.querySelectorAll<TestButton>(".admin-nav button")]
      .find((b) => b.textContent === "Kho quà")!
      .click();
    await flush();
    assert(
      w.document
        .querySelector(".admin-content")!
        .textContent!.includes("Test gift"),
    );
    assert.equal(w.document.querySelector(".admin-content form"), null);
    assert.equal(w.document.querySelector(".admin-content button"), null);
    w.document.querySelector(".admin-console")!.remove();
    await mountAdminDashboard(
      {
        ...principal,
        email: "other@amtech.vn",
        protectedRoot: false,
        permissions: ALL_ADMIN_PERMISSIONS,
      },
      "production",
      true,
    );
    await flush();
    assert(
      ![...w.document.querySelectorAll(".admin-nav button")].some(
        (b) => b.textContent === "Dữ liệu chiến dịch",
      ),
    );
    w.document.querySelector(".admin-console")!.remove();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input) !== "/api/admin/campaign")
        return originalFetch(input, init);
      if (init?.body) {
        const body = JSON.parse(String(init.body));
        submitted.push(body);
        if (body.action === "search")
          return new Response(
            JSON.stringify({
              students: [
                {
                  actorId: "actor",
                  name: "<b>Student</b>",
                  externalId: "123",
                  schoolId: "hcmut",
                  balance: "10",
                  email: null,
                },
              ],
            }),
          );
        if (body.action === "history")
          return new Response(
            JSON.stringify({
              entries: [
                {
                  kind: "note",
                  occurredAt: "2026-10-27T00:00:00Z",
                  detail: { note: "<img src=x>" },
                },
              ],
              hasMore: false,
            }),
          );
        return new Response(JSON.stringify({ balance: body.balance }));
      }
      return new Response(
        JSON.stringify({
          pools: [{ schoolId: "hcmut", schoolName: "Bách khoa", balance: "0" }],
        }),
      );
    };
    await mountAdminDashboard(
      {
        ...principal,
        email: "admin@amtech.vn",
        protectedRoot: true,
        permissions: ALL_ADMIN_PERMISSIONS,
      },
      "production",
      true,
    );
    await flush();
    [...w.document.querySelectorAll<TestButton>(".admin-nav button")]
      .find((b) => b.textContent === "Dữ liệu chiến dịch")!
      .click();
    await flush();
    const poolForm = w.document.querySelector(".campaign-pools form")!;
    poolForm.querySelector<TestInput>("input")!.value = "8888";
    poolForm.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await flush();
    assert(
      submitted.some(
        (v) =>
          v.action === "set_pool" &&
          v.balance === "8888" &&
          v.expectedBalance === "0",
      ),
    );
    const search = w.document.querySelector(".campaign-search")!;
    search.querySelector<TestInput>("input")!.value = "123";
    search.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await flush();
    assert.equal(w.document.querySelector(".campaign-students b"), null);
    const studentForm = w.document.querySelector(".campaign-students form")!;
    studentForm.querySelector<TestInput>("input")!.value = "42";
    studentForm.querySelectorAll<TestInput>("input")[1]!.value = "Đối soát";
    studentForm.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await flush();
    assert(
      submitted.some(
        (v) =>
          v.action === "set_student" &&
          v.balance === "42" &&
          v.expectedBalance === "10",
      ),
    );
    const reset = w.document.querySelector(".campaign-reset")!;
    reset.querySelector<TestInput>("input")!.value = "RESET";
    reset.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await flush();
    assert(
      submitted.some((v) => v.action === "reset" && v.confirmation === "RESET"),
    );
    [...w.document.querySelectorAll<TestButton>(".admin-nav button")]
      .find((b) => b.textContent === "Lịch sử sinh viên")!
      .click();
    await flush();
    const historySearch = w.document.querySelector(".history-search")!;
    historySearch.querySelector<TestInput>("input")!.value = "123";
    historySearch.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await flush();
    w.document.querySelector<TestButton>(".history-results button")!.click();
    await flush();
    assert.equal(w.document.querySelector(".history-detail img"), null);
    assert(
      w.document
        .querySelector(".history-detail")!
        .textContent!.includes("<img src=x>"),
    );
    const historyNote = w.document
      .querySelector(".history-detail textarea")!
      .closest("form")!;
    historyNote.querySelector<TestArea>("textarea")!.value =
      "Kiểm tra đối soát";
    historyNote.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await flush();
    assert(
      submitted.some(
        (v) => v.action === "note" && v.note === "Kiểm tra đối soát",
      ),
    );
  } finally {
    await vite.close();
    await w.happyDOM.close();
    Object.assign(globalThis, original);
  }
});
