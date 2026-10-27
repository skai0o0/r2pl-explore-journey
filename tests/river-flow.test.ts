import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { TerrainBiomes } from "../client/src/terrainBiomes.ts";
import {
  buildTerrainChunkGeometry,
  terrainMaterial,
} from "../client/src/terrainChunks.ts";
import { chunkId } from "../shared/world/coordinates.ts";

test("river animation coordinates meet across chunk seams and only mark water tops", () => {
  const field = new TerrainBiomes();
  const z = 256;
  let x = 0;
  for (; x < 1000; x++) if (field.sample(x, z).biome === "river") break;
  assert(x < 1000);
  const column = Math.floor(x / 64);
  const geometries = [3, 4].map((row) =>
    buildTerrainChunkGeometry(field, chunkId(column, row)),
  );
  const seam = geometries.map((geometry) => {
    const positions = geometry.getAttribute("position"),
      flow = geometry.getAttribute("riverFlow"),
      normals = geometry.getAttribute("normal");
    const values = new Map<number, [number, number]>();
    let marked = 0;
    for (let i = 0; i < positions.count; i++) {
      if (flow.getZ(i) !== 1) continue;
      marked++;
      assert(normals.getZ(i) > 0.99);
      if (Math.abs(positions.getY(i) - (500 - z)) < 0.001)
        values.set(positions.getX(i), [flow.getX(i), flow.getY(i)]);
    }
    assert(marked > 0);
    return values;
  });
  let shared = 0;
  for (const [key, value] of seam[0]!) {
    const next = seam[1]!.get(key);
    if (!next) continue;
    shared++;
    assert.deepEqual(value, next);
  }
  assert(shared > 0);
  assert(field.riverFlow(x, z + 1)[1] > field.riverFlow(x, z)[1]);
  for (const geometry of geometries) geometry.dispose();
});

test("river shader shares a clock and preserves existing knowledge shading", () => {
  const texture = new THREE.DataTexture(new Uint8Array(16384), 64, 64),
    clock = { value: 10 };
  const material = terrainMaterial(texture, undefined, clock);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
  };
  material.onBeforeCompile(
    shader as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  assert.equal((shader.uniforms as Record<string, unknown>).riverTime, clock);
  assert(shader.fragmentShader.includes("terrainRiverFlow.z > 0.5"));
  assert(shader.fragmentShader.includes("state >= 128.0"));
  material.dispose();
  texture.dispose();
});
