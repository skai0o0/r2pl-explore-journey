import * as THREE from "three";
import type { ModelPlacement } from "./assetRegistry.ts";
import { isModelAvailable } from "./modelManifest.ts";

export interface ModelInstanceLoader {
  loadInstance(url: string): Promise<THREE.Object3D>;
}

export interface AssetMount {
  readonly ready: Promise<"loaded" | "fallback">;
  readonly model?: THREE.Object3D | undefined;
  dispose(): void;
}

export interface MountModelOptions {
  readonly colorHex?: string | number | undefined;
  readonly skipIfUnavailable?: boolean | undefined;
  readonly isChestOpened?: boolean | undefined;
}

export function applyModelPlacement(
  object: THREE.Object3D,
  placement: ModelPlacement,
): void {
  object.position.set(placement.worldX - 500, 500 - placement.worldZ, 0.12);
  object.rotation.set(0, 0, placement.rotationZ);
  object.scale.setScalar(placement.scale);
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
    if (node.name === "Chest_Lid" || /(?:chest.*lid|lid.*chest)/i.test(node.name)) {
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
  scene.add(fallback);

  if (options?.skipIfUnavailable && !isModelAvailable(url)) {
    return {
      ready: Promise.resolve("fallback" as const),
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
      model = loaded;
      applyModelPlacement(model, placement);
      if (options?.colorHex !== undefined) {
        tintModelFactionMaterials(model, options.colorHex);
      }
      if (options?.isChestOpened !== undefined) {
        setChestLidRotation(model, options.isChestOpened);
      }
      scene.remove(fallback);
      disposeSceneObject(fallback);
      fallbackDisposed = true;
      scene.add(model);
      onChange();
      return "loaded" as const;
    },
    () => "fallback" as const,
  );

  return {
    ready,
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
