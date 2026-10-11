import * as THREE from "three";
import type { ModelPlacement } from "./assetRegistry.ts";

export interface ModelInstanceLoader {
  loadInstance(url: string): Promise<THREE.Object3D>;
}

export interface AssetMount {
  readonly ready: Promise<"loaded" | "fallback">;
  dispose(): void;
}

export function applyModelPlacement(
  object: THREE.Object3D,
  placement: ModelPlacement,
): void {
  object.position.set(placement.worldX - 500, 500 - placement.worldZ, 0.12);
  object.rotation.set(0, 0, placement.rotationZ);
  object.scale.setScalar(placement.scale);
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
): AssetMount {
  let disposed = false;
  let model: THREE.Object3D | undefined;
  let fallbackDisposed = false;
  applyModelPlacement(fallback, placement);
  scene.add(fallback);

  const ready = loader.loadInstance(url).then(
    (loaded) => {
      if (disposed) {
        disposeSceneObject(loaded);
        return "fallback" as const;
      }
      model = loaded;
      applyModelPlacement(model, placement);
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
