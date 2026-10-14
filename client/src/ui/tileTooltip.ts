/** V1 tooltip adapted to V2's own-school projection and public object catalog. */
import {
  GAME_CONFIG,
  LANDMARKS,
  type WorldObject,
} from "../../../shared/gameplay/gameConfig.ts";
export class TileTooltip {
  private element = document.createElement("div");
  constructor(parent: HTMLElement = document.body) {
    this.element.className = "tile-tactical-tooltip";
    this.element.hidden = true;
    parent.append(this.element);
  }
  show(tile: {
    x: number;
    z: number;
    owned: boolean;
    discovered: boolean;
    adjacent: boolean;
    object?: WorldObject | undefined;
  }): void {
    this.element.hidden = false;
    const title = document.createElement("b");
    title.textContent = tile.object?.name ?? `Ô tri thức ${tile.x}, ${tile.z}`;
    const detail = document.createElement("p");
    detail.textContent = tile.object
      ? `${tile.object.width}×${tile.object.height} · ${tile.object.kind}`
      : tile.owned
        ? "Tri thức trường mình · 0 Points"
        : tile.adjacent
          ? `Khám phá · ${GAME_CONFIG.knowledge.explorePoints} Point`
          : tile.discovered
            ? "Đã khám phá · cần chung cạnh tri thức"
            : "Sương mù · cần mở đường từ HQ";
    this.element.replaceChildren(title, detail);
    const landmark = LANDMARKS.find((l) => l.id === tile.object?.id);
    if (landmark) {
      const buff = document.createElement("p");
      buff.textContent = landmark.buffDescription;
      this.element.append(buff);
    }
  }
  hide(): void {
    this.element.hidden = true;
  }
}
