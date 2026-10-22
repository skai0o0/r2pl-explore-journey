import { preserveSurface, UiOverlay } from "./overlay.ts";
import { GAME_CONFIG } from "../../../shared/gameplay/gameConfig.ts";
import { Icons } from "./icons.ts";
// client/src/ui/landmarkModal.ts
import {
  BEACON_CRYSTALS,
  getSchoolColor,
  SCHOOL_ROSTER,
} from "./v1Adapters.ts";

export interface LandmarkModalData {
  landmarkId: string;
  footprint: { width: number; height: number };
  buffDescription: string;
  x: number;
  y: number;
  currentCrystals: number;
  maxCrystals: number;
  litBySchoolId: string;
  buffActive: boolean;
  crystalsBySchool: Record<string, number>;
  userPoints: number;
  userCrystals?: number | undefined;
  contributionCapacity?: number | undefined;
  activeBeaconName?: string | undefined;
  rallied?: boolean | undefined;
  playerSchoolId: string;
  hasPath?: boolean | undefined;
  distanceToPerimeter?: number;
  closestFrontier?: { x: number; z: number };
  // Aliases for compatibility
  currentFuel?: number | undefined;
  maxFuel?: number | undefined;
  fuelBySchool?: Record<string, number>;
}

export interface LandmarkModalCallbacks {
  onContributeCrystal: (landmarkId: string, amount: number) => void;
  onContributeFuel?: (landmarkId: string, amount: number) => void;
  onFocusLandmark?: (x: number, y: number) => void;
  onGuidePath?: (x: number, y: number) => void;
  onConvertPoints?: (amount: number) => void;
  onRally?: (landmarkId: string) => void;
}

export class LandmarkModal {
  private surface: UiOverlay;
  private overlay: HTMLElement;
  private callbacks: LandmarkModalCallbacks;
  private currentLandmarkId: string | null = null;
  private currentData: LandmarkModalData | null = null;
  private isOpen = false;
  private pending = false;
  public onConvertPoints?: (amount: number) => void;

  constructor(callbacks: LandmarkModalCallbacks) {
    this.callbacks = callbacks;
    this.overlay = document.createElement("div");
    this.overlay.className = "lm-modal-overlay";
    this.overlay.setAttribute("data-ui", "true");
    this.overlay.style.display = "none";

    // Isolate pointer and touch events from 3D scene canvas
    const stopProp = (e: Event) => e.stopPropagation();
    this.overlay.addEventListener("pointerdown", stopProp);
    this.overlay.addEventListener("pointerup", stopProp);
    this.overlay.addEventListener("mousedown", stopProp);
    this.overlay.addEventListener("mouseup", stopProp);
    this.overlay.addEventListener("touchstart", stopProp, { passive: true });
    this.overlay.addEventListener("touchend", stopProp, { passive: true });

    document.body.appendChild(this.overlay);
    this.surface = new UiOverlay(
      this.overlay,
      () => this.close(),
      "Công trình và đèn hiệu",
    );

    this.bindGlobalEvents();
    this.bindLitEventListeners();
  }

  /**
   * Listen to both 'beacon_lit' and 'landmark_lit' window events
   */
  private bindLitEventListeners(): void {
    const handleLitEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent.detail;
      if (!detail) return;
      this.onBeaconLit(detail);
    };

    window.addEventListener("beacon_lit", handleLitEvent);
    window.addEventListener("landmark_lit", handleLitEvent);
  }

  /**
   * Handle beacon lit notification from socket or custom event
   */
  public onBeaconLit(data: {
    landmarkId: string;
    schoolId: string;
    crystals?: number | undefined;
    fuel?: number;
  }): void {
    if (!this.isOpen || !this.currentData) return;
    if (this.currentLandmarkId === data.landmarkId) {
      if (data.schoolId) {
        this.currentData.litBySchoolId = data.schoolId;
        this.currentData.buffActive = true;
      }
      const newCrystals =
        data.crystals !== undefined ? data.crystals : data.fuel;
      if (newCrystals !== undefined) {
        this.currentData.currentCrystals = newCrystals;
      }
      this.render();
    }
  }

  /**
   * Backward-compatibility alias for onBeaconLit
   */
  public onLandmarkLit(data: {
    landmarkId: string;
    schoolId: string;
    crystals?: number | undefined;
    fuel?: number;
  }): void {
    this.onBeaconLit(data);
  }

  public open(data: LandmarkModalData): void {
    this.currentLandmarkId = data.landmarkId;
    this.currentData = { ...data };
    this.isOpen = true;
    this.overlay.style.display = "flex";
    this.render();
    this.surface.open();
  }

  public show(data: LandmarkModalData): void {
    this.open(data);
  }

  public setPending(value: boolean): void {
    this.pending = value;
    this.overlay.setAttribute("aria-busy", String(value));
    this.overlay
      .querySelectorAll<HTMLButtonElement>(
        "button[data-amount],#lm-rally",
      )
      .forEach((button) => {
        if (value) {
          button.dataset.beforePending = String(button.disabled);
          button.disabled = true;
        } else if (button.dataset.beforePending !== undefined) {
          button.disabled = button.dataset.beforePending === "true";
          delete button.dataset.beforePending;
        }
      });
  }

  public update(data: LandmarkModalData): void {
    if (!this.isOpen || this.currentLandmarkId !== data.landmarkId) return;
    if (JSON.stringify(this.currentData) === JSON.stringify(data)) return;
    this.currentData = { ...data };
    this.render();
  }

  public close(): void {
    this.isOpen = false;
    this.overlay.style.display = "none";
    this.surface.close();
    this.currentLandmarkId = null;
    this.currentData = null;
  }

  public isVisible(): boolean {
    return this.isOpen;
  }

  public getCurrentLandmarkId(): string | null {
    return this.currentLandmarkId;
  }

  private bindGlobalEvents(): void {
    this.overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target === this.overlay) {
        this.close();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.close();
      }
    });
  }

  private render(): void {
    if (!this.currentData) return;
    const restore = preserveSurface(this.overlay);

    const data = this.currentData;
    const isLit = !!data.litBySchoolId && data.litBySchoolId !== "";
    const litSchool = isLit ? SCHOOL_ROSTER[data.litBySchoolId] : null;
    const litSchoolColor = isLit
      ? getSchoolColor(data.litBySchoolId)
      : "#00ffe8";
    const litSchoolName = litSchool
      ? litSchool.name
      : "Chưa có trường nào thắp Đèn hiệu";

    const curCrystals =
      data.currentCrystals !== undefined
        ? data.currentCrystals
        : data.currentFuel || 0;
    const maxCrystals = data.maxCrystals || BEACON_CRYSTALS;
    const crystalPercent = Math.min(
      100,
      Math.round((curCrystals / maxCrystals) * 100),
    );

    // Calculate school rankings for crystal contribution
    const crystalSource = data.crystalsBySchool || data.fuelBySchool || {};
    const myCrystals = crystalSource[data.playerSchoolId] || 0;
    const targetCrystals = maxCrystals;
    // Personal user balances
    const userCrystals = data.userCrystals || 0;
    const capacity = data.contributionCapacity ?? userCrystals;

    this.overlay.innerHTML = `
      <div class="lm-modal-dialog">
        <!-- Top HUD Header -->
        <div class="lm-modal-header">
          <div class="lm-header-left">
            <div class="lm-modal-kicker">
              <span class="lm-kicker-icon">${Icons.beacon(16)}</span>
              <span>ĐÈN HIỆU CỦA TRƯỜNG</span>
            </div>
            <div class="lm-title-wrap">
              <h2 class="lm-title">CÔNG TRÌNH BÍ ẨN</h2>
            </div>
          </div>
          <button class="lm-modal-close" id="lm-btn-close" title="Đóng [Esc]" aria-label="Đóng công trình">
            ${Icons.close(18)}
          </button>
        </div>

        <!-- Scrollable Modal Content -->
        <div class="lm-modal-body">
          <!-- 1. Beacon Status Banner -->
          <div class="lm-beacon-banner lm-flame-banner ${isLit ? "is-lit" : "is-unlit"}" style="--school-color: ${litSchoolColor};">
            <div class="lm-flame-status-left">
              <div class="lm-beacon-orb lm-flame-orb ${isLit ? "lit-pulse" : ""}" style="color: ${isLit ? litSchoolColor : "#00ffe8"};">
                ${Icons.beacon(28)}
              </div>
              <div class="lm-flame-meta">
                <span class="lm-meta-sub">TRẠNG THÁI ĐÈN HIỆU CÔNG TRÌNH</span>
                <div class="lm-meta-main">
                  ${
                    isLit
                      ? `<span class="lm-status-text lit">ĐANG THẮP ĐÈN HIỆU BỞI:</span> <strong class="lm-school-highlight" style="color: ${litSchoolColor};">${litSchoolName}</strong>`
                      : `<span class="lm-status-text unlit">CHƯA THẮP ĐÈN HIỆU (CẦN NẠP ĐỦ ${maxCrystals} TINH THỂ)</span>`
                  }
                </div>
              </div>
            </div>
            <div class="lm-flame-status-right">
              <div class="lm-fuel-metric lm-crystal-metric">
                <span class="lm-metric-value" style="color: ${isLit ? litSchoolColor : "#00ffe8"};">${curCrystals}</span>
                <span class="lm-metric-divider">/</span>
                <span class="lm-metric-max">${maxCrystals}</span>
                <span class="lm-metric-unit">Tinh thể</span>
              </div>
            </div>
          </div>

          <!-- Requirements Checklist -->
          <div class="requirements-checklist-card">
            <div class="checklist-header">
              <span class="checklist-title">Điều kiện tương tác</span>
            </div>

            <!-- Item 1: Territory connection -->
            <div class="checklist-item ${data.hasPath !== false ? "ok" : "fail"}">
              <span class="check-icon">${data.hasPath !== false ? "✓" : "×"}</span>
              <div class="check-info">
                <strong>Đường tiếp cận</strong>
                <span>${
                  data.hasPath !== false
                    ? "Tri thức trường đã chạm công trình. Có thể nạp vào quỹ."
                    : `Chưa chạm vùng Tri thức${data.distanceToPerimeter ? ` (Cách rìa gần nhất ${data.distanceToPerimeter} ô)` : ""} — Cần mở đường chạm viền công trình để nạp Tinh Thể`
                }</span>
                ${
                  data.hasPath === false &&
                  data.x !== undefined &&
                  data.y !== undefined
                    ? `
                  <div class="check-action-row">
                    <button type="button" class="btn-check-guide" id="btn-guide-landmark">
                      ⌖ Đi tới công trình
                    </button>
                  </div>
                `
                    : ""
                }
              </div>
            </div>

          </div>

          <!-- 2. Crystal Progress Bar -->
          <div class="lm-progress-block">
            <div class="lm-progress-header">
              <span class="lm-progress-title">
                ${Icons.crystal(14)}
                <span>Tiến độ Nạp Tinh thể: <strong>${curCrystals} / ${maxCrystals} Tinh thể</strong></span>
              </span>
              <span class="lm-progress-percent" style="color: ${isLit ? "#10b981" : "#00ffe8"};">${crystalPercent}%</span>
            </div>
            <div class="lm-progress-track">
              <div
                class="lm-progress-fill ${isLit ? "lit-fill" : ""}"
                style="width: ${crystalPercent}%; background: ${isLit ? `linear-gradient(90deg, ${litSchoolColor}99, ${litSchoolColor})` : "linear-gradient(90deg, #00ffe8, #0062ff)"}; box-shadow: 0 0 14px ${isLit ? litSchoolColor : "rgba(0, 255, 232, 0.6)"};"
              >
                <div class="lm-progress-glow-head"></div>
              </div>
            </div>
            <div class="lm-progress-note">
              ${
                isLit
                  ? ` Đèn hiệu đang hoạt động cho <strong>${litSchool?.shortName || litSchoolName}</strong>. Mốc thắp tiếp theo tăng cố định ${GAME_CONFIG.landmark.activationStepCrystals} Tinh thể.`
                  : ` Đạt mốc ${maxCrystals} Tinh thể để thắp sáng Đèn hiệu tri thức và kích hoạt đặc quyền toàn trường!`
              }
            </div>
          </div>

          <!-- 3. Buff Description Box -->
          <div class="lm-buff-box ${data.buffActive ? "buff-active" : ""}">
            <div class="lm-buff-header">
              <span class="lm-buff-icon">${Icons.lightning(16)}</span>
              <span class="lm-buff-label">ĐẶC QUYỀN TRI THỨC</span>
              ${
                data.buffActive
                  ? `<span class="lm-buff-badge active">${Icons.check(12)} ĐANG KÍCH HOẠT</span>`
                  : `<span class="lm-buff-badge inactive">${Icons.lock(12)} CHƯA KÍCH HOẠT</span>`
              }
            </div>
            <div class="lm-buff-content">
              ${isLit ? data.buffDescription : "Đặc quyền được xác định khi trường thắp Đèn hiệu."}
            </div>
          </div>

          <!-- 6. Contribution Actions: Nạp Tinh Thể (+10, +20, +50) & Quy đổi Điểm Tri Thức -->
          <div class="lm-contribution-card">
            <div class="lm-contrib-header">
              <div class="lm-contrib-title">
                ${Icons.crystal(16)}
                <span>NẠP TINH THỂ THẮP SÁNG ĐÈN HIỆU</span>
              </div>
            </div>

            <div class="lm-contrib-info">
              Cùng góp đủ mốc để thắp Đèn hiệu cho toàn trường.
              ${data.activeBeaconName ? `Khi đủ mốc, Đèn hiệu ${data.activeBeaconName} sẽ tắt; quỹ tại công trình cũ tiêu tán và buff cũ hết hiệu lực.` : "Mỗi trường chỉ có một Đèn hiệu hoạt động."}
              ${data.rallied ? '<p class="lm-rally-status">Trường đang hiệu triệu tại công trình này.</p>' : ""}
              <button type="button" class="lm-crystal-btn" id="lm-rally" ${data.hasPath === false || data.buffActive ? "disabled" : ""}>Hiệu triệu cùng trường</button>
            </div>

            <div class="lm-deposit-label">Nạp Tinh thể vào Đèn hiệu công trình:</div>
            <div class="lm-contrib-buttons">
              ${[
                ...GAME_CONFIG.landmark.contributionSteps,
                Math.max(0, targetCrystals - myCrystals),
              ]
                .filter(
                  (amount, index, all) =>
                    amount > 0 && all.indexOf(amount) === index,
                )
                .map((amount) => {
                  const canAfford =
                    capacity >= amount &&
                    data.hasPath !== false &&
                    !data.buffActive;
                  return `<button class="lm-crystal-btn ${canAfford ? "can-afford" : "cannot-afford"}" data-amount="${amount}" ${canAfford ? "" : "disabled"}><span class="lm-btn-icon">${Icons.crystal(16)}</span><span class="lm-btn-text">${amount === targetCrystals - myCrystals ? "Nạp đủ mốc" : "Nạp"} +${amount} Tinh Thể</span><span class="lm-btn-cost">-${amount} Tinh Thể</span></button>`;
                })
                .join("")}
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="lm-modal-footer">
          <div class="lm-footer-hint">
            ${Icons.lightning(12)}
            <span>Đèn hiệu kích hoạt đặc quyền cho toàn trường.</span>
          </div>
          <button class="lm-footer-close-btn" id="lm-btn-footer-close">
            Đóng
          </button>
        </div>
      </div>
    `;

    this.bindActionEvents();
    restore();
    if (this.pending) this.setPending(true);
  }

  private bindActionEvents(): void {
    this.overlay.querySelector("#lm-rally")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.currentLandmarkId)
        this.callbacks.onRally?.(this.currentLandmarkId);
    });
    const closeBtn = this.overlay.querySelector("#lm-btn-close");
    closeBtn?.addEventListener("click", () => this.close());

    const footerCloseBtn = this.overlay.querySelector("#lm-btn-footer-close");
    footerCloseBtn?.addEventListener("click", () => this.close());

    // Nạp Tinh thể buttons
    const crystalBtns = this.overlay.querySelectorAll(
      ".lm-fuel-btn.can-afford, .lm-crystal-btn.can-afford",
    );
    crystalBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const amtStr = btn.getAttribute("data-amount");
        if (amtStr && this.currentLandmarkId) {
          const amount = parseInt(amtStr, 10);
          if (amount > 0) {
            if (this.callbacks.onContributeCrystal) {
              this.callbacks.onContributeCrystal(
                this.currentLandmarkId,
                amount,
              );
            } else if (this.callbacks.onContributeFuel) {
              this.callbacks.onContributeFuel(this.currentLandmarkId, amount);
            }
          }
        }
      });
    });

    const guideBtn = this.overlay.querySelector("#btn-guide-landmark");
    guideBtn?.addEventListener("click", () => {
      if (
        this.currentData?.x !== undefined &&
        this.currentData?.y !== undefined
      ) {
        this.close();
        this.callbacks.onGuidePath?.(this.currentData.x, this.currentData.y);
      }
    });
  }
}
