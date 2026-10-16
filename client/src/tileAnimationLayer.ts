import * as THREE from "three";
import { SCHOOLS } from "../../shared/gameplay/gameConfig.ts";

interface ActiveTileFlip {
  mesh: THREE.Mesh;
  shockwave?: THREE.Mesh | undefined;
  startTime: number;
  duration: number;
  startX: number;
  startWorldY: number;
  baseZ: number;
  onComplete?: (() => void) | undefined;
  shockwaveStarted: boolean;
}

interface ActiveFogPuff {
  mesh: THREE.Mesh;
  startTime: number;
  duration: number;
  vx: number;
  vy: number;
  vz: number;
  baseScale: number;
}

export class TileAnimationLayer {
  readonly group = new THREE.Group();
  readonly #activeFlips: ActiveTileFlip[] = [];
  readonly #activePuffs: ActiveFogPuff[] = [];

  readonly #boxGeometry = new THREE.BoxGeometry(0.96, 0.96, 0.16);
  readonly #ringGeometry = new THREE.RingGeometry(0.2, 0.48, 24);
  readonly #puffGeometry = new THREE.PlaneGeometry(0.9, 0.9);

  readonly #ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  readonly #puffMaterial = new THREE.MeshBasicMaterial({
    color: 0xbed6ec,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  constructor() {
    this.group.name = "TileAnimationLayer";
  }

  /**
   * Play 180-degree flip animation when a tile is claimed/colored.
   */
  playTileFlip(
    x: number,
    z: number,
    groundZ: number,
    startColorHex: number,
    targetSchoolSlot: number,
    onComplete?: () => void,
  ): void {
    const school = SCHOOLS[targetSchoolSlot];
    const targetColorHex = school ? parseInt(school.color.slice(1), 16) : 0x00f0ff;
    const accentColorHex = school ? parseInt(school.accent.slice(1), 16) : 0x80ffff;

    // Face materials: BoxGeometry faces in order: +x, -x, +y, -y, +z (top), -z (bottom)
    const sideMat = new THREE.MeshLambertMaterial({ color: 0x3d3024 });
    const topMat = new THREE.MeshLambertMaterial({ color: targetColorHex });
    const bottomMat = new THREE.MeshLambertMaterial({ color: startColorHex });

    // In Three.js Z-up or Y-up: BoxGeometry top is +z, bottom is -z
    const materials: THREE.Material[] = [
      sideMat,
      sideMat,
      sideMat,
      sideMat,
      topMat,
      bottomMat,
    ];

    const mesh = new THREE.Mesh(this.#boxGeometry, materials);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    // Center in world coordinates (map center is 500, 500)
    const worldX = x - 500 + 0.5;
    const worldY = 500 - z - 0.5;
    mesh.position.set(worldX, worldY, groundZ + 0.08);

    // Initial rotation: bottom face pointing up
    mesh.rotation.set(Math.PI, 0, 0);

    this.group.add(mesh);

    // Shockwave ring
    const ringMat = this.#ringMaterial.clone();
    ringMat.color.setHex(accentColorHex);
    const ringMesh = new THREE.Mesh(this.#ringGeometry, ringMat);
    ringMesh.position.set(worldX, worldY, groundZ + 0.02);
    ringMesh.visible = false;
    this.group.add(ringMesh);

    this.#activeFlips.push({
      mesh,
      shockwave: ringMesh,
      startTime: performance.now(),
      duration: 460, // ms
      startX: worldX,
      startWorldY: worldY,
      baseZ: groundZ + 0.08,
      onComplete,
      shockwaveStarted: false,
    });
  }

  /**
   * Play fog dissipation puff particles when fog lifts over a tile.
   */
  playFogDissipate(x: number, z: number, groundZ: number): void {
    const worldX = x - 500 + 0.5;
    const worldY = 500 - z - 0.5;
    const now = performance.now();

    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(this.#puffGeometry, this.#puffMaterial.clone());
      const angle = (i * Math.PI) / 2 + (Math.random() - 0.5) * 0.4;
      const speed = 0.5 + Math.random() * 0.7;

      puff.position.set(
        worldX + (Math.random() - 0.5) * 0.4,
        worldY + (Math.random() - 0.5) * 0.4,
        groundZ + 0.2 + Math.random() * 0.2,
      );
      puff.rotation.z = Math.random() * Math.PI * 2;
      this.group.add(puff);

      this.#activePuffs.push({
        mesh: puff,
        startTime: now + i * 40,
        duration: 520,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 1.2 + Math.random() * 0.8,
        baseScale: 0.6 + Math.random() * 0.4,
      });
    }
  }

  /**
   * Update active animations. Returns true if animations are still running.
   */
  update(): boolean {
    const now = performance.now();
    let hasRunning = false;

    // 1. Update Tile Flips
    for (let i = this.#activeFlips.length - 1; i >= 0; i--) {
      const flip = this.#activeFlips[i]!;
      const elapsed = now - flip.startTime;
      const t = Math.min(1, Math.max(0, elapsed / flip.duration));

      if (t < 1) {
        hasRunning = true;
        // Parabolic jump arc: height peak at t = 0.5
        const lift = Math.sin(t * Math.PI) * 0.95;
        flip.mesh.position.z = flip.baseZ + lift;

        // Smooth 180-degree flip: starts at Math.PI (upside down), ends at 0
        flip.mesh.rotation.x = Math.PI * (1 - t);
        // Slight wobble around Y for visual flavor
        flip.mesh.rotation.y = Math.sin(t * Math.PI) * 0.18;
      } else {
        // Stamp down completion
        if (!flip.shockwaveStarted) {
          flip.shockwaveStarted = true;
          flip.mesh.position.z = flip.baseZ;
          flip.mesh.rotation.set(0, 0, 0);
          if (flip.shockwave) flip.shockwave.visible = true;
          flip.onComplete?.();
        }

        // Shockwave expansion phase (180ms after stamp)
        const shockElapsed = elapsed - flip.duration;
        const shockDuration = 220;
        const st = Math.min(1, shockElapsed / shockDuration);

        if (st < 1 && flip.shockwave) {
          hasRunning = true;
          const scale = 0.6 + st * 2.2;
          flip.shockwave.scale.set(scale, scale, 1);
          (flip.shockwave.material as THREE.MeshBasicMaterial).opacity = (1 - st) * 0.95;
        } else {
          // Cleanup finished flip
          this.group.remove(flip.mesh);
          if (Array.isArray(flip.mesh.material)) {
            for (const m of flip.mesh.material) m.dispose();
          } else {
            (flip.mesh.material as THREE.Material).dispose();
          }
          if (flip.shockwave) {
            this.group.remove(flip.shockwave);
            (flip.shockwave.material as THREE.Material).dispose();
          }
          this.#activeFlips.splice(i, 1);
        }
      }
    }

    // 2. Update Fog Puffs
    for (let i = this.#activePuffs.length - 1; i >= 0; i--) {
      const puff = this.#activePuffs[i]!;
      if (now < puff.startTime) {
        hasRunning = true;
        continue;
      }
      const elapsed = now - puff.startTime;
      const t = Math.min(1, Math.max(0, elapsed / puff.duration));

      if (t < 1) {
        hasRunning = true;
        const dt = 0.016;
        puff.mesh.position.x += puff.vx * dt;
        puff.mesh.position.y += puff.vy * dt;
        puff.mesh.position.z += puff.vz * dt;
        const scale = puff.baseScale + t * 1.8;
        puff.mesh.scale.set(scale, scale, 1);
        (puff.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.65;
      } else {
        this.group.remove(puff.mesh);
        (puff.mesh.material as THREE.Material).dispose();
        this.#activePuffs.splice(i, 1);
      }
    }

    return hasRunning;
  }

  dispose(): void {
    for (const flip of this.#activeFlips) {
      this.group.remove(flip.mesh);
      if (Array.isArray(flip.mesh.material)) {
        for (const m of flip.mesh.material) m.dispose();
      }
      if (flip.shockwave) {
        this.group.remove(flip.shockwave);
        (flip.shockwave.material as THREE.Material).dispose();
      }
    }
    this.#activeFlips.length = 0;

    for (const puff of this.#activePuffs) {
      this.group.remove(puff.mesh);
      (puff.mesh.material as THREE.Material).dispose();
    }
    this.#activePuffs.length = 0;

    this.#boxGeometry.dispose();
    this.#ringGeometry.dispose();
    this.#puffGeometry.dispose();
    this.#ringMaterial.dispose();
    this.#puffMaterial.dispose();
    this.group.clear();
  }
}
