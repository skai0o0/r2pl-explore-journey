import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  GAME_CONFIG,
  SCHOOLS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import type { ProjectionReplica } from "../../shared/protocol/replica.ts";
import {
  chunkCoordinatesForId,
  chunkId,
} from "../../shared/world/coordinates.ts";
import {
  createBirchTreeGeometry,
  createFlowerGeometry,
  createGrassTuftGeometry,
  createOakTreeGeometry,
} from "./natureProps.ts";
import { TerrainBiomes } from "./terrainBiomes.ts";
import { type NatureInstance, naturePlanRows } from "./terrainNature.ts";

const WORLD = 1000,
  HALF = 500;
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
function tint(
  geometry: THREE.BufferGeometry,
  hex: number,
): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
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
  cloth.computeVertexNormals();
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

/** V1 voxel scenery generated only for authorized chunk discoveries, with bounded incremental work. */
export class LandscapeEffects {
  readonly group = new THREE.Group();
  #objects: readonly WorldObject[];
  readonly #field: TerrainBiomes;
  readonly #hqRects = new Map<number, Rect>();
  readonly #chunks = new Map<
    number,
    { group: THREE.Group; owned: Int32Array; bounds: THREE.Box3 }
  >();
  readonly #sources = new Map<number, ProjectionReplica>();
  readonly #pending = new Map<number, ProjectionReplica>();
  readonly #geo = {
    oak: createOakTreeGeometry(),
    birch: createBirchTreeGeometry(),
    grass: createGrassTuftGeometry(),
    red: createFlowerGeometry(0xef4444),
    yellow: createFlowerGeometry(0xfacc15),
    blue: createFlowerGeometry(0x3b82f6),
    flag: flagGeometry(),
  };
  readonly #material = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly #timeUniform = { value: 0 };
  readonly #flagMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  readonly #emblemTextures = new Map<number, THREE.CanvasTexture>();
  readonly #frustum = new THREE.Frustum();
  readonly #matrix = new THREE.Matrix4();
  #slot = 0;
  #frame: number | undefined;
  #disposed = false;
  #span = 275;
  #active:
    | {
        id: number;
        replica: ProjectionReplica;
        builder: Generator<void, NatureInstance[]>;
      }
    | undefined;
  readonly #onChange: (() => void) | undefined;
  constructor(
    objects: readonly WorldObject[] = [],
    onChange?: () => void,
    field = new TerrainBiomes(objects),
  ) {
    this.#objects = objects;
    this.#field = field;
    this.#onChange = onChange;
    this.group.name = "VoxelNatureChunks";
    this.#material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.#timeUniform;
      shader.vertexShader =
        "uniform float uTime;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float sway = max(0.0, position.z - 0.2);
          float wind = sin(uTime * 2.4 + (modelMatrix * vec4(position, 1.0)).x * 0.4 + (modelMatrix * vec4(position, 1.0)).y * 0.4);
          transformed.x += wind * sway * 0.07;
          `,
        );
    };
    this.#setHeadquarters();
  }
  updateTime(time: number): void {
    this.#timeUniform.value = time;
  }
  #setHeadquarters(): void {
    this.#hqRects.clear();
    for (const o of this.#objects)
      if (o.kind === "hq" && o.schoolSlot !== undefined)
        this.#hqRects.set(o.schoolSlot, rectOf(o));
  }
  setObjects(objects: readonly WorldObject[]): void {
    this.#objects = objects;
    this.#setHeadquarters();
    const sources = [...this.#sources];
    this.clear();
    for (const [id, replica] of sources) this.rebuild(id, replica);
  }
  setSchool(slot: number): void {
    this.#slot = slot;
    this.clear();
  }
  clear(): void {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    this.#active = undefined;
    this.#pending.clear();
    this.#sources.clear();
    for (const { group } of this.#chunks.values()) this.#dispose(group);
    this.#chunks.clear();
    this.#syncEmblemFor();
  }
  rebuildSoon(id: number, replica: ProjectionReplica): void {
    this.#queueRebuild(id, replica);
  }
  rebuild(id: number, replica: ProjectionReplica): void {
    // A replacement snapshot may revoke discovery. Remove stale trees immediately,
    // including tall crowns that could otherwise protrude above the opaque mist.
    const previous = this.#chunks.get(id);
    if (previous) this.#dispose(previous.group);
    this.#chunks.delete(id);
    if (this.#active?.id === id) this.#active = undefined;
    this.#queueRebuild(id, replica);
  }
  #queueRebuild(id: number, replica: ProjectionReplica): void {
    if (this.#disposed) return;
    this.#sources.set(id, replica);
    this.#pending.set(id, replica);
    if (this.#sources.size > GAME_CONFIG.terrain.propCacheChunks) {
      const first = this.#sources.keys().next().value!;
      this.#sources.delete(first);
      this.#pending.delete(first);
      const old = this.#chunks.get(first);
      if (old) this.#dispose(old.group);
      this.#chunks.delete(first);
    }
    if (this.#frame === undefined)
      this.#frame = requestAnimationFrame(this.#pump);
  }
  #pump = (): void => {
    this.#frame = undefined;
    if (this.#disposed) return;
    if (!this.#active) {
      const first = this.#pending.entries().next().value;
      if (!first) return;
      const [id, replica] = first;
      this.#pending.delete(id);
      const { chunkX, chunkZ } = chunkCoordinatesForId(id);
      this.#active = {
        id,
        replica,
        builder: naturePlanRows(
          this.#field,
          id,
          (x, z) =>
            replica.hasChunk(id) &&
            replica.isDiscovered(id, (z - chunkZ * 64) * 64 + x - chunkX * 64),
        ),
      };
    }
    const result = this.#active.builder.next();
    if (result.done) {
      if (this.#sources.has(this.#active.id))
        this.#finish(this.#active.id, this.#active.replica, result.value);
      this.#active = undefined;
      this.#onChange?.();
    }
    if (this.#pending.size || this.#active)
      this.#frame = requestAnimationFrame(this.#pump);
  };
  #finish(
    id: number,
    replica: ProjectionReplica,
    instances: readonly NatureInstance[],
  ): void {
    const previous = this.#chunks.get(id);
    if (previous) this.#dispose(previous.group);
    const { chunkX, chunkZ } = chunkCoordinatesForId(id),
      baseX = chunkX * 64,
      baseZ = chunkZ * 64;
    const group = new THREE.Group(),
      dummy = new THREE.Object3D();
    for (const kind of [
      "oak",
      "birch",
      "grass",
      "red",
      "yellow",
      "blue",
    ] as const) {
      const entries = instances.filter((p) => p.kind === kind);
      if (!entries.length) continue;
      const mesh = new THREE.InstancedMesh(
        this.#geo[kind],
        this.#material,
        entries.length,
      );
      mesh.name =
        kind === "grass"
          ? "TallGrass"
          : kind === "oak"
            ? "OakTrees"
            : kind === "birch"
              ? "BirchTrees"
              : "Wildflowers";
      mesh.userData.detail = kind !== "oak" && kind !== "birch";
      mesh.visible =
        !mesh.userData.detail || this.#span <= GAME_CONFIG.terrain.detailSpan;
      entries.forEach((p, i) => {
        dummy.position.set(p.x - HALF, HALF - p.z, p.height);
        dummy.rotation.set(0, 0, p.rotation);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    const ownedTiles: number[] = [],
      flags: THREE.Matrix4[] = [];
    const owned = (x: number, z: number): boolean => {
      if (x < 0 || z < 0 || x >= WORLD || z >= WORLD) return false;
      const cid = chunkId(Math.floor(x / 64), Math.floor(z / 64));
      return (
        replica.hasChunk(cid) &&
        !!(replica.maskAt(cid, (z % 64) * 64 + (x % 64)) & (1 << this.#slot))
      );
    };
    for (let z = baseZ; z < Math.min(WORLD, baseZ + 64); z++)
      for (let x = baseX; x < Math.min(WORLD, baseX + 64); x++) {
        if (!owned(x, z)) continue;
        ownedTiles.push(z * WORLD + x);
        if ((x + z) % 8 || this.#field.isFoundation(x + 0.5, z + 0.5)) continue;
        if (
          owned(x + 1, z) &&
          owned(x - 1, z) &&
          owned(x, z + 1) &&
          owned(x, z - 1)
        )
          continue;
        dummy.position.set(
          x + 0.5 - HALF,
          HALF - z - 0.5,
          this.#field.getTerrainHeight(x, z) + 0.06,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.65);
        dummy.updateMatrix();
        flags.push(dummy.matrix.clone());
      }
    if (flags.length) {
      const mesh = new THREE.InstancedMesh(
          this.#geo.flag,
          this.#flagMaterial,
          flags.length,
        ),
        color = new THREE.Color(SCHOOLS[this.#slot]!.color);
      flags.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color);
      });
      mesh.name = "BorderFlags";
      mesh.userData.detail = true;
      mesh.visible = this.#span <= GAME_CONFIG.terrain.detailSpan;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    this.group.add(group);
    this.#chunks.set(id, {
      group,
      owned: Int32Array.from(ownedTiles),
      bounds: new THREE.Box3(
        new THREE.Vector3(
          baseX - HALF - 2,
          HALF - Math.min(WORLD, baseZ + 64) - 2,
          -0.4,
        ),
        new THREE.Vector3(
          Math.min(WORLD, baseX + 64) - HALF + 2,
          HALF - baseZ + 2,
          9,
        ),
      ),
    });
  }
  updateView(camera: THREE.Camera, span: number): void {
    this.#span = span;
    this.#matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.#frustum.setFromProjectionMatrix(this.#matrix);
    for (const { group, bounds } of this.#chunks.values()) {
      group.visible = this.#frustum.intersectsBox(bounds);
      for (const child of group.children)
        if (child.userData.detail)
          child.visible = span <= GAME_CONFIG.terrain.detailSpan;
    }
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
    this.#disposed = true;
    this.clear();
    if (this.#emblemGroup) {
      this.#dispose(this.#emblemGroup);
      this.#emblemGroup = undefined;
    }
    for (const g of Object.values(this.#geo)) g.dispose();
    this.#material.dispose();
    this.#flagMaterial.dispose();
    for (const t of this.#emblemTextures.values()) t.dispose();
  }
  #dispose(group: THREE.Object3D): void {
    group.removeFromParent();
    group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
