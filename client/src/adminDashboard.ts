import { GAME_CONFIG, SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  type AdminAccountView,
  type AdminPermission,
  type AdminRole,
  canAdmin,
  isStaffSsoEmail,
  ROOT_ADMIN_EMAIL,
} from "../../shared/integration/adminAccess.ts";
import type { AdminPrincipal } from "../../shared/integration/identity.ts";
import {
  NOTIFICATION_LABELS,
  type NotificationRouting,
} from "../../shared/integration/notifications.ts";
import { mountCampaignAdmin } from "./adminCampaign.ts";
import { finishBoot } from "./bootScreen.ts";
import { gameFetch } from "./gameHttp.ts";
import { mountGiftPoolEditor } from "./giftPoolEditor.ts";
import { mountStudentHistory } from "./studentHistory.ts";
import "./adminDashboard.css";

const errors: Record<string, string> = {
  INVALID_CREDENTIALS:
    "Email hoặc mật khẩu chưa đúng, hoặc tài khoản đã bị khóa.",
  LOGIN_RATE_LIMITED:
    "Đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.",
  ADMIN_VERSION_CONFLICT:
    "Tài khoản đã được cập nhật ở cửa sổ khác. Tải lại danh sách trước khi lưu.",
  PERMISSION_DENIED: "Bạn không có quyền thực hiện thao tác này.",
  ROOT_ADMIN_PROTECTED:
    "Tài khoản gốc được bảo vệ, không thể thay đổi tại đây.",
  INVALID_PASSWORD_LENGTH: "Mật khẩu cần từ 10 đến 128 ký tự.",
  MAP_PERMISSION_DEPENDENCY:
    "Sửa bản đồ cần quyền xem; xuất bản cần cả quyền sửa.",
  CANNOT_EDIT_SELF: "Nhờ quản trị viên khác thay đổi quyền tài khoản của bạn.",
  CANNOT_GRANT_PERMISSION: "Bạn chỉ có thể cấp và sửa các quyền mình đang có.",
  PASSWORD_REQUIRED: "Hãy nhập mật khẩu ban đầu cho tài khoản mới.",
  STAFF_USES_PORTAL:
    "AMTECH chỉ đặt mật khẩu Game khi bật 8 hồ sơ test và bỏ toàn bộ quyền quản trị.",
  TEST_PROFILE_READ_ONLY:
    "Tài khoản có hồ sơ test chỉ được cấp quyền xem dữ liệu.",
  TEST_PROFILES_REQUIRE_PORTAL:
    "Hồ sơ test chỉ có trên máy chủ game dùng đăng nhập tài khoản.",
  ADMIN_REQUIRED: "Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.",
  CSRF_REJECTED: "Phiên đăng nhập đã thay đổi. Vui lòng tải lại trang.",
  ROOT_ONLY: "Chỉ tài khoản quản trị gốc được thực hiện thao tác này.",
  BALANCE_CHANGED: "Số dư đã thay đổi. Hãy tải lại dữ liệu trước khi lưu.",
  BACKUP_FAILED: "Không tạo được bản sao lưu. Dữ liệu chưa được reset.",
  RESET_IN_PROGRESS: "Đang có thao tác reset khác được thực hiện.",
  INVALID_FILTER: "Khoảng ngày hoặc loại hoạt động không hợp lệ.",
  REASON_REQUIRED: "Hãy nhập lý do điều chỉnh từ 3 đến 500 ký tự.",
  INVALID_NOTE: "Ghi chú cần từ 3 đến 1.000 ký tự.",
};
async function api<T>(
  path: string,
  body?: unknown,
  timeoutMs: number = GAME_CONFIG.integration.bootstrapTimeoutMs,
): Promise<T> {
  const response = await gameFetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok)
    throw new Error(
      errors[result.error ?? ""] ??
        result.error ??
        "Chưa thể kết nối. Vui lòng thử lại.",
    );
  return result as T;
}
function shell(title: string, note: string): HTMLElement {
  document.body.dataset.mode = "admin-dashboard";
  document.querySelector(".game-shell")?.remove();
  document.querySelector(".map-tools")?.remove();
  const app = document.createElement("main");
  app.className = "admin-console";
  app.innerHTML = `<header class="admin-header"><a href="/admin" class="admin-brand"><img src="/Headline.png" alt="Road to Predator League"><span>CAMPAIGN CONSOLE</span></a><div class="admin-identity"></div></header><section class="admin-heading"><p class="admin-eyebrow">AMTECH / OPERATIONS</p><h1></h1><p class="admin-note"></p></section><nav class="admin-nav" aria-label="Quản trị"></nav><p class="admin-feedback" role="status" aria-live="polite"></p><section class="admin-content"></section>`;
  app.querySelector("h1")!.textContent = title;
  app.querySelector(".admin-note")!.textContent = note;
  document.body.append(app);
  finishBoot();
  return app;
}
function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
}
export async function mountAdminLogin(): Promise<void> {
  document.title = "Đăng nhập quản trị · R2PL";
  const app = shell(
    "Không gian quản trị.",
    "Tài khoản AMTECH dùng đăng nhập web giải. Tài khoản quản trị riêng đăng nhập tại đây.",
  );
  app.classList.add("admin-login-page");
  const content = app.querySelector<HTMLElement>(".admin-content")!;
  content.innerHTML = `<form class="admin-login"><h2>Đăng nhập quản trị</h2><label>Email<input type="email" name="email" autocomplete="username" required maxlength="254"></label><label>Mật khẩu<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button class="admin-primary" type="submit">Vào bảng điều khiển ↗</button><a href="/?entry=admin">Đăng nhập qua web giải →</a></form>`;
  const form = content.querySelector("form")!,
    feedback = app.querySelector<HTMLElement>(".admin-feedback")!;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector("button")!;
    button.disabled = true;
    feedback.textContent = "Đang xác thực…";
    try {
      const configResponse = await fetch("/api/admin-auth/config", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!configResponse.ok)
        throw new Error("Đăng nhập quản trị chưa sẵn sàng.");
      const config = (await configResponse.json()) as { csrfToken: string };
      const response = await fetch("/api/admin-auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": config.csrfToken,
        },
        body: JSON.stringify({
          email: (form.elements.namedItem("email") as HTMLInputElement).value,
          password: (form.elements.namedItem("password") as HTMLInputElement)
            .value,
        }),
      });
      (form.elements.namedItem("password") as HTMLInputElement).value = "";
      if (!response.ok) {
        const result = (await response.json()) as { error: string };
        throw new Error(errors[result.error] ?? "Chưa thể đăng nhập.");
      }
      location.assign("/admin");
    } catch (error) {
      feedback.textContent = (error as Error).message;
    } finally {
      button.disabled = false;
    }
  };
}
export async function mountAdminDashboard(
  principal: AdminPrincipal,
  environment: "staging" | "production",
  testProfilesSupported = false,
): Promise<void> {
  document.title = "Campaign Console · R2PL";
  const app = shell(
    "Điều hành hành trình.",
    `${environment === "production" ? "Campaign chính thức" : "Môi trường thử nghiệm"} · Quyền thao tác theo tài khoản.`,
  );
  const identity = app.querySelector(".admin-identity")!,
    content = app.querySelector<HTMLElement>(".admin-content")!,
    nav = app.querySelector(".admin-nav")!,
    feedback = app.querySelector<HTMLElement>(".admin-feedback")!;
  identity.append(
    node(
      "span",
      `${principal.name}${principal.protectedRoot ? " · Quản trị gốc" : ""}`,
    ),
  );
  const logout = node("button", "Đăng xuất");
  identity.append(logout);
  if (principal.playable) {
    const play = node("a", "Vào game ↗");
    play.href = "/";
    identity.prepend(play);
  }
  logout.onclick = () =>
    void work(async () => {
      await api("/api/portal/logout", {});
      location.assign("/admin/login");
    });
  let working = false;
  async function work(task: () => Promise<void>): Promise<void> {
    if (working) return;
    working = true;
    for (const b of Array.from(nav.querySelectorAll("button")))
      b.disabled = true;
    feedback.textContent = "Đang xử lý…";
    try {
      await task();
      feedback.textContent = "";
    } catch (error) {
      feedback.textContent = (error as Error).message;
    } finally {
      working = false;
      for (const b of Array.from(nav.querySelectorAll("button")))
        b.disabled = false;
    }
  }
  const tabs: Array<
    [string, AdminPermission | undefined, () => Promise<void>]
  > = [];
  const refreshRankings = async () => {
    const page = await api<{
      rankings: { schoolId: string; points: number }[];
    }>("/api/admin/rankings");
    const table = node("table");
    table.innerHTML =
      "<thead><tr><th>Hạng</th><th>Trường</th><th>Điểm tri thức</th></tr></thead>";
    const body = node("tbody");
    page.rankings.forEach((row, i) => {
      const tr = node("tr");
      tr.append(
        node("td", String(i + 1)),
        node(
          "td",
          SCHOOLS.find((s) => s.id === row.schoolId)?.fullName ?? row.schoolId,
        ),
        node("td", row.points.toLocaleString("vi-VN")),
      );
      body.append(tr);
    });
    table.append(body);
    content.replaceChildren(
      node("h2", "Bảng xếp hạng trường"),
      node("p", "Số liệu tại thời điểm tải. Bấm tab BXH để cập nhật."),
      table,
    );
  };
  tabs.push(["BXH", "rankings.view", refreshRankings]);
  tabs.push([
    "Live Editor ↗",
    "map.view",
    async () => {
      location.assign("/admin/editor");
    },
  ]);
  tabs.push([
    "Thông báo",
    "notifications.send",
    async () => {
      const state = await api<{
        routes: NotificationRouting[];
        counts: { status: string; count: number }[];
        recent: {
          id: string;
          title: string;
          status: string;
          attempts: number;
        }[];
      }>("/api/admin/notifications");
      content.innerHTML = `<h2>Thông báo</h2><p>Ingame chỉ hiện hoạt động mới khi đang chơi, từng banner một. Chọn hoạt động nào được đưa sang web giải chạy. Adapter của web giải lấy tin và xác nhận qua API.</p><form class="admin-form notification-routing"><fieldset><legend>Hoạt động gửi sang web giải chạy</legend></fieldset><button type="submit">Lưu lựa chọn</button></form><h3>Soạn thông báo cho web giải chạy</h3><form class="admin-form notification-compose"><label>Người nhận<select name="school"><option value="">Toàn chiến dịch</option></select></label><label>Tiêu đề<input name="title" required maxlength="100"></label><label>Nội dung<textarea name="body" required maxlength="500"></textarea></label><button type="submit">Xếp hàng gửi sang web giải chạy</button></form><h3>Trạng thái chuyển tin</h3><div class="notification-status"></div>`;
      const routing = content.querySelector<HTMLFormElement>(
        ".notification-routing",
      )!;
      for (const [kind, label] of Object.entries(NOTIFICATION_LABELS)) {
        const wrapper = node("label"),
          check = node("input");
        wrapper.className = "admin-check";
        check.type = "checkbox";
        check.name = kind;
        check.checked =
          state.routes?.find((r) => r.kind === kind)?.forwardToPortal ?? false;
        wrapper.append(check, node("span", label));
        routing.querySelector("fieldset")!.append(wrapper);
      }
      routing.onsubmit = (e) => {
        e.preventDefault();
        const button = routing.querySelector("button")!;
        button.disabled = true;
        void work(async () => {
          await api("/api/admin/notifications", {
            action: "routing",
            routes: Object.keys(NOTIFICATION_LABELS).map((kind) => ({
              kind,
              forwardToPortal: (
                routing.elements.namedItem(kind) as HTMLInputElement
              ).checked,
            })),
          });
          feedback.textContent =
            "Đã lưu các hoạt động chuyển sang web giải chạy.";
        }).finally(() => (button.disabled = false));
      };
      const compose = content.querySelector<HTMLFormElement>(
          ".notification-compose",
        )!,
        schools = compose.elements.namedItem("school") as HTMLSelectElement;
      for (const school of SCHOOLS) {
        const option = node("option", school.shortName);
        option.value = school.id;
        schools.append(option);
      }
      let composeKey = crypto.randomUUID();
      compose.onsubmit = (e) => {
        e.preventDefault();
        if (!confirm("Xếp hàng thông báo này để web giải chạy nhận qua API?"))
          return;
        const button = compose.querySelector("button")!;
        button.disabled = true;
        void work(async () => {
          await api("/api/admin/notifications", {
            action: "compose",
            key: composeKey,
            schoolId: schools.value || null,
            title: (compose.elements.namedItem("title") as HTMLInputElement)
              .value,
            body: (compose.elements.namedItem("body") as HTMLTextAreaElement)
              .value,
          });
          compose.reset();
          composeKey = crypto.randomUUID();
          feedback.textContent =
            "Đã xếp hàng. Tin chỉ được chuyển khi adapter web giải chạy lấy và xác nhận.";
        }).finally(() => (button.disabled = false));
      };
      const status = content.querySelector(".notification-status")!;
      const labels: Record<string, string> = {
        pending: "Chờ adapter nhận",
        leased: "Adapter đang xử lý",
        delivered: "Adapter đã xác nhận",
        failed: "Hết hạn / cần kiểm tra",
      };
      for (const count of state.counts ?? [])
        status.append(
          node("p", `${labels[count.status] ?? count.status}: ${count.count}`),
        );
      for (const item of state.recent ?? [])
        status.append(
          node(
            "p",
            `${item.title} · ${labels[item.status] ?? item.status} · ${item.attempts} lượt nhận`,
          ),
        );
      if (!state.recent?.length)
        status.append(
          node(
            "p",
            "Chưa có tin xếp hàng. Chưa kết nối adapter thì chưa có tin nào được gửi ra ngoài.",
          ),
        );
    },
  ]);
  tabs.push([
    "Kho quà",
    "gifts.view",
    async () => {
      content.replaceChildren(node("h2", "Pool quà thật"));
      const pool = node("div");
      content.append(pool);
      if (canAdmin(principal, "gifts.manage")) mountGiftPoolEditor(pool, api);
      else {
        const snapshot = await api<
          import("../../shared/gameplay/giftPool.ts").GiftPoolSnapshot
        >("/api/admin/gift-pool");
        pool.append(node("p", "Chỉ xem · Số liệu tại thời điểm tải."));
        for (const item of snapshot.items) {
          pool.append(
            node(
              "p",
              `${item.name} · ${item.tier.toUpperCase()} · Còn ${item.remaining} · Đã trúng ${item.awarded}${item.active ? "" : " · Đã ngừng"}`,
            ),
          );
        }
        if (!snapshot.items.length) pool.append(node("p", "Kho đang trống."));
      }
    },
  ]);
  tabs.push([
    "Tra cứu & trao quà",
    "gifts.view",
    async () => {
      content.innerHTML = `<h2>Tra cứu & trao quà</h2><form class="admin-form"><label>Mã nhận quà<input name="code" required maxlength="100"></label><button type="submit">Tra cứu</button></form><div class="admin-gift-result"></div>`;
      content.querySelector("form")!.onsubmit = (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        void work(async () => {
          const code = (form.elements.namedItem("code") as HTMLInputElement)
            .value;
          const { gift } = await api<{ gift: Record<string, unknown> }>(
            `/api/admin/gifts?code=${encodeURIComponent(code)}`,
          );
          const result = content.querySelector(".admin-gift-result")!;
          result.replaceChildren(
            node("h3", String(gift.giftName ?? "Quà hiện vật")),
            node("p", String(gift.giftCode ?? code)),
            node("p", gift.redeemedAt ? "Đã trao quà" : "Chưa trao quà"),
          );
          if (!gift.redeemedAt && canAdmin(principal, "gifts.redeem")) {
            const button = node("button", "Xác nhận đã trao quà");
            result.append(button);
            button.onclick = () => {
              if (!confirm(`Xác nhận đã trao quà ${code}?`)) return;
              button.disabled = true;
              void work(async () => {
                await api("/api/admin/gifts/redeem", { giftCode: code });
                result.replaceChildren(node("p", "Đã xác nhận trao quà."));
              }).finally(() => {
                button.disabled = false;
              });
            };
          }
        });
      };
    },
  ]);
  tabs.push([
    "Lịch sử",
    "audit.view",
    async () => {
      const { events } = await api<{
        events: {
          createdAt: string;
          actor: string;
          action: string;
          detail: unknown;
        }[];
      }>("/api/admin/audit");
      content.replaceChildren(node("h2", "Lịch sử quản trị"));
      for (const event of events) {
        const item = node("article");
        item.append(
          node("strong", `${event.actor ?? "Hệ thống"} · ${event.action}`),
          node("p", new Date(event.createdAt).toLocaleString("vi-VN")),
          node("pre", JSON.stringify(event.detail, null, 2)),
        );
        content.append(item);
      }
      if (!events.length)
        content.append(node("p", "Chưa có thao tác quản trị."));
    },
  ]);
  tabs.push([
    "Tài khoản & quyền",
    "admins.manage",
    async () => {
      const { accounts } = await api<{ accounts: AdminAccountView[] }>(
        "/api/admin/accounts",
      );
      content.innerHTML = `<div class="admin-section-heading"><h2>Tài khoản & quyền</h2><button class="admin-new admin-primary">＋ Tạo tài khoản</button></div><p>AMTECH mới mặc định đủ quyền qua web giải; quyền đã chỉnh được giữ nguyên. Chọn “Chỉ chơi 8 hồ sơ test” để bỏ toàn bộ quyền quản trị và có thể đặt mật khẩu riêng đăng nhập tại /admin.</p><div class="admin-accounts"></div><div class="admin-account-editor"></div>`;
      const list = content.querySelector(".admin-accounts")!;
      for (const account of accounts) {
        const row = node("button");
        row.className = "admin-account-row";
        row.append(
          node("strong", account.name),
          node("span", account.email),
          node(
            "small",
            account.protectedRoot
              ? "Quản trị gốc · Được bảo vệ"
              : `${account.enabled ? "Hoạt động" : "Đã khóa"} · ${account.permissions.length} quyền · ${account.login === "portal" ? "Web giải" : "Mật khẩu"}`,
          ),
        );
        row.disabled =
          account.protectedRoot ||
          account.actorId === principal.actorId ||
          account.permissions.some((p) => !canAdmin(principal, p));
        row.onclick = () => edit(account);
        list.append(row);
      }
      (content.querySelector(".admin-new") as HTMLButtonElement).onclick = () =>
        edit();
      function edit(account?: AdminAccountView): void {
        const editor = content.querySelector(".admin-account-editor")!;
        editor.innerHTML = `<form class="admin-form"><h3></h3><label>Họ tên<input name="name" required maxlength="100"></label><label>Email<input type="email" name="email" required maxlength="254"></label><label>Mật khẩu đăng nhập trực tiếp <small>(để trống để giữ mật khẩu cũ; AMTECH chỉ đặt được khi chọn Chỉ chơi 8 hồ sơ test; không đổi mật khẩu web giải)</small><input type="password" name="password" autocomplete="new-password" minlength="10" maxlength="128"></label><label>Nhóm quyền<select name="preset"></select></label><fieldset><legend>Quyền được cấp</legend></fieldset><label class="admin-check"><input type="checkbox" name="enabled" checked>Cho phép đăng nhập và sử dụng tài khoản</label><button type="submit" class="admin-primary">Lưu tài khoản</button></form>`;
        const form = editor.querySelector("form")!,
          name = form.elements.namedItem("name") as HTMLInputElement,
          email = form.elements.namedItem("email") as HTMLInputElement,
          password = form.elements.namedItem("password") as HTMLInputElement,
          enabled = form.elements.namedItem("enabled") as HTMLInputElement,
          preset = form.elements.namedItem("preset") as HTMLSelectElement;
        form.querySelector("h3")!.textContent = account
          ? "Chỉnh sửa tài khoản"
          : "Tạo tài khoản quản trị";
        name.value = account?.name ?? "";
        email.value = account?.email ?? "";
        email.readOnly = !!account;
        enabled.checked = account?.enabled ?? true;
        const testLabel = node("label"),
          testProfiles = node("input");
        testLabel.className = "admin-check";
        testProfiles.type = "checkbox";
        testProfiles.name = "testProfiles";
        testProfiles.checked = account?.testProfiles ?? false;
        testProfiles.disabled = !testProfilesSupported;
        testLabel.hidden = !testProfilesSupported;
        testLabel.append(
          testProfiles,
          node(
            "span",
            "Cho phép chơi với 8 hồ sơ test · Điểm dùng chung theo trường",
          ),
        );
        form.querySelector("fieldset")!.before(testLabel);
        const checks = new Map<AdminPermission, HTMLInputElement>();
        for (const [permission, labelText] of Object.entries(
          ADMIN_PERMISSIONS,
        )) {
          const p = permission as AdminPermission,
            label = node("label"),
            check = node("input");
          label.className = "admin-check";
          check.type = "checkbox";
          check.value = p;
          check.checked =
            account?.permissions.includes(p) ??
            ADMIN_ROLES.viewer.permissions.some((v) => v === p);
          check.disabled = !canAdmin(principal, p);
          checks.set(p, check);
          label.append(check, node("span", labelText));
          form.querySelector("fieldset")!.append(label);
        }
        for (const [id, role] of Object.entries(ADMIN_ROLES)) {
          if (["partner", "testPlayer"].includes(id) && !testProfilesSupported)
            continue;
          const option = node("option", role.label);
          option.value = id;
          preset.append(option);
        }
        preset.value =
          account?.testProfiles && account.permissions.length === 0
            ? "testPlayer"
            : account
              ? "custom"
              : "viewer";
        const syncChecks = () => {
          const allowed = ADMIN_ROLES.partner
            .permissions as readonly AdminPermission[];
          checks.forEach((check, p) => {
            check.disabled =
              !canAdmin(principal, p) ||
              (testProfiles.checked && !allowed.includes(p));
            if (check.disabled) check.checked = false;
          });
        };
        syncChecks();
        const syncPassword = () => {
          password.disabled =
            isStaffSsoEmail(email.value.trim().toLowerCase()) &&
            !(
              testProfiles.checked &&
              [...checks.values()].every((c) => !c.checked)
            );
          if (password.disabled) password.value = "";
        };
        let permissionsTouched = false;
        preset.onchange = () => {
          permissionsTouched = true;
          testProfiles.checked = ["partner", "testPlayer"].includes(
            preset.value,
          );
          syncChecks();
          const chosen = ADMIN_ROLES[preset.value as AdminRole]
            .permissions as readonly AdminPermission[];
          checks.forEach((check, p) => {
            check.checked = !check.disabled && chosen.includes(p);
          });
          syncPassword();
        };
        testProfiles.onchange = () => {
          permissionsTouched = true;
          syncChecks();
          if (testProfiles.checked) {
            preset.value = "partner";
            const allowed = ADMIN_ROLES.partner
              .permissions as readonly AdminPermission[];
            checks.forEach((check, p) => {
              check.checked = !check.disabled && allowed.includes(p);
            });
          }
          syncPassword();
        };
        checks.forEach((check) => {
          check.onchange = () => {
            permissionsTouched = true;
            preset.value = "custom";
            syncPassword();
          };
        });
        const syncEmail = () => {
          const staff = isStaffSsoEmail(email.value.trim().toLowerCase());
          if (!account && !permissionsTouched) {
            preset.value = staff ? "full" : "viewer";
            const defaults = ADMIN_ROLES[preset.value as AdminRole]
              .permissions as readonly AdminPermission[];
            checks.forEach((check, p) => {
              check.checked = !check.disabled && defaults.includes(p);
            });
          }
        };
        email.oninput = () => {
          syncEmail();
          syncPassword();
        };
        syncEmail();
        syncPassword();
        form.onsubmit = (event) => {
          event.preventDefault();
          const button = form.querySelector("button")!;
          button.disabled = true;
          void work(async () => {
            await api("/api/admin/accounts", {
              email: email.value,
              name: name.value,
              enabled: enabled.checked,
              permissions: [...checks]
                .filter(([, check]) => check.checked)
                .map(([p]) => p),
              expectedRevision: account?.revision ?? 0,
              testProfiles: testProfiles.checked,
              ...(password.value ? { password: password.value } : {}),
            });
            password.value = "";
            await tabs.find((t) => t[0] === "Tài khoản & quyền")![2]();
          }).finally(() => {
            button.disabled = false;
          });
        };
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
        name.focus();
      }
    },
  ]);
  if (principal.protectedRoot && principal.email === ROOT_ADMIN_EMAIL) {
    tabs.push([
      "Dữ liệu chiến dịch",
      "admins.manage",
      async () => mountCampaignAdmin(content, api),
    ]);
    tabs.push([
      "Lịch sử sinh viên",
      "admins.manage",
      async () => mountStudentHistory(content, api),
    ]);
  }
  const available = tabs.filter(
    ([, permission]) => !permission || canAdmin(principal, permission),
  );
  for (const [label, , open] of available) {
    const button = node("button", label);
    nav.append(button);
    button.onclick = () => {
      for (const b of Array.from(nav.querySelectorAll("button")))
        b.dataset.active = String(b === button);
      content.replaceChildren(node("p", "Đang tải…"));
      void work(async () => {
        await open();
      });
    };
  }
  if (available.length)
    (nav.querySelector("button") as HTMLButtonElement).click();
  else
    content.append(
      node(
        "p",
        "Tài khoản chưa được cấp chức năng. Liên hệ quản trị viên để phân quyền.",
      ),
    );
}
