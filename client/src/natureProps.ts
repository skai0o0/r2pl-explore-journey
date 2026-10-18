import * as THREE from "three";
import { mergeGeometries as mergeBuffers } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SCENE_PRESENTATION as P } from "./scenePresentation.ts";

/** Approved V1 voxel meshes, rotated once from Y-up into V2 Z-up. */
function createBoxWithColor(
  width: number,
  height: number,
  depth: number,
  colorHex: number,
  centerX = 0,
  centerY = 0,
  centerZ = 0,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(centerX, centerY, centerZ);
  geometry.rotateX(Math.PI / 2);
  const color = new THREE.Color(colorHex),
    colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeBuffers(parts);
  if (!merged) throw new Error("Incompatible voxel geometry");
  for (const part of parts) part.dispose();
  return merged;
}

/** Low-poly rounded crowns from the approved scene, converted once into Z-up. */
function treeGeometry(leaf: number, slender: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (geometry: THREE.BufferGeometry, hex: number) => {
    if (geometry.index) {
      const indexed = geometry;
      geometry = geometry.toNonIndexed();
      indexed.dispose();
    }
    geometry.rotateX(Math.PI / 2);
    const color = new THREE.Color(hex);
    const values = new Float32Array(
      geometry.getAttribute("position").count * 3,
    );
    for (let i = 0; i < values.length; i += 3) {
      values[i] = color.r;
      values[i + 1] = color.g;
      values[i + 2] = color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
    parts.push(geometry);
  };
  const trunk = new THREE.CylinderGeometry(0.13, 0.2, 2.6, 6);
  trunk.translate(0, 1.3, 0);
  paint(trunk, P.trees.trunk);
  const crown = new THREE.IcosahedronGeometry(slender ? 1.1 : 1.45, 1);
  crown.scale(1, slender ? 1.65 : 1.15, 1);
  crown.translate(0, slender ? 3.2 : 3.0, 0);
  paint(crown, leaf);
  const top = new THREE.IcosahedronGeometry(slender ? 0.8 : 1.0, 1);
  top.scale(1, 1.15, 1);
  top.translate(-0.2, slender ? 4.1 : 3.9, 0.1);
  paint(top, leaf);
  return mergeGeometries(parts);
}
export function createOakTreeGeometry(): THREE.BufferGeometry {
  return treeGeometry(P.trees.oak, false);
}
export function createBirchTreeGeometry(): THREE.BufferGeometry {
  return treeGeometry(P.trees.birch, true);
}

// 3. CỎ DẠI MINECRAFT (Grass Tuft - Khóm cỏ khối hộp xanh mướt)
export function createGrassTuftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cGrass = 0x5b8c32; // Xanh cỏ Minecraft
  const cGrassLight = 0x70a83b; // Xanh tươi sáng
  const cGrassDark = 0x4e7a27; // Xanh đậm chân cỏ

  // Khóm các cọng cỏ voxel mọc tự nhiên
  parts.push(createBoxWithColor(0.12, 0.65, 0.12, cGrassLight, 0, 0.325, 0));
  parts.push(createBoxWithColor(0.1, 0.5, 0.1, cGrass, 0.18, 0.25, 0.1));
  parts.push(
    createBoxWithColor(0.1, 0.45, 0.1, cGrassDark, -0.16, 0.225, -0.08),
  );
  parts.push(createBoxWithColor(0.08, 0.55, 0.08, cGrass, -0.1, 0.275, 0.15));
  parts.push(
    createBoxWithColor(0.08, 0.4, 0.08, cGrassLight, 0.14, 0.2, -0.14),
  );

  return mergeGeometries(parts);
}

// 4. HOA NHỎ MINECRAFT (Wild Flower - Hoa đỏ Poppy & Dandelion đón nắng)
export function createFlowerGeometry(
  petalColor = 0xef4444,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cStem = 0x5b8c32; // Cuống hoa xanh
  const cPetalRed = petalColor; // Cánh hoa đỏ Poppy (#ef4444)
  const cPetalYellow = 0xfacc15; // Nhị hoa vàng rực rỡ (#facc15)

  // Cuống hoa thẳng đứng
  parts.push(createBoxWithColor(0.08, 0.55, 0.08, cStem, 0, 0.275, 0));
  // Cánh hoa đỏ khối hộp Minecraft
  parts.push(createBoxWithColor(0.32, 0.22, 0.32, cPetalRed, 0, 0.62, 0));
  // Nhị hoa vàng ở giữa
  parts.push(createBoxWithColor(0.14, 0.14, 0.14, cPetalYellow, 0, 0.72, 0));
  // Chiếc lá nhỏ ở thân
  parts.push(createBoxWithColor(0.2, 0.05, 0.08, cStem, 0.1, 0.25, 0));

  return mergeGeometries(parts);
}
