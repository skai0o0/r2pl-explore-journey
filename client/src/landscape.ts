import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  GAME_CONFIG,
  SCHOOLS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import type { ProjectionReplica } from "../../shared/protocol/replica.ts";
import { CHUNK_SIZE } from "../../shared/world/constants.ts";
import {
  chunkCoordinatesForId,
  chunkId,
} from "../../shared/world/coordinates.ts";

/**
 * Ported V1 scenery (borderFlagManager / megaEmblemManager / natureGridManager)
 * for the V2 flat tile renderer. Everything is derived from the viewer's own
 * projected replica: rival masks are never needed or exposed.
 */
const WORLD = 1000;
const MAX_EMBLEMS_PER_CHUNK = 12;
const HALF = WORLD / 2;

interface Rect {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}
function rectOf(o: WorldObject, margin = 0): Rect {
  return {
    minX: o.x - o.width / 2 - margin,
    minZ: o.z - o.height / 2 - margin,
    maxX: o.x + o.width / 2 + margin,
    maxZ: o.z + o.height / 2 + margin,
  };
}
function inside(r: Rect, x: number, z: number): boolean {
  return x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ;
}
function hash(x: number, z: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}
function moisture(x: number, z: number): number {
  return (
    0.5 +
    0.25 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017) +
    0.25 * Math.sin((x + z) * 0.011)
  );
}
function tint(
  geometry: THREE.BufferGeometry,
  hex: number,
): THREE.BufferGeometry {
  const g = geometry.toNonIndexed();
  g.deleteAttribute("uv");
  const c = new THREE.Color(hex);
  const colors = new Float32Array(g.attributes.position!.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}
/** three.js primitives are Y-up; the map camera is Z-up. */
function zUp(g: THREE.BufferGeometry, lift = 0): THREE.BufferGeometry {
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, lift);
  return g;
}
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts) ?? parts[0]!;
}

function oakGeometry(): THREE.BufferGeometry {
  return merge([
    tint(zUp(new THREE.CylinderGeometry(0.22, 0.3, 1.4, 6), 0.7), 0x6b4a2b),
    tint(zUp(new THREE.IcosahedronGeometry(1.25, 0), 2.1), 0x2f8f4a),
  ]);
}
function birchGeometry(): THREE.BufferGeometry {
  return merge([
    tint(zUp(new THREE.CylinderGeometry(0.14, 0.2, 1.8, 6), 0.9), 0xe2e0d4),
    tint(zUp(new THREE.ConeGeometry(0.95, 2.4, 6), 2.9), 0x8fd36a),
  ]);
}
function grassGeometry(): THREE.BufferGeometry {
  return merge([
    tint(zUp(new THREE.ConeGeometry(0.28, 0.9, 4), 0.45), 0x62b85a),
    tint(
      zUp(new THREE.ConeGeometry(0.22, 0.7, 4).translate(0.3, 0, 0), 0.35),
      0x4ea04b,
    ),
  ]);
}
function flowerGeometry(): THREE.BufferGeometry {
  return merge([
    tint(zUp(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 4), 0.4), 0x3c8f48),
    tint(zUp(new THREE.SphereGeometry(0.26, 6, 4), 0.9), 0xff8fc7),
  ]);
}
function flagGeometry(): THREE.BufferGeometry {
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        0, 0, 3.0, 0, 0, 1.6, 1.7, 0, 2.5, 0, 0, 1.6, 1.3, 0, 2.0, 1.7, 0, 2.5,
      ]),
      3,
    ),
  );
  const colors = new Float32Array(18).fill(1);
  cloth.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return merge([
    tint(zUp(new THREE.CylinderGeometry(0.1, 0.1, 3.1, 6), 1.55), 0x1f2733),
    tint(zUp(new THREE.ConeGeometry(0.18, 0.4, 6), 3.3), 0x00ffe8),
    cloth,
  ]);
}

function emblemTexture(slot: number): THREE.CanvasTexture {
  const school = SCHOOLS[slot]!;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  // Predator frame: glowing chevron corners around a school crest.
  ctx.shadowColor = school.accent;
  ctx.shadowBlur = 24;
  ctx.lineWidth = 14;
  ctx.strokeStyle = school.accent;
  const k = 40;
  const arm = 120;
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const ox = sx > 0 ? k : 512 - k;
    const oy = sy > 0 ? k : 512 - k;
    ctx.beginPath();
    ctx.moveTo(ox, oy + sy * arm);
    ctx.lineTo(ox, oy);
    ctx.lineTo(ox + sx * arm, oy);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(256, 256, 170, 0, Math.PI * 2);
  ctx.fillStyle = school.color;
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.arc(256, 256, 140, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${school.shortName.length > 4 ? 72 : 96}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(school.shortName, 256, 262);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export interface OwnedFrontier {
  /** Chebyshev distance from the nearest owned tile to a rectangle, and that tile. */
  readonly distance: number;
  readonly tile: { x: number; z: number };
}

export class LandscapeEffects {
  readonly group = new THREE.Group();
  readonly #objects: readonly WorldObject[];
  readonly #exclusions: Rect[];
  readonly #hqRects = new Map<number, Rect>();
  readonly #chunks = new Map<
    number,
    { group: THREE.Group; owned: Int32Array }
  >();
  readonly #geo = {
    oak: oakGeometry(),
    birch: birchGeometry(),
    grass: grassGeometry(),
    flower: flowerGeometry(),
    flag: flagGeometry(),
  };
  readonly #material = new THREE.MeshBasicMaterial({ vertexColors: true });
  readonly #flagMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  readonly #emblemTextures = new Map<number, THREE.CanvasTexture>();
  #slot = 0;
  #pendingTimers = new Map<number, number>();
  #onChange: (() => void) | undefined;

  constructor(objects: readonly WorldObject[] = [], onChange?: () => void) {
    this.#objects = objects;
    this.#onChange = onChange;
    this.group.name = "LandscapeEffects";
    this.#exclusions = objects.map((o) =>
      rectOf(o, o.kind === "hq" || o.kind === "landmark" ? 2 : 1),
    );
    for (const o of objects)
      if (o.kind === "hq" && o.schoolSlot !== undefined)
        this.#hqRects.set(o.schoolSlot, rectOf(o));
  }

  setSchool(slot: number): void {
    this.#slot = slot;
    this.clear();
  }

  clear(): void {
    for (const t of this.#pendingTimers.values()) window.clearTimeout(t);
    this.#pendingTimers.clear();
    for (const { group } of this.#chunks.values()) this.#dispose(group);
    this.#chunks.clear();
    this.#syncEmblemFor();
  }

  /** Debounced per-tile updates; full paints rebuild immediately. */
  rebuildSoon(id: number, replica: ProjectionReplica): void {
    if (this.#pendingTimers.has(id)) return;
    this.#pendingTimers.set(
      id,
      window.setTimeout(() => {
        this.#pendingTimers.delete(id);
        this.rebuild(id, replica);
        this.#onChange?.();
      }, 80),
    );
  }

  rebuild(id: number, replica: ProjectionReplica): void {
    const previous = this.#chunks.get(id);
    if (previous) this.#dispose(previous.group);
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    const baseX = chunkX * CHUNK_SIZE;
    const baseZ = chunkZ * CHUNK_SIZE;
    const bit = 1 << this.#slot;
    const owned = (x: number, z: number): boolean | undefined => {
      if (x < 0 || z < 0 || x >= WORLD || z >= WORLD) return false;
      const cid = chunkId(
        Math.floor(x / CHUNK_SIZE),
        Math.floor(z / CHUNK_SIZE),
      );
      if (!replica.hasChunk(cid)) return undefined;
      const local = (z % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE);
      return (
        replica.isDiscovered(cid, local) && !!(replica.maskAt(cid, local) & bit)
      );
    };
    const size = (v: number): number => Math.min(CHUNK_SIZE, WORLD - v);
    const w = size(baseX);
    const h = size(baseZ);
    const grid = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const ownedTiles: number[] = [];
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++)
        if (owned(baseX + x, baseZ + z)) {
          grid[z * CHUNK_SIZE + x] = 1;
          ownedTiles.push((baseZ + z) * WORLD + baseX + x);
        }

    const trees: THREE.Matrix4[] = [];
    const birches: THREE.Matrix4[] = [];
    const grasses: THREE.Matrix4[] = [];
    const flowers: THREE.Matrix4[] = [];
    const flags: { m: THREE.Matrix4; color: THREE.Color }[] = [];
    const dummy = new THREE.Object3D();
    const schoolColor = new THREE.Color(SCHOOLS[this.#slot]!.color);
    const hq = this.#hqRects.get(this.#slot);
    const excluded = (x: number, z: number): boolean =>
      this.#exclusions.some((r) => inside(r, x, z));

    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        if (!grid[z * CHUNK_SIZE + x]) continue;
        const wx = baseX + x;
        const wz = baseZ + z;
        const inHq = hq ? inside(hq, wx, wz) : false;
        // Border flags on exposed edges (every other tile keeps the line airy).
        if (!inHq) {
          const edges: [number, number, number][] = [
            [0, -1, Math.PI],
            [0, 1, 0],
            [-1, 0, -Math.PI / 2],
            [1, 0, Math.PI / 2],
          ];
          for (const [dx, dz, rot] of edges) {
            const n = owned(wx + dx, wz + dz);
            if (n !== false) continue;
            if ((wx + wz) % 2) continue;
            if (excluded(wx, wz)) continue;
            dummy.position.set(
              wx + 0.5 + dx * 0.5 - HALF,
              HALF - (wz + 0.5 + dz * 0.5),
              0.1,
            );
            dummy.rotation.set(0, 0, rot);
            dummy.scale.setScalar(0.85);
            dummy.updateMatrix();
            flags.push({ m: dummy.matrix.clone(), color: schoolColor });
          }
        }
        // Nature props on owned tiles, sparse and deterministic.
        if (inHq || excluded(wx, wz)) continue;
        if (wx % 3 !== 0 || wz % 3 !== 0) continue;
        const jx = wx + Math.floor(hash(wx, wz, 1.1) * 3) - 1;
        const jz = wz + Math.floor(hash(wx, wz, 2.2) * 3) - 1;
        if (excluded(jx, jz) || owned(jx, jz) !== true) continue;
        const roll = hash(jx, jz, 3.3);
        const m = moisture(jx, jz);
        const sc = 0.85 + hash(jx, jz, 5.5) * 0.45;
        dummy.position.set(jx + 0.5 - HALF, HALF - (jz + 0.5), 0.08);
        dummy.rotation.set(0, 0, hash(jx, jz, 4.4) * Math.PI * 2);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        if (m > 0.62) {
          if (roll < 0.28) birches.push(dummy.matrix.clone());
          else if (roll < 0.5) flowers.push(dummy.matrix.clone());
          else if (roll < 0.7) grasses.push(dummy.matrix.clone());
        } else if (m > 0.35) {
          if (roll < 0.3) trees.push(dummy.matrix.clone());
          else if (roll < 0.4) birches.push(dummy.matrix.clone());
          else if (roll < 0.5) flowers.push(dummy.matrix.clone());
          else if (roll < 0.72) grasses.push(dummy.matrix.clone());
        } else if (roll < 0.15) trees.push(dummy.matrix.clone());
        else if (roll < 0.45) grasses.push(dummy.matrix.clone());
      }

    const group = new THREE.Group();
    const instanced = (
      geometry: THREE.BufferGeometry,
      matrices: THREE.Matrix4[],
      material: THREE.Material,
    ): void => {
      if (!matrices.length) return;
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    };
    instanced(this.#geo.oak, trees, this.#material);
    instanced(this.#geo.birch, birches, this.#material);
    instanced(this.#geo.grass, grasses, this.#material);
    instanced(this.#geo.flower, flowers, this.#material);
    if (flags.length) {
      const mesh = new THREE.InstancedMesh(
        this.#geo.flag,
        this.#flagMaterial,
        flags.length,
      );
      flags.forEach((f, i) => {
        mesh.setMatrixAt(i, f.m);
        mesh.setColorAt(i, f.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    }
    // Mega emblems: every fully owned aligned 8×8 block outside the HQ.
    let emblems = 0;
    for (let bz = 0; bz + 8 <= h && emblems < MAX_EMBLEMS_PER_CHUNK; bz += 8)
      for (
        let bx = 0;
        bx + 8 <= w && emblems < MAX_EMBLEMS_PER_CHUNK;
        bx += 8
      ) {
        let full = true;
        for (let z = bz; z < bz + 8 && full; z++)
          for (let x = bx; x < bx + 8; x++)
            if (!grid[z * CHUNK_SIZE + x]) {
              full = false;
              break;
            }
        if (!full) continue;
        const cx = baseX + bx;
        const cz = baseZ + bz;
        if (hq && inside(hq, cx + 4, cz + 4)) continue;
        group.add(this.#emblemMesh(cx + 4, cz + 4, 8));
        emblems++;
      }
    this.group.add(group);
    this.#chunks.set(id, { group, owned: Int32Array.from(ownedTiles) });
    this.#syncEmblemFor();
  }

  #emblemGroup: THREE.Group | undefined;
  #syncEmblemFor(): void {
    if (this.#emblemGroup) {
      this.group.remove(this.#emblemGroup);
      this.#dispose(this.#emblemGroup);
      this.#emblemGroup = undefined;
    }
    const hq = this.#hqRects.get(this.#slot);
    if (!hq) return;
    this.#emblemGroup = new THREE.Group();
    this.#emblemGroup.add(
      this.#emblemMesh(
        (hq.minX + hq.maxX) / 2,
        (hq.minZ + hq.maxZ) / 2,
        hq.maxX - hq.minX,
        0.68,
      ),
    );
    this.group.add(this.#emblemGroup);
  }

  #emblemMesh(cx: number, cz: number, size: number, opacity = 0.7): THREE.Mesh {
    let texture = this.#emblemTextures.get(this.#slot);
    if (!texture) {
      texture = emblemTexture(this.#slot);
      this.#emblemTextures.set(this.#slot, texture);
    }
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    mesh.position.set(cx - HALF, HALF - cz, 0.12);
    return mesh;
  }

  /** Nearest owned tile (or HQ fallback) to a target rectangle, for the compass. */
  nearestOwned(target: WorldObject): OwnedFrontier {
    const r = rectOf(target);
    let best: OwnedFrontier | undefined;
    const consider = (x: number, z: number): void => {
      const dx = Math.max(r.minX - x, 0, x - (r.maxX - 1));
      const dz = Math.max(r.minZ - z, 0, z - (r.maxZ - 1));
      const distance = Math.max(dx, dz);
      if (!best || distance < best.distance)
        best = { distance, tile: { x, z } };
    };
    const hq = this.#hqRects.get(this.#slot);
    if (hq)
      for (let z = hq.minZ; z < hq.maxZ; z += 1)
        for (let x = hq.minX; x < hq.maxX; x += 1)
          if (
            x === hq.minX ||
            z === hq.minZ ||
            x === hq.maxX - 1 ||
            z === hq.maxZ - 1
          )
            consider(x, z);
    for (const { owned } of this.#chunks.values())
      for (const tile of owned)
        consider(tile % WORLD, Math.floor(tile / WORLD));
    return best ?? { distance: 0, tile: { x: target.x, z: target.z } };
  }

  get knowledgeConfig(): typeof GAME_CONFIG.world {
    return GAME_CONFIG.world;
  }
  get objects(): readonly WorldObject[] {
    return this.#objects;
  }

  dispose(): void {
    this.clear();
    for (const g of Object.values(this.#geo)) g.dispose();
    this.#material.dispose();
    this.#flagMaterial.dispose();
    for (const t of this.#emblemTextures.values()) t.dispose();
  }

  #dispose(group: THREE.Group): void {
    this.group.remove(group);
    group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
