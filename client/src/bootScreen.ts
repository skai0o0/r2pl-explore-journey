import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import "./bootScreen.css";

const stages = [
  "Xác thực tài khoản",
  "Tải hồ sơ & ví",
  "Chuẩn bị cảnh 3D",
  "Kết nối bản đồ",
  "Sẵn sàng khám phá",
];
let overlay: HTMLElement | undefined, timer: number | undefined;
const completed = new Set<number>();
function create(): HTMLElement {
  if (overlay) return overlay;
  overlay = document.createElement("section");
  overlay.className = "journey-boot";
  overlay.setAttribute("aria-label", "Chuẩn bị hành trình");
  overlay.innerHTML =
    '<div class="boot-orbit" aria-hidden="true"><span></span><span></span><span></span></div><div class="boot-card"><a class="boot-brand" href="/"><img src="/Headline.png" alt="Road to Predator League 2027"><small>HÀNH TRÌNH KHÁM PHÁ</small></a><div class="boot-content"></div><footer>CHẠY CÙNG TRƯỜNG · MỞ RỘNG HÀNH TRÌNH</footer></div>';
  document.body.append(overlay);
  return overlay;
}
export function loadingStage(index: number): void {
  const element = create(),
    content = element.querySelector(".boot-content")!;
  if (element.dataset.failed === "true") return;
  content.replaceChildren();
  const kicker = document.createElement("p"),
    title = document.createElement("h1"),
    note = document.createElement("p"),
    list = document.createElement("ol");
  kicker.className = "boot-kicker";
  kicker.textContent = "HÀNH TRÌNH CỦA BẠN";
  title.textContent = "Sẵn sàng khám phá?";
  note.className = "boot-note";
  note.textContent = "Đang chuẩn bị bản đồ, hồ sơ và số dư mới nhất của bạn.";
  list.className = "boot-stages";
  list.setAttribute("aria-live", "polite");
  for (const [i, stage] of stages.entries()) {
    const row = document.createElement("li");
    row.textContent = stage;
    row.dataset.state = completed.has(i)
      ? "done"
      : i === index
        ? "active"
        : "waiting";
    list.append(row);
  }
  content.append(kicker, title, note, list);
  if (!timer)
    timer = window.setTimeout(
      () =>
        bootFailure(
          "Kết nối mất nhiều thời gian hơn dự kiến. Bạn có thể thử lại.",
        ),
      GAME_CONFIG.integration.bootstrapTimeoutMs,
    );
}
export function completeStage(index: number): void {
  completed.add(index);
}
export function finishBoot(): void {
  if (overlay?.dataset.failed === "true") return;
  window.clearTimeout(timer);
  timer = undefined;
  overlay?.remove();
  overlay = undefined;
}
export function bootFailure(message: string): void {
  const root = create();
  root.dataset.failed = "true";
  window.clearTimeout(timer);
  const content = root.querySelector(".boot-content")!;
  content.replaceChildren();
  const title = document.createElement("h1"),
    note = document.createElement("p"),
    retry = document.createElement("button");
  title.textContent = "Hành trình đang tạm dừng";
  note.textContent = message;
  note.className = "boot-note";
  retry.textContent = "Thử kết nối lại";
  retry.className = "boot-primary";
  retry.onclick = () => location.reload();
  content.append(title, note, retry);
}
export function loginScreen(
  message: string,
  login: () => Promise<void>,
  portalUrl: string,
): Promise<never> {
  const root = create();
  root.dataset.screen = "login";
  window.clearTimeout(timer);
  timer = undefined;
  const content = root.querySelector(".boot-content")!;
  content.replaceChildren();
  const kicker = document.createElement("p"),
    title = document.createElement("h1"),
    note = document.createElement("p"),
    button = document.createElement("button"),
    link = document.createElement("a");
  kicker.className = "boot-kicker";
  kicker.textContent = "TỪ ĐƯỜNG CHẠY ĐẾN BẢN ĐỒ";
  title.innerHTML = "Mỗi bước chạy.<br>Một vùng đất mới.";
  note.className = "boot-note";
  note.textContent = message;
  button.className = "boot-primary";
  button.textContent = "Đăng nhập qua web giải chạy ↗";
  button.onclick = async () => {
    button.disabled = true;
    try {
      await login();
    } catch {
      note.textContent = "Chưa thể mở đăng nhập. Vui lòng thử lại.";
      button.disabled = false;
    }
  };
  link.className = "boot-secondary";
  link.href = new URL("/", portalUrl).href;
  link.textContent = "Chưa có tài khoản? Mở portal sinh viên";
  const steps = document.createElement("p");
  steps.className = "boot-how";
  steps.textContent =
    "01  Đăng nhập sinh viên    02  Đồng bộ thành tích    03  Khám phá cùng trường";
  content.append(kicker, title, note, button, link, steps);
  return new Promise<never>(() => {});
}
