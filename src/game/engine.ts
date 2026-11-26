import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DungeonAudio } from './audio';
import {
  TILE_SIZE,
  findGridPath,
  generateDungeon,
  gridToWorld,
  hasLineOfSight,
  isTileWalkable,
  worldToGrid,
  worldToWalkableGrid,
} from './dungeon';
import {
  AngelRig,
  BossTelegraphRig,
  EnemyRig,
  GateRig,
  HeroRig,
  RelicLootRig,
  SpikeTrapRig,
  TownPortalRig,
  applyEliteVisuals,
  createAngelModel,
  createBossTelegraph,
  createBrazier,
  createCentralWell,
  createCrateProp,
  createEnemyModel,
  createHeroModel,
  createHeroSetAura,
  createFrostMageModel,
  createIceSpikeMesh,
  createFrozenShell,
  createSlowMarker,
  createKeyPedestal,
  createLootMesh,
  createPotionShop,
  createProjectileMesh,
  createRelicLootMesh,
  createRuneWell,
  createStairwell,
  createTownHouse,
  createTownPortal,
  createUpgradeAltar,
  createVillageLampPost,
  createVillageTree,
  createWallTorch,
  createLockedGate,
  createSpikeTrap,
  createStunStars,
} from './models';
import {
  AngelBuff,
  RelicDropSource,
  RelicItem,
  RelicSetId,
  RelicSummaryStats,
  UniqueEffectId,
  computeRelicSummary,
  evaluateRelicLoadoutScore,
  getRarityColorHex,
  rollAngelBlessing,
  rollRelicDrops,
} from './relics';
import { DungeonTextureSet, createDungeonTextures } from './textures';
import {
  FROST_MAGE,
  HERO_CLASSES,
  HeroClassId,
  UpgradeKind,
  UpgradeOptionView,
  getShieldSpeedFactor,
  splitRelicMaxHpForMage,
} from './classes';
import {
  BannerEvent,
  BiomeConfig,
  BossAttackState,
  DungeonData,
  EnemyKind,
  FloatingLabelData,
  HudState,
  MinimapSnapshot,
  ProjectileKind,
  RunSummary,
  TerrainTheme,
  TileType,
} from './types';

interface EngineCallbacks {
  onHudChange: (hud: HudState) => void;
  onBanner: (banner: BannerEvent) => void;
  onFloatingLabel: (label: FloatingLabelData) => void;
  onMinimapUpdate: (snap: MinimapSnapshot) => void;
  onWebGLError: (message: string) => void;
}

type FloorBossKind =
  | 'boss_juggernaut'
  | 'boss_lich'
  | 'boss_colossus'
  | 'boss_crystal_wyrm'
  | 'boss_fungal_king'
  | 'boss_leviathan_heart'
  | 'boss_abyssal_brain'
  | 'boss_mothership_ai'
  | 'boss_xeno_commander';

type BossSkillKind = 'slam' | 'charge_slam' | 'nova_ring' | 'ranged_volley' | 'targeted_blast';

interface BossConfig {
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

const DUNGEON_BOSS_ROTATION: FloorBossKind[] = [
  'boss_juggernaut',
  'boss_lich',
  'boss_colossus',
];
const CAVERN_BOSS_ROTATION: FloorBossKind[] = ['boss_crystal_wyrm', 'boss_fungal_king'];
const FLESH_BOSS_ROTATION: FloorBossKind[] = ['boss_leviathan_heart', 'boss_abyssal_brain'];
const ALIEN_BOSS_ROTATION: FloorBossKind[] = ['boss_mothership_ai', 'boss_xeno_commander'];

const SPECIAL_ELITE_NAMES: string[] = [
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

function getBossForDepth(depth: number, theme: TerrainTheme): FloorBossKind {
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

const BOSS_CONFIGS: Record<FloorBossKind, BossConfig> = {
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

function isFloorBoss(kind: EnemyKind): kind is FloorBossKind {
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

function isArcherLikeRanged(kind: EnemyKind): boolean {
  return (
    kind === 'archer' ||
    kind === 'cavern_spitter' ||
    kind === 'flesh_spiner' ||
    kind === 'alien_gunner'
  );
}

function isMageLikeRanged(kind: EnemyKind): boolean {
  return (
    kind === 'mage' ||
    kind === 'cavern_shaman' ||
    kind === 'flesh_eye' ||
    kind === 'alien_psion'
  );
}

function isRangedEnemy(kind: EnemyKind): boolean {
  return isArcherLikeRanged(kind) || isMageLikeRanged(kind);
}

function isGuardianEnemy(kind: EnemyKind): boolean {
  return (
    kind === 'guardian' ||
    kind === 'cavern_warden' ||
    kind === 'flesh_brute' ||
    kind === 'alien_mech'
  );
}

function isSwarmEnemy(kind: EnemyKind): boolean {
  return (
    kind === 'dungeon_rat' ||
    kind === 'cavern_mite' ||
    kind === 'flesh_leech' ||
    kind === 'alien_nanobot'
  );
}

function getRangedProjectileKind(kind: EnemyKind): ProjectileKind {
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

interface EnemyEntity {
  id: number;
  kind: EnemyKind;
  rig: EnemyRig;
  x: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  speed: number;
  attackCooldown: number;
  windupTimer: number;
  stunTimer: number;
  hitFlash: number;
  hopPhase: number;
  facing: number;
  dead: boolean;
  isBoss: boolean;
  isRanged: boolean;
  isElite: boolean;
  isSpecialElite?: boolean;
  customName?: string;
  damageMult: number;
  bossName?: string;
  bossTitle?: string;
  bossState?: BossAttackState;
  bossStateTimer?: number;
  bossStateDuration?: number;
  telegraph?: BossTelegraphRig;
  telegraphX?: number;
  telegraphZ?: number;
  telegraphRadius?: number;
  bossDamage?: number;
  bossHitApplied?: boolean;
  bossSkill?: BossSkillKind;
  bossSkillIndex?: number;
  bossChargeStartX?: number;
  bossChargeStartZ?: number;
  // Frost Mage debuffs
  /** Seconds of slow remaining. */
  slowTimer?: number;
  /** Fraction of move/attack speed removed while slowed (0.4 normal, 0.2 elite, 0.1 boss). */
  slowPct?: number;
  /** Seconds of Frost Nova freeze remaining (acts like a stun). */
  frozenTimer?: number;
}

interface HeroProjectileEntity {
  mesh: THREE.Group;
  x: number;
  z: number;
  vx: number;
  vz: number;
  traveled: number;
  /** 0, 1 = normal spike, 2 = empowered spike */
  shotIdx: number;
}

interface HeroHitParams {
  baseDmg: number;
  /** Warrior 3rd-hit cleave / Frost Mage empowered 3rd spike (Stormforged Hammer trigger). */
  isEmpowered: boolean;
  atkMult: number;
  critChance: number;
  critMult: number;
  knockMult: number;
  knockBase: number;
  originX: number;
  originZ: number;
  fallbackX: number;
  fallbackZ: number;
  usePhantomCrit: boolean;
  effMaxHp: number;
  state: { consumedPhantom: boolean; triggeredStorm: boolean };
  hitColor?: number;
  isMageHit?: boolean;
}

interface ProjectileEntity {
  kind: ProjectileKind;
  mesh: THREE.Group;
  x: number;
  z: number;
  vx: number;
  vz: number;
  damage: number;
  sourceLabel: string;
  life: number;
  maxLife: number;
}

interface LootEntity {
  id: number;
  type: 'gold' | 'potion' | 'relic';
  value: number;
  mesh: THREE.Group;
  relic?: RelicItem;
  relicRig?: RelicLootRig;
  x: number;
  z: number;
  vx?: number;
  vz?: number;
  vy: number;
  y: number;
  age: number;
  pickupDelay?: number;
  collected: boolean;
}

interface BreakableEntity {
  id: number;
  kind: 'crate' | 'urn';
  mesh: THREE.Group;
  x: number;
  z: number;
  broken: boolean;
}

interface Particle {
  mesh: THREE.Mesh;
  active: boolean;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
  baseScale: number;
  shrink: boolean;
}

interface SlashArc {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  isCleave: boolean;
  isShockwave?: boolean;
  targetScale?: number;
}

interface AnimatedLightProp {
  color: number;
  baseIntensity: number;
  distance: number;
  decay: number;
  phase: number;
  x: number;
  y: number;
  z: number;
  flame?: THREE.Object3D;
  crystal?: THREE.Object3D;
  decal?: THREE.Mesh;
  pool?: THREE.Mesh;
  halo?: THREE.Sprite;
  kind:
    | 'torch'
    | 'brazier'
    | 'rune'
    | 'key'
    | 'gate'
    | 'stairs'
    | 'altar'
    | 'shop'
    | 'portal'
    | 'angel'
    | 'lamp';
  used?: boolean;
}

interface SavedDungeonSnapshot {
  depth: number;
  dungeon: DungeonData;
  hasKey: boolean;
  doorUnlocked: boolean;
  chronosUsedThisFloor: boolean;
  floorKills: number;
  returnX: number;
  returnZ: number;
  usedRuneKeys: Set<string>;
  brokenBreakableKeys: Set<string>;
}

interface WallOcclusionTile {
  gx: number;
  gz: number;
  wx: number;
  wz: number;
  bucketIdx: number;
  wallInstIdx: number;
  capInstIdx: number;
  rotY: number;
  occluded: boolean;
}

interface SpikeInstance {
  rig: SpikeTrapRig;
  x: number;
  z: number;
  phaseOffset: number;
  extended: boolean;
}

// Module-scoped scratch vectors for zero GC churn in render loop
const _projVec = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camGoal = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

export class EmbervaultEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private audio = new DungeonAudio();
  private isSoftwareGl = false;

  // Groups
  private levelGroup = new THREE.Group();
  private dynamicGroup = new THREE.Group();
  private debrisGroup = new THREE.Group();

  // Persistent lights & hero
  private heroRig!: HeroRig;
  private heroSetAura!: ReturnType<typeof createHeroSetAura>;
  private heroLight!: THREE.PointLight;
  private heroFloorGlow!: THREE.Mesh;
  private propLightPool: THREE.PointLight[] = [];
  private hemiLight!: THREE.HemisphereLight;
  private rimLight!: THREE.DirectionalLight;
  private textures: DungeonTextureSet | null = null;
  private sharedShadowMap!: THREE.CanvasTexture;

  // Level data & entities
  private dungeon!: DungeonData;
  private enemies: EnemyEntity[] = [];
  private projectiles: ProjectileEntity[] = [];
  private loots: LootEntity[] = [];
  private breakables: BreakableEntity[] = [];
  private lightProps: AnimatedLightProp[] = [];
  private spikes: SpikeInstance[] = [];
  private keyPedestal: { root: THREE.Group; keyMesh: THREE.Group; halo: THREE.Sprite } | null =
    null;
  private altarRig: {
    root: THREE.Group;
    crystal: THREE.Group;
    ring: THREE.Mesh;
    halo: THREE.Sprite;
  } | null = null;
  private shopRig: {
    root: THREE.Group;
    crystal: THREE.Group;
    ring: THREE.Mesh;
    halo: THREE.Sprite;
  } | null = null;
  private gateRig: GateRig | null = null;
  private gateOpenProgress = 0;

  // Sanctuary Town & Angel Blessing State
  private inTown = false;
  private savedDungeon: SavedDungeonSnapshot | null = null;
  private townPortalPos: { x: number; z: number } | null = null;
  private angelPos: { x: number; z: number } | null = null;
  private angelRig: AngelRig | null = null;
  private townPortalRig: TownPortalRig | null = null;
  private angelBuff: AngelBuff | null = null;
  private portalSafePos: { x: number; z: number } | null = null;
  private extraTextures: THREE.Texture[] = [];

  // Dynamic 50% translucency for foreground walls occluding the hero
  private readonly wallHeight = 2.65;
  private wallOpaqueMeshes: THREE.InstancedMesh[] = [];
  private wallFadeMeshes: THREE.InstancedMesh[] = [];
  private capOpaqueMesh: THREE.InstancedMesh | null = null;
  private capFadeMesh: THREE.InstancedMesh | null = null;
  private wallTiles: WallOcclusionTile[] = [];
  private wallOcclusionActive = false;

  // Pools
  private particles: Particle[] = [];
  private slashArcs: SlashArc[] = [];
  private particleGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);

  // Game & Hero State (HP scaled 10x: 60 start, 300 cap)
  private depth = 1;
  private hp = 60;
  private maxHp = 60;
  private readonly maxHpCap = 300;
  private hpUpgrades = 0;
  private atkUpgrades = 0;
  private armorUpgrades = 0;
  private readonly maxArmorUpgrades = 5;
  private critUpgrades = 0;
  private readonly maxCritUpgrades = 10;
  private autoNextUpgrade: UpgradeKind = 'hp';

  // Hero Class (warrior / frost_mage)
  private heroClass: HeroClassId = 'warrior';
  // Frost Mage shield & upgrades
  private shield = 0;
  private baseMaxShield = 0;
  private hpShieldUpgrades = 0;
  private shieldSpeedUpgrades = 0;
  /** Seconds since the hero last took damage (drives shield regen delay). */
  private timeSinceDamaged = 999;
  /** Frost Mage ice spike cycle index: 0, 1, 2 (2 = empowered). Never resets on idle. */
  private mageShotIndex = 0;
  private queuedRestartClass: HeroClassId | null = null;
  private heroProjectiles: HeroProjectileEntity[] = [];
  /** Last non-zero movement direction (used by Blink). */
  private lastMoveX = 0;
  private lastMoveZ = 1;
  /** True when the last hit was fully absorbed by the shield (blue hit flash instead of red). */
  private heroHitShieldOnly = false;
  private autoUpgradeCooldown = 0;
  private potions = 3;
  private hasKey = false;
  private doorUnlocked = false;
  private gold = 0;
  private totalGoldEarned = 0;
  private kills = 0;
  private normalKills = 0;
  private eliteKills = 0;
  private bossKills = 0;
  private potionsUsed = 0;
  private totalDamageDealt = 0;
  private critCount = 0;
  private runElapsedSec = 0;
  private slainBy = '地城陷阱';
  private isDead = false;

  // Relic Equipment & Bag System
  private equippedRelics: RelicItem[] = [];
  private relicBag: RelicItem[] = [];
  private readonly relicBagCap = 30;
  private discoveredRelicIds = new Set<string>();
  private relicStats: RelicSummaryStats = computeRelicSummary([]);
  private phantomCritTimer = 0;
  private alchemistShieldTimer = 0;
  private dragonAuraTimer = 0;
  private chronosUsedThisFloor = false;
  private bloodLeechAccum = 0;
  private floorKills = 0;
  private catPawHitCounter = 0;

  private heroX = 0;
  private heroZ = 0;
  private heroVx = 0;
  private heroVz = 0;
  private heroFacing = 0;
  private walkCycle = 0;
  private footstepTimer = 0;
  private attackCooldown = 0;
  private attackAnim = 0;
  private pommelCooldown = 0;
  /** Right-click class skill max cooldown (Pommel Strike 8s / Frost Nova 10s). */
  private pommelMaxCooldown = 8.0;
  private pommelAnim = 0;
  private comboStep = 0;
  private comboResetTimer = 0;
  private dashTimer = 0;
  private dashCooldown = 0;
  private dashDirX = 0;
  private dashDirZ = 1;
  private heroInvuln = 0;
  private heroHitFlash = 0;
  private emberSpawnTimer = 0;

  // Camera & Juice
  private camZoom = 1.0;
  private shakeTime = 0;
  private shakeMag = 0;
  private hitStopTimer = 0;
  private fadeOpacity = 1.0;
  private transitionState: 'none' | 'fadeOut' | 'fadeIn' = 'fadeIn';
  private pendingTransitionAction: (() => void) | null = null;

  // Control & AI
  private controlMode: 'auto' | 'manual' = 'auto';
  private keysPressed = new Set<string>();
  private aiPath: Array<{ gx: number; gz: number }> = [];
  private aiRepathTimer = 0;
  private aiCombatPath: Array<{ gx: number; gz: number }> = [];
  private aiCombatRepathTimer = 0;
  private aiLastCheckX = 0;
  private aiLastCheckZ = 0;
  private aiStuckTimer = 0;
  private aiStuckCount = 0;
  private aiForcePathTimer = 0;
  private aiStrafeSign = 1;
  private aiStatus = 'Exploring Catacombs';
  private aiLastCombatDamageTime = -10;
  private aiProgressAnchorX = 0;
  private aiProgressAnchorZ = 0;
  private aiNoProgressTimer = 0;
  private aiUnstuckTimer = 0;
  private aiUnstuckPath: Array<{ gx: number; gz: number }> = [];
  private aiCurrentTargetId: number | null = null;
  private aiUnstuckAttempts = 0;
  private aiSkipEnemyUntil = new Map<number, number>();

  // Loop & Bookkeeping
  private frameId = 0;
  private disposed = false;
  private lastTime = 0;
  private elapsed = 0;
  private nextId = 1;
  private hudSyncTimer = 0;
  private minimapTimer = 0;

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.initRenderer();
    this.initScene();
    this.initParticlePool();
    this.buildLevel(1);
    this.bindEvents();
    this.lastTime = performance.now();
    this.emitHud();
    this.tick();
  }

  private detectSoftwareGl(): boolean {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  }

  private initRenderer(): void {
    this.isSoftwareGl = this.detectSoftwareGl();

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      this.callbacks.onWebGLError('WebGL is unavailable in this browser context.');
      return;
    }

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);
  }

  private initScene(): void {
    if (!this.renderer) return;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060b);
    this.scene.fog = new THREE.Fog(0x05060b, 32, 54);

    // Mandatory Studio Environment Reflection for metallic glints (very subtle so unlit stone stays truly dark)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.07;
    pmrem.dispose();

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // Tight FOV isometric miniature perspective (tilt-shift tabletop diorama feel)
    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.5, 110);

    // Very low ambient fill so areas away from torches & rune circles fall into deep shadow
    this.hemiLight = new THREE.HemisphereLight(0x3a4f78, 0x120b07, 0.12);
    this.scene.add(this.hemiLight);

    this.rimLight = new THREE.DirectionalLight(0x6c8cc4, 0.09);
    this.rimLight.position.set(-12, 22, -10);
    if (!this.isSoftwareGl) {
      this.rimLight.castShadow = true;
      this.rimLight.shadow.mapSize.set(1024, 1024);
      const d = 16;
      this.rimLight.shadow.camera.left = -d;
      this.rimLight.shadow.camera.right = d;
      this.rimLight.shadow.camera.top = d;
      this.rimLight.shadow.camera.bottom = -d;
      this.rimLight.shadow.camera.near = 2;
      this.rimLight.shadow.camera.far = 48;
      this.rimLight.shadow.bias = -0.0006;
      this.rimLight.shadow.normalBias = 0.03;
    }
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    // Persistent soft radial contact shadow texture for hero & enemies
    const sc = document.createElement('canvas');
    sc.width = 64;
    sc.height = 64;
    const sctx = sc.getContext('2d')!;
    const sgrad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    sgrad.addColorStop(0, 'rgba(0,0,0,0.65)');
    sgrad.addColorStop(0.62, 'rgba(0,0,0,0.28)');
    sgrad.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = sgrad;
    sctx.fillRect(0, 0, 64, 64);
    this.sharedShadowMap = new THREE.CanvasTexture(sc);

    // Hero & bright flickering handheld Lantern light
    this.heroRig = createHeroModel(this.sharedShadowMap);
    this.heroSetAura = createHeroSetAura();
    this.heroRig.root.add(this.heroSetAura.group);
    this.scene.add(this.heroRig.root);

    this.heroLight = new THREE.PointLight(0xffaa44, 56, 11.2, 2.05);
    this.heroLight.position.set(0, 1.85, 0);
    if (!this.isSoftwareGl) {
      this.heroLight.castShadow = true;
      this.heroLight.shadow.mapSize.set(1024, 1024);
      this.heroLight.shadow.camera.near = 0.3;
      this.heroLight.shadow.camera.far = 12;
      this.heroLight.shadow.bias = -0.0025;
      this.heroLight.shadow.normalBias = 0.04;
    }
    this.scene.add(this.heroLight);

    // Subtle additive warm floor glow tightly hugging the hero's lantern without washing out brick detail
    const hgc = document.createElement('canvas');
    hgc.width = 64;
    hgc.height = 64;
    const hgctx = hgc.getContext('2d')!;
    const hgg = hgctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    hgg.addColorStop(0, 'rgba(255,186,92,0.44)');
    hgg.addColorStop(0.42, 'rgba(255,142,48,0.14)');
    hgg.addColorStop(1, 'rgba(255,120,30,0)');
    hgctx.fillStyle = hgg;
    hgctx.fillRect(0, 0, 64, 64);
    const heroGlowTex = new THREE.CanvasTexture(hgc);
    heroGlowTex.colorSpace = THREE.SRGBColorSpace;
    this.heroFloorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({
        map: heroGlowTex,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    this.heroFloorGlow.rotation.x = -Math.PI / 2;
    this.heroFloorGlow.position.y = 0.022;
    this.scene.add(this.heroFloorGlow);

    // Fast fixed pool of 8 dynamic PointLights for nearest scene torches, braziers & magic rune circles
    for (let i = 0; i < 8; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 10, 2.05);
      pl.position.set(0, -10, 0);
      this.scene.add(pl);
      this.propLightPool.push(pl);
    }

    this.scene.add(this.levelGroup);
    this.scene.add(this.dynamicGroup);
    this.scene.add(this.debrisGroup);
  }

  private initParticlePool(): void {
    const poolSize = 140;
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffb84d,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        active: false,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        gravity: 0,
        baseScale: 1,
        shrink: true,
      });
    }
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    scale: number,
    maxLife: number,
    gravity = 0
  ): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.mesh.visible = true;
        p.mesh.position.set(x, y, z);
        p.mesh.scale.setScalar(scale);
        const mat = p.mesh.material as THREE.MeshBasicMaterial;
        mat.color.setHex(colorHex);
        mat.opacity = 1;
        p.vx = vx;
        p.vy = vy;
        p.vz = vz;
        p.life = 0;
        p.maxLife = maxLife;
        p.gravity = gravity;
        p.baseScale = scale;
        p.shrink = true;
        return;
      }
    }
  }

  private clearLevel(): void {
    const disposeGroup = (group: THREE.Group) => {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        } else if (obj instanceof THREE.Sprite) {
          obj.material.map?.dispose();
          obj.material.dispose();
        }
      });
      while (group.children.length > 0) {
        group.remove(group.children[0]);
      }
    };

    disposeGroup(this.levelGroup);
    disposeGroup(this.dynamicGroup);
    disposeGroup(this.debrisGroup);

    if (this.textures) {
      this.textures.dispose();
      this.textures = null;
    }
    if (this.extraTextures.length > 0) {
      this.extraTextures.forEach((t) => t.dispose());
      this.extraTextures = [];
    }

    this.enemies = [];
    this.projectiles = [];
    this.heroProjectiles = [];
    this.loots = [];
    this.breakables = [];
    this.lightProps = [];
    this.spikes = [];
    this.keyPedestal = null;
    this.altarRig = null;
    this.shopRig = null;
    this.gateRig = null;
    this.gateOpenProgress = 0;
    this.angelRig = null;
    this.townPortalRig = null;
    this.townPortalPos = null;
    this.angelPos = null;
    this.wallOpaqueMeshes = [];
    this.wallFadeMeshes = [];
    this.capOpaqueMesh = null;
    this.capFadeMesh = null;
    this.wallTiles = [];
    this.wallOcclusionActive = false;
    this.aiPath = [];
    this.aiCombatPath = [];
    this.aiStuckTimer = 0;
    this.aiStuckCount = 0;
    this.aiNoProgressTimer = 0;
    this.aiUnstuckTimer = 0;
    this.aiUnstuckPath = [];
    this.aiCurrentTargetId = null;
    this.aiUnstuckAttempts = 0;
    this.aiSkipEnemyUntil.clear();
    this.aiLastCombatDamageTime = -10;
    this.autoUpgradeCooldown = 0;
  }

  private buildLevel(
    depth: number,
    options?: { savedSnapshot?: SavedDungeonSnapshot; tickBuffFloor?: boolean }
  ): void {
    this.clearLevel();
    this.inTown = false;
    this.depth = depth;

    let buffExpired = false;
    if (options?.tickBuffFloor && this.angelBuff) {
      this.angelBuff.floorsLeft -= 1;
      if (this.angelBuff.floorsLeft <= 0) {
        this.angelBuff = null;
        this.recomputeRelicStats(true);
        buffExpired = true;
      }
    }

    const snap = options?.savedSnapshot;
    if (snap) {
      this.hasKey = snap.hasKey;
      this.doorUnlocked = snap.doorUnlocked;
      this.chronosUsedThisFloor = snap.chronosUsedThisFloor;
      this.floorKills = snap.floorKills;
      this.dungeon = snap.dungeon;
    } else {
      this.hasKey = false;
      this.doorUnlocked = false;
      this.chronosUsedThisFloor = false;
      this.floorKills = 0;
      this.dungeon = generateDungeon(depth);
    }
    const biome = this.dungeon.biome;
    const isAlienDeck = biome.terrainTheme === 'alien';

    // Update scene atmosphere to match biome (bright blue-silver sci-fi lighting for Alien Starship Deck!)
    this.scene.background = new THREE.Color(biome.fogColor);
    this.scene.fog = new THREE.Fog(biome.fogColor, isAlienDeck ? 38 : 32, isAlienDeck ? 62 : 54);
    this.hemiLight.color.setHex(biome.hemiSky);
    this.hemiLight.groundColor.setHex(biome.hemiGround);
    this.hemiLight.intensity = isAlienDeck ? 0.96 : 0.12;
    this.rimLight.color.setHex(isAlienDeck ? 0xd8f3ff : 0x6c8cc4);
    this.rimLight.intensity = isAlienDeck ? 0.62 : 0.09;
    this.scene.environmentIntensity = isAlienDeck ? 0.45 : 0.07;
    this.heroLight.color.setHex(biome.torchColor);

    this.textures = createDungeonTextures(
      biome,
      this.renderer.capabilities.getMaxAnisotropy(),
      depth * 997 + 13
    );

    const { width, height, tiles } = this.dungeon;

    // Count tiles for InstancedMesh batching
    const floorCoords: Array<[number, number]> = [];
    const wallCoords: Array<[number, number]> = [];
    const pillarCoords: Array<[number, number]> = [];

    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const t = tiles[gz][gx];
        if (t === 1 || t === 3 || t === 5 || t === 6) {
          floorCoords.push([gx, gz]);
        }
        if (t === 2) {
          wallCoords.push([gx, gz]);
        }
        if (t === 5) {
          pillarCoords.push([gx, gz]);
        }
      }
    }

    // 1. Instanced Terrain Floors (Dungeon Flagstone / Cavern Rock / Organic Tissue)
    const theme = biome.terrainTheme;
    const upAxis = new THREE.Vector3(0, 1, 0);
    const floorGeo = new THREE.BoxGeometry(TILE_SIZE, 0.3, TILE_SIZE);
    const floorVariants = this.textures.floorVariants;

    if (floorVariants && floorVariants.length > 1) {
      // Cavern: 6 deterministic buckets -> 2 clean rock (variant 0) + 4 multicolor crystal variants (1..4)
      // Average ~1.33 crystals/tile (~1/5 of original 6) with Y-axis rotation for zero grid repetition
      const buckets: Array<Array<[number, number]>> = floorVariants.map(() => []);
      for (const coord of floorCoords) {
        const [gx, gz] = coord;
        const hash = Math.abs((gx * 73856093) ^ (gz * 19349663)) % 6;
        const variantIdx = hash < 2 ? 0 : hash - 1; // 0..4
        buckets[variantIdx].push(coord);
      }
      const floorBumpMap = this.textures.floorBump;
      buckets.forEach((coords, vIdx) => {
        if (coords.length === 0) return;
        const mat = new THREE.MeshStandardMaterial({
          map: floorVariants[vIdx],
          bumpMap: floorBumpMap,
          bumpScale: 0.06,
          roughness: 0.94,
          metalness: 0.06,
        });
        const mesh = new THREE.InstancedMesh(floorGeo, mat, coords.length);
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        coords.forEach(([gx, gz], i) => {
          _pos.set(gx * TILE_SIZE, -0.15, gz * TILE_SIZE);
          const rotSteps = Math.abs(gx * 3 + gz * 5) & 3;
          _quat.setFromAxisAngle(upAxis, rotSteps * (Math.PI / 2));
          _scale.set(1, 1, 1);
          _mat4.compose(_pos, _quat, _scale);
          mesh.setMatrixAt(i, _mat4);
          const tint = 0.92 + ((gx * 17 + gz * 31) % 13) * 0.012;
          _color.setRGB(tint, tint, tint);
          mesh.setColorAt(i, _color);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.levelGroup.add(mesh);
      });
    } else {
      const floorMat = new THREE.MeshStandardMaterial({
        map: this.textures.floorMap,
        bumpMap: this.textures.floorBump,
        bumpScale:
          theme === 'alien' ? 0.032 : theme === 'flesh' ? 0.055 : theme === 'cavern' ? 0.06 : 0.04,
        roughness:
          theme === 'alien' ? 0.24 : theme === 'flesh' ? 0.44 : theme === 'cavern' ? 0.94 : 0.86,
        metalness: theme === 'alien' ? 0.58 : theme === 'flesh' ? 0.1 : 0.06,
      });
      const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, floorCoords.length);
      floorMesh.receiveShadow = true;
      floorMesh.frustumCulled = false;

      floorCoords.forEach(([gx, gz], i) => {
        _pos.set(gx * TILE_SIZE, -0.15, gz * TILE_SIZE);
        _quat.identity();
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        floorMesh.setMatrixAt(i, _mat4);
        const tint =
          theme === 'alien'
            ? 0.97 + ((gx * 17 + gz * 31) % 7) * 0.008
            : 0.92 + ((gx * 17 + gz * 31) % 13) * 0.012;
        _color.setRGB(tint, tint, tint);
        floorMesh.setColorAt(i, _color);
      });
      floorMesh.instanceMatrix.needsUpdate = true;
      if (floorMesh.instanceColor) floorMesh.instanceColor.needsUpdate = true;
      this.levelGroup.add(floorMesh);
    }

    // 2. Instanced Thick Walls (+ 50% translucent foreground occlusion layer)
    const wallHeight = this.wallHeight;
    const wallGeo = new THREE.BoxGeometry(TILE_SIZE, wallHeight, TILE_SIZE);
    const wallVariants = this.textures.wallVariants;
    const maxFadeWalls = 48;

    // Cap top on walls for clean miniature cutaway silhouette
    const capGeo = new THREE.BoxGeometry(TILE_SIZE + 0.02, 0.14, TILE_SIZE + 0.02);
    const capMat = new THREE.MeshStandardMaterial({
      color:
        theme === 'alien'
          ? 0x223b59
          : theme === 'flesh'
          ? 0x260c21
          : theme === 'cavern'
          ? 0x161412
          : 0x13151d,
      roughness: theme === 'alien' ? 0.34 : theme === 'flesh' ? 0.62 : 0.95,
      metalness: theme === 'alien' ? 0.72 : 0.05,
    });
    const capMesh = new THREE.InstancedMesh(capGeo, capMat, wallCoords.length);
    capMesh.frustumCulled = false;

    const capFadeMat = capMat.clone();
    capFadeMat.transparent = true;
    capFadeMat.opacity = 0.5;
    capFadeMat.depthWrite = true;
    const capFadeMesh = new THREE.InstancedMesh(capGeo, capFadeMat, maxFadeWalls);
    capFadeMesh.count = 0;
    capFadeMesh.frustumCulled = false;
    capFadeMesh.renderOrder = 5;

    this.capOpaqueMesh = capMesh;
    this.capFadeMesh = capFadeMesh;
    this.wallOpaqueMeshes = [];
    this.wallFadeMeshes = [];
    this.wallTiles = [];

    if (wallVariants && wallVariants.length > 1) {
      const wallBuckets: Array<Array<{ gx: number; gz: number; capIdx: number }>> =
        wallVariants.map(() => []);
      wallCoords.forEach((coord, i) => {
        const [gx, gz] = coord;
        const vIdx = Math.abs((gx * 37 + gz * 91) ^ (gx * gz)) % wallVariants.length;
        wallBuckets[vIdx].push({ gx, gz, capIdx: i });

        _pos.set(gx * TILE_SIZE, wallHeight + 0.07, gz * TILE_SIZE);
        _quat.identity();
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        capMesh.setMatrixAt(i, _mat4);
      });
      const wallBumpMap = this.textures.wallBump;
      wallBuckets.forEach((entries, vIdx) => {
        if (entries.length === 0) return;
        const bucketIdx = this.wallOpaqueMeshes.length;
        const mat = new THREE.MeshStandardMaterial({
          map: wallVariants[vIdx],
          bumpMap: wallBumpMap,
          bumpScale: 0.065,
          roughness: 0.96,
          metalness: 0.04,
        });
        const mesh = new THREE.InstancedMesh(wallGeo, mat, entries.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        const fadeMat = mat.clone();
        fadeMat.transparent = true;
        fadeMat.opacity = 0.5;
        fadeMat.depthWrite = true;
        const fadeMesh = new THREE.InstancedMesh(wallGeo, fadeMat, maxFadeWalls);
        fadeMesh.count = 0;
        fadeMesh.receiveShadow = true;
        fadeMesh.frustumCulled = false;
        fadeMesh.renderOrder = 6;

        entries.forEach(({ gx, gz, capIdx }, i) => {
          const wx = gx * TILE_SIZE;
          const wz = gz * TILE_SIZE;
          const rotSteps = Math.abs(gx * 7 + gz * 11) & 3;
          const rotY = rotSteps * (Math.PI / 2);
          _pos.set(wx, wallHeight / 2, wz);
          _quat.setFromAxisAngle(upAxis, rotY);
          _scale.set(1, 1, 1);
          _mat4.compose(_pos, _quat, _scale);
          mesh.setMatrixAt(i, _mat4);

          this.wallTiles.push({
            gx,
            gz,
            wx,
            wz,
            bucketIdx,
            wallInstIdx: i,
            capInstIdx: capIdx,
            rotY,
            occluded: false,
          });
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.wallOpaqueMeshes.push(mesh);
        this.wallFadeMeshes.push(fadeMesh);
        this.levelGroup.add(mesh, fadeMesh);
      });
      capMesh.instanceMatrix.needsUpdate = true;
      this.levelGroup.add(capMesh, capFadeMesh);
    } else {
      const wallMat = new THREE.MeshStandardMaterial({
        map: this.textures.wallMap,
        bumpMap: this.textures.wallBump,
        bumpScale:
          theme === 'alien' ? 0.035 : theme === 'flesh' ? 0.06 : theme === 'cavern' ? 0.065 : 0.05,
        roughness:
          theme === 'alien' ? 0.26 : theme === 'flesh' ? 0.48 : theme === 'cavern' ? 0.96 : 0.9,
        metalness: theme === 'alien' ? 0.62 : theme === 'flesh' ? 0.08 : 0.04,
      });
      const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCoords.length);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      wallMesh.frustumCulled = false;

      const wallFadeMat = wallMat.clone();
      wallFadeMat.transparent = true;
      wallFadeMat.opacity = 0.5;
      wallFadeMat.depthWrite = true;
      const wallFadeMesh = new THREE.InstancedMesh(wallGeo, wallFadeMat, maxFadeWalls);
      wallFadeMesh.count = 0;
      wallFadeMesh.receiveShadow = true;
      wallFadeMesh.frustumCulled = false;
      wallFadeMesh.renderOrder = 6;

      wallCoords.forEach(([gx, gz], i) => {
        const wx = gx * TILE_SIZE;
        const wz = gz * TILE_SIZE;
        _pos.set(wx, wallHeight / 2, wz);
        _quat.identity();
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        wallMesh.setMatrixAt(i, _mat4);

        _pos.set(wx, wallHeight + 0.07, wz);
        _mat4.compose(_pos, _quat, _scale);
        capMesh.setMatrixAt(i, _mat4);

        this.wallTiles.push({
          gx,
          gz,
          wx,
          wz,
          bucketIdx: 0,
          wallInstIdx: i,
          capInstIdx: i,
          rotY: 0,
          occluded: false,
        });
      });
      wallMesh.instanceMatrix.needsUpdate = true;
      capMesh.instanceMatrix.needsUpdate = true;
      this.wallOpaqueMeshes.push(wallMesh);
      this.wallFadeMeshes.push(wallFadeMesh);
      this.levelGroup.add(wallMesh, wallFadeMesh, capMesh, capFadeMesh);
    }

    // 3. Instanced Pillars (Stone Columns / Cavern Stalagmites / Organic Bone-Sinew Ribs / Sci-Fi Reactor Columns)
    if (pillarCoords.length > 0) {
      const shaftGeo =
        theme === 'cavern'
          ? new THREE.CylinderGeometry(0.32, 0.56, 2.5, 6)
          : theme === 'flesh'
          ? new THREE.CylinderGeometry(0.42, 0.5, 2.5, 10)
          : theme === 'alien'
          ? new THREE.CylinderGeometry(0.44, 0.44, 2.5, 10)
          : new THREE.CylinderGeometry(0.46, 0.52, 2.5, 8);
      const pillarMat = new THREE.MeshStandardMaterial({
        map: this.textures.pillarMap,
        roughness:
          theme === 'alien' ? 0.22 : theme === 'flesh' ? 0.46 : theme === 'cavern' ? 0.92 : 0.82,
        metalness: theme === 'alien' ? 0.72 : theme === 'flesh' ? 0.08 : 0.12,
      });
      const shaftInst = new THREE.InstancedMesh(shaftGeo, pillarMat, pillarCoords.length);
      shaftInst.castShadow = true;
      shaftInst.receiveShadow = true;
      shaftInst.frustumCulled = false;

      const plinthGeo = new THREE.BoxGeometry(1.18, 0.28, 1.18);
      const plinthMat = new THREE.MeshStandardMaterial({
        color:
          theme === 'alien'
            ? 0x2b496b
            : theme === 'flesh'
            ? 0x451a3d
            : theme === 'cavern'
            ? 0x35312c
            : 0x2c303a,
        roughness: theme === 'alien' ? 0.28 : theme === 'flesh' ? 0.52 : 0.85,
        metalness: theme === 'alien' ? 0.78 : theme === 'flesh' ? 0.08 : 0.15,
      });
      const plinthInst = new THREE.InstancedMesh(plinthGeo, plinthMat, pillarCoords.length * 2);
      plinthInst.castShadow = true;
      plinthInst.receiveShadow = true;
      plinthInst.frustumCulled = false;

      pillarCoords.forEach(([gx, gz], i) => {
        const wx = gx * TILE_SIZE;
        const wz = gz * TILE_SIZE;
        _pos.set(wx, 1.25, wz);
        _quat.identity();
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        shaftInst.setMatrixAt(i, _mat4);

        _pos.set(wx, 0.14, wz);
        _mat4.compose(_pos, _quat, _scale);
        plinthInst.setMatrixAt(i * 2, _mat4);

        _pos.set(wx, 2.52, wz);
        _mat4.compose(_pos, _quat, _scale);
        plinthInst.setMatrixAt(i * 2 + 1, _mat4);
      });
      shaftInst.instanceMatrix.needsUpdate = true;
      plinthInst.instanceMatrix.needsUpdate = true;
      this.levelGroup.add(shaftInst, plinthInst);
    }

    // 4. Props (Torches, Braziers, Rune Wells, Crates, Urns, Banners, Spike Traps)
    const bannerGeo = new THREE.PlaneGeometry(0.95, 1.4);
    const bannerMat = new THREE.MeshStandardMaterial({
      map: this.textures.bannerMap,
      transparent: true,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
      roughness: theme === 'alien' ? 0.25 : 0.9,
      emissive: theme === 'alien' ? new THREE.Color(0x1f9ce8) : new THREE.Color(0x000000),
      emissiveIntensity: theme === 'alien' ? 0.58 : 0,
    });
    const propLightColor = theme === 'dungeon' ? 0xff9838 : biome.torchColor;

    for (const prop of this.dungeon.props) {
      const { x, z } = gridToWorld(prop.gx, prop.gz);

      if (prop.type === 'brazier') {
        const b = createBrazier(this.textures.glowMap, propLightColor, theme);
        b.root.position.set(x, 0, z);
        this.levelGroup.add(b.root);
        this.lightProps.push({
          color: propLightColor,
          baseIntensity: theme === 'alien' ? 52 : 46,
          distance: theme === 'alien' ? 10.5 : 8.8,
          decay: 2.1,
          phase: Math.random() * 10,
          x,
          y: 1.62,
          z,
          flame: b.flame,
          kind: 'brazier',
        });
      } else if (prop.type === 'torch') {
        const t = createWallTorch(this.textures.glowMap, propLightColor, theme);
        const rot = prop.facing ?? 0;
        t.root.rotation.y = rot;
        // Offset flush against north (-Z) or west (-X) wall face
        const ox = rot === Math.PI / 2 ? -TILE_SIZE * 0.48 : 0;
        const oz = rot === 0 ? -TILE_SIZE * 0.48 : 0;
        t.root.position.set(x + ox, 0, z + oz);
        this.levelGroup.add(t.root);
        this.lightProps.push({
          color: propLightColor,
          baseIntensity: 36,
          distance: 7.4,
          decay: 2.1,
          phase: Math.random() * 10,
          x: x + ox + (rot === Math.PI / 2 ? 0.55 : 0),
          y: 1.75,
          z: z + oz + (rot === 0 ? 0.55 : 0),
          flame: t.flame,
          kind: 'torch',
        });
      } else if (prop.type === 'banner') {
        const mesh = new THREE.Mesh(bannerGeo, bannerMat);
        const rot = prop.facing ?? 0;
        mesh.rotation.y = rot;
        const ox = rot === Math.PI / 2 ? -TILE_SIZE * 0.46 : 0;
        const oz = rot === 0 ? -TILE_SIZE * 0.46 : 0;
        mesh.position.set(x + ox, 1.48, z + oz);
        this.levelGroup.add(mesh);
      } else if (prop.type === 'rune_well') {
        const rw = createRuneWell(biome, this.textures);
        rw.root.position.set(x, 0, z);
        const alreadyUsed = Boolean(snap?.usedRuneKeys.has(`${prop.gx},${prop.gz}`));
        if (alreadyUsed) {
          rw.crystal.visible = false;
          rw.halo.visible = false;
          (rw.decal.material as THREE.MeshBasicMaterial).opacity = 0.46;
          (rw.pool.material as THREE.MeshBasicMaterial).opacity = 0.12;
        }
        this.levelGroup.add(rw.root);
        this.lightProps.push({
          color: biome.runeColor,
          baseIntensity: 42,
          distance: 9.6,
          decay: 2.05,
          phase: Math.random() * 6,
          x,
          y: 1.58,
          z,
          crystal: rw.crystal,
          decal: rw.decal,
          pool: rw.pool,
          halo: rw.halo,
          kind: 'rune',
          used: alreadyUsed,
        });
      } else if (prop.type === 'crate' || prop.type === 'urn') {
        if (snap?.brokenBreakableKeys.has(`${prop.gx},${prop.gz}`)) {
          continue;
        }
        const mesh = createCrateProp(prop.type, this.textures);
        mesh.position.set(x, 0, z);
        mesh.rotation.y = (Math.random() - 0.5) * 0.35;
        this.dynamicGroup.add(mesh);
        this.breakables.push({
          id: this.nextId++,
          kind: prop.type,
          mesh,
          x,
          z,
          broken: false,
        });
      } else if (prop.type === 'spike') {
        const spikeRig = createSpikeTrap();
        spikeRig.root.position.set(x, 0, z);
        this.levelGroup.add(spikeRig.root);
        this.spikes.push({
          rig: spikeRig,
          x,
          z,
          phaseOffset: Math.random() * 4,
          extended: false,
        });
      }
    }

    // 5. Floating Golden Relic Key Pedestal
    {
      const { x, z } = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const ped = createKeyPedestal(this.sharedShadowMap, this.textures.glowMap);
      ped.root.position.set(x, 0, z);
      if (this.hasKey) {
        ped.keyMesh.visible = false;
        ped.halo.visible = false;
      }
      this.dynamicGroup.add(ped.root);
      this.keyPedestal = ped;
      this.lightProps.push({
        color: 0xffd252,
        baseIntensity: 40,
        distance: 8.2,
        decay: 2.05,
        phase: 0,
        x,
        y: 1.55,
        z,
        halo: ped.halo,
        kind: 'key',
      });
    }

    // 6. Locked Bronze-Oak Gate
    {
      const { gx, gz, horizontal } = this.dungeon.doorPos;
      const { x, z } = gridToWorld(gx, gz);
      this.gateRig = createLockedGate(horizontal, this.textures);
      this.gateRig.root.position.set(x, 0, z);
      if (this.doorUnlocked) {
        this.gateRig.lockGlow.visible = false;
        this.gateOpenProgress = 1;
        this.gateRig.leftPivot.rotation.y = -Math.PI * 0.62;
        this.gateRig.rightPivot.rotation.y = Math.PI * 0.62;
      }
      this.levelGroup.add(this.gateRig.root);
      this.lightProps.push({
        color: 0xffd052,
        baseIntensity: 28,
        distance: 7.2,
        decay: 2.05,
        phase: 1.5,
        x,
        y: 1.65,
        z,
        kind: 'gate',
      });
    }

    // 7. Descending Illuminated Stone Stairwell
    {
      const { x, z } = gridToWorld(this.dungeon.stairsPos.gx, this.dungeon.stairsPos.gz);
      const stairs = createStairwell(this.textures);
      stairs.root.position.set(x, 0, z);
      this.levelGroup.add(stairs.root);
      this.lightProps.push({
        color: 0xffd26e,
        baseIntensity: 44,
        distance: 8.8,
        decay: 2.05,
        phase: 2.3,
        x,
        y: 1.7,
        z,
        kind: 'stairs',
      });
    }

    // 7b. Altar of Ascension on pre-boss floors (Depth 4, 9, 14, 19...)
    if (this.dungeon.altarPos) {
      const { x, z } = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
      const altar = createUpgradeAltar(this.textures.glowMap);
      altar.root.position.set(x, 0, z);
      this.levelGroup.add(altar.root);
      this.altarRig = altar;
      this.lightProps.push({
        color: 0xffd25c,
        baseIntensity: 48,
        distance: 9.5,
        decay: 2.05,
        phase: 0.7,
        x,
        y: 1.75,
        z,
        crystal: altar.crystal,
        decal: altar.ring,
        halo: altar.halo,
        kind: 'altar',
      });
    }

    // 7c. Dedicated Elixir Potion Shop on every 3rd floor (Depth 3, 6, 9, 12, 15...)
    if (this.dungeon.shopPos) {
      const { x, z } = gridToWorld(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
      const shop = createPotionShop(this.textures.glowMap);
      shop.root.position.set(x, 0, z);
      this.levelGroup.add(shop.root);
      this.shopRig = shop;
      this.lightProps.push({
        color: 0xff5a7e,
        baseIntensity: 44,
        distance: 9.0,
        decay: 2.05,
        phase: 1.9,
        x,
        y: 1.7,
        z,
        crystal: shop.crystal,
        decal: shop.ring,
        halo: shop.halo,
        kind: 'shop',
      });
    }

    // 8. Spawn Hero at Room 0 (or at left-behind Town Portal when returning from Town)
    const spawnW = snap
      ? { x: snap.returnX, z: snap.returnZ }
      : gridToWorld(this.dungeon.spawn.gx, this.dungeon.spawn.gz);
    this.heroX = spawnW.x;
    this.heroZ = spawnW.z;
    this.aiProgressAnchorX = this.heroX;
    this.aiProgressAnchorZ = this.heroZ;
    this.heroVx = 0;
    this.heroVz = 0;
    this.heroRig.root.position.set(this.heroX, 0, this.heroZ);
    this.heroLight.position.set(this.heroX, 2.0, this.heroZ);

    // If returning from Town, place the lingering Town Portal landmark at the exact return spot
    if (snap) {
      const dPortal = createTownPortal(this.textures.glowMap);
      dPortal.root.position.set(snap.returnX, 0, snap.returnZ);
      dPortal.root.rotation.y = Math.PI / 4;
      this.levelGroup.add(dPortal.root);
      this.townPortalRig = dPortal;
      this.lightProps.push({
        color: 0x35a8db,
        baseIntensity: 21,
        distance: 8.2,
        decay: 2.05,
        phase: 0.4,
        x: snap.returnX,
        y: 1.4,
        z: snap.returnZ,
        kind: 'portal',
      });
    }

    // Snap camera immediately to new floor spawn
    const camOffset = 14.5 * this.camZoom;
    this.camera.position.set(this.heroX + camOffset, camOffset * 1.16, this.heroZ + camOffset);
    _camTarget.set(this.heroX, 0.7, this.heroZ);
    this.camera.lookAt(_camTarget);

    // 9. Spawn Enemies across non-start rooms (protect Town Portal safe zone when returning)
    this.portalSafePos = snap ? { x: snap.returnX, z: snap.returnZ } : null;
    this.spawnEnemies();
    this.portalSafePos = null;
    const spawnG = worldToGrid(this.heroX, this.heroZ);
    this.markExplored(spawnG.gx, spawnG.gz);

    if (!this.isSoftwareGl && depth === 1 && !snap) {
      this.renderer.compile(this.scene, this.camera);
    }

    if (buffExpired) {
      this.emitFloatingText(this.heroX, 2.25, this.heroZ, '天使祝福已消散', 'info');
    }

    if (snap) {
      this.pushBanner(`返回第 ${depth} 層`, '怪物已復活 · 傳送門周圍安全');
    } else if (depth % 5 === 0) {
      const bossKind = getBossForDepth(depth, biome.terrainTheme);
      const cfg = BOSS_CONFIGS[bossKind];
      const shopNote = this.dungeon.shopPos ? ' · Elixir Shop Open' : '';
      this.pushBanner(`DEPTH ${depth} — BOSS FLOOR`, `${cfg.name} Guards the Relic Key${shopNote}`);
    } else if (depth % 5 === 4) {
      const shopNote = this.dungeon.shopPos ? ' · Elixir Shop Open' : '';
      this.pushBanner(
        `DEPTH ${depth} — ALTAR OF ASCENSION`,
        `Spend Gold Before the Depth ${depth + 1} Boss${shopNote}`
      );
    } else if (this.dungeon.shopPos) {
      this.pushBanner(
        `DEPTH ${depth} — ELIXIR SHOP`,
        `${biome.name} · Elixirs ${depth * 10}G Each`
      );
    } else {
      this.pushBanner(`DEPTH ${depth}`, biome.name);
    }
    this.updateWallOcclusion();
    this.emitHud();
    this.emitMinimap();
  }

  private buildTown(): void {
    this.clearLevel();
    this.inTown = true;

    // 4x total plaza area (2x width x 2x length: 23x23 walkable tiles vs previous 11x11)
    const W = 27;
    const H = 27;
    const tiles: TileType[][] = Array.from({ length: H }, () => new Array<TileType>(W).fill(2));
    const explored: boolean[][] = Array.from({ length: H }, () => new Array<boolean>(W).fill(true));

    // Expansive village plaza (gx 2..24, gz 2..24), exact center at (13, 13)
    for (let gz = 2; gz <= 24; gz++) {
      for (let gx = 2; gx <= 24; gx++) {
        tiles[gz][gx] = 1;
      }
    }

    // Solid non-enterable footprints:
    // - Left Grand Timber & Brick Tavern (gx 4..6, gz 9..12 -> 3x4 tiles, non-square)
    // - Right Stone Watch-Turret Guildhouse (gx 9..12, gz 4..6 -> 4x3 tiles, non-square)
    // - Central Stone Well (13, 13)
    for (let gz = 9; gz <= 12; gz++) {
      for (let gx = 4; gx <= 6; gx++) {
        tiles[gz][gx] = 2;
      }
    }
    for (let gz = 4; gz <= 6; gz++) {
      for (let gx = 9; gx <= 12; gx++) {
        tiles[gz][gx] = 2;
      }
    }
    tiles[13][13] = 2; // Central stone well

    const townBiome: BiomeConfig = {
      id: 'catacombs',
      name: '庇護小鎮',
      terrainTheme: 'dungeon',
      fogColor: 0x090c14,
      floorBase: '#3c4048',
      floorAccent: '#484d57',
      floorMortar: '#1c1f26',
      wallBase: '#423c36',
      wallAccent: '#544d45',
      bannerColor: '#2d5770',
      runeColor: 0x35a8db,
      runeCss: '#35a8db',
      torchColor: 0xffb24c,
      hemiSky: 0x6c88b8,
      hemiGround: 0x201a14,
    };

    this.dungeon = {
      width: W,
      height: H,
      tiles,
      explored,
      rooms: [{ id: 0, x: 2, z: 2, w: 23, h: 23, cx: 13, cz: 13, role: 'start' }],
      spawn: { gx: 15, gz: 15 },
      keyPos: { gx: -10, gz: -10 },
      doorPos: { gx: -10, gz: -10, horizontal: true },
      stairsPos: { gx: 19, gz: 11 }, // Town Portal on screen RIGHT (cyan blip on minimap)
      shopPos: { gx: 8, gz: 17 }, // Potion Shop on screen LEFT
      altarPos: { gx: 11, gz: 20 }, // Upgrade Altar on screen LEFT (same side as Potion Shop)
      props: [],
      biome: townBiome,
    };

    // Moody dusk-night town atmosphere: low ambient lighting so facility & lantern lights drive the mood
    this.scene.background = new THREE.Color(0x090c14);
    this.scene.fog = new THREE.Fog(0x090c14, 36, 72);
    this.hemiLight.color.setHex(0x6c88b8);
    this.hemiLight.groundColor.setHex(0x201a14);
    this.hemiLight.intensity = 0.18;
    this.rimLight.color.setHex(0x9eb8df);
    this.rimLight.intensity = 0.14;
    this.scene.environmentIntensity = 0.08;
    this.heroLight.color.setHex(0xffbe66);

    this.textures = createDungeonTextures(
      townBiome,
      this.renderer.capabilities.getMaxAnisotropy(),
      777
    );

    // 1. Dark twilight forest meadow surrounding the 4x village plaza
    const grassCanvas = document.createElement('canvas');
    grassCanvas.width = 256;
    grassCanvas.height = 256;
    const gctx = grassCanvas.getContext('2d')!;
    gctx.fillStyle = '#121e16';
    gctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 650; i++) {
      gctx.fillStyle = i % 3 === 0 ? '#18281d' : i % 3 === 1 ? '#0e1811' : '#1e3023';
      gctx.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 4, 3 + Math.random() * 4);
    }
    const grassTex = new THREE.CanvasTexture(grassCanvas);
    grassTex.colorSpace = THREE.SRGBColorSpace;
    grassTex.wrapS = THREE.RepeatWrapping;
    grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(26, 26);
    this.extraTextures.push(grassTex);

    const meadow = new THREE.Mesh(
      new THREE.PlaneGeometry(130, 130),
      new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.96, metalness: 0.02 })
    );
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.set(13 * TILE_SIZE, -0.06, 13 * TILE_SIZE);
    meadow.receiveShadow = true;
    this.levelGroup.add(meadow);

    // 2. Dark Weathered Slate-Gray Cobblestone Village Plaza (gx 2..24, gz 2..24)
    const cobbleCanvas = document.createElement('canvas');
    cobbleCanvas.width = 256;
    cobbleCanvas.height = 256;
    const cctx = cobbleCanvas.getContext('2d')!;
    cctx.fillStyle = '#1a1d24';
    cctx.fillRect(0, 0, 256, 256);
    const rows = 6;
    const cols = 6;
    const cw = 256 / cols;
    const ch = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const offsetX = (r % 2) * (cw * 0.5);
      for (let c = -1; c <= cols; c++) {
        const shade = 54 + (((r * 19 + c * 37) & 15) * 1.15);
        const s = Math.round(shade);
        cctx.fillStyle = `rgb(${s}, ${s + 2}, ${s + 6})`;
        cctx.fillRect(c * cw + offsetX + 3, r * ch + 3, cw - 6, ch - 6);
        cctx.fillStyle = 'rgba(205,215,232,0.04)';
        cctx.fillRect(c * cw + offsetX + 4, r * ch + 4, cw - 10, 4);
      }
    }
    const cobbleTex = new THREE.CanvasTexture(cobbleCanvas);
    cobbleTex.colorSpace = THREE.SRGBColorSpace;
    this.extraTextures.push(cobbleTex);

    const plazaCoords: Array<[number, number]> = [];
    for (let gz = 2; gz <= 24; gz++) {
      for (let gx = 2; gx <= 24; gx++) {
        plazaCoords.push([gx, gz]);
      }
    }
    const plazaGeo = new THREE.BoxGeometry(TILE_SIZE, 0.24, TILE_SIZE);
    const plazaMat = new THREE.MeshStandardMaterial({
      map: cobbleTex,
      roughness: 0.92,
      metalness: 0.06,
    });
    const plazaMesh = new THREE.InstancedMesh(plazaGeo, plazaMat, plazaCoords.length);
    plazaMesh.receiveShadow = true;
    plazaMesh.frustumCulled = false;
    plazaCoords.forEach(([gx, gz], i) => {
      _pos.set(gx * TILE_SIZE, -0.12, gz * TILE_SIZE);
      _quat.identity();
      _scale.set(1, 1, 1);
      _mat4.compose(_pos, _quat, _scale);
      plazaMesh.setMatrixAt(i, _mat4);
      const tint = 0.86 + ((gx * 13 + gz * 29) % 11) * 0.012;
      _color.setRGB(tint, tint, tint);
      plazaMesh.setColorAt(i, _color);
    });
    plazaMesh.instanceMatrix.needsUpdate = true;
    if (plazaMesh.instanceColor) plazaMesh.instanceColor.needsUpdate = true;
    this.levelGroup.add(plazaMesh);

    // Low weathered wooden fence edging the 4x plaza perimeter
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x453120, roughness: 0.92 });
    const postGeo = new THREE.BoxGeometry(0.16, 0.72, 0.16);
    const railGeo = new THREE.BoxGeometry(TILE_SIZE, 0.1, 0.08);
    for (let i = 2; i <= 24; i++) {
      const edges: Array<[number, number, number]> = [
        [i * TILE_SIZE, 1.5 * TILE_SIZE, 0],
        [i * TILE_SIZE, 24.5 * TILE_SIZE, 0],
        [1.5 * TILE_SIZE, i * TILE_SIZE, Math.PI / 2],
        [24.5 * TILE_SIZE, i * TILE_SIZE, Math.PI / 2],
      ];
      for (const [fx, fz, rot] of edges) {
        const post = new THREE.Mesh(postGeo, fenceMat);
        post.position.set(fx, 0.36, fz);
        post.castShadow = true;
        const rail = new THREE.Mesh(railGeo, fenceMat);
        rail.position.set(fx, 0.48, fz);
        rail.rotation.y = rot;
        this.levelGroup.add(post, rail);
      }
    }

    // 3. Two Distinct ~2x Larger Non-Square Exterior Houses
    // Left: Grand Timber & Red-Brown Brick Tavern (no white walls) at gx 4..6, gz 9..12
    const tavern = createTownHouse('tavern', this.textures.glowMap);
    tavern.position.set(4.6 * TILE_SIZE, 0, 10.5 * TILE_SIZE);
    tavern.rotation.y = Math.PI / 2; // Long timber porch, barrels & tavern sign face +X into the plaza
    this.levelGroup.add(tavern);
    this.lightProps.push({
      color: 0xffaa44,
      baseIntensity: 52,
      distance: 13.5,
      decay: 2.0,
      phase: 0.5,
      x: 6.45 * TILE_SIZE,
      y: 2.35,
      z: 10.5 * TILE_SIZE,
      kind: 'lamp',
    });

    // Right: Asymmetrical Stone Watch-Turret Guildhouse at gx 9..12, gz 4..6
    const cottage = createTownHouse('cottage', this.textures.glowMap);
    cottage.position.set(10.5 * TILE_SIZE, 0, 4.65 * TILE_SIZE);
    cottage.rotation.y = 0; // Stone portico & turret face +Z into the plaza
    this.levelGroup.add(cottage);
    this.lightProps.push({
      color: 0xffb454,
      baseIntensity: 48,
      distance: 13.0,
      decay: 2.0,
      phase: 1.4,
      x: 10.5 * TILE_SIZE,
      y: 2.35,
      z: 6.45 * TILE_SIZE,
      kind: 'lamp',
    });

    // 4. Central Stone Water Well at exact plaza center (13, 13)
    const well = createCentralWell();
    well.position.set(13 * TILE_SIZE, 0, 13 * TILE_SIZE);
    well.rotation.y = Math.PI / 4;
    this.levelGroup.add(well);

    // 5. Beautiful White-Robed Female Angel at (10, 10) framed between the two buildings & well
    const angel = createAngelModel(this.sharedShadowMap, this.textures.glowMap);
    const angelW = gridToWorld(10, 10);
    angel.root.position.set(angelW.x, 0, angelW.z);
    angel.root.rotation.y = Math.PI / 4;
    this.levelGroup.add(angel.root);
    this.angelRig = angel;
    this.angelPos = { x: angelW.x, z: angelW.z };
    this.lightProps.push({
      color: 0xffe296,
      baseIntensity: 42,
      distance: 11.5,
      decay: 2.0,
      phase: 0.2,
      x: angelW.x,
      y: 2.2,
      z: angelW.z,
      kind: 'angel',
    });

    // 6. Outdoor Potion Shop on screen LEFT at (8, 17)
    {
      const sw = gridToWorld(8, 17);
      const shop = createPotionShop(this.textures.glowMap);
      shop.root.position.set(sw.x, 0, sw.z);
      this.levelGroup.add(shop.root);
      this.shopRig = shop;
      this.lightProps.push({
        color: 0xff5a7e,
        baseIntensity: 52,
        distance: 11.5,
        decay: 2.0,
        phase: 1.9,
        x: sw.x,
        y: 1.75,
        z: sw.z,
        crystal: shop.crystal,
        decal: shop.ring,
        halo: shop.halo,
        kind: 'shop',
      });
    }

    // 7. Outdoor Upgrade Altar on screen LEFT (same side as Potion Shop) at (11, 20)
    {
      const aw = gridToWorld(11, 20);
      const altar = createUpgradeAltar(this.textures.glowMap);
      altar.root.position.set(aw.x, 0, aw.z);
      this.levelGroup.add(altar.root);
      this.altarRig = altar;
      this.lightProps.push({
        color: 0xffd25c,
        baseIntensity: 54,
        distance: 11.8,
        decay: 2.0,
        phase: 0.7,
        x: aw.x,
        y: 1.8,
        z: aw.z,
        crystal: altar.crystal,
        decal: altar.ring,
        halo: altar.halo,
        kind: 'altar',
      });
    }

    // 8. Return-to-Dungeon Town Portal on opposite side (screen RIGHT) at (19, 11) with halved brightness
    {
      const pw = gridToWorld(19, 11);
      const portal = createTownPortal(this.textures.glowMap);
      portal.root.position.set(pw.x, 0, pw.z);
      portal.root.rotation.y = Math.PI / 4;
      this.levelGroup.add(portal.root);
      this.townPortalRig = portal;
      this.townPortalPos = { x: pw.x, z: pw.z };
      this.lightProps.push({
        color: 0x35a8db,
        baseIntensity: 24,
        distance: 9.0,
        decay: 2.0,
        phase: 2.5,
        x: pw.x,
        y: 1.5,
        z: pw.z,
        kind: 'portal',
      });
    }

    // 9. Atmospheric Village Lamp Posts & Perimeter Forest Pine Trees across the 4x square
    const lampCoords: Array<[number, number]> = [
      [3.5, 3.5],
      [22.5, 3.5],
      [3.5, 22.5],
      [22.5, 22.5],
      [14.5, 11.5],
      [11.5, 14.5],
      [7.2, 13.5],
      [18.2, 16.2],
    ];
    for (const [lx, lz] of lampCoords) {
      const lamp = createVillageLampPost(this.textures.glowMap);
      lamp.position.set(lx * TILE_SIZE, 0, lz * TILE_SIZE);
      this.levelGroup.add(lamp);
      this.lightProps.push({
        color: 0xffb24c,
        baseIntensity: 42,
        distance: 11.2,
        decay: 2.0,
        phase: lx + lz,
        x: lx * TILE_SIZE,
        y: 2.35,
        z: lz * TILE_SIZE,
        kind: 'lamp',
      });
    }

    const treeCoords: Array<[number, number, number]> = [
      [0.5, 1.2, 1.2],
      [0.9, 5.0, 1.0],
      [0.6, 9.2, 1.25],
      [1.0, 13.5, 1.05],
      [0.7, 17.8, 1.18],
      [0.8, 22.2, 1.1],
      [2.8, 0.6, 1.15],
      [6.6, 0.8, 0.96],
      [10.8, 0.6, 1.22],
      [15.2, 0.8, 1.05],
      [19.6, 0.6, 1.18],
      [23.8, 0.9, 1.08],
      [25.6, 3.8, 1.2],
      [25.8, 8.0, 1.02],
      [25.5, 12.6, 1.18],
      [25.7, 17.2, 1.06],
      [25.4, 21.8, 1.22],
      [24.2, 25.6, 1.12],
      [19.8, 25.8, 1.04],
      [15.0, 25.5, 1.18],
      [10.4, 25.7, 1.08],
      [5.8, 25.5, 1.16],
      [1.6, 25.4, 1.02],
    ];
    for (const [tx, tz, sc] of treeCoords) {
      const tree = createVillageTree(sc);
      tree.position.set(tx * TILE_SIZE, 0, tz * TILE_SIZE);
      tree.rotation.y = (tx * 1.7 + tz * 2.3) % (Math.PI * 2);
      this.levelGroup.add(tree);
    }

    // 10. Place Hero in front of Central Well facing the Angel & Buildings
    const heroStart = gridToWorld(15, 15);
    this.heroX = heroStart.x;
    this.heroZ = heroStart.z;
    this.heroVx = 0;
    this.heroVz = 0;
    this.heroFacing = -Math.PI * 0.75;
    this.heroRig.root.position.set(this.heroX, 0, this.heroZ);
    this.heroRig.body.rotation.y = this.heroFacing;
    this.heroLight.position.set(this.heroX, 2.0, this.heroZ);

    const camOffset = 14.5 * this.camZoom;
    this.camera.position.set(this.heroX + camOffset, camOffset * 1.16, this.heroZ + camOffset);
    _camTarget.set(this.heroX, 0.7, this.heroZ);
    this.camera.lookAt(_camTarget);

    this.pushBanner('庇護小鎮', '左側補給藥水與祭壇強化、向天使祈福，或走入右側傳送門返回地下城');
    this.emitHud();
    this.emitMinimap();
  }

  private spawnEnemies(): void {
    const biome = this.dungeon.biome;
    const theme = biome.terrainTheme;
    const isBossFloor = this.depth % 5 === 0;
    const combatRooms = this.dungeon.rooms.filter(
      (r) => r.role !== 'start' && r.role !== 'key' && r.role !== 'exit'
    );
    const lastCombatRoomId = combatRooms[combatRooms.length - 1]?.id ?? -1;
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
      if (room.role === 'start') continue;

      if (room.role === 'key') {
        if (isBossFloor) {
          // Spawn a towering terrain-matched Floor Boss in or right in front of the Key Room!
          const bossKind = getBossForDepth(this.depth, theme);
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
    if (swarmPacksSpawned === 0 && combatRooms.length > 0) {
      const targetRoom = combatRooms[Math.floor(combatRooms.length / 2)];
      if (this.dungeon.tiles[targetRoom.cz]?.[targetRoom.cx] === 1) {
        spawnSwarmPack(targetRoom.cx, targetRoom.cz);
      }
    }
  }

  private getDepthDamageScale(): number {
    return 1 + (this.depth - 1) * 0.12;
  }

  private getSwarmDepthDamageScale(): number {
    return 1 + (this.depth - 1) * 0.06;
  }

  private getDepthGoldScale(): number {
    // +6.5% gold per floor (within 5-8% per floor progression)
    return Math.pow(1.065, Math.max(0, this.depth - 1));
  }

  private addEnemy(
    kind: EnemyKind,
    gx: number,
    gz: number,
    biome: DungeonData['biome'],
    isElite = false,
    offsetX = 0,
    offsetZ = 0
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
      const bossTierScale = 1 + Math.max(0, this.depth - 5) * 0.14;
      const maxHp = Math.round(cfg.baseHp * bossTierScale);
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
      });
      return;
    }

    const eliteEligible = isElite && !isGuardianEnemy(kind) && !isSwarmEnemy(kind);
    const isSpecialElite = eliteEligible && Math.random() < 0.25;
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
    const maxHp = Math.round(baseHp * depthScale * eliteHpMult);
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
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.renderer?.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer?.domElement.addEventListener('contextmenu', this.handleContextMenu);
    this.renderer?.domElement.addEventListener('wheel', this.handleWheel, { passive: true });
    this.renderer?.domElement.addEventListener('webglcontextlost', this.handleContextLost);
  }

  private handleResize = (): void => {
    if (!this.renderer || !this.camera) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.callbacks.onWebGLError('WebGL context was lost. Please reload the page.');
  };

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private handleWheel = (e: WheelEvent): void => {
    this.camZoom = THREE.MathUtils.clamp(this.camZoom + e.deltaY * 0.0005, 0.72, 1.35);
  };

  private activateManualMode(): void {
    if (!this.audio.isEnabled()) {
      this.audio.unlockAndEnable();
    }
    this.controlMode = 'manual';
    this.emitHud();
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.isDead) return;
    const code = e.code;

    // Hidden shortcut: Ctrl+J jumps straight to the next floor entrance and grants (nextDepth * 100) gold
    if (e.ctrlKey && !e.altKey && (code === 'KeyJ' || e.key.toLowerCase() === 'j')) {
      e.preventDefault();
      this.triggerSkipFloorCheat();
      return;
    }

    // Hotkey B: Teleport back to Sanctuary Town
    if (code === 'KeyB' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (!this.inTown) {
        this.returnToTown();
      }
      return;
    }

    if (
      [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
        'ShiftLeft',
        'ShiftRight',
        'KeyE',
        'KeyQ',
      ].includes(code)
    ) {
      e.preventDefault();
      this.keysPressed.add(code);
      if (this.inTown) {
        if (!this.audio.isEnabled()) {
          this.audio.unlockAndEnable();
        }
      } else {
        this.activateManualMode();
      }

      if (code === 'Space' && !this.inTown) {
        // Space auto-turns toward the nearest enemy (both classes) before attacking
        if (this.attackCooldown <= 0) this.autoFaceNearestEnemy();
        this.performAttack();
      } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
        this.performDash();
      } else if (code === 'KeyE' || code === 'KeyQ') {
        this.usePotion();
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keysPressed.delete(e.code);
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.isDead || this.inTown) return;
    this.activateManualMode();
    if (e.button === 2) {
      this.performPommelStrike();
    } else if (e.button === 0) {
      if (this.isMage() && this.attackCooldown <= 0) {
        // Frost Mage left-click fires toward the mouse cursor
        const target = this.screenToGround(e.clientX, e.clientY);
        if (target) {
          const ax = target.x - this.heroX;
          const az = target.z - this.heroZ;
          if (Math.hypot(ax, az) > 0.05) {
            this.heroFacing = Math.atan2(ax, az);
            this.heroRig.body.rotation.y = this.heroFacing;
          }
        }
      }
      this.performAttack();
    }
  };

  // Public UI Control Methods
  public triggerPommelStrike(): void {
    if (this.isDead) return;
    if (!this.audio.isEnabled()) {
      this.audio.unlockAndEnable();
    }
    this.performPommelStrike();
  }

  public toggleSound(): boolean {
    const on = this.audio.toggle();
    this.emitHud();
    return on;
  }

  public setControlMode(mode: 'auto' | 'manual'): void {
    this.controlMode = mode;
    this.aiPath = [];
    this.aiCombatPath = [];
    this.aiUnstuckPath = [];
    this.aiUnstuckTimer = 0;
    this.aiNoProgressTimer = 0;
    this.aiUnstuckAttempts = 0;
    this.aiProgressAnchorX = this.heroX;
    this.aiProgressAnchorZ = this.heroZ;
    this.emitHud();
  }

  public triggerManualPotion(): void {
    if (this.isDead) return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.usePotion();
  }

  public triggerNewDungeon(): void {
    if (this.isDead || this.inTown || this.transitionState !== 'none') return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.audio.playDescend();
    this.beginTransition(() => {
      this.buildLevel(this.depth + 1, { tickBuffFloor: true });
    });
  }

  private triggerSkipFloorCheat(): void {
    if (this.isDead || this.inTown || this.transitionState !== 'none') return;
    if (this.audio.isEnabled()) {
      this.audio.playDescend();
    }
    const nextDepth = this.depth + 1;
    const bonusGold = nextDepth * 100;
    this.beginTransition(() => {
      this.gold += bonusGold;
      this.totalGoldEarned += bonusGold;
      this.buildLevel(nextDepth, { tickBuffFloor: true });
      this.emitFloatingText(this.heroX, 2.0, this.heroZ, `+${bonusGold} G`, 'gold');
    });
  }

  public getTownReturnCost(): number {
    return this.depth * 10;
  }

  public returnToTown(): void {
    if (this.isDead || this.inTown || this.transitionState !== 'none') return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();

    const cost = this.getTownReturnCost();
    const spent = Math.min(this.gold, cost);
    this.gold = Math.max(0, this.gold - cost);

    // Record consumed rune wells & broken crates so the floor stays consistent on return
    const usedRuneKeys = new Set<string>();
    for (const lp of this.lightProps) {
      if (lp.kind === 'rune' && lp.used) {
        const g = worldToGrid(lp.x, lp.z);
        usedRuneKeys.add(`${g.gx},${g.gz}`);
      }
    }
    const brokenBreakableKeys = new Set<string>();
    for (const b of this.breakables) {
      if (b.broken) {
        const g = worldToGrid(b.x, b.z);
        brokenBreakableKeys.add(`${g.gx},${g.gz}`);
      }
    }

    this.savedDungeon = {
      depth: this.depth,
      dungeon: this.dungeon,
      hasKey: this.hasKey,
      doorUnlocked: this.doorUnlocked,
      chronosUsedThisFloor: this.chronosUsedThisFloor,
      floorKills: this.floorKills,
      returnX: this.heroX,
      returnZ: this.heroZ,
      usedRuneKeys,
      brokenBreakableKeys,
    };

    // Spawn instantaneous glowing portal at current spot before fading into Sanctuary Town
    if (this.textures) {
      const departPortal = createTownPortal(this.textures.glowMap);
      departPortal.root.position.set(this.heroX, 0, this.heroZ);
      departPortal.root.rotation.y = Math.PI / 4;
      this.dynamicGroup.add(departPortal.root);
    }
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.spawnParticle(
        this.heroX + Math.cos(a) * 0.35,
        0.7,
        this.heroZ + Math.sin(a) * 0.35,
        Math.cos(a) * 2.4,
        2.2 + Math.random() * 1.4,
        Math.sin(a) * 2.4,
        i % 2 === 0 ? 0x56e4ff : 0xd9fbff,
        1.1,
        0.65,
        -0.4
      );
    }

    this.audio.playPortal();
    this.emitFloatingText(
      this.heroX,
      2.1,
      this.heroZ,
      spent > 0 ? `回城鎮 -${spent}G` : '回城鎮',
      'info'
    );
    this.keysPressed.clear();
    this.emitHud();

    this.beginTransition(() => {
      this.buildTown();
    });
  }

  public returnToDungeon(): void {
    if (this.isDead || !this.inTown || !this.savedDungeon || this.transitionState !== 'none') {
      return;
    }
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.audio.playPortal();
    this.keysPressed.clear();

    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.spawnParticle(
        this.heroX + Math.cos(a) * 0.35,
        0.7,
        this.heroZ + Math.sin(a) * 0.35,
        Math.cos(a) * 2.2,
        2.2 + Math.random() * 1.2,
        Math.sin(a) * 2.2,
        i % 2 === 0 ? 0x56e4ff : 0xffffff,
        1.05,
        0.6,
        -0.4
      );
    }

    const snap = this.savedDungeon;
    this.savedDungeon = null;
    this.beginTransition(() => {
      this.buildLevel(snap.depth, { savedSnapshot: snap });
    });
  }

  public requestAngelBlessing(): boolean {
    if (this.isDead || !this.inTown || !this.isHeroNearAngel() || this.angelBuff) {
      return false;
    }
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();

    const buff = rollAngelBlessing(this.depth);
    this.angelBuff = buff;
    this.recomputeRelicStats(true);
    this.audio.playAngelBlessing();

    const tone: FloatingLabelData['tone'] =
      buff.rarity === 'orange'
        ? 'relicOrange'
        : buff.rarity === 'yellow'
        ? 'relicYellow'
        : 'relicBlue';
    this.emitFloatingText(this.heroX, 2.25, this.heroZ, `獲得祝福：${buff.name}`, tone);

    const ax = this.angelPos?.x ?? this.heroX;
    const az = this.angelPos?.z ?? this.heroZ;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.spawnParticle(
        ax + Math.cos(a) * 0.5,
        1.1,
        az + Math.sin(a) * 0.5,
        Math.cos(a) * 2.1,
        2.0 + Math.random() * 1.8,
        Math.sin(a) * 2.1,
        i % 2 === 0 ? 0xfff0a8 : 0xffffff,
        1.15,
        0.85,
        -0.5
      );
    }

    this.emitHud();
    return true;
  }

  public getHeroClass(): HeroClassId {
    return this.heroClass;
  }

  /** Swap the hero 3D rig to match the given class (no-op if already matching). */
  private applyHeroClassRig(classId: HeroClassId): void {
    if (!this.heroRig || !this.sharedShadowMap) return;
    const wantMage = classId === 'frost_mage';
    const isMageRig = Boolean(this.heroRig.root.userData.isFrostMage);
    if (wantMage === isMageRig) return;
    this.heroRig.root.remove(this.heroSetAura.group);
    this.scene.remove(this.heroRig.root);
    this.heroRig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.heroRig = wantMage
      ? createFrostMageModel(this.sharedShadowMap)
      : createHeroModel(this.sharedShadowMap);
    this.heroRig.root.userData.isFrostMage = wantMage;
    this.heroLight?.color.setHex(wantMage ? 0x9fe6ff : 0xffaa44);
    if (this.heroFloorGlow) {
      (this.heroFloorGlow.material as THREE.MeshBasicMaterial).color.setHex(wantMage ? 0x7fd6ff : 0xffffff);
    }
    this.heroRig.root.add(this.heroSetAura.group);
    this.heroRig.root.position.set(this.heroX, 0, this.heroZ);
    this.scene.add(this.heroRig.root);
  }

  /** Resets class-dependent base stats (HP, shield, upgrades, skill cooldown). */
  private applyHeroClassStats(classId: HeroClassId): void {
    const def = HERO_CLASSES[classId];
    this.heroClass = classId;
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

  public restartRun(classId?: HeroClassId): void {
    const nextClass: HeroClassId = classId ?? this.heroClass;
    if (this.transitionState !== 'none') {
      // A fade is in progress (e.g. the initial fade-in): run the restart as soon as it ends.
      this.queuedRestartClass = nextClass;
      return;
    }
    this.queuedRestartClass = null;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.audio.playDescend();
    this.beginTransition(() => {
      this.isDead = false;
      this.inTown = false;
      this.savedDungeon = null;
      this.angelBuff = null;
      this.portalSafePos = null;
      this.applyHeroClassStats(nextClass);
      this.applyHeroClassRig(nextClass);
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
      this.runElapsedSec = 0;
      this.slainBy = '地城陷阱';
      this.equippedRelics = [];
      this.relicBag = [];
      this.discoveredRelicIds.clear();
      this.phantomCritTimer = 0;
      this.alchemistShieldTimer = 0;
      this.dragonAuraTimer = 0;
      this.chronosUsedThisFloor = false;
      this.bloodLeechAccum = 0;
      this.pommelCooldown = 0;
      this.pommelAnim = 0;
      this.recomputeRelicStats(false);
      this.keysPressed.clear();
      this.heroRig.body.rotation.z = 0;
      this.heroRig.body.position.y = 0;
      this.buildLevel(1);
    });
  }

  public adjustZoom(delta: number): void {
    this.camZoom = THREE.MathUtils.clamp(this.camZoom + delta, 0.72, 1.35);
  }

  private getEffectiveMaxHp(): number {
    if (this.heroClass === 'frost_mage') {
      return this.maxHp + splitRelicMaxHpForMage(this.relicStats.maxHp).hp;
    }
    return this.maxHp + this.relicStats.maxHp;
  }

  /** Effective max shield (Frost Mage only; 0 for classes without a shield). */
  private getEffectiveMaxShield(): number {
    if (this.heroClass !== 'frost_mage') return 0;
    return this.baseMaxShield + splitRelicMaxHpForMage(this.relicStats.maxHp).shield;
  }

  private isMage(): boolean {
    return this.heroClass === 'frost_mage';
  }

  private hasUnique(effectId: UniqueEffectId): boolean {
    return this.relicStats.uniqueEffects.includes(effectId);
  }

  private hasSet4pc(setId: RelicSetId): boolean {
    return this.relicStats.activeSetIds4pc.includes(setId);
  }

  private recomputeRelicStats(adjustHp = true): void {
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
    if (this.heroSetAura) {
      const set4 = this.relicStats.activeSetIds4pc[0];
      if (!set4) {
        this.heroSetAura.group.visible = false;
      } else {
        this.heroSetAura.group.visible = true;
        if (set4 === 'dragonfire') {
          this.heroSetAura.outerMat.color.setHex(0xff5a1f);
          this.heroSetAura.innerMat.color.setHex(0xffcf54);
        } else if (set4 === 'voidstalker') {
          this.heroSetAura.outerMat.color.setHex(0x9b5cff);
          this.heroSetAura.innerMat.color.setHex(0x5ef0ff);
        } else {
          this.heroSetAura.outerMat.color.setHex(0xffd24a);
          this.heroSetAura.innerMat.color.setHex(0xfff4a8);
        }
      }
    }
  }

  public equipRelic(relicId: string, replaceSlotIndex?: number): boolean {
    if (this.isDead) return false;
    const bagIdx = this.relicBag.findIndex((r) => r.id === relicId);
    if (bagIdx === -1) return false;

    const item = this.relicBag[bagIdx];
    if (this.equippedRelics.length < 4 && replaceSlotIndex === undefined) {
      this.relicBag.splice(bagIdx, 1);
      this.equippedRelics.push(item);
    } else {
      const slot =
        replaceSlotIndex !== undefined &&
        replaceSlotIndex >= 0 &&
        replaceSlotIndex < this.equippedRelics.length
          ? replaceSlotIndex
          : 0;
      const swappedOut = this.equippedRelics[slot];
      this.relicBag.splice(bagIdx, 1);
      this.equippedRelics[slot] = item;
      if (swappedOut) {
        this.relicBag.unshift(swappedOut);
      }
    }

    this.recomputeRelicStats(true);
    this.audio.playRelicEquip();
    this.emitHud();
    return true;
  }

  public unequipRelic(slotIndex: number): boolean {
    if (this.isDead) return false;
    if (slotIndex < 0 || slotIndex >= this.equippedRelics.length) return false;
    if (this.relicBag.length >= this.relicBagCap) return false;

    const [removed] = this.equippedRelics.splice(slotIndex, 1);
    this.relicBag.unshift(removed);
    this.recomputeRelicStats(true);
    this.audio.playRelicEquip();
    this.emitHud();
    return true;
  }

  public sellRelic(relicId: string): boolean {
    if (this.isDead || !this.isHeroNearShop()) return false;
    const bagIdx = this.relicBag.findIndex((r) => r.id === relicId);
    if (bagIdx === -1) return false;

    if (!this.audio.isEnabled() && this.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    const [sold] = this.relicBag.splice(bagIdx, 1);
    this.gold += sold.sellValue;
    this.totalGoldEarned += sold.sellValue;
    this.audio.playRelicSell();
    this.emitFloatingText(this.heroX, 1.9, this.heroZ, `+${sold.sellValue} G`, 'gold');
    this.emitHud();
    return true;
  }

  public sellCommonBagRelics(includeYellow = true): number {
    if (this.isDead || !this.isHeroNearShop()) return 0;
    let earned = 0;
    const keep: RelicItem[] = [];
    for (const r of this.relicBag) {
      if (r.rarity === 'blue' || (includeYellow && r.rarity === 'yellow')) {
        earned += r.sellValue;
      } else {
        keep.push(r);
      }
    }
    if (earned <= 0) return 0;

    if (!this.audio.isEnabled() && this.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    this.relicBag = keep;
    this.gold += earned;
    this.totalGoldEarned += earned;
    this.audio.playRelicSell();
    this.emitFloatingText(this.heroX, 2.0, this.heroZ, `售出 +${earned} G`, 'gold');
    this.emitHud();
    return earned;
  }

  private getTotalUpgradeLevel(): number {
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
  private getUpgradeMax(kind: UpgradeKind): number {
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

  private getUpgradeCount(kind: UpgradeKind): number {
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

  private isUpgradeMaxed(kind: UpgradeKind): boolean {
    if (!this.isMage() && kind === 'hp') return this.maxHp >= this.maxHpCap;
    return this.getUpgradeCount(kind) >= this.getUpgradeMax(kind);
  }

  public getUpgradeOptions(): UpgradeOptionView[] {
    const row = (
      kind: UpgradeKind,
      accent: UpgradeOptionView['accent'],
      label: string,
      maxedLabel: string,
      progress: string
    ): UpgradeOptionView => ({
      kind,
      accent,
      label,
      maxedLabel,
      progress,
      count: this.getUpgradeCount(kind),
      maxCount: this.getUpgradeMax(kind),
      maxed: this.isUpgradeMaxed(kind),
    });
    if (this.isMage()) {
      const speedPct = Math.round(this.shieldSpeedUpgrades * FROST_MAGE.shieldSpeedStep * 100);
      return [
        row(
          'hp_shield',
          'shield',
          `HP +${FROST_MAGE.hpPerUpgrade} · 護盾 +${FROST_MAGE.shieldPerUpgrade}`,
          'HP / 護盾 MAXED',
          `${this.hpShieldUpgrades} / ${FROST_MAGE.maxHpShieldUpgrades} · HP ${this.maxHp} · 護盾 ${this.baseMaxShield}`
        ),
        row(
          'atk',
          'atk',
          '+10% 攻擊力',
          'ATK MAXED',
          `+${this.atkUpgrades * 10}% / +${FROST_MAGE.maxAtkUpgrades * 10}% DMG`
        ),
        row(
          'crit',
          'crit',
          '+2% 爆擊',
          'CRIT MAXED',
          `+${this.critUpgrades * 2}% / +${FROST_MAGE.maxCritUpgrades * 2}% CRIT`
        ),
        row(
          'shield_speed',
          'armor',
          '護盾回充 +12%',
          'REGEN MAXED',
          `-${speedPct}% / -${FROST_MAGE.maxShieldSpeedUpgrades * 12}% 等待與回充時間`
        ),
      ];
    }
    return [
      row('hp', 'hp', '+10 Max HP', 'HP MAXED', `${this.maxHp} / ${this.maxHpCap} HP`),
      row(
        'atk',
        'atk',
        '+10% Attack',
        'ATK MAXED',
        `+${this.atkUpgrades * 10}% → +${this.atkUpgrades * 10 + 10}% DMG`
      ),
      row(
        'armor',
        'armor',
        '+10% Armor',
        'DEF MAXED',
        `${this.armorUpgrades * 10}% / ${this.maxArmorUpgrades * 10}% DEF`
      ),
      row(
        'crit',
        'crit',
        '+2% Crit',
        'CRIT MAXED',
        `+${this.critUpgrades * 2}% / +${this.maxCritUpgrades * 2}% CRIT`
      ),
    ];
  }

  public getUpgradeCost(): number {
    const lv = this.getTotalUpgradeLevel();
    return 40 + lv * 25 + Math.floor(lv * lv * 4);
  }

  public getPotionCost(): number {
    return this.depth * 10;
  }

  private isHeroNearAltar(): boolean {
    if (!this.dungeon?.altarPos) return false;
    const aw = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
    return Math.hypot(this.heroX - aw.x, this.heroZ - aw.z) < 2.55;
  }

  private isHeroNearShop(): boolean {
    if (!this.dungeon?.shopPos) return false;
    const sw = gridToWorld(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
    return Math.hypot(this.heroX - sw.x, this.heroZ - sw.z) < 2.55;
  }

  private isHeroNearPortal(): boolean {
    if (!this.inTown || !this.townPortalPos) return false;
    return Math.hypot(this.heroX - this.townPortalPos.x, this.heroZ - this.townPortalPos.z) < 2.25;
  }

  private isHeroNearAngel(): boolean {
    if (!this.inTown || !this.angelPos) return false;
    return Math.hypot(this.heroX - this.angelPos.x, this.heroZ - this.angelPos.z) < 2.75;
  }

  public purchaseUpgrade(kind: UpgradeKind): boolean {
    if (!this.dungeon?.altarPos || !this.isHeroNearAltar()) return false;
    const cost = this.getUpgradeCost();
    if (this.gold < cost) return false;
    if (this.getUpgradeMax(kind) <= 0 || this.isUpgradeMaxed(kind)) return false;

    if (!this.audio.isEnabled() && this.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    this.gold -= cost;
    const effMax = this.getEffectiveMaxHp();
    if (kind === 'hp_shield') {
      this.hpShieldUpgrades += 1;
      this.maxHp += FROST_MAGE.hpPerUpgrade;
      this.baseMaxShield += FROST_MAGE.shieldPerUpgrade;
      this.hp = this.getEffectiveMaxHp();
      this.shield = this.getEffectiveMaxShield();
      this.emitFloatingText(
        this.heroX,
        2.0,
        this.heroZ,
        `HP +${FROST_MAGE.hpPerUpgrade} · 護盾 +${FROST_MAGE.shieldPerUpgrade} · FULL`,
        'shieldHit'
      );
    } else if (kind === 'shield_speed') {
      this.shieldSpeedUpgrades += 1;
      this.hp = effMax;
      this.shield = this.getEffectiveMaxShield();
      this.emitFloatingText(
        this.heroX,
        2.0,
        this.heroZ,
        `護盾回充 +${this.shieldSpeedUpgrades * 12}% · FULL`,
        'shieldHit'
      );
    } else if (kind === 'hp') {
      this.hpUpgrades += 1;
      this.maxHp = Math.min(this.maxHpCap, this.maxHp + 10);
      this.hp = this.getEffectiveMaxHp();
      this.emitFloatingText(this.heroX, 2.0, this.heroZ, '+10 MAX HP · FULL HP', 'heal');
    } else if (kind === 'armor') {
      this.armorUpgrades += 1;
      this.hp = effMax;
      this.emitFloatingText(
        this.heroX,
        2.0,
        this.heroZ,
        `DEF +${this.armorUpgrades * 10}% · FULL HP`,
        'info'
      );
    } else if (kind === 'crit') {
      this.critUpgrades += 1;
      this.hp = effMax;
      this.emitFloatingText(
        this.heroX,
        2.0,
        this.heroZ,
        `CRIT +${this.critUpgrades * 2}% · FULL HP`,
        'crit'
      );
    } else {
      this.atkUpgrades += 1;
      this.hp = effMax;
      this.emitFloatingText(
        this.heroX,
        2.0,
        this.heroZ,
        `ATK +${this.atkUpgrades * 10}% · FULL HP`,
        'crit'
      );
    }

    if (this.isMage()) {
      this.shield = this.getEffectiveMaxShield();
    }
    this.audio.playUpgrade();

    const aw = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const particleColor =
        kind === 'hp'
          ? i % 2 === 0
            ? 0xff5a72
            : 0xffe066
          : kind === 'armor' || kind === 'hp_shield' || kind === 'shield_speed'
          ? i % 2 === 0
            ? 0x6ecbff
            : 0xffe066
          : kind === 'crit'
          ? i % 2 === 0
            ? 0x7eff9b
            : 0xffe066
          : i % 2 === 0
          ? 0xffe066
          : 0xff9838;
      this.spawnParticle(
        aw.x + Math.cos(a) * 0.45,
        0.9,
        aw.z + Math.sin(a) * 0.45,
        Math.cos(a) * 1.8,
        2.4 + Math.random() * 1.6,
        Math.sin(a) * 1.8,
        particleColor,
        1.15,
        0.72,
        -0.8
      );
    }

    this.emitHud();
    return true;
  }

  public purchasePotion(): boolean {
    if (this.isDead) return false;
    const nearShop = this.isHeroNearShop();
    const nearAltar = this.isHeroNearAltar();
    if (!nearShop && !nearAltar) return false;
    const cost = this.getPotionCost();
    if (this.gold < cost) return false;

    if (!this.audio.isEnabled() && this.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    this.gold -= cost;
    this.potions += 1;
    this.audio.playPotion();
    this.emitFloatingText(this.heroX, 2.0, this.heroZ, '+1 ELIXIR', 'heal');

    const stationPos = nearShop ? this.dungeon.shopPos! : this.dungeon.altarPos!;
    const sw = gridToWorld(stationPos.gx, stationPos.gz);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.spawnParticle(
        sw.x + Math.cos(a) * 0.4,
        0.9,
        sw.z + Math.sin(a) * 0.4,
        Math.cos(a) * 1.5,
        2.1 + Math.random() * 1.2,
        Math.sin(a) * 1.5,
        i % 2 === 0 ? 0xff4d6d : 0xffb3c1,
        1.0,
        0.62,
        -0.8
      );
    }

    this.emitHud();
    return true;
  }

  private beginTransition(action: () => void): void {
    this.transitionState = 'fadeOut';
    this.pendingTransitionAction = action;
  }

  private usePotion(): void {
    const effMax = this.getEffectiveMaxHp();
    if (this.isDead || this.potions <= 0 || this.hp >= effMax) return;

    const hasAlchemist = this.hasUnique('alchemist_free_flask');
    const savedFlask = hasAlchemist && Math.random() < 0.2;
    if (!savedFlask) {
      this.potions -= 1;
    }
    this.potionsUsed += 1;
    if (hasAlchemist) {
      this.alchemistShieldTimer = 3.0;
    }

    const noodleBonus = this.hasUnique('noodle_elixir_boost') ? 15 : 0;
    const baseHeal = Math.round(40 * (1 + this.relicStats.potionHealPct / 100)) + noodleBonus;
    const heal = Math.min(baseHeal, effMax - this.hp);
    this.hp = Math.min(effMax, this.hp + heal);
    this.audio.playPotion();
    this.pushBanner(
      savedFlask ? '秘藥奇蹟 · 不耗藥水!' : noodleBonus > 0 ? '泡麵加湯回復!' : 'ELIXIR USED'
    );
    this.emitFloatingText(
      this.heroX,
      1.8,
      this.heroZ,
      savedFlask ? `+${heal} HP (免費!)` : noodleBonus > 0 ? `+${heal} HP 暖胃!` : `+${heal} HP`,
      'heal'
    );

    // Burst of crimson & emerald restorative motes
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.spawnParticle(
        this.heroX + Math.cos(a) * 0.4,
        0.5,
        this.heroZ + Math.sin(a) * 0.4,
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
  }

  private performDash(): void {
    if (this.dashCooldown > 0 || this.dashTimer > 0) return;
    if (this.isMage()) {
      this.performBlink();
      return;
    }
    this.dashTimer = 0.16;
    this.dashCooldown = Math.max(0.35, 1.1 * (1 - this.relicStats.dashCdPct / 100));
    this.heroInvuln = Math.max(this.heroInvuln, 0.28);
    if (this.hasUnique('phantom_dash_crit')) {
      this.phantomCritTimer = 2.0;
    }
    this.dashDirX = Math.sin(this.heroFacing);
    this.dashDirZ = Math.cos(this.heroFacing);
    this.audio.playDash();

    // Unique: Phoenix Plume — fiery ring nova when dashing
    if (this.hasUnique('phoenix_dash_nova')) {
      const dashAtkMult = 1 + this.atkUpgrades * 0.1 + this.relicStats.atkPct / 100;
      const fireDmg = Math.max(8, Math.round(14 * dashAtkMult));
      for (const e of this.enemies) {
        if (e.dead) continue;
        const edx = e.x - this.heroX;
        const edz = e.z - this.heroZ;
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
          this.heroX + Math.cos(a) * 0.35,
          0.55,
          this.heroZ + Math.sin(a) * 0.35,
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
        this.heroX + (Math.random() - 0.5) * 0.5,
        0.4 + Math.random() * 0.7,
        this.heroZ + (Math.random() - 0.5) * 0.5,
        -this.dashDirX * (1.2 + Math.random()),
        0.8 + Math.random(),
        -this.dashDirZ * (1.2 + Math.random()),
        i % 2 === 0 ? 0x3be8e0 : 0xffbe55,
        1.15,
        0.38,
        0
      );
    }
    this.emitHud();
  }

  private applyBonusEnemyDamage(
    enemy: EnemyEntity,
    bonusDmg: number,
    label: string,
    tone: FloatingLabelData['tone'],
    particleColor: number
  ): void {
    if (enemy.dead || bonusDmg <= 0) return;
    enemy.hp -= bonusDmg;
    enemy.hitFlash = 0.12;
    this.totalDamageDealt += bonusDmg;
    this.aiLastCombatDamageTime = this.elapsed;
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
  }

  private performAttack(): void {
    if (this.attackCooldown > 0) return;
    if (this.isMage()) {
      this.performMageAttack();
      return;
    }

    this.comboStep = this.comboResetTimer > 0 ? (this.comboStep + 1) % 3 : 0;
    this.comboResetTimer = 0.9;
    const isCleave = this.comboStep === 2;

    this.attackCooldown = isCleave ? 0.42 : 0.28;
    this.attackAnim = isCleave ? 0.34 : 0.24;
    this.audio.playSwordSlash(isCleave);

    // Spawn luminous crescent sword slash VFX mesh
    const arcGeo = isCleave
      ? new THREE.RingGeometry(0.75, 2.05, 24, 1, 0, Math.PI * 1.85)
      : new THREE.RingGeometry(0.65, 1.85, 14, 1, -Math.PI * 0.48, Math.PI * 0.96);
    const arcColor = this.hasSet4pc('dragonfire')
      ? 0xff7b29
      : this.hasSet4pc('voidstalker')
      ? 0xc88cff
      : this.hasSet4pc('syndicate')
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
    arcMesh.rotation.z = this.heroFacing - Math.PI / 2;
    arcMesh.position.set(this.heroX, 0.85, this.heroZ);
    this.scene.add(arcMesh);
    this.slashArcs.push({
      mesh: arcMesh,
      life: 0,
      maxLife: isCleave ? 0.24 : 0.16,
      isCleave,
    });

    const reach = isCleave ? 2.55 : 2.25;
    const fwdX = Math.sin(this.heroFacing);
    const fwdZ = Math.cos(this.heroFacing);
    let landedHit = false;
    const effMaxHp = this.getEffectiveMaxHp();
    const usePhantomCrit = this.phantomCritTimer > 0;
    const hitState = { consumedPhantom: false, triggeredStorm: false };

    const avariceBonus = this.hasUnique('avarice_gold_atk')
      ? Math.min(0.4, Math.floor(this.gold / 100) * 0.01)
      : 0;
    const titanFuryBonus =
      this.hasUnique('titan_low_hp_fury') && this.hp / Math.max(1, effMaxHp) < 0.4 ? 0.18 : 0;
    const berserkerBonus = this.hasUnique('berserker_combo_ramp')
      ? Math.min(0.25, this.floorKills * 0.01)
      : 0;
    const atkMult =
      1 +
      this.atkUpgrades * 0.1 +
      this.relicStats.atkPct / 100 +
      avariceBonus +
      titanFuryBonus +
      berserkerBonus;
    const critChance = Math.min(
      0.95,
      (isCleave ? 0.5 : 0.11) + this.critUpgrades * 0.02 + this.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.relicStats.critDmgPct / 100 + (usePhantomCrit ? 0.25 : 0);
    const knockMult = 1 + this.relicStats.dramaticKnockback / 100;

    // Damage enemies in arc
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - this.heroX;
      const dz = enemy.z - this.heroZ;
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
        originX: this.heroX,
        originZ: this.heroZ,
        fallbackX: fwdX,
        fallbackZ: fwdZ,
        usePhantomCrit,
        effMaxHp,
        state: hitState,
      });
      landedHit = true;
    }

    if (hitState.consumedPhantom) {
      this.phantomCritTimer = 0;
    }

    // Smash nearby crates & urns
    for (const br of this.breakables) {
      if (br.broken) continue;
      const dist = Math.hypot(br.x - this.heroX, br.z - this.heroZ);
      if (dist <= reach * 0.92) {
        this.breakProp(br);
        landedHit = true;
      }
    }

    if (landedHit) {
      this.audio.playHit(isCleave);
      this.hitStopTimer = isCleave ? 0.055 : 0.03;
      this.addScreenShake(isCleave ? 0.26 : 0.14, 0.14);
    }
  }

  /**
   * Applies one hero basic-attack hit to an enemy: damage roll, crit, knockback,
   * floating text, and every "on hit" relic / set effect. Shared by the warrior's
   * sword arc and the Frost Mage's ice spike explosions.
   */
  private applyHeroHit(enemy: EnemyEntity, hit: HeroHitParams): void {
    const dx = enemy.x - hit.originX;
    const dz = enemy.z - hit.originZ;
    const dist = Math.hypot(dx, dz);

    const isCounter = enemy.isBoss && enemy.bossState === 'recover';
    const { atkMult, critChance, critMult, knockMult, usePhantomCrit, effMaxHp } = hit;
    const baseDmg = hit.baseDmg;
    const bananaSlip = this.hasUnique('banana_slip_crit') && Math.random() < 0.15;
    const isCrit = isCounter || usePhantomCrit || bananaSlip || Math.random() < critChance;
    if (usePhantomCrit) hit.state.consumedPhantom = true;

    let mult = atkMult * (isCounter ? Math.max(1.45, critMult) : isCrit ? critMult : 1);
    if (bananaSlip) {
      mult *= 1.4;
    }
    if (enemy.isBoss || enemy.isElite) {
      mult *= 1 + this.relicStats.eliteBossDmgPct / 100;
    }
    if (this.hasUnique('executioner_finisher') && enemy.hp / Math.max(1, enemy.maxHp) < 0.3) {
      mult *= enemy.isBoss ? 1.25 : 1.5;
    }

    let gamblerTag = bananaSlip ? '滑倒! ' : '';
    if (this.hasUnique('gambler_coin_flip')) {
      const gRoll = Math.random();
      if (gRoll < 0.25) {
        mult *= 1.6;
        gamblerTag += 'JACKPOT ';
      } else if (gRoll < 0.35) {
        mult *= 0.7;
        gamblerTag += 'SLIP ';
      }
    }

    const dmg = Math.max(1, Math.round(baseDmg * mult));

    this.totalDamageDealt += dmg;
    if (isCrit) this.critCount += 1;
    this.aiLastCombatDamageTime = this.elapsed;

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
      this.hasUnique('overtime_mug_fury') &&
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
    if (this.hasUnique('blood_moon_leech') && this.hp < effMaxHp) {
      this.bloodLeechAccum += dmg * 0.015;
      const leech = Math.floor(this.bloodLeechAccum);
      if (leech >= 1) {
        this.bloodLeechAccum -= leech;
        this.hp = Math.min(effMaxHp, this.hp + leech);
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
    if (!enemy.dead && this.hasUnique('astral_double_strike') && Math.random() < 0.2) {
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
    if (!enemy.dead && this.hasUnique('frost_chill_aura')) {
      enemy.attackCooldown += enemy.isBoss ? 0.22 : 0.45;
      const frostDmg = Math.max(2, Math.round(dmg * 0.12));
      this.applyBonusEnemyDamage(enemy, frostDmg, `冰霜 -${frostDmg}`, 'relicBlue', 0x8be9ff);
    }

    // Unique: Cat Paw Gloves — every 3rd hit triggers rapid "喵!" bonus swat + knockback
    if (this.hasUnique('cat_paw_swat')) {
      this.catPawHitCounter += 1;
      if (!enemy.dead && this.catPawHitCounter % 3 === 0) {
        const pawDmg = Math.max(4, Math.round(dmg * 0.35));
        enemy.vx += nx * (enemy.isBoss ? 1.6 : 6.2);
        enemy.vz += nz * (enemy.isBoss ? 1.6 : 6.2);
        this.applyBonusEnemyDamage(enemy, pawDmg, `喵! -${pawDmg}`, 'relicOrange', 0xff9ad5);
      }
    }

    // Unique: Dungeon Disco Ball — rainbow sparks on crit + 20% bonus tip coin
    if (isCrit && this.hasUnique('disco_fever_aura')) {
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
    if (isCrit && this.hasUnique('ember_crit_nova')) {
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
    if (hit.isEmpowered && !hit.state.triggeredStorm && this.hasUnique('storm_cleave_lightning')) {
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
    if (this.hasSet4pc('dragonfire')) {
      const fireDmg = Math.max(2, Math.round(dmg * 0.14));
      for (const other of this.enemies) {
        if (other.dead || other.id === enemy.id) continue;
        if (Math.hypot(other.x - enemy.x, other.z - enemy.z) <= 2.4) {
          this.applyBonusEnemyDamage(other, fireDmg, `龍炎 -${fireDmg}`, 'relicOrange', 0xff5a1f);
        }
      }
    }

    // 4pc Green Set: Voidstalker — crit resets dash & fires 3 void blades
    if (isCrit && this.hasSet4pc('voidstalker')) {
      this.dashCooldown = 0;
      const bladeDmg = Math.max(3, Math.round(dmg * 0.18));
      let hits = 0;
      for (const other of this.enemies) {
        if (other.dead || hits >= 3) continue;
        if (Math.hypot(other.x - this.heroX, other.z - this.heroZ) <= 6.2) {
          hits += 1;
          this.applyBonusEnemyDamage(other, bladeDmg, `虛空刃 -${bladeDmg}`, 'info', 0xb46bff);
        }
      }
    }

    // 4pc Green Set: Gilded Syndicate — 20% Golden Smite bonus damage + gold pop
    if (!enemy.dead && this.hasSet4pc('syndicate') && Math.random() < 0.2) {
      const smiteDmg = Math.max(4, Math.round(dmg * 0.18));
      this.applyBonusEnemyDamage(enemy, smiteDmg, `重金轟擊 -${smiteDmg}`, 'gold', 0xffd84a);
      this.spawnLoot(
        enemy.x + (Math.random() - 0.5) * 0.6,
        enemy.z + (Math.random() - 0.5) * 0.6,
        'gold'
      );
    }
  }

  private performPommelStrike(): void {
    if (this.isDead || this.pommelCooldown > 0) return;
    if (this.isMage()) {
      this.performFrostNova();
      return;
    }

    this.pommelCooldown = this.pommelMaxCooldown;
    this.pommelAnim = 0.34;
    this.attackAnim = 0;
    this.attackCooldown = Math.max(this.attackCooldown, 0.28);

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
    outerRing.position.set(this.heroX, 0.22, this.heroZ);
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
    innerRing.position.set(this.heroX, 0.26, this.heroZ);
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
        this.heroX + Math.cos(a) * 0.45,
        0.35,
        this.heroZ + Math.sin(a) * 0.45,
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
    const effMaxHp = this.getEffectiveMaxHp();
    const avariceBonus = this.hasUnique('avarice_gold_atk')
      ? Math.min(0.4, Math.floor(this.gold / 100) * 0.01)
      : 0;
    const titanFuryBonus =
      this.hasUnique('titan_low_hp_fury') && this.hp / Math.max(1, effMaxHp) < 0.4 ? 0.18 : 0;
    const berserkerBonus = this.hasUnique('berserker_combo_ramp')
      ? Math.min(0.25, this.floorKills * 0.01)
      : 0;
    const atkMult =
      1 +
      this.atkUpgrades * 0.1 +
      this.relicStats.atkPct / 100 +
      avariceBonus +
      titanFuryBonus +
      berserkerBonus;
    const critChance = Math.min(
      0.95,
      0.11 + this.critUpgrades * 0.02 + this.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.relicStats.critDmgPct / 100;
    const knockMult = 1 + this.relicStats.dramaticKnockback / 100;

    let landedHit = false;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - this.heroX;
      const dz = enemy.z - this.heroZ;
      const dist = Math.hypot(dx, dz);
      const effectiveReach = reach + (enemy.isBoss ? 0.5 : enemy.isElite ? 0.18 : 0);
      if (dist > effectiveReach) continue;

      // 50% of normal attack damage
      const normalBase = 11 + Math.floor(Math.random() * 6);
      const isCrit = Math.random() < critChance;
      let mult = atkMult * 0.5 * (isCrit ? critMult : 1);
      if (enemy.isBoss || enemy.isElite) {
        mult *= 1 + this.relicStats.eliteBossDmgPct / 100;
      }
      if (this.hasUnique('executioner_finisher') && enemy.hp / Math.max(1, enemy.maxHp) < 0.3) {
        mult *= enemy.isBoss ? 1.25 : 1.5;
      }

      const dmg = Math.max(1, Math.round(normalBase * mult));
      this.totalDamageDealt += dmg;
      if (isCrit) this.critCount += 1;
      this.aiLastCombatDamageTime = this.elapsed;

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
      const nx = dist > 0.01 ? dx / dist : Math.sin(this.heroFacing);
      const nz = dist > 0.01 ? dz / dist : Math.cos(this.heroFacing);
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
      if (Math.hypot(br.x - this.heroX, br.z - this.heroZ) <= reach) {
        this.breakProp(br);
        landedHit = true;
      }
    }

    if (landedHit) {
      this.hitStopTimer = 0.04;
    }
    this.emitHud();
  }

  // =========================================================================
  // FROST MAGE — combat core
  // =========================================================================

  /** Attack multiplier from upgrades, relics and conditional uniques (shared by both classes). */
  private getHeroAtkMult(): number {
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

  /** Rough collision radius of an enemy body for projectile / AoE checks. */
  private getEnemyHitRadius(e: EnemyEntity): number {
    if (e.isBoss) return 1.0;
    if (isGuardianEnemy(e.kind) || e.isElite) return 0.55;
    if (isSwarmEnemy(e.kind)) return 0.3;
    return 0.42;
  }

  /** Visual scale for the frozen-ice shell per enemy size. */
  private getFrozenShellScale(e: EnemyEntity): number {
    if (e.isBoss) return 2.2;
    if (isGuardianEnemy(e.kind)) return 1.35;
    if (e.isElite) return 1.3;
    if (isSwarmEnemy(e.kind)) return 0.75;
    return 1.05;
  }

  private applySlow(e: EnemyEntity): void {
    if (e.dead) return;
    const factor = e.isBoss ? FROST_MAGE.bossSlowFactor : e.isElite ? FROST_MAGE.eliteSlowFactor : 1;
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
  }

  private applyFreeze(e: EnemyEntity, duration: number): void {
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
  }

  /** Rotates the hero to face the nearest valid enemy. Returns true if a target was found. */
  private autoFaceNearestEnemy(): boolean {
    const mage = this.isMage();
    const range = mage ? FROST_MAGE.projectileRange : 3.2;
    let best: EnemyEntity | null = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - this.heroX, e.z - this.heroZ);
      if (d > range + this.getEnemyHitRadius(e) || d >= bestDist) continue;
      if (
        mage &&
        !hasLineOfSight(this.dungeon, this.heroX, this.heroZ, e.x, e.z, this.doorUnlocked, 0.2)
      ) {
        continue;
      }
      best = e;
      bestDist = d;
    }
    if (!best) return false;
    this.heroFacing = Math.atan2(best.x - this.heroX, best.z - this.heroZ);
    this.heroRig.body.rotation.y = this.heroFacing;
    return true;
  }

  /** Projects a screen point onto the ground plane (y = 0.85, ice spike height). */
  private screenToGround(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.camera || !this.renderer) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.85);
    const hitPoint = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hitPoint)) return null;
    return { x: hitPoint.x, z: hitPoint.z };
  }

  /** Frost Mage basic attack: fires one ice spike along heroFacing (3-shot cycle, never resets). */
  private performMageAttack(): void {
    if (this.attackCooldown > 0) return;
    const shotIdx = this.mageShotIndex;
    const empowered = shotIdx === 2;
    this.mageShotIndex = (this.mageShotIndex + 1) % 3;
    this.attackCooldown = FROST_MAGE.shotCooldown[shotIdx];
    this.attackAnim = empowered ? 0.3 : 0.22;
    this.audio.playIceCast(empowered);

    const dirX = Math.sin(this.heroFacing);
    const dirZ = Math.cos(this.heroFacing);
    this.spawnIceSpike(this.heroX + dirX * 0.55, this.heroZ + dirZ * 0.55, dirX, dirZ, shotIdx);

    // Muzzle frost sparkle at the staff tip
    for (let i = 0; i < (empowered ? 10 : 5); i++) {
      this.spawnParticle(
        this.heroX + dirX * 0.7,
        1.05,
        this.heroZ + dirZ * 0.7,
        dirX * 2 + (Math.random() - 0.5) * 1.6,
        0.6 + Math.random(),
        dirZ * 2 + (Math.random() - 0.5) * 1.6,
        i % 2 === 0 ? 0xbff4ff : empowered ? 0xffe066 : 0x7fdcff,
        0.8,
        0.28,
        1.5
      );
    }
  }

  private spawnIceSpike(x: number, z: number, dirX: number, dirZ: number, shotIdx: number): void {
    const empowered = shotIdx === 2;
    const mesh = createIceSpikeMesh(empowered);
    mesh.position.set(x, 0.85, z);
    mesh.rotation.y = Math.atan2(dirX, dirZ);
    this.dynamicGroup.add(mesh);
    this.heroProjectiles.push({
      mesh,
      x,
      z,
      vx: dirX * FROST_MAGE.projectileSpeed,
      vz: dirZ * FROST_MAGE.projectileSpeed,
      traveled: 0,
      shotIdx,
    });
  }

  private removeHeroProjectileAt(idx: number): void {
    const p = this.heroProjectiles[idx];
    this.dynamicGroup.remove(p.mesh);
    p.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.heroProjectiles.splice(idx, 1);
  }

  private isPointInWall(x: number, z: number): boolean {
    const g = worldToGrid(x, z);
    return !isTileWalkable(this.dungeon, g.gx, g.gz, this.doorUnlocked);
  }

  private updateHeroProjectiles(dt: number): void {
    for (let i = this.heroProjectiles.length - 1; i >= 0; i--) {
      const p = this.heroProjectiles[i];
      const speed = Math.hypot(p.vx, p.vz);
      // Sub-step so fast spikes never tunnel through thin enemies or wall corners
      const steps = Math.max(1, Math.ceil((speed * dt) / 0.3));
      const sdt = dt / steps;
      let exploded = false;
      for (let s = 0; s < steps && !exploded; s++) {
        const nx = p.x + p.vx * sdt;
        const nz = p.z + p.vz * sdt;
        if (this.isPointInWall(nx, nz)) {
          this.explodeIceSpike(p.x, p.z, p.shotIdx);
          exploded = true;
          break;
        }
        p.x = nx;
        p.z = nz;
        p.traveled += speed * sdt;

        for (const e of this.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - p.x, e.z - p.z) <= FROST_MAGE.projectileHitRadius + this.getEnemyHitRadius(e)) {
            this.explodeIceSpike(p.x, p.z, p.shotIdx);
            exploded = true;
            break;
          }
        }
        if (exploded) break;
        for (const br of this.breakables) {
          if (br.broken) continue;
          if (Math.hypot(br.x - p.x, br.z - p.z) <= 0.6) {
            this.explodeIceSpike(p.x, p.z, p.shotIdx);
            exploded = true;
            break;
          }
        }
        if (!exploded && p.traveled >= FROST_MAGE.projectileRange) {
          this.explodeIceSpike(p.x, p.z, p.shotIdx);
          exploded = true;
        }
      }
      if (exploded) {
        this.removeHeroProjectileAt(i);
        continue;
      }
      p.mesh.position.set(p.x, 0.85, p.z);
      p.mesh.rotation.z += dt * (p.shotIdx === 2 ? 9 : 5);
      if (Math.random() < (p.shotIdx === 2 ? 0.9 : 0.5)) {
        this.spawnParticle(
          p.x,
          0.85,
          p.z,
          (Math.random() - 0.5) * 0.4,
          0.2 + Math.random() * 0.4,
          (Math.random() - 0.5) * 0.4,
          p.shotIdx === 2 && Math.random() < 0.3 ? 0xffe066 : 0xbff4ff,
          0.6,
          0.24,
          0
        );
      }
    }
  }

  private explodeIceSpike(x: number, z: number, shotIdx: number): void {
    const empowered = shotIdx === 2;
    const radius = FROST_MAGE.shotExplosionRadius[shotIdx];
    this.audio.playIceShatter(empowered);

    // Expanding frost ring on the floor
    const ringMat = new THREE.MeshBasicMaterial({
      color: empowered ? 0xbff4ff : 0x8fe3ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 28), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.2, z);
    this.scene.add(ring);
    this.slashArcs.push({
      mesh: ring,
      life: 0,
      maxLife: empowered ? 0.3 : 0.2,
      isCleave: false,
      isShockwave: true,
      targetScale: radius / 0.62,
    });
    for (let i = 0; i < (empowered ? 18 : 9); i++) {
      const a = (i / (empowered ? 18 : 9)) * Math.PI * 2;
      const spd = (empowered ? 4.2 : 2.6) + Math.random() * 1.6;
      this.spawnParticle(
        x,
        0.75,
        z,
        Math.cos(a) * spd,
        1.4 + Math.random() * 1.8,
        Math.sin(a) * spd,
        i % 3 === 0 ? 0xffffff : empowered && i % 4 === 1 ? 0xffe066 : 0x9fe8ff,
        empowered ? 1.0 : 0.8,
        0.4,
        6.5
      );
    }

    const atkMult = this.getHeroAtkMult();
    const usePhantomCrit = this.phantomCritTimer > 0;
    const hitState = { consumedPhantom: false, triggeredStorm: false };
    const critChance = Math.min(
      0.95,
      FROST_MAGE.shotBaseCrit[shotIdx] + this.critUpgrades * 0.02 + this.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.relicStats.critDmgPct / 100 + (usePhantomCrit ? 0.25 : 0);
    const knockMult = 1 + this.relicStats.dramaticKnockback / 100;
    const effMaxHp = this.getEffectiveMaxHp();
    let landedHit = false;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const d = Math.hypot(enemy.x - x, enemy.z - z);
      if (d > radius + this.getEnemyHitRadius(enemy)) continue;
      const warriorBase = 11 + Math.floor(Math.random() * 6);
      this.applyHeroHit(enemy, {
        baseDmg: Math.max(1, Math.round(warriorBase * FROST_MAGE.shotDamageMult[shotIdx])),
        isEmpowered: empowered,
        atkMult,
        critChance,
        critMult,
        knockMult,
        knockBase: empowered ? 3.6 : 1.8,
        originX: x,
        originZ: z,
        fallbackX: Math.sin(this.heroFacing),
        fallbackZ: Math.cos(this.heroFacing),
        usePhantomCrit,
        effMaxHp,
        state: hitState,
        hitColor: 0xbff4ff,
        isMageHit: true,
      });
      landedHit = true;
      if (!enemy.dead && Math.random() < FROST_MAGE.shotSlowChance[shotIdx]) {
        this.applySlow(enemy);
      }
    }
    if (hitState.consumedPhantom) this.phantomCritTimer = 0;

    for (const br of this.breakables) {
      if (br.broken) continue;
      if (Math.hypot(br.x - x, br.z - z) <= radius + 0.35) {
        this.breakProp(br);
        landedHit = true;
      }
    }

    if (landedHit) {
      this.hitStopTimer = Math.max(this.hitStopTimer, empowered ? 0.045 : 0.02);
      this.addScreenShake(empowered ? 0.2 : 0.08, 0.1);
    }
  }

  /** Frost Mage right-click: screen-wide expanding ice nova — freeze, damage, push. */
  private performFrostNova(): void {
    if (this.isDead || this.pommelCooldown > 0) return;
    this.pommelCooldown = this.pommelMaxCooldown;
    this.attackAnim = 0.34;
    this.attackCooldown = Math.max(this.attackCooldown, 0.3);
    this.audio.playFrostNova();
    this.addScreenShake(0.32, 0.28);

    const rings: Array<[number, number, number, number]> = [
      // [inner, outer, maxLife, color]
      [0.42, 0.7, 0.55, 0xbff4ff],
      [0.2, 0.42, 0.42, 0xffffff],
      [0.55, 0.62, 0.65, 0xffe066],
    ];
    for (const [inner, outer, life, color] of rings) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(this.heroX, 0.24, this.heroZ);
      this.scene.add(mesh);
      this.slashArcs.push({
        mesh,
        life: 0,
        maxLife: life,
        isCleave: false,
        isShockwave: true,
        targetScale: FROST_MAGE.novaRadius / outer,
      });
    }
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const spd = 8 + Math.random() * 6;
      this.spawnParticle(
        this.heroX + Math.cos(a) * 0.5,
        0.4 + Math.random() * 0.6,
        this.heroZ + Math.sin(a) * 0.5,
        Math.cos(a) * spd,
        0.8 + Math.random() * 1.6,
        Math.sin(a) * spd,
        i % 5 === 0 ? 0xffe066 : i % 2 === 0 ? 0xffffff : 0x9fe8ff,
        1.1,
        0.7,
        1.0
      );
    }

    const atkMult = this.getHeroAtkMult();
    const critChance = Math.min(0.95, 0.08 + this.critUpgrades * 0.02 + this.relicStats.critPct / 100);
    const critMult = 1.35 + this.relicStats.critDmgPct / 100;
    const knockMult = 1 + this.relicStats.dramaticKnockback / 100;
    let landedHit = false;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - this.heroX;
      const dz = enemy.z - this.heroZ;
      const dist = Math.hypot(dx, dz);
      if (dist > FROST_MAGE.novaRadius + this.getEnemyHitRadius(enemy)) continue;

      const base = (11 + Math.floor(Math.random() * 6)) * FROST_MAGE.novaDamageMult;
      const isCrit = Math.random() < critChance;
      let mult = atkMult * (isCrit ? critMult : 1);
      if (enemy.isBoss || enemy.isElite) mult *= 1 + this.relicStats.eliteBossDmgPct / 100;
      if (this.hasUnique('executioner_finisher') && enemy.hp / Math.max(1, enemy.maxHp) < 0.3) {
        mult *= enemy.isBoss ? 1.25 : 1.5;
      }
      const dmg = Math.max(1, Math.round(base * mult));
      this.totalDamageDealt += dmg;
      if (isCrit) this.critCount += 1;
      this.aiLastCombatDamageTime = this.elapsed;
      enemy.hp -= dmg;
      enemy.hitFlash = 0.18;

      if (!enemy.isBoss) {
        const nx = dist > 0.01 ? dx / dist : Math.sin(this.heroFacing);
        const nz = dist > 0.01 ? dz / dist : Math.cos(this.heroFacing);
        const knock = FROST_MAGE.novaKnockback * knockMult * (enemy.isElite ? 0.45 : 1);
        enemy.vx += nx * knock;
        enemy.vz += nz * knock;
      }
      this.applyFreeze(enemy, FROST_MAGE.novaFreeze);
      this.emitFloatingText(
        enemy.x,
        enemy.isBoss ? 2.45 : enemy.isElite ? 2.15 : 1.65,
        enemy.z,
        isCrit ? `冰封 CRIT -${dmg}` : `冰封 -${dmg}`,
        isCrit ? 'crit' : 'frost'
      );
      for (let i = 0; i < 6; i++) {
        this.spawnParticle(
          enemy.x,
          enemy.isBoss ? 1.3 : 0.85,
          enemy.z,
          (Math.random() - 0.5) * 3.6,
          1.4 + Math.random() * 1.8,
          (Math.random() - 0.5) * 3.6,
          i % 2 === 0 ? 0xbff4ff : 0xffffff,
          0.9,
          0.4,
          6
        );
      }
      landedHit = true;
      if (enemy.hp <= 0) this.killEnemy(enemy);
    }

    for (const br of this.breakables) {
      if (br.broken) continue;
      if (Math.hypot(br.x - this.heroX, br.z - this.heroZ) <= FROST_MAGE.novaRadius) {
        this.breakProp(br);
      }
    }
    if (landedHit) this.hitStopTimer = 0.05;
    this.emitHud();
  }

  /** Phoenix Plume fire ring at a point (shared by Dash and Blink). */
  private triggerPhoenixRingAt(x: number, z: number): void {
    const fireDmg = Math.max(8, Math.round(14 * (1 + this.atkUpgrades * 0.1 + this.relicStats.atkPct / 100)));
    for (const e of this.enemies) {
      if (e.dead) continue;
      const edx = e.x - x;
      const edz = e.z - z;
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
        x + Math.cos(a) * 0.35,
        0.55,
        z + Math.sin(a) * 0.35,
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

  /** Frost Mage mobility: instant short teleport along the move direction (or facing). */
  private performBlink(): void {
    if (this.dashCooldown > 0 || this.dashTimer > 0) return;
    let dirX = this.lastMoveX;
    let dirZ = this.lastMoveZ;
    if (Math.hypot(dirX, dirZ) < 0.1) {
      dirX = Math.sin(this.heroFacing);
      dirZ = Math.cos(this.heroFacing);
    }
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len;
    dirZ /= len;

    const startX = this.heroX;
    const startZ = this.heroZ;
    let endX = startX;
    let endZ = startZ;
    const stepLen = 0.2;
    for (let d = stepLen; d <= FROST_MAGE.blinkDistance + 1e-6; d += stepLen) {
      const tx = startX + dirX * d;
      const tz = startZ + dirZ * d;
      if (!this.canMoveTo(tx, tz, 0.4)) break; // stop in front of walls (enemies don't block)
      endX = tx;
      endZ = tz;
    }

    this.dashCooldown = Math.max(0.35, 1.1 * (1 - this.relicStats.dashCdPct / 100));
    this.heroInvuln = Math.max(this.heroInvuln, 0.28);
    if (this.hasUnique('phantom_dash_crit')) this.phantomCritTimer = 2.0;
    this.audio.playBlink();

    const burst = (bx: number, bz: number, outward: boolean) => {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const spd = outward ? 2.6 : -1.2;
        this.spawnParticle(
          bx + Math.cos(a) * 0.3,
          0.3 + Math.random() * 1.0,
          bz + Math.sin(a) * 0.3,
          Math.cos(a) * spd,
          0.8 + Math.random() * 1.2,
          Math.sin(a) * spd,
          i % 4 === 0 ? 0xffe066 : i % 2 === 0 ? 0xffffff : 0x9fe8ff,
          1.0,
          0.42,
          -0.4
        );
      }
    };
    burst(startX, startZ, false);
    if (this.hasUnique('phoenix_dash_nova')) this.triggerPhoenixRingAt(startX, startZ);

    this.heroX = endX;
    this.heroZ = endZ;
    this.heroVx = 0;
    this.heroVz = 0;
    this.heroFacing = Math.atan2(dirX, dirZ);
    this.heroRig.root.position.set(this.heroX, 0, this.heroZ);
    burst(endX, endZ, true);
    if (this.hasUnique('phoenix_dash_nova')) this.triggerPhoenixRingAt(endX, endZ);
    this.emitHud();
  }

  /** Frost Mage shield regeneration tick. */
  private updateShield(dt: number): void {
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

  private breakProp(br: BreakableEntity): void {
    br.broken = true;
    br.mesh.visible = false;
    this.audio.playCrateBreak();

    if (this.relicStats.crateDmgPct > 0) {
      const megaDmg = Math.round(15 * (1 + this.relicStats.crateDmgPct / 100));
      this.emitFloatingText(br.x, 1.35, br.z, `木箱粉碎 -${megaDmg}!`, 'crit');
    }
    if (this.hasUnique('noodle_elixir_boost') && Math.random() < 0.28) {
      this.emitFloatingText(br.x, 1.75, br.z, '真香！泡麵魂!', 'relicOrange');
    }

    const color =
      this.dungeon.biome.terrainTheme === 'alien'
        ? 0x70d8ff
        : br.kind === 'crate'
        ? 0x7c502d
        : 0xb38252;
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

    // Loot chance from crates/urns (boosted by Drop Rate)
    const dropMult = 1 + this.relicStats.dropRatePct / 100;
    if (Math.random() < 0.72) {
      const potChance = Math.min(0.45, 0.13 * dropMult);
      this.spawnLoot(br.x, br.z, Math.random() < potChance ? 'potion' : 'gold');
    }
    if (this.hasUnique('starforged_treasure_sense') && Math.random() < 0.25) {
      this.spawnLoot(br.x + (Math.random() - 0.5) * 0.45, br.z + (Math.random() - 0.5) * 0.45, 'gold');
    }
    this.spawnRelicDrops(br.x, br.z, 'crate');
  }

  private killEnemy(enemy: EnemyEntity): void {
    enemy.dead = true;
    enemy.rig.root.visible = false;
    if (enemy.telegraph) {
      enemy.telegraph.group.visible = false;
    }
    this.kills += 1;
    this.floorKills += 1;
    if (enemy.isBoss) {
      this.bossKills += 1;
    } else if (enemy.isElite) {
      this.eliteKills += 1;
    } else {
      this.normalKills += 1;
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
        'Treasure Hoard Dropped!'
      );

      // Boss Treasure Hoard: 12 high-value bouncing gold coins scaled +6.5%/floor + Healing Elixir + Guaranteed Boss Relics
      const goldScale = this.getDepthGoldScale();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
        const r = 0.35 + Math.random() * 1.05;
        const baseBossCoin = 10 + Math.floor(Math.random() * 5);
        this.spawnLoot(
          enemy.x + Math.cos(a) * r,
          enemy.z + Math.sin(a) * r,
          'gold',
          Math.max(10, Math.round(baseBossCoin * goldScale))
        );
      }
      this.spawnLoot(enemy.x, enemy.z, 'potion');
      this.spawnRelicDrops(enemy.x, enemy.z, 'boss');
      if (this.relicStats.lifeOnKill > 0) {
        const effMax = this.getEffectiveMaxHp();
        this.hp = Math.min(effMax, this.hp + this.relicStats.lifeOnKill);
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
          ? `★ ${enemy.customName} 討伐 · 掉落×1.2`
          : 'ELITE SLAIN · 3x LOOT',
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
    if (this.relicStats.lifeOnKill > 0 && !this.isDead) {
      const effMax = this.getEffectiveMaxHp();
      if (this.hp < effMax) {
        this.hp = Math.min(effMax, this.hp + this.relicStats.lifeOnKill);
      }
    }
    if (
      this.relicStats.politeness > 0 &&
      Math.random() < Math.min(0.45, this.relicStats.politeness / 170)
    ) {
      const lines = ['大哥太強了…', '甘拜下風！', '這什麼神裝！？', '英雄饒命啊…', '好痛好帥！'];
      const msg = lines[Math.floor(Math.random() * lines.length)];
      this.emitFloatingText(enemy.x, 1.9, enemy.z, msg, 'info');
    }

    const isSwarm = isSwarmEnemy(enemy.kind);
    const specialDropMult = enemy.isSpecialElite ? 1.2 : 1;
    const extraCoins =
      (this.hasSet4pc('syndicate') ? 1 : 0) +
      (this.hasUnique('frying_pan_bonk') && Math.random() < 0.15 ? 1 : 0) +
      (enemy.isElite && this.hasUnique('starforged_treasure_sense') && Math.random() < 0.25 ? 2 : 0);
    const rawCoinDrops =
      ((isGuardianEnemy(enemy.kind) ? 3 : enemy.isElite ? 3 : isSwarm ? 0.65 : 1) + extraCoins) *
      specialDropMult;
    const coinDrops =
      Math.floor(rawCoinDrops) + (Math.random() < rawCoinDrops - Math.floor(rawCoinDrops) ? 1 : 0);
    for (let i = 0; i < coinDrops; i++) {
      this.spawnLoot(
        enemy.x + (Math.random() - 0.5) * (enemy.isElite ? 0.85 : 0.5),
        enemy.z + (Math.random() - 0.5) * (enemy.isElite ? 0.85 : 0.5),
        'gold'
      );
    }
    const dropMult = 1 + this.relicStats.dropRatePct / 100;
    const basePotionChance = isGuardianEnemy(enemy.kind)
      ? 0.5
      : enemy.isElite
      ? 0.36
      : isSwarm
      ? 0.06
      : 0.12;
    if (Math.random() < Math.min(0.95, basePotionChance * dropMult * specialDropMult)) {
      this.spawnLoot(enemy.x, enemy.z, 'potion');
    }

    // Relic drop rolls (Elites guaranteed >= 1, Special Named Elites scale drop rate x1.2, Swarms x0.5 per critter)
    this.spawnRelicDrops(
      enemy.x,
      enemy.z,
      enemy.isElite ? 'elite' : 'mob',
      specialDropMult * (isSwarm && !enemy.isElite ? 0.5 : 1)
    );

    this.emitHud();
  }

  private spawnRelicDrops(
    x: number,
    z: number,
    source: RelicDropSource,
    extraDropMult = 1
  ): void {
    const dropped = rollRelicDrops(
      this.depth,
      source,
      this.relicStats.dropRatePct,
      () => this.nextId++,
      extraDropMult
    );
    // Base angle points away from the hero so dropped relics pop outward instead of instantly landing on the player
    const awayAngle = Math.atan2(z - this.heroZ, x - this.heroX);
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
  }

  private spawnRelicLoot(
    x: number,
    z: number,
    relic: RelicItem,
    vx = 0,
    vz = 0
  ): void {
    const relicRig = createRelicLootMesh(relic.rarity, this.textures?.glowMap);
    relicRig.root.position.set(x, 0, z);
    this.dynamicGroup.add(relicRig.root);

    const isHighTier = relic.rarity === 'orange' || relic.rarity === 'green';

    this.loots.push({
      id: this.nextId++,
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
  }

  private spawnLoot(x: number, z: number, type: 'gold' | 'potion', customValue?: number): void {
    const mesh = createLootMesh(type);
    mesh.position.set(x, 0.3, z);
    this.dynamicGroup.add(mesh);
    const defaultGold = Math.max(
      1,
      Math.round((3 + Math.floor(Math.random() * 5)) * this.getDepthGoldScale())
    );
    this.loots.push({
      id: this.nextId++,
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
  }

  private getEnemyBaseLabel(kind: EnemyKind): string {
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
  }

  private getEnemyLabel(e: EnemyEntity): string {
    if (e.isBoss) return e.bossName ?? '地城頭目';
    if (e.customName) return e.customName;
    const base = this.getEnemyBaseLabel(e.kind);
    return e.isElite ? `菁英 ${base}` : base;
  }

  private buildRunSummary(): RunSummary {
    return {
      heroClass: this.heroClass,
      depth: this.depth,
      biomeName: this.dungeon.biome.name,
      durationSec: Math.max(1, Math.floor(this.runElapsedSec)),
      totalGoldEarned: this.totalGoldEarned,
      goldRemaining: this.gold,
      totalKills: this.kills,
      normalKills: this.normalKills,
      eliteKills: this.eliteKills,
      bossKills: this.bossKills,
      upgradeLevel: this.getTotalUpgradeLevel(),
      // For the Frost Mage, "hpUpgrades" reports HP+shield upgrades and "armorUpgrades" reports shield-speed upgrades
      hpUpgrades: this.isMage() ? this.hpShieldUpgrades : this.hpUpgrades,
      atkUpgrades: this.atkUpgrades,
      armorUpgrades: this.isMage() ? this.shieldSpeedUpgrades : this.armorUpgrades,
      critUpgrades: this.critUpgrades,
      maxHp: this.maxHp,
      atkBonusPct: this.atkUpgrades * 10,
      armorBonusPct: this.armorUpgrades * 10,
      critBonusPct: this.critUpgrades * 2,
      potionsUsed: this.potionsUsed,
      potionsLeft: this.potions,
      totalDamageDealt: this.totalDamageDealt,
      critCount: this.critCount,
      slainBy: this.slainBy,
    };
  }

  private damageHero(
    amount: number,
    sourceX: number,
    sourceZ: number,
    sourceLabel = '地城怪物',
    attacker?: EnemyEntity
  ): void {
    if (this.isDead || this.heroInvuln > 0 || this.transitionState !== 'none') return;

    const isSwarmHit = Boolean(attacker && isSwarmEnemy(attacker.kind));
    const effMaxHp = this.getEffectiveMaxHp();

    // Relic Block Chance: completely negate incoming damage
    if (this.relicStats.blockPct > 0 && Math.random() * 100 < this.relicStats.blockPct) {
      const hasPan = this.hasUnique('frying_pan_bonk');
      this.heroInvuln = isSwarmHit ? 0.14 : 0.38;
      this.audio.playBlock(hasPan);
      this.emitFloatingText(
        this.heroX,
        1.9,
        this.heroZ,
        hasPan ? '噹！神聖格擋!' : 'BLOCK!',
        'block'
      );
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.spawnParticle(
          this.heroX,
          0.95,
          this.heroZ,
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
      if (this.hasUnique('aegis_block_counter')) {
        this.hp = Math.min(effMaxHp, this.hp + 3);
        this.emitFloatingText(this.heroX, 2.25, this.heroZ, '+3 HP 聖盾反震', 'heal');
        for (const e of this.enemies) {
          if (e.dead) continue;
          const edx = e.x - this.heroX;
          const edz = e.z - this.heroZ;
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
        this.spawnLoot(this.heroX + (Math.random() - 0.5) * 0.6, this.heroZ + (Math.random() - 0.5) * 0.6, 'gold');
      }

      this.emitHud();
      return;
    }

    // Armor % reduction + Flat Relic Damage Reduction (always minimum 1 HP per hit)
    const defMult = Math.max(0.5, 1 - this.armorUpgrades * 0.1);
    const titanFlat =
      this.hasUnique('titan_low_hp_fury') && this.hp / Math.max(1, effMaxHp) < 0.4 ? 2 : 0;
    const alchemistFlat = this.alchemistShieldTimer > 0 ? 2 : 0;
    const flatReduce = this.relicStats.damageReduction + titanFlat + alchemistFlat;
    const actualDamage = Math.max(1, Math.round(amount * defMult) - flatReduce);

    const dx = this.heroX - sourceX;
    const dz = this.heroZ - sourceZ;
    const dist = Math.hypot(dx, dz) || 1;

    // Frost Mage: the shield absorbs damage first, HP only takes the remainder
    let shieldAbsorbed = 0;
    let hpDamage = actualDamage;
    if (this.isMage() && this.shield > 0) {
      const absorb = Math.min(this.shield, actualDamage);
      this.shield = Math.max(0, this.shield - absorb);
      hpDamage = Math.max(0, Math.round(actualDamage - absorb));
      shieldAbsorbed = actualDamage - hpDamage;
      if (this.shield <= 0) this.audio.playShieldBreak();
    }
    this.timeSinceDamaged = 0;

    this.hp = Math.max(0, this.hp - hpDamage);
    // Swarm critters use a brief invuln window so their 2/sec rapid chip bites (-1, -1, -2, -2) land cleanly
    this.heroInvuln = isSwarmHit ? 0.14 : 0.72;
    this.heroHitFlash = isSwarmHit ? 0.1 : 0.18;
    this.heroHitShieldOnly = hpDamage <= 0;
    this.audio.playPlayerHurt();
    this.addScreenShake(isSwarmHit ? 0.08 : 0.24, isSwarmHit ? 0.08 : 0.18);
    const labelJitterX = isSwarmHit ? (Math.random() - 0.5) * 0.55 : 0;
    const labelJitterZ = isSwarmHit ? (Math.random() - 0.5) * 0.55 : 0;
    const labelY = isSwarmHit ? 1.6 + Math.random() * 0.35 : 1.8;
    if (shieldAbsorbed > 0) {
      this.emitFloatingText(
        this.heroX + labelJitterX - 0.15,
        labelY + (hpDamage > 0 ? 0.3 : 0),
        this.heroZ + labelJitterZ,
        `-${shieldAbsorbed}`,
        'shieldHit'
      );
    }
    if (hpDamage > 0) {
      this.emitFloatingText(
        this.heroX + labelJitterX,
        labelY,
        this.heroZ + labelJitterZ,
        `-${hpDamage}`,
        'playerHit'
      );
    }

    // Relic Thorns: reflect fixed damage to melee attacker
    if (attacker && !attacker.dead && this.relicStats.thorns > 0) {
      this.applyBonusEnemyDamage(
        attacker,
        this.relicStats.thorns,
        `荊棘 -${this.relicStats.thorns}`,
        'info',
        0x7eff9b
      );
    }

    // Unique: Eclipse Mirror — reflect 150% of damage taken as arcane pulse to nearby enemies
    if (this.hasUnique('eclipse_reflect_beam')) {
      const refDmg = Math.max(4, Math.round(actualDamage * 1.5));
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - this.heroX, e.z - this.heroZ) <= 3.8) {
          this.applyBonusEnemyDamage(e, refDmg, `蝕月反衝 -${refDmg}`, 'info', 0xc88cff);
        }
      }
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.spawnParticle(
          this.heroX,
          0.85,
          this.heroZ,
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
    if (this.hasUnique('rubber_duck_squeak') && this.hp > 0) {
      const duckHeal = Math.random() < 0.2;
      if (duckHeal) {
        this.hp = Math.min(effMaxHp, this.hp + 2);
      }
      this.emitFloatingText(
        this.heroX,
        2.2,
        this.heroZ,
        duckHeal ? '啾！+2 HP' : '啾！',
        duckHeal ? 'heal' : 'relicYellow'
      );
      for (const e of this.enemies) {
        if (e.dead) continue;
        const edx = e.x - this.heroX;
        const edz = e.z - this.heroZ;
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
          this.heroX,
          0.95,
          this.heroZ,
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
    this.heroVx += (dx / dist) * kbForce;
    this.heroVz += (dz / dist) * kbForce;

    // Auto-heal trigger in autonomous mode if low HP
    const healThreshold = this.getAutoHealThreshold(effMaxHp);
    if (this.controlMode === 'auto' && this.hp > 0 && this.hp <= healThreshold && this.potions > 0) {
      this.usePotion();
    }

    // Unique: Shattered Chronos Hourglass — cheat death once per floor!
    if (
      this.hp <= 0 &&
      this.hasUnique('chronos_cheat_death') &&
      !this.chronosUsedThisFloor
    ) {
      this.chronosUsedThisFloor = true;
      this.hp = this.isMage()
        ? Math.max(1, Math.round(effMaxHp * 0.2))
        : Math.max(10, Math.round(effMaxHp * 0.2));
      if (this.isMage()) this.shield = this.getEffectiveMaxShield();
      this.heroInvuln = 1.65;
      this.audio.playUpgrade();
      this.addScreenShake(0.32, 0.25);
      this.pushBanner('時光砂漏觸發！', '時間凝滯 · 逆轉死亡');
      this.emitFloatingText(this.heroX, 2.2, this.heroZ, 'TIME REWIND!', 'relicOrange');
      for (const e of this.enemies) {
        if (e.dead) continue;
        const edx = e.x - this.heroX;
        const edz = e.z - this.heroZ;
        const edist = Math.hypot(edx, edz);
        if (edist < 4.5) {
          e.vx += (edx / (edist || 1)) * 10;
          e.vz += (edz / (edist || 1)) * 10;
        }
      }
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        this.spawnParticle(
          this.heroX,
          0.9,
          this.heroZ,
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

    if (this.hp <= 0) {
      this.isDead = true;
      this.slainBy = sourceLabel;
      this.heroVx = 0;
      this.heroVz = 0;
      this.dashTimer = 0;
      this.keysPressed.clear();
      this.heroRig.body.rotation.z = Math.PI * 0.46;
      this.heroRig.body.position.y = 0.22;
      for (const m of this.heroRig.flashMaterials) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
    this.emitHud();
  }

  private addScreenShake(magnitude: number, duration: number): void {
    this.shakeMag = Math.max(this.shakeMag, magnitude);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  private pushBanner(title: string, subtitle?: string): void {
    this.callbacks.onBanner({ id: this.nextId++, title, subtitle });
  }

  private emitFloatingText(
    wx: number,
    wy: number,
    wz: number,
    text: string,
    tone: FloatingLabelData['tone']
  ): void {
    if (!this.camera || !this.renderer) return;
    _projVec.set(wx, wy, wz).project(this.camera);
    if (_projVec.z > 1) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const sx = (_projVec.x * 0.5 + 0.5) * w;
    const sy = (-_projVec.y * 0.5 + 0.5) * h;
    this.callbacks.onFloatingLabel({
      id: this.nextId++,
      text,
      x: sx,
      y: sy,
      tone,
    });
  }

  private emitHud(): void {
    const activeBoss = this.enemies.find(
      (e) =>
        e.isBoss &&
        !e.dead &&
        Math.hypot(e.x - this.heroX, e.z - this.heroZ) < 15.5
    );

    this.callbacks.onHudChange({
      hp: this.hp,
      maxHp: this.getEffectiveMaxHp(),
      baseMaxHp: this.maxHp,
      maxHpCap: this.maxHpCap,
      potions: this.potions,
      hasKey: this.hasKey,
      doorUnlocked: this.doorUnlocked,
      depth: this.depth,
      biomeName: this.inTown ? '庇護小鎮' : this.dungeon.biome.name,
      gold: this.gold,
      kills: this.kills,
      atkBonusPct: this.atkUpgrades * 10,
      armorBonusPct: this.armorUpgrades * 10,
      armorMaxPct: this.maxArmorUpgrades * 10,
      critBonusPct: this.critUpgrades * 2,
      critMaxPct: this.maxCritUpgrades * 2,
      upgradeLevel: this.getTotalUpgradeLevel(),
      upgradeCost: this.getUpgradeCost(),
      potionCost: this.getPotionCost(),
      nearAltar: this.isHeroNearAltar(),
      hasAltarOnFloor: Boolean(this.dungeon.altarPos),
      nearShop: this.isHeroNearShop(),
      hasShopOnFloor: Boolean(this.dungeon.shopPos),
      inTown: this.inTown,
      nearPortal: this.isHeroNearPortal(),
      nearAngel: this.isHeroNearAngel(),
      townReturnCost: this.getTownReturnCost(),
      angelBuff: this.angelBuff ? { ...this.angelBuff } : null,
      controlMode: this.controlMode,
      soundOn: this.audio.isEnabled(),
      dashReady: this.dashCooldown <= 0,
      pommelCooldown: this.pommelCooldown,
      pommelMaxCooldown: this.pommelMaxCooldown,
      fadeOpacity: this.fadeOpacity,
      aiStatus: this.aiStatus,
      boss: activeBoss
        ? {
            name: activeBoss.bossName ?? 'DUNGEON BOSS',
            title: activeBoss.bossTitle ?? '',
            hp: Math.max(0, activeBoss.hp),
            maxHp: activeBoss.maxHp,
            state: activeBoss.bossState ?? 'chase',
          }
        : null,
      isDead: this.isDead,
      runSummary: this.isDead ? this.buildRunSummary() : null,
      equippedRelics: [...this.equippedRelics],
      relicBag: [...this.relicBag],
      relicBagCap: this.relicBagCap,
      relicStats: this.relicStats,
      activeSets: this.relicStats.activeSets,
      discoveredRelicIds: Array.from(this.discoveredRelicIds),
      heroClass: this.heroClass,
      shield: Math.round(this.shield),
      maxShield: this.getEffectiveMaxShield(),
      shieldRegenerating:
        this.isMage() &&
        this.shield < this.getEffectiveMaxShield() &&
        this.timeSinceDamaged >= this.getShieldRegenDelay(),
      skillName: HERO_CLASSES[this.heroClass].skillName,
      mobilityName: HERO_CLASSES[this.heroClass].mobilityName,
      upgradeOptions: this.getUpgradeOptions(),
    });
  }

  /** HP at or below which the auto-pilot drinks a potion. */
  private getAutoHealThreshold(effMaxHp: number): number {
    if (this.isMage()) return Math.max(4, Math.floor(effMaxHp * 0.5));
    return Math.max(20, Math.floor(effMaxHp * 0.45));
  }

  private getShieldRegenDelay(): number {
    return FROST_MAGE.shieldDelayBase * getShieldSpeedFactor(this.shieldSpeedUpgrades);
  }

  private getShieldRefillTime(): number {
    return FROST_MAGE.shieldRefillBase * getShieldSpeedFactor(this.shieldSpeedUpgrades);
  }

  private emitMinimap(): void {
    const heroG = worldToGrid(this.heroX, this.heroZ);
    this.callbacks.onMinimapUpdate({
      width: this.dungeon.width,
      height: this.dungeon.height,
      tiles: this.dungeon.tiles,
      explored: this.dungeon.explored,
      playerX: heroG.gx,
      playerZ: heroG.gz,
      keyX: this.dungeon.keyPos.gx,
      keyZ: this.dungeon.keyPos.gz,
      hasKey: this.hasKey,
      doorX: this.dungeon.doorPos.gx,
      doorZ: this.dungeon.doorPos.gz,
      doorUnlocked: this.doorUnlocked,
      stairsX: this.dungeon.stairsPos.gx,
      stairsZ: this.dungeon.stairsPos.gz,
      altarX: this.dungeon.altarPos?.gx,
      altarZ: this.dungeon.altarPos?.gz,
      shopX: this.dungeon.shopPos?.gx,
      shopZ: this.dungeon.shopPos?.gz,
      terrainTheme: this.dungeon.biome.terrainTheme,
      enemies: this.enemies
        .filter((e) => !e.dead)
        .map((e) => {
          const g = worldToGrid(e.x, e.z);
          return { x: g.gx, z: g.gz, isBoss: e.isBoss, isElite: e.isElite };
        }),
      relics: this.loots
        .filter((l) => !l.collected && l.type === 'relic' && l.relic)
        .map((l) => {
          const g = worldToGrid(l.x, l.z);
          return { x: g.gx, z: g.gz, rarity: l.relic!.rarity };
        }),
    });
  }

  private markExplored(cgx: number, cgz: number): void {
    const radius = 5;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const nx = cgx + dx;
        const nz = cgz + dz;
        if (nx >= 0 && nz >= 0 && nx < this.dungeon.width && nz < this.dungeon.height) {
          this.dungeon.explored[nz][nx] = true;
        }
      }
    }
  }

  private canMoveTo(wx: number, wz: number, radius = 0.38): boolean {
    const checks = [
      [wx - radius, wz - radius],
      [wx + radius, wz - radius],
      [wx - radius, wz + radius],
      [wx + radius, wz + radius],
    ];
    for (let i = 0; i < 4; i++) {
      const cx = checks[i][0];
      const cz = checks[i][1];
      const { gx, gz } = worldToGrid(cx, cz);
      if (gx < 0 || gz < 0 || gx >= this.dungeon.width || gz >= this.dungeon.height) {
        return false;
      }
      const t = this.dungeon.tiles[gz][gx];
      if (t === 0 || t === 2) return false;
      if (t === 3 && !this.doorUnlocked) return false;
    }

    // Smooth circular collision against nearby stone pillars (tile 5) so actors glide around pillars
    const centerG = worldToGrid(wx, wz);
    const pillarBlockDist = 0.48 + radius;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = centerG.gx + dx;
        const gz = centerG.gz + dz;
        if (this.dungeon.tiles[gz]?.[gx] === 5) {
          const px = gx * TILE_SIZE;
          const pz = gz * TILE_SIZE;
          if (Math.hypot(wx - px, wz - pz) < pillarBlockDist) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private moveWithSlide(
    x: number,
    z: number,
    dx: number,
    dz: number,
    radius = 0.38
  ): { x: number; z: number } {
    if (this.canMoveTo(x + dx, z + dz, radius)) {
      return { x: x + dx, z: z + dz };
    }

    let nx = x;
    let nz = z;
    if (this.canMoveTo(x + dx, z, radius)) {
      nx = x + dx;
    }
    if (this.canMoveTo(nx, z + dz, radius)) {
      nz = z + dz;
    }

    // If blocked head-on by a circular pillar, slide tangentially around it!
    const movedDist = Math.hypot(nx - x, nz - z);
    const wantDist = Math.hypot(dx, dz);
    if (wantDist > 0.0001 && movedDist < wantDist * 0.25) {
      const centerG = worldToGrid(x + dx, z + dz);
      for (let pzOff = -1; pzOff <= 1; pzOff++) {
        for (let pxOff = -1; pxOff <= 1; pxOff++) {
          const gx = centerG.gx + pxOff;
          const gz = centerG.gz + pzOff;
          if (this.dungeon.tiles[gz]?.[gx] === 5) {
            const px = gx * TILE_SIZE;
            const pz = gz * TILE_SIZE;
            const rx = x - px;
            const rz = z - pz;
            const rLen = Math.hypot(rx, rz) || 1;
            if (rLen < 1.35) {
              // Two tangent directions around pillar; pick the one aligned with movement
              const t1x = -rz / rLen;
              const t1z = rx / rLen;
              const dot = t1x * dx + t1z * dz;
              const sign = dot >= 0 ? 1 : -1;
              const sx = t1x * sign * wantDist * 0.9;
              const sz = t1z * sign * wantDist * 0.9;
              if (this.canMoveTo(x + sx, z + sz, radius)) {
                return { x: x + sx, z: z + sz };
              }
            }
          }
        }
      }

      // Wall-corner doorway centering nudge: if snagged on a 1-tile corridor lip, glide toward tile center
      const curG = worldToGrid(x, z);
      const centerW = gridToWorld(curG.gx, curG.gz);
      const toCx = centerW.x - x;
      const toCz = centerW.z - z;
      const toCDist = Math.hypot(toCx, toCz);
      if (toCDist > 0.08) {
        const nudgeX = (toCx / toCDist) * wantDist * 0.85;
        const nudgeZ = (toCz / toCDist) * wantDist * 0.85;
        if (this.canMoveTo(x + nudgeX, z + nudgeZ, radius)) {
          return { x: x + nudgeX, z: z + nudgeZ };
        }
        if (this.canMoveTo(x + nudgeX, z, radius)) {
          return { x: x + nudgeX, z };
        }
        if (this.canMoveTo(x, z + nudgeZ, radius)) {
          return { x, z: z + nudgeZ };
        }
      }
    }

    return { x: nx, z: nz };
  }

  private buildSafeGridPath(
    goalGx: number,
    goalGz: number
  ): Array<{ gx: number; gz: number }> {
    const start = worldToWalkableGrid(this.dungeon, this.heroX, this.heroZ, this.doorUnlocked);
    const path = findGridPath(
      this.dungeon,
      start.gx,
      start.gz,
      goalGx,
      goalGz,
      this.doorUnlocked
    );
    if (path.length > 0) {
      // If hero is off-center and straight line to path[0] clips a doorway wall corner, center on current tile first!
      const firstW = gridToWorld(path[0].gx, path[0].gz);
      const curW = gridToWorld(start.gx, start.gz);
      if (
        Math.hypot(this.heroX - curW.x, this.heroZ - curW.z) > 0.3 &&
        !hasLineOfSight(this.dungeon, this.heroX, this.heroZ, firstW.x, firstW.z, this.doorUnlocked, 0.42)
      ) {
        path.unshift({ gx: start.gx, gz: start.gz });
      }
    }
    return path;
  }

  private followGridPath(
    path: Array<{ gx: number; gz: number }>
  ): { moveX: number; moveZ: number } | null {
    while (path.length > 0) {
      const nextTile = path[0];
      const targetW = gridToWorld(nextTile.gx, nextTile.gz);
      const dx = targetW.x - this.heroX;
      const dz = targetW.z - this.heroZ;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.36) {
        path.shift();
      } else {
        return { moveX: dx / dist, moveZ: dz / dist };
      }
    }
    return null;
  }

  private nudgeHeroToClearTile(): void {
    const cur = worldToGrid(this.heroX, this.heroZ);
    const targetTile =
      this.aiPath.length > 0 && isTileWalkable(this.dungeon, this.aiPath[0].gx, this.aiPath[0].gz, this.doorUnlocked)
        ? this.aiPath[0]
        : null;

    const candidates: Array<{ gx: number; gz: number }> = [];
    if (targetTile) candidates.push(targetTile);
    candidates.push(cur);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const nx = cur.gx + dx;
      const nz = cur.gz + dz;
      if (isTileWalkable(this.dungeon, nx, nz, this.doorUnlocked)) {
        candidates.push({ gx: nx, gz: nz });
      }
    }

    for (const c of candidates) {
      const cw = gridToWorld(c.gx, c.gz);
      if (this.canMoveTo(cw.x, cw.z, 0.36)) {
        const dx = cw.x - this.heroX;
        const dz = cw.z - this.heroZ;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const step = Math.min(d, 0.55);
          this.heroX += (dx / d) * step;
          this.heroZ += (dz / d) * step;
          return;
        }
      }
    }
  }

  private tryAutoTravelDash(moveX: number, moveZ: number, distToGoal: number): void {
    if (
      this.dashCooldown > 0 ||
      this.dashTimer > 0 ||
      this.aiForcePathTimer > 0 ||
      distToGoal < 3.4
    ) {
      return;
    }

    const len = Math.hypot(moveX, moveZ);
    if (len < 0.2) return;
    const nx = moveX / len;
    const nz = moveZ / len;

    // Only dash in confirmed safe zones (no nearby enemies or active projectiles)
    for (const e of this.enemies) {
      if (!e.dead && Math.hypot(e.x - this.heroX, e.z - this.heroZ) < 9.0) {
        return;
      }
    }
    for (const p of this.projectiles) {
      if (Math.hypot(p.x - this.heroX, p.z - this.heroZ) < 8.0) {
        return;
      }
    }

    // Ensure a completely clear straight corridor ahead (dash travels ~2.16 units)
    const checkEndX = this.heroX + nx * 2.55;
    const checkEndZ = this.heroZ + nz * 2.55;
    const landX = this.heroX + nx * 2.15;
    const landZ = this.heroZ + nz * 2.15;
    if (
      !hasLineOfSight(this.dungeon, this.heroX, this.heroZ, checkEndX, checkEndZ, this.doorUnlocked, 0.44) ||
      !this.canMoveTo(landX, landZ, 0.42)
    ) {
      return;
    }

    // Avoid dashing straight onto a spike trap
    for (const sp of this.spikes) {
      if (Math.hypot(sp.x - landX, sp.z - landZ) < 1.25) {
        return;
      }
    }

    this.heroFacing = Math.atan2(nx, nz);
    this.performDash();
  }

  private getPathDashDirection(
    path: Array<{ gx: number; gz: number }>,
    fallback: { moveX: number; moveZ: number }
  ): { moveX: number; moveZ: number; distToGoal: number } {
    if (path.length === 0) {
      return { moveX: fallback.moveX, moveZ: fallback.moveZ, distToGoal: 0 };
    }
    const endW = gridToWorld(path[path.length - 1].gx, path[path.length - 1].gz);
    const distToGoal = Math.hypot(endW.x - this.heroX, endW.z - this.heroZ);

    // Look up to 3 tiles ahead along the A* path for a clean straight dash vector
    const maxLook = Math.min(path.length - 1, 2);
    for (let i = maxLook; i >= 0; i--) {
      const tw = gridToWorld(path[i].gx, path[i].gz);
      const dx = tw.x - this.heroX;
      const dz = tw.z - this.heroZ;
      const d = Math.hypot(dx, dz);
      if (
        d > 1.2 &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, tw.x, tw.z, this.doorUnlocked, 0.44)
      ) {
        return { moveX: dx / d, moveZ: dz / d, distToGoal };
      }
    }
    return { moveX: fallback.moveX, moveZ: fallback.moveZ, distToGoal };
  }

  private triggerStuckRecovery(emergencyWarp: boolean): void {
    this.aiStrafeSign *= -1;
    this.aiPath = [];
    this.aiCombatPath = [];
    this.aiRepathTimer = 0;
    this.aiCombatRepathTimer = 0;
    this.aiForcePathTimer = 2.0;

    if (this.aiCurrentTargetId !== null && this.aiUnstuckAttempts >= 1) {
      // Temporarily ignore a deadlocked target while repositioning around obstacles
      this.aiSkipEnemyUntil.set(this.aiCurrentTargetId, this.elapsed + 4.5);
    }

    const heroG = worldToWalkableGrid(this.dungeon, this.heroX, this.heroZ, this.doorUnlocked);

    // Collect verified open escape tiles (room centers + nearby clear tiles 2-4 tiles away)
    const escapeCandidates: Array<{ gx: number; gz: number; score: number }> = [];
    for (const r of this.dungeon.rooms) {
      if (r.role === 'exit' && !this.doorUnlocked) continue;
      if (!isTileWalkable(this.dungeon, r.cx, r.cz, this.doorUnlocked)) continue;
      const rw = gridToWorld(r.cx, r.cz);
      const d = Math.hypot(rw.x - this.heroX, rw.z - this.heroZ);
      if (d > 1.8 && d < 18 && this.canMoveTo(rw.x, rw.z, 0.44)) {
        escapeCandidates.push({ gx: r.cx, gz: r.cz, score: Math.abs(d - 5.0) });
      }
    }
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const manhattan = Math.abs(dx) + Math.abs(dz);
        if (manhattan < 2 || manhattan > 5) continue;
        const nx = heroG.gx + dx;
        const nz = heroG.gz + dz;
        if (!isTileWalkable(this.dungeon, nx, nz, this.doorUnlocked)) continue;
        if (this.dungeon.tiles[nz]?.[nx] === 6) continue; // skip spike traps
        const nw = gridToWorld(nx, nz);
        if (!this.canMoveTo(nw.x, nw.z, 0.44)) continue;
        escapeCandidates.push({ gx: nx, gz: nz, score: Math.abs(manhattan - 3) + 2.5 });
      }
    }
    escapeCandidates.sort((a, b) => a.score - b.score);

    if (emergencyWarp) {
      // Stage 2 emergency unstuck: blink hero cleanly to a verified open tile to break any geometry lock
      for (const c of escapeCandidates) {
        const pathCheck = findGridPath(
          this.dungeon,
          heroG.gx,
          heroG.gz,
          c.gx,
          c.gz,
          this.doorUnlocked
        );
        if (pathCheck.length > 0) {
          const dest = gridToWorld(c.gx, c.gz);
          this.heroX = dest.x;
          this.heroZ = dest.z;
          this.heroVx = 0;
          this.heroVz = 0;
          this.aiProgressAnchorX = dest.x;
          this.aiProgressAnchorZ = dest.z;
          this.aiUnstuckAttempts = 0;
          this.aiUnstuckTimer = 0;
          this.aiUnstuckPath = [];
          this.aiSkipEnemyUntil.clear();
          this.aiStatus = 'Repositioning';
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            this.spawnParticle(
              dest.x,
              0.7,
              dest.z,
              Math.cos(a) * 2.4,
              1.4,
              Math.sin(a) * 2.4,
              0x3be8e0,
              0.95,
              0.42,
              0
            );
          }
          return;
        }
      }
      this.nudgeHeroToClearTile();
      this.aiUnstuckAttempts = 0;
      return;
    }

    // Stage 1 active detour: chart an explicit escape path to an open tile and commit to it for 1.6s
    for (const c of escapeCandidates) {
      const p = this.buildSafeGridPath(c.gx, c.gz);
      if (p.length > 0) {
        this.aiUnstuckPath = p;
        this.aiUnstuckTimer = 1.6;
        this.aiStatus = 'Repositioning';
        return;
      }
    }

    // Fallback if no detour found
    this.nudgeHeroToClearTile();
  }

  /**
   * Frost Mage auto-pilot combat: keep 4.5–7 units away, kite back when threatened (< 3),
   * shoot only with line of sight, Frost Nova / Blink to escape crowds and swarms.
   * Returns null when the target has no line of sight (caller then path-finds toward it).
   */
  private updateMageCombatAI(
    target: EnemyEntity,
    targetDist: number
  ): { moveX: number; moveZ: number } | null {
    const dx = target.x - this.heroX;
    const dz = target.z - this.heroZ;
    const shotLOS = hasLineOfSight(
      this.dungeon,
      this.heroX,
      this.heroZ,
      target.x,
      target.z,
      this.doorUnlocked,
      0.2
    );

    // Threat census around the mage
    let within4 = 0;
    let adjacent = 0;
    let swarmClose = 0;
    let bossWindup = false;
    let closest: EnemyEntity | null = null;
    let closestDist = Infinity;
    let cx = 0;
    let cz = 0;
    let cn = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - this.heroX, e.z - this.heroZ);
      const frozen = (e.frozenTimer ?? 0) > 0 || e.stunTimer > 0;
      if (d <= 4 && !frozen) within4 += 1;
      if (d <= 1.9 && !frozen) adjacent += 1;
      if (d <= 3.2 && isSwarmEnemy(e.kind) && !frozen) swarmClose += 1;
      if (e.isBoss && e.bossState === 'windup' && d <= FROST_MAGE.novaRadius) bossWindup = true;
      if (d < 6) {
        cx += e.x;
        cz += e.z;
        cn += 1;
      }
      if (d < closestDist && !frozen) {
        closestDist = d;
        closest = e;
      }
    }
    const shieldBroken = this.getEffectiveMaxShield() > 0 && this.shield <= 0.5;

    // 1. Frost Nova
    if (
      this.pommelCooldown <= 0 &&
      (within4 >= 3 || (shieldBroken && adjacent > 0) || bossWindup || swarmClose >= 2)
    ) {
      this.performFrostNova();
      this.aiStatus = 'Frost Nova!';
    }

    // 2. Blink out of a swarm / melee crowd when Nova is not available
    if (
      this.pommelCooldown > 0 &&
      this.dashCooldown <= 0 &&
      cn > 0 &&
      (swarmClose >= 2 || adjacent >= 2 || (shieldBroken && adjacent >= 1))
    ) {
      const awayX = this.heroX - cx / cn;
      const awayZ = this.heroZ - cz / cn;
      const len = Math.hypot(awayX, awayZ);
      const baseAng = len > 0.05 ? Math.atan2(awayX, awayZ) : this.heroFacing + Math.PI;
      // Try straight away from the crowd first, then fan out
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
        const ex = Math.sin(baseAng + off);
        const ez = Math.cos(baseAng + off);
        if (this.canMoveTo(this.heroX + ex * 2.5, this.heroZ + ez * 2.5, 0.4)) {
          this.lastMoveX = ex;
          this.lastMoveZ = ez;
          this.performBlink();
          this.aiStatus = 'Blinking Clear';
          break;
        }
      }
    }

    // 3. Shoot the target when we have a clean shot
    if (shotLOS && targetDist <= FROST_MAGE.projectileRange + this.getEnemyHitRadius(target)) {
      this.heroFacing = Math.atan2(dx, dz);
      if (this.attackCooldown <= 0) this.performAttack();
    } else if (!shotLOS) {
      return null; // let the shared pathing bring us around the corner
    }

    // 4. Movement: kite, hold the band, or close in
    const tryDir = (mx: number, mz: number): { moveX: number; moveZ: number } | null => {
      const l = Math.hypot(mx, mz) || 1;
      const nx = mx / l;
      const nz = mz / l;
      if (this.canMoveTo(this.heroX + nx * 0.7, this.heroZ + nz * 0.7, 0.4)) return { moveX: nx, moveZ: nz };
      return null;
    };

    if (closest && closestDist < 3) {
      this.aiStatus = 'Kiting';
      const ax = this.heroX - closest.x;
      const az = this.heroZ - closest.z;
      const l = Math.hypot(ax, az) || 1;
      const bx = ax / l;
      const bz = az / l;
      const px = -bz * this.aiStrafeSign;
      const pz = bx * this.aiStrafeSign;
      const step =
        tryDir(bx, bz) ??
        tryDir(bx + px, bz + pz) ??
        tryDir(bx - px, bz - pz) ??
        tryDir(px, pz) ??
        tryDir(-px, -pz);
      if (step) return step;
      // Cornered: Blink sideways if possible, otherwise stand and shoot
      if (this.dashCooldown <= 0) {
        this.lastMoveX = px;
        this.lastMoveZ = pz;
        this.performBlink();
      }
      return { moveX: 0, moveZ: 0 };
    }

    const l = targetDist || 1;
    if (targetDist > 7) {
      this.aiStatus = target.isBoss ? `Battling ${target.bossName}` : 'Closing Distance';
      return { moveX: dx / l, moveZ: dz / l };
    }
    if (targetDist < 4.5) {
      const back = tryDir(-dx / l, -dz / l);
      if (back) return { moveX: back.moveX * 0.7, moveZ: back.moveZ * 0.7 };
    }
    // Comfortable range: light strafing so slow ranged shots and boss telegraphs miss
    return {
      moveX: (-dz / l) * 0.3 * this.aiStrafeSign,
      moveZ: (dx / l) * 0.3 * this.aiStrafeSign,
    };
  }

  private updateAI(dt: number): { moveX: number; moveZ: number } {
    this.aiForcePathTimer = Math.max(0, this.aiForcePathTimer - dt);

    // 0a. Macro Stuck Detector: if hero's XY/XZ position barely changes for 2.5s AND no enemy took damage,
    //     run a 2-stage unstuck recovery flow (Stage 1: detour around obstacle; Stage 2: clean reposition)!
    const anchorDist = Math.hypot(
      this.heroX - this.aiProgressAnchorX,
      this.heroZ - this.aiProgressAnchorZ
    );
    const recentCombatDamage = this.elapsed - this.aiLastCombatDamageTime < 2.2;
    if (anchorDist > 1.35 || recentCombatDamage) {
      this.aiProgressAnchorX = this.heroX;
      this.aiProgressAnchorZ = this.heroZ;
      this.aiNoProgressTimer = 0;
      if (anchorDist > 1.8) {
        this.aiUnstuckAttempts = 0;
      }
    } else {
      this.aiNoProgressTimer += dt;
      if (this.aiNoProgressTimer >= 2.5) {
        this.aiNoProgressTimer = 0;
        this.aiUnstuckAttempts += 1;
        this.triggerStuckRecovery(this.aiUnstuckAttempts >= 2);
      }
    }

    // 0b. Micro stuck watchdog: quick 0.55s snag check for doorway corners
    this.aiStuckTimer += dt;
    if (this.aiStuckTimer > 0.55) {
      const progress = Math.hypot(this.heroX - this.aiLastCheckX, this.heroZ - this.aiLastCheckZ);
      this.aiLastCheckX = this.heroX;
      this.aiLastCheckZ = this.heroZ;
      this.aiStuckTimer = 0;
      if (progress < 0.22 && !recentCombatDamage) {
        this.aiStuckCount += 1;
        this.aiCombatPath = [];
        this.aiRepathTimer = 0;
        this.aiCombatRepathTimer = 0;
        this.aiForcePathTimer = 1.4;
        this.aiStrafeSign *= -1;
        if (this.aiStuckCount >= 2) {
          this.nudgeHeroToClearTile();
          this.aiStuckCount = 0;
        }
        this.aiPath = [];
      } else {
        this.aiStuckCount = 0;
      }
    }

    // 1. Auto-heal check
    const healThreshold = this.getAutoHealThreshold(this.getEffectiveMaxHp());
    if (this.hp <= healThreshold && this.potions > 0) {
      this.usePotion();
    }

    // 1b. Boss Telegraph Dodge! Step or dash outside the Boss's danger zone or strafe away from ranged volley
    for (const e of this.enemies) {
      if (e.dead || !e.isBoss || e.bossState !== 'windup') continue;
      if (e.bossSkill === 'ranged_volley') {
        const bdx = this.heroX - e.x;
        const bdz = this.heroZ - e.z;
        const bDist = Math.hypot(bdx, bdz);
        if (bDist < 8.5 && (e.bossStateTimer ?? 1) < 0.45) {
          this.aiStatus = 'Strafing Boss Volley';
          const dirX = bDist > 0.05 ? bdx / bDist : 1;
          const dirZ = bDist > 0.05 ? bdz / bDist : 0;
          const perpX = -dirZ * this.aiStrafeSign;
          const perpZ = dirX * this.aiStrafeSign;
          if (this.canMoveTo(this.heroX + perpX * 0.7, this.heroZ + perpZ * 0.7, 0.4)) {
            return { moveX: perpX, moveZ: perpZ };
          }
          return { moveX: -perpX, moveZ: -perpZ };
        }
        continue;
      }

      const tx = e.telegraphX ?? e.x;
      const tz = e.telegraphZ ?? e.z;
      const rad = e.telegraphRadius ?? 2.8;
      const dx = this.heroX - tx;
      const dz = this.heroZ - tz;
      const dist = Math.hypot(dx, dz);
      if (dist < rad + 0.65) {
        this.aiStatus = 'Evading Boss Strike';
        const escX = dist > 0.05 ? dx / dist : Math.cos(this.elapsed);
        const escZ = dist > 0.05 ? dz / dist : Math.sin(this.elapsed);
        this.heroFacing = Math.atan2(escX, escZ);
        if (this.dashCooldown <= 0 && (e.bossStateTimer ?? 1) < 0.52) {
          this.performDash();
        }
        if (this.canMoveTo(this.heroX + escX * 0.7, this.heroZ + escZ * 0.7, 0.4)) {
          return { moveX: escX, moveZ: escZ };
        }
        const perpX = -escZ * this.aiStrafeSign;
        const perpZ = escX * this.aiStrafeSign;
        if (this.canMoveTo(this.heroX + perpX * 0.7, this.heroZ + perpZ * 0.7, 0.4)) {
          return { moveX: perpX, moveZ: perpZ };
        }
        return { moveX: -perpX, moveZ: -perpZ };
      }
    }

    // 1c. Active Unstuck Detour: commit to breaking free from a pillar/corner deadlock before re-engaging
    if (this.aiUnstuckTimer > 0) {
      this.aiUnstuckTimer = Math.max(0, this.aiUnstuckTimer - dt);
      const escapeStep = this.followGridPath(this.aiUnstuckPath);
      if (escapeStep) {
        this.aiStatus = 'Repositioning';
        const dashVec = this.getPathDashDirection(this.aiUnstuckPath, escapeStep);
        this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
        return escapeStep;
      }
      this.aiUnstuckTimer = 0;
    }

    // 1d. If standing right beside the Relic Key with clear LOS and no melee threat on top of us, grab it immediately!
    if (!this.hasKey) {
      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const kdx = kw.x - this.heroX;
      const kdz = kw.z - this.heroZ;
      const kDist = Math.hypot(kdx, kdz);
      if (
        kDist < 2.65 &&
        this.aiForcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, kw.x, kw.z, this.doorUnlocked, 0.36)
      ) {
        const immediateThreat = this.enemies.some(
          (e) => !e.dead && Math.hypot(e.x - this.heroX, e.z - this.heroZ) < 2.2
        );
        if (!immediateThreat) {
          this.aiStatus = 'Claiming Relic Key';
          return { moveX: kdx / (kDist || 1), moveZ: kdz / (kDist || 1) };
        }
      }
    }

    // 2. Check alive REACHABLE enemies:
    //    - Always finish every enemy inside the hero's current room before leaving!
    //    - Tactical Boss Rule: if a Boss is nearby, eliminate ranged escorts near the Boss first!
    const heroG = worldToWalkableGrid(this.dungeon, this.heroX, this.heroZ, this.doorUnlocked);
    const currentRoom = this.dungeon.rooms.find(
      (r) =>
        heroG.gx >= r.x &&
        heroG.gx < r.x + r.w &&
        heroG.gz >= r.z &&
        heroG.gz < r.z + r.h
    );
    const exitRoom = this.dungeon.rooms.find((r) => r.role === 'exit');
    const nearbyBoss = this.enemies.find(
      (e) => !e.dead && e.isBoss && Math.hypot(e.x - this.heroX, e.z - this.heroZ) < 13.0
    );

    let nearestEnemy: EnemyEntity | null = null;
    let nearestEnemyDist = Infinity;
    let roomEnemy: EnemyEntity | null = null;
    let roomEnemyDist = Infinity;
    let priorityRanged: EnemyEntity | null = null;
    let priorityRangedDist = Infinity;

    for (const e of this.enemies) {
      if (e.dead) continue;
      const skipUntil = this.aiSkipEnemyUntil.get(e.id);
      if (skipUntil !== undefined && this.elapsed < skipUntil) continue;

      const d = Math.hypot(e.x - this.heroX, e.z - this.heroZ);
      const eg = worldToWalkableGrid(this.dungeon, e.x, e.z, this.doorUnlocked);

      if (
        !this.doorUnlocked &&
        exitRoom &&
        eg.gx >= exitRoom.x - 1 &&
        eg.gx <= exitRoom.x + exitRoom.w &&
        eg.gz >= exitRoom.z - 1 &&
        eg.gz <= exitRoom.z + exitRoom.h
      ) {
        continue;
      }

      const inCurrentRoom =
        Boolean(currentRoom) &&
        eg.gx >= currentRoom!.x - 1 &&
        eg.gx <= currentRoom!.x + currentRoom!.w &&
        eg.gz >= currentRoom!.z - 1 &&
        eg.gz <= currentRoom!.z + currentRoom!.h;
      const nearBossRanged =
        Boolean(nearbyBoss) &&
        e.isRanged &&
        (Math.hypot(e.x - nearbyBoss!.x, e.z - nearbyBoss!.z) < 12.5 || d < 11.0);
      const maxRange = e.isBoss ? 10.5 : e.isRanged ? 10.5 : 8.2;
      if (!inCurrentRoom && !nearBossRanged && d >= maxRange) continue;

      // Skip enemies that cannot be reached (e.g., separated by a locked gate)
      const directReachable = hasLineOfSight(
        this.dungeon,
        this.heroX,
        this.heroZ,
        e.x,
        e.z,
        this.doorUnlocked,
        0.35
      );
      if (!directReachable) {
        const pathCheck = findGridPath(
          this.dungeon,
          heroG.gx,
          heroG.gz,
          eg.gx,
          eg.gz,
          this.doorUnlocked
        );
        if (pathCheck.length === 0 && (heroG.gx !== eg.gx || heroG.gz !== eg.gz)) {
          continue;
        }
      }

      if (nearBossRanged && d < priorityRangedDist) {
        priorityRangedDist = d;
        priorityRanged = e;
      }

      if (inCurrentRoom && d < roomEnemyDist) {
        roomEnemyDist = d;
        roomEnemy = e;
      }

      if (d < maxRange && d < nearestEnemyDist) {
        nearestEnemyDist = d;
        nearestEnemy = e;
      }
    }

    if (priorityRanged) {
      nearestEnemy = priorityRanged;
      nearestEnemyDist = priorityRangedDist;
    } else if (roomEnemy) {
      nearestEnemy = roomEnemy;
      nearestEnemyDist = roomEnemyDist;
    }

    this.aiCurrentTargetId = nearestEnemy ? nearestEnemy.id : null;

    if (nearestEnemy) {
      this.aiStatus = priorityRanged
        ? 'Eliminating Ranged Threat'
        : nearestEnemy.isBoss
        ? `Battling ${nearestEnemy.bossName}`
        : 'Engaging Foes';
      const dx = nearestEnemy.x - this.heroX;
      const dz = nearestEnemy.z - this.heroZ;

      const clearLOS = hasLineOfSight(
        this.dungeon,
        this.heroX,
        this.heroZ,
        nearestEnemy.x,
        nearestEnemy.z,
        this.doorUnlocked,
        0.42
      );

      // Frost Mage: ranged kiting combat. Falls through to path navigation only when LOS is blocked.
      if (this.isMage()) {
        const mageMove = this.updateMageCombatAI(nearestEnemy, nearestEnemyDist);
        if (mageMove) return mageMove;
      }

      // Auto AI casts Pommel Strike when off CD to interrupt windups or stun nearby foes
      if (!this.isMage() && this.pommelCooldown <= 0) {
        let inShockRange = 0;
        let hasPriorityInterrupt = false;
        let hasUnstunnedElite = false;
        for (const e of this.enemies) {
          if (e.dead) continue;
          const ed = Math.hypot(e.x - this.heroX, e.z - this.heroZ);
          const eReach = 2.55 + (e.isBoss ? 0.5 : e.isElite ? 0.18 : 0);
          if (ed <= eReach) {
            if (e.isBoss && e.bossState === 'windup') {
              hasPriorityInterrupt = true;
            } else if (e.isRanged && e.windupTimer > 0) {
              hasPriorityInterrupt = true;
            }
            if (e.stunTimer <= 0.1) {
              inShockRange += 1;
              if (e.isElite || e.isBoss || isGuardianEnemy(e.kind)) {
                hasUnstunnedElite = true;
              }
            }
          }
        }
        if (
          hasPriorityInterrupt ||
          hasUnstunnedElite ||
          inShockRange >= 2 ||
          (nearestEnemyDist <= 2.2 && nearestEnemy.stunTimer <= 0.1 && clearLOS)
        ) {
          this.heroFacing = Math.atan2(dx, dz);
          this.performPommelStrike();
        }
      }

      const attackRange = nearestEnemy.isBoss ? 2.25 : 1.85;
      if (!this.isMage() && nearestEnemyDist <= attackRange && clearLOS) {
        this.heroFacing = Math.atan2(dx, dz);
        if (this.attackCooldown <= 0) {
          this.performAttack();
        }
        return {
          moveX: (-dz / (nearestEnemyDist || 1)) * 0.25 * this.aiStrafeSign,
          moveZ: (dx / (nearestEnemyDist || 1)) * 0.25 * this.aiStrafeSign,
        };
      }

      if (clearLOS && this.aiForcePathTimer <= 0) {
        this.aiCombatPath = [];
        return { moveX: dx / nearestEnemyDist, moveZ: dz / nearestEnemyDist };
      }

      // Line of sight is blocked by a wall corner or pillar: navigate cleanly via walkable-snapped A*!
      this.aiCombatRepathTimer -= dt;
      if (this.aiCombatPath.length === 0 || this.aiCombatRepathTimer <= 0) {
        this.aiCombatRepathTimer = 0.4;
        const enemyG = worldToWalkableGrid(
          this.dungeon,
          nearestEnemy.x,
          nearestEnemy.z,
          this.doorUnlocked
        );
        this.aiCombatPath = this.buildSafeGridPath(enemyG.gx, enemyG.gz);
      }
      const step = this.followGridPath(this.aiCombatPath);
      if (step) return step;

      // Pillar-flank fallback: if hero & enemy share a snapped tile across a pillar edge, flank sideways around it!
      const len = nearestEnemyDist || 1;
      const perpX = (-dz / len) * this.aiStrafeSign;
      const perpZ = (dx / len) * this.aiStrafeSign;
      if (this.canMoveTo(this.heroX + perpX * 0.65, this.heroZ + perpZ * 0.65, 0.4)) {
        return { moveX: perpX, moveZ: perpZ };
      }
      if (this.canMoveTo(this.heroX - perpX * 0.65, this.heroZ - perpZ * 0.65, 0.4)) {
        return { moveX: -perpX, moveZ: -perpZ };
      }
    }

    // 2a. Frost Mage: with no enemy nearby and the shield below 60%, hold position until it refills
    if (this.isMage() && !nearestEnemy) {
      const maxShield = this.getEffectiveMaxShield();
      const anyNear = this.enemies.some(
        (e) => !e.dead && Math.hypot(e.x - this.heroX, e.z - this.heroZ) < 11
      );
      if (maxShield > 0 && this.shield < maxShield * 0.6 && !anyNear) {
        this.aiStatus = 'Recharging Frost Shield';
        this.aiProgressAnchorX = this.heroX;
        this.aiProgressAnchorZ = this.heroZ;
        this.aiNoProgressTimer = 0;
        this.aiStuckTimer = 0;
        this.aiLastCheckX = this.heroX;
        this.aiLastCheckZ = this.heroZ;
        return { moveX: 0, moveZ: 0 };
      }
    }

    // 2b. No active threats in room: if the Relic Key is in sight nearby, claim it immediately!
    if (!this.hasKey) {
      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const kdx = kw.x - this.heroX;
      const kdz = kw.z - this.heroZ;
      const kDist = Math.hypot(kdx, kdz);
      if (
        kDist < 8.5 &&
        this.aiForcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, kw.x, kw.z, this.doorUnlocked, 0.42)
      ) {
        this.aiStatus = 'Claiming Relic Key';
        const dirX = kdx / (kDist || 1);
        const dirZ = kdz / (kDist || 1);
        this.tryAutoTravelDash(dirX, dirZ, kDist);
        return { moveX: dirX, moveZ: dirZ };
      }
    }

    // 3. Collect nearby loose gold & potion loot (only if body-width line-of-sight is clear)
    for (const l of this.loots) {
      if (l.collected || l.type === 'relic') continue;
      const d = Math.hypot(l.x - this.heroX, l.z - this.heroZ);
      if (
        d < 4.5 &&
        this.aiForcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, l.x, l.z, this.doorUnlocked, 0.42)
      ) {
        this.aiStatus = 'Gathering Spoils';
        return { moveX: (l.x - this.heroX) / (d || 1), moveZ: (l.z - this.heroZ) / (d || 1) };
      }
    }

    // 4. Smash nearby crate if right next to hero
    for (const br of this.breakables) {
      if (br.broken) continue;
      const d = Math.hypot(br.x - this.heroX, br.z - this.heroZ);
      if (d < 2.0) {
        this.heroFacing = Math.atan2(br.x - this.heroX, br.z - this.heroZ);
        if (this.attackCooldown <= 0) this.performAttack();
        break;
      }
    }

    // 4a. Pick up nearby dropped Relics (wait briefly so pop-out arc & Orange/Green beam register clearly!)
    let nearestRelic: LootEntity | null = null;
    let nearestRelicDist = Infinity;
    for (const l of this.loots) {
      if (l.collected || l.type !== 'relic' || !l.relic) continue;
      const readyAge = (l.pickupDelay ?? 0.85) * 0.72;
      if (l.age < readyAge) continue;
      const d = Math.hypot(l.x - this.heroX, l.z - this.heroZ);
      const maxSearch = l.relic.rarity === 'orange' || l.relic.rarity === 'green' ? 11.0 : 5.8;
      if (
        d < maxSearch &&
        d < nearestRelicDist &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, l.x, l.z, this.doorUnlocked, 0.36)
      ) {
        nearestRelicDist = d;
        nearestRelic = l;
      }
    }
    if (nearestRelic && nearestRelicDist > 0.3) {
      this.aiStatus = 'Collecting Relic';
      const dirX = (nearestRelic.x - this.heroX) / nearestRelicDist;
      const dirZ = (nearestRelic.z - this.heroZ) / nearestRelicDist;
      return { moveX: dirX, moveZ: dirZ };
    }

    // 4a-2. Auto-Heal at any discovered Healing Sanctum (Rune Well) whenever HP is not full
    if (this.hp < this.getEffectiveMaxHp()) {
      let bestRune: AnimatedLightProp | null = null;
      let bestRuneDist = Infinity;
      let bestRuneGrid: { gx: number; gz: number } | null = null;

      for (const lp of this.lightProps) {
        if (lp.kind !== 'rune' || lp.used) continue;
        const rg = worldToGrid(lp.x, lp.z);
        const discovered = Boolean(this.dungeon.explored[rg.gz]?.[rg.gx]);
        const d = Math.hypot(lp.x - this.heroX, lp.z - this.heroZ);
        const directVisible =
          d < 10.5 &&
          hasLineOfSight(this.dungeon, this.heroX, this.heroZ, lp.x, lp.z, this.doorUnlocked, 0.36);
        if (!discovered && !directVisible) continue;
        if (!this.doorUnlocked && exitRoom) {
          if (
            rg.gx >= exitRoom.x - 1 &&
            rg.gx <= exitRoom.x + exitRoom.w &&
            rg.gz >= exitRoom.z - 1 &&
            rg.gz <= exitRoom.z + exitRoom.h
          ) {
            continue;
          }
        }
        if (d < bestRuneDist) {
          bestRuneDist = d;
          bestRune = lp;
          bestRuneGrid = rg;
        }
      }

      if (bestRune && bestRuneGrid) {
        const dx = bestRune.x - this.heroX;
        const dz = bestRune.z - this.heroZ;
        this.aiStatus = 'Healing at Sanctum';
        if (
          this.aiForcePathTimer <= 0 &&
          hasLineOfSight(
            this.dungeon,
            this.heroX,
            this.heroZ,
            bestRune.x,
            bestRune.z,
            this.doorUnlocked,
            0.4
          )
        ) {
          const dirX = dx / (bestRuneDist || 1);
          const dirZ = dz / (bestRuneDist || 1);
          this.tryAutoTravelDash(dirX, dirZ, bestRuneDist);
          return { moveX: dirX, moveZ: dirZ };
        }
        this.aiRepathTimer -= dt;
        const lastRunePt = this.aiPath[this.aiPath.length - 1];
        const pathMatchesRune =
          Boolean(lastRunePt) &&
          lastRunePt.gx === bestRuneGrid.gx &&
          lastRunePt.gz === bestRuneGrid.gz;
        if (!pathMatchesRune || this.aiPath.length === 0 || this.aiRepathTimer <= 0) {
          this.aiRepathTimer = 0.65;
          this.aiPath = this.buildSafeGridPath(bestRuneGrid.gx, bestRuneGrid.gz);
        }
        const runeStep = this.followGridPath(this.aiPath);
        if (runeStep) {
          const dashVec = this.getPathDashDirection(this.aiPath, runeStep);
          this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
          return runeStep;
        }
      }
    }

    // 4b. Auto-Upgrade & Smart Potion Restock (Altar of Ascension & Dedicated Potion Shop)
    // Target potion stock scales with depth (4 early -> 5-8 deeper) so Auto buys potions when running low
    const targetPotions = Math.min(8, 4 + Math.floor(this.depth / 6));
    const urgentPotionNeed = this.potions <= 2 && this.gold >= this.getPotionCost();
    const wantsMorePotions = this.potions < targetPotions && this.gold >= this.getPotionCost();
    const canAutoUpgradeStat =
      this.gold >= this.getUpgradeCost() &&
      this.getUpgradeOptions().some((o) => !o.maxed);
    const hasSellableBagRelics = this.relicBag.some(
      (r) => r.rarity === 'blue' || r.rarity === 'yellow'
    );

    if (this.dungeon.altarPos && (canAutoUpgradeStat || wantsMorePotions)) {
      const aw = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
      const dx = aw.x - this.heroX;
      const dz = aw.z - this.heroZ;
      const altarDist = Math.hypot(dx, dz);

      if (altarDist < 2.2) {
        this.aiStatus = urgentPotionNeed ? 'Restocking Elixirs' : 'Ascending at Altar';
        this.aiStuckTimer = 0;
        this.aiStuckCount = 0;
        this.aiNoProgressTimer = 0;
        this.aiProgressAnchorX = this.heroX;
        this.aiProgressAnchorZ = this.heroZ;
        this.autoUpgradeCooldown -= dt;
        if (this.autoUpgradeCooldown <= 0) {
          if (urgentPotionNeed) {
            if (this.purchasePotion()) {
              this.autoUpgradeCooldown = 0.42;
              this.aiPath = [];
            }
          } else if (this.gold >= this.getUpgradeCost()) {
            const cycle: UpgradeKind[] = this.isMage()
              ? ['hp_shield', 'atk', 'shield_speed', 'crit']
              : ['hp', 'atk', 'armor', 'crit'];
            const startIdx = Math.max(0, cycle.indexOf(this.autoNextUpgrade));
            let choice: UpgradeKind = 'atk';
            for (let offset = 0; offset < cycle.length; offset++) {
              const cand = cycle[(startIdx + offset) % cycle.length];
              if (this.isUpgradeMaxed(cand)) continue;
              choice = cand;
              break;
            }
            if (this.purchaseUpgrade(choice)) {
              const nextIdx = (cycle.indexOf(choice) + 1) % cycle.length;
              this.autoNextUpgrade = cycle[nextIdx];
              this.autoUpgradeCooldown = 0.55;
              this.aiPath = [];
            }
          } else if (this.potions < targetPotions && this.gold >= this.getPotionCost()) {
            if (this.purchasePotion()) {
              this.autoUpgradeCooldown = 0.42;
              this.aiPath = [];
            }
          }
        }
        return { moveX: 0, moveZ: 0 };
      }

      this.aiStatus = 'Visiting Altar';
      if (
        this.aiForcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, aw.x, aw.z, this.doorUnlocked, 0.42)
      ) {
        const dirX = dx / (altarDist || 1);
        const dirZ = dz / (altarDist || 1);
        this.tryAutoTravelDash(dirX, dirZ, altarDist);
        return { moveX: dirX, moveZ: dirZ };
      }
      this.aiRepathTimer -= dt;
      if (this.aiPath.length === 0 || this.aiRepathTimer <= 0) {
        this.aiRepathTimer = 0.7;
        this.aiPath = this.buildSafeGridPath(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
      }
      const altarStep = this.followGridPath(this.aiPath);
      if (altarStep) {
        const dashVec = this.getPathDashDirection(this.aiPath, altarStep);
        this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
        return altarStep;
      }
    }

    // 4c. Dedicated Elixir Potion Shop visit on every 3rd floor (Depth 3, 6, 9, 12...)
    // Auto sells all unused Blue & Yellow relics in bag and restocks potions when needed
    if (this.dungeon.shopPos && (wantsMorePotions || hasSellableBagRelics)) {
      const sw = gridToWorld(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
      const dx = sw.x - this.heroX;
      const dz = sw.z - this.heroZ;
      const shopDist = Math.hypot(dx, dz);

      if (shopDist < 2.2) {
        this.aiStatus = hasSellableBagRelics ? 'Selling Spare Relics' : 'Buying Elixirs';
        this.aiStuckTimer = 0;
        this.aiStuckCount = 0;
        this.aiNoProgressTimer = 0;
        this.aiProgressAnchorX = this.heroX;
        this.aiProgressAnchorZ = this.heroZ;
        this.autoUpgradeCooldown -= dt;
        if (this.autoUpgradeCooldown <= 0) {
          if (hasSellableBagRelics && this.sellCommonBagRelics(true) > 0) {
            this.autoUpgradeCooldown = 0.45;
            this.aiPath = [];
          } else if (this.potions < targetPotions && this.purchasePotion()) {
            this.autoUpgradeCooldown = 0.42;
            this.aiPath = [];
          }
        }
        return { moveX: 0, moveZ: 0 };
      }

      this.aiStatus = 'Visiting Potion Shop';
      if (
        this.aiForcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, sw.x, sw.z, this.doorUnlocked, 0.42)
      ) {
        const dirX = dx / (shopDist || 1);
        const dirZ = dz / (shopDist || 1);
        this.tryAutoTravelDash(dirX, dirZ, shopDist);
        return { moveX: dirX, moveZ: dirZ };
      }
      this.aiRepathTimer -= dt;
      const lastShopPt = this.aiPath[this.aiPath.length - 1];
      const pathMatchesShop =
        Boolean(lastShopPt) &&
        lastShopPt.gx === this.dungeon.shopPos.gx &&
        lastShopPt.gz === this.dungeon.shopPos.gz;
      if (!pathMatchesShop || this.aiPath.length === 0 || this.aiRepathTimer <= 0) {
        this.aiRepathTimer = 0.7;
        this.aiPath = this.buildSafeGridPath(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
      }
      const shopStep = this.followGridPath(this.aiPath);
      if (shopStep) {
        const dashVec = this.getPathDashDirection(this.aiPath, shopStep);
        this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
        return shopStep;
      }
    }

    // 5. Strategic objective pathfinding
    this.aiRepathTimer -= dt;
    if (this.aiPath.length === 0 || this.aiRepathTimer <= 0) {
      this.aiRepathTimer = 0.85;
      let goal: { gx: number; gz: number } | null = null;

      if (!this.hasKey) {
        // Once the Relic Key has been discovered on the map, head straight for it instead of detouring!
        const keyDiscovered = Boolean(
          this.dungeon.explored[this.dungeon.keyPos.gz]?.[this.dungeon.keyPos.gx]
        );
        if (keyDiscovered) {
          goal = { gx: this.dungeon.keyPos.gx, gz: this.dungeon.keyPos.gz };
          this.aiStatus = 'Seeking Relic Key';
        } else {
          // Otherwise sweep the nearest unexplored non-exit chamber (no random cross-map backtracking)
          let nearestRoom: DungeonData['rooms'][number] | null = null;
          let nearestRoomDistSq = Infinity;
          for (const r of this.dungeon.rooms) {
            if (r.role === 'exit' || this.dungeon.explored[r.cz][r.cx]) continue;
            const dSq = (r.cx - heroG.gx) ** 2 + (r.cz - heroG.gz) ** 2;
            if (dSq < nearestRoomDistSq) {
              nearestRoomDistSq = dSq;
              nearestRoom = r;
            }
          }
          if (nearestRoom) {
            goal = { gx: nearestRoom.cx, gz: nearestRoom.cz };
            this.aiStatus = 'Exploring Chambers';
          } else {
            goal = { gx: this.dungeon.keyPos.gx, gz: this.dungeon.keyPos.gz };
            this.aiStatus = 'Seeking Relic Key';
          }
        }
      } else if (!this.doorUnlocked) {
        // Walk adjacent to Locked Gate to unlock it
        goal = this.findApproachTile(this.dungeon.doorPos.gx, this.dungeon.doorPos.gz);
        this.aiStatus = 'Unlocking Seal Gate';
      } else {
        goal = { gx: this.dungeon.stairsPos.gx, gz: this.dungeon.stairsPos.gz };
        this.aiStatus = 'Descending Deeper';
      }

      if (goal) {
        this.aiPath = this.buildSafeGridPath(goal.gx, goal.gz);
      }
    }

    const navStep = this.followGridPath(this.aiPath);
    if (navStep) {
      const dashVec = this.getPathDashDirection(this.aiPath, navStep);
      this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
      return navStep;
    }

    // Fallback direct approach ONLY when line-of-sight is genuinely clear (never walk blindly into walls)
    if (!this.hasKey) {
      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const dx = kw.x - this.heroX;
      const dz = kw.z - this.heroZ;
      const d = Math.hypot(dx, dz);
      if (
        d > 0.25 &&
        d < 3.5 &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, kw.x, kw.z, this.doorUnlocked, 0.32)
      ) {
        return { moveX: dx / d, moveZ: dz / d };
      }
    } else if (!this.doorUnlocked) {
      const dw = gridToWorld(this.dungeon.doorPos.gx, this.dungeon.doorPos.gz);
      const dx = dw.x - this.heroX;
      const dz = dw.z - this.heroZ;
      const d = Math.hypot(dx, dz);
      if (
        d > 0.25 &&
        d < 2.6 &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, dw.x, dw.z, true, 0.2)
      ) {
        return { moveX: dx / d, moveZ: dz / d };
      }
    } else {
      const sw = gridToWorld(this.dungeon.stairsPos.gx, this.dungeon.stairsPos.gz);
      const dx = sw.x - this.heroX;
      const dz = sw.z - this.heroZ;
      const d = Math.hypot(dx, dz);
      if (
        d > 0.2 &&
        d < 3.5 &&
        hasLineOfSight(this.dungeon, this.heroX, this.heroZ, sw.x, sw.z, this.doorUnlocked, 0.32)
      ) {
        return { moveX: dx / d, moveZ: dz / d };
      }
    }

    return { moveX: 0, moveZ: 0 };
  }

  private findApproachTile(gx: number, gz: number): { gx: number; gz: number } {
    const start = worldToGrid(this.heroX, this.heroZ);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const nx = gx + dx;
      const nz = gz + dz;
      if (isTileWalkable(this.dungeon, nx, nz, false)) {
        const p = findGridPath(this.dungeon, start.gx, start.gz, nx, nz, false);
        if (p.length > 0 || (nx === start.gx && nz === start.gz)) {
          return { gx: nx, gz: nz };
        }
      }
    }
    return { gx, gz };
  }

  private update(dt: number): void {
    this.elapsed += dt;

    // Fade-in / Fade-out floor transition
    if (this.transitionState === 'fadeOut') {
      this.fadeOpacity = Math.min(1, this.fadeOpacity + dt * 2.2);
      this.emitHud();
      if (this.fadeOpacity >= 1) {
        const action = this.pendingTransitionAction;
        this.pendingTransitionAction = null;
        if (action) action();
        this.transitionState = 'fadeIn';
      }
      return;
    } else if (this.transitionState === 'fadeIn') {
      this.fadeOpacity = Math.max(0, this.fadeOpacity - dt * 2.0);
      this.emitHud();
      if (this.fadeOpacity <= 0) {
        this.transitionState = 'none';
        if (this.queuedRestartClass) {
          this.restartRun(this.queuedRestartClass);
        }
      }
    }

    // Freeze dungeon simulation immediately on death until player clicks Restart
    if (this.isDead) {
      return;
    }

    this.runElapsedSec += dt;

    // Brief tactile hit-stop on sword impact
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      return;
    }

    // Cooldowns & Relic Timers
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.pommelCooldown = Math.max(0, this.pommelCooldown - dt);
    this.pommelAnim = Math.max(0, this.pommelAnim - dt);
    this.comboResetTimer = Math.max(0, this.comboResetTimer - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.heroInvuln = Math.max(0, this.heroInvuln - dt);
    this.heroHitFlash = Math.max(0, this.heroHitFlash - dt);
    this.phantomCritTimer = Math.max(0, this.phantomCritTimer - dt);
    this.alchemistShieldTimer = Math.max(0, this.alchemistShieldTimer - dt);
    this.updateShield(dt);

    // 4pc Green Set: Dragonfire Knight periodic fiery breath nova every 3.0s
    if (this.hasSet4pc('dragonfire')) {
      this.dragonAuraTimer -= dt;
      if (this.dragonAuraTimer <= 0) {
        const nearbyEnemies = this.enemies.filter(
          (e) => !e.dead && Math.hypot(e.x - this.heroX, e.z - this.heroZ) <= 3.6
        );
        if (nearbyEnemies.length > 0) {
          this.dragonAuraTimer = 3.0;
          const novaDmg = Math.max(
            5,
            Math.round((7 + this.depth * 1.1) * (1 + this.atkUpgrades * 0.1 + this.relicStats.atkPct / 100))
          );
          for (const e of nearbyEnemies) {
            this.applyBonusEnemyDamage(e, novaDmg, `龍息 -${novaDmg}`, 'relicOrange', 0xff5a1f);
          }
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            this.spawnParticle(
              this.heroX + Math.cos(a) * 0.5,
              0.45,
              this.heroZ + Math.sin(a) * 0.5,
              Math.cos(a) * 5.8,
              0.7 + Math.random() * 0.8,
              Math.sin(a) * 5.8,
              i % 2 === 0 ? 0xff5a1f : 0xffd24a,
              1.15,
              0.48,
              0.5
            );
          }
        }
      }
    }

    // 1. Determine Hero Input (Manual or Auto)
    let moveX = 0;
    let moveZ = 0;

    if (this.controlMode === 'manual' || this.inTown) {
      if (this.inTown) {
        this.aiStatus = '庇護小鎮休整中';
      }
      // Camera looks along (-1, -1) in XZ, so screen-up = (-1,-1) and screen-right = (1,-1)
      let ix = 0;
      let iy = 0;
      if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) iy += 1;
      if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) iy -= 1;
      if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) ix += 1;
      if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) ix -= 1;

      if (ix !== 0 || iy !== 0) {
        moveX = ix - iy;
        moveZ = -ix - iy;
        const len = Math.hypot(moveX, moveZ) || 1;
        moveX /= len;
        moveZ /= len;
      }
    } else {
      const aiMove = this.updateAI(dt);
      moveX = aiMove.moveX;
      moveZ = aiMove.moveZ;
    }

    if (Math.hypot(moveX, moveZ) > 0.08) {
      this.lastMoveX = moveX;
      this.lastMoveZ = moveZ;
    }

    // 2. Move Hero (Dash or Walk + Knockback)
    const moveSpeed = 4.65 * (1 + this.relicStats.moveSpeedPct / 100);
    let dx = 0;
    let dz = 0;
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      dx = this.dashDirX * 13.5 * dt;
      dz = this.dashDirZ * 13.5 * dt;
      if (Math.random() < 0.7) {
        this.spawnParticle(
          this.heroX,
          0.6,
          this.heroZ,
          0,
          0.4,
          0,
          0x3be8e0,
          1.1,
          0.26,
          0
        );
      }
    } else {
      dx = (moveX * moveSpeed + this.heroVx) * dt;
      dz = (moveZ * moveSpeed + this.heroVz) * dt;
    }

    this.heroVx *= Math.exp(-10 * dt);
    this.heroVz *= Math.exp(-10 * dt);

    const moved = this.moveWithSlide(this.heroX, this.heroZ, dx, dz, 0.4);
    this.heroX = moved.x;
    this.heroZ = moved.z;

    const speedMag = Math.hypot(moveX, moveZ);
    if (speedMag > 0.08 && this.dashTimer <= 0) {
      const desiredAngle = Math.atan2(moveX, moveZ);
      let diff = desiredAngle - this.heroFacing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heroFacing += diff * Math.min(1, dt * 14);

      this.walkCycle += dt * 11.5;
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = 0.28;
        this.audio.playFootstep();
      }
    } else {
      this.walkCycle *= 0.85;
    }

    // 3. Animate Hero Composite Rig
    this.heroRig.root.position.set(this.heroX, 0, this.heroZ);
    this.heroRig.body.rotation.y = this.heroFacing;
    const stride = Math.sin(this.walkCycle) * (speedMag > 0.1 ? 0.55 : 0);
    this.heroRig.leftLeg.rotation.x = stride;
    this.heroRig.rightLeg.rotation.x = -stride;
    this.heroRig.body.position.y = Math.abs(Math.sin(this.walkCycle)) * (speedMag > 0.1 ? 0.08 : 0);
    this.heroRig.cape.rotation.x = 0.14 + (speedMag > 0.1 ? 0.22 : 0) + Math.sin(this.elapsed * 3.5) * 0.05;
    this.heroRig.lanternPivot.rotation.z = Math.sin(this.elapsed * 4.2 + this.walkCycle * 0.5) * 0.16;

    // Sword swing / Pommel Strike arm & hilt animation
    if (this.pommelAnim > 0) {
      const p = 1 - this.pommelAnim / 0.34;
      // Reverse sword grip so pommel/hilt juts forward & slams down with a crisp torque twist
      this.heroRig.swordGroup.rotation.x = -Math.PI * 0.56;
      const slamCurve = Math.sin(p * Math.PI);
      this.heroRig.rightArm.rotation.x = -1.35 + slamCurve * 1.15;
      this.heroRig.rightArm.rotation.y = -0.35 + p * 1.35;
      this.heroRig.body.rotation.y = this.heroFacing + slamCurve * 0.72;
    } else if (this.attackAnim > 0) {
      const p = 1 - this.attackAnim / 0.28;
      this.heroRig.swordGroup.rotation.x = THREE.MathUtils.damp(
        this.heroRig.swordGroup.rotation.x,
        Math.PI * 0.42,
        22,
        dt
      );
      this.heroRig.rightArm.rotation.x = -1.6 + p * 2.4;
      this.heroRig.rightArm.rotation.y = -0.7 + p * 1.6;
    } else {
      this.heroRig.swordGroup.rotation.x = THREE.MathUtils.damp(
        this.heroRig.swordGroup.rotation.x,
        Math.PI * 0.42,
        16,
        dt
      );
      this.heroRig.rightArm.rotation.x = THREE.MathUtils.damp(this.heroRig.rightArm.rotation.x, -stride * 0.4, 12, dt);
      this.heroRig.rightArm.rotation.y = THREE.MathUtils.damp(this.heroRig.rightArm.rotation.y, 0, 12, dt);
    }

    // Hero Hit Flash
    const heroEmissive =
      this.heroHitFlash > 0 ? (this.heroHitShieldOnly ? 0x6fd8ff : 0xff3b3b) : 0x000000;
    for (const m of this.heroRig.flashMaterials) {
      m.emissive.setHex(heroEmissive);
      m.emissiveIntensity = this.heroHitFlash > 0 ? 0.75 : 0;
    }

    // Hero Flickering Lantern Light + Warm Floor Glow Pool + Rising Ember Trail + 4pc Set Aura
    const flicker =
      Math.sin(this.elapsed * 14.3) * 2.4 +
      Math.sin(this.elapsed * 29.7) * 1.4 +
      Math.cos(this.elapsed * 8.1) * 1.6;
    const lanternBoost = 1 + this.relicStats.lanternGlowPct / 100;
    this.heroLight.intensity = (56.0 + flicker) * lanternBoost;
    this.heroLight.distance = 11.2 * (1 + (this.relicStats.lanternGlowPct / 100) * 0.45);
    const lanternOffX = Math.sin(this.heroFacing - 0.55) * 0.65;
    const lanternOffZ = Math.cos(this.heroFacing - 0.55) * 0.65;
    this.heroLight.position.set(this.heroX + lanternOffX, 1.85, this.heroZ + lanternOffZ);
    this.heroFloorGlow.position.set(this.heroX + lanternOffX * 0.5, 0.022, this.heroZ + lanternOffZ * 0.5);
    (this.heroFloorGlow.material as THREE.MeshBasicMaterial).opacity = 0.36 + flicker * 0.008;

    if (this.heroSetAura && this.heroSetAura.group.visible) {
      this.heroSetAura.outerRing.rotation.z += dt * 1.1;
      this.heroSetAura.innerRing.rotation.z -= dt * 1.9;
      const pulse = 0.96 + Math.sin(this.elapsed * 4.2) * 0.08;
      this.heroSetAura.group.scale.setScalar(pulse);
    }

    this.emberSpawnTimer -= dt;
    if (this.emberSpawnTimer <= 0) {
      this.emberSpawnTimer = 0.085;
      this.spawnParticle(
        this.heroX + lanternOffX + (Math.random() - 0.5) * 0.18,
        1.25,
        this.heroZ + lanternOffZ + (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.5) * 0.45,
        0.9 + Math.random() * 0.9,
        (Math.random() - 0.5) * 0.45,
        this.isMage()
          ? Math.random() < 0.75
            ? 0xbff4ff
            : 0xffe066
          : Math.random() < 0.5
          ? 0xffcf5c
          : 0xff7c24,
        0.72,
        0.85,
        -0.1
      );
    }

    // Keep global rim shadow camera centered on hero
    this.rimLight.position.set(this.heroX - 10, 22, this.heroZ - 8);
    this.rimLight.target.position.set(this.heroX, 0, this.heroZ);

    // Explore fog-of-war on minimap
    const heroG = worldToGrid(this.heroX, this.heroZ);
    this.markExplored(heroG.gx, heroG.gz);

    // 4. Key Pickup, Locked Gate Unlock, Stairwell Descent (dungeon only)
    if (!this.inTown) {
      this.updateObjectives(dt);

      // 5. Update Enemies & Projectiles
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updateHeroProjectiles(dt);

      // 6. Update Loot Drops
      this.updateLoot(dt);
    }

    // 7. Update Animated Light Props, Rune Wells, Spike Traps & Wall Occlusion Fade
    this.updateEnvironment(dt);
    this.updateWallOcclusion();

    // 8. Update Pooled Particles & Sword Slash Arcs
    this.updateParticles(dt);

    // 9. Smooth Isometric Camera Follow + Screen Shake
    const camDist = 14.5 * this.camZoom;
    _camGoal.set(this.heroX + camDist, camDist * 1.16, this.heroZ + camDist);
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camGoal.x, 5.5, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camGoal.y, 5.5, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camGoal.z, 5.5, dt);

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      shakeX = (Math.random() - 0.5) * this.shakeMag;
      shakeY = (Math.random() - 0.5) * this.shakeMag;
      this.shakeMag *= 0.9;
    }

    _camTarget.set(
      THREE.MathUtils.damp(_camTarget.x, this.heroX, 7, dt) + shakeX,
      0.65 + shakeY,
      THREE.MathUtils.damp(_camTarget.z, this.heroZ, 7, dt)
    );
    this.camera.lookAt(_camTarget);

    // Keep linear distance fog starting beyond the active room at every zoom level
    if (this.scene.fog instanceof THREE.Fog) {
      const viewDist = this.camera.position.distanceTo(_camTarget);
      this.scene.fog.near = viewDist + 5.5;
      this.scene.fog.far = viewDist + 26.0;
    }

    // Periodic HUD / Minimap refresh (faster while Pommel Strike CD is ticking)
    this.hudSyncTimer += dt;
    const hudInterval = this.pommelCooldown > 0 ? 0.1 : 0.25;
    if (this.hudSyncTimer > hudInterval) {
      this.hudSyncTimer = 0;
      this.emitHud();
    }
    this.minimapTimer += dt;
    if (this.minimapTimer > 0.16) {
      this.minimapTimer = 0;
      this.emitMinimap();
    }
  }

  private updateObjectives(dt: number): void {
    // Key Pickup
    if (this.keyPedestal && !this.hasKey) {
      this.keyPedestal.keyMesh.rotation.y += dt * 2.1;
      this.keyPedestal.keyMesh.position.y = 1.05 + Math.sin(this.elapsed * 3.4) * 0.14;

      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      if (Math.hypot(this.heroX - kw.x, this.heroZ - kw.z) < 1.45) {
        this.hasKey = true;
        this.keyPedestal.keyMesh.visible = false;
        this.keyPedestal.halo.visible = false;
        this.audio.playKeyFound();
        this.pushBanner('RELIC KEY CLAIMED', 'Seek the Sealed Gate');
        this.emitFloatingText(kw.x, 1.8, kw.z, 'RELIC KEY!', 'key');
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          this.spawnParticle(
            kw.x,
            1.0,
            kw.z,
            Math.cos(a) * 3.2,
            2.2 + Math.random() * 2,
            Math.sin(a) * 3.2,
            0xffdd55,
            1.2,
            0.75,
            4.5
          );
        }
        this.aiPath = [];
        this.emitHud();
      }
    }

    // Locked Gate Unlocking & Swinging Open
    if (this.gateRig) {
      const dw = gridToWorld(this.dungeon.doorPos.gx, this.dungeon.doorPos.gz);
      if (this.hasKey && !this.doorUnlocked) {
        if (Math.hypot(this.heroX - dw.x, this.heroZ - dw.z) < 2.85) {
          this.doorUnlocked = true;
          this.gateRig.lockGlow.visible = false;
          this.audio.playDoorUnlock();
          this.addScreenShake(0.18, 0.22);
          this.pushBanner('SEAL GATE UNLOCKED', 'The Stairwell Awaits');
          for (let i = 0; i < 22; i++) {
            this.spawnParticle(
              dw.x + (Math.random() - 0.5) * 1.2,
              1.1 + (Math.random() - 0.5) * 0.6,
              dw.z + (Math.random() - 0.5) * 1.2,
              (Math.random() - 0.5) * 3.5,
              1.6 + Math.random() * 2.2,
              (Math.random() - 0.5) * 3.5,
              0xffd24a,
              1.15,
              0.7,
              3.5
            );
          }
          this.aiPath = [];
          this.emitHud();
        }
      }

      if (this.doorUnlocked && this.gateOpenProgress < 1) {
        this.gateOpenProgress = Math.min(1, this.gateOpenProgress + dt * 2.4);
        const ease = 1 - Math.pow(1 - this.gateOpenProgress, 3);
        this.gateRig.leftPivot.rotation.y = -ease * Math.PI * 0.62;
        this.gateRig.rightPivot.rotation.y = ease * Math.PI * 0.62;
      }
    }

    // Stairwell Descent
    if (this.doorUnlocked && this.transitionState === 'none') {
      const sw = gridToWorld(this.dungeon.stairsPos.gx, this.dungeon.stairsPos.gz);
      if (Math.hypot(this.heroX - sw.x, this.heroZ - sw.z) < 1.25) {
        this.audio.playDescend();
        this.beginTransition(() => {
          this.hp = Math.min(this.getEffectiveMaxHp(), this.hp + 20);
          this.buildLevel(this.depth + 1, { tickBuffFloor: true });
        });
      }
    }
  }

  private updateBoss(e: EnemyEntity, dt: number, dx: number, dz: number, dist: number): void {
    if (!isFloorBoss(e.kind)) return;
    const cfg = BOSS_CONFIGS[e.kind];
    const state = e.bossState ?? 'chase';

    if (e.rig.auraRing) {
      e.rig.auraRing.rotation.z += dt * 0.9;
    }
    if (e.rig.coreMesh) {
      e.rig.coreMesh.rotation.y += dt * 2.4;
      if (e.kind === 'boss_leviathan_heart') {
        const beat = 1 + Math.sin(this.elapsed * 6.5) * 0.16;
        e.rig.coreMesh.scale.setScalar(beat);
      }
    }

    let moveX = 0;
    let moveZ = 0;

    if (state === 'chase') {
      if (e.telegraph) e.telegraph.group.visible = false;

      if (dist < 12.5 && dist > 1.35) {
        const dirX = dx / (dist || 1);
        const dirZ = dz / (dist || 1);
        moveX = dirX * e.speed;
        moveZ = dirZ * e.speed;
        e.facing = Math.atan2(dirX, dirZ);
      }

      if (e.attackCooldown <= 0 && dist < 11.5) {
        const skills = cfg.skills;
        const idx = (e.bossSkillIndex ?? 0) % skills.length;
        let skill: BossSkillKind = skills[idx];

        const hasLOS = hasLineOfSight(
          this.dungeon,
          e.x,
          e.z,
          this.heroX,
          this.heroZ,
          this.doorUnlocked,
          0.35
        );

        const skillRange = (s: BossSkillKind): number => {
          switch (s) {
            case 'ranged_volley':
              return 7.8;
            case 'targeted_blast':
              return 6.4;
            case 'charge_slam':
              return 5.4;
            case 'nova_ring':
              return cfg.triggerRange + 0.55;
            default:
              return cfg.triggerRange;
          }
        };

        const canCastSkill = (s: BossSkillKind): boolean => {
          if (dist > skillRange(s)) return false;
          if ((s === 'ranged_volley' || s === 'charge_slam') && !hasLOS) return false;
          return true;
        };

        let ready = canCastSkill(skill);
        if (!ready && skills.length > 1) {
          // If queued skill is out of range or blocked by a pillar, check another ready skill in kit
          for (let offset = 1; offset < skills.length; offset++) {
            const alt = skills[(idx + offset) % skills.length];
            if (canCastSkill(alt)) {
              skill = alt;
              e.bossSkillIndex = (idx + offset) % skills.length;
              ready = true;
              break;
            }
          }
        }

        if (ready) {
          e.bossSkill = skill;
          e.bossState = 'windup';
          const windupDur =
            skill === 'ranged_volley'
              ? 0.78
              : skill === 'charge_slam'
              ? 0.84
              : skill === 'targeted_blast'
              ? 0.96
              : cfg.windupDuration;
          e.bossStateDuration = windupDur;
          e.bossStateTimer = windupDur;
          e.bossHitApplied = false;
          e.facing = Math.atan2(dx, dz);

          let tx = e.x;
          let tz = e.z;
          let tRad = cfg.telegraphRadius;

          if (skill === 'targeted_blast') {
            // Lock psychic/arcane blast circle directly under the hero's current spot
            tx = this.heroX;
            tz = this.heroZ;
            tRad = 2.25;
          } else if (skill === 'charge_slam') {
            // Find farthest unobstructed landing spot along line toward hero (up to 4.6u)
            const dirX = dx / (dist || 1);
            const dirZ = dz / (dist || 1);
            const maxLunge = Math.min(4.6, Math.max(1.5, dist + 0.35));
            let bestX = e.x;
            let bestZ = e.z;
            const steps = 10;
            for (let s = 1; s <= steps; s++) {
              const frac = (s / steps) * maxLunge;
              const cx = e.x + dirX * frac;
              const cz = e.z + dirZ * frac;
              if (this.canMoveTo(cx, cz, 0.52)) {
                bestX = cx;
                bestZ = cz;
              } else {
                break;
              }
            }
            tx = bestX;
            tz = bestZ;
            tRad = 2.25;
            e.bossChargeStartX = e.x;
            e.bossChargeStartZ = e.z;
          } else if (skill === 'ranged_volley') {
            // Compact charge ring beneath the Boss to telegraph incoming ranged fan
            tx = e.x;
            tz = e.z;
            tRad = 1.45;
          } else if (skill === 'nova_ring') {
            tx = e.x;
            tz = e.z;
            tRad = cfg.telegraphRadius;
          } else {
            // Classic melee slam (Depth 5 first boss & cavern melee slams)
            const leadDist = Math.min(1.1, dist * 0.5);
            tx = e.x + (dx / (dist || 1)) * leadDist;
            tz = e.z + (dz / (dist || 1)) * leadDist;
            tRad = cfg.telegraphRadius;
          }

          e.telegraphX = tx;
          e.telegraphZ = tz;
          e.telegraphRadius = tRad;

          if (e.telegraph) {
            e.telegraph.group.position.set(tx, 0, tz);
            e.telegraph.group.scale.setScalar(tRad);
            e.telegraph.fillDisk.scale.setScalar(0.12);
            e.telegraph.group.visible = true;
          }
          if (skill === 'ranged_volley') {
            this.audio.playMageCast();
          } else {
            this.audio.playBossTelegraph();
          }
          this.emitHud();
        }
      }
    } else if (state === 'windup') {
      e.bossStateTimer = (e.bossStateTimer ?? 0) - dt;
      const dur = e.bossStateDuration || cfg.windupDuration;
      const progress = THREE.MathUtils.clamp(1 - (e.bossStateTimer ?? 0) / dur, 0, 1);
      const skill = e.bossSkill ?? 'slam';

      // For ranged volley, smoothly track hero during the first 60% of windup, then lock aim so player can sidestep
      if (skill === 'ranged_volley' && progress < 0.6) {
        e.facing = Math.atan2(dx, dz);
      }

      // Smoothly fill ground danger circle so player reads exact dodge timing
      if (e.telegraph) {
        e.telegraph.fillDisk.scale.setScalar(0.12 + progress * 0.88);
        e.telegraph.fillMat.opacity = 0.2 + progress * 0.34;
        e.telegraph.ringMat.opacity = 0.72 + Math.sin(this.elapsed * 26) * 0.24;
      }

      if ((e.bossStateTimer ?? 0) <= 0) {
        e.bossState = 'strike';
        const strikeDur =
          skill === 'charge_slam'
            ? 0.34
            : skill === 'ranged_volley'
            ? 0.22
            : cfg.strikeDuration;
        e.bossStateDuration = strikeDur;
        e.bossStateTimer = strikeDur;
        e.bossHitApplied = false;
      }
    } else if (state === 'strike') {
      e.bossStateTimer = (e.bossStateTimer ?? 0) - dt;
      const skill = e.bossSkill ?? 'slam';
      const tx = e.telegraphX ?? e.x;
      const tz = e.telegraphZ ?? e.z;
      const rad = e.telegraphRadius ?? cfg.telegraphRadius;

      const emitShockwave = (cx: number, cz: number, r: number, colorHex: number) => {
        const waveGeo = new THREE.RingGeometry(r * 0.35, r, 28);
        const waveMat = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const waveMesh = new THREE.Mesh(waveGeo, waveMat);
        waveMesh.rotation.x = -Math.PI / 2;
        waveMesh.position.set(cx, 0.14, cz);
        this.scene.add(waveMesh);
        this.slashArcs.push({
          mesh: waveMesh,
          life: 0,
          maxLife: 0.34,
          isCleave: true,
        });

        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const spd = 2.4 + Math.random() * 4.2;
          this.spawnParticle(
            cx + Math.cos(a) * r * 0.4,
            0.25,
            cz + Math.sin(a) * r * 0.4,
            Math.cos(a) * spd,
            2.0 + Math.random() * 3.0,
            Math.sin(a) * spd,
            i % 3 === 0 ? 0xffe484 : colorHex,
            1.35,
            0.55,
            7.2
          );
        }
      };

      if (skill === 'charge_slam') {
        // Dash rapidly from start to locked landing point, leaving a glowing trail, then slam on arrival
        const dur = e.bossStateDuration || 0.34;
        const p = THREE.MathUtils.clamp(1 - (e.bossStateTimer ?? 0) / dur, 0, 1);
        const sx = e.bossChargeStartX ?? e.x;
        const sz = e.bossChargeStartZ ?? e.z;
        const nx = THREE.MathUtils.lerp(sx, tx, p);
        const nz = THREE.MathUtils.lerp(sz, tz, p);
        if (this.canMoveTo(nx, nz, 0.48)) {
          e.x = nx;
          e.z = nz;
        }
        if (Math.random() < dt * 45) {
          this.spawnParticle(
            e.x,
            0.55,
            e.z,
            (Math.random() - 0.5) * 1.4,
            0.7,
            (Math.random() - 0.5) * 1.4,
            cfg.telegraphColor,
            1.2,
            0.35,
            2.0
          );
        }

        if (p >= 0.88 && !e.bossHitApplied) {
          e.bossHitApplied = true;
          if (e.telegraph) e.telegraph.group.visible = false;
          this.audio.playBossSlam();
          this.addScreenShake(0.4, 0.24);
          emitShockwave(e.x, e.z, rad, cfg.telegraphColor);

          const heroDistToImpact = Math.hypot(this.heroX - e.x, this.heroZ - e.z);
          if (heroDistToImpact <= rad) {
            this.damageHero(
              cfg.damage * 0.95 * this.getDepthDamageScale(),
              e.x,
              e.z,
              this.getEnemyLabel(e)
            );
          } else if (heroDistToImpact <= rad + 3.2) {
            this.emitFloatingText(this.heroX, 1.95, this.heroZ, 'DODGED!', 'info');
          }
        }
      } else if (!e.bossHitApplied) {
        e.bossHitApplied = true;
        if (e.telegraph) e.telegraph.group.visible = false;

        if (skill === 'ranged_volley') {
          // Fair 3-shot ranged fan toward locked aim direction
          const projKind: ProjectileKind = cfg.projectileKind ?? 'bio_orb';
          const baseAngle = e.facing;
          const spreadOffsets = [-0.28, 0, 0.28]; // ~16 deg apart
          const projSpeed = projKind === 'bone_dart' ? 7.8 : 6.6;
          const projDmg = cfg.damage * 0.62 * this.getDepthDamageScale();

          this.audio.playMageCast();
          this.addScreenShake(0.2, 0.14);
          for (const offset of spreadOffsets) {
            const a = baseAngle + offset;
            const sdx = Math.sin(a);
            const sdz = Math.cos(a);
            this.spawnProjectile(
              projKind,
              e.x + sdx * 0.85,
              e.z + sdz * 0.85,
              sdx,
              sdz,
              1,
              this.getEnemyLabel(e),
              projSpeed,
              projDmg
            );
          }
          for (let i = 0; i < 14; i++) {
            const a = baseAngle + (Math.random() - 0.5) * 0.9;
            this.spawnParticle(
              e.x + Math.sin(a) * 0.7,
              0.9,
              e.z + Math.cos(a) * 0.7,
              Math.sin(a) * (2.5 + Math.random() * 2.5),
              1.1,
              Math.cos(a) * (2.5 + Math.random() * 2.5),
              cfg.telegraphColor,
              1.1,
              0.4,
              2.5
            );
          }
        } else if (skill === 'nova_ring') {
          // Close shockwave + dodgeable radial orb ring (6 orbs Depth 10-20, 8 orbs Depth 21-30)
          this.audio.playBossSlam();
          this.addScreenShake(0.38, 0.22);
          emitShockwave(tx, tz, rad, cfg.telegraphColor);

          const heroDistToImpact = Math.hypot(this.heroX - tx, this.heroZ - tz);
          if (heroDistToImpact <= rad * 0.92) {
            this.damageHero(
              cfg.damage * 0.9 * this.getDepthDamageScale(),
              tx,
              tz,
              this.getEnemyLabel(e)
            );
          } else if (heroDistToImpact <= rad + 3.0) {
            this.emitFloatingText(this.heroX, 1.95, this.heroZ, 'DODGED!', 'info');
          }

          const orbCount = this.depth >= 21 ? 8 : 6;
          const orbKind: ProjectileKind =
            cfg.projectileKind && cfg.projectileKind !== 'bone_dart'
              ? cfg.projectileKind
              : this.depth >= 21
              ? 'bio_orb'
              : 'mage_orb';
          const orbDmg = cfg.damage * 0.58 * this.getDepthDamageScale();
          const baseAng = e.facing;
          for (let i = 0; i < orbCount; i++) {
            const a = baseAng + (i / orbCount) * Math.PI * 2;
            const sdx = Math.sin(a);
            const sdz = Math.cos(a);
            this.spawnProjectile(
              orbKind,
              tx + sdx * 0.75,
              tz + sdz * 0.75,
              sdx,
              sdz,
              1,
              this.getEnemyLabel(e),
              5.4,
              orbDmg
            );
          }
        } else {
          // 'slam' (classic Depth 5 boss & cavern slams) or 'targeted_blast' (remote psychic blast)
          this.audio.playBossSlam();
          this.addScreenShake(0.42, 0.24);
          emitShockwave(tx, tz, rad, cfg.telegraphColor);

          const heroDistToImpact = Math.hypot(this.heroX - tx, this.heroZ - tz);
          if (heroDistToImpact <= rad) {
            this.damageHero(
              cfg.damage * this.getDepthDamageScale(),
              tx,
              tz,
              this.getEnemyLabel(e)
            );
          } else if (heroDistToImpact <= rad + 3.4) {
            this.emitFloatingText(this.heroX, 1.95, this.heroZ, 'DODGED!', 'info');
          }
        }
      }

      if ((e.bossStateTimer ?? 0) <= 0) {
        e.bossState = 'recover';
        e.bossStateDuration = cfg.recoverDuration;
        e.bossStateTimer = cfg.recoverDuration;
        e.bossSkillIndex = ((e.bossSkillIndex ?? 0) + 1) % cfg.skills.length;
        this.emitHud();
      }
    } else if (state === 'recover') {
      e.bossStateTimer = (e.bossStateTimer ?? 0) - dt;
      if ((e.bossStateTimer ?? 0) <= 0) {
        e.bossState = 'chase';
        e.attackCooldown = 0.65;
        this.emitHud();
      }
    }

    const nextPos = this.moveWithSlide(
      e.x,
      e.z,
      (moveX + e.vx) * dt,
      (moveZ + e.vz) * dt,
      0.52
    );
    e.x = nextPos.x;
    e.z = nextPos.z;
    e.vx *= Math.exp(-11 * dt);
    e.vz *= Math.exp(-11 * dt);

    // Boss Procedural 3D Animation (Distinct Windup -> Slam -> Recover silhouette!)
    e.rig.root.position.set(e.x, 0, e.z);
    e.rig.body.rotation.y = e.facing;
    e.hopPhase += dt * 5.2;

    const hoverY =
      e.kind === 'boss_lich' ||
      e.kind === 'boss_abyssal_brain' ||
      e.kind === 'boss_mothership_ai'
        ? 0.16 + Math.sin(this.elapsed * 3.2) * 0.1
        : 0;

    if (e.bossState === 'windup') {
      const p = THREE.MathUtils.clamp(
        1 - (e.bossStateTimer ?? 0) / (e.bossStateDuration || 1),
        0,
        1
      );
      // Dramatically raise weapon/arms high overhead & lean back
      e.rig.body.position.y = hoverY + p * 0.22;
      e.rig.body.rotation.x = -p * 0.22;
      if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = -p * 2.45;
      if (e.rig.leftArm) {
        e.rig.leftArm.rotation.x = e.kind === 'boss_juggernaut' ? -p * 0.8 : -p * 2.35;
      }
    } else if (e.bossState === 'strike') {
      // Violent downward slam or forward lunge!
      e.rig.body.position.y = hoverY - 0.14;
      e.rig.body.rotation.x = e.bossSkill === 'charge_slam' ? 0.42 : 0.34;
      if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = 1.05;
      if (e.rig.leftArm) {
        e.rig.leftArm.rotation.x = e.kind === 'boss_juggernaut' ? 0.3 : 0.95;
      }
    } else if (e.bossState === 'recover') {
      // Hunched / catching breath — clear visual cue for player to counterattack!
      e.rig.body.position.y = hoverY - 0.08 + Math.sin(this.elapsed * 6) * 0.03;
      e.rig.body.rotation.x = 0.22;
      if (e.rig.weaponArm) e.rig.weaponArm.rotation.x = 0.65;
      if (e.rig.leftArm) e.rig.leftArm.rotation.x = 0.45;
    } else {
      const walkSwing = dist < 12.0 && dist > 1.35 ? Math.sin(e.hopPhase) * 0.42 : 0;
      e.rig.body.position.y = hoverY + Math.abs(walkSwing) * 0.08;
      e.rig.body.rotation.x = THREE.MathUtils.damp(e.rig.body.rotation.x, 0, 10, dt);
      if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = walkSwing;
      if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -walkSwing;
      if (e.rig.weaponArm) {
        e.rig.weaponArm.rotation.x = THREE.MathUtils.damp(
          e.rig.weaponArm.rotation.x,
          -walkSwing * 0.35,
          10,
          dt
        );
      }
      if (e.rig.leftArm) {
        e.rig.leftArm.rotation.x = THREE.MathUtils.damp(
          e.rig.leftArm.rotation.x,
          walkSwing * 0.35,
          10,
          dt
        );
      }
    }

    // Flash white on hit, or pulse warning color during windup
    for (const m of e.rig.flashMaterials) {
      if (e.hitFlash > 0) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.85;
      } else if (e.bossState === 'windup') {
        m.emissive.setHex(cfg.telegraphColor);
        m.emissiveIntensity = 0.25 + Math.sin(this.elapsed * 22) * 0.18;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  }

  private spawnProjectile(
    kind: ProjectileKind,
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    damageMult = 1,
    sourceLabel?: string,
    customSpeed?: number,
    customDamage?: number
  ): void {
    const mesh = createProjectileMesh(kind);
    const isFastShot =
      kind === 'arrow' ||
      kind === 'crystal_shard' ||
      kind === 'bone_dart' ||
      kind === 'plasma_bolt';
    const speed = customSpeed ?? (isFastShot ? 10.2 : 7.4);
    mesh.position.set(x, 0.85, z);
    mesh.rotation.y = Math.atan2(dirX, dirZ);
    this.dynamicGroup.add(mesh);

    this.projectiles.push({
      kind,
      mesh,
      x,
      z,
      vx: dirX * speed,
      vz: dirZ * speed,
      damage: customDamage ?? (isFastShot ? 4 : 5) * this.getDepthDamageScale() * damageMult,
      sourceLabel: sourceLabel ?? (isFastShot ? '遠程射手' : '遠程術士'),
      life: 0,
      maxLife: 2.8,
    });
  }

  private removeProjectileAt(idx: number): void {
    const p = this.projectiles[idx];
    this.dynamicGroup.remove(p.mesh);
    p.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.projectiles.splice(idx, 1);
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.removeProjectileAt(i);
        continue;
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, 0.85, p.z);
      const isOrb =
        p.kind === 'mage_orb' ||
        p.kind === 'spore_orb' ||
        p.kind === 'bio_orb' ||
        p.kind === 'ion_orb';
      if (isOrb) {
        p.mesh.rotation.y += dt * 7;
        p.mesh.rotation.x += dt * 4;
      }

      const trailCol =
        p.kind === 'crystal_shard'
          ? 0x62f5ff
          : p.kind === 'spore_orb'
          ? Math.random() < 0.5
            ? 0x66f59a
            : 0xc2ff78
          : p.kind === 'bone_dart'
          ? 0xffc84d
          : p.kind === 'bio_orb'
          ? Math.random() < 0.5
            ? 0x2ee6b8
            : 0xc6ff66
          : p.kind === 'plasma_bolt'
          ? 0x4dff88
          : p.kind === 'ion_orb'
          ? Math.random() < 0.5
            ? 0xff5ce6
            : 0x6ef2ff
          : p.kind === 'mage_orb'
          ? Math.random() < 0.5
            ? 0x6ef2ff
            : 0xb866ff
          : 0xffe484;

      // Subtle flight trail sparks
      if (Math.random() < dt * (isOrb ? 28 : 16)) {
        this.spawnParticle(
          p.x,
          0.85,
          p.z,
          (Math.random() - 0.5) * 0.5,
          0.25,
          (Math.random() - 0.5) * 0.5,
          trailCol,
          isOrb ? 0.65 : 0.45,
          0.24,
          0
        );
      }

      // Wall, closed-door, or stone-pillar impact check
      const g = worldToGrid(p.x, p.z);
      const tile = this.dungeon.tiles[g.gz]?.[g.gx] ?? 0;
      let hitSolid = tile === 0 || tile === 2 || (tile === 3 && !this.doorUnlocked);
      if (!hitSolid && tile === 5) {
        const px = g.gx * TILE_SIZE;
        const pz = g.gz * TILE_SIZE;
        if (Math.hypot(p.x - px, p.z - pz) < 0.58) hitSolid = true;
      }

      if (hitSolid) {
        for (let k = 0; k < 6; k++) {
          this.spawnParticle(
            p.x,
            0.85,
            p.z,
            (Math.random() - 0.5) * 3.8,
            1.2 + Math.random() * 1.5,
            (Math.random() - 0.5) * 3.8,
            trailCol,
            0.72,
            0.3,
            5
          );
        }
        this.removeProjectileAt(i);
        continue;
      }

      // Hero collision (hero can dash through projectiles!)
      if (this.dashTimer <= 0 && Math.hypot(p.x - this.heroX, p.z - this.heroZ) < 0.58) {
        this.damageHero(p.damage, p.x - p.vx * 0.05, p.z - p.vz * 0.05, p.sourceLabel);
        for (let k = 0; k < 8; k++) {
          this.spawnParticle(
            p.x,
            0.9,
            p.z,
            (Math.random() - 0.5) * 4.2,
            1.4 + Math.random() * 1.6,
            (Math.random() - 0.5) * 4.2,
            trailCol,
            0.82,
            0.32,
            4
          );
        }
        this.removeProjectileAt(i);
      }
    }
  }

  private updateRangedEnemy(e: EnemyEntity, dt: number, dx: number, dz: number, dist: number): void {
    const isArcher = isArcherLikeRanged(e.kind);
    const fireRange = isArcher ? 9.2 : 8.6;
    const minKeepDist = isArcher ? 3.5 : 3.2;
    const aggroRange = 11.5;

    let moveX = 0;
    let moveZ = 0;

    const clearLOS =
      dist < aggroRange &&
      hasLineOfSight(this.dungeon, e.x, e.z, this.heroX, this.heroZ, this.doorUnlocked, 0.24);

    if (dist < aggroRange) {
      const dirX = dx / (dist || 1);
      const dirZ = dz / (dist || 1);
      e.facing = Math.atan2(dirX, dirZ);

      if (e.windupTimer > 0) {
        e.windupTimer -= dt;
        if (e.windupTimer <= 0) {
          // Release terrain-matched projectile!
          this.spawnProjectile(
            getRangedProjectileKind(e.kind),
            e.x + dirX * 0.48,
            e.z + dirZ * 0.48,
            dirX,
            dirZ,
            e.damageMult,
            this.getEnemyLabel(e)
          );
          if (isArcher) {
            this.audio.playBowShot();
            e.attackCooldown = 1.55 + Math.random() * 0.25;
          } else {
            this.audio.playMageCast();
            e.attackCooldown = 1.85 + Math.random() * 0.25;
          }
        }
      } else if (clearLOS && dist <= fireRange && e.attackCooldown <= 0) {
        // Begin short readable draw/cast windup before firing
        e.windupTimer = isArcher ? 0.32 : 0.42;
      } else if (!clearLOS) {
        // Flank sideways around pillars/corners so ranged enemies don't glue themselves behind cover
        const side = e.id % 2 === 0 ? 1 : -1;
        moveX = (dirX * 0.55 - dirZ * 0.84 * side) * e.speed;
        moveZ = (dirZ * 0.55 + dirX * 0.84 * side) * e.speed;
      } else if (dist > fireRange * 0.85) {
        moveX = dirX * e.speed;
        moveZ = dirZ * e.speed;
      } else if (dist < minKeepDist) {
        // Gently kite backward if hero closes in
        moveX = -dirX * e.speed * 0.72;
        moveZ = -dirZ * e.speed * 0.72;
      }

      // Soft separation from other enemies
      for (const other of this.enemies) {
        if (other === e || other.dead) continue;
        const ox = e.x - other.x;
        const oz = e.z - other.z;
        const od = Math.hypot(ox, oz);
        if (od > 0.01 && od < 1.15) {
          moveX += (ox / od) * 1.8;
          moveZ += (oz / od) * 1.8;
        }
      }
    } else {
      e.windupTimer = 0;
    }

    const nextPos = this.moveWithSlide(
      e.x,
      e.z,
      (moveX + e.vx) * dt,
      (moveZ + e.vz) * dt,
      0.38
    );
    e.x = nextPos.x;
    e.z = nextPos.z;
    e.vx *= Math.exp(-9 * dt);
    e.vz *= Math.exp(-9 * dt);

    // Procedural Rig Animation
    e.rig.root.position.set(e.x, 0, e.z);
    e.rig.body.rotation.y = e.facing;
    if (e.rig.auraRing) {
      e.rig.auraRing.rotation.z += dt * 1.4;
    }
    const moving = Math.hypot(moveX, moveZ) > 0.3;
    e.hopPhase += dt * (isArcher ? 8.2 : 5.2);

    if (isArcher) {
      const walkSwing = moving ? Math.sin(e.hopPhase) * 0.45 : 0;
      if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = walkSwing;
      if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -walkSwing;
      if (e.rig.weaponArm) {
        const targetRot = e.windupTimer > 0 ? -0.42 : 0;
        e.rig.weaponArm.rotation.x = THREE.MathUtils.damp(
          e.rig.weaponArm.rotation.x,
          targetRot,
          14,
          dt
        );
      }
      if (e.rig.coreMesh) {
        e.rig.coreMesh.visible = e.windupTimer > 0 || e.attackCooldown < 0.45;
      }
    } else {
      // Caster / hovering eyeball glides & energizes core while casting
      e.rig.body.position.y = (e.kind === 'flesh_eye' ? 0.14 : 0.08) + Math.sin(e.hopPhase) * 0.08;
      if (e.rig.coreMesh) {
        e.rig.coreMesh.rotation.y += dt * (e.windupTimer > 0 ? 11 : 3.2);
        const s = e.windupTimer > 0 ? 1.42 : 1.0;
        e.rig.coreMesh.scale.setScalar(s);
      }
      if (e.rig.weaponArm) {
        const targetRot = e.windupTimer > 0 ? -0.9 : 0;
        e.rig.weaponArm.rotation.x = THREE.MathUtils.damp(
          e.rig.weaponArm.rotation.x,
          targetRot,
          12,
          dt
        );
      }
    }

    // Hit flash or subtle windup telegraph glow
    const windupColor =
      e.kind === 'cavern_spitter'
        ? 0x5cf5ff
        : e.kind === 'cavern_shaman'
        ? 0x6ef7a2
        : e.kind === 'flesh_spiner' || e.kind === 'flesh_eye'
        ? 0xff5ec4
        : e.kind === 'alien_gunner'
        ? 0x4dff88
        : e.kind === 'alien_psion'
        ? 0xff5ce6
        : isArcher
        ? 0xffd24a
        : 0x7ef5ff;
    for (const m of e.rig.flashMaterials) {
      if (e.hitFlash > 0) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.85;
      } else if (e.windupTimer > 0) {
        m.emissive.setHex(windupColor);
        m.emissiveIntensity = 0.32;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (e.dead) continue;

      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.stunTimer = Math.max(0, e.stunTimer - dt);
      e.frozenTimer = Math.max(0, (e.frozenTimer ?? 0) - dt);
      const isFrozen = e.frozenTimer > 0;
      const isSlowed = (e.slowTimer ?? 0) > 0;
      if (isSlowed) e.slowTimer = Math.max(0, (e.slowTimer ?? 0) - dt);
      // Slowed enemies run their whole AI (movement, attack cooldowns, boss windups) on scaled time
      const edt = dt * (isSlowed ? 1 - (e.slowPct ?? 0) : 1);
      e.attackCooldown = Math.max(0, e.attackCooldown - edt);

      if (e.rig.frozenShell) e.rig.frozenShell.visible = isFrozen;
      if (e.rig.slowMarker) {
        e.rig.slowMarker.visible = isSlowed && !isFrozen;
        if (isSlowed) e.rig.slowMarker.rotation.y += dt * 2.2;
      }

      if (e.rig.stunStars) {
        e.rig.stunStars.visible = e.stunTimer > 0;
        if (e.stunTimer > 0) {
          e.rig.stunStars.rotation.y += dt * 5.8;
          e.rig.stunStars.rotation.z = Math.sin(this.elapsed * 7 + e.id) * 0.14;
        }
      }

      if (e.stunTimer > 0 || isFrozen) {
        // Stunned / Frozen: only slide from remaining knockback, sway dizzily, cannot move/attack/cast
        const stunnedPos = this.moveWithSlide(e.x, e.z, e.vx * dt, e.vz * dt, e.isBoss ? 0.72 : 0.38);
        e.x = stunnedPos.x;
        e.z = stunnedPos.z;
        e.vx *= Math.exp(-9 * dt);
        e.vz *= Math.exp(-9 * dt);
        e.rig.root.position.set(e.x, 0, e.z);
        e.rig.body.rotation.z = isFrozen ? 0 : Math.sin(this.elapsed * 18 + e.id) * 0.12;
        if (e.rig.auraRing) {
          e.rig.auraRing.rotation.z += dt * 1.4;
        }
        for (const m of e.rig.flashMaterials) {
          if (e.hitFlash > 0) {
            m.emissive.setHex(0xffffff);
            m.emissiveIntensity = 0.85;
          } else if (isFrozen) {
            m.emissive.setHex(0x7fdcff);
            m.emissiveIntensity = 0.45;
          } else {
            m.emissive.setHex(0xffd24d);
            m.emissiveIntensity = 0.16;
          }
        }
        continue;
      } else if (e.rig.body.rotation.z !== 0) {
        e.rig.body.rotation.z = 0;
      }

      const dx = this.heroX - e.x;
      const dz = this.heroZ - e.z;
      const dist = Math.hypot(dx, dz);

      if (e.isBoss) {
        this.updateBoss(e, edt, dx, dz, dist);
        continue;
      }

      if (e.isRanged) {
        this.updateRangedEnemy(e, edt, dx, dz, dist);
        continue;
      }

      const isSwarm = isSwarmEnemy(e.kind);
      const aggroRange = isSwarm ? 10.5 : 9.5;
      const stopDist = isSwarm ? 0.62 : 0.9;
      const sepRadius = isSwarm ? 0.62 : 1.1;

      let moveX = 0;
      let moveZ = 0;

      // Aggro and pursue hero (swarm critters lock on and rush at 3x speed)
      if (dist < aggroRange && dist > stopDist) {
        const dirX = dx / dist;
        const dirZ = dz / dist;
        moveX = dirX * e.speed;
        moveZ = dirZ * e.speed;
        e.facing = Math.atan2(dirX, dirZ);

        // Soft separation between enemies so packs fan around the hero instead of stacking identically
        for (const other of this.enemies) {
          if (other === e || other.dead) continue;
          const ox = e.x - other.x;
          const oz = e.z - other.z;
          const od = Math.hypot(ox, oz);
          if (od > 0.01 && od < sepRadius) {
            const sepPush = isSwarm ? 2.4 : 1.8;
            moveX += (ox / od) * sepPush;
            moveZ += (oz / od) * sepPush;
          }
        }
      } else if (isSwarm && dist <= stopDist) {
        e.facing = Math.atan2(dx / (dist || 1), dz / (dist || 1));
      }

      const nextPos = this.moveWithSlide(
        e.x,
        e.z,
        (moveX + e.vx) * edt,
        (moveZ + e.vz) * edt,
        isSwarm ? 0.25 : 0.38
      );
      e.x = nextPos.x;
      e.z = nextPos.z;
      e.vx *= Math.exp(-9 * edt);
      e.vz *= Math.exp(-9 * edt);

      // Enemy Attack on Hero
      const isGuard = isGuardianEnemy(e.kind);
      const attackReach = isGuard ? 1.45 : e.isElite ? 1.25 : isSwarm ? 1.05 : 1.12;
      if (dist < attackReach && e.attackCooldown <= 0) {
        e.attackCooldown = isSwarm ? 0.5 : isGuard ? 1.15 : 1.05; // Swarm bites 2 times per second!
        const baseMelee = isGuard ? 9 : isSwarm ? 1.25 + Math.random() * 0.65 : 5;
        // Swarm critters scale gentler with depth (+6%/floor instead of +12%)
        const depthScale = isSwarm ? this.getSwarmDepthDamageScale() : this.getDepthDamageScale();
        this.damageHero(
          baseMelee * depthScale * e.damageMult,
          e.x,
          e.z,
          this.getEnemyLabel(e),
          e
        );
      }

      // Enemy Procedural Rig Animation
      e.rig.root.position.set(e.x, 0, e.z);
      e.rig.body.rotation.y = e.facing;
      if (e.rig.auraRing) {
        e.rig.auraRing.rotation.z += edt * 1.4;
      }
      const isBouncy = e.kind === 'slime' || e.kind === 'flesh_cell';
      const isWingedFlyer = e.kind === 'cavern_bat' || e.kind === 'flesh_parasite';
      const isHoverTech = e.kind === 'wisp' || e.kind === 'alien_probe' || e.kind === 'alien_saucer';
      e.hopPhase +=
        edt * (isSwarm ? 24.0 : isBouncy ? 5.8 : isWingedFlyer ? 14.0 : isHoverTech ? 6.5 : 8.5);

      if (isSwarm) {
        const chasing = dist < aggroRange;
        const scurry = chasing ? Math.sin(e.hopPhase) : Math.sin(e.hopPhase * 0.25) * 0.15;
        if (e.kind === 'flesh_leech') {
          e.rig.body.scale.set(1 + scurry * 0.08, 1 - scurry * 0.06, 1 + scurry * 0.14);
          e.rig.body.position.y = Math.max(0, scurry) * 0.08;
          if (e.rig.coreMesh) {
            const p = 1 + Math.sin(this.elapsed * 9 + e.id) * 0.15;
            e.rig.coreMesh.scale.setScalar(p);
          }
          if (e.rig.weaponArm) {
            e.rig.weaponArm.position.z = e.attackCooldown > 0.34 ? 0.38 : 0.28;
          }
        } else if (e.kind === 'alien_nanobot') {
          e.rig.body.position.y = 0.04 + Math.sin(e.hopPhase * 0.6) * 0.07;
          if (e.rig.coreMesh) e.rig.coreMesh.rotation.z += edt * 16;
          if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = scurry * 0.55;
          if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -scurry * 0.55;
          const snap = e.attackCooldown > 0.34 ? 0.42 : scurry * 0.18;
          if (e.rig.leftArm) e.rig.leftArm.rotation.y = snap;
          if (e.rig.weaponArm) e.rig.weaponArm.rotation.y = -snap;
        } else {
          // dungeon_rat & cavern_mite rapid scurrying gait + fast bite lunge
          e.rig.body.position.y = Math.abs(scurry) * 0.09;
          if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = scurry * 0.72;
          if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -scurry * 0.72;
          if (e.kind === 'cavern_mite') {
            const snap = e.attackCooldown > 0.34 ? 0.45 : scurry * 0.16;
            if (e.rig.leftArm) e.rig.leftArm.rotation.y = snap;
            if (e.rig.weaponArm) e.rig.weaponArm.rotation.y = -snap;
          } else if (e.rig.weaponArm) {
            e.rig.weaponArm.position.z = e.attackCooldown > 0.34 ? 0.32 : 0.2;
          }
        }
      } else if (isBouncy) {
        const bounce = Math.max(0, Math.sin(e.hopPhase));
        e.rig.body.position.y = bounce * 0.42;
        const stretch = 1 + bounce * 0.18;
        const squash = 1 / Math.sqrt(stretch);
        const baseScale = e.isSpecialElite ? 1.38 : e.isElite ? 1.32 : 1;
        e.rig.body.scale.set(squash * baseScale, stretch * baseScale, squash * baseScale);
        if (e.rig.coreMesh) {
          e.rig.coreMesh.rotation.y += edt * 2.5;
        }
      } else if (isWingedFlyer) {
        e.rig.body.position.y = 0.12 + Math.sin(e.hopPhase * 0.45) * 0.16;
        const flap = Math.sin(e.hopPhase) * 0.65;
        if (e.rig.leftArm) e.rig.leftArm.rotation.z = flap;
        if (e.rig.weaponArm) e.rig.weaponArm.rotation.z = -flap;
      } else if (isHoverTech) {
        e.rig.body.position.y = Math.sin(e.hopPhase) * 0.2;
        if (e.rig.coreMesh) {
          e.rig.coreMesh.rotation.y += edt * (e.kind === 'alien_saucer' ? 6.5 : 4.2);
          if (e.kind === 'alien_probe') {
            e.rig.coreMesh.rotation.z += edt * 3.0;
          }
        }
      } else {
        const walkSwing = dist < 9.5 ? Math.sin(e.hopPhase) * 0.5 : 0;
        if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = walkSwing;
        if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -walkSwing;
        if (e.rig.weaponArm) {
          e.rig.weaponArm.rotation.x = e.attackCooldown > 0.75 ? -1.4 : -walkSwing * 0.3;
        }
      }

      // White hit flash
      for (const m of e.rig.flashMaterials) {
        if (e.hitFlash > 0) {
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = 0.85;
        } else if (e.kind === 'slime') {
          m.emissive.setHex(this.dungeon.biome.id === 'ossuary' ? 0x9b5de5 : 0x45d66b);
          m.emissiveIntensity = 0.22;
        } else if (e.kind === 'flesh_cell') {
          m.emissive.setHex(0xa6266e);
          m.emissiveIntensity = 0.28;
        } else if (e.kind === 'flesh_leech') {
          m.emissive.setHex(0x8a1242);
          m.emissiveIntensity = 0.2;
        } else if (e.kind === 'cavern_mite') {
          m.emissive.setHex(0x4b1d8c);
          m.emissiveIntensity = 0.16;
        } else {
          m.emissive.setHex(0x000000);
          m.emissiveIntensity = 0;
        }
      }
    }
  }

  private tryAutoEquipBetterRelic(item: RelicItem): boolean {
    if (this.equippedRelics.length < 4) return false;

    const currentScore = evaluateRelicLoadoutScore(this.equippedRelics);
    let bestSlot = -1;
    let bestScore = currentScore;

    for (let i = 0; i < this.equippedRelics.length; i++) {
      const candidate = [...this.equippedRelics];
      candidate[i] = item;
      const score = evaluateRelicLoadoutScore(candidate);
      if (score > bestScore + 3) {
        bestScore = score;
        bestSlot = i;
      }
    }

    if (bestSlot < 0) return false;

    const replaced = this.equippedRelics[bestSlot];
    this.equippedRelics[bestSlot] = item;
    if (this.relicBag.length < this.relicBagCap) {
      this.relicBag.unshift(replaced);
    } else {
      // Bag full fallback: convert replaced piece into gold
      this.gold += replaced.sellValue;
      this.totalGoldEarned += replaced.sellValue;
    }
    this.recomputeRelicStats(true);
    return true;
  }

  private updateLoot(dt: number): void {
    for (const l of this.loots) {
      if (l.collected) continue;
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
      const dx = this.heroX - l.x;
      const dz = this.heroZ - l.z;
      const dist = Math.hypot(dx, dz);
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
          if (Math.random() < dt * 5.5) {
            const a = Math.random() * Math.PI * 2;
            const r = 0.12 + Math.random() * 0.34;
            this.spawnParticle(
              l.x + Math.cos(a) * r,
              0.25,
              l.z + Math.sin(a) * r,
              0,
              2.2 + Math.random() * 1.8,
              0,
              getRarityColorHex(l.relic.rarity),
              0.72,
              0.9,
              -0.3
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
          const gained = Math.max(1, Math.round(l.value * (1 + this.relicStats.goldPct / 100)));
          this.gold += gained;
          this.totalGoldEarned += gained;
          this.audio.playCoin();
          this.emitFloatingText(l.x, 1.3, l.z, `+${gained}G`, 'gold');
        } else if (l.type === 'potion') {
          this.potions += 1;
          this.audio.playPotion();
          this.emitFloatingText(l.x, 1.3, l.z, '+1 ELIXIR', 'heal');
        } else if (l.type === 'relic' && l.relic) {
          const item = l.relic;
          this.discoveredRelicIds.add(item.templateId);
          const tone: FloatingLabelData['tone'] =
            item.rarity === 'orange'
              ? 'relicOrange'
              : item.rarity === 'green'
              ? 'relicGreen'
              : item.rarity === 'yellow'
              ? 'relicYellow'
              : 'relicBlue';

          if (this.equippedRelics.length < 4) {
            this.equippedRelics.push(item);
            this.recomputeRelicStats(true);
            this.audio.playRelicEquip();
            this.emitFloatingText(l.x, 1.65, l.z, `已裝備：${item.name}`, tone);
          } else if (this.controlMode === 'auto' && this.tryAutoEquipBetterRelic(item)) {
            this.audio.playRelicEquip();
            this.emitFloatingText(l.x, 1.75, l.z, `自動換裝：${item.name}`, tone);
          } else if (this.relicBag.length < this.relicBagCap) {
            this.relicBag.unshift(item);
            this.audio.playRelicEquip();
            this.emitFloatingText(l.x, 1.65, l.z, `獲得：${item.name}`, tone);
          } else {
            // Bag full fallback: auto-convert to gold so loot is never wasted
            this.gold += item.sellValue;
            this.totalGoldEarned += item.sellValue;
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
    }
  }

  private updateEnvironment(dt: number): void {
    // Animate props and collect active light candidates sorted by proximity to hero
    const activeLights: Array<{ prop: AnimatedLightProp; dist: number; intensity: number }> = [];

    const maxLightDist = this.inTown ? 30 : 22;
    for (const lp of this.lightProps) {
      const dist = Math.hypot(lp.x - this.heroX, lp.z - this.heroZ);
      if (lp.kind === 'key' && this.hasKey) continue;
      if (lp.kind === 'gate' && this.doorUnlocked) continue;
      if (dist > maxLightDist) continue;

      let intensity = lp.baseIntensity;

      if (lp.kind === 'brazier' || lp.kind === 'torch') {
        const f =
          Math.sin(this.elapsed * 12.5 + lp.phase) * 3.0 +
          Math.cos(this.elapsed * 23.1 + lp.phase * 1.7) * 1.8;
        intensity = lp.baseIntensity + f;
        if (lp.flame) {
          lp.flame.scale.set(1 + f * 0.025, 1 + f * 0.045, 1 + f * 0.025);
          lp.flame.rotation.y += dt * 3.0;
        }
        if (lp.kind === 'brazier' && Math.random() < dt * 4.5) {
          this.spawnParticle(
            lp.x + (Math.random() - 0.5) * 0.3,
            1.1,
            lp.z + (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.4,
            1.2 + Math.random() * 1.1,
            (Math.random() - 0.5) * 0.4,
            lp.color,
            0.75,
            0.9,
            -0.2
          );
        }
      } else if (lp.kind === 'rune') {
        const pulse = Math.sin(this.elapsed * 3.0 + lp.phase) * 4.0;
        intensity = lp.used
          ? lp.baseIntensity * 0.5 + pulse * 0.5
          : lp.baseIntensity + pulse;
        if (lp.crystal) {
          lp.crystal.visible = !lp.used;
          if (!lp.used) {
            lp.crystal.rotation.y += dt * 1.6;
            lp.crystal.position.y = 0.78 + Math.sin(this.elapsed * 2.6 + lp.phase) * 0.14;
          }
        }
        if (lp.decal) {
          lp.decal.rotation.z += dt * (lp.used ? 0.16 : 0.35);
        }
        if (lp.halo) {
          lp.halo.visible = !lp.used;
          if (!lp.used) {
            const hs = 1.12 + Math.sin(this.elapsed * 3.0 + lp.phase) * 0.16;
            lp.halo.scale.set(hs, hs, 1);
            if (lp.crystal) lp.halo.position.y = lp.crystal.position.y;
          }
        }
        // Gently rising cool arcane sparks from the magic circle
        if (Math.random() < dt * (lp.used ? 1.1 : 4.2)) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.3 + Math.random() * 0.9;
          this.spawnParticle(
            lp.x + Math.cos(a) * r,
            0.12,
            lp.z + Math.sin(a) * r,
            0,
            1.1 + Math.random() * 0.9,
            0,
            lp.color,
            lp.used ? 0.48 : 0.68,
            0.95,
            -0.15
          );
        }
        const effMax = this.getEffectiveMaxHp();
        if (!lp.used && dist < 1.1 && this.hp < effMax) {
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
          this.hp = Math.min(effMax, this.hp + 20);
          this.audio.playPotion();
          this.emitFloatingText(lp.x, 1.7, lp.z, 'SANCTUM +20 HP', 'info');
          this.emitHud();
        }
      } else if (lp.kind === 'altar' || lp.kind === 'shop') {
        const isShop = lp.kind === 'shop';
        const pulse = Math.sin(this.elapsed * 2.8 + lp.phase) * 4.5;
        intensity = lp.baseIntensity + pulse;
        if (lp.crystal) {
          lp.crystal.rotation.y += dt * (isShop ? 1.65 : 1.45);
          lp.crystal.position.y = (isShop ? 1.38 : 1.32) + Math.sin(this.elapsed * 2.4 + lp.phase) * 0.1;
        }
        if (lp.decal) {
          lp.decal.rotation.z -= dt * 0.45;
        }
        if (lp.halo) {
          const hs = (isShop ? 1.36 : 1.42) + Math.sin(this.elapsed * 2.8 + lp.phase) * 0.15;
          lp.halo.scale.set(hs, hs, 1);
          if (lp.crystal) lp.halo.position.y = lp.crystal.position.y;
        }
        if (Math.random() < dt * 4.2) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.28 + Math.random() * 0.65;
          this.spawnParticle(
            lp.x + Math.cos(a) * r,
            0.25,
            lp.z + Math.sin(a) * r,
            0,
            1.15 + Math.random() * 0.85,
            0,
            isShop ? 0xff6b8b : 0xffd966,
            0.66,
            0.95,
            -0.18
          );
        }
      } else {
        intensity = lp.baseIntensity + Math.sin(this.elapsed * 3.5 + lp.phase) * 3.5;
      }

      // Slightly prioritize altars, potion shops, portals, angel, arcane rune circles, and key pedestals
      const priorityBias =
        lp.kind === 'altar' || lp.kind === 'shop' || lp.kind === 'angel' || lp.kind === 'portal'
          ? -4.5
          : lp.kind === 'rune' || lp.kind === 'key' || lp.kind === 'stairs'
          ? -3.5
          : 0;
      activeLights.push({ prop: lp, dist: dist + priorityBias, intensity });
    }

    activeLights.sort((a, b) => a.dist - b.dist);

    // Assign top 8 nearest active light sources into the fast pooled PointLights
    for (let i = 0; i < this.propLightPool.length; i++) {
      const pl = this.propLightPool[i];
      const item = activeLights[i];
      if (item) {
        pl.color.setHex(item.prop.color);
        pl.intensity = item.intensity;
        pl.distance = item.prop.distance;
        pl.decay = item.prop.decay;
        pl.position.set(item.prop.x, item.prop.y, item.prop.z);
      } else {
        pl.intensity = 0;
      }
    }

    // Animate Sanctuary Town White-Robed Angel
    if (this.angelRig) {
      this.angelRig.body.position.y = Math.sin(this.elapsed * 2.1) * 0.08;
      const wingFlutter = Math.sin(this.elapsed * 2.6) * 0.16;
      this.angelRig.leftWing.rotation.y = -0.24 + wingFlutter;
      this.angelRig.rightWing.rotation.y = 0.24 - wingFlutter;
      this.angelRig.haloRing.position.y = 2.08 + Math.sin(this.elapsed * 3.0) * 0.05;
      this.angelRig.lightOrb.rotation.y += dt * 1.9;
      this.angelRig.lightOrb.rotation.x += dt * 1.1;
      this.angelRig.auraPool.rotation.z += dt * 0.55;
      const hs = 2.15 + Math.sin(this.elapsed * 2.4) * 0.18;
      this.angelRig.haloSprite.scale.set(hs, hs, 1);

      if (this.angelPos && Math.random() < dt * 3.8) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.35 + Math.random() * 0.65;
        this.spawnParticle(
          this.angelPos.x + Math.cos(a) * r,
          0.35,
          this.angelPos.z + Math.sin(a) * r,
          0,
          1.0 + Math.random() * 0.85,
          0,
          Math.random() < 0.5 ? 0xfff0a8 : 0xffffff,
          0.62,
          1.15,
          -0.12
        );
      }
    }

    // Animate Swirling Cyan Town Portal (in Town or left behind in Dungeon)
    if (this.townPortalRig) {
      this.townPortalRig.vortex.rotation.z += dt * 1.9;
      this.townPortalRig.outerRing.rotation.z -= dt * 1.2;
      this.townPortalRig.innerRing.rotation.z += dt * 2.5;
      const pulse = 1 + Math.sin(this.elapsed * 3.6) * 0.05;
      this.townPortalRig.halo.scale.set(2.3 * pulse, 2.6 * pulse, 1);
      const px = this.townPortalRig.root.position.x;
      const pz = this.townPortalRig.root.position.z;
      if (Math.random() < dt * 3.5) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.3 + Math.random() * 0.55;
        this.spawnParticle(
          px + Math.cos(a) * r,
          0.3 + Math.random() * 1.4,
          pz + Math.sin(a) * r,
          (Math.random() - 0.5) * 0.3,
          0.9 + Math.random() * 0.7,
          (Math.random() - 0.5) * 0.3,
          Math.random() < 0.5 ? 0x35a8db : 0x8be2ff,
          0.52,
          0.85,
          -0.15
        );
      }
    }

    // Periodic Spike Traps
    for (const sp of this.spikes) {
      const cycle = (this.elapsed + sp.phaseOffset) % 3.6;
      const isWarning = cycle > 1.8 && cycle <= 2.35;
      const isUp = cycle > 2.35 && cycle <= 3.15;
      sp.extended = isUp;

      const targetY = isUp ? 0.04 : -0.46;
      sp.rig.spikesGroup.position.y = THREE.MathUtils.damp(
        sp.rig.spikesGroup.position.y,
        targetY,
        18,
        dt
      );
      sp.rig.warningMat.emissiveIntensity = isWarning ? 1.1 : isUp ? 1.5 : 0.15;

      if (isUp && Math.hypot(this.heroX - sp.x, this.heroZ - sp.z) < 0.72) {
        this.damageHero(6 * this.getDepthDamageScale(), sp.x, sp.z, '尖刺陷阱');
      }
    }
  }

  private updateWallOcclusion(): void {
    if (this.wallTiles.length === 0 || !this.capOpaqueMesh || !this.capFadeMesh) return;

    // 1. Check with slight hysteresis whether any foreground wall is currently blocking the hero
    let hasBlocker = false;
    const fwdMin = this.wallOcclusionActive ? 0.05 : 0.2;
    const fwdMax = this.wallOcclusionActive ? 4.0 : 3.65;
    const sideMax = this.wallOcclusionActive ? 2.15 : 1.88;

    for (let i = 0; i < this.wallTiles.length; i++) {
      const t = this.wallTiles[i];
      const dx = t.wx - this.heroX;
      const dz = t.wz - this.heroZ;
      const fwd = (dx + dz) * 0.70710678;
      if (fwd <= fwdMin || fwd >= fwdMax) continue;
      const side = Math.abs(dx - dz) * 0.70710678;
      if (side < sideMax) {
        hasBlocker = true;
        break;
      }
    }
    this.wallOcclusionActive = hasBlocker;

    // 2. When occluded, ALWAYS fade the nearest 4 foreground wall tiles (with slight distance hysteresis to prevent wobble)
    const desiredOccluded = new Set<WallOcclusionTile>();
    if (hasBlocker) {
      const candidates: Array<{ tile: WallOcclusionTile; score: number }> = [];
      for (let i = 0; i < this.wallTiles.length; i++) {
        const t = this.wallTiles[i];
        const dx = t.wx - this.heroX;
        const dz = t.wz - this.heroZ;
        const fwd = (dx + dz) * 0.70710678;
        if (fwd <= -0.35 || fwd >= 6.4) continue;
        const side = Math.abs(dx - dz) * 0.70710678;
        if (side >= 5.0) continue;
        // Stickiness bonus (-0.28) keeps the 4-tile window steady while walking
        const score = Math.hypot(dx, dz) - (t.occluded ? 0.28 : 0);
        candidates.push({ tile: t, score });
      }
      candidates.sort((a, b) => a.score - b.score);
      const count = Math.min(4, candidates.length);
      for (let i = 0; i < count; i++) {
        desiredOccluded.add(candidates[i].tile);
      }
    }

    let changed = false;
    for (let i = 0; i < this.wallTiles.length; i++) {
      const t = this.wallTiles[i];
      const shouldOcclude = desiredOccluded.has(t);
      if (shouldOcclude !== t.occluded) {
        t.occluded = shouldOcclude;
        changed = true;

        const opaqueWall = this.wallOpaqueMeshes[t.bucketIdx];
        if (shouldOcclude) {
          _pos.set(t.wx, -100, t.wz);
          _quat.identity();
          _scale.set(0, 0, 0);
          _mat4.compose(_pos, _quat, _scale);
          opaqueWall.setMatrixAt(t.wallInstIdx, _mat4);
          this.capOpaqueMesh.setMatrixAt(t.capInstIdx, _mat4);
        } else {
          _pos.set(t.wx, this.wallHeight / 2, t.wz);
          _quat.setFromAxisAngle(_upAxis, t.rotY);
          _scale.set(1, 1, 1);
          _mat4.compose(_pos, _quat, _scale);
          opaqueWall.setMatrixAt(t.wallInstIdx, _mat4);

          _pos.set(t.wx, this.wallHeight + 0.07, t.wz);
          _quat.identity();
          _mat4.compose(_pos, _quat, _scale);
          this.capOpaqueMesh.setMatrixAt(t.capInstIdx, _mat4);
        }
        opaqueWall.instanceMatrix.needsUpdate = true;
        this.capOpaqueMesh.instanceMatrix.needsUpdate = true;
      }
    }

    if (!changed) return;

    // Collect currently occluded wall tiles and sort front-to-back so depthWrite avoids double-blending
    const occludedList: WallOcclusionTile[] = [];
    for (let i = 0; i < this.wallTiles.length; i++) {
      if (this.wallTiles[i].occluded) occludedList.push(this.wallTiles[i]);
    }
    occludedList.sort((a, b) => b.gx + b.gz - (a.gx + a.gz));

    const bucketCounts = new Array<number>(this.wallFadeMeshes.length).fill(0);
    let capCount = 0;
    const maxCap = this.capFadeMesh.instanceMatrix.count;

    for (let i = 0; i < occludedList.length; i++) {
      const t = occludedList[i];
      const fadeWall = this.wallFadeMeshes[t.bucketIdx];
      const maxWall = fadeWall.instanceMatrix.count;

      if (bucketCounts[t.bucketIdx] < maxWall) {
        _pos.set(t.wx, this.wallHeight / 2, t.wz);
        _quat.setFromAxisAngle(_upAxis, t.rotY);
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        fadeWall.setMatrixAt(bucketCounts[t.bucketIdx]++, _mat4);
      }

      if (capCount < maxCap) {
        _pos.set(t.wx, this.wallHeight + 0.07, t.wz);
        _quat.identity();
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        this.capFadeMesh.setMatrixAt(capCount++, _mat4);
      }
    }

    this.capFadeMesh.count = capCount;
    this.capFadeMesh.instanceMatrix.needsUpdate = true;

    for (let b = 0; b < this.wallFadeMeshes.length; b++) {
      this.wallFadeMeshes[b].count = bucketCounts[b];
      this.wallFadeMeshes[b].instanceMatrix.needsUpdate = true;
    }
  }

  private updateParticles(dt: number): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0.05, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;
      const t = p.life / p.maxLife;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - t;
      if (p.shrink) {
        p.mesh.scale.setScalar(p.baseScale * (1 - t * 0.65));
      }
    }

    for (let i = this.slashArcs.length - 1; i >= 0; i--) {
      const s = this.slashArcs[i];
      s.life += dt;
      const t = s.life / s.maxLife;
      if (t >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.slashArcs.splice(i, 1);
        continue;
      }
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      if (s.isShockwave) {
        const easeOut = 1 - Math.pow(1 - t, 2.2);
        mat.opacity = (1 - t) * 0.88;
        s.mesh.scale.setScalar(0.8 + easeOut * ((s.targetScale ?? 4.2) - 0.8));
      } else {
        mat.opacity = (1 - t) * 0.9;
        s.mesh.scale.setScalar(1 + t * (s.isCleave ? 0.35 : 0.22));
        s.mesh.rotation.z += dt * (s.isCleave ? 12 : 8);
      }
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private tick = (): void => {
    if (this.disposed || !this.renderer) return;

    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this.update(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);

    if (this.renderer) {
      this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
      this.renderer.domElement.removeEventListener('contextmenu', this.handleContextMenu);
      this.renderer.domElement.removeEventListener('wheel', this.handleWheel);
      this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    }

    this.clearLevel();
    this.sharedShadowMap?.dispose();
    if (this.heroFloorGlow) {
      this.heroFloorGlow.geometry.dispose();
      const mat = this.heroFloorGlow.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.particleGeo.dispose();
    this.particles.forEach((p) => (p.mesh.material as THREE.Material).dispose());
    this.slashArcs.forEach((s) => {
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    });
    this.audio.dispose();

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentElement === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }
}
