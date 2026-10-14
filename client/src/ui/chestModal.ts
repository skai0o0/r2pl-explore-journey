// client/src/ui/chestModal.ts
/**
 * Dedicated Chest Modal with Predator HUD Requirements Checklist & Loot Preview
 */
import { GAME_CONFIG, type WorldObject } from "../../../shared/gameplay/gameConfig.ts";
import { Icons } from "./icons.ts";

export interface ChestView {
  id: string;
  tier: "aspire" | "nitro" | "predator";
  x: number;
  z: number;
  keysCount: number;
  claimed: boolean;
  discovered: boolean;
}

export interface ChestModalCallbacks {
  onOpenChest: (id: string) => void;
  onFindKey?: (tier: string) => void;
  onGuidePath?: (x: number, z: number) => void;
}

export class ChestModal {
  private overlay: HTMLElement;
  private currentData: ChestView | null = null;
  private isOpen = false;

  constructor(private callbacks: ChestModalCallbacks) {
    this.overlay = document.createElement("div");
    this.overlay.className = "chest-modal-overlay";
    this.overlay.setAttribute("data-ui", "true");
    this.overlay.style.display = "none";

    const stopProp = (e: Event) => e.stopPropagation();
    this.overlay.addEventListener("pointerdown", stopProp);
    this.overlay.addEventListener("pointerup", stopProp);
    this.overlay.addEventListener("mousedown", stopProp);
    this.overlay.addEventListener("mouseup", stopProp);
    this.overlay.addEventListener("touchstart", stopProp, { passive: true });
    this.overlay.addEventListener("touchend", stopProp, { passive: true });

    document.body.appendChild(this.overlay);

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
  }

  public open(data: ChestView): void {
    this.currentData = { ...data };
    this.isOpen = true;
    this.overlay.style.display = "flex";
    this.render();
  }

  public close(): void {
    this.isOpen = false;
    this.overlay.style.display = "none";
    this.currentData = null;
  }

  public isVisible(): boolean {
    return this.isOpen;
  }

  private render(): void {
    if (!this.currentData) return;
    const d = this.currentData;
    const tierName = d.tier === "predator" ? "Predator" : d.tier === "nitro" ? "Nitro" : "Aspire";
    const tierColor = d.tier === "predator" ? "#a855f7" : d.tier === "nitro" ? "#00ffe8" : "#fbbf24";

    const hasKey = d.keysCount >= 1;
    const canOpen = hasKey && !d.claimed;

    // Drop table preview
    const outcomes = GAME_CONFIG.rewards.chest[d.tier]?.outcomes ?? [];
    const totalWeight = outcomes.reduce((sum, r) => sum + r.weight, 0);

    const lootRows = outcomes.map((r) => {
      const pct = totalWeight > 0 ? ((r.weight / totalWeight) * 100).toFixed(0) : "0";
      const name =
        r.kind === "gift"
          ? "🎁 Quà Hiện Vật Predator"
          : r.kind === "crystals"
            ? `💎 Tinh Thể ×${r.quantity}`
            : r.kind === "points"
              ? `⚡ Điểm Tri Thức ×${r.quantity}`
              : r.kind === "key"
                ? `🔑 Chìa Khóa ×${r.quantity}`
                : `🗺️ Bản Đồ Kho Báu ×${r.quantity}`;
      return `
        <div class="loot-preview-row">
          <span class="loot-name">${name}</span>
          <span class="loot-pct">${pct}%</span>
        </div>
      `;
    }).join("");

    this.overlay.innerHTML = `
      <div class="chest-modal-dialog">
        <!-- Header -->
        <div class="chest-modal-header">
          <div class="chest-header-left">
            <div class="chest-brand-tag" style="--tier-color: ${tierColor};">
              <span class="brand-predator-text">[PREDATOR]</span>
              <span class="brand-badge">${tierName.toUpperCase()} CHEST</span>
            </div>
            <h2 class="chest-title">RƯƠNG KHO BÁU TRI THỨC</h2>
            <div class="chest-coords">Tọa độ bí mật: (${d.x}, ${d.z})</div>
          </div>
          <button class="chest-close-btn" id="chest-btn-close" title="Đóng [Esc]">×</button>
        </div>

        <!-- Body -->
        <div class="chest-modal-body">
          <div class="chest-art-banner" style="--tier-color: ${tierColor};">
            <div class="chest-visual-glow"></div>
            <div class="chest-icon-large">${Icons.box(44)}</div>
            <div class="chest-tier-badge" style="background: ${tierColor}22; border-color: ${tierColor}; color: ${tierColor};">
              BẬC ${tierName.toUpperCase()}
            </div>
          </div>

          <!-- Requirements Checklist -->
          <div class="requirements-checklist-card">
            <div class="checklist-header">
              <span class="checklist-title">ĐIỀU KIỆN MỞ RƯƠNG BÁU</span>
            </div>

            <!-- Item 1: Discovered -->
            <div class="checklist-item ok">
              <span class="check-icon">✅</span>
              <div class="check-info">
                <strong>Vị trí kho báu:</strong>
                <span>Đã định vị chính xác tại tọa độ (${d.x}, ${d.z})</span>
              </div>
            </div>

            <!-- Item 2: Key requirement -->
            <div class="checklist-item ${hasKey ? "ok" : "fail"}">
              <span class="check-icon">${hasKey ? "✅" : "❌"}</span>
              <div class="check-info">
                <strong>Chìa khóa mở rương:</strong>
                <span>Yêu cầu 1 Chìa Khóa ${tierName} (Đang có: <strong>${d.keysCount}</strong> chìa)</span>
                ${
                  !hasKey
                    ? `
                  <div class="check-action-row">
                    <button type="button" class="btn-check-guide" id="btn-find-key">
                      🧭 Tìm chìa tại Trạm tiếp tế cùng bậc
                    </button>
                  </div>
                `
                    : ""
                }
              </div>
            </div>

            <!-- Item 3: Claimed status -->
            <div class="checklist-item ${!d.claimed ? "ok" : "fail"}">
              <span class="check-icon">${!d.claimed ? "✅" : "❌"}</span>
              <div class="check-info">
                <strong>Trạng thái rương:</strong>
                <span>${!d.claimed ? "Rương còn nguyên vẹn, sẵn sàng mở!" : "Rương đã được mở trước đó."}</span>
              </div>
            </div>
          </div>

          <!-- Drop Rates -->
          <div class="loot-table-card">
            <div class="loot-table-header">
              ${Icons.sparkles(14)}
              <span>TỶ LỆ RƠI VẬT PHẨM TỪ RƯƠNG NÀY</span>
            </div>
            <div class="loot-table-grid">
              ${lootRows}
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="chest-modal-footer">
          <button type="button" class="btn-open-chest" id="btn-do-open" ${canOpen ? "" : "disabled"}>
            ${Icons.sparkles(16)}
            <span>${canOpen ? "Mở Rương Báu (1 Key)" : hasKey ? "Rương Đã Mở" : "Cần 1 Chìa Khóa"}</span>
          </button>
          <button type="button" class="btn-close-chest" id="btn-footer-close">
            Đóng
          </button>
        </div>
      </div>
    `;

    // Bind events
    this.overlay.querySelector("#chest-btn-close")?.addEventListener("click", () => this.close());
    this.overlay.querySelector("#btn-footer-close")?.addEventListener("click", () => this.close());

    const openBtn = this.overlay.querySelector("#btn-do-open");
    openBtn?.addEventListener("click", () => {
      if (!canOpen || !this.currentData) return;
      const id = this.currentData.id;
      this.close();
      this.callbacks.onOpenChest(id);
    });

    const findKeyBtn = this.overlay.querySelector("#btn-find-key");
    findKeyBtn?.addEventListener("click", () => {
      if (!this.currentData) return;
      this.close();
      this.callbacks.onFindKey?.(this.currentData.tier);
    });
  }
}
