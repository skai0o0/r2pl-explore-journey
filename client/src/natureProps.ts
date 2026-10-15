import * as THREE from "three";
import { mergeGeometries as mergeBuffers } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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

// 1. CÂY GỖ SỒI MINECRAFT (Oak Tree - Thân gỗ nâu sẫm, tán lá khối lập phương xanh đậm)
export function createOakTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cTrunk = 0x6d4e33; // Thân gỗ sồi nâu sẫm (#6d4e33)
  const cTrunkDark = 0x543d2b; // Vân gỗ sồi tối màu
  const cLeaves = 0x4e7a27; // Tán lá sồi xanh đậm (#4e7a27)
  const cLeavesLight = 0x58892c; // Lớp viền lá xanh tươi đón nắng

  // Thân gỗ lập phương (Trunk: height 3.2, base at y = 0)
  parts.push(createBoxWithColor(0.55, 3.2, 0.55, cTrunk, 0, 1.6, 0));
  // Vệt vỏ gỗ tạo chiều sâu
  parts.push(createBoxWithColor(0.58, 0.6, 0.2, cTrunkDark, 0, 1.0, 0.2));
  parts.push(createBoxWithColor(0.2, 0.7, 0.58, cTrunkDark, -0.2, 2.0, 0));

  // Tán lá sồi Minecraft (Layered cubic voxel boxes)
  // Tầng 1: Tán lá rộng phía dưới (y = 2.0 -> 2.8)
  parts.push(createBoxWithColor(2.2, 0.8, 2.2, cLeaves, 0, 2.4, 0));
  // Tầng 2: Thân tán lá chính dày dặn (y = 2.8 -> 3.6)
  parts.push(createBoxWithColor(2.4, 0.8, 2.4, cLeaves, 0, 3.2, 0));
  parts.push(createBoxWithColor(2.5, 0.6, 1.4, cLeavesLight, 0, 3.2, 0));
  parts.push(createBoxWithColor(1.4, 0.6, 2.5, cLeavesLight, 0, 3.2, 0));
  // Tầng 3: Tán lá thuôn phía trên (y = 3.6 -> 4.4)
  parts.push(createBoxWithColor(1.8, 0.8, 1.8, cLeaves, 0, 4.0, 0));
  // Tầng 4: Đỉnh chóp lá vòm (y = 4.4 -> 4.9)
  parts.push(createBoxWithColor(1.1, 0.5, 1.1, cLeavesLight, 0, 4.65, 0));

  return mergeGeometries(parts);
}

// 2. CÂY GỖ BẠCH DƯƠNG MINECRAFT (Birch Tree - Thân trắng ngà có vân xám/đen, tán lá xanh vàng nhạt)
export function createBirchTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cBirchTrunk = 0xe2e8f0; // Thân gỗ trắng ngà (#e2e8f0)
  const cBirchMark = 0x4a4a4a; // Vân đốm xám/đen đặc trưng (#4a4a4a)
  const cBirchLeaf = 0x7ba342; // Tán lá xanh vàng nhạt đặc trưng (#7ba342)
  const cBirchLeafLight = 0x8cb84d; // Tán lá viền vàng nhạt

  // Thân cây cao và thon thả (Trunk: height 4.2, base at y = 0)
  parts.push(createBoxWithColor(0.42, 4.2, 0.42, cBirchTrunk, 0, 2.1, 0));

  // Vệt vân xám đen đặc trưng của gỗ Bạch Dương Minecraft
  parts.push(createBoxWithColor(0.44, 0.22, 0.44, cBirchMark, 0, 0.7, 0));
  parts.push(createBoxWithColor(0.45, 0.18, 0.22, cBirchMark, 0, 1.5, 0.12));
  parts.push(createBoxWithColor(0.22, 0.22, 0.45, cBirchMark, -0.12, 2.3, 0));
  parts.push(createBoxWithColor(0.45, 0.18, 0.45, cBirchMark, 0, 3.1, 0));

  // Tán lá Bạch Dương Minecraft (Slender cubic canopy)
  // Tầng 1: Tán dưới (y = 2.8 -> 3.5)
  parts.push(createBoxWithColor(1.8, 0.7, 1.8, cBirchLeaf, 0, 3.15, 0));
  // Tầng 2: Tán giữa (y = 3.5 -> 4.3)
  parts.push(createBoxWithColor(2.0, 0.8, 2.0, cBirchLeaf, 0, 3.9, 0));
  parts.push(createBoxWithColor(2.1, 0.6, 1.2, cBirchLeafLight, 0, 3.9, 0));
  parts.push(createBoxWithColor(1.2, 0.6, 2.1, cBirchLeafLight, 0, 3.9, 0));
  // Tầng 3: Tán trên (y = 4.3 -> 5.0)
  parts.push(createBoxWithColor(1.5, 0.7, 1.5, cBirchLeaf, 0, 4.65, 0));
  // Tầng 4: Đỉnh ngọn lá (y = 5.0 -> 5.6)
  parts.push(createBoxWithColor(0.9, 0.6, 0.9, cBirchLeafLight, 0, 5.3, 0));

  return mergeGeometries(parts);
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
