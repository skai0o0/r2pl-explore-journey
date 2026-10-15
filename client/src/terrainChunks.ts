import * as THREE from "three";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import { chunkCoordinatesForId } from "../../shared/world/coordinates.ts";
import type { TerrainBiomes, TerrainSample } from "./terrainBiomes.ts";

const C = GAME_CONFIG.terrain;
/** Independent voxel faces preserve terraces and sharp, naturally lit cliff normals. */
export function* terrainGeometrySteps(
  field: TerrainBiomes,
  id: number,
  step = 1,
): Generator<void, THREE.BufferGeometry> {
  const { chunkX, chunkZ } = chunkCoordinatesForId(id),
    baseX = chunkX * 64,
    baseZ = chunkZ * 64;
  const width = Math.min(64, 1000 - baseX),
    depth = Math.min(64, 1000 - baseZ);
  const positions: number[] = [],
    colors: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const samples = new Map<string, TerrainSample>();
  const sample = (x: number, z: number): TerrainSample => {
    const key = `${x},${z}`;
    let value = samples.get(key);
    if (!value) {
      value =
        x < 0 || z < 0 || x >= 1000 || z >= 1000
          ? { height: C.waterHeight, biome: "river", color: 0x3f76e4 }
          : field.sample(x + step / 2, z + step / 2);
      if (step > 1 && field.intersectsFoundation(x, z, step))
        value = { height: 0, biome: "foundation", color: 0x689f38 };
      samples.set(key, value);
    }
    return value;
  };
  const color = new THREE.Color();
  const face = (
    vertices: readonly number[],
    hex: number,
    u: number,
    v: number,
  ) => {
    const offset = positions.length / 3;
    positions.push(...vertices);
    color.setHex(hex);
    for (let i = 0; i < 4; i++) {
      colors.push(color.r, color.g, color.b);
      uvs.push(u, v);
    }
    indices.push(
      offset,
      offset + 1,
      offset + 2,
      offset,
      offset + 2,
      offset + 3,
    );
  };
  for (let row = 0; row < depth; row += step) {
    for (let col = 0; col < width; col += step) {
      const x = baseX + col,
        z = baseZ + row,
        s = sample(x, z),
        h = s.height;
      const l = x - 500,
        r = l + Math.min(step, width - col),
        t = 500 - z,
        b = t - Math.min(step, depth - row);
      const u = (col + Math.min(step, width - col) / 2) / 64,
        v = 1 - (row + Math.min(step, depth - row) / 2) / 64;
      face([l, t, h, l, b, h, r, b, h, r, t, h], s.color, u, v);
      const side = h >= 0.85 ? 0x737373 : 0x866043;
      // Full perimeter skirts also seal interfaces between coarse and fine LODs.
      let low =
        col + step >= width ? C.waterHeight : sample(x + step, z).height;
      if (h > low) face([r, t, low, r, t, h, r, b, h, r, b, low], side, u, v);
      low = col === 0 ? C.waterHeight : sample(x - step, z).height;
      if (h > low) face([l, b, low, l, b, h, l, t, h, l, t, low], side, u, v);
      low = row === 0 ? C.waterHeight : sample(x, z - step).height;
      if (h > low) face([r, t, low, l, t, low, l, t, h, r, t, h], side, u, v);
      low = row + step >= depth ? C.waterHeight : sample(x, z + step).height;
      if (h > low) face([l, b, low, r, b, low, r, b, h, l, b, h], side, u, v);
    }
    if ((row + step) % C.buildRowsPerFrame === 0) yield;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (step > 1) {
    geometry.boundingBox!.min.z = Math.min(
      geometry.boundingBox!.min.z,
      C.waterHeight,
    );
    geometry.boundingBox!.max.z = Math.max(
      geometry.boundingBox!.max.z,
      C.hillHeights[2],
    );
  }
  return geometry;
}
export function buildTerrainChunkGeometry(
  field: TerrainBiomes,
  id: number,
  step = 1,
): THREE.BufferGeometry {
  const builder = terrainGeometrySteps(field, id, step);
  let result = builder.next();
  while (!result.done) result = builder.next();
  return result.value;
}

export function terrainMaterial(
  texture: THREE.DataTexture,
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: texture,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #ifdef USE_MAP
        vec4 knowledge = texture2D(map, vMapUv);
        if (knowledge.a < 0.001) diffuseColor.rgb *= 0.24;
        else if (knowledge.a < 0.01) diffuseColor.rgb *= 0.62;
        else diffuseColor.rgb = mix(diffuseColor.rgb, knowledge.rgb, 0.30);
      #endif
    `,
    );
  };
  material.customProgramCacheKey = () => "fixed-biome-knowledge-v1";
  return material;
}

export interface TerrainLayer {
  readonly pixels: Uint8Array;
  readonly texture: THREE.DataTexture;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  coarse: THREE.BufferGeometry;
  detail: THREE.BufferGeometry | undefined;
  wanted: boolean;
}
/** Small overview meshes are fixed; detailed chunks build incrementally and have a hard cache cap. */
export class TerrainChunks {
  readonly group = new THREE.Group();
  readonly layers = new Map<number, TerrainLayer>();
  readonly #field: TerrainBiomes;
  readonly #onChange: () => void;
  readonly #frustum = new THREE.Frustum();
  readonly #matrix = new THREE.Matrix4();
  readonly #point = new THREE.Vector3();
  #queue: number[] = [];
  #builder: Generator<void, THREE.BufferGeometry> | undefined;
  #building: number | undefined;
  #frame: number | undefined;
  #disposed = false;
  constructor(field: TerrainBiomes, onChange: () => void) {
    this.#field = field;
    this.#onChange = onChange;
    this.group.name = "FixedBiomeTerrain";
    for (let id = 0; id < 256; id++) {
      const pixels = new Uint8Array(64 * 64 * 4),
        texture = new THREE.DataTexture(pixels, 64, 64);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      const coarse = buildTerrainChunkGeometry(field, id, C.coarseStep);
      const mesh = new THREE.Mesh(coarse, terrainMaterial(texture));
      mesh.name = `terrain-${id}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      this.layers.set(id, {
        pixels,
        texture,
        mesh,
        coarse,
        detail: undefined,
        wanted: false,
      });
    }
  }
  updateView(camera: THREE.Camera, span: number): void {
    this.#matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.#frustum.setFromProjectionMatrix(this.#matrix);
    const visible: { id: number; distance: number }[] = [];
    for (const [id, layer] of this.layers) {
      layer.mesh.visible = this.#frustum.intersectsBox(
        layer.coarse.boundingBox!,
      );
      layer.wanted = false;
      if (layer.mesh.visible && span <= C.detailSpan) {
        layer.coarse.boundingBox!.getCenter(this.#point).project(camera);
        visible.push({ id, distance: this.#point.x ** 2 + this.#point.y ** 2 });
      }
    }
    visible.sort((a, b) => a.distance - b.distance);
    for (const { id } of visible.slice(0, C.detailCacheChunks))
      this.layers.get(id)!.wanted = true;
    for (const layer of this.layers.values())
      layer.mesh.geometry =
        layer.wanted && layer.detail ? layer.detail : layer.coarse;
    this.#queue = visible
      .slice(0, C.detailCacheChunks)
      .map((v) => v.id)
      .filter((id) => !this.layers.get(id)!.detail && id !== this.#building);
    if (
      this.#building !== undefined &&
      !this.layers.get(this.#building)!.wanted
    ) {
      this.#builder = undefined;
      this.#building = undefined;
    }
    if ((this.#queue.length || this.#builder) && this.#frame === undefined)
      this.#frame = requestAnimationFrame(this.#pump);
  }
  #pump = (): void => {
    this.#frame = undefined;
    if (this.#disposed) return;
    if (!this.#builder) {
      this.#building = this.#queue.shift();
      if (this.#building === undefined) return;
      this.#builder = terrainGeometrySteps(this.#field, this.#building);
    }
    const result = this.#builder.next();
    if (result.done) {
      const layer = this.layers.get(this.#building!)!;
      const detailed = [...this.layers.values()].filter((l) => l.detail);
      if (detailed.length >= C.detailCacheChunks) {
        const old = detailed.find((l) => !l.wanted);
        if (old) {
          old.mesh.geometry = old.coarse;
          old.detail!.dispose();
          old.detail = undefined;
        }
      }
      layer.detail = result.value;
      layer.mesh.geometry = layer.wanted ? layer.detail : layer.coarse;
      this.#builder = undefined;
      this.#building = undefined;
      this.#onChange();
    }
    if (this.#queue.length || this.#builder)
      this.#frame = requestAnimationFrame(this.#pump);
  };
  resetKnowledge(): void {
    for (const layer of this.layers.values()) {
      layer.pixels.fill(0);
      layer.texture.needsUpdate = true;
    }
  }
  invalidate(): void {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    this.#builder = undefined;
    this.#building = undefined;
    this.#queue = [];
    for (const [id, layer] of this.layers) {
      layer.detail?.dispose();
      layer.coarse.dispose();
      layer.detail = undefined;
      layer.coarse = buildTerrainChunkGeometry(this.#field, id, C.coarseStep);
      layer.mesh.geometry = layer.coarse;
    }
  }
  dispose(): void {
    this.#disposed = true;
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    for (const layer of this.layers.values()) {
      layer.detail?.dispose();
      layer.coarse.dispose();
      layer.mesh.material.dispose();
      layer.texture.dispose();
    }
    this.group.clear();
    this.layers.clear();
    this.#builder = undefined;
    this.#queue = [];
  }
}

/** Analytic voxel-column picking touches only cells crossed by the terrain's thin height slab. */
export function terrainPointFromRay(
  ray: THREE.Ray,
  field: TerrainBiomes,
  target = new THREE.Vector3(),
): THREE.Vector3 | undefined {
  if (ray.direction.z >= -0.01) return undefined;
  const top = (C.hillHeights[2] - ray.origin.z) / ray.direction.z;
  const bottom = (C.waterHeight - ray.origin.z) / ray.direction.z;
  const a = ray.at(Math.max(0, top), new THREE.Vector3()),
    b = ray.at(Math.max(0, bottom), new THREE.Vector3());
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) + 500)),
    maxX = Math.min(999, Math.floor(Math.max(a.x, b.x) + 500));
  const minZ = Math.max(0, Math.floor(500 - Math.max(a.y, b.y))),
    maxZ = Math.min(999, Math.floor(500 - Math.min(a.y, b.y)));
  if ((maxX - minX + 1) * (maxZ - minZ + 1) > 64) return undefined;
  const box = new THREE.Box3(),
    hit = new THREE.Vector3();
  let distance = Infinity;
  for (let z = minZ; z <= maxZ; z++)
    for (let x = minX; x <= maxX; x++) {
      box.min.set(x - 500, 499 - z, C.waterHeight - 0.01);
      box.max.set(x - 499, 500 - z, field.getTerrainHeight(x, z));
      if (ray.intersectBox(box, hit)) {
        const d = hit.distanceToSquared(ray.origin);
        if (d < distance) {
          target.copy(hit);
          // A cliff belongs to its elevated column, not the adjacent low tile.
          target.x = Math.max(
            x - 500 + 1e-7,
            Math.min(x - 499 - 1e-7, target.x),
          );
          target.y = Math.max(
            499 - z + 1e-7,
            Math.min(500 - z - 1e-7, target.y),
          );
          distance = d;
        }
      }
    }
  return distance < Infinity ? target : undefined;
}
