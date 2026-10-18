import {
  GAME_CONFIG,
  STAGING_OBJECTS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";

const C = GAME_CONFIG.terrain;
export type TerrainBiome =
  | "foundation"
  | "river"
  | "lake"
  | "sand"
  | "hills"
  | "highlands"
  | "lush_grass"
  | "flower_meadow";
export interface TerrainSample {
  readonly height: number;
  readonly biome: TerrainBiome;
  readonly color: number;
}
interface Foundation {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  circle: boolean;
}

/** Seeded 2D simplex adapted from the approved V1 terrainNoise.ts. */
export function createNoise2D(seed: number): (x: number, z: number) => number {
  const p = Uint8Array.from({ length: 256 }, (_, i) => i);
  const perm = new Uint8Array(512);
  let state = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1),
      old = p[i]!;
    p[i] = p[j]!;
    p[j] = old;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  const f = (Math.sqrt(3) - 1) / 2,
    g = (3 - Math.sqrt(3)) / 6;
  const corner = (hash: number, x: number, y: number): number => {
    let t = 0.5 - x * x - y * y;
    if (t <= 0) return 0;
    const h = hash & 7,
      u = h < 4 ? x : y,
      v = h < 4 ? y : x;
    t *= t;
    return t * t * ((h & 1 ? -u : u) + (h & 2 ? -2 * v : 2 * v));
  };
  return (x, y) => {
    const skew = (x + y) * f,
      i = Math.floor(x + skew),
      j = Math.floor(y + skew),
      unskew = (i + j) * g;
    const x0 = x - i + unskew,
      y0 = y - j + unskew;
    const ix = x0 > y0 ? 1 : 0,
      iy = 1 - ix,
      ii = i & 255,
      jj = j & 255;
    return Math.max(
      -1,
      Math.min(
        1,
        70 *
          (corner(perm[ii + perm[jj]!]!, x0, y0) +
            corner(perm[ii + ix + perm[jj + iy]!]!, x0 - ix + g, y0 - iy + g) +
            corner(
              perm[ii + 1 + perm[jj + 1]!]!,
              x0 - 1 + 2 * g,
              y0 - 1 + 2 * g,
            )),
      ),
    );
  };
}
const elevation = createNoise2D(C.heightSeed),
  moisture = createNoise2D(C.moistureSeed);
export function terrainHash(x: number, z: number, salt = 0): number {
  let n =
    Math.imul(x, 374761393) ^
    Math.imul(z, 668265263) ^
    Math.imul(salt + C.heightSeed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function getTerrainMoisture(x: number, z: number): number {
  return (moisture(x * C.moistureFrequency, z * C.moistureFrequency) + 1) / 2;
}

export class TerrainBiomes {
  readonly #zones = new Map<number, Foundation[]>();
  readonly #rivers = [new Float32Array(1001), new Float32Array(1001)];
  #foundations: Foundation[] = [];
  #signature = "";
  constructor(objects: readonly WorldObject[] = STAGING_OBJECTS) {
    this.setObjects(objects);
  }

  /** Public layout overrides the fixed defaults; no wallet or rival fog is read. */
  setObjects(objects: readonly WorldObject[]): boolean {
    const catalog = new Map(
      STAGING_OBJECTS.filter(
        (o) => o.kind === "hq" || o.kind === "landmark",
      ).map((o) => [o.id, o]),
    );
    for (const object of objects) catalog.set(object.id, object);
    const ordered = [...catalog.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const signature = JSON.stringify(
      ordered.map((o) => [o.id, o.kind, o.x, o.z]),
    );
    if (signature === this.#signature) return false;
    this.#signature = signature;
    this.#foundations = ordered.map((o) => {
      const size =
        o.kind === "hq"
          ? [C.foundations.hqRadius * 2, C.foundations.hqRadius * 2]
          : C.foundations[o.kind];
      return {
        x: o.x,
        z: o.z,
        halfX: size[0]! / 2,
        halfZ: size[1]! / 2,
        circle: o.kind === "hq",
      };
    });
    this.#zones.clear();
    for (const zone of this.#foundations)
      for (
        let z = Math.max(0, Math.floor((zone.z - zone.halfZ - 2) / 64));
        z <= Math.min(15, Math.floor((zone.z + zone.halfZ + 2) / 64));
        z++
      )
        for (
          let x = Math.max(0, Math.floor((zone.x - zone.halfX - 2) / 64));
          x <= Math.min(15, Math.floor((zone.x + zone.halfX + 2) / 64));
          x++
        ) {
          const key = z * 16 + x,
            list = this.#zones.get(key) ?? [];
          list.push(zone);
          this.#zones.set(key, list);
        }
    // Two smooth arms pass through the inter-school gaps and meet the central lake.
    // Detours are prepared once per layout, never during a tile lookup/render.
    for (let arm = 0; arm < 2; arm++)
      for (let z = 0; z <= 1000; z++) {
        const baseline =
          500 +
          (arm === 0 ? 500 - z : z - 500) * 0.48 +
          Math.sin((z - 500) * 0.019) * 18;
        let x = baseline;
        for (let pass = 0; pass < 2; pass++)
          for (const zone of this.#foundations) {
            const clearance = C.riverHalfWidth + C.shoreWidth + 4;
            const dz = Math.abs(z - zone.z),
              core = zone.halfZ + clearance;
            if (
              dz > core + 28 ||
              Math.abs(x - zone.x) > zone.halfX + clearance + 12
            )
              continue;
            const t = Math.max(0, Math.min(1, (core + 28 - dz) / 28)),
              blend = t * t * (3 - 2 * t);
            const side =
              500 +
                (arm === 0 ? 500 - zone.z : zone.z - 500) * 0.48 +
                Math.sin((zone.z - 500) * 0.019) * 18 <
              zone.x
                ? -1
                : 1;
            const edge = zone.x + side * (zone.halfX + clearance);
            if (Math.abs(x - zone.x) < zone.halfX + clearance)
              x += (edge - x) * blend;
          }
        this.#rivers[arm]![z] = x;
      }
    return true;
  }

  isFoundation(x: number, z: number, margin = 0): boolean {
    const zones =
      this.#zones.get(Math.floor(z / 64) * 16 + Math.floor(x / 64)) ?? [];
    return zones.some((o) =>
      o.circle
        ? Math.hypot(x - o.x, z - o.z) <= o.halfX + margin
        : Math.abs(x - o.x) <= o.halfX + margin &&
          Math.abs(z - o.z) <= o.halfZ + margin,
    );
  }
  intersectsFoundation(x: number, z: number, size: number): boolean {
    return this.#foundations.some(
      (o) =>
        x <= o.x + o.halfX &&
        x + size >= o.x - o.halfX &&
        z <= o.z + o.halfZ &&
        z + size >= o.z - o.halfZ,
    );
  }
  sample(x: number, z: number): TerrainSample {
    x = Math.floor(x);
    z = Math.floor(z);
    if (this.isFoundation(x + 0.5, z + 0.5))
      return { height: 0, biome: "foundation", color: 0x689f38 };
    const row = Math.max(0, Math.min(1000, z));
    const path = this.#rivers[z < 500 ? 0 : 1]!;
    const slope =
      (path[Math.min(1000, row + 1)]! - path[Math.max(0, row - 1)]!) / 2;
    const river =
      Math.abs(x + 0.5 - path[row]!) / Math.sqrt(1 + slope * slope) -
      C.riverHalfWidth;
    const lake =
      Math.hypot(x + 0.5 - 500, z + 0.5 - 500) -
      C.lakeRadius +
      elevation(x * 0.035, z * 0.035) * 2;
    if (lake < 0)
      return { height: C.waterHeight, biome: "lake", color: 0x2563eb };
    if (river < 0)
      return { height: C.waterHeight, biome: "river", color: 0x3f76e4 };
    if (Math.min(lake, river) < C.shoreWidth)
      return { height: C.sandHeight, biome: "sand", color: 0xd8c593 };
    const n =
      elevation(x * C.heightFrequency, z * C.heightFrequency) * 0.8 +
      elevation(x * 0.022 + 91, z * 0.022 - 18) * 0.2;
    let height = 0;
    for (let i = 0; i < C.hillThresholds.length; i++)
      if (n > C.hillThresholds[i]!) height = C.hillHeights[i]!;
    if (getTerrainMoisture(x, z) > C.meadowMoisture && height <= 0.4) {
      // Flowers belong to revealed 3D instances, never to an entire ground tile.
      const color = terrainHash(x, z, 4) > 0.5 ? 0x5b8c32 : 0x689f38;
      return { height, biome: "flower_meadow", color };
    }
    return {
      height,
      biome: height >= 0.85 ? "highlands" : height > 0 ? "hills" : "lush_grass",
      color:
        height > 0 ? 0x4e7a27 : terrainHash(x, z) > 0.5 ? 0x5b8c32 : 0x689f38,
    };
  }
  getTerrainHeight(x: number, z: number): number {
    return this.sample(x, z).height;
  }
  getTerrainBiome(x: number, z: number): TerrainBiome {
    return this.sample(x, z).biome;
  }
}
const defaultTerrain = new TerrainBiomes();
export const getTerrainHeight = (x: number, z: number): number =>
  defaultTerrain.getTerrainHeight(x, z);
export const getTerrainBiome = (x: number, z: number): TerrainBiome =>
  defaultTerrain.getTerrainBiome(x, z);
