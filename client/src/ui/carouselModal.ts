// client/src/ui/carouselModal.ts
import { Icons } from "./icons.ts";
import type { LootItem, LootRarity } from "./v1Adapters.ts";

export interface CarouselSpinOptions {
  title: string;
  subtitle?: string | undefined;
  sourceType: "unistop" | "chest";
  tier: string;
  items: LootItem[];
  winningIndex: number;
  winningItem: LootItem;
  onClaim?: (item: LootItem) => void;
  discoveryCoords?: { x: number; z: number } | undefined;
  onViewTreasureMap?: (coords: { x: number; z: number }) => void;
  giftCode?: string | undefined;
}

export class CarouselModal {
  private overlay: HTMLElement;
  private dialog: HTMLElement;
  private strip: HTMLElement;
  private needle: HTMLElement;
  private viewport: HTMLElement;
  private resultOverlay: HTMLElement;
  private confettiCanvas: HTMLCanvasElement;
  private confettiCtx: CanvasRenderingContext2D | null = null;

  private isSpinning = false;
  private audioCtx: AudioContext | null = null;
  private confettiAnimationId: number | null = null;
  private currentOptions: CarouselSpinOptions | null = null;
  private targetTranslateX = 0;

  private readonly cardWidth = 140;
  private readonly cardMargin = 6;
  private readonly cardStep = 152; // 140 + 6 * 2

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "carousel-modal-overlay";
    this.overlay.setAttribute("data-ui", "true");
    this.overlay.style.display = "none";

    this.overlay.innerHTML = `
      <div class="carousel-modal-backdrop"></div>
      <div class="carousel-modal-dialog">
        <!-- Header -->
        <div class="carousel-modal-header">
          <div class="carousel-header-left">
            <div class="carousel-brand-tag">
              <span class="brand-predator-text">[PREDATOR]</span>
              <span class="brand-r2pl-badge">TIẾP TẾ</span>
            </div>
            <div class="carousel-title-col">
              <h2 class="carousel-title">VÒNG QUAY TIẾP TẾ</h2>
              <span class="carousel-subtitle">ROAD TO PREDATOR LEAGUE</span>
            </div>
          </div>
          <button class="carousel-close-btn" id="cmodal-close" title="Đóng">${Icons.close(20)}</button>
        </div>

        <!-- Carousel Container -->
        <div class="carousel-viewport-wrapper">
          <div class="carousel-center-needle">
            <div class="needle-arrow top"></div>
            <div class="needle-laser"></div>
            <div class="needle-arrow bottom"></div>
          </div>
          <div class="carousel-viewport" id="cmodal-viewport">
            <div class="carousel-strip" id="cmodal-strip"></div>
          </div>
        </div>

        <!-- Status / Hint Bar -->
        <div class="carousel-footer-bar">
          <div class="rarity-legend">
            <span class="rarity-tag common"><span class="dot"></span> Thường</span>
            <span class="rarity-tag rare"><span class="dot"></span> Hiếm</span>
            <span class="rarity-tag epic"><span class="dot"></span> Sử thi</span>
            <span class="rarity-tag legendary"><span class="dot"></span> Huyền thoại</span>
          </div>
          <div class="carousel-spin-status">Đang mở khóa phần thưởng...</div>
          <button type="button" class="carousel-skip-btn" id="cmodal-skip-btn">⚡ Bỏ qua hiệu ứng (Mở nhanh)</button>
        </div>

        <!-- Result Celebration Overlay -->
        <div class="carousel-result-overlay" id="cmodal-result">
          <div class="result-card-celebration">
            <div class="result-halo"></div>
            <div class="result-badge-rarity" id="cmodal-result-rarity"></div>
            <div class="result-icon-box" id="cmodal-result-icon"></div>
            <h3 class="result-item-name" id="cmodal-result-name">Đang quay…</h3>
            <p class="result-item-desc" id="cmodal-result-desc">Phần thưởng dành cho bạn</p>
            <div class="result-special-actions" id="cmodal-special-actions"></div>
            <button class="btn-claim-reward" id="cmodal-claim-btn">
              ${Icons.sparkles(18)}
              <span>NHẬN THƯỞNG</span>
            </button>
          </div>
        </div>

        <!-- Confetti Canvas -->
        <canvas class="carousel-confetti-canvas" id="cmodal-confetti"></canvas>
      </div>
    `;

    document.body.appendChild(this.overlay);

    this.dialog = this.overlay.querySelector(".carousel-modal-dialog")!;
    this.strip = this.overlay.querySelector("#cmodal-strip")!;
    this.needle = this.overlay.querySelector(".carousel-center-needle")!;
    this.viewport = this.overlay.querySelector("#cmodal-viewport")!;
    this.resultOverlay = this.overlay.querySelector("#cmodal-result")!;
    this.confettiCanvas = this.overlay.querySelector(
      "#cmodal-confetti",
    ) as HTMLCanvasElement;
    this.confettiCtx = this.confettiCanvas.getContext("2d");

    this.setupEvents();
  }

  private initAudio(): void {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
  }

  /**
   * Sound: Metallic mechanical tick sound when each item slides past the needle
   */
  private playTick(freq = 1100): void {
    try {
      this.initAudio();
      if (!this.audioCtx) return;

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        180,
        this.audioCtx.currentTime + 0.025,
      );

      gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        this.audioCtx.currentTime + 0.025,
      );

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.028);
    } catch (_) {}
  }

  /**
   * Sound: Triumphant cyber chime when winning reward stops
   */
  private playWinningFanfare(): void {
    try {
      this.initAudio();
      if (!this.audioCtx) return;

      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      const now = this.audioCtx.currentTime;

      notes.forEach((freq, idx) => {
        const osc = this.audioCtx!.createOscillator();
        const gain = this.audioCtx!.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);

        gain.gain.setValueAtTime(0.18, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.55);

        osc.connect(gain);
        gain.connect(this.audioCtx!.destination);

        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.6);
      });
    } catch (_) {}
  }

  private setupEvents(): void {
    // Prevent backdrop clicks from bubbling into 3D scene
    const stopProp = (e: Event) => e.stopPropagation();
    this.overlay.addEventListener("pointerdown", stopProp);
    this.overlay.addEventListener("mousedown", stopProp);
    this.overlay.addEventListener("touchstart", stopProp, { passive: true });

    // Close button
    const closeBtn = this.overlay.querySelector("#cmodal-close");
    closeBtn?.addEventListener("click", () => {
      this.close();
    });

    // Skip button (Fast open)
    const skipBtn = this.overlay.querySelector("#cmodal-skip-btn");
    skipBtn?.addEventListener("click", () => {
      if (this.isSpinning && this.currentOptions) {
        this.isSpinning = false;
        this.strip.style.transition = "none";
        this.strip.style.transform = `translateX(${this.targetTranslateX}px)`;
        this.onSpinComplete(this.currentOptions);
      }
    });

    // Claim button
    const claimBtn = this.overlay.querySelector("#cmodal-claim-btn");
    claimBtn?.addEventListener("click", () => {
      if (this.currentOptions?.onClaim) {
        this.currentOptions.onClaim(this.currentOptions.winningItem);
      }
      this.close();
    });
  }

  private getItemIcon(item: LootItem, size: number = 36): string {
    if (item.type === "points") {
      return Icons.star(size);
    } else if (item.type === "crystal" || (item.type as any) === "charcoal") {
      return Icons.crystal(size);
    } else if (item.type === "key") {
      return Icons.key(size);
    } else if (item.type === "treasure_map") {
      return Icons.map(size);
    } else if (item.isRealGift || item.type === "real_gift") {
      return Icons.gift(size);
    }
    return Icons.box(size);
  }

  private getRarityColor(rarity: LootRarity): string {
    switch (rarity) {
      case "legendary":
        return "#eab308";
      case "epic":
        return "#a855f7";
      case "rare":
        return "#00ffe8";
      default:
        return "#64748b";
    }
  }

  public spin(options: CarouselSpinOptions): void {
    if (this.isSpinning) return;
    this.isSpinning = true;
    this.currentOptions = options;

    this.initAudio();

    // 1. Update Title & Headers
    const titleEl = this.overlay.querySelector(
      ".carousel-title",
    ) as HTMLElement;
    const subtitleEl = this.overlay.querySelector(
      ".carousel-subtitle",
    ) as HTMLElement;
    const statusEl = this.overlay.querySelector(
      ".carousel-spin-status",
    ) as HTMLElement;

    if (titleEl) titleEl.textContent = options.title.toUpperCase();
    if (subtitleEl)
      subtitleEl.textContent =
        options.subtitle ||
        (options.sourceType === "chest"
          ? "MỞ RƯƠNG KHO BÁU"
          : "PHẦN THƯỞNG TRẠM TIẾP TẾ");
    if (statusEl) statusEl.textContent = "Đang quay thưởng…";

    // 2. Hide Result & Clear Confetti
    this.resultOverlay.classList.remove("show");
    this.resultOverlay.setAttribute("aria-hidden", "true");
    this.stopConfetti();

    // 3. Render 30 Carousel Cards
    this.strip.innerHTML = "";
    this.strip.style.transition = "none";
    this.strip.style.transform = "translateX(0px)";

    const items = options.items;
    items.forEach((item, index) => {
      const card = document.createElement("div");
      const isRealGift = !!item.isRealGift || item.type === "real_gift";
      const isCrystal =
        item.type === "crystal" || (item.type as any) === "charcoal";

      card.className = `carousel-card rarity-${item.rarity} ${isRealGift ? "is-predator-gift" : ""} ${isCrystal ? "is-crystal-card" : ""}`;
      card.dataset.index = index.toString();
      card.dataset.rarity = item.rarity;

      const rarityColor = this.getRarityColor(item.rarity);
      card.style.setProperty("--rarity-color", rarityColor);

      const iconSvg = this.getItemIcon(item, 38);
      const isWinner = index === options.winningIndex;

      // Special badge for Real Gifts or Crystals
      let badgeLabel =
        {
          common: "THƯỜNG",
          rare: "HIẾM",
          epic: "SỬ THI",
          legendary: "HUYỀN THOẠI",
        }[item.rarity] ?? "PHẦN THƯỞNG";
      if (isRealGift) {
        badgeLabel = "QUÀ HIỆN VẬT";
      } else if (isCrystal && item.amount) {
        badgeLabel = `+${item.amount} TINH THỂ`;
      }

      card.innerHTML = `
        <div class="card-glow-bg"></div>
        <div class="card-rarity-strip"></div>
        <div class="card-icon-wrapper ${isCrystal ? "crystal-glow-icon" : ""} ${isRealGift ? "gift-glow-icon" : ""}">
          ${iconSvg}
        </div>
        <div class="card-info">
          <span class="card-rarity-label ${isRealGift ? "brand-label" : ""}">${badgeLabel}</span>
          <span class="card-item-name" title="${item.name}">${item.name}</span>
        </div>
      `;

      if (isWinner) {
        card.classList.add("is-target-winner");
      }

      this.strip.appendChild(card);
    });

    // 4. Open Modal & Calculate Coordinates
    this.overlay.style.display = "flex";
    requestAnimationFrame(() => {
      this.overlay.classList.add("visible");
    });

    const viewportWidth = this.viewport.clientWidth || 640;
    const centerOffset = viewportWidth / 2;
    const targetCardCenter =
      options.winningIndex * this.cardStep +
      this.cardWidth / 2 +
      this.cardMargin;

    // Small random jitter within ±18px so the landing feels authentic
    const jitter = (Math.random() - 0.5) * 36;
    const targetTranslateX = -(targetCardCenter - centerOffset + jitter);
    this.targetTranslateX = targetTranslateX;
    this.currentOptions = options;

    // 5. Run CS:GO Easing Animation
    const spinDuration = 4800; // 4.8 seconds

    setTimeout(() => {
      this.strip.style.transition = `transform ${spinDuration}ms cubic-bezier(0.12, 0.8, 0.33, 1)`;
      this.strip.style.transform = `translateX(${targetTranslateX}px)`;

      // Audio Click Tick tracker
      let lastTickIndex = 0;
      const startTime = performance.now();

      const trackTicks = (now: number) => {
        if (!this.isSpinning) return;

        const elapsed = now - startTime;
        if (elapsed < spinDuration) {
          const computed = window.getComputedStyle(this.strip);
          const matrix = computed.transform;
          let currentX = 0;

          if (matrix && matrix !== "none") {
            const values = matrix.split("(")[1]!.split(")")[0]!.split(",");
            currentX = parseFloat(values[4]!);
          }

          const needleWorldX = -currentX + centerOffset;
          const currentCardIndex = Math.floor(needleWorldX / this.cardStep);

          if (
            currentCardIndex !== lastTickIndex &&
            currentCardIndex >= 0 &&
            currentCardIndex < items.length
          ) {
            lastTickIndex = currentCardIndex;
            this.needle.classList.add("active-tick");
            setTimeout(() => this.needle.classList.remove("active-tick"), 45);

            const progress = elapsed / spinDuration;
            const pitch = 1200 - progress * 500;
            this.playTick(pitch);
          }

          requestAnimationFrame(trackTicks);
        } else {
          this.onSpinComplete(options);
        }
      };

      requestAnimationFrame(trackTicks);
    }, 150);
  }

  private onSpinComplete(options: CarouselSpinOptions): void {
    this.isSpinning = false;
    const winningItem = options.winningItem;

    // Play victory fanfare sound
    this.playWinningFanfare();

    // Haptic feedback
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate([40, 60, 80]);
      } catch (_) {}
    }

    // Highlight target winning card
    const targetCard = this.strip.querySelector(
      `[data-index="${options.winningIndex}"]`,
    ) as HTMLElement;
    if (targetCard) {
      targetCard.classList.add("highlight-win");
    }

    // Launch Confetti Celebration
    this.startConfetti();

    // Show Result Overlay after 450ms
    setTimeout(() => {
      const rarityEl = this.overlay.querySelector(
        "#cmodal-result-rarity",
      ) as HTMLElement;
      const iconEl = this.overlay.querySelector(
        "#cmodal-result-icon",
      ) as HTMLElement;
      const nameEl = this.overlay.querySelector(
        "#cmodal-result-name",
      ) as HTMLElement;
      const descEl = this.overlay.querySelector(
        "#cmodal-result-desc",
      ) as HTMLElement;
      const celebrationCard = this.overlay.querySelector(
        ".result-card-celebration",
      ) as HTMLElement;
      const specialActionsEl = this.overlay.querySelector(
        "#cmodal-special-actions",
      ) as HTMLElement;

      const isRealGift =
        !!winningItem.isRealGift || winningItem.type === "real_gift";
      const isCrystal =
        winningItem.type === "crystal" ||
        (winningItem.type as any) === "charcoal";
      const rarityColor = this.getRarityColor(winningItem.rarity);
      celebrationCard.style.setProperty("--rarity-color", rarityColor);

      if (rarityEl) {
        if (isRealGift) {
          rarityEl.textContent = `QUÀ HIỆN VẬT PREDATOR`;
          rarityEl.className = `result-badge-rarity rarity-legendary`;
        } else if (isCrystal) {
          rarityEl.textContent = `+${winningItem.amount || 1} TINH THỂ TRI THỨC`;
          rarityEl.className = `result-badge-rarity rarity-rare`;
        } else {
          rarityEl.textContent =
            {
              common: "THƯỜNG",
              rare: "HIẾM",
              epic: "SỬ THI",
              legendary: "HUYỀN THOẠI",
            }[winningItem.rarity] ?? "PHẦN THƯỞNG";
          rarityEl.className = `result-badge-rarity rarity-${winningItem.rarity}`;
        }
      }

      if (iconEl) {
        iconEl.innerHTML = this.getItemIcon(winningItem, 64);
        iconEl.style.color = rarityColor;
      }

      if (nameEl) {
        nameEl.textContent = winningItem.name;
      }

      if (descEl) {
        if (isCrystal) {
          descEl.textContent = `Đã nhận +${winningItem.amount || 1} Tinh Thể! Dùng để nạp và Thắp sáng Đèn hiệu Công trình Tri thức.`;
        } else if (isRealGift) {
          descEl.textContent =
            winningItem.description ||
            "Hiện vật Predator Gaming chính hãng dành cho người chạy xuất sắc!";
        } else {
          descEl.textContent =
            winningItem.description ||
            "Phần thưởng đã được cộng trực tiếp vào hành trang sinh viên!";
        }
      }

      if (specialActionsEl) {
        specialActionsEl.replaceChildren();

        if (winningItem.type === "treasure_map" || options.discoveryCoords) {
          const mapBtn = document.createElement("button");
          mapBtn.type = "button";
          mapBtn.className = "btn-view-map-loc";
          mapBtn.innerHTML = `🗺️ Xem vị trí Rương vừa tìm thấy`;
          mapBtn.addEventListener("click", () => {
            const coords = options.discoveryCoords ?? { x: 500, z: 500 };
            this.close();
            options.onViewTreasureMap?.(coords);
          });
          specialActionsEl.appendChild(mapBtn);
        }

        if (isRealGift || options.giftCode) {
          const code =
            options.giftCode ??
            `R2PL-GIFT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
          const codeBox = document.createElement("div");
          codeBox.className = "gift-code-box";
          codeBox.innerHTML = `
            <span class="gift-code-val">${code}</span>
            <button type="button" class="btn-copy-code" id="btn-copy-code">📋 Sao chép mã Check-in</button>
          `;
          codeBox
            .querySelector("#btn-copy-code")
            ?.addEventListener("click", (e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              navigator.clipboard?.writeText(code);
              btn.textContent = "Đã sao chép! ✓";
            });
          specialActionsEl.appendChild(codeBox);
        }
      }

      this.resultOverlay.removeAttribute("aria-hidden");
      this.resultOverlay.classList.add("show");
    }, 450);
  }

  private startConfetti(): void {
    if (!this.confettiCanvas || !this.confettiCtx) return;

    this.confettiCanvas.width = this.dialog.clientWidth;
    this.confettiCanvas.height = this.dialog.clientHeight;

    const ctx = this.confettiCtx;
    const count = 85;
    const particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      color: string;
      rotation: number;
      vRot: number;
      alpha: number;
    }[] = [];

    const colors = [
      "#00ffe8",
      "#0062ff",
      "#fbbf24",
      "#a855f7",
      "#ef4444",
      "#10b981",
      "#ffffff",
    ];

    for (let i = 0; i < count; i++) {
      particles.push({
        x: this.confettiCanvas.width / 2 + (Math.random() - 0.5) * 120,
        y: this.confettiCanvas.height / 2 - 30,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 12 - 4,
        size: 5 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.25,
        alpha: 1.0,
      });
    }

    const render = () => {
      ctx.clearRect(
        0,
        0,
        this.confettiCanvas.width,
        this.confettiCanvas.height,
      );

      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.38; // Gravity
        p.vx *= 0.985;
        p.rotation += p.vRot;

        if (p.y > this.confettiCanvas.height * 0.4) {
          p.alpha -= 0.012;
        }

        if (p.alpha > 0) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.4);
          ctx.restore();
        }
      }

      if (alive) {
        this.confettiAnimationId = requestAnimationFrame(render);
      }
    };

    render();
  }

  private stopConfetti(): void {
    if (this.confettiAnimationId) {
      cancelAnimationFrame(this.confettiAnimationId);
      this.confettiAnimationId = null;
    }
    if (this.confettiCtx && this.confettiCanvas) {
      this.confettiCtx.clearRect(
        0,
        0,
        this.confettiCanvas.width,
        this.confettiCanvas.height,
      );
    }
  }

  public close(): void {
    this.isSpinning = false;
    this.stopConfetti();
    this.overlay.classList.remove("visible");
    setTimeout(() => {
      this.overlay.style.display = "none";
      this.resultOverlay.classList.remove("show");
    }, 250);
  }

  public isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }
}
