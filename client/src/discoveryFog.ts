import * as THREE from "three";
import type { ProjectionReplica } from "../../shared/protocol/replica.ts";
import { chunkCoordinatesForId } from "../../shared/world/coordinates.ts";
import { SCENE_PRESENTATION as P } from "./scenePresentation.ts";

const SIZE = 1000;
/** A cosmetic atlas copied only from the current own-school projection. Never authorizes objects. */
export class DiscoveryFog {
  readonly pixels = new Uint8Array(SIZE * SIZE * 4);
  readonly texture = new THREE.DataTexture(this.pixels, SIZE, SIZE);
  readonly density = { value: P.discoveryFog.density as number };
  constructor() {
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }
  paintTile(id: number, local: number, replica: ProjectionReplica): void {
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    const x = chunkX * 64 + (local % 64);
    const z = chunkZ * 64 + Math.floor(local / 64);
    if (x >= SIZE || z >= SIZE) return;
    const offset = (z * SIZE + x) * 4;
    const next =
      replica.hasChunk(id) && replica.isDiscovered(id, local) ? 255 : 0;
    if (this.pixels[offset] === next) return;
    this.pixels[offset] = next;
    this.texture.addUpdateRange(offset, 4);
    this.texture.needsUpdate = true;
  }
  paintChunk(id: number, replica: ProjectionReplica): void {
    const { chunkX, chunkZ } = chunkCoordinatesForId(id);
    let changed = false;
    for (let row = 0; row < 64 && chunkZ * 64 + row < SIZE; row++) {
      let dirty = false;
      const width = Math.min(64, SIZE - chunkX * 64);
      const offset = ((chunkZ * 64 + row) * SIZE + chunkX * 64) * 4;
      for (let col = 0; col < width; col++) {
        const next =
          replica.hasChunk(id) && replica.isDiscovered(id, row * 64 + col)
            ? 255
            : 0;
        if (this.pixels[offset + col * 4] === next) continue;
        this.pixels[offset + col * 4] = next;
        dirty = true;
      }
      if (dirty) {
        this.texture.addUpdateRange(offset, width * 4);
        changed = true;
      }
    }
    if (changed) this.texture.needsUpdate = true;
  }
  reset(): void {
    this.pixels.fill(0);
    this.texture.clearUpdateRanges();
    this.texture.needsUpdate = true;
  }
  setDensity(multiplier: number): void {
    this.density.value = Math.max(
      0,
      Math.min(0.75, P.discoveryFog.density * multiplier),
    );
  }
  apply(material: THREE.Material): void {
    const previous = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.landscapeDiscovery = { value: this.texture };
      shader.uniforms.landscapeDensity = this.density;
      shader.vertexShader =
        "varying vec2 landscapeWorld;\n" +
        shader.vertexShader.replace(
          "#include <project_vertex>",
          `vec4 landscapePosition = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           landscapePosition = instanceMatrix * landscapePosition;
         #endif
         landscapeWorld = (modelMatrix * landscapePosition).xy;
         #include <project_vertex>`,
        );
      shader.fragmentShader =
        `
        uniform sampler2D landscapeDiscovery;
        uniform float landscapeDensity;
        varying vec2 landscapeWorld;
        float landscapeSample(vec2 p) {
          if (p.x < 0.0 || p.y < 0.0 || p.x >= 1000.0 || p.y >= 1000.0) return 0.0;
          return texture2D(landscapeDiscovery, p / 1000.0).r;
        }
        float landscapeFog() {
          vec2 p = vec2(landscapeWorld.x + 500.0, 500.0 - landscapeWorld.y);
          float center = landscapeSample(p);
          float spread = 0.0;
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              spread += landscapeSample(p + vec2(float(x), float(y)) * ${P.discoveryFog.feather});
            }
          }
          // A one-tile corridor remains clear; unknown holes and absent chunks stay fogged.
          float reveal = max(center, spread / 9.0);
          float edge = smoothstep(0.0, 1.0, 1.0 - reveal);
          float wisps = 0.89 + 0.11 * sin(p.x * 0.17 + sin(p.y * 0.13));
          return edge * landscapeDensity * wisps;
        }
      ` +
        shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          `
        float landscapeAmount = landscapeFog();
        float landscapeLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
        outgoingLight = mix(outgoingLight, vec3(landscapeLuma) * vec3(0.86, 1.02, 1.08), landscapeAmount * 0.28);
        outgoingLight = mix(outgoingLight, vec3(${P.discoveryFog.color.join(",")}), landscapeAmount * 0.83);
        #include <opaque_fragment>
      `,
        );
    };
    material.customProgramCacheKey = () =>
      `${cacheKey}-school-discovery-landscape-v1`;
  }
  dispose(): void {
    this.texture.dispose();
  }
}
