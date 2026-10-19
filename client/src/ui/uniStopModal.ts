// client/src/ui/uniStopModal.ts
import { GAME_CONFIG } from "../../../shared/gameplay/gameConfig.ts";
import { effectiveRewardOutcomes } from "../../../shared/gameplay/giftPool.ts";
import { Icons } from "./icons.ts";
import { preserveSurface, UiOverlay } from "./overlay.ts";
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
  x?: number;
  z?: number;
  ownerSchoolId?: string | null | undefined;
  schoolId: string;
  cooldownUntil: number;
  profileReady: boolean;
  hasWeeklyRunningPoints: boolean;
  giftStock?: number;
  distanceToTerritory?: number;
  closestFrontierTile?: { x: number; z: number };
}

export interface UniStopModalCallbacks {
  onClaim: (id: string) => void;
  onGuidePath?: (targetX: number, targetZ: number) => void;
  onSyncRunning?: () => void;
}

/** Reads the private profile cooldown, never the station's obsolete global timer. */
export class UniStopModal {
  private surface: UiOverlay;
  private overlay = document.createElement("div");
  private data?: UniStopView;
  private timer?: number | undefined;
  private pending = false;
  private requestTimer?: number | undefined;
  private previousFocus?: HTMLElement;
  private callbacks: UniStopModalCallbacks;

  constructor(
    claimOrCallbacks: ((id: string) => void) | UniStopModalCallbacks,
    parent: HTMLElement = document.body,
  ) {
    this.callbacks =
      typeof claimOrCallbacks === "function"
        ? { onClaim: claimOrCallbacks }
        : claimOrCallbacks;

    this.overlay.className = "guidance-modal-overlay unistop-modal-overlay";
    this.overlay.setAttribute("data-ui", "true");
    this.overlay.style.display = "none";

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

    this.overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target === this.overlay) this.close();
    });

    window.addEventListener("keydown", (e) => {
      if (!this.isOpen()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    parent.appendChild(this.overlay);
    this.surface = new UiOverlay(
      this.overlay,
      () => this.close(),
      "Trạm tiếp tế",
    );
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
    this.surface.open();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  public update(data: UniStopView) {
    if (data.id !== this.data?.id) return;
    const changed = JSON.stringify(this.data) !== JSON.stringify(data);
    this.data = data;
    if (changed) this.render();
    else this.tick();
  }

  private tick(): void {
    if (!this.data || !this.isOpen()) return;
    const timer = this.overlay.querySelector(".timer-live");
    const remaining = this.availability().remainingSeconds;
    if (remaining > 0 && timer)
      timer.textContent = this.formatCountdown(remaining);
    else if (remaining === 0 && timer) this.render();
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
    this.surface.close();
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

  private formatCountdown(totalSeconds: number): string {
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  private render() {
    if (!this.data) return;
    const restore = preserveSurface(this.overlay);
    const d = this.data;
    const config = UNISTOP_CONFIGS[d.tier];
    const state = this.availability();

    const isOwnedByMySchool =
      !!d.ownerSchoolId && d.ownerSchoolId === d.schoolId;
    const ownerSchoolName =
      d.ownerSchoolId && SCHOOL_ROSTER[d.ownerSchoolId]
        ? SCHOOL_ROSTER[d.ownerSchoolId]?.name
        : "Trạm Trung Lập";

    const tierName =
      d.tier === "predator"
        ? "Predator"
        : d.tier === "nitro"
          ? "Nitro"
          : "Aspire";
    const tierColor =
      d.tier === "predator"
        ? "#a855f7"
        : d.tier === "nitro"
          ? "#00ffe8"
          : "#fbbf24";

    // Drop table preview
    const outcomes = effectiveRewardOutcomes(
      "unistop",
      d.tier,
      d.giftStock ?? 0,
      d.hasWeeklyRunningPoints,
    );
    const totalWeight = outcomes.reduce((sum, r) => sum + r.weight, 0);

    const lootRows = outcomes
      .map((r) => {
        const pct =
          totalWeight > 0
            ? ((r.weight / totalWeight) * 100).toLocaleString("vi-VN", {
                maximumFractionDigits: 2,
              })
            : "0";
        const name =
          r.kind === "gift"
            ? " Quà Hiện Vật"
            : r.kind === "crystals"
              ? ` Tinh Thể ×${r.quantity}`
              : r.kind === "points"
                ? ` Điểm Tri Thức ×${r.quantity}`
                : r.kind === "key"
                  ? ` Chìa Khóa ×${r.quantity}`
                  : ` Bản Đồ Kho Báu ×${r.quantity}`;
        return `
        <div class="loot-preview-row">
          <span class="loot-name">${name}</span>
          <span class="loot-pct">${pct}%</span>
        </div>
      `;
      })
      .join("");

    this.overlay.innerHTML = `
      <section class="guidance-modal unistop-modal-card">
        <header class="unistop-modal-header">
          <div class="unistop-header-left">
            <div class="unistop-brand-tag" style="--tier-color: ${tierColor};">
              <span class="brand-predator-text">[PREDATOR]</span>
              <span class="brand-badge">TRẠM TIẾP TẾ · ${tierName.toUpperCase()}</span>
            </div>
            <h2 id="unistop-title" class="unistop-title">${config.name}</h2>
            ${d.x !== undefined && d.z !== undefined ? `<div class="unistop-coords">Tọa độ: (${d.x}, ${d.z})</div>` : ""}
          </div>
          <button type="button" class="guidance-close" aria-label="Đóng trạm tiếp tế">×</button>
        </header>

        <div class="unistop-modal-body">
          <!-- Requirements Checklist -->
          <div class="requirements-checklist-card">
            <div class="checklist-header">
              <span class="checklist-title">ĐIỀU KIỆN NHẬN TIẾP TẾ</span>
            </div>

            <!-- Item 1: School Ownership -->
            <div class="checklist-item ${isOwnedByMySchool ? "ok" : "fail"}">
              <span class="check-icon">${isOwnedByMySchool ? "✓" : "×"}</span>
              <div class="check-info">
                <strong>Quyền tiếp tế của trường:</strong>
                <span>${
                  isOwnedByMySchool
                    ? `Trường bạn đang giữ trạm (${ownerSchoolName})`
                    : `Chưa chạm vùng Tri thức (Đang giữ: ${ownerSchoolName}${
                        d.distanceToTerritory
                          ? ` · Cách rìa gần nhất ${d.distanceToTerritory} ô`
                          : ""
                      })`
                }</span>
                ${
                  !isOwnedByMySchool && d.x !== undefined && d.z !== undefined
                    ? `
                  <div class="check-action-row">
                    <button type="button" class="btn-check-guide" id="btn-guide-unistop">
                      ⌖ Đi tới công trình
                    </button>
                  </div>
                `
                    : ""
                }
              </div>
            </div>

            <!-- Item 2: Cooldown Countdown -->
            <div class="checklist-item ${state.remainingSeconds === 0 ? "ok" : "wait"}">
              <span class="check-icon">${state.remainingSeconds === 0 ? "✓" : "×"}</span>
              <div class="check-info">
                <strong>Lượt quay cá nhân:</strong>
                <span>${
                  state.remainingSeconds === 0
                    ? "Sẵn sàng quay lượt tiếp tế!"
                    : `Hồi lượt sau: <strong class="timer-live">${this.formatCountdown(state.remainingSeconds)}</strong>`
                }</span>
              </div>
            </div>

            <!-- Item 3: Weekly Running Gift Eligibility -->
            <div class="checklist-item ${d.hasWeeklyRunningPoints ? "ok" : "warn"}">
              <span class="check-icon">${d.hasWeeklyRunningPoints ? "✓" : "×"}</span>
              <div class="check-info">
                <strong>Điều kiện Quà hiện vật:</strong>
                <span>${
                  d.hasWeeklyRunningPoints
                    ? "Đủ điều kiện nhận Quà thật (Đã đồng bộ km chạy tuần này)"
                    : "Chưa có km chạy tuần: Vẫn nhận đồ ingame (Ô Quà thật sẽ tự chuyển thành Tinh thể ×4)"
                }</span>
                ${
                  !d.hasWeeklyRunningPoints
                    ? `
                  <div class="check-action-row">
                    <button type="button" class="btn-check-guide" id="btn-sync-running">
                       Đồng bộ km chạy
                    </button>
                  </div>
                `
                    : ""
                }
              </div>
            </div>
          </div>

          <!-- Drop Rates Preview -->
          <details class="loot-table-card"><summary class="loot-table-header">
              ${Icons.sparkles(14)}
              <span>TỶ LỆ RƠI VẬT PHẨM TRẠM ${tierName.toUpperCase()}</span>
            </summary><div class="loot-table-grid">
              ${lootRows}
            </div></details>

          <p class="guidance-note">
             Mỗi sinh viên có lượt tiếp tế cá nhân riêng biệt. Đổi chủ trường không xóa lượt chờ của bạn.
          </p>
        </div>

        <footer class="unistop-modal-footer">
          <button type="button" class="guidance-primary unistop-claim" ${!state.canClaim || this.pending ? "disabled" : ""}>
            ${this.pending ? "Đang xử lý…" : state.canClaim ? "Nhận tiếp tế" : !isOwnedByMySchool ? "Cần mở đường tới trạm" : "Đang hồi lượt"}
          </button>
        </footer>
      </section>
    `;

    // Event binding
    this.overlay
      .querySelector(".guidance-close")
      ?.addEventListener("click", () => this.close());

    const claimBtn =
      this.overlay.querySelector<HTMLButtonElement>(".unistop-claim");
    claimBtn?.addEventListener("click", () => {
      if (!this.data || this.pending || !this.availability().canClaim) return;
      this.pending = true;
      this.render();
      this.requestTimer = window.setTimeout(() => this.finishRequest(), 8000);
      this.callbacks.onClaim(this.data.id);
    });

    const guideBtn = this.overlay.querySelector("#btn-guide-unistop");
    guideBtn?.addEventListener("click", () => {
      if (d.x !== undefined && d.z !== undefined) {
        this.close();
        this.callbacks.onGuidePath?.(d.x, d.z);
      }
    });

    const syncBtn = this.overlay.querySelector("#btn-sync-running");
    syncBtn?.addEventListener("click", () => {
      this.callbacks.onSyncRunning?.();
    });
    restore();
  }
}
