import {
  durationText,
  SCHOOL_ROSTER,
  UNISTOP_CONFIGS,
  type UniStopTier,
  uniStopAvailability,
} from "./v1Adapters.ts";

export interface UniStopView {
  id: string;
  tier: UniStopTier;
  ownerSchoolId?: string | null | undefined;
  schoolId: string;
  cooldownUntil: number;
  profileReady: boolean;
  hasWeeklyRunningPoints: boolean;
}

/** Reads the private profile cooldown, never the station's obsolete global timer. */
export class UniStopModal {
  private overlay = document.createElement("div");
  private data?: UniStopView;
  private timer?: number | undefined;
  private pending = false;
  private requestTimer?: number | undefined;
  private title: HTMLElement;
  private owner: HTMLElement;
  private status: HTMLElement;
  private cooldown: HTMLElement;
  private details: HTMLElement;
  private claim: HTMLButtonElement;
  private previousFocus?: HTMLElement;

  constructor(
    private onClaim: (id: string) => void,
    parent: HTMLElement = document.body,
  ) {
    this.overlay.className = "guidance-modal-overlay";
    this.overlay.setAttribute("data-ui", "true");
    this.overlay.style.display = "none";
    this.overlay.innerHTML = `<section class="guidance-modal" role="dialog" aria-modal="true" aria-labelledby="unistop-title">
      <header><h2 id="unistop-title"></h2><button type="button" class="guidance-close" aria-label="Đóng trạm tiếp tế">×</button></header>
      <p class="unistop-owner"></p><p class="unistop-status" role="status" aria-live="polite"></p>
      <p class="unistop-cooldown"></p><p class="unistop-details"></p>
      <p class="guidance-note">Mỗi sinh viên có lượt riêng tại từng trạm. Lượt không cộng dồn; đổi chủ không xóa thời gian chờ của bạn.</p>
      <button type="button" class="guidance-primary unistop-claim">Nhận lượt tiếp tế</button>
    </section>`;
    this.title = this.overlay.querySelector("h2")!;
    this.owner = this.overlay.querySelector(".unistop-owner")!;
    this.status = this.overlay.querySelector(".unistop-status")!;
    this.cooldown = this.overlay.querySelector(".unistop-cooldown")!;
    this.details = this.overlay.querySelector(".unistop-details")!;
    this.claim = this.overlay.querySelector(".unistop-claim")!;
    this.overlay
      .querySelector(".guidance-close")!
      .addEventListener("click", () => this.close());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
    for (const name of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "touchstart",
      "touchend",
      "click",
    ])
      this.overlay.addEventListener(name, (e) => e.stopPropagation());
    window.addEventListener("keydown", (e) => {
      if (!this.isOpen()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
      if (e.key === "Tab") {
        const buttons = Array.from(
          this.overlay.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    });
    this.claim.addEventListener("click", () => {
      if (!this.data || this.pending || !this.availability().canClaim) return;
      this.pending = true;
      this.render();
      this.requestTimer = window.setTimeout(() => this.finishRequest(), 8000);
      this.onClaim(this.data.id);
    });
    parent.appendChild(this.overlay);
  }
  public isOpen() {
    return this.overlay.style.display !== "none";
  }
  public getStopId() {
    return this.data?.id;
  }
  public open(data: UniStopView) {
    this.close();
    this.previousFocus = document.activeElement as HTMLElement;
    this.data = data;
    this.overlay.style.display = "flex";
    this.render();
    this.timer = window.setInterval(() => this.render(), 1000);
    this.overlay.querySelector<HTMLButtonElement>(".guidance-close")!.focus();
  }
  public update(data: UniStopView) {
    if (data.id !== this.data?.id) return;
    this.data = data;
    this.render();
  }
  public finishRequest() {
    this.pending = false;
    if (this.requestTimer !== undefined) window.clearTimeout(this.requestTimer);
    this.requestTimer = undefined;
    if (this.isOpen()) this.render();
  }
  public close() {
    const wasOpen = this.isOpen();
    this.overlay.style.display = "none";
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.finishRequest();
    if (wasOpen) this.previousFocus?.focus();
  }
  private availability() {
    return uniStopAvailability(
      this.data!.ownerSchoolId,
      this.data!.schoolId,
      this.data!.cooldownUntil,
      Date.now(),
      this.data!.profileReady,
    );
  }
  private render() {
    if (!this.data) return;
    const d = this.data,
      config = UNISTOP_CONFIGS[d.tier],
      state = this.availability();
    this.title.textContent = config.name;
    this.owner.textContent =
      d.ownerSchoolId && SCHOOL_ROSTER[d.ownerSchoolId]
        ? `Trường giữ trạm: ${SCHOOL_ROSTER[d.ownerSchoolId]?.name}`
        : "Trạng thái: Trạm trung lập (Mở đường chạm trạm để trường chiếm giữ)";
    this.status.textContent = this.pending
      ? "Đang nhận kết quả tiếp tế…"
      : {
          syncing: "Đang đồng bộ tài khoản…",
          unowned: "Mở rộng tri thức vào trạm để trường bạn nhận tiếp tế.",
          foreign: "Chỉ sinh viên trường đang giữ trạm được nhận tiếp tế.",
          cooldown: "Bạn đã dùng lượt tại trạm này.",
          ready: "Lượt tiếp tế của bạn đã sẵn sàng!",
        }[state.status];
    this.cooldown.textContent =
      state.remainingSeconds > 0
        ? `Lượt của bạn hồi sau: ${durationText(state.remainingSeconds)}`
        : `Hồi lượt sau mỗi ${config.cooldownMs / 3600000} giờ.`;
    this.details.textContent = !d.profileReady
      ? "Đang kiểm tra điều kiện điểm chạy trong tuần…"
      : d.hasWeeklyRunningPoints
        ? "Bạn có điểm chạy trong tuần. Quà thật vẫn tùy thuộc tier và kết quả quay."
        : "Chưa có điểm chạy trong tuần: vẫn nhận vật phẩm trong game, chưa đủ điều kiện nhận quà thật.";
    this.claim.disabled = !state.canClaim || this.pending;
    this.claim.textContent = this.pending ? "Đang xử lý…" : "Nhận lượt tiếp tế";
  }
}
