// client/src/ui/mapEditorPanel.ts
import { Icons } from "./icons.ts";
import { LANDMARK_ROSTER, SCHOOL_ROSTER } from "./v1Adapters.ts";

export type MapItemType = "hq" | "landmark" | "unistop" | "chest";

export interface MapEditorItem {
  id: string;
  type: MapItemType;
  name: string;
  tier?: string | undefined;
  schoolId?: string | undefined;
  landmarkKey?: string | undefined;
  landmarkId?: string | undefined;
  maxCrystals?: number | undefined | undefined;
  x: number;
  y: number; // or z
  unassigned?: boolean | undefined;
}

export interface MapLayoutPayload {
  version?: string | undefined;
  timestamp?: number | undefined;
  hqs?: { schoolId: string; x: number; y: number }[];
  landmarks?: {
    id: string;
    landmarkKey?: string | undefined;
    x: number;
    y: number;
    maxFuel?: number | undefined;
    maxCrystals?: number | undefined | undefined;
  }[];
  unistops?: {
    id: string;
    name?: string | undefined;
    tier?: string | undefined;
    x: number;
    z: number;
  }[];
  chests?: {
    id: string;
    tier?: string | undefined;
    x: number;
    z: number;
    isOpened?: boolean;
  }[];
}

export interface MapEditorCallbacks {
  onClose?: () => void;
  onFocusItem?: (item: MapEditorItem) => void;
  onItemRelocated?: (item: MapEditorItem, newX: number, newY: number) => void;
  onApplyToServer?: (layout: MapLayoutPayload) => void;
  onImportLayout?: (layout: MapLayoutPayload) => void;
  onNotification?: (
    msg: string,
    type?: "info" | "warning" | "error" | "success",
  ) => void;
}

export class MapEditorPanel {
  public element: HTMLElement;
  private listEl: HTMLElement;
  private fileInput: HTMLInputElement;
  private currentTab: "all" | "hq" | "landmark" | "unistop" | "chest" = "all";
  private items: Map<string, MapEditorItem> = new Map();
  private selectedItemId: string | null = null;
  private relocatingItemId: string | null = null;
  private callbacks: MapEditorCallbacks;
  private isVisible = false;

  constructor(callbacks: MapEditorCallbacks) {
    this.callbacks = callbacks;

    this.element = document.createElement("div");
    this.element.className = "map-editor-panel hidden";
    this.element.setAttribute("data-ui", "true");

    this.element.innerHTML = `
      <div class="map-editor-header">
        <div class="map-editor-title">
          ${Icons.target(16)}
          <span>MAP EDITOR // BỐ CỤC BẢN ĐỒ</span>
        </div>
        <button class="map-editor-close-btn" id="meditor-close" title="Đóng">${Icons.close(16)}</button>
      </div>

      <div class="map-editor-tabs">
        <button class="map-editor-tab-btn active" data-tab="all">Tất cả</button>
        <button class="map-editor-tab-btn" data-tab="hq">Trụ sở HQs</button>
        <button class="map-editor-tab-btn" data-tab="landmark">Biểu tượng</button>
        <button class="map-editor-tab-btn" data-tab="unistop">UniStops</button>
        <button class="map-editor-tab-btn" data-tab="chest">Chests</button>
      </div>

      <div class="map-editor-list" id="meditor-list"></div>

      <div class="map-editor-actions">
        <div class="editor-btn-row">
          <button class="btn-editor-secondary" id="meditor-export">
            ${Icons.sparkles(13)}
            <span>XUẤT CẤU HÌNH</span>
          </button>
          <button class="btn-editor-secondary" id="meditor-import">
            ${Icons.map(13)}
            <span>NẠP CẤU HÌNH</span>
          </button>
        </div>
        <button class="btn-editor-primary" id="meditor-apply">
          ${Icons.lightning(15)}
          <span>ÁP DỤNG NGAY LÊN SERVER</span>
        </button>
      </div>
    `;

    // Hidden file input for import
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".json,application/json";
    this.fileInput.style.display = "none";
    document.body.appendChild(this.fileInput);

    document.body.appendChild(this.element);

    this.listEl = this.element.querySelector("#meditor-list")!;
    this.bindEvents();
  }

  private bindEvents(): void {
    // Isolate pointer events from scene
    const stopProp = (e: Event) => e.stopPropagation();
    this.element.addEventListener("pointerdown", stopProp);
    this.element.addEventListener("mousedown", stopProp);
    this.element.addEventListener("touchstart", stopProp, { passive: true });

    // Close button
    this.element
      .querySelector("#meditor-close")
      ?.addEventListener("click", () => {
        this.close();
      });

    // Tab buttons
    const tabBtns = this.element.querySelectorAll(".map-editor-tab-btn");
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabBtns.forEach((b) => {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        this.currentTab = (btn.getAttribute("data-tab") || "all") as any;
        this.renderList();
      });
    });

    // Export button
    this.element
      .querySelector("#meditor-export")
      ?.addEventListener("click", () => {
        this.exportJson();
      });

    // Import button
    this.element
      .querySelector("#meditor-import")
      ?.addEventListener("click", () => {
        this.fileInput.click();
      });

    this.fileInput.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.importJsonFile(file);
      }
      this.fileInput.value = "";
    });

    // Apply to Server button
    this.element
      .querySelector("#meditor-apply")
      ?.addEventListener("click", () => {
        this.applyToServer();
      });
  }

  public updateData(
    hqs: { schoolId: string; x: number; y: number }[],
    landmarks: {
      id: string;
      landmarkKey?: string | undefined;
      x: number;
      y: number;
      maxFuel?: number | undefined;
      maxCrystals?: number | undefined;
    }[],
    unistops: {
      id: string;
      name?: string | undefined;
      tier?: string | undefined;
      x: number;
      z: number;
    }[],
    chests: {
      id: string;
      tier?: string | undefined;
      x: number;
      z: number;
      isOpened?: boolean;
    }[],
  ): void {
    this.items.clear();

    // 1. HQs
    for (const hq of hqs) {
      const school = SCHOOL_ROSTER[hq.schoolId];
      const name = `Trụ sở ${school?.shortName || hq.schoolId.toUpperCase()}`;
      this.items.set(`hq_${hq.schoolId}`, {
        id: `hq_${hq.schoolId}`,
        type: "hq",
        schoolId: hq.schoolId,
        name,
        x: hq.x,
        y: hq.y,
      });
    }

    for (const school of Object.values(SCHOOL_ROSTER))
      if (!hqs.some((h) => h.schoolId === school.id)) {
        this.items.set(`hq_${school.id}`, {
          id: `hq_${school.id}`,
          type: "hq",
          schoolId: school.id,
          name: `Trụ sở ${school.shortName}`,
          x: NaN,
          y: NaN,
          unassigned: true,
        });
      }
    // 2. Landmarks
    for (const lm of landmarks) {
      const key = lm.landmarkKey || lm.id;
      const config = LANDMARK_ROSTER[key];
      const name = config?.name || `Biểu tượng ${key}`;
      this.items.set(`lm_${key}`, {
        id: `lm_${key}`,
        type: "landmark",
        landmarkKey: key,
        landmarkId: lm.id,
        maxCrystals: lm.maxCrystals ?? lm.maxFuel,
        name,
        x: lm.x,
        y: lm.y,
      });
    }

    // 3. UniStops
    for (const u of unistops) {
      const tier = u.tier || "aspire";
      const name = u.name || `UniStop - ${tier.toUpperCase()}`;
      this.items.set(u.id, {
        id: u.id,
        type: "unistop",
        tier,
        name,
        x: u.x,
        y: u.z,
      });
    }

    // 4. Chests
    for (const c of chests) {
      const tier = c.tier || "aspire";
      const name = `Rương ${tier.toUpperCase()}${c.isOpened ? " (Đã mở)" : ""}`;
      this.items.set(c.id, {
        id: c.id,
        type: "chest",
        tier,
        name,
        x: c.x,
        y: c.z,
      });
    }

    this.renderList();
  }

  private renderList(): void {
    this.listEl.innerHTML = "";

    const filtered = Array.from(this.items.values()).filter((item) => {
      if (this.currentTab === "all") return true;
      return item.type === this.currentTab;
    });

    if (filtered.length === 0) {
      this.listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b; font-size:11px;">Không có đối tượng nào trong mục này.</div>`;
      return;
    }

    filtered.forEach((item) => {
      const row = document.createElement("div");
      row.className = `map-editor-item ${this.selectedItemId === item.id ? "selected" : ""}`;
      row.dataset.id = item.id;

      const isRelocating = this.relocatingItemId === item.id;

      row.innerHTML = `
        <div class="editor-item-info">
          <span class="editor-item-name">${item.name}</span>
          <span class="editor-item-coords">${item.unassigned ? "Chưa bố trí — chọn Đặt vị trí" : `[X: ${item.x}, Z: ${item.y}]`}</span>
        </div>
        <button class="editor-relocate-btn ${isRelocating ? "active" : ""}" data-relocate-id="${item.id}" title="Click vào bản đồ 3D để di dời">
          ${Icons.crosshair(12)}
          <span>${isRelocating ? "ĐANG CHỜ CLICK..." : "Di dời"}</span>
        </button>
      `;

      // Select item on row click
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".editor-relocate-btn")) return;
        this.selectItem(item);
      });

      // Relocate button click
      const relocateBtn = row.querySelector(
        ".editor-relocate-btn",
      ) as HTMLElement;
      relocateBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startRelocate(item);
      });

      this.listEl.appendChild(row);
    });
  }

  public selectItem(item: MapEditorItem): void {
    this.selectedItemId = item.id;
    this.renderList();
    if (this.callbacks.onFocusItem && !item.unassigned) {
      this.callbacks.onFocusItem(item);
    }
  }

  public startRelocate(item: MapEditorItem): void {
    this.selectedItemId = item.id;
    this.relocatingItemId = item.id;
    this.renderList();

    this.callbacks.onNotification?.(
      `[CHẾ ĐỘ DI DỜI]: Hãy nhấp chuột vào vị trí bất kỳ trên bản đồ 3D để dời "${item.name}"...`,
      "info",
    );
  }

  public isRelocating(): boolean {
    return this.relocatingItemId !== null;
  }

  public getRelocatingItem(): MapEditorItem | null {
    if (!this.relocatingItemId) return null;
    return this.items.get(this.relocatingItemId) || null;
  }

  public completeRelocate(newX: number, newY: number): void {
    if (!this.relocatingItemId) return;
    const item = this.items.get(this.relocatingItemId);
    if (!item) {
      this.relocatingItemId = null;
      return;
    }

    item.unassigned = false;
    item.x = Math.round(newX);
    item.y = Math.round(newY);
    const _relocatedId = this.relocatingItemId;
    this.relocatingItemId = null;

    this.renderList();

    if (this.callbacks.onItemRelocated) {
      this.callbacks.onItemRelocated(item, item.x, item.y);
    }

    this.callbacks.onNotification?.(
      `Đã di dời "${item.name}" tới tọa độ [${item.x}, ${item.y}]!`,
      "success",
    );
  }

  public cancelRelocate(): void {
    this.relocatingItemId = null;
    this.renderList();
  }

  // =========================================================================
  // EXPORT / IMPORT / APPLY
  // =========================================================================

  public generateLayoutPayload(): MapLayoutPayload {
    const hqs: { schoolId: string; x: number; y: number }[] = [];
    const landmarks: {
      id: string;
      landmarkKey?: string | undefined;
      x: number;
      y: number;
      maxFuel?: number | undefined;
      maxCrystals?: number | undefined;
    }[] = [];
    const unistops: {
      id: string;
      name?: string | undefined;
      tier?: string | undefined;
      x: number;
      z: number;
    }[] = [];
    const chests: {
      id: string;
      tier?: string | undefined;
      x: number;
      z: number;
      isOpened?: boolean;
    }[] = [];

    this.items.forEach((item) => {
      if (item.type === "hq" && item.schoolId && !item.unassigned) {
        hqs.push({ schoolId: item.schoolId, x: item.x, y: item.y });
      } else if (item.type === "landmark") {
        const key = item.landmarkKey || item.id.replace("lm_", "");
        landmarks.push({
          id: item.landmarkId || key,
          landmarkKey: key,
          x: item.x,
          y: item.y,
          maxCrystals: item.maxCrystals,
        });
      } else if (item.type === "unistop") {
        unistops.push({
          id: item.id,
          name: item.name,
          tier: item.tier,
          x: item.x,
          z: item.y,
        });
      } else if (item.type === "chest") {
        chests.push({ id: item.id, tier: item.tier, x: item.x, z: item.y });
      }
    });

    return {
      version: "1.0",
      timestamp: Date.now(),
      hqs,
      landmarks,
      unistops,
      chests,
    };
  }

  public exportJson(): void {
    const payload = this.generateLayoutPayload();
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `map-layout-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.callbacks.onNotification?.(
      "Đã xuất file map-layout.json thành công!",
      "success",
    );
  }

  private importJsonFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const layout: MapLayoutPayload = JSON.parse(content);

        if (
          !layout.hqs &&
          !layout.landmarks &&
          !layout.unistops &&
          !layout.chests
        ) {
          throw new Error("Định dạng file không chứa dữ liệu map hợp lệ");
        }

        if (this.callbacks.onImportLayout) {
          this.callbacks.onImportLayout(layout);
        }

        this.callbacks.onNotification?.(
          'Đã nạp file cấu hình bản đồ! Bấm "ÁP DỤNG NGAY LÊN SERVER" để lưu lên server.',
          "success",
        );
      } catch (err: any) {
        this.callbacks.onNotification?.(
          `Lỗi đọc file JSON: ${err.message}`,
          "error",
        );
      }
    };
    reader.readAsText(file);
  }

  public applyToServer(): void {
    const payload = this.generateLayoutPayload();
    if (this.callbacks.onApplyToServer) {
      this.callbacks.onApplyToServer(payload);
    }
    this.callbacks.onNotification?.(
      "Đang gửi bản đồ lên Colyseus Server...",
      "info",
    );
  }

  public toggle(): void {
    if (this.isVisible) {
      this.close();
    } else {
      this.open();
    }
  }

  public open(): void {
    this.isVisible = true;
    this.element.classList.remove("hidden");
    this.renderList();
  }

  public close(): void {
    this.callbacks.onClose?.();
    this.isVisible = false;
    this.relocatingItemId = null;
    this.element.classList.add("hidden");
  }

  public isOpen(): boolean {
    return this.isVisible;
  }
}
