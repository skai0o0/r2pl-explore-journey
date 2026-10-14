import { GAME_CONFIG } from "./gameConfig.ts";
export interface TileAction {
  readonly tileIndex: number;
  readonly action: "owned" | "explore" | "study" | "blocked";
  readonly points: number;
}
/** Only a selected, adjacent tile's action is disclosed; raw rival masks stay on the server. */
export function selectedTileAction(
  tileIndex: number,
  mask: number,
  slot: number,
  adjacent: boolean,
  protectedHq: boolean,
): TileAction {
  const action = protectedHq
    ? "blocked"
    : mask & (1 << slot)
      ? "owned"
      : !adjacent || (mask !== 0 && (mask & (mask - 1)) !== 0)
        ? "blocked"
        : mask === 0
          ? "explore"
          : "study";
  return {
    tileIndex,
    action,
    points:
      action === "explore"
        ? GAME_CONFIG.knowledge.explorePoints
        : action === "study"
          ? GAME_CONFIG.knowledge.sharedPoints
          : 0,
  };
}
