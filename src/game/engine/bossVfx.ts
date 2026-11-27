import * as THREE from 'three';
import type { EmbervaultEngine } from '../engine';
import { BOSS_CONFIGS, BOSS_NOVA, BOSS_VOLLEY, BossSkillKind, FloorBossKind } from './data';
import { EnemyEntity } from './entities';

// ---------------------------------------------------------------------------------------------------------------
// Procedural GLSL Shaders (Scheme A: pure in-scene shaders + white-hot core + temporary burst PointLight)
// ---------------------------------------------------------------------------------------------------------------

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Slam / Charge landing ground telegraph: crisp outer danger boundary, rotating rune ring, pulsing molten fill. */
const SLAM_TELEGRAPH_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  float outerRing = smoothstep(0.92, 0.96, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float innerBorder = smoothstep(0.76, 0.785, r) * (1.0 - smoothstep(0.795, 0.82, r));

  float aRot = a + uTime * (1.4 + uProgress * 2.8);
  float ticks = step(0.35, fract(aRot * 16.0 / 6.2831853));
  float tickBand = smoothstep(0.81, 0.83, r) * (1.0 - smoothstep(0.91, 0.93, r)) * ticks;

  float spokeAng = abs(fract((a - uTime * 0.45) * 8.0 / 6.2831853 + 0.5) - 0.5);
  float spokes = smoothstep(0.045, 0.012, spokeAng) * smoothstep(0.22, 0.28, r) * (1.0 - smoothstep(0.76, 0.79, r));

  float fillR = mix(0.14, 0.96, uProgress);
  float fillMask = 1.0 - smoothstep(fillR - 0.04, fillR, r);
  float leadingEdge = smoothstep(fillR - 0.08, fillR - 0.01, r) * (1.0 - smoothstep(fillR - 0.01, fillR + 0.02, r));

  float vein = sin(a * 12.0 + r * 14.0 - uTime * 8.0) * 0.5 + 0.5;
  vein = pow(vein, 3.0) * fillMask;

  float pulse = 0.82 + 0.18 * sin(uTime * (14.0 + uProgress * 26.0));
  float hot = smoothstep(0.6, 1.0, uProgress);

  vec3 col = uColor * (
    outerRing * (1.75 * pulse) +
    innerBorder * 0.95 +
    tickBand * 0.8 +
    spokes * 0.6 +
    fillMask * (0.28 + uProgress * 0.26) +
    vein * 0.42 +
    leadingEdge * 1.6
  );
  vec3 whiteHot = vec3(1.0, 0.96, 0.88);
  col += whiteHot * (leadingEdge * (0.55 + hot * 0.95) + outerRing * hot * 0.85);

  float alpha = clamp(
    outerRing * 1.0 +
    innerBorder * 0.7 +
    tickBand * 0.6 +
    spokes * 0.48 +
    fillMask * (0.26 + uProgress * 0.3) +
    leadingEdge * 0.95,
    0.0,
    1.0
  );
  gl_FragColor = vec4(col, alpha);
}
`;

/** Dual-layer polar shockwave ring with turbulent plasma veins and white-hot crest. */
const SHOCKWAVE_FRAG = /* glsl */ `
uniform float uLife;
uniform vec3 uColor;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  float n = noise(vec2(a * 6.0, r * 8.0 - uLife * 10.0));
  float ringWidth = mix(0.3, 0.1, uLife);
  float ringPos = mix(0.24, 0.94, pow(uLife, 0.58));
  float d = abs(r - ringPos + (n - 0.5) * 0.07);

  float outerWave = smoothstep(ringWidth, 0.0, d);
  float razorCore = smoothstep(ringWidth * 0.34, 0.0, d);

  float ring2Pos = max(0.05, ringPos - 0.2);
  float ring2 = smoothstep(0.08, 0.0, abs(r - ring2Pos)) * (1.0 - uLife) * 0.78;

  float fade = pow(1.0 - uLife, 1.25);
  vec3 col = uColor * (outerWave * 1.7 + ring2 * 1.3) + vec3(1.0, 0.97, 0.9) * (razorCore * 1.85 + ring2 * 0.6);
  float alpha = clamp((outerWave * 0.95 + razorCore + ring2) * fade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Procedural Voronoi cracked ground decal (intense molten fissures that cool and dissolve). */
const VORONOI_SCORCH_FRAG = /* glsl */ `
uniform float uLife;
uniform vec3 uColor;
varying vec2 vUv;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float voronoiEdge(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg, mr;
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
      }
    }
  }
  md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 r = g + o - f;
      if (dot(mr - r, mr - r) > 0.0001) {
        md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
      }
    }
  }
  return md;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  float radialMask = 1.0 - smoothstep(mix(0.72, 0.16, uLife), mix(1.0, 0.58, uLife), r);
  if (radialMask <= 0.001) discard;

  float edge = voronoiEdge(p * 4.2);
  float crackWidth = mix(0.13, 0.04, uLife);
  float crack = 1.0 - smoothstep(0.0, crackWidth, edge);
  float coreCrack = 1.0 - smoothstep(0.0, crackWidth * 0.38, edge);

  float centerHeat = exp(-r * r * 3.8) * pow(1.0 - uLife, 1.6);
  float coolFade = pow(1.0 - uLife, 1.05);

  vec3 emberCol = mix(uColor, uColor * 0.55, uLife);
  vec3 hotCore = vec3(1.0, 0.95, 0.74);
  vec3 col = emberCol * (crack * 1.95 + centerHeat * 1.35) + hotCore * (coreCrack * (1.0 - uLife * 0.68) * 1.6 + centerHeat * 1.05);

  float alpha = clamp((crack * 1.0 + centerHeat * 0.72) * radialMask * coolFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Arcane Hexagram (6-pointed star) ground seal for nova_ring windup & aftermath. */
const HEXAGRAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;

float sdEquilateralTriangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  float outerRing = smoothstep(0.92, 0.955, r) * (1.0 - smoothstep(0.98, 1.0, r));
  float midRing = smoothstep(0.75, 0.775, r) * (1.0 - smoothstep(0.79, 0.815, r));
  float innerRing = smoothstep(0.36, 0.38, r) * (1.0 - smoothstep(0.395, 0.415, r));

  float spin = uTime * (0.7 + uProgress * 2.4);
  vec2 rp = rot2(spin) * p;
  float tri1 = abs(sdEquilateralTriangle(rp, 0.68));
  float tri2 = abs(sdEquilateralTriangle(vec2(rp.x, -rp.y), 0.68));
  float hexLines = smoothstep(0.028, 0.008, min(tri1, tri2)) * step(r, 0.79);

  float notch = step(0.45, fract((a - spin * 0.6) * 12.0 / 6.2831853));
  float runeBand = smoothstep(0.81, 0.83, r) * (1.0 - smoothstep(0.91, 0.93, r)) * notch;

  float swirl = sin(a * 6.0 - r * 10.0 + uTime * 8.0) * 0.5 + 0.5;
  float coreGlow = exp(-r * r * mix(6.5, 2.2, uProgress)) * (0.45 + 0.55 * swirl);

  float hot = smoothstep(0.55, 1.0, uProgress);
  vec3 whiteHot = vec3(0.97, 0.96, 1.0);
  vec3 col = uColor * (outerRing * 1.45 + midRing * 1.15 + innerRing * 0.95 + hexLines * 1.65 + runeBand * 0.8 + coreGlow * 1.3);
  col += whiteHot * (hexLines * (0.35 + hot * 0.8) + outerRing * hot * 0.7 + coreGlow * (0.3 + hot * 0.95));

  float alpha = clamp((outerRing * 0.95 + midRing * 0.75 + innerRing * 0.65 + hexLines * 0.95 + runeBand * 0.55 + coreGlow * 0.72) * uFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Directional laser / volley charge telegraph strip on the ground. */
const LASER_CHARGE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  float lat = abs(vUv.x - 0.5) * 2.0;

  float lane = (1.0 - smoothstep(0.65, 1.0, lat)) * (0.14 + uProgress * 0.16);
  float edgeBorder = smoothstep(0.82, 0.92, lat) * (1.0 - smoothstep(0.95, 1.0, lat)) * (0.35 + uProgress * 0.45);

  float wireWidth = mix(0.28, 0.07, uProgress);
  float wire = 1.0 - smoothstep(0.0, wireWidth, lat);

  float pulse = sin(vUv.y * 22.0 - uTime * 24.0) * 0.5 + 0.5;
  pulse = pow(pulse, 2.0);

  float endFade = smoothstep(0.0, 0.03, vUv.y) * (1.0 - smoothstep(0.96, 1.0, vUv.y));
  float hot = smoothstep(0.52, 1.0, uProgress);

  vec3 col = uColor * (lane + edgeBorder * 1.15 + wire * (0.95 + pulse * 0.7))
           + vec3(1.0, 0.98, 1.0) * (wire * (0.5 + hot * 1.35 + pulse * 0.4));

  float alpha = clamp((lane + edgeBorder + wire * (0.78 + uProgress * 0.22)) * endFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Charge path lane with forward-streaming chevrons connecting boss to landing circle. */
const CHARGE_PATH_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  float lat = abs(vUv.x - 0.5) * 2.0;
  float edge = smoothstep(0.84, 0.94, lat) * (1.0 - smoothstep(0.96, 1.0, lat));
  float fill = (1.0 - smoothstep(0.7, 1.0, lat)) * (0.14 + uProgress * 0.16);

  // Forward-streaming V-shaped chevrons pointing toward landing zone (vUv.y = 1)
  float chevCoord = vUv.y * 5.5 - uTime * (4.5 + uProgress * 4.0) - lat * 0.55;
  float chev = smoothstep(0.18, 0.02, abs(fract(chevCoord) - 0.5)) * (1.0 - smoothstep(0.75, 0.92, lat));

  float endFade = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
  float hot = smoothstep(0.55, 1.0, uProgress);

  vec3 col = uColor * (fill + edge * 1.4 + chev * 1.55) + vec3(1.0, 0.96, 0.85) * (chev * (0.35 + hot * 0.7) + edge * hot * 0.5);
  float alpha = clamp((fill + edge * 0.85 + chev * 0.9) * endFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Outer plasma/arcane energy sheath wrapped around the bright white 3D laser beam cylinder. */
const LASER_SHEATH_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  float stream1 = sin(vUv.y * 28.0 - uTime * 38.0 + sin(vUv.x * 12.566) * 1.2) * 0.5 + 0.5;
  float stream2 = sin(vUv.y * 56.0 - uTime * 56.0 - vUv.x * 18.849) * 0.5 + 0.5;
  float energy = 0.55 + 0.3 * stream1 + 0.25 * pow(stream2, 2.0);

  float endFade = smoothstep(0.0, 0.02, vUv.y) * (1.0 - smoothstep(0.98, 1.0, vUv.y));
  vec3 col = mix(uColor, vec3(1.0, 0.98, 1.0), 0.42 + 0.35 * stream2) * energy * 1.6;
  float alpha = clamp(energy * uIntensity * endFade * 0.84, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Ground light-bleed & scorch strip beneath each fired laser beam. */
const LASER_FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uScorch;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  float lat = abs(vUv.x - 0.5) * 2.0;
  float core = exp(-lat * lat * 16.0);
  float halo = exp(-lat * lat * 3.4);
  float shimmer = 0.85 + 0.15 * sin(vUv.y * 30.0 - uTime * 34.0);
  float endFade = smoothstep(0.0, 0.03, vUv.y) * (1.0 - smoothstep(0.96, 1.0, vUv.y));

  vec3 col = uColor * halo * (1.0 + uScorch * 0.4) + vec3(1.0, 0.98, 1.0) * core * (1.4 * (1.0 - uScorch * 0.75));
  float alpha = clamp((halo * 0.55 + core * 0.88) * shimmer * uIntensity * endFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Soft radial core flash / impact flare (pure white center -> theme color halo). */
const CORE_FLASH_FRAG = /* glsl */ `
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  float core = exp(-r * r * 12.0);
  float halo = exp(-r * r * 3.2);
  float star = exp(-abs(p.x) * 14.0) * exp(-abs(p.y) * 2.2) + exp(-abs(p.y) * 14.0) * exp(-abs(p.x) * 2.2);
  star *= 0.55 * (1.0 - r);

  vec3 col = uColor * halo * 1.35 + vec3(1.0, 0.98, 0.94) * (core * 2.1 + star * 1.45);
  float alpha = clamp((core + halo * 0.72 + star) * uIntensity, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Black Hole Accretion Disk Shader (inspired by video's 00:48-00:54 Void Black Hole!). */
const ACCRETION_DISK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 || r < 0.24) discard;
  float a = atan(p.y, p.x);

  // Swirling spiral accretion bands pulling inward
  float swirl1 = sin(a * 3.0 + r * 16.0 - uTime * (7.0 + uProgress * 9.0)) * 0.5 + 0.5;
  float swirl2 = sin(a * 7.0 - r * 24.0 + uTime * 11.0) * 0.5 + 0.5;
  float bands = 0.45 + 0.35 * swirl1 + 0.25 * pow(swirl2, 2.0);

  // Event horizon blazing white-gold inner rim + purple/theme outer disk
  float innerRim = smoothstep(0.42, 0.26, r) * smoothstep(0.24, 0.28, r);
  float outerFade = 1.0 - smoothstep(0.62, 1.0, r);
  float outerEdge = smoothstep(0.86, 0.94, r) * (1.0 - smoothstep(0.96, 1.0, r));

  vec3 goldWhite = vec3(1.0, 0.95, 0.82);
  vec3 deepVoid = mix(uColor, vec3(0.58, 0.14, 0.95), 0.55);
  vec3 col = deepVoid * bands * outerFade * 1.45 + goldWhite * (innerRim * 2.2 + swirl1 * innerRim * 0.8) + uColor * outerEdge * 1.1;

  float alpha = clamp((bands * outerFade * 0.9 + innerRim * 1.2 + outerEdge * 0.6) * uFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Black Hole Ground Gravity Well & Galaxy Collapse Vortex (windup + aftermath). */
const GRAVITY_WELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uFade;
uniform float uBurst;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  // Crisp outer danger boundary during windup
  float outerRing = smoothstep(0.92, 0.96, r) * (1.0 - smoothstep(0.985, 1.0, r)) * (1.0 - uBurst * 0.65);

  // Spiraling galaxy vortex arms
  float arms = sin(a * 4.0 + r * mix(10.0, 16.0, uBurst) - uTime * (5.5 + uProgress * 7.0)) * 0.5 + 0.5;
  float fine = sin(a * 9.0 + r * 22.0 - uTime * 9.0) * 0.5 + 0.5;
  float spiral = pow(arms, 1.8) * 0.75 + pow(fine, 3.0) * 0.35;

  // Radial gravity grid rings pulling inward
  float gridRings = smoothstep(0.12, 0.02, abs(fract(r * 4.0 + uTime * 1.8) - 0.5)) * (1.0 - uBurst);
  float radialFade = (1.0 - smoothstep(0.65, 1.0, r));

  vec3 voidCol = mix(uColor, vec3(0.62, 0.2, 1.0), 0.5);
  vec3 goldCore = vec3(1.0, 0.92, 0.74);
  float centerGold = exp(-r * r * mix(7.0, 2.8, uBurst));

  vec3 col = voidCol * (outerRing * 1.65 + spiral * radialFade * 1.45 + gridRings * radialFade * 0.55)
           + goldCore * (centerGold * (0.5 + uProgress * 0.7 + uBurst * 1.2) + outerRing * smoothstep(0.6, 1.0, uProgress) * 0.8);

  float alpha = clamp((outerRing * 0.98 + spiral * radialFade * 0.82 + gridRings * radialFade * 0.35 + centerGold * 0.75) * uFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------------------------------------------------------
// Runtime VFX Tracking Structures
// ---------------------------------------------------------------------------------------------------------------

export interface BossBeamSpec {
  angle: number;
  dirX: number;
  dirZ: number;
  length: number;
  hitWall: boolean;
}

export interface BossVfxInstance {
  group: THREE.Group;
  life: number;
  maxLife: number;
  update: (dt: number, t: number, elapsed: number) => void;
  dispose: () => void;
}

export interface BossWindupRig {
  skill: BossSkillKind;
  group: THREE.Group;
  groundMat: THREE.ShaderMaterial;
  // nova_ring laser charge elements
  chargeOrb?: THREE.Mesh;
  chargeRing?: THREE.Mesh;
  beamGroup?: THREE.Group;
  beamLines?: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial }>;
  beamAnglesKey?: string;
  // targeted_blast black hole elements
  singularity?: THREE.Mesh;
  accretionDisk?: THREE.Mesh;
  accretionMat?: THREE.ShaderMaterial;
  infallBeam?: THREE.Mesh;
  // charge_slam path strip
  chargePathMesh?: THREE.Mesh;
  chargePathMat?: THREE.ShaderMaterial;
  // ranged_volley railgun gate + 3 fan lines
  volleyGroup?: THREE.Group;
  volleyLines?: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial }>;
  volleyGate?: THREE.Mesh;
}

const _unitPlaneGeo = new THREE.PlaneGeometry(2, 2);
const _unitBeamFloorGeo = new THREE.PlaneGeometry(1, 1);
const _unitCylGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
const _unitCoreCylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
const _unitSphereGeo = new THREE.SphereGeometry(1, 16, 12);
const _unitTorusGeo = new THREE.TorusGeometry(1, 0.075, 10, 42);
const _unitHexGateGeo = new THREE.RingGeometry(0.62, 0.85, 6);
const _unitSpikeGeo = new THREE.ConeGeometry(0.27, 1.35, 5);
const _unitPuffGeo = new THREE.IcosahedronGeometry(0.42, 1);

function disposeOwnedMaterials(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Engine Methods (mounted onto EmbervaultEngine.prototype)
// ---------------------------------------------------------------------------------------------------------------

export const bossVfxMethods = {
  /** Raycast along (dirX, dirZ) from (ox, oz) until hitting a dungeon wall or maxRange. */
  raycastBossBeam(
    this: EmbervaultEngine,
    ox: number,
    oz: number,
    dirX: number,
    dirZ: number,
    maxRange: number
  ): { dist: number; hitWall: boolean } {
    const step = 0.25;
    let d = 0.45;
    while (d < maxRange) {
      if (this.isPointInWall(ox + dirX * d, oz + dirZ * d)) {
        let lo = Math.max(0.2, d - step);
        let hi = d;
        for (let i = 0; i < 4; i++) {
          const mid = (lo + hi) * 0.5;
          if (this.isPointInWall(ox + dirX * mid, oz + dirZ * mid)) hi = mid;
          else lo = mid;
        }
        return { dist: lo, hitWall: true };
      }
      d += step;
    }
    return { dist: maxRange, hitWall: false };
  },

  /** Compute the N radial laser beams for a boss's nova_ring at (ox, oz) with base angle `baseAngle`. */
  computeNovaBeams(
    this: EmbervaultEngine,
    ox: number,
    oz: number,
    baseAngle: number
  ): BossBeamSpec[] {
    const count = this.depth >= BOSS_NOVA.deepFromDepth ? BOSS_NOVA.beamsDeep : BOSS_NOVA.beams;
    const beams: BossBeamSpec[] = [];
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (i / count) * Math.PI * 2;
      const dirX = Math.sin(angle);
      const dirZ = Math.cos(angle);
      const hit = this.raycastBossBeam(ox, oz, dirX, dirZ, BOSS_NOVA.beamMaxRange);
      beams.push({ angle, dirX, dirZ, length: hit.dist, hitWall: hit.hitWall });
    }
    return beams;
  },

  /** Trigger a short high-intensity dynamic PointLight burst that illuminates surrounding dungeon walls & floor. */
  triggerBossBurstLight(
    this: EmbervaultEngine,
    x: number,
    y: number,
    z: number,
    colorHex: number,
    intensity: number,
    duration: number
  ): void {
    if (this.bgSim || this.isSoftwareGl || !this.scene) return;
    if (!this.bossBurstLight) {
      this.bossBurstLight = new THREE.PointLight(colorHex, 0, 18, 1.65);
      this.bossBurstLight.position.set(0, -10, 0);
      this.scene.add(this.bossBurstLight);
    }
    this.bossBurstLight.color.setHex(colorHex);
    this.bossBurstLight.position.set(x, y, z);
    this.bossBurstLight.intensity = intensity;
    this.bossBurstLightMax = intensity;
    this.bossBurstLightTimer = duration;
    this.bossBurstLightDur = duration;
  },

  /** Hide a boss's custom shader windup telegraph. */
  hideBossWindupVfx(this: EmbervaultEngine, enemyId: number): void {
    const rig = this.bossWindupRigs.get(enemyId);
    if (rig) rig.group.visible = false;
  },

  /**
   * Update (or lazily create) the enhanced shader windup telegraph for ALL 5 boss skills:
   * - `slam`: rotating molten rune circle + inward embers
   * - `charge_slam`: landing rune circle + streaming chevron charge corridor from boss to landing spot
   * - `nova_ring`: rotating hexagram + gathering core orb + 6/8 wall-clamped laser charge lanes
   * - `targeted_blast`: Void Black Hole gravity well + hovering pitch-black singularity + swirling accretion disk
   * - `ranged_volley`: boss focus ring + 3 fan laser-sight tracks + floating railgun hex gate
   */
  updateBossWindupVfx(
    this: EmbervaultEngine,
    e: EnemyEntity,
    skill: BossSkillKind,
    tx: number,
    tz: number,
    rad: number,
    progress: number,
    baseAngle: number
  ): boolean {
    if (this.bgSim) return false;
    const cfg = BOSS_CONFIGS[e.kind as FloorBossKind];
    const color = new THREE.Color(cfg.telegraphColor);

    let rig = this.bossWindupRigs.get(e.id);
    if (!rig || rig.skill !== skill) {
      if (rig) {
        this.dynamicGroup.remove(rig.group);
        disposeOwnedMaterials(rig.group);
      }
      const group = new THREE.Group();

      const frag =
        skill === 'nova_ring'
          ? HEXAGRAM_FRAG
          : skill === 'targeted_blast'
          ? GRAVITY_WELL_FRAG
          : SLAM_TELEGRAPH_FRAG;

      const groundMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: frag,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uFade: { value: 1 },
          uBurst: { value: 0 },
          uColor: { value: color.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const groundMesh = new THREE.Mesh(_unitPlaneGeo, groundMat);
      groundMesh.rotation.x = -Math.PI / 2;
      groundMesh.position.y = 0.055;
      group.add(groundMesh);

      rig = { skill, group, groundMat };

      if (skill === 'nova_ring') {
        const orbMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const orb = new THREE.Mesh(_unitSphereGeo, orbMat);
        orb.position.y = 1.05;
        group.add(orb);

        const ringMat = new THREE.MeshBasicMaterial({
          color: cfg.telegraphColor,
          transparent: true,
          opacity: 0.88,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(_unitTorusGeo, ringMat);
        ring.position.y = 1.05;
        ring.rotation.x = Math.PI / 2;
        group.add(ring);

        const beamGroup = new THREE.Group();
        group.add(beamGroup);

        rig.chargeOrb = orb;
        rig.chargeRing = ring;
        rig.beamGroup = beamGroup;
        rig.beamLines = [];
      } else if (skill === 'targeted_blast') {
        // Pitch-black void singularity hovering above the target
        const singMat = new THREE.MeshBasicMaterial({
          color: 0x020105,
        });
        const singularity = new THREE.Mesh(_unitSphereGeo, singMat);
        singularity.position.y = 1.35;
        group.add(singularity);

        // Tilted glowing accretion disk around the singularity
        const accMat = new THREE.ShaderMaterial({
          vertexShader: QUAD_VERT,
          fragmentShader: ACCRETION_DISK_FRAG,
          uniforms: {
            uTime: { value: 0 },
            uProgress: { value: 0 },
            uFade: { value: 1 },
            uColor: { value: color.clone() },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const accretionDisk = new THREE.Mesh(_unitPlaneGeo, accMat);
        accretionDisk.position.y = 1.35;
        accretionDisk.rotation.set(-Math.PI / 2 + 0.34, 0, 0.2);
        group.add(accretionDisk);

        // Thin vertical gravitational infall filament feeding the singularity from above
        const infallMat = new THREE.MeshBasicMaterial({
          color: 0xf4dcff,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const infallBeam = new THREE.Mesh(_unitCoreCylGeo, infallMat);
        infallBeam.position.y = 4.2;
        infallBeam.scale.set(0.06, 5.6, 0.06);
        group.add(infallBeam);

        rig.singularity = singularity;
        rig.accretionDisk = accretionDisk;
        rig.accretionMat = accMat;
        rig.infallBeam = infallBeam;
      } else if (skill === 'charge_slam') {
        const pathMat = new THREE.ShaderMaterial({
          vertexShader: QUAD_VERT,
          fragmentShader: CHARGE_PATH_FRAG,
          uniforms: {
            uTime: { value: 0 },
            uProgress: { value: 0 },
            uColor: { value: color.clone() },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        });
        const pathMesh = new THREE.Mesh(_unitBeamFloorGeo, pathMat);
        pathMesh.rotation.order = 'YXZ';
        pathMesh.rotation.x = Math.PI / 2;
        group.add(pathMesh);
        rig.chargePathMesh = pathMesh;
        rig.chargePathMat = pathMat;
      } else if (skill === 'ranged_volley') {
        const volleyGroup = new THREE.Group();
        group.add(volleyGroup);
        const volleyLines: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial }> = [];
        for (let i = 0; i < BOSS_VOLLEY.spread.length; i++) {
          const mat = new THREE.ShaderMaterial({
            vertexShader: QUAD_VERT,
            fragmentShader: LASER_CHARGE_FRAG,
            uniforms: {
              uTime: { value: 0 },
              uProgress: { value: 0 },
              uColor: { value: color.clone() },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
          });
          const mesh = new THREE.Mesh(_unitBeamFloorGeo, mat);
          mesh.rotation.order = 'YXZ';
          mesh.rotation.x = Math.PI / 2;
          volleyGroup.add(mesh);
          volleyLines.push({ mesh, mat });
        }
        // Floating hexagonal railgun gate in front of boss
        const gateMat = new THREE.MeshBasicMaterial({
          color: cfg.telegraphColor,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const gate = new THREE.Mesh(_unitHexGateGeo, gateMat);
        gate.position.y = 1.05;
        volleyGroup.add(gate);

        rig.volleyGroup = volleyGroup;
        rig.volleyLines = volleyLines;
        rig.volleyGate = gate;
      }

      this.dynamicGroup.add(group);
      this.bossWindupRigs.set(e.id, rig);
    }

    rig.group.visible = true;
    rig.group.position.set(tx, 0, tz);
    rig.groundMat.uniforms.uTime.value = this.elapsed;
    rig.groundMat.uniforms.uProgress.value = progress;
    rig.groundMat.uniforms.uFade.value = 1;
    rig.groundMat.uniforms.uBurst.value = 0;
    rig.group.children[0].scale.setScalar(rad);

    if (skill === 'slam') {
      if (!this.isSoftwareGl && Math.random() < 0.5 + progress * 0.45) {
        const a = Math.random() * Math.PI * 2;
        const dist = rad * (0.55 + Math.random() * 0.45);
        this.spawnParticle(
          tx + Math.cos(a) * dist,
          0.18,
          tz + Math.sin(a) * dist,
          -Math.cos(a) * 2.5,
          1.5 + Math.random() * 1.5,
          -Math.sin(a) * 2.5,
          progress > 0.6 ? 0xffe8a0 : cfg.telegraphColor,
          0.75 + progress * 0.45,
          0.32,
          -0.6
        );
      }
    } else if (skill === 'charge_slam' && rig.chargePathMesh && rig.chargePathMat) {
      const sx = e.bossChargeStartX ?? e.x;
      const sz = e.bossChargeStartZ ?? e.z;
      const dx = tx - sx;
      const dz = tz - sz;
      const len = Math.hypot(dx, dz);
      if (len > 0.35) {
        rig.chargePathMesh.visible = true;
        const ang = Math.atan2(dx, dz);
        rig.chargePathMesh.rotation.y = ang;
        // Positioned in rig-local space (rig is at tx, tz, so start is at -dx, -dz)
        rig.chargePathMesh.position.set(-dx * 0.5, 0.062, -dz * 0.5);
        rig.chargePathMesh.scale.set(1.35, len, 1);
        rig.chargePathMat.uniforms.uTime.value = this.elapsed;
        rig.chargePathMat.uniforms.uProgress.value = progress;
      } else {
        rig.chargePathMesh.visible = false;
      }
    } else if (skill === 'nova_ring' && rig.beamGroup && rig.beamLines && rig.chargeOrb && rig.chargeRing) {
      const orbScale = 0.16 + progress * 0.44 + Math.sin(this.elapsed * 34) * 0.03;
      rig.chargeOrb.scale.setScalar(orbScale);
      const ringScale = THREE.MathUtils.lerp(1.55, 0.45, progress);
      rig.chargeRing.scale.setScalar(ringScale);
      rig.chargeRing.rotation.z = this.elapsed * (3.5 + progress * 7);
      rig.chargeRing.rotation.x = Math.PI / 2 + Math.sin(this.elapsed * 5) * 0.35;

      const beams = this.computeNovaBeams(tx, tz, baseAngle);
      const key = `${Math.round(tx * 10)}:${Math.round(tz * 10)}:${Math.round(baseAngle * 100)}:${beams.length}`;
      if (rig.beamAnglesKey !== key) {
        rig.beamAnglesKey = key;
        while (rig.beamGroup.children.length > 0) {
          const c = rig.beamGroup.children[0];
          rig.beamGroup.remove(c);
          disposeOwnedMaterials(c);
        }
        rig.beamLines = [];
        for (const b of beams) {
          const mat = new THREE.ShaderMaterial({
            vertexShader: QUAD_VERT,
            fragmentShader: LASER_CHARGE_FRAG,
            uniforms: {
              uTime: { value: this.elapsed },
              uProgress: { value: progress },
              uColor: { value: color.clone() },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
          });
          const mesh = new THREE.Mesh(_unitBeamFloorGeo, mat);
          mesh.rotation.order = 'YXZ';
          mesh.rotation.y = b.angle;
          mesh.rotation.x = Math.PI / 2;
          const laneWidth = BOSS_NOVA.beamHalfWidth * 2.0;
          mesh.scale.set(laneWidth, b.length, 1);
          mesh.position.set(b.dirX * (b.length * 0.5), 0.065, b.dirZ * (b.length * 0.5));
          rig.beamGroup.add(mesh);
          rig.beamLines.push({ mesh, mat });
        }
      }
      for (const bl of rig.beamLines) {
        bl.mat.uniforms.uTime.value = this.elapsed;
        bl.mat.uniforms.uProgress.value = progress;
      }

      if (!this.isSoftwareGl && Math.random() < 0.65) {
        const a = Math.random() * Math.PI * 2;
        const d = 1.6 + Math.random() * 1.6;
        this.spawnParticle(
          tx + Math.cos(a) * d,
          0.95 + (Math.random() - 0.5) * 0.6,
          tz + Math.sin(a) * d,
          -Math.cos(a) * 4.5,
          (Math.random() - 0.5) * 1.2,
          -Math.sin(a) * 4.5,
          Math.random() < 0.55 ? 0xffffff : cfg.telegraphColor,
          0.65,
          0.26,
          0
        );
      }
    } else if (
      skill === 'targeted_blast' &&
      rig.singularity &&
      rig.accretionDisk &&
      rig.accretionMat &&
      rig.infallBeam
    ) {
      // Singularity grows quickly then pinches slightly right before detonation!
      const grow = Math.min(1, progress * 1.35);
      const pinch = progress > 0.85 ? 1 - ((progress - 0.85) / 0.15) * 0.3 : 1;
      rig.singularity.scale.setScalar((0.22 + grow * 0.52) * pinch);
      rig.accretionDisk.scale.setScalar((0.6 + grow * (rad * 0.72)) * pinch);
      rig.accretionDisk.rotation.z = this.elapsed * (1.8 + progress * 4.5);
      rig.accretionMat.uniforms.uTime.value = this.elapsed;
      rig.accretionMat.uniforms.uProgress.value = progress;
      rig.accretionMat.uniforms.uFade.value = Math.min(1, progress * 3.0);

      const infallW = 0.03 + progress * 0.08;
      rig.infallBeam.scale.set(infallW, 5.6, infallW);
      (rig.infallBeam.material as THREE.MeshBasicMaterial).opacity = 0.35 + progress * 0.55;

      // Spiraling void particles sucked into the black hole core
      if (!this.isSoftwareGl && Math.random() < 0.75) {
        const a = Math.random() * Math.PI * 2;
        const d = rad * (0.75 + Math.random() * 0.55);
        this.spawnParticle(
          tx + Math.cos(a) * d,
          0.4 + Math.random() * 1.4,
          tz + Math.sin(a) * d,
          -Math.cos(a) * 5.2 - Math.sin(a) * 2.2,
          (1.35 - 0.7) * 1.8,
          -Math.sin(a) * 5.2 + Math.cos(a) * 2.2,
          Math.random() < 0.4 ? 0xf6d8ff : 0x9b4dff,
          0.72,
          0.32,
          0
        );
      }
    } else if (skill === 'ranged_volley' && rig.volleyLines && rig.volleyGate) {
      const aimAngle = e.facing;
      const locked = progress >= BOSS_VOLLEY.aimTrackFraction;
      for (let i = 0; i < BOSS_VOLLEY.spread.length; i++) {
        const ang = aimAngle + BOSS_VOLLEY.spread[i];
        const dx = Math.sin(ang);
        const dz = Math.cos(ang);
        const hit = this.raycastBossBeam(tx, tz, dx, dz, 9.5);
        const bl = rig.volleyLines[i];
        bl.mesh.rotation.y = ang;
        bl.mesh.scale.set(locked ? 0.52 : 0.68, hit.dist, 1);
        bl.mesh.position.set(dx * (hit.dist * 0.5), 0.065, dz * (hit.dist * 0.5));
        bl.mat.uniforms.uTime.value = this.elapsed;
        bl.mat.uniforms.uProgress.value = locked ? Math.min(1, 0.55 + progress * 0.45) : progress * 0.55;
      }
      const gx = Math.sin(aimAngle) * 1.15;
      const gz = Math.cos(aimAngle) * 1.15;
      rig.volleyGate.position.set(gx, 1.05, gz);
      rig.volleyGate.rotation.y = aimAngle;
      rig.volleyGate.rotation.z = this.elapsed * (locked ? 6.5 : 2.5);
      const gs = 0.55 + progress * 0.65;
      rig.volleyGate.scale.setScalar(gs);
      (rig.volleyGate.material as THREE.MeshBasicMaterial).color.setHex(locked ? 0xffffff : cfg.telegraphColor);
    }

    return true;
  },

  /**
   * Upgraded `slam` / `charge_slam` landing impact VFX:
   * - Intense white-hot core flash + high-power temporary dynamic PointLight
   * - Dual-layer polar turbulent shockwave + rising outer shock torus
   * - 16 staggered 3D erupting shattered rock/molten spikes
   * - Rolling ember dust ring + radial spark fountain
   * - Richer procedural Voronoi cracked molten ground decal (2.0s aftermath)
   */
  spawnBossSlamVfx(
    this: EmbervaultEngine,
    cx: number,
    cz: number,
    rad: number,
    colorHex: number
  ): void {
    if (this.bgSim) return;
    const color = new THREE.Color(colorHex);
    const group = new THREE.Group();
    group.position.set(cx, 0, cz);

    // 1. High-power burst PointLight
    this.triggerBossBurstLight(cx, 1.85, cz, colorHex, 165, 0.52);

    // 2. White-hot core flash
    const flashMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: CORE_FLASH_FRAG,
      uniforms: {
        uIntensity: { value: 1.0 },
        uColor: { value: color.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flashMesh = new THREE.Mesh(_unitPlaneGeo, flashMat);
    flashMesh.rotation.x = -Math.PI / 2;
    flashMesh.position.y = 0.25;
    flashMesh.scale.setScalar(rad * 1.65);
    group.add(flashMesh);

    // 3. Polar turbulent shockwave ring
    const waveMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SHOCKWAVE_FRAG,
      uniforms: {
        uLife: { value: 0 },
        uColor: { value: color.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const waveMesh = new THREE.Mesh(_unitPlaneGeo, waveMat);
    waveMesh.rotation.x = -Math.PI / 2;
    waveMesh.position.y = 0.15;
    waveMesh.scale.setScalar(rad * 0.45);
    group.add(waveMesh);

    // 4. Elevated 3D shockwave torus ring (gives dramatic vertical punch)
    const shockTorusMat = new THREE.MeshBasicMaterial({
      color: 0xfff0cc,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shockTorus = new THREE.Mesh(_unitTorusGeo, shockTorusMat);
    shockTorus.rotation.x = Math.PI / 2;
    shockTorus.position.y = 0.25;
    group.add(shockTorus);

    // 5. Procedural Voronoi cracked molten ground decal (2.0s aftermath)
    const scorchMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: VORONOI_SCORCH_FRAG,
      uniforms: {
        uLife: { value: 0 },
        uColor: { value: color.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const scorchMesh = new THREE.Mesh(_unitPlaneGeo, scorchMat);
    scorchMesh.rotation.x = -Math.PI / 2;
    scorchMesh.position.y = 0.048;
    scorchMesh.scale.setScalar(rad * 1.24);
    group.add(scorchMesh);

    // 6. Staggered 3D erupting shattered rock/molten spikes around the perimeter
    const spikeCount = this.isSoftwareGl ? 7 : 16;
    const spikes: Array<{ mesh: THREE.Mesh; delay: number; maxH: number }> = [];
    for (let i = 0; i < spikeCount; i++) {
      const a = (i / spikeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const dist = rad * (0.64 + Math.random() * 0.34);
      const isHot = i % 2 === 0;
      const mat = new THREE.MeshStandardMaterial({
        color: isHot ? 0x341916 : 0x1e1822,
        emissive: colorHex,
        emissiveIntensity: isHot ? 1.75 : 0.85,
        roughness: 0.68,
        metalness: 0.18,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(_unitSpikeGeo, mat);
      mesh.position.set(Math.cos(a) * dist, -0.5, Math.sin(a) * dist);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
      mesh.rotation.x = 0.2 + Math.random() * 0.28;
      const wScale = 0.9 + Math.random() * 0.6;
      const maxH = 0.95 + Math.random() * 0.85;
      mesh.scale.set(wScale, 0.01, wScale);
      group.add(mesh);
      spikes.push({ mesh, delay: (i % 3) * 0.022, maxH });
    }

    // 7. Outer rolling dust / ember billows
    const puffCount = this.isSoftwareGl ? 0 : 14;
    const puffs: Array<{ mesh: THREE.Mesh; dirX: number; dirZ: number; startR: number; spd: number }> = [];
    for (let i = 0; i < puffCount; i++) {
      const a = (i / puffCount) * Math.PI * 2 + Math.random() * 0.25;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? colorHex : 0x452822,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(_unitPuffGeo, mat);
      const startR = rad * 0.52;
      mesh.position.set(Math.cos(a) * startR, 0.28, Math.sin(a) * startR);
      mesh.scale.setScalar(0.55);
      group.add(mesh);
      puffs.push({ mesh, dirX: Math.cos(a), dirZ: Math.sin(a), startR, spd: 2.6 + Math.random() * 1.6 });
    }

    // 8. Dramatic radial spark shower
    const sparkCount = this.isSoftwareGl ? 14 : 38;
    for (let i = 0; i < sparkCount; i++) {
      const a = (i / sparkCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.16;
      const spd = 3.8 + Math.random() * 5.6;
      this.spawnParticle(
        cx + Math.cos(a) * rad * 0.35,
        0.3,
        cz + Math.sin(a) * rad * 0.35,
        Math.cos(a) * spd,
        2.8 + Math.random() * 4.0,
        Math.sin(a) * spd,
        i % 3 === 0 ? 0xfff2ba : colorHex,
        1.4,
        0.58,
        8.8
      );
    }

    this.dynamicGroup.add(group);
    const maxLife = 2.0;
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt) => {
        const age = (group.userData.age = (group.userData.age ?? 0) + dt);

        const ft = Math.min(1, age / 0.22);
        flashMesh.visible = ft < 1;
        if (ft < 1) {
          flashMat.uniforms.uIntensity.value = Math.pow(1 - ft, 1.5);
          flashMesh.scale.setScalar(rad * (1.05 + ft * 1.0));
        }

        const wt = Math.min(1, age / 0.46);
        waveMesh.visible = wt < 1;
        if (wt < 1) {
          waveMat.uniforms.uLife.value = wt;
          const ease = 1 - Math.pow(1 - wt, 2.3);
          waveMesh.scale.setScalar(rad * (0.48 + ease * 1.32));
        }

        const tt = Math.min(1, age / 0.38);
        shockTorus.visible = tt < 1;
        if (tt < 1) {
          const ease = 1 - Math.pow(1 - tt, 2.2);
          shockTorus.scale.setScalar(rad * (0.28 + ease * 1.18));
          shockTorus.position.y = 0.22 + ease * 0.65;
          shockTorusMat.opacity = (1 - tt) * 0.92;
        }

        scorchMat.uniforms.uLife.value = Math.min(1, age / maxLife);

        for (const sp of spikes) {
          const sa = age - sp.delay;
          if (sa <= 0 || sa >= 0.95) {
            sp.mesh.visible = false;
            continue;
          }
          sp.mesh.visible = true;
          const mat = sp.mesh.material as THREE.MeshStandardMaterial;
          if (sa < 0.13) {
            const p = sa / 0.13;
            const overshoot = 1 + Math.sin(p * Math.PI) * 0.26;
            const h = sp.maxH * p * overshoot;
            sp.mesh.scale.y = Math.max(0.05, h);
            sp.mesh.position.y = h * 0.44;
            mat.emissiveIntensity = 2.1;
          } else {
            const p = (sa - 0.13) / 0.82;
            const sink = 1 - Math.pow(p, 1.8);
            const h = sp.maxH * sink;
            sp.mesh.scale.y = Math.max(0.02, h);
            sp.mesh.position.y = h * 0.44 - p * 0.16;
            mat.emissiveIntensity = 1.45 * (1 - p);
            mat.opacity = 1 - Math.pow(p, 2.2);
          }
        }

        const pt = Math.min(1, age / 0.72);
        for (const pf of puffs) {
          pf.mesh.visible = pt < 1;
          if (pt < 1) {
            const ease = 1 - Math.pow(1 - pt, 2.0);
            const r = pf.startR + ease * pf.spd * 0.72;
            pf.mesh.position.set(pf.dirX * r, 0.28 + ease * 0.38, pf.dirZ * r);
            pf.mesh.scale.setScalar(0.6 + ease * 1.25);
            pf.mesh.rotation.y += dt * 2.4;
            (pf.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - pt) * 0.52;
          }
        }
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeOwnedMaterials(group);
      },
    });
  },

  /**
   * Upgraded `nova_ring` bright-white radial laser burst VFX:
   * - Longer sustain (+0.3s: 0.78s active beam visual) & sleeker, sharper beam thickness
   * - Multi-layered pure-white core + scrolling plasma sheath + floor glow/scorch + wall impact flares
   * - Twin tilted intersecting arcane energy rings + lingering hexagram aftermath
   */
  spawnBossNovaLaserVfx(
    this: EmbervaultEngine,
    ox: number,
    oz: number,
    rad: number,
    beams: BossBeamSpec[],
    colorHex: number
  ): void {
    if (this.bgSim) return;
    const color = new THREE.Color(colorHex);
    const group = new THREE.Group();
    group.position.set(ox, 0, oz);

    const burstColor = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.55).getHex();
    this.triggerBossBurstLight(ox, 1.6, oz, burstColor, 150, 0.72);

    const flashMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: CORE_FLASH_FRAG,
      uniforms: {
        uIntensity: { value: 1.0 },
        uColor: { value: color.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flashMesh = new THREE.Mesh(_unitPlaneGeo, flashMat);
    flashMesh.rotation.x = -Math.PI / 2;
    flashMesh.position.y = 0.95;
    flashMesh.scale.setScalar(rad * 1.35);
    group.add(flashMesh);

    const hexMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: HEXAGRAM_FRAG,
      uniforms: {
        uTime: { value: this.elapsed },
        uProgress: { value: 1.0 },
        uFade: { value: 0.9 },
        uColor: { value: color.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const hexMesh = new THREE.Mesh(_unitPlaneGeo, hexMat);
    hexMesh.rotation.x = -Math.PI / 2;
    hexMesh.position.y = 0.052;
    hexMesh.scale.setScalar(rad);
    group.add(hexMesh);

    const ringMatA = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringA = new THREE.Mesh(_unitTorusGeo, ringMatA);
    ringA.position.y = 0.95;
    ringA.rotation.set(Math.PI / 2 + 0.45, 0.3, 0);
    group.add(ringA);

    const ringMatB = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringB = new THREE.Mesh(_unitTorusGeo, ringMatB);
    ringB.position.y = 0.95;
    ringB.rotation.set(Math.PI / 2 - 0.45, -0.3, 0);
    group.add(ringB);

    const beamY = 0.95;
    const coreRadius = BOSS_NOVA.beamHalfWidth * 0.44;
    const sheathRadius = BOSS_NOVA.beamHalfWidth * 0.98;
    const beamEntries: Array<{
      core: THREE.Mesh;
      coreMat: THREE.MeshBasicMaterial;
      sheath: THREE.Mesh;
      sheathMat: THREE.ShaderMaterial;
      floorMat: THREE.ShaderMaterial;
      wallFlare?: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
    }> = [];

    for (const b of beams) {
      const midX = b.dirX * (b.length * 0.5);
      const midZ = b.dirZ * (b.length * 0.5);

      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const core = new THREE.Mesh(_unitCoreCylGeo, coreMat);
      core.rotation.order = 'YXZ';
      core.rotation.y = b.angle;
      core.rotation.x = Math.PI / 2;
      core.position.set(midX, beamY, midZ);
      core.scale.set(coreRadius, b.length, coreRadius);
      group.add(core);

      const sheathMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: LASER_SHEATH_FRAG,
        uniforms: {
          uTime: { value: this.elapsed },
          uIntensity: { value: 1.0 },
          uColor: { value: color.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const sheath = new THREE.Mesh(_unitCylGeo, sheathMat);
      sheath.rotation.order = 'YXZ';
      sheath.rotation.y = b.angle;
      sheath.rotation.x = Math.PI / 2;
      sheath.position.set(midX, beamY, midZ);
      sheath.scale.set(sheathRadius, b.length, sheathRadius);
      group.add(sheath);

      const floorMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: LASER_FLOOR_FRAG,
        uniforms: {
          uTime: { value: this.elapsed },
          uIntensity: { value: 1.0 },
          uScorch: { value: 0.0 },
          uColor: { value: color.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const floorStrip = new THREE.Mesh(_unitBeamFloorGeo, floorMat);
      floorStrip.rotation.order = 'YXZ';
      floorStrip.rotation.y = b.angle;
      floorStrip.rotation.x = Math.PI / 2;
      floorStrip.scale.set(BOSS_NOVA.beamHalfWidth * 3.0, b.length, 1);
      floorStrip.position.set(midX, 0.06, midZ);
      group.add(floorStrip);

      let wallFlare: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } | undefined;
      if (b.hitWall) {
        const wx = b.dirX * b.length;
        const wz = b.dirZ * b.length;
        const wfMat = new THREE.ShaderMaterial({
          vertexShader: QUAD_VERT,
          fragmentShader: CORE_FLASH_FRAG,
          uniforms: {
            uIntensity: { value: 1.0 },
            uColor: { value: color.clone() },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const wfMesh = new THREE.Mesh(_unitPlaneGeo, wfMat);
        wfMesh.position.set(wx, beamY, wz);
        wfMesh.rotation.x = -Math.PI / 2;
        wfMesh.scale.setScalar(1.3);
        group.add(wfMesh);
        wallFlare = { mesh: wfMesh, mat: wfMat };

        if (!this.isSoftwareGl) {
          for (let s = 0; s < 5; s++) {
            const spread = (Math.random() - 0.5) * 1.9;
            const bounceAng = b.angle + Math.PI + spread;
            const spd = 2.4 + Math.random() * 3.6;
            this.spawnParticle(
              ox + wx,
              beamY,
              oz + wz,
              Math.sin(bounceAng) * spd,
              1.6 + Math.random() * 2.2,
              Math.cos(bounceAng) * spd,
              s % 2 === 0 ? 0xffffff : colorHex,
              0.88,
              0.42,
              6.0
            );
          }
        }
      }

      beamEntries.push({ core, coreMat, sheath, sheathMat, floorMat, wallFlare });
    }

    this.dynamicGroup.add(group);
    // +0.34s longer sustain: 0..0.07s punch -> 0.07..0.55s blazing sustain -> 0.55..0.78s taper-off
    const beamDur = 0.78;
    const maxLife = 1.65;

    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt, _t, elapsed) => {
        const age = (group.userData.age = (group.userData.age ?? 0) + dt);

        const ft = Math.min(1, age / 0.24);
        flashMesh.visible = ft < 1;
        if (ft < 1) {
          flashMat.uniforms.uIntensity.value = Math.pow(1 - ft, 1.5);
          flashMesh.scale.setScalar(rad * (1.0 + ft * 0.8));
        }

        const rt = Math.min(1, age / 0.56);
        ringA.visible = rt < 1;
        ringB.visible = rt < 1;
        if (rt < 1) {
          const ease = 1 - Math.pow(1 - rt, 2.3);
          const sc = 0.55 + ease * rad * 1.45;
          ringA.scale.setScalar(sc);
          ringB.scale.setScalar(sc * 0.92);
          ringA.rotation.z += dt * 4.5;
          ringB.rotation.z -= dt * 4.0;
          ringMatA.opacity = (1 - rt) * 0.9;
          ringMatB.opacity = (1 - rt) * 0.85;
        }

        const bt = Math.min(1, age / beamDur);
        let widthMult = 0;
        let beamAlpha = 0;
        if (bt < 1) {
          if (age < 0.07) {
            const p = age / 0.07;
            widthMult = THREE.MathUtils.lerp(0.65, 1.42, p);
            beamAlpha = 1.0;
          } else if (age < 0.55) {
            const p = (age - 0.07) / 0.48;
            widthMult = THREE.MathUtils.lerp(1.42, 0.96, Math.min(1, p * 2.2));
            beamAlpha = 1.0;
          } else {
            const p = (age - 0.55) / (beamDur - 0.55);
            widthMult = Math.max(0.02, 0.96 * (1.0 - Math.pow(p, 1.35)));
            beamAlpha = Math.pow(1 - p, 1.15);
          }
        }

        const scorchT = age <= beamDur ? 0 : Math.min(1, (age - beamDur) / (maxLife - beamDur));
        const floorIntensity = age <= beamDur ? Math.max(0.48, beamAlpha) : (1 - scorchT) * 0.42;

        for (const be of beamEntries) {
          be.core.visible = bt < 1;
          be.sheath.visible = bt < 1;
          if (bt < 1) {
            const flicker = 0.93 + 0.07 * Math.sin(elapsed * 72);
            be.core.scale.x = coreRadius * widthMult * flicker;
            be.core.scale.z = coreRadius * widthMult * flicker;
            be.coreMat.opacity = beamAlpha;

            be.sheath.scale.x = sheathRadius * widthMult * 1.04;
            be.sheath.scale.z = sheathRadius * widthMult * 1.04;
            be.sheathMat.uniforms.uTime.value = elapsed;
            be.sheathMat.uniforms.uIntensity.value = beamAlpha;
          }
          be.floorMat.uniforms.uTime.value = elapsed;
          be.floorMat.uniforms.uIntensity.value = floorIntensity;
          be.floorMat.uniforms.uScorch.value = age <= beamDur ? 0 : 1;

          if (be.wallFlare) {
            be.wallFlare.mesh.visible = bt < 1;
            if (bt < 1) {
              be.wallFlare.mat.uniforms.uIntensity.value = beamAlpha;
              be.wallFlare.mesh.scale.setScalar(0.95 + widthMult * 0.42);
            }
          }
        }

        hexMat.uniforms.uTime.value = elapsed;
        hexMat.uniforms.uFade.value = Math.pow(1 - Math.min(1, age / maxLife), 1.35) * 0.85;
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeOwnedMaterials(group);
      },
    });
  },

  /**
   * `targeted_blast` Void Black Hole Detonation VFX (inspired by video's 00:48-00:54):
   * - Blazing white-violet supernova core flash + temporary dynamic PointLight
   * - Rapidly expanding spiral galaxy vortex + twin tilted purple/gold gravitational rings
   * - Outer ring of dark-violet void nebula puffs billowing outward
   * - Lingering rotating gravity vortex aftermath (1.65s)
   */
  spawnBossBlackHoleVfx(
    this: EmbervaultEngine,
    cx: number,
    cz: number,
    rad: number,
    colorHex: number
  ): void {
    if (this.bgSim) return;
    const baseCol = new THREE.Color(colorHex);
    const voidViolet = baseCol.clone().lerp(new THREE.Color(0x9b42ff), 0.55);
    const group = new THREE.Group();
    group.position.set(cx, 0, cz);

    // 1. Intense purple-white supernova burst PointLight
    this.triggerBossBurstLight(cx, 1.7, cz, voidViolet.getHex(), 170, 0.56);

    // 2. Supernova white-hot core flash
    const flashMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: CORE_FLASH_FRAG,
      uniforms: {
        uIntensity: { value: 1.0 },
        uColor: { value: voidViolet.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flashMesh = new THREE.Mesh(_unitPlaneGeo, flashMat);
    flashMesh.rotation.x = -Math.PI / 2;
    flashMesh.position.y = 0.85;
    flashMesh.scale.setScalar(rad * 1.8);
    group.add(flashMesh);

    // 3. Expanding spiral galaxy collapse vortex on the ground (1.65s)
    const vortexMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: GRAVITY_WELL_FRAG,
      uniforms: {
        uTime: { value: this.elapsed },
        uProgress: { value: 1.0 },
        uFade: { value: 1.0 },
        uBurst: { value: 1.0 },
        uColor: { value: baseCol.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const vortexMesh = new THREE.Mesh(_unitPlaneGeo, vortexMat);
    vortexMesh.rotation.x = -Math.PI / 2;
    vortexMesh.position.y = 0.055;
    vortexMesh.scale.setScalar(rad * 1.45);
    group.add(vortexMesh);

    // 4. Twin tilted expanding purple + gold gravitational orbital rings (video signature!)
    const ringMatGold = new THREE.MeshBasicMaterial({
      color: 0xffe49c,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringGold = new THREE.Mesh(_unitTorusGeo, ringMatGold);
    ringGold.position.y = 0.9;
    ringGold.rotation.set(Math.PI / 2 + 0.42, 0.25, 0);
    group.add(ringGold);

    const ringMatPurple = new THREE.MeshBasicMaterial({
      color: voidViolet.getHex(),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringPurple = new THREE.Mesh(_unitTorusGeo, ringMatPurple);
    ringPurple.position.y = 0.9;
    ringPurple.rotation.set(Math.PI / 2 - 0.38, -0.35, 0);
    group.add(ringPurple);

    // 5. Outer ring of dark-violet void nebula puffs billowing outward
    const puffCount = this.isSoftwareGl ? 0 : 12;
    const puffs: Array<{ mesh: THREE.Mesh; dirX: number; dirZ: number; startR: number; spd: number }> = [];
    for (let i = 0; i < puffCount; i++) {
      const a = (i / puffCount) * Math.PI * 2 + Math.random() * 0.2;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x4b187a : voidViolet.getHex(),
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(_unitPuffGeo, mat);
      const startR = rad * 0.55;
      mesh.position.set(Math.cos(a) * startR, 0.32, Math.sin(a) * startR);
      group.add(mesh);
      puffs.push({ mesh, dirX: Math.cos(a), dirZ: Math.sin(a), startR, spd: 2.8 + Math.random() * 1.4 });
    }

    // 6. Starlight / void spark burst
    const sparkCount = this.isSoftwareGl ? 12 : 32;
    for (let i = 0; i < sparkCount; i++) {
      const a = (i / sparkCount) * Math.PI * 2 + Math.random() * 0.2;
      const spd = 3.2 + Math.random() * 5.0;
      this.spawnParticle(
        cx + Math.cos(a) * 0.4,
        0.9,
        cz + Math.sin(a) * 0.4,
        Math.cos(a) * spd,
        1.4 + Math.random() * 3.0,
        Math.sin(a) * spd,
        i % 3 === 0 ? 0xfff0c4 : voidViolet.getHex(),
        1.25,
        0.58,
        3.5
      );
    }

    this.dynamicGroup.add(group);
    const maxLife = 1.65;
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt, _t, elapsed) => {
        const age = (group.userData.age = (group.userData.age ?? 0) + dt);

        const ft = Math.min(1, age / 0.26);
        flashMesh.visible = ft < 1;
        if (ft < 1) {
          flashMat.uniforms.uIntensity.value = Math.pow(1 - ft, 1.45);
          flashMesh.scale.setScalar(rad * (1.2 + ft * 1.1));
        }

        const rt = Math.min(1, age / 0.62);
        ringGold.visible = rt < 1;
        ringPurple.visible = rt < 1;
        if (rt < 1) {
          const ease = 1 - Math.pow(1 - rt, 2.2);
          const sc = 0.45 + ease * rad * 1.42;
          ringGold.scale.setScalar(sc);
          ringPurple.scale.setScalar(sc * 0.94);
          ringGold.rotation.z += dt * 5.2;
          ringPurple.rotation.z -= dt * 4.4;
          ringMatGold.opacity = (1 - rt) * 0.95;
          ringMatPurple.opacity = (1 - rt) * 0.9;
        }

        vortexMat.uniforms.uTime.value = elapsed;
        vortexMat.uniforms.uFade.value = Math.pow(1 - Math.min(1, age / maxLife), 1.3);

        const pt = Math.min(1, age / 0.78);
        for (const pf of puffs) {
          pf.mesh.visible = pt < 1;
          if (pt < 1) {
            const ease = 1 - Math.pow(1 - pt, 2.0);
            const r = pf.startR + ease * pf.spd * 0.75;
            pf.mesh.position.set(pf.dirX * r, 0.3 + ease * 0.35, pf.dirZ * r);
            pf.mesh.scale.setScalar(0.55 + ease * 1.3);
            pf.mesh.rotation.y += dt * 2.5;
            (pf.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - pt) * 0.54;
          }
        }
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeOwnedMaterials(group);
      },
    });
  },

  /**
   * `ranged_volley` Railgun Gate Discharge VFX:
   * - White-hot muzzle flash + temporary dynamic PointLight
   * - Directional shock ring expanding forward through the hex railgun gate
   * - 3 brief glowing floor recoil trails along the fired volley fan
   */
  spawnBossVolleyVfx(
    this: EmbervaultEngine,
    ox: number,
    oz: number,
    baseAngle: number,
    colorHex: number
  ): void {
    if (this.bgSim) return;
    const color = new THREE.Color(colorHex);
    const group = new THREE.Group();
    group.position.set(ox, 0, oz);

    const mx = Math.sin(baseAngle) * 1.1;
    const mz = Math.cos(baseAngle) * 1.1;
    this.triggerBossBurstLight(ox + mx, 1.3, oz + mz, colorHex, 110, 0.32);

    // Muzzle flash flare
    const flashMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: CORE_FLASH_FRAG,
      uniforms: {
        uIntensity: { value: 1.0 },
        uColor: { value: color.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flashMesh = new THREE.Mesh(_unitPlaneGeo, flashMat);
    flashMesh.position.set(mx, 1.0, mz);
    flashMesh.rotation.x = -Math.PI / 2;
    flashMesh.scale.setScalar(1.8);
    group.add(flashMesh);

    // Directional shock torus firing forward
    const muzzleRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const muzzleRing = new THREE.Mesh(_unitTorusGeo, muzzleRingMat);
    muzzleRing.position.set(mx, 1.0, mz);
    muzzleRing.rotation.y = baseAngle;
    muzzleRing.scale.setScalar(0.5);
    group.add(muzzleRing);

    // 3 fading floor recoil trails
    const trails: THREE.ShaderMaterial[] = [];
    for (const off of BOSS_VOLLEY.spread) {
      const ang = baseAngle + off;
      const dx = Math.sin(ang);
      const dz = Math.cos(ang);
      const hit = this.raycastBossBeam(ox, oz, dx, dz, 8.5);
      const mat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: LASER_FLOOR_FRAG,
        uniforms: {
          uTime: { value: this.elapsed },
          uIntensity: { value: 0.75 },
          uScorch: { value: 0.5 },
          uColor: { value: color.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const strip = new THREE.Mesh(_unitBeamFloorGeo, mat);
      strip.rotation.order = 'YXZ';
      strip.rotation.y = ang;
      strip.rotation.x = Math.PI / 2;
      strip.scale.set(0.62, hit.dist, 1);
      strip.position.set(dx * (hit.dist * 0.5), 0.06, dz * (hit.dist * 0.5));
      group.add(strip);
      trails.push(mat);
    }

    this.dynamicGroup.add(group);
    const maxLife = 0.5;
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt, t, elapsed) => {
        const age = (group.userData.age = (group.userData.age ?? 0) + dt);
        const ft = Math.min(1, age / 0.18);
        flashMesh.visible = ft < 1;
        if (ft < 1) {
          flashMat.uniforms.uIntensity.value = Math.pow(1 - ft, 1.5);
          flashMesh.scale.setScalar(1.5 + ft * 1.2);
        }
        const rt = Math.min(1, age / 0.28);
        muzzleRing.visible = rt < 1;
        if (rt < 1) {
          const ease = 1 - Math.pow(1 - rt, 2.0);
          muzzleRing.scale.setScalar(0.5 + ease * 1.4);
          muzzleRing.position.set(mx + Math.sin(baseAngle) * ease * 1.4, 1.0, mz + Math.cos(baseAngle) * ease * 1.4);
          muzzleRingMat.opacity = (1 - rt) * 0.92;
        }
        for (const tm of trails) {
          tm.uniforms.uTime.value = elapsed;
          tm.uniforms.uIntensity.value = (1 - t) * 0.65;
        }
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeOwnedMaterials(group);
      },
    });
  },

  /** Per-frame update for all active boss VFX instances and the temporary burst PointLight. */
  updateBossVfx(this: EmbervaultEngine, dt: number): void {
    if (this.bossWindupRigs.size > 0) {
      const list = this.mp?.role === 'guest' ? this.mp.guest.enemyList : this.enemies;
      for (const [id, rig] of this.bossWindupRigs) {
        if (!rig.group.visible) continue;
        const boss = list.find((e) => e.id === id);
        if (!boss || boss.dead || boss.bossState !== 'windup') {
          rig.group.visible = false;
        }
      }
    }

    if (this.bossBurstLight && this.bossBurstLightTimer > 0) {
      this.bossBurstLightTimer = Math.max(0, this.bossBurstLightTimer - dt);
      const frac = this.bossBurstLightDur > 0 ? this.bossBurstLightTimer / this.bossBurstLightDur : 0;
      this.bossBurstLight.intensity = this.bossBurstLightMax * frac * frac;
    }

    for (let i = this.bossVfxItems.length - 1; i >= 0; i--) {
      const item = this.bossVfxItems[i];
      item.life += dt;
      const t = item.life / item.maxLife;
      if (t >= 1) {
        item.dispose();
        this.bossVfxItems.splice(i, 1);
        continue;
      }
      item.update(dt, t, this.elapsed);
    }
  },

  /** Clean up all active boss VFX and windup rigs (called on clearLevel and dispose). */
  clearBossVfx(this: EmbervaultEngine): void {
    for (const item of this.bossVfxItems) item.dispose();
    this.bossVfxItems = [];
    for (const rig of this.bossWindupRigs.values()) {
      this.dynamicGroup.remove(rig.group);
      disposeOwnedMaterials(rig.group);
    }
    this.bossWindupRigs.clear();
    if (this.bossBurstLight) {
      this.bossBurstLight.intensity = 0;
      this.bossBurstLightTimer = 0;
    }
  },
};
