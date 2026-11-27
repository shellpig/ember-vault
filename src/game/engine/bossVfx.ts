import * as THREE from 'three';
import type { EmbervaultEngine } from '../engine';
import { BOSS_CONFIGS, BOSS_NOVA, BossSkillKind, FloorBossKind } from './data';
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

/** Slam ground telegraph: crisp outer danger boundary, rotating iron/rune ring, pulsing molten fill. */
const SLAM_TELEGRAPH_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform vec3 uColor;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  // Crisp outer danger boundary (gameplay readability)
  float outerRing = smoothstep(0.92, 0.96, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float innerBorder = smoothstep(0.76, 0.785, r) * (1.0 - smoothstep(0.795, 0.82, r));

  // Rotating rune ticks between innerBorder and outerRing
  float aRot = a + uTime * (1.2 + uProgress * 2.5);
  float ticks = step(0.35, fract(aRot * 16.0 / 6.2831853));
  float tickBand = smoothstep(0.81, 0.83, r) * (1.0 - smoothstep(0.91, 0.93, r)) * ticks;

  // 8 radial spoke lines
  float spokeAng = abs(fract((a - uTime * 0.4) * 8.0 / 6.2831853 + 0.5) - 0.5);
  float spokes = smoothstep(0.045, 0.012, spokeAng) * smoothstep(0.22, 0.28, r) * (1.0 - smoothstep(0.76, 0.79, r));

  // Expanding molten energy fill disk
  float fillR = mix(0.14, 0.96, uProgress);
  float fillMask = 1.0 - smoothstep(fillR - 0.04, fillR, r);
  float leadingEdge = smoothstep(fillR - 0.08, fillR - 0.01, r) * (1.0 - smoothstep(fillR - 0.01, fillR + 0.02, r));

  // Subtle radial energy veins inside fill
  float vein = sin(a * 12.0 + r * 14.0 - uTime * 7.0) * 0.5 + 0.5;
  vein = pow(vein, 3.0) * fillMask;

  float pulse = 0.82 + 0.18 * sin(uTime * (12.0 + uProgress * 24.0));
  float hot = smoothstep(0.65, 1.0, uProgress);

  vec3 col = uColor * (
    outerRing * (1.55 * pulse) +
    innerBorder * 0.85 +
    tickBand * 0.7 +
    spokes * 0.55 +
    fillMask * (0.24 + uProgress * 0.22) +
    vein * 0.35 +
    leadingEdge * 1.4
  );
  // White-hot crest on outer ring and expanding edge near impact
  vec3 whiteHot = vec3(1.0, 0.96, 0.88);
  col += whiteHot * (leadingEdge * (0.45 + hot * 0.85) + outerRing * hot * 0.75);

  float alpha = clamp(
    outerRing * 0.98 +
    innerBorder * 0.65 +
    tickBand * 0.55 +
    spokes * 0.45 +
    fillMask * (0.22 + uProgress * 0.28) +
    leadingEdge * 0.9,
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
  float ringWidth = mix(0.26, 0.09, uLife);
  float ringPos = mix(0.28, 0.92, pow(uLife, 0.62));
  float d = abs(r - ringPos + (n - 0.5) * 0.06);

  float outerWave = smoothstep(ringWidth, 0.0, d);
  float razorCore = smoothstep(ringWidth * 0.32, 0.0, d);

  // Secondary inner echo ring
  float ring2Pos = max(0.05, ringPos - 0.18);
  float ring2 = smoothstep(0.07, 0.0, abs(r - ring2Pos)) * (1.0 - uLife) * 0.65;

  float fade = pow(1.0 - uLife, 1.35);
  vec3 col = uColor * (outerWave * 1.45 + ring2 * 1.1) + vec3(1.0, 0.97, 0.9) * (razorCore * 1.5 + ring2 * 0.45);
  float alpha = clamp((outerWave * 0.9 + razorCore + ring2) * fade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Procedural Voronoi cracked ground decal (inspired by video's molten/scorched impact aftermath). */
const VORONOI_SCORCH_FRAG = /* glsl */ `
uniform float uLife;
uniform vec3 uColor;
varying vec2 vUv;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Returns distance to nearest Voronoi edge (0 at crack center)
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

  // Radial dissolution from outside inward as uLife progresses
  float radialMask = 1.0 - smoothstep(mix(0.68, 0.15, uLife), mix(1.0, 0.55, uLife), r);
  if (radialMask <= 0.001) discard;

  float edge = voronoiEdge(p * 4.4);
  float crackWidth = mix(0.11, 0.035, uLife);
  float crack = 1.0 - smoothstep(0.0, crackWidth, edge);
  float coreCrack = 1.0 - smoothstep(0.0, crackWidth * 0.35, edge);

  // Center heat glow that cools quickly
  float centerHeat = exp(-r * r * 4.5) * pow(1.0 - uLife, 1.8);
  float coolFade = pow(1.0 - uLife, 1.1);

  vec3 emberCol = mix(uColor, uColor * 0.55, uLife);
  vec3 hotCore = vec3(1.0, 0.94, 0.72);
  vec3 col = emberCol * (crack * 1.65 + centerHeat * 1.1) + hotCore * (coreCrack * (1.0 - uLife * 0.75) * 1.35 + centerHeat * 0.85);

  float alpha = clamp((crack * 0.95 + centerHeat * 0.65) * radialMask * coolFade, 0.0, 1.0);
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

  // Outer danger boundary & inner ring
  float outerRing = smoothstep(0.92, 0.955, r) * (1.0 - smoothstep(0.98, 1.0, r));
  float midRing = smoothstep(0.75, 0.775, r) * (1.0 - smoothstep(0.79, 0.815, r));
  float innerRing = smoothstep(0.36, 0.38, r) * (1.0 - smoothstep(0.395, 0.415, r));

  // Rotating 6-pointed star (hexagram)
  float spin = uTime * (0.7 + uProgress * 2.4);
  vec2 rp = rot2(spin) * p;
  float tri1 = abs(sdEquilateralTriangle(rp, 0.68));
  float tri2 = abs(sdEquilateralTriangle(vec2(rp.x, -rp.y), 0.68));
  float hexLines = smoothstep(0.028, 0.008, min(tri1, tri2)) * step(r, 0.79);

  // 12 outer rune notches
  float notch = step(0.45, fract((a - spin * 0.6) * 12.0 / 6.2831853));
  float runeBand = smoothstep(0.81, 0.83, r) * (1.0 - smoothstep(0.91, 0.93, r)) * notch;

  // Swirling arcane core fill
  float swirl = sin(a * 6.0 - r * 10.0 + uTime * 8.0) * 0.5 + 0.5;
  float coreGlow = exp(-r * r * mix(6.5, 2.2, uProgress)) * (0.45 + 0.55 * swirl);

  float hot = smoothstep(0.55, 1.0, uProgress);
  vec3 whiteHot = vec3(0.97, 0.96, 1.0);
  vec3 col = uColor * (outerRing * 1.4 + midRing * 1.1 + innerRing * 0.95 + hexLines * 1.55 + runeBand * 0.75 + coreGlow * 1.25);
  col += whiteHot * (hexLines * (0.35 + hot * 0.75) + outerRing * hot * 0.65 + coreGlow * (0.3 + hot * 0.9));

  float alpha = clamp((outerRing * 0.95 + midRing * 0.75 + innerRing * 0.65 + hexLines * 0.95 + runeBand * 0.55 + coreGlow * 0.7) * uFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Directional laser charge telegraph strip on the ground (widely readable lane + searing tightening center wire). */
const LASER_CHARGE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  // vUv.x: across beam width (0..1, center 0.5); vUv.y: along beam length (0=boss, 1=wall)
  float lat = abs(vUv.x - 0.5) * 2.0;

  // Subtle danger lane showing beam hitbox width
  float lane = (1.0 - smoothstep(0.65, 1.0, lat)) * (0.14 + uProgress * 0.16);
  float edgeBorder = smoothstep(0.82, 0.92, lat) * (1.0 - smoothstep(0.95, 1.0, lat)) * (0.35 + uProgress * 0.45);

  // Tightening high-energy central charging filament
  float wireWidth = mix(0.28, 0.08, uProgress);
  float wire = 1.0 - smoothstep(0.0, wireWidth, lat);

  // Energy pulses racing outward from boss toward target
  float pulse = sin(vUv.y * 18.0 - uTime * 22.0) * 0.5 + 0.5;
  pulse = pow(pulse, 2.0);

  // Soft fade at very start and tip
  float endFade = smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.96, 1.0, vUv.y));
  float hot = smoothstep(0.55, 1.0, uProgress);

  vec3 col = uColor * (lane + edgeBorder * 1.1 + wire * (0.9 + pulse * 0.65))
           + vec3(1.0, 0.98, 1.0) * (wire * (0.45 + hot * 1.25 + pulse * 0.35));

  float alpha = clamp((lane + edgeBorder + wire * (0.75 + uProgress * 0.25)) * endFade, 0.0, 1.0);
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
  // vUv.x wraps around cylinder circumference; vUv.y runs along beam length
  float stream1 = sin(vUv.y * 22.0 - uTime * 36.0 + sin(vUv.x * 12.566) * 1.2) * 0.5 + 0.5;
  float stream2 = sin(vUv.y * 44.0 - uTime * 54.0 - vUv.x * 18.849) * 0.5 + 0.5;
  float energy = 0.55 + 0.3 * stream1 + 0.25 * pow(stream2, 2.0);

  float endFade = smoothstep(0.0, 0.03, vUv.y) * (1.0 - smoothstep(0.97, 1.0, vUv.y));
  vec3 col = mix(uColor, vec3(1.0, 0.98, 1.0), 0.38 + 0.35 * stream2) * energy * 1.5;
  float alpha = clamp(energy * uIntensity * endFade * 0.82, 0.0, 1.0);
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
  float core = exp(-lat * lat * 14.0);
  float halo = exp(-lat * lat * 3.2);
  float shimmer = 0.85 + 0.15 * sin(vUv.y * 26.0 - uTime * 32.0);
  float endFade = smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.95, 1.0, vUv.y));

  vec3 col = uColor * halo * (0.95 + uScorch * 0.4) + vec3(1.0, 0.98, 1.0) * core * (1.35 * (1.0 - uScorch * 0.75));
  float alpha = clamp((halo * 0.55 + core * 0.85) * shimmer * uIntensity * endFade, 0.0, 1.0);
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

  float core = exp(-r * r * 14.0);
  float halo = exp(-r * r * 3.6);
  // Subtle 4-point star flare spikes
  float star = exp(-abs(p.x) * 16.0) * exp(-abs(p.y) * 2.4) + exp(-abs(p.y) * 16.0) * exp(-abs(p.x) * 2.4);
  star *= 0.45 * (1.0 - r);

  vec3 col = uColor * halo * 1.2 + vec3(1.0, 0.98, 0.94) * (core * 1.9 + star * 1.2);
  float alpha = clamp((core + halo * 0.65 + star) * uIntensity, 0.0, 1.0);
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
  // Optional nova_ring laser charge elements
  chargeOrb?: THREE.Mesh;
  chargeRing?: THREE.Mesh;
  beamGroup?: THREE.Group;
  beamLines?: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial }>;
  beamAnglesKey?: string;
}

const _unitPlaneGeo = new THREE.PlaneGeometry(2, 2);
const _unitBeamFloorGeo = new THREE.PlaneGeometry(1, 1);
const _unitCylGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
const _unitCoreCylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
const _unitSphereGeo = new THREE.SphereGeometry(1, 14, 10);
const _unitTorusGeo = new THREE.TorusGeometry(1, 0.075, 10, 42);
const _unitSpikeGeo = new THREE.ConeGeometry(0.24, 1.15, 5);
const _unitPuffGeo = new THREE.IcosahedronGeometry(0.38, 1);

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
        // Binary refine against wall edge so laser terminates flush
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
      this.bossBurstLight = new THREE.PointLight(colorHex, 0, 15, 1.75);
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

  /** Hide and optionally remove a boss's custom shader windup telegraph. */
  hideBossWindupVfx(this: EmbervaultEngine, enemyId: number): void {
    const rig = this.bossWindupRigs.get(enemyId);
    if (rig) rig.group.visible = false;
  },

  /** Update (or lazily create) the enhanced shader windup telegraph for `slam` and `nova_ring`. */
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
    if (skill !== 'slam' && skill !== 'nova_ring') {
      this.hideBossWindupVfx(e.id);
      return false;
    }

    const cfg = BOSS_CONFIGS[e.kind as FloorBossKind];
    const color = new THREE.Color(cfg.telegraphColor);

    let rig = this.bossWindupRigs.get(e.id);
    if (!rig || rig.skill !== skill) {
      if (rig) {
        this.dynamicGroup.remove(rig.group);
        disposeOwnedMaterials(rig.group);
      }
      const group = new THREE.Group();
      const groundMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: skill === 'slam' ? SLAM_TELEGRAPH_FRAG : HEXAGRAM_FRAG,
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
        // White-hot gathering orb + converging arcane ring at boss chest height
        const orbMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const orb = new THREE.Mesh(_unitSphereGeo, orbMat);
        orb.position.y = 1.05;
        group.add(orb);

        const ringMat = new THREE.MeshBasicMaterial({
          color: cfg.telegraphColor,
          transparent: true,
          opacity: 0.85,
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
      }

      this.dynamicGroup.add(group);
      this.bossWindupRigs.set(e.id, rig);
    }

    rig.group.visible = true;
    rig.group.position.set(tx, 0, tz);
    rig.groundMat.uniforms.uTime.value = this.elapsed;
    rig.groundMat.uniforms.uProgress.value = progress;
    rig.groundMat.uniforms.uFade.value = 1;
    // Ground plane is 2x2, so scale = rad gives exact radius `rad`
    rig.group.children[0].scale.setScalar(rad);

    if (skill === 'slam') {
      // Subtle inward-sucking embers during late windup
      if (!this.isSoftwareGl && Math.random() < 0.45 + progress * 0.45) {
        const a = Math.random() * Math.PI * 2;
        const dist = rad * (0.55 + Math.random() * 0.45);
        this.spawnParticle(
          tx + Math.cos(a) * dist,
          0.18,
          tz + Math.sin(a) * dist,
          -Math.cos(a) * 2.2,
          1.4 + Math.random() * 1.4,
          -Math.sin(a) * 2.2,
          progress > 0.65 ? 0xffe8a0 : cfg.telegraphColor,
          0.7 + progress * 0.4,
          0.32,
          -0.6
        );
      }
    } else if (skill === 'nova_ring' && rig.beamGroup && rig.beamLines && rig.chargeOrb && rig.chargeRing) {
      // Animate gathering core orb + tightening ring
      const orbScale = 0.14 + progress * 0.42 + Math.sin(this.elapsed * 32) * 0.03;
      rig.chargeOrb.scale.setScalar(orbScale);
      const ringScale = THREE.MathUtils.lerp(1.45, 0.48, progress);
      rig.chargeRing.scale.setScalar(ringScale);
      rig.chargeRing.rotation.z = this.elapsed * (3 + progress * 6);
      rig.chargeRing.rotation.x = Math.PI / 2 + Math.sin(this.elapsed * 5) * 0.35;

      // Build or update directional laser telegraph lanes (raycasted to walls)
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
          // Plane lies on XZ: local X = beam width, local Y (rotated to -Z) = beam length
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

      // Inward energy sparks gathering into boss core
      if (!this.isSoftwareGl && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        const d = 1.6 + Math.random() * 1.4;
        this.spawnParticle(
          tx + Math.cos(a) * d,
          0.95 + (Math.random() - 0.5) * 0.6,
          tz + Math.sin(a) * d,
          -Math.cos(a) * 4.2,
          (Math.random() - 0.5) * 1.2,
          -Math.sin(a) * 4.2,
          Math.random() < 0.55 ? 0xffffff : cfg.telegraphColor,
          0.65,
          0.26,
          0
        );
      }
    }

    return true;
  },

  /**
   * Spawn the full 3-beat `slam` impact VFX:
   * - White-hot core flash + temporary dynamic PointLight illuminating the room
   * - Polar turbulent shockwave ring
   * - Staggered 3D erupting shattered rock/molten spikes around the perimeter
   * - Expanding dust/ember puffs
   * - Procedural Voronoi cracked molten ground decal that cools & dissolves over 1.7s
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

    // 1. Temporary burst PointLight
    this.triggerBossBurstLight(cx, 1.6, cz, colorHex, 115, 0.44);

    // 2. White-hot core flash (short 0.16s peak)
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
    flashMesh.position.y = 0.22;
    flashMesh.scale.setScalar(rad * 1.35);
    group.add(flashMesh);

    // 3. Polar turbulent shockwave ring (0.42s)
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
    waveMesh.position.y = 0.14;
    waveMesh.scale.setScalar(rad * 0.4);
    group.add(waveMesh);

    // 4. Procedural Voronoi cracked molten ground decal (1.75s aftermath)
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
    scorchMesh.scale.setScalar(rad * 1.08);
    group.add(scorchMesh);

    // 5. Staggered 3D erupting shattered rock/molten spikes around the perimeter
    const spikeCount = this.isSoftwareGl ? 6 : 12;
    const spikes: Array<{ mesh: THREE.Mesh; delay: number; maxH: number; baseY: number }> = [];
    for (let i = 0; i < spikeCount; i++) {
      const a = (i / spikeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
      const dist = rad * (0.68 + Math.random() * 0.28);
      const isHot = i % 2 === 0;
      const mat = new THREE.MeshStandardMaterial({
        color: isHot ? 0x2a1816 : 0x1c1820,
        emissive: colorHex,
        emissiveIntensity: isHot ? 1.35 : 0.65,
        roughness: 0.72,
        metalness: 0.15,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(_unitSpikeGeo, mat);
      mesh.position.set(Math.cos(a) * dist, -0.5, Math.sin(a) * dist);
      // Tilt slightly outward from impact center
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
      mesh.rotation.x = 0.22 + Math.random() * 0.24;
      const wScale = 0.8 + Math.random() * 0.55;
      const maxH = 0.7 + Math.random() * 0.65;
      mesh.scale.set(wScale, 0.01, wScale);
      group.add(mesh);
      spikes.push({ mesh, delay: (i % 3) * 0.025, maxH, baseY: maxH * 0.42 });
    }

    // 6. Outer rolling dust / ember puffs (like the video's perimeter billows)
    const puffCount = this.isSoftwareGl ? 0 : 10;
    const puffs: Array<{ mesh: THREE.Mesh; dirX: number; dirZ: number; startR: number; spd: number }> = [];
    for (let i = 0; i < puffCount; i++) {
      const a = (i / puffCount) * Math.PI * 2 + Math.random() * 0.3;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? colorHex : 0x3a2420,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(_unitPuffGeo, mat);
      const startR = rad * 0.55;
      mesh.position.set(Math.cos(a) * startR, 0.24, Math.sin(a) * startR);
      mesh.scale.setScalar(0.5);
      group.add(mesh);
      puffs.push({ mesh, dirX: Math.cos(a), dirZ: Math.sin(a), startR, spd: 2.2 + Math.random() * 1.4 });
    }

    // 7. Crisp radial spark burst
    const sparkCount = this.isSoftwareGl ? 12 : 28;
    for (let i = 0; i < sparkCount; i++) {
      const a = (i / sparkCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
      const spd = 3.2 + Math.random() * 4.8;
      this.spawnParticle(
        cx + Math.cos(a) * rad * 0.35,
        0.28,
        cz + Math.sin(a) * rad * 0.35,
        Math.cos(a) * spd,
        2.4 + Math.random() * 3.4,
        Math.sin(a) * spd,
        i % 3 === 0 ? 0xfff0b0 : colorHex,
        1.25,
        0.52,
        8.5
      );
    }

    this.dynamicGroup.add(group);
    const maxLife = 1.75;
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt, _t) => {
        const age = group.userData.age = (group.userData.age ?? 0) + dt;

        // Core flash: intense punch for 0.18s
        const ft = Math.min(1, age / 0.18);
        flashMesh.visible = ft < 1;
        if (ft < 1) {
          flashMat.uniforms.uIntensity.value = Math.pow(1 - ft, 1.7);
          flashMesh.scale.setScalar(rad * (0.9 + ft * 0.85));
        }

        // Shockwave: rapid expansion over 0.42s
        const wt = Math.min(1, age / 0.42);
        waveMesh.visible = wt < 1;
        if (wt < 1) {
          waveMat.uniforms.uLife.value = wt;
          const ease = 1 - Math.pow(1 - wt, 2.4);
          waveMesh.scale.setScalar(rad * (0.45 + ease * 1.15));
        }

        // Voronoi scorch decal: lingers full 1.75s
        scorchMat.uniforms.uLife.value = Math.min(1, age / maxLife);

        // 3D erupting spikes: pop up in 0.12s with overshoot, hold briefly, sink & fade by 0.85s
        for (const sp of spikes) {
          const sa = age - sp.delay;
          if (sa <= 0 || sa >= 0.85) {
            sp.mesh.visible = false;
            continue;
          }
          sp.mesh.visible = true;
          const mat = sp.mesh.material as THREE.MeshStandardMaterial;
          if (sa < 0.12) {
            const p = sa / 0.12;
            const overshoot = 1 + Math.sin(p * Math.PI) * 0.22;
            const h = sp.maxH * p * overshoot;
            sp.mesh.scale.y = Math.max(0.05, h);
            sp.mesh.position.y = h * 0.42;
            mat.emissiveIntensity = 1.8;
          } else {
            const p = (sa - 0.12) / 0.73;
            const sink = 1 - Math.pow(p, 1.8);
            const h = sp.maxH * sink;
            sp.mesh.scale.y = Math.max(0.02, h);
            sp.mesh.position.y = h * 0.42 - p * 0.15;
            mat.emissiveIntensity = 1.2 * (1 - p);
            mat.opacity = 1 - Math.pow(p, 2.2);
          }
        }

        // Expanding dust/ember billows over 0.65s
        const pt = Math.min(1, age / 0.65);
        for (const pf of puffs) {
          pf.mesh.visible = pt < 1;
          if (pt < 1) {
            const ease = 1 - Math.pow(1 - pt, 2.0);
            const r = pf.startR + ease * pf.spd * 0.65;
            pf.mesh.position.set(pf.dirX * r, 0.24 + ease * 0.32, pf.dirZ * r);
            pf.mesh.scale.setScalar(0.55 + ease * 1.15);
            pf.mesh.rotation.y += dt * 2.2;
            (pf.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - pt) * 0.48;
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
   * Spawn the full 3-beat `nova_ring` bright-white radial laser burst VFX:
   * - White-hot core flash + temporary dynamic PointLight
   * - N multi-layered 3D beams (pure white core cylinder + scrolling arcane plasma sheath + floor glow strip)
   * - Wall-impact flares & sparks at every beam's exact wall contact point
   * - Twin tilted intersecting arcane energy rings erupting outward
   * - Lingering hexagram ground seal & beam scorch lines fading over 1.35s
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

    // 1. Intense white-tinted burst PointLight
    const burstColor = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.55).getHex();
    this.triggerBossBurstLight(ox, 1.5, oz, burstColor, 130, 0.48);

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
    flashMesh.position.y = 0.95;
    flashMesh.scale.setScalar(rad * 1.25);
    group.add(flashMesh);

    // 3. Lingering Hexagram ground seal (aftermath fade)
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

    // 4. Twin tilted intersecting arcane energy rings (video signature!)
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

    // 5. Multi-layered 3D bright-white laser beams + ground glow/scorch strips + wall impact flares
    const beamY = 0.95;
    const coreRadius = BOSS_NOVA.beamHalfWidth * 0.46;
    const sheathRadius = BOSS_NOVA.beamHalfWidth * 1.05;
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

      // Layer A: Pure blazing white core cylinder
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

      // Layer B: Scrolling arcane/plasma energy sheath cylinder
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

      // Layer C: Floor light-bleed & aftermath scorch strip
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
      floorStrip.scale.set(BOSS_NOVA.beamHalfWidth * 3.1, b.length, 1);
      floorStrip.position.set(midX, 0.06, midZ);
      group.add(floorStrip);

      // Layer D: Wall impact flare + sparks at exact wall hit point
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
        wfMesh.scale.setScalar(1.35);
        group.add(wfMesh);
        wallFlare = { mesh: wfMesh, mat: wfMat };

        if (!this.isSoftwareGl) {
          for (let s = 0; s < 5; s++) {
            const spread = (Math.random() - 0.5) * 1.9;
            const bounceAng = b.angle + Math.PI + spread;
            const spd = 2.2 + Math.random() * 3.4;
            this.spawnParticle(
              ox + wx,
              beamY,
              oz + wz,
              Math.sin(bounceAng) * spd,
              1.6 + Math.random() * 2.2,
              Math.cos(bounceAng) * spd,
              s % 2 === 0 ? 0xffffff : colorHex,
              0.9,
              0.38,
              6.0
            );
          }
        }
      }

      beamEntries.push({ core, coreMat, sheath, sheathMat, floorMat, wallFlare });
    }

    this.dynamicGroup.add(group);
    const beamDur = 0.44;
    const maxLife = 1.35;

    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt, _t, elapsed) => {
        const age = group.userData.age = (group.userData.age ?? 0) + dt;

        // Core flash (0.2s)
        const ft = Math.min(1, age / 0.2);
        flashMesh.visible = ft < 1;
        if (ft < 1) {
          flashMat.uniforms.uIntensity.value = Math.pow(1 - ft, 1.5);
          flashMesh.scale.setScalar(rad * (0.95 + ft * 0.75));
        }

        // Twin tilted rings erupt outward over 0.48s
        const rt = Math.min(1, age / 0.48);
        ringA.visible = rt < 1;
        ringB.visible = rt < 1;
        if (rt < 1) {
          const ease = 1 - Math.pow(1 - rt, 2.3);
          const sc = 0.55 + ease * rad * 1.35;
          ringA.scale.setScalar(sc);
          ringB.scale.setScalar(sc * 0.92);
          ringA.rotation.z += dt * 4.5;
          ringB.rotation.z -= dt * 4.0;
          ringMatA.opacity = (1 - rt) * 0.9;
          ringMatB.opacity = (1 - rt) * 0.85;
        }

        // Beams: 0..0.07s punch overshoot -> 0.07..0.24s blazing sustain -> 0.24..0.44s crisp taper-off
        const bt = Math.min(1, age / beamDur);
        let widthMult = 0;
        let beamAlpha = 0;
        if (bt < 1) {
          if (age < 0.07) {
            const p = age / 0.07;
            widthMult = THREE.MathUtils.lerp(0.6, 1.48, p);
            beamAlpha = 1.0;
          } else if (age < 0.22) {
            const p = (age - 0.07) / 0.15;
            widthMult = THREE.MathUtils.lerp(1.48, 1.0, p);
            beamAlpha = 1.0;
          } else {
            const p = (age - 0.22) / (beamDur - 0.22);
            widthMult = Math.max(0.02, 1.0 - Math.pow(p, 1.4));
            beamAlpha = Math.pow(1 - p, 1.2);
          }
        }

        // Floor scorch lingers past beamDur until maxLife
        const scorchT = age <= beamDur ? 0 : Math.min(1, (age - beamDur) / (maxLife - beamDur));
        const floorIntensity = age <= beamDur ? Math.max(0.45, beamAlpha) : (1 - scorchT) * 0.42;

        for (const be of beamEntries) {
          be.core.visible = bt < 1;
          be.sheath.visible = bt < 1;
          if (bt < 1) {
            const flicker = 0.92 + 0.08 * Math.sin(elapsed * 70);
            be.core.scale.x = coreRadius * widthMult * flicker;
            be.core.scale.z = coreRadius * widthMult * flicker;
            be.coreMat.opacity = beamAlpha;

            be.sheath.scale.x = sheathRadius * widthMult * 1.05;
            be.sheath.scale.z = sheathRadius * widthMult * 1.05;
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
              be.wallFlare.mesh.scale.setScalar(1.0 + widthMult * 0.45);
            }
          }
        }

        // Hexagram aftermath fades out smoothly
        hexMat.uniforms.uTime.value = elapsed;
        hexMat.uniforms.uFade.value = Math.pow(1 - Math.min(1, age / maxLife), 1.35) * 0.85;
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeOwnedMaterials(group);
      },
    });
  },

  /** Per-frame update for all active boss VFX instances and the temporary burst PointLight. */
  updateBossVfx(this: EmbervaultEngine, dt: number): void {
    // Auto-hide windup rigs whose boss died or left windup
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
