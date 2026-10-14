import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { ModelAssetLoader } from "../client/src/assetLoader.ts";
import {
  applyModelPlacement,
  mountModelAsset,
} from "../client/src/assetPipeline.ts";
import { MODEL_ASSETS, MODEL_PLACEMENTS } from "../client/src/assetRegistry.ts";
import {
  type CameraMode,
  configureMapCamera,
  deriveDevCreditState,
  groundPointFromNdc,
  projectTileCorners,
  TileIndicatorLayer,
} from "../client/src/worldView.ts";

test("dev credit state only blocks a known positive unaffordable cost", () => {
  assert.equal(deriveDevCreditState(undefined, "1"), "unknown");
  assert.equal(deriveDevCreditState("0", undefined), "unknown");
  assert.equal(deriveDevCreditState("not-a-balance", "1"), "unknown");
  assert.equal(deriveDevCreditState("0", "0"), "free");
  assert.equal(deriveDevCreditState("0", "1"), "insufficient");
  assert.equal(deriveDevCreditState("2", "3"), "insufficient");
  assert.equal(deriveDevCreditState("3", "3"), "affordable");
  assert.equal(
    deriveDevCreditState("9007199254740993", "9007199254740992"),
    "affordable",
  );
});

test("camera projection, tile corners, and ground picking agree in every view", () => {
  const views = [
    { centerX: 215, centerZ: 235, span: 275, aspect: 16 / 9 },
    { centerX: 500, centerZ: 500, span: 1_000, aspect: 1 },
    { centerX: 12, centerZ: 988, span: 32, aspect: 9 / 16 },
    { centerX: 785, centerZ: 765, span: 200, aspect: 2.4 },
  ] as const;
  const tiles = [
    { x: 0, z: 0 },
    { x: 214, z: 234 },
    { x: 510, z: 485 },
    { x: 999, z: 999 },
  ] as const;

  for (const mode of ["top-down", "isometric"] satisfies CameraMode[]) {
    for (const view of views) {
      const camera = new THREE.OrthographicCamera();
      configureMapCamera(
        camera,
        mode,
        view.centerX,
        view.centerZ,
        view.span,
        view.aspect,
      );

      const expectedCenter = new THREE.Vector3(
        view.centerX - 500,
        500 - view.centerZ,
        0,
      );
      const centerHit = groundPointFromNdc(camera, new THREE.Vector2(0, 0));
      assert.ok(centerHit);
      assert.ok(centerHit.distanceTo(expectedCenter) < 1e-8);

      for (const tile of tiles) {
        const quad = projectTileCorners(camera, tile.x, tile.z);
        const worldCorners = [
          new THREE.Vector3(tile.x - 500, 500 - tile.z, 0),
          new THREE.Vector3(tile.x - 499, 500 - tile.z, 0),
          new THREE.Vector3(tile.x - 499, 499 - tile.z, 0),
          new THREE.Vector3(tile.x - 500, 499 - tile.z, 0),
        ];
        quad.forEach((corner, index) => {
          const projected = worldCorners[index]!.clone().project(camera);
          assert.ok(corner.distanceTo(projected) < 1e-12);
          const roundTrip = groundPointFromNdc(camera, corner);
          assert.ok(roundTrip);
          assert.ok(roundTrip.distanceTo(worldCorners[index]!) < 1e-7);
        });

        const tileCenter = new THREE.Vector3(tile.x - 499.5, 499.5 - tile.z, 0);
        const centerScreen = tileCenter.clone().project(camera);
        const centerRoundTrip = groundPointFromNdc(
          camera,
          new THREE.Vector2(centerScreen.x, centerScreen.y),
        );
        assert.ok(centerRoundTrip);
        assert.ok(centerRoundTrip.distanceTo(tileCenter) < 1e-7);
      }
    }
  }
});

test("tile indicators reuse constant scene resources without WebGL", () => {
  const indicators = new TileIndicatorLayer();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  indicators.object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      geometries.add(child.geometry);
      const childMaterials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const material of childMaterials) materials.add(material);
    }
  });
  assert.equal(indicators.object.children.length, 5);
  assert.equal(geometries.size, 2);
  assert.equal(materials.size, 10);

  for (let index = 0; index < 10_000; index++) {
    indicators.setTile("hover", { x: index % 1_000, z: index % 1_000 });
    indicators.setTile("selected", { x: 999, z: 0 });
  }
  assert.equal(indicators.object.children.length, 5);
  assert.equal(geometries.size, 2);
  const hover = indicators.object.children[0];
  assert.ok(hover);
  assert.equal(hover.visible, true);
  assert.deepEqual(hover.position.toArray(), [499.5, -499.5, 0]);
  const outline = hover.children[1];
  assert.ok(outline instanceof THREE.LineLoop);
  const positions = outline.geometry.getAttribute("position");
  const worldCorners = Array.from({ length: positions.count }, (_, index) =>
    new THREE.Vector3(
      positions.getX(index),
      positions.getY(index),
      positions.getZ(index),
    ).add(hover.position),
  );
  assert.deepEqual(
    worldCorners.map(({ x, y }) => [x, y]),
    [
      [499, -499],
      [500, -499],
      [500, -500],
      [499, -500],
    ],
  );
  indicators.dispose();
  assert.equal(indicators.object.children.length, 0);
});

test("model registry uses local swappable URLs and preserves world locations", () => {
  assert.deepEqual(MODEL_ASSETS, {
    hq: { url: "/models/hq.gltf" },
    landmark: { url: "/models/landmark.gltf" },
  });
  assert.deepEqual(
    MODEL_PLACEMENTS.map(({ asset, worldX, worldZ }) => ({
      asset,
      worldX,
      worldZ,
    })),
    [
      { asset: "hq", worldX: 215, worldZ: 235 },
      { asset: "hq", worldX: 785, worldZ: 765 },
      { asset: "landmark", worldX: 510, worldZ: 485 },
    ],
  );
});

test("fixture glTF files are self-contained glTF 2.0 geometry", async () => {
  for (const name of ["hq", "landmark"]) {
    const document = JSON.parse(
      await readFile(
        new URL(`../client/public/models/${name}.gltf`, import.meta.url),
        "utf8",
      ),
    ) as {
      asset: { version: string };
      buffers: { byteLength: number; uri: string }[];
      bufferViews: { byteLength: number }[];
      accessors: { count: number; type: string }[];
      meshes: unknown[];
    };
    assert.equal(document.asset.version, "2.0");
    assert.ok(document.meshes.length > 0);
    assert.match(document.buffers[0]?.uri ?? "", /^data:/);
    const encoded = document.buffers[0]!.uri.split(",", 2)[1]!;
    const bytes = Buffer.from(encoded, "base64");
    assert.equal(bytes.byteLength, document.buffers[0]!.byteLength);
    assert.equal(document.bufferViews[0]!.byteLength, bytes.byteLength);
    assert.equal(document.accessors[0]!.count, 3);
    assert.equal(document.accessors[0]!.type, "VEC3");
    const positions = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
    const a = new THREE.Vector3(positions[0], positions[1], positions[2]);
    const b = new THREE.Vector3(positions[3], positions[4], positions[5]);
    const c = new THREE.Vector3(positions[6], positions[7], positions[8]);
    const normal = b.sub(a).cross(c.sub(a));
    assert.ok(normal.lengthSq() > 0, "fixture triangle must not be degenerate");
    assert.ok(
      normal.z > 0,
      "fixture front face must point toward the map camera",
    );
  }
});

test("loader deduplicates requests and returns isolated scene resources", async () => {
  let requests = 0;
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial();
  const template = new THREE.Group();
  template.add(new THREE.Mesh(geometry, material));
  const loader = new ModelAssetLoader({
    async load() {
      requests++;
      await Promise.resolve();
      return template;
    },
  });
  const [first, second] = await Promise.all([
    loader.loadInstance("/models/hq.gltf"),
    loader.loadInstance("/models/hq.gltf"),
  ]);
  assert.equal(requests, 1);
  assert.notEqual(first, second);
  const firstMesh = first.children[0] as THREE.Mesh;
  const secondMesh = second.children[0] as THREE.Mesh;
  assert.notEqual(firstMesh.geometry, secondMesh.geometry);
  assert.notEqual(firstMesh.material, secondMesh.material);
});

test("placement conversion and fallback lifecycle do not require WebGL", async () => {
  const scene = new THREE.Scene();
  const fallback = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  const placement = MODEL_PLACEMENTS[0]!;
  applyModelPlacement(fallback, placement);
  assert.deepEqual(fallback.position.toArray(), [-285, 265, 0.12]);

  const failed = mountModelAsset(
    scene,
    { loadInstance: () => Promise.reject(new Error("missing")) },
    MODEL_ASSETS.hq.url,
    placement,
    fallback,
  );
  assert.equal(scene.children.includes(fallback), true);
  assert.equal(await failed.ready, "fallback");
  assert.equal(scene.children.includes(fallback), true);
  failed.dispose();
  assert.equal(scene.children.includes(fallback), false);
});

test("Phase 3 GLB auto-loader conventions, faction tinting and chest lid rotation", async () => {
  const {
    getChestModelUrl,
    getHqModelUrl,
    getLandmarkModelUrl,
    getUniStopModelUrl,
    isModelAvailable,
  } = await import("../client/src/assetRegistry.ts");
  const {
    setChestLidRotation,
    tintModelFactionMaterials,
  } = await import("../client/src/assetPipeline.ts");

  // Model URL conventions
  assert.equal(getHqModelUrl("hcmut"), "/models/hqs/hcmut_hq.glb");
  assert.equal(getHqModelUrl("hcmiu"), "/models/hqs/hcmiu_hq.glb");
  assert.equal(getLandmarkModelUrl("fansipan"), "/models/landmarks/fansipan.glb");
  assert.equal(
    getLandmarkModelUrl("thanglong"),
    "/models/landmarks/hoangthanhthanglong.glb",
  );
  assert.equal(
    getLandmarkModelUrl("cairang"),
    "/models/landmarks/chonoicairang.glb",
  );
  assert.equal(getUniStopModelUrl("aspire"), "/models/unistops/unistop_aspire.glb");
  assert.equal(getUniStopModelUrl("nitro"), "/models/unistops/unistop_nitro.glb");
  assert.equal(
    getUniStopModelUrl("predator"),
    "/models/unistops/unistop_predator.glb",
  );
  assert.equal(getChestModelUrl("aspire"), "/models/chests/chest_aspire.glb");

  // Manifest availability check
  assert.equal(isModelAvailable("/models/hqs/hcmut_hq.glb"), true);
  assert.equal(isModelAvailable("/models/hqs/hcmiu_hq.glb"), true);
  assert.equal(isModelAvailable("/models/landmarks/nonexistent.glb"), false);

  // Skip if unavailable immediately uses fallback without calling loader
  let loaderCalled = false;
  const scene = new THREE.Scene();
  const fallback = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const mount = mountModelAsset(
    scene,
    {
      loadInstance: () => {
        loaderCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
    },
    "/models/landmarks/missing.glb",
    MODEL_PLACEMENTS[0]!,
    fallback,
    () => {},
    { skipIfUnavailable: true },
  );
  assert.equal(loaderCalled, false);
  assert.equal(await mount.ready, "fallback");
  assert.equal(scene.children.includes(fallback), true);
  mount.dispose();

  // Faction material tinting
  const root = new THREE.Group();
  const meshFaction = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffffff, name: "Mat_Faction_Primary" }),
  );
  const meshAccent = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffffff, name: "Mat_Accent_Green" }),
  );
  const meshOther = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffffff, name: "Mat_White" }),
  );
  root.add(meshFaction, meshAccent, meshOther);

  tintModelFactionMaterials(root, "#0062FF");
  assert.equal(
    (meshFaction.material as THREE.MeshBasicMaterial).color.getHexString(),
    "0062ff",
  );
  assert.equal(
    (meshAccent.material as THREE.MeshBasicMaterial).color.getHexString(),
    "0062ff",
  );
  assert.equal(
    (meshOther.material as THREE.MeshBasicMaterial).color.getHexString(),
    "ffffff",
  );

  // Chest lid rotation
  const chestRoot = new THREE.Group();
  const lid = new THREE.Group();
  lid.name = "Chest_Lid";
  chestRoot.add(lid);
  assert.equal(lid.rotation.x, 0);

  setChestLidRotation(chestRoot, true);
  assert.ok(lid.rotation.x < -0.5);

  setChestLidRotation(chestRoot, false);
  assert.equal(lid.rotation.x, 0);
});
