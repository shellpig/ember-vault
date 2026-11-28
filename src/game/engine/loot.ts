import type { EmbervaultEngine } from '../engine';
import { q100 } from '../../../shared/game';
import { BOSS_LOOT, isGuardianEnemy, isSwarmEnemy } from './data';
import { AnimatedLightProp, BreakableEntity, EnemyEntity, LootEntity, SavedLoot } from './entities';
import { Hero } from '../hero';
import { createLootMesh, createRelicLootMesh } from '../models';
import { RelicDropSource, RelicItem, evaluateRelicLoadoutScore, getRarityColorHex, rollRelicDrops } from '../relics';
import { EnemyKind, FloatingLabelData } from '../types';
import * as THREE from 'three';

/** What kind of monster a drop is for (see `dropEnemyLoot`). */
export interface EnemyLootProfile {
  guardian: boolean;
  elite: boolean;
  swarm: boolean;
  /** Special (named) elite: every drop chance and the coin count scale x1.2. */
  special: boolean;
}

export const lootMethods = {
  breakProp(this: EmbervaultEngine, br: BreakableEntity): void {
    if (this.mpGuestDungeon()) {
      // Teammate client: the host decides what breaks (and what drops). My own hit shatters the crate right away
      // (purely visual); the host's snapshot confirms it, otherwise it comes back (see mpGuestWorld)
      this.mpGuestPredictBreak(br);
      return;
    }
    br.broken = true;
    br.mesh.visible = false;
    this.audio.playCrateBreak();

    if (this.hero.relicStats.crateDmgPct > 0) {
      const megaDmg = Math.round(15 * (1 + this.hero.relicStats.crateDmgPct / 100));
      this.emitFloatingText(br.x, 1.35, br.z, `木箱粉碎 -${megaDmg}!`, 'crit');
    }
    if (this.hero.hasUnique('noodle_elixir_boost') && Math.random() < 0.28) {
      this.emitFloatingText(br.x, 1.75, br.z, '真香！泡麵魂!', 'relicOrange');
    }

    const color = this.getBreakableDebrisColor(br.kind);
    for (let i = 0; i < 10; i++) {
      this.spawnParticle(
        br.x + (Math.random() - 0.5) * 0.4,
        0.5,
        br.z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 4.2,
        2.2 + Math.random() * 2.4,
        (Math.random() - 0.5) * 4.2,
        color,
        1.25,
        0.55,
        9.5
      );
    }

    // Loot chance from crates/urns (boosted by Drop Rate). Every hero gets their own independent roll (spec §5.2).
    const breaker = this.hero;
    for (const h of this.heroes) {
      if (h.inTown) continue;
      this.setActor(h);
      const dropMult = 1 + this.hero.relicStats.dropRatePct / 100;
      if (Math.random() < 0.72) {
        const potChance = Math.min(0.45, 0.13 * dropMult);
        this.spawnLoot(br.x, br.z, Math.random() < potChance ? 'potion' : 'gold');
      }
      if (this.hero.hasUnique('starforged_treasure_sense') && Math.random() < 0.25) {
        this.spawnLoot(br.x + (Math.random() - 0.5) * 0.45, br.z + (Math.random() - 0.5) * 0.45, 'gold');
      }
      this.spawnRelicDrops(br.x, br.z, 'crate');
    }
    this.setActor(breaker);
  },

  killEnemy(this: EmbervaultEngine, enemy: EnemyEntity): void {
    enemy.dead = true;
    enemy.bossWarpUntargetable = false;
    this.resetBossWarpVisual(enemy);
    this.hideBossWindupVfx(enemy.id);
    enemy.rig.root.visible = false;
    if (this.mp?.role === 'host') this.mpEmit(['x', q100(enemy.x), q100(enemy.z), enemy.isBoss || enemy.isElite ? 1 : 0]);
    if (enemy.telegraph) {
      enemy.telegraph.group.visible = false;
    }
    this.hero.kills += 1;
    this.hero.floorKills += 1;
    if (enemy.isBoss) {
      this.hero.bossKills += 1;
    } else if (enemy.isElite) {
      this.hero.eliteKills += 1;
    } else {
      this.hero.normalKills += 1;
    }

    if (enemy.isBoss) {
      this.audio.playBossVictory();
      this.addScreenShake(0.45, 0.35);
      const burstColor =
        enemy.kind === 'boss_lich'
          ? 0xd675ff
          : enemy.kind === 'boss_colossus'
          ? 0xff8024
          : enemy.kind === 'boss_crystal_wyrm'
          ? 0x45f2ff
          : enemy.kind === 'boss_fungal_king'
          ? 0x52f795
          : enemy.kind === 'boss_leviathan_heart'
          ? 0xff8826
          : enemy.kind === 'boss_abyssal_brain'
          ? 0x36f5d4
          : enemy.kind === 'boss_mothership_ai'
          ? 0xff4757
          : enemy.kind === 'boss_xeno_commander'
          ? 0x39ff7a
          : 0xffd252;
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const spd = 2.5 + Math.random() * 5.0;
        this.spawnParticle(
          enemy.x,
          1.1,
          enemy.z,
          Math.cos(a) * spd,
          2.2 + Math.random() * 3.8,
          Math.sin(a) * spd,
          i % 2 === 0 ? 0xffe066 : burstColor,
          1.45,
          0.85,
          5.5
        );
      }

      this.pushBanner(
        `${enemy.bossName ?? 'BOSS'} VANQUISHED`,
        'Treasure Hoard Dropped!',
        true
      );

      // Boss Treasure Hoard: 12 high-value bouncing gold coins (x1.5) scaled +6.5%/floor + Healing Elixir + Guaranteed Boss Relics
      // (every hero gets their own hoard)
      const bossKiller = this.hero;
      for (const h of this.heroes) {
        if (h.inTown) continue;
        this.setActor(h);
        this.dropBossHoard(enemy.x, enemy.z);
      }
      this.setActor(bossKiller);
      if (this.hero.relicStats.lifeOnKill > 0) {
        const effMax = this.hero.getEffectiveMaxHp();
        this.hero.hp = Math.min(effMax, this.hero.hp + this.hero.relicStats.lifeOnKill);
      }
      this.emitHud();
      return;
    }

    if (
      enemy.kind === 'skeleton' ||
      enemy.kind === 'guardian' ||
      enemy.kind === 'archer' ||
      enemy.kind === 'cavern_beetle' ||
      enemy.kind === 'cavern_golem' ||
      enemy.kind === 'cavern_spitter' ||
      enemy.kind === 'cavern_warden' ||
      enemy.kind === 'cavern_mite' ||
      enemy.kind === 'flesh_spiner' ||
      enemy.kind === 'flesh_brute' ||
      enemy.kind === 'alien_trooper' ||
      enemy.kind === 'alien_gunner' ||
      enemy.kind === 'alien_mech' ||
      enemy.kind === 'alien_nanobot'
    ) {
      this.audio.playSkeletonDeath();
      const isCavernStone =
        enemy.kind === 'cavern_beetle' ||
        enemy.kind === 'cavern_golem' ||
        enemy.kind === 'cavern_spitter' ||
        enemy.kind === 'cavern_warden' ||
        enemy.kind === 'cavern_mite';
      const isAlienMetal =
        enemy.kind === 'alien_trooper' ||
        enemy.kind === 'alien_gunner' ||
        enemy.kind === 'alien_mech' ||
        enemy.kind === 'alien_nanobot';
      const debrisCount = isSwarmEnemy(enemy.kind) ? 3 : isGuardianEnemy(enemy.kind) ? 9 : 5;
      const debrisGeo = isCavernStone
        ? new THREE.OctahedronGeometry(0.14, 0)
        : new THREE.BoxGeometry(0.28, 0.07, 0.08);
      const debrisMat = new THREE.MeshStandardMaterial({
        color: isAlienMetal
          ? enemy.kind === 'alien_mech'
            ? 0xb8293d
            : 0x4b5c7d
          : isCavernStone
          ? 0x45d8f0
          : enemy.kind === 'archer'
          ? 0x9c7244
          : enemy.kind === 'flesh_spiner' || enemy.kind === 'flesh_brute'
          ? 0xf2ebd5
          : 0xe6e0cf,
        roughness: isAlienMetal ? 0.25 : isCavernStone ? 0.35 : 0.78,
        metalness: isAlienMetal ? 0.85 : 0.05,
      });
      for (let i = 0; i < debrisCount; i++) {
        const piece = new THREE.Mesh(debrisGeo, debrisMat);
        const angle = Math.random() * Math.PI * 2;
        const dist = 0.22 + Math.random() * 0.72;
        piece.position.set(enemy.x + Math.cos(angle) * dist, 0.05, enemy.z + Math.sin(angle) * dist);
        piece.rotation.y = Math.random() * Math.PI;
        piece.rotation.z = (Math.random() - 0.5) * 0.25;
        this.debrisGroup.add(piece);
      }
    } else if (enemy.kind === 'slime' || enemy.kind === 'flesh_cell' || enemy.kind === 'flesh_tendril') {
      this.audio.playSlimePop();
      const puddleColor =
        enemy.kind === 'flesh_cell'
          ? 0x7ce034
          : enemy.kind === 'flesh_tendril'
          ? 0xe88b28
          : this.dungeon.biome.id === 'ossuary'
          ? 0x9b5de5
          : 0x45d66b;
      const puddleMat = new THREE.MeshBasicMaterial({
        color: puddleColor,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      });
      for (let i = 0; i < 3; i++) {
        const r = 0.22 + Math.random() * 0.28;
        const puddle = new THREE.Mesh(new THREE.CircleGeometry(r, 10), puddleMat);
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(
          enemy.x + (Math.random() - 0.5) * 0.85,
          0.032,
          enemy.z + (Math.random() - 0.5) * 0.85
        );
        this.debrisGroup.add(puddle);
      }
    } else {
      this.audio.playSlimePop();
      const burstCol =
        enemy.kind === 'mage'
          ? 0x9b66ff
          : enemy.kind === 'cavern_shaman'
          ? 0x52f28e
          : enemy.kind === 'cavern_bat'
          ? 0x7d60a8
          : enemy.kind === 'flesh_eye'
          ? 0x26f5b8
          : enemy.kind === 'flesh_parasite'
          ? 0x38e8d8
          : enemy.kind === 'alien_probe'
          ? 0xffb829
          : enemy.kind === 'alien_saucer'
          ? 0x39ff7a
          : enemy.kind === 'alien_psion'
          ? 0xff5ce6
          : 0xff7a29;
      const altCol =
        enemy.kind === 'mage'
          ? 0x6ef2ff
          : enemy.kind === 'flesh_eye'
          ? 0xc6ff66
          : enemy.kind === 'flesh_parasite'
          ? 0xffe24d
          : enemy.kind === 'alien_probe' || enemy.kind === 'alien_saucer' || enemy.kind === 'alien_psion'
          ? 0x62f5ff
          : burstCol;
      for (let i = 0; i < 14; i++) {
        this.spawnParticle(
          enemy.x,
          0.85,
          enemy.z,
          (Math.random() - 0.5) * 5,
          1.5 + Math.random() * 3,
          (Math.random() - 0.5) * 5,
          i % 2 === 0 ? altCol : burstCol,
          1.2,
          0.55,
          4
        );
      }
    }

    // Loot drop (Elites drop 3x gold coins & 3x elixir drop chance + golden burst; Special Named Elites scale all drops x1.2)
    if (enemy.isElite) {
      this.addScreenShake(0.26, 0.2);
      this.emitFloatingText(
        enemy.x,
        2.1,
        enemy.z,
        enemy.isSpecialElite && enemy.customName
          ? `★ ${enemy.customName} 討伐 · 3.6× 掉落`
          : '菁英討伐 · 3× 掉落',
        enemy.isSpecialElite ? 'relicOrange' : 'key'
      );
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const spd = 2.0 + Math.random() * 3.8;
        this.spawnParticle(
          enemy.x,
          1.0,
          enemy.z,
          Math.cos(a) * spd,
          2.0 + Math.random() * 2.8,
          Math.sin(a) * spd,
          i % 2 === 0 ? 0xffd54a : 0xff9824,
          1.3,
          0.7,
          5.5
        );
      }
    }

    // Relic on-kill bonuses (Life on Kill, Politeness flavor, Frying Pan coin, Syndicate 4pc gold rain)
    if (this.hero.relicStats.lifeOnKill > 0 && !this.hero.isDead) {
      const effMax = this.hero.getEffectiveMaxHp();
      if (this.hero.hp < effMax) {
        this.hero.hp = Math.min(effMax, this.hero.hp + this.hero.relicStats.lifeOnKill);
      }
    }
    if (
      this.hero.relicStats.politeness > 0 &&
      Math.random() < Math.min(0.45, this.hero.relicStats.politeness / 170)
    ) {
      const lines = ['大哥太強了…', '甘拜下風！', '這什麼神裝！？', '英雄饒命啊…', '好痛好帥！'];
      const msg = lines[Math.floor(Math.random() * lines.length)];
      this.emitFloatingText(enemy.x, 1.9, enemy.z, msg, 'info');
    }

    const lootProfile: EnemyLootProfile = {
      guardian: isGuardianEnemy(enemy.kind),
      elite: enemy.isElite,
      swarm: isSwarmEnemy(enemy.kind),
      special: Boolean(enemy.isSpecialElite),
    };
    // Every hero rolls their own drops (spec §5.2); the killer is the actor again afterwards
    const killer = this.hero;
    for (const h of this.heroes) {
      if (h.inTown) continue;
      this.setActor(h);
      this.dropEnemyLoot(enemy.x, enemy.z, lootProfile);
    }
    this.setActor(killer);

    this.emitHud();
  },

  /**
   * One monster's drop for the CURRENT actor (`this.hero`; the caller loops over the heroes): gold coins, an elixir and the
   * relic rolls. Shared by `killEnemy` and the treasure chests so both use the very same numbers. `relics: false` skips the
   * relic rolls (the "three elites' worth of gold and potions" chest).
   */
  dropEnemyLoot(this: EmbervaultEngine, x: number, z: number, p: EnemyLootProfile, relics = true): void {
    const specialDropMult = p.special ? 1.2 : 1;
    const extraCoins =
      (this.hero.hasSet4pc('syndicate') ? 1 : 0) +
      (this.hero.hasUnique('frying_pan_bonk') && Math.random() < 0.15 ? 1 : 0) +
      (p.elite && this.hero.hasUnique('starforged_treasure_sense') && Math.random() < 0.25 ? 2 : 0);
    const rawCoinDrops = ((p.guardian ? 3 : p.elite ? 3 : p.swarm ? 0.65 : 1) + extraCoins) * specialDropMult;
    const coinDrops =
      Math.floor(rawCoinDrops) + (Math.random() < rawCoinDrops - Math.floor(rawCoinDrops) ? 1 : 0);
    for (let i = 0; i < coinDrops; i++) {
      this.spawnLoot(
        x + (Math.random() - 0.5) * (p.elite ? 0.85 : 0.5),
        z + (Math.random() - 0.5) * (p.elite ? 0.85 : 0.5),
        'gold'
      );
    }
    const dropMult = 1 + this.hero.relicStats.dropRatePct / 100;
    const basePotionChance = p.guardian ? 0.5 : p.elite ? 0.36 : p.swarm ? 0.06 : 0.12;
    if (Math.random() < Math.min(0.95, basePotionChance * dropMult * specialDropMult)) {
      this.spawnLoot(x, z, 'potion');
    }

    // Relic drop rolls (Elites guaranteed >= 1, Special Named Elites scale drop rate x1.2, Swarms x0.5 per critter)
    if (relics) {
      this.spawnRelicDrops(x, z, p.elite ? 'elite' : 'mob', specialDropMult * (p.swarm && !p.elite ? 0.5 : 1));
    }
  },

  /**
   * Boss Treasure Hoard for the CURRENT actor: 12 high-value bouncing coins (x1.5, scaled +6.5% per floor), a Healing Elixir
   * and the guaranteed boss relics. Shared by the boss kill and the treasure chests.
   */
  dropBossHoard(this: EmbervaultEngine, x: number, z: number): void {
    if (this.bossArenaMode) return;
    const goldScale = this.getDepthGoldScale();
    for (let i = 0; i < BOSS_LOOT.coinCount; i++) {
      const a = (i / BOSS_LOOT.coinCount) * Math.PI * 2 + Math.random() * 0.3;
      const r = 0.35 + Math.random() * 1.05;
      const baseBossCoin = 10 + Math.floor(Math.random() * 5);
      this.spawnLoot(
        x + Math.cos(a) * r,
        z + Math.sin(a) * r,
        'gold',
        Math.max(10, Math.round(baseBossCoin * goldScale * BOSS_LOOT.goldMult))
      );
    }
    this.spawnLoot(x, z, 'potion');
    this.spawnRelicDrops(x, z, 'boss');
  },

  spawnRelicDrops(
    this: EmbervaultEngine,
    x: number,
    z: number,
    source: RelicDropSource,
    extraDropMult = 1
  ): void {
    const dropped = rollRelicDrops(
      this.depth,
      source,
      this.hero.relicStats.dropRatePct,
      () => this.nextId++,
      extraDropMult
    );
    this.spawnRelicItems(x, z, dropped);
  },

  /** Hands already rolled relics to the CURRENT actor: popped out of (x, z) for a player, straight into the bag for a bot. */
  spawnRelicItems(this: EmbervaultEngine, x: number, z: number, dropped: RelicItem[]): void {
    if (this.hero.isBot) {
      // Bots do not render or walk over loot: the roll goes straight into their own bag
      for (const relic of dropped) this.grantBotRelic(relic);
      return;
    }
    // Base angle points away from the hero so dropped relics pop outward instead of instantly landing on the player
    const awayAngle = Math.atan2(z - this.hero.z, x - this.hero.x);
    dropped.forEach((relic, idx) => {
      const fanOffset =
        dropped.length > 1
          ? ((idx - (dropped.length - 1) / 2) / dropped.length) * Math.PI * 1.15
          : 0;
      const angle = awayAngle + fanOffset + (Math.random() - 0.5) * 0.75;
      // Pick a launch direction that isn't immediately blocked by a wall
      let launchAngle = angle;
      for (let attempt = 0; attempt < 6; attempt++) {
        const cand = angle + attempt * (Math.PI / 3);
        const testX = x + Math.cos(cand) * 1.35;
        const testZ = z + Math.sin(cand) * 1.35;
        if (this.canMoveTo(testX, testZ, 0.35)) {
          launchAngle = cand;
          break;
        }
      }
      const launchSpeed = 3.1 + Math.random() * 1.45;
      this.spawnRelicLoot(
        x,
        z,
        relic,
        Math.cos(launchAngle) * launchSpeed,
        Math.sin(launchAngle) * launchSpeed
      );
    });
  },

  spawnRelicLoot(
    this: EmbervaultEngine,
    x: number,
    z: number,
    relic: RelicItem,
    vx = 0,
    vz = 0
  ): void {
    if (this.bossArenaMode) return;
    const relicRig = createRelicLootMesh(relic.rarity, this.textures?.glowMap);
    relicRig.root.position.set(x, 0, z);
    this.dynamicGroup.add(relicRig.root);

    const isHighTier = relic.rarity === 'orange' || relic.rarity === 'green';

    this.loots.push({
      id: this.nextId++,
      ownerId: this.hero.id,
      type: 'relic',
      value: relic.sellValue,
      mesh: relicRig.root,
      relic,
      relicRig,
      x,
      z,
      vx,
      vz,
      y: 0.32,
      vy: (isHighTier ? 5.2 : 4.5) + Math.random() * 0.9,
      age: 0,
      pickupDelay: isHighTier ? 1.25 : 0.85,
      collected: false,
    });

    this.audio.playRelicDrop(relic.rarity);
    if (isHighTier) {
      const col = getRarityColorHex(relic.rarity);
      this.pushBanner(
        relic.rarity === 'orange' ? `獨特遺物掉落 · ${relic.name}` : `套裝遺物掉落 · ${relic.name}`,
        `Lv.${relic.level}${relic.setName ? ` · ${relic.setName}` : ''}`
      );
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        this.spawnParticle(
          x,
          0.35,
          z,
          Math.cos(a) * (1.2 + Math.random() * 1.6),
          2.6 + Math.random() * 3.0,
          Math.sin(a) * (1.2 + Math.random() * 1.6),
          col,
          1.15,
          0.85,
          -0.6
        );
      }
    }
  },

  /**
   * Puts the drops of a frozen floor back where they lay (rebuild from a saved snapshot). Quiet: no banner,
   * sound or pop; already settled on the ground and ready to pick up. Owners are kept, so teammates' drops
   * reach them again through the host's next full loot snapshot.
   */
  restoreSavedLoots(this: EmbervaultEngine, saved: SavedLoot[]): void {
    for (const s of saved) {
      let mesh: THREE.Group;
      let relicRig: LootEntity['relicRig'];
      if (s.type === 'relic' && s.relic) {
        relicRig = createRelicLootMesh(s.relic.rarity, this.textures?.glowMap);
        relicRig.root.position.set(s.x, 0, s.z);
        mesh = relicRig.root;
      } else if (s.type !== 'relic') {
        mesh = createLootMesh(s.type);
        mesh.position.set(s.x, 0, s.z);
      } else {
        continue;
      }
      this.dynamicGroup.add(mesh);
      this.loots.push({
        id: this.nextId++,
        ownerId: s.ownerId,
        type: s.type,
        value: s.value,
        mesh,
        relic: s.relic,
        relicRig,
        x: s.x,
        z: s.z,
        y: 0,
        vy: 0,
        age: 10,
        collected: false,
      });
    }
  },

  /** Bot gold / potion drops go straight into the bot's own purse (same values the pickup would give). */
  grantBotLoot(this: EmbervaultEngine, type: 'gold' | 'potion', customValue?: number): void {
    const h = this.hero;
    if (type === 'gold') {
      const base =
        customValue ??
        Math.max(1, Math.round((3 + Math.floor(Math.random() * 5)) * this.getDepthGoldScale()));
      const gained = Math.max(1, Math.round(base * (1 + h.relicStats.goldPct / 100)));
      h.gold += gained;
      h.totalGoldEarned += gained;
    } else {
      h.potions += 1;
    }
  },

  /** Mirrors the relic pickup rules of updateLoot for a bot (equip into a free slot, else upgrade, else bag, else sell). */
  grantBotRelic(this: EmbervaultEngine, item: RelicItem): void {
    const h = this.hero;
    h.discoveredRelicIds.add(item.templateId);
    if (h.equippedRelics.length < 4) {
      h.equippedRelics.push(item);
      h.recomputeRelicStats(true);
    } else if (this.tryAutoEquipBetterRelic(item)) {
      // swapped in (the replaced piece went to the bag or was sold)
    } else if (h.relicBag.length < h.relicBagCap) {
      h.relicBag.unshift(item);
    } else {
      h.gold += item.sellValue;
      h.totalGoldEarned += item.sellValue;
    }
  },

  spawnLoot(this: EmbervaultEngine, x: number, z: number, type: 'gold' | 'potion', customValue?: number): void {
    if (this.bossArenaMode) return;
    if (this.hero.isBot) {
      this.grantBotLoot(type, customValue);
      return;
    }
    const mesh = createLootMesh(type);
    mesh.position.set(x, 0.3, z);
    this.dynamicGroup.add(mesh);
    const defaultGold = Math.max(
      1,
      Math.round((3 + Math.floor(Math.random() * 5)) * this.getDepthGoldScale())
    );
    this.loots.push({
      id: this.nextId++,
      ownerId: this.hero.id,
      type,
      value: customValue ?? (type === 'gold' ? defaultGold : 1),
      mesh,
      x,
      z,
      y: 0.3,
      vy: 3.6 + Math.random() * 1.4,
      age: 0,
      collected: false,
    });
  },

  getEnemyBaseLabel(this: EmbervaultEngine, kind: EnemyKind): string {
    switch (kind) {
      case 'skeleton':
        return '骷髏戰士';
      case 'slime':
        return '地城史萊姆';
      case 'wisp':
        return '餘燼幽火';
      case 'dungeon_rat':
        return '地穴魔鼠';
      case 'archer':
        return '暗影弓箭手';
      case 'mage':
        return '秘法術士';
      case 'guardian':
        return '地穴守衛';
      case 'cavern_beetle':
        return '晶殼甲蟲';
      case 'cavern_golem':
        return '岩晶魔像';
      case 'cavern_bat':
        return '洞穴蝠魔';
      case 'cavern_mite':
        return '晶牙幼蛛';
      case 'cavern_spitter':
        return '晶刺蜥蜴';
      case 'cavern_shaman':
        return '螢菇薩滿';
      case 'cavern_warden':
        return '礦窟守望者';
      case 'flesh_cell':
        return '吞噬細胞';
      case 'flesh_tendril':
        return '噬肉觸手怪';
      case 'flesh_parasite':
        return '深紫寄生蟲';
      case 'flesh_leech':
        return '噬血幼蛭';
      case 'flesh_spiner':
        return '骨刺射手';
      case 'flesh_eye':
        return '魔眼凝視者';
      case 'flesh_brute':
        return '骨甲肉魔';
      case 'alien_trooper':
        return '星艦突擊兵';
      case 'alien_probe':
        return '警戒偵查球';
      case 'alien_saucer':
        return '幽浮偵察碟';
      case 'alien_nanobot':
        return '奈米突襲蟲';
      case 'alien_gunner':
        return '外星電漿射手';
      case 'alien_psion':
        return '星靈念力師';
      case 'alien_mech':
        return '重裝防衛機甲';
      default:
        return '地穴守衛';
    }
  },

  getEnemyLabel(this: EmbervaultEngine, e: EnemyEntity): string {
    if (e.isBoss) return e.bossName ?? '地城頭目';
    if (e.customName) return e.customName;
    const base = this.getEnemyBaseLabel(e.kind);
    return e.isElite ? `菁英 ${base}` : base;
  },

  tryAutoEquipBetterRelic(this: EmbervaultEngine, item: RelicItem): boolean {
    if (this.hero.equippedRelics.length < 4) return false;

    const currentScore = evaluateRelicLoadoutScore(this.hero.equippedRelics);
    let bestSlot = -1;
    let bestScore = currentScore;

    for (let i = 0; i < this.hero.equippedRelics.length; i++) {
      const candidate = [...this.hero.equippedRelics];
      candidate[i] = item;
      const score = evaluateRelicLoadoutScore(candidate);
      if (score > bestScore + 3) {
        bestScore = score;
        bestSlot = i;
      }
    }

    if (bestSlot < 0) return false;

    const replaced = this.hero.equippedRelics[bestSlot];
    this.hero.equippedRelics[bestSlot] = item;
    if (this.hero.relicBag.length < this.hero.relicBagCap) {
      this.hero.relicBag.unshift(replaced);
    } else {
      // Bag full fallback: convert replaced piece into gold
      this.hero.gold += replaced.sellValue;
      this.hero.totalGoldEarned += replaced.sellValue;
    }
    this.hero.recomputeRelicStats(true);
    return true;
  },

  updateLoot(this: EmbervaultEngine, dt: number): void {
    const loopActor = this.hero;
    for (const l of this.loots) {
      if (l.collected) continue;
      // Everyone sees only their own drops: other heroes' loot is neither drawn nor simulated here
      let remote: Hero | null = null;
      if (l.ownerId !== this.localHeroId) {
        l.mesh.visible = false;
        // Room game host: a teammate's drops are simulated (invisible) so they can pick them up
        if (this.mp?.role === 'host') {
          const o = this.heroById(l.ownerId);
          if (o && o.isRemote && !o.inTown) remote = o;
        }
        if (!remote) continue;
        this.setActor(remote);
      } else if (this.bgSim && this.mp) {
        continue; // the host is in town: its own drops wait for it
      }
      l.age += dt;
      if (l.y > 0 || l.vy > 0) {
        l.vy -= 13.5 * dt;
        l.y = Math.max(0, l.y + l.vy * dt);
        if (l.y === 0) l.vy = 0;
      }

      // Apply outward pop-out launch velocity (with wall clamping so relics never fly into walls)
      if (l.vx || l.vz) {
        const vx = l.vx ?? 0;
        const vz = l.vz ?? 0;
        const nextX = l.x + vx * dt;
        const nextZ = l.z + vz * dt;
        if (this.canMoveTo(nextX, l.z, 0.35)) {
          l.x = nextX;
        } else {
          l.vx = -vx * 0.25;
        }
        if (this.canMoveTo(l.x, nextZ, 0.35)) {
          l.z = nextZ;
        } else {
          l.vz = -vz * 0.25;
        }
        const drag = l.y > 0.01 ? Math.exp(-1.5 * dt) : Math.exp(-12.0 * dt);
        l.vx = (l.vx ?? 0) * drag;
        l.vz = (l.vz ?? 0) * drag;
        if (Math.hypot(l.vx, l.vz) < 0.06) {
          l.vx = 0;
          l.vz = 0;
        }
      }

      // Gentle magnetic pull toward hero (respects relic viewing delay)
      const dx = this.hero.x - l.x;
      const dz = this.hero.z - l.z;
      // A downed owner can neither attract nor collect their loot (it waits until they are back on their feet)
      const dist = this.hero.isDead ? Infinity : Math.hypot(dx, dz);
      const minCollectAge = l.pickupDelay ?? 0.22;
      const pullRange = l.type === 'relic' ? 1.35 : 2.4;
      if (dist < pullRange && l.age > minCollectAge) {
        const pull = (1 - dist / pullRange) * (l.type === 'relic' ? 6.2 : 7.5) * dt;
        l.x += (dx / (dist || 1)) * pull;
        l.z += (dz / (dist || 1)) * pull;
      }

      if (l.type === 'relic' && l.relicRig && l.relic) {
        l.mesh.position.set(l.x, 0, l.z);
        l.relicRig.artifact.position.y =
          0.36 + l.y + Math.sin(this.elapsed * 3.8 + l.id) * 0.1;
        l.relicRig.artifact.rotation.y += dt * 2.4;
        l.relicRig.ring.rotation.z -= dt * 1.2;
        if (l.relicRig.beam) {
          l.relicRig.beam.rotation.y += dt * 0.85;
          const pulse = 0.92 + Math.sin(this.elapsed * 4.5 + l.id) * 0.12;
          l.relicRig.beam.scale.set(pulse, 1, pulse);
          if (Math.random() < dt * 14.5) {
            const a = Math.random() * Math.PI * 2;
            const r = 0.08 + Math.random() * 0.42;
            const isBright = Math.random() < 0.35;
            this.spawnParticle(
              l.x + Math.cos(a) * r,
              0.2 + Math.random() * 0.35,
              l.z + Math.sin(a) * r,
              (Math.random() - 0.5) * 0.25,
              2.4 + Math.random() * 2.1,
              (Math.random() - 0.5) * 0.25,
              isBright ? 0xfff4d2 : getRarityColorHex(l.relic.rarity),
              0.48 + Math.random() * 0.36,
              0.95 + Math.random() * 0.45,
              -0.25
            );
          }
        }
      } else {
        l.mesh.position.set(l.x, l.y + Math.sin(this.elapsed * 4.5 + l.id) * 0.08, l.z);
        l.mesh.rotation.y += dt * 2.8;
      }

      if (dist < 0.78 && l.age > minCollectAge) {
        l.collected = true;
        l.mesh.visible = false;
        if (l.type === 'gold') {
          const gained = Math.max(1, Math.round(l.value * (1 + this.hero.relicStats.goldPct / 100)));
          this.hero.gold += gained;
          this.hero.totalGoldEarned += gained;
          this.audio.playCoin();
          this.emitFloatingText(l.x, 1.3, l.z, `+${gained}G`, 'gold');
        } else if (l.type === 'potion') {
          this.hero.potions += 1;
          this.audio.playPotion();
          this.emitFloatingText(l.x, 1.3, l.z, '+1 ELIXIR', 'heal');
        } else if (l.type === 'relic' && l.relic) {
          const item = l.relic;
          this.hero.discoveredRelicIds.add(item.templateId);
          const tone: FloatingLabelData['tone'] =
            item.rarity === 'orange'
              ? 'relicOrange'
              : item.rarity === 'green'
              ? 'relicGreen'
              : item.rarity === 'yellow'
              ? 'relicYellow'
              : 'relicBlue';

          if (this.hero.equippedRelics.length < 4) {
            this.hero.equippedRelics.push(item);
            this.hero.recomputeRelicStats(true);
            this.audio.playRelicEquip();
            this.emitFloatingText(l.x, 1.65, l.z, `已裝備：${item.name}`, tone);
          } else if (this.hero.controlMode === 'auto' && this.tryAutoEquipBetterRelic(item)) {
            this.audio.playRelicEquip();
            this.emitFloatingText(l.x, 1.75, l.z, `自動換裝：${item.name}`, tone);
          } else if (this.hero.relicBag.length < this.hero.relicBagCap) {
            this.hero.relicBag.unshift(item);
            this.audio.playRelicEquip();
            this.emitFloatingText(l.x, 1.65, l.z, `獲得：${item.name}`, tone);
          } else {
            // Bag full fallback: auto-convert to gold so loot is never wasted
            this.hero.gold += item.sellValue;
            this.hero.totalGoldEarned += item.sellValue;
            this.audio.playRelicSell();
            this.emitFloatingText(
              l.x,
              1.65,
              l.z,
              `背包已滿 · 折現 +${item.sellValue}G`,
              'gold'
            );
          }
        }
        this.emitHud();
      }
      if (remote) this.setActor(loopActor);
    }
  },

  /** The first living hero that is hurt and stands in an unused rune well drinks from it. */
  tryRuneDrink(this: EmbervaultEngine, lp: AnimatedLightProp): void {
    // The first living hero that is hurt and stands in the circle drinks from it
    const drinker = lp.used
      ? undefined
      : this.heroes.find(
          (h) =>
            !h.isDead &&
            !h.inTown &&
            Math.hypot(lp.x - h.x, lp.z - h.z) < 1.1 &&
            h.hp < h.getEffectiveMaxHp()
        );
    if (drinker) {
      this.setActor(drinker);
      const effMax = this.hero.getEffectiveMaxHp();
      lp.used = true;
      if (lp.crystal) lp.crystal.visible = false;
      if (lp.halo) lp.halo.visible = false;
      if (lp.decal) {
        (lp.decal.material as THREE.MeshBasicMaterial).opacity = 0.46;
      }
      if (lp.pool) {
        (lp.pool.material as THREE.MeshBasicMaterial).opacity = 0.12;
      }
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.spawnParticle(
          lp.x + Math.cos(a) * 0.2,
          0.78,
          lp.z + Math.sin(a) * 0.2,
          Math.cos(a) * 2.2,
          1.6 + Math.random() * 1.4,
          Math.sin(a) * 2.2,
          lp.color,
          0.85,
          0.55,
          1.5
        );
      }
      this.hero.hp = Math.min(effMax, this.hero.hp + 20);
      this.audio.playPotion();
      this.emitFloatingText(lp.x, 1.7, lp.z, 'SANCTUM +20 HP', 'info');
      this.setActor(this.localHero);
      this.emitHud();
    }
  },
};
