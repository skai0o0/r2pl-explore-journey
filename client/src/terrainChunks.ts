import * as THREE from "three";
import { GAME_CONFIG, SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import type { ProjectionReplica } from "../../shared/protocol/replica.ts";
import {
  chunkCoordinatesForId,
  chunkId,
} from "../../shared/world/coordinates.ts";
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
      // Continuous top UVs preserve single-tile fog/ownership at every LOD.
      // Side samples stay just inside their owning column, including seams.
      uvs.push(
        Math.max(
          u - (0.5 * step) / 64 + 1e-6,
          Math.min(
            u + (0.5 * step) / 64 - 1e-6,
            (vertices[i * 3]! + 500 - baseX) / 64,
          ),
        ),
        Math.max(
          v - (0.5 * step) / 64 + 1e-6,
          Math.min(
            v + (0.5 * step) / 64 - 1e-6,
            (vertices[i * 3 + 1]! - 500 + baseZ + 64) / 64,
          ),
        ),
      );
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
      const side = h >= 0.85 ? 0x7c5c3e : 0x3f621f;
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

/** Blend bytes in sRGB, matching the signed 68/32 palette exactly. */
export function terrainTileColor(
  terrain: number,
  slots: readonly number[],
): number {
  if (!slots.length) return terrain;
  let result = 0;
  for (const shift of [16, 8, 0]) {
    const school =
      slots.reduce(
        (sum, slot) =>
          sum + ((parseInt(SCHOOLS[slot]!.color.slice(1), 16) >> shift) & 255),
        0,
      ) / slots.length;
    result |=
      Math.round(
        ((terrain >> shift) & 255) * (1 - C.schoolTintOpacity) +
          school * C.schoolTintOpacity,
      ) << shift;
  }
  return result;
}

export function terrainMaterial(
  texture: THREE.DataTexture,
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: texture,
    toneMapped: false,
  });
  material.userData.accent = { value: new THREE.Color(SCHOOLS[0].accent) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.territoryAccent = material.userData.accent;
    shader.vertexShader =
      "varying float terrainTop;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n terrainTop = step(0.5, normal.z);",
      );
    shader.fragmentShader =
      "varying float terrainTop;\nuniform vec3 territoryAccent;\n" +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <map_fragment>",
        `
      vec4 knowledge = texture2D(map, vMapUv);
      if (knowledge.a < 0.001) discard;
      float state = floor(knowledge.a * 255.0 + 0.5);
    `,
      )
      .replace(
        "#include <color_fragment>",
        `
      #include <color_fragment>
      if (terrainTop > 0.5) diffuseColor.rgb = knowledge.rgb;
      float edges = max(0.0, state - 128.0);
      vec2 cell = fract(vMapUv * 64.0);
      bool border = (mod(edges, 2.0) >= 1.0 && cell.x < ${C.territoryEdgeWidth})
        || (mod(floor(edges / 2.0), 2.0) >= 1.0 && cell.x > ${1 - C.territoryEdgeWidth})
        || (mod(floor(edges / 4.0), 2.0) >= 1.0 && cell.y > ${1 - C.territoryEdgeWidth})
        || (mod(floor(edges / 8.0), 2.0) >= 1.0 && cell.y < ${C.territoryEdgeWidth});
      if (terrainTop > 0.5 && state >= 128.0 && border) diffuseColor.rgb = territoryAccent;
    `,
      )
      .replace(
        "#include <opaque_fragment>",
        `
      // Exact top palette; directional lighting remains on softened cliff faces.
      if (terrainTop > 0.5) outgoingLight = diffuseColor.rgb;
      #include <opaque_fragment>
    `,
      );
  };
  material.customProgramCacheKey = () => "fixed-biome-knowledge-v2";
  return material;
}

/** Static opaque clouds conceal unknown elevations as well as their colors. */
export function terrainMist(texture: THREE.DataTexture, id: number) {
  const { chunkX, chunkZ } = chunkCoordinatesForId(id);
  const width = Math.min(64, 1000 - chunkX * 64),
    depth = Math.min(64, 1000 - chunkZ * 64);
  const geometry = new THREE.PlaneGeometry(width, depth);
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++)
    uv.setXY(
      i,
      (uv.getX(i) * width) / 64,
      1 - depth / 64 + (uv.getY(i) * depth) / 64,
    );
  const material = new THREE.ShaderMaterial({
    uniforms: {
      knowledge: { value: texture },
      mistA: { value: new THREE.Color(C.mistColors[0]) },
      mistB: { value: new THREE.Color(C.mistColors[1]) },
    },
    vertexShader:
      "varying vec2 tileUv; varying vec2 worldXY; void main() { tileUv = uv; worldXY = (modelMatrix * vec4(position, 1.0)).xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform sampler2D knowledge; uniform vec3 mistA; uniform vec3 mistB; varying vec2 tileUv; varying vec2 worldXY;
      void main() {
        if (texture2D(knowledge, tileUv).a > 0.001) discard;
        float clouds = clamp(0.5 + 0.24 * sin(worldXY.x * 0.11 + sin(worldXY.y * 0.09)) + 0.26 * cos(worldXY.y * 0.13 + sin(worldXY.x * 0.07)), 0.0, 1.0);
        gl_FragColor = vec4(mix(mistA, mistB, clouds), 1.0);
        #include <colorspace_fragment>
      }
    `,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `mist-${id}`;
  mesh.position.set(
    chunkX * 64 + width / 2 - 500,
    500 - chunkZ * 64 - depth / 2,
    C.hillHeights[2] + 0.01,
  );
  return mesh;
}

export interface TerrainLayer {
  readonly mist: ReturnType<typeof terrainMist>;
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
      const mist = terrainMist(texture, id);
      this.group.add(mesh, mist);
      this.layers.set(id, {
        mist,
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
      layer.mist.visible = layer.mesh.visible;
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
      layer.mist.geometry.dispose();
      layer.mist.material.dispose();
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

/** Paint one authoritative projected tile; never requests rival masks. */
export function writeTerrainTile(
  pixels: Uint8Array,
  id: number,
  local: number,
  replica: ProjectionReplica,
  field: TerrainBiomes,
  schoolSlot: number,
  shared: ReadonlyMap<number, readonly number[]>,
): void {
  const { chunkX, chunkZ } = chunkCoordinatesForId(id);
  const x = chunkX * 64 + (local % 64);
  const z = chunkZ * 64 + Math.floor(local / 64);
  const offset = (63 - Math.floor(local / 64)) * 64 * 4 + (local % 64) * 4;
  if (x >= 1000 || z >= 1000) {
    pixels[offset + 3] = 0;
    return;
  }

  if (!replica.isDiscovered(id, local)) {
    pixels[offset + 3] = 0;
    return;
  }
  const pair = shared.get(z * 1000 + x);
  const mask = replica.maskAt(id, local);
  const slots =
    pair?.length === 2
      ? pair
      : SCHOOLS.flatMap((_, slot) => (mask & (1 << slot) ? [slot] : []));
  const hex = terrainTileColor(field.sample(x, z).color, slots);
  pixels[offset] = (hex >> 16) & 255;
  pixels[offset + 1] = (hex >> 8) & 255;
  pixels[offset + 2] = hex & 255;
  let edges = 0;
  if (mask & (1 << schoolSlot)) {
    for (const [dx, dz, flag] of [
      [-1, 0, 1],
      [1, 0, 2],
      [0, -1, 4],
      [0, 1, 8],
    ]) {
      if (!ownsTerrainTile(x + dx!, z + dz!, replica, schoolSlot))
        edges |= flag!;
    }
  }
  pixels[offset + 3] = slots.length ? 128 + edges : 1;
}

function ownsTerrainTile(
  x: number,
  z: number,
  replica: ProjectionReplica,
  schoolSlot: number,
): boolean {
  if (x < 0 || z < 0 || x >= 1000 || z >= 1000) return false;
  const id = chunkId(Math.floor(x / 64), Math.floor(z / 64));
  return (
    replica.hasChunk(id) &&
    !!(replica.maskAt(id, (z % 64) * 64 + (x % 64)) & (1 << schoolSlot))
  );
}
