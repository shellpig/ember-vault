import * as THREE from 'three';
import type { EmbervaultEngine } from '../engine';
import { q100 } from '../../../shared/game';

// ---------------------------------------------------------------------------------------------------------------
// Frost Mage skill VFX: Frost Nova, ice spike burst and Blink. Procedural shaders on shared geometry, driven by
// the same `bossVfxItems` lifecycle as the boss VFX (updated in updateBossVfx, cleared in clearBossVfx).
// Visual only: damage and hit logic stay in classSkills.ts.
// ---------------------------------------------------------------------------------------------------------------

export const FLAT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NOISE_GLSL = /* glsl */ `
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
// Distance to a six-armed snowflake (main arms plus two pairs of side branches), r in [0, 1]
float snowflake(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float sector = 1.04719755;
  a = mod(a + sector * 0.5, sector) - sector * 0.5;
  vec2 q = r * vec2(cos(a), abs(sin(a)));
  float d = q.x < 0.92 ? q.y : length(q - vec2(0.92, 0.0));
  vec2 b1 = vec2(0.42, 0.0);
  vec2 dir = vec2(0.5, 0.866);
  vec2 v1 = q - b1;
  float t1 = clamp(dot(v1, dir), 0.0, 0.3);
  d = min(d, length(v1 - dir * t1));
  vec2 b2 = vec2(0.66, 0.0);
  vec2 v2 = q - b2;
  float t2 = clamp(dot(v2, dir), 0.0, 0.2);
  d = min(d, length(v2 - dir * t2));
  return d;
}
`;

/** Ground frost wave: front sweeps out to the nova radius, leaves rime and crystal branches that melt away. */
const NOVA_FLOOR_FRAG = /* glsl */ `
uniform float uLife;
uniform float uSeed;
uniform vec3 uColor;
uniform vec3 uCore;
uniform vec3 uAccent;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  float sweep = clamp(uLife / 0.34, 0.0, 1.0);
  float front = 1.0 - pow(1.0 - sweep, 2.4);
  float n = noise(vec2(a * 7.0 + uSeed, r * 9.0));
  float d = r - front + (n - 0.5) * 0.04;

  float waveFade = 1.0 - smoothstep(0.28, 0.48, uLife);
  float wave = smoothstep(0.07, 0.0, abs(d)) * waveFade;
  float waveCore = smoothstep(0.022, 0.0, abs(d)) * waveFade;
  float behind = smoothstep(0.02, -0.05, d);

  // Twelve frost branches with a jagged spine, plus noisy rime
  float spokes = abs(fract(a / 6.2831853 * 12.0 + uSeed + (noise(vec2(r * 14.0, uSeed * 3.0)) - 0.5) * 0.16) - 0.5);
  float branch = smoothstep(0.035, 0.0, spokes * r) * smoothstep(0.12, 0.3, r);
  float rime = smoothstep(0.5, 0.85, noise(p * 16.0 + uSeed * 7.0)) * 0.7 + smoothstep(0.62, 0.9, noise(p * 38.0 - uSeed)) * 0.5;
  float residueFade = 1.0 - smoothstep(0.5, 1.0, uLife);
  float nearFront = exp(-max(0.0, -d) * 3.2);

  float frost = (rime * 0.32 + branch * 0.75) * behind * residueFade * (0.4 + 0.6 * nearFront);
  float glint = step(0.985, hash(floor(p * 60.0) + floor(uLife * 9.0))) * behind * residueFade;
  float edge = smoothstep(1.0, 0.9, r);

  vec3 col = uColor * (frost + wave * 1.3) + uCore * (waveCore * 1.8 + frost * 0.25) + uAccent * (glint * 1.4 + wave * n * 0.35);
  float alpha = clamp((frost + wave + waveCore + glint) * edge, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Ice spike impact: central flash, expanding ring, shatter cracks and (empowered) a snowflake sigil. */
const ICE_BURST_FRAG = /* glsl */ `
uniform float uLife;
uniform float uSeed;
uniform float uSigil;
uniform vec3 uColor;
uniform vec3 uCore;
uniform vec3 uAccent;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  float grow = 1.0 - pow(1.0 - uLife, 2.6);
  float ringPos = grow * 0.94;
  float ring = smoothstep(0.1, 0.0, abs(r - ringPos)) * (1.0 - uLife);
  float ringCore = smoothstep(0.03, 0.0, abs(r - ringPos)) * (1.0 - uLife);
  float flash = smoothstep(0.5, 0.0, r) * pow(1.0 - uLife, 3.0);

  float sx = a / 6.2831853 * 7.0 + uSeed + (noise(vec2(r * 7.0, uSeed * 5.0)) - 0.5) * 0.35;
  float sb = min(fract(sx), 1.0 - fract(sx));
  float crack = smoothstep(0.05, 0.0, sb * r) * step(r, ringPos + 0.02) * (1.0 - smoothstep(0.35, 1.0, uLife));

  float sigilD = snowflake(p / 0.86);
  float sigil = uSigil * smoothstep(0.035, 0.0, sigilD) * smoothstep(0.0, 0.15, uLife) * (1.0 - smoothstep(0.55, 1.0, uLife));

  vec3 col = uColor * (ring * 1.3 + crack * 0.9 + sigil * 1.1) + uCore * (flash * 1.7 + ringCore * 1.4 + sigil * 0.5) + uAccent * sigil * 0.35;
  float alpha = clamp(ring + ringCore + crack + flash + sigil, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Faceted ice crystal (cones): deep blue base -> pale tip with a fresnel rim. */
const CRYSTAL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const CRYSTAL_FRAG = /* glsl */ `
uniform float uFade;
uniform vec3 uDeep;
uniform vec3 uColor;
uniform vec3 uCore;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  vec3 col = mix(uDeep, uColor, smoothstep(0.0, 0.75, vUv.y));
  col = mix(col, uCore, smoothstep(0.72, 1.0, vUv.y));
  col += uCore * fres * 0.9;
  gl_FragColor = vec4(col, uFade * (0.72 + 0.28 * fres));
}
`;

/** Rising frost column (open cylinder): upward-scrolling streaks, fades toward the top. */
const PILLAR_FRAG = /* glsl */ `
uniform float uLife;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCore;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  float streak = noise(vec2(vUv.x * 18.0, vUv.y * 3.0 - uTime * 6.0));
  streak = smoothstep(0.45, 0.95, streak);
  float vertical = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
  float fade = pow(1.0 - uLife, 1.6);
  vec3 col = uColor * (0.35 + streak) + uCore * streak * 0.8;
  float alpha = clamp((0.25 + streak * 0.9) * vertical * fade, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Blink ground trail: frost streak from the start point to the end point, melting from the start first. */
const TRAIL_FRAG = /* glsl */ `
uniform float uLife;
uniform float uSeed;
uniform vec3 uColor;
uniform vec3 uCore;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  float across = abs(vUv.y - 0.5) * 2.0;
  float n = noise(vec2(vUv.x * 22.0 + uSeed, vUv.y * 6.0));
  float width = 0.35 + 0.45 * vUv.x + (n - 0.5) * 0.3;
  float body = smoothstep(width, width * 0.3, across);
  float core = smoothstep(0.16, 0.0, across) * (0.6 + 0.4 * vUv.x);
  float rime = smoothstep(0.55, 0.9, noise(vUv * vec2(60.0, 10.0) + uSeed)) * body;
  // Melts from the start (x = 0) toward the end
  float melt = smoothstep(uLife * 1.25 - 0.1, uLife * 1.25 + 0.15, vUv.x);
  float ends = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  vec3 col = uColor * (body * 0.55 + rime * 0.8) + uCore * core * 1.5;
  float alpha = clamp((body * 0.45 + rime + core) * melt * ends * (1.0 - uLife * 0.5), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

const ICE_BLUE = 0x8fe3ff;
const ICE_CORE = 0xf2fdff;
const ICE_DEEP = 0x2a6fd0;
const MAGE_GOLD = 0xffd84a;

const _flatGeo = new THREE.PlaneGeometry(2, 2);
const _trailGeo = new THREE.PlaneGeometry(1, 1);
export const _crystalGeo = (() => {
  const g = new THREE.ConeGeometry(1, 1, 6, 1, false);
  g.translate(0, 0.5, 0); // base on the floor
  return g;
})();
const _pillarGeo = (() => {
  const g = new THREE.CylinderGeometry(1, 1.15, 1, 20, 1, true);
  g.translate(0, 0.5, 0);
  return g;
})();

export function flatMat(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FLAT_VERT,
    fragmentShader: frag,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Faceted crystal / shard material (ice by default; other skills pass their own deep / mid / tip colours). */
export function crystalMat(deep = ICE_DEEP, color = ICE_BLUE, core = ICE_CORE): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CRYSTAL_VERT,
    fragmentShader: CRYSTAL_FRAG,
    uniforms: {
      uFade: { value: 1 },
      uDeep: { value: new THREE.Color(deep) },
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
    },
    transparent: true,
    depthWrite: false,
  });
}

export function floorQuad(mat: THREE.Material, x: number, z: number, radius: number, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(_flatGeo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.scale.set(radius, radius, 1);
  mesh.frustumCulled = false;
  return mesh;
}

export function disposeGroupMaterials(group: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      mat.dispose();
    }
  });
}

/** Pop-in (ease-out-back) then hold, then sink into the floor: returns the vertical scale factor. */
export function crystalRise(t: number, start: number, sinkFrom: number): number {
  if (t < start) return 0;
  const k = Math.min(1, (t - start) / 0.08);
  const c = 1.9;
  const pop = 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
  const sink = t > sinkFrom ? 1 - Math.min(1, (t - sinkFrom) / (1 - sinkFrom)) : 1;
  return Math.max(0, pop) * sink;
}

export const mageVfxMethods = {
  /** Pre-compile the Frost Mage shaders at startup so the first cast does not hitch. */
  prewarmMageVfx(this: EmbervaultEngine): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const warm = new THREE.Group();
    warm.position.set(0, -100, 0);
    const c = () => ({ value: new THREE.Color(0xffffff) });
    const mats: THREE.Material[] = [
      flatMat(NOVA_FLOOR_FRAG, { uLife: { value: 0.2 }, uSeed: { value: 0 }, uColor: c(), uCore: c(), uAccent: c() }),
      flatMat(ICE_BURST_FRAG, { uLife: { value: 0.2 }, uSeed: { value: 0 }, uSigil: { value: 1 }, uColor: c(), uCore: c(), uAccent: c() }),
      flatMat(PILLAR_FRAG, { uLife: { value: 0.2 }, uTime: { value: 0 }, uColor: c(), uCore: c() }),
      flatMat(TRAIL_FRAG, { uLife: { value: 0.2 }, uSeed: { value: 0 }, uColor: c(), uCore: c() }),
      crystalMat(),
    ];
    const geos = [_flatGeo, _flatGeo, _pillarGeo, _trailGeo, _crystalGeo];
    mats.forEach((m, i) => {
      const mesh = new THREE.Mesh(geos[i], m);
      mesh.frustumCulled = false;
      warm.add(mesh);
    });
    this.scene.add(warm);
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      // Ignore software/headless GL compile quirks
    }
    this.scene.remove(warm);
    for (const m of mats) m.dispose();
  },

  /** Rising energy column at (x, z) (frost by default): Nova centre, Blink ends, pet summon. Returns its update hook. */
  addFrostPillar(
    this: EmbervaultEngine,
    group: THREE.Group,
    x: number,
    z: number,
    radius: number,
    height: number,
    color = ICE_BLUE,
    core = ICE_CORE
  ): (t: number, elapsed: number) => void {
    const mat = flatMat(PILLAR_FRAG, {
      uLife: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
    });
    const mesh = new THREE.Mesh(_pillarGeo, mat);
    mesh.position.set(x, 0.02, z);
    mesh.scale.set(radius, height, radius);
    mesh.frustumCulled = false;
    group.add(mesh);
    return (t, elapsed) => {
      mat.uniforms.uLife.value = t;
      mat.uniforms.uTime.value = elapsed;
      const s = radius * (1 + t * 0.6);
      mesh.scale.set(s, height * (0.6 + 0.4 * Math.min(1, t * 4)), s);
    };
  },

  /** Frost Nova: ground frost wave to the nova radius, ice crystals erupting behind the front, centre column. */
  spawnFrostNovaVfx(this: EmbervaultEngine, x: number, z: number, radius: number, local: boolean): void {
    if (this.mp?.role === 'host') this.mpEmit(['m', 'n', q100(x), q100(z), q100(radius), 0, this.hero.id]);
    if (this.bgSim) return;
    const maxLife = 1.7;
    const group = new THREE.Group();
    this.dynamicGroup.add(group);

    const floorMat = flatMat(NOVA_FLOOR_FRAG, {
      uLife: { value: 0 },
      uSeed: { value: Math.random() * 10 },
      uColor: { value: new THREE.Color(ICE_BLUE) },
      uCore: { value: new THREE.Color(ICE_CORE) },
      uAccent: { value: new THREE.Color(MAGE_GOLD) },
    });
    group.add(floorQuad(floorMat, x, z, radius, 0.05));

    const pillar = this.addFrostPillar(group, x, z, 0.9, 4.2);

    // Crystals in rings; each pops up when the wave front (0.34 of the life, ease-out) passes it
    const cMat = crystalMat();
    const crystals: Array<{ mesh: THREE.Mesh; start: number; h: number; w: number }> = [];
    const rings: Array<[number, number]> = [
      [radius * 0.22, 7],
      [radius * 0.42, 10],
      [radius * 0.64, 13],
      [radius * 0.86, 15],
    ];
    for (const [rr, count] of rings) {
      const offset = Math.random() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const a = offset + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
        const d = rr * (0.9 + Math.random() * 0.2);
        const cx = x + Math.cos(a) * d;
        const cz = z + Math.sin(a) * d;
        if (this.isPointInWall(cx, cz)) continue;
        const mesh = new THREE.Mesh(_crystalGeo, cMat);
        mesh.position.set(cx, 0, cz);
        mesh.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
        mesh.scale.set(0, 0, 0);
        mesh.frustumCulled = false;
        group.add(mesh);
        // Inverse of the floor shader front curve: front = 1 - (1 - s)^2.4, s = life / 0.34
        const s = 1 - Math.pow(1 - Math.min(0.999, d / radius), 1 / 2.4);
        crystals.push({
          mesh,
          start: (s * 0.34 * maxLife) / maxLife,
          h: 0.7 + Math.random() * 1.1 * (1 - d / radius) + 0.35,
          w: 0.16 + Math.random() * 0.14,
        });
      }
    }

    if (local && !this.isSilentActor()) {
      this.triggerBossImpactFlash(x, z, 0x9fe8ff, 0.55, 0.2);
    }
    this.triggerBossBurstLight(x, 1.8, z, 0x9fe8ff, 7, 0.55);

    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (_dt, t, elapsed) => {
        floorMat.uniforms.uLife.value = t;
        pillar(Math.min(1, t * 2.2), elapsed);
        cMat.uniforms.uFade.value = 1 - Math.max(0, (t - 0.78) / 0.22);
        for (const c of crystals) {
          const k = crystalRise(t, c.start, 0.62);
          c.mesh.scale.set(c.w * (k > 0 ? 1 : 0), c.h * k, c.w * (k > 0 ? 1 : 0));
        }
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeGroupMaterials(group);
      },
    });
  },

  /** Ice spike impact: shatter decal sized to the blast radius; the empowered 3rd shot adds a sigil and crystals. */
  spawnIceBurstVfx(this: EmbervaultEngine, x: number, z: number, radius: number, empowered: boolean, local: boolean): void {
    if (this.mp?.role === 'host') this.mpEmit(['m', 'i', q100(x), q100(z), q100(radius), empowered ? 1 : 0, this.hero.id]);
    if (this.bgSim) return;
    const maxLife = empowered ? 0.62 : 0.34;
    const group = new THREE.Group();
    this.dynamicGroup.add(group);

    const mat = flatMat(ICE_BURST_FRAG, {
      uLife: { value: 0 },
      uSeed: { value: Math.random() * 10 },
      uSigil: { value: empowered ? 1 : 0 },
      uColor: { value: new THREE.Color(empowered ? 0xbff4ff : ICE_BLUE) },
      uCore: { value: new THREE.Color(ICE_CORE) },
      uAccent: { value: new THREE.Color(MAGE_GOLD) },
    });
    group.add(floorQuad(mat, x, z, Math.max(1.2, radius * 1.12), 0.06));

    const crystals: Array<{ mesh: THREE.Mesh; h: number; w: number; start: number }> = [];
    let cMat: THREE.ShaderMaterial | null = null;
    if (empowered) {
      cMat = crystalMat();
      const count = 6;
      const offset = Math.random() * Math.PI;
      for (let i = 0; i < count; i++) {
        const a = offset + (i / count) * Math.PI * 2;
        const d = radius * (0.35 + Math.random() * 0.25);
        const cx = x + Math.cos(a) * d;
        const cz = z + Math.sin(a) * d;
        if (this.isPointInWall(cx, cz)) continue;
        const mesh = new THREE.Mesh(_crystalGeo, cMat);
        mesh.position.set(cx, 0, cz);
        // Lean outward from the impact
        mesh.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
        mesh.scale.set(0, 0, 0);
        mesh.frustumCulled = false;
        group.add(mesh);
        crystals.push({ mesh, h: 0.75 + Math.random() * 0.5, w: 0.13 + Math.random() * 0.07, start: 0.02 + i * 0.015 });
      }
      this.triggerBossBurstLight(x, 1.2, z, 0xbff4ff, 3.2, 0.3);
    }

    // Ice shards and frost mist
    const shardCount = empowered ? 22 : 10;
    for (let i = 0; i < shardCount; i++) {
      const a = (i / shardCount) * Math.PI * 2 + Math.random() * 0.3;
      const spd = (empowered ? 4.6 : 2.8) + Math.random() * 2.2;
      this.spawnParticle(
        x,
        0.7,
        z,
        Math.cos(a) * spd,
        1.6 + Math.random() * 2.2,
        Math.sin(a) * spd,
        i % 3 === 0 ? 0xffffff : empowered && i % 5 === 1 ? MAGE_GOLD : 0x9fe8ff,
        empowered ? 1.0 : 0.8,
        0.45,
        7
      );
    }
    if (empowered && local && !this.isSilentActor()) this.triggerBossImpactFlash(x, z, 0xbff4ff, 0.3, 0.12);

    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (_dt, t) => {
        mat.uniforms.uLife.value = t;
        if (cMat) cMat.uniforms.uFade.value = 1 - Math.max(0, (t - 0.7) / 0.3);
        for (const c of crystals) {
          const k = crystalRise(t, c.start, 0.55);
          c.mesh.scale.set(c.w, c.h * k, c.w);
        }
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeGroupMaterials(group);
      },
    });
  },

  /** Blink: frost columns at both ends, snowflake sigils on the floor and a melting frost trail between them. */
  spawnBlinkVfx(this: EmbervaultEngine, sx: number, sz: number, ex: number, ez: number): void {
    if (this.mp?.role === 'host') this.mpEmit(['m', 'k', q100(sx), q100(sz), q100(ex), q100(ez), this.hero.id]);
    if (this.bgSim) return;
    const maxLife = 0.75;
    const group = new THREE.Group();
    this.dynamicGroup.add(group);

    const mkSigil = (x: number, z: number, r: number) => {
      const m = flatMat(ICE_BURST_FRAG, {
        uLife: { value: 0 },
        uSeed: { value: Math.random() * 10 },
        uSigil: { value: 1 },
        uColor: { value: new THREE.Color(ICE_BLUE) },
        uCore: { value: new THREE.Color(ICE_CORE) },
        uAccent: { value: new THREE.Color(MAGE_GOLD) },
      });
      group.add(floorQuad(m, x, z, r, 0.06));
      return m;
    };
    const startSigil = mkSigil(sx, sz, 1.25);
    const endSigil = mkSigil(ex, ez, 1.5);
    const startPillar = this.addFrostPillar(group, sx, sz, 0.55, 2.6);
    const endPillar = this.addFrostPillar(group, ex, ez, 0.6, 3.0);

    const dx = ex - sx;
    const dz = ez - sz;
    const len = Math.hypot(dx, dz);
    let trailMat: THREE.ShaderMaterial | null = null;
    if (len > 0.4) {
      trailMat = flatMat(TRAIL_FRAG, {
        uLife: { value: 0 },
        uSeed: { value: Math.random() * 10 },
        uColor: { value: new THREE.Color(ICE_BLUE) },
        uCore: { value: new THREE.Color(ICE_CORE) },
      });
      const trail = new THREE.Mesh(_trailGeo, trailMat);
      trail.rotation.x = -Math.PI / 2;
      trail.rotation.z = -Math.atan2(dz, dx);
      trail.position.set((sx + ex) / 2, 0.055, (sz + ez) / 2);
      trail.scale.set(len, 1.1, 1);
      trail.frustumCulled = false;
      group.add(trail);
      // Snow drifting off the trail
      const n = Math.min(14, Math.ceil(len * 2.4));
      for (let i = 0; i < n; i++) {
        const f = (i + Math.random()) / n;
        this.spawnParticle(
          sx + dx * f + (Math.random() - 0.5) * 0.5,
          0.25 + Math.random() * 0.9,
          sz + dz * f + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.8,
          0.6 + Math.random() * 1.1,
          (Math.random() - 0.5) * 0.8,
          i % 4 === 0 ? MAGE_GOLD : i % 2 === 0 ? 0xffffff : 0x9fe8ff,
          0.85,
          0.6,
          -0.3
        );
      }
    }

    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (_dt, t, elapsed) => {
        startSigil.uniforms.uLife.value = Math.min(1, t * 1.25);
        endSigil.uniforms.uLife.value = t;
        startPillar(Math.min(1, t * 1.6), elapsed);
        endPillar(t, elapsed);
        if (trailMat) trailMat.uniforms.uLife.value = t;
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeGroupMaterials(group);
      },
    });
  },
};
