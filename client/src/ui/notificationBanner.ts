import { GAME_CONFIG } from "../../../shared/gameplay/gameConfig.ts";
import { Icons } from "./icons.ts";
// client/src/ui/notificationBanner.ts

export interface NotificationBannerOptions {
  title: string;
  body: string;
  icon?: string | undefined;
  durationMs?: number | undefined;
  category?: "territory" | "landmark" | "gacha" | "rank" | string | undefined;
  onClick?: (() => void) | undefined;
  expiresAtMs?: number | undefined;
}

class SoundSynthesizer {
  private static audioCtx: AudioContext | null = null;

  public static playChime(): void {
    try {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!SoundSynthesizer.audioCtx) {
        SoundSynthesizer.audioCtx = new AudioCtx();
      }
      if (SoundSynthesizer.audioCtx.state === "suspended") {
        SoundSynthesizer.audioCtx.resume();
      }
      const ctx = SoundSynthesizer.audioCtx;
      const now = ctx.currentTime;

      // Predator HUD x Duolingo signature harmonic chime (A5 -> C#6 -> E6)
      const playTone = (
        freq: number,
        startTime: number,
        duration: number,
        gainVal: number,
      ) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(gainVal, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      playTone(880.0, now, 0.45, 0.06); // A5
      playTone(1108.73, now + 0.08, 0.5, 0.07); // C#6
      playTone(1318.51, now + 0.16, 0.6, 0.06); // E6
    } catch {
      // Audio playback may be restricted before initial user gesture
    }
  }
}

export class NotificationBanner {
  private static container: HTMLElement | null = null;
  private static activeBanners: HTMLElement[] = [];
  private static queue: {
    options: NotificationBannerOptions;
    element: HTMLElement;
    expires: number;
  }[] = [];
  private static transitionUntil = 0;
  private static pumpTimer: ReturnType<typeof setTimeout> | undefined;
  private static exiting = new WeakSet<HTMLElement>();
  private static timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  private static ensureContainer(): HTMLElement {
    if (
      !NotificationBanner.container ||
      !document.body.contains(NotificationBanner.container)
    ) {
      NotificationBanner.container = document.createElement("div");
      NotificationBanner.container.id = "notification-banner-container";
      NotificationBanner.container.className = "notification-banner-container";
      NotificationBanner.container.setAttribute("data-ui", "true");
      document.body.appendChild(NotificationBanner.container);
    }
    return NotificationBanner.container;
  }

  private static getCategoryMeta(category?: string): {
    label: string;
    color: string;
    borderGlow: string;
  } {
    switch (category) {
      case "error":
        return {
          label: "CHƯA THỂ THỰC HIỆN",
          color: "var(--danger)",
          borderGlow: "none",
        };
      case "territory":
        return {
          label: "LÃNH THỔ",
          color: "#00ffe8",
          borderGlow: "rgba(0, 255, 232, 0.4)",
        };
      case "landmark":
        return {
          label: "ĐÈN HIỆU & KỲ QUAN",
          color: "#fbbf24",
          borderGlow: "rgba(251, 191, 36, 0.4)",
        };
      case "gacha":
        return {
          label: "TIẾP TẾ & RƯƠNG",
          color: "#a855f7",
          borderGlow: "rgba(168, 85, 247, 0.4)",
        };
      case "rank":
        return {
          label: "BẢNG XẾP HẠNG",
          color: "#10b981",
          borderGlow: "rgba(16, 185, 129, 0.4)",
        };
      default:
        return {
          label: "THÔNG BÁO PREDATOR",
          color: "#00ffe8",
          borderGlow: "rgba(0, 255, 232, 0.4)",
        };
    }
  }

  private static resolveIcon(icon?: string): string {
    switch (icon) {
      case "gift":
        return Icons.box(20);
      case "key":
        return Icons.key(20);
      case "map":
        return Icons.map(20);
      case "trophy":
        return Icons.trophy(20);
      case "flame":
        return Icons.beacon(20);
      case "check-circle":
        return Icons.check(20);
      default:
        return Icons.target(20);
    }
  }

  public static show(options: NotificationBannerOptions): HTMLElement {
    const element = document.createElement("div");
    const expires = Math.min(
      options.expiresAtMs ?? Infinity,
      Date.now() + GAME_CONFIG.notifications.queueTtlMs,
    );
    if (expires <= Date.now() || document.hidden) return element;
    if (NotificationBanner.queue.length >= GAME_CONFIG.notifications.maxQueued)
      NotificationBanner.queue.shift();
    NotificationBanner.queue.push({ options, element, expires });
    NotificationBanner.pump();
    return element;
  }
  private static pump(): void {
    if (NotificationBanner.activeBanners.length || document.hidden) return;
    if (Date.now() < NotificationBanner.transitionUntil) {
      clearTimeout(NotificationBanner.pumpTimer);
      NotificationBanner.pumpTimer = setTimeout(
        () => NotificationBanner.pump(),
        NotificationBanner.transitionUntil - Date.now(),
      );
      return;
    }
    while (NotificationBanner.queue.length) {
      const next = NotificationBanner.queue.shift()!;
      if (next.expires <= Date.now()) continue;
      NotificationBanner.render(
        {
          ...next.options,
          durationMs: Math.min(
            next.options.durationMs ?? GAME_CONFIG.notifications.bannerMs,
            next.expires - Date.now(),
          ),
        },
        next.element,
      );
      break;
    }
  }
  private static render(
    options: NotificationBannerOptions,
    banner: HTMLElement,
  ): HTMLElement {
    const container = NotificationBanner.ensureContainer();
    const durationMs = options.durationMs ?? 6000;
    const catMeta = NotificationBanner.getCategoryMeta(options.category);
    const iconSymbol = NotificationBanner.resolveIcon(options.icon);

    // Play pleasant synthesized chime
    SoundSynthesizer.playChime();

    banner.className = "predator-push-banner";
    banner.setAttribute("role", "status");
    for (const name of ["pointerdown", "pointerup", "click"])
      banner.addEventListener(name, (e) => e.stopPropagation());
    banner.dataset.category = options.category ?? "normal";
    banner.style.setProperty("--banner-accent", catMeta.color);
    banner.style.setProperty("--banner-glow", catMeta.borderGlow);

    banner.innerHTML = `
      <div class="banner-top-accent"></div>
      <div class="banner-main-row">
        <div class="banner-avatar">
          <span class="banner-icon-symbol">${iconSymbol}</span>
        </div>
        <div class="banner-body-content">
          <div class="banner-meta-header">
            <span class="banner-app-tag">R2PL 2027</span>
            <span class="banner-cat-badge">${catMeta.label}</span>
          </div>
          <div class="banner-title">${NotificationBanner.escapeHtml(options.title)}</div>
          <div class="banner-desc">${NotificationBanner.escapeHtml(options.body)}</div>
        </div>
        <button class="banner-close-btn" title="Đóng thông báo">✕</button>
      </div>
      <div class="banner-progress-track">
        <div class="banner-progress-bar"></div>
      </div>
    `;

    // Click behavior
    if (options.onClick) {
      banner.style.cursor = "pointer";
      banner.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".banner-close-btn")) return;
        options.onClick?.();
        NotificationBanner.dismiss(banner);
      });
    }

    const closeBtn = banner.querySelector(".banner-close-btn");
    closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      NotificationBanner.dismiss(banner);
    });

    container.appendChild(banner);
    NotificationBanner.activeBanners.push(banner);

    // Trigger enter animation
    banner.classList.add("banner-visible");

    // Animate progress bar
    const progressBar = banner.querySelector(
      ".banner-progress-bar",
    ) as HTMLElement | null;
    if (progressBar) {
      progressBar.style.transition = `width ${durationMs}ms linear`;
      requestAnimationFrame(() => {
        progressBar.style.width = "0%";
      });
    }

    // Auto dismiss timer
    let autoDismissTimer = setTimeout(() => {
      NotificationBanner.dismiss(banner);
    }, durationMs);

    NotificationBanner.timers.set(banner, autoDismissTimer);
    // Pause on hover, resume on mouse leave
    banner.addEventListener("mouseenter", () => {
      clearTimeout(autoDismissTimer);
      if (progressBar) {
        const computedWidth = window.getComputedStyle(progressBar).width;
        progressBar.style.transition = "none";
        progressBar.style.width = computedWidth;
      }
    });

    banner.addEventListener("mouseleave", () => {
      autoDismissTimer = setTimeout(() => {
        NotificationBanner.dismiss(banner);
      }, 2000);
      NotificationBanner.timers.set(banner, autoDismissTimer);
      if (progressBar) {
        progressBar.style.transition = "width 2000ms linear";
        progressBar.style.width = "0%";
      }
    });

    return banner;
  }

  public static dismiss(banner: HTMLElement): void {
    if (!banner?.parentElement || NotificationBanner.exiting.has(banner))
      return;
    clearTimeout(NotificationBanner.timers.get(banner));
    NotificationBanner.timers.delete(banner);
    NotificationBanner.exiting.add(banner);
    NotificationBanner.transitionUntil = Date.now() + 320;
    banner.classList.remove("banner-visible");
    banner.classList.add("banner-exit");

    const index = NotificationBanner.activeBanners.indexOf(banner);
    if (index !== -1) {
      NotificationBanner.activeBanners.splice(index, 1);
    }

    setTimeout(() => {
      banner.remove();
      NotificationBanner.pump();
    }, 320);
  }

  public static clearAll(): void {
    NotificationBanner.queue = [];
    clearTimeout(NotificationBanner.pumpTimer);
    NotificationBanner.transitionUntil = 0;
    for (const b of NotificationBanner.activeBanners) {
      clearTimeout(NotificationBanner.timers.get(b));
      NotificationBanner.timers.delete(b);
      b.remove();
    }
    NotificationBanner.activeBanners = [];
    NotificationBanner.container?.replaceChildren();
  }

  private static escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
