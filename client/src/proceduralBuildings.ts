import * as THREE from "three";
import {
  GAME_CONFIG,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";

// All dimensions are world units. Geometry is Z-up before it reaches the asset pipeline.
export function createProceduralBuilding(
  kind: "hq" | "landmark" | "unistop" | "chest",
  color: THREE.ColorRepresentation,
  dimensions: { readonly width: number; readonly height: number } = GAME_CONFIG
    .footprints[kind],
  tier?: WorldObject["tier"],
): THREE.Group {
  const group = new THREE.Group();
  const { width, height } = dimensions;
  const material = (color: THREE.ColorRepresentation, name = "") =>
    new THREE.MeshStandardMaterial({
      color,
      name,
      roughness: 0.65,
      metalness: 0.15,
    });
  const addBox = (
    w: number,
    d: number,
    h: number,
    z: number,
    color: THREE.ColorRepresentation,
    name = "",
    x = 0,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, d, h),
      material(color, name),
    );
    mesh.position.set(x, 0, z);
    group.add(mesh);
    return mesh;
  };
  const addTower = (
    radius: number,
    h: number,
    z: number,
    color: THREE.ColorRepresentation,
    sides = 6,
  ) => {
    const geometry = new THREE.CylinderGeometry(radius, radius, h, sides);
    geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.position.z = z;
    group.add(mesh);
  };
  if (kind === "hq") {
    addTower(Math.min(width, height) / 2, 2, 1, 0x315e52);
    addTower(width * 0.22, 9, 6.5, color);
    addBox(0.3, 0.3, 6, 13, 0xdde4ea, "", width * 0.28);
    addBox(
      width * 0.22,
      0.2,
      2.5,
      14.5,
      color,
      "Mat_Faction_Flag",
      width * 0.17,
    );
  } else if (kind === "landmark") {
    addBox(width, height, 2, 1, 0x514369);
    addBox(width * 0.72, height * 0.72, 3, 3.5, 0x75618f);
    addBox(width * 0.45, height * 0.45, 4, 7, color);
    addTower(2, 16, 17, 0xd4c6ef, 8);
    addTower(3, 2, 26, 0x8ce9ed, 8);
  } else if (kind === "unistop") {
    const bodyColor =
      tier === "nitro" ? 0xef5934 : tier === "predator" ? 0x141e29 : 0xc8d0d8;
    const trimColor = tier === "predator" ? 0x00e5ed : bodyColor;
    addBox(width, height, 0.5, 0.25, color, "Mat_Faction_Base");
    addBox(width * 0.88, height * 0.8, 4, 2.5, bodyColor);
    addBox(width * 0.94, height * 0.9, 0.5, 4.75, trimColor);
    addBox(0.2, 0.2, 3, 6.5, 0xdde4ea, "", width * 0.4);
    addBox(
      width * 0.24,
      0.15,
      1.2,
      7.1,
      color,
      "Mat_Faction_Flag",
      width * 0.29,
    );
  } else {
    addBox(width, height, 1.2, 0.6, color);
    const lid = new THREE.Group();
    lid.name = "Chest_Lid";
    lid.position.set(0, -height / 2, 1.2);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 0.4),
      material(0xe8c36c),
    );
    mesh.position.set(0, height / 2, 0.2);
    lid.add(mesh);
    group.add(lid);
  }
  return group;
}
