import * as THREE from "three";
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

export interface PickedTile {
  readonly x: number;
  readonly z: number;
  readonly index: number;
  readonly chunk: number;
  readonly local: number;
}

const markers = [
  {
    x: 215,
    z: 235,
    title: "DAWN HQ",
    detail: "Public headquarters · fixture",
    kind: "dawn",
  },
  {
    x: 785,
    z: 765,
    title: "DUSK HQ",
    detail: "Public headquarters · fixture",
    kind: "dusk",
  },
  {
    x: 510,
    z: 485,
    title: "LANDMARK",
    detail: "Visual placeholder · no rewards",
    kind: "landmark",
  },
] as const;

function terrainPixels(): Uint8Array {
  const pixels = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT * 4);
  for (let z = 0; z < WORLD_HEIGHT; z++)
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const wave =
        Math.sin(x * 0.018) * 0.32 +
        Math.cos(z * 0.023) * 0.3 +
        Math.sin((x + z) * 0.009) * 0.27 +
        Math.cos((x - z) * 0.014) * 0.18;
      const grain = (((x * 73856093) ^ (z * 19349663)) >>> 0) % 17;
      const offset = ((WORLD_HEIGHT - 1 - z) * WORLD_WIDTH + x) * 4;
      const water = wave < -0.55;
      const road = x % 128 < 2 || z % 128 < 2;
      pixels[offset] = water ? 16 + grain : road ? 36 : 24 + grain;
      pixels[offset + 1] = water ? 48 + grain : road ? 57 : 48 + grain;
      pixels[offset + 2] = water ? 68 + grain : road ? 65 : 53 + grain;
      pixels[offset + 3] = 255;
    }
  return pixels;
}

export class WorldView {
  readonly #host: HTMLElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  readonly #chunkLayers = new Map<
    number,
    { pixels: Uint8Array; texture: THREE.DataTexture; mesh: THREE.Mesh }
  >();
  readonly #markerElements: HTMLElement[] = [];
  readonly #selection: HTMLElement;
  readonly #onPick: (tile: PickedTile) => void;
  readonly #onViewChange: () => void;
  #schoolSlot = 0;
  #span = 275;
  #centerX = 215;
  #centerZ = 235;
  #drag:
    | { x: number; y: number; centerX: number; centerZ: number; moved: boolean }
    | undefined;
  #selected: PickedTile | undefined;

  constructor(
    host: HTMLElement,
    onPick: (tile: PickedTile) => void,
    onViewChange: () => void,
  ) {
    this.#host = host;
    this.#onPick = onPick;
    this.#onViewChange = onViewChange;
    this.#renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.#renderer.domElement);
    this.#scene.background = new THREE.Color(0x0b1a20);
    const terrain = new THREE.DataTexture(
      terrainPixels(),
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
          opacity: 0.13,
        }),
      ),
    );
    for (const marker of markers) {
      const element = document.createElement("div");
      element.className = `map-marker ${marker.kind}`;
      element.innerHTML = `<span class="marker-glyph">${marker.kind === "landmark" ? "◆" : "⌂"}</span><span class="marker-copy"><b>${marker.title}</b><small>${marker.detail}</small></span>`;
      host.append(element);
      this.#markerElements.push(element);
    }
    this.#selection = document.createElement("div");
    this.#selection.className = "tile-selection";
    host.append(this.#selection);
    this.#camera.position.z = 5;
    this.#camera.lookAt(0, 0, 0);
    host.addEventListener("pointerdown", this.#pointerDown);
    host.addEventListener("pointermove", this.#pointerMove);
    host.addEventListener("pointerup", this.#pointerUp);
    host.addEventListener("pointercancel", this.#pointerUp);
    host.addEventListener("wheel", this.#wheel, { passive: false });
    window.addEventListener("resize", this.#render);
    this.#render();
  }

  setSchool(slot: number): void {
    this.#schoolSlot = slot;
    for (const layer of this.#chunkLayers.values()) {
      this.#scene.remove(layer.mesh);
      layer.texture.dispose();
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
    }
    this.#chunkLayers.clear();
    this.focus(slot === 0 ? 215 : 785, slot === 0 ? 235 : 765, 275);
  }

  focus(x: number, z: number, span = this.#span): void {
    this.#centerX = x;
    this.#centerZ = z;
    this.#span = Math.max(32, Math.min(1000, span));
    this.#clampCenter();
    this.#render();
    this.#onViewChange();
  }

  zoom(factor: number): void {
    this.focus(this.#centerX, this.#centerZ, this.#span * factor);
  }

  select(tile: PickedTile): void {
    this.#selected = tile;
    this.#render();
  }

  visibleChunkIds(extra?: number): number[] {
    const aspect =
      this.#host.clientWidth / Math.max(1, this.#host.clientHeight);
    const halfX = (this.#span * aspect) / 2 + CHUNK_SIZE;
    const halfZ = this.#span / 2 + CHUNK_SIZE;
    const minX = Math.max(0, Math.floor((this.#centerX - halfX) / CHUNK_SIZE));
    const maxX = Math.min(15, Math.floor((this.#centerX + halfX) / CHUNK_SIZE));
    const minZ = Math.max(0, Math.floor((this.#centerZ - halfZ) / CHUNK_SIZE));
    const maxZ = Math.min(15, Math.floor((this.#centerZ + halfZ) / CHUNK_SIZE));
    const ids: number[] = [];
    for (let z = minZ; z <= maxZ; z++)
      for (let x = minX; x <= maxX; x++) ids.push(chunkId(x, z));
    ids.sort((a, b) => {
      const aa = chunkCoordinatesForId(a),
        bb = chunkCoordinatesForId(b);
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
    const layer = this.#layer(id);
    for (let local = 0; local < 4096; local++)
      this.#paintLocal(layer.pixels, id, local, replica);
    layer.texture.needsUpdate = true;
    this.#render();
  }

  paintTile(id: number, local: number, replica: ProjectionReplica): void {
    const layer = this.#layer(id);
    this.#paintLocal(layer.pixels, id, local, replica);
    layer.texture.needsUpdate = true;
    this.#render();
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
    if (
      x >= WORLD_WIDTH ||
      z >= WORLD_HEIGHT ||
      !replica.isDiscovered(id, local)
    ) {
      pixels[offset + 3] = 0;
      return;
    }
    const known = replica.maskAt(id, local) & (1 << this.#schoolSlot);
    const color = known
      ? this.#schoolSlot === 0
        ? [85, 222, 168]
        : [255, 164, 112]
      : [151, 175, 165];
    pixels[offset] = color[0]!;
    pixels[offset + 1] = color[1]!;
    pixels[offset + 2] = color[2]!;
    pixels[offset + 3] = 238;
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
    const aspect = rect.width / Math.max(1, rect.height);
    return {
      x:
        this.#centerX +
        ((clientX - rect.left) / rect.width - 0.5) * this.#span * aspect,
      z:
        this.#centerZ + ((clientY - rect.top) / rect.height - 0.5) * this.#span,
    };
  }

  #pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.#host.setPointerCapture(event.pointerId);
    this.#drag = {
      x: event.clientX,
      y: event.clientY,
      centerX: this.#centerX,
      centerZ: this.#centerZ,
      moved: false,
    };
  };
  #pointerMove = (event: PointerEvent): void => {
    if (!this.#drag) return;
    const dx = event.clientX - this.#drag.x;
    const dy = event.clientY - this.#drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) this.#drag.moved = true;
    if (!this.#drag.moved) return;
    const aspect =
      this.#host.clientWidth / Math.max(1, this.#host.clientHeight);
    this.#centerX =
      this.#drag.centerX - (dx / this.#host.clientWidth) * this.#span * aspect;
    this.#centerZ =
      this.#drag.centerZ - (dy / this.#host.clientHeight) * this.#span;
    this.#clampCenter();
    this.#render();
    this.#onViewChange();
  };
  #pointerUp = (event: PointerEvent): void => {
    const drag = this.#drag;
    this.#drag = undefined;
    if (!drag || drag.moved) return;
    const point = this.#point(event.clientX, event.clientY);
    const x = Math.floor(point.x),
      z = Math.floor(point.z);
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
  #wheel = (event: WheelEvent): void => {
    event.preventDefault();
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

  #render = (): void => {
    const width = Math.max(2, this.#host.clientWidth);
    const height = Math.max(2, this.#host.clientHeight);
    this.#renderer.setSize(width, height, false);
    const aspect = width / height;
    this.#camera.left = (-this.#span * aspect) / 2;
    this.#camera.right = (this.#span * aspect) / 2;
    this.#camera.top = this.#span / 2;
    this.#camera.bottom = -this.#span / 2;
    this.#camera.position.x = this.#centerX - 500;
    this.#camera.position.y = 500 - this.#centerZ;
    this.#camera.updateProjectionMatrix();
    this.#renderer.render(this.#scene, this.#camera);
    const position = (x: number, z: number) => ({
      left: `${(0.5 + (x - this.#centerX) / (this.#span * aspect)) * 100}%`,
      top: `${(0.5 + (z - this.#centerZ) / this.#span) * 100}%`,
    });
    markers.forEach((marker, index) => {
      Object.assign(
        this.#markerElements[index]!.style,
        position(marker.x, marker.z),
      );
    });
    this.#selection.hidden = !this.#selected;
    if (this.#selected)
      Object.assign(
        this.#selection.style,
        position(this.#selected.x + 0.5, this.#selected.z + 0.5),
      );
  };
}
