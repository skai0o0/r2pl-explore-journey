export const MODEL_ASSETS = {
  hq: { url: "/models/hq.gltf" },
  landmark: { url: "/models/landmark.gltf" },
} as const;

export type ModelAssetId = keyof typeof MODEL_ASSETS;

export interface ModelPlacement {
  readonly id: string;
  readonly asset: ModelAssetId;
  readonly worldX: number;
  readonly worldZ: number;
  readonly scale: number;
  readonly rotationZ: number;
}

export const MODEL_PLACEMENTS: readonly ModelPlacement[] = [
  {
    id: "dawn-hq",
    asset: "hq",
    worldX: 215,
    worldZ: 235,
    scale: 12,
    rotationZ: 0,
  },
  {
    id: "dusk-hq",
    asset: "hq",
    worldX: 785,
    worldZ: 765,
    scale: 12,
    rotationZ: Math.PI,
  },
  {
    id: "landmark",
    asset: "landmark",
    worldX: 510,
    worldZ: 485,
    scale: 15,
    rotationZ: 0,
  },
] as const;

export {
  getChestModelUrl,
  getHqModelUrl,
  getLandmarkModelUrl,
  getUniStopModelUrl,
  isModelAvailable,
  registerAvailableModel,
} from "./modelManifest.ts";

