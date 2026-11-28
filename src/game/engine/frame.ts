import type { EmbervaultEngine } from '../engine';
import { HERO_CLASSES } from '../classes';
import { gridToWorld, worldToGrid } from '../dungeon';
import * as THREE from 'three';

export const frameMethods = {
  /**
   * Spec §3.4: while the local hero is in town and a teammate is alive in the dungeon, the dungeon keeps running
   * (enemies, bot fights, projectiles, objectives) without being rendered. Its level fields are swapped in for the
   * step and nothing may reach the screen (HUD, particles, floating text, sounds ...). When nobody is left alive
   * there the floor is frozen the same way a single player return freezes it.
   */
  runDungeonBackground(this: EmbervaultEngine, dt: number): void {
    if (!this.dungeonCtx) return;
    if (!this.heroes.some((h) => this.isInDungeonAlive(h))) {
      this.freezeDungeonAway();
      return;
    }
    const local = this.localHero;
    const townCtx = this.captureCtx();
    const arcsBefore = this.slashArcs.length;
    this.applyCtx(this.dungeonCtx);
    this.inTown = false;
    this.bgSim = true;
    this.audio.suppressed = true;
    try {
      if (this.mp) this.mpHostPre();
      for (const h of this.heroes) {
        if (!this.isInDungeonAlive(h)) continue;
        this.setActor(h);
        this.updateHeroFrame(dt, false);
      }
      this.setActor(local);
      this.updateRescue(dt);
      this.updateObjectives(dt);
      this.updatePets(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updateHeroProjectiles(dt);
      if (this.mp) this.updateLoot(dt);
      this.updateEnvironmentBackground();
      if (this.mp) this.mpHostPost(dt);
    } finally {
      this.dungeonCtx = this.captureCtx();
      this.applyCtx(townCtx);
      this.inTown = true;
      this.bgSim = false;
      this.setActor(local);
      for (let i = arcsBefore; i < this.slashArcs.length; i++) this.slashArcs[i].mesh.visible = false;
      for (const bar of this.rescueBars.values()) bar.group.visible = false;
      this.rescueHudActive = false;
    }
    if (this.pendingAwayFloor !== null) {
      const depth = this.pendingAwayFloor;
      this.pendingAwayFloor = null;
      this.pushBanner(`隊伍已前往第 ${depth} 層`, '傳送門已消失 · 從城鎮傳送門回到新樓層入口');
      this.emitHud();
    }
  },

  /** The last teammate in the dungeon went down while the local hero is in town: freeze the floor (spec §3.4). */
  freezeDungeonAway(this: EmbervaultEngine): void {
    if (!this.dungeonCtx) return;
    const townCtx = this.captureCtx();
    this.applyCtx(this.dungeonCtx);
    this.dungeonCtx = null;
    if (this.mp?.role === 'host') this.mpHostFreezeFlush();
    const sp = gridToWorld(this.dungeon.spawn.gx, this.dungeon.spawn.gz);
    this.savedDungeon = this.snapshotDungeon(sp);
    this.clearLevel();
    this.applyCtx(townCtx);
    this.emitHud();
  },

  /** One frame of one living hero (the actor must already be set to it): timers, input or AI, movement, rig animation.
   * Camera / light / minimap work only happens for the local hero.
   */
  updateHeroFrame(this: EmbervaultEngine, dt: number, isLocal: boolean): void {
    // Cooldowns & Relic Timers
    this.hero.attackCooldown = Math.max(0, this.hero.attackCooldown - dt * this.hero.getAttackSpeedMult());
    this.hero.attackAnim = Math.max(0, this.hero.attackAnim - dt);
    this.hero.pommelCooldown = Math.max(0, this.hero.pommelCooldown - dt);
    this.hero.pommelAnim = Math.max(0, this.hero.pommelAnim - dt);
    this.hero.comboResetTimer = Math.max(0, this.hero.comboResetTimer - dt);
    this.hero.dashCooldown = Math.max(0, this.hero.dashCooldown - dt);
    this.hero.invuln = Math.max(0, this.hero.invuln - dt);
    this.hero.hitFlash = Math.max(0, this.hero.hitFlash - dt);
    this.hero.phantomCritTimer = Math.max(0, this.hero.phantomCritTimer - dt);
    this.hero.alchemistShieldTimer = Math.max(0, this.hero.alchemistShieldTimer - dt);
    this.hero.updateShield(dt);
    this.tickRelicEffects(dt);

    // 4pc Green Set: Dragonfire Knight periodic fiery breath nova every 3.0s
    if (this.hero.hasSet4pc('dragonfire')) {
      this.hero.dragonAuraTimer -= dt;
      if (this.hero.dragonAuraTimer <= 0) {
        const nearbyEnemies = this.enemies.filter(
          (e) => !e.dead && !e.bossWarpUntargetable && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) <= 3.6
        );
        if (nearbyEnemies.length > 0) {
          this.hero.dragonAuraTimer = 3.0;
          const novaDmg = Math.max(
            5,
            Math.round((7 + this.depth * 1.1) * (1 + this.hero.atkUpgrades * 0.1 + this.hero.relicStats.atkPct / 100))
          );
          for (const e of nearbyEnemies) {
            this.applyBonusEnemyDamage(e, novaDmg, `龍息 -${novaDmg}`, 'relicOrange', 0xff5a1f);
          }
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            this.spawnParticle(
              this.hero.x + Math.cos(a) * 0.5,
              0.45,
              this.hero.z + Math.sin(a) * 0.5,
              Math.cos(a) * 5.8,
              0.7 + Math.random() * 0.8,
              Math.sin(a) * 5.8,
              i % 2 === 0 ? 0xff5a1f : 0xffd24a,
              1.15,
              0.48,
              0.5
            );
          }
        }
      }
    }

    // 1. Determine Hero Input (Manual or Auto)
    let moveX = 0;
    let moveZ = 0;

    if (this.hero.controlMode === 'manual' || this.inTown) {
      if (this.inTown) {
        this.hero.ai.status = '庇護小鎮休整中';
      }
      // Camera looks along (-1, -1) in XZ, so screen-up = (-1,-1) and screen-right = (1,-1)
      let ix = 0;
      let iy = 0;
      if (this.hero.input.keys.has('KeyW') || this.hero.input.keys.has('ArrowUp')) iy += 1;
      if (this.hero.input.keys.has('KeyS') || this.hero.input.keys.has('ArrowDown')) iy -= 1;
      if (this.hero.input.keys.has('KeyD') || this.hero.input.keys.has('ArrowRight')) ix += 1;
      if (this.hero.input.keys.has('KeyA') || this.hero.input.keys.has('ArrowLeft')) ix -= 1;

      if (ix !== 0 || iy !== 0) {
        moveX = ix - iy;
        moveZ = -ix - iy;
        const len = Math.hypot(moveX, moveZ) || 1;
        moveX /= len;
        moveZ /= len;
      }
    } else {
      const aiMove = this.updateAI(this.hero, dt);
      moveX = aiMove.moveX;
      moveZ = aiMove.moveZ;
    }

    this.hero.input.moveX = moveX;
    this.hero.input.moveZ = moveZ;

    // 2. Move Hero (Dash or Walk + Knockback)
    const moveSpeed =
      4.65 *
      HERO_CLASSES[this.hero.classId].moveSpeedMult *
      (1 + this.hero.relicStats.moveSpeedPct / 100);
    let dx = 0;
    let dz = 0;
    if (this.hero.dashTimer > 0) {
      this.hero.dashTimer -= dt;
      dx = this.hero.dashDirX * 13.5 * dt;
      dz = this.hero.dashDirZ * 13.5 * dt;
      if (Math.random() < 0.7) {
        this.spawnParticle(
          this.hero.x,
          0.6,
          this.hero.z,
          0,
          0.4,
          0,
          0x3be8e0,
          1.1,
          0.26,
          0
        );
      }
    } else {
      dx = (moveX * moveSpeed + this.hero.vx) * dt;
      dz = (moveZ * moveSpeed + this.hero.vz) * dt;
    }

    this.hero.vx *= Math.exp(-10 * dt);
    this.hero.vz *= Math.exp(-10 * dt);

    const moved = this.moveWithSlide(this.hero.x, this.hero.z, dx, dz, 0.4);
    this.hero.x = moved.x;
    this.hero.z = moved.z;

    const speedMag = Math.hypot(moveX, moveZ);
    if (speedMag > 0.08 && this.hero.dashTimer <= 0) {
      const desiredAngle = Math.atan2(moveX, moveZ);
      let diff = desiredAngle - this.hero.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.hero.facing += diff * Math.min(1, dt * 14);

      this.hero.walkCycle += dt * 11.5;
      this.hero.footstepTimer -= dt;
      if (this.hero.footstepTimer <= 0) {
        this.hero.footstepTimer = 0.28;
        this.audio.playFootstep();
      }
    } else {
      this.hero.walkCycle *= 0.85;
    }

    // Hold-to-attack: aim at the cursor every frame (overrides walk facing) and fire when ready
    this.updateHeldAttack();
    // Auto-attack toggle: swing / shoot at the nearest enemy in range when nothing is held
    this.updateAutoAttack();

    // 3. Animate Hero Composite Rig
    this.hero.rig.root.position.set(this.hero.x, 0, this.hero.z);
    this.hero.rig.body.rotation.y = this.hero.facing;
    const stride = Math.sin(this.hero.walkCycle) * (speedMag > 0.1 ? 0.55 : 0);
    this.hero.rig.leftLeg.rotation.x = stride;
    this.hero.rig.rightLeg.rotation.x = -stride;
    this.hero.rig.body.position.y = Math.abs(Math.sin(this.hero.walkCycle)) * (speedMag > 0.1 ? 0.08 : 0);
    this.hero.rig.cape.rotation.x = 0.14 + (speedMag > 0.1 ? 0.22 : 0) + Math.sin(this.elapsed * 3.5) * 0.05;
    this.hero.rig.lanternPivot.rotation.z = Math.sin(this.elapsed * 4.2 + this.hero.walkCycle * 0.5) * 0.16;

    // Sword swing / Pommel Strike arm & hilt animation
    if (this.hero.pommelAnim > 0) {
      const p = 1 - this.hero.pommelAnim / 0.34;
      // Reverse sword grip so pommel/hilt juts forward & slams down with a crisp torque twist
      this.hero.rig.swordGroup.rotation.x = -Math.PI * 0.56;
      const slamCurve = Math.sin(p * Math.PI);
      this.hero.rig.rightArm.rotation.x = -1.35 + slamCurve * 1.15;
      this.hero.rig.rightArm.rotation.y = -0.35 + p * 1.35;
      this.hero.rig.body.rotation.y = this.hero.facing + slamCurve * 0.72;
    } else if (this.hero.attackAnim > 0) {
      const p = 1 - this.hero.attackAnim / 0.28;
      this.hero.rig.swordGroup.rotation.x = THREE.MathUtils.damp(
        this.hero.rig.swordGroup.rotation.x,
        Math.PI * 0.42,
        22,
        dt
      );
      this.hero.rig.rightArm.rotation.x = -1.6 + p * 2.4;
      this.hero.rig.rightArm.rotation.y = -0.7 + p * 1.6;
    } else {
      this.hero.rig.swordGroup.rotation.x = THREE.MathUtils.damp(
        this.hero.rig.swordGroup.rotation.x,
        Math.PI * 0.42,
        16,
        dt
      );
      this.hero.rig.rightArm.rotation.x = THREE.MathUtils.damp(this.hero.rig.rightArm.rotation.x, -stride * 0.4, 12, dt);
      this.hero.rig.rightArm.rotation.y = THREE.MathUtils.damp(this.hero.rig.rightArm.rotation.y, 0, 12, dt);
    }

    // Hero Hit Flash
    const heroEmissive =
      this.hero.hitFlash > 0 ? (this.hero.hitShieldOnly ? 0x6fd8ff : 0xff3b3b) : 0x000000;
    for (const m of this.hero.rig.flashMaterials) {
      m.emissive.setHex(heroEmissive);
      m.emissiveIntensity = this.hero.hitFlash > 0 ? 0.75 : 0;
    }

    // Hero Flickering Lantern Light + Warm Floor Glow Pool + Rising Ember Trail + 4pc Set Aura
    const flicker =
      Math.sin(this.elapsed * 14.3) * 2.4 +
      Math.sin(this.elapsed * 29.7) * 1.4 +
      Math.cos(this.elapsed * 8.1) * 1.6;
    const lanternOffX = Math.sin(this.hero.facing - 0.55) * 0.65;
    const lanternOffZ = Math.cos(this.hero.facing - 0.55) * 0.65;
    if (isLocal) {
      // Only the local hero carries a real lantern light (bots stay cheap)
      const lanternBoost = 1 + this.hero.relicStats.lanternGlowPct / 100;
      this.heroLight.intensity = (56.0 + flicker) * lanternBoost;
      this.heroLight.distance = 11.2 * (1 + (this.hero.relicStats.lanternGlowPct / 100) * 0.45);
      // Mage: lift the light well above her head so the pale robe/hair isn't blown out at close range
      const lightRise = this.hero.isMage() ? 1.25 : 1;
      this.heroLight.position.set(
        this.hero.x + lanternOffX * lightRise,
        this.hero.isMage() ? 2.9 : 1.85,
        this.hero.z + lanternOffZ * lightRise
      );
      this.heroFloorGlow.position.set(this.hero.x + lanternOffX * 0.5, 0.022, this.hero.z + lanternOffZ * 0.5);
      (this.heroFloorGlow.material as THREE.MeshBasicMaterial).opacity = 0.36 + flicker * 0.008;
    }

    if (this.hero.setAura && this.hero.setAura.group.visible) {
      this.hero.setAura.outerRing.rotation.z += dt * 1.1;
      this.hero.setAura.innerRing.rotation.z -= dt * 1.9;
      const pulse = 0.96 + Math.sin(this.elapsed * 4.2) * 0.08;
      this.hero.setAura.group.scale.setScalar(pulse);
    }

    this.hero.emberSpawnTimer -= dt;
    if (this.hero.emberSpawnTimer <= 0) {
      this.hero.emberSpawnTimer = 0.085;
      this.spawnParticle(
        this.hero.x + lanternOffX + (Math.random() - 0.5) * 0.18,
        1.25,
        this.hero.z + lanternOffZ + (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.5) * 0.45,
        0.9 + Math.random() * 0.9,
        (Math.random() - 0.5) * 0.45,
        this.hero.isMage()
          ? Math.random() < 0.75
            ? 0xbff4ff
            : 0xffe066
          : Math.random() < 0.5
          ? 0xffcf5c
          : 0xff7c24,
        0.72,
        0.85,
        -0.1
      );
    }

    if (isLocal) {
      // Keep global rim shadow camera centered on the local hero
      this.rimLight.position.set(this.hero.x - 10, 22, this.hero.z - 8);
      this.rimLight.target.position.set(this.hero.x, 0, this.hero.z);

      // Explore fog-of-war on minimap
      const heroG = worldToGrid(this.hero.x, this.hero.z);
      this.markExplored(heroG.gx, heroG.gz);
    }
  },

  updateObjectives(this: EmbervaultEngine, dt: number): void {
    // Key Pickup
    if (this.keyPedestal && !this.hasKey) {
      this.keyPedestal.keyMesh.rotation.y += dt * 2.1;
      this.keyPedestal.keyMesh.position.y = 1.05 + Math.sin(this.elapsed * 3.4) * 0.14;

      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      // The key (and the gate / hasKey flag) belong to the whole team: any living hero can claim it
      for (const h of this.heroes) {
        if (h.isDead || h.inTown || Math.hypot(h.x - kw.x, h.z - kw.z) >= 1.45) continue;
        this.setActor(h);
        this.hasKey = true;
        this.keyPedestal.keyMesh.visible = false;
        this.keyPedestal.halo.visible = false;
        this.audio.playKeyFound();
        this.pushBanner('RELIC KEY CLAIMED', 'Seek the Sealed Gate', true);
        this.emitFloatingText(kw.x, 1.8, kw.z, 'RELIC KEY!', 'key', true);
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          this.spawnParticle(
            kw.x,
            1.0,
            kw.z,
            Math.cos(a) * 3.2,
            2.2 + Math.random() * 2,
            Math.sin(a) * 3.2,
            0xffdd55,
            1.2,
            0.75,
            4.5
          );
        }
        this.hero.ai.path = [];
        this.setActor(this.localHero);
        this.emitHud();
        break;
      }
    }

    // Locked Gate Unlocking & Swinging Open
    if (this.gateRig) {
      const dw = gridToWorld(this.dungeon.doorPos.gx, this.dungeon.doorPos.gz);
      const opener = this.hasKey && !this.doorUnlocked
        ? this.heroes.find((h) => !h.isDead && !h.inTown && Math.hypot(h.x - dw.x, h.z - dw.z) < 2.85)
        : undefined;
      if (this.hasKey && !this.doorUnlocked) {
        if (opener) {
          this.setActor(opener);
          this.doorUnlocked = true;
          this.gateRig.lockGlow.visible = false;
          this.audio.playDoorUnlock();
          this.addScreenShake(0.18, 0.22);
          this.pushBanner('SEAL GATE UNLOCKED', 'The Stairwell Awaits', true);
          for (let i = 0; i < 22; i++) {
            this.spawnParticle(
              dw.x + (Math.random() - 0.5) * 1.2,
              1.1 + (Math.random() - 0.5) * 0.6,
              dw.z + (Math.random() - 0.5) * 1.2,
              (Math.random() - 0.5) * 3.5,
              1.6 + Math.random() * 2.2,
              (Math.random() - 0.5) * 3.5,
              0xffd24a,
              1.15,
              0.7,
              3.5
            );
          }
          this.hero.ai.path = [];
          this.setActor(this.localHero);
          this.emitHud();
        }
      }

      if (this.doorUnlocked && this.gateOpenProgress < 1) {
        this.gateOpenProgress = Math.min(1, this.gateOpenProgress + dt * 2.4);
        const ease = 1 - Math.pow(1 - this.gateOpenProgress, 3);
        this.gateRig.leftPivot.rotation.y = -ease * Math.PI * 0.62;
        this.gateRig.rightPivot.rotation.y = ease * Math.PI * 0.62;
      }
    }

    // Stairwell Descent
    if (this.doorUnlocked && this.transitionState === 'none') {
      const sw = gridToWorld(this.dungeon.stairsPos.gx, this.dungeon.stairsPos.gz);
      // Taking the stairs moves the whole team (any living hero can trigger it)
      if (this.heroes.some((h) => !h.isDead && !h.inTown && Math.hypot(h.x - sw.x, h.z - sw.z) < 1.25)) {
        const descend = () => {
          for (const h of this.heroes) {
            if (h.inTown) continue;
            h.hp = Math.min(h.getEffectiveMaxHp(), h.hp + 20);
          }
          this.buildLevel(this.depth + 1, { tickBuffFloor: true });
        };
        if (this.bgSim) {
          // A teammate took the stairs while the local hero is in town: no fade, the town just gets a notice
          descend();
        } else {
          this.audio.playDescend();
          this.beginTransition(descend);
        }
      }
    }
  },
};
