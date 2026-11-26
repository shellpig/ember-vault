export type TileType =
  | 0 // Void
  | 1 // Floor
  | 2 // Wall
  | 3 // Locked Gate (passable once unlocked)
  | 4 // Descending Stairs
  | 5 // Pillar (impassable floor decoration)
  | 6; // Spike Trap (walkable, periodic hazard)

export type TerrainTheme = 'dungeon' | 'cavern' | 'flesh' | 'alien';

export type BiomeId =
  | 'catacombs'
  | 'ossuary'
  | 'forge'
  | 'cavern_crystal'
  | 'cavern_fungal'
  | 'flesh_maw'
  | 'flesh_heart'
  | 'alien_deck'
  | 'alien_core';

export interface BiomeConfig {
  id: BiomeId;
  terrainTheme: TerrainTheme;
  name: string;
  fogColor: number;
  floorBase: string;
  floorAccent: string;
  floorMortar: string;
  wallBase: string;
  wallAccent: string;
  bannerColor: string;
  runeColor: number;
  runeCss: string;
  torchColor: number;
  hemiSky: number;
  hemiGround: number;
}

export interface RoomRect {
  id: number;
  x: number;
  z: number;
  w: number;
  h: number;
  cx: number;
  cz: number;
  role: 'start' | 'combat' | 'shrine' | 'key' | 'exit';
}

export interface DungeonPropData {
  type: 'torch' | 'brazier' | 'rune_well' | 'crate' | 'urn' | 'banner' | 'spike';
  gx: number;
  gz: number;
  facing?: number; // radians for wall torches / banners
}

export interface DungeonData {
  width: number;
  height: number;
  tiles: TileType[][];
  explored: boolean[][];
  rooms: RoomRect[];
  props: DungeonPropData[];
  spawn: { gx: number; gz: number };
  keyPos: { gx: number; gz: number };
  doorPos: { gx: number; gz: number; horizontal: boolean };
  stairsPos: { gx: number; gz: number };
  altarPos?: { gx: number; gz: number };
  shopPos?: { gx: number; gz: number };
  biome: BiomeConfig;
}

export type EnemyKind =
  // Zone 1 (Depth 1-10): Stone Dungeon
  | 'skeleton'
  | 'slime'
  | 'wisp'
  | 'archer'
  | 'mage'
  | 'guardian'
  | 'boss_juggernaut'
  | 'boss_lich'
  | 'boss_colossus'
  // Zone 2 (Depth 11-20): Subterranean Cavern
  | 'cavern_beetle'
  | 'cavern_golem'
  | 'cavern_bat'
  | 'cavern_spitter'
  | 'cavern_shaman'
  | 'cavern_warden'
  | 'boss_crystal_wyrm'
  | 'boss_fungal_king'
  // Zone 3 (Depth 21-30): Monster Interior (Pink / Purple)
  | 'flesh_cell'
  | 'flesh_tendril'
  | 'flesh_parasite'
  | 'flesh_spiner'
  | 'flesh_eye'
  | 'flesh_brute'
  | 'boss_leviathan_heart'
  | 'boss_abyssal_brain'
  // Zone 4 (Depth 31-40): Alien Spaceship Interior (Bright Blue-Silver Sci-Fi)
  | 'alien_trooper'
  | 'alien_probe'
  | 'alien_saucer'
  | 'alien_gunner'
  | 'alien_psion'
  | 'alien_mech'
  | 'boss_mothership_ai'
  | 'boss_xeno_commander';

export type ProjectileKind =
  | 'arrow'
  | 'mage_orb'
  | 'crystal_shard'
  | 'spore_orb'
  | 'bone_dart'
  | 'bio_orb'
  | 'plasma_bolt'
  | 'ion_orb';

export type BossAttackState = 'chase' | 'windup' | 'strike' | 'recover';

export interface BossHudInfo {
  name: string;
  title: string;
  hp: number;
  maxHp: number;
  state: BossAttackState;
}

import type {
  ActiveSetBonus,
  RelicItem,
  RelicRarity,
  RelicSummaryStats,
} from './relics';

export interface FloatingLabelData {
  id: number;
  text: string;
  x: number;
  y: number;
  tone:
    | 'damage'
    | 'crit'
    | 'playerHit'
    | 'heal'
    | 'gold'
    | 'key'
    | 'info'
    | 'block'
    | 'relicBlue'
    | 'relicYellow'
    | 'relicOrange'
    | 'relicGreen'
    | 'stun';
}

export interface BannerEvent {
  id: number;
  title: string;
  subtitle?: string;
}

export interface MinimapSnapshot {
  width: number;
  height: number;
  tiles: TileType[][];
  explored: boolean[][];
  terrainTheme?: TerrainTheme;
  playerX: number;
  playerZ: number;
  keyX: number;
  keyZ: number;
  hasKey: boolean;
  doorX: number;
  doorZ: number;
  doorUnlocked: boolean;
  stairsX: number;
  stairsZ: number;
  altarX?: number;
  altarZ?: number;
  shopX?: number;
  shopZ?: number;
  enemies: Array<{ x: number; z: number; isBoss?: boolean; isElite?: boolean }>;
  relics?: Array<{ x: number; z: number; rarity: RelicRarity }>;
}

export interface RunSummary {
  depth: number;
  biomeName: string;
  durationSec: number;
  totalGoldEarned: number;
  goldRemaining: number;
  totalKills: number;
  normalKills: number;
  eliteKills: number;
  bossKills: number;
  upgradeLevel: number;
  hpUpgrades: number;
  atkUpgrades: number;
  armorUpgrades: number;
  critUpgrades: number;
  maxHp: number;
  atkBonusPct: number;
  armorBonusPct: number;
  critBonusPct: number;
  potionsUsed: number;
  potionsLeft: number;
  totalDamageDealt: number;
  critCount: number;
  slainBy: string;
}

export interface HudState {
  hp: number;
  maxHp: number; // Effective max HP (baseMaxHp + relic HP bonus)
  baseMaxHp: number; // Altar base max HP (60..300)
  maxHpCap: number;
  potions: number;
  hasKey: boolean;
  doorUnlocked: boolean;
  depth: number;
  biomeName: string;
  gold: number;
  kills: number;
  atkBonusPct: number;
  armorBonusPct: number;
  armorMaxPct: number;
  critBonusPct: number;
  critMaxPct: number;
  upgradeLevel: number;
  upgradeCost: number;
  potionCost: number;
  nearAltar: boolean;
  hasAltarOnFloor: boolean;
  nearShop: boolean;
  hasShopOnFloor: boolean;
  controlMode: 'auto' | 'manual';
  soundOn: boolean;
  dashReady: boolean;
  pommelCooldown: number;
  pommelMaxCooldown: number;
  fadeOpacity: number;
  aiStatus: string;
  boss: BossHudInfo | null;
  isDead: boolean;
  runSummary: RunSummary | null;
  equippedRelics: RelicItem[];
  relicBag: RelicItem[];
  relicBagCap: number;
  relicStats: RelicSummaryStats;
  activeSets: ActiveSetBonus[];
  discoveredRelicIds: string[];
}
