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

export type BossSkillKind = 'slam' | 'charge_slam' | 'nova_ring' | 'ranged_volley' | 'targeted_blast';

export interface BossConfig {
  name: string;
  title: string;
  baseHp: number;
  speed: number;
  damage: number;
  telegraphColor: number;
  telegraphRadius: number;
  triggerRange: number;
  windupDuration: number;
  strikeDuration: number;
  recoverDuration: number;
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

export const DUNGEON_BOSS_ROTATION: FloorBossKind[] = [
  'boss_juggernaut',
  'boss_lich',
  'boss_colossus',
];

export const CAVERN_BOSS_ROTATION: FloorBossKind[] = ['boss_crystal_wyrm', 'boss_fungal_king'];

export const FLESH_BOSS_ROTATION: FloorBossKind[] = ['boss_leviathan_heart', 'boss_abyssal_brain'];

export const ALIEN_BOSS_ROTATION: FloorBossKind[] = ['boss_mothership_ai', 'boss_xeno_commander'];

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

export function getBossForDepth(depth: number, theme: TerrainTheme): FloorBossKind {
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
  return DUNGEON_BOSS_ROTATION[bossIdx % DUNGEON_BOSS_ROTATION.length];
}

export const BOSS_CONFIGS: Record<FloorBossKind, BossConfig> = {
  // Depth 5 (First Boss): kept unchanged with classic heavy slam
  boss_juggernaut: {
    name: 'IRONCLAD WARDEN',
    title: 'Catacomb Dread Knight',
    baseHp: 175,
    speed: 2.1,
    damage: 16,
    telegraphColor: 0xff4438,
    telegraphRadius: 2.75,
    triggerRange: 2.85,
    windupDuration: 0.92,
    strikeDuration: 0.26,
    recoverDuration: 1.05,
    skills: ['slam'],
  },
  // Depth 10: Arcane Hex Ring Nova (distinct from first boss)
  boss_lich: {
    name: 'OSSUARY ARCHLICH',
    title: 'Sovereign of Bone & Hex',
    baseHp: 160,
    speed: 2.3,
    damage: 15,
    telegraphColor: 0xc85cff,
    telegraphRadius: 3.0,
    triggerRange: 3.35,
    windupDuration: 0.96,
    strikeDuration: 0.28,
    recoverDuration: 1.0,
    skills: ['nova_ring'],
    projectileKind: 'mage_orb',
  },
  // Alternate Dungeon Boss: Molten Rush Charge
  boss_colossus: {
    name: 'MOLTEN COLOSSUS',
    title: 'Abyssal Furnace Golem',
    baseHp: 195,
    speed: 1.92,
    damage: 17,
    telegraphColor: 0xff7b24,
    telegraphRadius: 2.65,
    triggerRange: 2.95,
    windupDuration: 0.9,
    strikeDuration: 0.34,
    recoverDuration: 1.15,
    skills: ['charge_slam'],
  },
  // Depth 11-20 Cavern Boss #1 (2 Skills: Slam + Crystal Dash Rush)
  boss_crystal_wyrm: {
    name: 'CRYSTAL BEHEMOTH',
    title: 'Prism-Crowned Cavern Titan',
    baseHp: 195,
    speed: 2.15,
    damage: 17,
    telegraphColor: 0x3be8ff,
    telegraphRadius: 2.85,
    triggerRange: 3.0,
    windupDuration: 0.9,
    strikeDuration: 0.32,
    recoverDuration: 1.05,
    skills: ['slam', 'charge_slam'],
    projectileKind: 'crystal_shard',
  },
  // Depth 11-20 Cavern Boss #2 (2 Skills: Spore Slam + 6-Orb Spore Ring)
  boss_fungal_king: {
    name: 'SPORE SOVEREIGN',
    title: 'Monarch of the Glowcap Grotto',
    baseHp: 185,
    speed: 2.05,
    damage: 16,
    telegraphColor: 0x4ef58a,
    telegraphRadius: 3.05,
    triggerRange: 3.2,
    windupDuration: 0.94,
    strikeDuration: 0.28,
    recoverDuration: 1.05,
    skills: ['slam', 'nova_ring'],
    projectileKind: 'spore_orb',
  },
  // Depth 21-30 Monster Interior Boss #1 (3 Skills incl. Ranged: Bone Volley + Arterial Lunge + Pulse Ring)
  boss_leviathan_heart: {
    name: 'HEART OF THE BEAST',
    title: 'Crimson Core of the Leviathan',
    baseHp: 210,
    speed: 2.08,
    damage: 18,
    telegraphColor: 0xff8826,
    telegraphRadius: 2.95,
    triggerRange: 3.05,
    windupDuration: 0.88,
    strikeDuration: 0.32,
    recoverDuration: 1.05,
    skills: ['ranged_volley', 'charge_slam', 'nova_ring'],
    projectileKind: 'bone_dart',
  },
  // Depth 21-30 Monster Interior Boss #2 (3 Skills incl. Ranged: Bio-Plasma Fan + Targeted Lock Blast + Synapse Ring)
  boss_abyssal_brain: {
    name: 'NEURAL OVERMIND',
    title: 'Encephalon of Abyssal Viscera',
    baseHp: 192,
    speed: 2.32,
    damage: 17,
    telegraphColor: 0x36f5d4,
    telegraphRadius: 3.1,
    triggerRange: 3.3,
    windupDuration: 0.92,
    strikeDuration: 0.28,
    recoverDuration: 1.0,
    skills: ['ranged_volley', 'targeted_blast', 'nova_ring'],
    projectileKind: 'bio_orb',
  },
  // Depth 31-40 Alien Spaceship Boss #1 (3 Skills incl. Ranged: Ion Barrage + Orbital Target Lock + Quantum Nova)
  boss_mothership_ai: {
    name: 'OMEGA CORE AI',
    title: 'Sovereign Starship Mainframe',
    baseHp: 215,
    speed: 2.38,
    damage: 18,
    telegraphColor: 0xff4757,
    telegraphRadius: 3.1,
    triggerRange: 3.4,
    windupDuration: 0.9,
    strikeDuration: 0.28,
    recoverDuration: 0.98,
    skills: ['ranged_volley', 'targeted_blast', 'nova_ring'],
    projectileKind: 'ion_orb',
  },
  // Depth 31-40 Alien Spaceship Boss #2 (3 Skills incl. Ranged: Plasma Spread + Warp Lunge + EMP Ring)
  boss_xeno_commander: {
    name: 'XENO OVERLORD',
    title: 'Grand Admiral of the Armada',
    baseHp: 230,
    speed: 2.22,
    damage: 19,
    telegraphColor: 0x39ff7a,
    telegraphRadius: 3.0,
    triggerRange: 3.15,
    windupDuration: 0.86,
    strikeDuration: 0.32,
    recoverDuration: 1.0,
    skills: ['ranged_volley', 'charge_slam', 'nova_ring'],
    projectileKind: 'plasma_bolt',
  },
};

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
