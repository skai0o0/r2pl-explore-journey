import { GAME_CONFIG } from "../../../shared/gameplay/gameConfig.ts";
// client/src/ui/studentActionDock.ts
import { Icons } from "./icons.ts";

export type ActionMode =
  | "explore"
  | "study"
  | "beacon"
  | "bonfire"
  | "claim"
  | "fortify"
  | "attack";
export type DockMode = "explore" | "study" | "beacon";

export interface ModeConfig {
  id: DockMode;
  title: string;
  subtitle?: string;
  cost: number;
  costType: "points" | "crystals";
  icon: (size: any) => string;
  description: string;
}

export interface KeyInventory {
  aspire: number;
  nitro: number;
  predator: number;
}

export const ACTION_MODES: Record<DockMode, ModeConfig> = {
  explore: {
    id: "explore",
    title: "Khám Phá",
    subtitle: "Vùng Tri Thức",
    cost: GAME_CONFIG.knowledge.explorePoints,
    costType: "points",
    icon: Icons.claim,
    description: "Khám phá và mở rộng ô tri thức hoang sơ tiếp giáp",
  },
  study: {
    id: "study",
    title: "Giao Lưu",
    subtitle: "Ôn bài Tri Thức",
    cost: GAME_CONFIG.knowledge.sharedPoints,
    costType: "points",
    icon: Icons.book,
    description:
      "Giao lưu ô tri thức tiếp giáp: tối đa hai trường; ô của trường mình không mất Điểm",
  },
  beacon: {
    id: "beacon",
    title: "Thắp Đèn Hiệu",
    subtitle: "Công Trình",
    cost: GAME_CONFIG.landmark.baseCrystals,
    costType: "crystals",
    icon: Icons.crystal,
    description: "Nạp Tinh thể để thắp sáng Đèn hiệu Công trình tri thức",
  },
};

// Backward-compatibility alias
(ACTION_MODES as any).bonfire = ACTION_MODES.beacon;

export class StudentActionDock {
  private container: HTMLElement;
  private currentMode: DockMode = "explore";
  private smartMode = true;
  private points: number = 500;
  private crystals: number = 0;
  private keys: KeyInventory = { aspire: 0, nitro: 0, predator: 0 };
  public client?: { send: (type: string, message?: any) => void } | any;

  private onModeChangeCallback?: (mode: DockMode) => void;
  public onToggleSmart?: (enabled: boolean) => void;
  public onBeaconAction?: () => void;
  public onBonfireAction?: () => void;

  constructor(parent?: HTMLElement, client?: any) {
    this.client = client;
    this.container = document.createElement("div");
    this.container.className = "student-mode-dock";
    this.container.setAttribute("data-ui", "true");

    // Isolate all pointer/mouse/touch interactions from propagating to 3D canvas
    const stopProp = (e: Event) => e.stopPropagation();
    this.container.addEventListener("pointerdown", stopProp);
    this.container.addEventListener("pointerup", stopProp);
    this.container.addEventListener("mousedown", stopProp);
    this.container.addEventListener("mouseup", stopProp);
    this.container.addEventListener("touchstart", stopProp, { passive: true });
    this.container.addEventListener("touchend", stopProp, { passive: true });

    this.render();
    (parent || document.body).appendChild(this.container);
    this.bindEvents();
  }

  public setClient(client: any): void {
    this.client = client;
  }

  public getActiveMode(): DockMode {
    return this.currentMode;
  }

  public setMode(mode: ActionMode | string): void {
    // Normalize legacy modes
    let normalized: DockMode = "explore";
    if (mode === "explore" || mode === "claim") normalized = "explore";
    else if (mode === "study" || mode === "fortify" || mode === "attack")
      normalized = "study";
    else if (mode === "beacon" || mode === "bonfire") normalized = "beacon";

    if (this.currentMode === normalized) return;
    this.currentMode = normalized;
    this.render();
    this.bindEvents();
  }

  public onModeChange(cb: (mode: DockMode) => void): void {
    this.onModeChangeCallback = cb;
  }

  public isSmart(): boolean {
    return this.smartMode;
  }

  public setSmartMode(enabled: boolean): void {
    this.smartMode = enabled;
    this.render();
    this.bindEvents();
  }

  /**
   * Set student knowledge points (Điểm Tri Thức)
   */
  public setPoints(points: number): void {
    if (this.points === points) return;
    this.points = points;
  }

  /**
   * Set student crystals (Tinh Thể)
   */
  public setCrystals(crystals: number): void {
    if (this.crystals === crystals) return;
    this.crystals = crystals;
  }

  /**
   * Set student keys (Aspire, Nitro, Predator)
   */
  public setKeys(aspireOrAll: any, nitro?: number, predator?: number): void {
    if (typeof aspireOrAll === "object" && aspireOrAll !== null) {
      this.keys = {
        aspire: aspireOrAll.aspire || aspireOrAll.silver || 0,
        nitro: aspireOrAll.nitro || aspireOrAll.gold || 0,
        predator: aspireOrAll.predator || aspireOrAll.platinum || 0,
      };
    } else if (typeof aspireOrAll === "number") {
      this.keys = {
        aspire: aspireOrAll,
        nitro: nitro || 0,
        predator: predator || 0,
      };
    }
  }

  public updateResources(points: number, crystals: number, keys?: any): void {
    this.setPoints(points);
    this.setCrystals(crystals);
    if (keys !== undefined) this.setKeys(keys);
  }

  // Compatibility helpers
  public setSelectedTile(_tile: any): void {}
  public onClaim(_cb: (tile: any) => void): void {}
  public onResetCamera(_cb: () => void): void {}

  private render(): void {
    const modes = [
      ACTION_MODES.explore,
      ACTION_MODES.study,
      ACTION_MODES.beacon,
    ];

    this.container.innerHTML = `
      <div class="mode-dock-bar">
        <!-- 2. Header Bar: Smart Mode Switcher -->
        <div class="dock-header-bar">
          <button class="smart-toggle-pill ${this.smartMode ? "active" : ""}" id="btn-smart-toggle" aria-pressed="${this.smartMode}" title="Chọn Tự Động hoặc tự chọn thao tác">
            <span class="smart-indicator"></span>
            <span class="smart-icon">${Icons.lightning(13)}</span>
            <span class="smart-text">${this.smartMode ? "Tự Động" : "Thủ Công"}</span>
          </button>
          <span class="dock-label-hint">${this.smartMode ? "Tự chọn thao tác khi chạm ô" : "Chọn thao tác tương tác:"}</span>
        </div>

        <!-- 3. Action Buttons Group: Khám Phá | Ôn Bài | Thắp Đèn Hiệu -->
        <div class="mode-buttons-group">
          ${modes
            .map((mode) => {
              const isActive = this.currentMode === mode.id;
              const isBeacon = mode.id === "beacon";
              const isStudy = mode.id === "study";
              const costIcon = isBeacon ? Icons.crystal(12) : Icons.point(12);
              const costUnit = isBeacon ? "Tinh thể" : "Điểm";

              return `
              <button
                class="mode-btn ${isActive ? "is-active" : ""} ${isBeacon ? "mode-beacon-btn mode-bonfire-btn" : ""} ${isStudy ? "mode-study-btn" : ""}"
                data-mode="${mode.id}"
                title="${mode.description}" aria-pressed="${isActive}" aria-label="${mode.title}, ${mode.cost} ${costUnit}"
              >
                <span class="mode-icon">${mode.icon("sm")}</span>
                <span class="mode-text-wrap">
                  <span class="mode-name">${mode.title}</span>
                </span>
                <span class="mode-cost" title="Chi phí: ${mode.cost} ${costUnit}">
                  ${costIcon}
                  <strong>${mode.cost}</strong>
                </span>
              </button>
            `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    const smartToggleBtn = this.container.querySelector("#btn-smart-toggle");
    smartToggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.smartMode = !this.smartMode;
      this.render();
      this.bindEvents();
      this.onToggleSmart?.(this.smartMode);
    });

    const buttons = this.container.querySelectorAll(".mode-btn");
    buttons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rawMode = btn.getAttribute("data-mode");
        const mode = (rawMode === "bonfire" ? "beacon" : rawMode) as DockMode;
        if (mode) {
          if (mode === "beacon") {
            this.onBeaconAction?.();
            this.onBonfireAction?.();
          }
          if (mode !== this.currentMode) {
            this.currentMode = mode;
            this.render();
            this.bindEvents();
            this.onModeChangeCallback?.(this.currentMode);
          }
        }
      });
    });
  }
}
