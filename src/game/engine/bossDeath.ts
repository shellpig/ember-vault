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
}

interface BossDeathScript {
  /** Seconds after the death starts when the finisher fires (~0.7 so the stagger + collapse sit in the slow motion). */
  finisherAt: number;
  /** Runs every frame between the stagger and the finisher; `u` goes 0..1 over that span. */
  collapse: (c: BossDeathCtx, u: number, dt: number) => void;
  /** Runs right after the common finisher effects: shatter / hide whatever is left of the rig. */
  finisher: (c: BossDeathCtx) => void;
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
      vy: opts.up * (0.45 + Math.random() * 0.8) + wy * 0.5,
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
  for (let i = 0; i < o.count; i++) {
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
  duration: number
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
      orb.scale.setScalar(0.5 + 2.6 * Math.sqrt(ot));
      orbMat.opacity = 0.9 * Math.pow(1 - ot, 2);
    },
    dispose: () => {
      eng.dynamicGroup.remove(group);
      disposeObject(group);
    },
  });
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

const BOSS_DEATH_SCRIPTS: Partial<Record<EnemyKind, BossDeathScript>> = {
  boss_juggernaut: juggernautScript,
  boss_crystal_wyrm: crystalWyrmScript,
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
    };
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
        updateShards(c, dt, fade);
        if (fade > 0) {
          rig.root.traverse((o) => {
            if (o instanceof THREE.Mesh && o.userData.isContactShadow) (o.material as THREE.Material).opacity = 0.7 * (1 - fade);
          });
        }
      },
      dispose: () => {
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
  eng.triggerBossBurstLight(x, 2.0, z, burstColor, 230, 0.75);
  eng.triggerBossImpactFlash(x, z, burstColor, 1.2, 0.2);
  spawnDeathShockwave(eng, x, z, burstColor, 6.5, 0.75);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
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
  eng.addScreenShake(0.75, 0.55);
  eng.audio.setEmitter(x, z);
  eng.audio.playBossDeathBlast();
  eng.audio.setEmitter(null);
  script.finisher(c);
}
