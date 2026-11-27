import type { EmbervaultEngine } from '../engine';
import { ACT_DASH, ACT_POMMEL, ACT_POTION } from '../../../shared/game';
import { FROST_MAGE, HERO_CLASSES, HUNTER } from '../classes';
import { hasLineOfSight } from '../dungeon';
import { BOSS_CONFIGS, BOSS_MELEE_DAMAGE_TAKEN_MULT, isFloorBoss, isGuardianEnemy, isSwarmEnemy } from './data';
import { EnemyEntity, HeroHitParams } from './entities';
import { createFrozenShell, createSlowMarker, createStunStars } from '../models';
import { FloatingLabelData } from '../types';
import * as THREE from 'three';

export const heroCombatMethods = {
  usePotion(this: EmbervaultEngine): void {
    const effMax = this.hero.getEffectiveMaxHp();
    // Single player: the local hero's elixir also heals the bot teammates, so drinking is allowed while any of them is hurt
    const healsBots = !this.mp && this.hero === this.localHero && !this.hero.isBot;
    const hurtBots = healsBots
      ? this.heroes.filter((h) => h.isBot && !h.isDead && !h.inTown && h.hp < h.getEffectiveMaxHp())
      : [];
    if (this.hero.isDead || this.hero.potions <= 0 || (this.hero.hp >= effMax && hurtBots.length === 0)) return;
    if (this.mpGuestDungeon()) {
      // The host drinks it for me (HP / potions come back with its next snapshot / private state)
      this.mpQueueAction(ACT_POTION);
      return;
    }

    const hasAlchemist = this.hero.hasUnique('alchemist_free_flask');
    const savedFlask = hasAlchemist && Math.random() < 0.2;
    if (!savedFlask) {
      this.hero.potions -= 1;
    }
    this.hero.potionsUsed += 1;
    if (hasAlchemist) {
      this.hero.alchemistShieldTimer = 3.0;
    }

    const noodleBonus = this.hero.hasUnique('noodle_elixir_boost') ? 15 : 0;
    const classPotionMult = HERO_CLASSES[this.hero.classId].potionHealMult;
    const baseHeal =
      Math.round(40 * classPotionMult * (1 + this.hero.relicStats.potionHealPct / 100)) +
      noodleBonus;
    const heal = Math.min(baseHeal, effMax - this.hero.hp);
    this.hero.hp = Math.min(effMax, this.hero.hp + heal);
    for (const b of hurtBots) {
      const bMax = b.getEffectiveMaxHp();
      const bHeal = Math.min(baseHeal, bMax - b.hp);
      b.hp = Math.min(bMax, b.hp + bHeal);
      if (bHeal > 0) this.emitFloatingText(b.x, 1.8, b.z, `+${Math.round(bHeal)} HP`, 'heal');
    }
    this.audio.playPotion();
    this.pushBanner(
      savedFlask ? '秘藥奇蹟 · 不耗藥水!' : noodleBonus > 0 ? '泡麵加湯回復!' : 'ELIXIR USED'
    );
    this.emitFloatingText(
      this.hero.x,
      1.8,
      this.hero.z,
      savedFlask ? `+${heal} HP (免費!)` : noodleBonus > 0 ? `+${heal} HP 暖胃!` : `+${heal} HP`,
      'heal'
    );

    // Burst of crimson & emerald restorative motes
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.spawnParticle(
        this.hero.x + Math.cos(a) * 0.4,
        0.5,
        this.hero.z + Math.sin(a) * 0.4,
        Math.cos(a) * 1.2,
        2.2 + Math.random() * 1.4,
        Math.sin(a) * 1.2,
        i % 2 === 0 ? 0xff4d6d : 0x52ffa8,
        1.1,
        0.65,
        -1.2
      );
    }
    this.emitHud();
  },

  performDash(this: EmbervaultEngine): void {
    if (this.hero.dashCooldown > 0 || this.hero.dashTimer > 0) return;
    if (this.mpGuestDungeon()) this.mpQueueAction(ACT_DASH); // predicted here, executed by the host too
    if (this.hero.isMage()) {
      this.performBlink();
      return;
    }
    this.hero.dashTimer = 0.16;
    this.hero.dashCooldown = Math.max(0.35, 1.1 * (1 - this.hero.relicStats.dashCdPct / 100));
    this.hero.invuln = Math.max(this.hero.invuln, 0.28);
    if (this.hero.hasUnique('phantom_dash_crit')) {
      this.hero.phantomCritTimer = 2.0;
    }
    this.hero.dashDirX = Math.sin(this.hero.facing);
    this.hero.dashDirZ = Math.cos(this.hero.facing);
    this.audio.playDash();

    // Unique: Phoenix Plume — fiery ring nova when dashing
    if (this.hero.hasUnique('phoenix_dash_nova')) {
      const dashAtkMult = 1 + this.hero.atkUpgrades * 0.1 + this.hero.relicStats.atkPct / 100;
      const fireDmg = Math.max(8, Math.round(14 * dashAtkMult));
      for (const e of this.enemies) {
        if (e.dead) continue;
        const edx = e.x - this.hero.x;
        const edz = e.z - this.hero.z;
        const edist = Math.hypot(edx, edz);
        if (edist <= 3.4) {
          const push = e.isBoss ? 1.8 : 6.0;
          e.vx += (edx / (edist || 1)) * push;
          e.vz += (edz / (edist || 1)) * push;
          this.applyBonusEnemyDamage(e, fireDmg, `鳳焰 -${fireDmg}`, 'relicOrange', 0xff6224);
        }
      }
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x + Math.cos(a) * 0.35,
          0.55,
          this.hero.z + Math.sin(a) * 0.35,
          Math.cos(a) * 5.2,
          1.1 + Math.random() * 1.4,
          Math.sin(a) * 5.2,
          i % 2 === 0 ? 0xff5a1f : 0xffd24a,
          1.2,
          0.45,
          1.5
        );
      }
    }

    for (let i = 0; i < 12; i++) {
      this.spawnParticle(
        this.hero.x + (Math.random() - 0.5) * 0.5,
        0.4 + Math.random() * 0.7,
        this.hero.z + (Math.random() - 0.5) * 0.5,
        -this.hero.dashDirX * (1.2 + Math.random()),
        0.8 + Math.random(),
        -this.hero.dashDirZ * (1.2 + Math.random()),
        i % 2 === 0 ? 0x3be8e0 : 0xffbe55,
        1.15,
        0.38,
        0
      );
    }
    this.emitHud();
  },

  /**
   * Boss rework (docs/boss-spec.md section 2): melee bosses take 25% less damage from every source. Called as the very
   * last step of each damage calculation (after crit / relic / set multipliers), right before the HP is reduced and the
   * floating text is built, so the number shown is the HP that was really removed.
   */
  scaleEnemyDamageTaken(this: EmbervaultEngine, enemy: EnemyEntity, dmg: number): number {
    if (!enemy.isBoss || !isFloorBoss(enemy.kind) || BOSS_CONFIGS[enemy.kind].bossType !== 'melee') return dmg;
    return Math.max(1, Math.round(dmg * BOSS_MELEE_DAMAGE_TAKEN_MULT));
  },

  applyBonusEnemyDamage(
    this: EmbervaultEngine,
    enemy: EnemyEntity,
    bonusDmg: number,
    label: string,
    tone: FloatingLabelData['tone'],
    particleColor: number
  ): void {
    if (enemy.dead || bonusDmg <= 0) return;
    const rawDmg = bonusDmg;
    bonusDmg = this.scaleEnemyDamageTaken(enemy, bonusDmg);
    if (bonusDmg !== rawDmg) label = label.replace(`-${rawDmg}`, `-${bonusDmg}`);
    enemy.hp -= bonusDmg;
    enemy.hitFlash = 0.12;
    this.hero.totalDamageDealt += bonusDmg;
    this.hero.ai.lastCombatDamageTime = this.elapsed;
    this.emitFloatingText(enemy.x, enemy.isBoss ? 2.4 : 1.75, enemy.z, label, tone);
    for (let i = 0; i < 6; i++) {
      this.spawnParticle(
        enemy.x,
        0.9,
        enemy.z,
        (Math.random() - 0.5) * 4.2,
        1.4 + Math.random() * 2.0,
        (Math.random() - 0.5) * 4.2,
        particleColor,
        0.95,
        0.38,
        5
      );
    }
    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    }
  },

  performAttack(this: EmbervaultEngine): void {
    if (this.hero.attackCooldown > 0) return;
    if (this.hero.isMage()) {
      this.performMageAttack();
      return;
    }
    if (this.hero.isHunter()) {
      this.performHunterAttack();
      return;
    }

    this.hero.comboStep = this.hero.comboResetTimer > 0 ? (this.hero.comboStep + 1) % 3 : 0;
    this.hero.comboResetTimer = 0.9;
    const isCleave = this.hero.comboStep === 2;

    this.hero.attackCooldown = isCleave ? 0.42 : 0.28;
    this.hero.attackAnim = isCleave ? 0.34 : 0.24;
    this.audio.playSwordSlash(isCleave);

    // Spawn luminous crescent sword slash VFX mesh
    const arcGeo = isCleave
      ? new THREE.RingGeometry(0.75, 2.05, 24, 1, 0, Math.PI * 1.85)
      : new THREE.RingGeometry(0.65, 1.85, 14, 1, -Math.PI * 0.48, Math.PI * 0.96);
    const arcColor = this.hero.hasSet4pc('dragonfire')
      ? 0xff7b29
      : this.hero.hasSet4pc('voidstalker')
      ? 0xc88cff
      : this.hero.hasSet4pc('syndicate')
      ? 0xffe066
      : isCleave
      ? 0xffdf7a
      : 0xf2f8ff;
    const arcMat = new THREE.MeshBasicMaterial({
      color: arcColor,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const arcMesh = new THREE.Mesh(arcGeo, arcMat);
    arcMesh.rotation.x = -Math.PI / 2;
    arcMesh.rotation.z = this.hero.facing - Math.PI / 2;
    arcMesh.position.set(this.hero.x, 0.85, this.hero.z);
    this.scene.add(arcMesh);
    this.slashArcs.push({
      mesh: arcMesh,
      life: 0,
      maxLife: isCleave ? 0.24 : 0.16,
      isCleave,
    });

    const reach = isCleave ? 2.55 : 2.25;
    const fwdX = Math.sin(this.hero.facing);
    const fwdZ = Math.cos(this.hero.facing);
    let landedHit = false;
    const effMaxHp = this.hero.getEffectiveMaxHp();
    const usePhantomCrit = this.hero.phantomCritTimer > 0;
    const hitState = { consumedPhantom: false, triggeredStorm: false };

    const avariceBonus = this.hero.hasUnique('avarice_gold_atk')
      ? Math.min(0.4, Math.floor(this.hero.gold / 100) * 0.01)
      : 0;
    const titanFuryBonus =
      this.hero.hasUnique('titan_low_hp_fury') && this.hero.hp / Math.max(1, effMaxHp) < 0.4 ? 0.18 : 0;
    const berserkerBonus = this.hero.hasUnique('berserker_combo_ramp')
      ? Math.min(0.25, this.hero.floorKills * 0.01)
      : 0;
    const atkMult =
      1 +
      this.hero.atkUpgrades * 0.1 +
      this.hero.relicStats.atkPct / 100 +
      avariceBonus +
      titanFuryBonus +
      berserkerBonus;
    const critChance = Math.min(
      0.95,
      (isCleave ? 0.5 : 0.11) + this.hero.critUpgrades * 0.02 + this.hero.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100 + (usePhantomCrit ? 0.25 : 0);
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;

    // Damage enemies in arc
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - this.hero.x;
      const dz = enemy.z - this.hero.z;
      const dist = Math.hypot(dx, dz);
      const effectiveReach = reach + (enemy.isBoss ? 0.5 : enemy.isElite ? 0.18 : 0);
      if (dist > effectiveReach) continue;

      if (!isCleave && dist > 0.25) {
        const dot = (dx * fwdX + dz * fwdZ) / dist;
        if (dot < -0.15) continue;
      }
      this.applyHeroHit(enemy, {
        baseDmg: isCleave ? 18 + Math.floor(Math.random() * 8) : 11 + Math.floor(Math.random() * 6),
        isEmpowered: isCleave,
        atkMult,
        critChance,
        critMult,
        knockMult,
        knockBase: isCleave ? 8.5 : 5.5,
        originX: this.hero.x,
        originZ: this.hero.z,
        fallbackX: fwdX,
        fallbackZ: fwdZ,
        usePhantomCrit,
        effMaxHp,
        state: hitState,
      });
      landedHit = true;
    }

    if (hitState.consumedPhantom) {
      this.hero.phantomCritTimer = 0;
    }

    // Smash nearby crates & urns
    for (const br of this.breakables) {
      if (br.broken) continue;
      const dist = Math.hypot(br.x - this.hero.x, br.z - this.hero.z);
      if (dist <= reach * 0.92) {
        this.breakProp(br);
        landedHit = true;
      }
    }

    if (landedHit) {
      this.audio.playHit(isCleave);
      if (!this.isSilentActor() && !this.mp) this.hitStopTimer = isCleave ? 0.055 : 0.03;
      this.addScreenShake(isCleave ? 0.26 : 0.14, 0.14);
    }
  },

  /**
   * Applies one hero basic-attack hit to an enemy: damage roll, crit, knockback,
   * floating text, and every "on hit" relic / set effect. Shared by the warrior's
   * sword arc and the Frost Mage's ice spike explosions.
   */
  applyHeroHit(this: EmbervaultEngine, enemy: EnemyEntity, hit: HeroHitParams): void {
    const dx = enemy.x - hit.originX;
    const dz = enemy.z - hit.originZ;
    const dist = Math.hypot(dx, dz);

    const isCounter = enemy.isBoss && enemy.bossState === 'recover';
    const { atkMult, critChance, critMult, knockMult, usePhantomCrit, effMaxHp } = hit;
    const baseDmg = hit.baseDmg;
    const bananaSlip = this.hero.hasUnique('banana_slip_crit') && Math.random() < 0.15;
    const isCrit = isCounter || usePhantomCrit || bananaSlip || Math.random() < critChance;
    if (usePhantomCrit) hit.state.consumedPhantom = true;

    let mult = atkMult * (isCounter ? Math.max(1.45, critMult) : isCrit ? critMult : 1);
    if (bananaSlip) {
      mult *= 1.4;
    }
    if (enemy.isBoss || enemy.isElite) {
      mult *= 1 + this.hero.relicStats.eliteBossDmgPct / 100;
    }
    if (this.hero.hasUnique('executioner_finisher') && enemy.hp / Math.max(1, enemy.maxHp) < 0.3) {
      mult *= enemy.isBoss ? 1.25 : 1.5;
    }

    let gamblerTag = bananaSlip ? '滑倒! ' : '';
    if (this.hero.hasUnique('gambler_coin_flip')) {
      const gRoll = Math.random();
      if (gRoll < 0.25) {
        mult *= 1.6;
        gamblerTag += 'JACKPOT ';
      } else if (gRoll < 0.35) {
        mult *= 0.7;
        gamblerTag += 'SLIP ';
      }
    }

    const dmg = this.scaleEnemyDamageTaken(enemy, Math.max(1, Math.round(baseDmg * mult)));

    this.hero.totalDamageDealt += dmg;
    if (isCrit) this.hero.critCount += 1;
    this.hero.ai.lastCombatDamageTime = this.elapsed;

    enemy.hp -= dmg;
    enemy.hitFlash = 0.14;
    const nx = dist > 0.01 ? dx / dist : hit.fallbackX;
    const nz = dist > 0.01 ? dz / dist : hit.fallbackZ;
    const knock =
      hit.knockBase *
      knockMult *
      (bananaSlip ? 1.85 : 1) *
      (enemy.isBoss ? 0.22 : enemy.isElite ? 0.45 : 1);
    enemy.vx += nx * knock;
    enemy.vz += nz * knock;

    this.emitFloatingText(
      enemy.x,
      enemy.isBoss ? 2.35 : enemy.isElite ? 2.0 : 1.55,
      enemy.z,
      `${gamblerTag}${isCounter ? `COUNTER -${dmg}` : isCrit ? `CRIT -${dmg}` : `-${dmg}`}`,
      isCrit ? 'crit' : 'damage'
    );

    // Unique: Overtime Mug — funny quips when hitting Elites/Bosses
    if (
      (enemy.isBoss || enemy.isElite) &&
      this.hero.hasUnique('overtime_mug_fury') &&
      Math.random() < 0.2
    ) {
      const quips = ['準時下班!', '不准加班!', '拒絕開會!', '我要打卡!'];
      this.emitFloatingText(
        enemy.x,
        (enemy.isBoss ? 2.75 : 2.35),
        enemy.z,
        quips[Math.floor(Math.random() * quips.length)],
        'relicOrange'
      );
    }

    // Unique: Blood Moon Fang lifesteal (quarter strength: 1.5% with fractional accumulation)
    if (this.hero.hasUnique('blood_moon_leech') && this.hero.hp < effMaxHp) {
      this.hero.bloodLeechAccum += dmg * 0.015;
      const leech = Math.floor(this.hero.bloodLeechAccum);
      if (leech >= 1) {
        this.hero.bloodLeechAccum -= leech;
        this.hero.hp = Math.min(effMaxHp, this.hero.hp + leech);
      }
    }

    for (let i = 0; i < 8; i++) {
      this.spawnParticle(
        enemy.x,
        enemy.isBoss ? 1.15 : 0.75,
        enemy.z,
        (Math.random() - 0.5) * 4.5 + nx * 2,
        1.5 + Math.random() * 2.5,
        (Math.random() - 0.5) * 4.5 + nz * 2,
        bananaSlip ? 0xffe44d : isCrit ? 0xffdc6b : hit.hitColor ?? 0xffffff,
        0.95,
        0.35,
        7.5
      );
    }

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    } else if (enemy.isBoss) {
      this.emitHud();
    }

    // Unique: Astral Prism — 20% chance for refracted astral double-strike (+35% dmg)
    if (!enemy.dead && this.hero.hasUnique('astral_double_strike') && Math.random() < 0.2) {
      const astralDmg = Math.max(3, Math.round(dmg * 0.35));
      this.applyBonusEnemyDamage(
        enemy,
        astralDmg,
        hit.isMageHit ? `冰稜 -${astralDmg}` : `星界斬 -${astralDmg}`,
        'info',
        0x7ef5ff
      );
    }

    // Unique: Permafrost Stele — chill enemy cooldown (+35%) & frost chip damage
    if (!enemy.dead && this.hero.hasUnique('frost_chill_aura')) {
      enemy.attackCooldown += enemy.isBoss ? 0.22 : 0.45;
      const frostDmg = Math.max(2, Math.round(dmg * 0.12));
      this.applyBonusEnemyDamage(enemy, frostDmg, `冰霜 -${frostDmg}`, 'relicBlue', 0x8be9ff);
    }

    // Unique: Cat Paw Gloves — every 3rd hit triggers rapid "喵!" bonus swat + knockback
    if (this.hero.hasUnique('cat_paw_swat')) {
      this.hero.catPawHitCounter += 1;
      if (!enemy.dead && this.hero.catPawHitCounter % 3 === 0) {
        const pawDmg = Math.max(4, Math.round(dmg * 0.35));
        enemy.vx += nx * (enemy.isBoss ? 1.6 : 6.2);
        enemy.vz += nz * (enemy.isBoss ? 1.6 : 6.2);
        this.applyBonusEnemyDamage(enemy, pawDmg, `喵! -${pawDmg}`, 'relicOrange', 0xff9ad5);
      }
    }

    // Unique: Dungeon Disco Ball — rainbow sparks on crit + 20% bonus tip coin
    if (isCrit && this.hero.hasUnique('disco_fever_aura')) {
      const discoColors = [0xff4fd8, 0x3ef5ff, 0xffe047, 0x5cff6b, 0xb266ff];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.spawnParticle(
          enemy.x,
          0.95,
          enemy.z,
          Math.cos(a) * 4.4,
          1.6 + Math.random() * 2.0,
          Math.sin(a) * 4.4,
          discoColors[i % discoColors.length],
          1.05,
          0.48,
          3.5
        );
      }
      if (Math.random() < 0.2) {
        this.emitFloatingText(enemy.x, 2.25, enemy.z, '迪斯可小費!', 'gold');
        this.spawnLoot(
          enemy.x + (Math.random() - 0.5) * 0.6,
          enemy.z + (Math.random() - 0.5) * 0.6,
          'gold'
        );
      }
    }

    // Unique: Crown of Ember Sovereign — fiery AoE nova on crit
    if (isCrit && this.hero.hasUnique('ember_crit_nova')) {
      const splashDmg = Math.max(2, Math.round(dmg * 0.22));
      for (const other of this.enemies) {
        if (other.dead || other.id === enemy.id) continue;
        if (Math.hypot(other.x - enemy.x, other.z - enemy.z) <= 2.9) {
          this.applyBonusEnemyDamage(other, splashDmg, `焚燒 -${splashDmg}`, 'relicOrange', 0xff6224);
        }
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.spawnParticle(
          enemy.x,
          0.55,
          enemy.z,
          Math.cos(a) * 4.8,
          0.9 + Math.random(),
          Math.sin(a) * 4.8,
          i % 2 === 0 ? 0xff6b24 : 0xffd24a,
          1.1,
          0.4,
          1.5
        );
      }
    }

    // Unique: Stormforged Hammer — chain lightning on 3rd-hit cleave
    if (hit.isEmpowered && !hit.state.triggeredStorm && this.hero.hasUnique('storm_cleave_lightning')) {
      hit.state.triggeredStorm = true;
      const arcDmg = Math.max(3, Math.round(dmg * 0.2));
      let chained = 0;
      for (const other of this.enemies) {
        if (other.dead || other.id === enemy.id || chained >= 3) continue;
        if (Math.hypot(other.x - enemy.x, other.z - enemy.z) <= 5.2) {
          chained += 1;
          this.applyBonusEnemyDamage(other, arcDmg, `⚡ -${arcDmg}`, 'info', 0x62f5ff);
        }
      }
    }

    // 4pc Green Set: Dragonfire Knight — fiery splash on every attack
    if (this.hero.hasSet4pc('dragonfire')) {
      const fireDmg = Math.max(2, Math.round(dmg * 0.14));
      for (const other of this.enemies) {
        if (other.dead || other.id === enemy.id) continue;
        if (Math.hypot(other.x - enemy.x, other.z - enemy.z) <= 2.4) {
          this.applyBonusEnemyDamage(other, fireDmg, `龍炎 -${fireDmg}`, 'relicOrange', 0xff5a1f);
        }
      }
    }

    // 4pc Green Set: Voidstalker — crit resets dash & fires 3 void blades
    if (isCrit && this.hero.hasSet4pc('voidstalker')) {
      this.hero.dashCooldown = 0;
      const bladeDmg = Math.max(3, Math.round(dmg * 0.18));
      let hits = 0;
      for (const other of this.enemies) {
        if (other.dead || hits >= 3) continue;
        if (Math.hypot(other.x - this.hero.x, other.z - this.hero.z) <= 6.2) {
          hits += 1;
          this.applyBonusEnemyDamage(other, bladeDmg, `虛空刃 -${bladeDmg}`, 'info', 0xb46bff);
        }
      }
    }

    // 4pc Green Set: Gilded Syndicate — 20% Golden Smite bonus damage + gold pop
    if (!enemy.dead && this.hero.hasSet4pc('syndicate') && Math.random() < 0.2) {
      const smiteDmg = Math.max(4, Math.round(dmg * 0.18));
      this.applyBonusEnemyDamage(enemy, smiteDmg, `重金轟擊 -${smiteDmg}`, 'gold', 0xffd84a);
      this.spawnLoot(
        enemy.x + (Math.random() - 0.5) * 0.6,
        enemy.z + (Math.random() - 0.5) * 0.6,
        'gold'
      );
    }
  },

  performPommelStrike(this: EmbervaultEngine): void {
    if (this.hero.isDead || this.hero.pommelCooldown > 0) return;
    if (this.mpGuestDungeon()) this.mpQueueAction(ACT_POMMEL);
    if (this.hero.isMage()) {
      this.performFrostNova();
      return;
    }
    if (this.hero.isHunter()) {
      this.performHunterPetSkill();
      return;
    }

    this.hero.pommelCooldown = this.hero.pommelMaxCooldown;
    this.hero.pommelAnim = 0.34;
    this.hero.attackAnim = 0;
    this.hero.attackCooldown = Math.max(this.hero.attackCooldown, 0.28);

    this.audio.playPommelStrike();
    // Subtle full-screen impact shake
    this.addScreenShake(0.24, 0.22);

    // Compact 360-degree dual shockwave rings around the hero
    const outerGeo = new THREE.RingGeometry(0.42, 0.62, 32);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xffe484,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const outerRing = new THREE.Mesh(outerGeo, outerMat);
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.set(this.hero.x, 0.22, this.hero.z);
    this.scene.add(outerRing);
    this.slashArcs.push({
      mesh: outerRing,
      life: 0,
      maxLife: 0.28,
      isCleave: false,
      isShockwave: true,
      targetScale: 4.35,
    });

    const innerGeo = new THREE.RingGeometry(0.18, 0.36, 24);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const innerRing = new THREE.Mesh(innerGeo, innerMat);
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.set(this.hero.x, 0.26, this.hero.z);
    this.scene.add(innerRing);
    this.slashArcs.push({
      mesh: innerRing,
      life: 0,
      maxLife: 0.2,
      isCleave: false,
      isShockwave: true,
      targetScale: 4.1,
    });

    // Radial shockwave dust/gold impact sparks
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const spd = 4.6 + Math.random() * 2.4;
      this.spawnParticle(
        this.hero.x + Math.cos(a) * 0.45,
        0.35,
        this.hero.z + Math.sin(a) * 0.45,
        Math.cos(a) * spd,
        1.1 + Math.random() * 1.4,
        Math.sin(a) * spd,
        i % 2 === 0 ? 0xffe45e : 0xf4f7ff,
        0.95,
        0.34,
        5.5
      );
    }

    // Same 360-degree radius as the 3rd-hit cleave (2.55 + target size margin)
    const reach = 2.55;
    const effMaxHp = this.hero.getEffectiveMaxHp();
    const avariceBonus = this.hero.hasUnique('avarice_gold_atk')
      ? Math.min(0.4, Math.floor(this.hero.gold / 100) * 0.01)
      : 0;
    const titanFuryBonus =
      this.hero.hasUnique('titan_low_hp_fury') && this.hero.hp / Math.max(1, effMaxHp) < 0.4 ? 0.18 : 0;
    const berserkerBonus = this.hero.hasUnique('berserker_combo_ramp')
      ? Math.min(0.25, this.hero.floorKills * 0.01)
      : 0;
    const atkMult =
      1 +
      this.hero.atkUpgrades * 0.1 +
      this.hero.relicStats.atkPct / 100 +
      avariceBonus +
      titanFuryBonus +
      berserkerBonus;
    const critChance = Math.min(
      0.95,
      0.11 + this.hero.critUpgrades * 0.02 + this.hero.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100;
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;

    let landedHit = false;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - this.hero.x;
      const dz = enemy.z - this.hero.z;
      const dist = Math.hypot(dx, dz);
      const effectiveReach = reach + (enemy.isBoss ? 0.5 : enemy.isElite ? 0.18 : 0);
      if (dist > effectiveReach) continue;

      // 50% of normal attack damage
      const normalBase = 11 + Math.floor(Math.random() * 6);
      const isCrit = Math.random() < critChance;
      let mult = atkMult * 0.5 * (isCrit ? critMult : 1);
      if (enemy.isBoss || enemy.isElite) {
        mult *= 1 + this.hero.relicStats.eliteBossDmgPct / 100;
      }
      if (this.hero.hasUnique('executioner_finisher') && enemy.hp / Math.max(1, enemy.maxHp) < 0.3) {
        mult *= enemy.isBoss ? 1.25 : 1.5;
      }

      const dmg = this.scaleEnemyDamageTaken(enemy, Math.max(1, Math.round(normalBase * mult)));
      this.hero.totalDamageDealt += dmg;
      if (isCrit) this.hero.critCount += 1;
      this.hero.ai.lastCombatDamageTime = this.elapsed;

      enemy.hp -= dmg;
      enemy.hitFlash = 0.18;

      // Interrupt active attacks / casts / boss windups
      let interrupted = false;
      if (enemy.isBoss && (enemy.bossState === 'windup' || enemy.bossState === 'strike')) {
        enemy.bossState = 'chase';
        enemy.bossStateTimer = 0;
        enemy.bossHitApplied = false;
        enemy.attackCooldown = Math.max(enemy.attackCooldown, 0.75);
        if (enemy.telegraph) {
          enemy.telegraph.group.visible = false;
        }
        interrupted = true;
      } else if (enemy.isRanged && enemy.windupTimer > 0) {
        enemy.windupTimer = 0;
        enemy.attackCooldown = Math.max(enemy.attackCooldown, 0.85);
        interrupted = true;
      } else if (!enemy.isBoss) {
        enemy.attackCooldown = Math.max(enemy.attackCooldown, 0.55);
      }

      // Stun duration: Normal 2.5s, Elite/Guardian 1.5s, Boss 0.8s
      const stunDur = enemy.isBoss
        ? 0.8
        : enemy.isElite || isGuardianEnemy(enemy.kind)
        ? 1.5
        : 2.5;
      enemy.stunTimer = Math.max(enemy.stunTimer, stunDur);

      // Lazily attach orbiting 3D stun stars above enemy head
      if (!enemy.rig.stunStars) {
        const stars = createStunStars();
        stars.position.y = enemy.isBoss
          ? 3.15
          : enemy.isElite
          ? 2.02
          : isGuardianEnemy(enemy.kind)
          ? 2.05
          : isSwarmEnemy(enemy.kind)
          ? 0.88
          : 1.72;
        const starScale = enemy.isBoss
          ? 1.5
          : enemy.isElite
          ? 1.12
          : isSwarmEnemy(enemy.kind)
          ? 0.76
          : 0.94;
        stars.scale.setScalar(starScale);
        enemy.rig.root.add(stars);
        enemy.rig.stunStars = stars;
      }
      enemy.rig.stunStars.visible = true;

      // Crisp outward shockwave knockback
      const nx = dist > 0.01 ? dx / dist : Math.sin(this.hero.facing);
      const nz = dist > 0.01 ? dz / dist : Math.cos(this.hero.facing);
      const knock = 4.6 * knockMult * (enemy.isBoss ? 0.18 : enemy.isElite ? 0.45 : 0.85);
      enemy.vx += nx * knock;
      enemy.vz += nz * knock;

      this.emitFloatingText(
        enemy.x,
        enemy.isBoss ? 2.45 : enemy.isElite ? 2.15 : 1.65,
        enemy.z,
        interrupted ? `中斷! 暈眩 -${dmg}` : `暈眩 -${dmg}`,
        'stun'
      );

      for (let i = 0; i < 6; i++) {
        this.spawnParticle(
          enemy.x,
          enemy.isBoss ? 1.3 : 0.85,
          enemy.z,
          (Math.random() - 0.5) * 4.2 + nx * 1.6,
          1.6 + Math.random() * 2.0,
          (Math.random() - 0.5) * 4.2 + nz * 1.6,
          i % 2 === 0 ? 0xffe44d : 0xffffff,
          0.9,
          0.36,
          6.5
        );
      }

      landedHit = true;
      if (enemy.hp <= 0) {
        this.killEnemy(enemy);
      }
    }

    // Also shatter nearby breakables caught in shockwave
    for (const br of this.breakables) {
      if (br.broken) continue;
      if (Math.hypot(br.x - this.hero.x, br.z - this.hero.z) <= reach) {
        this.breakProp(br);
        landedHit = true;
      }
    }

    if (landedHit) {
      if (!this.isSilentActor() && !this.mp) this.hitStopTimer = 0.04;
    }
    this.emitHud();
  },

  /** Rough collision radius of an enemy body for projectile / AoE checks. */
  getEnemyHitRadius(this: EmbervaultEngine, e: EnemyEntity): number {
    if (e.isBoss) return 1.0;
    if (isGuardianEnemy(e.kind) || e.isElite) return 0.55;
    if (isSwarmEnemy(e.kind)) return 0.3;
    return 0.42;
  },

  /** Visual scale for the frozen-ice shell per enemy size. */
  getFrozenShellScale(this: EmbervaultEngine, e: EnemyEntity): number {
    if (e.isBoss) return 2.2;
    if (isGuardianEnemy(e.kind)) return 1.35;
    if (e.isElite) return 1.3;
    if (isSwarmEnemy(e.kind)) return 0.75;
    return 1.05;
  },

  applySlow(this: EmbervaultEngine, e: EnemyEntity): void {
    if (e.dead) return;
    const factor = e.isBoss
      ? FROST_MAGE.bossSlowFactor
      : e.isElite || isGuardianEnemy(e.kind)
      ? FROST_MAGE.eliteSlowFactor
      : 1;
    const pct = FROST_MAGE.slowPct * factor;
    const wasSlowed = (e.slowTimer ?? 0) > 0;
    e.slowPct = Math.max(wasSlowed ? e.slowPct ?? 0 : 0, pct);
    e.slowTimer = FROST_MAGE.slowDuration;
    if (!e.rig.slowMarker) {
      const marker = createSlowMarker();
      const sc = e.isBoss ? 2.0 : isGuardianEnemy(e.kind) || e.isElite ? 1.3 : isSwarmEnemy(e.kind) ? 0.7 : 1.0;
      marker.scale.set(sc, 1, sc);
      e.rig.root.add(marker);
      e.rig.slowMarker = marker;
    }
    e.rig.slowMarker.visible = true;
    if (!wasSlowed) {
      this.emitFloatingText(e.x, e.isBoss ? 2.7 : 1.95, e.z, `緩速 -${Math.round(pct * 100)}%`, 'frost');
    }
  },

  applyFreeze(this: EmbervaultEngine, e: EnemyEntity, duration: number): void {
    if (e.dead) return;
    e.frozenTimer = Math.max(e.frozenTimer ?? 0, duration);
    // Freezing interrupts boss windups / ranged casts, exactly like Pommel Strike
    if (e.isBoss && (e.bossState === 'windup' || e.bossState === 'strike')) {
      e.bossState = 'chase';
      e.bossStateTimer = 0;
      e.bossHitApplied = false;
      e.attackCooldown = Math.max(e.attackCooldown, 0.75);
      if (e.telegraph) e.telegraph.group.visible = false;
    } else if (e.isRanged && e.windupTimer > 0) {
      e.windupTimer = 0;
      e.attackCooldown = Math.max(e.attackCooldown, 0.6);
    }
    if (!e.rig.frozenShell) {
      const shell = createFrozenShell();
      shell.scale.setScalar(this.getFrozenShellScale(e));
      e.rig.root.add(shell);
      e.rig.frozenShell = shell;
    }
    e.rig.frozenShell.visible = true;
  },

  /** Rotates the hero to face the nearest valid enemy. Returns true if a target was found. */
  autoFaceNearestEnemy(this: EmbervaultEngine): boolean {
    const ranged = this.hero.isRangedClass();
    const range = this.hero.isHunter()
      ? HUNTER.projectileRange
      : this.hero.isMage()
      ? FROST_MAGE.projectileRange
      : 3.2;
    let best: EnemyEntity | null = null;
    let bestDist = Infinity;
    for (const e of this.viewEnemies()) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - this.hero.x, e.z - this.hero.z);
      if (d > range + this.getEnemyHitRadius(e) || d >= bestDist) continue;
      if (
        ranged &&
        !hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, e.x, e.z, this.doorUnlocked, 0.2)
      ) {
        continue;
      }
      best = e;
      bestDist = d;
    }
    if (!best) return false;
    this.hero.facing = Math.atan2(best.x - this.hero.x, best.z - this.hero.z);
    this.hero.rig.body.rotation.y = this.hero.facing;
    return true;
  },

  damageHero(
    this: EmbervaultEngine,
    amount: number,
    sourceX: number,
    sourceZ: number,
    sourceLabel = '地城怪物',
    attacker?: EnemyEntity
  ): void {
    if (this.hero.isDead || this.hero.invuln > 0 || this.transitionState !== 'none') return;

    const isSwarmHit = Boolean(attacker && isSwarmEnemy(attacker.kind));
    const effMaxHp = this.hero.getEffectiveMaxHp();

    // Relic Block Chance: completely negate incoming damage
    if (this.hero.relicStats.blockPct > 0 && Math.random() * 100 < this.hero.relicStats.blockPct) {
      const hasPan = this.hero.hasUnique('frying_pan_bonk');
      this.hero.invuln = isSwarmHit ? 0.14 : 0.38;
      this.audio.playBlock(hasPan);
      this.emitFloatingText(
        this.hero.x,
        1.9,
        this.hero.z,
        hasPan ? '噹！神聖格擋!' : 'BLOCK!',
        'block'
      );
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x,
          0.95,
          this.hero.z,
          Math.cos(a) * 3.4,
          1.4 + Math.random() * 1.4,
          Math.sin(a) * 3.4,
          hasPan ? 0xffe066 : 0x70e8ff,
          1.0,
          0.36,
          4
        );
      }

      // Unique: Eternal Aegis counter-shockwave & heal on block
      if (this.hero.hasUnique('aegis_block_counter')) {
        this.hero.hp = Math.min(effMaxHp, this.hero.hp + 3);
        this.emitFloatingText(this.hero.x, 2.25, this.hero.z, '+3 HP 聖盾反震', 'heal');
        for (const e of this.enemies) {
          if (e.dead) continue;
          const edx = e.x - this.hero.x;
          const edz = e.z - this.hero.z;
          const edist = Math.hypot(edx, edz);
          if (edist <= 3.4) {
            e.vx += (edx / (edist || 1)) * 7.5;
            e.vz += (edz / (edist || 1)) * 7.5;
            this.applyBonusEnemyDamage(e, 12, '反震 -12', 'block', 0x70e8ff);
          }
        }
      }

      // Unique: Frying Pan bonus coin pop on block
      if (hasPan && Math.random() < 0.15) {
        this.spawnLoot(this.hero.x + (Math.random() - 0.5) * 0.6, this.hero.z + (Math.random() - 0.5) * 0.6, 'gold');
      }

      this.emitHud();
      return;
    }

    // Armor % reduction + Flat Relic Damage Reduction (always minimum 1 HP per hit)
    const defMult = Math.max(0.5, 1 - this.hero.armorUpgrades * 0.1);
    const titanFlat =
      this.hero.hasUnique('titan_low_hp_fury') && this.hero.hp / Math.max(1, effMaxHp) < 0.4 ? 2 : 0;
    const alchemistFlat = this.hero.alchemistShieldTimer > 0 ? 2 : 0;
    const flatReduce = this.hero.relicStats.damageReduction + titanFlat + alchemistFlat;
    const actualDamage = Math.max(1, Math.round(amount * defMult) - flatReduce);

    const dx = this.hero.x - sourceX;
    const dz = this.hero.z - sourceZ;
    const dist = Math.hypot(dx, dz) || 1;

    // Frost Mage: the shield absorbs damage first, HP only takes the remainder
    let shieldAbsorbed = 0;
    let hpDamage = actualDamage;
    if (this.hero.isMage() && this.hero.shield > 0) {
      const absorb = Math.min(this.hero.shield, actualDamage);
      this.hero.shield = Math.max(0, this.hero.shield - absorb);
      hpDamage = Math.max(0, actualDamage - Math.ceil(absorb));
      shieldAbsorbed = actualDamage - hpDamage;
      if (this.hero.shield <= 0) this.audio.playShieldBreak();
    }
    this.hero.timeSinceDamaged = 0;
    this.hero.rescueProgress = 0; // getting hit interrupts a rescue in progress

    this.hero.hp = Math.max(0, this.hero.hp - hpDamage);
    // Swarm critters use a brief invuln window so their 2/sec rapid chip bites (-1, -1, -2, -2) land cleanly
    this.hero.invuln = isSwarmHit ? 0.14 : 0.72;
    this.hero.hitFlash = isSwarmHit ? 0.1 : 0.18;
    this.hero.hitShieldOnly = hpDamage <= 0;
    this.audio.playPlayerHurt();
    this.addScreenShake(isSwarmHit ? 0.08 : 0.24, isSwarmHit ? 0.08 : 0.18);
    const labelJitterX = isSwarmHit ? (Math.random() - 0.5) * 0.55 : 0;
    const labelJitterZ = isSwarmHit ? (Math.random() - 0.5) * 0.55 : 0;
    const labelY = isSwarmHit ? 1.6 + Math.random() * 0.35 : 1.8;
    if (shieldAbsorbed > 0) {
      this.emitFloatingText(
        this.hero.x + labelJitterX - 0.15,
        labelY + (hpDamage > 0 ? 0.3 : 0),
        this.hero.z + labelJitterZ,
        `-${shieldAbsorbed}`,
        'shieldHit'
      );
    }
    if (hpDamage > 0) {
      this.emitFloatingText(
        this.hero.x + labelJitterX,
        labelY,
        this.hero.z + labelJitterZ,
        `-${hpDamage}`,
        'playerHit'
      );
    }

    // Relic Thorns: reflect fixed damage to melee attacker
    if (attacker && !attacker.dead && this.hero.relicStats.thorns > 0) {
      this.applyBonusEnemyDamage(
        attacker,
        this.hero.relicStats.thorns,
        `荊棘 -${this.hero.relicStats.thorns}`,
        'info',
        0x7eff9b
      );
    }

    // Unique: Eclipse Mirror — reflect 150% of damage taken as arcane pulse to nearby enemies
    if (this.hero.hasUnique('eclipse_reflect_beam')) {
      const refDmg = Math.max(4, Math.round(actualDamage * 1.5));
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - this.hero.x, e.z - this.hero.z) <= 3.8) {
          this.applyBonusEnemyDamage(e, refDmg, `蝕月反衝 -${refDmg}`, 'info', 0xc88cff);
        }
      }
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x,
          0.85,
          this.hero.z,
          Math.cos(a) * 5.2,
          0.9 + Math.random(),
          Math.sin(a) * 5.2,
          i % 2 === 0 ? 0xc88cff : 0xe6f7ff,
          1.05,
          0.42,
          1.2
        );
      }
    }

    // Unique: Bathhouse Rubber Duck — loud "啾！" knockback + 20% chance to heal 2 HP
    if (this.hero.hasUnique('rubber_duck_squeak') && this.hero.hp > 0) {
      const duckHeal = Math.random() < 0.2;
      if (duckHeal) {
        this.hero.hp = Math.min(effMaxHp, this.hero.hp + 2);
      }
      this.emitFloatingText(
        this.hero.x,
        2.2,
        this.hero.z,
        duckHeal ? '啾！+2 HP' : '啾！',
        duckHeal ? 'heal' : 'relicYellow'
      );
      for (const e of this.enemies) {
        if (e.dead) continue;
        const edx = e.x - this.hero.x;
        const edz = e.z - this.hero.z;
        const edist = Math.hypot(edx, edz);
        if (edist <= 3.5) {
          const push = e.isBoss ? 1.8 : 7.5;
          e.vx += (edx / (edist || 1)) * push;
          e.vz += (edz / (edist || 1)) * push;
        }
      }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x,
          0.95,
          this.hero.z,
          Math.cos(a) * 3.8,
          1.6 + Math.random() * 1.4,
          Math.sin(a) * 3.8,
          0xffe44d,
          1.05,
          0.42,
          3.0
        );
      }
    }

    const kbForce = isSwarmHit ? 1.15 : 5.2;
    this.hero.vx += (dx / dist) * kbForce;
    this.hero.vz += (dz / dist) * kbForce;

    // Auto-heal trigger in autonomous mode if low HP
    const healThreshold = this.hero.getAutoHealThreshold(effMaxHp);
    if (this.hero.controlMode === 'auto' && this.hero.hp > 0 && this.hero.hp <= healThreshold && this.hero.potions > 0) {
      this.usePotion();
    }

    // Unique: Shattered Chronos Hourglass — cheat death once per floor!
    if (
      this.hero.hp <= 0 &&
      this.hero.hasUnique('chronos_cheat_death') &&
      !this.hero.chronosUsedThisFloor
    ) {
      this.hero.chronosUsedThisFloor = true;
      this.hero.hp = this.hero.isMage()
        ? Math.max(1, Math.round(effMaxHp * 0.2))
        : Math.max(10, Math.round(effMaxHp * 0.2));
      if (this.hero.isMage()) this.hero.shield = this.hero.getEffectiveMaxShield();
      this.hero.invuln = 1.65;
      this.audio.playUpgrade();
      this.addScreenShake(0.32, 0.25);
      this.pushBanner('時光砂漏觸發！', '時間凝滯 · 逆轉死亡');
      this.emitFloatingText(this.hero.x, 2.2, this.hero.z, 'TIME REWIND!', 'relicOrange');
      for (const e of this.enemies) {
        if (e.dead) continue;
        const edx = e.x - this.hero.x;
        const edz = e.z - this.hero.z;
        const edist = Math.hypot(edx, edz);
        if (edist < 4.5) {
          e.vx += (edx / (edist || 1)) * 10;
          e.vz += (edz / (edist || 1)) * 10;
        }
      }
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x,
          0.9,
          this.hero.z,
          Math.cos(a) * 4.5,
          1.8 + Math.random() * 2.0,
          Math.sin(a) * 4.5,
          i % 2 === 0 ? 0x6ef5ff : 0xffbe55,
          1.2,
          0.65,
          -0.5
        );
      }
      this.emitHud();
      return;
    }

    if (this.hero.hp <= 0) {
      this.hero.isDead = true;
      this.dismissPet(this.hero.id);
      this.requestSave('death');
      this.hero.slainBy = sourceLabel;
      // Downed: open the hero's portal right where they fell (replaces any older one)
      this.placeHeroPortal(this.hero, this.hero.x, this.hero.z, this.depth);
      this.audio.playPortal();
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x + Math.cos(a) * 0.35,
          0.7,
          this.hero.z + Math.sin(a) * 0.35,
          Math.cos(a) * 2.4,
          2.2 + Math.random() * 1.4,
          Math.sin(a) * 2.4,
          i % 2 === 0 ? 0x56e4ff : 0xd9fbff,
          1.1,
          0.65,
          -0.4
        );
      }
      this.hero.vx = 0;
      this.hero.vz = 0;
      this.hero.dashTimer = 0;
      this.hero.input.keys.clear();
      this.hero.rig.body.rotation.z = Math.PI * 0.46;
      this.hero.rig.body.position.y = 0.22;
      for (const m of this.hero.rig.flashMaterials) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
    this.emitHud();
  },
};
