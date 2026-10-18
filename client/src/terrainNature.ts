import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import { chunkCoordinatesForId } from "../../shared/world/coordinates.ts";
import {
  getTerrainMoisture,
  type TerrainBiomes,
  terrainHash,
} from "./terrainBiomes.ts";

export type NatureKind = "oak" | "birch" | "grass" | "red" | "yellow" | "blue";
export interface NatureInstance {
  readonly kind: NatureKind;
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly scale: number;
  readonly rotation: number;
}
/** The caller chooses public scenery or an own-school discovery-filtered plan. */
export function* naturePlanRows(
  field: TerrainBiomes,
  id: number,
  discovered: (x: number, z: number) => boolean,
  treeJitter = 0,
): Generator<void, NatureInstance[]> {
  const { chunkX, chunkZ } = chunkCoordinatesForId(id),
    list: NatureInstance[] = [];
  const C = GAME_CONFIG.terrain;
  for (let row = 0; row < 64; row++) {
    const z = chunkZ * 64 + row;
    if (z >= 1000) break;
    for (let col = 0; col < 64; col++) {
      const x = chunkX * 64 + col;
      if (
        x >= 1000 ||
        !discovered(x, z) ||
        field.isFoundation(x + 0.5, z + 0.5, 2)
      )
        continue;
      const sample = field.sample(x, z);
      if (sample.height < 0) continue;
      const roll = terrainHash(x, z, 11);
      const add = (kind: NatureKind, scale: number) => {
        const tree = kind === "oak" || kind === "birch";
        const px =
          x + 0.5 + (tree ? (terrainHash(x, z, 41) - 0.5) * treeJitter : 0);
        const pz =
          z + 0.5 + (tree ? (terrainHash(x, z, 42) - 0.5) * treeJitter : 0);
        if (
          px < 0 ||
          pz < 0 ||
          px >= 1000 ||
          pz >= 1000 ||
          field.isFoundation(px, pz, 2)
        )
          return;
        const height = field.getTerrainHeight(px, pz);
        if (height < 0) return;
        list.push({
          kind,
          x: px,
          z: pz,
          height,
          scale,
          rotation: terrainHash(x, z, 5) * Math.PI * 2,
        });
      };
      if (x % C.treeSpacing === 0 && z % C.treeSpacing === 0 && roll < 0.62) {
        add(
          getTerrainMoisture(x, z) > 0.6 ? "birch" : "oak",
          0.8 + terrainHash(x, z, 7) * 0.25,
        );
      } else if (x % C.grassSpacing === 0 && z % C.grassSpacing === 0) {
        if (sample.biome === "flower_meadow" && roll < 0.84)
          add(
            (["red", "yellow", "blue"] as const)[
              Math.floor(terrainHash(x, z, 14) * 3)
            ]!,
            0.85 + roll * 0.4,
          );
        else if (roll < 0.82) add("grass", 0.8 + roll * 0.6);
      }
    }
    if ((row + 1) % C.buildRowsPerFrame === 0) yield;
  }
  return list;
}
