import {
  GAME_CONFIG,
  type WorldObject,
} from "../../../shared/gameplay/gameConfig.ts";
import type { ProjectionReplica } from "../../../shared/protocol/replica.ts";
import { chunkId, localIndex } from "../../../shared/world/coordinates.ts";

export type UiMode = "player" | "dev" | "admin";
export function uiModeFromSearch(search: string): UiMode {
  const params = new URLSearchParams(search);
  return params.get("mode") === "dev"
    ? "dev"
    : params.get("admin") === "1"
      ? "admin"
      : "player";
}
export function objectDisplayName(
  object: Pick<WorldObject, "kind" | "name" | "tier">,
  solved = true,
): string {
  if (object.kind === "landmark" && !solved) return "Công trình bí ẩn";
  if (object.kind === "hq")
    return "Trụ sở " + object.name.replace(/\s+HQ$/i, "");
  if (object.kind === "unistop")
    return (
      "Trạm " +
      (object.tier === "nitro"
        ? "Nitro"
        : object.tier === "predator"
          ? "Predator"
          : "Aspire")
    );
  if (object.kind === "chest")
    return (
      "Rương " +
      (object.tier === "nitro"
        ? "Nitro"
        : object.tier === "predator"
          ? "Predator"
          : "Aspire")
    );
  return object.name;
}
export function footprintDiscovered(
  object: Pick<WorldObject, "x" | "z" | "width" | "height">,
  replica: ProjectionReplica | undefined,
): boolean {
  if (!replica) return false;
  const left = Math.max(0, Math.floor(object.x - object.width / 2));
  const top = Math.max(0, Math.floor(object.z - object.height / 2));
  for (let z = top; z < Math.min(1000, top + object.height); z++)
    for (let x = left; x < Math.min(1000, left + object.width); x++) {
      const id = chunkId(Math.floor(x / 64), Math.floor(z / 64));
      if (replica.hasChunk(id) && replica.isDiscovered(id, localIndex(x, z)))
        return true;
    }
  return false;
}
export interface LabelCandidate {
  id: string;
  kind: string;
  ownHq: boolean;
  discovered: boolean;
  selected: boolean;
  hovered: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}
export function layoutMapLabels(
  candidates: readonly LabelCandidate[],
  span: number,
  viewport: { width: number; height: number },
): Map<string, "hidden" | "icon" | "name"> {
  const result = new Map<string, "hidden" | "icon" | "name">();
  const occupied: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }[] = [];
  const config = GAME_CONFIG.presentation;
  const sorted = [...candidates].sort(
    (a, b) =>
      Number(b.selected) - Number(a.selected) ||
      Number(b.hovered) - Number(a.hovered) ||
      Number(b.ownHq) - Number(a.ownHq) ||
      a.id.localeCompare(b.id),
  );
  for (const c of sorted) {
    if (
      c.x < 0 ||
      c.y < 0 ||
      c.x > viewport.width ||
      c.y > viewport.height ||
      (c.kind === "unistop" && !c.discovered)
    ) {
      result.set(c.id, "hidden");
      continue;
    }
    const name =
      c.selected ||
      c.hovered ||
      (span <= config.labelNameSpan && (c.ownHq || c.discovered));
    const width = name ? c.width : config.markerIconSize,
      height = name ? c.height : config.markerIconSize;
    const rect = {
      left: c.x - width / 2 - config.labelGap,
      right: c.x + width / 2 + config.labelGap,
      top: c.y - config.labelGap,
      bottom: c.y + height + config.labelGap,
    };
    const collision = occupied.some(
      (r) =>
        rect.left < r.right &&
        rect.right > r.left &&
        rect.top < r.bottom &&
        rect.bottom > r.top,
    );
    if (collision && !c.selected && !c.hovered) {
      result.set(c.id, "hidden");
      continue;
    }
    occupied.push(rect);
    result.set(c.id, name ? "name" : "icon");
  }
  return result;
}

/** Translate persisted campaign copy without changing reconciliation codes. */
export function campaignDisplayText(text: string): string {
  return text
    .replace(/Shared Knowledge/g, "Tri Thức chung")
    .replace(/Crystal pot/g, "quỹ Tinh Thể")
    .replace(/\bCrystals?\b/g, "Tinh Thể")
    .replace(/\bPoints?\b/g, "Điểm")
    .replace(/\bRunning\b/g, "Thành tích chạy")
    .replace(/\bUniStop\b/g, "trạm tiếp tế")
    .replace(/\bcluster\b/g, "cụm tri thức");
}
