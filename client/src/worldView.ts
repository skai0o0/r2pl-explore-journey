import * as THREE from "three";
import { SCHOOLS, type WorldObject } from "../../shared/gameplay/gameConfig.ts";
import type {
  ProjectionReplica,
  PublicKnowledgeReplica,
} from "../../shared/protocol/replica.ts";
import {
  CHUNK_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../../shared/world/constants.ts";
import {
  chunkCoordinatesForId,
  chunkId,
  tileIndex,
} from "../../shared/world/coordinates.ts";
import { ModelAssetLoader } from "./assetLoader.ts";
import {
  type AssetMount,
  cacheInteractiveObject,
  type InteractiveObject,
  mountModelAsset,
  pickInteractiveObject,
  setChestLidRotation,
  tintModelFactionMaterials,
} from "./assetPipeline.ts";
import {
  getChestModelUrl,
  getHqModelUrl,
  getLandmarkModelUrl,
  getUniStopModelUrl,
  MODEL_ASSETS,
  MODEL_PLACEMENTS,
  type ModelPlacement,
} from "./assetRegistry.ts";
import { LandscapeEffects } from "./landscape.ts";
import { MapCameraInput } from "./mapCameraInput.ts";
import { createProceduralBuilding } from "./proceduralBuildings.ts";
import { SCENE_PRESENTATION as P } from "./scenePresentation.ts";
import { TerrainBiomes } from "./terrainBiomes.ts";
import {
  TerrainChunks,
  type TerrainLayer,
  terrainPointFromRay,
  writeTerrainTile,
} from "./terrainChunks.ts";
import {
  footprintDiscovered,
  objectDisplayName,
} from "./ui/playerPresentation.ts";

export interface PickedTile {
  readonly x: number;
  readonly z: number;
  readonly index: number;
  readonly chunk: number;
  readonly local: number;
}

export type CameraMode = "isometric" | "top-down";

export type DevCreditState = "unknown" | "free" | "affordable" | "insufficient";

export function deriveDevCreditState(
  balance: string | undefined,
  cost: string | undefined,
): DevCreditState {
  if (!balance?.match(/^\d+$/) || !cost?.match(/^\d+$/)) return "unknown";
  const required = BigInt(cost);
  if (required === 0n) return "free";
  return BigInt(balance) >= required ? "affordable" : "insufficient";
}

const CAMERA_DISTANCE = 1_800;
const CAMERA_FAR = 4_000;
const SUN_OFFSET: readonly [number, number, number] = [-240, 120, 360];
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

export function configureMapCamera(
  camera: THREE.OrthographicCamera,
  mode: CameraMode,
  centerX: number,
  centerZ: number,
  span: number,
  aspect: number,
  azimuth: number = P.camera.azimuth,
  elevation: number = P.camera.elevation,
): void {
  const targetX = centerX - WORLD_WIDTH / 2;
  const targetY = WORLD_HEIGHT / 2 - centerZ;
  camera.left = (-span * aspect) / 2;
  camera.right = (span * aspect) / 2;
  camera.top = span / 2;
  camera.bottom = -span / 2;
  camera.near = 0.1;
  camera.far = CAMERA_FAR;

  if (mode === "isometric") {
    camera.up.set(0, 0, 1);
    const tilt = Math.max(
      P.camera.minElevation,
      Math.min(P.camera.maxElevation, elevation),
    );
    const distance = CAMERA_DISTANCE * Math.hypot(Math.SQRT1_2, 0.62);
    camera.position.set(
      targetX + distance * Math.cos(tilt) * Math.cos(azimuth),
      targetY + distance * Math.cos(tilt) * Math.sin(azimuth),
      distance * Math.sin(tilt),
    );
  } else {
    const rotation = azimuth - P.camera.azimuth;
    camera.up.set(-Math.sin(rotation), Math.cos(rotation), 0);
    camera.position.set(targetX, targetY, CAMERA_DISTANCE);
  }
  camera.lookAt(targetX, targetY, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export function groundPointFromNdc(
  camera: THREE.Camera,
  ndc: THREE.Vector2,
  raycaster = new THREE.Raycaster(),
  target = new THREE.Vector3(),
): THREE.Vector3 | undefined {
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(GROUND_PLANE, target) ?? undefined;
}

export type ProjectedTileQuad = readonly [
  THREE.Vector2,
  THREE.Vector2,
  THREE.Vector2,
  THREE.Vector2,
];

export function projectTileCorners(
  camera: THREE.Camera,
  x: number,
  z: number,
): ProjectedTileQuad {
  const left = x - WORLD_WIDTH / 2;
  const right = left + 1;
  const top = WORLD_HEIGHT / 2 - z;
  const bottom = top - 1;
  const project = (worldX: number, worldY: number): THREE.Vector2 => {
    const point = new THREE.Vector3(worldX, worldY, 0).project(camera);
    return new THREE.Vector2(point.x, point.y);
  };
  return [
    project(left, top),
    project(right, top),
    project(right, bottom),
    project(left, bottom),
  ];
}

export type TileIndicatorKind =
  | "hover"
  | "selected"
  | "pending"
  | "reveal"
  | "reject";

const TILE_INDICATOR_KINDS = [
  "hover",
  "selected",
  "pending",
  "reveal",
  "reject",
] as const satisfies readonly TileIndicatorKind[];

const TILE_INDICATOR_STYLE: Record<
  TileIndicatorKind,
  { readonly color: number; readonly opacity: number }
> = {
  hover: { color: 0xe8fff6, opacity: 0.18 },
  selected: { color: 0x5fffd0, opacity: 0.3 },
  pending: { color: 0xffcc66, opacity: 0.34 },
  reveal: { color: 0x7dffad, opacity: 0.5 },
  reject: { color: 0xff657a, opacity: 0.5 },
};

export class TileIndicatorLayer {
  readonly object = new THREE.Group();
  readonly #fillGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #outlineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(-0.5, -0.5, 0),
  ]);
  readonly #states = new Map<TileIndicatorKind, THREE.Group>();
  readonly #materials: THREE.Material[] = [];

  readonly #heightAt: (x: number, z: number) => number;
  constructor(heightAt: (x: number, z: number) => number = () => 0) {
    this.#heightAt = heightAt;
    for (const kind of TILE_INDICATOR_KINDS) {
      const style = TILE_INDICATOR_STYLE[kind];
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: style.color,
        depthTest: false,
        depthWrite: false,
        opacity: style.opacity,
        side: THREE.DoubleSide,
        transparent: true,
      });
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: style.color,
        depthTest: false,
        depthWrite: false,
        opacity: Math.min(1, style.opacity + 0.55),
        transparent: true,
      });
      this.#materials.push(fillMaterial, outlineMaterial);
      const state = new THREE.Group();
      const fill = new THREE.Mesh(this.#fillGeometry, fillMaterial);
      const outline = new THREE.LineLoop(
        this.#outlineGeometry,
        outlineMaterial,
      );
      fill.renderOrder = 100;
      outline.renderOrder = 101;
      state.add(fill, outline);
      state.visible = false;
      this.object.add(state);
      this.#states.set(kind, state);
    }
  }

  setTile(
    kind: TileIndicatorKind,
    tile: { readonly x: number; readonly z: number } | undefined,
  ): void {
    const state = this.#states.get(kind);
    if (!state) return;
    state.visible = tile !== undefined;
    if (!tile) return;
    state.position.set(
      tile.x + 0.5 - WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2 - tile.z - 0.5,
      this.#heightAt(tile.x, tile.z),
    );
  }

  dispose(): void {
    this.#fillGeometry.dispose();
    this.#outlineGeometry.dispose();
    for (const material of this.#materials) material.dispose();
    this.#materials.length = 0;
    this.#states.clear();
    this.object.clear();
  }
}

export interface WorldMarker {
  readonly x: number;
  readonly z: number;
  readonly title: string;
  readonly detail: string;
  readonly kind: string;
  readonly id?: string;
  readonly color?: string;
  readonly schoolSlot?: number | undefined;
}
const markers: readonly WorldMarker[] = [
  {
    x: 215,
    z: 235,
    title: "DAWN HQ",
    detail: "Public headquarters Â· fixture",
    kind: "dawn",
  },
  {
    x: 785,
    z: 765,
    title: "DUSK HQ",
    detail: "Public headquarters Â· fixture",
    kind: "dusk",
  },
  {
    x: 510,
    z: 485,
    title: "LANDMARK",
    detail: "Visual placeholder Â· no rewards",
    kind: "landmark",
  },
] as const;

export class WorldView {
  readonly #host: HTMLElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  #sun: THREE.DirectionalLight | undefined;
  readonly #camera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    0.1,
    CAMERA_FAR,
  );
  readonly #raycaster = new THREE.Raycaster();
  readonly #ndc = new THREE.Vector2();
  readonly #groundPoint = new THREE.Vector3();
  readonly #projectedPoint = new THREE.Vector3();
  readonly #chunkLayers = new Map<number, TerrainLayer>();
  readonly #terrain: TerrainBiomes;
  readonly #terrainChunks: TerrainChunks;
  readonly #rootBaseHeights = new WeakMap<THREE.Object3D, number>();
  #renderFrame: number | undefined;
  #renderWidth = 0;
  #renderHeight = 0;
  readonly #markerElements: HTMLElement[] = [];
  readonly #markers: WorldMarker[];
  #baseCatalog: readonly WorldObject[];
  #privateCatalog: readonly WorldObject[] = [];
  #previewCatalog = new Map<string, WorldObject>();
  #catalog: readonly WorldObject[];
  readonly #solvedLandmarks = new Set<string>();
  readonly #isDev: boolean;
  #selectedObject: string | undefined;
  #hoveredObject: string | undefined;
  #privateDigest = "";
  #beaconDigest = "";
  #sharedDigest = "";
  #objectById = new Map<string, WorldObject>();
  readonly #assetMounts: AssetMount[] = [];
  readonly #interactiveObjects: InteractiveObject[] = [];
  readonly #hitIntersections: THREE.Intersection[] = [];
  readonly #privateObjectIds = new Set<string>();
  readonly #privateMounts = new Map<string, AssetMount>();
  readonly #assetLoader = new ModelAssetLoader();
  #hoverFrame: number | undefined;
  #hoverPointer: { x: number; y: number } | undefined;
  #disposed = false;
  readonly #objectTooltip: HTMLElement;
  readonly #assetRoots: THREE.Group[] = [];
  readonly #privateObjects = new THREE.Group();
  readonly #beacons = new THREE.Group();
  readonly #unistopMeshes = new Map<string, THREE.Object3D>();
  readonly #chestMeshes = new Map<string, THREE.Object3D>();
  readonly #landscape: LandscapeEffects;
  #shared: ReadonlyMap<number, readonly number[]> = new Map();
  #replica: ProjectionReplica | undefined;
  #publicKnowledge: PublicKnowledgeReplica | undefined;
  readonly #editorPreview = new THREE.Group();
  readonly #tileIndicators = new TileIndicatorLayer((x, z) =>
    this.#terrain.getTerrainHeight(x, z),
  );
  readonly #selection: HTMLElement;
  readonly #hoverElement: HTMLElement;
  readonly #pendingElement: HTMLElement;
  readonly #revealElement: HTMLElement;
  readonly #rejectElement: HTMLElement;
  readonly #onPick: (tile: PickedTile, object?: WorldObject) => boolean | void;
  readonly #onViewChange: () => void;
  readonly #onHover: ((tile: PickedTile | undefined) => void) | undefined;
  readonly #onPickObject: ((object: WorldObject) => void) | undefined;

  #schoolSlot = 0;
  #cameraMode: CameraMode = "isometric";
  #span = 275;
  #centerX: number = SCHOOLS[0].hq.x;
  #centerZ: number = SCHOOLS[0].hq.z;
  readonly #cameraInput = new MapCameraInput();
  #azimuth: number = P.camera.azimuth;
  #elevation: number = P.camera.elevation;
  #selected: PickedTile | undefined;
  #hovered: PickedTile | undefined;
  #pendingTile: PickedTile | undefined;
  #animId: number | undefined;
  #revealTimer: number | undefined;
  #rejectTimer: number | undefined;

  constructor(
    host: HTMLElement,
    onPick: (tile: PickedTile, object?: WorldObject) => boolean | void,
    onViewChange: () => void,
    onHover?: (tile: PickedTile | undefined) => void,
    layout: {
      readonly markers?: readonly WorldMarker[];
      readonly placements?: readonly ModelPlacement[];
      readonly objects?: readonly WorldObject[];
      readonly onPickObject?: (object: WorldObject) => void;
    } = {},
  ) {
    this.#host = host;
    this.#onPick = onPick;
    this.#onViewChange = onViewChange;
    this.#onHover = onHover;
    this.#onPickObject = layout.onPickObject;
    this.#markers = [...(layout.markers ?? markers)];
    this.#baseCatalog = layout.objects ?? [];
    this.#terrain = new TerrainBiomes(this.#baseCatalog);
    this.#catalog = [...this.#baseCatalog];
    this.#objectById = new Map(this.#catalog.map((o) => [o.id, o]));
    this.#isDev = document.body.dataset.debug === "true";

    this.#renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = P.exposure;
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    host.append(this.#renderer.domElement);
    this.#scene.background = new THREE.Color(P.background);
    this.#scene.fog = new THREE.FogExp2(
      P.distanceFog.color,
      P.distanceFog.density,
    );

    const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.35);
    this.#scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x9bbbd1, 0x183c35, 0.95);
    hemiLight.position.set(0, 0, 300);
    this.#scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xf5d7ab, 2.35);
    dirLight.position.set(...SUN_OFFSET);
    dirLight.target.position.set(0, 0, 0);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 1500;
    dirLight.shadow.bias = -0.0003;
    dirLight.shadow.normalBias = 0.12;
    dirLight.shadow.radius = 3;
    this.#sun = dirLight;
    this.#scene.add(dirLight);
    this.#scene.add(dirLight.target);

    const fillLight = new THREE.DirectionalLight(0xa2d2eb, 0.85);
    fillLight.position.set(150, -180, 220);
    this.#scene.add(fillLight);

    this.#terrainChunks = new TerrainChunks(this.#terrain, this.#render);
    this.#scene.add(this.#terrainChunks.group);
    this.#landscape = new LandscapeEffects(
      layout.objects ?? [],
      this.#render,
      this.#terrain,
      this.#terrainChunks.discoveryFog,
    );
    this.#scene.add(this.#landscape.group);
    this.#scene.add(this.#privateObjects);
    this.#scene.add(this.#beacons);
    this.#scene.add(this.#editorPreview);
    const assetLoader = this.#assetLoader;
    for (const placement of layout.placements ?? MODEL_PLACEMENTS) {
      const assetRoot = new THREE.Group();
      this.#scene.add(assetRoot);
      this.#assetRoots.push(assetRoot);

      const schoolId =
        placement.asset === "hq"
          ? placement.id.replace(/^hq-/, "").replace(/-hq$/, "").toLowerCase()
          : undefined;
      const school = schoolId
        ? SCHOOLS.find((s) => s.id === schoolId)
        : undefined;

      const modelUrl =
        placement.asset === "hq" && schoolId
          ? getHqModelUrl(schoolId)
          : placement.asset === "landmark"
            ? getLandmarkModelUrl(placement.id)
            : MODEL_ASSETS[placement.asset].url;

      const footprint = layout.objects?.find((o) => o.id === placement.id);
      const fallback = createProceduralBuilding(
        placement.asset,
        school?.color ?? 0xc3a5eb,
        footprint,
      );
      const mount = mountModelAsset(
        assetRoot,
        assetLoader,
        modelUrl,
        placement,
        fallback,
        this.#render,
        {
          skipIfUnavailable: true,
          colorHex: school?.color,
          onRootChanged: (root) => {
            if (footprint) this.#cacheObject(footprint, root);
          },
        },
      );
      this.#assetMounts.push(mount);
    }

    for (const o of layout.objects ?? []) {
      if (o.kind !== "unistop" && o.kind !== "chest") continue;
      const baseColor =
        o.tier === "aspire"
          ? 0x72d8ca
          : o.tier === "nitro"
            ? 0xef7253
            : 0xa084ff;
      const color =
        o.kind === "unistop" &&
        o.ownerSchoolSlot !== null &&
        o.ownerSchoolSlot !== undefined
          ? (SCHOOLS[o.ownerSchoolSlot]?.color ?? baseColor)
          : baseColor;
      const fallback = createProceduralBuilding(o.kind, color, o, o.tier);
      if (o.kind === "unistop") {
        fallback.visible = this.#isDev || this.isObjectDiscovered(o);
        this.#unistopMeshes.set(o.id, fallback);
      } else {
        fallback.visible = this.#isDev || this.#privateObjectIds.has(o.id);
        this.#chestMeshes.set(o.id, fallback);
      }

      const modelUrl =
        o.kind === "unistop" && o.tier
          ? getUniStopModelUrl(o.tier)
          : o.kind === "chest" && o.tier
            ? getChestModelUrl(o.tier)
            : "";
      if (modelUrl) {
        const mount = mountModelAsset(
          this.#scene,
          assetLoader,
          modelUrl,
          {
            id: o.id,
            asset: "hq",
            worldX: o.x,
            worldZ: o.z,
            scale: 1,
            rotationZ: 0,
          },
          fallback,
          this.#render,
          {
            skipIfUnavailable: true,
            colorHex: color,
            isChestOpened: false,
            targetSpan: o.kind === "chest" ? 2.5 : 10,
            onRootChanged: (root) => this.#cacheObject(o, root),
          },
        );
        mount.ready.then((status) => {
          if (status === "loaded" && mount.model) {
            const isVis =
              o.kind === "unistop"
                ? this.#isDev || this.isObjectDiscovered(o)
                : this.#isDev || this.#privateObjectIds.has(o.id);
            mount.model.visible = isVis;
            if (o.kind === "unistop") {
              this.#unistopMeshes.set(o.id, mount.model);
            } else {
              this.#chestMeshes.set(o.id, mount.model);
            }
            this.#render();
          }
        });
        this.#assetMounts.push(mount);
      } else {
        fallback.position.set(o.x - 500, 500 - o.z, 0.12);
        this.#scene.add(fallback);
        this.#cacheObject(o, fallback);
      }
    }
    for (const marker of this.#markers) {
      const element = document.createElement("div");
      element.className = `map-marker ${marker.kind}`;
      if (marker.color) element.style.color = marker.color;
      const glyph = document.createElement("span");
      glyph.className = "marker-glyph";
      glyph.textContent =
        marker.kind === "landmark"
          ? "◆"
          : marker.kind === "unistop"
            ? "◉"
            : marker.kind === "chest"
              ? "▣"
              : "⌂";
      const copy = document.createElement("span");
      copy.className = "marker-copy";
      const title = document.createElement("b");
      title.textContent = marker.title;
      const detail = document.createElement("small");
      detail.textContent = this.#isDev ? marker.detail : "";
      detail.hidden = !this.#isDev;
      element.dataset.markerId = marker.id ?? marker.title;
      copy.append(title, detail);
      element.append(glyph, copy);
      element.addEventListener("click", (e) => {
        e.stopPropagation();
        const obj = this.#displayObject(marker.id ?? marker.title);
        if (obj) this.#pickObject(obj);
      });
      host.append(element);
      this.#markerElements.push(element);
    }

    this.#hoverElement = document.createElement("div");
    this.#hoverElement.className = "tile-hover";
    this.#hoverElement.hidden = true;
    host.append(this.#hoverElement);
    this.#objectTooltip = document.createElement("div");
    this.#objectTooltip.className = "object-hover-tooltip";
    this.#objectTooltip.hidden = true;
    this.#objectTooltip.style.pointerEvents = "none";
    host.append(this.#objectTooltip);

    this.#selection = document.createElement("div");
    this.#selection.className = "tile-selection";
    this.#selection.hidden = true;
    host.append(this.#selection);

    this.#pendingElement = document.createElement("div");
    this.#pendingElement.className = "tile-pending";
    this.#pendingElement.innerHTML =
      '<span class="pending-radar"></span><span class="pending-tag">ĐANG XỬ LÝ</span>';
    this.#pendingElement.hidden = true;
    host.append(this.#pendingElement);

    this.#revealElement = document.createElement("div");
    this.#revealElement.className = "tile-reveal";
    this.#revealElement.setAttribute("aria-hidden", "true");
    this.#revealElement.innerHTML =
      '<span class="reveal-ring"></span><span class="reveal-spark">✦</span>';
    this.#revealElement.hidden = true;
    host.append(this.#revealElement);

    this.#rejectElement = document.createElement("div");
    this.#rejectElement.className = "tile-reject";
    this.#rejectElement.innerHTML =
      '<span class="reject-ring"></span><span class="reject-tag">REJECTED</span>';
    this.#rejectElement.hidden = true;
    host.append(this.#rejectElement);

    for (const overlay of [
      this.#hoverElement,
      this.#selection,
      this.#pendingElement,
      this.#revealElement,
      this.#rejectElement,
    ]) {
      overlay.style.pointerEvents = "none";
    }
    this.#scene.add(this.#tileIndicators.object);

    host.addEventListener("pointerdown", this.#pointerDown);
    host.addEventListener("pointermove", this.#pointerMove);
    host.addEventListener("pointerup", this.#pointerUp);
    host.addEventListener("pointercancel", this.#pointerUp);
    host.addEventListener("lostpointercapture", this.#pointerUp);
    host.addEventListener("contextmenu", this.#contextMenu);
    host.addEventListener("pointerleave", this.#pointerLeave);
    host.addEventListener("wheel", this.#wheel, { passive: false });
    window.addEventListener("resize", this.#render);
    this.#render();
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearObjectHover();
    this.#interactiveObjects.length = 0;
    this.#objectTooltip.remove();
    this.#host.removeEventListener("pointerdown", this.#pointerDown);
    this.#host.removeEventListener("pointermove", this.#pointerMove);
    this.#host.removeEventListener("pointerup", this.#pointerUp);
    this.#host.removeEventListener("pointercancel", this.#pointerUp);
    this.#host.removeEventListener("lostpointercapture", this.#pointerUp);
    this.#host.removeEventListener("contextmenu", this.#contextMenu);
    this.#host.removeEventListener("pointerleave", this.#pointerLeave);
    this.#host.removeEventListener("wheel", this.#wheel);
    window.removeEventListener("resize", this.#render);
    window.clearTimeout(this.#revealTimer);
    window.clearTimeout(this.#rejectTimer);
    this.#landscape.dispose();
    this.#terrainChunks.dispose();
    if (this.#renderFrame !== undefined)
      cancelAnimationFrame(this.#renderFrame);
    if (this.#animId !== undefined) cancelAnimationFrame(this.#animId);
    this.#scene.remove(this.#tileIndicators.object);
    this.#tileIndicators.dispose();
    for (const mount of this.#assetMounts) mount.dispose();
    for (const mount of this.#privateMounts.values()) mount.dispose();
    this.#privateMounts.clear();
    this.#assetMounts.length = 0;
    for (const root of this.#assetRoots) this.#scene.remove(root);
    this.#assetRoots.length = 0;
  }

  get cameraMode(): CameraMode {
    return this.#cameraMode;
  }

  rotateCamera(angle: number, tilt = 0): void {
    this.#clearObjectHover();
    this.#azimuth = Math.atan2(
      Math.sin(this.#azimuth + angle),
      Math.cos(this.#azimuth + angle),
    );
    this.#elevation = Math.max(
      P.camera.minElevation,
      Math.min(P.camera.maxElevation, this.#elevation + tilt),
    );
    this.#render();
    this.#onViewChange();
  }

  resetCamera(): void {
    this.#clearObjectHover();
    this.#azimuth = P.camera.azimuth;
    this.#elevation = P.camera.elevation;
    this.#cameraMode = "isometric";
    this.#render();
    this.#onViewChange();
  }

  toggleCameraMode(): CameraMode {
    this.#clearObjectHover();
    this.#cameraMode =
      this.#cameraMode === "isometric" ? "top-down" : "isometric";
    this.#render();
    this.#onViewChange();
    return this.#cameraMode;
  }

  setBeacons(
    beacons: readonly {
      id: string;
      holder: number | null;
      target: number;
      solved?: boolean;
    }[],
  ): void {
    const digest = JSON.stringify(beacons);
    if (digest === this.#beaconDigest) return;
    this.#beaconDigest = digest;
    for (const child of [...this.#beacons.children]) {
      this.#beacons.remove(child);
      this.#disposeGroup(child);
    }
    this.#solvedLandmarks.clear();
    for (const beacon of beacons) {
      if (beacon.solved) this.#solvedLandmarks.add(beacon.id);
      const index = this.#markers.findIndex((m) => m.id === beacon.id),
        marker = this.#markers[index];
      if (!marker) continue;
      const title = this.#markerElements[index]?.querySelector("b");
      const landmark = this.#catalog.find((o) => o.id === beacon.id);
      if (title && landmark)
        title.textContent = objectDisplayName(landmark, !!beacon.solved);
      const detail = this.#markerElements[index]?.querySelector("small");
      if (detail)
        detail.textContent =
          (beacon.holder === null
            ? "Chưa thắp Đèn Hiệu"
            : SCHOOLS[beacon.holder]!.shortName + " giữ Đèn Hiệu") +
          " · " +
          beacon.target +
          " Tinh Thể";
      if (beacon.holder === null) continue;
      const color = new THREE.Color(SCHOOLS[beacon.holder]!.color);
      const beam = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.65, P.beacon.height, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: color.clone().lerp(new THREE.Color(0xffffff), 0.55),
          transparent: true,
          opacity: P.beacon.coreOpacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const aura = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 2.1, P.beacon.height, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: P.beacon.auraOpacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(7, 13, 40),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      for (const part of [core, aura]) {
        part.rotation.x = Math.PI / 2;
        part.position.z = P.beacon.height / 2;
      }
      halo.position.z = 0.2;
      beam.add(core, aura, halo);
      beam.position.set(
        marker.x - 500,
        500 - marker.z,
        this.#terrain.getTerrainHeight(marker.x, marker.z),
      );
      beam.userData.landmarkId = beacon.id;
      beam.userData.beacon = true;
      this.#beacons.add(beam);
    }
    this.#render();
  }
  updateObjects(objects: readonly WorldObject[]): void {
    const signature = (list: readonly WorldObject[]) =>
      JSON.stringify(list.map((o) => [o.id, o.kind, o.name, o.tier]));
    const rebuild = signature(objects) !== signature(this.#baseCatalog);
    this.#baseCatalog = objects;
    this.#catalog = [...objects, ...this.#privateCatalog];
    this.#objectById = new Map(this.#catalog.map((o) => [o.id, o]));
    if (rebuild) this.#replacePublicMeshes(objects);
    this.#moveObjectRoots();
    for (const o of objects) {
      if (o.kind === "unistop") {
        const mesh = this.#unistopMeshes.get(o.id);
        if (mesh) {
          const baseColor =
            o.tier === "aspire"
              ? 0x72d8ca
              : o.tier === "nitro"
                ? 0xef7253
                : 0xa084ff;
          const color =
            o.ownerSchoolSlot !== null && o.ownerSchoolSlot !== undefined
              ? (SCHOOLS[o.ownerSchoolSlot]?.color ?? baseColor)
              : baseColor;
          if (
            mesh instanceof THREE.Mesh &&
            mesh.material &&
            "color" in mesh.material
          ) {
            (mesh.material as THREE.MeshBasicMaterial).color.set(color);
          }
          tintModelFactionMaterials(mesh, color);
        }
      }
    }
    this.#render();
  }
  /** Reconcile published additions/deletions without resetting player or fog state. */
  #replacePublicMeshes(objects: readonly WorldObject[]): void {
    for (const mount of this.#assetMounts) mount.dispose();
    this.#assetMounts.length = 0;
    for (const root of this.#assetRoots) this.#scene.remove(root);
    this.#assetRoots.length = 0;
    for (let i = this.#interactiveObjects.length - 1; i >= 0; i--)
      if (!this.#privateObjectIds.has(this.#interactiveObjects[i]!.id))
        this.#interactiveObjects.splice(i, 1);
    this.#unistopMeshes.clear();
    for (let i = this.#markers.length - 1; i >= 0; i--)
      if (this.#markers[i]!.kind !== "chest") {
        this.#markerElements[i]!.remove();
        this.#markerElements.splice(i, 1);
        this.#markers.splice(i, 1);
      }
    for (const o of objects) {
      if (o.kind === "chest") continue;
      const school =
        o.schoolSlot === undefined ? undefined : SCHOOLS[o.schoolSlot];
      const color =
        school?.color ?? (o.kind === "landmark" ? "#c3a5eb" : "#72d8ca");
      const url =
        o.kind === "hq"
          ? getHqModelUrl(school!.id)
          : o.kind === "landmark"
            ? getLandmarkModelUrl(o.id)
            : getUniStopModelUrl(o.tier!);
      const mount = mountModelAsset(
        this.#scene,
        this.#assetLoader,
        url,
        {
          id: o.id,
          asset: o.kind === "landmark" ? "landmark" : "hq",
          worldX: o.x,
          worldZ: o.z,
          scale: 1,
          rotationZ: 0,
        },
        createProceduralBuilding(o.kind, color, o, o.tier),
        this.#render,
        {
          skipIfUnavailable: true,
          colorHex: color,
          targetSpan: Math.max(o.width, o.height),
          onRootChanged: (root) => this.#cacheObject(o, root),
        },
      );
      this.#assetMounts.push(mount);
      const marker: WorldMarker = {
        id: o.id,
        kind: o.kind,
        x: o.x,
        z: o.z,
        title: objectDisplayName(o, false),
        detail: "",
        ...(school ? { color: school.color, schoolSlot: school.slot } : {}),
      };
      const element = document.createElement("div"),
        glyph = document.createElement("span"),
        copy = document.createElement("span"),
        title = document.createElement("b");
      element.className = `map-marker ${o.kind}`;
      element.dataset.markerId = o.id;
      if (school) element.style.color = school.color;
      glyph.className = "marker-glyph";
      glyph.textContent =
        o.kind === "hq" ? "⌂" : o.kind === "landmark" ? "◆" : "◉";
      copy.className = "marker-copy";
      title.textContent = marker.title;
      copy.append(title);
      element.append(glyph, copy);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const current = this.#displayObject(o.id);
        if (current) this.#pickObject(current);
      });
      this.#markers.push(marker);
      this.#markerElements.push(element);
      this.#host.append(element);
    }
    if (this.#selectedObject && !this.#objectById.has(this.#selectedObject))
      this.#selectedObject = undefined;
  }
  setChestOpen(id: string, open = true): void {
    const mesh = this.#chestMeshes.get(id);
    if (mesh) {
      setChestLidRotation(mesh, open);
      const object = this.#displayObject(id);
      if (object) this.#cacheObject(object, mesh);
      this.#render();
    }
  }
  setMistBrightness(mult: number): void {
    this.#terrainChunks.setMistBrightness(mult);
  }
  #disposeGroup(group: THREE.Object3D): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }
  setEditorPreview(objects: readonly WorldObject[]): void {
    this.#previewCatalog = new Map(objects.map((o) => [o.id, o]));
    this.#moveObjectRoots();
    for (const child of [...this.#editorPreview.children]) {
      this.#editorPreview.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    for (const o of objects) {
      const invalid =
        o.x - o.width / 2 < 0 ||
        o.z - o.height / 2 < 0 ||
        o.x + o.width / 2 > 1000 ||
        o.z + o.height / 2 > 1000 ||
        objects.some(
          (p) =>
            p.id !== o.id &&
            Math.abs(p.x - o.x) < (p.width + o.width) / 2 &&
            Math.abs(p.z - o.z) < (p.height + o.height) / 2,
        );
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(o.width, o.height, 1),
        new THREE.MeshBasicMaterial({
          color: invalid ? 0xff6655 : 0x6ce2dc,
          wireframe: true,
          depthTest: false,
          transparent: true,
          opacity: P.beacon.coreOpacity,
        }),
      );
      mesh.position.set(
        o.x - 500,
        500 - o.z,
        this.#terrain.getTerrainHeight(o.x, o.z) + 1.5,
      );
      this.#editorPreview.add(mesh);
    }
    this.#render();
  }
  isObjectDiscovered(object: WorldObject): boolean {
    return footprintDiscovered(object, this.#replica);
  }
  setSelectedObject(id: string | undefined): void {
    if (this.#selectedObject === id) return;
    this.#selectedObject = id;
    this.#render();
  }
  setHoveredObject(id: string | undefined): void {
    if (this.#hoveredObject === id) return;
    this.#hoveredObject = id;
    this.#render();
  }
  setPrivateObjects(objects: readonly WorldObject[]): void {
    const digest = JSON.stringify(objects);
    if (digest === this.#privateDigest) return;
    this.#privateDigest = digest;
    for (const mount of this.#privateMounts.values()) mount.dispose();
    this.#privateMounts.clear();
    for (let i = this.#interactiveObjects.length - 1; i >= 0; i--)
      if (this.#privateObjectIds.has(this.#interactiveObjects[i]!.id))
        this.#interactiveObjects.splice(i, 1);
    for (const id of this.#privateObjectIds) this.#chestMeshes.delete(id);
    this.#privateObjectIds.clear();
    this.#clearObjectHover();
    this.#privateCatalog = objects;
    this.#catalog = [...this.#baseCatalog, ...objects];
    this.#objectById = new Map(this.#catalog.map((o) => [o.id, o]));
    this.#syncTerrainLayout();
    for (const child of [...this.#privateObjects.children]) {
      this.#privateObjects.remove(child);
      this.#disposeGroup(child);
    }
    for (let i = this.#markers.length - 1; i >= 0; i--)
      if (this.#markers[i]!.kind === "chest") {
        this.#chestMeshes.delete(this.#markers[i]!.id!);
        this.#markerElements[i]!.remove();
        this.#markerElements.splice(i, 1);
        this.#markers.splice(i, 1);
      }
    for (const o of objects) {
      const mesh = createProceduralBuilding(
        "chest",
        o.tier === "nitro"
          ? 0xef5934
          : o.tier === "predator"
            ? 0x00c6d7
            : 0xc8d0d8,
        o,
        o.tier,
      );
      this.#privateObjectIds.add(o.id);
      const mount = mountModelAsset(
        this.#privateObjects,
        this.#assetLoader,
        getChestModelUrl(o.tier ?? "aspire"),
        {
          id: o.id,
          asset: "hq",
          worldX: o.x,
          worldZ: o.z,
          scale: 1,
          rotationZ: 0,
        },
        mesh,
        this.#render,
        {
          skipIfUnavailable: true,
          targetSpan: 2.5,
          isChestOpened: false,
          onRootChanged: (root) => this.#cacheObject(o, root),
        },
      );
      this.#privateMounts.set(o.id, mount);
      const marker: WorldMarker = {
        id: o.id,
        kind: "chest",
        x: o.x,
        z: o.z,
        title: objectDisplayName(o),
        detail: "",
      };
      this.#markers.push(marker);
      const element = document.createElement("div");
      element.className = "map-marker chest";
      element.dataset.markerId = o.id;
      const glyph = document.createElement("span");
      glyph.className = "marker-glyph";
      glyph.textContent = "▣";
      const copy = document.createElement("span");
      copy.className = "marker-copy";
      const title = document.createElement("b");
      title.textContent = marker.title;
      copy.append(title);
      element.append(glyph, copy);
      element.addEventListener("click", (e) => {
        e.stopPropagation();
        const object = this.#displayObject(o.id);
        if (object) this.#pickObject(object);
      });
      this.#host.append(element);
      this.#markerElements.push(element);
    }
    this.#render();
  }
  get viewState(): { x: number; z: number; span: number } {
    return { x: this.#centerX, z: this.#centerZ, span: this.#span };
  }

  setSchool(slot: number): void {
    this.#clearObjectHover();
    this.#schoolSlot = slot;
    this.#selectedObject = undefined;
    this.#hoveredObject = undefined;
    this.#solvedLandmarks.clear();
    this.#beaconDigest = "";
    this.#sharedDigest = "";
    this.#replica = undefined;
    this.#selected = undefined;
    this.#hovered = undefined;
    this.#pendingTile = undefined;
    this.#onHover?.(undefined);
    window.clearTimeout(this.#revealTimer);
    window.clearTimeout(this.#rejectTimer);
    this.#revealElement.hidden = true;
    this.#revealElement.classList.remove("animating");
    this.#rejectElement.hidden = true;
    this.#rejectElement.classList.remove("animating");
    for (const kind of TILE_INDICATOR_KINDS) {
      this.#tileIndicators.setTile(kind, undefined);
    }
    this.#terrainChunks.resetKnowledge();
    for (const layer of this.#terrainChunks.layers.values())
      layer.mesh.material.userData.accent.value.set(SCHOOLS[slot]!.accent);
    this.#chunkLayers.clear();
    this.#shared = new Map();
    this.#replica = undefined;
    this.#landscape.setSchool(slot);
    const hq = SCHOOLS[slot]?.hq;
    this.focus(hq?.x ?? 500, hq?.z ?? 500, 120);
  }

  focus(x: number, z: number, span = this.#span): void {
    this.#clearObjectHover();
    if (this.#animId !== undefined) {
      cancelAnimationFrame(this.#animId);
      this.#animId = undefined;
    }
    this.#centerX = x;
    this.#centerZ = z;
    this.#span = Math.max(P.camera.minSpan, Math.min(P.camera.maxSpan, span));
    this.#clampCenter();
    this.#render();
    this.#onViewChange();
  }

  animateFocus(
    targetX: number,
    targetZ: number,
    targetSpan = this.#span,
    durationMs = 380,
  ): void {
    this.#clearObjectHover();
    if (this.#animId !== undefined) {
      cancelAnimationFrame(this.#animId);
      this.#animId = undefined;
    }
    const startX = this.#centerX;
    const startZ = this.#centerZ;
    const startSpan = this.#span;
    const clampedTargetX = Math.max(0, Math.min(999, targetX));
    const clampedTargetZ = Math.max(0, Math.min(999, targetZ));
    const clampedTargetSpan = Math.max(
      P.camera.minSpan,
      Math.min(P.camera.maxSpan, targetSpan),
    );
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const ease =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - (-2 * progress + 2) ** 2 / 2;
      this.#centerX = startX + (clampedTargetX - startX) * ease;
      this.#centerZ = startZ + (clampedTargetZ - startZ) * ease;
      this.#span = startSpan + (clampedTargetSpan - startSpan) * ease;
      this.#clampCenter();
      this.#render();
      this.#onViewChange();
      if (progress < 1) {
        this.#animId = requestAnimationFrame(step);
      } else {
        this.#animId = undefined;
      }
    };
    this.#animId = requestAnimationFrame(step);
  }

  zoom(factor: number): void {
    this.animateFocus(this.#centerX, this.#centerZ, this.#span * factor, 240);
  }

  select(tile: PickedTile | undefined): void {
    this.#selected = tile;
    this.#render();
  }

  setPending(tile: PickedTile | undefined): void {
    this.#pendingTile = tile;
    this.#render();
  }

  projectToScreen(x: number, z: number): { x: number; y: number } | undefined {
    const worldX = x - 500 + 0.5;
    const worldY = 500 - z - 0.5;
    const point = new THREE.Vector3(
      worldX,
      worldY,
      this.#terrain.getTerrainHeight(x, z) + 0.15,
    ).project(this.#camera);
    const rect = this.#host.getBoundingClientRect();
    const screenX = rect.left + ((point.x + 1) / 2) * rect.width;
    const screenY = rect.top + ((-point.y + 1) / 2) * rect.height;
    return { x: screenX, y: screenY };
  }

  playReveal(x: number, z: number, slot: number): void {
    window.clearTimeout(this.#revealTimer);
    this.#revealElement.hidden = false;
    this.#revealElement.dataset.school = slot === 0 ? "dawn" : "dusk";
    const pos = this.#position(x + 0.5, z + 0.5);
    Object.assign(this.#revealElement.style, pos);
    this.#revealElement.classList.remove("animating");
    void this.#revealElement.offsetWidth;
    this.#revealElement.classList.add("animating");
    this.#tileIndicators.setTile("reveal", { x, z });
    this.#render();
    this.#revealTimer = window.setTimeout(() => {
      this.#revealElement.hidden = true;
      this.#revealElement.classList.remove("animating");
      this.#tileIndicators.setTile("reveal", undefined);
      this.#render();
    }, 750);
  }

  playReject(x: number, z: number): void {
    window.clearTimeout(this.#rejectTimer);
    this.#rejectElement.hidden = false;
    const pos = this.#position(x + 0.5, z + 0.5);
    Object.assign(this.#rejectElement.style, pos);
    this.#rejectElement.classList.remove("animating");
    void this.#rejectElement.offsetWidth;
    this.#rejectElement.classList.add("animating");
    this.#tileIndicators.setTile("reject", { x, z });
    this.#render();
    this.#rejectTimer = window.setTimeout(() => {
      this.#rejectElement.hidden = true;
      this.#rejectElement.classList.remove("animating");
      this.#tileIndicators.setTile("reject", undefined);
      this.#render();
    }, 750);
  }

  visibleChunkIds(extra?: number): number[] {
    const corners = [
      this.#pointFromNdc(-1, -1),
      this.#pointFromNdc(-1, 1),
      this.#pointFromNdc(1, -1),
      this.#pointFromNdc(1, 1),
    ].filter((point): point is { x: number; z: number } => point !== undefined);
    const xs = corners.map((point) => point.x);
    const zs = corners.map((point) => point.z);
    const minWorldX = Math.min(...xs) - CHUNK_SIZE;
    const maxWorldX = Math.max(...xs) + CHUNK_SIZE;
    const minWorldZ = Math.min(...zs) - CHUNK_SIZE;
    const maxWorldZ = Math.max(...zs) + CHUNK_SIZE;
    const maxChunkX = Math.ceil(WORLD_WIDTH / CHUNK_SIZE) - 1;
    const maxChunkZ = Math.ceil(WORLD_HEIGHT / CHUNK_SIZE) - 1;
    const minX = Math.max(0, Math.floor(minWorldX / CHUNK_SIZE));
    const maxX = Math.min(maxChunkX, Math.floor(maxWorldX / CHUNK_SIZE));
    const minZ = Math.max(0, Math.floor(minWorldZ / CHUNK_SIZE));
    const maxZ = Math.min(maxChunkZ, Math.floor(maxWorldZ / CHUNK_SIZE));
    const ids: number[] = [];
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) ids.push(chunkId(x, z));
    }
    ids.sort((a, b) => {
      const aa = chunkCoordinatesForId(a);
      const bb = chunkCoordinatesForId(b);
      const da =
        (aa.chunkX * 64 + 32 - this.#centerX) ** 2 +
        (aa.chunkZ * 64 + 32 - this.#centerZ) ** 2;
      const db =
        (bb.chunkX * 64 + 32 - this.#centerX) ** 2 +
        (bb.chunkZ * 64 + 32 - this.#centerZ) ** 2;
      return da - db;
    });
    if (extra !== undefined) ids.unshift(extra);
    return [...new Set(ids)].slice(0, 48).sort((a, b) => a - b);
  }

  paintChunk(id: number, replica: ProjectionReplica): void {
    this.#terrainChunks.discoveryFog.paintChunk(id, replica);
    this.#replica = replica;
    const layer = this.#layer(id);
    for (let local = 0; local < 4096; local++) {
      this.#paintLocal(layer.pixels, id, local, replica);
    }
    layer.texture.needsUpdate = true;
    // Only the four neighboring chunk borders can change their edge flags.
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    for (let i = 0; i < 64; i++) {
      this.#refreshTerrainTile(chunkX * 64 - 1, chunkZ * 64 + i, replica);
      this.#refreshTerrainTile(chunkX * 64 + 64, chunkZ * 64 + i, replica);
      this.#refreshTerrainTile(chunkX * 64 + i, chunkZ * 64 - 1, replica);
      this.#refreshTerrainTile(chunkX * 64 + i, chunkZ * 64 + 64, replica);
    }
    this.#landscape.rebuild(id, replica);
    this.#render();
  }

  paintPublicChunk(
    id: number,
    replica: ProjectionReplica,
    publicKnowledge: PublicKnowledgeReplica,
  ): void {
    this.#publicKnowledge = publicKnowledge;
    if (!this.#chunkLayers.has(id) || !replica.hasChunk(id)) return;
    this.paintChunk(id, replica);
  }
  paintPublicTile(
    id: number,
    local: number,
    replica: ProjectionReplica,
    publicKnowledge: PublicKnowledgeReplica,
  ): void {
    this.#publicKnowledge = publicKnowledge;
    this.paintTile(id, local, replica);
  }

  paintTile(id: number, local: number, replica: ProjectionReplica): void {
    this.#terrainChunks.discoveryFog.paintTile(id, local, replica);
    this.#replica = replica;
    const layer = this.#layer(id);
    this.#paintLocal(layer.pixels, id, local, replica);
    layer.texture.needsUpdate = true;
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    const x = chunkX * 64 + (local % 64),
      z = chunkZ * 64 + Math.floor(local / 64);
    for (const [dx, dz] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      this.#refreshTerrainTile(x + dx!, z + dz!, replica);
    this.#landscape.rebuildSoon(id, replica);
    this.#render();
  }

  /**
   * Private party view of Shared Knowledge tiles (tile index -> school pair).
   * Equal school-color blend, then the same terrain tint as owned knowledge.
   */
  setSharedTiles(tiles: ReadonlyMap<number, readonly number[]>): void {
    const digest = JSON.stringify([...tiles]);
    if (digest === this.#sharedDigest) return;
    this.#sharedDigest = digest;
    const touched = new Set<number>();
    for (const index of [...this.#shared.keys(), ...tiles.keys()])
      touched.add(
        chunkId(
          Math.floor((index % WORLD_WIDTH) / 64),
          Math.floor(index / WORLD_WIDTH / 64),
        ),
      );
    this.#shared = new Map(tiles);
    const replica = this.#replica;
    if (!replica) return;
    for (const id of touched) {
      const layer = this.#chunkLayers.get(id);
      if (!layer) continue;
      for (let local = 0; local < 4096; local++)
        this.#paintLocal(layer.pixels, id, local, replica);
      layer.texture.needsUpdate = true;
    }
    this.#render();
  }

  /** Compass helper: nearest owned/HQ tile to a world object. */
  nearestOwned(target: WorldObject) {
    return this.#landscape.nearestOwned(target);
  }

  #paintLocal(
    pixels: Uint8Array,
    id: number,
    local: number,
    replica: ProjectionReplica,
  ): void {
    writeTerrainTile(
      pixels,
      id,
      local,
      replica,
      this.#terrain,
      this.#schoolSlot,
      this.#shared,
      this.#publicKnowledge,
    );
  }

  #refreshTerrainTile(x: number, z: number, replica: ProjectionReplica): void {
    if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_HEIGHT) return;
    const id = chunkId(Math.floor(x / 64), Math.floor(z / 64));
    const layer = this.#chunkLayers.get(id);
    if (!layer || !replica.hasChunk(id)) return;
    this.#paintLocal(layer.pixels, id, (z % 64) * 64 + (x % 64), replica);
    layer.texture.needsUpdate = true;
  }

  #layer(id: number): TerrainLayer {
    const layer = this.#terrainChunks.layers.get(id);
    if (!layer) throw new RangeError("Unknown terrain chunk");
    this.#chunkLayers.set(id, layer);
    return layer;
  }

  #clampCenter(): void {
    this.#centerX = Math.max(0, Math.min(999, this.#centerX));
    this.#centerZ = Math.max(0, Math.min(999, this.#centerZ));
  }

  #displayObject(id: string): WorldObject | undefined {
    return this.#previewCatalog.get(id) ?? this.#objectById.get(id);
  }

  #cacheObject(object: WorldObject, root: THREE.Object3D): void {
    if (this.#disposed) return;
    const current = this.#displayObject(object.id) ?? object;
    root.position.x = current.x - WORLD_WIDTH / 2;
    root.position.y = WORLD_HEIGHT / 2 - current.z;
    const baseHeight = this.#rootBaseHeights.get(root) ?? root.position.z;
    this.#rootBaseHeights.set(root, baseHeight);
    root.position.z =
      baseHeight + this.#terrain.getTerrainHeight(current.x, current.z);
    const entry = cacheInteractiveObject(current, root);
    const index = this.#interactiveObjects.findIndex(
      (e) => e.id === current.id,
    );
    if (index < 0) this.#interactiveObjects.push(entry);
    else this.#interactiveObjects[index] = entry;
    if (current.kind === "unistop") this.#unistopMeshes.set(current.id, root);
    if (current.kind === "chest") this.#chestMeshes.set(current.id, root);
    this.#render();
  }

  #syncTerrainLayout(): void {
    const objects = [
      ...this.#baseCatalog,
      ...this.#privateCatalog,
      ...this.#previewCatalog.values(),
    ];
    if (this.#terrain.setObjects(objects)) {
      this.#terrainChunks.invalidate();
      this.#landscape.setObjects(objects);
    }
  }

  #moveObjectRoots(): void {
    this.#syncTerrainLayout();
    this.#clearObjectHover();
    for (const entry of this.#interactiveObjects) {
      const object = this.#displayObject(entry.id);
      if (!object) continue;
      const x = object.x - WORLD_WIDTH / 2;
      const y = WORLD_HEIGHT / 2 - object.z;
      if (
        entry.objectRoot.position.x !== x ||
        entry.objectRoot.position.y !== y ||
        entry.objectRoot.position.z !==
          (this.#rootBaseHeights.get(entry.objectRoot) ?? 0) +
            this.#terrain.getTerrainHeight(object.x, object.z)
      )
        this.#cacheObject(object, entry.objectRoot);
      const marker = this.#markers.find((m) => m.id === object.id);
      if (marker) Object.assign(marker, { x: object.x, z: object.z });
    }
  }

  #interactiveEligible = (entry: InteractiveObject): boolean => {
    const object = this.#displayObject(entry.id);
    if (!object) return false;
    if (this.#isDev) return true;
    if (entry.kind === "chest") return this.#privateObjectIds.has(entry.id);
    return entry.kind !== "unistop" || this.isObjectDiscovered(object);
  };

  #pickBuilding(): WorldObject | undefined {
    const entry = pickInteractiveObject(
      this.#raycaster,
      this.#interactiveObjects,
      this.#interactiveEligible,
      this.#hitIntersections,
    );
    return entry ? this.#displayObject(entry.id) : undefined;
  }

  #pickObject(object: WorldObject): void {
    const x = Math.floor(object.x),
      z = Math.floor(object.z);
    const tile: PickedTile = {
      x,
      z,
      index: tileIndex(x, z),
      chunk: chunkId(Math.floor(x / 64), Math.floor(z / 64)),
      local: (z % 64) * 64 + (x % 64),
    };
    this.select(tile);
    this.setSelectedObject(object.id);
    if (this.#onPick(tile, object) !== false) this.#onPickObject?.(object);
  }

  #setObjectHover(object: WorldObject | undefined, x = 0, y = 0): void {
    const changed = this.#hoveredObject !== object?.id;
    this.#hoveredObject = object?.id;
    this.#host.style.cursor = object ? "pointer" : "";
    this.#objectTooltip.hidden = !object;
    if (object) {
      this.#objectTooltip.textContent = objectDisplayName(
        object,
        object.kind !== "landmark" || this.#solvedLandmarks.has(object.id),
      );
      this.#objectTooltip.style.transform = `translate3d(${x + 12}px, ${y + 12}px, 0)`;
    }
    if (changed) this.#render();
  }

  #clearObjectHover(): void {
    if (this.#hoverFrame !== undefined) cancelAnimationFrame(this.#hoverFrame);
    this.#hoverFrame = undefined;
    this.#hoverPointer = undefined;
    this.#setObjectHover(undefined);
  }

  #pointerRay(clientX: number, clientY: number): DOMRect {
    const rect = this.#host.getBoundingClientRect();
    this.#syncCamera(rect.width, rect.height);
    this.#ndc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2,
    );
    this.#raycaster.setFromCamera(this.#ndc, this.#camera);
    return rect;
  }

  #groundFromRay(): { x: number; z: number } {
    const hit = terrainPointFromRay(
      this.#raycaster.ray,
      this.#terrain,
      this.#groundPoint,
    );
    return hit
      ? { x: hit.x + WORLD_WIDTH / 2, z: WORLD_HEIGHT / 2 - hit.y }
      : { x: Number.NaN, z: Number.NaN };
  }

  #point(clientX: number, clientY: number): { x: number; z: number } {
    this.#pointerRay(clientX, clientY);
    const hit = this.#raycaster.ray.intersectPlane(
      GROUND_PLANE,
      this.#groundPoint,
    );
    return hit
      ? { x: hit.x + WORLD_WIDTH / 2, z: WORLD_HEIGHT / 2 - hit.y }
      : { x: Number.NaN, z: Number.NaN };
  }

  #pointFromNdc(
    ndcX: number,
    ndcY: number,
  ): { x: number; z: number } | undefined {
    this.#ndc.set(ndcX, ndcY);
    const hit = groundPointFromNdc(
      this.#camera,
      this.#ndc,
      this.#raycaster,
      this.#groundPoint,
    );
    if (!hit) return undefined;
    return {
      x: hit.x + WORLD_WIDTH / 2,
      z: WORLD_HEIGHT / 2 - hit.y,
    };
  }

  #position(x: number, z: number): { left: string; top: string } {
    this.#projectedPoint
      .set(
        x - WORLD_WIDTH / 2,
        WORLD_HEIGHT / 2 - z,
        this.#terrain.getTerrainHeight(x, z),
      )
      .project(this.#camera);
    return {
      left: `${(this.#projectedPoint.x * 0.5 + 0.5) * 100}%`,
      top: `${(-this.#projectedPoint.y * 0.5 + 0.5) * 100}%`,
    };
  }

  #pointerDown = (event: PointerEvent): void => {
    if ((event.target as Element).closest(".map-marker")) return;
    if (![0, 1, 2].includes(event.button)) return;
    event.preventDefault();
    this.#clearObjectHover();
    this.#host.focus({ preventScroll: true });
    this.#host.setPointerCapture(event.pointerId);
    this.#cameraInput.begin({
      pointerId: event.pointerId,
      button: event.button,
      x: event.clientX,
      y: event.clientY,
    });
    if (this.#animId !== undefined) {
      cancelAnimationFrame(this.#animId);
      this.#animId = undefined;
    }
  };

  #pointerMove = (event: PointerEvent): void => {
    if (this.#cameraInput.active) {
      const motion = this.#cameraInput.move({
        pointerId: event.pointerId,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
      });
      if (!motion) return;
      if (motion.kind === "orbit") {
        this.rotateCamera(
          -motion.dx * P.camera.orbitSensitivity,
          motion.dy * P.camera.orbitSensitivity,
        );
        return;
      }
      const before = this.#point(motion.from.x, motion.from.y);
      if (motion.kind === "gesture") {
        this.#span = Math.max(
          P.camera.minSpan,
          Math.min(P.camera.maxSpan, this.#span * motion.zoom),
        );
        this.#azimuth = Math.atan2(
          Math.sin(this.#azimuth - motion.rotation),
          Math.cos(this.#azimuth - motion.rotation),
        );
      }
      const after = this.#point(motion.to.x, motion.to.y);
      this.#centerX += before.x - after.x;
      this.#centerZ += before.z - after.z;
      this.#clampCenter();
      this.#render();
      this.#onViewChange();
      return;
    }

    // Coalesce input bursts into one bounded broad/narrow-phase pass per frame.
    this.#hoverPointer = { x: event.clientX, y: event.clientY };
    if (this.#hoverFrame === undefined) {
      this.#hoverFrame = requestAnimationFrame(this.#hoverAtPointer);
    }
  };

  #hoverAtPointer = (): void => {
    this.#hoverFrame = undefined;
    const pointer = this.#hoverPointer;
    if (!pointer || this.#cameraInput.active || this.#disposed) return;
    const rect = this.#pointerRay(pointer.x, pointer.y);
    const object = this.#pickBuilding();
    this.#setObjectHover(object, pointer.x - rect.left, pointer.y - rect.top);
    if (object) {
      if (this.#hovered) {
        this.#hovered = undefined;
        this.#onHover?.(undefined);
        this.#render();
      }
      return;
    }
    const point = this.#groundFromRay();
    const x = Math.floor(point.x);
    const z = Math.floor(point.z);
    if (x >= 0 && z >= 0 && x < WORLD_WIDTH && z < WORLD_HEIGHT) {
      const tile: PickedTile = {
        x,
        z,
        index: tileIndex(x, z),
        chunk: chunkId(Math.floor(x / 64), Math.floor(z / 64)),
        local: (z % 64) * 64 + (x % 64),
      };
      if (this.#hovered?.index === tile.index) return;
      this.#hovered = tile;
      this.#onHover?.(tile);
      this.#render();
    } else {
      this.#hovered = undefined;
      this.#hoverElement.hidden = true;
      this.#onHover?.(undefined);
      this.#render();
    }
  };

  #pointerUp = (event: PointerEvent): void => {
    const click = this.#cameraInput.end(
      {
        pointerId: event.pointerId,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
      },
      event.type !== "pointerup",
    );
    if (this.#host.hasPointerCapture(event.pointerId))
      this.#host.releasePointerCapture(event.pointerId);
    if (!click) return;

    this.#pointerRay(event.clientX, event.clientY);
    const object = this.#pickBuilding();
    if (object) {
      this.#pickObject(object);
      return;
    }
    const point = this.#groundFromRay();
    const x = Math.floor(point.x);
    const z = Math.floor(point.z);
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(z) ||
      x < 0 ||
      z < 0 ||
      x >= WORLD_WIDTH ||
      z >= WORLD_HEIGHT
    )
      return;
    const tile: PickedTile = {
      x,
      z,
      index: tileIndex(x, z),
      chunk: chunkId(Math.floor(x / 64), Math.floor(z / 64)),
      local: (z % 64) * 64 + (x % 64),
    };
    this.setSelectedObject(undefined);
    this.select(tile);
    this.#onPick(tile);
  };

  #pointerLeave = (): void => {
    this.#clearObjectHover();
    this.#hovered = undefined;
    this.#hoverElement.hidden = true;
    this.#onHover?.(undefined);
    this.#render();
  };

  #wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.#clearObjectHover();
    if (this.#animId !== undefined) {
      cancelAnimationFrame(this.#animId);
      this.#animId = undefined;
    }
    const before = this.#point(event.clientX, event.clientY);
    this.#span = Math.max(
      P.camera.minSpan,
      Math.min(
        P.camera.maxSpan,
        this.#span *
          Math.exp(
            Math.max(
              -240,
              Math.min(
                240,
                event.deltaY *
                  (event.deltaMode === 1
                    ? 16
                    : event.deltaMode === 2
                      ? this.#host.clientHeight
                      : 1),
              ),
            ) * 0.0015,
          ),
      ),
    );
    const after = this.#point(event.clientX, event.clientY);
    this.#centerX += before.x - after.x;
    this.#centerZ += before.z - after.z;
    this.#clampCenter();
    this.#render();
    this.#onViewChange();
  };

  #contextMenu = (event: Event): void => {
    event.preventDefault();
  };

  #updateReticles(): void {
    this.#tileIndicators.setTile("selected", this.#selected);
    this.#tileIndicators.setTile("hover", this.#hovered);
    this.#tileIndicators.setTile("pending", this.#pendingTile);
    // These former flat tile boxes are intentionally label/effect-only now.
    this.#selection.hidden = true;
    this.#hoverElement.hidden = true;

    if (this.#pendingTile) {
      this.#pendingElement.hidden = false;
      Object.assign(
        this.#pendingElement.style,
        this.#position(this.#pendingTile.x + 0.5, this.#pendingTile.z + 0.5),
      );
    } else {
      this.#pendingElement.hidden = true;
    }
  }

  #syncCamera(width: number, height: number): void {
    const aspect = Math.max(1, width) / Math.max(1, height);
    configureMapCamera(
      this.#camera,
      this.#cameraMode,
      this.#centerX,
      this.#centerZ,
      this.#span,
      aspect,
      this.#azimuth,
      this.#elevation,
    );
    this.#host.dataset.cameraAzimuth = String(this.#azimuth);
    this.#host.dataset.cameraElevation = String(this.#elevation);
    this.#host.dataset.cameraMode = this.#cameraMode;
    this.#host.dataset.cameraSpan = String(this.#span);
    const sun = this.#sun;
    if (sun) {
      const tx = this.#centerX - 500;
      const ty = 500 - this.#centerZ;
      sun.target.position.set(tx, ty, 0);
      sun.position.set(tx + SUN_OFFSET[0], ty + SUN_OFFSET[1], SUN_OFFSET[2]);
      const half = Math.min(
        700,
        Math.max(40, this.#span * Math.max(1, aspect)),
      );
      const cam = sun.shadow.camera;
      if (cam.right !== half) {
        cam.left = -half;
        cam.right = half;
        cam.top = half;
        cam.bottom = -half;
        cam.updateProjectionMatrix();
      }
    }
  }

  #render = (): void => {
    if (this.#disposed) return;
    if (this.#renderFrame !== undefined) return;
    this.#renderFrame = requestAnimationFrame(() => {
      this.#renderFrame = undefined;
      this.#draw();
    });
  };

  #draw = (): void => {
    const width = Math.max(2, this.#host.clientWidth);
    const height = Math.max(2, this.#host.clientHeight);
    if (this.#renderWidth !== width || this.#renderHeight !== height) {
      this.#renderWidth = width;
      this.#renderHeight = height;
      this.#renderer.setSize(width, height, false);
    }
    this.#syncCamera(width, height);
    this.#terrainChunks.updateView(this.#camera, this.#span);
    this.#landscape.updateView(this.#camera, this.#span);
    this.#updateReticles();

    for (let index = 0; index < this.#markers.length; index++) {
      const marker = this.#markers[index]!;
      const element = this.#markerElements[index]!;
      const object = this.#objectById.get(marker.id ?? "");
      const supply = marker.kind === "unistop" || marker.kind === "chest";
      this.#projectedPoint
        .set(marker.x - WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - marker.z, 0)
        .project(this.#camera);
      const point = this.#projectedPoint;
      const visible =
        Math.abs(point.x) <= 1 &&
        Math.abs(point.y) <= 1 &&
        Math.abs(point.z) <= 1 &&
        !(supply && this.#span > 320) &&
        (marker.kind !== "unistop" ||
          this.#isDev ||
          (!!object && this.isObjectDiscovered(object)));
      element.hidden = !visible;
      if (!visible) continue;
      element.style.left = "0";
      element.style.top = "0";
      element.style.transform = `translate3d(${(point.x * 0.5 + 0.5) * width}px, ${(-point.y * 0.5 + 0.5) * height}px, 0) translate(-50%, -100%)`;
      element.classList.toggle("icon-only", supply && this.#span > 160);
      element.classList.toggle(
        "is-emphasized",
        marker.id === this.#selectedObject || marker.id === this.#hoveredObject,
      );
    }
    for (const [id, mesh] of this.#unistopMeshes) {
      const object = this.#objectById.get(id);
      mesh.visible =
        this.#isDev || (!!object && this.isObjectDiscovered(object));
    }
    for (const [id, mesh] of this.#chestMeshes) {
      mesh.visible = this.#isDev || this.#privateObjectIds.has(id);
    }
    this.#renderer.render(this.#scene, this.#camera);
  };
}
