import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export interface SceneTemplateLoader {
  load(url: string): Promise<THREE.Object3D>;
}

class ThreeGltfTemplateLoader implements SceneTemplateLoader {
  readonly #loader = new GLTFLoader();

  async load(url: string): Promise<THREE.Object3D> {
    return (await this.#loader.loadAsync(url)).scene;
  }
}

function cloneMaterial(material: THREE.Material): THREE.Material {
  const clone = material.clone();
  const properties = clone as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(properties)) {
    if (value instanceof THREE.Texture) properties[key] = value.clone();
  }
  return clone;
}

export function cloneSceneInstance(template: THREE.Object3D): THREE.Object3D {
  const instance = template.clone(true);
  instance.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneMaterial)
      : cloneMaterial(object.material);
  });
  return instance;
}

export class ModelAssetLoader {
  readonly #templates = new Map<string, Promise<THREE.Object3D>>();

  private readonly templateLoader: SceneTemplateLoader;

  constructor(
    templateLoader: SceneTemplateLoader = new ThreeGltfTemplateLoader(),
  ) {
    this.templateLoader = templateLoader;
  }

  async loadInstance(url: string): Promise<THREE.Object3D> {
    let pending = this.#templates.get(url);
    if (!pending) {
      pending = this.templateLoader.load(url).catch((error: unknown) => {
        this.#templates.delete(url);
        throw error;
      });
      this.#templates.set(url, pending);
    }
    return cloneSceneInstance(await pending);
  }
}
