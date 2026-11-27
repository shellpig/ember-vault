// Hero class definitions shared by the engine and the UI.
// All gameplay numbers for each class live here so balance tweaks stay in one place.
// Distances are WORLD UNITS (1 tile = TILE_SIZE = 2.0 world units).

import { UPGRADE_KEYS, emptyUpgrades, type CharacterUpgrades } from '../../shared/character';

export type HeroClassId = 'warrior' | 'frost_mage' | 'hunter';

export type PetSpecies = 'bear' | 'chocobo' | 'wolf';

export type UpgradeKind =
  // Warrior
  | 'hp'
  | 'atk'
  | 'armor'
  | 'crit'
  // Frost Mage
  | 'hp_shield'
  | 'shield_speed'
  // Hunter
  | 'atk_speed';

export type UpgradeAccent = 'hp' | 'atk' | 'armor' | 'atkSpeed' | 'crit' | 'shield';

/** Pre-formatted altar upgrade row, produced by the engine and rendered as-is by the UI. */
export interface UpgradeOptionView {
  kind: UpgradeKind;
  accent: UpgradeAccent;
  /** Short button label, e.g. "+10 Max HP" or "HP +3 · 護盾 +7". */
  label: string;
  /** Label shown instead of `label` once maxed, e.g. "HP MAXED". */
  maxedLabel: string;
  /** Progress line, e.g. "120 / 300 HP" or "3 / 20". */
  progress: string;
  count: number;
  maxCount: number;
  maxed: boolean;
}

export interface HeroClassDef {
  id: HeroClassId;
  /** Display name, Traditional Chinese. */
  name: string;
  /** Short English subtitle for the class card. */
  title: string;
  /** One-paragraph description for the class select card. */
  description: string;
  /** Bullet highlights for the class select card. */
  highlights: string[];
  baseHp: number;
  baseShield: number;
  /** Multiplier applied to base potion heal (40 HP). */
  potionHealMult: number;
  /** Multiplier applied to base movement speed (4.65). */
  moveSpeedMult: number;
  skillName: string;
  skillCooldown: number;
  mobilityName: string;
  /** Main accent colour (CSS) for UI theming. */
  accentCss: string;
  /** Secondary accent colour (CSS). */
  secondaryCss: string;
}

export const HERO_CLASSES: Record<HeroClassId, HeroClassDef> = {
  warrior: {
    id: 'warrior',
    name: '燈守戰士',
    title: 'Lantern Warden',
    description: '手持符文巨劍與魂燈的近戰鬥士。厚實血量與護甲，三段連斬第三擊大範圍橫掃，藥水回復量為1.5倍。',
    highlights: ['近戰三段連斬', '右鍵：劍柄重擊（暈眩）', '高血量＋護甲減傷，藥水回復量為1.5倍'],
    baseHp: 60,
    baseShield: 0,
    potionHealMult: 1.5,
    moveSpeedMult: 1.0,
    skillName: '劍柄重擊',
    skillCooldown: 8.0,
    mobilityName: '衝刺',
    accentCss: '#d4a94e',
    secondaryCss: '#1b5a5e',
  },
  frost_mage: {
    id: 'frost_mage',
    name: '冰雪法師',
    title: 'Frost Mage',
    description:
      '操控寒冰的遠程法師。身板脆弱，靠會自動回充的冰晶護盾與緩速控場生存。第三發冰尖彈威力大增。',
    highlights: ['遠程冰尖彈，命中小範圍爆炸', '右鍵：冰霜新星 全螢幕冰爆', '護盾 3 秒未受擊自動回充'],
    baseHp: 20,
    baseShield: 30,
    potionHealMult: 1.0,
    moveSpeedMult: 1.0,
    skillName: '冰霜新星',
    skillCooldown: 10.0,
    mobilityName: '閃現',
    accentCss: '#8fd8ff',
    secondaryCss: '#ffd84a',
  },
  hunter: {
    id: 'hunter',
    name: '赤焰獵人',
    title: 'Amazon Hunter',
    description:
      '身手矯健的紅甲女弓手。天生高速移動、極快連射與 20% 爆擊，能召喚並強化近戰戰寵並肩作戰。',
    highlights: ['高速單體連射，天生 20% 爆擊', '右鍵：召喚戰寵／強化並回血 50%', '天生移動速度 1.2 倍'],
    baseHp: 50,
    baseShield: 0,
    potionHealMult: 1.0,
    moveSpeedMult: 1.2,
    skillName: '召喚戰寵',
    skillCooldown: 7.0,
    mobilityName: '疾步',
    accentCss: '#e8524a',
    secondaryCss: '#f2b84b',
  },
};

export const SELECTABLE_CLASS_IDS: HeroClassId[] = ['warrior', 'frost_mage', 'hunter'];

// ---------------------------------------------------------------------------
// Warrior tuning
// ---------------------------------------------------------------------------
export const WARRIOR = {
  // Altar upgrades (total 60)
  hpPerUpgrade: 12,
  maxHpUpgrades: 20, // 60 + 20 * 12 = 300 HP
  maxAtkUpgrades: 20,
  maxArmorUpgrades: 5,
  maxCritUpgrades: 15,
} as const;

// ---------------------------------------------------------------------------
// Frost Mage tuning
// ---------------------------------------------------------------------------
export const FROST_MAGE = {
  // Ice spike cycle (shot index 0, 1, 2). Cycle never resets on idle.
  shotCooldown: [0.36, 0.36, 0.55] as const,
  /** Damage multiplier relative to warrior normal-hit base (11–16). */
  shotDamageMult: [0.85, 0.85, 1.6] as const,
  shotBaseCrit: [0.08, 0.08, 0.3] as const,
  shotSlowChance: [0.25, 0.25, 0.5] as const,
  shotExplosionRadius: [1.0, 1.0, 2.2] as const,
  projectileSpeed: 17,
  projectileRange: 10,
  projectileHitRadius: 0.55,

  // Slow debuff (applied to move speed AND attack/cast speed)
  slowPct: 0.4,
  slowDuration: 2.0,
  eliteSlowFactor: 0.5, // elites: 40% * 0.5 = 20%
  bossSlowFactor: 0.25, // bosses: 40% * 0.25 = 10%

  // Frost Nova (right click)
  novaRadius: 13,
  novaFreeze: 0.5,
  novaDamageMult: 3.0, // x warrior normal-hit base
  novaKnockback: 3.2, // bosses are not pushed, elites x0.45

  // Blink (replaces Dash)
  blinkDistance: 5,

  // Shield
  shieldDelayBase: 3.0, // seconds without taking damage before regen starts
  shieldRefillBase: 5.0, // seconds to refill from 0 to full
  shieldSpeedStep: 0.12, // each upgrade shortens BOTH by 12% of base (additive)

  // Altar upgrades (total 60)
  hpPerUpgrade: 3,
  shieldPerUpgrade: 7,
  maxHpShieldUpgrades: 20,
  maxAtkUpgrades: 20,
  maxCritUpgrades: 15,
  maxShieldSpeedUpgrades: 5,

  // Relic "max HP" stat split for the mage
  relicHpShareToHp: 0.3,
} as const;

export function getShieldSpeedFactor(shieldSpeedUpgrades: number): number {
  return Math.max(0.1, 1 - FROST_MAGE.shieldSpeedStep * shieldSpeedUpgrades);
}

/** Splits a relic "+max HP" amount into HP and shield portions for the Frost Mage (3 : 7). */
export function splitRelicMaxHpForMage(amount: number): { hp: number; shield: number } {
  const hp = Math.round(amount * FROST_MAGE.relicHpShareToHp);
  return { hp, shield: amount - hp };
}

// ---------------------------------------------------------------------------
// Hunter tuning
// ---------------------------------------------------------------------------
export const HUNTER = {
  // Bow attack (no 3-hit cycle, fast single-target)
  baseShotCooldown: 0.28,
  atkSpeedStep: 0.1, // +10% attack speed per upgrade (max 5 -> +50%)
  shotDamageMult: 0.65, // x warrior normal-hit base (11-16)
  baseCritChance: 0.2,
  projectileSpeed: 22,
  projectileRange: 11,
  projectileHitRadius: 0.45,
  thunderEveryNHits: 4,

  // Altar upgrades (total 60)
  hpPerUpgrade: 8,
  maxHpUpgrades: 20, // 50 + 20 * 8 = 210 HP
  maxAtkUpgrades: 20,
  maxAtkSpeedUpgrades: 5,
  maxCritUpgrades: 15, // +3% each -> +45% (65% with innate 20%)
  critPerUpgradePct: 3,

  // Pet companion
  petBaseHp: 64, // ~65% of unnamed elite base HP (96)
  petDepthHpScale: 0.22,
  petRegenDelay: 3.0, // seconds without damage before out-of-combat regen starts
  petRegenRefill: 10.0, // seconds to refill from 0 to full once regen starts (10%/s)
  petMoveSpeed: 6.0,
  petAggroRange: 9.0,
  petLeashReturnDist: 11.5, // breaks off combat to return to owner beyond this distance
  petTeleportDist: 18.0, // teleports beside owner if stuck / too far
  petAttackReach: 1.55,
  petAttackCooldown: 0.95,
  petDamageMin: 9,
  petDamageMax: 12,

  // Pet skill buff (when pet is already alive)
  petBuffDuration: 5.0,
  petHealFraction: 0.5,
  petBuffAtkMult: 1.2,
  petBuffAtkSpeedMult: 1.2,
  petBuffDamageTakenMult: 0.8, // +20% defense
} as const;

export const PET_SPECIES_LIST: readonly PetSpecies[] = ['bear', 'chocobo', 'wolf'];

export const PET_NAMES: Record<PetSpecies, readonly string[]> = {
  bear: ['巴魯', '鐵掌', '蜜糖', '巨岩', '棕毛', '雷吼', '大壯', '雪爪'],
  chocobo: ['波可', '金羽', '疾風', '小陸', '赤喙', '飛雲', '咕咕', '流光'],
  wolf: ['灰牙', '夜影', '芬里爾', '霜尾', '赤瞳', '孤月', '疾爪', '白狼'],
};

export function getHunterPetMaxHp(depth: number): number {
  return Math.round(HUNTER.petBaseHp * (1 + Math.max(0, depth - 1) * HUNTER.petDepthHpScale));
}

// ---------------------------------------------------------------------------
// Single-player bot teammates
// ---------------------------------------------------------------------------
/** Most bot teammates a single-player run can have. */
export const MAX_BOTS = 3;
/** Fraction of the player's numeric relic bonuses that a bot receives. */
export const BOT_RELIC_SCALE = 0.8;

/** Altar upgrade tracks of each class (same options and caps the Altar of Ascension offers), in display order. */
export const CLASS_UPGRADE_OPTIONS: Record<HeroClassId, ReadonlyArray<{ key: keyof CharacterUpgrades; max: number }>> = {
  warrior: [
    { key: 'hp', max: WARRIOR.maxHpUpgrades },
    { key: 'atk', max: WARRIOR.maxAtkUpgrades },
    { key: 'armor', max: WARRIOR.maxArmorUpgrades },
    { key: 'crit', max: WARRIOR.maxCritUpgrades },
  ],
  frost_mage: [
    { key: 'hpShield', max: FROST_MAGE.maxHpShieldUpgrades },
    { key: 'atk', max: FROST_MAGE.maxAtkUpgrades },
    { key: 'shieldSpeed', max: FROST_MAGE.maxShieldSpeedUpgrades },
    { key: 'crit', max: FROST_MAGE.maxCritUpgrades },
  ],
  hunter: [
    { key: 'hp', max: HUNTER.maxHpUpgrades },
    { key: 'atk', max: HUNTER.maxAtkUpgrades },
    { key: 'atkSpeed', max: HUNTER.maxAtkSpeedUpgrades },
    { key: 'crit', max: HUNTER.maxCritUpgrades },
  ],
};

/** Sum of all upgrade levels of a character (its "total upgrade level"). */
export function sumUpgradeLevels(u: CharacterUpgrades): number {
  let n = 0;
  for (const k of UPGRADE_KEYS) n += Math.max(0, Math.floor(u[k] ?? 0));
  return n;
}

/**
 * Spreads `total` upgrade points round-robin over the class's altar options. A capped option is skipped, so its
 * share goes to the others; leftover points are dropped once every option is capped.
 */
export function distributeUpgradePoints(classId: HeroClassId, total: number): CharacterUpgrades {
  const out = emptyUpgrades();
  const options = CLASS_UPGRADE_OPTIONS[classId];
  let left = Math.max(0, Math.floor(total));
  while (left > 0) {
    let gave = false;
    for (const o of options) {
      if (left <= 0) break;
      if (out[o.key] >= o.max) continue;
      out[o.key] += 1;
      left -= 1;
      gave = true;
    }
    if (!gave) break;
  }
  return out;
}
