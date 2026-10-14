/**
 * Model URL conventions and availability manifest for 3D GLB assets.
 * Standardizes naming conventions and avoids 404 console errors by
 * checking model availability before dispatching GLTFLoader requests.
 */

export const KNOWN_MODELS = new Set<string>([
  "/models/hq.gltf",
  "/models/landmark.gltf",
  "/models/hqs/hcmut_hq.glb",
  "/models/hqs/hcmiu_hq.glb",
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
    const res = await fetch("/models/manifest.json");
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
  let normalized = landmarkId.toLowerCase();
  if (normalized === "thanglong") normalized = "hoangthanhthanglong";
  if (normalized === "cairang") normalized = "chonoicairang";
  return `/models/landmarks/${normalized}.glb`;
}

export function getUniStopModelUrl(tier: string): string {
  return `/models/unistops/unistop_${tier.toLowerCase()}.glb`;
}

export function getChestModelUrl(tier: string): string {
  return `/models/chests/chest_${tier.toLowerCase()}.glb`;
}
