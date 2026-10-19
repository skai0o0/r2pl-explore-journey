import "./style.css";
import { postPortalApi } from "./csrfRequest.ts";

interface Student {
  id: string;
  displayName: string;
  email: string;
  schoolId: string | null;
  role?: "user" | "admin";
}
interface Dashboard {
  csrfToken: string;
  student: Student | null;
  schools: { id: string; name: string }[];
  gameOrigin: string;
  account?: {
    earnedRunningPoints: string;
    spendablePoints: string;
    cumulativeMeters: string;
    weeklyMeters: string;
  } | null;
  activities?: { id: string; meters: string; occurred_at: string }[];
  jobs?: { revision: string; state: string; error_code: string | null }[];
  ranking?: { display_name: string; school_id: string; meters: string }[];
}
const app = document.querySelector<HTMLElement>("#app")!;
let data: Dashboard,
  register = false,
  refreshing = false,
  pendingActivity:
    | { id: string; meters: number; occurredAtMs: number }
    | undefined;
const query = new URLSearchParams(location.search);
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const km = (value: string | undefined) =>
  (Number(value ?? 0) / 1000).toLocaleString("vi-VN", {
    maximumFractionDigits: 3,
  });
const school = (id: string) =>
  data.schools.find((s) => s.id === id)?.name ?? id.toUpperCase();
function message(text: string, error = false): void {
  const el = get("message");
  if (el) {
    el.textContent = text;
    el.dataset.error = String(error);
  }
}
async function api(
  path: string,
  body: unknown = {},
): Promise<Record<string, unknown>> {
  return postPortalApi(path, body, data);
}
function brand(): string {
  return '<a class="brand" href="/"><span class="brand-mark">R²</span><strong>R2PL<span>STUDENT RUNNING LEAGUE</span></strong></a>';
}
function auth(): void {
  app.innerHTML = `<div class="auth-layout"><aside class="auth-story">${brand()}<span class="eyebrow">THE JOURNEY STARTS WITH YOU</span><h1>Chạy vì bạn.<br>Khám phá<br><em>cùng trường.</em></h1><p>Mỗi kilomet là một bước tiến. Tích lũy Điểm, mở bản đồ và tạo nên hành trình của trường bạn.</p><svg class="route-art" viewBox="0 0 500 200" aria-hidden="true"><path d="M0 150 C100 -20 170 260 260 100 S400 0 500 60"/><circle cx="85" cy="90" r="7"/><circle cx="270" cy="82" r="7"/><circle cx="455" cy="40" r="7"/></svg><footer>08 TRƯỜNG ĐẠI HỌC <span>01 HÀNH TRÌNH CHUNG</span></footer></aside><main class="auth-main"><div class="sandbox-badge">● SANDBOX · DỮ LIỆU KIỂM THỬ</div><div class="auth-card"><p class="eyebrow">PORTAL SINH VIÊN</p><h2>${register ? "Bắt đầu hành trình" : "Chào mừng trở lại"}</h2><p class="muted">${register ? "Tạo sinh viên của riêng bạn để thử toàn bộ hành trình." : "Đăng nhập để xem thành tích và tiếp tục khám phá."}</p><div class="tabs"><button id="login-tab" class="${register ? "" : "selected"}">Đăng nhập</button><button id="register-tab" class="${register ? "selected" : ""}">Tạo tài khoản</button></div><form id="auth-form">${register ? '<label>Họ và tên sinh viên<input name="displayName" autocomplete="name" placeholder="Nguyễn Minh Anh" minlength="2" maxlength="100" required></label><label>Trường đại học<select name="schoolId" id="school" required></select></label>' : ""}<label>Email sinh viên<input name="email" type="email" autocomplete="email" placeholder="ban@truong.edu.vn" required maxlength="254"></label><label>Mật khẩu<input name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" placeholder="Tối thiểu 10 ký tự" minlength="10" maxlength="128" required></label><button class="primary" id="auth-submit" type="submit">${register ? "Tạo tài khoản & bắt đầu ↗" : "Đăng nhập ↗"}</button></form><p id="message" role="status"></p><p class="test-note">Đây là portal giả lập. Email được xác minh mô phỏng; hãy dùng mật khẩu dành riêng cho kiểm thử.</p></div><footer>R2PL · HÀNH TRÌNH KHÁM PHÁ</footer></main></div>`;
  if (register)
    for (const item of data.schools)
      get<HTMLSelectElement>("school").add(new Option(item.name, item.id));
  get("login-tab").onclick = () => {
    register = false;
    auth();
  };
  get("register-tab").onclick = () => {
    register = true;
    auth();
  };
  get<HTMLFormElement>("auth-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement),
      button = get<HTMLButtonElement>("auth-submit");
    button.disabled = true;
    try {
      const payload: Record<string, string> = {};
      form.forEach((value, key) => {
        payload[key] = String(value);
      });
      await api(register ? "register" : "login", payload);
      await load();
    } catch (error) {
      message(
        error instanceof Error ? error.message : "Chưa thể đăng nhập.",
        true,
      );
      button.disabled = false;
    }
  };
}
function dashboard(): void {
  if (data.student?.role === "admin") {
    app.innerHTML = `<div class="dashboard"><aside class="sidebar">${brand()}<div class="campaign-tag">AMTECH · ADMIN</div><nav><a class="active" href="#overview">◈ Live Editor</a></nav><div class="sidebar-bottom"><button id="logout">Đăng xuất portal ↗</button></div></aside><main class="dashboard-main"><header class="dashboard-header">KHÔNG GIAN QUẢN TRỊ · SANDBOX</header><section id="overview"><p class="eyebrow">R2PL STUDIO</p><h1>Chào <span id="admin-name"></span></h1><p class="muted">Tài khoản công ty / đối tác AMTECH</p><div class="hero-banner"><div><span class="eyebrow">THIẾT KẾ HÀNH TRÌNH</span><h2>Sáng tạo bản đồ.<br>Vận hành campaign.</h2><p>Chỉnh sửa trực quan, lưu bản nháp và xuất bản cho 8 trường.</p><button class="primary" id="play">Mở Live Editor ↗</button></div><div class="hero-number" aria-hidden="true">R<span>2</span><i>CAMPAIGN<br>STUDIO</i></div></div><p id="message" role="status"></p></section></main></div>`;
    get("admin-name").textContent = data.student.displayName;
    get("play").onclick = () => void play();
    get("logout").onclick = async () => {
      try {
        await api("logout");
        location.assign("/");
      } catch (error) {
        message(String(error), true);
      }
    };
    return;
  }
  app.innerHTML = `<div class="dashboard"><aside class="sidebar">${brand()}<div class="campaign-tag">SANDBOX CAMPAIGN</div><nav><a class="active" href="#overview">◈ Tổng quan</a><a href="#activities">↗ Hoạt động chạy</a><a href="#ranking">♜ Bảng xếp hạng</a></nav><div class="sidebar-bottom"><p>Xác minh edu được mô phỏng.<br>Mọi hoạt động trên portal này là dữ liệu kiểm thử.</p><button id="logout">Đăng xuất portal ↗</button></div></aside><main class="dashboard-main"><header class="dashboard-header"><span>PORTAL SINH VIÊN <b class="sandbox-inline">KIỂM THỬ</b></span><span id="student-school"></span></header><section id="overview"><p class="eyebrow">HÀNH TRÌNH CỦA BẠN</p><h1>Chào <span id="student-name"></span><span class="wave"> ✳</span></h1><p class="muted" id="student-email"></p><div class="hero-banner"><div><span class="eyebrow">CHẠY THÊM MỘT CHÚT. ĐI XA THÊM MỘT CHÚT.</span><h2>Bản đồ đang chờ<br>bước chân của bạn.</h2><p>Tiêu Điểm trong game không làm giảm thành tích BXH chạy.</p><button class="primary" id="play">Chơi game ↗</button></div><div class="hero-number" aria-hidden="true">R<span>2</span><i>EXPLORE<br>TOGETHER</i></div></div><div class="metrics"><article><span>QUÃNG ĐƯỜNG TÍCH LŨY</span><strong><b id="total-km">—</b><small>km</small></strong><p>Hoạt động đã được đồng bộ</p></article><article><span>ĐIỂM CHẠY · BXH</span><strong id="earned">—</strong><p>Tổng điểm từ thành tích chạy</p></article><article class="wallet"><span>ĐIỂM CÒN LẠI · GAME</span><strong id="balance">—</strong><p>Số dư có thể dùng để khám phá</p></article></div></section><div class="columns"><section class="panel" id="activities"><div class="panel-heading"><div><p class="eyebrow">THỬ NGHIỆM ĐỒNG BỘ</p><h2>Thêm một chặng chạy</h2></div><span class="tag">GIẢ LẬP</span></div><form id="activity-form"><div class="form-row"><label>Quãng đường (km)<input id="distance" name="distance" type="number" min="0.001" max="100" step="0.001" value="1.5" required></label><label>Thời gian chạy<input id="run-date" type="datetime-local" required></label></div><button class="primary" id="add-run" type="submit">Thêm hoạt động & đồng bộ +</button></form><p id="message" role="status"></p><div class="sync-line"><span id="sync-state">Đang tải trạng thái</span><button id="retry" class="text-button">Thử đồng bộ lại ↻</button></div><h3>Lịch sử hoạt động</h3><div id="activity-list" class="activity-list"></div></section><section class="panel" id="ranking"><p class="eyebrow">CÙNG NHAU TIẾN LÊN</p><h2>Bảng xếp hạng chạy</h2><p class="muted">Thành tích của sinh viên trong sandbox.</p><div id="ranking-list"></div></section></div></main></div>`;
  get("student-name").textContent = data.student!.displayName;
  get("student-email").textContent = data.student!.email;
  get("student-school").textContent = school(data.student!.schoolId!);
  const now = new Date();
  get<HTMLInputElement>("run-date").value = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
  get("logout").onclick = async () => {
    try {
      await api("logout");
      pendingActivity = undefined;
      location.assign("/");
    } catch (error) {
      message(String(error), true);
    }
  };
  get("play").onclick = () => {
    void play();
  };
  get("retry").onclick = async () => {
    try {
      await api("retry");
      await refresh();
      message("Đã yêu cầu thử đồng bộ lại.");
    } catch (error) {
      message(String(error), true);
    }
  };
  get<HTMLFormElement>("activity-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = get<HTMLButtonElement>("add-run");
    button.disabled = true;
    const meters = Math.round(
        Number(get<HTMLInputElement>("distance").value) * 1000,
      ),
      occurredAtMs = new Date(
        get<HTMLInputElement>("run-date").value,
      ).getTime();
    if (
      !pendingActivity ||
      pendingActivity.meters !== meters ||
      pendingActivity.occurredAtMs !== occurredAtMs
    )
      pendingActivity = { id: crypto.randomUUID(), meters, occurredAtMs };
    try {
      await api("activities", pendingActivity);
      pendingActivity = undefined;
      message("Đã lưu hoạt động. Điểm sẽ cập nhật sau khi đồng bộ.");
      await refresh();
    } catch (error) {
      message(
        error instanceof Error ? error.message : "Chưa thể thêm hoạt động.",
        true,
      );
    } finally {
      button.disabled = false;
    }
  };
  update();
}
function update(): void {
  if (!get("balance")) return;
  get("total-km").textContent = data.account
    ? km(data.account.cumulativeMeters)
    : "—";
  get("earned").textContent = data.account?.earnedRunningPoints ?? "—";
  get("balance").textContent = data.account?.spendablePoints ?? "—";
  const job = data.jobs?.[0];
  get("sync-state").textContent = !data.account
    ? "Game chưa kết nối · hoạt động vẫn được lưu"
    : !job
      ? "Chưa có hoạt động · ví bắt đầu từ 0"
      : job.state === "synced"
        ? "● Đã đồng bộ thành tích"
        : job.state === "failed"
          ? "Cần thử lại · dữ liệu đã được giữ"
          : "◌ Đang chờ đồng bộ";
  const list = get("activity-list");
  list.replaceChildren();
  for (const activity of data.activities ?? []) {
    const row = document.createElement("article"),
      title = document.createElement("strong"),
      date = document.createElement("span");
    title.textContent = `${km(activity.meters)} km`;
    date.textContent = new Date(Number(activity.occurred_at)).toLocaleString(
      "vi-VN",
    );
    row.append(title, date);
    list.append(row);
  }
  if (!list.children.length)
    list.textContent =
      "Chưa có chặng chạy nào. Thêm hoạt động đầu tiên của bạn.";
  const rank = get("ranking-list");
  rank.replaceChildren();
  for (const [i, student] of (data.ranking ?? []).entries()) {
    const row = document.createElement("article"),
      ordinal = document.createElement("b"),
      name = document.createElement("span"),
      total = document.createElement("strong");
    row.className = "rank-row";
    ordinal.textContent = String(i + 1).padStart(2, "0");
    name.textContent = `${student.display_name} · ${school(student.school_id)}`;
    total.textContent = `${km(student.meters)} km`;
    row.append(ordinal, name, total);
    rank.append(row);
  }
}
async function play(): Promise<void> {
  const button = get<HTMLButtonElement>("play");
  button.disabled = true;
  try {
    if (!query.get("game_challenge")) {
      location.assign(`${data.gameOrigin}/?entry=portal`);
      return;
    }
    const result = await api("play", {
      gameCampaign: query.get("game_campaign"),
      gameChallenge: query.get("game_challenge"),
      gameReturn: query.get("game_return"),
    });
    location.assign(String(result.launchUrl));
  } catch (error) {
    message(
      error instanceof Error ? error.message : "Chưa thể vào game.",
      true,
    );
    button.disabled = false;
  }
}
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch("/api/dummy/v1/me", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error();
    const next = (await response.json()) as Dashboard;
    if (!next.student) {
      location.reload();
      return;
    }
    data = next;
    update();
  } catch {
    message(
      "Chưa kết nối được portal. Bạn có thể thử lại; hoạt động đã lưu vẫn được giữ.",
      true,
    );
  } finally {
    refreshing = false;
  }
}
async function load(): Promise<void> {
  const response = await fetch("/api/dummy/v1/me", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Chưa tải được portal.");
  data = (await response.json()) as Dashboard;
  if (data.student) {
    dashboard();
    if (query.get("game_challenge")) await play();
  } else auth();
}
app.innerHTML =
  '<div class="initial-loading">R² <span>Đang mở portal sinh viên…</span></div>';
void load().catch(() => {
  app.innerHTML =
    '<main class="error-page"><h1>Portal đang tạm dừng</h1><p>Chưa thể kết nối đến máy chủ.</p><button onclick="location.reload()">Thử lại</button></main>';
});
window.setInterval(() => {
  if (data?.student && !document.hidden) void refresh();
}, 5000);
