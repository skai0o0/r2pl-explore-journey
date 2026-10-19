import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { LandscapeEffects } from "../client/src/landscape.ts";
import {
  createBirchTreeGeometry,
  createFlowerGeometry,
  createGrassTuftGeometry,
  createOakTreeGeometry,
} from "../client/src/natureProps.ts";
import {
  createNoise2D,
  getTerrainHeight,
  TerrainBiomes,
} from "../client/src/terrainBiomes.ts";
import {
  buildTerrainChunkGeometry,
  TerrainChunks,
  terrainMaterial,
  terrainPointFromRay,
  terrainTileColor,
  writeTerrainTile,
} from "../client/src/terrainChunks.ts";
import { naturePlanRows } from "../client/src/terrainNature.ts";
import {
  configureMapCamera,
  TileIndicatorLayer,
} from "../client/src/worldView.ts";
import {
  GAME_CONFIG,
  SCHOOLS,
  STAGING_OBJECTS,
} from "../shared/gameplay/gameConfig.ts";
import { ProjectionReplica } from "../shared/protocol/replica.ts";
import { chunkId } from "../shared/world/coordinates.ts";

function finish<T>(generator: Generator<void, T>): T {
  let result = generator.next();
  while (!result.done) result = generator.next();
  return result.value;
}
function frameHarness() {
  const oldRequest = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map<number, FrameRequestCallback>();
  let serial = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++serial;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
  };
  return {
    callbacks,
    drain() {
      let iterations = 0;
      while (callbacks.size) {
        assert(++iterations < 2000, "LOD work must become idle");
        const [id, callback] = callbacks.entries().next().value!;
        callbacks.delete(id);
        callback(iterations * 16);
      }
    },
    restore() {
      globalThis.requestAnimationFrame = oldRequest;
      globalThis.cancelAnimationFrame = oldCancel;
    },
  };
}

test("fixed simplex seeds and authored layout produce the same biomes regardless of load/order", () => {
  const a = new TerrainBiomes(),
    b = new TerrainBiomes([...STAGING_OBJECTS].reverse());
  const noise = createNoise2D(1337),
    same = createNoise2D(1337),
    different = createNoise2D(1338);
  assert.equal(noise(0.34, 0.78), same(0.34, 0.78));
  assert.notEqual(noise(0.34, 0.78), different(0.34, 0.78));
  const biomes = new Set<string>(),
    heights = new Set<number>();
  for (let z = 3; z < 1000; z += 17)
    for (let x = 5; x < 1000; x += 17) {
      const sample = a.sample(x, z);
      if (sample.biome === "flower_meadow")
        assert([0x5b8c32, 0x689f38].includes(sample.color));
      assert.deepEqual(sample, b.sample(x, z));
      assert.equal(sample.height, getTerrainHeight(x, z));
      biomes.add(sample.biome);
      heights.add(sample.height);
    }
  for (const biome of [
    "foundation",
    "river",
    "lake",
    "sand",
    "lush_grass",
    "flower_meadow",
    "hills",
    "highlands",
  ])
    assert(biomes.has(biome), biome);
  for (const height of [-0.35, -0.05, 0, 0.4, 0.85, 1.35])
    assert(heights.has(height), String(height));
});

test("all 48 building foundation zones stay level and reject water and nature, including moved layouts", () => {
  const field = new TerrainBiomes();
  assert.equal(STAGING_OBJECTS.length, 48);
  for (const object of STAGING_OBJECTS) {
    const size =
      object.kind === "hq"
        ? [24, 24]
        : GAME_CONFIG.terrain.foundations[object.kind];
    for (const dx of [-size[0]! / 2 + 1, 0, size[0]! / 2 - 1])
      for (const dz of [-size[1]! / 2 + 1, 0, size[1]! / 2 - 1]) {
        if (object.kind === "hq" && Math.hypot(dx + 0.5, dz + 0.5) > 13)
          continue;
        assert.equal(
          field.getTerrainHeight(object.x + dx, object.z + dz),
          0,
          object.id,
        );
        assert.equal(
          field.getTerrainBiome(object.x + dx, object.z + dz),
          "foundation",
          object.id,
        );
      }
  }
  const original = STAGING_OBJECTS.find((o) => o.kind === "unistop")!;
  const moved = { ...original, x: 63, z: 63 };
  assert(field.setObjects([moved]));
  assert(!field.setObjects([moved]));
  for (const [x, z] of [
    [57, 61],
    [63, 63],
    [69, 65],
  ])
    assert.equal(field.getTerrainHeight(x!, z!), 0);
});

test("central lake and both river arms have depressed water and sandy banks without blocking knowledge tiles", () => {
  const field = new TerrainBiomes();
  assert.equal(field.getTerrainBiome(500, 500), "lake");
  assert.equal(field.getTerrainHeight(500, 500), -0.35);
  let north = 0,
    south = 0,
    sand = 0;
  for (let z = 10; z < 1000; z += 13)
    for (let x = 5; x < 1000; x += 3) {
      const s = field.sample(x, z);
      if (s.biome === "river") {
        if (z < 500) north++;
        else south++;
        assert.equal(s.height, -0.35);
        assert(!field.isFoundation(x + 0.5, z + 0.5));
      }
      if (s.biome === "sand") {
        sand++;
        assert.equal(s.height, -0.05);
      }
    }
  assert(north > 0 && south > 0 && sand > 0);
  let edge = 500;
  while (["lake", "river"].includes(field.getTerrainBiome(edge, 500))) edge++;
  assert.equal(field.getTerrainBiome(edge, 500), "sand");
  assert.equal(field.getTerrainBiome(edge + 1, 500), "sand");
});

test("chunk meshes contain real terraces, lit cliff faces and clipped edge chunks", () => {
  const field = new TerrainBiomes();
  let terrain: THREE.BufferGeometry | undefined;
  for (const id of [0, 34, 85, 170]) {
    const geometry = buildTerrainChunkGeometry(field, id);
    const normals = geometry.getAttribute("normal");
    for (let i = 0; i < normals.count; i++)
      assert(
        Math.abs(
          Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1,
        ) < 1e-5,
      );
    if (geometry.boundingBox!.max.z > 0) {
      terrain?.dispose();
      terrain = geometry;
    } else geometry.dispose();
  }
  assert(terrain);
  assert(terrain.getAttribute("color").count > 0);
  const normals = terrain.getAttribute("normal");
  let top = false,
    side = false;
  for (let i = 0; i < normals.count; i++) {
    top ||= normals.getZ(i) > 0.99;
    side ||= Math.abs(normals.getZ(i)) < 0.01;
  }
  assert(top && side);
  terrain.dispose();
  const edge = buildTerrainChunkGeometry(field, 255);
  assert.equal(edge.boundingBox!.max.x, 500);
  assert.equal(edge.boundingBox!.min.y, -500);
  assert.equal(edge.boundingBox!.min.x, 460);
  edge.dispose();
});

test("terrain picking matches rendered tops/cliffs in isometric view and selection follows height", () => {
  const field = new TerrainBiomes();
  const camera = new THREE.OrthographicCamera();
  for (const [x, z] of [
    [30, 30],
    [158, 350],
    [542, 610],
    [800, 800],
  ]) {
    const id = chunkId(Math.floor(x! / 64), Math.floor(z! / 64));
    const geometry = buildTerrainChunkGeometry(field, id),
      mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateWorldMatrix(true, true);
    configureMapCamera(camera, "isometric", x! + 0.5, z! + 0.5, 72, 1.6);
    const point = new THREE.Vector3(
      x! + 0.5 - 500,
      500 - z! - 0.5,
      field.getTerrainHeight(x!, z!),
    );
    const projected = point.clone().project(camera),
      caster = new THREE.Raycaster();
    caster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
    const visible = caster.intersectObject(mesh)[0]!;
    assert(visible);
    const picked = terrainPointFromRay(caster.ray, field)!;
    assert(picked);
    assert(picked.distanceTo(visible.point) < 1e-5);
    assert.equal(
      Math.floor(picked.x + 500),
      Math.floor(x! / 64) * 64 + Math.floor(visible.uv!.x * 64),
    );
    assert.equal(
      Math.floor(500 - picked.y),
      Math.floor(z! / 64) * 64 + Math.floor((1 - visible.uv!.y) * 64),
    );
    geometry.dispose();
    mesh.material.dispose();
  }
  const indicators = new TileIndicatorLayer((x, z) =>
    field.getTerrainHeight(x, z),
  );
  indicators.setTile("selected", { x: 30, z: 30 });
  assert.equal(
    indicators.object.children[1]!.position.z,
    field.getTerrainHeight(30, 30),
  );
  indicators.dispose();
});

test("voxel prop plans are repeatable, discovery-filtered, foundation-free and grounded at terrain height", () => {
  const field = new TerrainBiomes(),
    kinds = new Set<string>();
  assert.deepEqual(finish(naturePlanRows(field, 0, () => false)), []);
  for (const id of [0, 17, 34, 85, 136, 221]) {
    const predicate = (x: number, z: number) => (x + z) % 5 !== 0;
    const a = finish(naturePlanRows(field, id, predicate)),
      b = finish(naturePlanRows(field, id, predicate));
    assert.deepEqual(a, b);
    for (const prop of a) {
      kinds.add(prop.kind);
      assert(predicate(Math.floor(prop.x), Math.floor(prop.z)));
      assert(!field.isFoundation(prop.x, prop.z, 2));
      assert.equal(prop.height, field.getTerrainHeight(prop.x, prop.z));
      assert(prop.height >= 0);
    }
  }
  for (const kind of ["oak", "birch", "grass", "red", "yellow", "blue"])
    assert(kinds.has(kind), kind);
  for (const geometry of [
    createOakTreeGeometry(),
    createBirchTreeGeometry(),
    createGrassTuftGeometry(),
    createFlowerGeometry(),
  ]) {
    geometry.computeBoundingBox();
    assert(geometry.boundingBox!.min.z >= -1e-6);
    assert(geometry.boundingBox!.max.z > 0);
    assert.equal(
      geometry.getAttribute("color").count,
      geometry.getAttribute("position").count,
    );
    geometry.dispose();
  }
});

test("viewport LOD builds bounded detail incrementally, hides small props beyond 400 and becomes idle", () => {
  const frames = frameHarness(),
    field = new TerrainBiomes();
  let terrain: TerrainChunks | undefined, nature: LandscapeEffects | undefined;
  try {
    terrain = new TerrainChunks(field, () => {});
    const camera = new THREE.OrthographicCamera();
    configureMapCamera(camera, "isometric", 32, 32, 401, 1);
    terrain.updateView(camera, 401);
    assert.equal(frames.callbacks.size, 0);
    configureMapCamera(camera, "isometric", 32, 32, 72, 1);
    terrain.updateView(camera, 72);
    assert.equal(
      [...terrain.layers.values()].filter((l) => l.detail).length,
      0,
    );
    assert(frames.callbacks.size > 0);
    frames.drain();
    assert([...terrain.layers.values()].some((l) => l.detail));
    assert(
      [...terrain.layers.values()].filter((l) => l.detail).length <=
        GAME_CONFIG.terrain.detailCacheChunks,
    );
    terrain.updateView(camera, 401);
    assert(
      [...terrain.layers.values()].every((l) => l.mesh.geometry === l.coarse),
    );
    const replica = new ProjectionReplica(0);
    replica.applySnapshot({
      chunkId: 0,
      viewRevision: 0n,
      mask: new Uint8Array(8192),
      fog: new Uint8Array(512).fill(255),
    });
    nature = new LandscapeEffects([], () => {}, field);
    nature.rebuild(0, replica);
    frames.drain();
    const detail: THREE.Object3D[] = [];
    nature.group.traverse((o) => {
      if (o.userData.detail) detail.push(o);
    });
    assert(detail.length > 0);
    nature.updateView(camera, 400);
    assert(detail.every((o) => o.visible));
    nature.updateView(camera, 400.01);
    assert(detail.every((o) => !o.visible));
    const instances: THREE.InstancedMesh[] = [];
    nature.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) instances.push(o);
    });
    assert(instances.length > 0);
    assert(instances.some((o) => o.name === "OakTrees" && o.castShadow));
    assert(instances.every((o) => o.receiveShadow || o.name === "BorderFlags"));
    replica.applySnapshot({
      chunkId: 0,
      viewRevision: 1n,
      mask: new Uint8Array(8192),
      fog: new Uint8Array(512),
    });
    nature.rebuild(0, replica);
    let stale = 0;
    nature.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) stale++;
    });
    assert(stale > 0, "Public scenery must stay mounted while replacement builds");
    assert(!nature.group.getObjectByName("BorderFlags"), "revoked private flags are removed immediately");
    frames.drain();
    nature.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) stale++;
    });
    assert(stale > 0, "Public scenery remains visible beneath cosmetic fog");
    assert(
      !nature.group.getObjectByName("BorderFlags"),
      "private ownership flags must not survive a revoked snapshot",
    );
    terrain.layers.get(0)!.pixels.fill(127);
    terrain.resetKnowledge();
    assert(terrain.layers.get(0)!.pixels.every((v) => v === 0));
    assert.equal(frames.callbacks.size, 0);
  } finally {
    nature?.dispose();
    terrain?.dispose();
    assert.equal(frames.callbacks.size, 0);
    frames.restore();
  }
});

test("replacement snapshots keep scenery mounted until the next complete build", () => {
  const frames = frameHarness();
  const replica = new ProjectionReplica(0);
  replica.applySnapshot({chunkId: 0, viewRevision: 0n,
    mask: new Uint8Array(8192), fog: new Uint8Array(512)});
  const nature = new LandscapeEffects([], undefined, new TerrainBiomes());
  try {
    nature.rebuild(0, replica);
    frames.drain();
    const trees = nature.group.getObjectByName("OakTrees") ?? nature.group.getObjectByName("BirchTrees");
    assert(trees);
    const mounted = trees.parent!;
    nature.rebuild(0, replica);
    nature.rebuild(0, replica);
    assert(trees.parent, "in-flight updates must not remove existing scenery");
    frames.drain();
    assert.equal(mounted.parent, null, "the old group is disposed after replacement is ready");
    assert(nature.group.getObjectByName("OakTrees") ?? nature.group.getObjectByName("BirchTrees"));
  } finally {
    nature.dispose();
    frames.restore();
  }
});

test("terrain ownership data retains neutral biomes, school tint 68%, shared tint 50/50", () => {
  const replica = new ProjectionReplica(0),
    field = new TerrainBiomes();
  const mask = new Uint8Array(8192),
    fog = new Uint8Array(512),
    pixels = new Uint8Array(16384);
  const data = new DataView(mask.buffer);
  // Unknown, neutral reveal, owned, private shared, and unknown with stale shared metadata.
  for (const local of [1, 2, 3]) fog[local >> 3]! |= 1 << (local & 7);
  for (const local of [2, 3]) data.setUint16(local * 2, 1, true);
  replica.applySnapshot({ chunkId: 0, viewRevision: 0n, mask, fog });
  const shared = new Map<number, readonly number[]>([
    [3, [0, 1]],
    [4, [0, 1]],
  ]);
  const read = (local: number) => {
    writeTerrainTile(pixels, 0, local, replica, field, 0, shared);
    const offset = 63 * 256 + local * 4;
    return [...pixels.slice(offset, offset + 4)];
  };
  assert.equal(read(0)[3], 0);
  assert.equal(
    read(4)[3],
    0,
    "Shared metadata must not reveal unknown terrain",
  );
  const bytes = (hex: number) => [
    (hex >> 16) & 255,
    (hex >> 8) & 255,
    hex & 255,
  ];
  assert.deepEqual(read(1), [...bytes(field.sample(1, 0).color), 1]);
  const terrain = bytes(field.sample(2, 0).color),
    school = bytes(parseInt(SCHOOLS[0].color.slice(1), 16));
  assert.deepEqual(
    read(2).slice(0, 3),
    terrain.map((c, i) => Math.round(c * 0.32 + school[i]! * 0.68)),
  );
  assert(read(2)[3]! >= 128);
  const rival = bytes(parseInt(SCHOOLS[1].color.slice(1), 16));
  const sharedTerrain = bytes(field.sample(3, 0).color);
  assert.deepEqual(
    read(3).slice(0, 3),
    sharedTerrain.map((c, i) =>
      Math.round(c * 0.32 + ((school[i]! + rival[i]!) / 2) * 0.68),
    ),
  );
  assert.equal(terrainTileColor(0x5b8c32, []), 0x5b8c32);
});

test("territory edges inspect four neighbors across chunk seams and follow deltas", () => {
  const replica = new ProjectionReplica(0),
    field = new TerrainBiomes(),
    pixels = new Uint8Array(16384);
  const left = new Uint8Array(8192),
    right = new Uint8Array(8192);
  new DataView(left.buffer).setUint16(63 * 2, 1, true);
  new DataView(right.buffer).setUint16(0, 1, true);
  replica.applySnapshot({
    chunkId: 0,
    viewRevision: 0n,
    mask: left,
    fog: new Uint8Array(512).fill(255),
  });
  const paint = () => {
    writeTerrainTile(pixels, 0, 63, replica, field, 0, new Map());
    return pixels[63 * 256 + 63 * 4 + 3]! - 128;
  };
  assert.equal(
    paint(),
    15,
    "Absent neighbor chunks are safely treated as outside",
  );
  replica.applySnapshot({
    chunkId: 1,
    viewRevision: 0n,
    mask: right,
    fog: new Uint8Array(512).fill(255),
  });
  assert.equal(paint(), 13, "No inner seam on adjacent owned tiles");
  replica.applyDelta({
    chunkId: 1,
    localIndex: 0,
    baseRevision: 0n,
    nextRevision: 1n,
    mask: 0,
    discovered: true,
  });
  assert.equal(paint(), 15, "Removed ownership restores only the exposed edge");
});

test("coarse terrain UVs retain individual tile sampling while public terrain receives dusk lighting", () => {
  const field = new TerrainBiomes(),
    geometry = buildTerrainChunkGeometry(field, 0, 8);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  for (const x of [1.5, 2.5, 6.5]) {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(x - 500, 500 - 1.5, 10),
      new THREE.Vector3(0, 0, -1),
    );
    const hit = ray.intersectObject(mesh)[0]!;
    assert.equal(Math.floor(hit.uv!.x * 64), Math.floor(x));
    assert.equal(Math.floor((1 - hit.uv!.y) * 64), 1);
  }
  const texture = new THREE.DataTexture(new Uint8Array(16384), 64, 64);
  const material = terrainMaterial(texture);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
  };
  material.onBeforeCompile(
    shader as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  assert(!shader.fragmentShader.includes("if (knowledge.a < 0.001) discard;"));
  assert.equal(material.toneMapped, true);
  for (const disposable of [geometry, mesh.material, texture, material])
    disposable.dispose();
});
