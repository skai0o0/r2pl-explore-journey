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

      // Dawn HQ beacon clearing at (215, 235)
      const dDawn = Math.hypot(x - 215, z - 235);
      if (dDawn < 16) {
        const t = Math.max(0, 1 - dDawn / 16);
        r = Math.round(r * (1 - t) + 72 * t);
        g = Math.round(g * (1 - t) + 210 * t);
        b = Math.round(b * (1 - t) + 155 * t);
      }

      // Dusk HQ beacon clearing at (785, 765)
      const dDusk = Math.hypot(x - 785, z - 765);
      if (dDusk < 16) {
        const t = Math.max(0, 1 - dDusk / 16);
        r = Math.round(r * (1 - t) + 245 * t);
        g = Math.round(g * (1 - t) + 150 * t);
        b = Math.round(b * (1 - t) + 100 * t);
      }

      // Landmark beacon clearing at (510, 485)
      const dLandmark = Math.hypot(x - 510, z - 485);
      if (dLandmark < 22) {
        const t = Math.max(0, 1 - dLandmark / 22);
        r = Math.round(r * (1 - t) + 195 * t);
        g = Math.round(g * (1 - t) + 165 * t);
        b = Math.round(b * (1 - t) + 235 * t);
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
  readonly #camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  readonly #chunkLayers = new Map<
    number,
    { pixels: Uint8Array; texture: THREE.DataTexture; mesh: THREE.Mesh }
  >();
  readonly #markerElements: HTMLElement[] = [];
  readonly #selection: HTMLElement;
  readonly #hoverElement: HTMLElement;
  readonly #pendingElement: HTMLElement;
  readonly #revealElement: HTMLElement;
  readonly #rejectElement: HTMLElement;
  readonly #onPick: (tile: PickedTile) => void;
  readonly #onViewChange: () => void;
  readonly #onHover: ((tile: PickedTile | undefined) => void) | undefined;

  #schoolSlot = 0;
  #span = 275;
  #centerX = 215;
  #centerZ = 235;
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
  ) {
    this.#host = host;
    this.#onPick = onPick;
    this.#onViewChange = onViewChange;
    this.#onHover = onHover;

    this.#renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.#renderer.domElement);
    this.#scene.background = new THREE.Color(0x0b1a20);

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

    for (const marker of markers) {
      const element = document.createElement("div");
      element.className = `map-marker ${marker.kind}`;
      element.innerHTML = `<span class="marker-glyph">${marker.kind === "landmark" ? "◆" : "⌂"}</span><span class="marker-copy"><b>${marker.title}</b><small>${marker.detail}</small></span>`;
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
      '<span class="pending-radar"></span><span class="pending-tag">COMMITTING</span>';
    this.#pendingElement.hidden = true;
    host.append(this.#pendingElement);

    this.#revealElement = document.createElement("div");
    this.#revealElement.className = "tile-reveal";
    this.#revealElement.innerHTML =
      '<span class="reveal-ring"></span><span class="reveal-spark">✦</span><span class="reveal-tag">KNOWLEDGE REVEALED</span>';
    this.#revealElement.hidden = true;
    host.append(this.#revealElement);

    this.#rejectElement = document.createElement("div");
    this.#rejectElement.className = "tile-reject";
    this.#rejectElement.innerHTML =
      '<span class="reject-ring"></span><span class="reject-tag">REJECTED</span>';
    this.#rejectElement.hidden = true;
    host.append(this.#rejectElement);

    this.#camera.position.z = 5;
    this.#camera.lookAt(0, 0, 0);

    host.addEventListener("pointerdown", this.#pointerDown);
    host.addEventListener("pointermove", this.#pointerMove);
    host.addEventListener("pointerup", this.#pointerUp);
    host.addEventListener("pointercancel", this.#pointerUp);
    host.addEventListener("pointerleave", this.#pointerLeave);
    host.addEventListener("wheel", this.#wheel, { passive: false });
    window.addEventListener("resize", this.#render);
    this.#render();
  }

  setSchool(slot: number): void {
    this.#schoolSlot = slot;
    this.#selected = undefined;
    this.#hovered = undefined;
    this.#pendingTile = undefined;
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
    this.#revealTimer = window.setTimeout(() => {
      this.#revealElement.hidden = true;
      this.#revealElement.classList.remove("animating");
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
    this.#rejectTimer = window.setTimeout(() => {
      this.#rejectElement.hidden = true;
      this.#rejectElement.classList.remove("animating");
    }, 750);
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
    const layer = this.#layer(id);
    for (let local = 0; local < 4096; local++) {
      this.#paintLocal(layer.pixels, id, local, replica);
    }
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
    if (x >= WORLD_WIDTH || z >= WORLD_HEIGHT) {
      pixels[offset + 3] = 0;
      return;
    }

    if (!replica.isDiscovered(id, local)) {
      // Unexplored tile: transparent so base fog texture shows through
      pixels[offset + 3] = 0;
      return;
    }

    // Discovered tile: fog is cleared!
    const isOwned = (replica.maskAt(id, local) & (1 << this.#schoolSlot)) !== 0;
    const [tr, tg, tb] = baseTerrainColor(x, z);

    if (isOwned) {
      // Differentiate authorized discovered school-owned tiles with vibrant school territory styling!
      if (this.#schoolSlot === 0) {
        // Dawn University: emerald mint glow
        pixels[offset] = Math.min(255, Math.round(tr * 0.35 + 85 * 0.65));
        pixels[offset + 1] = Math.min(255, Math.round(tg * 0.35 + 242 * 0.65));
        pixels[offset + 2] = Math.min(255, Math.round(tb * 0.35 + 180 * 0.65));
      } else {
        // Dusk University: warm sunset coral glow
        pixels[offset] = Math.min(255, Math.round(tr * 0.35 + 255 * 0.65));
        pixels[offset + 1] = Math.min(255, Math.round(tg * 0.35 + 168 * 0.65));
        pixels[offset + 2] = Math.min(255, Math.round(tb * 0.35 + 115 * 0.65));
      }
      pixels[offset + 3] = 255;
    } else {
      // Discovered but not owned by this school (scouted/unclaimed):
      // Revealed natural terrain with crisp neutral survey lighting
      pixels[offset] = Math.min(255, Math.round(tr * 0.85 + 145 * 0.15));
      pixels[offset + 1] = Math.min(255, Math.round(tg * 0.85 + 185 * 0.15));
      pixels[offset + 2] = Math.min(255, Math.round(tb * 0.85 + 175 * 0.15));
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
    const aspect = rect.width / Math.max(1, rect.height);
    return {
      x:
        this.#centerX +
        ((clientX - rect.left) / rect.width - 0.5) * this.#span * aspect,
      z:
        this.#centerZ + ((clientY - rect.top) / rect.height - 0.5) * this.#span,
    };
  }

  #position(x: number, z: number): { left: string; top: string } {
    const aspect =
      this.#host.clientWidth / Math.max(1, this.#host.clientHeight);
    return {
      left: `${(0.5 + (x - this.#centerX) / (this.#span * aspect)) * 100}%`,
      top: `${(0.5 + (z - this.#centerZ) / this.#span) * 100}%`,
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
      const aspect =
        this.#host.clientWidth / Math.max(1, this.#host.clientHeight);
      this.#centerX =
        this.#drag.centerX -
        (dx / this.#host.clientWidth) * this.#span * aspect;
      this.#centerZ =
        this.#drag.centerZ - (dy / this.#host.clientHeight) * this.#span;
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
      this.#hoverElement.hidden = false;
      this.#onHover?.(tile);
      this.#updateReticles();
    } else {
      this.#hovered = undefined;
      this.#hoverElement.hidden = true;
      this.#onHover?.(undefined);
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
    const width = Math.max(2, this.#host.clientWidth);
    const height = Math.max(2, this.#host.clientHeight);
    const aspect = width / height;
    const tilePx = width / (this.#span * aspect);
    const boxSize = Math.max(14, Math.min(56, Math.round(tilePx)));

    if (this.#selected) {
      this.#selection.hidden = false;
      this.#selection.style.width = `${boxSize}px`;
      this.#selection.style.height = `${boxSize}px`;
      Object.assign(
        this.#selection.style,
        this.#position(this.#selected.x + 0.5, this.#selected.z + 0.5),
      );
    } else {
      this.#selection.hidden = true;
    }

    if (this.#hovered) {
      this.#hoverElement.hidden = false;
      this.#hoverElement.style.width = `${boxSize}px`;
      this.#hoverElement.style.height = `${boxSize}px`;
      Object.assign(
        this.#hoverElement.style,
        this.#position(this.#hovered.x + 0.5, this.#hovered.z + 0.5),
      );
    } else {
      this.#hoverElement.hidden = true;
    }

    if (this.#pendingTile) {
      this.#pendingElement.hidden = false;
      this.#pendingElement.style.width = `${boxSize}px`;
      this.#pendingElement.style.height = `${boxSize}px`;
      Object.assign(
        this.#pendingElement.style,
        this.#position(this.#pendingTile.x + 0.5, this.#pendingTile.z + 0.5),
      );
    } else {
      this.#pendingElement.hidden = true;
    }
  }

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

    markers.forEach((marker, index) => {
      const el = this.#markerElements[index];
      if (el) {
        Object.assign(el.style, this.#position(marker.x, marker.z));
      }
    });

    this.#updateReticles();
  };
}
