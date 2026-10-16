import * as THREE from "three";
import { placementError } from "../../shared/gameplay/editor.ts";
import { SCHOOLS, type WorldObject } from "../../shared/gameplay/gameConfig.ts";
import { ModelAssetLoader } from "./assetLoader.ts";
import { type AssetMount, mountModelAsset } from "./assetPipeline.ts";
import {
  getChestModelUrl,
  getHqModelUrl,
  getLandmarkModelUrl,
  getUniStopModelUrl,
} from "./assetRegistry.ts";
import { createProceduralBuilding } from "./proceduralBuildings.ts";
import { TerrainBiomes } from "./terrainBiomes.ts";
import { configureMapCamera, groundPointFromNdc } from "./worldView.ts";

/** An authoring scene: no player replica, school projection, wallet or gameplay socket. */
export class EditorScene {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  private loader = new ModelAssetLoader();
  private mounts = new Map<string, { mount: AssetMount; signature: string }>();
  private objects: WorldObject[] = [];
  private terrain = new TerrainBiomes([]);
  private geometry = new THREE.PlaneGeometry(1000, 1000, 128, 128);
  private labels = new Map<string, HTMLElement>();
  private ray = new THREE.Raycaster();
  private marker = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x6ce2dc,
      wireframe: true,
      depthTest: false,
    }),
  );
  private selected: string | undefined;
  private placement: WorldObject | undefined;
  private center = { x: 500, z: 500, span: 650 };
  private mode: "isometric" | "top-down" = "isometric";
  private drag:
    | {
        id?: string;
        x: number;
        y: number;
        moved: boolean;
        point: { x: number; z: number };
        original?: WorldObject;
      }
    | undefined;
  private resize: ResizeObserver;
  constructor(
    private host: HTMLElement,
    private pick: (id: string) => void,
    private move: (object: WorldObject) => void,
    private hint: (text: string, error?: boolean) => void,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x101e24);
    host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Bản đồ chỉnh sửa 3D. Chọn vật thể để kéo, kéo nền để di chuyển bản đồ.",
    );
    this.scene.add(new THREE.HemisphereLight(0xe2f5ff, 0x243824, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(-250, 100, 500);
    this.scene.add(light);
    this.geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(
        new Float32Array(this.geometry.attributes.position!.count * 3),
        3,
      ),
    );
    this.updateTerrain();
    this.scene.add(
      new THREE.Mesh(
        this.geometry,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      ),
    );
    const grid = new THREE.GridHelper(1000, 100, 0x67957d, 0x416c59);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 1;
    this.scene.add(grid);
    this.marker.visible = false;
    this.marker.renderOrder = 100;
    this.scene.add(this.marker);
    this.resize = new ResizeObserver(() => this.render());
    this.resize.observe(host);
    host.addEventListener("pointerdown", this.down);
    host.addEventListener("pointermove", this.pointerMove);
    host.addEventListener("pointerup", this.up);
    host.addEventListener("pointercancel", this.cancel);
    host.addEventListener("wheel", this.wheel, { passive: false });
    host.addEventListener("dragover", (e) => e.preventDefault());
    host.addEventListener("drop", (e) => {
      e.preventDefault();
      if (this.placement) this.place(e.clientX, e.clientY);
    });
    this.render();
  }
  private point(x: number, y: number): { x: number; z: number } {
    const r = this.host.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((x - r.left) / r.width) * 2 - 1,
      (-(y - r.top) / r.height) * 2 + 1,
    );
    const p = groundPointFromNdc(this.camera, ndc)!;
    this.ray.setFromCamera(ndc, this.camera);
    return { x: Math.round(p.x + 500), z: Math.round(500 - p.y) };
  }
  private objectAt(x: number, y: number): WorldObject | undefined {
    const p = this.point(x, y);
    const roots = [...this.mounts.values()].map((m) => m.mount.objectRoot);
    for (const hit of this.ray.intersectObjects(roots, true)) {
      for (
        let node: THREE.Object3D | null = hit.object;
        node;
        node = node.parent
      ) {
        if (typeof node.userData.editorId === "string")
          return this.objects.find((o) => o.id === node!.userData.editorId);
      }
    }
    const rect = this.host.getBoundingClientRect();
    let nearest: WorldObject | undefined,
      distance = 14;
    for (const o of this.objects) {
      const screen = new THREE.Vector3(
        o.x - 500,
        500 - o.z,
        this.terrain.getTerrainHeight(o.x, o.z) + 2,
      ).project(this.camera);
      const d = Math.hypot(
        rect.left + ((screen.x + 1) * rect.width) / 2 - x,
        rect.top + ((1 - screen.y) * rect.height) / 2 - y,
      );
      if (d < distance) {
        nearest = o;
        distance = d;
      }
    }
    return (
      nearest ??
      this.objects.find(
        (o) =>
          Math.abs(o.x - p.x) <= o.width / 2 &&
          Math.abs(o.z - p.z) <= o.height / 2,
      )
    );
  }
  private down = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    if (this.placement && e.button === 0) {
      this.place(e.clientX, e.clientY);
      return;
    }
    const object =
      e.button === 0 ? this.objectAt(e.clientX, e.clientY) : undefined;
    const point = this.point(e.clientX, e.clientY);
    if (object) {
      this.pick(object.id);
      this.select(object.id);
    }
    this.drag = {
      ...(object ? { id: object.id, original: object } : {}),
      x: e.clientX,
      y: e.clientY,
      moved: false,
      point,
    };
    this.host.setPointerCapture(e.pointerId);
  };
  private pointerMove = (e: PointerEvent): void => {
    const point = this.point(e.clientX, e.clientY);
    if (this.placement) {
      this.placement = { ...this.placement, ...point };
      this.showMarker(this.placement);
    }
    const d = this.drag;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.original) {
      const target = {
        ...d.original,
        x: d.original.x + point.x - d.point.x,
        z: d.original.z + point.z - d.point.z,
      };
      this.showMarker(target);
      const mount = this.mounts.get(d.original.id)?.mount;
      if (mount)
        mount.objectRoot.position.set(
          target.x - 500,
          500 - target.z,
          this.terrain.getTerrainHeight(target.x, target.z),
        );
      this.hint(
        placementError(target, this.objects) ??
          `Đặt tại ô ${target.x}, ${target.z}`,
        !!placementError(target, this.objects),
      );
    } else {
      this.center.x += d.point.x - point.x;
      this.center.z += d.point.z - point.z;
      this.render();
    }
    this.render();
  };
  private up = (e: PointerEvent): void => {
    const d = this.drag;
    this.drag = undefined;
    if (this.host.hasPointerCapture(e.pointerId))
      this.host.releasePointerCapture(e.pointerId);
    if (d?.original && d.moved) {
      const point = this.point(e.clientX, e.clientY);
      const target = {
        ...d.original,
        x: d.original.x + point.x - d.point.x,
        z: d.original.z + point.z - d.point.z,
      };
      if (!placementError(target, this.objects)) this.move(target);
      else {
        this.hint(placementError(target, this.objects)!, true);
        this.setObjects(this.objects);
      }
    }
    this.select(this.selected);
  };
  private cancel = (): void => {
    this.drag = undefined;
    this.setObjects(this.objects);
    this.select(this.selected);
  };
  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.center.span = Math.max(
      40,
      Math.min(1300, this.center.span * Math.exp(e.deltaY * 0.001)),
    );
    this.render();
  };
  private place(x: number, y: number): void {
    if (!this.placement) return;
    const object = { ...this.placement, ...this.point(x, y) };
    const error = placementError(object, this.objects);
    if (error) {
      this.hint(error, true);
      return;
    }
    this.placement = undefined;
    this.move(object);
    this.pick(object.id);
    this.select(object.id);
  }
  beginPlacement(object: WorldObject): void {
    this.placement = object;
    this.showMarker(object);
  }
  cancelPlacement(): void {
    this.placement = undefined;
    this.select(this.selected);
  }
  private showMarker(o: WorldObject): void {
    this.marker.visible = true;
    this.marker.scale.set(o.width, o.height, 3);
    this.marker.position.set(
      o.x - 500,
      500 - o.z,
      this.terrain.getTerrainHeight(o.x, o.z) + 2,
    );
    this.marker.material.color.set(
      placementError(o, this.objects) ? 0xff716c : 0x76efd3,
    );
    this.render();
  }
  select(id: string | undefined): void {
    this.selected = id;
    const o = this.objects.find((o) => o.id === id);
    if (o) this.showMarker(o);
    else {
      this.marker.visible = false;
      this.render();
    }
  }
  focus(x: number, z: number, span = 160): void {
    Object.assign(this.center, { x, z, span });
    this.render();
  }
  toggleCamera(): void {
    this.mode = this.mode === "isometric" ? "top-down" : "isometric";
    this.render();
  }
  zoom(factor: number): void {
    this.center.span = Math.max(40, Math.min(1300, this.center.span * factor));
    this.render();
  }
  setObjects(objects: WorldObject[]): void {
    this.objects = objects;
    if (this.terrain.setObjects(objects)) this.updateTerrain();
    for (const [id, label] of this.labels)
      if (!objects.some((o) => o.id === id)) {
        label.remove();
        this.labels.delete(id);
      }
    for (const [id, entry] of this.mounts)
      if (!objects.some((o) => o.id === id)) {
        entry.mount.dispose();
        this.mounts.delete(id);
      }
    for (const o of objects) {
      let label = this.labels.get(o.id);
      if (!label) {
        label = document.createElement("span");
        label.className = "studio-map-label";
        label.setAttribute("aria-hidden", "true");
        this.host.append(label);
        this.labels.set(o.id, label);
      }
      label.textContent =
        o.kind === "hq" ? SCHOOLS[o.schoolSlot!]!.shortName : o.name;
      const signature = `${o.kind}:${o.tier ?? ""}:${o.schoolSlot ?? ""}`;
      let entry = this.mounts.get(o.id);
      if (entry && entry.signature !== signature) {
        entry.mount.dispose();
        this.mounts.delete(o.id);
        entry = undefined;
      }
      if (!entry) {
        const school =
          o.schoolSlot === undefined ? undefined : SCHOOLS[o.schoolSlot];
        const url =
          o.kind === "hq"
            ? getHqModelUrl(school!.id)
            : o.kind === "landmark"
              ? getLandmarkModelUrl(o.id)
              : o.kind === "unistop"
                ? getUniStopModelUrl(o.tier!)
                : getChestModelUrl(o.tier!);
        const color =
          school?.color ?? (o.kind === "landmark" ? "#d7bb73" : "#63c9b0");
        const mount = mountModelAsset(
          this.scene,
          this.loader,
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
          () => this.render(),
          {
            skipIfUnavailable: true,
            targetSpan: Math.max(o.width, o.height),
            colorHex: color,
            onRootChanged: (root) => {
              root.userData.editorId = o.id;
              const current = this.objects.find((p) => p.id === o.id) ?? o;
              root.position.set(
                current.x - 500,
                500 - current.z,
                this.terrain.getTerrainHeight(current.x, current.z),
              );
            },
          },
        );
        entry = { mount, signature };
        this.mounts.set(o.id, entry);
      }
      entry.mount.objectRoot.position.set(
        o.x - 500,
        500 - o.z,
        this.terrain.getTerrainHeight(o.x, o.z),
      );
    }
    this.select(this.selected);
    this.render();
  }
  private render(): void {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.center.x = Math.max(0, Math.min(1000, this.center.x));
    this.center.z = Math.max(0, Math.min(1000, this.center.z));
    configureMapCamera(
      this.camera,
      this.mode,
      this.center.x,
      this.center.z,
      this.center.span,
      width / height,
    );
    for (const o of this.objects) {
      const label = this.labels.get(o.id);
      if (!label) continue;
      const point = new THREE.Vector3(
        o.x - 500,
        500 - o.z,
        this.terrain.getTerrainHeight(o.x, o.z) + 6,
      ).project(this.camera);
      label.hidden =
        Math.abs(point.x) > 1 ||
        Math.abs(point.y) > 1 ||
        (this.center.span > 240 &&
          !["hq", "landmark"].includes(o.kind) &&
          o.id !== this.selected);
      label.style.left = `${((point.x + 1) * width) / 2}px`;
      label.style.top = `${((1 - point.y) * height) / 2}px`;
    }
    this.renderer.render(this.scene, this.camera);
  }
  private updateTerrain(): void {
    const positions = this.geometry.attributes.position!,
      colors = this.geometry.attributes.color!,
      color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const sample = this.terrain.sample(
        positions.getX(i) + 500,
        500 - positions.getY(i),
      );
      positions.setZ(i, sample.height);
      color.setHex(sample.color);
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    positions.needsUpdate = colors.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
