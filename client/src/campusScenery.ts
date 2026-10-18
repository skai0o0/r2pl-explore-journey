import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldObject } from "../../shared/gameplay/gameConfig.ts";
import type { TerrainBiomes } from "./terrainBiomes.ts";

/** Public HQ dressing only. These meshes never enter object picking or gameplay footprints. */
export function createCampusScenery(
  objects: readonly WorldObject[],
  field: TerrainBiomes,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "PublicCampusGardens";
  const parts = new Map<number, THREE.BufferGeometry[]>();
  const box = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    color: number,
    lift = 0,
  ) => {
    const geometry = new THREE.BoxGeometry(width, depth, height);
    geometry.translate(
      x - 500,
      500 - z,
      field.getTerrainHeight(x, z) + height / 2 + lift,
    );
    const batch = parts.get(color) ?? [];
    batch.push(geometry);
    parts.set(color, batch);
  };
  for (const hq of objects.filter((o) => o.kind === "hq")) {
    const radius = Math.max(hq.width, hq.height) / 2 + 2.8;
    // Small curb segments follow the campus perimeter, with open gates on each side.
    for (const sign of [-1, 1]) {
      for (let offset = -radius + 1; offset < radius; offset += 2) {
        if (Math.abs(offset) < 2.5) continue;
        box(hq.x + offset, hq.z + sign * radius, 1.8, 0.3, 0.22, 0x97aaa0);
        box(hq.x + sign * radius, hq.z + offset, 0.3, 1.8, 0.22, 0x97aaa0);
      }
      for (let step = 0; step < 4; step++) {
        box(
          hq.x,
          hq.z + sign * (radius + step * 1.35),
          2.6,
          1.1,
          0.06,
          0x82988d,
        );
      }
      for (const side of [-1, 1]) {
        const x = hq.x + side * (radius - 1.5),
          z = hq.z + sign * (radius - 1.5);
        box(x, z, 2.8, 1.4, 0.35, 0x5b7168);
        box(x, z, 2.6, 1.2, 0.5, 0x47684f, 0.35);
        box(
          hq.x + side * 2,
          hq.z + sign * (radius + 1),
          0.14,
          0.14,
          2.4,
          0x52696a,
        );
        box(
          hq.x + side * 2,
          hq.z + sign * (radius + 1),
          0.3,
          0.3,
          0.22,
          0xffddb0,
          2.35,
        );
      }
    }
    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(radius + 0.5, 48),
      new THREE.MeshBasicMaterial({
        color: 0x102c30,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    contact.position.set(
      hq.x - 500,
      500 - hq.z,
      field.getTerrainHeight(hq.x, hq.z) + 0.015,
    );
    group.add(contact);
  }
  for (const [color, geometries] of parts) {
    const geometry = mergeGeometries(geometries)!;
    for (const part of geometries) part.dispose();
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      ...(color === 0xffddb0
        ? { emissive: color, emissiveIntensity: 0.7 }
        : {}),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = color !== 0xffddb0;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
