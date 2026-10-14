import {
  SCHOOLS,
  type WorldObject,
} from "../../../shared/gameplay/gameConfig.ts";

/** Compass / "Mục tiêu tiếp theo" card: nearest Aspire station + nearest Landmark. */
export interface CompassHooks {
  /** Nearest owned (or HQ edge) tile to a target and its tile gap. */
  nearestOwned(target: WorldObject): {
    distance: number;
    tile: { x: number; z: number };
  };
  focus(x: number, z: number, span?: number): void;
}

const DIRECTIONS = [
  "Đông",
  "Đông Nam",
  "Nam",
  "Tây Nam",
  "Tây",
  "Tây Bắc",
  "Bắc",
  "Đông Bắc",
] as const;
/** Map z grows southwards. Returns the 8-way Vietnamese compass direction. */
export function directionLabel(dx: number, dz: number): string {
  if (dx === 0 && dz === 0) return "ngay tại đây";
  const angle = Math.atan2(dz, dx); // 0 = East, +90deg = South
  const sector = Math.round(angle / (Math.PI / 4));
  return DIRECTIONS[((sector % 8) + 8) % 8]!;
}
const ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"] as const;
function arrowFor(dx: number, dz: number): string {
  const sector = Math.round(Math.atan2(dz, dx) / (Math.PI / 4));
  return ARROWS[((sector % 8) + 8) % 8]!;
}

export interface CompassTarget {
  readonly object: WorldObject;
  readonly distance: number;
  readonly from: { x: number; z: number };
  readonly direction: string;
  readonly arrow: string;
}

export function nearestTarget(
  objects: readonly WorldObject[],
  hooks: Pick<CompassHooks, "nearestOwned">,
  match: (o: WorldObject) => boolean,
): CompassTarget | undefined {
  let best: CompassTarget | undefined;
  for (const object of objects) {
    if (!match(object)) continue;
    const owned = hooks.nearestOwned(object);
    if (!best || owned.distance < best.distance) {
      const dx = object.x - owned.tile.x;
      const dz = object.z - owned.tile.z;
      best = {
        object,
        distance: owned.distance,
        from: owned.tile,
        direction: directionLabel(dx, dz),
        arrow: arrowFor(dx, dz),
      };
    }
  }
  return best;
}

export class CompassCard {
  readonly element = document.createElement("section");
  readonly #objects: readonly WorldObject[];
  readonly #hooks: CompassHooks;
  #slot = 0;
  #timer: number | undefined;
  #toast: HTMLElement | undefined;

  constructor(objects: readonly WorldObject[], hooks: CompassHooks) {
    this.#objects = objects;
    this.#hooks = hooks;
    this.element.className = "compass-card glass";
    this.element.setAttribute("aria-label", "Mục tiêu tiếp theo");
    this.element.dataset.ui = "true";
    document.body.append(this.element);
    this.refresh();
  }

  setSchool(slot: number): void {
    this.#slot = slot;
    this.refresh();
  }

  /** Debounced: tile paints can arrive in bursts. */
  refreshSoon(): void {
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => this.refresh(), 200);
  }

  refresh(): void {
    const school = SCHOOLS[this.#slot]!;
    this.element.style.setProperty("--school", school.color);
    const station = nearestTarget(
      this.#objects,
      this.#hooks,
      (o) => o.kind === "unistop" && o.tier === "aspire",
    );
    const landmark = nearestTarget(
      this.#objects,
      this.#hooks,
      (o) => o.kind === "landmark",
    );
    this.element.replaceChildren();
    const title = document.createElement("p");
    title.className = "eyebrow";
    title.textContent = "MỤC TIÊU TIẾP THEO";
    this.element.append(title);
    if (station)
      this.element.append(
        this.#row(
          "compass-station",
          "Trạm tiếp tế Aspire gần nhất",
          station,
          "Mở đường ngay!",
        ),
      );
    if (landmark)
      this.element.append(
        this.#row(
          "compass-landmark",
          `Địa danh gần nhất · ${landmark.object.name}`,
          landmark,
          "Tích Points mở đường!",
        ),
      );
  }

  #row(
    cls: string,
    label: string,
    target: CompassTarget,
    cta: string,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = `compass-row ${cls}`;
    const arrow = document.createElement("span");
    arrow.className = "compass-arrow";
    arrow.textContent = target.distance === 0 ? "✓" : target.arrow;
    const copy = document.createElement("div");
    copy.className = "compass-copy";
    const heading = document.createElement("b");
    heading.textContent = label;
    const detail = document.createElement("small");
    detail.textContent =
      target.distance === 0
        ? "Đã chạm tới — bấm để xem ngay!"
        : `Cách ${target.distance} ô về hướng ${target.direction} — ${cta}`;
    copy.append(heading, detail);
    const view = document.createElement("button");
    view.type = "button";
    view.className = "compass-view";
    view.textContent = "Xem vị trí";
    view.addEventListener("click", () =>
      this.#hooks.focus(target.object.x, target.object.z, 90),
    );
    const edge = document.createElement("button");
    edge.type = "button";
    edge.className = "compass-edge";
    edge.title = "Lia tới ô tri thức gần mục tiêu nhất";
    edge.textContent = "Rìa tri thức";
    edge.addEventListener("click", () =>
      this.#hooks.focus(target.from.x, target.from.z, 60),
    );
    row.append(arrow, copy, view, edge);
    return row;
  }

  /** One-shot welcome toast: "Chào mừng chiến binh [Trường]! Bạn đang có [X] Points". */
  welcome(schoolName: string, points: string | number): void {
    this.#toast?.remove();
    const toast = document.createElement("div");
    toast.className = "welcome-toast glass";
    toast.setAttribute("role", "status");
    toast.textContent = `Chào mừng chiến binh ${schoolName}! Bạn đang có ${points} Points từ giải chạy.`;
    document.body.append(toast);
    this.#toast = toast;
    window.setTimeout(() => toast.remove(), 7000);
  }
}
