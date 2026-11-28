import * as THREE from 'three';
import type { EmbervaultEngine } from '../engine';
import type { EnemyRig } from '../models';
import type { EnemyKind } from '../types';
import type { EnemyEntity } from './entities';

// ---------------------------------------------------------------------------------------------------------------
// Floor boss death sequence. The dead boss rig is NOT hidden at once: `playBossDeath` hands it to a game-time timeline
// (it runs on the scaled dt, so the opening plays inside the boss-death slow motion) that rides on `bossVfxItems`:
//   stagger  0 .. STAGGER        white flash + jitter, status effects stripped
//   collapse STAGGER .. finisher per-boss script (`collapse`)
//   finisher at `finisherAt`     burst light / flash / shockwave / particles / shake / sound / hoard drop, then the
//                                script's `finisher` (usually the shatter)
//   remains  finisher .. end     debris lies around for HOLD s, then fades for FADE s
// Per-boss scripts are small: they only compose the generic building blocks below (tiltFall, sinkSquash, crystallize,
// glowEmissive, pulseCore, shatter, scatterShards, spawnDeathShockwave).
// ---------------------------------------------------------------------------------------------------------------

const STAGGER = 0.25;
const HOLD = 0.7;
const FADE = 1.0;
const GRAVITY = 15;
/** Death sequences currently running (floor 40 can have two at once). */
let activeDeaths = 0;

const BOSS_DEATH_BURST_COLOR: Partial<Record<EnemyKind, number>> = {
  boss_lich: 0xd675ff,
  boss_colossus: 0xff8024,
  boss_crystal_wyrm: 0x45f2ff,
  boss_fungal_king: 0x52f795,
  boss_leviathan_heart: 0xff8826,
  boss_abyssal_brain: 0x36f5d4,
  boss_mothership_ai: 0xff4757,
  boss_xeno_commander: 0x39ff7a,
};
const DEFAULT_BURST_COLOR = 0xffd252;

const _white = new THREE.Color(0xffffff);
const _black = new THREE.Color(0x000000);
const _tint = new THREE.Color();
const _glow = new THREE.Color();
const _wp = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _scl = new THREE.Vector3();

/** A material the death sequence owns (cloned from the rig's) plus its original look. */
interface OwnedMat {
  mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  std: boolean;
  color: THREE.Color;
  emissive: THREE.Color | null;
  emissiveI: number;
  /** Original opacity: the end fade scales it instead of overwriting it. */
  opacity: number;
}

/** One detached piece of the boss lying / bouncing in world space. */
interface DeathShard {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  floorY: number;
  rest: boolean;
  baseScale: THREE.Vector3;
}

export interface BossDeathCtx {
  eng: EmbervaultEngine;
  enemy: EnemyEntity;
  rig: EnemyRig;
  /** World-space group (child of dynamicGroup) that holds every detached piece and effect of this death. */
  group: THREE.Group;
  mats: OwnedMat[];
  shards: DeathShard[];
  x: number;
  z: number;
  /** Unit vector pointing away from the killer: the way the boss falls. */
  dirX: number;
  dirZ: number;
  burstColor: number;
  baseBodyY: number;
  baseBodyScale: THREE.Vector3;
  /** Seconds since the death started (game time). */
  t: number;
  fired: boolean;
  /** One-shot markers a script can use (e.g. 'peeled'). */
  flags: Set<string>;
  onFinisher: (() => void) | null;
  removeRoot: boolean;
  /** Another boss death is already running (floor 40 pair): particle / piece counts are halved. */
  lite: boolean;
  /** Cached per-mesh data for `dissolve` (built on first use). */
  meshes: { mesh: THREE.Mesh; base: THREE.Vector3; y: number }[] | null;
}

interface BossDeathScript {
  /** Seconds after the death starts when the finisher fires (~0.7 so the stagger + collapse sit in the slow motion). */
  finisherAt: number;
  /** Runs every frame between the stagger and the finisher; `u` goes 0..1 over that span. */
  collapse: (c: BossDeathCtx, u: number, dt: number) => void;
  /** Runs right after the common finisher effects: shatter / hide whatever is left of the rig. */
  finisher: (c: BossDeathCtx) => void;
  /** Runs every frame after the finisher while the remains lie around; `r` is seconds since the finisher. */
  remains?: (c: BossDeathCtx, r: number, dt: number) => void;
  /** Quieter common finisher (no impact flash, smaller blast): for deaths that fade away rather than explode. */
  soft?: boolean;
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

// ---------------------------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------------------------

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

/** Clones every mesh material of the rig (they may be shared) so the sequence can tint / fade them freely. */
function ownRigMaterials(root: THREE.Object3D): OwnedMat[] {
  const out: OwnedMat[] = [];
  const cloned = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    let m = cloned.get(src) as OwnedMat['mat'] | undefined;
    if (!m) {
      m = src.clone() as OwnedMat['mat'];
      cloned.set(src, m);
      const std = 'emissive' in m;
      out.push({
        mat: m,
        std,
        color: m.color.clone(),
        emissive: std ? (m as THREE.MeshStandardMaterial).emissive.clone() : null,
        emissiveI: std ? (m as THREE.MeshStandardMaterial).emissiveIntensity : 0,
        opacity: m.opacity,
      });
    }
    o.material = m;
  });
  return out;
}

/** Status / telegraph decorations that must vanish the instant the boss dies. */
function stripStatusFx(rig: EnemyRig): void {
  for (const o of [rig.nameTag, rig.rageAura, rig.burnFx, rig.frozenShell, rig.stunStars, rig.slowMarker, rig.auraRing]) {
    if (o) o.visible = false;
  }
}

/** White-hot flash: Standard materials glow white, unlit ones lerp to white. `k` 0 restores the original look. */
export function setFlash(c: BossDeathCtx, k: number): void {
  for (const o of c.mats) {
    if (o.std) {
      const m = o.mat as THREE.MeshStandardMaterial;
      m.emissive.copy(o.emissive!).lerp(_white, k);
      m.emissiveIntensity = o.emissiveI + (1.0 - o.emissiveI) * k;
    } else {
      o.mat.color.copy(o.color).lerp(_white, k * 0.7);
    }
  }
}

/** Tints the lit materials with an emissive colour (heat / energy glow); unlit ones lerp toward it a little. */
export function glowEmissive(c: BossDeathCtx, hex: number, intensity: number): void {
  _tint.setHex(hex);
  for (const o of c.mats) {
    if (o.std) {
      const m = o.mat as THREE.MeshStandardMaterial;
      m.emissive.copy(_tint);
      m.emissiveIntensity = Math.max(o.emissiveI, intensity);
    } else {
      o.mat.color.copy(o.color).lerp(_tint, Math.min(1, intensity * 0.6));
    }
  }
}

/** Crystallize: every material fades toward a pale glassy tint with a cyan glow. `k` 0..1. */
export function crystallize(c: BossDeathCtx, k: number, tintHex = 0xe4fbff, glowHex = 0x8aeaff): void {
  _tint.setHex(tintHex);
  for (const o of c.mats) {
    o.mat.color.copy(o.color).lerp(_tint, k);
    if (o.std) {
      const m = o.mat as THREE.MeshStandardMaterial;
      m.emissive.copy(o.emissive!).lerp(_glow.setHex(glowHex), k);
      m.emissiveIntensity = o.emissiveI + (0.85 - o.emissiveI) * k;
      m.roughness = THREE.MathUtils.lerp(m.roughness, 0.12, k * 0.2);
    }
  }
}

/** Tips the whole rig over (pivot at the feet) away from the killer by `k * maxAngle` radians. */
export function tiltFall(c: BossDeathCtx, k: number, maxAngle: number): void {
  _axis.set(c.dirZ, 0, -c.dirX);
  c.rig.root.quaternion.setFromAxisAngle(_axis, k * maxAngle);
}

/** Sinks the body into the floor and squashes it (`sink` world units, `squash` / `widen` fractions at k = 1). */
export function sinkSquash(c: BossDeathCtx, k: number, sink: number, squash: number, widen: number): void {
  const b = c.rig.body;
  b.position.y = c.baseBodyY - sink * k;
  b.scale.set(
    c.baseBodyScale.x * (1 + widen * k),
    c.baseBodyScale.y * (1 - squash * k),
    c.baseBodyScale.z * (1 + widen * k)
  );
}

/** Pulses the rig's core mesh: grows by `grow` and turns white-hot at k = 1. */
export function pulseCore(c: BossDeathCtx, k: number, grow: number): void {
  const core = c.rig.coreMesh;
  if (!core) return;
  core.scale.setScalar(1 + grow * k * (0.85 + Math.sin(c.t * 40) * 0.15));
}

function isInvisibleInRig(m: THREE.Object3D, stop: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = m; o && o !== stop.parent; o = o.parent) if (!o.visible) return true;
  return false;
}

export interface ShatterOpts {
  /** Which still-attached meshes break off (receives the mesh and its world position). Default: all. */
  filter?: (m: THREE.Mesh, worldPos: THREE.Vector3) => boolean;
  /** Outward speed (units/s), upward kick and spin (rad/s). */
  speed: number;
  up: number;
  spin: number;
  /** How much of a piece's height turns into upward speed (default 0.5; 0 = pieces drop straight down). */
  lift?: number;
}

/**
 * Detaches the rig's meshes into world space (world transforms preserved) and gives each a velocity, spin and gravity.
 * Pieces bounce on the floor (y = 0) and fade out at the end of the sequence.
 */
export function shatter(c: BossDeathCtx, opts: ShatterOpts): void {
  const root = c.rig.root;
  root.updateMatrixWorld(true);
  const picked: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.isContactShadow || isInvisibleInRig(o, root)) return;
    _wp.setFromMatrixPosition(o.matrixWorld);
    if (!opts.filter || opts.filter(o, _wp)) picked.push(o);
  });
  for (const m of picked) {
    _wp.setFromMatrixPosition(m.matrixWorld);
    const wx = _wp.x;
    const wy = _wp.y;
    const wz = _wp.z;
    c.group.attach(m);
    const mat = m.material as OwnedMat['mat'];
    mat.transparent = true;
    mat.needsUpdate = true;
    let ox = wx - c.x;
    let oz = wz - c.z;
    const len = Math.hypot(ox, oz);
    if (len < 0.05) {
      const a = Math.random() * Math.PI * 2;
      ox = Math.cos(a);
      oz = Math.sin(a);
    } else {
      ox /= len;
      oz /= len;
    }
    const sp = opts.speed * (0.55 + Math.random() * 0.7);
    m.geometry.computeBoundingBox();
    _box.copy(m.geometry.boundingBox!);
    _box.getSize(_size);
    m.getWorldScale(_scl);
    const half = Math.min(_size.x * _scl.x, _size.y * _scl.y, _size.z * _scl.z) * 0.5;
    c.shards.push({
      mesh: m,
      vx: ox * sp + (Math.random() - 0.5) * 1.2,
      vy: opts.up * (0.45 + Math.random() * 0.8) + wy * (opts.lift ?? 0.5),
      vz: oz * sp + (Math.random() - 0.5) * 1.2,
      wx: (Math.random() - 0.5) * 2 * opts.spin,
      wy: (Math.random() - 0.5) * 2 * opts.spin,
      wz: (Math.random() - 0.5) * 2 * opts.spin,
      floorY: THREE.MathUtils.clamp(half, 0.05, 0.4),
      rest: false,
      baseScale: m.scale.clone(),
    });
  }
}

export interface ScatterOpts {
  count: number;
  geometry: 'cone' | 'box' | 'octa';
  /** Piece size (units) and its random spread (0..1). */
  size: number;
  color: number;
  emissive: number;
  emissiveI: number;
  speed: number;
  up: number;
  spin: number;
  /** Spawn heights (y0..y1) and horizontal radius around the boss. */
  y0: number;
  y1: number;
  radius: number;
}

/** Extra small debris (shards / chunks) bursting out of the body; same physics as `shatter` pieces. */
export function scatterShards(c: BossDeathCtx, o: ScatterOpts): void {
  const geo =
    o.geometry === 'cone'
      ? new THREE.ConeGeometry(0.5, 1.6, 4)
      : o.geometry === 'box'
      ? new THREE.BoxGeometry(1, 0.5, 0.7)
      : new THREE.OctahedronGeometry(0.7, 0);
  const n = scaled(c, o.count);
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: o.color,
      emissive: o.emissive,
      emissiveIntensity: o.emissiveI,
      roughness: 0.3,
      metalness: 0.4,
      flatShading: true,
      transparent: true,
    });
    const m = new THREE.Mesh(geo, mat);
    const s = o.size * (0.6 + Math.random() * 0.8);
    m.scale.setScalar(s);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * o.radius;
    m.position.set(c.x + Math.cos(a) * r, o.y0 + Math.random() * (o.y1 - o.y0), c.z + Math.sin(a) * r);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    c.group.add(m);
    const sp = o.speed * (0.4 + Math.random() * 0.8);
    c.shards.push({
      mesh: m,
      vx: Math.cos(a) * sp,
      vy: o.up * (0.4 + Math.random() * 0.9),
      vz: Math.sin(a) * sp,
      wx: (Math.random() - 0.5) * 2 * o.spin,
      wy: (Math.random() - 0.5) * 2 * o.spin,
      wz: (Math.random() - 0.5) * 2 * o.spin,
      floorY: Math.max(0.05, s * 0.3),
      rest: false,
      baseScale: m.scale.clone(),
    });
  }
}

/** Expanding ground ring plus a quick white-hot orb at (x, z); a self-contained VFX item. */
export function spawnDeathShockwave(
  eng: EmbervaultEngine,
  x: number,
  z: number,
  colorHex: number,
  radius: number,
  duration: number,
  orbScale = 1
): void {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.07;
  const orbMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), orbMat);
  orb.position.y = 1.1;
  orb.visible = orbScale > 0;
  group.add(ring, orb);
  group.position.set(x, 0, z);
  eng.dynamicGroup.add(group);
  eng.bossVfxItems.push({
    group,
    life: 0,
    maxLife: duration,
    update: (_dt, t) => {
      const e = 1 - Math.pow(1 - t, 3);
      ring.scale.setScalar(0.5 + radius * e);
      ringMat.opacity = Math.pow(1 - t, 1.4);
      const ot = Math.min(1, t * 2.4);
      orb.scale.setScalar((0.5 + 2.6 * Math.sqrt(ot)) * orbScale);
      orbMat.opacity = 0.9 * Math.pow(1 - ot, 2);
    },
    dispose: () => {
      eng.dynamicGroup.remove(group);
      disposeObject(group);
    },
  });
}

/** Particle / piece count for this sequence: halved while another boss death is running. */
function scaled(c: BossDeathCtx, n: number): number {
  return c.lite ? Math.ceil(n * 0.5) : n;
}

/** Whole-body beat: scales the body uniformly by `swell + amp * sin(2 pi hz t)` around its base scale. */
export function pulseBody(c: BossDeathCtx, hz: number, amp: number, swell = 1): void {
  c.rig.body.scale.copy(c.baseBodyScale).multiplyScalar(swell + amp * Math.sin(c.t * Math.PI * 2 * hz));
}

/** Lerps every material toward a dead colour and drains its glow. `k` 0..1. */
export function tintBody(c: BossDeathCtx, hex: number, k: number): void {
  _tint.setHex(hex);
  for (const o of c.mats) {
    o.mat.color.copy(o.color).lerp(_tint, k);
    if (o.std) {
      const m = o.mat as THREE.MeshStandardMaterial;
      m.emissive.copy(o.emissive!).lerp(_black, k);
      m.emissiveIntensity = o.emissiveI * (1 - k);
    }
  }
}

/** Random flicker: lit materials glow in `hex` at a random strength in [lo, hi] every frame. */
export function flicker(c: BossDeathCtx, hex: number, lo: number, hi: number): void {
  glowEmissive(c, hex, lo + Math.random() * (hi - lo));
}

/** Meshes of the rig that are still attached and visible, with their base scale (built once). */
function rigMeshes(c: BossDeathCtx): NonNullable<BossDeathCtx['meshes']> {
  if (c.meshes) return c.meshes;
  const root = c.rig.root;
  root.updateMatrixWorld(true);
  const list: NonNullable<BossDeathCtx['meshes']> = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.isContactShadow || isInvisibleInRig(o, root)) return;
    list.push({ mesh: o, base: o.scale.clone(), y: _wp.setFromMatrixPosition(o.matrixWorld).y });
  });
  c.meshes = list;
  return list;
}

/** Shrinks the rig's parts to nothing from the top down: k 0 = intact, k 1 = gone. Pair with `spawnMotes`. */
export function dissolve(c: BossDeathCtx, k: number): void {
  const list = rigMeshes(c);
  let maxY = 0.01;
  for (const e of list) maxY = Math.max(maxY, e.y);
  for (const e of list) {
    const local = THREE.MathUtils.clamp((k - (1 - e.y / maxY) * 0.5) / 0.5, 0, 1);
    e.mesh.visible = local < 1;
    e.mesh.scale.copy(e.base).multiplyScalar(Math.max(0.001, 1 - local));
  }
}

export interface MoteOpts {
  count: number;
  colors: number[];
  radius: number;
  y0: number;
  y1: number;
  /** Horizontal speed (random direction) and vertical speed; a negative `gravity` makes motes accelerate upward. */
  hSpeed: number;
  up: number;
  gravity: number;
  life: number;
  scale: number;
}

/** Spawns particles from the shared pool around the boss (count halved while another death runs). */
export function spawnMotes(c: BossDeathCtx, o: MoteOpts): void {
  const n = scaled(c, o.count);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * o.radius;
    const sp = Math.random() * o.hSpeed;
    c.eng.spawnParticle(
      c.x + Math.cos(a) * r,
      o.y0 + Math.random() * (o.y1 - o.y0),
      c.z + Math.sin(a) * r,
      Math.cos(a + 1.7) * sp,
      o.up * (0.5 + Math.random() * 0.7),
      Math.sin(a + 1.7) * sp,
      o.colors[i % o.colors.length],
      o.scale * (0.7 + Math.random() * 0.6),
      o.life * (0.75 + Math.random() * 0.5),
      o.gravity
    );
  }
}

/** Frame-rate independent particle count for a spawn rate (per second). */
const perFrame = (rate: number, dt: number): number => Math.floor(rate * dt + Math.random());

/** A glowing soul orb that rises from the chest over `dur` seconds, growing as it goes (self-contained VFX item). */
export function spawnSoulOrb(c: BossDeathCtx, colorHex: number, y0: number, y1: number, dur: number): void {
  const eng = c.eng;
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), mat);
  group.add(orb);
  group.position.set(c.x, y0, c.z);
  eng.dynamicGroup.add(group);
  eng.bossVfxItems.push({
    group,
    life: 0,
    maxLife: Math.max(0.05, dur),
    update: (_dt, t, elapsed) => {
      group.position.y = y0 + (y1 - y0) * smooth(t);
      orb.scale.setScalar((0.5 + 1.1 * t) * (1 + Math.sin(elapsed * 30) * 0.08));
      mat.opacity = 0.55 + 0.4 * t;
    },
    dispose: () => {
      eng.dynamicGroup.remove(group);
      disposeObject(group);
    },
  });
}

/** A small secondary blast somewhere on the body (chain explosions): ring, orb, a few sparks and a light pop. */
export function miniBlast(c: BossDeathCtx, hex: number, hMax = 2.2): void {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * 0.8;
  const px = c.x + Math.cos(a) * r;
  const pz = c.z + Math.sin(a) * r;
  const py = 0.8 + Math.random() * (hMax - 0.8);
  spawnDeathShockwave(c.eng, px, pz, hex, 1.7, 0.35, 0.45);
  c.eng.triggerBossBurstLight(px, py, pz, hex, 90, 0.2);
  c.eng.addScreenShake(0.15, 0.15);
  const n = scaled(c, 6);
  for (let i = 0; i < n; i++) {
    const b = Math.random() * Math.PI * 2;
    c.eng.spawnParticle(px, py, pz, Math.cos(b) * 3, 1.5 + Math.random() * 2, Math.sin(b) * 3, i % 2 ? 0xffffff : hex, 0.9, 0.5, 6);
  }
}

function updateShards(c: BossDeathCtx, dt: number, fade: number): void {
  const damp = Math.exp(-0.7 * dt);
  for (const s of c.shards) {
    const m = s.mesh;
    if (!s.rest) {
      s.vy -= GRAVITY * dt;
      m.position.x += s.vx * dt;
      m.position.y += s.vy * dt;
      m.position.z += s.vz * dt;
      s.vx *= damp;
      s.vz *= damp;
      m.rotation.x += s.wx * dt;
      m.rotation.y += s.wy * dt;
      m.rotation.z += s.wz * dt;
      if (m.position.y < s.floorY) {
        m.position.y = s.floorY;
        if (Math.abs(s.vy) > 1.4) {
          s.vy = -s.vy * 0.4;
          s.vx *= 0.65;
          s.vz *= 0.65;
          s.wx *= 0.6;
          s.wy *= 0.6;
          s.wz *= 0.6;
        } else {
          s.rest = true;
        }
      }
    }
    if (fade > 0) {
      m.scale.copy(s.baseScale).multiplyScalar(1 - 0.45 * fade);
      (m.material as OwnedMat['mat']).opacity = 1 - fade;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Per-boss scripts
// ---------------------------------------------------------------------------------------------------------------

/** Generic: sink + tilt while glowing in the boss colour, then shatter and scatter chunks in that colour. */
function defaultScript(burst: number): BossDeathScript {
  return {
    finisherAt: 0.7,
    collapse: (c, u) => {
      const e = smooth(u);
      sinkSquash(c, e, 0.25, 0.18, 0.12);
      tiltFall(c, e, 0.35);
      glowEmissive(c, burst, 0.9 * e);
      pulseCore(c, e, 2);
    },
    finisher: (c) => {
      if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
      shatter(c, { speed: 5, up: 5, spin: 10 });
      scatterShards(c, {
        count: 10,
        geometry: 'octa',
        size: 0.22,
        color: burst,
        emissive: burst,
        emissiveI: 0.8,
        speed: 6,
        up: 6,
        spin: 12,
        y0: 0.6,
        y1: 1.8,
        radius: 0.6,
      });
    },
  };
}

/** Juggernaut: kneels and topples, armour plates peel off mid-collapse, then the ember core flares and blows. */
const juggernautScript: BossDeathScript = {
  finisherAt: 0.8,
  collapse: (c, u) => {
    const e = smooth(u);
    const r = c.rig;
    if (r.leftLeg) r.leftLeg.rotation.x = -1.15 * e;
    if (r.rightLeg) r.rightLeg.rotation.x = 0.85 * e;
    if (r.weaponArm) r.weaponArm.rotation.x = 0.9 * e;
    if (r.leftArm) r.leftArm.rotation.z = 0.5 * e;
    sinkSquash(c, e, 0.42, 0, 0);
    tiltFall(c, e, 0.5);
    glowEmissive(c, 0xff3a22, 0.7 * e);
    pulseCore(c, u * u, 3.5);
    if (u >= 0.35 && !c.flags.has('peeled')) {
      c.flags.add('peeled');
      // Upper-body armour (pauldrons, plates, horns, shield) comes loose; the core stays inside
      shatter(c, {
        filter: (m, wp) => m !== r.coreMesh && wp.y > 0.9 && Math.random() < 0.65,
        speed: 3.2,
        up: 3.5,
        spin: 8,
      });
    }
  },
  finisher: (c) => {
    if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
    shatter(c, { speed: 6.5, up: 7, spin: 12 });
    scatterShards(c, {
      count: 14,
      geometry: 'box',
      size: 0.2,
      color: 0x3a3f52,
      emissive: 0xff4a30,
      emissiveI: 0.55,
      speed: 7,
      up: 7,
      spin: 14,
      y0: 0.5,
      y1: 1.7,
      radius: 0.6,
    });
  },
};

/** Crystal Wyrm: freezes solid into white crystal, then bursts into a spray of crystal shards. */
const crystalWyrmScript: BossDeathScript = {
  finisherAt: 0.7,
  collapse: (c, u) => {
    const e = smooth(u);
    crystallize(c, e);
    tiltFall(c, e, 0.12);
    // A fine shiver as the crystal strains; the base pose is restored every frame
    c.rig.root.position.x = c.x + Math.sin(c.t * 70) * 0.025 * e;
    c.rig.root.position.z = c.z + Math.cos(c.t * 63) * 0.025 * e;
    pulseCore(c, e, 1.8);
  },
  finisher: (c) => {
    if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
    shatter(c, { speed: 7.5, up: 6.5, spin: 15 });
    scatterShards(c, {
      count: 28,
      geometry: 'cone',
      size: 0.2,
      color: 0xeafcff,
      emissive: 0x6fe6ff,
      emissiveI: 0.9,
      speed: 9,
      up: 8,
      spin: 16,
      y0: 0.4,
      y1: 2.0,
      radius: 0.8,
    });
  },
};

/** Archlich: the robed skeleton crumbles and drops; a soul rises out of the chest and bursts. */
const lichScript: BossDeathScript = {
  finisherAt: 0.75,
  collapse: (c, u) => {
    const e = smooth(u);
    sinkSquash(c, e, 0.5, 0.25, 0.1);
    tiltFall(c, e, 0.2);
    glowEmissive(c, 0xb040ff, 0.7 * e);
    if (!c.flags.has('soul')) {
      c.flags.add('soul');
      spawnSoulOrb(c, 0xd975ff, 1.9, 3.7, 0.75 - c.t);
    }
    if (u >= 0.4 && !c.flags.has('crumble')) {
      c.flags.add('crumble');
      // Robe, crown and sleeves come away first and simply fall
      shatter(c, { filter: (m) => m !== c.rig.coreMesh && Math.random() < 0.5, speed: 1.1, up: 0.8, spin: 4, lift: 0 });
    }
  },
  finisher: (c) => {
    if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
    shatter(c, { speed: 2.2, up: 1.4, spin: 6, lift: 0 });
    scatterShards(c, {
      count: 8,
      geometry: 'box',
      size: 0.16,
      color: 0xe6decb,
      emissive: 0x9a3cff,
      emissiveI: 0.35,
      speed: 3.5,
      up: 3,
      spin: 8,
      y0: 0.8,
      y1: 1.8,
      radius: 0.5,
    });
    spawnMotes(c, { count: 14, colors: [0xd975ff, 0xf2c8ff], radius: 0.6, y0: 1.2, y1: 2.4, hSpeed: 1.5, up: 3, gravity: -1.5, life: 1.2, scale: 1.1 });
  },
};

/** Molten Colossus: lava cracks glow brighter across the body, it shudders, then breaks into tumbling rock. */
const colossusScript: BossDeathScript = {
  finisherAt: 0.8,
  collapse: (c, u, dt) => {
    const e = smooth(u);
    glowEmissive(c, 0xff5a10, 0.15 + 1.0 * e * (0.85 + Math.random() * 0.15));
    sinkSquash(c, e, 0.12, 0.08, 0.06);
    c.rig.root.position.x = c.x + (Math.random() - 0.5) * 0.08 * e;
    c.rig.root.position.z = c.z + (Math.random() - 0.5) * 0.08 * e;
    pulseCore(c, e, 0.6);
    // Lava sparks leak out of the cracks
    if (perFrame(30 * e, dt) > 0) {
      spawnMotes(c, { count: 1, colors: [0xff7e24, 0xffe066], radius: 0.7, y0: 0.5, y1: 1.9, hSpeed: 1.5, up: 2.5, gravity: 5, life: 0.6, scale: 0.8 });
    }
  },
  finisher: (c) => {
    if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
    shatter(c, { speed: 4.2, up: 4.5, spin: 6 });
    scatterShards(c, {
      count: 12,
      geometry: 'box',
      size: 0.32,
      color: 0x262228,
      emissive: 0xff5a10,
      emissiveI: 0.8,
      speed: 5,
      up: 5,
      spin: 7,
      y0: 0.5,
      y1: 1.6,
      radius: 0.7,
    });
  },
};

/** Fungal King: wilts brown-grey and slumps, then bursts its cap into a big drifting spore cloud. */
const fungalKingScript: BossDeathScript = {
  finisherAt: 0.8,
  collapse: (c, u, dt) => {
    const e = smooth(u);
    sinkSquash(c, e, 0.4, 0.4, 0.12);
    tiltFall(c, e, 0.15);
    tintBody(c, 0x4a3f33, e * 0.85);
    pulseCore(c, e, 1.2);
    if (u > 0.4 && perFrame(18, dt) > 0) {
      spawnMotes(c, { count: 1, colors: [0x7dffb0, 0x52f795], radius: 0.8, y0: 1.0, y1: 1.9, hSpeed: 0.6, up: 0.8, gravity: -0.3, life: 1.6, scale: 0.9 });
    }
  },
  finisher: (c) => {
    if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
    shatter(c, { speed: 2.4, up: 2.5, spin: 5, lift: 0.25 });
    // Slow, lingering spore cloud
    spawnMotes(c, { count: 28, colors: [0x7dffb0, 0x52f795, 0xc8ffd8], radius: 1.4, y0: 0.5, y1: 2.0, hSpeed: 1.1, up: 0.9, gravity: -0.25, life: 2.5, scale: 1.0 });
  },
};

/** Leviathan Heart: convulses faster and faster, bursts in a flesh spray, then the remains sag and melt flat. */
const leviathanScript: BossDeathScript = {
  finisherAt: 0.7,
  collapse: (c, u) => {
    pulseBody(c, 8 + 14 * u, 0.05 + 0.13 * u);
    flicker(c, 0xff2a10, 0.2, 0.3 + 0.7 * u);
    c.rig.root.position.x = c.x + (Math.random() - 0.5) * 0.07 * u;
    c.rig.root.position.z = c.z + (Math.random() - 0.5) * 0.07 * u;
    pulseCore(c, u, 1.4);
  },
  finisher: (c) => {
    if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
    // Ribs, claws, vessels and limbs burst off; the heart muscle itself stays behind to melt
    shatter(c, {
      filter: (m) => m.geometry.type !== 'DodecahedronGeometry' && m.geometry.type !== 'SphereGeometry',
      speed: 5.5,
      up: 5,
      spin: 10,
    });
    scatterShards(c, {
      count: 12,
      geometry: 'octa',
      size: 0.2,
      color: 0xb81f1f,
      emissive: 0x501010,
      emissiveI: 0.5,
      speed: 6.5,
      up: 5,
      spin: 9,
      y0: 0.6,
      y1: 1.6,
      radius: 0.5,
    });
    spawnMotes(c, { count: 20, colors: [0xff3a22, 0xff8826, 0x8a1010], radius: 0.4, y0: 0.7, y1: 1.5, hSpeed: 6, up: 5, gravity: 8, life: 0.9, scale: 1.1 });
  },
  remains: (c, r) => {
    const k = smooth(Math.min(1, r / 0.9));
    c.rig.body.scale.copy(c.baseBodyScale);
    sinkSquash(c, k, 0.8, 0.88, 0.6);
    tintBody(c, 0x3a0c0c, k * 0.8);
  },
};

/** Abyssal Brain: swells and glows, a teal psychic shockwave rips out, then the husk shrivels. */
const abyssalBrainScript: BossDeathScript = {
  finisherAt: 0.75,
  collapse: (c, u) => {
    const e = smooth(u);
    pulseBody(c, 6 + 6 * u, 0.03 + 0.04 * u, 1 + 0.38 * e);
    glowEmissive(c, 0x36f5d4, 0.2 + 0.8 * e);
    pulseCore(c, e, 1.6);
    if (c.rig.coreMesh) c.rig.coreMesh.rotation.z += 0.35;
  },
  finisher: (c) => {
    if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
    // Extra wide psychic ring on top of the common blast (no orb: it is a wave, not a fireball)
    spawnDeathShockwave(c.eng, c.x, c.z, 0x36f5d4, 10, 0.95, 0);
    shatter(c, {
      filter: (m) => m.geometry.type === 'CylinderGeometry' || m.geometry.type === 'OctahedronGeometry' || m.geometry.type === 'BoxGeometry',
      speed: 5,
      up: 4,
      spin: 9,
    });
    spawnMotes(c, { count: 16, colors: [0x36f5d4, 0xc8ff4d], radius: 0.6, y0: 0.8, y1: 2.0, hSpeed: 4, up: 1.5, gravity: 1, life: 1.0, scale: 1.0 });
  },
  remains: (c, r) => {
    const k = smooth(Math.min(1, r / 0.8));
    c.rig.body.scale.set(c.baseBodyScale.x * (1.38 - 0.85 * k), c.baseBodyScale.y * (1.38 - 1.0 * k), c.baseBodyScale.z * (1.38 - 0.85 * k));
    tintBody(c, 0x2a4a50, k * 0.9);
  },
};

/** Mothership AI: electric overload, parts drop off, a chain of small blasts, then one big explosion. */
const mothershipScript: BossDeathScript = {
  finisherAt: 0.85,
  collapse: (c, u, dt) => {
    const e = smooth(u);
    flicker(c, 0x8fc4ff, 0.1, 0.5 + 0.7 * e);
    sinkSquash(c, e, 0.9, 0, 0);
    tiltFall(c, e, 0.3);
    if (c.rig.coreMesh) c.rig.coreMesh.rotation.z += 0.5 * e;
    if (perFrame(26, dt) > 0) {
      spawnMotes(c, { count: 1, colors: [0xffffff, 0x8fc4ff], radius: 0.8, y0: 0.5, y1: 1.8, hSpeed: 4, up: 3, gravity: 6, life: 0.4, scale: 0.7 });
    }
    // Weapon pods and fins drop first, then the lens / collar hardware
    if (u >= 0.2 && !c.flags.has('drop1')) {
      c.flags.add('drop1');
      shatter(c, { filter: (m) => m.geometry.type === 'BoxGeometry', speed: 1.6, up: 1.5, spin: 5, lift: 0.1 });
    }
    if (u >= 0.55 && !c.flags.has('drop2')) {
      c.flags.add('drop2');
      shatter(c, { filter: (m) => m !== c.rig.coreMesh && m.geometry.type !== 'OctahedronGeometry', speed: 2, up: 1.5, spin: 6, lift: 0.1 });
    }
    // Chain of small blasts
    for (const [i, at] of [0.2, 0.42, 0.65, 0.85].entries()) {
      const key = `blast${i}`;
      if (u >= at && !c.flags.has(key)) {
        c.flags.add(key);
        miniBlast(c, i % 2 ? 0xffa62b : 0xff4757);
      }
    }
  },
  finisher: (c) => {
    if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
    shatter(c, { speed: 7, up: 7, spin: 13 });
    scatterShards(c, {
      count: 16,
      geometry: 'box',
      size: 0.2,
      color: 0x1e293b,
      emissive: 0xff4757,
      emissiveI: 0.6,
      speed: 8,
      up: 7,
      spin: 14,
      y0: 0.5,
      y1: 1.8,
      radius: 0.6,
    });
  },
};

/** Xeno Commander: drops to its knees, then dissolves part by part into green motes that drift upward. */
const xenoScript: BossDeathScript = {
  finisherAt: 0.85,
  soft: true,
  collapse: (c, u, dt) => {
    const e = smooth(u);
    const r = c.rig;
    if (r.leftLeg) r.leftLeg.rotation.x = -1.15 * e;
    if (r.rightLeg) r.rightLeg.rotation.x = 0.85 * e;
    if (r.weaponArm) r.weaponArm.rotation.x = 0.8 * e;
    if (r.leftArm) r.leftArm.rotation.z = 0.5 * e;
    sinkSquash(c, e, 0.45, 0, 0);
    glowEmissive(c, 0x39ff7a, 0.5 * e);
    if (u > 0.35) {
      dissolve(c, ((u - 0.35) / 0.65) * 0.45);
      if (perFrame(30, dt) > 0) spawnMotes(c, { count: 1, colors: [0x39ff7a, 0xc8ffd8], radius: 0.5, y0: 0.4, y1: 2.0, hSpeed: 0.5, up: 1.6, gravity: -1, life: 1.3, scale: 0.9 });
    }
  },
  finisher: (c) => {
    if (c.rig.coreMesh) c.rig.coreMesh.visible = false;
    spawnMotes(c, { count: 20, colors: [0x39ff7a, 0xc8ffd8, 0xffee52], radius: 0.7, y0: 0.4, y1: 2.0, hSpeed: 0.8, up: 2.2, gravity: -1, life: 1.6, scale: 1.0 });
  },
  remains: (c, r, dt) => {
    dissolve(c, 0.45 + 0.55 * smooth(Math.min(1, r / 0.7)));
    if (r < 0.7 && perFrame(24, dt) > 0) spawnMotes(c, { count: 1, colors: [0x39ff7a, 0xc8ffd8], radius: 0.5, y0: 0.4, y1: 2.0, hSpeed: 0.5, up: 1.8, gravity: -1, life: 1.4, scale: 0.9 });
  },
};

const BOSS_DEATH_SCRIPTS: Partial<Record<EnemyKind, BossDeathScript>> = {
  boss_juggernaut: juggernautScript,
  boss_crystal_wyrm: crystalWyrmScript,
  boss_lich: lichScript,
  boss_colossus: colossusScript,
  boss_fungal_king: fungalKingScript,
  boss_leviathan_heart: leviathanScript,
  boss_abyssal_brain: abyssalBrainScript,
  boss_mothership_ai: mothershipScript,
  boss_xeno_commander: xenoScript,
};

// ---------------------------------------------------------------------------------------------------------------
// Engine method
// ---------------------------------------------------------------------------------------------------------------

export interface BossDeathOpts {
  /** Where the killer stands: the boss falls away from it. */
  killerX: number;
  killerZ: number;
  /** Boss hoard drop. Runs exactly once: at the finisher, or at once when the animation is skipped / cut short. */
  onFinisher?: (() => void) | null;
  /** Take the rig out of the scene when the sequence ends (teammate clients; the host keeps its hidden rig). */
  removeRoot?: boolean;
}

export const bossDeathMethods = {
  /**
   * Plays the death sequence for a boss that has just been killed (see the header comment). The caller has already
   * flagged it dead; this takes over the rig. `onFinisher` is guaranteed to run once, even when the animation is skipped
   * (background dungeon) or disposed early (level cleared / run restarted).
   */
  playBossDeath(this: EmbervaultEngine, enemy: EnemyEntity, opts: BossDeathOpts): void {
    const rig = enemy.rig;
    const removeRoot = opts.removeRoot === true;
    if (this.bgSim) {
      // Nobody watches the background dungeon: no animation, the hoard drops now
      rig.root.visible = false;
      if (removeRoot) this.dynamicGroup.remove(rig.root);
      opts.onFinisher?.();
      return;
    }

    const burst = BOSS_DEATH_BURST_COLOR[enemy.kind] ?? DEFAULT_BURST_COLOR;
    const script = BOSS_DEATH_SCRIPTS[enemy.kind] ?? defaultScript(burst);
    let dx = enemy.x - opts.killerX;
    let dz = enemy.z - opts.killerZ;
    const dl = Math.hypot(dx, dz);
    if (dl < 0.05) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dz = Math.sin(a);
    } else {
      dx /= dl;
      dz /= dl;
    }

    const group = new THREE.Group();
    this.dynamicGroup.add(group);
    rig.root.visible = true;
    rig.root.position.set(enemy.x, 0, enemy.z);
    stripStatusFx(rig);
    const c: BossDeathCtx = {
      eng: this,
      enemy,
      rig,
      group,
      mats: ownRigMaterials(rig.root),
      shards: [],
      x: enemy.x,
      z: enemy.z,
      dirX: dx,
      dirZ: dz,
      burstColor: burst,
      baseBodyY: rig.body.position.y,
      baseBodyScale: rig.body.scale.clone(),
      t: 0,
      fired: false,
      flags: new Set<string>(),
      onFinisher: opts.onFinisher ?? null,
      removeRoot,
      lite: activeDeaths > 0,
      meshes: null,
    };
    activeDeaths++;
    let staggerDone = false;
    this.addScreenShake(0.25, 0.2);

    const runLoot = (): void => {
      const fn = c.onFinisher;
      c.onFinisher = null;
      fn?.();
    };
    const total = script.finisherAt + HOLD + FADE;

    this.bossVfxItems.push({
      group,
      life: 0,
      maxLife: total,
      update: (dt) => {
        c.t += dt;
        if (c.t < STAGGER) {
          // Stagger: strobing white flash and a violent jitter on the spot
          setFlash(c, Math.sin(c.t * 90) > -0.3 ? 1 : 0.45);
          rig.root.position.x = c.x + (Math.random() - 0.5) * 0.12;
          rig.root.position.z = c.z + (Math.random() - 0.5) * 0.12;
        } else if (!c.fired) {
          if (!staggerDone) {
            staggerDone = true;
            setFlash(c, 0);
            rig.root.position.set(c.x, 0, c.z);
          }
          if (c.t >= script.finisherAt) {
            c.fired = true;
            fireFinisher(c, script);
            runLoot();
          } else {
            script.collapse(c, (c.t - STAGGER) / (script.finisherAt - STAGGER), dt);
          }
        }
        const fade = c.fired ? THREE.MathUtils.clamp((c.t - script.finisherAt - HOLD) / FADE, 0, 1) : 0;
        if (c.fired) script.remains?.(c, c.t - script.finisherAt, dt);
        updateShards(c, dt, fade);
        if (fade > 0) {
          for (const o of c.mats) o.mat.opacity = o.opacity * (1 - fade); // whatever is still attached to the rig fades too
          rig.root.traverse((o) => {
            if (o instanceof THREE.Mesh && o.userData.isContactShadow) (o.material as THREE.Material).opacity = 0.7 * (1 - fade);
          });
        }
      },
      dispose: () => {
        activeDeaths = Math.max(0, activeDeaths - 1);
        runLoot(); // never lose the hoard when the level is cleared mid-animation
        rig.root.visible = false;
        this.dynamicGroup.remove(group);
        disposeObject(group);
        for (const o of c.mats) o.mat.dispose();
        if (c.removeRoot) {
          this.dynamicGroup.remove(rig.root);
          disposeObject(rig.root);
        }
      },
    });
  },
};

/** The common explosion every boss shares, then the boss' own finisher. */
function fireFinisher(c: BossDeathCtx, script: BossDeathScript): void {
  const eng = c.eng;
  const { x, z, burstColor } = c;
  const soft = script.soft === true;
  // Everything that stays attached to the rig may fade out at the end: make the materials transparent now
  for (const o of c.mats) {
    o.mat.transparent = true;
    o.mat.needsUpdate = true;
  }
  eng.triggerBossBurstLight(x, 2.0, z, burstColor, soft ? 120 : 230, soft ? 0.5 : 0.75);
  if (!soft) eng.triggerBossImpactFlash(x, z, burstColor, 1.2, 0.2);
  spawnDeathShockwave(eng, x, z, burstColor, soft ? 4 : 6.5, 0.75, soft ? 0.3 : 1);
  const burstN = soft || c.lite ? 18 : 36;
  for (let i = 0; i < burstN; i++) {
    const a = (i / burstN) * Math.PI * 2;
    const spd = 2.5 + Math.random() * 5.0;
    eng.spawnParticle(
      x,
      1.1,
      z,
      Math.cos(a) * spd,
      2.2 + Math.random() * 3.8,
      Math.sin(a) * spd,
      i % 2 === 0 ? 0xffe066 : burstColor,
      1.45,
      0.85,
      5.5
    );
  }
  eng.addScreenShake(soft ? 0.4 : 0.75, 0.55);
  eng.audio.setEmitter(x, z);
  eng.audio.playBossDeathBlast();
  eng.audio.setEmitter(null);
  script.finisher(c);
}
