import type { EmbervaultEngine } from '../engine';
import { BOT_REGROUP_DIST, BOT_REGROUP_DONE_DIST, COMPANION_EDGE_NDC, COMPANION_WARP_DIST, FROST_MAGE, HERO_CLASSES, HUNTER, UpgradeKind } from '../classes';
import { findGridPath, gridToWorld, hasLineOfSight, isTileWalkable, worldToGrid, worldToWalkableGrid } from '../dungeon';
import { BOSS_AI, BOSS_CHARGE, BOSS_NOVA, BOSS_PRISM, BOSS_VOLLEY, BOSS_WARP, isGuardianEnemy, isSwarmEnemy } from './data';
import { AnimatedLightProp, EnemyEntity, LootEntity } from './entities';
import { _projVec } from './scratch';
import { Hero } from '../hero';
import { TREASURE_CONFIG } from '../treasure';
import { DungeonData } from '../types';

export const aiMethods = {
  triggerStuckRecovery(this: EmbervaultEngine, emergencyWarp: boolean): void {
    this.hero.ai.strafeSign *= -1;
    this.hero.ai.path = [];
    this.hero.ai.combatPath = [];
    this.hero.ai.repathTimer = 0;
    this.hero.ai.combatRepathTimer = 0;
    this.hero.ai.forcePathTimer = 2.0;

    if (this.hero.ai.currentTargetId !== null && this.hero.ai.unstuckAttempts >= 1) {
      // Temporarily ignore a deadlocked target while repositioning around obstacles
      this.hero.ai.skipEnemyUntil.set(this.hero.ai.currentTargetId, this.elapsed + 4.5);
    }

    const heroG = worldToWalkableGrid(this.dungeon, this.hero.x, this.hero.z, this.doorUnlocked);

    // Collect verified open escape tiles (room centers + nearby clear tiles 2-4 tiles away)
    const escapeCandidates: Array<{ gx: number; gz: number; score: number }> = [];
    for (const r of this.dungeon.rooms) {
      if (r.role === 'exit' && !this.doorUnlocked) continue;
      if (!isTileWalkable(this.dungeon, r.cx, r.cz, this.doorUnlocked)) continue;
      const rw = gridToWorld(r.cx, r.cz);
      const d = Math.hypot(rw.x - this.hero.x, rw.z - this.hero.z);
      if (d > 1.8 && d < 18 && this.canMoveTo(rw.x, rw.z, 0.44)) {
        escapeCandidates.push({ gx: r.cx, gz: r.cz, score: Math.abs(d - 5.0) });
      }
    }
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const manhattan = Math.abs(dx) + Math.abs(dz);
        if (manhattan < 2 || manhattan > 5) continue;
        const nx = heroG.gx + dx;
        const nz = heroG.gz + dz;
        if (!isTileWalkable(this.dungeon, nx, nz, this.doorUnlocked)) continue;
        if (this.dungeon.tiles[nz]?.[nx] === 6) continue; // skip spike traps
        const nw = gridToWorld(nx, nz);
        if (!this.canMoveTo(nw.x, nw.z, 0.44)) continue;
        escapeCandidates.push({ gx: nx, gz: nz, score: Math.abs(manhattan - 3) + 2.5 });
      }
    }
    escapeCandidates.sort((a, b) => a.score - b.score);

    if (emergencyWarp) {
      // Stage 2 emergency unstuck: blink hero cleanly to a verified open tile to break any geometry lock
      for (const c of escapeCandidates) {
        const pathCheck = findGridPath(
          this.dungeon,
          heroG.gx,
          heroG.gz,
          c.gx,
          c.gz,
          this.doorUnlocked
        );
        if (pathCheck.length > 0) {
          const dest = gridToWorld(c.gx, c.gz);
          this.hero.x = dest.x;
          this.hero.z = dest.z;
          this.hero.vx = 0;
          this.hero.vz = 0;
          this.hero.ai.progressAnchorX = dest.x;
          this.hero.ai.progressAnchorZ = dest.z;
          this.hero.ai.unstuckAttempts = 0;
          this.hero.ai.unstuckTimer = 0;
          this.hero.ai.unstuckPath = [];
          this.hero.ai.skipEnemyUntil.clear();
          this.hero.ai.status = 'Repositioning';
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            this.spawnParticle(
              dest.x,
              0.7,
              dest.z,
              Math.cos(a) * 2.4,
              1.4,
              Math.sin(a) * 2.4,
              0x3be8e0,
              0.95,
              0.42,
              0
            );
          }
          return;
        }
      }
      this.nudgeHeroToClearTile();
      this.hero.ai.unstuckAttempts = 0;
      return;
    }

    // Stage 1 active detour: chart an explicit escape path to an open tile and commit to it for 1.6s
    for (const c of escapeCandidates) {
      const p = this.buildSafeGridPath(c.gx, c.gz);
      if (p.length > 0) {
        this.hero.ai.unstuckPath = p;
        this.hero.ai.unstuckTimer = 1.6;
        this.hero.ai.status = 'Repositioning';
        return;
      }
    }

    // Fallback if no detour found
    this.nudgeHeroToClearTile();
  },

  /**
   * Frost Mage auto-pilot combat: keep 4.5–7 units away, kite back when threatened (< 3),
   * shoot only with line of sight, Frost Nova / Blink to escape crowds and swarms.
   * Returns null when the target has no line of sight (caller then path-finds toward it).
   */
  updateMageCombatAI(
    this: EmbervaultEngine,
    target: EnemyEntity,
    targetDist: number
  ): { moveX: number; moveZ: number } | null {
    const dx = target.x - this.hero.x;
    const dz = target.z - this.hero.z;
    const shotLOS = hasLineOfSight(
      this.dungeon,
      this.hero.x,
      this.hero.z,
      target.x,
      target.z,
      this.doorUnlocked,
      0.2
    );

    // Threat census around the mage
    let within4 = 0;
    let adjacent = 0;
    let swarmClose = 0;
    let bossWindup = false;
    let closest: EnemyEntity | null = null;
    let closestDist = Infinity;
    let cx = 0;
    let cz = 0;
    let cn = 0;
    for (const e of this.enemies) {
      if (e.dead || e.bossWarpUntargetable) continue;
      const d = Math.hypot(e.x - this.hero.x, e.z - this.hero.z);
      const frozen = (e.frozenTimer ?? 0) > 0 || e.stunTimer > 0;
      if (d <= 4 && !frozen) within4 += 1;
      if (d <= 1.9 && !frozen) adjacent += 1;
      if (d <= 3.2 && isSwarmEnemy(e.kind) && !frozen) swarmClose += 1;
      if (e.isBoss && e.bossState === 'windup' && d <= FROST_MAGE.novaRadius) bossWindup = true;
      if (d < 6) {
        cx += e.x;
        cz += e.z;
        cn += 1;
      }
      if (d < closestDist && !frozen) {
        closestDist = d;
        closest = e;
      }
    }
    const shieldBroken = this.hero.getEffectiveMaxShield() > 0 && this.hero.shield <= 0.5;
    let castNova = false;

    // 1. Frost Nova
    if (
      this.hero.pommelCooldown <= 0 &&
      (within4 >= 3 || (shieldBroken && adjacent > 0) || bossWindup || swarmClose >= 2)
    ) {
      this.performFrostNova();
      this.hero.ai.status = 'Frost Nova!';
      castNova = true;
    }

    // 2. Blink out of a swarm / melee crowd when Nova is not available
    if (
      !castNova &&
      this.hero.pommelCooldown > 0 &&
      this.hero.dashCooldown <= 0 &&
      cn > 0 &&
      (swarmClose >= 2 || adjacent >= 2 || (shieldBroken && adjacent >= 1))
    ) {
      const awayX = this.hero.x - cx / cn;
      const awayZ = this.hero.z - cz / cn;
      const len = Math.hypot(awayX, awayZ);
      const baseAng = len > 0.05 ? Math.atan2(awayX, awayZ) : this.hero.facing + Math.PI;
      // Try straight away from the crowd first, then fan out
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
        const ex = Math.sin(baseAng + off);
        const ez = Math.cos(baseAng + off);
        if (this.canMoveTo(this.hero.x + ex * 2.5, this.hero.z + ez * 2.5, 0.4)) {
          this.performBlink({ x: ex, z: ez });
          this.hero.ai.status = 'Blinking Clear';
          break;
        }
      }
    }

    // 3. Shoot the target when we have a clean shot
    if (shotLOS && targetDist <= FROST_MAGE.projectileRange + this.getEnemyHitRadius(target)) {
      this.hero.facing = Math.atan2(dx, dz);
      if (this.hero.attackCooldown <= 0) this.performAttack();
    } else if (!shotLOS) {
      return null; // let the shared pathing bring us around the corner
    }

    // 4. Movement: kite, hold the band, or close in
    const tryDir = (mx: number, mz: number): { moveX: number; moveZ: number } | null => {
      const l = Math.hypot(mx, mz) || 1;
      const nx = mx / l;
      const nz = mz / l;
      if (this.canMoveTo(this.hero.x + nx * 0.7, this.hero.z + nz * 0.7, 0.4)) return { moveX: nx, moveZ: nz };
      return null;
    };

    // An enraged boss is fast: kite from further away so it never gets on top of us
    const kiteDist = this.aiEnragedBossNear() ? BOSS_AI.enragedKiteDist : 3;
    if (closest && closestDist < kiteDist) {
      this.hero.ai.status = 'Kiting';
      const ax = this.hero.x - closest.x;
      const az = this.hero.z - closest.z;
      const l = Math.hypot(ax, az) || 1;
      const bx = ax / l;
      const bz = az / l;
      const px = -bz * this.hero.ai.strafeSign;
      const pz = bx * this.hero.ai.strafeSign;
      const step =
        tryDir(bx, bz) ??
        tryDir(bx + px, bz + pz) ??
        tryDir(bx - px, bz - pz) ??
        tryDir(px, pz) ??
        tryDir(-px, -pz);
      if (step) return step;
      // Cornered: Blink sideways if possible, otherwise stand and shoot
      if (this.hero.dashCooldown <= 0) {
        this.performBlink({ x: px, z: pz });
      }
      return { moveX: 0, moveZ: 0 };
    }

    const l = targetDist || 1;
    if (targetDist > 7) {
      this.hero.ai.status = target.isBoss ? `Battling ${target.bossName}` : 'Closing Distance';
      return { moveX: dx / l, moveZ: dz / l };
    }
    if (targetDist < 4.5) {
      const back = tryDir(-dx / l, -dz / l);
      if (back) return { moveX: back.moveX * 0.7, moveZ: back.moveZ * 0.7 };
    }
    // Comfortable range: light strafing so slow ranged shots and boss telegraphs miss
    return {
      moveX: (-dz / l) * 0.3 * this.hero.ai.strafeSign,
      moveZ: (dx / l) * 0.3 * this.hero.ai.strafeSign,
    };
  },

  /** Walk speed of the actor, same formula as the movement step in `updateHeroFrame`. */
  aiMoveSpeed(this: EmbervaultEngine): number {
    return (
      4.65 *
      HERO_CLASSES[this.hero.classId].moveSpeedMult *
      (1 + this.hero.relicStats.moveSpeedPct / 100)
    );
  },

  /** True when a living enraged boss is within 13 of the actor: ranged heroes then keep a larger distance. */
  aiEnragedBossNear(this: EmbervaultEngine): boolean {
    return this.enemies.some(
      (e) => !e.dead && e.isBoss && e.bossEnraged && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) < 13
    );
  },

  /**
   * Boss dodge for the actor: leave a skill telegraph circle as soon as it shows (dash when walking cannot make it),
   * step out of a locked volley fan, and sidestep boss projectiles on their way. Returns the move, or null.
   * Basic attacks have no telegraph and cannot be dodged by reading the ground.
   */
  aiBossDodge(this: EmbervaultEngine): { moveX: number; moveZ: number } | null {
    const hx = this.hero.x;
    const hz = this.hero.z;
    const speed = this.aiMoveSpeed();
    const margin = BOSS_AI.circleMargin;

    const stepAway = (escX: number, escZ: number): { moveX: number; moveZ: number } => {
      this.hero.facing = Math.atan2(escX, escZ);
      if (this.canMoveTo(hx + escX * 0.7, hz + escZ * 0.7, 0.4)) return { moveX: escX, moveZ: escZ };
      const perpX = -escZ * this.hero.ai.strafeSign;
      const perpZ = escX * this.hero.ai.strafeSign;
      if (this.canMoveTo(hx + perpX * 0.7, hz + perpZ * 0.7, 0.4)) return { moveX: perpX, moveZ: perpZ };
      return { moveX: -perpX, moveZ: -perpZ };
    };

    for (const e of this.enemies) {
      if (e.dead || !e.isBoss || e.bossAction === 'basic') continue;

      // warp_ambush Phase 3: royal-blue landing rings locked nearby -> pull away early before the seamless follow-up slam!
      if (e.bossState === 'strike' && e.bossSkill === 'warp_ambush' && e.bossWarpPhase === 'descend') {
        const tx = e.telegraphX ?? e.x;
        const tz = e.telegraphZ ?? e.z;
        const cdx = hx - tx;
        const cdz = hz - tz;
        const cDist = Math.hypot(cdx, cdz);
        const safeRad = (e.telegraphRadius ?? BOSS_WARP.telegraphRadius) + margin + 1.2;
        if (cDist < safeRad) {
          this.hero.ai.status = 'Evading Boss Warp';
          const escX = cDist > 0.05 ? cdx / cDist : Math.cos(this.elapsed);
          const escZ = cDist > 0.05 ? cdz / cDist : Math.sin(this.elapsed);
          if (this.hero.dashCooldown <= 0 && cDist < 2.3 && (e.bossStateTimer ?? 0) < 0.16) {
            this.hero.facing = Math.atan2(escX, escZ);
            this.performDash();
          }
          return stepAway(escX, escZ);
        }
        continue;
      }

      if (e.bossState !== 'windup') continue;
      // warp_ambush Phase 1 (takeoff chant) deals no damage at takeoff — keep fighting instead of fleeing
      if (e.bossSkill === 'warp_ambush') continue;
      const remaining = e.bossStateTimer ?? 0;
      const dur = e.bossStateDuration || 1;

      if (e.bossSkill === 'ranged_volley') {
        const bdx = hx - e.x;
        const bdz = hz - e.z;
        const bDist = Math.hypot(bdx, bdz);
        const progress = 1 - remaining / dur;
        if (progress < BOSS_VOLLEY.aimTrackFraction) {
          // The boss still tracks us: only get out of the small ring under it
          const ring = (e.telegraphRadius ?? 1.45) + margin;
          if (bDist < ring) {
            this.hero.ai.status = 'Evading Boss Strike';
            const ex = bDist > 0.05 ? bdx / bDist : 1;
            const ez = bDist > 0.05 ? bdz / bDist : 0;
            return stepAway(ex, ez);
          }
          continue;
        }
        // Aim locked: leave the fan (3 shots, +-0.28 rad around the facing direction)
        const fx = Math.sin(e.facing);
        const fz = Math.cos(e.facing);
        const along = bdx * fx + bdz * fz;
        const lateral = bdx * -fz + bdz * fx;
        const fanHalfWidth = Math.max(0, along) * Math.tan(0.28) + 1.05;
        if (along > 0 && bDist < BOSS_VOLLEY.beamMaxRange + 0.4 && Math.abs(lateral) < fanHalfWidth) {
          this.hero.ai.status = 'Strafing Boss Volley';
          const side = lateral === 0 ? this.hero.ai.strafeSign : Math.sign(lateral);
          const mv = stepAway(-fz * side, fx * side);
          if (this.hero.dashCooldown <= 0 && remaining < BOSS_AI.dashLeadTime + 0.1) this.performDash();
          return mv;
        }
        continue;
      }

      if (e.bossSkill === 'prism_cone') {
        const bdx = hx - e.x;
        const bdz = hz - e.z;
        const bDist = Math.hypot(bdx, bdz);
        if (bDist < BOSS_PRISM.range + margin) {
          const fx = Math.sin(e.facing);
          const fz = Math.cos(e.facing);
          const along = bdx * fx + bdz * fz;
          const lateral = bdx * -fz + bdz * fx;
          let diff = Math.atan2(bdx, bdz) - e.facing;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (along > -0.4 && Math.abs(diff) <= BOSS_PRISM.halfAngle + 0.14) {
            this.hero.ai.status = 'Evading Prism Cone';
            const side = lateral === 0 ? this.hero.ai.strafeSign : Math.sign(lateral);
            const mv = stepAway(-fz * side, fx * side);
            if (this.hero.dashCooldown <= 0 && remaining < BOSS_AI.dashLeadTime + 0.1) this.performDash();
            return mv;
          }
        }
        continue;
      }

      const tx = e.telegraphX ?? e.x;
      const tz = e.telegraphZ ?? e.z;
      const rad = e.telegraphRadius ?? 2.8;
      const cdx = hx - tx;
      const cdz = hz - tz;
      const cDist = Math.hypot(cdx, cdz);
      if (cDist < rad + margin) {
        this.hero.ai.status = 'Evading Boss Strike';
        const escX = cDist > 0.05 ? cdx / cDist : Math.cos(this.elapsed);
        const escZ = cDist > 0.05 ? cdz / cDist : Math.sin(this.elapsed);
        const left = rad + margin * 0.5 - cDist;
        // Walking out takes left / speed; if the windup ends before that (or nearly has), burn the dash (it also grants i-frames)
        if (
          this.hero.dashCooldown <= 0 &&
          (left > speed * remaining * 0.9 || (remaining < BOSS_AI.dashLeadTime && cDist < rad + 0.2))
        ) {
          this.hero.facing = Math.atan2(escX, escZ);
          this.performDash();
        }
        return stepAway(escX, escZ);
      }

      // charge_slam: also sidestep out of the damaging dash corridor (start -> landing)
      if (e.bossSkill === 'charge_slam') {
        const sx = e.bossChargeStartX ?? e.x;
        const sz = e.bossChargeStartZ ?? e.z;
        const ldx = tx - sx;
        const ldz = tz - sz;
        const lLen = Math.hypot(ldx, ldz);
        if (lLen > 0.35) {
          const ux = ldx / lLen;
          const uz = ldz / lLen;
          const rx = hx - sx;
          const rz = hz - sz;
          const along = rx * ux + rz * uz;
          const lateral = rx * -uz + rz * ux;
          const corrHalf = BOSS_CHARGE.corridorHalfWidth + margin;
          if (along >= -0.4 && along <= lLen + 0.4 && Math.abs(lateral) < corrHalf) {
            this.hero.ai.status = 'Evading Boss Charge';
            const side = Math.abs(lateral) < 0.05 ? this.hero.ai.strafeSign : Math.sign(lateral);
            const escX = -uz * side;
            const escZ = ux * side;
            if (this.hero.dashCooldown <= 0 && remaining < BOSS_AI.dashLeadTime + 0.08) {
              this.hero.facing = Math.atan2(escX, escZ);
              this.performDash();
            }
            return stepAway(escX, escZ);
          }
        }
      }

      // nova_ring: also sidestep out of the N directional laser telegraph lanes into the safe gap
      if (e.bossSkill === 'nova_ring' && cDist < BOSS_NOVA.beamMaxRange) {
        const count = this.depth >= BOSS_NOVA.deepFromDepth ? BOSS_NOVA.beamsDeep : BOSS_NOVA.beams;
        const baseAng = e.bossNovaAngle ?? e.facing;
        const laneHalf = BOSS_NOVA.beamHalfWidth + margin;
        for (let i = 0; i < count; i++) {
          const ang = baseAng + (i / count) * Math.PI * 2;
          const bdx = Math.sin(ang);
          const bdz = Math.cos(ang);
          const along = cdx * bdx + cdz * bdz;
          if (along < 0 || along > BOSS_NOVA.beamMaxRange) continue;
          const lateral = cdx * -bdz + cdz * bdx;
          if (Math.abs(lateral) < laneHalf) {
            this.hero.ai.status = 'Evading Boss Laser';
            const side = lateral === 0 ? this.hero.ai.strafeSign : Math.sign(lateral);
            const escX = -bdz * side;
            const escZ = bdx * side;
            if (this.hero.dashCooldown <= 0 && remaining < BOSS_AI.dashLeadTime + 0.06) {
              this.hero.facing = Math.atan2(escX, escZ);
              this.performDash();
            }
            return stepAway(escX, escZ);
          }
        }
      }
    }

    // Boss projectiles (volley shots, basic shots, nova orbs): leave the line of every one that is about to reach us
    let sideX = 0;
    let sideZ = 0;
    let imminent = false;
    for (const p of this.projectiles) {
      if (!this.enemies.some((e) => !e.dead && e.isBoss && (e.bossName ?? '地城頭目') === p.sourceLabel)) continue;
      const ps = Math.hypot(p.vx, p.vz);
      if (ps < 0.01) continue;
      const ux = p.vx / ps;
      const uz = p.vz / ps;
      const rx = hx - p.x;
      const rz = hz - p.z;
      const along = rx * ux + rz * uz;
      if (along < -0.2 || along > ps * 1.4) continue;
      const lateral = rx * -uz + rz * ux;
      if (Math.abs(lateral) > 1.25) continue;
      const side = Math.abs(lateral) < 0.05 ? this.hero.ai.strafeSign : Math.sign(lateral);
      const w = 1 / (Math.abs(lateral) + 0.25);
      sideX += -uz * side * w;
      sideZ += ux * side * w;
      if (along / ps < 0.28 && Math.abs(lateral) < 0.75) imminent = true;
    }
    const sideLen = Math.hypot(sideX, sideZ);
    if (sideLen > 0.001) {
      this.hero.ai.status = 'Dodging Boss Shots';
      const mv = stepAway(sideX / sideLen, sideZ / sideLen);
      if (imminent && this.hero.dashCooldown <= 0) this.performDash();
      return mv;
    }
    return null;
  },

  /**
   * Auto-pilot for any hero (attract mode, the local hero in auto mode, and every bot teammate). The engine's
   * per-hero code reads its hero from `this.hero`, so the body below runs with `hero` as the actor.
   */
  updateAI(this: EmbervaultEngine, hero: Hero, dt: number): { moveX: number; moveZ: number } {
    const prev = this.hero;
    this.setActor(hero);
    try {
      return this.runAI(dt);
    } finally {
      this.setActor(prev);
    }
  },

  runAI(this: EmbervaultEngine, dt: number): { moveX: number; moveZ: number } {
    this.hero.ai.forcePathTimer = Math.max(0, this.hero.ai.forcePathTimer - dt);

    // 0a. Macro Stuck Detector: if hero's XY/XZ position barely changes for 2.5s AND no enemy took damage,
    //     run a 2-stage unstuck recovery flow (Stage 1: detour around obstacle; Stage 2: clean reposition)!
    const anchorDist = Math.hypot(
      this.hero.x - this.hero.ai.progressAnchorX,
      this.hero.z - this.hero.ai.progressAnchorZ
    );
    const recentCombatDamage = this.elapsed - this.hero.ai.lastCombatDamageTime < 2.2;
    if (anchorDist > 1.35 || recentCombatDamage) {
      this.hero.ai.progressAnchorX = this.hero.x;
      this.hero.ai.progressAnchorZ = this.hero.z;
      this.hero.ai.noProgressTimer = 0;
      if (anchorDist > 1.8) {
        this.hero.ai.unstuckAttempts = 0;
      }
    } else {
      this.hero.ai.noProgressTimer += dt;
      if (this.hero.ai.noProgressTimer >= 2.5) {
        this.hero.ai.noProgressTimer = 0;
        this.hero.ai.unstuckAttempts += 1;
        this.triggerStuckRecovery(this.hero.ai.unstuckAttempts >= 2);
      }
    }

    // 0b. Micro stuck watchdog: quick 0.55s snag check for doorway corners
    this.hero.ai.stuckTimer += dt;
    if (this.hero.ai.stuckTimer > 0.55) {
      const progress = Math.hypot(this.hero.x - this.hero.ai.lastCheckX, this.hero.z - this.hero.ai.lastCheckZ);
      this.hero.ai.lastCheckX = this.hero.x;
      this.hero.ai.lastCheckZ = this.hero.z;
      this.hero.ai.stuckTimer = 0;
      if (progress < 0.22 && !recentCombatDamage) {
        this.hero.ai.stuckCount += 1;
        this.hero.ai.combatPath = [];
        this.hero.ai.repathTimer = 0;
        this.hero.ai.combatRepathTimer = 0;
        this.hero.ai.forcePathTimer = 1.4;
        this.hero.ai.strafeSign *= -1;
        if (this.hero.ai.stuckCount >= 2) {
          this.nudgeHeroToClearTile();
          this.hero.ai.stuckCount = 0;
        }
        this.hero.ai.path = [];
      } else {
        this.hero.ai.stuckCount = 0;
      }
    }

    // 1. Auto-heal check
    const healThreshold = this.hero.getAutoHealThreshold(this.hero.getEffectiveMaxHp());
    if (this.hero.hp <= healThreshold && this.hero.potions > 0) {
      this.usePotion();
    }

    // 1b. Boss dodge (docs/boss-spec.md section 9): react the moment a telegraph appears (windups are only 0.5-0.8 s now)
    const bossDodge = this.aiBossDodge();
    if (bossDodge) return bossDodge;

    // 1b-2. Rescue a downed teammate: ranks above fighting, below the potion check and boss dodging above
    const rescueMove = this.aiRescueStep(dt);
    if (rescueMove) return rescueMove;

    // 1b-3. Bots that drifted away from the leader drop the fight and walk back first (hysteresis: resume fighting
    //       only once they are close again)
    if (this.hero.isBot) {
      const me = this.hero;
      const leader = this.isAwayMode(me) && this.awayAnchor ? this.awayAnchor : this.localHero;
      const d = Math.hypot(leader.x - me.x, leader.z - me.z);
      if (me.ai.regrouping) {
        if (d <= BOT_REGROUP_DONE_DIST) me.ai.regrouping = false;
      } else if (d > BOT_REGROUP_DIST) {
        me.ai.regrouping = true;
        me.ai.combatPath = [];
        me.ai.currentTargetId = null;
      }
      if (me.ai.regrouping) {
        const step = this.aiFollowLeader(dt);
        me.ai.status = 'Regrouping';
        return step;
      }
    }

    // 1c. Active Unstuck Detour: commit to breaking free from a pillar/corner deadlock before re-engaging
    if (this.hero.ai.unstuckTimer > 0) {
      this.hero.ai.unstuckTimer = Math.max(0, this.hero.ai.unstuckTimer - dt);
      const escapeStep = this.followGridPath(this.hero.ai.unstuckPath);
      if (escapeStep) {
        this.hero.ai.status = 'Repositioning';
        const dashVec = this.getPathDashDirection(this.hero.ai.unstuckPath, escapeStep);
        this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
        return escapeStep;
      }
      this.hero.ai.unstuckTimer = 0;
    }

    // 1d. If standing right beside the Relic Key with clear LOS and no melee threat on top of us, grab it immediately!
    // (bots follow the local hero instead of pursuing the floor objectives)
    if (!this.hasKey && !this.hero.isBot) {
      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const kdx = kw.x - this.hero.x;
      const kdz = kw.z - this.hero.z;
      const kDist = Math.hypot(kdx, kdz);
      if (
        kDist < 2.65 &&
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, kw.x, kw.z, this.doorUnlocked, 0.36)
      ) {
        const immediateThreat = this.enemies.some(
          (e) => !e.dead && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) < 2.2
        );
        if (!immediateThreat) {
          this.hero.ai.status = 'Claiming Relic Key';
          return { moveX: kdx / (kDist || 1), moveZ: kdz / (kDist || 1) };
        }
      }
    }

    // 2. Check alive REACHABLE enemies:
    //    - Always finish every enemy inside the hero's current room before leaving!
    //    - Tactical Boss Rule: if a Boss is nearby, eliminate ranged escorts near the Boss first!
    const heroG = worldToWalkableGrid(this.dungeon, this.hero.x, this.hero.z, this.doorUnlocked);
    const currentRoom = this.dungeon.rooms.find(
      (r) =>
        heroG.gx >= r.x &&
        heroG.gx < r.x + r.w &&
        heroG.gz >= r.z &&
        heroG.gz < r.z + r.h
    );
    const exitRoom = this.dungeon.rooms.find((r) => r.role === 'exit');
    const nearbyBoss = this.enemies.find(
      (e) => !e.dead && e.isBoss && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) < 13.0
    );

    let nearestEnemy: EnemyEntity | null = null;
    let nearestEnemyDist = Infinity;
    let roomEnemy: EnemyEntity | null = null;
    let roomEnemyDist = Infinity;
    let priorityRanged: EnemyEntity | null = null;
    let priorityRangedDist = Infinity;

    // Local hero away in town: bots hold the post. They only fight what comes within 8 of the post and give up
    // any target once they have been pulled more than 10 away from it (they never explore or chase).
    const away = this.isAwayMode(this.hero);
    for (const e of this.enemies) {
      if (e.dead || e.bossWarpUntargetable) continue;
      if (away && (!this.withinLeash(this.hero.x, this.hero.z, 10) || !this.withinLeash(e.x, e.z, 8))) continue;
      const skipUntil = this.hero.ai.skipEnemyUntil.get(e.id);
      if (skipUntil !== undefined && this.elapsed < skipUntil) continue;

      const d = Math.hypot(e.x - this.hero.x, e.z - this.hero.z);
      const eg = worldToWalkableGrid(this.dungeon, e.x, e.z, this.doorUnlocked);

      if (
        !this.doorUnlocked &&
        exitRoom &&
        eg.gx >= exitRoom.x - 1 &&
        eg.gx <= exitRoom.x + exitRoom.w &&
        eg.gz >= exitRoom.z - 1 &&
        eg.gz <= exitRoom.z + exitRoom.h
      ) {
        continue;
      }

      const inCurrentRoom =
        Boolean(currentRoom) &&
        eg.gx >= currentRoom!.x - 1 &&
        eg.gx <= currentRoom!.x + currentRoom!.w &&
        eg.gz >= currentRoom!.z - 1 &&
        eg.gz <= currentRoom!.z + currentRoom!.h;
      const nearBossRanged =
        Boolean(nearbyBoss) &&
        e.isRanged &&
        (Math.hypot(e.x - nearbyBoss!.x, e.z - nearbyBoss!.z) < 12.5 || d < 11.0);
      const maxRange = e.isBoss ? 10.5 : e.isRanged ? 10.5 : 8.2;
      if (!inCurrentRoom && !nearBossRanged && d >= maxRange) continue;

      // Skip enemies that cannot be reached (e.g., separated by a locked gate)
      const directReachable = hasLineOfSight(
        this.dungeon,
        this.hero.x,
        this.hero.z,
        e.x,
        e.z,
        this.doorUnlocked,
        0.35
      );
      if (!directReachable) {
        const pathCheck = findGridPath(
          this.dungeon,
          heroG.gx,
          heroG.gz,
          eg.gx,
          eg.gz,
          this.doorUnlocked
        );
        if (pathCheck.length === 0 && (heroG.gx !== eg.gx || heroG.gz !== eg.gz)) {
          continue;
        }
      }

      if (nearBossRanged && d < priorityRangedDist) {
        priorityRangedDist = d;
        priorityRanged = e;
      }

      if (inCurrentRoom && d < roomEnemyDist) {
        roomEnemyDist = d;
        roomEnemy = e;
      }

      if (d < maxRange && d < nearestEnemyDist) {
        nearestEnemyDist = d;
        nearestEnemy = e;
      }
    }

    if (priorityRanged) {
      nearestEnemy = priorityRanged;
      nearestEnemyDist = priorityRangedDist;
    } else if (roomEnemy) {
      nearestEnemy = roomEnemy;
      nearestEnemyDist = roomEnemyDist;
    }

    this.hero.ai.currentTargetId = nearestEnemy ? nearestEnemy.id : null;

    if (nearestEnemy) {
      this.hero.ai.status = priorityRanged
        ? 'Eliminating Ranged Threat'
        : nearestEnemy.isBoss
        ? `Battling ${nearestEnemy.bossName}`
        : 'Engaging Foes';
      const dx = nearestEnemy.x - this.hero.x;
      const dz = nearestEnemy.z - this.hero.z;

      const clearLOS = hasLineOfSight(
        this.dungeon,
        this.hero.x,
        this.hero.z,
        nearestEnemy.x,
        nearestEnemy.z,
        this.doorUnlocked,
        0.42
      );

      // Frost Mage / Hunter: ranged kiting combat. Falls through to path navigation only when LOS is blocked.
      if (this.hero.isMage()) {
        const mageMove = this.updateMageCombatAI(nearestEnemy, nearestEnemyDist);
        if (mageMove) return mageMove;
      } else if (this.hero.isHunter()) {
        if (this.hero.pommelCooldown <= 0) {
          const pet = this.pets.get(this.hero.id);
          if (!pet || pet.hp <= pet.maxHp * 0.7 || nearestEnemyDist < 8.5) {
            this.performHunterPetSkill();
          }
        }
        const shotLOS = hasLineOfSight(
          this.dungeon,
          this.hero.x,
          this.hero.z,
          nearestEnemy.x,
          nearestEnemy.z,
          this.doorUnlocked,
          0.2
        );
        if (shotLOS && nearestEnemyDist <= HUNTER.projectileRange - 0.5) {
          this.hero.facing = Math.atan2(dx, dz);
          if (this.hero.attackCooldown <= 0) this.performHunterAttack();
          const len = nearestEnemyDist || 1;
          if (nearestEnemyDist < (this.aiEnragedBossNear() ? BOSS_AI.enragedKiteDist : 3.6)) {
            // Kite backward while shooting (further away from an enraged boss)
            return { moveX: -dx / len, moveZ: -dz / len };
          }
          if (nearestEnemyDist > 7.5) {
            return { moveX: (dx / len) * 0.65, moveZ: (dz / len) * 0.65 };
          }
          return {
            moveX: (-dz / len) * 0.45 * this.hero.ai.strafeSign,
            moveZ: (dx / len) * 0.45 * this.hero.ai.strafeSign,
          };
        }
      }

      // Auto AI casts Pommel Strike when off CD to interrupt windups or stun nearby foes
      if (!this.hero.isRangedClass() && this.hero.pommelCooldown <= 0) {
        let inShockRange = 0;
        let hasPriorityInterrupt = false;
        let hasUnstunnedElite = false;
        for (const e of this.enemies) {
          if (e.dead || e.bossWarpUntargetable) continue;
          const ed = Math.hypot(e.x - this.hero.x, e.z - this.hero.z);
          const eReach = 2.55 + (e.isBoss ? 0.5 : e.isElite ? 0.18 : 0);
          if (ed <= eReach) {
            if (e.isBoss && e.bossState === 'windup') {
              hasPriorityInterrupt = true;
            } else if (e.isRanged && e.windupTimer > 0) {
              hasPriorityInterrupt = true;
            }
            if (e.stunTimer <= 0.1) {
              inShockRange += 1;
              if (e.isElite || e.isBoss || isGuardianEnemy(e.kind)) {
                hasUnstunnedElite = true;
              }
            }
          }
        }
        if (
          hasPriorityInterrupt ||
          hasUnstunnedElite ||
          inShockRange >= 2 ||
          (nearestEnemyDist <= 2.2 && nearestEnemy.stunTimer <= 0.1 && clearLOS)
        ) {
          this.hero.facing = Math.atan2(dx, dz);
          this.performPommelStrike();
        }
      }

      const attackRange = nearestEnemy.isBoss ? 2.25 : 1.85;
      if (!this.hero.isRangedClass() && nearestEnemyDist <= attackRange && clearLOS) {
        this.hero.facing = Math.atan2(dx, dz);
        if (this.hero.attackCooldown <= 0) {
          this.performAttack();
        }
        return {
          moveX: (-dz / (nearestEnemyDist || 1)) * 0.25 * this.hero.ai.strafeSign,
          moveZ: (dx / (nearestEnemyDist || 1)) * 0.25 * this.hero.ai.strafeSign,
        };
      }

      if (clearLOS && this.hero.ai.forcePathTimer <= 0) {
        this.hero.ai.combatPath = [];
        return { moveX: dx / nearestEnemyDist, moveZ: dz / nearestEnemyDist };
      }

      // Line of sight is blocked by a wall corner or pillar: navigate cleanly via walkable-snapped A*!
      this.hero.ai.combatRepathTimer -= dt;
      if (this.hero.ai.combatPath.length === 0 || this.hero.ai.combatRepathTimer <= 0) {
        this.hero.ai.combatRepathTimer = 0.4;
        const enemyG = worldToWalkableGrid(
          this.dungeon,
          nearestEnemy.x,
          nearestEnemy.z,
          this.doorUnlocked
        );
        this.hero.ai.combatPath = this.buildSafeGridPath(enemyG.gx, enemyG.gz);
      }
      const step = this.followGridPath(this.hero.ai.combatPath);
      if (step) return step;

      // Pillar-flank fallback: if hero & enemy share a snapped tile across a pillar edge, flank sideways around it!
      const len = nearestEnemyDist || 1;
      const perpX = (-dz / len) * this.hero.ai.strafeSign;
      const perpZ = (dx / len) * this.hero.ai.strafeSign;
      if (this.canMoveTo(this.hero.x + perpX * 0.65, this.hero.z + perpZ * 0.65, 0.4)) {
        return { moveX: perpX, moveZ: perpZ };
      }
      if (this.canMoveTo(this.hero.x - perpX * 0.65, this.hero.z - perpZ * 0.65, 0.4)) {
        return { moveX: -perpX, moveZ: -perpZ };
      }
    }

    // 2a. Frost Mage: with no enemy nearby and the shield below 60%, hold position until it refills
    if (this.hero.isMage() && !nearestEnemy) {
      const maxShield = this.hero.getEffectiveMaxShield();
      const anyNear = this.enemies.some(
        (e) => !e.dead && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) < 11
      );
      if (maxShield > 0 && this.hero.shield < maxShield * 0.6) this.hero.ai.mageRecharging = true;
      if (this.hero.shield >= maxShield * 0.99) this.hero.ai.mageRecharging = false;
      if (maxShield > 0 && this.hero.ai.mageRecharging && !anyNear) {
        this.hero.ai.status = 'Recharging Frost Shield';
        this.hero.ai.progressAnchorX = this.hero.x;
        this.hero.ai.progressAnchorZ = this.hero.z;
        this.hero.ai.noProgressTimer = 0;
        this.hero.ai.stuckTimer = 0;
        this.hero.ai.lastCheckX = this.hero.x;
        this.hero.ai.lastCheckZ = this.hero.z;
        return { moveX: 0, moveZ: 0 };
      }
    }

    // Away mode: nothing else interests a bot (no key, loot, crates, runes, shops or stairs): back to the post
    if (away) return this.aiFollowLeader(dt);

    // 2b. No active threats in room: if the Relic Key is in sight nearby, claim it immediately!
    if (!this.hasKey && !this.hero.isBot) {
      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const kdx = kw.x - this.hero.x;
      const kdz = kw.z - this.hero.z;
      const kDist = Math.hypot(kdx, kdz);
      if (
        kDist < 8.5 &&
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, kw.x, kw.z, this.doorUnlocked, 0.42)
      ) {
        this.hero.ai.status = 'Claiming Relic Key';
        const dirX = kdx / (kDist || 1);
        const dirZ = kdz / (kDist || 1);
        this.tryAutoTravelDash(dirX, dirZ, kDist);
        return { moveX: dirX, moveZ: dirZ };
      }
    }

    // 3. Collect nearby loose gold & potion loot (only if body-width line-of-sight is clear)
    for (const l of this.loots) {
      if (l.collected || l.type === 'relic' || l.ownerId !== this.hero.id) continue;
      const d = Math.hypot(l.x - this.hero.x, l.z - this.hero.z);
      if (
        d < 4.5 &&
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, l.x, l.z, this.doorUnlocked, 0.42)
      ) {
        this.hero.ai.status = 'Gathering Spoils';
        return { moveX: (l.x - this.hero.x) / (d || 1), moveZ: (l.z - this.hero.z) / (d || 1) };
      }
    }

    // 4. Smash nearby crate if right next to hero
    for (const br of this.breakables) {
      if (br.broken) continue;
      const d = Math.hypot(br.x - this.hero.x, br.z - this.hero.z);
      if (d < 2.0) {
        this.hero.facing = Math.atan2(br.x - this.hero.x, br.z - this.hero.z);
        if (this.hero.attackCooldown <= 0) this.performAttack();
        break;
      }
    }

    // 4a. Pick up nearby dropped Relics (wait briefly so pop-out arc & Orange/Green beam register clearly!)
    let nearestRelic: LootEntity | null = null;
    let nearestRelicDist = Infinity;
    for (const l of this.loots) {
      if (l.collected || l.type !== 'relic' || !l.relic || l.ownerId !== this.hero.id) continue;
      const readyAge = (l.pickupDelay ?? 0.85) * 0.72;
      if (l.age < readyAge) continue;
      const d = Math.hypot(l.x - this.hero.x, l.z - this.hero.z);
      const maxSearch = l.relic.rarity === 'orange' || l.relic.rarity === 'green' ? 11.0 : 5.8;
      if (
        d < maxSearch &&
        d < nearestRelicDist &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, l.x, l.z, this.doorUnlocked, 0.36)
      ) {
        nearestRelicDist = d;
        nearestRelic = l;
      }
    }
    if (nearestRelic && nearestRelicDist > 0.3) {
      this.hero.ai.status = 'Collecting Relic';
      const dirX = (nearestRelic.x - this.hero.x) / nearestRelicDist;
      const dirZ = (nearestRelic.z - this.hero.z) / nearestRelicDist;
      return { moveX: dirX, moveZ: dirZ };
    }

    // 4a-1. Treasure room: with no threat around, walk to every discovered closed chest and open it
    const chestStep = this.aiTreasureStep(dt);
    if (chestStep) return chestStep;

    // 4a-2. Auto-Heal at any discovered Healing Sanctum (Rune Well) whenever HP is not full
    if (this.hero.hp < this.hero.getEffectiveMaxHp()) {
      let bestRune: AnimatedLightProp | null = null;
      let bestRuneDist = Infinity;
      let bestRuneGrid: { gx: number; gz: number } | null = null;

      for (const lp of this.lightProps) {
        if (lp.kind !== 'rune' || lp.used) continue;
        const rg = worldToGrid(lp.x, lp.z);
        const discovered = Boolean(this.dungeon.explored[rg.gz]?.[rg.gx]);
        const d = Math.hypot(lp.x - this.hero.x, lp.z - this.hero.z);
        const directVisible =
          d < 10.5 &&
          hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, lp.x, lp.z, this.doorUnlocked, 0.36);
        if (!discovered && !directVisible) continue;
        if (!this.doorUnlocked && exitRoom) {
          if (
            rg.gx >= exitRoom.x - 1 &&
            rg.gx <= exitRoom.x + exitRoom.w &&
            rg.gz >= exitRoom.z - 1 &&
            rg.gz <= exitRoom.z + exitRoom.h
          ) {
            continue;
          }
        }
        if (d < bestRuneDist) {
          bestRuneDist = d;
          bestRune = lp;
          bestRuneGrid = rg;
        }
      }

      if (bestRune && bestRuneGrid) {
        const dx = bestRune.x - this.hero.x;
        const dz = bestRune.z - this.hero.z;
        this.hero.ai.status = 'Healing at Sanctum';
        if (
          this.hero.ai.forcePathTimer <= 0 &&
          hasLineOfSight(
            this.dungeon,
            this.hero.x,
            this.hero.z,
            bestRune.x,
            bestRune.z,
            this.doorUnlocked,
            0.4
          )
        ) {
          const dirX = dx / (bestRuneDist || 1);
          const dirZ = dz / (bestRuneDist || 1);
          this.tryAutoTravelDash(dirX, dirZ, bestRuneDist);
          return { moveX: dirX, moveZ: dirZ };
        }
        this.hero.ai.repathTimer -= dt;
        const lastRunePt = this.hero.ai.path[this.hero.ai.path.length - 1];
        const pathMatchesRune =
          Boolean(lastRunePt) &&
          lastRunePt.gx === bestRuneGrid.gx &&
          lastRunePt.gz === bestRuneGrid.gz;
        if (!pathMatchesRune || this.hero.ai.path.length === 0 || this.hero.ai.repathTimer <= 0) {
          this.hero.ai.repathTimer = 0.65;
          this.hero.ai.path = this.buildSafeGridPath(bestRuneGrid.gx, bestRuneGrid.gz);
        }
        const runeStep = this.followGridPath(this.hero.ai.path);
        if (runeStep) {
          const dashVec = this.getPathDashDirection(this.hero.ai.path, runeStep);
          this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
          return runeStep;
        }
      }
    }

    // 4b. Auto-Upgrade & Smart Potion Restock (Altar of Ascension & Dedicated Potion Shop)
    // Target potion stock scales with depth (4 early -> 5-8 deeper) so Auto buys potions when running low
    const targetPotions = Math.min(8, 4 + Math.floor(this.depth / 6));
    const urgentPotionNeed = this.hero.potions <= 2 && this.hero.gold >= this.getPotionCost();
    const wantsMorePotions = this.hero.potions < targetPotions && this.hero.gold >= this.getPotionCost();
    const canAutoUpgradeStat =
      this.hero.gold >= this.getUpgradeCost() &&
      this.getUpgradeOptions().some((o) => !o.maxed);

    if (!this.hero.isBot && this.dungeon.altarPos && (canAutoUpgradeStat || wantsMorePotions)) {
      const aw = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
      const dx = aw.x - this.hero.x;
      const dz = aw.z - this.hero.z;
      const altarDist = Math.hypot(dx, dz);

      if (altarDist < 2.2) {
        this.hero.ai.status = urgentPotionNeed ? 'Restocking Elixirs' : 'Ascending at Altar';
        this.hero.ai.stuckTimer = 0;
        this.hero.ai.stuckCount = 0;
        this.hero.ai.noProgressTimer = 0;
        this.hero.ai.progressAnchorX = this.hero.x;
        this.hero.ai.progressAnchorZ = this.hero.z;
        this.hero.ai.upgradeCooldown -= dt;
        if (this.hero.ai.upgradeCooldown <= 0) {
          if (urgentPotionNeed) {
            if (this.purchasePotion()) {
              this.hero.ai.upgradeCooldown = 0.42;
              this.hero.ai.path = [];
            }
          } else if (this.hero.gold >= this.getUpgradeCost()) {
            const cycle: UpgradeKind[] = this.hero.isMage()
              ? ['hp_shield', 'atk', 'shield_speed', 'crit']
              : this.hero.isHunter()
              ? ['hp', 'atk', 'atk_speed', 'crit']
              : ['hp', 'atk', 'armor', 'crit'];
            const startIdx = Math.max(0, cycle.indexOf(this.hero.autoNextUpgrade));
            let choice: UpgradeKind = 'atk';
            for (let offset = 0; offset < cycle.length; offset++) {
              const cand = cycle[(startIdx + offset) % cycle.length];
              if (this.hero.isUpgradeMaxed(cand)) continue;
              choice = cand;
              break;
            }
            if (this.purchaseUpgrade(choice)) {
              const nextIdx = (cycle.indexOf(choice) + 1) % cycle.length;
              this.hero.autoNextUpgrade = cycle[nextIdx];
              this.hero.ai.upgradeCooldown = 0.55;
              this.hero.ai.path = [];
            }
          } else if (this.hero.potions < targetPotions && this.hero.gold >= this.getPotionCost()) {
            if (this.purchasePotion()) {
              this.hero.ai.upgradeCooldown = 0.42;
              this.hero.ai.path = [];
            }
          }
        }
        return { moveX: 0, moveZ: 0 };
      }

      this.hero.ai.status = 'Visiting Altar';
      if (
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, aw.x, aw.z, this.doorUnlocked, 0.42)
      ) {
        const dirX = dx / (altarDist || 1);
        const dirZ = dz / (altarDist || 1);
        this.tryAutoTravelDash(dirX, dirZ, altarDist);
        return { moveX: dirX, moveZ: dirZ };
      }
      this.hero.ai.repathTimer -= dt;
      if (this.hero.ai.path.length === 0 || this.hero.ai.repathTimer <= 0) {
        this.hero.ai.repathTimer = 0.7;
        this.hero.ai.path = this.buildSafeGridPath(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
      }
      const altarStep = this.followGridPath(this.hero.ai.path);
      if (altarStep) {
        const dashVec = this.getPathDashDirection(this.hero.ai.path, altarStep);
        this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
        return altarStep;
      }
    }

    // 4c. Dedicated Elixir Potion Shop visit on every 3rd floor (Depth 3, 6, 9, 12...)
    // Restocks potions when needed. Auto never sells bag relics: the player decides what to sell or discard.
    if (!this.hero.isBot && this.dungeon.shopPos && wantsMorePotions) {
      const sw = gridToWorld(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
      const dx = sw.x - this.hero.x;
      const dz = sw.z - this.hero.z;
      const shopDist = Math.hypot(dx, dz);

      if (shopDist < 2.2) {
        this.hero.ai.status = 'Buying Elixirs';
        this.hero.ai.stuckTimer = 0;
        this.hero.ai.stuckCount = 0;
        this.hero.ai.noProgressTimer = 0;
        this.hero.ai.progressAnchorX = this.hero.x;
        this.hero.ai.progressAnchorZ = this.hero.z;
        this.hero.ai.upgradeCooldown -= dt;
        if (this.hero.ai.upgradeCooldown <= 0) {
          if (this.hero.potions < targetPotions && this.purchasePotion()) {
            this.hero.ai.upgradeCooldown = 0.42;
            this.hero.ai.path = [];
          }
        }
        return { moveX: 0, moveZ: 0 };
      }

      this.hero.ai.status = 'Visiting Potion Shop';
      if (
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, sw.x, sw.z, this.doorUnlocked, 0.42)
      ) {
        const dirX = dx / (shopDist || 1);
        const dirZ = dz / (shopDist || 1);
        this.tryAutoTravelDash(dirX, dirZ, shopDist);
        return { moveX: dirX, moveZ: dirZ };
      }
      this.hero.ai.repathTimer -= dt;
      const lastShopPt = this.hero.ai.path[this.hero.ai.path.length - 1];
      const pathMatchesShop =
        Boolean(lastShopPt) &&
        lastShopPt.gx === this.dungeon.shopPos.gx &&
        lastShopPt.gz === this.dungeon.shopPos.gz;
      if (!pathMatchesShop || this.hero.ai.path.length === 0 || this.hero.ai.repathTimer <= 0) {
        this.hero.ai.repathTimer = 0.7;
        this.hero.ai.path = this.buildSafeGridPath(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
      }
      const shopStep = this.followGridPath(this.hero.ai.path);
      if (shopStep) {
        const dashVec = this.getPathDashDirection(this.hero.ai.path, shopStep);
        this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
        return shopStep;
      }
    }

    // 5-bot. Bot teammates stick with the local hero instead of exploring on their own
    if (this.hero.isBot) return this.aiFollowLeader(dt);

    // 5. Strategic objective pathfinding
    this.hero.ai.repathTimer -= dt;
    if (this.hero.ai.path.length === 0 || this.hero.ai.repathTimer <= 0) {
      this.hero.ai.repathTimer = 0.85;
      let goal: { gx: number; gz: number } | null = null;

      if (!this.hasKey) {
        // Once the Relic Key has been discovered on the map, head straight for it instead of detouring!
        const keyDiscovered = Boolean(
          this.dungeon.explored[this.dungeon.keyPos.gz]?.[this.dungeon.keyPos.gx]
        );
        if (keyDiscovered) {
          goal = { gx: this.dungeon.keyPos.gx, gz: this.dungeon.keyPos.gz };
          this.hero.ai.status = 'Seeking Relic Key';
        } else {
          // Otherwise sweep the nearest unexplored non-exit chamber (no random cross-map backtracking)
          let nearestRoom: DungeonData['rooms'][number] | null = null;
          let nearestRoomDistSq = Infinity;
          for (const r of this.dungeon.rooms) {
            if (r.role === 'exit' || this.dungeon.explored[r.cz][r.cx]) continue;
            const dSq = (r.cx - heroG.gx) ** 2 + (r.cz - heroG.gz) ** 2;
            if (dSq < nearestRoomDistSq) {
              nearestRoomDistSq = dSq;
              nearestRoom = r;
            }
          }
          if (nearestRoom) {
            goal = { gx: nearestRoom.cx, gz: nearestRoom.cz };
            this.hero.ai.status = 'Exploring Chambers';
          } else {
            goal = { gx: this.dungeon.keyPos.gx, gz: this.dungeon.keyPos.gz };
            this.hero.ai.status = 'Seeking Relic Key';
          }
        }
      } else if (!this.doorUnlocked) {
        // Walk adjacent to Locked Gate to unlock it
        goal = this.findApproachTile(this.dungeon.doorPos.gx, this.dungeon.doorPos.gz);
        this.hero.ai.status = 'Unlocking Seal Gate';
      } else {
        goal = { gx: this.dungeon.stairsPos.gx, gz: this.dungeon.stairsPos.gz };
        this.hero.ai.status = 'Descending Deeper';
      }

      if (goal) {
        this.hero.ai.path = this.buildSafeGridPath(goal.gx, goal.gz);
      }
    }

    const navStep = this.followGridPath(this.hero.ai.path);
    if (navStep) {
      const dashVec = this.getPathDashDirection(this.hero.ai.path, navStep);
      this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
      return navStep;
    }

    // Fallback direct approach ONLY when line-of-sight is genuinely clear (never walk blindly into walls)
    if (!this.hasKey) {
      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const dx = kw.x - this.hero.x;
      const dz = kw.z - this.hero.z;
      const d = Math.hypot(dx, dz);
      if (
        d > 0.25 &&
        d < 3.5 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, kw.x, kw.z, this.doorUnlocked, 0.32)
      ) {
        return { moveX: dx / d, moveZ: dz / d };
      }
    } else if (!this.doorUnlocked) {
      const dw = gridToWorld(this.dungeon.doorPos.gx, this.dungeon.doorPos.gz);
      const dx = dw.x - this.hero.x;
      const dz = dw.z - this.hero.z;
      const d = Math.hypot(dx, dz);
      if (
        d > 0.25 &&
        d < 2.6 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, dw.x, dw.z, true, 0.2)
      ) {
        return { moveX: dx / d, moveZ: dz / d };
      }
    } else {
      const sw = gridToWorld(this.dungeon.stairsPos.gx, this.dungeon.stairsPos.gz);
      const dx = sw.x - this.hero.x;
      const dz = sw.z - this.hero.z;
      const d = Math.hypot(dx, dz);
      if (
        d > 0.2 &&
        d < 3.5 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, sw.x, sw.z, this.doorUnlocked, 0.32)
      ) {
        return { moveX: dx / d, moveZ: dz / d };
      }
    }

    return { moveX: 0, moveZ: 0 };
  },

  /**
   * Step 4a-1 of the auto-pilot (the local hero only, never a bot): once a treasure chest has been discovered (its tile is on
   * the minimap) and no live monster is near the hero or the chest, walk there and open it, one chest after the other.
   * Never runs during a fight: the enemy steps above return first, and a monster close to the hero or the chest vetoes it.
   */
  aiTreasureStep(this: EmbervaultEngine, dt: number): { moveX: number; moveZ: number } | null {
    const t = this.dungeon.treasure;
    const me = this.hero;
    if (!t || me.isBot || me.isRemote || me.isDead) return null;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < t.chests.length; i++) {
      const c = t.chests[i];
      const ent = this.treasureRigs[i];
      if (c.opened || !ent || !this.dungeon.explored[c.gz]?.[c.gx]) continue;
      const d = Math.hypot(ent.x - me.x, ent.z - me.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const ent = this.treasureRigs[best];
    const threat = TREASURE_CONFIG.autoThreatRange;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - me.x, e.z - me.z) < threat || Math.hypot(e.x - ent.x, e.z - ent.z) < threat) return null;
    }
    const ai = me.ai;
    if (bestD <= TREASURE_CONFIG.autoOpenRange) {
      ai.status = 'Opening Treasure';
      ai.progressAnchorX = me.x;
      ai.progressAnchorZ = me.z;
      ai.noProgressTimer = 0;
      ai.stuckTimer = 0;
      ai.stuckCount = 0;
      ai.lastCheckX = me.x;
      ai.lastCheckZ = me.z;
      this.useNearbyTreasureChest(TREASURE_CONFIG.autoOpenRange);
      return { moveX: 0, moveZ: 0 };
    }
    ai.status = 'Seeking Treasure';
    const dx = ent.x - me.x;
    const dz = ent.z - me.z;
    if (ai.forcePathTimer <= 0 && hasLineOfSight(this.dungeon, me.x, me.z, ent.x, ent.z, this.doorUnlocked, 0.4)) {
      const dirX = dx / (bestD || 1);
      const dirZ = dz / (bestD || 1);
      this.tryAutoTravelDash(dirX, dirZ, bestD);
      return { moveX: dirX, moveZ: dirZ };
    }
    const goal = t.chests[best];
    ai.repathTimer -= dt;
    const last = ai.path[ai.path.length - 1];
    if (ai.path.length === 0 || ai.repathTimer <= 0 || !last || last.gx !== goal.gx || last.gz !== goal.gz) {
      ai.repathTimer = 0.65;
      ai.path = this.buildSafeGridPath(goal.gx, goal.gz);
    }
    const step = this.followGridPath(ai.path);
    if (step) {
      const dashVec = this.getPathDashDirection(ai.path, step);
      this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
      return step;
    }
    return null;
  },

  /**
   * Step 1b-2 of the auto-pilot. Walks to the nearest downed teammate and holds still beside them (announcing the
   * rescue through `rescueTargetId`, which `updateRescue` turns into progress). Returns null when there is nothing
   * to rescue, or when enemies are standing on the downed hero (fight them first so the rescue is not cancelled).
   */
  aiRescueStep(this: EmbervaultEngine, dt: number): { moveX: number; moveZ: number } | null {
    const me = this.hero;
    me.rescueTargetId = null;
    if (this.inTown) return null;
    let target: Hero | null = null;
    let bestD = Infinity;
    const away = this.isAwayMode(me);
    for (const o of this.heroes) {
      if (o === me || !o.isDead) continue;
      if (away && !this.withinLeash(o.x, o.z, 10)) continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      if (d < bestD) {
        bestD = d;
        target = o;
      }
    }
    if (!target || bestD > 45) return null;
    for (const e of this.enemies) {
      if (!e.dead && e.stunTimer <= 0.1 && Math.hypot(e.x - target.x, e.z - target.z) < 2.4) return null;
    }
    const ai = me.ai;
    if (bestD <= 1.1) {
      // Hold still next to them; keep the stuck detectors quiet
      me.rescueTargetId = target.id;
      ai.status = 'Rescuing Ally';
      ai.progressAnchorX = me.x;
      ai.progressAnchorZ = me.z;
      ai.noProgressTimer = 0;
      ai.stuckTimer = 0;
      ai.stuckCount = 0;
      ai.lastCheckX = me.x;
      ai.lastCheckZ = me.z;
      return { moveX: 0, moveZ: 0 };
    }
    ai.status = 'Running to Rescue';
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    if (ai.forcePathTimer <= 0 && hasLineOfSight(this.dungeon, me.x, me.z, target.x, target.z, this.doorUnlocked, 0.4)) {
      return { moveX: dx / bestD, moveZ: dz / bestD };
    }
    const tg = worldToWalkableGrid(this.dungeon, target.x, target.z, this.doorUnlocked);
    ai.repathTimer -= dt;
    const last = ai.path[ai.path.length - 1];
    if (ai.path.length === 0 || ai.repathTimer <= 0 || !last || last.gx !== tg.gx || last.gz !== tg.gz) {
      ai.repathTimer = 0.5;
      ai.path = this.buildSafeGridPath(tg.gx, tg.gz);
    }
    const step = this.followGridPath(ai.path);
    if (step) return step;
    return { moveX: dx / bestD, moveZ: dz / bestD };
  },

  /**
   * True when a companion (bot or pet) at (x, z) is far enough from its leader/owner to be warped back: near the
   * screen edge when the leader is the camera's hero, otherwise beyond COMPANION_WARP_DIST.
   */
  isCompanionTooFar(this: EmbervaultEngine, leader: { x: number; z: number }, x: number, z: number): boolean {
    const d = Math.hypot(x - leader.x, z - leader.z);
    if (d < 4) return false;
    if (leader !== this.localHero || this.inTown) return d > COMPANION_WARP_DIST;
    _projVec.set(x, 0.6, z).project(this.camera);
    return Math.abs(_projVec.x) > COMPANION_EDGE_NDC || Math.abs(_projVec.y) > COMPANION_EDGE_NDC;
  },

  /** Bot while the local hero is in town (spec §3.4): wait at the post the local hero left from. */
  isAwayMode(this: EmbervaultEngine, me: Hero): boolean {
    return me.isBot && this.localHero.inTown;
  },

  withinLeash(this: EmbervaultEngine, x: number, z: number, radius: number): boolean {
    const a = this.awayAnchor;
    if (!a) return true;
    return Math.hypot(x - a.x, z - a.z) <= radius;
  },

  /**
   * Bot teammates: keep within a few tiles of the local hero (or, while the local hero is in town, of the post
   * they left from); hold still (no stuck-detector churn) when close.
   */
  aiFollowLeader(this: EmbervaultEngine, dt: number): { moveX: number; moveZ: number } {
    const me = this.hero;
    const ai = me.ai;
    const away = this.isAwayMode(me);
    const leader: { x: number; z: number } =
      away && this.awayAnchor ? this.awayAnchor : this.localHero;
    if (leader === me) return { moveX: 0, moveZ: 0 };
    const dx = leader.x - me.x;
    const dz = leader.z - me.z;
    const dist = Math.hypot(dx, dz);
    // Waiting bots stand spread out within ~3 of the post
    const slot = away ? 0.9 + (me.botIndex % 3) * 0.6 : 1.8 + (me.botIndex % 3) * 0.9;
    if (away ? dist > 36 : this.isCompanionTooFar(leader, me.x, me.z)) {
      // Separated (snagged behind a wall / the gate, or about to leave the screen): catch up instantly
      this.warpHeroNear(me, leader.x, leader.z, me.botIndex - 1);
      return { moveX: 0, moveZ: 0 };
    }
    if (dist <= slot + (away ? 0.6 : 1.2)) {
      ai.status = away ? 'Holding Post' : 'Following Leader';
      ai.progressAnchorX = me.x;
      ai.progressAnchorZ = me.z;
      ai.noProgressTimer = 0;
      ai.stuckTimer = 0;
      ai.stuckCount = 0;
      ai.lastCheckX = me.x;
      ai.lastCheckZ = me.z;
      ai.path = [];
      return { moveX: 0, moveZ: 0 };
    }
    ai.status = 'Following Leader';
    if (ai.forcePathTimer <= 0 && hasLineOfSight(this.dungeon, me.x, me.z, leader.x, leader.z, this.doorUnlocked, 0.42)) {
      ai.path = [];
      if (dist > 9) this.tryAutoTravelDash(dx / dist, dz / dist, dist);
      return { moveX: dx / dist, moveZ: dz / dist };
    }
    const lg = worldToWalkableGrid(this.dungeon, leader.x, leader.z, this.doorUnlocked);
    ai.repathTimer -= dt;
    const last = ai.path[ai.path.length - 1];
    if (ai.path.length === 0 || ai.repathTimer <= 0 || !last || Math.abs(last.gx - lg.gx) + Math.abs(last.gz - lg.gz) > 3) {
      ai.repathTimer = 0.6;
      ai.path = this.buildSafeGridPath(lg.gx, lg.gz);
    }
    const step = this.followGridPath(ai.path);
    if (step) return step;
    return { moveX: dx / dist, moveZ: dz / dist };
  },

  findApproachTile(this: EmbervaultEngine, gx: number, gz: number): { gx: number; gz: number } {
    const start = worldToGrid(this.hero.x, this.hero.z);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const nx = gx + dx;
      const nz = gz + dz;
      if (isTileWalkable(this.dungeon, nx, nz, false)) {
        const p = findGridPath(this.dungeon, start.gx, start.gz, nx, nz, false);
        if (p.length > 0 || (nx === start.gx && nz === start.gz)) {
          return { gx: nx, gz: nz };
        }
      }
    }
    return { gx, gz };
  },
};
