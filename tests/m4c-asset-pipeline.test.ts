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
    assert.ok(normal.z > 0, "fixture front face must point toward the map camera");
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
