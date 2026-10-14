import * as THREE from "three";
import {
  LANDMARKS,
  SCHOOLS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import type { ProjectionReplica } from "../../shared/protocol/replica.ts";
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
  mountModelAsset,
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
import { createProceduralBuilding } from "./proceduralBuildings.ts";
import {
  footprintDiscovered,
  layoutMapLabels,
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
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

export function configureMapCamera(
  camera: THREE.OrthographicCamera,
  mode: CameraMode,
  centerX: number,
  centerZ: number,
  span: number,
  aspect: number,
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
    camera.position.set(
      targetX + CAMERA_DISTANCE * 0.5,
      targetY - CAMERA_DISTANCE * 0.5,
      CAMERA_DISTANCE * 0.62,
    );
  } else {
    camera.up.set(0, 1, 0);
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

  constructor() {
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
      0,
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

function baseTerrainColor(x: number, z: number): [number, number, number] {
  const wave =
    Math.sin(x * 0.018) * 0.32 +
    Math.cos(z * 0.023) * 0.3 +
    Math.sin((x + z) * 0.009) * 0.27 +
    Math.cos((x - z) * 0.014) * 0.18;
  const grain = (((x * 73856093) ^ (z * 19349663)) >>> 0) % 17;
  const water = wave < -0.55;
  const road = x % 128 < 2 || z % 128 < 2;
  if (water) return [18 + grain, 72 + grain, 104 + grain];
  if (road) return [66 + grain, 84 + grain, 82 + grain];
  return [32 + grain, 76 + grain, 58 + grain];
}

/** Soft tileable cloud alpha map for the animated fog-of-war mist. */
function mistTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const x = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = Math.abs(Math.sin(i * 78.233) * 12345.6789) % 1;
    const r = 18 + ((i * 37) % 40);
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(
          x * size + ox,
          y * size + oy,
          0,
          x * size + ox,
          y * size + oy,
          r,
        );
        g.addColorStop(0, "rgba(190,215,225,0.35)");
        g.addColorStop(1, "rgba(190,215,225,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x * size + ox - r, y * size + oy - r, r * 2, r * 2);
      }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Soft glow at every school HQ (school colour) and Landmark (lilac). */
const CLEARINGS: readonly {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly color: [number, number, number];
}[] = [
  ...SCHOOLS.map((s) => ({
    x: s.hq.x,
    z: s.hq.z,
    r: 22,
    color: hexRgb(s.accent),
  })),
  ...LANDMARKS.map((l) => ({
    x: l.x,
    z: l.z,
    r: 26,
    color: [195, 165, 235] as [number, number, number],
  })),
];

function foggedBaseTerrainPixels(): Uint8Array {
  const pixels = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT * 4);
  for (let z = 0; z < WORLD_HEIGHT; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const mistWave =
        Math.sin(x * 0.012 + z * 0.008) * 0.5 +
        Math.cos(x * 0.007 - z * 0.015) * 0.5;
      const mist = Math.floor(mistWave * 4);
      let r = 8 + mist;
      let g = 20 + mist;
      let b = 27 + mist;

      for (const c of CLEARINGS) {
        if (Math.abs(x - c.x) >= c.r || Math.abs(z - c.z) >= c.r) continue;
        const d = Math.hypot(x - c.x, z - c.z);
        if (d >= c.r) continue;
        const t = Math.max(0, 1 - d / c.r) * 0.85;
        r = Math.round(r * (1 - t) + c.color[0] * t);
        g = Math.round(g * (1 - t) + c.color[1] * t);
        b = Math.round(b * (1 - t) + c.color[2] * t);
      }

      const offset = ((WORLD_HEIGHT - 1 - z) * WORLD_WIDTH + x) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export class WorldView {
  readonly #host: HTMLElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
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
  readonly #chunkLayers = new Map<
    number,
    { pixels: Uint8Array; texture: THREE.DataTexture; mesh: THREE.Mesh }
  >();
  readonly #markerElements: HTMLElement[] = [];
  readonly #markers: WorldMarker[];
  readonly #catalog: readonly WorldObject[];
  readonly #solvedLandmarks = new Set<string>();
  readonly #isDev: boolean;
  #selectedObject: string | undefined;
  #hoveredObject: string | undefined;
  #privateDigest = "";
  readonly #assetMounts: AssetMount[] = [];
  readonly #assetRoots: THREE.Group[] = [];
  readonly #privateObjects = new THREE.Group();
  readonly #beacons = new THREE.Group();
  readonly #unistopMeshes = new Map<string, THREE.Object3D>();
  readonly #chestMeshes = new Map<string, THREE.Object3D>();
  readonly #landscape: LandscapeEffects;
  readonly #mist: THREE.Mesh;
  readonly #mistTexture: THREE.CanvasTexture;
  #shared: ReadonlyMap<number, readonly number[]> = new Map();
  #replica: ProjectionReplica | undefined;
  #tickTimer: number | undefined;
  readonly #editorPreview = new THREE.Group();
  readonly #tileIndicators = new TileIndicatorLayer();
  readonly #selection: HTMLElement;
  readonly #hoverElement: HTMLElement;
  readonly #pendingElement: HTMLElement;
  readonly #revealElement: HTMLElement;
  readonly #rejectElement: HTMLElement;
  readonly #onPick: (tile: PickedTile) => void;
  readonly #onViewChange: () => void;
  readonly #onHover: ((tile: PickedTile | undefined) => void) | undefined;

  #schoolSlot = 0;
  #cameraMode: CameraMode = "isometric";
  #span = 275;
  #centerX: number = SCHOOLS[0].hq.x;
  #centerZ: number = SCHOOLS[0].hq.z;
  #drag:
    | { x: number; y: number; centerX: number; centerZ: number; moved: boolean }
    | undefined;
  #pointers = new Map<number, { x: number; y: number }>();
  #pinchDist = 0;
  #selected: PickedTile | undefined;
  #hovered: PickedTile | undefined;
  #pendingTile: PickedTile | undefined;
  #animId: number | undefined;
  #revealTimer: number | undefined;
  #rejectTimer: number | undefined;

  constructor(
    host: HTMLElement,
    onPick: (tile: PickedTile) => void,
    onViewChange: () => void,
    onHover?: (tile: PickedTile | undefined) => void,
    layout: {
      readonly markers?: readonly WorldMarker[];
      readonly placements?: readonly ModelPlacement[];
      readonly objects?: readonly WorldObject[];
    } = {},
  ) {
    this.#host = host;
    this.#onPick = onPick;
    this.#onViewChange = onViewChange;
    this.#onHover = onHover;
    this.#markers = [...(layout.markers ?? markers)];
    this.#catalog = layout.objects ?? [];
    this.#isDev = document.body.dataset.debug === "true";

    this.#renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.15;
    host.append(this.#renderer.domElement);
    this.#scene.background = new THREE.Color(0x0b1a20);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.15);
    this.#scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.95);
    hemiLight.position.set(0, 0, 300);
    this.#scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfffbe8, 1.6);
    dirLight.position.set(180, -180, 320);
    dirLight.target.position.set(0, 0, 0);
    this.#scene.add(dirLight);
    this.#scene.add(dirLight.target);

    const terrain = new THREE.DataTexture(
      foggedBaseTerrainPixels(),
      WORLD_WIDTH,
      WORLD_HEIGHT,
      THREE.RGBAFormat,
    );
    terrain.magFilter = THREE.NearestFilter;
    terrain.minFilter = THREE.LinearFilter;
    terrain.colorSpace = THREE.SRGBColorSpace;
    terrain.needsUpdate = true;
    this.#scene.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_HEIGHT),
        new THREE.MeshBasicMaterial({ map: terrain }),
      ),
    );

    const gridPoints: number[] = [];
    for (let i = 0; i <= 1000; i += 64) {
      const p = i - 500;
      gridPoints.push(p, -500, 0.02, p, 500, 0.02);
      gridPoints.push(-500, p, 0.02, 500, p, 0.02);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(gridPoints, 3),
    );
    this.#scene.add(
      new THREE.LineSegments(
        gridGeometry,
        new THREE.LineBasicMaterial({
          color: 0xa9d6bd,
          transparent: true,
          opacity: 0.14,
        }),
      ),
    );

    this.#landscape = new LandscapeEffects(layout.objects ?? [], this.#render);
    this.#scene.add(this.#landscape.group);
    this.#mistTexture = mistTexture();
    this.#mist = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_HEIGHT),
      new THREE.MeshBasicMaterial({
        map: this.#mistTexture,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    // Above the fog base, below explored chunk layers (z 0.05): drifts only over unexplored land.
    this.#mist.position.z = 0.03;
    this.#scene.add(this.#mist);
    this.#tickTimer = window.setInterval(this.#tick, 80);
    this.#scene.add(this.#privateObjects);
    this.#scene.add(this.#beacons);
    this.#scene.add(this.#editorPreview);
    const assetLoader = new ModelAssetLoader();
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
        this.#unistopMeshes.set(o.id, fallback);
      } else {
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
          },
        );
        mount.ready.then((status) => {
          if (status === "loaded" && mount.model) {
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
      host.append(element);
      this.#markerElements.push(element);
    }

    this.#hoverElement = document.createElement("div");
    this.#hoverElement.className = "tile-hover";
    this.#hoverElement.hidden = true;
    host.append(this.#hoverElement);

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
    this.#revealElement.innerHTML =
      '<span class="reveal-ring"></span><span class="reveal-spark">âœ¦</span><span class="reveal-tag">KNOWLEDGE REVEALED</span>';
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
    host.addEventListener("pointerleave", this.#pointerLeave);
    host.addEventListener("wheel", this.#wheel, { passive: false });
    window.addEventListener("resize", this.#render);
    this.#render();
  }

  dispose(): void {
    window.clearTimeout(this.#revealTimer);
    window.clearTimeout(this.#rejectTimer);
    window.clearInterval(this.#tickTimer);
    this.#landscape.dispose();
    this.#mistTexture.dispose();
    if (this.#animId !== undefined) cancelAnimationFrame(this.#animId);
    this.#scene.remove(this.#tileIndicators.object);
    this.#tileIndicators.dispose();
    for (const mount of this.#assetMounts) mount.dispose();
    this.#assetMounts.length = 0;
    for (const root of this.#assetRoots) this.#scene.remove(root);
    this.#assetRoots.length = 0;
  }

  get cameraMode(): CameraMode {
    return this.#cameraMode;
  }

  toggleCameraMode(): CameraMode {
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
        new THREE.CylinderGeometry(0.9, 1.6, 150, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: color.clone().lerp(new THREE.Color(0xffffff), 0.55),
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const aura = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 5.2, 150, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.38,
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
        part.position.z = 75;
      }
      halo.position.z = 0.2;
      beam.add(core, aura, halo);
      beam.position.set(marker.x - 500, 500 - marker.z, 0);
      beam.userData.beacon = true;
      this.#beacons.add(beam);
    }
    this.#render();
  }
  updateObjects(objects: readonly WorldObject[]): void {
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
  setChestOpen(id: string, open = true): void {
    const mesh = this.#chestMeshes.get(id);
    if (mesh) {
      setChestLidRotation(mesh, open);
      this.#render();
    }
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
          opacity: 0.9,
        }),
      );
      mesh.position.set(o.x - 500, 500 - o.z, 1.5);
      this.#editorPreview.add(mesh);
    }
    this.#render();
  }
  isObjectDiscovered(object: WorldObject): boolean {
    return footprintDiscovered(object, this.#replica);
  }
  setSelectedObject(id: string | undefined): void {
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
      mesh.position.set(o.x - 500, 500 - o.z, 0.12);
      this.#privateObjects.add(mesh);
      this.#chestMeshes.set(o.id, mesh);
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
      this.#host.append(element);
      this.#markerElements.push(element);
    }
    this.#render();
  }
  get viewState(): { x: number; z: number; span: number } {
    return { x: this.#centerX, z: this.#centerZ, span: this.#span };
  }

  setSchool(slot: number): void {
    this.#schoolSlot = slot;
    this.#selectedObject = undefined;
    this.#hoveredObject = undefined;
    this.#solvedLandmarks.clear();
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
    for (const layer of this.#chunkLayers.values()) {
      this.#scene.remove(layer.mesh);
      layer.texture.dispose();
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
    }
    this.#chunkLayers.clear();
    this.#shared = new Map();
    this.#replica = undefined;
    this.#landscape.setSchool(slot);
    const hq = SCHOOLS[slot]?.hq;
    this.focus(hq?.x ?? 500, hq?.z ?? 500, 120);
  }

  focus(x: number, z: number, span = this.#span): void {
    if (this.#animId !== undefined) {
      cancelAnimationFrame(this.#animId);
      this.#animId = undefined;
    }
    this.#centerX = x;
    this.#centerZ = z;
    this.#span = Math.max(32, Math.min(1000, span));
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
    if (this.#animId !== undefined) {
      cancelAnimationFrame(this.#animId);
      this.#animId = undefined;
    }
    const startX = this.#centerX;
    const startZ = this.#centerZ;
    const startSpan = this.#span;
    const clampedTargetX = Math.max(0, Math.min(999, targetX));
    const clampedTargetZ = Math.max(0, Math.min(999, targetZ));
    const clampedTargetSpan = Math.max(32, Math.min(1000, targetSpan));
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

  select(tile: PickedTile): void {
    this.#selected = tile;
    this.#render();
  }

  setPending(tile: PickedTile | undefined): void {
    this.#pendingTile = tile;
    this.#render();
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
    this.#replica = replica;
    const layer = this.#layer(id);
    for (let local = 0; local < 4096; local++) {
      this.#paintLocal(layer.pixels, id, local, replica);
    }
    layer.texture.needsUpdate = true;
    this.#landscape.rebuild(id, replica);
    this.#render();
  }

  paintTile(id: number, local: number, replica: ProjectionReplica): void {
    this.#replica = replica;
    const layer = this.#layer(id);
    this.#paintLocal(layer.pixels, id, local, replica);
    layer.texture.needsUpdate = true;
    this.#landscape.rebuildSoon(id, replica);
    this.#render();
  }

  /**
   * Private party view of Shared Knowledge tiles (tile index -> school pair).
   * Painted as a two-colour weave so the overlap with the rival is obvious.
   */
  setSharedTiles(tiles: ReadonlyMap<number, readonly number[]>): void {
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
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    const x = chunkX * 64 + (local % 64);
    const z = chunkZ * 64 + Math.floor(local / 64);
    const offset = (63 - Math.floor(local / 64)) * 64 * 4 + (local % 64) * 4;
    if (x >= WORLD_WIDTH || z >= WORLD_HEIGHT) {
      pixels[offset + 3] = 0;
      return;
    }

    const pair = this.#shared.get(z * WORLD_WIDTH + x);
    if (!replica.isDiscovered(id, local) && !pair) {
      // Unexplored tile: transparent so base fog texture shows through
      pixels[offset + 3] = 0;
      return;
    }

    const [tr, tg, tb] = baseTerrainColor(x, z);
    if (pair && pair.length === 2) {
      // Shared Knowledge: checker weave of both school colours.
      const a = parseInt(SCHOOLS[pair[0]!]!.color.slice(1), 16);
      const b = parseInt(SCHOOLS[pair[1]!]!.color.slice(1), 16);
      const color = (x + z) % 2 === 0 ? a : b;
      pixels[offset] = Math.round(tr * 0.25 + ((color >> 16) & 255) * 0.75);
      pixels[offset + 1] = Math.round(tg * 0.25 + ((color >> 8) & 255) * 0.75);
      pixels[offset + 2] = Math.round(tb * 0.25 + (color & 255) * 0.75);
      pixels[offset + 3] = 255;
      return;
    }

    // Discovered tile: fog is cleared!
    const isOwned = (replica.maskAt(id, local) & (1 << this.#schoolSlot)) !== 0;

    if (isOwned) {
      // Differentiate authorized discovered school-owned tiles with vibrant school territory styling!
      const hex = SCHOOLS[this.#schoolSlot]?.color ?? "#8bd9b4";
      const color = parseInt(hex.slice(1), 16);
      pixels[offset] = Math.round(tr * 0.35 + ((color >> 16) & 255) * 0.65);
      pixels[offset + 1] = Math.round(tg * 0.35 + ((color >> 8) & 255) * 0.65);
      pixels[offset + 2] = Math.round(tb * 0.35 + (color & 255) * 0.65);
      pixels[offset + 3] = 255;
    } else {
      // Remembered fog: discovered once but no longer owned. Muted, desaturated terrain.
      const gray = (tr + tg + tb) / 3;
      pixels[offset] = Math.round((tr * 0.4 + gray * 0.6) * 0.62 + 18);
      pixels[offset + 1] = Math.round((tg * 0.4 + gray * 0.6) * 0.62 + 24);
      pixels[offset + 2] = Math.round((tb * 0.4 + gray * 0.6) * 0.62 + 30);
      pixels[offset + 3] = 255;
    }
  }

  #layer(id: number) {
    let layer = this.#chunkLayers.get(id);
    if (layer) return layer;
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    const pixels = new Uint8Array(64 * 64 * 4);
    const texture = new THREE.DataTexture(pixels, 64, 64, THREE.RGBAFormat);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 64),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    mesh.position.set(chunkX * 64 - 500 + 32, 500 - chunkZ * 64 - 32, 0.05);
    this.#scene.add(mesh);
    layer = { pixels, texture, mesh };
    this.#chunkLayers.set(id, layer);
    return layer;
  }

  #clampCenter(): void {
    this.#centerX = Math.max(0, Math.min(999, this.#centerX));
    this.#centerZ = Math.max(0, Math.min(999, this.#centerZ));
  }

  #point(clientX: number, clientY: number): { x: number; z: number } {
    const rect = this.#host.getBoundingClientRect();
    this.#syncCamera(rect.width, rect.height);
    return (
      this.#pointFromNdc(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2,
      ) ?? { x: Number.NaN, z: Number.NaN }
    );
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
      .set(x - WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - z, 0)
      .project(this.#camera);
    return {
      left: `${(this.#projectedPoint.x * 0.5 + 0.5) * 100}%`,
      top: `${(-this.#projectedPoint.y * 0.5 + 0.5) * 100}%`,
    };
  }

  #pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    this.#host.setPointerCapture(event.pointerId);
    this.#pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (this.#animId !== undefined) {
      cancelAnimationFrame(this.#animId);
      this.#animId = undefined;
    }
    if (this.#pointers.size === 1) {
      this.#drag = {
        x: event.clientX,
        y: event.clientY,
        centerX: this.#centerX,
        centerZ: this.#centerZ,
        moved: false,
      };
    } else if (this.#pointers.size === 2) {
      const [p1, p2] = Array.from(this.#pointers.values());
      if (p1 && p2) {
        this.#pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      }
      this.#drag = undefined;
    }
  };

  #pointerMove = (event: PointerEvent): void => {
    if (this.#pointers.has(event.pointerId)) {
      this.#pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }

    if (this.#pointers.size === 2) {
      const [p1, p2] = Array.from(this.#pointers.values());
      if (p1 && p2 && this.#pinchDist > 0) {
        const newDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const factor = this.#pinchDist / Math.max(10, newDist);
        this.#span = Math.max(32, Math.min(1000, this.#span * factor));
        this.#pinchDist = newDist;
        this.#clampCenter();
        this.#render();
        this.#onViewChange();
      }
      return;
    }

    if (this.#drag) {
      const dx = event.clientX - this.#drag.x;
      const dy = event.clientY - this.#drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) this.#drag.moved = true;
      if (!this.#drag.moved) return;
      const start = this.#point(this.#drag.x, this.#drag.y);
      const current = this.#point(event.clientX, event.clientY);
      this.#centerX = this.#drag.centerX + start.x - current.x;
      this.#centerZ = this.#drag.centerZ + start.z - current.z;
      this.#clampCenter();
      this.#render();
      this.#onViewChange();
      return;
    }

    // Hover detection when not dragging
    const point = this.#point(event.clientX, event.clientY);
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
    this.#pointers.delete(event.pointerId);
    const drag = this.#drag;
    this.#drag = undefined;
    if (this.#pointers.size === 0) this.#pinchDist = 0;
    if (!drag || drag.moved) return;

    const point = this.#point(event.clientX, event.clientY);
    const x = Math.floor(point.x);
    const z = Math.floor(point.z);
    if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_HEIGHT) return;
    const tile: PickedTile = {
      x,
      z,
      index: tileIndex(x, z),
      chunk: chunkId(Math.floor(x / 64), Math.floor(z / 64)),
      local: (z % 64) * 64 + (x % 64),
    };
    this.select(tile);
    this.#onPick(tile);
  };

  #pointerLeave = (): void => {
    this.#hovered = undefined;
    this.#hoverElement.hidden = true;
    this.#onHover?.(undefined);
    this.#render();
  };

  #wheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.#animId !== undefined) {
      cancelAnimationFrame(this.#animId);
      this.#animId = undefined;
    }
    const before = this.#point(event.clientX, event.clientY);
    this.#span = Math.max(
      32,
      Math.min(1000, this.#span * (event.deltaY > 0 ? 1.16 : 0.86)),
    );
    const after = this.#point(event.clientX, event.clientY);
    this.#centerX += before.x - after.x;
    this.#centerZ += before.z - after.z;
    this.#clampCenter();
    this.#render();
    this.#onViewChange();
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
    configureMapCamera(
      this.#camera,
      this.#cameraMode,
      this.#centerX,
      this.#centerZ,
      this.#span,
      Math.max(1, width) / Math.max(1, height),
    );
  }

  /** ~12 fps ambient motion: drifting mist and pulsing Beacon beams. */
  #tick = (): void => {
    if (document.hidden) return;
    const t = performance.now() / 1000;
    const map = this.#mistTexture;
    map.offset.set((t * 0.004) % 1, (t * 0.0025) % 1);
    for (const beam of this.#beacons.children) {
      const pulse = 1 + Math.sin(t * 2.4) * 0.08;
      beam.scale.set(pulse, pulse, 1);
    }
    this.#render();
  };

  #render = (): void => {
    const width = Math.max(2, this.#host.clientWidth);
    const height = Math.max(2, this.#host.clientHeight);
    this.#renderer.setSize(width, height, false);
    this.#syncCamera(width, height);
    this.#updateReticles();

    const candidates = this.#markers.map((marker, index) => {
      const element = this.#markerElements[index]!;
      const object = this.#catalog.find((o) => o.id === marker.id);
      const position = this.#position(
        marker.x,
        marker.z + (object?.height ?? 2) / 2,
      );
      Object.assign(element.style, position);
      const copy = element.querySelector<HTMLElement>(".marker-copy");
      const nameWidth =
        Math.min(
          210,
          (copy?.querySelector("b")?.textContent?.length ?? 12) * 7 + 18,
        ) + 30;
      return {
        id: marker.id ?? marker.title,
        kind: marker.kind,
        ownHq: marker.kind === "hq" && marker.schoolSlot === this.#schoolSlot,
        discovered:
          marker.kind === "chest" ||
          (!!object && this.isObjectDiscovered(object)),
        selected: marker.id === this.#selectedObject,
        hovered: marker.id === this.#hoveredObject,
        x: (parseFloat(position.left) * width) / 100,
        y: (parseFloat(position.top) * height) / 100,
        width: nameWidth,
        height: 32,
      };
    });
    const labels = layoutMapLabels(candidates, this.#span, { width, height });
    this.#markers.forEach((marker, index) => {
      const element = this.#markerElements[index]!;
      const visibility = labels.get(marker.id ?? marker.title) ?? "hidden";
      element.hidden = visibility === "hidden";
      element.classList.toggle("icon-only", visibility !== "name");
      element.classList.toggle(
        "is-emphasized",
        marker.id === this.#selectedObject || marker.id === this.#hoveredObject,
      );
    });
    for (const [id, mesh] of this.#unistopMeshes) {
      const object = this.#catalog.find((o) => o.id === id);
      mesh.visible =
        this.#isDev || (!!object && this.isObjectDiscovered(object));
    }
    this.#renderer.render(this.#scene, this.#camera);
  };
}
