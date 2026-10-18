import {
  type HeadquartersArea,
  headquartersOwner,
} from "../gameplay/expansion.ts";
/** Non-authoritative bot intentions. Uses only each school's projected knowledge + public fixture goals. */
import { chunkId, tileCoordinates, tileIndex } from "../world/coordinates.ts";
export type BotRole = "explorer" | "connector" | "steward";
export type BotIntent = "expand" | "rendezvous" | "revisit";
export interface BotRegion {
  readonly x: number;
  readonly z: number;
  readonly size: number;
}
export interface BotSchool {
  readonly slot: number;
  readonly fixtureId: string;
  readonly label: string;
  readonly color: string;
  readonly region: BotRegion;
  readonly home: number;
  readonly meeting: number;
  readonly protectedHeadquarters?: readonly HeadquartersArea[];
}
const labels = [
  "HCMUT",
  "OU",
  "DTU",
  "HPUNI",
  "HSU",
  "HUCE",
  "NTU",
  "HCMIU",
] as const;
const colors = [
  "#35bfa0",
  "#f3a64a",
  "#78a7ff",
  "#e976b6",
  "#b0cd58",
  "#aa91f4",
  "#57c1da",
  "#ee7b66",
] as const;
/** Public synthetic starts, NOT approved university IDs/slots/HQ coordinates. */
export function botSchools(
  layout: "contact" | "spread" | "gather",
  size = 128,
): readonly BotSchool[] {
  if (layout !== "contact" && layout !== "spread" && layout !== "gather")
    throw new RangeError("Unknown bot layout");
  if (![64, 128, 256].includes(size))
    throw new RangeError("Invalid bot region size");
  return labels.map((label, slot) => {
    const pair = Math.floor(slot / 2);
    const col = pair % 2;
    const row = Math.floor(pair / 2);
    const region: BotRegion = {
      x:
        layout === "gather"
          ? 512 - size / 2
          : layout === "contact"
            ? 512 - size + col * size
            : col
              ? 936 - size
              : 64,
      z:
        layout === "gather"
          ? 512 - size / 2
          : layout === "contact"
            ? 512 - size + row * size
            : row
              ? 936 - size
              : 64,
      size,
    };
    const x = region.x + size / 2;
    const z = region.z + size / 2;
    const offsets = [
      [8, 0],
      [-8, 0],
      [0, 8],
      [0, -8],
      [4, 4],
      [-4, 4],
      [4, -4],
      [-4, -4],
    ];
    const offset =
      layout === "gather" ? offsets[slot]! : [slot % 2 ? -8 : 8, 0];
    return {
      slot,
      fixtureId: `fixture-school-${slot}`,
      label,
      color: colors[slot]!,
      region,
      home: tileIndex(x + offset[0]!, z + offset[1]!),
      meeting: tileIndex(x, z),
    };
  });
}
export function regionContains(region: BotRegion, tile: number): boolean {
  const { x, z } = tileCoordinates(tile);
  return (
    x >= region.x &&
    x < region.x + region.size &&
    z >= region.z &&
    z < region.z + region.size
  );
}
export function regionChunks(region: BotRegion): number[] {
  if (!Number.isInteger(region.size) || region.size < 1 || region.size > 1000)
    throw new RangeError("Invalid bot region size");
  tileIndex(region.x, region.z);
  tileIndex(region.x + region.size - 1, region.z + region.size - 1);
  const chunks: number[] = [];
  for (
    let z = Math.floor(region.z / 64);
    z <= Math.floor((region.z + region.size - 1) / 64);
    z++
  )
    for (
      let x = Math.floor(region.x / 64);
      x <= Math.floor((region.x + region.size - 1) / 64);
      x++
    )
      chunks.push(chunkId(x, z));
  return chunks;
}
export function seededRandom(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError("Invalid bot seed");
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
/** Never marks a pending action owned. Only caller-supplied authorized snapshots/deltas do that. */
export class BotPlanner {
  readonly #school: BotSchool;
  readonly #rng: () => number;
  readonly #owned = new Set<number>();
  readonly #frontier = new Set<number>();
  constructor(school: BotSchool, seed: number) {
    if (
      !Number.isInteger(school.slot) ||
      school.slot < 0 ||
      school.slot > 15 ||
      !regionContains(school.region, school.home) ||
      !regionContains(school.region, school.meeting)
    )
      throw new RangeError("Invalid bot school fixture");
    regionChunks(school.region);
    this.#school = school;
    this.#rng = seededRandom(seed);
    this.#frontier.add(school.home);
  }
  get knownTiles(): number {
    return this.#owned.size;
  }
  random(): number {
    return this.#rng();
  }
  learn(tile: number): void {
    if (!regionContains(this.#school.region, tile) || this.#owned.has(tile))
      return;
    this.#owned.add(tile);
    this.#frontier.delete(tile);
    const { x, z } = tileCoordinates(tile);
    for (const [nx, nz] of [
      [x - 1, z],
      [x + 1, z],
      [x, z - 1],
      [x, z + 1],
    ]) {
      if (nx! < 0 || nz! < 0 || nx! >= 1000 || nz! >= 1000) continue;
      const neighbor = tileIndex(nx!, nz!);
      if (
        regionContains(this.#school.region, neighbor) &&
        !this.#owned.has(neighbor) &&
        (headquartersOwner(
          neighbor,
          this.#school.protectedHeadquarters ?? [],
        ) === undefined ||
          headquartersOwner(
            neighbor,
            this.#school.protectedHeadquarters ?? [],
          ) === this.#school.slot)
      )
        this.#frontier.add(neighbor);
    }
  }
  next(
    role: BotRole,
  ): { readonly tile: number; readonly intent: BotIntent } | null {
    if (!["explorer", "connector", "steward"].includes(role))
      throw new RangeError("Unknown bot role");
    const draw = this.#rng();
    const review = role === "steward" ? 0.18 : 0.04;
    if (this.#owned.size && draw < review) {
      const owned = [...this.#owned];
      return {
        tile: owned[Math.floor(this.#rng() * owned.length)]!,
        intent: "revisit",
      };
    }
    if (!this.#frontier.size) return null;
    const frontier = [...this.#frontier];
    if (role === "connector" || draw < (role === "explorer" ? 0.25 : 0.5)) {
      const meeting = tileCoordinates(this.#school.meeting);
      let best = Infinity;
      const candidates: number[] = [];
      for (const tile of frontier) {
        const c = tileCoordinates(tile);
        const distance = Math.abs(c.x - meeting.x) + Math.abs(c.z - meeting.z);
        if (distance < best) {
          best = distance;
          candidates.length = 0;
        }
        if (distance === best) candidates.push(tile);
      }
      return {
        tile: candidates[Math.floor(this.#rng() * candidates.length)]!,
        intent: "rendezvous",
      };
    }
    return {
      tile: frontier[Math.floor(this.#rng() * frontier.length)]!,
      intent: "expand",
    };
  }
}
