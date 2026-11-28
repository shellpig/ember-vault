import * as THREE from 'three';
import type { EmbervaultEngine } from '../engine';
import { q100 } from '../../../shared/game';
import { HUNTER, PET_SPECIES_LIST, type PetSpecies } from '../classes';
import { isGuardianEnemy, isSwarmEnemy } from './data';
import type { EnemyEntity } from './entities';
import {
  FLAT_VERT,
  NOISE_GLSL,
  _crystalGeo,
  crystalMat,
  crystalRise,
  disposeGroupMaterials,
  flatMat,
  floorQuad,
} from './mageVfx';

// ---------------------------------------------------------------------------------------------------------------
// Hunter pet summon / buff, Warrior Pommel Strike and the burning-enemy status visual.
// Visual only; the skills' gameplay lives in classSkills.ts / heroCombat.ts. Timed effects ride on bossVfxItems.
// ---------------------------------------------------------------------------------------------------------------

/** Summon / buff sigil: rotating rune band, inner glow and an outward pulse ring. */
const RUNE_FRAG = /* glsl */ `
uniform float uLife;
uniform float uTime;
uniform float uSeed;
uniform vec3 uColor;
uniform vec3 uCore;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  float inT = smoothstep(0.0, 0.12, uLife);
  float outT = 1.0 - smoothstep(0.6, 1.0, uLife);
  float vis = inT * outT;

  // Outer band with 18 rotating rune ticks
  float band = smoothstep(0.025, 0.0, abs(r - 0.86)) + smoothstep(0.02, 0.0, abs(r - 0.7)) * 0.8;
  float ticks = step(0.5, fract((a + uTime * 0.9) / 6.2831853 * 18.0)) * step(0.72, r) * step(r, 0.84);
  float tickShape = ticks * smoothstep(0.0, 0.3, noise(vec2(floor((a + uTime * 0.9) / 6.2831853 * 18.0), uSeed)) + 0.4);
  // Inner three-claw mark (counter-rotating)
  float ca = a - uTime * 1.4;
  float claw = smoothstep(0.06, 0.0, abs(fract(ca / 6.2831853 * 3.0) - 0.5) * r) * smoothstep(0.62, 0.2, r) * step(0.12, r);
  float glow = smoothstep(0.7, 0.0, r) * 0.35;

  float pulseR = smoothstep(0.0, 0.45, uLife) * 1.0;
  float pulse = smoothstep(0.06, 0.0, abs(r - pulseR)) * (1.0 - smoothstep(0.2, 0.5, uLife));

  vec3 col = uColor * (band + tickShape * 0.9 + claw * 0.9 + glow) + uCore * (pulse * 1.6 + band * 0.4);
  float alpha = clamp((band + tickShape + claw + glow) * vis + pulse, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Pommel Strike ground impact: jagged radial cracks that glow gold then cool, a dust shockwave front. */
const POMMEL_FRAG = /* glsl */ `
uniform float uLife;
uniform float uSeed;
uniform vec3 uColor;
uniform vec3 uCore;
uniform vec3 uCool;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);

  float front = 1.0 - pow(1.0 - clamp(uLife / 0.28, 0.0, 1.0), 2.2);
  float n = noise(vec2(a * 8.0 + uSeed, r * 6.0));
  float d = r - front + (n - 0.5) * 0.06;
  float waveFade = 1.0 - smoothstep(0.22, 0.42, uLife);
  float wave = smoothstep(0.09, 0.0, abs(d)) * waveFade;
  float waveCore = smoothstep(0.025, 0.0, abs(d)) * waveFade;
  float dust = smoothstep(0.0, -0.25, d) * smoothstep(-0.5, -0.15, d) * noise(p * 9.0 + uSeed) * waveFade;

  // 9 jagged cracks reaching ~85% of the radius
  float sx = a / 6.2831853 * 9.0 + uSeed + (noise(vec2(r * 9.0, uSeed * 2.0)) - 0.5) * 0.45;
  float sb = min(fract(sx), 1.0 - fract(sx));
  float reach = 0.85 * smoothstep(0.0, 0.25, uLife);
  float crack = smoothstep(0.05, 0.0, sb * r) * step(r, reach) * smoothstep(0.08, 0.18, r);
  float heat = 1.0 - smoothstep(0.15, 0.7, uLife);
  float crackFade = 1.0 - smoothstep(0.6, 1.0, uLife);
  float centre = smoothstep(0.3, 0.0, r) * pow(1.0 - uLife, 2.5);

  vec3 crackCol = mix(uCool, uColor, heat) * crack * crackFade;
  vec3 col = crackCol * 1.3 + uColor * (wave * 1.2 + dust * 0.5) + uCore * (waveCore * 1.6 + centre * 1.8);
  float alpha = clamp(crack * crackFade + wave + waveCore + dust * 0.6 + centre, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Burning status: soft flickering flame tongues on crossed vertical planes (kept faint so the monster stays readable). */
const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = modelMatrix[3].x * 1.7 + modelMatrix[3].z * 2.3;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
${NOISE_GLSL}
void main() {
  float x = (vUv.x - 0.5) * 2.0;
  float y = vUv.y;
  float n = noise(vec2(vUv.x * 4.0 + vSeed, y * 3.0 - uTime * 3.4));
  float n2 = noise(vec2(vUv.x * 10.0 - vSeed, y * 7.0 - uTime * 5.5));
  // Wide at the feet, three licking tongues toward the top so the flames show around the body and over its head
  float width = 0.92 * pow(1.0 - y, 0.7) + 0.08;
  float tongues = 0.5 + 0.5 * sin(x * 7.5 + vSeed + uTime * 2.0);
  float shape = 1.0 - abs(x) / width;
  float flame = smoothstep(0.0, 0.4, shape + (n - 0.5) * 0.75 + (n2 - 0.5) * 0.35 - y * (0.75 - tongues * 0.35));
  float base = smoothstep(0.0, 0.1, y);
  vec3 hot = vec3(1.0, 0.86, 0.4);
  vec3 warm = vec3(1.0, 0.38, 0.06);
  vec3 col = mix(warm, hot, clamp(flame * (1.0 - y) * 1.3, 0.0, 1.0));
  float alpha = flame * base * 0.5;
  gl_FragColor = vec4(col, alpha);
}
`;

const BURN_GLOW_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float flicker = 0.8 + 0.2 * sin(uTime * 13.0) * sin(uTime * 7.3);
  float a = smoothstep(1.0, 0.2, r) * 0.28 * flicker;
  gl_FragColor = vec4(vec3(1.0, 0.45, 0.1) * a, a);
}
`;

const SPECIES_COLORS: Record<PetSpecies, [number, number]> = {
  bear: [0xffa040, 0xffe2b0],
  chocobo: [0xffd84a, 0xfff6c4],
  wolf: [0x9fc4ff, 0xeef5ff],
};
const BUFF_COLOR = 0xff8c24;
const BUFF_CORE = 0xfff0c0;
const POMMEL_GOLD = 0xffc94a;
const POMMEL_CORE = 0xfff6da;
const POMMEL_COOL = 0x8a2a10;

// Burning visual: one shared time uniform and shared materials for every burning enemy
const _burnTime = { value: 0 };
let _flameMat: THREE.ShaderMaterial | null = null;
let _burnGlowMat: THREE.ShaderMaterial | null = null;
const _flameGeo = (() => {
  const g = new THREE.PlaneGeometry(1, 1);
  g.translate(0, 0.5, 0);
  return g;
})();
const _glowGeo = new THREE.PlaneGeometry(2, 2);

function flameMaterials(): [THREE.ShaderMaterial, THREE.ShaderMaterial] {
  if (!_flameMat) {
    _flameMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      uniforms: { uTime: _burnTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  if (!_burnGlowMat) {
    _burnGlowMat = new THREE.ShaderMaterial({
      vertexShader: FLAT_VERT,
      fragmentShader: BURN_GLOW_FRAG,
      uniforms: { uTime: _burnTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }
  return [_flameMat, _burnGlowMat];
}

function burnScale(e: EnemyEntity): number {
  return e.isBoss ? 2.0 : isGuardianEnemy(e.kind) || e.isElite ? 1.35 : isSwarmEnemy(e.kind) ? 0.7 : 1.0;
}

export const skillVfxMethods = {
  /** Pre-compile the shaders of this module (see prewarmMageVfx). */
  prewarmSkillVfx(this: EmbervaultEngine): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const warm = new THREE.Group();
    warm.position.set(0, -100, 0);
    const c = () => ({ value: new THREE.Color(0xffffff) });
    const own: THREE.Material[] = [
      flatMat(RUNE_FRAG, { uLife: { value: 0.3 }, uTime: { value: 0 }, uSeed: { value: 0 }, uColor: c(), uCore: c() }),
      flatMat(POMMEL_FRAG, { uLife: { value: 0.3 }, uSeed: { value: 0 }, uColor: c(), uCore: c(), uCool: c() }),
    ];
    const [flame, glow] = flameMaterials();
    for (const m of [...own, flame, glow]) {
      const mesh = new THREE.Mesh(_glowGeo, m);
      mesh.frustumCulled = false;
      warm.add(mesh);
    }
    this.scene.add(warm);
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      // Ignore software/headless GL compile quirks
    }
    this.scene.remove(warm);
    for (const m of own) m.dispose();
  },

  /** Hunter summons a pet: species-tinted sigil, energy column, spiralling motes. */
  spawnPetSummonVfx(this: EmbervaultEngine, x: number, z: number, species: PetSpecies, local: boolean): void {
    if (this.mp?.role === 'host') {
      this.mpEmit(['m', 'h', q100(x), q100(z), Math.max(0, PET_SPECIES_LIST.indexOf(species)), 0, this.hero.id]);
    }
    if (this.bgSim) return;
    const [color, core] = SPECIES_COLORS[species] ?? SPECIES_COLORS.bear;
    const maxLife = 1.3;
    const group = new THREE.Group();
    this.dynamicGroup.add(group);

    const rune = flatMat(RUNE_FRAG, {
      uLife: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 10 },
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
    });
    group.add(floorQuad(rune, x, z, 2.2, 0.06));
    const pillar = this.addFrostPillar(group, x, z, 0.75, 4.2, color, core);

    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = 0.6 + Math.random() * 1.2;
      // Tangential + upward: a rising spiral around the pet
      this.spawnParticle(
        x + Math.cos(a) * rr,
        0.2 + Math.random() * 0.4,
        z + Math.sin(a) * rr,
        -Math.sin(a) * 2.4 - Math.cos(a) * 0.6,
        2.2 + Math.random() * 2.2,
        Math.cos(a) * 2.4 - Math.sin(a) * 0.6,
        i % 3 === 0 ? 0xffffff : i % 2 === 0 ? color : core,
        0.9,
        0.7,
        -0.6
      );
    }
    this.triggerBossBurstLight(x, 1.6, z, color, 5, 0.6);
    if (local && !this.isSilentActor()) this.triggerBossImpactFlash(x, z, color, 0.35, 0.16);

    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (_dt, t, elapsed) => {
        rune.uniforms.uLife.value = t;
        rune.uniforms.uTime.value = elapsed;
        pillar(Math.min(1, t * 1.4), elapsed);
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeGroupMaterials(group);
      },
    });
  },

  /** Hunter buffs the pet (Wild Rally): fiery sigil, flame burst column and a roar shockwave. */
  spawnPetBuffVfx(this: EmbervaultEngine, x: number, z: number, local: boolean): void {
    if (this.mp?.role === 'host') this.mpEmit(['m', 'u', q100(x), q100(z), 0, 0, this.hero.id]);
    if (this.bgSim) return;
    const maxLife = 1.0;
    const group = new THREE.Group();
    this.dynamicGroup.add(group);

    const rune = flatMat(RUNE_FRAG, {
      uLife: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 10 },
      uColor: { value: new THREE.Color(BUFF_COLOR) },
      uCore: { value: new THREE.Color(BUFF_CORE) },
    });
    group.add(floorQuad(rune, x, z, 1.9, 0.06));
    const pillar = this.addFrostPillar(group, x, z, 0.6, 3.2, BUFF_COLOR, BUFF_CORE);

    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      this.spawnParticle(
        x + Math.cos(a) * 0.4,
        0.4,
        z + Math.sin(a) * 0.4,
        Math.cos(a) * 3.4,
        2.6 + Math.random() * 2.4,
        Math.sin(a) * 3.4,
        i % 3 === 0 ? 0x52ffa8 : i % 2 === 0 ? BUFF_COLOR : 0xffd54f,
        1.0,
        0.6,
        1.6
      );
    }
    this.triggerBossBurstLight(x, 1.4, z, BUFF_COLOR, 4, 0.5);
    if (local && !this.isSilentActor()) this.addScreenShake(0.12, 0.16);

    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (_dt, t, elapsed) => {
        rune.uniforms.uLife.value = t;
        rune.uniforms.uTime.value = elapsed * 1.6;
        pillar(Math.min(1, t * 1.3), elapsed);
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeGroupMaterials(group);
      },
    });
  },

  /** Warrior Pommel Strike: cracked-earth decal + dust shockwave to the stun radius, erupting rock shards. */
  spawnPommelVfx(this: EmbervaultEngine, x: number, z: number, radius: number, local: boolean): void {
    if (this.mp?.role === 'host') this.mpEmit(['m', 'w', q100(x), q100(z), q100(radius), 0, this.hero.id]);
    if (this.bgSim) return;
    const maxLife = 1.1;
    const group = new THREE.Group();
    this.dynamicGroup.add(group);

    const decal = flatMat(POMMEL_FRAG, {
      uLife: { value: 0 },
      uSeed: { value: Math.random() * 10 },
      uColor: { value: new THREE.Color(POMMEL_GOLD) },
      uCore: { value: new THREE.Color(POMMEL_CORE) },
      uCool: { value: new THREE.Color(POMMEL_COOL) },
    });
    group.add(floorQuad(decal, x, z, radius * 1.05, 0.06));

    const rockMat = crystalMat(0x2e2418, 0x7d6143, 0xffd27a);
    const shards: Array<{ mesh: THREE.Mesh; start: number; h: number; w: number }> = [];
    const count = 12;
    const offset = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const d = radius * (0.45 + Math.random() * 0.4);
      const sx = x + Math.cos(a) * d;
      const sz = z + Math.sin(a) * d;
      if (this.isPointInWall(sx, sz)) continue;
      const mesh = new THREE.Mesh(_crystalGeo, rockMat);
      mesh.position.set(sx, 0, sz);
      mesh.rotation.set(Math.sin(a) * 0.5, Math.random() * Math.PI, -Math.cos(a) * 0.5);
      mesh.scale.set(0, 0, 0);
      mesh.frustumCulled = false;
      group.add(mesh);
      // The shockwave front reaches distance d at life ~ 0.28 * (1 - (1 - d/r)^(1/2.2))
      const s = 1 - Math.pow(1 - Math.min(0.999, d / radius), 1 / 2.2);
      shards.push({ mesh, start: s * 0.28, h: 0.45 + Math.random() * 0.45, w: 0.16 + Math.random() * 0.12 });
    }

    // Dust and stone chips
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const spd = 5 + Math.random() * 4;
      this.spawnParticle(
        x + Math.cos(a) * 0.6,
        0.2,
        z + Math.sin(a) * 0.6,
        Math.cos(a) * spd,
        2.4 + Math.random() * 2.2,
        Math.sin(a) * spd,
        i % 3 === 0 ? 0x9b8466 : i % 3 === 1 ? 0x6e5a42 : 0xffd27a,
        1.1,
        0.55,
        9
      );
    }
    this.triggerBossBurstLight(x, 1.2, z, POMMEL_GOLD, 5.5, 0.4);
    if (local && !this.isSilentActor()) this.triggerBossImpactFlash(x, z, POMMEL_GOLD, 0.4, 0.14);

    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife,
      update: (_dt, t) => {
        decal.uniforms.uLife.value = t;
        rockMat.uniforms.uFade.value = 1 - Math.max(0, (t - 0.75) / 0.25);
        for (const sh of shards) {
          const k = crystalRise(t, sh.start, 0.55);
          sh.mesh.scale.set(sh.w, sh.h * k, sh.w);
        }
      },
      dispose: () => {
        this.dynamicGroup.remove(group);
        disposeGroupMaterials(group);
      },
    });
  },

  /** Show / hide the burning visual on an enemy and drift an ember now and then (host and teammate clients). */
  updateBurnVisual(this: EmbervaultEngine, e: EnemyEntity, dt: number): void {
    const burning = (e.burnTimer ?? 0) > 0;
    if (!burning) {
      if (e.rig.burnFx) e.rig.burnFx.visible = false;
      return;
    }
    if (!e.rig.burnFx) {
      const [flame, glow] = flameMaterials();
      const sc = burnScale(e);
      const g = new THREE.Group();
      for (let i = 0; i < 2; i++) {
        const plane = new THREE.Mesh(_flameGeo, flame);
        // 0 and 90 degrees: both planes sit at 45 degrees to the isometric camera, never edge-on
        plane.rotation.y = i * (Math.PI / 2);
        plane.scale.set(1.7 * sc, 1.75 * sc, 1);
        plane.frustumCulled = false;
        g.add(plane);
      }
      const disc = new THREE.Mesh(_glowGeo, glow);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.05;
      disc.scale.set(0.85 * sc, 0.85 * sc, 1);
      g.add(disc);
      e.rig.root.add(g);
      e.rig.burnFx = g;
    }
    e.rig.burnFx.visible = true;
    _burnTime.value = this.elapsed;
    if (this.bgSim) return;
    // Red / orange / yellow embers rising up and drifting outward (~12 per second; bosses / elites up to 1.5x)
    const sc = burnScale(e);
    let count = dt * 12 * Math.min(1.5, sc);
    while (count > 0) {
      if (count < 1 && Math.random() > count) break;
      count -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.3 * sc;
      const out = 0.6 + Math.random() * 1.1;
      const roll = Math.random();
      this.spawnParticle(
        e.x + Math.cos(a) * r,
        0.25 + Math.random() * 0.9 * sc,
        e.z + Math.sin(a) * r,
        Math.cos(a) * out,
        1.6 + Math.random() * 1.6,
        Math.sin(a) * out,
        roll < 0.35 ? 0xff3b1f : roll < 0.7 ? 0xff8a1e : 0xffd84a,
        0.7 + Math.random() * 0.3,
        0.6 + Math.random() * 0.3,
        -0.9
      );
    }
  },

  /** Host-side burn: ignite (or refresh) on an enemy. `tickDmg` is the raw per-second damage before reduction. */
  applyBurn(this: EmbervaultEngine, e: EnemyEntity, tickDmg: number): void {
    if (e.dead || e.bossWarpUntargetable) return;
    const fresh = (e.burnTimer ?? 0) <= 0;
    e.burnTimer = HUNTER.burnDuration;
    e.burnDmg = Math.max(fresh ? 0 : e.burnDmg ?? 0, tickDmg);
    e.burnOwnerId = this.hero.id;
    if (fresh) {
      e.burnTick = 1;
      this.emitFloatingText(e.x, e.isBoss ? 2.7 : 1.95, e.z, '著火!', 'relicOrange');
    }
  },

  /** Host-side burn: count down and deal one tick per second, credited to the hero that lit it. */
  tickBurn(this: EmbervaultEngine, e: EnemyEntity, dt: number): void {
    if ((e.burnTimer ?? 0) <= 0) return;
    e.burnTimer = Math.max(0, (e.burnTimer ?? 0) - dt);
    e.burnTick = (e.burnTick ?? 1) - dt;
    if (e.burnTick > 0) return;
    e.burnTick += 1;
    const dmg = Math.max(1, Math.round(e.burnDmg ?? 1));
    const owner = this.heroes.find((h) => h.id === e.burnOwnerId);
    const prev = this.hero;
    if (owner) this.setActor(owner);
    this.applyBonusEnemyDamage(e, dmg, `燃燒 -${dmg}`, 'relicOrange', 0xff6a1f);
    if (owner) this.setActor(prev);
  },
};
