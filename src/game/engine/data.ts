import { EnemyKind, ProjectileKind, TerrainTheme } from '../types';

export type FloorBossKind =
  | 'boss_juggernaut'
  | 'boss_lich'
  | 'boss_colossus'
  | 'boss_crystal_wyrm'
  | 'boss_fungal_king'
  | 'boss_leviathan_heart'
  | 'boss_abyssal_brain'
  | 'boss_mothership_ai'
  | 'boss_xeno_commander';

export type BossSkillKind =
  | 'slam'
  | 'charge_slam'
  | 'nova_ring'
  | 'ranged_volley'
  | 'targeted_blast'
  | 'prism_cone'
  | 'orbital_barrage'
  | 'warp_ambush';

/** Stable index order for syncing `bossSkill` over multiplayer snapshots. */
export const BOSS_SKILL_LIST: readonly BossSkillKind[] = [
  'slam',
  'charge_slam',
  'nova_ring',
  'ranged_volley',
  'targeted_blast',
  'prism_cone',
  'orbital_barrage',
  'warp_ambush',
];

/** Special start-depth sentinel for the hidden PC Boss Test Arena (Boss Rush) mode. */
export const BOSS_ARENA_DEPTH = 99;
/** Ordered wave depths spawned in the Boss Test Arena (5F..40F dual-boss, then loops). */
export const BOSS_ARENA_WAVES: readonly number[] = [5, 10, 15, 20, 25, 30, 35, 40];

/** A boss action is either one of its skills (ground telegraph) or a basic attack (docs/boss-spec.md sections 3-5). */
export type BossActionType = 'skill' | 'basic';

/** Melee bosses take less damage; caster / shooter bosses attack faster (docs/boss-spec.md section 2). */
export type BossType = 'melee' | 'caster';

export interface BossConfig {
  name: string;
  title: string;
  bossType: BossType;
  /** Only the relative HP of the nine bosses (individual factor, see `getBossIndividualHpFactor`), not an absolute HP. */
  baseHp: number;
  speed: number;
  damage: number;
  telegraphColor: number;
  telegraphRadius: number;
  triggerRange: number;
  skills: BossSkillKind[];
  projectileKind?: ProjectileKind;
}

/**
 * Town station grid positions (single source for visuals, minimap blips, proximity checks and AI pathing).
 * Screen-up on the isometric camera is -(gx+gz); screen-right is +(gx-gz); plaza centre is (13, 13).
 */
export const TOWN_SHOP_GRID = { gx: 9, gz: 17 };

export const TOWN_ALTAR_GRID = { gx: 11, gz: 19 };

export const TOWN_STASH_GRID = { gx: 17, gz: 18 };

/** Depth 5 is always the first (beginner) boss. */
export const FIRST_BOSS: FloorBossKind = 'boss_juggernaut';

/** Depth 10 is now always the Ossuary Archlich (Molten Colossus moved to Depth 40 dual-boss). */
export const DEPTH10_BOSS: FloorBossKind = 'boss_lich';

export const CAVERN_BOSS_ROTATION: FloorBossKind[] = ['boss_crystal_wyrm', 'boss_fungal_king'];

export const FLESH_BOSS_ROTATION: FloorBossKind[] = ['boss_leviathan_heart', 'boss_abyssal_brain'];

/** Depth 35 = Xeno Overlord, Depth 40 = Omega Core AI (+ Molten Colossus dual-boss). */
export const ALIEN_BOSS_ROTATION: FloorBossKind[] = ['boss_xeno_commander', 'boss_mothership_ai'];

export const SPECIAL_ELITE_NAMES: string[] = [
  // 帥氣／酷炫風格
  '深淵斬魂者',
  '赤炎破軍',
  '虛空行刑官',
  '黑耀暴君',
  '冥府審判長',
  '星辰吞噬者',
  '血月狂戰神',
  '永夜收割者',
  '雷霆碎骨王',
  '霜寒絕影',
  '蒼穹破滅者',
  '煉獄督軍',
  '末日先鋒',
  '孤狼劍聖',
  '幽冥霸主',
  '燼火魔王',
  '暗星領主',
  '鋼鐵巨煞',
  // 搞笑／惡搞風格
  '剛加班完的班長',
  '愛吃宵夜的阿肥',
  '忘了帶鑰匙的守衛',
  '隔壁棚走錯路的王',
  '其實很怕黑的阿強',
  '地城房東收租中',
  '剛睡醒脾氣很差',
  '全勤獎落空怨念體',
  '減肥永遠明天的霸王',
  '鍵盤戰神本尊',
  '還沒喝咖啡的暴君',
  '這層的地下里長伯',
  '踩到樂高的怒吼者',
  '月底吃土的貴族',
  '自稱主角的配角',
  '滑倒三次的戰神',
  '沒開冷氣很暴躁',
  '忘記存檔的勇者',
];

/** Small integer hash (xorshift-multiply) used to derive deterministic per-floor choices from the dungeon seed. */
function hashSeed(seed: number, salt: number): number {
  let h = Math.imul((seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The floor boss of a boss floor. `genSeed` is the dungeon's generation seed (`DungeonData.genSeed`): in a room the host
 * announces it in `level.seed` and every client regenerates the same dungeon from it, so the depth-10 random pick is
 * identical everywhere without any extra protocol field (docs/boss-spec.md section 8).
 */
export function getBossForDepth(depth: number, theme: TerrainTheme, _genSeed = 0): FloorBossKind {
  const bossIdx = Math.max(0, Math.floor(depth / 5) - 1);
  if (theme === 'cavern') {
    return CAVERN_BOSS_ROTATION[bossIdx % CAVERN_BOSS_ROTATION.length];
  }
  if (theme === 'flesh') {
    return FLESH_BOSS_ROTATION[bossIdx % FLESH_BOSS_ROTATION.length];
  }
  if (theme === 'alien') {
    return ALIEN_BOSS_ROTATION[bossIdx % ALIEN_BOSS_ROTATION.length];
  }
  if (depth <= 5) return FIRST_BOSS;
  return DEPTH10_BOSS;
}

/** Returns all floor bosses spawned on a boss floor (Depth 40 is the dual-boss finale). */
export function getBossesForDepth(depth: number, theme: TerrainTheme, genSeed = 0): FloorBossKind[] {
  const primary = getBossForDepth(depth, theme, genSeed);
  if (depth === 40) return [primary, 'boss_colossus'];
  return [primary];
}

export const BOSS_CONFIGS: Record<FloorBossKind, BossConfig> = {
  // Depth 5 (First Boss): kept unchanged with classic heavy slam
  boss_juggernaut: {
    name: 'IRONCLAD WARDEN',
    bossType: 'melee',
    title: 'Catacomb Dread Knight',
    baseHp: 175,
    speed: 2.1,
    damage: 16,
    telegraphColor: 0xff4438,
    telegraphRadius: 2.75,
    triggerRange: 2.85,
    skills: ['slam'],
  },
  // Depth 10 (Fixed): Arcane Violet 6-Laser Nova + Multicolor Void Black Hole
  boss_lich: {
    name: 'OSSUARY ARCHLICH',
    bossType: 'caster',
    title: 'Sovereign of Bone & Hex',
    baseHp: 160,
    speed: 2.3,
    damage: 15,
    telegraphColor: 0xc85cff,
    telegraphRadius: 3.0,
    triggerRange: 3.35,
    skills: ['nova_ring', 'targeted_blast'],
    projectileKind: 'mage_orb',
  },
  // Depth 40 Dual-Boss Partner: Molten Colossus
  boss_colossus: {
    name: 'MOLTEN COLOSSUS',
    bossType: 'melee',
    title: 'Abyssal Furnace Golem',
    baseHp: 195,
    speed: 1.92,
    damage: 17,
    telegraphColor: 0xff7b24,
    telegraphRadius: 2.8,
    triggerRange: 3.1,
    skills: ['charge_slam', 'slam'],
  },
  // Depth 15 Cavern Boss #1 (Slam expanded range + Charge + Royal-Blue Warp Ambush)
  boss_crystal_wyrm: {
    name: 'CRYSTAL BEHEMOTH',
    bossType: 'melee',
    title: 'Prism-Crowned Cavern Titan',
    baseHp: 195,
    speed: 2.15,
    damage: 17,
    telegraphColor: 0x3be8ff,
    telegraphRadius: 3.6,
    triggerRange: 4.2,
    skills: ['slam', 'charge_slam', 'warp_ambush'],
    projectileKind: 'crystal_shard',
  },
  // Depth 20 Cavern Boss #2 (Spore Slam + Laser Nova + Orbital Barrage)
  boss_fungal_king: {
    name: 'SPORE SOVEREIGN',
    bossType: 'caster',
    title: 'Monarch of the Glowcap Grotto',
    baseHp: 185,
    speed: 2.05,
    damage: 16,
    telegraphColor: 0x4ef58a,
    telegraphRadius: 3.05,
    triggerRange: 3.2,
    skills: ['slam', 'nova_ring', 'orbital_barrage'],
    projectileKind: 'spore_orb',
  },
  // Depth 25 Monster Interior Boss #1 (Bone Volley + Arterial Charge + Prism Cone)
  boss_leviathan_heart: {
    name: 'HEART OF THE BEAST',
    bossType: 'melee',
    title: 'Crimson Core of the Leviathan',
    baseHp: 210,
    speed: 2.08,
    damage: 18,
    telegraphColor: 0xff4c29,
    telegraphRadius: 2.95,
    triggerRange: 3.05,
    skills: ['ranged_volley', 'charge_slam', 'prism_cone'],
    projectileKind: 'bone_dart',
  },
  // Depth 30 Monster Interior Boss #2 (Bio-Plasma Fan + Black Hole + Orbital Barrage)
  boss_abyssal_brain: {
    name: 'NEURAL OVERMIND',
    bossType: 'caster',
    title: 'Encephalon of Abyssal Viscera',
    baseHp: 192,
    speed: 2.32,
    damage: 17,
    telegraphColor: 0x36f5d4,
    telegraphRadius: 3.1,
    triggerRange: 3.3,
    skills: ['ranged_volley', 'targeted_blast', 'orbital_barrage'],
    projectileKind: 'bio_orb',
  },
  // Depth 40 Alien Spaceship Finale Boss #1 (Ion Barrage + Tech Blue 8-Laser Nova + Orbital Barrage; paired with Molten Colossus)
  boss_mothership_ai: {
    name: 'OMEGA CORE AI',
    bossType: 'caster',
    title: 'Sovereign Starship Mainframe',
    baseHp: 215,
    speed: 2.38,
    damage: 18,
    telegraphColor: 0xff4757,
    telegraphRadius: 3.1,
    triggerRange: 3.4,
    skills: ['ranged_volley', 'nova_ring', 'orbital_barrage'],
    projectileKind: 'ion_orb',
  },
  // Depth 35 Alien Spaceship Boss #1 (Plasma Spread + Warp Charge + Plasma Prism Cone + Royal-Blue Warp Ambush)
  boss_xeno_commander: {
    name: 'XENO OVERLORD',
    bossType: 'melee',
    title: 'Grand Admiral of the Armada',
    baseHp: 230,
    speed: 2.22,
    damage: 19,
    telegraphColor: 0x39ff7a,
    telegraphRadius: 3.0,
    triggerRange: 3.15,
    skills: ['ranged_volley', 'charge_slam', 'prism_cone', 'warp_ambush'],
    projectileKind: 'plasma_bolt',
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Boss rework tuning (docs/boss-spec.md). Every number of the boss fights lives here.
// ---------------------------------------------------------------------------------------------------------------

/** Section 1: HP = 30 (hardest elite-able mob) x 5 (named elite 4 x 1.25) x 1.5 x 0.9, then the mob depth growth. */
export const BOSS_HP = {
  mobBaseHp: 30,
  namedEliteMult: 4 * 1.25,
  bossMult: 1.5,
  tuneMult: 0.9,
  /** Same growth as normal monsters: 1 + (depth - 1) x this. */
  depthGrowth: 0.22,
  /** The nine bosses keep their old relative `baseHp` difference, clamped to +-this fraction. */
  individualClamp: 0.1,
} as const;

/** Section 2: melee-type bosses take 25% less damage (added to the depth tier's reduction below). */
export const BOSS_MELEE_DAMAGE_REDUCTION = 0.25;

/**
 * Section 1b: depth tiers (user tuning after the first balance run). Every boss of the tier gets the extra damage
 * reduction (additive with the melee 25%), an HP multiplier and extra escorts around it.
 * `mobs` = extra regular escorts, `elites` = extra unnamed elites, `named` = extra named (special) elites.
 */
export interface BossDepthTier {
  maxDepth: number;
  damageReduction: number;
  hpMult: number;
  mobs: number;
  elites: number;
  named: number;
}
export const BOSS_DEPTH_TIERS: readonly BossDepthTier[] = [
  { maxDepth: 10, damageReduction: 0.1, hpMult: 1.1, mobs: 1, elites: 0, named: 0 },
  { maxDepth: 20, damageReduction: 0.15, hpMult: 1.25, mobs: 2, elites: 1, named: 0 },
  { maxDepth: 30, damageReduction: 0.2, hpMult: 1.5, mobs: 3, elites: 0, named: 1 },
  { maxDepth: 39, damageReduction: 0.3, hpMult: 2.0, mobs: 3, elites: 0, named: 2 },
  // Depth 40 dual-boss finale: no elite escorts, 4 regular mobs; each boss gets 0.7x dual-boss HP factor
  { maxDepth: Infinity, damageReduction: 0.3, hpMult: 1.4, mobs: 4, elites: 0, named: 0 },
];

/** Boss depth tier of a floor (floors past 40 keep the last tier). */
export function getBossDepthTier(depth: number): BossDepthTier {
  return BOSS_DEPTH_TIERS.find((t) => depth <= t.maxDepth) ?? BOSS_DEPTH_TIERS[BOSS_DEPTH_TIERS.length - 1];
}

/** Multiplier applied to every hit a boss takes: 1 - (melee 25%) - tier reduction. */
export function getBossDamageTakenMult(kind: FloorBossKind, depth: number): number {
  const melee = BOSS_CONFIGS[kind].bossType === 'melee' ? BOSS_MELEE_DAMAGE_REDUCTION : 0;
  return Math.max(0.05, 1 - melee - getBossDepthTier(depth).damageReduction);
}
export const BOSS_CASTER_BASIC_SPEED_MULT = 1.25;

/** Section 3: how the five skills behave. `damage` is a fraction of `cfg.damage x getDepthDamageScale()`. */
export interface BossSkillSpec {
  windup: number;
  strike: number;
  damage: number;
  /** Max distance (to the target hero) at which the skill may be started. `null` = `cfg.triggerRange` (+ `rangeBonus`). */
  range: number | null;
  rangeBonus?: number;
  needsLos?: boolean;
  /** Radius of the ground circle; `null` = `cfg.telegraphRadius`. */
  radius: number | null;
}

/** warp_ambush: royal-blue 5-ring spatial ambush targeting a player outside slam triggerRange. */
export const BOSS_WARP = {
  windup: 0.6,
  ascendDur: 0.22,
  descendDur: 0.25,
  landDistMin: 1.4,
  landDistMax: 1.8,
  liftHeight: 5.4,
  color: 0x246bff,
  telegraphRadius: 2.2,
  /** Extended warp ambush range once the boss is aggroed (so kiting past 12.5 tiles gets punished!). */
  aggroMaxRange: 18,
} as const;

export const BOSS_SKILLS: Record<BossSkillKind, BossSkillSpec> = {
  slam: { windup: 0.8, strike: 0.1, damage: 1.5, range: null, radius: null },
  nova_ring: { windup: 0.6, strike: 0.1, damage: 0.9, range: 8.5, radius: null },
  charge_slam: { windup: 0.7, strike: 0.3, damage: 1.25, range: 5.4, needsLos: true, radius: 2.25 },
  ranged_volley: { windup: 0.5, strike: 0.1, damage: 0.9, range: 7.8, needsLos: true, radius: 1.45 },
  targeted_blast: { windup: 0.95, strike: 0.1, damage: 1.5, range: 10.5, radius: 2.25 },
  prism_cone: { windup: 0.75, strike: 0.1, damage: 1.35, range: 6.8, radius: 6.4 },
  orbital_barrage: { windup: 0.65, strike: 0.1, damage: 0.95, range: 9.5, radius: 1.85 },
  warp_ambush: {
    windup: BOSS_WARP.windup,
    strike: BOSS_WARP.ascendDur + BOSS_WARP.descendDur,
    damage: 0,
    range: 11.5,
    radius: BOSS_WARP.telegraphRadius,
  },
};

/** prism_cone: 70-degree stained-glass crystal/bone/plasma fan (tracks first 40% of windup, then locks; +10% length = 6.4). */
export const BOSS_PRISM = {
  halfAngle: (35 * Math.PI) / 180,
  range: 6.4,
  aimTrackFraction: 0.4,
} as const;

/** orbital_barrage: 3 sequential sky-to-ground energy pillars chasing live heroes. */
export const BOSS_ORBITAL = {
  shots: 3,
  shotInterval: 0.38,
  windup: 0.65,
  radius: 1.85,
} as const;

/** nova_ring: radial bright-white laser beams (stop at walls, single hit per target across centre + beams). */
export const BOSS_NOVA = {
  beams: 6,
  beamsDeep: 8,
  deepFromDepth: 21,
  beamMaxRange: 18,
  beamHalfWidth: 0.3,
  /** Duration (s) the fired laser beams actively check hits (each hero/pet can only be hit once). */
  activeHitWindow: 0.58,
} as const;

/** charge_slam geometry (the dash itself lasts `BOSS_SKILLS.charge_slam.strike`). */
export const BOSS_CHARGE = {
  maxLunge: 4.6,
  minLunge: 1.5,
  impactProgress: 0.88,
  /** Half-width of the damaging dash corridor (aligned with the glowing trench fissure). */
  corridorHalfWidth: 1.05,
} as const;

/** ranged_volley: 3 fan shots, aim follows the hero for the first part of the windup then locks. */
export const BOSS_VOLLEY = { spread: [-0.28, 0, 0.28], projectileSpeed: 6.6, boneDartSpeed: 7.8, aimTrackFraction: 0.6 } as const;

/** Every action (skill or basic) ends with: strike -> recovery (stiffness) -> cooldown -> next action. */
export const BOSS_RECOVER = 0.5;
export const BOSS_COOLDOWN = 0.5;
/** Distance at which an un-aggroed boss wakes up and begins chasing; once aggroed it pursues indefinitely. */
export const BOSS_CHASE_WAKE_RANGE = 12.5;
/** A boss starts looking for an action when the target hero is closer than this. */
export const BOSS_ENGAGE_RANGE = 11.5;

/** Section 4: basic attacks. */
export const BOSS_BASIC = {
  melee: { reach: 1.8, windup: 0.3, strike: 0.1, damage: 0.6 },
  caster: { range: 8, windup: 0.3, strike: 0.1, damage: 0.5, projectileSpeed: 8, defaultProjectile: 'mage_orb' as ProjectileKind },
} as const;

/** Section 5: 50/50 between skill and basic, never this many of the same type in a row. */
export const BOSS_ACTION = {
  skillChance: 0.5,
  maxSameInRow: 2,
  /** If a melee boss wants a basic attack but cannot reach the hero for this long (s), fall back to a skill. */
  meleeBasicChaseTimeout: 1.2,
} as const;

/** Section 6. */
export const BOSS_ENRAGE = {
  hpFraction: 0.5,
  speedMult: 1.5,
  damageMult: 1.25,
  color: 0xff2a1a,
  shakeMagnitude: 0.6,
  shakeDuration: 0.5,
} as const;

/** Section 7. */
/** Gold coins of every hero's hoard (value x goldMult). The yellow-or-better relic guarantee lives in `rollRelicDrops` (relics.ts). */
export const BOSS_LOOT = { goldMult: 1.5, coinCount: 12 } as const;

/** Section 9: AI dodge tuning. */
export const BOSS_AI = {
  /** Keep this far outside a telegraph circle. */
  circleMargin: 0.65,
  /** Dash when the windup has this little time left and we are still inside (a dash also grants i-frames). */
  dashLeadTime: 0.22,
  /** An enraged boss is kited from further away than this (ranged heroes). */
  enragedKiteDist: 5.2,
} as const;

/** Individual HP factor of a boss: its old `baseHp` relative to the nine-boss average, clamped to +-`individualClamp`. */
const BOSS_BASE_HP_AVG =
  Object.values(BOSS_CONFIGS).reduce((sum, c) => sum + c.baseHp, 0) / Object.keys(BOSS_CONFIGS).length;

export function getBossIndividualHpFactor(kind: FloorBossKind): number {
  const rel = (BOSS_CONFIGS[kind].baseHp - BOSS_BASE_HP_AVG) / BOSS_BASE_HP_AVG;
  return 1 + Math.max(-BOSS_HP.individualClamp, Math.min(BOSS_HP.individualClamp, rel));
}

/** Boss max HP for one hero (the party size factor `getEnemyHpScale()` is multiplied on top by the caller). */
export function getBossBaseMaxHp(kind: FloorBossKind, depth: number): number {
  const base = BOSS_HP.mobBaseHp * BOSS_HP.namedEliteMult * BOSS_HP.bossMult * BOSS_HP.tuneMult;
  return base * (1 + (depth - 1) * BOSS_HP.depthGrowth) * getBossIndividualHpFactor(kind);
}

export function isFloorBoss(kind: EnemyKind): kind is FloorBossKind {
  return (
    kind === 'boss_juggernaut' ||
    kind === 'boss_lich' ||
    kind === 'boss_colossus' ||
    kind === 'boss_crystal_wyrm' ||
    kind === 'boss_fungal_king' ||
    kind === 'boss_leviathan_heart' ||
    kind === 'boss_abyssal_brain' ||
    kind === 'boss_mothership_ai' ||
    kind === 'boss_xeno_commander'
  );
}

export function isArcherLikeRanged(kind: EnemyKind): boolean {
  return (
    kind === 'archer' ||
    kind === 'cavern_spitter' ||
    kind === 'flesh_spiner' ||
    kind === 'alien_gunner'
  );
}

export function isMageLikeRanged(kind: EnemyKind): boolean {
  return (
    kind === 'mage' ||
    kind === 'cavern_shaman' ||
    kind === 'flesh_eye' ||
    kind === 'alien_psion'
  );
}

export function isRangedEnemy(kind: EnemyKind): boolean {
  return isArcherLikeRanged(kind) || isMageLikeRanged(kind);
}

export function isGuardianEnemy(kind: EnemyKind): boolean {
  return (
    kind === 'guardian' ||
    kind === 'cavern_warden' ||
    kind === 'flesh_brute' ||
    kind === 'alien_mech'
  );
}

export function isSwarmEnemy(kind: EnemyKind): boolean {
  return (
    kind === 'dungeon_rat' ||
    kind === 'cavern_mite' ||
    kind === 'flesh_leech' ||
    kind === 'alien_nanobot'
  );
}

export function getRangedProjectileKind(kind: EnemyKind): ProjectileKind {
  switch (kind) {
    case 'cavern_spitter':
      return 'crystal_shard';
    case 'cavern_shaman':
      return 'spore_orb';
    case 'flesh_spiner':
      return 'bone_dart';
    case 'flesh_eye':
      return 'bio_orb';
    case 'alien_gunner':
      return 'plasma_bolt';
    case 'alien_psion':
      return 'ion_orb';
    case 'mage':
      return 'mage_orb';
    default:
      return 'arrow';
  }
}

/** A teammate's predicted crate break is undone if the host's snapshot has not confirmed it after this long (ms). */
export const MP_BREAK_CONFIRM_MS = 1500;
