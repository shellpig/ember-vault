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

/** One chest of the treasure room. `opened` is the only part that changes after the floor was built. */
export interface TreasureChestData {
  gx: number;
  gz: number;
  opened: boolean;
}

/** The floor's treasure room (docs/treasure-room-spec.md): which room, and where its chests stand. */
export interface TreasureRoomData {
  roomId: number;
  chests: TreasureChestData[];
  /** The local hero already got the "treasure room found" banner for this floor (per client, not synced). */
  announced?: boolean;
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
  /** Set by the host (or the single player engine) right after generation; teammates receive it in the `level` payload. */
  treasure?: TreasureRoomData;
  biome: BiomeConfig;
  /** The random part of the generator seed (multiplayer: the host announces it so every client builds the same map). */
  genSeed?: number;
}

export type EnemyKind =
  // Zone 1 (Depth 1-10): Stone Dungeon
  | 'skeleton'
  | 'slime'
  | 'wisp'
  | 'dungeon_rat'
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
  | 'cavern_mite'
  | 'cavern_spitter'
  | 'cavern_shaman'
  | 'cavern_warden'
  | 'boss_crystal_wyrm'
  | 'boss_fungal_king'
  // Zone 3 (Depth 21-30): Monster Interior (Pink / Purple)
  | 'flesh_cell'
  | 'flesh_tendril'
  | 'flesh_parasite'
  | 'flesh_leech'
  | 'flesh_spiner'
  | 'flesh_eye'
  | 'flesh_brute'
  | 'boss_leviathan_heart'
  | 'boss_abyssal_brain'
  // Zone 4 (Depth 31-40): Alien Spaceship Interior (Bright Blue-Silver Sci-Fi)
  | 'alien_trooper'
  | 'alien_probe'
  | 'alien_saucer'
  | 'alien_nanobot'
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
  AngelBuff,
  RelicItem,
  RelicRarity,
  RelicSummaryStats,
} from './relics';
import type { HeroClassId, PetSpecies, UpgradeOptionView } from './classes';

export interface PetHudInfo {
  species: PetSpecies;
  name: string;
  hp: number;
  maxHp: number;
  buffRemaining: number;
  buffMax: number;
  regenerating: boolean;
}

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
    | 'stun'
    | 'shieldHit' // damage absorbed by the Frost Mage shield (light blue)
    | 'frost'; // freeze / slow status text (icy cyan)
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
  /** Treasure room chests (gold = still closed, grey = opened); drawn only where the tile was explored. */
  chests?: Array<{ x: number; z: number; opened: boolean }>;
  enemies: Array<{ x: number; z: number; isBoss?: boolean; isElite?: boolean }>;
  relics?: Array<{ x: number; z: number; rarity: RelicRarity }>;
}

export interface RunSummary {
  heroClass: HeroClassId;
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
  /** Hunter only: attack-speed bonus in percent (0 for other classes). */
  atkSpeedBonusPct: number;
  critBonusPct: number;
  potionsUsed: number;
  potionsLeft: number;
  totalDamageDealt: number;
  critCount: number;
  slainBy: string;
}

/** A teammate row under the top-left player panel (single-player bots, or the other players of a room). */
export interface CompanionHudInfo {
  id: string;
  name: string;
  classId: HeroClassId;
  level: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  isDead: boolean;
  inTown: boolean;
}

/** A hero entry of the party panel. */
export interface PartyMemberInfo {
  id: string;
  name: string;
  classId: string;
  isSelf: boolean;
  isHost: boolean;
  /** 0 in the dungeon, 1 in town, 2 downed */
  state: 0 | 1 | 2;
}

export interface HudState {
  hp: number;
  maxHp: number; // Effective max HP (baseMaxHp + relic HP bonus)
  baseMaxHp: number; // Altar base max HP (warrior 70..310)
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
  /** Hunter only: attack-speed bonus in percent (0 for other classes). */
  atkSpeedBonusPct: number;
  atkSpeedMaxPct: number;
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
  /** Auto-attack toggle (dock button / T). */
  autoAttack: boolean;
  soundOn: boolean;
  dashReady: boolean;
  pommelCooldown: number;
  pommelMaxCooldown: number;
  fadeOpacity: number;
  aiStatus: string;
  boss: BossHudInfo | null;
  /** All engaged living bosses (1 normally, 2 on Depth 40 dual-boss finale). */
  bosses: BossHudInfo[];
  /** Boss Test Arena 5s wave countdown banner, or null when a wave is active / normal dungeon. */
  arenaCountdown: { sec: number; wave: number; waveDepth: number; label: string } | null;
  isDead: boolean;
  runSummary: RunSummary | null;
  /** 0-1 rescue progress on the (downed) local hero while a teammate is reviving them. */
  beingRescued: number;
  /** The local hero stands next to a downed teammate (hold F). `progress` is 0-1 while the revive runs. */
  rescuePrompt: { name: string; progress: number } | null;
  /** Heroes in the run (local player + bot teammates). */
  partySize: number;
  /** Room games: every hero of the party and where they are (empty in single player). */
  party: PartyMemberInfo[];
  /** Room games: what the held (black) screen is waiting for ("正在進入第 N 層…"), null when nothing is held. */
  mpWait: string | null;
  equippedRelics: RelicItem[];
  relicBag: RelicItem[];
  relicBagCap: number;
  /** Hero is next to the town stash chest. */
  nearStash: boolean;
  /** Stash window is open (engine blocks hero input while true). */
  stashOpen: boolean;
  /** Stash contents; only populated while the window is open. */
  stash: RelicItem[];
  stashCount: number;
  stashCap: number;
  /** Hero is next to the travelling merchant (relic codex). */
  nearCodex: boolean;
  /** Relic codex window is open (engine blocks hero input while true). */
  codexOpen: boolean;
  /** Registered relic codex entries (relic template ids). */
  codexIds: string[];
  relicStats: RelicSummaryStats;
  activeSets: ActiveSetBonus[];
  discoveredRelicIds: string[];
  /** Temporary relic buffs (Selfie Stick, stolen aura, phone shutdown). */
  relicBuffs: Array<{ id: string; label: string; left: number; css: string }>;
  inTown: boolean;
  nearPortal: boolean;
  /** Dungeon: the local hero stands next to a treasure chest that can be opened (F). */
  nearChest: boolean;
  /** Doors the town gate can lead to (own portal, teammates' portals, or the floor entrance). Empty outside town. */
  portalOptions: TownPortalOption[];
  /** In town: teammates are still fighting in the dungeon (it keeps running, monsters will not respawn). */
  dungeonRunning: boolean;
  nearAngel: boolean;
  townReturnCost: number;
  /** Gold the death screen's 回到城鎮 costs (rescue team): townReturnCost x DEATH_RETURN_COST_MULT. */
  deathReturnCost: number;
  angelBuff: AngelBuff | null;
  // --- Hero class (added for multi-class support) ---
  heroClass: HeroClassId;
  /** Current shield points (0 and unused for classes without a shield). */
  shield: number;
  /** Effective max shield (base + upgrades + relic share). 0 = class has no shield. */
  maxShield: number;
  /** True while the shield is regenerating (delay elapsed, not full). */
  shieldRegenerating: boolean;
  /** Right-click skill display name ("Pommel Strike" / "Frost Nova"). Cooldown = pommelCooldown / pommelMaxCooldown. */
  skillName: string;
  /** Mobility skill display name ("Dash" / "Blink"). */
  mobilityName: string;
  /** Altar upgrade rows for the current class, already formatted. */
  upgradeOptions: UpgradeOptionView[];
  /** Active Hunter pet state (shown below the top-left HUD card), or null if none. */
  pet: PetHudInfo | null;
  /** Bots (single player) or the other players (room), shown as compact rows under the player panel. */
  companions: CompanionHudInfo[];
}

/** One selectable dungeon portal in the town gate menu (spec §3.1: any hero may use anybody's portal). */
export interface TownPortalOption {
  /** Id of the hero who owns the portal; `'entrance'` stands for the floor entrance when no portal exists. */
  id: string;
  label: string;
  isOwn: boolean;
  downed: boolean;
}
