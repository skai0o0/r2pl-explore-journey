import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  cacheInteractiveObject,
  pickInteractiveObject,
} from "../client/src/assetPipeline.ts";
import { MapCameraInput } from "../client/src/mapCameraInput.ts";
import { createProceduralBuilding } from "../client/src/proceduralBuildings.ts";
import { SCENE_PRESENTATION as P } from "../client/src/scenePresentation.ts";
import {
  configureMapCamera,
  groundPointFromNdc,
} from "../client/src/worldView.ts";

const pointer = (x: number, y: number, pointerId = 1, button = 0) => ({
  x,
  y,
  pointerId,
  button,
});

test("pan and orbit cannot select tiles, including fast drags, return-to-start and cancellation", () => {
  const input = new MapCameraInput();
  input.begin(pointer(10, 20));
  assert.equal(input.end(pointer(12, 21)), true);
  for (const button of [0, 1, 2]) {
    input.begin(pointer(10, 20, 1, button));
    assert.equal(
      input.move(pointer(30, 45, 1, button))?.kind,
      button ? "orbit" : "pan",
    );
    input.move(pointer(10, 20, 1, button));
    assert.equal(input.end(pointer(10, 20, 1, button)), false);
  }
  input.begin(pointer(10, 20));
  assert.equal(
    input.end(pointer(100, 20)),
    false,
    "large pointer-up delta without move is a drag",
  );
  input.begin(pointer(10, 20, 1, 2));
  assert.equal(
    input.end(pointer(10, 20, 1, 2)),
    false,
    "right click never selects",
  );
  input.begin(pointer(10, 20));
  assert.equal(input.end(pointer(10, 20), true), false);
  assert.equal(
    input.end(pointer(10, 20)),
    false,
    "lost capture after up cannot duplicate a click",
  );
});

test("two fingers pan, pinch and twist without either release becoming a click", () => {
  const input = new MapCameraInput();
  input.begin(pointer(0, 0));
  input.begin(pointer(100, 0, 2));
  const motion = input.move(pointer(100, 100, 2));
  assert(motion?.kind === "gesture");
  assert.deepEqual(motion.from, { x: 50, y: 0 });
  assert.deepEqual(motion.to, { x: 50, y: 50 });
  assert(Math.abs(motion.zoom - Math.SQRT1_2) < 1e-10);
  assert(Math.abs(motion.rotation - Math.PI / 4) < 1e-10);
  assert.equal(input.end(pointer(100, 100, 2)), false);
  assert.equal(input.end(pointer(0, 0)), false);
  assert.equal(input.active, false);
  input.begin(pointer(0, 0));
  assert.equal(
    input.end(pointer(0, 0)),
    true,
    "normal taps recover after the gesture",
  );
});

test("Shift-left drag orbits without a right-button browser gesture or gameplay click", () => {
  const input = new MapCameraInput();
  input.begin({ ...pointer(10, 20), shiftKey: true });
  assert.deepEqual(input.move(pointer(30, 45)), {
    kind: "orbit",
    dx: 20,
    dy: 25,
  });
  assert.equal(input.end(pointer(30, 45)), false);
  input.begin({ ...pointer(10, 20), shiftKey: true });
  assert.equal(
    input.end(pointer(10, 20)),
    false,
    "Shift-click must not spend Points",
  );
  input.begin(pointer(10, 20));
  assert.equal(
    input.move({ ...pointer(30, 45), shiftKey: true })?.kind,
    "pan",
    "The mode is latched on press, rather than jumping when a modifier changes",
  );
  input.end(pointer(30, 45));
  input.begin(pointer(10, 20));
  assert.equal(input.end(pointer(10, 20)), true);
});

test("interrupted mouse and multi-touch gestures reset without phantom moves or clicks", () => {
  const input = new MapCameraInput();
  for (const button of [0, 1, 2]) {
    input.begin(pointer(10, 20, 1, button));
    input.move(pointer(40, 50, 1, button));
    assert.deepEqual(input.cancel(), [1]);
    assert.equal(input.active, false);
    assert.equal(input.move(pointer(70, 80)), undefined);
    assert.equal(input.end(pointer(70, 80)), false);
  }
  input.begin(pointer(0, 0));
  input.begin(pointer(100, 0, 2));
  assert.deepEqual(input.cancel(), [1, 2]);
  assert.equal(input.end(pointer(100, 0, 2)), false);
  input.begin(pointer(10, 20));
  assert.equal(
    input.end(pointer(10, 20)),
    true,
    "Input recovers after interruption",
  );
});

test("rotation and tilt preserve Z-up terrain picking and clip depth in every quadrant", () => {
  for (const mode of ["isometric", "top-down"] as const) {
    for (const aspect of [16 / 9, 9 / 16]) {
      for (let step = 0; step < 8; step++) {
        for (const elevation of [
          P.camera.minElevation,
          P.camera.elevation,
          P.camera.maxElevation,
        ]) {
          const camera = new THREE.OrthographicCamera();
          configureMapCamera(
            camera,
            mode,
            785,
            765,
            64,
            aspect,
            P.camera.azimuth + (step * Math.PI) / 4,
            elevation,
          );
          const world = new THREE.Vector3(286.5, -266.5, 0);
          const screen = world.clone().project(camera);
          const hit = groundPointFromNdc(
            camera,
            new THREE.Vector2(screen.x, screen.y),
          );
          assert(hit && hit.distanceTo(world) < 1e-7);
          assert(
            screen.z > -1 && screen.z < 1,
            "steep tilt must not move terrain beyond the far plane",
          );
        }
      }
    }
  }
});

test("orbit exposes a ground tile hidden behind a tall building from the original camera", () => {
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(6, 6, 12),
    new THREE.MeshBasicMaterial(),
  );
  building.position.z = 6;
  building.updateMatrixWorld(true);
  const tile = new THREE.Vector3(-5, 5, 0);
  const camera = new THREE.OrthographicCamera();
  const ray = new THREE.Raycaster();
  const hits = (angle: number) => {
    configureMapCamera(camera, "isometric", 500, 500, 64, 1.6, angle);
    const projected = tile.clone().project(camera);
    ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
    return ray.intersectObject(building).length;
  };
  assert(hits(P.camera.azimuth) > 0, "original view is occluded");
  assert.equal(
    hits(P.camera.azimuth + Math.PI),
    0,
    "opposite view exposes the tile",
  );
  building.geometry.dispose();
  building.material.dispose();
});

test("actual HQ, landmark, UniStop and chest geometry remains selectable after orbit", () => {
  for (const kind of ["hq", "landmark", "unistop", "chest"] as const) {
    const root = createProceduralBuilding(kind, 0x00d4eb);
    const entry = cacheInteractiveObject({ id: kind, kind }, root);
    for (let step = 0; step < 8; step++) {
      const camera = new THREE.OrthographicCamera();
      configureMapCamera(
        camera,
        "isometric",
        500,
        500,
        64,
        1.6,
        P.camera.azimuth + (step * Math.PI) / 4,
      );
      const screen = entry.worldBox
        .getCenter(new THREE.Vector3())
        .project(camera);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
      assert.equal(pickInteractiveObject(ray, [entry])?.id, kind);
    }
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          material.dispose();
      }
    });
  }
});
