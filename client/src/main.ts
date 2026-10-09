import * as THREE from "three";
import "./style.css";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/world/constants.ts";
import { tileIndex } from "../../shared/world/coordinates.ts";
import { SchoolRegistry } from "../../shared/world/registry.ts";
import { WorldState } from "../../shared/world/world.ts";

// Visual fixture only. These identifiers are synthetic and have no campaign meaning.
const world = new WorldState(
  new SchoolRegistry([
    { id: "fixture-a", slot: 0 },
    { id: "fixture-b", slot: 15 },
  ]),
);
for (let z = 100; z < 250; z++)
  for (let x = 90; x < 310; x++) world.setPresence(tileIndex(x, z), 0, true);
for (let z = 590; z < 790; z++)
  for (let x = 570; x < 760; x++) world.setPresence(tileIndex(x, z), 15, true);

const pixels = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT * 4);
for (let z = 0; z < WORLD_HEIGHT; z++) {
  for (let x = 0; x < WORLD_WIDTH; x++) {
    const offset = tileIndex(x, z) * 4;
    const mask = world.maskAt(tileIndex(x, z));
    const color =
      mask & 1
        ? [65, 186, 157]
        : mask & 0x8000
          ? [236, 140, 104]
          : [34, 46, 66];
    pixels[offset] = color[0]!;
    pixels[offset + 1] = color[1]!;
    pixels[offset + 2] = color[2]!;
    pixels[offset + 3] = 255;
  }
}

const host = document.querySelector<HTMLElement>("#world-view")!;
const output = document.querySelector<HTMLElement>("#metrics")!;
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: "low-power",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setScissorTest(true);
host.append(renderer.domElement);
const texture = new THREE.DataTexture(
  pixels,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  THREE.RGBAFormat,
);
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestFilter;
texture.needsUpdate = true;
const scene = new THREE.Scene();
scene.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_HEIGHT),
    new THREE.MeshBasicMaterial({ map: texture }),
  ),
);
const overview = new THREE.OrthographicCamera(-500, 500, 500, -500, 0.1, 10);
overview.position.z = 1;
const local = new THREE.OrthographicCamera(-65, 65, 65, -65, 0.1, 10);
local.position.set(170 - 500, 170 - 500, 1);
const frameTimes: number[] = [];
let priorFrame = 0;
let totalFrames = 0;

function paint(): void {
  const now = performance.now();
  if (priorFrame) {
    frameTimes.push(now - priorFrame);
    if (frameTimes.length > 240) frameTimes.shift();
  }
  priorFrame = now;
  const width = Math.max(2, host.clientWidth);
  const height = Math.max(2, host.clientHeight);
  renderer.setSize(width, height, false);
  const fullWidth = renderer.domElement.width;
  const fullHeight = renderer.domElement.height;
  const half = Math.floor(fullWidth / 2);
  renderer.setViewport(0, 0, half, fullHeight);
  renderer.setScissor(0, 0, half, fullHeight);
  renderer.render(scene, overview);
  const overviewCalls = renderer.info.render.calls;
  renderer.setViewport(half, 0, fullWidth - half, fullHeight);
  renderer.setScissor(half, 0, fullWidth - half, fullHeight);
  renderer.render(scene, local);
  const drawCalls = overviewCalls + renderer.info.render.calls;
  totalFrames++;
  if (totalFrames % 60 === 0) {
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const heap = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory?.usedJSHeapSize;
    const metrics = {
      fixture: "synthetic, 1,000,000 cells, slots 0 and 15",
      frameCount: totalFrames,
      frameMsP50: sorted[Math.floor(sorted.length * 0.5)]?.toFixed(2),
      frameMsP95: sorted[Math.floor(sorted.length * 0.95)]?.toFixed(2),
      drawCallsPerFrame: drawCalls,
      geometryCount: renderer.info.memory.geometries,
      textureCount: renderer.info.memory.textures,
      texturePayloadBytes: pixels.byteLength,
      gpuMemoryBytes: "not exposed by WebGL",
      heapBytes: heap ?? "not exposed by browser",
    };
    output.textContent = JSON.stringify(metrics, null, 2);
    Object.assign(window, { __r2plFixtureMetrics: metrics });
  }
  requestAnimationFrame(paint);
}
requestAnimationFrame(paint);
