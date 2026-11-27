import * as THREE from 'three';
import type { EmbervaultEngine } from '../engine';
import { BOSS_CONFIGS, BOSS_NOVA, BOSS_PRISM, BOSS_VOLLEY, BossSkillKind, FloorBossKind } from './data';
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

/** Procedural Voronoi cracked ground decal (theme-tinted fissures that cool and dissolve). */
const VORONOI_SCORCH_FRAG = /* glsl */ `
uniform float uLife;
uniform vec3 uColor;
uniform vec3 uCoreColor;
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
  vec3 col = emberCol * (crack * 2.0 + centerHeat * 1.35) + uCoreColor * (coreCrack * (1.0 - uLife * 0.65) * 1.65 + centerHeat * 1.05);

  float alpha = clamp((crack * 1.0 + centerHeat * 0.72) * radialMask * coolFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Linear jagged magma/energy trench fissure left along a charge_slam path (video 01:12-01:17). */
const TRENCH_FISSURE_FRAG = /* glsl */ `
uniform float uLife;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // vUv.x across width, vUv.y along charge path (0=start, 1=landing)
  float jag = sin(vUv.y * 22.0) * 0.09 + sin(vUv.y * 47.0 + 1.3) * 0.05;
  float lat = abs((vUv.x - 0.5) * 2.0 + jag);

  // Cracked core trench + glowing outer magma rim
  float coreWidth = mix(0.36, 0.14, uLife);
  float core = 1.0 - smoothstep(0.0, coreWidth, lat);
  float rim = (1.0 - smoothstep(coreWidth * 0.6, 0.92, lat)) * (0.7 + 0.3 * sin(vUv.y * 34.0 - uTime * 8.0));

  // Cross-fissure cracks radiating off the main trench
  float ribs = smoothstep(0.22, 0.02, abs(fract(vUv.y * 7.0) - 0.5)) * (1.0 - smoothstep(0.2, 0.96, lat));

  float endFade = smoothstep(0.0, 0.07, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
  float fade = pow(1.0 - uLife, 1.1);

  vec3 whiteHot = vec3(1.0, 0.96, 0.78);
  vec3 col = uColor * (rim * 1.65 + ribs * 1.35 + core * 1.2) + whiteHot * (core * (1.0 - uLife * 0.7) * 1.85 + ribs * (1.0 - uLife) * 0.55);
  float alpha = clamp((core + rim * 0.8 + ribs * 0.7) * endFade * fade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Soaring vertical erupting fire / plasma pillar shader (video 01:15 magma pillars). */
const PILLAR_FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLife;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  // vUv.y = 0 at ground base, 1 at pillar top
  float flame1 = sin(vUv.x * 18.849 + vUv.y * 9.0 - uTime * 22.0) * 0.5 + 0.5;
  float flame2 = sin(vUv.x * 31.416 - vUv.y * 14.0 - uTime * 30.0) * 0.5 + 0.5;
  float turb = 0.55 + 0.3 * flame1 + 0.25 * pow(flame2, 2.0);

  // Intense white-hot base transitioning into blazing theme color & dissipating top
  float vertFade = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float baseHot = exp(-vUv.y * 3.4);
  float fade = pow(1.0 - uLife, 1.25);

  vec3 coreCol = vec3(1.0, 0.96, 0.82);
  vec3 col = mix(uColor, coreCol, clamp(baseHot * 0.85 + flame2 * 0.32, 0.0, 1.0)) * turb * 1.85;
  float alpha = clamp(vertFade * turb * fade * 0.92, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Forward-blasting crescent cleave shockwave at charge_slam impact point. */
const CRESCENT_ARC_FRAG = /* glsl */ `
uniform float uLife;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // Local +Y is forward charge direction (after rotation.x = PI/2, rotation.y = angle)
  float forwardMask = smoothstep(-0.15, 0.32, p.y);
  if (forwardMask <= 0.001) discard;

  float arcPos = mix(0.32, 0.92, pow(uLife, 0.6));
  float arcWidth = mix(0.28, 0.1, uLife);
  float d = abs(r - arcPos);
  float wave = smoothstep(arcWidth, 0.0, d);
  float razor = smoothstep(arcWidth * 0.32, 0.0, d);

  float fade = pow(1.0 - uLife, 1.25);
  vec3 col = uColor * wave * 1.75 + vec3(1.0, 0.97, 0.88) * razor * 2.0;
  float alpha = clamp((wave * 0.9 + razor) * forwardMask * fade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Supersonic forward airflow cone wrapping the boss during charge_slam dash. */
const CHARGE_CONE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  float streak = sin(vUv.x * 25.132 + vUv.y * 12.0 + uTime * 34.0) * 0.5 + 0.5;
  float tip = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  vec3 col = mix(uColor, vec3(1.0, 0.96, 0.88), 0.45 + 0.35 * streak) * 1.65;
  float alpha = clamp(tip * (0.45 + 0.55 * streak) * uIntensity, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** 70-degree Stained-Glass / Prism Fan Cone Shader (video 00:55-01:02). */
const PRISM_CONE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uFade;
uniform float uHalfAngle;
uniform vec3 uColor;
uniform vec3 uCoreColor;
varying vec2 vUv;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 || r < 0.04) discard;
  // Local +Y is forward aim direction
  float ang = abs(atan(p.x, p.y));
  if (ang > uHalfAngle) discard;

  // Voronoi stained-glass cells
  vec2 uvCell = p * 6.5;
  vec2 n = floor(uvCell);
  vec2 f = fract(uvCell);
  float md = 8.0;
  float md2 = 8.0;
  vec2 cellId = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 diff = g + o - f;
      float d = length(diff);
      if (d < md) {
        md2 = md;
        md = d;
        cellId = n + g;
      } else if (d < md2) {
        md2 = d;
      }
    }
  }
  float cellEdge = smoothstep(0.08, 0.02, md2 - md);
  float cellHue = fract(sin(dot(cellId, vec2(41.3, 289.1))) * 43758.5453);
  vec3 facetCol = mix(uColor, uCoreColor, 0.25 + 0.55 * cellHue);

  // Crisp outer arc, side borders & 2 concentric distance arcs
  float outerArc = smoothstep(0.94, 0.975, r);
  float sideEdge = smoothstep(uHalfAngle - 0.045, uHalfAngle - 0.01, ang);
  float midArcs = smoothstep(0.025, 0.008, abs(r - 0.48)) + smoothstep(0.025, 0.008, abs(r - 0.74));

  // Fill sweep outward with uProgress
  float fillMask = 1.0 - smoothstep(uProgress - 0.08, uProgress + 0.02, r);
  float sweepWave = smoothstep(0.09, 0.0, abs(r - uProgress));

  float border = clamp(outerArc + sideEdge + midArcs * 0.75, 0.0, 1.0);
  float shimmer = 0.75 + 0.25 * sin(uTime * 10.0 + cellHue * 6.283);

  vec3 col = facetCol * (0.28 + fillMask * 0.52) * shimmer * (1.0 - cellEdge * 0.45)
           + vec3(1.0, 0.98, 1.0) * (border * 1.35 + sweepWave * 1.15 + cellEdge * 0.25);

  float alpha = clamp((0.28 + fillMask * 0.42 + border * 0.95 + sweepWave * 0.8) * uFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** High-tech orbital radar / targeting grid shader (Omega Core AI tech nova_ring & orbital_barrage). */
const TECH_RADAR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  float outerRing = smoothstep(0.93, 0.96, r) * (1.0 - smoothstep(0.985, 1.0, r));
  float ring2 = smoothstep(0.64, 0.665, r) * (1.0 - smoothstep(0.675, 0.7, r));
  float ring3 = smoothstep(0.32, 0.34, r) * (1.0 - smoothstep(0.35, 0.37, r));

  // Crisp crosshair axes + 24 digital tick marks
  float crossH = smoothstep(0.022, 0.006, abs(p.y)) * smoothstep(0.16, 0.22, r);
  float crossV = smoothstep(0.022, 0.006, abs(p.x)) * smoothstep(0.16, 0.22, r);
  float ticks = step(0.55, fract((a + uTime * 0.9) * 24.0 / 6.2831853))
              * smoothstep(0.84, 0.86, r) * (1.0 - smoothstep(0.91, 0.93, r));

  // Rotating radar sweep beam
  float sweepAng = fract((a - uTime * (2.6 + uProgress * 4.5)) / 6.2831853);
  float sweep = pow(1.0 - sweepAng, 5.0) * 0.55;

  float fillR = mix(0.12, 0.96, uProgress);
  float lockRing = smoothstep(0.04, 0.0, abs(r - fillR));

  float hot = smoothstep(0.55, 1.0, uProgress);
  vec3 col = uColor * (outerRing * 1.6 + ring2 * 1.0 + ring3 * 0.9 + (crossH + crossV) * 0.8 + ticks * 0.85 + sweep + lockRing * 1.5)
           + vec3(0.94, 0.99, 1.0) * (lockRing * (0.6 + hot * 0.9) + outerRing * hot * 0.75);

  float alpha = clamp((outerRing + ring2 * 0.65 + ring3 * 0.6 + (crossH + crossV) * 0.55 + ticks * 0.65 + sweep + lockRing * 0.9) * uFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Sky-to-ground orbital energy pillar shader (high-speed downward plasma stream). */
const ORBITAL_BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLife;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  // vUv.y = 0 at ground, 1 at sky; flow streams rapidly DOWNWARD
  float s1 = sin(vUv.y * 28.0 + uTime * 42.0 + vUv.x * 12.566) * 0.5 + 0.5;
  float s2 = sin(vUv.y * 52.0 + uTime * 64.0 - vUv.x * 18.849) * 0.5 + 0.5;
  float energy = 0.55 + 0.3 * s1 + 0.25 * pow(s2, 2.0);
  float fade = pow(1.0 - uLife, 1.2);
  float topFade = 1.0 - smoothstep(0.85, 1.0, vUv.y);

  vec3 col = mix(uColor, vec3(1.0, 0.99, 1.0), 0.45 + 0.35 * s2) * energy * 1.85;
  float alpha = clamp(energy * fade * topFade * 0.9, 0.0, 1.0);
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

/** Black Hole Multicolor Cosmic Accretion Disk Shader (distinct from violet nova_ring!). */
const ACCRETION_DISK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 || r < 0.28) discard;
  float a = atan(p.y, p.x);

  float spin = a + r * 14.0 - uTime * (6.5 + uProgress * 9.5);
  float swirl1 = sin(spin * 3.0) * 0.5 + 0.5;
  float swirl2 = sin(a * 7.0 - r * 22.0 + uTime * 11.0) * 0.5 + 0.5;
  float bands = 0.45 + 0.35 * swirl1 + 0.25 * pow(swirl2, 2.0);

  // Multicolor cosmic spectrum (cyan / gold / magenta / emerald swirling into event horizon)
  vec3 cCyan = vec3(0.22, 0.92, 1.0);
  vec3 cGold = vec3(1.0, 0.78, 0.28);
  vec3 cRose = vec3(1.0, 0.32, 0.68);
  vec3 cMint = vec3(0.32, 1.0, 0.68);
  float hueT = fract(spin * 0.15915 + uTime * 0.22);
  vec3 rainbow = hueT < 0.25
    ? mix(cCyan, cGold, hueT * 4.0)
    : hueT < 0.5
    ? mix(cGold, cRose, (hueT - 0.25) * 4.0)
    : hueT < 0.75
    ? mix(cRose, cMint, (hueT - 0.5) * 4.0)
    : mix(cMint, cCyan, (hueT - 0.75) * 4.0);

  // Blazing white-gold event horizon rim right around the pitch-black sphere
  float innerRim = smoothstep(0.46, 0.30, r) * smoothstep(0.28, 0.32, r);
  float outerFade = 1.0 - smoothstep(0.62, 1.0, r);
  float outerEdge = smoothstep(0.88, 0.95, r) * (1.0 - smoothstep(0.96, 1.0, r));

  vec3 col = rainbow * bands * outerFade * 1.6 + vec3(1.0, 0.97, 0.88) * (innerRim * 2.4 + swirl1 * innerRim * 0.9) + rainbow * outerEdge * 1.15;
  float alpha = clamp((bands * outerFade * 0.92 + innerRim * 1.25 + outerEdge * 0.65) * uFade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Black Hole Ground Gravity Well & Multicolor Cosmic Vortex (windup + aftermath). */
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

  float outerRing = smoothstep(0.92, 0.96, r) * (1.0 - smoothstep(0.985, 1.0, r)) * (1.0 - uBurst * 0.65);

  float spin = a + r * mix(9.0, 15.0, uBurst) - uTime * (5.5 + uProgress * 7.5);
  float arms = sin(spin * 4.0) * 0.5 + 0.5;
  float fine = sin(a * 9.0 + r * 20.0 - uTime * 9.0) * 0.5 + 0.5;
  float spiral = pow(arms, 1.7) * 0.78 + pow(fine, 3.0) * 0.35;

  float gridRings = smoothstep(0.12, 0.02, abs(fract(r * 4.0 + uTime * 2.0) - 0.5)) * (1.0 - uBurst);
  float radialFade = 1.0 - smoothstep(0.65, 1.0, r);

  // Multicolor cosmic tint swirling around the dark void center
  vec3 c1 = vec3(0.2, 0.88, 1.0);
  vec3 c2 = vec3(1.0, 0.42, 0.65);
  vec3 c3 = vec3(1.0, 0.82, 0.32);
  float k = sin(spin * 1.5) * 0.5 + 0.5;
  vec3 nebula = mix(mix(c1, c2, k), c3, pow(fine, 2.0) * 0.65);

  float centerFlash = exp(-r * r * mix(6.0, 2.4, uBurst)) * uBurst;
  vec3 col = nebula * (outerRing * 1.65 + spiral * radialFade * 1.55 + gridRings * radialFade * 0.55)
           + vec3(1.0, 0.96, 0.88) * (centerFlash * 1.6 + outerRing * smoothstep(0.55, 1.0, uProgress) * 0.9);

  float alpha = clamp((outerRing * 0.98 + spiral * radialFade * 0.85 + gridRings * radialFade * 0.35 + centerFlash * 0.8) * uFade, 0.0, 1.0);
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
  // ranged_volley 3-lane dual railgun accelerator gates + 3 fan lines
  volleyGroup?: THREE.Group;
  volleyLines?: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial }>;
  volleyGates?: THREE.Mesh[];
}

const _unitPlaneGeo = new THREE.PlaneGeometry(2, 2);
const _unitBeamFloorGeo = new THREE.PlaneGeometry(1, 1);
const _unitCylGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
const _unitCoreCylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
const _unitSphereGeo = new THREE.SphereGeometry(1, 16, 12);
const _unitTorusGeo = new THREE.TorusGeometry(1, 0.075, 10, 42);
const _unitHexGateGeo = new THREE.RingGeometry(0.62, 0.85, 6);
const _unitSpikeGeo = new THREE.ConeGeometry(0.27, 1.35, 5);
const _unitPrismGeo = new THREE.OctahedronGeometry(0.34, 0);
const _unitRibGeo = new THREE.BoxGeometry(0.32, 1.55, 0.58);
const _unitChargeConeGeo = new THREE.ConeGeometry(1.15, 2.2, 14, 1, true);
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
  /**
   * Pre-compile all 11 procedural Boss VFX GLSL shaders at engine startup so the very first boss skill cast
   * never triggers synchronous WebGL/ANGLE shader compilation stutter mid-combat.
   */
  prewarmBossVfx(this: EmbervaultEngine): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const dummyColor = new THREE.Color(0xffffff);
    const frags = [
      SLAM_TELEGRAPH_FRAG,
      SHOCKWAVE_FRAG,
      VORONOI_SCORCH_FRAG,
      HEXAGRAM_FRAG,
      LASER_CHARGE_FRAG,
      CHARGE_PATH_FRAG,
      LASER_SHEATH_FRAG,
      LASER_FLOOR_FRAG,
      CORE_FLASH_FRAG,
      ACCRETION_DISK_FRAG,
      GRAVITY_WELL_FRAG,
      TRENCH_FISSURE_FRAG,
      PILLAR_FLAME_FRAG,
      CRESCENT_ARC_FRAG,
      CHARGE_CONE_FRAG,
      PRISM_CONE_FRAG,
      TECH_RADAR_FRAG,
      ORBITAL_BEAM_FRAG,
    ];
    const warmGroup = new THREE.Group();
    warmGroup.position.set(0, -100, 0);
    const createdMats: THREE.Material[] = [];

    for (const fragmentShader of frags) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0.5 },
          uLife: { value: 0.5 },
          uFade: { value: 1 },
          uBurst: { value: 0 },
          uIntensity: { value: 1 },
          uScorch: { value: 0 },
          uHalfAngle: { value: BOSS_PRISM.halfAngle },
          uColor: { value: dummyColor },
          uCoreColor: { value: dummyColor },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      createdMats.push(mat);
      const mesh = new THREE.Mesh(_unitPlaneGeo, mat);
      mesh.frustumCulled = false;
      warmGroup.add(mesh);
    }

    // Also prewarm the spike MeshStandardMaterial variant
    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0x221818,
      emissive: 0xff4438,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 1,
    });
    createdMats.push(spikeMat);
    const spikeMesh = new THREE.Mesh(_unitSpikeGeo, spikeMat);
    spikeMesh.frustumCulled = false;
    warmGroup.add(spikeMesh);

    this.scene.add(warmGroup);
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      // Ignore software/headless GL compile quirks
    }
    this.scene.remove(warmGroup);
    for (const m of createdMats) m.dispose();
  },

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
    if (this.bgSim || this.isSoftwareGl || !this.bossBurstLight) return;
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
    const isTechBoss = e.kind === 'boss_mothership_ai' || e.kind === 'boss_xeno_commander';
    // Tech nova_ring on Omega Core AI uses bright sci-fi ice-blue; Archlich uses arcane violet
    const effColorHex = skill === 'nova_ring' && e.kind === 'boss_mothership_ai' ? 0x38c8ff : cfg.telegraphColor;
    const color = new THREE.Color(effColorHex);
    const prismAccent =
      e.kind === 'boss_crystal_wyrm'
        ? new THREE.Color(0xd96bff)
        : e.kind === 'boss_leviathan_heart'
        ? new THREE.Color(0xffb84d)
        : new THREE.Color(0x38e8ff);

    let rig = this.bossWindupRigs.get(e.id);
    if (!rig || rig.skill !== skill) {
      if (rig) {
        this.dynamicGroup.remove(rig.group);
        disposeOwnedMaterials(rig.group);
      }
      const group = new THREE.Group();

      const frag =
        skill === 'nova_ring'
          ? isTechBoss
            ? TECH_RADAR_FRAG
            : HEXAGRAM_FRAG
          : skill === 'targeted_blast'
          ? GRAVITY_WELL_FRAG
          : skill === 'prism_cone'
          ? PRISM_CONE_FRAG
          : skill === 'orbital_barrage'
          ? isTechBoss
            ? TECH_RADAR_FRAG
            : HEXAGRAM_FRAG
          : SLAM_TELEGRAPH_FRAG;

      const groundMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: frag,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uFade: { value: 1 },
          uBurst: { value: 0 },
          uHalfAngle: { value: BOSS_PRISM.halfAngle },
          uColor: { value: color.clone() },
          uCoreColor: { value: prismAccent.clone() },
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
      if (skill === 'prism_cone') {
        groundMesh.rotation.order = 'YXZ';
        groundMesh.rotation.x = Math.PI / 2;
      } else {
        groundMesh.rotation.x = -Math.PI / 2;
      }
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
        // 3 lanes x 2 tandem hexagonal railgun accelerator gates (6 floating gates total!)
        const volleyGates: THREE.Mesh[] = [];
        for (let i = 0; i < BOSS_VOLLEY.spread.length * 2; i++) {
          const gateMat = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? cfg.telegraphColor : 0xffffff,
            transparent: true,
            opacity: 0.92,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          const gate = new THREE.Mesh(_unitHexGateGeo, gateMat);
          gate.position.y = 1.05;
          volleyGroup.add(gate);
          volleyGates.push(gate);
        }

        rig.volleyGroup = volleyGroup;
        rig.volleyLines = volleyLines;
        rig.volleyGates = volleyGates;
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
    if (skill === 'prism_cone') {
      rig.group.children[0].rotation.y = baseAngle;
    }

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
      // Giant pitch-black singularity grows prominently (1.6x larger!) then pinches right before detonation
      const grow = Math.min(1, progress * 1.45);
      const pinch = progress > 0.86 ? 1 - ((progress - 0.86) / 0.14) * 0.32 : 1;
      rig.singularity.position.y = 1.45;
      rig.singularity.scale.setScalar((0.35 + grow * 0.72) * pinch);
      rig.accretionDisk.position.y = 1.45;
      rig.accretionDisk.scale.setScalar((0.95 + grow * (rad * 0.98)) * pinch);
      rig.accretionDisk.rotation.z = this.elapsed * (2.2 + progress * 5.2);
      rig.accretionMat.uniforms.uTime.value = this.elapsed;
      rig.accretionMat.uniforms.uProgress.value = progress;
      rig.accretionMat.uniforms.uFade.value = Math.min(1, progress * 3.2);

      const infallW = 0.04 + progress * 0.11;
      rig.infallBeam.scale.set(infallW, 6.0, infallW);
      (rig.infallBeam.material as THREE.MeshBasicMaterial).opacity = 0.4 + progress * 0.55;

      // Dense multicolor cosmic particles spiraling into the pitch-black singularity!
      if (!this.isSoftwareGl) {
        const cosmicColors = [0x38e8ff, 0xffd24a, 0xff4d94, 0x4ef59a, 0xffffff, 0xff7b24];
        const count = progress > 0.45 ? 3 : 2;
        for (let k = 0; k < count; k++) {
          const a = Math.random() * Math.PI * 2;
          const d = rad * (0.75 + Math.random() * 0.85);
          const startY = 0.35 + Math.random() * 2.0;
          const col = cosmicColors[Math.floor(Math.random() * cosmicColors.length)];
          this.spawnParticle(
            tx + Math.cos(a) * d,
            startY,
            tz + Math.sin(a) * d,
            -Math.cos(a) * 5.8 - Math.sin(a) * 3.4,
            (1.45 - startY) * 2.4,
            -Math.sin(a) * 5.8 + Math.cos(a) * 3.4,
            col,
            0.78 + Math.random() * 0.35,
            0.34,
            0
          );
        }
      }
    } else if (skill === 'ranged_volley' && rig.volleyLines && rig.volleyGates) {
      const aimAngle = e.facing;
      const locked = progress >= BOSS_VOLLEY.aimTrackFraction;
      for (let i = 0; i < BOSS_VOLLEY.spread.length; i++) {
        const ang = aimAngle + BOSS_VOLLEY.spread[i];
        const dx = Math.sin(ang);
        const dz = Math.cos(ang);
        const hit = this.raycastBossBeam(tx, tz, dx, dz, 10.5);
        const bl = rig.volleyLines[i];
        bl.mesh.rotation.y = ang;
        bl.mesh.scale.set(locked ? 0.62 : 0.76, hit.dist, 1);
        bl.mesh.position.set(dx * (hit.dist * 0.5), 0.065, dz * (hit.dist * 0.5));
        bl.mat.uniforms.uTime.value = this.elapsed;
        bl.mat.uniforms.uProgress.value = locked ? Math.min(1, 0.55 + progress * 0.45) : progress * 0.55;

        // 2 tandem floating hexagonal railgun accelerator gates per lane (distances 1.15 & 2.25)
        for (let g = 0; g < 2; g++) {
          const gate = rig.volleyGates[i * 2 + g];
          const gDist = g === 0 ? 1.15 : 2.25;
          const appear = THREE.MathUtils.clamp((progress - g * 0.14) / 0.28, 0, 1);
          gate.visible = appear > 0.01;
          gate.position.set(dx * gDist, 1.05, dz * gDist);
          gate.rotation.y = ang;
          gate.rotation.z = this.elapsed * (locked ? 7.5 : 2.8) * (g === 0 ? 1 : -1);
          const gs = appear * (g === 0 ? 0.72 + progress * 0.35 : 0.55 + progress * 0.28);
          gate.scale.setScalar(gs);
          (gate.material as THREE.MeshBasicMaterial).color.setHex(locked ? 0xffffff : cfg.telegraphColor);
        }
      }
      if (!this.isSoftwareGl && Math.random() < 0.7) {
        const lane = BOSS_VOLLEY.spread[Math.floor(Math.random() * BOSS_VOLLEY.spread.length)];
        const ang = aimAngle + lane;
        const dist = 1.1 + Math.random() * 1.4;
        this.spawnParticle(
          tx + Math.sin(ang) * dist + (Math.random() - 0.5) * 0.4,
          1.05 + (Math.random() - 0.5) * 0.4,
          tz + Math.cos(ang) * dist + (Math.random() - 0.5) * 0.4,
          Math.sin(ang) * 3.0,
          0,
          Math.cos(ang) * 3.0,
          locked ? 0xffffff : cfg.telegraphColor,
          0.65,
          0.22,
          0
        );
      }
    }

    return true;
  },

  /**
   * Upgraded `slam` 360-degree impact VFX (Scheme 1 themed palettes — zero muddy brown!):
   * - Ironclad Warden (`boss_juggernaut`): high-contrast crimson + cool steel-white core, dark gunmetal blades, crimson-black smoke
   * - Crystal Behemoth (`boss_crystal_wyrm`): translucent luminous ice-cyan crystals, frost mist, icy cracks
   * - Spore Sovereign (`boss_fungal_king`): toxic emerald spikes, emerald spore clouds, venomous cracks
   */
  spawnBossSlamVfx(
    this: EmbervaultEngine,
    cx: number,
    cz: number,
    rad: number,
    colorHex: number,
    bossKind?: FloorBossKind
  ): void {
    if (this.bgSim) return;
    // Theme palette selection (eliminates earthy brown tones)
    const isCrimsonSteel = bossKind === 'boss_juggernaut';
    const isCrystal = bossKind === 'boss_crystal_wyrm';
    const isSpore = bossKind === 'boss_fungal_king';

    const mainHex = isCrimsonSteel ? 0xff1e3a : colorHex;
    const color = new THREE.Color(mainHex);
    const coreColor = isCrimsonSteel
      ? new THREE.Color(0xfff0f4)
      : isCrystal
      ? new THREE.Color(0xebfdff)
      : isSpore
      ? new THREE.Color(0xeafff0)
      : new THREE.Color(0xfff4e0);
    const spikeBaseHex = isCrimsonSteel ? 0x1a1d28 : isCrystal ? 0x5be8ff : isSpore ? 0x143320 : 0x1e202c;
    const spikeAltHex = isCrimsonSteel ? 0x26121b : isCrystal ? 0xb4f7ff : isSpore ? 0x225436 : 0x2a2433;
    const smokeHex = isCrimsonSteel ? 0x24070f : isCrystal ? 0x17445e : isSpore ? 0x11361e : 0x261c28;
    const sparkAccentHex = isCrimsonSteel ? 0xffd6de : isCrystal ? 0xffffff : isSpore ? 0xd8ffe4 : 0xfff2ba;

    const group = new THREE.Group();
    group.position.set(cx, 0, cz);

    // 1. High-power burst PointLight
    this.triggerBossBurstLight(cx, 1.85, cz, mainHex, 165, 0.52);

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

    // 4. Elevated 3D shockwave torus ring
    const shockTorusMat = new THREE.MeshBasicMaterial({
      color: coreColor.getHex(),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shockTorus = new THREE.Mesh(_unitTorusGeo, shockTorusMat);
    shockTorus.rotation.x = Math.PI / 2;
    shockTorus.position.y = 0.25;
    group.add(shockTorus);

    // 5. Procedural Voronoi cracked ground decal (themed core color — crisp crimson/ice/toxic!)
    const scorchMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: VORONOI_SCORCH_FRAG,
      uniforms: {
        uLife: { value: 0 },
        uColor: { value: color.clone() },
        uCoreColor: { value: coreColor.clone() },
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

    // 6. Staggered 3D erupting themed spikes (gunmetal crimson blades / translucent ice crystals / toxic spines)
    const spikeCount = this.isSoftwareGl ? 7 : 16;
    const spikes: Array<{ mesh: THREE.Mesh; delay: number; maxH: number }> = [];
    for (let i = 0; i < spikeCount; i++) {
      const a = (i / spikeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const dist = rad * (0.64 + Math.random() * 0.34);
      const isHot = i % 2 === 0;
      const mat = new THREE.MeshStandardMaterial({
        color: isHot ? spikeAltHex : spikeBaseHex,
        emissive: mainHex,
        emissiveIntensity: isCrystal ? 1.45 : isHot ? 1.55 : 0.75,
        roughness: isCrystal ? 0.14 : isCrimsonSteel ? 0.28 : 0.55,
        metalness: isCrimsonSteel ? 0.78 : isCrystal ? 0.2 : 0.2,
        transparent: true,
        opacity: isCrystal ? 0.88 : 1,
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

    // 7. Outer rolling themed mist / smoke billows
    const puffCount = this.isSoftwareGl ? 0 : 14;
    const puffs: Array<{ mesh: THREE.Mesh; dirX: number; dirZ: number; startR: number; spd: number }> = [];
    for (let i = 0; i < puffCount; i++) {
      const a = (i / puffCount) * Math.PI * 2 + Math.random() * 0.25;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? mainHex : smokeHex,
        transparent: true,
        opacity: isCrystal ? 0.45 : 0.58,
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
        i % 3 === 0 ? sparkAccentHex : mainHex,
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
   * `charge_slam` Supersonic Dash Cone VFX (rides in front of the charging boss for 0.3s).
   */
  spawnBossChargeDashVfx(
    this: EmbervaultEngine,
    sx: number,
    sz: number,
    tx: number,
    tz: number,
    duration: number,
    colorHex: number
  ): void {
    if (this.bgSim) return;
    const dx = tx - sx;
    const dz = tz - sz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.4) return;
    const angle = Math.atan2(dx, dz);

    const group = new THREE.Group();
    const coneMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: CHARGE_CONE_FRAG,
      uniforms: {
        uTime: { value: this.elapsed },
        uIntensity: { value: 1.0 },
        uColor: { value: new THREE.Color(colorHex) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const cone = new THREE.Mesh(_unitChargeConeGeo, coneMat);
    cone.rotation.order = 'YXZ';
    cone.rotation.y = angle;
    // Tip points forward along (sin(angle), 0, cos(angle))
    cone.rotation.x = Math.PI / 2;
    cone.position.set(sx, 1.05, sz);
    group.add(cone);

    this.dynamicGroup.add(group);
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife: Math.max(0.15, duration),
      update: (_dt, t, elapsed) => {
        const px = THREE.MathUtils.lerp(sx, tx, t);
        const pz = THREE.MathUtils.lerp(sz, tz, t);
        cone.position.set(px + (dx / dist) * 0.6, 1.05, pz + (dz / dist) * 0.6);
        coneMat.uniforms.uTime.value = elapsed;
        coneMat.uniforms.uIntensity.value = Math.sin(t * Math.PI);
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeOwnedMaterials(group);
      },
    });
  },

  /**
   * Independent `charge_slam` Impact VFX (inspired by video 01:11-01:17 Magma Rib Fissure + Fire Pillars):
   * - Long jagged molten/energy trench fissure along the entire charge path
   * - Two parallel rows of angled rib-like rock/crystal blades erupting along both sides of the trench
   * - 5 soaring vertical flame/energy pillars blasting skyward sequentially along the charge axis
   * - Forward-blasting giant crescent cleave shockwave + forward ember fan shower (completely distinct from `slam`!)
   */
  spawnBossChargeImpactVfx(
    this: EmbervaultEngine,
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    rad: number,
    colorHex: number
  ): void {
    if (this.bgSim) return;
    const dx = ex - sx;
    const dz = ez - sz;
    const rawLen = Math.hypot(dx, dz);
    const angle = rawLen > 0.1 ? Math.atan2(dx, dz) : 0;
    const dirX = Math.sin(angle);
    const dirZ = Math.cos(angle);
    const rightX = Math.cos(angle);
    const rightZ = -Math.sin(angle);
    const trenchLen = Math.max(3.6, rawLen + rad * 0.75);
    // Trench starts behind ex along -dir and extends slightly past ex
    const startX = ex - dirX * (trenchLen - rad * 0.65);
    const startZ = ez - dirZ * (trenchLen - rad * 0.65);

    const color = new THREE.Color(colorHex);
    const group = new THREE.Group();

    // 1. High-intensity burst PointLight at landing impact
    this.triggerBossBurstLight(ex, 2.0, ez, colorHex, 175, 0.58);

    // 2. Long jagged burning trench fissure decal along the charge corridor (1.9s)
    const trenchMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: TRENCH_FISSURE_FRAG,
      uniforms: {
        uLife: { value: 0 },
        uTime: { value: this.elapsed },
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
    const trenchMesh = new THREE.Mesh(_unitBeamFloorGeo, trenchMat);
    trenchMesh.rotation.order = 'YXZ';
    trenchMesh.rotation.y = angle;
    trenchMesh.rotation.x = Math.PI / 2;
    trenchMesh.scale.set(2.35, trenchLen, 1);
    trenchMesh.position.set(
      startX + dirX * (trenchLen * 0.5),
      0.056,
      startZ + dirZ * (trenchLen * 0.5)
    );
    group.add(trenchMesh);

    // 3. Forward-blasting giant crescent cleave shockwave at the landing point
    const crescentMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: CRESCENT_ARC_FRAG,
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
    const crescentMesh = new THREE.Mesh(_unitPlaneGeo, crescentMat);
    crescentMesh.rotation.order = 'YXZ';
    crescentMesh.rotation.y = angle;
    crescentMesh.rotation.x = Math.PI / 2;
    crescentMesh.position.set(ex, 0.16, ez);
    crescentMesh.scale.setScalar(rad * 0.7);
    group.add(crescentMesh);

    // 4. White-hot impact core flash at landing spot
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
    flashMesh.position.set(ex, 0.28, ez);
    flashMesh.scale.setScalar(rad * 1.55);
    group.add(flashMesh);

    // 5. Two parallel rows of angled rib-like rock/energy blades flanking the trench (video 01:12!)
    const ribPairs = this.isSoftwareGl ? 3 : 6;
    const ribs: Array<{ mesh: THREE.Mesh; delay: number; maxH: number }> = [];
    for (let i = 0; i < ribPairs; i++) {
      const frac = (i + 0.5) / ribPairs;
      const rxBase = startX + dirX * (trenchLen * frac);
      const rzBase = startZ + dirZ * (trenchLen * frac);
      for (const side of [-1, 1]) {
        const mat = new THREE.MeshStandardMaterial({
          color: 0x1c1412,
          emissive: colorHex,
          emissiveIntensity: 1.45,
          roughness: 0.65,
          metalness: 0.2,
          transparent: true,
          opacity: 1,
        });
        const mesh = new THREE.Mesh(_unitRibGeo, mat);
        const lateral = 1.05 + (i === ribPairs - 1 ? 0.25 : 0);
        mesh.position.set(rxBase + rightX * side * lateral, -0.5, rzBase + rightZ * side * lateral);
        mesh.rotation.order = 'YXZ';
        mesh.rotation.y = angle;
        // Tilt outward like giant rib bones flanking the magma fissure
        mesh.rotation.z = -side * 0.36;
        const maxH = 0.85 + frac * 0.65;
        mesh.scale.set(1, 0.02, 1);
        group.add(mesh);
        ribs.push({ mesh, delay: i * 0.024, maxH });
      }
    }

    // 6. 5 Soaring vertical erupting flame/energy pillars blasting skyward along the trench (video 01:15!)
    const pillarCount = this.isSoftwareGl ? 3 : 5;
    const pillars: Array<{
      outer: THREE.Mesh;
      outerMat: THREE.ShaderMaterial;
      core: THREE.Mesh;
      coreMat: THREE.MeshBasicMaterial;
      delay: number;
      maxH: number;
      radius: number;
    }> = [];
    for (let i = 0; i < pillarCount; i++) {
      const frac = 0.14 + (i / Math.max(1, pillarCount - 1)) * 0.82;
      const px = startX + dirX * (trenchLen * frac);
      const pz = startZ + dirZ * (trenchLen * frac);
      const radius = 0.42 + frac * 0.28;
      const maxH = 3.2 + frac * 1.9;

      const outerMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: PILLAR_FLAME_FRAG,
        uniforms: {
          uTime: { value: this.elapsed },
          uLife: { value: 0 },
          uColor: { value: color.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const outer = new THREE.Mesh(_unitCylGeo, outerMat);
      outer.position.set(px, 0, pz);
      outer.scale.set(radius, 0.01, radius);
      outer.visible = false;
      group.add(outer);

      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xfff8de,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const core = new THREE.Mesh(_unitCoreCylGeo, coreMat);
      core.position.set(px, 0, pz);
      core.scale.set(radius * 0.38, 0.01, radius * 0.38);
      core.visible = false;
      group.add(core);

      pillars.push({ outer, outerMat, core, coreMat, delay: i * 0.032, maxH, radius });
    }

    // 7. Forward directional ember / magma shower blasting out from landing point
    const sparkCount = this.isSoftwareGl ? 14 : 34;
    for (let i = 0; i < sparkCount; i++) {
      const fanAng = angle + (Math.random() - 0.5) * 1.55;
      const spd = 4.2 + Math.random() * 6.2;
      this.spawnParticle(
        ex + (Math.random() - 0.5) * 0.8,
        0.4,
        ez + (Math.random() - 0.5) * 0.8,
        Math.sin(fanAng) * spd,
        2.6 + Math.random() * 4.2,
        Math.cos(fanAng) * spd,
        i % 3 === 0 ? 0xfff4c2 : colorHex,
        1.35,
        0.58,
        8.4
      );
    }

    this.dynamicGroup.add(group);
    const maxLife = 1.9;
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt, _t, elapsed) => {
        const age = (group.userData.age = (group.userData.age ?? 0) + dt);

        trenchMat.uniforms.uLife.value = Math.min(1, age / maxLife);
        trenchMat.uniforms.uTime.value = elapsed;

        const ft = Math.min(1, age / 0.22);
        flashMesh.visible = ft < 1;
        if (ft < 1) {
          flashMat.uniforms.uIntensity.value = Math.pow(1 - ft, 1.5);
          flashMesh.scale.setScalar(rad * (1.0 + ft * 0.95));
        }

        const ct = Math.min(1, age / 0.44);
        crescentMesh.visible = ct < 1;
        if (ct < 1) {
          crescentMat.uniforms.uLife.value = ct;
          const ease = 1 - Math.pow(1 - ct, 2.2);
          crescentMesh.scale.setScalar(rad * (0.7 + ease * 1.55));
          crescentMesh.position.set(ex + dirX * ease * 0.9, 0.16, ez + dirZ * ease * 0.9);
        }

        // Rib blades pop up staggered along the trench, hold, then sink
        for (const rb of ribs) {
          const ra = age - rb.delay;
          if (ra <= 0 || ra >= 1.15) {
            rb.mesh.visible = false;
            continue;
          }
          rb.mesh.visible = true;
          const mat = rb.mesh.material as THREE.MeshStandardMaterial;
          if (ra < 0.12) {
            const p = ra / 0.12;
            const h = rb.maxH * p * (1 + Math.sin(p * Math.PI) * 0.22);
            rb.mesh.scale.y = Math.max(0.05, h);
            rb.mesh.position.y = h * 0.55;
            mat.emissiveIntensity = 1.9;
          } else {
            const p = (ra - 0.12) / 1.03;
            const sink = 1 - Math.pow(p, 1.9);
            const h = rb.maxH * sink;
            rb.mesh.scale.y = Math.max(0.02, h);
            rb.mesh.position.y = h * 0.55 - p * 0.2;
            mat.emissiveIntensity = 1.3 * (1 - p);
            mat.opacity = 1 - Math.pow(p, 2.2);
          }
        }

        // Vertical fire pillars erupt skyward rapidly then dissolve over 0.72s
        for (const pl of pillars) {
          const pa = age - pl.delay;
          const pDur = 0.72;
          if (pa <= 0 || pa >= pDur) {
            pl.outer.visible = false;
            pl.core.visible = false;
            continue;
          }
          pl.outer.visible = true;
          pl.core.visible = true;
          const pt = pa / pDur;
          const rise = Math.min(1, pa / 0.11);
          const h = pl.maxH * (1 - Math.pow(1 - rise, 2.4));
          const width = (1 - Math.pow(pt, 1.8)) * (0.9 + 0.15 * Math.sin(elapsed * 40));

          pl.outer.scale.set(pl.radius * (0.65 + width * 0.55), Math.max(0.05, h), pl.radius * (0.65 + width * 0.55));
          pl.outer.position.y = h * 0.5;
          pl.outerMat.uniforms.uTime.value = elapsed;
          pl.outerMat.uniforms.uLife.value = pt;

          pl.core.scale.set(pl.radius * 0.36 * width, Math.max(0.05, h * 0.85), pl.radius * 0.36 * width);
          pl.core.position.y = h * 0.425;
          pl.coreMat.opacity = Math.pow(1 - pt, 1.35) * 0.85;
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

    // 6. Multicolor cosmic starlight burst
    const cosmicPalette = [0x38e8ff, 0xffd24a, 0xff4d94, 0x4ef59a, 0xffffff, 0xff7b24];
    const sparkCount = this.isSoftwareGl ? 16 : 44;
    for (let i = 0; i < sparkCount; i++) {
      const a = (i / sparkCount) * Math.PI * 2 + Math.random() * 0.2;
      const spd = 3.5 + Math.random() * 5.6;
      this.spawnParticle(
        cx + Math.cos(a) * 0.5,
        1.1,
        cz + Math.sin(a) * 0.5,
        Math.cos(a) * spd,
        1.6 + Math.random() * 3.4,
        Math.sin(a) * spd,
        cosmicPalette[i % cosmicPalette.length],
        1.3,
        0.65,
        3.2
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
   * Reworked `ranged_volley` Triple Railgun Horizon Barrage VFX (inspired by video 00:00-00:06):
   * - High-intensity burst PointLight + white-hot muzzle flare
   * - 3 supersonic plasma flash lances blasting through 6 tandem Mach shock-cone rings
   * - 3 glowing railgun scorched floor trenches fading over 0.95s + heavy spark jet
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

    const mx = Math.sin(baseAngle) * 1.4;
    const mz = Math.cos(baseAngle) * 1.4;
    this.triggerBossBurstLight(ox + mx, 1.5, oz + mz, colorHex, 150, 0.42);

    // 1. Intense muzzle flash flare
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
    flashMesh.position.set(mx, 1.05, mz);
    flashMesh.rotation.x = -Math.PI / 2;
    flashMesh.scale.setScalar(2.6);
    group.add(flashMesh);

    // 2. Per-lane railgun flash lance + 2 Mach shock-cone rings + scorched floor trench
    const lances: Array<{ core: THREE.Mesh; coreMat: THREE.MeshBasicMaterial; sheath: THREE.Mesh; sheathMat: THREE.ShaderMaterial }> = [];
    const machRings: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; dirX: number; dirZ: number; baseDist: number; delay: number }> = [];
    const trails: THREE.ShaderMaterial[] = [];

    for (const off of BOSS_VOLLEY.spread) {
      const ang = baseAngle + off;
      const dx = Math.sin(ang);
      const dz = Math.cos(ang);
      const hit = this.raycastBossBeam(ox, oz, dx, dz, 10.5);
      const lanceLen = Math.min(hit.dist, 7.5);
      const midX = dx * (lanceLen * 0.5 + 0.5);
      const midZ = dz * (lanceLen * 0.5 + 0.5);

      // Blazing white-hot railgun muzzle lance
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const core = new THREE.Mesh(_unitCoreCylGeo, coreMat);
      core.rotation.order = 'YXZ';
      core.rotation.y = ang;
      core.rotation.x = Math.PI / 2;
      core.position.set(midX, 1.05, midZ);
      core.scale.set(0.16, lanceLen, 0.16);
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
      sheath.rotation.y = ang;
      sheath.rotation.x = Math.PI / 2;
      sheath.position.set(midX, 1.05, midZ);
      sheath.scale.set(0.36, lanceLen, 0.36);
      group.add(sheath);
      lances.push({ core, coreMat, sheath, sheathMat });

      // 2 Mach shock-cone rings blasting forward at each gate
      for (let g = 0; g < 2; g++) {
        const ringMat = new THREE.MeshBasicMaterial({
          color: g === 0 ? 0xffffff : colorHex,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(_unitTorusGeo, ringMat);
        const baseDist = g === 0 ? 1.15 : 2.35;
        ring.position.set(dx * baseDist, 1.05, dz * baseDist);
        ring.rotation.y = ang;
        ring.scale.setScalar(0.45);
        group.add(ring);
        machRings.push({ mesh: ring, mat: ringMat, dirX: dx, dirZ: dz, baseDist, delay: g * 0.035 });
      }

      // Scorched plasma floor trench
      const mat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: LASER_FLOOR_FRAG,
        uniforms: {
          uTime: { value: this.elapsed },
          uIntensity: { value: 0.95 },
          uScorch: { value: 0.25 },
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
      strip.scale.set(0.95, hit.dist, 1);
      strip.position.set(dx * (hit.dist * 0.5), 0.06, dz * (hit.dist * 0.5));
      group.add(strip);
      trails.push(mat);
    }

    // Heavy supersonic spark jet
    if (!this.isSoftwareGl) {
      for (let i = 0; i < 28; i++) {
        const a = baseAngle + (Math.random() - 0.5) * 0.95;
        const spd = 5.0 + Math.random() * 6.5;
        this.spawnParticle(
          ox + Math.sin(a) * 1.1,
          1.05 + (Math.random() - 0.5) * 0.35,
          oz + Math.cos(a) * 1.1,
          Math.sin(a) * spd,
          0.6 + Math.random() * 1.8,
          Math.cos(a) * spd,
          i % 2 === 0 ? 0xffffff : colorHex,
          1.15,
          0.42,
          3.2
        );
      }
    }

    this.dynamicGroup.add(group);
    const maxLife = 0.95;
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt, t, elapsed) => {
        const age = (group.userData.age = (group.userData.age ?? 0) + dt);
        const ft = Math.min(1, age / 0.2);
        flashMesh.visible = ft < 1;
        if (ft < 1) {
          flashMat.uniforms.uIntensity.value = Math.pow(1 - ft, 1.4);
          flashMesh.scale.setScalar(2.0 + ft * 1.8);
        }

        const lt = Math.min(1, age / 0.28);
        for (const ln of lances) {
          ln.core.visible = lt < 1;
          ln.sheath.visible = lt < 1;
          if (lt < 1) {
            const w = age < 0.05 ? THREE.MathUtils.lerp(0.6, 1.45, age / 0.05) : Math.max(0.02, 1.45 * (1 - lt));
            ln.core.scale.x = 0.16 * w;
            ln.core.scale.z = 0.16 * w;
            ln.coreMat.opacity = Math.pow(1 - lt, 1.15);
            ln.sheath.scale.x = 0.38 * w;
            ln.sheath.scale.z = 0.38 * w;
            ln.sheathMat.uniforms.uTime.value = elapsed;
            ln.sheathMat.uniforms.uIntensity.value = 1 - lt;
          }
        }

        for (const mr of machRings) {
          const ma = age - mr.delay;
          const mDur = 0.34;
          if (ma <= 0 || ma >= mDur) {
            mr.mesh.visible = false;
            continue;
          }
          mr.mesh.visible = true;
          const mt = ma / mDur;
          const ease = 1 - Math.pow(1 - mt, 2.2);
          mr.mesh.scale.setScalar(0.5 + ease * 1.65);
          mr.mesh.position.set(
            mr.dirX * (mr.baseDist + ease * 2.2),
            1.05,
            mr.dirZ * (mr.baseDist + ease * 2.2)
          );
          mr.mat.opacity = (1 - mt) * 0.95;
        }

        for (const tm of trails) {
          tm.uniforms.uTime.value = elapsed;
          tm.uniforms.uIntensity.value = Math.pow(1 - t, 1.25) * 0.85;
          tm.uniforms.uScorch.value = age < 0.25 ? 0.15 : 0.85;
        }
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeOwnedMaterials(group);
      },
    });
  },

  /**
   * `prism_cone` Stained-Glass / Crystal Fan Eruption & Shatter VFX (video 00:55-01:02):
   * - Lingering stained-glass prism fan floor decal
   * - 14 staggered 3D translucent crystal/bone/plasma prisms erupting outward across the 70-degree cone
   * - Collective shatter at 0.28s into sparkling multi-hued crystal shards + burst PointLight
   */
  spawnBossPrismConeVfx(
    this: EmbervaultEngine,
    ox: number,
    oz: number,
    baseAngle: number,
    range: number,
    halfAngle: number,
    colorHex: number,
    bossKind?: FloorBossKind
  ): void {
    if (this.bgSim) return;
    const isCrystal = bossKind === 'boss_crystal_wyrm';
    const isFlesh = bossKind === 'boss_leviathan_heart';
    const color = new THREE.Color(colorHex);
    const accent = isCrystal
      ? new THREE.Color(0xd96bff)
      : isFlesh
      ? new THREE.Color(0xffb84d)
      : new THREE.Color(0x38e8ff);

    const group = new THREE.Group();
    group.position.set(ox, 0, oz);

    const cx = ox + Math.sin(baseAngle) * (range * 0.55);
    const cz = oz + Math.cos(baseAngle) * (range * 0.55);
    this.triggerBossBurstLight(cx, 1.8, cz, colorHex, 155, 0.52);

    // 1. Lingering stained-glass prism fan floor decal
    const fanMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: PRISM_CONE_FRAG,
      uniforms: {
        uTime: { value: this.elapsed },
        uProgress: { value: 1.0 },
        uFade: { value: 0.95 },
        uHalfAngle: { value: halfAngle },
        uColor: { value: color.clone() },
        uCoreColor: { value: accent.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const fanMesh = new THREE.Mesh(_unitPlaneGeo, fanMat);
    fanMesh.rotation.order = 'YXZ';
    fanMesh.rotation.y = baseAngle;
    fanMesh.rotation.x = Math.PI / 2;
    fanMesh.position.y = 0.056;
    fanMesh.scale.setScalar(range);
    group.add(fanMesh);

    // 2. 3 rows of staggered 3D prism spires inside the 70-degree cone
    const rows = this.isSoftwareGl ? [2, 3] : [3, 5, 6];
    const prisms: Array<{ mesh: THREE.Mesh; delay: number; maxH: number; wx: number; wz: number; col: number; shattered: boolean }> = [];
    rows.forEach((count, rowIdx) => {
      const rFrac = (rowIdx + 1) / (rows.length + 0.25);
      const dist = range * rFrac;
      for (let i = 0; i < count; i++) {
        const u = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
        const ang = baseAngle + u * (halfAngle * 0.86);
        const px = Math.sin(ang) * dist;
        const pz = Math.cos(ang) * dist;
        const colHex = i % 2 === 0 ? colorHex : accent.getHex();
        const mat = new THREE.MeshStandardMaterial({
          color: colHex,
          emissive: colHex,
          emissiveIntensity: 1.35,
          roughness: 0.14,
          metalness: 0.25,
          transparent: true,
          opacity: 0.88,
        });
        const mesh = new THREE.Mesh(_unitPrismGeo, mat);
        mesh.position.set(px, 0, pz);
        mesh.rotation.y = ang + i * 0.4;
        const maxH = 1.65 + rFrac * 1.45;
        mesh.scale.set(0.7 + rFrac * 0.35, 0.01, 0.7 + rFrac * 0.35);
        mesh.visible = false;
        group.add(mesh);
        prisms.push({ mesh, delay: rowIdx * 0.035 + i * 0.01, maxH, wx: ox + px, wz: oz + pz, col: colHex, shattered: false });
      }
    });

    this.dynamicGroup.add(group);
    const shatterAt = 0.32;
    const maxLife = 1.15;
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt, _t, elapsed) => {
        const age = (group.userData.age = (group.userData.age ?? 0) + dt);
        fanMat.uniforms.uTime.value = elapsed;
        fanMat.uniforms.uFade.value = Math.pow(1 - Math.min(1, age / maxLife), 1.3) * 0.92;

        for (const pr of prisms) {
          const pa = age - pr.delay;
          if (pa <= 0) {
            pr.mesh.visible = false;
            continue;
          }
          if (age >= shatterAt) {
            pr.mesh.visible = false;
            if (!pr.shattered) {
              pr.shattered = true;
              const shards = this.isSoftwareGl ? 2 : 4;
              for (let s = 0; s < shards; s++) {
                const sa = Math.random() * Math.PI * 2;
                const spd = 2.4 + Math.random() * 4.2;
                this.spawnParticle(
                  pr.wx,
                  0.6 + Math.random() * 0.9,
                  pr.wz,
                  Math.cos(sa) * spd,
                  2.4 + Math.random() * 3.4,
                  Math.sin(sa) * spd,
                  s % 2 === 0 ? 0xffffff : pr.col,
                  0.85,
                  0.48,
                  7.8
                );
              }
            }
            continue;
          }
          pr.mesh.visible = true;
          const rise = Math.min(1, pa / 0.11);
          const overshoot = 1 + Math.sin(rise * Math.PI) * 0.2;
          const h = pr.maxH * rise * overshoot;
          pr.mesh.scale.y = Math.max(0.05, h);
          pr.mesh.position.y = h * 0.35;
        }
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeOwnedMaterials(group);
      },
    });
  },

  /**
   * Standalone windup telegraph for sequential `orbital_barrage` shots (ground seal + sky energy portal).
   */
  spawnBossOrbitalTelegraphVfx(
    this: EmbervaultEngine,
    tx: number,
    tz: number,
    rad: number,
    windupDur: number,
    colorHex: number,
    isTech = false
  ): void {
    if (this.bgSim) return;
    const color = new THREE.Color(colorHex);
    const group = new THREE.Group();
    group.position.set(tx, 0, tz);

    const groundMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: isTech ? TECH_RADAR_FRAG : HEXAGRAM_FRAG,
      uniforms: {
        uTime: { value: this.elapsed },
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
    groundMesh.position.y = 0.056;
    groundMesh.scale.setScalar(rad);
    group.add(groundMesh);

    // High-altitude sky portal ring opening at y = 6.2
    const portalMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const portalRing = new THREE.Mesh(_unitTorusGeo, portalMat);
    portalRing.position.y = 6.2;
    portalRing.rotation.x = Math.PI / 2;
    portalRing.scale.setScalar(0.2);
    group.add(portalRing);

    // Thin vertical aiming guide beam from sky portal down to ground
    const guideMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const guide = new THREE.Mesh(_unitCoreCylGeo, guideMat);
    guide.position.y = 3.1;
    guide.scale.set(0.04, 6.2, 0.04);
    group.add(guide);

    this.dynamicGroup.add(group);
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife: windupDur,
      update: (dt, t, elapsed) => {
        groundMat.uniforms.uTime.value = elapsed;
        groundMat.uniforms.uProgress.value = t;
        portalRing.scale.setScalar(0.3 + t * rad * 0.78);
        portalRing.rotation.z += dt * (4 + t * 6);
        guide.scale.x = 0.03 + t * 0.07;
        guide.scale.z = 0.03 + t * 0.07;
        guideMat.opacity = 0.25 + t * 0.65;
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeOwnedMaterials(group);
      },
    });
  },

  /**
   * `orbital_barrage` Sky-to-Ground Energy Pillar Strike VFX (video 00:26-00:30 Astral Cataclysm):
   * - Blazing white-core sky pillar + downward-streaming plasma sheath
   * - Twin ascending 3D energy torus rings rising up the beam
   * - White-hot flash + burst PointLight + Voronoi scorch aftermath
   */
  spawnBossOrbitalPillarVfx(
    this: EmbervaultEngine,
    tx: number,
    tz: number,
    rad: number,
    colorHex: number
  ): void {
    if (this.bgSim) return;
    const color = new THREE.Color(colorHex);
    const group = new THREE.Group();
    group.position.set(tx, 0, tz);

    this.triggerBossBurstLight(tx, 2.2, tz, colorHex, 155, 0.48);

    // 1. Sky-to-ground beam core + outer plasma sheath (height 12)
    const beamH = 12;
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(_unitCoreCylGeo, coreMat);
    core.position.y = beamH * 0.5;
    core.scale.set(rad * 0.28, beamH, rad * 0.28);
    group.add(core);

    const sheathMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: ORBITAL_BEAM_FRAG,
      uniforms: {
        uTime: { value: this.elapsed },
        uLife: { value: 0 },
        uColor: { value: color.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const sheath = new THREE.Mesh(_unitCylGeo, sheathMat);
    sheath.position.y = beamH * 0.5;
    sheath.scale.set(rad * 0.58, beamH, rad * 0.58);
    group.add(sheath);

    // 2. Twin ascending energy rings (video signature!)
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring1 = new THREE.Mesh(_unitTorusGeo, ringMat1);
    ring1.rotation.x = Math.PI / 2;
    ring1.position.y = 0.4;
    group.add(ring1);

    const ringMat2 = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring2 = new THREE.Mesh(_unitTorusGeo, ringMat2);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 1.4;
    group.add(ring2);

    // 3. Voronoi scorch ground crater
    const scorchMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: VORONOI_SCORCH_FRAG,
      uniforms: {
        uLife: { value: 0 },
        uColor: { value: color.clone() },
        uCoreColor: { value: new THREE.Color(0xffffff) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const scorch = new THREE.Mesh(_unitPlaneGeo, scorchMat);
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.05;
    scorch.scale.setScalar(rad * 1.15);
    group.add(scorch);

    if (!this.isSoftwareGl) {
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const spd = 2.8 + Math.random() * 4.2;
        this.spawnParticle(
          tx + Math.cos(a) * rad * 0.3,
          0.3,
          tz + Math.sin(a) * rad * 0.3,
          Math.cos(a) * spd,
          2.2 + Math.random() * 3.5,
          Math.sin(a) * spd,
          i % 2 === 0 ? 0xffffff : colorHex,
          1.1,
          0.48,
          6.5
        );
      }
    }

    this.dynamicGroup.add(group);
    const beamDur = 0.48;
    const maxLife = 1.4;
    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (dt, _t, elapsed) => {
        const age = (group.userData.age = (group.userData.age ?? 0) + dt);
        const bt = Math.min(1, age / beamDur);
        core.visible = bt < 1;
        sheath.visible = bt < 1;
        if (bt < 1) {
          const w = age < 0.06 ? THREE.MathUtils.lerp(0.5, 1.3, age / 0.06) : Math.max(0.02, 1.3 * (1 - Math.pow((age - 0.06) / (beamDur - 0.06), 1.4)));
          core.scale.set(rad * 0.28 * w, beamH, rad * 0.28 * w);
          coreMat.opacity = Math.pow(1 - bt, 1.2);
          sheath.scale.set(rad * 0.58 * w, beamH, rad * 0.58 * w);
          sheathMat.uniforms.uTime.value = elapsed;
          sheathMat.uniforms.uLife.value = bt;
        }

        const rt = Math.min(1, age / 0.62);
        ring1.visible = rt < 1;
        ring2.visible = rt < 1;
        if (rt < 1) {
          const ease = 1 - Math.pow(1 - rt, 2.0);
          ring1.position.y = 0.35 + ease * 3.2;
          ring1.scale.setScalar(rad * (0.55 + ease * 0.85));
          ringMat1.opacity = (1 - rt) * 0.9;

          ring2.position.y = 1.3 + ease * 3.6;
          ring2.scale.setScalar(rad * (0.7 + ease * 0.95));
          ringMat2.opacity = (1 - rt) * 0.85;
        }

        scorchMat.uniforms.uLife.value = Math.min(1, age / maxLife);
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
