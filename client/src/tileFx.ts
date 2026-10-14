import * as THREE from "three";

/** Max simultaneous tile animations tracked per 64x64 chunk layer. */
export const MAX_TILE_PULSES = 8;
/** Duration of one tile reveal / change animation, in seconds. */
export const TILE_PULSE_SECONDS = 1.4;
const CHUNK = 64;
const EXPIRED = -1_000_000;

export type TilePulseKind = "gain" | "loss";

/** Texel (col,row) of a chunk-local tile index; DataTexture rows run bottom-up. */
export function tileTexel(local: number): { col: number; row: number } {
  return { col: local % CHUNK, row: CHUNK - 1 - Math.floor(local / CHUNK) };
}

/** Time source shared by every chunk layer material (seconds). */
export const tileFxTime = { value: 0 };

/**
 * Fixed-size ring of tile animations for one chunk layer. Entries are packed as
 * vec4(col, row, startSeconds, kind) so they can be uploaded as a uniform array.
 */
export class TilePulses {
  readonly uniforms: THREE.Vector4[] = Array.from(
    { length: MAX_TILE_PULSES },
    () => new THREE.Vector4(0, 0, EXPIRED, 0),
  );

  add(local: number, now: number, kind: TilePulseKind): void {
    const { col, row } = tileTexel(local);
    let slot = -1;
    let oldest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.uniforms.length; i++) {
      const u = this.uniforms[i]!;
      if (u.x === col && u.y === row && now - u.z < TILE_PULSE_SECONDS) {
        slot = i; // same tile retriggered: restart in place
        break;
      }
      if (now - u.z >= TILE_PULSE_SECONDS) {
        slot = i;
        break;
      }
      if (u.z < oldest) {
        oldest = u.z;
        slot = i;
      }
    }
    this.uniforms[slot]!.set(col, row, now, kind === "loss" ? 1 : 0);
  }

  active(now: number): boolean {
    return this.uniforms.some((u) => now - u.z < TILE_PULSE_SECONDS);
  }
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float uTime;
uniform vec4 uPulses[${MAX_TILE_PULSES}];
varying vec2 vUv;

vec4 fetchCell(vec2 cell, vec4 fallback) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x > 63.0 || cell.y > 63.0) return fallback;
  return texture2D(map, (cell + 0.5) / 64.0);
}

// 1 when the neighbouring tile is fog or clearly a different territory colour.
float boundary(vec4 n, vec4 c) {
  if (n.a < 0.5) return 1.0;
  return step(0.18, distance(n.rgb, c.rgb));
}

void main() {
  vec2 px = vUv * 64.0;
  vec2 cell = min(floor(px), vec2(63.0));
  vec2 f = px - cell;
  vec4 c = texture2D(map, (cell + 0.5) / 64.0);
  vec4 nl = fetchCell(cell + vec2(-1.0, 0.0), c);
  vec4 nr = fetchCell(cell + vec2(1.0, 0.0), c);
  vec4 nd = fetchCell(cell + vec2(0.0, -1.0), c);
  vec4 nu = fetchCell(cell + vec2(0.0, 1.0), c);
  float dl = f.x;
  float dr = 1.0 - f.x;
  float dd = f.y;
  float du = 1.0 - f.y;

  vec3 rgb = c.rgb;
  float a = c.a;

  if (c.a > 0.5) {
    // Tile bevel: thin dark seam between tiles plus a soft highlight on top-left.
    float seam = min(min(dl, dr), min(dd, du));
    rgb *= 0.86 + 0.14 * smoothstep(0.0, 0.1, seam);
    rgb += 0.035 * smoothstep(0.35, 0.0, distance(f, vec2(0.35, 0.65)));

    // Territory rim, breathing slowly.
    float e = 0.0;
    e = max(e, boundary(nl, c) * smoothstep(0.16, 0.0, dl));
    e = max(e, boundary(nr, c) * smoothstep(0.16, 0.0, dr));
    e = max(e, boundary(nd, c) * smoothstep(0.16, 0.0, dd));
    e = max(e, boundary(nu, c) * smoothstep(0.16, 0.0, du));
    vec3 rimColor = mix(rgb, vec3(1.0), 0.5) * 1.25;
    rgb = mix(rgb, rimColor, e * (0.78 + 0.22 * sin(uTime * 2.2)));
  } else {
    // Fog tile touching territory: soft frontier glow in the neighbour's colour.
    vec3 gc = vec3(0.0);
    float ga = 0.0;
    float w;
    w = (nl.a > 0.5 ? 1.0 : 0.0) * (1.0 - smoothstep(0.0, 0.85, dl));
    if (w > ga) { ga = w; gc = nl.rgb; }
    w = (nr.a > 0.5 ? 1.0 : 0.0) * (1.0 - smoothstep(0.0, 0.85, dr));
    if (w > ga) { ga = w; gc = nr.rgb; }
    w = (nd.a > 0.5 ? 1.0 : 0.0) * (1.0 - smoothstep(0.0, 0.85, dd));
    if (w > ga) { ga = w; gc = nd.rgb; }
    w = (nu.a > 0.5 ? 1.0 : 0.0) * (1.0 - smoothstep(0.0, 0.85, du));
    if (w > ga) { ga = w; gc = nu.rgb; }
    rgb = gc * 1.3;
    a = ga * 0.3;
  }

  // Tile change animations: flash + fade-in on the tile, expanding ripple around it.
  for (int i = 0; i < ${MAX_TILE_PULSES}; i++) {
    vec4 p = uPulses[i];
    float age = uTime - p.z;
    if (age < 0.0 || age > ${TILE_PULSE_SECONDS.toFixed(2)}) continue;
    float fade = 1.0 - age / ${TILE_PULSE_SECONDS.toFixed(2)};
    float d = distance(px, p.xy + 0.5);
    float ring = smoothstep(1.1, 0.0, abs(d - age * 6.0)) * fade;
    vec3 pcol = p.w > 0.5 ? vec3(1.0, 0.42, 0.22) : vec3(0.5, 1.0, 0.85);
    if (all(lessThan(abs(cell - p.xy), vec2(0.5)))) {
      float flash = 1.0 - smoothstep(0.0, 0.7, age);
      rgb = mix(rgb, vec3(1.0), flash * 0.85);
      if (c.a > 0.5) a = c.a * smoothstep(0.0, 0.2, age);
    }
    rgb = mix(rgb, pcol, ring * 0.85);
    a = max(a, ring * 0.8);
  }

  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface TileLayerMaterial {
  readonly material: THREE.ShaderMaterial;
  readonly pulses: TilePulses;
}

/** Material for one 64x64 chunk layer; shares tileFxTime across all layers. */
export function createTileLayerMaterial(
  texture: THREE.DataTexture,
): TileLayerMaterial {
  const pulses = new TilePulses();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uTime: tileFxTime,
      uPulses: { value: pulses.uniforms },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });
  return { material, pulses };
}
