import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  applyGlbModelPlacement,
  cacheInteractiveObject,
  type InteractiveObject,
  mountModelAsset,
  pickInteractiveObject,
  setChestLidRotation,
} from "../client/src/assetPipeline.ts";
import { createProceduralBuilding } from "../client/src/proceduralBuildings.ts";
import {
  configureMapCamera,
  groundPointFromNdc,
} from "../client/src/worldView.ts";

const mesh = (x = 0, z = 5) => {
  const object = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 10),
    new THREE.MeshBasicMaterial(),
  );
  object.position.set(x, 0, z);
  return object;
};
const verticalRay = (x = 0, y = 0) =>
  new THREE.Raycaster(
    new THREE.Vector3(x, y, 100),
    new THREE.Vector3(0, 0, -1),
  );

test("the shipped HCMUT GLB's roof, outer wing and base are picked in isometric view", async () => {
  const bytes = await readFile(
    new URL("../client/public/models/hqs/hcmut_hq.glb", import.meta.url),
  );
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  // Keep the shipped vertex/index buffers and node transforms unchanged. Only
  // omit image textures, since this geometry test runs without a browser/GPU.
  document.materials = document.materials.map(
    (material: {
      name?: string;
      doubleSided?: boolean;
      alphaMode?: string;
      pbrMetallicRoughness?: { baseColorFactor?: number[] };
    }) => ({
      name: material.name,
      doubleSided: material.doubleSided,
      alphaMode: material.alphaMode,
      pbrMetallicRoughness: {
        baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor,
      },
    }),
  );
  const json = Buffer.from(JSON.stringify(document));
  assert(json.length <= jsonLength);
  bytes.fill(0x20, 20, 20 + jsonLength);
  json.copy(bytes, 20);
  const loaded = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const root = applyGlbModelPlacement(loaded.scene, {
    id: "hq-hcmut",
    asset: "hq",
    worldX: 500,
    worldZ: 500,
    scale: 1,
    rotationZ: 0,
  });
  const entry = cacheInteractiveObject({ id: "hq-hcmut", kind: "hq" }, root);
  const boxes: THREE.Box3[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh)
      boxes.push(new THREE.Box3().setFromObject(node));
  });
  assert(boxes.length > 0);
  const roof = [...boxes].sort((a, b) => b.max.z - a.max.z)[0]!;
  const wing = [...boxes].sort((a, b) => a.min.x - b.min.x)[0]!;
  const base = [...boxes].sort(
    (a, b) =>
      (b.max.x - b.min.x) * (b.max.y - b.min.y) -
      (a.max.x - a.min.x) * (a.max.y - a.min.y),
  )[0]!;
  const camera = new THREE.OrthographicCamera();
  configureMapCamera(camera, "isometric", 500, 500, 72, 1.6);
  for (const part of [roof, wing, base]) {
    const screen = part.getCenter(new THREE.Vector3()).project(camera);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
    assert.equal(pickInteractiveObject(ray, [entry])?.id, "hq-hcmut");
  }
  const corner = verticalRay(
    entry.worldBox.max.x - 0.05,
    entry.worldBox.max.y - 0.05,
  );
  assert(corner.ray.intersectsBox(entry.worldBox));
  assert.equal(
    pickInteractiveObject(corner, [entry]),
    undefined,
    "empty space beside the real HQ base must remain selectable ground",
  );
});

test("isometric rays select the high geometry of each actual procedural building", () => {
  const camera = new THREE.OrthographicCamera();
  configureMapCamera(camera, "isometric", 500, 500, 72, 1.6);
  for (const kind of ["hq", "landmark", "unistop", "chest"] as const) {
    const root = createProceduralBuilding(kind, 0x00ffcc);
    const entry = cacheInteractiveObject({ id: kind, kind }, root);
    let roof = new THREE.Vector3();
    let maxZ = -Infinity;
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const box = new THREE.Box3().setFromObject(node);
      if (box.max.z > maxZ) {
        maxZ = box.max.z;
        roof = box.getCenter(new THREE.Vector3());
      }
    });
    assert(entry.worldBox.max.z >= maxZ);
    const screen = roof.clone().project(camera);
    const ndc = new THREE.Vector2(screen.x, screen.y);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    assert.equal(pickInteractiveObject(ray, [entry])?.id, kind);
    const ground = groundPointFromNdc(camera, ndc)!;
    assert(
      ground.distanceTo(roof) > 1,
      "roof click differs from the ground projection",
    );
  }
});

test("empty space inside a hexagonal HQ's box falls through to the correct ground tile", () => {
  const root = createProceduralBuilding("hq", 0x00ffcc);
  const entry = cacheInteractiveObject({ id: "hq", kind: "hq" }, root);
  const ray = verticalRay(8, 9);
  assert(
    ray.ray.intersectsBox(entry.worldBox),
    "exercise a broad-phase false positive",
  );
  assert.equal(pickInteractiveObject(ray, [entry]), undefined);
  const ground = ray.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    new THREE.Vector3(),
  )!;
  assert.deepEqual(
    [Math.floor(ground.x + 500), Math.floor(500 - ground.y)],
    [508, 491],
  );
  assert.equal(pickInteractiveObject(verticalRay(8, 0), [entry])?.id, "hq");
});

test("broad-phase filters off-ray and hidden buildings; narrow-phase holes never become hits", () => {
  const root = new THREE.Group();
  root.add(mesh(-4), mesh(4));
  const entry = cacheInteractiveObject({ id: "wings", kind: "hq" }, root);
  const offRay = mesh(100);
  const far = cacheInteractiveObject(
    { id: "off-ray", kind: "landmark" },
    offRay,
  );
  let farRaycasts = 0;
  offRay.raycast = () => {
    farRaycasts++;
  };
  const ray = verticalRay();
  assert(ray.ray.intersectsBox(entry.worldBox));
  assert.equal(pickInteractiveObject(ray, [entry, far]), undefined);
  assert.equal(farRaycasts, 0);
  assert.equal(pickInteractiveObject(verticalRay(4), [entry])?.id, "wings");
  assert.equal(
    pickInteractiveObject(verticalRay(4), [entry], () => false),
    undefined,
  );
  root.visible = false;
  assert.equal(pickInteractiveObject(verticalRay(4), [entry]), undefined);
  root.visible = true;
  root.children[1]!.visible = false;
  assert.equal(pickInteractiveObject(verticalRay(4), [entry]), undefined);
});

test("closest visible mesh wins independently of catalog order or invisible children", () => {
  const low = mesh(0, 5),
    high = mesh(0, 25);
  const entries = [
    cacheInteractiveObject({ id: "low", kind: "chest" }, low),
    cacheInteractiveObject({ id: "high", kind: "unistop" }, high),
  ];
  assert.equal(pickInteractiveObject(verticalRay(), entries)?.id, "high");
  assert.equal(
    pickInteractiveObject(verticalRay(), [...entries].reverse())?.id,
    "high",
  );
  high.material.visible = false;
  assert.equal(pickInteractiveObject(verticalRay(), entries)?.id, "low");
  high.material.visible = true;
  const hiddenParent = new THREE.Group();
  hiddenParent.add(high);
  hiddenParent.visible = false;
  assert.equal(pickInteractiveObject(verticalRay(), entries)?.id, "low");
});

test("mount lifecycle replaces fallback bounds with fitted Z-up GLB bounds, then recaches relocation", async () => {
  const scene = new THREE.Scene();
  const roots: InteractiveObject[] = [];
  const fallback = mesh();
  const loaded = new THREE.Group();
  // A glTF Y-up tower; fitting rotates its height onto the map's Z axis.
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(2, 30, 2),
    new THREE.MeshBasicMaterial(),
  );
  tower.position.y = 15;
  loaded.add(tower);
  const mount = mountModelAsset(
    scene,
    { loadInstance: async () => loaded },
    "tower.glb",
    {
      id: "landmark",
      asset: "landmark",
      worldX: 500,
      worldZ: 500,
      scale: 1,
      rotationZ: 0,
    },
    fallback,
    () => {},
    {
      targetSpan: 2,
      onRootChanged: (root) => {
        roots.push(
          cacheInteractiveObject({ id: "landmark", kind: "landmark" }, root),
        );
      },
    },
  );
  assert.equal(mount.objectRoot, fallback);
  assert.equal(roots.length, 1);
  await mount.ready;
  assert.equal(roots.length, 2);
  assert.equal(mount.objectRoot, mount.model);
  assert.equal(fallback.parent, null);
  let entry = roots.at(-1)!;
  assert(entry.worldBox.max.z > roots[0]!.worldBox.max.z + 10);
  // The roof ray misses the fallback's old height, but hits the loaded model.
  const ray = new THREE.Raycaster(
    new THREE.Vector3(30, 0, 28),
    new THREE.Vector3(-1, 0, 0),
  );
  assert.equal(pickInteractiveObject(ray, [roots[0]!]), undefined);
  assert.equal(pickInteractiveObject(ray, [entry])?.id, "landmark");
  entry.objectRoot.position.x += 40;
  entry = cacheInteractiveObject(entry, entry.objectRoot);
  assert.equal(pickInteractiveObject(verticalRay(), [entry]), undefined);
  assert.equal(pickInteractiveObject(verticalRay(40), [entry])?.id, "landmark");
  const box = entry.worldBox.clone();
  // Repeated inputs reuse bounds and precomputed mesh volumes.
  const originalUpdate = entry.objectRoot.updateWorldMatrix;
  entry.objectRoot.updateWorldMatrix = () => {
    throw new Error("input must not rebuild matrices/bounds");
  };
  for (let i = 0; i < 20; i++)
    assert.equal(
      pickInteractiveObject(verticalRay(40), [entry])?.id,
      "landmark",
    );
  entry.objectRoot.updateWorldMatrix = originalUpdate;
  assert(entry.worldBox.equals(box));
  mount.dispose();
  assert.equal(scene.children.length, 0);
});

test("disposing an in-flight mount prevents a late model from re-registering its hitbox", async () => {
  let finish!: (object: THREE.Object3D) => void;
  const roots: THREE.Object3D[] = [];
  const mount = mountModelAsset(
    new THREE.Scene(),
    {
      loadInstance: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
    "late.glb",
    {
      id: "chest",
      asset: "hq",
      worldX: 500,
      worldZ: 500,
      scale: 1,
      rotationZ: 0,
    },
    mesh(),
    () => {},
    { onRootChanged: (root) => roots.push(root) },
  );
  mount.dispose();
  finish(mesh());
  assert.equal(await mount.ready, "fallback");
  assert.equal(roots.length, 1);
});

test("cached world bounds include parent transforms and follow a chest lid's changed pose", () => {
  const parent = new THREE.Group();
  parent.position.set(40, 20, 3);
  parent.rotation.z = Math.PI / 4;
  parent.scale.setScalar(2);
  const chest = createProceduralBuilding("chest", 0xffcc00);
  parent.add(chest);
  const closed = cacheInteractiveObject({ id: "chest", kind: "chest" }, chest);
  assert(closed.worldBox.min.x > 30 && closed.worldBox.min.y > 10);
  setChestLidRotation(chest, true);
  const opened = cacheInteractiveObject(closed, chest);
  assert(!opened.worldBox.equals(closed.worldBox));
  assert(opened.worldBox.equals(new THREE.Box3().setFromObject(chest)));
  assert.equal(
    pickInteractiveObject(verticalRay(40, 20), [opened])?.id,
    "chest",
  );
});
