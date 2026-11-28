import type { EmbervaultEngine } from '../engine';
import { TILE_SIZE, findGridPath, gridToWorld, hasLineOfSight, worldToGrid, worldToWalkableGrid } from '../dungeon';
import {
  BOSS_ACTION,
  BOSS_BASIC,
  BOSS_CASTER_BASIC_SPEED_MULT,
  BOSS_CHARGE,
  BOSS_CHASE_WAKE_RANGE,
  BOSS_CONFIGS,
  BOSS_COOLDOWN,
  BOSS_ENGAGE_RANGE,
  BOSS_ENRAGE,
  BOSS_NOVA,
  BOSS_ORBITAL,
  BOSS_PRISM,
  BOSS_RECOVER,
  BOSS_SKILLS,
  BOSS_VOLLEY,
  BOSS_WARP,
  BossActionType,
  BossConfig,
  BossSkillKind,
  ENEMY_AURA_ATKSPD_MULT,
  ENEMY_AURA_DEFS,
  ENEMY_AURA_TYPES,
  EnemyAuraType,
  ENEMY_AURA_ATK_MULT,
  ENEMY_AURA_CRIT_BONUS,
  ENEMY_AURA_INTERVAL,
  ENEMY_AURA_MOVE_MULT,
  ENEMY_AURA_RADIUS,
  ENEMY_CRIT_MULT,
  FloorBossKind,
  getEnemyDepthTier,
  getRangedProjectileKind,
  isArcherLikeRanged,
  isFloorBoss,
  isGuardianEnemy,
  isSwarmEnemy,
} from './data';
import { EnemyEntity, PetEntity } from './entities';
import type { Hero } from '../hero';
import { AURA_BAND_RADIUS, createAuraPool, createBossRageAura, createProjectileMesh } from '../models';
import { ProjectileKind } from '../types';
import * as THREE from 'three';

const AURA_POOL_FADE = 0.2;
/** Seconds each aura colour is held (then cross-faded) when several auras cover the same enemy. */
const AURA_COLOR_CYCLE = 1.2;
const _auraColA = new THREE.Color();
const _auraColB = new THREE.Color();

/** Colour of a pool covered by several auras: slow cross-fade through the aura colours in `types`. */
function cycleAuraColor(out: THREE.Color, types: EnemyAuraType[], t: number): void {
  out.setHex(ENEMY_AURA_DEFS[types[0]].color);
  if (types.length < 2) return;
  const phase = t / AURA_COLOR_CYCLE;
  const i = Math.floor(phase) % types.length;
  const f = phase - Math.floor(phase);
  const k = f < 0.6 ? 0 : (f - 0.6) / 0.4;
  out.setHex(ENEMY_AURA_DEFS[types[i]].color);
  _auraColB.setHex(ENEMY_AURA_DEFS[types[(i + 1) % types.length]].color);
  out.lerp(_auraColB, k * k * (3 - 2 * k));
}

export const enemiesMethods = {
  /**
   * Basic-attack cooldown divisor of a regular monster: elite 1.25x, depth tier bonus, named-elite attack-speed aura (all
   * multiplied). Only the cooldown uses it: the windup (telegraph) is never shortened by tier or aura.
   */
  getEnemyAtkSpeedDiv(this: EmbervaultEngine, e: EnemyEntity): number {
    const tier = getEnemyDepthTier(this.getEffectiveSimDepth());
    return (e.isElite ? 1.25 : 1) * (1 + tier.atkSpeedBonus) * (e.fxAtkSpd ? ENEMY_AURA_ATKSPD_MULT : 1);
  },

  /** Damage multiplier the named-elite "atk" aura gives a regular monster's basic attack. */
  getEnemyAuraDamageMult(this: EmbervaultEngine, e: EnemyEntity): number {
    return e.fxAtk ? ENEMY_AURA_ATK_MULT : 1;
  },

  /** Rolls the enemy crit for one basic attack (base chance + the crit aura). */
  rollEnemyCrit(this: EmbervaultEngine, e: EnemyEntity): boolean {
    const chance = Math.min(1, e.critChance + (e.fxCrit ? ENEMY_AURA_CRIT_BONUS : 0));
    return chance > 0 && Math.random() < chance;
  },

  /** Holder light: breathing band, slowly orbiting glyph marks, drifting motes, +-5% pulse (host and teammate clients). */
  animateAuraRing(this: EmbervaultEngine, e: EnemyEntity, dt: number): void {
    const fx = e.auraHolderFx;
    if (!fx) return;
    const t = this.elapsed + e.id * 0.7;
    fx.group.scale.setScalar(1 + Math.sin(t * 1.7) * 0.05);
    (fx.band.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 2.1) * 0.1;
    fx.glyphPivot.rotation.y += dt * 0.35;
    fx.glyphMat.opacity = 0.7 + Math.sin(t * 2.1 + 1) * 0.12;
    for (const m of fx.motes) {
      const f = (t * 0.32 + (m.userData.phase as number)) % 1;
      const ang = (m.userData.ang as number) + t * 0.25;
      const r = AURA_BAND_RADIUS * (0.35 + 0.55 * ((m.userData.phase as number) * 1.7 % 1));
      m.position.set(Math.cos(ang) * r, 0.1 + f * 1.5, Math.sin(ang) * r);
      m.scale.setScalar(Math.sin(f * Math.PI) * 0.3);
    }
  },

  /**
   * Ground light (host and teammate clients, purely visual). A covered regular monster gets one soft glow pool under its
   * feet; with several auras it cross-fades slowly between their colours. A holder keeps its band, and its inner glow
   * cycles through the OTHER auras covering it. Pools fade in/out over AURA_POOL_FADE s and are disposed when gone.
   */
  updateAuraRings(this: EmbervaultEngine, list: EnemyEntity[], dt: number): void {
    const types: EnemyAuraType[] = [];
    for (const e of list) {
      if (e.isBoss) continue;
      if (e.auraHolderFx && !e.dead) this.animateAuraRing(e, dt);
      if (!e.auraPool && !(e.auraMask && !e.dead) && !e.auraHolderFx) continue;
      const mask = e.dead ? 0 : (e.auraMask ?? 0);
      types.length = 0;
      for (let i = 0; i < ENEMY_AURA_TYPES.length; i++) {
        if ((mask & (1 << i)) !== 0 && e.aura !== ENEMY_AURA_TYPES[i]) types.push(ENEMY_AURA_TYPES[i]);
      }
      const t = this.elapsed + e.id * 0.37;
      if (e.auraHolderFx) {
        // Holder: inner glow shows its own colour, cross-fading through other covering auras when there are any
        const own = e.aura!;
        const cyc = types.length > 0 ? [own, ...types] : [own];
        cycleAuraColor(_auraColA, cyc, t);
        const inner = e.auraHolderFx.inner.material as THREE.MeshBasicMaterial;
        inner.color.copy(_auraColA);
        inner.opacity = 0.22 + Math.sin(t * 1.9) * 0.05;
        continue;
      }
      const wanted = types.length > 0;
      let pool = e.auraPool;
      if (!pool) {
        if (!wanted) continue;
        const mesh = createAuraPool(ENEMY_AURA_DEFS[types[0]].color);
        e.rig.root.add(mesh);
        pool = { mesh, alpha: 0 };
        e.auraPool = pool;
      }
      pool.alpha = wanted ? Math.min(1, pool.alpha + dt / AURA_POOL_FADE) : Math.max(0, pool.alpha - dt / AURA_POOL_FADE);
      if (pool.alpha <= 0 && !wanted) {
        e.rig.root.remove(pool.mesh);
        pool.mesh.geometry.dispose();
        (pool.mesh.material as THREE.Material).dispose();
        e.auraPool = undefined;
        continue;
      }
      const mat = pool.mesh.material as THREE.MeshBasicMaterial;
      if (wanted) cycleAuraColor(mat.color, types, t);
      mat.opacity = pool.alpha * (0.62 + Math.sin(t * 2.1) * 0.1);
      pool.mesh.scale.setScalar(1 + Math.sin(t * 1.6) * 0.04);
    }
  },

  /**
   * Recomputes `auraMask` (bit per ENEMY_AURA_TYPES index) for every regular monster within ENEMY_AURA_RADIUS of a living
   * holder (the holder included). Swarm critters never get the move bit. `applyFx` (host / single player only) also
   * mirrors the mask into the cached gameplay `fx*` flags; a teammate client passes false and only draws.
   */
  refreshAuraMask(this: EmbervaultEngine, list: EnemyEntity[], applyFx: boolean): void {
    const holders = list.filter((e) => e.aura && !e.dead && !e.isBoss);
    for (const e of list) {
      if (e.isBoss) continue;
      let mask = 0;
      if (!e.dead && (e.rig.root.position.y > -10 || applyFx)) {
        for (const h of holders) {
          if (Math.hypot(e.x - h.x, e.z - h.z) > ENEMY_AURA_RADIUS) continue;
          if (h.aura === 'move' && isSwarmEnemy(e.kind)) continue;
          mask |= 1 << ENEMY_AURA_TYPES.indexOf(h.aura!);
        }
      }
      e.auraMask = mask;
      if (applyFx) {
        e.fxAtkSpd = (mask & 1) !== 0;
        e.fxAtk = (mask & 2) !== 0;
        e.fxDr = (mask & 4) !== 0;
        e.fxMove = (mask & 8) !== 0;
        e.fxCrit = (mask & 16) !== 0;
      }
    }
  },

  /** Named-elite auras (host / single player): refresh membership + gameplay flags on a timer, rings every frame. */
  updateEnemyAuras(this: EmbervaultEngine, dt: number): void {
    this.enemyAuraTimer -= dt;
    if (this.enemyAuraTimer <= 0) {
      this.enemyAuraTimer = ENEMY_AURA_INTERVAL;
      this.refreshAuraMask(this.enemies, true);
    }
    this.updateAuraRings(this.enemies, dt);
  },

  /** Damage of one boss hit: `fraction` of the boss's base damage at this depth, x enrage multiplier (docs/boss-spec.md). */
  bossDamage(this: EmbervaultEngine, e: EnemyEntity, fraction: number): number {
    const cfg = BOSS_CONFIGS[e.kind as FloorBossKind];
    return cfg.damage * fraction * this.getDepthDamageScale() * (e.bossEnraged ? BOSS_ENRAGE.damageMult : 1);
  },

  /** Section 4: caster basic attacks (windup + recovery + cooldown) run 25% faster. */
  bossBasicSpeedDiv(this: EmbervaultEngine, e: EnemyEntity): number {
    const cfg = BOSS_CONFIGS[e.kind as FloorBossKind];
    return e.bossAction === 'basic' && cfg.bossType === 'caster' ? BOSS_CASTER_BASIC_SPEED_MULT : 1;
  },

  /** Section 6: the first time the boss drops to 50% HP it enrages for the rest of the fight (host / single player only). */
  checkBossEnrage(this: EmbervaultEngine, e: EnemyEntity): void {
    if (!e.isBoss || e.dead || e.bossEnraged || !isFloorBoss(e.kind)) return;
    if (e.hp > e.maxHp * BOSS_ENRAGE.hpFraction) return;
    const cfg = BOSS_CONFIGS[e.kind];
    e.bossEnraged = true;
    e.speed = cfg.speed * BOSS_ENRAGE.speedMult;
    this.audio.playBossSlam();
    this.pushBanner(`${e.bossName ?? 'BOSS'} 狂暴化！`, '移動加快 · 傷害提升', true);
    // Every hero in the dungeon feels one shake (teammates get it as a private event)
    this.forEachLiveHero(() => this.addScreenShake(BOSS_ENRAGE.shakeMagnitude, BOSS_ENRAGE.shakeDuration));
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const spd = 3 + Math.random() * 4;
      this.spawnParticle(
        e.x + Math.cos(a) * 0.6,
        0.4 + Math.random() * 1.2,
        e.z + Math.sin(a) * 0.6,
        Math.cos(a) * spd,
        1.5 + Math.random() * 3,
        Math.sin(a) * spd,
        i % 3 === 0 ? 0xffd24a : BOSS_ENRAGE.color,
        1.5,
        0.7,
        4
      );
    }
    this.emitHud();
  },

  /** Red aura + pulsing red tint of an enraged boss. Runs on the host and, from the snapshot flag, on teammates. */
  updateBossRageVisual(this: EmbervaultEngine, e: EnemyEntity, dt: number): void {
    if (!e.isBoss) return;
    if (!e.bossEnraged || e.bossWarpUntargetable) {
      if (e.rig.rageAura) e.rig.rageAura.visible = false;
      return;
    }
    if (!e.rig.rageAura) {
      const aura = createBossRageAura(BOSS_ENRAGE.color);
      aura.scale.setScalar(e.kind === 'boss_leviathan_heart' || e.kind === 'boss_colossus' ? 1.25 : 1);
      e.rig.root.add(aura);
      e.rig.rageAura = aura;
    }
    const aura = e.rig.rageAura;
    aura.visible = true;
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 7 + e.id);
    aura.rotation.y += dt * 1.6;
    const ring = aura.userData.ring as THREE.Mesh | undefined;
    const column = aura.userData.column as THREE.Mesh | undefined;
    if (ring) {
      ring.scale.setScalar(1 + pulse * 0.14);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + pulse * 0.35;
    }
    if (column) (column.material as THREE.MeshBasicMaterial).opacity = 0.12 + pulse * 0.14;
    if (Math.random() < dt * 22) {
      const a = Math.random() * Math.PI * 2;
      this.spawnParticle(
        e.x + Math.cos(a) * 0.9,
        0.2,
        e.z + Math.sin(a) * 0.9,
        (Math.random() - 0.5) * 0.6,
        1.6 + Math.random() * 1.4,
        (Math.random() - 0.5) * 0.6,
        Math.random() < 0.4 ? 0xffd24a : BOSS_ENRAGE.color,
        0.9,
        0.5,
        -0.5
      );
    }
  },

  /** Section 5: roll the type of the next action (50/50) with the "never 3 of a kind in a row" rule. */
  bossRollNextType(this: EmbervaultEngine, e: EnemyEntity): BossActionType {
    let want: BossActionType = Math.random() < BOSS_ACTION.skillChance ? 'skill' : 'basic';
    if (e.bossLastType === want && (e.bossStreak ?? 0) >= BOSS_ACTION.maxSameInRow) {
      want = want === 'skill' ? 'basic' : 'skill';
    }
    return want;
  },

  /**
   * Find an unobstructed landing position for `warp_ambush` adjacent to `(hx, hz)` at distance 1.4-1.8 tiles.
   */
  findWarpLandingSpot(
    this: EmbervaultEngine,
    hx: number,
    hz: number,
    fromX: number,
    fromZ: number
  ): { x: number; z: number } {
    // Prefer ambushing behind / flanking the player relative to the boss's takeoff position
    const baseAng = Math.atan2(hx - fromX, hz - fromZ) + (Math.random() - 0.5) * 1.3;
    const radii = [1.6, 1.45, 1.75, BOSS_WARP.landDistMin, BOSS_WARP.landDistMax];
    const samples = 16;

    for (const r of radii) {
      for (let k = 0; k < samples; k++) {
        // Alternate clockwise / counter-clockwise outward from baseAng
        const step = k % 2 === 0 ? k / 2 : -Math.ceil(k / 2);
        const ang = baseAng + (step / samples) * Math.PI * 2;
        const cx = hx + Math.sin(ang) * r;
        const cz = hz + Math.cos(ang) * r;
        if (
          this.canMoveTo(cx, cz, 0.52) &&
          hasLineOfSight(this.dungeon, hx, hz, cx, cz, this.doorUnlocked, 0.25)
        ) {
          return { x: cx, z: cz };
        }
      }
    }
    // Fallback without LOS requirement in very tight corners
    for (const r of [1.6, 1.4, 1.8, 1.15, 2.0]) {
      for (let k = 0; k < samples; k++) {
        const ang = baseAng + (k / samples) * Math.PI * 2;
        const cx = hx + Math.sin(ang) * r;
        const cz = hz + Math.cos(ang) * r;
        if (this.canMoveTo(cx, cz, 0.52)) return { x: cx, z: cz };
      }
    }
    return this.canMoveTo(hx, hz, 0.52) ? { x: hx, z: hz } : { x: fromX, z: fromZ };
  },

  /** Enter the windup state for a chosen boss skill (shared by normal action picks & warp_ambush Phase 4 chain). */
  startBossSkillWindup(
    this: EmbervaultEngine,
    e: EnemyEntity,
    cfg: BossConfig,
    chosen: BossSkillKind,
    dx: number,
    dz: number,
    dist: number
  ): void {
    const spec = BOSS_SKILLS[chosen];
    e.bossAction = 'skill';
    e.bossState = 'windup';
    e.bossHitApplied = false;
    e.bossSkill = chosen;
    e.bossStateDuration = spec.windup;
    e.bossStateTimer = spec.windup;
    e.facing = Math.atan2(dx, dz);

    let tx = e.x;
    let tz = e.z;
    const tRad = spec.radius ?? cfg.telegraphRadius;

    if (chosen === 'targeted_blast' || chosen === 'orbital_barrage') {
      // Lock the blast/orbital circle directly under the hero's current spot
      tx = this.hero.x;
      tz = this.hero.z;
    } else if (chosen === 'charge_slam') {
      // Find farthest unobstructed landing spot along line toward hero
      const dirX = dx / (dist || 1);
      const dirZ = dz / (dist || 1);
      const desiredLunge = e.bossWarpChained
        ? Math.max(BOSS_CHARGE.minLunge + 1.5, dist + 1.6)
        : Math.max(BOSS_CHARGE.minLunge, dist + 0.55);
      const maxLunge = Math.min(BOSS_CHARGE.maxLunge, desiredLunge);
      let bestX = e.x;
      let bestZ = e.z;
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const frac = (s / steps) * maxLunge;
        const cx = e.x + dirX * frac;
        const cz = e.z + dirZ * frac;
        if (this.canMoveTo(cx, cz, 0.52)) {
          bestX = cx;
          bestZ = cz;
        } else {
          break;
        }
      }
      tx = bestX;
      tz = bestZ;
      e.bossChargeStartX = e.x;
      e.bossChargeStartZ = e.z;
    } else if (chosen === 'slam') {
      // Classic melee slam, centred a little in front of the boss
      const leadDist = Math.min(1.1, dist * 0.5);
      tx = e.x + (dx / (dist || 1)) * leadDist;
      tz = e.z + (dz / (dist || 1)) * leadDist;
    } else if (chosen === 'nova_ring') {
      // Lock the radial laser beam angles at windup start so charge lines match the burst
      e.bossNovaAngle = e.facing;
    } else if (chosen === 'warp_ambush') {
      // Phase 1 takeoff chant at boss's own position (still damageable)
      e.bossWarpPhase = undefined;
      e.bossWarpUntargetable = false;
    }
    // ranged_volley: compact ring beneath the boss; nova_ring: centred on the boss

    e.telegraphX = tx;
    e.telegraphZ = tz;
    e.telegraphRadius = tRad;
    const customWindup = this.updateBossWindupVfx(e, chosen, tx, tz, tRad, 0, e.bossNovaAngle ?? e.facing);
    if (e.telegraph) {
      e.telegraph.group.position.set(tx, 0, tz);
      e.telegraph.group.scale.setScalar(tRad);
      e.telegraph.fillDisk.scale.setScalar(0.12);
      e.telegraph.group.visible = !customWindup;
    }
    if (chosen === 'warp_ambush') {
      this.audio.playBossWarpCharge();
    } else if (chosen === 'ranged_volley') {
      this.audio.playMageCast();
    } else if (chosen === 'nova_ring') {
      this.audio.playBossLaserCharge();
    } else if (chosen === 'targeted_blast') {
      this.audio.playBossBlackHoleCharge();
    } else {
      this.audio.playBossTelegraph();
    }
    this.emitHud();
  },

  /**
   * Chase state, cooldown over: start the pre-rolled action type if it is possible right now, otherwise keep chasing
   * (docs/boss-spec.md section 5). A skill that cannot be cast falls back to a basic attack.
   */
  bossTryStartAction(this: EmbervaultEngine, e: EnemyEntity, cfg: BossConfig, dx: number, dz: number, dist: number, dt: number): void {
    const hasLOS = hasLineOfSight(this.dungeon, e.x, e.z, this.hero.x, this.hero.z, this.doorUnlocked, 0.35);
    const wantType = e.bossNextType ?? 'skill';

    const canBasic = (): boolean =>
      cfg.bossType === 'melee'
        ? dist <= BOSS_BASIC.melee.reach
        : dist <= BOSS_BASIC.caster.range && hasLOS;

    const findWarpTarget = (): Hero | null => {
      const maxWarpRange = e.bossAggroed ? BOSS_WARP.aggroMaxRange : BOSS_ENGAGE_RANGE;
      const candidates = this.heroes.filter((h) => {
        if (h.isDead || h.inTown) return false;
        const d = Math.hypot(h.x - e.x, h.z - e.z);
        return d > cfg.triggerRange && d <= maxWarpRange;
      });
      if (candidates.length === 0) return null;
      return candidates[Math.floor(Math.random() * candidates.length)];
    };

    const warpPick: { hero: Hero | null } = { hero: null };
    const skillRange = (s: BossSkillKind): number => {
      const spec = BOSS_SKILLS[s];
      return (spec.range ?? cfg.triggerRange) + (spec.rangeBonus ?? 0);
    };
    const canCastSkill = (s: BossSkillKind): boolean => {
      if (s === 'warp_ambush') {
        warpPick.hero = findWarpTarget();
        return warpPick.hero !== null;
      }
      if (dist > skillRange(s)) return false;
      if (BOSS_SKILLS[s].needsLos && !hasLOS) return false;
      return true;
    };

    const pickSkill = (): BossSkillKind | null => {
      const skills = cfg.skills;
      const idx = (e.bossSkillIndex ?? 0) % skills.length;
      for (let offset = 0; offset < skills.length; offset++) {
        const cand = skills[(idx + offset) % skills.length];
        if (canCastSkill(cand)) {
          e.bossSkillIndex = (idx + offset) % skills.length;
          return cand;
        }
      }
      return null;
    };

    let skill: BossSkillKind | null = null;
    let type: BossActionType | null = null;
    if (wantType === 'skill') {
      skill = pickSkill();
      if (skill) type = 'skill';
      else if (canBasic()) type = 'basic';
    } else if (canBasic()) {
      type = 'basic';
    } else if (cfg.bossType === 'melee') {
      // Melee boss kited out of basic reach: after a short chase timeout, switch to an in-range skill
      e.bossBasicChaseTimer = (e.bossBasicChaseTimer ?? 0) + dt;
      if (e.bossBasicChaseTimer >= BOSS_ACTION.meleeBasicChaseTimeout) {
        skill = pickSkill();
        if (skill) type = 'skill';
      }
    }
    if (!type) return; // keep chasing
    e.bossBasicChaseTimer = 0;

    if (e.bossLastType === type) e.bossStreak = (e.bossStreak ?? 0) + 1;
    else {
      e.bossLastType = type;
      e.bossStreak = 1;
    }
    e.bossNextType = this.bossRollNextType(e);
    e.bossWarpChained = false;

    if (type === 'basic') {
      e.bossAction = 'basic';
      e.bossState = 'windup';
      e.bossHitApplied = false;
      e.facing = Math.atan2(dx, dz);
      const basic = cfg.bossType === 'melee' ? BOSS_BASIC.melee : BOSS_BASIC.caster;
      const windupDur = basic.windup / this.bossBasicSpeedDiv(e);
      e.bossStateDuration = windupDur;
      e.bossStateTimer = windupDur;
      // No ground circle for a basic attack: radius 0 also tells teammates not to draw one
      e.telegraphX = e.x;
      e.telegraphZ = e.z;
      e.telegraphRadius = 0;
      if (e.telegraph) e.telegraph.group.visible = false;
      this.hideBossWindupVfx(e.id);
      this.emitHud();
      return;
    }

    const chosen = skill!;
    if (chosen === 'warp_ambush' && warpPick.hero) {
      const target = warpPick.hero;
      e.bossWarpTargetId = target.id;
      const wdx = target.x - e.x;
      const wdz = target.z - e.z;
      this.startBossSkillWindup(e, cfg, chosen, wdx, wdz, Math.hypot(wdx, wdz));
      return;
    }
    this.startBossSkillWindup(e, cfg, chosen, dx, dz, dist);
  },

  /** Check single-hit damage for active nova_ring laser beams + centre circle across all live heroes and pets. */
  checkBossNovaBeamHits(this: EmbervaultEngine, e: EnemyEntity): void {
    const active = e.bossNovaActiveBeams;
    if (!active) return;
    const { ox, oz, rad, beams, dmg, hitIds } = active;
    const halfW = BOSS_NOVA.beamHalfWidth;
    const label = this.getEnemyLabel(e);

    const pointHitsNova = (px: number, pz: number, targetR: number): boolean => {
      const rx = px - ox;
      const rz = pz - oz;
      if (Math.hypot(rx, rz) <= rad) return true;
      for (const b of beams) {
        const along = rx * b.dirX + rz * b.dirZ;
        if (along < 0 || along > b.length + targetR) continue;
        const lateral = Math.abs(rx * -b.dirZ + rz * b.dirX);
        if (lateral <= halfW + targetR) return true;
      }
      return false;
    };

    const firstCheck = !active.dodgedChecked;
    active.dodgedChecked = true;

    this.forEachLiveHero(() => {
      const key = `h:${this.hero.id}`;
      if (hitIds.has(key)) return;
      if (pointHitsNova(this.hero.x, this.hero.z, 0.34)) {
        hitIds.add(key);
        this.damageHero(dmg, ox, oz, label);
      } else if (firstCheck) {
        const d = Math.hypot(this.hero.x - ox, this.hero.z - oz);
        if (d <= rad + 3.4) {
          this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
        }
      }
    });

    for (const pet of this.pets.values()) {
      if (pet.hp <= 0) continue;
      const owner = this.heroById(pet.ownerId);
      if (!owner || owner.isDead || owner.inTown) continue;
      const key = `p:${pet.ownerId}`;
      if (hitIds.has(key)) continue;
      if (pointHitsNova(pet.x, pet.z, 0.36)) {
        hitIds.add(key);
        this.damagePet(pet, dmg, ox, oz);
      }
    }
  },

  /** Basic attack, melee boss: swing at the nearest hero (or pet) inside the reach, no ground telegraph. */
  bossMeleeBasicHit(this: EmbervaultEngine, e: EnemyEntity, cfg: BossConfig): void {
    const reach = BOSS_BASIC.melee.reach;
    const dmg = this.bossDamage(e, BOSS_BASIC.melee.damage);
    let bestHero: Hero | null = null;
    let bestD = Infinity;
    for (const h of this.heroes) {
      if (h.isDead || h.inTown) continue;
      const d = Math.hypot(h.x - e.x, h.z - e.z);
      if (d <= reach && d < bestD) {
        bestD = d;
        bestHero = h;
      }
    }
    let bestPet: PetEntity | null = null;
    let bestPetD = Infinity;
    for (const pet of this.pets.values()) {
      if (pet.hp <= 0) continue;
      const owner = this.heroById(pet.ownerId);
      if (!owner || owner.isDead || owner.inTown) continue;
      const d = Math.hypot(pet.x - e.x, pet.z - e.z);
      if (d <= reach && d < bestPetD) {
        bestPetD = d;
        bestPet = pet;
      }
    }
    this.audio.playHit(true);
    for (let i = 0; i < 10; i++) {
      const a = e.facing + (Math.random() - 0.5) * 1.6;
      this.spawnParticle(
        e.x + Math.sin(a) * 1.0,
        0.9,
        e.z + Math.cos(a) * 1.0,
        Math.sin(a) * (2 + Math.random() * 2),
        0.8 + Math.random(),
        Math.cos(a) * (2 + Math.random() * 2),
        cfg.telegraphColor,
        1.0,
        0.3,
        2
      );
    }
    // Nearest wins; a hero and a pet in range: whichever is closer
    if (bestHero && bestD <= bestPetD) {
      const prev = this.hero;
      this.setActor(bestHero);
      this.damageHero(dmg, e.x, e.z, this.getEnemyLabel(e));
      this.setActor(prev);
    } else if (bestPet) {
      this.damagePet(bestPet, dmg, e.x, e.z);
    }
  },

  /** Basic attack, caster / shooter boss: one projectile toward the target hero, needs a line of sight at the start. */
  bossCasterBasicShot(this: EmbervaultEngine, e: EnemyEntity, cfg: BossConfig): void {
    const kind: ProjectileKind = cfg.projectileKind ?? BOSS_BASIC.caster.defaultProjectile;
    const sdx = Math.sin(e.facing);
    const sdz = Math.cos(e.facing);
    this.audio.playMageCast();
    this.spawnProjectile(
      kind,
      e.x + sdx * 0.85,
      e.z + sdz * 0.85,
      sdx,
      sdz,
      1,
      this.getEnemyLabel(e),
      BOSS_BASIC.caster.projectileSpeed,
      this.bossDamage(e, BOSS_BASIC.caster.damage)
    );
  },

  updateBoss(this: EmbervaultEngine, e: EnemyEntity, dt: number, dx: number, dz: number, dist: number): void {
    if (!isFloorBoss(e.kind)) return;
    const cfg = BOSS_CONFIGS[e.kind];
    const state = e.bossState ?? 'chase';

    if (e.rig.auraRing) {
      e.rig.auraRing.rotation.z += dt * 0.9;
    }
    if (e.rig.coreMesh) {
      e.rig.coreMesh.rotation.y += dt * 2.4;
      if (e.kind === 'boss_leviathan_heart') {
        const beat = 1 + Math.sin(this.elapsed * 6.5) * 0.16;
        e.rig.coreMesh.scale.setScalar(beat);
      }
    }

    // nova_ring: active laser beam hit window (each hero/pet can take damage at most once)
    if (e.bossNovaActiveBeams) {
      e.bossNovaActiveBeams.timer -= dt;
      this.checkBossNovaBeamHits(e);
      if (e.bossNovaActiveBeams.timer <= 0) {
        e.bossNovaActiveBeams = undefined;
      }
    }

    // orbital_barrage: queued follow-up sky pillars (shots 2 & 3)
    if (e.bossOrbitalQueue && e.bossOrbitalQueue.length > 0) {
      const isTech = e.kind === 'boss_mothership_ai' || e.kind === 'boss_xeno_commander';
      for (let i = e.bossOrbitalQueue.length - 1; i >= 0; i--) {
        const s = e.bossOrbitalQueue[i];
        if (!s.spawnedTelegraph) {
          s.delay -= dt;
          if (s.delay <= 0) {
            // Lock onto a live hero's current position
            const liveHeroes = this.heroes.filter((h) => !h.isDead && !h.inTown);
            const pick = liveHeroes.length > 0 ? liveHeroes[Math.floor(Math.random() * liveHeroes.length)] : this.hero;
            s.x = pick.x;
            s.z = pick.z;
            s.spawnedTelegraph = true;
            this.audio.playBossTelegraph();
            this.spawnBossOrbitalTelegraphVfx(s.x, s.z, s.rad, s.windup, cfg.telegraphColor, isTech);
          }
          continue;
        }
        s.windup -= dt;
        if (s.windup <= 0) {
          e.bossOrbitalQueue.splice(i, 1);
          this.audio.playBossOrbitalStrike();
          this.forEachLiveHero(() => this.addScreenShake(0.42, 0.22));
          this.spawnBossOrbitalPillarVfx(s.x, s.z, s.rad, cfg.telegraphColor);
          const label = this.getEnemyLabel(e);
          this.forEachLiveHero(() => {
            const d = Math.hypot(this.hero.x - s.x, this.hero.z - s.z);
            if (d <= s.rad) {
              this.damageHero(s.dmg, s.x, s.z, label);
            } else if (d <= s.rad + 2.8) {
              this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
            }
          });
          this.damagePetsInRadius(s.x, s.z, s.rad, s.dmg);
        }
      }
    }

    // Wake boss once player comes within wake range, deals damage, or enters Boss Test Arena -> pursues indefinitely!
    if (!e.bossAggroed && (this.bossArenaMode || dist < BOSS_CHASE_WAKE_RANGE || e.hp < e.maxHp)) {
      e.bossAggroed = true;
    }

    let moveX = 0;
    let moveZ = 0;

    if (state === 'chase') {
      if (e.telegraph) e.telegraph.group.visible = false;
      this.hideBossWindupVfx(e.id);

      if ((e.bossAggroed || dist < BOSS_CHASE_WAKE_RANGE) && dist > 1.35) {
        const directLOS =
          dist < 3.0 || hasLineOfSight(this.dungeon, e.x, e.z, this.hero.x, this.hero.z, this.doorUnlocked, 0.35);
        let dirX = dx / (dist || 1);
        let dirZ = dz / (dist || 1);
        if (directLOS) {
          e.bossPath = undefined;
        } else {
          // Navigate cleanly around room corners/doorways when chasing an aggroed target out of LOS
          e.bossPathTimer = (e.bossPathTimer ?? 0) - dt;
          if (!e.bossPath || e.bossPath.length === 0 || e.bossPathTimer <= 0) {
            e.bossPathTimer = 0.45;
            const bg = worldToWalkableGrid(this.dungeon, e.x, e.z, this.doorUnlocked);
            const hg = worldToWalkableGrid(this.dungeon, this.hero.x, this.hero.z, this.doorUnlocked);
            e.bossPath = findGridPath(this.dungeon, bg.gx, bg.gz, hg.gx, hg.gz, this.doorUnlocked);
          }
          while (e.bossPath && e.bossPath.length > 0) {
            const wp = gridToWorld(e.bossPath[0].gx, e.bossPath[0].gz);
            const wdx = wp.x - e.x;
            const wdz = wp.z - e.z;
            const wd = Math.hypot(wdx, wdz);
            if (wd < 0.45) {
              e.bossPath.shift();
            } else {
              dirX = wdx / wd;
              dirZ = wdz / wd;
              break;
            }
          }
        }
        moveX = dirX * e.speed;
        moveZ = dirZ * e.speed;
        e.facing = Math.atan2(dirX, dirZ);
      }

      const engageRange = e.bossAggroed ? BOSS_WARP.aggroMaxRange : BOSS_ENGAGE_RANGE;
      if (e.attackCooldown <= 0 && dist < engageRange) {
        this.bossTryStartAction(e, cfg, dx, dz, dist, dt);
      }
    } else if (state === 'windup') {
      e.bossStateTimer = (e.bossStateTimer ?? 0) - dt;
      const dur = e.bossStateDuration || BOSS_SKILLS[e.bossSkill ?? 'slam'].windup;
      const progress = THREE.MathUtils.clamp(1 - (e.bossStateTimer ?? 0) / dur, 0, 1);
      const isBasic = e.bossAction === 'basic';
      const skill = e.bossSkill ?? 'slam';

      // Volley & Prism Cone: smoothly track the hero for the first part of the windup, then lock aim.
      // Basic attacks face the hero the whole windup (short and untelegraphed).
      if (
        isBasic ||
        (skill === 'ranged_volley' && progress < BOSS_VOLLEY.aimTrackFraction) ||
        (skill === 'prism_cone' && progress < BOSS_PRISM.aimTrackFraction)
      ) {
        e.facing = Math.atan2(dx, dz);
      }

      // Smoothly fill ground danger circle so player reads exact dodge timing (skills only)
      if (!isBasic) {
        const customWindup = this.updateBossWindupVfx(
          e,
          skill,
          e.telegraphX ?? e.x,
          e.telegraphZ ?? e.z,
          e.telegraphRadius ?? cfg.telegraphRadius,
          progress,
          e.bossNovaAngle ?? e.facing
        );
        if (e.telegraph) {
          if (customWindup) {
            e.telegraph.group.visible = false;
          } else {
            e.telegraph.fillDisk.scale.setScalar(0.12 + progress * 0.88);
            e.telegraph.fillMat.opacity = 0.2 + progress * 0.34;
            e.telegraph.ringMat.opacity = 0.72 + Math.sin(this.elapsed * 26) * 0.24;
            e.telegraph.group.visible = true;
          }
        }
      }

      if ((e.bossStateTimer ?? 0) <= 0) {
        e.bossState = 'strike';
        const strikeDur = isBasic
          ? (cfg.bossType === 'melee' ? BOSS_BASIC.melee.strike : BOSS_BASIC.caster.strike)
          : BOSS_SKILLS[skill].strike;
        e.bossStateDuration = strikeDur;
        e.bossStateTimer = strikeDur;
        e.bossHitApplied = false;
        if (!isBasic && skill === 'charge_slam') {
          e.bossChargeHitIds = new Set<string>();
          this.spawnBossChargeDashVfx(
            e.bossChargeStartX ?? e.x,
            e.bossChargeStartZ ?? e.z,
            e.telegraphX ?? e.x,
            e.telegraphZ ?? e.z,
            strikeDur,
            cfg.telegraphColor
          );
        } else if (!isBasic && skill === 'warp_ambush') {
          // Phase 2: launch vertically & fade out (untargetable, no collision, shadow hidden immediately on frame 0)
          e.bossWarpPhase = 'ascend';
          e.bossWarpUntargetable = true;
          e.vx = 0;
          e.vz = 0;
          if (e.telegraph) e.telegraph.group.visible = false;
          this.hideBossWindupVfx(e.id);
          this.setBossWarpVisual(e, 0.35, 1, true);
          this.audio.playBossWarpVanish();
          const slowDiv = (e.slowTimer ?? 0) > 0 ? Math.max(0.5, 1 - (e.slowPct ?? 0)) : 1;
          this.spawnBossWarpTakeoffVfx(e.x, e.z, BOSS_WARP.ascendDur / slowDiv);
        }
      }
    } else if (state === 'strike') {
      e.bossStateTimer = (e.bossStateTimer ?? 0) - dt;
      const isBasic = e.bossAction === 'basic';
      const skill = e.bossSkill ?? 'slam';
      const tx = e.telegraphX ?? e.x;
      const tz = e.telegraphZ ?? e.z;
      const rad = e.telegraphRadius ?? cfg.telegraphRadius;

      if (isBasic) {
        if (!e.bossHitApplied) {
          e.bossHitApplied = true;
          if (cfg.bossType === 'melee') this.bossMeleeBasicHit(e, cfg);
          else this.bossCasterBasicShot(e, cfg);
        }
      } else if (skill === 'warp_ambush') {
        const totalDur = e.bossStateDuration || BOSS_WARP.ascendDur + BOSS_WARP.descendDur;
        const elapsedStrike = Math.max(0, totalDur - (e.bossStateTimer ?? 0));
        e.vx = 0;
        e.vz = 0;

        if (elapsedStrike < BOSS_WARP.ascendDur) {
          // Phase 2: rapid vertical launch & fade-out continuing smoothly from Phase 1 levitation height (0.35)
          const pAsc = THREE.MathUtils.clamp(elapsedStrike / BOSS_WARP.ascendDur, 0, 1);
          this.setBossWarpVisual(e, 0.35 + pAsc * pAsc * BOSS_WARP.liftHeight, 1 - pAsc, true);
        } else {
          // Exact moment opacity reaches 0: lock onto chosen player's CURRENT position & descend!
          if (!e.bossHitApplied) {
            e.bossHitApplied = true;
            e.bossWarpPhase = 'descend';
            const chosenHero = e.bossWarpTargetId ? this.heroById(e.bossWarpTargetId) : null;
            const targetHero =
              chosenHero && !chosenHero.isDead && !chosenHero.inTown
                ? chosenHero
                : this.nearestLiveHero(e.x, e.z) ?? this.hero;
            const land = this.findWarpLandingSpot(targetHero.x, targetHero.z, e.x, e.z);
            e.x = land.x;
            e.z = land.z;
            e.telegraphX = land.x;
            e.telegraphZ = land.z;
            e.telegraphRadius = BOSS_WARP.telegraphRadius;
            e.facing = Math.atan2(targetHero.x - land.x, targetHero.z - land.z);
            e.rig.root.position.set(e.x, 0, e.z);
            this.audio.playBossWarpArrive();
            const slowDiv = (e.slowTimer ?? 0) > 0 ? Math.max(0.5, 1 - (e.slowPct ?? 0)) : 1;
            this.spawnBossWarpArriveVfx(land.x, land.z, BOSS_WARP.descendDur / slowDiv);
          }
          // Phase 3: vertical drop & fade-in (opacity 0 -> 1)
          const pDesc = THREE.MathUtils.clamp(
            (elapsedStrike - BOSS_WARP.ascendDur) / BOSS_WARP.descendDur,
            0,
            1
          );
          const easeOut = 1 - Math.pow(1 - pDesc, 2.2);
          this.setBossWarpVisual(e, (1 - easeOut) * BOSS_WARP.liftHeight, pDesc, pDesc < 0.85);
        }

        // Phase 4: touchdown -> seamless follow-up slam / charge_slam (NO recover, NO cooldown!)
        if ((e.bossStateTimer ?? 0) <= 0) {
          this.resetBossWarpVisual(e);
          e.bossWarpPhase = undefined;
          e.bossWarpUntargetable = false;
          e.bossSkillIndex = ((e.bossSkillIndex ?? 0) + 1) % cfg.skills.length;

          const chosenHero = e.bossWarpTargetId ? this.heroById(e.bossWarpTargetId) : null;
          const followHero =
            chosenHero && !chosenHero.isDead && !chosenHero.inTown
              ? chosenHero
              : this.nearestLiveHero(e.x, e.z) ?? this.hero;
          const fdx = followHero.x - e.x;
          const fdz = followHero.z - e.z;
          const fDist = Math.hypot(fdx, fdz);
          const followLOS = hasLineOfSight(
            this.dungeon,
            e.x,
            e.z,
            followHero.x,
            followHero.z,
            this.doorUnlocked,
            0.35
          );
          const followSkill: BossSkillKind = !followLOS
            ? 'slam'
            : fDist > cfg.triggerRange
            ? 'charge_slam'
            : Math.random() < 0.5
            ? 'charge_slam'
            : 'slam';
          e.bossWarpChained = true;
          this.startBossSkillWindup(e, cfg, followSkill, fdx, fdz, fDist);
          e.rig.root.position.set(e.x, 0, e.z);
          e.rig.body.rotation.y = e.facing;
          return;
        }
      } else if (skill === 'charge_slam') {
        // Dash rapidly from start to locked landing point, damaging targets along the corridor AND at landing (once per target!)
        const dur = e.bossStateDuration || BOSS_SKILLS.charge_slam.strike;
        const p = THREE.MathUtils.clamp(1 - (e.bossStateTimer ?? 0) / dur, 0, 1);
        const sx = e.bossChargeStartX ?? e.x;
        const sz = e.bossChargeStartZ ?? e.z;
        const prevX = e.x;
        const prevZ = e.z;
        const nx = THREE.MathUtils.lerp(sx, tx, p);
        const nz = THREE.MathUtils.lerp(sz, tz, p);
        if (this.canMoveTo(nx, nz, 0.48)) {
          e.x = nx;
          e.z = nz;
        }
        const dmg = this.bossDamage(e, BOSS_SKILLS.charge_slam.damage);
        const hitIds = (e.bossChargeHitIds = e.bossChargeHitIds ?? new Set<string>());
        const label = this.getEnemyLabel(e);

        // Swept corridor hit check along (prevX, prevZ) -> (e.x, e.z) so standing in the charge path deals damage!
        const segX = e.x - prevX;
        const segZ = e.z - prevZ;
        const segLenSq = segX * segX + segZ * segZ;
        const distToStep = (px: number, pz: number): number => {
          if (segLenSq < 1e-6) return Math.hypot(px - e.x, pz - e.z);
          const proj = THREE.MathUtils.clamp(((px - prevX) * segX + (pz - prevZ) * segZ) / segLenSq, 0, 1);
          return Math.hypot(px - (prevX + segX * proj), pz - (prevZ + segZ * proj));
        };
        const corrHitRad = BOSS_CHARGE.corridorHalfWidth + 0.25;
        this.forEachLiveHero(() => {
          const key = `h:${this.hero.id}`;
          if (hitIds.has(key)) return;
          if (distToStep(this.hero.x, this.hero.z) <= corrHitRad) {
            hitIds.add(key);
            this.damageHero(dmg, e.x, e.z, label);
          }
        });
        for (const pet of this.pets.values()) {
          if (pet.hp <= 0) continue;
          const owner = this.heroById(pet.ownerId);
          if (!owner || owner.isDead || owner.inTown) continue;
          const key = `p:${pet.ownerId}`;
          if (hitIds.has(key)) continue;
          if (distToStep(pet.x, pet.z) <= corrHitRad + 0.08) {
            hitIds.add(key);
            this.damagePet(pet, dmg, e.x, e.z);
          }
        }

        if (Math.random() < dt * 45) {
          this.spawnParticle(
            e.x,
            0.55,
            e.z,
            (Math.random() - 0.5) * 1.4,
            0.7,
            (Math.random() - 0.5) * 1.4,
            cfg.telegraphColor,
            1.2,
            0.35,
            2.0
          );
        }

        if (p >= BOSS_CHARGE.impactProgress && !e.bossHitApplied) {
          e.bossHitApplied = true;
          if (e.telegraph) e.telegraph.group.visible = false;
          this.hideBossWindupVfx(e.id);
          this.audio.playBossChargeImpact();
          this.forEachLiveHero(() => this.addScreenShake(0.66, 0.34));
          this.spawnBossChargeImpactVfx(
            e.bossChargeStartX ?? e.x,
            e.bossChargeStartZ ?? e.z,
            e.x,
            e.z,
            rad,
            cfg.telegraphColor
          );

          this.forEachLiveHero(() => {
            const key = `h:${this.hero.id}`;
            if (hitIds.has(key)) return;
            const heroDistToImpact = Math.hypot(this.hero.x - e.x, this.hero.z - e.z);
            if (heroDistToImpact <= rad) {
              hitIds.add(key);
              this.damageHero(dmg, e.x, e.z, label);
            } else if (heroDistToImpact <= rad + 3.2) {
              this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
            }
          });
          for (const pet of Array.from(this.pets.values())) {
            if (pet.hp <= 0) continue;
            const owner = this.heroById(pet.ownerId);
            if (!owner || owner.isDead || owner.inTown) continue;
            const key = `p:${pet.ownerId}`;
            if (hitIds.has(key)) continue;
            if (Math.hypot(pet.x - e.x, pet.z - e.z) <= rad) {
              hitIds.add(key);
              this.damagePet(pet, dmg, e.x, e.z);
            }
          }
        }
      } else if (!e.bossHitApplied) {
        e.bossHitApplied = true;
        if (e.telegraph) e.telegraph.group.visible = false;
        this.hideBossWindupVfx(e.id);

        if (skill === 'ranged_volley') {
          // 2-stage triple railgun barrage:
          // Stage 1: instant full-length accelerator lances (35%, single-hit per hero/pet across all 3 lanes)
          // Stage 2: fast heavy railgun shells (75%, total 110% if both hit)
          const projKind: ProjectileKind = cfg.projectileKind ?? 'bio_orb';
          const baseAngle = e.facing;
          const projSpeed = projKind === 'bone_dart' ? BOSS_VOLLEY.boneDartSpeed : BOSS_VOLLEY.projectileSpeed;
          const beamDmg = this.bossDamage(e, BOSS_VOLLEY.beamDamage);
          const projDmg = this.bossDamage(e, BOSS_SKILLS.ranged_volley.damage);
          const label = this.getEnemyLabel(e);

          this.audio.playBossVolley();
          this.forEachLiveHero(() => this.addScreenShake(0.46, 0.24));
          this.spawnBossVolleyVfx(e.x, e.z, baseAngle, cfg.telegraphColor);

          const lanes: Array<{ dx: number; dz: number; dist: number }> = [];
          for (const offset of BOSS_VOLLEY.spread) {
            const a = baseAngle + offset;
            const sdx = Math.sin(a);
            const sdz = Math.cos(a);
            const hit = this.raycastBossBeam(e.x, e.z, sdx, sdz, BOSS_VOLLEY.beamMaxRange);
            lanes.push({ dx: sdx, dz: sdz, dist: hit.dist });
            this.spawnProjectile(
              projKind,
              e.x + sdx * 0.95,
              e.z + sdz * 0.95,
              sdx,
              sdz,
              1,
              label,
              projSpeed,
              projDmg,
              1.6
            );
          }

          // Stage 1 hit check along the 3 accelerator railgun lances (deduped so point-blank never triple-hits)
          const pointHitsLane = (px: number, pz: number, targetR: number): boolean => {
            const rx = px - e.x;
            const rz = pz - e.z;
            for (const lane of lanes) {
              const along = rx * lane.dx + rz * lane.dz;
              if (along < 0.1 || along > lane.dist + targetR) continue;
              const lateral = Math.abs(rx * -lane.dz + rz * lane.dx);
              if (lateral <= BOSS_VOLLEY.beamHalfWidth + targetR) return true;
            }
            return false;
          };

          const beamHitIds = new Set<string>();
          this.forEachLiveHero(() => {
            const key = `h:${this.hero.id}`;
            if (beamHitIds.has(key)) return;
            if (pointHitsLane(this.hero.x, this.hero.z, 0.3)) {
              beamHitIds.add(key);
              // invulnOverride = 0 so Stage 2 heavy railgun shell landing right after is not swallowed by i-frames
              this.damageHero(beamDmg, e.x, e.z, label, undefined, 0);
            }
          });
          for (const pet of this.pets.values()) {
            if (pet.hp <= 0) continue;
            const owner = this.heroById(pet.ownerId);
            if (!owner || owner.isDead || owner.inTown) continue;
            const key = `p:${pet.ownerId}`;
            if (beamHitIds.has(key)) continue;
            if (pointHitsLane(pet.x, pet.z, 0.32)) {
              beamHitIds.add(key);
              this.damagePet(pet, beamDmg, e.x, e.z, 0);
            }
          }

          for (let i = 0; i < 14; i++) {
            const a = baseAngle + (Math.random() - 0.5) * 0.9;
            this.spawnParticle(
              e.x + Math.sin(a) * 0.7,
              0.9,
              e.z + Math.cos(a) * 0.7,
              Math.sin(a) * (2.5 + Math.random() * 2.5),
              1.1,
              Math.cos(a) * (2.5 + Math.random() * 2.5),
              cfg.telegraphColor,
              1.1,
              0.4,
              2.5
            );
          }
        } else if (skill === 'nova_ring') {
          // Bright-white radial laser beams (Omega Core AI uses sci-fi blue; Archlich uses arcane violet)
          const dmg = this.bossDamage(e, BOSS_SKILLS.nova_ring.damage);
          const baseAng = e.bossNovaAngle ?? e.facing;
          const beams = this.computeNovaBeams(tx, tz, baseAng);
          const laserColor = e.kind === 'boss_mothership_ai' ? 0x38c8ff : cfg.telegraphColor;
          this.audio.playBossLaser();
          this.forEachLiveHero(() => this.addScreenShake(0.55, 0.34));
          this.spawnBossNovaLaserVfx(tx, tz, rad, beams, laserColor);

          e.bossNovaActiveBeams = {
            ox: tx,
            oz: tz,
            rad,
            beams,
            timer: BOSS_NOVA.activeHitWindow,
            dmg,
            hitIds: new Set<string>(),
          };
          this.checkBossNovaBeamHits(e);
        } else if (skill === 'prism_cone') {
          // 70-degree stained-glass crystal/bone/plasma fan eruption & shatter
          const dmg = this.bossDamage(e, BOSS_SKILLS.prism_cone.damage);
          const baseAng = e.facing;
          const coneRange = BOSS_PRISM.range;
          const halfAng = BOSS_PRISM.halfAngle;
          this.audio.playBossPrismShatter();
          this.forEachLiveHero(() => this.addScreenShake(0.48, 0.26));
          this.spawnBossPrismConeVfx(e.x, e.z, baseAng, coneRange, halfAng, cfg.telegraphColor, e.kind);

          const inCone = (px: number, pz: number): boolean => {
            const rx = px - e.x;
            const rz = pz - e.z;
            const d = Math.hypot(rx, rz);
            if (d > coneRange + 0.25) return false;
            if (d < 0.5) return true;
            let diff = Math.atan2(rx, rz) - baseAng;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            return Math.abs(diff) <= halfAng + 0.06;
          };

          const label = this.getEnemyLabel(e);
          this.forEachLiveHero(() => {
            if (inCone(this.hero.x, this.hero.z)) {
              this.damageHero(dmg, e.x, e.z, label);
            } else if (Math.hypot(this.hero.x - e.x, this.hero.z - e.z) <= coneRange + 2.8) {
              this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
            }
          });
          for (const pet of this.pets.values()) {
            if (pet.hp <= 0) continue;
            const owner = this.heroById(pet.ownerId);
            if (!owner || owner.isDead || owner.inTown) continue;
            if (inCone(pet.x, pet.z)) this.damagePet(pet, dmg, e.x, e.z);
          }
        } else if (skill === 'orbital_barrage') {
          // 3 sequential sky-to-ground orbital energy pillars (shot 1 now, shots 2 & 3 queued)
          const dmg = this.bossDamage(e, BOSS_SKILLS.orbital_barrage.damage);
          this.audio.playBossOrbitalStrike();
          this.forEachLiveHero(() => this.addScreenShake(0.44, 0.24));
          this.spawnBossOrbitalPillarVfx(tx, tz, rad, cfg.telegraphColor);

          const label = this.getEnemyLabel(e);
          this.forEachLiveHero(() => {
            const d = Math.hypot(this.hero.x - tx, this.hero.z - tz);
            if (d <= rad) {
              this.damageHero(dmg, tx, tz, label);
            } else if (d <= rad + 2.8) {
              this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
            }
          });
          this.damagePetsInRadius(tx, tz, rad, dmg);

          e.bossOrbitalQueue = e.bossOrbitalQueue ?? [];
          for (let q = 1; q < BOSS_ORBITAL.shots; q++) {
            e.bossOrbitalQueue.push({
              x: tx,
              z: tz,
              delay: q * BOSS_ORBITAL.shotInterval,
              windup: BOSS_ORBITAL.windup,
              spawnedTelegraph: false,
              dmg,
              rad: BOSS_ORBITAL.radius,
            });
          }
        } else if (skill === 'targeted_blast') {
          // Void Black Hole detonation at locked target position
          const dmg = this.bossDamage(e, BOSS_SKILLS.targeted_blast.damage);
          this.audio.playBossBlackHole();
          this.forEachLiveHero(() => this.addScreenShake(0.74, 0.38));
          this.spawnBossBlackHoleVfx(tx, tz, rad, cfg.telegraphColor);

          this.forEachLiveHero(() => {
            const heroDistToImpact = Math.hypot(this.hero.x - tx, this.hero.z - tz);
            if (heroDistToImpact <= rad) {
              this.damageHero(dmg, tx, tz, this.getEnemyLabel(e));
            } else if (heroDistToImpact <= rad + 3.4) {
              this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
            }
          });
          this.damagePetsInRadius(tx, tz, rad, dmg);
        } else {
          // 'slam' heavy floor smash with themed palette & full-screen shake
          const dmg = this.bossDamage(e, BOSS_SKILLS[skill].damage);
          this.audio.playBossSlam();
          this.forEachLiveHero(() => this.addScreenShake(0.78, 0.4));
          this.spawnBossSlamVfx(tx, tz, rad, cfg.telegraphColor, e.kind as FloorBossKind);

          this.forEachLiveHero(() => {
            const heroDistToImpact = Math.hypot(this.hero.x - tx, this.hero.z - tz);
            if (heroDistToImpact <= rad) {
              this.damageHero(dmg, tx, tz, this.getEnemyLabel(e));
            } else if (heroDistToImpact <= rad + 3.4) {
              this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
            }
          });
          this.damagePetsInRadius(tx, tz, rad, dmg);
        }
      }

      if ((e.bossStateTimer ?? 0) <= 0) {
        // Stiffness: the boss stands still for BOSS_RECOVER (the cooldown follows in the chase state)
        const recoverDur = BOSS_RECOVER / this.bossBasicSpeedDiv(e);
        e.bossState = 'recover';
        e.bossStateDuration = recoverDur;
        e.bossStateTimer = recoverDur;
        if (!isBasic) {
          if (e.bossWarpChained) e.bossWarpChained = false;
          else e.bossSkillIndex = ((e.bossSkillIndex ?? 0) + 1) % cfg.skills.length;
        }
        this.emitHud();
      }
    } else if (state === 'recover') {
      e.bossStateTimer = (e.bossStateTimer ?? 0) - dt;
      if ((e.bossStateTimer ?? 0) <= 0) {
        e.bossState = 'chase';
        e.attackCooldown = BOSS_COOLDOWN / this.bossBasicSpeedDiv(e);
        this.emitHud();
      }
    }

    const nextPos = this.moveWithSlide(
      e.x,
      e.z,
      (moveX + e.vx) * dt,
      (moveZ + e.vz) * dt,
      0.52
    );
    e.x = nextPos.x;
    e.z = nextPos.z;
    e.vx *= Math.exp(-11 * dt);
    e.vz *= Math.exp(-11 * dt);

    // Boss Procedural 3D Animation (Distinct Windup -> Slam -> Recover silhouette!)
    e.rig.root.position.set(e.x, 0, e.z);
    e.rig.body.rotation.y = e.facing;
    e.hopPhase += dt * 5.2;

    const hoverY =
      e.kind === 'boss_lich' ||
      e.kind === 'boss_abyssal_brain' ||
      e.kind === 'boss_mothership_ai'
        ? 0.16 + Math.sin(this.elapsed * 3.2) * 0.1
        : 0;

    const isCasterBasic = e.bossAction === 'basic' && cfg.bossType === 'caster';
    const isWarp = e.bossAction !== 'basic' && e.bossSkill === 'warp_ambush';

    if (e.bossState === 'windup') {
      const p = THREE.MathUtils.clamp(
        1 - (e.bossStateTimer ?? 0) / (e.bossStateDuration || 1),
        0,
        1
      );
      if (isWarp) {
        // Levitating spatial-chant pose while the 5 royal-blue rings lock around the boss
        e.rig.body.position.y = hoverY + p * 0.35;
        e.rig.body.rotation.x = -p * 0.14;
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = -p * 1.45;
        if (e.rig.leftArm) e.rig.leftArm.rotation.x = -p * 1.45;
      } else if (isCasterBasic) {
        // Poised floating cast (no backward recoil that looks like being hit)
        e.rig.body.position.y = hoverY + p * 0.08;
        e.rig.body.rotation.x = THREE.MathUtils.damp(e.rig.body.rotation.x, 0, 12, dt);
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = -p * 1.15;
        if (e.rig.leftArm) e.rig.leftArm.rotation.x = -p * 0.75;
      } else {
        // Dramatically raise weapon/arms high overhead & lean back
        e.rig.body.position.y = hoverY + p * 0.22;
        e.rig.body.rotation.x = -p * 0.22;
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = -p * 2.45;
        if (e.rig.leftArm) {
          e.rig.leftArm.rotation.x = e.kind === 'boss_juggernaut' ? -p * 0.8 : -p * 2.35;
        }
      }
    } else if (e.bossState === 'strike') {
      if (isWarp) {
        // Preserve vertical liftY driven by setBossWarpVisual; keep upright dramatic warp silhouette
        e.rig.body.rotation.x = 0;
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = -0.45;
        if (e.rig.leftArm) e.rig.leftArm.rotation.x = -0.45;
      } else if (isCasterBasic) {
        // Crisp forward staff cast while staying upright
        e.rig.body.position.y = hoverY + 0.04;
        e.rig.body.rotation.x = 0.06;
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = -1.55;
        if (e.rig.leftArm) e.rig.leftArm.rotation.x = -0.9;
      } else {
        // Violent downward slam or forward lunge!
        e.rig.body.position.y = hoverY - 0.14;
        e.rig.body.rotation.x = e.bossAction !== 'basic' && e.bossSkill === 'charge_slam' ? 0.42 : 0.34;
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = 1.05;
        if (e.rig.leftArm) {
          e.rig.leftArm.rotation.x = e.kind === 'boss_juggernaut' ? 0.3 : 0.95;
        }
      }
    } else if (e.bossState === 'recover') {
      if (isCasterBasic) {
        // Smooth upright settle after basic spell cast
        e.rig.body.position.y = hoverY;
        e.rig.body.rotation.x = THREE.MathUtils.damp(e.rig.body.rotation.x, 0.03, 10, dt);
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = THREE.MathUtils.damp(e.rig.weaponArm.rotation.x, -0.45, 10, dt);
        if (e.rig.leftArm) e.rig.leftArm.rotation.x = THREE.MathUtils.damp(e.rig.leftArm.rotation.x, -0.25, 10, dt);
      } else {
        // Hunched / catching breath — clear visual cue for player to counterattack!
        e.rig.body.position.y = hoverY - 0.08 + Math.sin(this.elapsed * 6) * 0.03;
        e.rig.body.rotation.x = 0.22;
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = 0.65;
        if (e.rig.leftArm) e.rig.leftArm.rotation.x = 0.45;
      }
    } else {
      const walkSwing = dist < 12.0 && dist > 1.35 ? Math.sin(e.hopPhase) * 0.42 : 0;
      e.rig.body.position.y = hoverY + Math.abs(walkSwing) * 0.08;
      e.rig.body.rotation.x = THREE.MathUtils.damp(e.rig.body.rotation.x, 0, 10, dt);
      if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = walkSwing;
      if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -walkSwing;
      if (e.rig.weaponArm) {
        e.rig.weaponArm.rotation.x = THREE.MathUtils.damp(
          e.rig.weaponArm.rotation.x,
          -walkSwing * 0.35,
          10,
          dt
        );
      }
      if (e.rig.leftArm) {
        e.rig.leftArm.rotation.x = THREE.MathUtils.damp(
          e.rig.leftArm.rotation.x,
          walkSwing * 0.35,
          10,
          dt
        );
      }
    }

    // Flash white on hit, royal-blue during warp_ambush, or pulse warning color during windup
    for (const m of e.rig.flashMaterials) {
      if (e.hitFlash > 0) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.85;
      } else if (isWarp && (e.bossState === 'windup' || e.bossState === 'strike')) {
        m.emissive.setHex(BOSS_WARP.color);
        m.emissiveIntensity = 0.42 + Math.sin(this.elapsed * 26) * 0.2;
      } else if (e.bossState === 'windup') {
        m.emissive.setHex(cfg.telegraphColor);
        m.emissiveIntensity = isCasterBasic ? 0.16 : 0.25 + Math.sin(this.elapsed * 22) * 0.18;
      } else if (e.bossEnraged) {
        m.emissive.setHex(BOSS_ENRAGE.color);
        m.emissiveIntensity = 0.3 + Math.sin(this.elapsed * 6 + e.id) * 0.12;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  },

  spawnProjectile(
    this: EmbervaultEngine,
    kind: ProjectileKind,
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    damageMult = 1,
    sourceLabel?: string,
    customSpeed?: number,
    customDamage?: number,
    scaleMult = 1
  ): void {
    const isBossHeavy = scaleMult >= 1.8;
    const mesh = createProjectileMesh(kind, isBossHeavy);
    if (isBossHeavy) mesh.scale.setScalar(1.08);
    else if (scaleMult !== 1) mesh.scale.setScalar(scaleMult);
    const isFastShot =
      kind === 'arrow' ||
      kind === 'crystal_shard' ||
      kind === 'bone_dart' ||
      kind === 'plasma_bolt';
    const speed = customSpeed ?? (isFastShot ? 10.2 : 7.4);
    mesh.position.set(x, 0.85, z);
    mesh.rotation.y = Math.atan2(dirX, dirZ);
    this.dynamicGroup.add(mesh);

    this.projectiles.push({
      kind,
      mesh,
      x,
      z,
      vx: dirX * speed,
      vz: dirZ * speed,
      damage: customDamage ?? (isFastShot ? 4 : 5) * this.getDepthDamageScale() * damageMult,
      sourceLabel: sourceLabel ?? (isFastShot ? '遠程射手' : '遠程術士'),
      life: 0,
      maxLife: 2.8,
      isBossHeavy,
    });
  },

  removeProjectileAt(this: EmbervaultEngine, idx: number): void {
    const p = this.projectiles[idx];
    this.dynamicGroup.remove(p.mesh);
    p.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.projectiles.splice(idx, 1);
  },

  updateProjectiles(this: EmbervaultEngine, dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.removeProjectileAt(i);
        continue;
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, 0.85, p.z);
      const isOrb =
        p.kind === 'mage_orb' ||
        p.kind === 'spore_orb' ||
        p.kind === 'bio_orb' ||
        p.kind === 'ion_orb';
      if (p.isBossHeavy) {
        const ringA = p.mesh.userData.heavyRingA as THREE.Mesh | undefined;
        const ringB = p.mesh.userData.heavyRingB as THREE.Mesh | undefined;
        if (ringA) ringA.rotation.z += dt * 14;
        if (ringB) ringB.rotation.z -= dt * 18;
      } else if (isOrb) {
        p.mesh.rotation.y += dt * 7;
        p.mesh.rotation.x += dt * 4;
      }

      const trailCol =
        p.kind === 'crystal_shard'
          ? 0x62f5ff
          : p.kind === 'spore_orb'
          ? Math.random() < 0.5
            ? 0x66f59a
            : 0xc2ff78
          : p.kind === 'bone_dart'
          ? 0xffc84d
          : p.kind === 'bio_orb'
          ? Math.random() < 0.5
            ? 0x2ee6b8
            : 0xc6ff66
          : p.kind === 'plasma_bolt'
          ? 0x4dff88
          : p.kind === 'ion_orb'
          ? Math.random() < 0.5
            ? 0xff5ce6
            : 0x6ef2ff
          : p.kind === 'mage_orb'
          ? Math.random() < 0.5
            ? 0x6ef2ff
            : 0xb866ff
          : 0xffe484;

      // Subtle flight trail sparks (heavy Boss railgun shells emit intense blazing plasma trails!)
      if (p.isBossHeavy) {
        if (!this.isSoftwareGl && Math.random() < dt * 58) {
          this.spawnParticle(
            p.x + (Math.random() - 0.5) * 0.28,
            0.85 + (Math.random() - 0.5) * 0.24,
            p.z + (Math.random() - 0.5) * 0.28,
            -p.vx * 0.14 + (Math.random() - 0.5) * 1.2,
            (Math.random() - 0.5) * 0.9,
            -p.vz * 0.14 + (Math.random() - 0.5) * 1.2,
            Math.random() < 0.4 ? 0xffffff : trailCol,
            0.95,
            0.3,
            0
          );
        }
      } else if (Math.random() < dt * (isOrb ? 28 : 16)) {
        this.spawnParticle(
          p.x,
          0.85,
          p.z,
          (Math.random() - 0.5) * 0.5,
          0.25,
          (Math.random() - 0.5) * 0.5,
          trailCol,
          isOrb ? 0.65 : 0.45,
          0.24,
          0
        );
      }

      // Wall, closed-door, or stone-pillar impact check
      const g = worldToGrid(p.x, p.z);
      const tile = this.dungeon.tiles[g.gz]?.[g.gx] ?? 0;
      let hitSolid = tile === 0 || tile === 2 || (tile === 3 && !this.doorUnlocked);
      if (!hitSolid && tile === 5) {
        const px = g.gx * TILE_SIZE;
        const pz = g.gz * TILE_SIZE;
        if (Math.hypot(p.x - px, p.z - pz) < 0.58) hitSolid = true;
      }

      if (hitSolid) {
        if (p.isBossHeavy) {
          this.spawnBossProjectileImpactVfx(p.x, p.z, trailCol);
        } else {
          for (let k = 0; k < 6; k++) {
            this.spawnParticle(
              p.x,
              0.85,
              p.z,
              (Math.random() - 0.5) * 3.8,
              1.2 + Math.random() * 1.5,
              (Math.random() - 0.5) * 3.8,
              trailCol,
              0.72,
              0.3,
              5
            );
          }
        }
        this.removeProjectileAt(i);
        continue;
      }

      // Pet collision (pets can body-block enemy projectiles)
      let hitPet: PetEntity | null = null;
      for (const pet of this.pets.values()) {
        if (pet.hp <= 0) continue;
        const owner = this.heroById(pet.ownerId);
        if (!owner || owner.isDead || owner.inTown) continue;
        if (Math.hypot(p.x - pet.x, p.z - pet.z) < (p.isBossHeavy ? 0.78 : 0.62)) {
          hitPet = pet;
          break;
        }
      }
      if (hitPet) {
        this.damagePet(hitPet, p.damage, p.x - p.vx * 0.05, p.z - p.vz * 0.05);
        if (p.isBossHeavy) {
          this.spawnBossProjectileImpactVfx(p.x, p.z, trailCol);
        } else {
          for (let k = 0; k < 6; k++) {
            this.spawnParticle(
              p.x,
              0.85,
              p.z,
              (Math.random() - 0.5) * 3.8,
              1.2 + Math.random() * 1.4,
              (Math.random() - 0.5) * 3.8,
              trailCol,
              0.72,
              0.28,
              4
            );
          }
        }
        this.removeProjectileAt(i);
        continue;
      }

      // Hero collision (any standing hero; heroes can dash through projectiles!)
      const struck = this.heroes.find(
        (h) => !h.isDead && !h.inTown && h.dashTimer <= 0 && Math.hypot(p.x - h.x, p.z - h.z) < (p.isBossHeavy ? 0.72 : 0.58)
      );
      if (struck) {
        this.setActor(struck);
        this.damageHero(p.damage, p.x - p.vx * 0.05, p.z - p.vz * 0.05, p.sourceLabel, undefined, undefined, p.crit);
        this.setActor(this.localHero);
        if (p.isBossHeavy) {
          this.spawnBossProjectileImpactVfx(p.x, p.z, trailCol);
        } else {
          for (let k = 0; k < 8; k++) {
            this.spawnParticle(
              p.x,
              0.9,
              p.z,
              (Math.random() - 0.5) * 4.2,
              1.4 + Math.random() * 1.6,
              (Math.random() - 0.5) * 4.2,
              trailCol,
              0.82,
              0.32,
              4
            );
          }
        }
        this.removeProjectileAt(i);
      }
    }
  },

  updateRangedEnemy(this: EmbervaultEngine, e: EnemyEntity, dt: number, dx: number, dz: number, dist: number): void {
    const isArcher = isArcherLikeRanged(e.kind);
    const fireRange = isArcher ? 9.2 : 8.6;
    const minKeepDist = isArcher ? 3.5 : 3.2;
    const aggroRange = 11.5;
    const moveSpeed = e.speed * (e.fxMove ? ENEMY_AURA_MOVE_MULT : 1);

    let moveX = 0;
    let moveZ = 0;

    const clearLOS =
      dist < aggroRange &&
      hasLineOfSight(this.dungeon, e.x, e.z, this.hero.x, this.hero.z, this.doorUnlocked, 0.24);

    if (dist < aggroRange) {
      const dirX = dx / (dist || 1);
      const dirZ = dz / (dist || 1);
      e.facing = Math.atan2(dirX, dirZ);

      if (e.windupTimer > 0) {
        e.windupTimer -= dt;
        if (e.windupTimer <= 0) {
          // Release terrain-matched projectile!
          // Crit is rolled at fire time and rides on the projectile (damage already includes the multiplier)
          const crit = this.rollEnemyCrit(e);
          this.spawnProjectile(
            getRangedProjectileKind(e.kind),
            e.x + dirX * 0.48,
            e.z + dirZ * 0.48,
            dirX,
            dirZ,
            e.damageMult * this.getEnemyAuraDamageMult(e) * (crit ? ENEMY_CRIT_MULT : 1),
            this.getEnemyLabel(e)
          );
          if (crit) this.projectiles[this.projectiles.length - 1].crit = true;
          const atkSpeedDiv = this.getEnemyAtkSpeedDiv(e);
          if (isArcher) {
            this.audio.playBowShot();
            e.attackCooldown = (1.55 + Math.random() * 0.25) / atkSpeedDiv;
          } else {
            this.audio.playMageCast();
            e.attackCooldown = (1.85 + Math.random() * 0.25) / atkSpeedDiv;
          }
        }
      } else if (clearLOS && dist <= fireRange && e.attackCooldown <= 0) {
        // Begin short readable draw/cast windup before firing
        const eliteAtkSpeed = e.isElite ? 1.25 : 1;
        e.windupTimer = (isArcher ? 0.32 : 0.42) / eliteAtkSpeed;
      } else if (!clearLOS) {
        // Flank sideways around pillars/corners so ranged enemies don't glue themselves behind cover
        const side = e.id % 2 === 0 ? 1 : -1;
        moveX = (dirX * 0.55 - dirZ * 0.84 * side) * moveSpeed;
        moveZ = (dirZ * 0.55 + dirX * 0.84 * side) * moveSpeed;
      } else if (dist > fireRange * 0.85) {
        moveX = dirX * moveSpeed;
        moveZ = dirZ * moveSpeed;
      } else if (dist < minKeepDist) {
        // Gently kite backward if hero closes in
        moveX = -dirX * moveSpeed * 0.72;
        moveZ = -dirZ * moveSpeed * 0.72;
      }

      // Soft separation from other enemies
      for (const other of this.enemies) {
        if (other === e || other.dead || other.bossWarpUntargetable) continue;
        const ox = e.x - other.x;
        const oz = e.z - other.z;
        const od = Math.hypot(ox, oz);
        if (od > 0.01 && od < 1.15) {
          moveX += (ox / od) * 1.8;
          moveZ += (oz / od) * 1.8;
        }
      }
    } else {
      e.windupTimer = 0;
    }

    const nextPos = this.moveWithSlide(
      e.x,
      e.z,
      (moveX + e.vx) * dt,
      (moveZ + e.vz) * dt,
      0.38
    );
    e.x = nextPos.x;
    e.z = nextPos.z;
    e.vx *= Math.exp(-9 * dt);
    e.vz *= Math.exp(-9 * dt);

    // Procedural Rig Animation
    e.rig.root.position.set(e.x, 0, e.z);
    e.rig.body.rotation.y = e.facing;
    if (e.rig.auraRing) {
      e.rig.auraRing.rotation.z += dt * 1.4;
    }
    const moving = Math.hypot(moveX, moveZ) > 0.3;
    e.hopPhase += dt * (isArcher ? 8.2 : 5.2);

    if (isArcher) {
      const walkSwing = moving ? Math.sin(e.hopPhase) * 0.45 : 0;
      if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = walkSwing;
      if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -walkSwing;
      if (e.rig.weaponArm) {
        const targetRot = e.windupTimer > 0 ? -0.42 : 0;
        e.rig.weaponArm.rotation.x = THREE.MathUtils.damp(
          e.rig.weaponArm.rotation.x,
          targetRot,
          14,
          dt
        );
      }
      if (e.rig.coreMesh) {
        e.rig.coreMesh.visible = e.windupTimer > 0 || e.attackCooldown < 0.45;
      }
    } else {
      // Caster / hovering eyeball glides & energizes core while casting
      e.rig.body.position.y = (e.kind === 'flesh_eye' ? 0.14 : 0.08) + Math.sin(e.hopPhase) * 0.08;
      if (e.rig.coreMesh) {
        e.rig.coreMesh.rotation.y += dt * (e.windupTimer > 0 ? 11 : 3.2);
        const s = e.windupTimer > 0 ? 1.42 : 1.0;
        e.rig.coreMesh.scale.setScalar(s);
      }
      if (e.rig.weaponArm) {
        const targetRot = e.windupTimer > 0 ? -0.9 : 0;
        e.rig.weaponArm.rotation.x = THREE.MathUtils.damp(
          e.rig.weaponArm.rotation.x,
          targetRot,
          12,
          dt
        );
      }
    }

    // Hit flash or subtle windup telegraph glow
    const windupColor =
      e.kind === 'cavern_spitter'
        ? 0x5cf5ff
        : e.kind === 'cavern_shaman'
        ? 0x6ef7a2
        : e.kind === 'flesh_spiner' || e.kind === 'flesh_eye'
        ? 0xff5ec4
        : e.kind === 'alien_gunner'
        ? 0x4dff88
        : e.kind === 'alien_psion'
        ? 0xff5ce6
        : isArcher
        ? 0xffd24a
        : 0x7ef5ff;
    for (const m of e.rig.flashMaterials) {
      if (e.hitFlash > 0) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.85;
      } else if (e.windupTimer > 0) {
        m.emissive.setHex(windupColor);
        m.emissiveIntensity = 0.32;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  },

  updateEnemies(this: EmbervaultEngine, dt: number): void {
    this.updateEnemyAuras(dt);
    for (const e of this.enemies) {
      if (e.dead) continue;

      if (e.isBoss) {
        this.checkBossEnrage(e);
        this.updateBossRageVisual(e, dt);
      }
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.stunTimer = Math.max(0, e.stunTimer - dt);
      e.frozenTimer = Math.max(0, (e.frozenTimer ?? 0) - dt);
      const isFrozen = e.frozenTimer > 0;
      const isSlowed = (e.slowTimer ?? 0) > 0;
      if (isSlowed) e.slowTimer = Math.max(0, (e.slowTimer ?? 0) - dt);
      // Slowed enemies run their whole AI (movement, attack cooldowns, boss windups) on scaled time
      const edt = dt * (isSlowed ? 1 - (e.slowPct ?? 0) : 1);
      if ((e.atkSlowTimer ?? 0) > 0) e.atkSlowTimer = Math.max(0, (e.atkSlowTimer ?? 0) - dt);
      e.attackCooldown = Math.max(0, e.attackCooldown - edt * ((e.atkSlowTimer ?? 0) > 0 ? 0.8 : 1));

      if (e.rig.frozenShell) e.rig.frozenShell.visible = isFrozen;
      if (e.rig.slowMarker) {
        e.rig.slowMarker.visible = isSlowed && !isFrozen;
        if (isSlowed) e.rig.slowMarker.rotation.y += dt * 2.2;
      }

      if (e.rig.stunStars) {
        e.rig.stunStars.visible = e.stunTimer > 0;
        if (e.stunTimer > 0) {
          e.rig.stunStars.rotation.y += dt * 5.8;
          e.rig.stunStars.rotation.z = Math.sin(this.elapsed * 7 + e.id) * 0.14;
        }
      }

      if ((e.stunTimer > 0 || isFrozen) && !e.bossWarpUntargetable) {
        // Stunned / Frozen: only slide from remaining knockback, sway dizzily, cannot move/attack/cast
        const stunnedPos = this.moveWithSlide(e.x, e.z, e.vx * dt, e.vz * dt, e.isBoss ? 0.72 : 0.38);
        e.x = stunnedPos.x;
        e.z = stunnedPos.z;
        e.vx *= Math.exp(-9 * dt);
        e.vz *= Math.exp(-9 * dt);
        e.rig.root.position.set(e.x, 0, e.z);
        e.rig.body.rotation.z = isFrozen ? 0 : Math.sin(this.elapsed * 18 + e.id) * 0.12;
        if (e.rig.auraRing) {
          e.rig.auraRing.rotation.z += dt * 1.4;
        }
        for (const m of e.rig.flashMaterials) {
          if (e.hitFlash > 0) {
            m.emissive.setHex(0xffffff);
            m.emissiveIntensity = 0.85;
          } else if (isFrozen) {
            m.emissive.setHex(0x7fdcff);
            m.emissiveIntensity = 0.45;
          } else {
            m.emissive.setHex(0xffd24d);
            m.emissiveIntensity = 0.16;
          }
        }
        continue;
      } else if (e.rig.body.rotation.z !== 0) {
        e.rig.body.rotation.z = 0;
      }

      // Lock onto the nearest hero (or Hunter pet for non-boss enemies)
      const prey = this.nearestLiveHero(e.x, e.z);
      if (!prey) continue;
      this.setActor(prey);
      let dx = this.hero.x - e.x;
      let dz = this.hero.z - e.z;
      let dist = Math.hypot(dx, dz);

      if (e.isBoss) {
        this.updateBoss(e, edt, dx, dz, dist);
        continue;
      }

      let targetPet: PetEntity | null = null;
      for (const pet of this.pets.values()) {
        if (pet.hp <= 0) continue;
        const owner = this.heroById(pet.ownerId);
        if (!owner || owner.isDead || owner.inTown) continue;
        const pd = Math.hypot(pet.x - e.x, pet.z - e.z);
        if (pd < dist) {
          dist = pd;
          dx = pet.x - e.x;
          dz = pet.z - e.z;
          targetPet = pet;
        }
      }

      if (e.isRanged) {
        this.updateRangedEnemy(e, edt, dx, dz, dist);
        continue;
      }

      const isSwarm = isSwarmEnemy(e.kind);
      const aggroRange = isSwarm ? 10.5 : 9.5;
      const stopDist = isSwarm ? 0.62 : 0.9;
      const sepRadius = isSwarm ? 0.62 : 1.1;

      let moveX = 0;
      let moveZ = 0;

      // Aggro and pursue hero (swarm critters lock on and rush at 3x speed)
      if (dist < aggroRange && dist > stopDist) {
        const dirX = dx / dist;
        const dirZ = dz / dist;
        const chaseSpeed = e.speed * (e.fxMove ? ENEMY_AURA_MOVE_MULT : 1);
        moveX = dirX * chaseSpeed;
        moveZ = dirZ * chaseSpeed;
        e.facing = Math.atan2(dirX, dirZ);

        // Soft separation between enemies so packs fan around the hero instead of stacking identically
        for (const other of this.enemies) {
          if (other === e || other.dead || other.bossWarpUntargetable) continue;
          const ox = e.x - other.x;
          const oz = e.z - other.z;
          const od = Math.hypot(ox, oz);
          if (od > 0.01 && od < sepRadius) {
            const sepPush = isSwarm ? 2.4 : 1.8;
            moveX += (ox / od) * sepPush;
            moveZ += (oz / od) * sepPush;
          }
        }
      } else if (isSwarm && dist <= stopDist) {
        e.facing = Math.atan2(dx / (dist || 1), dz / (dist || 1));
      }

      const nextPos = this.moveWithSlide(
        e.x,
        e.z,
        (moveX + e.vx) * edt,
        (moveZ + e.vz) * edt,
        isSwarm ? 0.25 : 0.38
      );
      e.x = nextPos.x;
      e.z = nextPos.z;
      e.vx *= Math.exp(-9 * edt);
      e.vz *= Math.exp(-9 * edt);

      // Enemy Attack on Hero
      const isGuard = isGuardianEnemy(e.kind);
      const attackReach = isGuard ? 1.45 : e.isElite ? 1.4 : isSwarm ? 1.05 : 1.12;
      if (dist < attackReach && e.attackCooldown <= 0) {
        e.attackCooldown = (isSwarm ? 0.5 : isGuard ? 1.15 : 1.05) / this.getEnemyAtkSpeedDiv(e); // Swarm bites 2 times per second!
        const baseMelee = isGuard ? 9 : isSwarm ? 1.25 + Math.random() * 0.65 : 5;
        // Swarm critters scale gentler with depth (+6%/floor instead of +12%)
        const depthScale = isSwarm ? this.getSwarmDepthDamageScale() : this.getDepthDamageScale();
        const dmg = baseMelee * depthScale * e.damageMult * this.getEnemyAuraDamageMult(e);
        if (targetPet) {
          this.damagePet(targetPet, dmg, e.x, e.z);
        } else {
          const crit = this.rollEnemyCrit(e);
          this.damageHero(crit ? dmg * ENEMY_CRIT_MULT : dmg, e.x, e.z, this.getEnemyLabel(e), undefined, undefined, crit);
        }
      }

      // Enemy Procedural Rig Animation
      e.rig.root.position.set(e.x, 0, e.z);
      e.rig.body.rotation.y = e.facing;
      if (e.rig.auraRing) {
        e.rig.auraRing.rotation.z += edt * 1.4;
      }
      const isBouncy = e.kind === 'slime' || e.kind === 'flesh_cell';
      const isWingedFlyer = e.kind === 'cavern_bat' || e.kind === 'flesh_parasite';
      const isHoverTech = e.kind === 'wisp' || e.kind === 'alien_probe' || e.kind === 'alien_saucer';
      e.hopPhase +=
        edt * (isSwarm ? 24.0 : isBouncy ? 5.8 : isWingedFlyer ? 14.0 : isHoverTech ? 6.5 : 8.5);

      if (isSwarm) {
        const chasing = dist < aggroRange;
        const scurry = chasing ? Math.sin(e.hopPhase) : Math.sin(e.hopPhase * 0.25) * 0.15;
        if (e.kind === 'flesh_leech') {
          e.rig.body.scale.set(1 + scurry * 0.08, 1 - scurry * 0.06, 1 + scurry * 0.14);
          e.rig.body.position.y = Math.max(0, scurry) * 0.08;
          if (e.rig.coreMesh) {
            const p = 1 + Math.sin(this.elapsed * 9 + e.id) * 0.15;
            e.rig.coreMesh.scale.setScalar(p);
          }
          if (e.rig.weaponArm) {
            e.rig.weaponArm.position.z = e.attackCooldown > 0.34 ? 0.38 : 0.28;
          }
        } else if (e.kind === 'alien_nanobot') {
          e.rig.body.position.y = 0.04 + Math.sin(e.hopPhase * 0.6) * 0.07;
          if (e.rig.coreMesh) e.rig.coreMesh.rotation.z += edt * 16;
          if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = scurry * 0.55;
          if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -scurry * 0.55;
          const snap = e.attackCooldown > 0.34 ? 0.42 : scurry * 0.18;
          if (e.rig.leftArm) e.rig.leftArm.rotation.y = snap;
          if (e.rig.weaponArm) e.rig.weaponArm.rotation.y = -snap;
        } else {
          // dungeon_rat & cavern_mite rapid scurrying gait + fast bite lunge
          e.rig.body.position.y = Math.abs(scurry) * 0.09;
          if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = scurry * 0.72;
          if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -scurry * 0.72;
          if (e.kind === 'cavern_mite') {
            const snap = e.attackCooldown > 0.34 ? 0.45 : scurry * 0.16;
            if (e.rig.leftArm) e.rig.leftArm.rotation.y = snap;
            if (e.rig.weaponArm) e.rig.weaponArm.rotation.y = -snap;
          } else if (e.rig.weaponArm) {
            e.rig.weaponArm.position.z = e.attackCooldown > 0.34 ? 0.32 : 0.2;
          }
        }
      } else if (isBouncy) {
        const bounce = Math.max(0, Math.sin(e.hopPhase));
        e.rig.body.position.y = bounce * 0.42;
        const stretch = 1 + bounce * 0.18;
        const squash = 1 / Math.sqrt(stretch);
        const baseScale = e.isSpecialElite ? 1.38 : e.isElite ? 1.32 : 1;
        e.rig.body.scale.set(squash * baseScale, stretch * baseScale, squash * baseScale);
        if (e.rig.coreMesh) {
          e.rig.coreMesh.rotation.y += edt * 2.5;
        }
      } else if (isWingedFlyer) {
        e.rig.body.position.y = 0.12 + Math.sin(e.hopPhase * 0.45) * 0.16;
        const flap = Math.sin(e.hopPhase) * 0.65;
        if (e.rig.leftArm) e.rig.leftArm.rotation.z = flap;
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.z = -flap;
      } else if (isHoverTech) {
        e.rig.body.position.y = Math.sin(e.hopPhase) * 0.2;
        if (e.rig.coreMesh) {
          e.rig.coreMesh.rotation.y += edt * (e.kind === 'alien_saucer' ? 6.5 : 4.2);
          if (e.kind === 'alien_probe') {
            e.rig.coreMesh.rotation.z += edt * 3.0;
          }
        }
      } else {
        const walkSwing = dist < 9.5 ? Math.sin(e.hopPhase) * 0.5 : 0;
        if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = walkSwing;
        if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -walkSwing;
        if (e.rig.weaponArm) {
          e.rig.weaponArm.rotation.x = e.attackCooldown > 0.75 ? -1.4 : -walkSwing * 0.3;
        }
      }

      // White hit flash
      for (const m of e.rig.flashMaterials) {
        if (e.hitFlash > 0) {
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = 0.85;
        } else if (e.kind === 'slime') {
          m.emissive.setHex(this.dungeon.biome.id === 'ossuary' ? 0x9b5de5 : 0x45d66b);
          m.emissiveIntensity = 0.22;
        } else if (e.kind === 'flesh_cell') {
          m.emissive.setHex(0xa6266e);
          m.emissiveIntensity = 0.28;
        } else if (e.kind === 'flesh_leech') {
          m.emissive.setHex(0x8a1242);
          m.emissiveIntensity = 0.2;
        } else if (e.kind === 'cavern_mite') {
          m.emissive.setHex(0x4b1d8c);
          m.emissiveIntensity = 0.16;
        } else {
          m.emissive.setHex(0x000000);
          m.emissiveIntensity = 0;
        }
      }
    }
    this.setActor(this.localHero);
  },
};
