import type { CharacterUpgrades } from '../../shared/character';
import { FROST_MAGE, HERO_CLASSES, getShieldSpeedFactor, splitRelicMaxHpForMage } from './classes';
import type { HeroClassId, UpgradeKind } from './classes';
import type { HeroRig, createHeroSetAura } from './models';
import { computeRelicSummary } from './relics';
import type { AngelBuff, RelicItem, RelicSetId, RelicSummaryStats, UniqueEffectId } from './relics';

/** Persistent per-character state a hero can load from / export to a cloud save. */
export interface CharacterLoadout {
  gold: number;
  /** Highest depth ever reached; a loaded run starts on this floor. */
  maxDepth: number;
  potions: number;
  upgrades: CharacterUpgrades;
  equipped: RelicItem[];
  bag: RelicItem[];
  /** Town stash (up to STASH_CAP relics). */
  stash: RelicItem[];
}

/** Stash capacity (mirrors MAX_STASH in shared/character.ts). */
export const STASH_CAP = 200;

/** Grid cell on an auto-pilot path. */
export interface GridCell {
  gx: number;
  gz: number;
}

/** A hero's own dungeon portal (spec §3.1). */
export interface HeroPortal {
  x: number;
  z: number;
  depth: number;
}

/** Input state of one hero (keyboard / pointer for a human, empty for an AI-driven hero). */
export interface HeroInput {
  /** `KeyboardEvent.code`s currently held. */
  keys: Set<string>;
  /** This frame's movement input (zero when idle). Blink uses it before falling back to facing. */
  moveX: number;
  moveZ: number;
  /** Left mouse button held over the game canvas (hold-to-attack). */
  leftMouseHeld: boolean;
  pointerClientX: number;
  pointerClientY: number;
}

/** Auto-pilot (attract mode / bot) bookkeeping of one hero. The behaviour itself lives in the engine. */
export interface HeroAiState {
  path: GridCell[];
  repathTimer: number;
  combatPath: GridCell[];
  combatRepathTimer: number;
  lastCheckX: number;
  lastCheckZ: number;
  stuckTimer: number;
  stuckCount: number;
  forcePathTimer: number;
  strafeSign: number;
  status: string;
  lastCombatDamageTime: number;
  progressAnchorX: number;
  progressAnchorZ: number;
  noProgressTimer: number;
  unstuckTimer: number;
  unstuckPath: GridCell[];
  currentTargetId: number | null;
  unstuckAttempts: number;
  skipEnemyUntil: Map<number, number>;
  /** Mage auto-pilot is waiting for the shield to refill (set below 60%, cleared when full). */
  mageRecharging: boolean;
  /** Cooldown between the auto-pilot's town purchases. */
  upgradeCooldown: number;
}

/**
 * Everything that belongs to ONE hero: position, stats, cooldowns, upgrades, relics, gold, downed state,
 * portal, input and per-run statistics. The engine owns the world (level, enemies, projectiles, camera ...)
 * and operates on Hero instances. Pure rules that only touch a hero's own state live here.
 */
export class Hero {
  public readonly id: string;

  /** Local AI teammate (P4-B): never saved, never talks to the API, no HUD / camera / input binding. */
  public isBot = false;
  /** 1-based index shown on a bot's nameplate ("Bot 1"). */
  public botIndex = 0;

  // Visual rig (owned by the hero; the engine adds it to the scene)
  public rig!: HeroRig;
  public setAura!: ReturnType<typeof createHeroSetAura>;

  // Position / motion
  public x = 0;
  public z = 0;
  public vx = 0;
  public vz = 0;
  public facing = 0;
  public walkCycle = 0;
  public footstepTimer = 0;
  public emberSpawnTimer = 0;

  // Combat / action state
  public attackCooldown = 0;
  public attackAnim = 0;
  public pommelCooldown = 0;
  /** Right-click class skill max cooldown (Pommel Strike 8s / Frost Nova 10s). */
  public pommelMaxCooldown = 8.0;
  public pommelAnim = 0;
  public comboStep = 0;
  public comboResetTimer = 0;
  public dashTimer = 0;
  public dashCooldown = 0;
  public dashDirX = 0;
  public dashDirZ = 1;
  public invuln = 0;
  public hitFlash = 0;
  /** True when the last hit was fully absorbed by the shield (blue hit flash instead of red). */
  public hitShieldOnly = false;
  /** Frost Mage ice spike cycle index: 0, 1, 2 (2 = empowered). Never resets on idle. */
  public mageShotIndex = 0;

  // Health (HP scaled 10x: 60 start, 300 cap)
  public hp = 60;
  public maxHp = 60;
  public readonly maxHpCap = 300;
  public shield = 0;
  public baseMaxShield = 0;
  /** Seconds since the hero last took damage (drives shield regen delay). */
  public timeSinceDamaged = 999;

  // Class & upgrades
  public classId: HeroClassId = 'warrior';
  public hpUpgrades = 0;
  public atkUpgrades = 0;
  public armorUpgrades = 0;
  public readonly maxArmorUpgrades = 5;
  public critUpgrades = 0;
  public readonly maxCritUpgrades = 10;
  public hpShieldUpgrades = 0;
  public shieldSpeedUpgrades = 0;
  public autoNextUpgrade: UpgradeKind = 'hp';

  /**
   * True while this hero stands in the (local) town instead of the dungeon (P4-C). Only the local hero ever sets it;
   * the dungeon simulation ignores such a hero completely (no targeting, pickups, rescue or objectives).
   */
  public inTown = false;

  // Downed state & portal
  public isDead = false;
  public slainBy = '地城陷阱';
  /**
   * The hero's own dungeon portal (spec §3.1): opened by a normal town return or when the hero is downed.
   * A new portal replaces the old one; it is cleared on every floor change.
   */
  public portal: HeroPortal | null = null;
  /** Rescue (spec §3.3): the downed hero this hero is currently reviving, and the seconds held so far. */
  public rescueTargetId: string | null = null;
  public rescueProgress = 0;

  // Economy
  public gold = 0;
  public potions = 3;

  // Relics
  public equippedRelics: RelicItem[] = [];
  public relicBag: RelicItem[] = [];
  public readonly relicBagCap = 30;
  /** Town stash contents (oldest deposit first). The stash belongs to the character, so it travels with the hero. */
  public stash: RelicItem[] = [];
  public stashOpen = false;
  public discoveredRelicIds = new Set<string>();
  public relicStats: RelicSummaryStats = computeRelicSummary([]);
  public angelBuff: AngelBuff | null = null;
  public phantomCritTimer = 0;
  public alchemistShieldTimer = 0;
  public dragonAuraTimer = 0;
  public chronosUsedThisFloor = false;
  public bloodLeechAccum = 0;
  public catPawHitCounter = 0;

  // Per-run statistics
  public totalGoldEarned = 0;
  public kills = 0;
  public normalKills = 0;
  public eliteKills = 0;
  public bossKills = 0;
  public floorKills = 0;
  public potionsUsed = 0;
  public totalDamageDealt = 0;
  public critCount = 0;
  /** Highest depth reached by this character (persisted as max_depth). */
  public maxDepthReached = 1;

  // Control
  public controlMode: 'auto' | 'manual' = 'auto';
  public readonly input: HeroInput = {
    keys: new Set<string>(),
    moveX: 0,
    moveZ: 0,
    leftMouseHeld: false,
    pointerClientX: 0,
    pointerClientY: 0,
  };
  public readonly ai: HeroAiState = {
    path: [],
    repathTimer: 0,
    combatPath: [],
    combatRepathTimer: 0,
    lastCheckX: 0,
    lastCheckZ: 0,
    stuckTimer: 0,
    stuckCount: 0,
    forcePathTimer: 0,
    strafeSign: 1,
    status: 'Exploring Catacombs',
    lastCombatDamageTime: -10,
    progressAnchorX: 0,
    progressAnchorZ: 0,
    noProgressTimer: 0,
    unstuckTimer: 0,
    unstuckPath: [],
    currentTargetId: null,
    unstuckAttempts: 0,
    skipEnemyUntil: new Map<number, number>(),
    mageRecharging: false,
    upgradeCooldown: 0,
  };

  constructor(id: string) {
    this.id = id;
  }

  /**
   * Clears everything a fresh run starts from (called by the engine's restartRun before the class
   * stats / loadout are applied). Class-dependent stats are set by applyClassStats afterwards.
   */
  public resetForNewRun(): void {
    this.inTown = false;
    this.isDead = false;
    this.portal = null;
    this.rescueTargetId = null;
    this.rescueProgress = 0;
    this.angelBuff = null;
    this.attackCooldown = 0;
    this.dashCooldown = 0;
    this.dashTimer = 0;
    this.invuln = 0;
    this.catPawHitCounter = 0;
    this.comboStep = 0;
    this.input.moveX = 0;
    this.input.moveZ = 0;
    this.ai.mageRecharging = false;
    this.potions = 3;
    this.gold = 0;
    this.totalGoldEarned = 0;
    this.kills = 0;
    this.normalKills = 0;
    this.eliteKills = 0;
    this.bossKills = 0;
    this.potionsUsed = 0;
    this.totalDamageDealt = 0;
    this.critCount = 0;
    this.slainBy = '地城陷阱';
    this.equippedRelics = [];
    this.relicBag = [];
    this.stash = [];
    this.stashOpen = false;
    this.discoveredRelicIds.clear();
    this.phantomCritTimer = 0;
    this.alchemistShieldTimer = 0;
    this.dragonAuraTimer = 0;
    this.chronosUsedThisFloor = false;
    this.bloodLeechAccum = 0;
    this.pommelCooldown = 0;
    this.pommelAnim = 0;
  }

  /** Snapshot of the persistent character state (gold, upgrades, relics, potions, max depth) for saving. */
  public exportLoadout(currentDepth: number): CharacterLoadout {
    return {
      gold: this.gold,
      maxDepth: Math.max(this.maxDepthReached, currentDepth),
      potions: this.potions,
      upgrades: {
        hp: this.hpUpgrades,
        atk: this.atkUpgrades,
        armor: this.armorUpgrades,
        crit: this.critUpgrades,
        hpShield: this.hpShieldUpgrades,
        shieldSpeed: this.shieldSpeedUpgrades,
      },
      equipped: this.equippedRelics.map((r) => ({ ...r })),
      bag: this.relicBag.map((r) => ({ ...r })),
      stash: this.stash.map((r) => ({ ...r })),
    };
  }

  public getEffectiveMaxHp(): number {
    if (this.classId === 'frost_mage') {
      return this.maxHp + splitRelicMaxHpForMage(this.relicStats.maxHp).hp;
    }
    return this.maxHp + this.relicStats.maxHp;
  }

  /** Effective max shield (Frost Mage only; 0 for classes without a shield). */
  public getEffectiveMaxShield(): number {
    if (this.classId !== 'frost_mage') return 0;
    return this.baseMaxShield + splitRelicMaxHpForMage(this.relicStats.maxHp).shield;
  }

  public isMage(): boolean {
    return this.classId === 'frost_mage';
  }

  public hasUnique(effectId: UniqueEffectId): boolean {
    return this.relicStats.uniqueEffects.includes(effectId);
  }

  public hasSet4pc(setId: RelicSetId): boolean {
    return this.relicStats.activeSetIds4pc.includes(setId);
  }

  public recomputeRelicStats(adjustHp = true): void {
    const prevEffMax = this.getEffectiveMaxHp();
    const prevMaxShield = this.getEffectiveMaxShield();
    this.relicStats = computeRelicSummary(this.equippedRelics, this.angelBuff?.stats);
    const nextEffMax = this.getEffectiveMaxHp();
    const nextMaxShield = this.getEffectiveMaxShield();

    if (adjustHp && !this.isDead) {
      if (nextEffMax > prevEffMax) {
        this.hp = Math.min(nextEffMax, this.hp + (nextEffMax - prevEffMax));
      } else {
        this.hp = Math.min(nextEffMax, this.hp);
      }
      if (nextMaxShield > prevMaxShield) {
        this.shield = Math.min(nextMaxShield, this.shield + (nextMaxShield - prevMaxShield));
      } else {
        this.shield = Math.min(nextMaxShield, this.shield);
      }
    } else {
      this.shield = Math.min(nextMaxShield, this.shield);
    }

    // Update 4-piece green set visual aura around hero
    if (this.setAura) {
      const set4 = this.relicStats.activeSetIds4pc[0];
      if (!set4) {
        this.setAura.group.visible = false;
      } else {
        this.setAura.group.visible = true;
        if (set4 === 'dragonfire') {
          this.setAura.outerMat.color.setHex(0xff5a1f);
          this.setAura.innerMat.color.setHex(0xffcf54);
        } else if (set4 === 'voidstalker') {
          this.setAura.outerMat.color.setHex(0x9b5cff);
          this.setAura.innerMat.color.setHex(0x5ef0ff);
        } else {
          this.setAura.outerMat.color.setHex(0xffd24a);
          this.setAura.innerMat.color.setHex(0xfff4a8);
        }
      }
    }
  }

  public getTotalUpgradeLevel(): number {
    return (
      this.hpUpgrades +
      this.atkUpgrades +
      this.armorUpgrades +
      this.critUpgrades +
      this.hpShieldUpgrades +
      this.shieldSpeedUpgrades
    );
  }

  /** Max purchase count for an upgrade of the current class (0 = not offered). */
  public getUpgradeMax(kind: UpgradeKind): number {
    if (this.isMage()) {
      switch (kind) {
        case 'hp_shield':
          return FROST_MAGE.maxHpShieldUpgrades;
        case 'atk':
          return FROST_MAGE.maxAtkUpgrades;
        case 'crit':
          return FROST_MAGE.maxCritUpgrades;
        case 'shield_speed':
          return FROST_MAGE.maxShieldSpeedUpgrades;
        default:
          return 0;
      }
    }
    switch (kind) {
      case 'hp':
        return Math.round((this.maxHpCap - HERO_CLASSES.warrior.baseHp) / 10);
      case 'atk':
        return 999; // warrior attack upgrades are uncapped
      case 'armor':
        return this.maxArmorUpgrades;
      case 'crit':
        return this.maxCritUpgrades;
      default:
        return 0;
    }
  }

  public getUpgradeCount(kind: UpgradeKind): number {
    switch (kind) {
      case 'hp':
        return this.hpUpgrades;
      case 'atk':
        return this.atkUpgrades;
      case 'armor':
        return this.armorUpgrades;
      case 'crit':
        return this.critUpgrades;
      case 'hp_shield':
        return this.hpShieldUpgrades;
      case 'shield_speed':
        return this.shieldSpeedUpgrades;
    }
  }

  public isUpgradeMaxed(kind: UpgradeKind): boolean {
    if (!this.isMage() && kind === 'hp') return this.maxHp >= this.maxHpCap;
    return this.getUpgradeCount(kind) >= this.getUpgradeMax(kind);
  }

  /** Attack multiplier from upgrades, relics and conditional uniques (shared by both classes). */
  public getAtkMult(): number {
    const effMaxHp = this.getEffectiveMaxHp();
    const avariceBonus = this.hasUnique('avarice_gold_atk')
      ? Math.min(0.4, Math.floor(this.gold / 100) * 0.01)
      : 0;
    const titanFuryBonus =
      this.hasUnique('titan_low_hp_fury') && this.hp / Math.max(1, effMaxHp) < 0.4 ? 0.18 : 0;
    const berserkerBonus = this.hasUnique('berserker_combo_ramp')
      ? Math.min(0.25, this.floorKills * 0.01)
      : 0;
    return (
      1 +
      this.atkUpgrades * 0.1 +
      this.relicStats.atkPct / 100 +
      avariceBonus +
      titanFuryBonus +
      berserkerBonus
    );
  }

  /** Frost Mage shield regeneration tick. */
  public updateShield(dt: number): void {
    this.timeSinceDamaged += dt;
    if (!this.isMage()) return;
    const maxShield = this.getEffectiveMaxShield();
    if (this.shield >= maxShield) {
      this.shield = maxShield;
      return;
    }
    if (this.timeSinceDamaged < this.getShieldRegenDelay()) return;
    const rate = maxShield / Math.max(0.1, this.getShieldRefillTime());
    this.shield = Math.min(maxShield, this.shield + rate * dt);
  }

  /** HP at or below which the auto-pilot drinks a potion. */
  public getAutoHealThreshold(effMaxHp: number): number {
    if (this.isMage()) return Math.max(4, Math.floor(effMaxHp * 0.5));
    return Math.max(20, Math.floor(effMaxHp * 0.45));
  }

  public getShieldRegenDelay(): number {
    return FROST_MAGE.shieldDelayBase * getShieldSpeedFactor(this.shieldSpeedUpgrades);
  }

  public getShieldRefillTime(): number {
    return FROST_MAGE.shieldRefillBase * getShieldSpeedFactor(this.shieldSpeedUpgrades);
  }

  /** Resets class-dependent base stats (HP, shield, upgrades, skill cooldown). */
  public applyClassStats(classId: HeroClassId): void {
    const def = HERO_CLASSES[classId];
    this.classId = classId;
    this.maxHp = def.baseHp;
    this.hp = def.baseHp;
    this.baseMaxShield = def.baseShield;
    this.shield = def.baseShield;
    this.hpUpgrades = 0;
    this.atkUpgrades = 0;
    this.armorUpgrades = 0;
    this.critUpgrades = 0;
    this.hpShieldUpgrades = 0;
    this.shieldSpeedUpgrades = 0;
    this.timeSinceDamaged = 999;
    this.mageShotIndex = 0;
    this.autoNextUpgrade = classId === 'frost_mage' ? 'hp_shield' : 'hp';
    this.pommelMaxCooldown = def.skillCooldown;
  }

  /**
   * Applies a saved loadout on top of the freshly reset class stats (called from restartRun).
   * Upgrade levels are re-applied with the same formulas purchaseUpgrade uses.
   */
  public applyLoadout(l: CharacterLoadout): void {
    const lvl = (n: number, max: number) => Math.max(0, Math.min(max, Math.floor(Number(n) || 0)));
    const up = l.upgrades;
    if (this.isMage()) {
      this.hpShieldUpgrades = lvl(up.hpShield, FROST_MAGE.maxHpShieldUpgrades);
      this.shieldSpeedUpgrades = lvl(up.shieldSpeed, FROST_MAGE.maxShieldSpeedUpgrades);
      this.atkUpgrades = lvl(up.atk, FROST_MAGE.maxAtkUpgrades);
      this.critUpgrades = lvl(up.crit, FROST_MAGE.maxCritUpgrades);
      this.maxHp = HERO_CLASSES.frost_mage.baseHp + FROST_MAGE.hpPerUpgrade * this.hpShieldUpgrades;
      this.baseMaxShield =
        HERO_CLASSES.frost_mage.baseShield + FROST_MAGE.shieldPerUpgrade * this.hpShieldUpgrades;
    } else {
      this.hpUpgrades = lvl(up.hp, this.getUpgradeMax('hp'));
      this.atkUpgrades = lvl(up.atk, 999);
      this.armorUpgrades = lvl(up.armor, this.maxArmorUpgrades);
      this.critUpgrades = lvl(up.crit, this.maxCritUpgrades);
      this.maxHp = Math.min(this.maxHpCap, HERO_CLASSES.warrior.baseHp + 10 * this.hpUpgrades);
    }
    this.gold = Math.max(0, Math.floor(l.gold));
    this.potions = Math.max(0, Math.floor(l.potions));
    this.equippedRelics = l.equipped.slice(0, 4).map((r) => ({ ...r }));
    this.relicBag = l.bag.slice(0, this.relicBagCap).map((r) => ({ ...r }));
    this.stash = (l.stash ?? []).slice(0, STASH_CAP).map((r) => ({ ...r }));
    for (const r of [...this.equippedRelics, ...this.relicBag, ...this.stash]) {
      this.discoveredRelicIds.add(r.templateId);
    }
  }

  public restoreAfterDowned(): void {
    this.hp = this.getEffectiveMaxHp();
    this.shield = this.getEffectiveMaxShield();
    this.rig.body.rotation.z = 0;
    this.rig.body.position.y = 0;
    this.vx = 0;
    this.vz = 0;
  }
}
