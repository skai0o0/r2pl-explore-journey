import { GAME_CONFIG } from "../../../shared/gameplay/gameConfig.ts";
// client/src/ui/statsOverlay.ts
import { Icons } from "./icons.ts";
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
  private showRankingPopover = false;
  private showMenu = false;
  private closePanels = (event: Event) => {
    if (
      !this.element.contains(event.target as Node) &&
      (this.showMenu || this.showRankingPopover)
    ) {
      this.showMenu = false;
      this.showRankingPopover = false;
      this.render();
    }
  };

  public onFlyToHQRequested?: () => void;
  public onInventoryRequested?: () => void;
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
      points: 500,
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

    // Initialize default points map
    for (const sId of SCHOOL_IDS) {
      this.schoolKnowledgeMap.set(sId, 0);
    }

    this.element = document.createElement("header");
    this.element.className = "stats-top-hud";
    this.element.setAttribute("data-ui", "true");
    for (const event of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "touchstart",
      "touchend",
      "click",
    ])
      this.element.addEventListener(event, (e) => e.stopPropagation());
    this.render();
    (parent || document.body).appendChild(this.element);
    document.addEventListener("click", this.closePanels);
    this.element.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.showMenu = false;
        this.showRankingPopover = false;
        this.render();
        this.element
          .querySelector<HTMLButtonElement>(".hud-menu-toggle")
          ?.focus();
      }
    });
  }

  public updateStats(newStats: Partial<StudentStats>): void {
    this.stats = { ...this.stats, ...newStats };

    this.render();
  }

  /**
   * Cập nhật Điểm Tri Thức (Points)
   */
  public updatePoints(points: number): void {
    if (this.stats.points === points) return;
    this.stats.points = points;

    const pointEl = this.element.querySelector(".stat-points .stat-value");
    if (pointEl) {
      pointEl.textContent = points.toLocaleString();
    } else {
      this.render();
    }
    this.updateRankDisplay();
  }

  /**
   * Backward-compatibility alias for updatePoints
   */
  public updateTroops(points: number): void {
    this.updatePoints(points);
  }

  /**
   * Cập nhật Bảng xếp hạng Ô Tri Thức các trường (School Ranking)
   * Hiển thị số ô tri thức đã mở rộng còn hiệu lực.
   */
  public updateSchoolRankings(
    rankings: SchoolRankingEntry[] | Record<string, number>,
  ): void {
    if (Array.isArray(rankings)) {
      this.schoolRankingsList = rankings.map((r) => ({
        schoolId: r.schoolId,
        points: r.points !== undefined ? r.points : (r as any).troops || 0,
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

  /**
   * Cập nhật Điểm Tri Thức cho 1 trường học cụ thể
   */
  public updateSchoolPoints(schoolId: string, points: number): void {
    this.schoolKnowledgeMap.set(schoolId, points);
    this.recalculateRankings();
    this.updateRankDisplay();
  }

  private recalculateRankings(): void {
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

  private getSchoolRankText(): string {
    if (this.schoolRankingsList.length === 0) {
      this.recalculateRankings();
    }
    const idx = this.schoolRankingsList.findIndex(
      (r) => r.schoolId === this.stats.schoolId,
    );
    if (idx === -1) {
      return `Hạng #1 (Ô)`;
    }
    const myEntry = this.schoolRankingsList[idx];
    const rank = idx + 1;
    return `#${rank} (${myEntry!.points.toLocaleString()} ô)`;
  }

  private updateRankDisplay(): void {
    const rankEl = this.element.querySelector("#stat-school-rank-text");
    if (rankEl) {
      rankEl.textContent = this.getSchoolRankText();
    }
    const popoverBody = this.element.querySelector(
      "#school-ranking-rows-container",
    );
    if (popoverBody) {
      popoverBody.innerHTML = this.renderRankingRows();
    }
  }

  public updateCrystals(crystals: number): void {
    if (this.stats.crystals === crystals) return;
    this.stats.crystals = crystals;
    const crystalEl = this.element.querySelector(".stat-crystals .stat-value");
    if (crystalEl) {
      crystalEl.textContent = crystals.toLocaleString();
    } else {
      this.render();
    }
  }

  /**
   * Thống kê số lượng Công trình đã Thắp Đèn Hiệu
   */
  public updateLitLandmarks(count: number): void {
    if (this.stats.litLandmarksCount === count) return;
    this.stats.litLandmarksCount = count;
    const beaconEl = this.element.querySelector(".stat-beacons .stat-value");
    if (beaconEl) {
      beaconEl.textContent = `${count} công trình`;
    } else {
      this.render();
    }
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

    if (
      this.stats.totalSchoolTiles === myTiles &&
      this.stats.controlPercentage === pct
    ) {
      return;
    }

    this.stats.totalSchoolTiles = myTiles;
    this.stats.controlPercentage = pct;

    const terrValEl = this.element.querySelector(".stat-territory .stat-value");
    if (terrValEl) {
      terrValEl.innerHTML = `${myTiles} <small style="font-size:11px; color:var(--text-secondary);">ô (${pct}%)</small>`;
    } else {
      this.render();
    }
  }

  public updateExploration(revealedCount: number, percentage: number): void {
    if (
      this.stats.revealedTilesCount === revealedCount &&
      this.stats.explorationPercentage === percentage
    ) {
      return;
    }

    this.stats.revealedTilesCount = revealedCount;
    this.stats.explorationPercentage = percentage;
    const meter = this.element.querySelector<HTMLProgressElement>(
      ".hud-exploration-meter",
    );
    if (meter) meter.value = percentage;

    const expValEl = this.element.querySelector(
      ".stat-exploration .stat-value",
    );
    if (expValEl) {
      expValEl.innerHTML = `${percentage.toFixed(2)}% <small class="exploration-sub">(${revealedCount.toLocaleString()} ô)</small>`;
    } else {
      this.render();
    }
  }

  private renderRankingRows(): string {
    if (this.schoolRankingsList.length === 0) {
      this.recalculateRankings();
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
        <div class="ranking-row ${isMe ? "is-my-school" : ""}" style="display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; border-radius: 4px; background: ${isMe ? "rgba(0, 255, 232, 0.12)" : "rgba(255,255,255,0.03)"}; margin-bottom: 4px; border-left: 3px solid ${color};">
          <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
            <span style="font-weight: 800; font-size: 11px; color: ${rankColor}; width: 22px;">#${idx + 1}</span>
            <span style="font-weight: 700; font-size: 11px; color: ${color}; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${name}</span>${entry.buffs?.length ? `<span class="ranking-buff-badge" title="${entry.buffs.map((b) => b.name).join(" · ")}">◆ ${entry.buffs.length}</span>` : ""}
            ${isMe ? `<span style="font-size: 9px; font-weight: 700; background: rgba(0, 255, 232, 0.2); color: #00ffe8; padding: 1px 4px; border-radius: 2px; white-space: nowrap;">Trường bạn</span>` : ""}
          </div>
          <div style="font-weight: 800; font-size: 11px; color: #fbbf24; white-space: nowrap; margin-left: 8px;">
            ${entry.points.toLocaleString()} <span style="font-weight: 600; font-size: 10px; color: var(--text-secondary);">ô</span>
          </div>
        </div>
      `;
      })
      .join("");
  }

  private render(): void {
    const focusedId = this.element.contains(document.activeElement)
      ? document.activeElement?.id
      : undefined;
    this.element.innerHTML = `
      <button class="hud-identity" id="btnFlyHQ" title="Về trụ sở (H)" aria-label="Về trụ sở">
        <span class="hud-home-icon" aria-hidden="true">⌂</span>
        <span class="school-pill" style="--school-color:${this.stats.schoolColor}">
          <strong>${this.stats.schoolName || this.stats.schoolId.toUpperCase()}</strong>
        </span>
      </button>
      <div class="hud-resources">
        <div class="stat-points hud-resource" aria-label="Điểm Tri Thức">${Icons.star(18)}<span class="stat-content"><span class="stat-label">Điểm Tri Thức</span><strong class="stat-value">${this.stats.points.toLocaleString()}</strong></span></div>
        <div class="stat-crystals hud-resource" aria-label="Tinh Thể">${Icons.crystal(18)}<span class="stat-content"><span class="stat-label">Tinh Thể</span><strong class="stat-value">${(this.stats.crystals || 0).toLocaleString()}</strong></span></div>
      </div>
      <button id="btnInventory" class="hud-inventory" aria-label="Mở hành trang" title="Chìa Khóa và hành trang">${Icons.key(18)}<strong>${(this.stats.aspireKeys ?? 0) + (this.stats.nitroKeys ?? 0) + (this.stats.predatorKeys ?? 0)}</strong><span>Hành trang</span></button>
      <div class="hud-progress-strip">
        <div class="stat-territory"><span class="stat-label">Ô Tri Thức: </span><span class="stat-value">${(this.stats.totalSchoolTiles || 0).toLocaleString()} <small>ô (${(this.stats.controlPercentage || 0).toFixed(2)}%)</small></span></div>
        <div class="stat-exploration"><span class="stat-label">Khám phá</span><span class="stat-value">${(this.stats.explorationPercentage || 0).toFixed(2)}% <small class="exploration-sub">(${(this.stats.revealedTilesCount || 0).toLocaleString()} ô)</small></span><progress class="hud-exploration-meter" max="100" value="${this.stats.explorationPercentage || 0}" aria-label="Tiến độ khám phá"></progress></div>
        <button class="stat-school-rank" id="btnSchoolRankPopover" aria-label="Xem bảng xếp hạng" aria-expanded="${this.showRankingPopover}">${Icons.trophy(18)}<span id="stat-school-rank-text">${this.getSchoolRankText()}</span><span aria-hidden="true">›</span></button>
      </div>
      <button id="btnHudMenu" class="hud-menu-toggle" aria-label="Menu thông tin" aria-expanded="${this.showMenu}" aria-controls="hud-secondary-menu">☰</button>
      <section id="hud-secondary-menu" class="hud-secondary-menu" ${this.showMenu ? "" : "hidden"} aria-label="Thông tin thêm">
        <header><strong>Hành trình khám phá</strong><button id="btnHudMenuClose" class="hud-menu-close" aria-label="Đóng menu">×</button></header>
        <p class="hud-player-name"></p>
        <div class="stat-beacons">Đèn hiệu đã thắp <strong class="stat-value">${this.stats.litLandmarksCount || 0} công trình</strong></div><div class="active-buffs">${this.stats.buffs?.map((b) => `<p>◆ ${b.name}: ${b.description}</p>`).join("") ?? ""}</div>
        <div>Đã khám phá <strong>${this.stats.revealedTilesCount ?? 0} ô</strong></div><p>Chìa Khóa: Aspire ${this.stats.aspireKeys ?? 0} · Nitro ${this.stats.nitroKeys ?? 0} · Predator ${this.stats.predatorKeys ?? 0}</p>
        <p class="hud-menu-hint">Chạm tên trường để về trụ sở. Chạm bản đồ để tương tác với ô tri thức.</p>
      </section>
      <section class="school-ranking-popover" ${this.showRankingPopover ? "" : "hidden"} aria-label="Bảng xếp hạng">
        <header><strong>Bảng xếp hạng Ô Tri Thức</strong><button id="btn-close-ranking-popover" aria-label="Đóng bảng xếp hạng">×</button></header>
        <div id="school-ranking-rows-container">${this.renderRankingRows()}</div>
      </section>`;
    this.element.querySelector(".hud-player-name")!.textContent =
      this.stats.displayName || this.stats.studentName;
    this.bindEvents();
    if (focusedId)
      this.element.querySelector<HTMLButtonElement>(`#${focusedId}`)?.focus();
  }

  private bindEvents(): void {
    this.element
      .querySelector("#btnInventory")
      ?.addEventListener("click", () => this.onInventoryRequested?.());
    this.element
      .querySelector("#btnFlyHQ")
      ?.addEventListener("click", () => this.onFlyToHQRequested?.());
    const toggleRank = () => {
      this.showRankingPopover = !this.showRankingPopover;
      this.showMenu = false;
      this.render();
      this.element
        .querySelector<HTMLButtonElement>(
          this.showRankingPopover
            ? "#btn-close-ranking-popover"
            : "#btnSchoolRankPopover",
        )
        ?.focus();
    };
    this.element
      .querySelector("#btnSchoolRankPopover")
      ?.addEventListener("click", toggleRank);
    this.element
      .querySelector("#btn-close-ranking-popover")
      ?.addEventListener("click", toggleRank);
    const toggleMenu = () => {
      this.showMenu = !this.showMenu;
      this.showRankingPopover = false;
      this.render();
      this.element
        .querySelector<HTMLButtonElement>(
          this.showMenu ? ".hud-menu-close" : ".hud-menu-toggle",
        )
        ?.focus();
    };
    this.element
      .querySelector(".hud-menu-toggle")
      ?.addEventListener("click", toggleMenu);
    this.element
      .querySelector(".hud-menu-close")
      ?.addEventListener("click", toggleMenu);
  }
}
