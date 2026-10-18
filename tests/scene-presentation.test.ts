import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createCampusScenery } from "../client/src/campusScenery.ts";
import { DiscoveryFog } from "../client/src/discoveryFog.ts";
import { SCENE_PRESENTATION } from "../client/src/scenePresentation.ts";
import { TerrainBiomes } from "../client/src/terrainBiomes.ts";
import { terrainMaterial } from "../client/src/terrainChunks.ts";
import { naturePlanRows } from "../client/src/terrainNature.ts";
import { STAGING_OBJECTS } from "../shared/gameplay/gameConfig.ts";
import { ProjectionReplica } from "../shared/protocol/replica.ts";

test("distance fog preserves contrast at the real 1,800-unit camera distance", () => {
  const density = SCENE_PRESENTATION.distanceFog.density;
  const fogFraction = 1 - Math.exp(-density * density * 1800 * 1800);
  assert(fogFraction > 0 && fogFraction < 0.1);
});

test("tree scattering is reproducible, grounded and clear of foundations", () => {
  const field = new TerrainBiomes();
  const collect = () => {
    const rows = naturePlanRows(
      field,
      119,
      () => true,
      SCENE_PRESENTATION.trees.jitter,
    );
    let result = rows.next();
    while (!result.done) result = rows.next();
    return result.value.filter((p) => p.kind === "oak" || p.kind === "birch");
  };
  const trees = collect();
  assert(trees.length > 0);
  assert.deepEqual(trees, collect());
  assert(trees.some((p) => p.x % 1 !== 0.5));
  for (const tree of trees) {
    assert.equal(tree.height, field.getTerrainHeight(tree.x, tree.z));
    assert(tree.height >= 0);
    assert.equal(field.isFoundation(tree.x, tree.z, 2), false);
  }
});

function snapshot(
  replica: ProjectionReplica,
  id: number,
  locals: number[],
  revision = 0n,
) {
  const fog = new Uint8Array(512),
    mask = new Uint8Array(8192);
  for (const local of locals) fog[local >> 3]! |= 1 << (local & 7);
  replica.applySnapshot({ chunkId: id, viewRevision: revision, mask, fog });
}
test("cosmetic discovery atlas follows own snapshots/deltas across seams, preserves holes and clears on school change", () => {
  const fog = new DiscoveryFog(),
    own = new ProjectionReplica(0),
    rival = new ProjectionReplica(1);
  snapshot(own, 0, [63, 127]);
  snapshot(own, 1, [0, 64]);
  snapshot(rival, 0, [20]);
  fog.paintChunk(0, own);
  fog.paintChunk(1, own);
  assert.equal(fog.pixels[63 * 4], 255);
  assert.equal(fog.pixels[64 * 4], 255);
  assert.equal(fog.pixels[62 * 4], 0);
  assert.equal(fog.pixels[20 * 4], 0, "rival projection was never copied");
  assert(
    fog.texture.updateRanges.length <= 4,
    "chunk upload is bounded to dirty rows",
  );
  own.applyDelta({
    chunkId: 1,
    localIndex: 128,
    baseRevision: 0n,
    nextRevision: 1n,
    mask: 1,
    discovered: true,
  });
  fog.paintTile(1, 128, own);
  assert.equal(fog.pixels[(2000 + 64) * 4], 255);
  snapshot(own, 1, [], 2n);
  fog.paintChunk(1, own);
  assert.equal(fog.pixels[64 * 4], 0);
  assert.equal(fog.pixels[(2000 + 64) * 4], 0);
  fog.setDensity(0);
  assert.equal(fog.density.value, 0);
  assert.equal(
    own.isDiscovered(0, 62),
    false,
    "cosmetic density never changes discovery",
  );
  fog.reset();
  assert(fog.pixels.every((v) => v === 0));
  assert.equal(fog.texture.updateRanges.length, 0);
  fog.dispose();
});
test("terrain and instanced crowns share world-space fog without an opaque cover or terrain discard", () => {
  const fog = new DiscoveryFog(),
    texture = new THREE.DataTexture(new Uint8Array(16384), 64, 64);
  const terrain = terrainMaterial(texture, fog),
    tree = new THREE.MeshLambertMaterial();
  fog.apply(tree);
  for (const material of [terrain, tree]) {
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    };
    material.onBeforeCompile(
      shader as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    assert.match(shader.vertexShader, /instanceMatrix \* landscapePosition/);
    assert.match(
      shader.fragmentShader,
      /max\(center, spread \/ 9.0\)/,
      "narrow corridors stay visible",
    );
    assert(
      !shader.fragmentShader.includes("if (knowledge.a < 0.001) discard;"),
    );
    assert.equal(
      (shader.uniforms as Record<string, { value: unknown }>)
        .landscapeDiscovery!.value,
      fog.texture,
    );
    material.dispose();
  }
  texture.dispose();
  fog.dispose();
});
test("public terrain and HQ dressing cannot reveal chest foundations or add interaction targets", () => {
  const publicObjects = STAGING_OBJECTS.filter((o) => o.kind !== "chest");
  const field = new TerrainBiomes(publicObjects);
  for (const chest of STAGING_OBJECTS.filter((o) => o.kind === "chest"))
    assert.equal(field.isFoundation(chest.x, chest.z), false, chest.id);
  const campus = createCampusScenery(publicObjects, field);
  assert.equal(campus.getObjectByName("PublicCampusGardens"), campus);
  campus.traverse((object) => {
    assert.equal(object.userData.objectId, undefined);
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      object.material.dispose();
    }
  });
});
