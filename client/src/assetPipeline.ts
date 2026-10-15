import * as THREE from "three";
import type { WorldObject } from "../../shared/gameplay/gameConfig.ts";
import type { ModelPlacement } from "./assetRegistry.ts";
import { isModelAvailable } from "./modelManifest.ts";

export interface InteractiveObject {
  readonly id: string;
  readonly kind: WorldObject["kind"];
  readonly objectRoot: THREE.Object3D;
  readonly worldBox: THREE.Box3;
}

/** Call only on mount, replacement, relocation, or a geometry/pose change. */
export function cacheInteractiveObject(
  object: Pick<WorldObject, "id" | "kind">,
  objectRoot: THREE.Object3D,
): InteractiveObject {
  objectRoot.updateWorldMatrix(true, true);
  // Raycaster otherwise computes these lazily on the first hover of a GLB.
  objectRoot.traverse((node) => {
    if (node instanceof THREE.Mesh && !node.geometry.boundingSphere)
      node.geometry.computeBoundingSphere();
    if (
      node instanceof THREE.SkinnedMesh ||
      node instanceof THREE.InstancedMesh
    )
      node.computeBoundingSphere();
  });
  return {
    id: object.id,
    kind: object.kind,
    objectRoot,
    worldBox: new THREE.Box3().setFromObject(objectRoot),
  };
}

function visibleInHierarchy(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}

/** No matrix/bounds rebuild and no terrain/scenery raycasts on the input path. */
export function pickInteractiveObject(
  raycaster: THREE.Raycaster,
  entries: readonly InteractiveObject[],
  eligible: (entry: InteractiveObject) => boolean = () => true,
  intersections: THREE.Intersection[] = [],
): InteractiveObject | undefined {
  let nearest: InteractiveObject | undefined;
  let distance = Infinity;
  for (const entry of entries) {
    if (
      !visibleInHierarchy(entry.objectRoot) ||
      !raycaster.ray.intersectsBox(entry.worldBox) ||
      !eligible(entry)
    )
      continue;
    intersections.length = 0;
    raycaster.intersectObject(entry.objectRoot, true, intersections);
    for (const hit of intersections) {
      if (
        !visibleInHierarchy(hit.object) ||
        !(hit.object instanceof THREE.Mesh)
      )
        continue;
      const material = Array.isArray(hit.object.material)
        ? hit.object.material[hit.face?.materialIndex ?? 0]
        : hit.object.material;
      if (
        !material?.visible ||
        (material.transparent && material.opacity === 0)
      )
        continue;
      if (hit.distance < distance) {
        nearest = entry;
        distance = hit.distance;
      }
      break;
    }
  }
  intersections.length = 0;
  return nearest;
}

export interface ModelInstanceLoader {
  loadInstance(url: string): Promise<THREE.Object3D>;
}

export interface AssetMount {
  readonly ready: Promise<"loaded" | "fallback">;
  readonly model?: THREE.Object3D | undefined;
  /** The mounted fallback or fitted GLB wrapper, never both. */
  readonly objectRoot: THREE.Object3D;
  dispose(): void;
}

export interface MountModelOptions {
  readonly onRootChanged?: ((root: THREE.Object3D) => void) | undefined;
  readonly colorHex?: string | number | undefined;
  readonly skipIfUnavailable?: boolean | undefined;
  readonly isChestOpened?: boolean | undefined;
  readonly targetSpan?: number | undefined;
}

export function getTargetFootprintSpan(
  placement: ModelPlacement | { readonly id?: string; readonly asset?: string },
): number {
  const id = (placement.id ?? "").toLowerCase();
  const asset = (placement.asset ?? "").toLowerCase();
  if (id.includes("chest") || asset === "chest") return 2.5;
  if (id.includes("unistop") || asset === "unistop") return 10;
  if (id.includes("landmark") || asset === "landmark") return 36;
  if (id.includes("hq") || asset === "hq") return 20;
  return 20;
}

export function tunePbrMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.material) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const mat of materials) {
      if (
        mat instanceof THREE.MeshStandardMaterial ||
        ("metalness" in mat && "roughness" in mat)
      ) {
        const standardMat = mat as THREE.MeshStandardMaterial;
        if (!standardMat.envMap && standardMat.metalness > 0.35) {
          standardMat.metalness = 0.25;
          standardMat.roughness = Math.max(0.35, standardMat.roughness);
          standardMat.needsUpdate = true;
        }
      }
    }
  });
}

export function enableShadows(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

export function applyGlbModelPlacement(
  model: THREE.Object3D,
  placement: ModelPlacement,
  targetSpanOverride?: number,
): THREE.Group {
  // 1. glTF is Y-up, WorldView is Z-up: rotate model upright on X-axis (+90 deg)
  model.rotation.set(Math.PI / 2, 0, 0);
  model.position.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  // 2. Measure bounding box after Z-up rotation
  const box = new THREE.Box3().setFromObject(model);
  const currentHorizontalSpan = Math.max(
    box.max.x - box.min.x,
    box.max.y - box.min.y,
  );

  // 3. Scale model so largest horizontal dimension matches target footprint
  const targetSpan = targetSpanOverride ?? getTargetFootprintSpan(placement);
  const scaleFactor =
    currentHorizontalSpan > 0.0001 ? targetSpan / currentHorizontalSpan : 1;
  model.scale.setScalar(scaleFactor);
  model.updateMatrixWorld(true);

  // 4. Center model horizontally and align base at z = 0.12
  box.setFromObject(model);
  const centerX = (box.min.x + box.max.x) / 2;
  const centerY = (box.min.y + box.max.y) / 2;
  const minZ = box.min.z;
  model.position.set(-centerX, -centerY, 0.12 - minZ);

  // 5. Wrap in group positioned at world tile and rotated by placement.rotationZ around Z
  const wrapper = new THREE.Group();
  wrapper.name = `${placement.id}-glb-wrapper`;
  wrapper.position.set(placement.worldX - 500, 500 - placement.worldZ, 0);
  wrapper.rotation.set(0, 0, placement.rotationZ);
  wrapper.add(model);

  return wrapper;
}

export function applyModelPlacement(
  object: THREE.Object3D,
  placement: ModelPlacement,
): void {
  object.position.set(placement.worldX - 500, 500 - placement.worldZ, 0.12);
  object.rotation.set(0, 0, placement.rotationZ);
  // Procedural geometry already uses world units; GLB fitting belongs exclusively
  // to applyGlbModelPlacement. Never multiply a footprint by the legacy asset scale.
  object.scale.setScalar(1);
}

export function tintModelFactionMaterials(
  root: THREE.Object3D,
  colorHex?: string | number,
): void {
  if (colorHex === undefined || colorHex === null) return;
  const color = new THREE.Color(colorHex);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.material) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const mat of materials) {
      if (mat.name && /(?:faction|accent)/i.test(mat.name)) {
        if ("color" in mat && mat.color instanceof THREE.Color) {
          mat.color.copy(color);
        }
      }
    }
  });
}

export function setChestLidRotation(root: THREE.Object3D, open: boolean): void {
  root.traverse((node) => {
    if (
      node.name === "Chest_Lid" ||
      /(?:chest.*lid|lid.*chest)/i.test(node.name)
    ) {
      node.rotation.x = open ? -Math.PI / 3 : 0;
    }
  });
}

export function disposeSceneObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

export function mountModelAsset(
  scene: THREE.Object3D,
  loader: ModelInstanceLoader,
  url: string,
  placement: ModelPlacement,
  fallback: THREE.Object3D,
  onChange: () => void = () => {},
  options?: MountModelOptions,
): AssetMount {
  let disposed = false;
  let model: THREE.Object3D | undefined;
  let fallbackDisposed = false;
  applyModelPlacement(fallback, placement);
  enableShadows(fallback);
  scene.add(fallback);
  options?.onRootChanged?.(fallback);

  if (options?.skipIfUnavailable && !isModelAvailable(url)) {
    return {
      ready: Promise.resolve("fallback" as const),
      objectRoot: fallback,
      dispose(): void {
        if (disposed) return;
        disposed = true;
        scene.remove(fallback);
        if (!fallbackDisposed) disposeSceneObject(fallback);
      },
    };
  }

  const ready = loader.loadInstance(url).then(
    (loaded) => {
      if (disposed) {
        disposeSceneObject(loaded);
        return "fallback" as const;
      }
      tunePbrMaterials(loaded);
      enableShadows(loaded);
      if (options?.colorHex !== undefined) {
        tintModelFactionMaterials(loaded, options.colorHex);
      }
      if (options?.isChestOpened !== undefined) {
        setChestLidRotation(loaded, options.isChestOpened);
      }
      const placed = applyGlbModelPlacement(
        loaded,
        placement,
        options?.targetSpan,
      );
      model = placed;
      scene.remove(fallback);
      disposeSceneObject(fallback);
      fallbackDisposed = true;
      scene.add(placed);
      options?.onRootChanged?.(placed);
      onChange();
      return "loaded" as const;
    },
    () => "fallback" as const,
  );

  return {
    ready,
    get objectRoot() {
      return model ?? fallback;
    },
    get model() {
      return model;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scene.remove(fallback);
      if (!fallbackDisposed) disposeSceneObject(fallback);
      if (model) {
        scene.remove(model);
        disposeSceneObject(model);
      }
    },
  };
}
