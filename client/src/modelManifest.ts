import { LANDMARKS } from "../../shared/gameplay/gameConfig.ts";

/**
 * Model URL conventions and availability manifest for 3D GLB assets.
 * Standardizes naming conventions and avoids 404 console errors by
 * checking model availability before dispatching GLTFLoader requests.
 */

export const KNOWN_MODELS = new Set<string>([
  "/models/hq.gltf",
  "/models/landmark.gltf",
  "/models/hqs/hcmut_hq.glb",
  "/models/hqs/ou_hq.glb",
  "/models/hqs/dtu_hq.glb",
  "/models/hqs/hpuni_hq.glb",
  "/models/hqs/hsu_hq.glb",
  "/models/hqs/huce_hq.glb",
  "/models/hqs/ntu_hq.glb",
  "/models/hqs/hcmiu_hq.glb",
  ...Array.from({ length: 8 }, (_, index) =>
    `/models/landmarks/mysterios${index + 1}.glb`,
  ),
]);

let manifestLoaded = false;

export function isModelAvailable(url: string): boolean {
  return KNOWN_MODELS.has(url);
}

export function registerAvailableModel(url: string): void {
  KNOWN_MODELS.add(url);
}

export async function fetchModelManifest(): Promise<ReadonlySet<string>> {
  if (typeof window === "undefined" || typeof fetch === "undefined") {
    return KNOWN_MODELS;
  }
  if (manifestLoaded) return KNOWN_MODELS;
  try {
    const res = await fetch("/models/manifest.json", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { models?: string[] };
      if (Array.isArray(data.models)) {
        for (const path of data.models) {
          KNOWN_MODELS.add(path);
        }
      }
    }
  } catch {
    // Keep known defaults if manifest network request is unavailable
  } finally {
    manifestLoaded = true;
  }
  return KNOWN_MODELS;
}

export function getHqModelUrl(schoolId: string): string {
  const normalized = schoolId.toLowerCase().replace(/-hq$/, "");
  return `/models/hqs/${normalized}_hq.glb`;
}

export function getLandmarkModelUrl(landmarkId: string): string {
  const normalizedId = landmarkId.toLowerCase();
  const existingAssetIndex: Readonly<Record<string, number>> = {
    fansipan: 1,
    halong: 2,
    nguhanhson: 3,
    phongnha: 4,
    nuibaden: 5,
    baden: 5,
    thanglong: 7,
    hoangthanhthanglong: 7,
  };
  const landmarkIndex = LANDMARKS.findIndex(
    (landmark) => landmark.id === normalizedId,
  );
  const index =
    existingAssetIndex[normalizedId] ??
    (landmarkIndex >= 0 ? landmarkIndex + 3 : -1);
  if (index < 0) return "/models/landmark.gltf";
  return `/models/landmarks/mysterios${index}.glb`;
}

export function getUniStopModelUrl(tier: string): string {
  return `/models/unistops/unistop_${tier.toLowerCase()}.glb`;
}

export function getChestModelUrl(tier: string): string {
  return `/models/chests/chest_${tier.toLowerCase()}.glb`;
}

