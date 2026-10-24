export interface ScreenPoint {
  x: number;
  y: number;
}
export interface CameraPointer extends ScreenPoint {
  pointerId: number;
  button: number;
  shiftKey?: boolean;
}
export type CameraMotion =
  | { kind: "pan"; from: ScreenPoint; to: ScreenPoint }
  | { kind: "orbit"; dx: number; dy: number }
  | {
      kind: "gesture";
      from: ScreenPoint;
      to: ScreenPoint;
      zoom: number;
      rotation: number;
    };

function pair(points: readonly ScreenPoint[]) {
  const [a, b] = points;
  if (!a || !b) return undefined;
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** Shared input arbitration: no camera gesture can also become a gameplay click. */
export class MapCameraInput {
  private pointers = new Map<number, ScreenPoint>();
  private drag:
    | { start: ScreenPoint; last: ScreenPoint; moved: boolean; orbit: boolean }
    | undefined;
  get active(): boolean {
    return this.pointers.size > 0;
  }

  begin(pointer: CameraPointer): void {
    this.pointers.set(pointer.pointerId, { x: pointer.x, y: pointer.y });
    this.drag =
      this.pointers.size === 1
        ? {
            start: pointer,
            last: pointer,
            moved: false,
            orbit: pointer.button !== 0 || pointer.shiftKey === true,
          }
        : undefined;
  }

  move(pointer: CameraPointer): CameraMotion | undefined {
    if (!this.pointers.has(pointer.pointerId)) return;
    const before = pair([...this.pointers.values()]);
    this.pointers.set(pointer.pointerId, { x: pointer.x, y: pointer.y });
    if (this.pointers.size === 2 && before) {
      const after = pair([...this.pointers.values()])!;
      return {
        kind: "gesture",
        from: before.center,
        to: after.center,
        zoom: Math.max(10, before.distance) / Math.max(10, after.distance),
        rotation: Math.atan2(
          Math.sin(after.angle - before.angle),
          Math.cos(after.angle - before.angle),
        ),
      };
    }
    if (this.pointers.size !== 1 || !this.drag) return;
    const drag = this.drag;
    if (Math.hypot(pointer.x - drag.start.x, pointer.y - drag.start.y) > 5)
      drag.moved = true;
    if (!drag.moved) return;
    const last = drag.last;
    drag.last = { x: pointer.x, y: pointer.y };
    return drag.orbit
      ? { kind: "orbit", dx: pointer.x - last.x, dy: pointer.y - last.y }
      : { kind: "pan", from: last, to: pointer };
  }

  end(pointer: CameraPointer, cancelled = false): boolean {
    const tracked = this.pointers.has(pointer.pointerId);
    const click =
      tracked &&
      !cancelled &&
      this.pointers.size === 1 &&
      !!this.drag &&
      !this.drag.orbit &&
      !this.drag.moved &&
      Math.hypot(
        pointer.x - this.drag.start.x,
        pointer.y - this.drag.start.y,
      ) <= 5;
    this.pointers.delete(pointer.pointerId);
    this.drag = undefined;
    return click;
  }

  /** Browser gestures and focus changes can swallow the final pointer-up. */
  cancel(): readonly number[] {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.drag = undefined;
    return ids;
  }
}
