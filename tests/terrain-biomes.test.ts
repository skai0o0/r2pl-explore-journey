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
  terrainPointFromRay,
} from "../client/src/terrainChunks.ts";
import { naturePlanRows } from "../client/src/terrainNature.ts";
import {
  configureMapCamera,
  TileIndicatorLayer,
} from "../client/src/worldView.ts";
import { GAME_CONFIG, STAGING_OBJECTS } from "../shared/gameplay/gameConfig.ts";
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
    assert(instances.every((o) => !o.castShadow && !o.receiveShadow));
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
