import type { EmbervaultEngine } from '../engine';
import { findGridPath, gridToWorld } from '../dungeon';
import { BOSS_ACTION, BOSS_CONFIGS, SPECIAL_ELITE_NAMES, getBossBaseMaxHp, getBossDepthTier, getBossForDepth, isArcherLikeRanged, isFloorBoss, isGuardianEnemy, isMageLikeRanged, isRangedEnemy, isSwarmEnemy } from './data';
import { applyEliteVisuals, createBossTelegraph, createEnemyModel } from '../models';
import { DungeonData, EnemyKind } from '../types';

export const spawnMethods = {
  spawnEnemies(this: EmbervaultEngine): void {
    const biome = this.dungeon.biome;
    const theme = biome.terrainTheme;
    const isBossFloor = this.depth % 5 === 0;
    const combatRooms = this.dungeon.rooms.filter(
      (r) => r.role !== 'start' && r.role !== 'key' && r.role !== 'exit'
    );
    const lastCombatRoomId = combatRooms[combatRooms.length - 1]?.id ?? -1;
    // The treasure room (docs/treasure-room-spec.md 2) holds no monsters, no swarms and none of the headcount bonus mobs.
    // The room is never the last combat room (that one carries the guaranteed floor elite), see pickTreasureRoom.
    const treasureRoomId = this.dungeon.treasure?.roomId ?? -1;
    const monsterRooms = combatRooms.filter((r) => r.id !== treasureRoomId);
    let elitesSpawned = 0;
    const maxElites = Math.min(4, 1 + Math.floor(this.dungeon.rooms.length / 6));

    // Biome-specific monster casts (Dungeon 1-10, Cavern 11-20, Monster Interior 21-30, Alien Spaceship 31-40)
    const themeArcher: EnemyKind =
      theme === 'alien'
        ? 'alien_gunner'
        : theme === 'cavern'
        ? 'cavern_spitter'
        : theme === 'flesh'
        ? 'flesh_spiner'
        : 'archer';
    const themeMage: EnemyKind =
      theme === 'alien'
        ? 'alien_psion'
        : theme === 'cavern'
        ? 'cavern_shaman'
        : theme === 'flesh'
        ? 'flesh_eye'
        : 'mage';
    const themeGuardian: EnemyKind =
      theme === 'alien'
        ? 'alien_mech'
        : theme === 'cavern'
        ? 'cavern_warden'
        : theme === 'flesh'
        ? 'flesh_brute'
        : 'guardian';
    const themeMeleeGuard: EnemyKind =
      theme === 'alien'
        ? 'alien_trooper'
        : theme === 'cavern'
        ? 'cavern_golem'
        : theme === 'flesh'
        ? 'flesh_tendril'
        : 'skeleton';
    const themeSwarm: EnemyKind =
      theme === 'alien'
        ? 'alien_nanobot'
        : theme === 'cavern'
        ? 'cavern_mite'
        : theme === 'flesh'
        ? 'flesh_leech'
        : 'dungeon_rat';
    const themePool: EnemyKind[] =
      theme === 'alien'
        ? [
            'alien_trooper',
            'alien_gunner',
            'alien_probe',
            'alien_psion',
            'alien_saucer',
            'alien_nanobot',
          ]
        : theme === 'cavern'
        ? [
            'cavern_beetle',
            'cavern_spitter',
            'cavern_golem',
            'cavern_shaman',
            'cavern_bat',
            'cavern_mite',
          ]
        : theme === 'flesh'
        ? [
            'flesh_tendril',
            'flesh_spiner',
            'flesh_cell',
            'flesh_eye',
            'flesh_parasite',
            'flesh_leech',
          ]
        : ['skeleton', 'archer', 'slime', 'mage', 'wisp', 'dungeon_rat'];

    // Fast small swarm pack size: always >= 2, scaling up with depth to max 4
    const rollSwarmPackSize = (): number => {
      // 1-9: 2 | 10-16: 2-3 | 17-25: 3 | 26+: 3-4
      const minPack = this.depth >= 17 ? 3 : 2;
      const maxPack = this.depth >= 26 ? 4 : this.depth >= 10 ? 3 : 2;
      return minPack + Math.floor(Math.random() * (maxPack - minPack + 1));
    };

    const spawnSwarmPack = (gx: number, gz: number) => {
      const packSize = rollSwarmPackSize();
      for (let p = 0; p < packSize; p++) {
        const angle = (p / packSize) * Math.PI * 2 + Math.random() * 0.55;
        const radius = packSize === 1 ? 0 : 0.42 + Math.random() * 0.28;
        this.addEnemy(
          themeSwarm,
          gx,
          gz,
          biome,
          false,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius
        );
      }
    };

    let swarmPacksSpawned = 0;

    for (const room of this.dungeon.rooms) {
      if (room.role === 'start' || room.id === treasureRoomId) continue;

      if (room.role === 'key') {
        if (isBossFloor) {
          // Spawn a towering terrain-matched Floor Boss in or right in front of the Key Room!
          const bossKind = getBossForDepth(this.depth, theme, this.dungeon.genSeed);
          const pathToKey = findGridPath(
            this.dungeon,
            this.dungeon.spawn.gx,
            this.dungeon.spawn.gz,
            this.dungeon.keyPos.gx,
            this.dungeon.keyPos.gz,
            false
          );

          let bossTile: { gx: number; gz: number } | null = null;
          for (let back = 2; back <= 5; back++) {
            const idx = pathToKey.length - 1 - back;
            if (idx >= 0 && idx < pathToKey.length) {
              const cand = pathToKey[idx];
              if (
                this.dungeon.tiles[cand.gz]?.[cand.gx] === 1 &&
                (cand.gx !== this.dungeon.keyPos.gx || cand.gz !== this.dungeon.keyPos.gz)
              ) {
                bossTile = cand;
                break;
              }
            }
          }

          if (!bossTile) {
            const fallbacks = [
              { gx: room.cx + 1, gz: room.cz },
              { gx: room.cx - 1, gz: room.cz },
              { gx: room.cx, gz: room.cz + 1 },
              { gx: room.cx, gz: room.cz - 1 },
            ];
            bossTile =
              fallbacks.find((f) => this.dungeon.tiles[f.gz]?.[f.gx] === 1) ?? {
                gx: room.cx,
                gz: room.cz,
              };
          }

          this.addEnemy(bossKind, bossTile.gx, bossTile.gz, biome);

          // Spawn 1–2 terrain-matched ranged escorts near the Boss so ranged-first Auto priority applies
          const escortKinds: EnemyKind[] =
            this.depth >= 10
              ? [themeArcher, themeMage]
              : [Math.floor(this.depth / 5) % 2 === 1 ? themeArcher : themeMage];
          const escortCandidates = [
            { gx: room.x + 1, gz: room.z + 1 },
            { gx: room.x + room.w - 2, gz: room.z + 1 },
            { gx: room.x + 1, gz: room.z + room.h - 2 },
            { gx: room.x + room.w - 2, gz: room.z + room.h - 2 },
            { gx: bossTile.gx + 2, gz: bossTile.gz },
            { gx: bossTile.gx - 2, gz: bossTile.gz },
            { gx: bossTile.gx, gz: bossTile.gz + 2 },
            { gx: bossTile.gx, gz: bossTile.gz - 2 },
          ];
          let spawnedEscorts = 0;
          for (const cand of escortCandidates) {
            if (spawnedEscorts >= escortKinds.length) break;
            if (
              this.dungeon.tiles[cand.gz]?.[cand.gx] === 1 &&
              (cand.gx !== bossTile.gx || cand.gz !== bossTile.gz) &&
              (cand.gx !== this.dungeon.keyPos.gx || cand.gz !== this.dungeon.keyPos.gz)
            ) {
              this.addEnemy(escortKinds[spawnedEscorts], cand.gx, cand.gz, biome);
              spawnedEscorts += 1;
            }
          }

          // Depth-tier extra escorts (docs/boss-spec.md 1b): regular mobs, unnamed elites and named elites, placed on
          // free key-room tiles at least ~2 tiles from the boss, spread out by taking every other candidate.
          const tier = getBossDepthTier(this.depth);
          const extra: Array<{ kind: EnemyKind; elite: 'none' | 'plain' | 'named' }> = [];
          const mobCycle: EnemyKind[] = [themeMeleeGuard, themeArcher, themeMage];
          for (let i = 0; i < tier.mobs; i++) extra.push({ kind: mobCycle[i % mobCycle.length], elite: 'none' });
          for (let i = 0; i < tier.elites; i++) extra.push({ kind: themeMeleeGuard, elite: 'plain' });
          for (let i = 0; i < tier.named; i++) extra.push({ kind: i % 2 === 0 ? themeMeleeGuard : themeArcher, elite: 'named' });
          if (extra.length > 0) {
            const free: Array<{ gx: number; gz: number }> = [];
            for (let gz = room.z + 1; gz < room.z + room.h - 1; gz++) {
              for (let gx = room.x + 1; gx < room.x + room.w - 1; gx++) {
                if (this.dungeon.tiles[gz]?.[gx] !== 1) continue;
                if (gx === this.dungeon.keyPos.gx && gz === this.dungeon.keyPos.gz) continue;
                if (Math.abs(gx - bossTile.gx) + Math.abs(gz - bossTile.gz) < 2) continue;
                free.push({ gx, gz });
              }
            }
            const step = Math.max(1, Math.floor(free.length / extra.length));
            for (let i = 0; i < extra.length && free.length > 0; i++) {
              const t = free[Math.min(free.length - 1, i * step)];
              const ex = extra[i];
              this.addEnemy(ex.kind, t.gx, t.gz, biome, ex.elite !== 'none', 0, 0, ex.elite === 'named');
            }
          }
        } else {
          // Standard floor: Terrain Guardian mini-boss near key pedestal + 1 ranged minion
          this.addEnemy(themeGuardian, room.cx + 1, room.cz, biome);
          this.addEnemy(this.depth % 2 === 0 ? themeMage : themeArcher, room.cx - 1, room.cz + 1, biome);
        }
        continue;
      }

      if (room.role === 'exit') {
        // 1 melee + 1 ranged terrain-matched guard inside the sealed stairwell chamber
        this.addEnemy(themeMeleeGuard, room.cx - 1, room.cz + 1, biome);
        this.addEnemy(this.depth % 2 === 0 ? themeArcher : themeMage, room.cx + 1, room.cz - 1, biome);
        continue;
      }

      const count = room.role === 'shrine' ? 2 : 2 + Math.min(2, Math.floor(this.depth / 2) + 1);
      for (let i = 0; i < count; i++) {
        const gx = room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2));
        const gz = room.z + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2));
        if (this.dungeon.tiles[gz][gx] !== 1) continue;
        const kind = themePool[(room.id * 2 + i) % themePool.length];
        if (kind === themeSwarm) {
          spawnSwarmPack(gx, gz);
          swarmPacksSpawned += 1;
          continue;
        }
        const forceFloorElite = room.id === lastCombatRoomId && elitesSpawned === 0;
        const isElite =
          forceFloorElite || (elitesSpawned < maxElites && Math.random() < 0.14);
        if (isElite) elitesSpawned += 1;
        this.addEnemy(kind, gx, gz, biome, isElite);
      }
    }

    // Guarantee at least one fast swarm pack appears on every floor
    if (swarmPacksSpawned === 0 && monsterRooms.length > 0) {
      const targetRoom = monsterRooms[Math.floor(monsterRooms.length / 2)];
      if (this.dungeon.tiles[targetRoom.cz]?.[targetRoom.cx] === 1) {
        spawnSwarmPack(targetRoom.cx, targetRoom.cz);
      }
    }

    // Spec §4 headcount scaling: +10% monsters per extra hero. The bonus is computed from the whole floor's regular
    // monster count (so it is felt even when every pack is tiny) and dealt out one by one over the combat rooms.
    const extraHeroes = this.getHeroCount() - 1;
    if (extraHeroes > 0 && monsterRooms.length > 0) {
      const regularCount = this.enemies.filter((e) => !e.isBoss).length;
      const bonus = Math.floor((regularCount * extraHeroes) / 10);
      for (let i = 0; i < bonus; i++) {
        const room = monsterRooms[i % monsterRooms.length];
        const kind = themePool[(room.id * 2 + i + 1) % themePool.length];
        for (let attempt = 0; attempt < 8; attempt++) {
          const gx = room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2));
          const gz = room.z + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2));
          if (this.dungeon.tiles[gz]?.[gx] !== 1) continue;
          this.addEnemy(kind, gx, gz, biome, false);
          break;
        }
      }
    }
  },

  /** Spec §4: monster HP x (1 + (n - 1)) for n heroes - 2 heroes = 2x, 4 heroes = 4x (bosses and elites included). */
  getEnemyHpScale(this: EmbervaultEngine): number {
    return 1 + (this.getHeroCount() - 1);
  },

  getDepthDamageScale(this: EmbervaultEngine): number {
    return 1 + (this.depth - 1) * 0.12;
  },

  getSwarmDepthDamageScale(this: EmbervaultEngine): number {
    return 1 + (this.depth - 1) * 0.06;
  },

  getDepthGoldScale(this: EmbervaultEngine): number {
    // +6.5% gold per floor (within 5-8% per floor progression)
    return Math.pow(1.065, Math.max(0, this.depth - 1));
  },

  addEnemy(
    this: EmbervaultEngine,
    kind: EnemyKind,
    gx: number,
    gz: number,
    biome: DungeonData['biome'],
    isElite = false,
    offsetX = 0,
    offsetZ = 0,
    forceNamedElite = false
  ): void {
    if (this.dungeon.tiles[gz]?.[gx] !== 1) return;
    const baseW = gridToWorld(gx, gz);
    let x = baseW.x + offsetX;
    let z = baseW.z + offsetZ;
    if (this.portalSafePos) {
      const distToPortal = Math.hypot(x - this.portalSafePos.x, z - this.portalSafePos.z);
      if (distToPortal < 7.2) {
        if (!isFloorBoss(kind)) {
          return;
        }
        // Relocate Floor Boss to the farthest walkable tile from the Town Portal so Boss floor remains completable
        let bestDist = distToPortal;
        let bestX = x;
        let bestZ = z;
        const keyRoom = this.dungeon.rooms.find((r) => r.role === 'key');
        const searchRooms = keyRoom ? [keyRoom, ...this.dungeon.rooms] : this.dungeon.rooms;
        for (const r of searchRooms) {
          for (let rz = r.z + 1; rz < r.z + r.h - 1; rz++) {
            for (let rx = r.x + 1; rx < r.x + r.w - 1; rx++) {
              if (this.dungeon.tiles[rz]?.[rx] !== 1) continue;
              const cand = gridToWorld(rx, rz);
              const d = Math.hypot(cand.x - this.portalSafePos.x, cand.z - this.portalSafePos.z);
              if (d > bestDist) {
                bestDist = d;
                bestX = cand.x;
                bestZ = cand.z;
              }
            }
          }
          if (bestDist >= 7.2) break;
        }
        x = bestX;
        z = bestZ;
      }
    }
    const rig = createEnemyModel(kind, biome, this.sharedShadowMap);
    rig.root.position.set(x, 0, z);
    this.dynamicGroup.add(rig.root);

    if (isFloorBoss(kind)) {
      const cfg = BOSS_CONFIGS[kind];
      const maxHp = Math.round(
        getBossBaseMaxHp(kind, this.depth) * getBossDepthTier(this.depth).hpMult * this.getEnemyHpScale()
      );
      const telegraph = createBossTelegraph(cfg.telegraphColor);
      this.dynamicGroup.add(telegraph.group);

      this.enemies.push({
        id: this.nextId++,
        kind,
        rig,
        x,
        z,
        vx: 0,
        vz: 0,
        hp: maxHp,
        maxHp,
        speed: cfg.speed,
        attackCooldown: 0.75,
        windupTimer: 0,
        stunTimer: 0,
        hitFlash: 0,
        hopPhase: 0,
        facing: 0,
        dead: false,
        isBoss: true,
        isRanged: false,
        isElite: false,
        damageMult: 1,
        bossName: cfg.name,
        bossTitle: cfg.title,
        bossState: 'chase',
        bossStateTimer: 0,
        bossStateDuration: 0,
        telegraph,
        telegraphX: x,
        telegraphZ: z,
        telegraphRadius: cfg.telegraphRadius,
        bossDamage: cfg.damage,
        bossHitApplied: false,
        bossSkill: cfg.skills[0],
        bossSkillIndex: 0,
        bossAction: 'skill',
        bossNextType: Math.random() < BOSS_ACTION.skillChance ? 'skill' : 'basic',
        bossStreak: 0,
        bossEnraged: false,
      });
      return;
    }

    const eliteEligible = isElite && !isGuardianEnemy(kind) && !isSwarmEnemy(kind);
    const isSpecialElite = eliteEligible && (forceNamedElite || Math.random() < 0.25);
    let customName: string | undefined;
    if (eliteEligible) {
      if (isSpecialElite) {
        customName =
          SPECIAL_ELITE_NAMES[Math.floor(Math.random() * SPECIAL_ELITE_NAMES.length)];
        applyEliteVisuals(rig, customName, true);
      } else {
        applyEliteVisuals(rig, `菁英 ${this.getEnemyBaseLabel(kind)}`, false);
      }
    }

    const depthScale = 1 + (this.depth - 1) * 0.22;
    const baseHp = isGuardianEnemy(kind)
      ? 62
      : isSwarmEnemy(kind)
      ? 8
      : kind === 'cavern_golem' || kind === 'flesh_tendril' || kind === 'alien_trooper'
      ? 30
      : kind === 'skeleton' || kind === 'cavern_beetle'
      ? 28
      : kind === 'slime' || kind === 'flesh_cell' || kind === 'alien_probe'
      ? 24
      : kind === 'wisp' ||
        kind === 'cavern_bat' ||
        kind === 'flesh_parasite' ||
        kind === 'alien_saucer'
      ? 22
      : isMageLikeRanged(kind)
      ? 19
      : 18; // ranged mobs have slightly less HP than melee mobs
    const eliteHpMult = eliteEligible ? (isSpecialElite ? 4 * 1.25 : 4) : 1;
    const maxHp = Math.round(baseHp * depthScale * eliteHpMult * this.getEnemyHpScale());
    const speed = isSwarmEnemy(kind)
      ? 8.4 // 3x normal melee speed (2.8 * 3)
      : kind === 'wisp' ||
        kind === 'cavern_bat' ||
        kind === 'flesh_parasite' ||
        kind === 'alien_saucer'
      ? 3.55
      : kind === 'skeleton' ||
        kind === 'cavern_beetle' ||
        kind === 'flesh_tendril' ||
        kind === 'alien_trooper'
      ? 2.8
      : isArcherLikeRanged(kind)
      ? 2.6
      : isMageLikeRanged(kind)
      ? 2.35
      : isGuardianEnemy(kind) || kind === 'cavern_golem' || kind === 'alien_probe'
      ? 2.3
      : 2.1;

    this.enemies.push({
      id: this.nextId++,
      kind,
      rig,
      x,
      z,
      vx: 0,
      vz: 0,
      hp: maxHp,
      maxHp,
      speed,
      attackCooldown: isRangedEnemy(kind)
        ? 0.8 + Math.random() * 0.5
        : isSwarmEnemy(kind)
        ? 0.15 + Math.random() * 0.25
        : 0.4 + Math.random() * 0.5,
      windupTimer: 0,
      stunTimer: 0,
      hitFlash: 0,
      hopPhase: Math.random() * Math.PI * 2,
      facing: Math.random() * Math.PI * 2,
      dead: false,
      isBoss: false,
      isRanged: isRangedEnemy(kind),
      isElite: eliteEligible,
      isSpecialElite,
      customName,
      damageMult: eliteEligible ? 1.5 : 1,
    });
  },
};
