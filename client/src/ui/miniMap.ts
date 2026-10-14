import {
  SCHOOLS,
  type WorldObject,
} from "../../../shared/gameplay/gameConfig.ts";
import type { ProjectionReplica } from "../../../shared/protocol/replica.ts";
import { chunkCoordinatesForId } from "../../../shared/world/coordinates.ts";
// client/src/ui/miniMap.ts
import { Icons } from "./icons.ts";

export class MiniMap {
  public element: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size = 160; // 160x160 px
  private playerHQ: { schoolId: string; x: number; y: number } | null = null;
  private isDrawPending = false;
  private objects: readonly WorldObject[] = [];
  private schoolSlot = 0;
  private projections = new Map<
    number,
    { fog: Uint8Array; owned: Uint8Array }
  >();
  public setSchool(slot: number): void {
    this.schoolSlot = slot;
    this.projections.clear();
    this.requestRedraw();
  }
  public paintProjection(id: number, replica: ProjectionReplica): void {
    const fog = new Uint8Array(512),
      owned = new Uint8Array(512);
    for (let local = 0; local < 4096; local++) {
      if (replica.isDiscovered(id, local)) fog[local >> 3]! |= 1 << (local & 7);
      if (replica.maskAt(id, local) & (1 << this.schoolSlot))
        owned[local >> 3]! |= 1 << (local & 7);
    }
    this.projections.set(id, { fog, owned });
    this.requestRedraw();
  }
  public setObjects(objects: readonly WorldObject[]): void {
    this.objects = objects;
    this.requestRedraw();
  }
  // Camera frustum position in 0..1000 world space
  private camX = 500;
  private camZ = 500;
  private camFrustum = 70;

  // Live Drag & Pan state (Vuốt & Lia)
  private isDragging = false;
  private dragMoved = 0;
  private isExpanded = false;

  public onPanRequested?: (x: number, y: number) => void;
  public onPanLive?: (x: number, y: number, isDragging: boolean) => void;
  public onZoomIn: (() => void) | undefined;
  public onZoomOut: (() => void) | undefined;
  public onRecenter: (() => void) | undefined;

  constructor(
    parent?: HTMLElement,
    onZoomIn?: () => void,
    onZoomOut?: () => void,
    onRecenter?: () => void,
  ) {
    this.onZoomIn = onZoomIn;
    this.onZoomOut = onZoomOut;
    this.onRecenter = onRecenter;

    this.element = document.createElement("div");
    this.element.className = "minimap-wrapper";
    this.element.setAttribute("data-ui", "true");

    this.canvas = document.createElement("canvas");
    this.canvas.className = "minimap-canvas";
    this.canvas.width = this.size;
    this.canvas.height = this.size;

    const controls = document.createElement("div");
    controls.className = "minimap-controls";
    controls.innerHTML = `
      <button class="btn-mini-control" id="mbtn-zoom-in" title="Phóng to">${Icons.zoomIn("sm")}</button>
      <button class="btn-mini-control" id="mbtn-zoom-out" title="Thu nhỏ">${Icons.zoomOut("sm")}</button>
      <button class="btn-mini-control" id="mbtn-recenter" title="Căn giữa Trụ sở HQ">${Icons.compass("sm")}</button>
    `;

    const expand = document.createElement("button");
    expand.className = "minimap-expand";
    expand.type = "button";
    expand.setAttribute("aria-label", "Mở bản đồ nhỏ");
    expand.setAttribute("aria-expanded", "false");
    expand.textContent = "⤢";
    expand.addEventListener("click", () => this.toggleExpand());
    this.element.appendChild(expand);
    this.element.appendChild(this.canvas);
    this.element.appendChild(controls);
    (parent || document.body).appendChild(this.element);

    this.ctx = this.canvas.getContext("2d")!;

    this.setupEvents();
    this.draw();
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public toggleExpand(): void {
    this.isExpanded = !this.isExpanded;
    this.element.classList.toggle("is-expanded", this.isExpanded);
    const expand =
      this.element.querySelector<HTMLButtonElement>(".minimap-expand")!;
    expand.setAttribute("aria-expanded", String(this.isExpanded));
    expand.setAttribute(
      "aria-label",
      this.isExpanded ? "Thu gọn bản đồ nhỏ" : "Mở bản đồ nhỏ",
    );
    expand.textContent = this.isExpanded ? "×" : "⤢";
    this.requestRedraw();
  }

  private calcWorldCoords(
    clientX: number,
    clientY: number,
  ): { worldX: number; worldY: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width || this.size;
    const scaleY = rect.height || this.size;
    const normX = Math.max(0, Math.min(1, (clientX - rect.left) / scaleX));
    const normY = Math.max(0, Math.min(1, (clientY - rect.top) / scaleY));
    return {
      worldX: Math.min(999, Math.floor(normX * 1000)),
      worldY: Math.min(999, Math.floor(normY * 1000)),
    };
  }

  private setupEvents(): void {
    // 1. Mouse Drag & Pan
    this.canvas.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isDragging = true;
      this.dragMoved = 0;
      this.canvas.classList.add("is-dragging");

      const { worldX, worldY } = this.calcWorldCoords(e.clientX, e.clientY);
      this.camX = worldX;
      this.camZ = worldY;
      this.requestRedraw();
      this.onPanLive?.(worldX, worldY, true);
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      this.dragMoved += Math.hypot(e.movementX, e.movementY);
      const { worldX, worldY } = this.calcWorldCoords(e.clientX, e.clientY);
      this.camX = worldX;
      this.camZ = worldY;
      this.requestRedraw();
      this.onPanLive?.(worldX, worldY, true);
    });

    window.addEventListener("mouseup", (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.canvas.classList.remove("is-dragging");
      const { worldX, worldY } = this.calcWorldCoords(e.clientX, e.clientY);
      this.onPanLive?.(worldX, worldY, false);
      if (this.dragMoved < 6 && this.onPanRequested) {
        this.onPanRequested(worldX, worldY);
      }
    });

    // 2. Touch Swipe & Live Pan (Vuốt & Lia)
    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 1) {
          e.preventDefault();
          e.stopPropagation();
          this.isDragging = true;
          this.dragMoved = 0;
          this.canvas.classList.add("is-dragging");

          const touch = e.touches[0]!;
          const { worldX, worldY } = this.calcWorldCoords(
            touch.clientX,
            touch.clientY,
          );
          this.camX = worldX;
          this.camZ = worldY;
          this.requestRedraw();
          this.onPanLive?.(worldX, worldY, true);
        }
      },
      { passive: false },
    );

    window.addEventListener(
      "touchmove",
      (e) => {
        if (!this.isDragging || e.touches.length !== 1) return;
        e.preventDefault();
        const touch = e.touches[0]!;
        this.dragMoved += 4;
        const { worldX, worldY } = this.calcWorldCoords(
          touch.clientX,
          touch.clientY,
        );
        this.camX = worldX;
        this.camZ = worldY;
        this.requestRedraw();
        this.onPanLive?.(worldX, worldY, true);
      },
      { passive: false },
    );

    const handleTouchEnd = (e: TouchEvent) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.canvas.classList.remove("is-dragging");
      const touch = e.changedTouches[0];
      if (touch) {
        const { worldX, worldY } = this.calcWorldCoords(
          touch.clientX,
          touch.clientY,
        );
        this.onPanLive?.(worldX, worldY, false);
        if (this.dragMoved < 10 && this.onPanRequested) {
          this.onPanRequested(worldX, worldY);
        }
      }
    };

    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);

    // 3. MiniMap Controls
    const stopProp = (e: Event) => e.stopPropagation();
    this.element.addEventListener("pointerdown", stopProp);
    this.element.addEventListener("mousedown", stopProp);
    this.element.addEventListener("touchstart", stopProp, { passive: true });

    const controls = this.element.querySelector(".minimap-controls");
    controls?.querySelectorAll(".btn-mini-control").forEach((btn) => {
      btn.addEventListener("pointerdown", stopProp);
      btn.addEventListener("mousedown", stopProp);
      btn.addEventListener("touchstart", stopProp, { passive: true });
    });

    controls?.querySelector("#mbtn-zoom-in")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onZoomIn?.();
    });
    controls
      ?.querySelector("#mbtn-zoom-out")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onZoomOut?.();
      });
    controls
      ?.querySelector("#mbtn-recenter")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onRecenter?.();
      });
  }

  public requestRedraw(): void {
    if (this.isDrawPending) return;
    this.isDrawPending = true;
    requestAnimationFrame(() => {
      this.isDrawPending = false;
      this.draw();
    });
  }

  public setPlayerHQ(schoolId: string, x: number, y: number): void {
    this.playerHQ = { schoolId, x, y };
    this.requestRedraw();
  }

  public updateCamera(camX: number, camZ: number, frustumSize: number): void {
    this.camX = camX;
    this.camZ = camZ;
    this.camFrustum = frustumSize;
    this.requestRedraw();
  }

  public draw(): void {
    const ctx = this.ctx,
      s = this.size,
      scale = s / 1000;
    ctx.fillStyle = "#173932";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "#567562";
    ctx.beginPath();
    ctx.arc(500 * scale, 500 * scale, 280 * scale, 0, Math.PI * 2);
    ctx.stroke();
    for (const [id, projection] of this.projections) {
      const c = chunkCoordinatesForId(id);
      for (let local = 0; local < 4096; local++) {
        if (!(projection.fog[local >> 3]! & (1 << (local & 7)))) continue;
        const x = c.chunkX * 64 + (local % 64),
          z = c.chunkZ * 64 + Math.floor(local / 64);
        if (x >= 1000 || z >= 1000) continue;
        ctx.fillStyle =
          projection.owned[local >> 3]! & (1 << (local & 7))
            ? (SCHOOLS[this.schoolSlot]?.color ?? "#6ce2dc")
            : "#638b7c";
        ctx.fillRect(
          x * scale,
          z * scale,
          Math.max(1, scale),
          Math.max(1, scale),
        );
      }
    }
    for (const o of this.objects) {
      ctx.fillStyle =
        o.kind === "hq"
          ? (SCHOOLS.find((s) => s.slot === o.schoolSlot)?.color ?? "#fff")
          : o.kind === "landmark"
            ? "#eecb72"
            : o.kind === "unistop"
              ? "#6ce2dc"
              : "#eaa678";
      ctx.fillRect(o.x * scale - 2, o.z * scale - 2, 4, 4);
    }
    if (this.playerHQ) {
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(
        this.playerHQ.x * scale - 4,
        this.playerHQ.y * scale - 4,
        8,
        8,
      );
    }
    ctx.strokeStyle = "#fff";
    ctx.strokeRect(
      (this.camX - this.camFrustum / 2) * scale,
      (this.camZ - this.camFrustum / 2) * scale,
      this.camFrustum * scale,
      this.camFrustum * scale,
    );
  }
}
