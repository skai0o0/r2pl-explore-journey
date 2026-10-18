import { GAME_CONFIG } from "../../../shared/gameplay/gameConfig.ts";
import { SCHOOL_IDS, SCHOOL_ROSTER } from "./v1Adapters.ts";

export interface SchoolRankingEntry {
  schoolId: string;
  points: number;
  tiles?: number | undefined;
  buffs?: readonly { name: string; description: string }[] | undefined;
}

export interface StudentStats {
  studentName: string;
  studentEmail?: string | undefined;
  displayName?: string | undefined;
  earnedRunningPoints?: number;
  schoolId: string;
  schoolName: string;
  schoolColor: string;
  points: number;
  crystals?: number | undefined;
  aspireKeys?: number | undefined;
  nitroKeys?: number | undefined;
  predatorKeys?: number | undefined;
  claimedTiles: number;
  totalSchoolTiles: number;
  controlPercentage: number;
  explorationPercentage?: number | undefined;
  revealedTilesCount?: number | undefined;
  totalMapTiles?: number | undefined;
  mode: "normal" | "dev";
  isLocked: boolean;
  litLandmarksCount?: number | undefined;
  buffs?: readonly { name: string; description: string }[] | undefined;
  schoolRankings?: SchoolRankingEntry[];
}

export class StatsOverlay {
  public element: HTMLElement;
  private stats: StudentStats;
  private schoolKnowledgeMap = new Map<string, number>();
  private schoolRankingsList: SchoolRankingEntry[] = [];
  private activeDialogKind:
    | "student"
    | "progress"
    | "inventory"
    | "ranking"
    | null = null;
  private toolsOpen = false;
  private dialogOpener: HTMLElement | null = null;

  public get dialogOpen(): boolean {
    return this.activeDialogKind !== null;
  }

  public onFlyToHQRequested?: () => void;
  public onInventoryRequested?: () => void;
  public onExploreRequested?: () => void;
  public onWalletRefreshRequested?: () => void;
  public onSchoolChange?: (schoolId: string) => void;

  constructor(parent?: HTMLElement, initialStats?: Partial<StudentStats>) {
    const defaultSchool = SCHOOL_ROSTER.hcmut;
    const defaultDisplayName =
      initialStats?.displayName ||
      (initialStats?.studentEmail
        ? initialStats.studentEmail.split("@")[0]!
        : "Sinh viên Khám phá");

    this.stats = {
      studentName: defaultDisplayName,
      displayName: defaultDisplayName,
      schoolId: "hcmut",
      schoolName: defaultSchool?.name || "HCMUT",
      schoolColor: defaultSchool?.colorHex || "#0062FF",
      points: 0,
      crystals: 0,
      aspireKeys: 0,
      nitroKeys: 0,
      predatorKeys: 0,
      claimedTiles: 0,
      totalSchoolTiles: 0,
      controlPercentage: 0,
      explorationPercentage: 0.0,
      revealedTilesCount: 0,
      totalMapTiles: 1000000,
      mode: "normal",
      isLocked: false,
      litLandmarksCount: 0,
      ...initialStats,
    };

    for (const sId of SCHOOL_IDS) {
      this.schoolKnowledgeMap.set(sId, 0);
    }

    const existingHud = document.querySelector<HTMLElement>(".hud");
    this.element = existingHud ?? document.createElement("header");
    if (!existingHud) {
      this.element.className = "hud";
      (parent || document.body).appendChild(this.element);
    }

    this.bindDOM();
    this.render();
  }

  private bindDOM(): void {
    // Prevent 3D map from capturing clicks on HUD and Tools panel
    const stopProp = (e: Event) => e.stopPropagation();
    for (const event of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
    ]) {
      this.element.addEventListener(event, stopProp);
      const tools = document.getElementById("tools-panel");
      tools?.addEventListener(event, stopProp);
      const scrim = document.getElementById("scrim");
      scrim?.addEventListener(event, (e) => {
        if (e.target === scrim) stopProp(e);
      });
      const dialog = document.getElementById("dialog");
      dialog?.addEventListener(event, stopProp);
    }

    // Tools Toggle button
    const toggleBtn = document.getElementById("hud-tools-toggle");
    toggleBtn?.addEventListener("click", () => {
      this.toggleTools(!this.toolsOpen);
    });

    // Close Tools button
    const closeToolsBtn = document.getElementById("close-tools");
    closeToolsBtn?.addEventListener("click", () => {
      this.toggleTools(false);
      toggleBtn?.focus();
    });

    // Tool actions
    document.getElementById("tool-home")?.addEventListener("click", () => {
      this.onFlyToHQRequested?.();
      if (window.innerWidth < 600) this.toggleTools(false);
    });

    document.getElementById("tool-inventory")?.addEventListener("click", () => {
      this.toggleTools(false);
      if (this.onInventoryRequested) {
        this.onInventoryRequested();
      } else {
        this.openDialog("inventory");
      }
    });

    document.getElementById("tool-ranking")?.addEventListener("click", () => {
      this.toggleTools(false);
      this.openDialog("ranking");
    });

    document
      .getElementById("tool-find-expansion")
      ?.addEventListener("click", () => {
        this.onExploreRequested?.();
        this.toggleTools(true);
      });

    // HUD Student click -> Open Student Profile Dialog
    document.getElementById("hud-student")?.addEventListener("click", () => {
      this.toggleTools(false);
      this.openDialog("student");
    });

    // HUD Progress click -> Open Progress & Wallet Dialog
    document.getElementById("hud-progress")?.addEventListener("click", () => {
      this.toggleTools(false);
      this.openDialog("progress");
    });

    // Close Dialog button
    document.getElementById("close-dialog")?.addEventListener("click", () => {
      this.closeDialog();
    });

    // Scrim backdrop click
    const scrim = document.getElementById("scrim");
    scrim?.addEventListener("click", (e) => {
      if (e.target === scrim) this.closeDialog();
    });

    // Keyboard navigation (Escape, Tab focus trap)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.activeDialogKind) {
          this.closeDialog();
        } else if (this.toolsOpen) {
          this.toggleTools(false);
        }
      }
      if (
        e.key.toLowerCase() === "t" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        if (!this.activeDialogKind) {
          this.toggleTools(!this.toolsOpen);
        }
      }
      if (this.activeDialogKind && e.key === "Tab") {
        const dialog = document.getElementById("dialog");
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        );
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    });

    // Close tools when clicking outside
    document.addEventListener("pointerdown", (e) => {
      if (this.toolsOpen) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          !target.closest("#tools-panel") &&
          !target.closest(".hud") &&
          !target.closest("#scrim")
        ) {
          this.toggleTools(false);
        }
      }
    });
  }

  public toggleTools(open: boolean): void {
    this.toolsOpen = open;
    const tools = document.getElementById("tools-panel");
    const toggleBtn = document.getElementById("hud-tools-toggle");
    if (tools) tools.hidden = !open;
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", String(open));
      toggleBtn.setAttribute(
        "aria-label",
        open ? "Đóng công cụ" : "Mở công cụ",
      );
    }
  }

  public openDialog(
    kind: "student" | "progress" | "inventory" | "ranking",
  ): void {
    const opening = this.activeDialogKind === null;
    const focusedId = document.activeElement?.id;
    if (opening)
      this.dialogOpener = document.activeElement as HTMLElement | null;
    this.activeDialogKind = kind;
    const scrim = document.getElementById("scrim");
    const kickerEl = document.getElementById("dialog-kicker");
    const titleEl = document.getElementById("dialog-title");
    const subtitleEl = document.getElementById("dialog-subtitle");
    const contentEl = document.getElementById("dialog-content");

    if (!scrim || !kickerEl || !titleEl || !subtitleEl || !contentEl) return;

    const studentName = this.stats.displayName || this.stats.studentName;
    const schoolName =
      this.stats.schoolName || this.stats.schoolId.toUpperCase();

    if (kind === "student") {
      kickerEl.textContent = "HỒ SƠ SINH VIÊN";
      titleEl.textContent = studentName;
      subtitleEl.textContent = `${schoolName} · Mã trường ${this.stats.schoolId.toUpperCase()}`;

      contentEl.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><small>Điểm Tri Thức</small><strong>${this.stats.points.toLocaleString()}</strong></div>
          <div class="stat"><small>Điểm chạy tích lũy</small><strong>${(this.stats.earnedRunningPoints ?? 0).toLocaleString()}</strong></div>
          <div class="stat"><small>Tinh Thể</small><strong>${(this.stats.crystals ?? 0).toLocaleString()}</strong></div>
          <div class="stat"><small>Đèn hiệu đã thắp</small><strong>${this.stats.litLandmarksCount ?? 0}</strong></div>
        </div>
        <p class="caption" style="margin-top: 14px; color: var(--muted);">
          Chiến binh thuộc đại diện học viện ${schoolName}. Điểm chạy tuần quy đổi thành Điểm Tri Thức để mở rộng bản đồ.
        </p>
        <button id="dialog-btn-fly-hq" class="primary" style="margin-top: 14px;">
          <span>Về trụ sở trường</span><span>⌂ ↗</span>
        </button>
      `;

      contentEl
        .querySelector("#dialog-btn-fly-hq")
        ?.addEventListener("click", () => {
          this.closeDialog();
          this.onFlyToHQRequested?.();
        });
    } else if (kind === "progress") {
      kickerEl.textContent = "TIẾN TRÌNH & SỐ DƯ";
      titleEl.textContent = "Tri thức học viện";
      subtitleEl.textContent = `Thành tích trường và tài nguyên của bạn`;

      const pct = (this.stats.controlPercentage ?? 0).toFixed(2);
      const expPct = (this.stats.explorationPercentage ?? 0).toFixed(2);
      const myTiles = (this.stats.totalSchoolTiles ?? 0).toLocaleString();
      const revTiles = (this.stats.revealedTilesCount ?? 0).toLocaleString();

      contentEl.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><small>Điểm khả dụng</small><strong style="color:var(--cyan)">${this.stats.points.toLocaleString()}</strong></div>
          <div class="stat"><small>Tinh Thể</small><strong>${(this.stats.crystals ?? 0).toLocaleString()}</strong></div>
          <div class="stat"><small>Ô Tri Thức trường</small><strong>${myTiles} <span style="font-size:12px;color:var(--muted)">(${pct}%)</span></strong></div>
          <div class="stat"><small>Đã khám phá</small><strong>${revTiles} <span style="font-size:12px;color:var(--muted)">(${expPct}%)</span></strong></div>
        </div>
        ${
          this.stats.buffs && this.stats.buffs.length > 0
            ? `<div style="margin-top:12px; padding:8px; border-radius:4px; background:rgba(255,255,255,0.03); border-left:2px solid var(--cyan-bright);">
                <small style="color:var(--cyan-bright); font-weight:600; font-size:10px;">HIỆU ỨNG ĐÈN HIỆU ĐANG CÓ</small>
                ${this.stats.buffs.map((b) => `<p style="font-size:11px; margin:4px 0 0; color:#dbeafe;">◆ <b>${b.name}</b>: ${b.description}</p>`).join("")}
              </div>`
            : ""
        }
        <button id="dialog-btn-refresh-wallet" class="secondary" style="margin-top: 14px;">
          Cập nhật số dư từ máy chủ ↻
        </button>
      `;

      contentEl
        .querySelector("#dialog-btn-refresh-wallet")
        ?.addEventListener("click", () => {
          this.onWalletRefreshRequested?.();
        });
    } else if (kind === "inventory") {
      kickerEl.textContent = "HÀNH TRANG KHÁM PHÁ";
      titleEl.textContent = "Tài nguyên & Chìa Khóa";
      subtitleEl.textContent = "Dùng Chìa Khóa mở Rương tương ứng trên bản đồ";

      const aKeys = this.stats.aspireKeys ?? 0;
      const nKeys = this.stats.nitroKeys ?? 0;
      const pKeys = this.stats.predatorKeys ?? 0;

      contentEl.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><small>Chìa Aspire</small><strong style="color:#fbbf24">${aKeys}</strong></div>
          <div class="stat"><small>Chìa Nitro</small><strong style="color:#00ffe8">${nKeys}</strong></div>
          <div class="stat"><small>Chìa Predator</small><strong style="color:#a855f7">${pKeys}</strong></div>
          <div class="stat"><small>Tinh Thể</small><strong>${(this.stats.crystals ?? 0).toLocaleString()}</strong></div>
        </div>
        <p class="caption" style="margin-top: 14px;">
          Chìa Khóa nhận được khi quay Trạm Tiếp Tế (UniStop). Chạm vào Rương đã khám phá trên bản đồ để mở quà.
        </p>
      `;
    } else if (kind === "ranking") {
      kickerEl.textContent = "BẢNG XẾP HẠNG HỌC VIỆN";
      titleEl.textContent = "Xếp hạng Ô Tri Thức";
      subtitleEl.textContent = "Số ô tri thức đang nắm giữ của các trường";

      contentEl.innerHTML = `
        <div style="margin-top: 8px;">
          ${this.renderRankingRows()}
        </div>
        <p class="ranking-note">
          Bảng xếp hạng cập nhật tự động theo thời gian thực từ máy chủ authoritative.
        </p>
      `;
    }

    scrim.hidden = false;
    if (opening) document.getElementById("close-dialog")?.focus();
    else if (focusedId) document.getElementById(focusedId)?.focus();
  }

  public closeDialog(): void {
    this.activeDialogKind = null;
    const scrim = document.getElementById("scrim");
    if (scrim) scrim.hidden = true;
    this.dialogOpener?.focus();
    this.dialogOpener = null;
  }

  public updateStats(newStats: Partial<StudentStats>): void {
    this.stats = { ...this.stats, ...newStats };
    this.render();
  }

  public updatePoints(points: number): void {
    if (this.stats.points === points) return;
    this.stats.points = points;
    this.render();
  }

  public updateTroops(points: number): void {
    this.updatePoints(points);
  }

  public updateSchoolRankings(
    rankings: SchoolRankingEntry[] | Record<string, number>,
  ): void {
    if (Array.isArray(rankings)) {
      this.schoolRankingsList = rankings.map((r) => ({
        schoolId: r.schoolId,
        points: r.points,
        tiles: r.tiles,
        buffs: r.buffs,
      }));
      for (const r of this.schoolRankingsList) {
        this.schoolKnowledgeMap.set(r.schoolId, r.points);
      }
    } else if (typeof rankings === "object" && rankings !== null) {
      this.schoolRankingsList = Object.entries(rankings).map(
        ([schoolId, pts]) => ({
          schoolId,
          points: pts,
        }),
      );
      for (const [sId, pts] of Object.entries(rankings)) {
        this.schoolKnowledgeMap.set(sId, pts);
      }
    }
    this.schoolRankingsList.sort((a, b) => b.points - a.points);
    const mine = this.schoolRankingsList.find(
      (r) => r.schoolId === this.stats.schoolId,
    );
    this.stats.totalSchoolTiles = mine?.points ?? 0;
    this.stats.controlPercentage =
      (this.stats.totalSchoolTiles /
        (GAME_CONFIG.world.width * GAME_CONFIG.world.height)) *
      100;
    this.render();
  }

  public updateSchoolPoints(schoolId: string, points: number): void {
    this.schoolKnowledgeMap.set(schoolId, points);
    const list: SchoolRankingEntry[] = [];
    for (const id of SCHOOL_IDS) {
      list.push({
        schoolId: id,
        points: this.schoolKnowledgeMap.get(id) || 0,
      });
    }
    list.sort((a, b) => b.points - a.points);
    this.schoolRankingsList = list;
    this.render();
  }

  public updateCrystals(crystals: number): void {
    if (this.stats.crystals === crystals) return;
    this.stats.crystals = crystals;
    this.render();
  }

  public updateLitLandmarks(count: number): void {
    if (this.stats.litLandmarksCount === count) return;
    this.stats.litLandmarksCount = count;
    this.render();
  }

  public setSchool(schoolId: string): void {
    const school = SCHOOL_ROSTER[schoolId];
    if (!school) return;
    this.updateStats({
      schoolId,
      schoolName: school.name,
      schoolColor: school.colorHex,
    });
  }

  public updateTerritory(territoryCounts: Record<string, number>): void {
    let totalClaimed = 0;
    for (const id of SCHOOL_IDS) {
      totalClaimed += territoryCounts[id] || 0;
    }
    const myTiles = territoryCounts[this.stats.schoolId] || 0;
    const pct =
      totalClaimed > 0
        ? parseFloat(((myTiles / totalClaimed) * 100).toFixed(1))
        : 0;
    this.stats.totalSchoolTiles = myTiles;
    this.stats.controlPercentage = pct;
    this.render();
  }

  public updateExploration(revealedCount: number, percentage: number): void {
    this.stats.revealedTilesCount = revealedCount;
    this.stats.explorationPercentage = percentage;
    this.render();
  }

  private renderRankingRows(): string {
    if (this.schoolRankingsList.length === 0) {
      const list: SchoolRankingEntry[] = [];
      for (const id of SCHOOL_IDS) {
        list.push({
          schoolId: id,
          points: this.schoolKnowledgeMap.get(id) || 0,
        });
      }
      list.sort((a, b) => b.points - a.points);
      this.schoolRankingsList = list;
    }
    return this.schoolRankingsList
      .map((entry, idx) => {
        const sc = SCHOOL_ROSTER[entry.schoolId];
        const isMe = entry.schoolId === this.stats.schoolId;
        const color = sc?.colorHex || "#94a3b8";
        const name = sc?.name || entry.schoolId.toUpperCase();
        const rankColor =
          idx === 0
            ? "#fbbf24"
            : idx === 1
              ? "#cbd5e1"
              : idx === 2
                ? "#b45309"
                : "#64748b";

        return `
        <div class="rank-row ${isMe ? "is-me" : ""}">
          <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; min-width: 0;">
            <b style="color: ${rankColor}; width: 22px; font-variant-numeric: tabular-nums;">#${idx + 1}</b>
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: ${color}; flex-shrink: 0;"></span>
            <b style="color: #eef7fa; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${name}</b>
            ${isMe ? `<span class="tiny-tag" style="color:var(--cyan-bright); border-color:var(--cyan-bright); padding:1px 4px;">Trường bạn</span>` : ""}
          </div>
          <span style="font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; margin-left: 8px;">
            ${entry.points.toLocaleString()} ô
          </span>
        </div>
      `;
      })
      .join("");
  }

  public render(): void {
    const studentName = this.stats.displayName || this.stats.studentName;
    const initials =
      studentName
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .slice(-2)
        .join("")
        .toUpperCase() || "SV";

    const schoolShort =
      this.stats.schoolName || this.stats.schoolId.toUpperCase();

    // Update HUD elements
    const avatarEl = document.getElementById("hud-avatar");
    if (avatarEl) avatarEl.textContent = initials;

    const studentNameEl = document.getElementById("hud-student-name");
    if (studentNameEl) {
      studentNameEl.textContent = studentName;
      studentNameEl.title = studentName;
    }

    const schoolNameEl = document.getElementById("hud-school-name");
    if (schoolNameEl) schoolNameEl.textContent = schoolShort.replace(/_/g, " ");

    const tileCountEl = document.getElementById("hud-tile-count");
    if (tileCountEl) {
      const displayTiles =
        this.stats.totalSchoolTiles || this.stats.claimedTiles || 0;
      tileCountEl.innerHTML = `${displayTiles.toLocaleString()} <span>ô</span>`;
    }

    // If dialog is active, re-render its content
    if (this.activeDialogKind) {
      this.openDialog(this.activeDialogKind);
    }
  }
}
