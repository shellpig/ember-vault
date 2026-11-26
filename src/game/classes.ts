// Hero class definitions shared by the engine and the UI.
// All gameplay numbers for each class live here so balance tweaks stay in one place.
// Distances are WORLD UNITS (1 tile = TILE_SIZE = 2.0 world units).

export type HeroClassId = 'warrior' | 'frost_mage';

export type UpgradeKind =
  // Warrior
  | 'hp'
  | 'atk'
  | 'armor'
  | 'crit'
  // Frost Mage
  | 'hp_shield'
  | 'shield_speed';

export type UpgradeAccent = 'hp' | 'atk' | 'armor' | 'crit' | 'shield';

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
    skillName: '冰霜新星',
    skillCooldown: 10.0,
    mobilityName: '閃現',
    accentCss: '#8fd8ff',
    secondaryCss: '#ffd84a',
  },
};

export const SELECTABLE_CLASS_IDS: HeroClassId[] = ['warrior', 'frost_mage'];

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
