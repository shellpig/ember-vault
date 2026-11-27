import * as THREE from 'three';
import { DungeonAudio } from './audio';
import { Hero, STASH_CAP } from './hero';
import type { CharacterLoadout } from './hero';
import { type RoomMember } from '../../shared/room';
import type {
  GameKind,
} from '../../shared/game';
import {
  ACT_ATTACK,
  ACT_DASH,
  ACT_POMMEL,
  ACT_POTION,
  RETURN_WAIT_MS,
  q100,
} from '../../shared/game';
import {
  TILE_SIZE,
  findGridPath,
  gridToWorld,
  hasLineOfSight,
  isTileWalkable,
  worldToGrid,
  worldToWalkableGrid,
} from './dungeon';
import {
  AngelRig,
  GateRig,
  StashChestRig,
  TownPortalRig,
  applyEliteVisuals,
  createAngelModel,
  createBossTelegraph,
  createCentralWell,
  createEnemyModel,
  createHunterArrowMesh,
  createHunterPetModel,
  PetRig,
  createIceSpikeMesh,
  createFrozenShell,
  createSlowMarker,
  createLootMesh,
  createPotionShop,
  createProjectileMesh,
  createRelicLootMesh,
  createTownHouse,
  createStashChest,
  createTownPortal,
  createUpgradeAltar,
  createVillageLampPost,
  createVillageTree,
  createStunStars,
} from './models';
import {
  RelicDropSource,
  RelicItem,
  evaluateRelicLoadoutScore,
  getRarityColorHex,
  rollAngelBlessing,
  rollRelicDrops,
} from './relics';
import { DungeonTextureSet, createDungeonTextures } from './textures';
import {
  FROST_MAGE,
  HERO_CLASSES,
  HUNTER,
  HeroClassId,
  PET_NAMES,
  PET_SPECIES_LIST,
  UpgradeKind,
  UpgradeOptionView,
  WARRIOR,
  BOT_REGROUP_DIST,
  BOT_REGROUP_DONE_DIST,
  COMPANION_EDGE_NDC,
  COMPANION_WARP_DIST,
  MAX_BOTS,
  getHunterPetMaxHp,
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
  TileType,
  TownPortalOption,
} from './types';








import {
  BOSS_CONFIGS,
  BossSkillKind,
  SPECIAL_ELITE_NAMES,
  TOWN_ALTAR_GRID,
  TOWN_SHOP_GRID,
  TOWN_STASH_GRID,
  getBossForDepth,
  getRangedProjectileKind,
  isArcherLikeRanged,
  isFloorBoss,
  isGuardianEnemy,
  isMageLikeRanged,
  isRangedEnemy,
  isSwarmEnemy,
} from './engine/data';
import {
  AnimatedLightProp,
  BreakableEntity,
  EnemyEntity,
  HeroHitParams,
  HeroProjectileEntity,
  LevelCtx,
  LootEntity,
  MpState,
  Particle,
  PetEntity,
  ProjectileEntity,
  SavedDungeonSnapshot,
  SlashArc,
  SpikeInstance,
  StationRig,
  WallOcclusionTile,
} from './engine/entities';
import {
  _camGoal,
  _camTarget,
  _color,
  _mat4,
  _pos,
  _projVec,
  _quat,
  _scale,
} from './engine/scratch';
import { hudMethods } from './engine/hud';
import { coreMpMethods } from './engine/mp/core';
import { hostMpMethods } from './engine/mp/host';
import { guestMpMethods } from './engine/mp/guest';
import { townMpMethods } from './engine/mp/town';
import { partyMethods } from './engine/party';
import { sceneMethods } from './engine/scene';
import { levelBuildMethods } from './engine/levelBuild';

export type { CharacterLoadout } from './hero';
export { STASH_CAP } from './hero';

/** Result of moving a relic between the bag and the stash. */
export type StashMoveResult =
  | { ok: true }
  | { ok: false; reason: 'closed' | 'notFound' | 'bagFull' | 'stashFull' };

/** Why the engine asks the host to persist the character right now. */
export type SaveCheckpointReason = 'town' | 'leaveTown' | 'floor' | 'death' | 'stash';

/** Everything the room layer hands the engine when a room game starts (P5-B). */
export interface MpConfig {
  role: 'host' | 'guest';
  selfId: string;
  hostId: string;
  members: RoomMember[];
  /** Sends a game message through the room relay (`to` omitted = everybody, host only). */
  send: (kind: GameKind, payload: unknown, to?: string) => void;
  /** A short notice for the player ("XXX 已離開"). */
  onNotice: (msg: string) => void;
  /** P5-C: broadcasts this hero's town position straight to everybody else (not through the host). */
  sendTownPos: (p: { x: number; z: number; f: number; a: 0 | 1 | 2 }) => void;
  /** P7: this client joins a game that is already running (the host puts it in town / at the entrance, no start loadout wait). */
  late?: boolean;
  /** Host only: the floor the room starts on (1..host max depth). Local setting, never sent over the wire. */
  startDepth?: number;
}


interface EngineCallbacks {
  /** Called at save points (town, leaving town, new floor, death) while a saved character is loaded. */
  onSaveCheckpoint?: (reason: SaveCheckpointReason) => void;
  onHudChange: (hud: HudState) => void;
  onBanner: (banner: BannerEvent) => void;
  onFloatingLabel: (label: FloatingLabelData) => void;
  onMinimapUpdate: (snap: MinimapSnapshot) => void;
  onWebGLError: (message: string) => void;
}
export class EmbervaultEngine {
  container: HTMLElement;
  callbacks: EngineCallbacks;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  audio = new DungeonAudio();
  isSoftwareGl = false;

  // Groups
  // The dungeon owns these three groups, the town owns `townGroup` (P4-C). Only the group set of the level the local
  // hero stands in is visible, so the other level costs nothing to render.
  levelGroup = new THREE.Group();
  dynamicGroup = new THREE.Group();
  debrisGroup = new THREE.Group();
  /**
   * Built without touching the global RNG: THREE draws object UUIDs from Math.random, and keeping the draw order of
   * the dungeon identical to before P4-C is what lets the deterministic regression run compare 0 differences.
   */
  townGroup = EmbervaultEngine.createQuietGroup();

  /**
   * Every hero in the run: the local player first, then the bot teammates (`?bots=N`, P4-B).
   * The camera, HUD, minimap, keyboard / pointer input, death screen and saving are bound to the local hero only.
   */
  heroes: Hero[] = [];
  localHeroId = 'hero-0';
  /** Room game state (P5-B). Null = plain single player: every multiplayer path below is skipped. */
  mp: MpState | null = null;
  /** P7: the room link dropped; the simulation (host) / dungeon view (teammate) stands still until it is back. */
  mpPaused = false;
  /**
   * The hero ("actor") that the per-hero engine code currently operates on. All the combat / skill / relic /
   * pickup methods read their hero from here. Outside of a per-hero context it is always the local hero;
   * `setActor()` switches it while the engine loops over heroes (and back with `setActor(localHero)`).
   */
  hero: Hero = new Hero('hero-0');
  /** The hero the camera, HUD and input follow. */
  get localHero(): Hero {
    return this.heroById(this.localHeroId) ?? this.heroes[0];
  }
  /** Dev override: `?bots=N` (0-3) forces N bots and wins over the UI setup. Null when the parameter is absent. */
  readonly botUrlOverride: number | null = EmbervaultEngine.readBotCount();
  /** Bot classes picked in the single-player pre-run screen (one entry per bot, at most MAX_BOTS). */
  botClasses: HeroClassId[] = [];
  /** Last gear fingerprint the bots were synced to (see syncBotGear). */
  botGearKey = '';
  botGearTimer = 0;
  /** Nameplate / ground ring of each bot (cheap, one sprite + one ring per bot). */
  botMarkers = new Map<string, { ring: THREE.Mesh; plate: THREE.Sprite; label: string }>();
  /** Progress bar floating over a downed hero while someone revives them. */
  rescueBars = new Map<string, { group: THREE.Group; fill: THREE.Mesh }>();
  /** Visual of each hero's dungeon portal (`hero.portal` holds the data). The town gate is `townPortalRig`. */
  heroPortalRigs = new Map<string, TownPortalRig>();

  // Persistent lights & hero
  heroLight!: THREE.PointLight;
  heroFloorGlow!: THREE.Mesh;
  propLightPool: THREE.PointLight[] = [];
  hemiLight!: THREE.HemisphereLight;
  rimLight!: THREE.DirectionalLight;
  textures: DungeonTextureSet | null = null;
  sharedShadowMap!: THREE.CanvasTexture;

  // Level data & entities
  dungeon!: DungeonData;
  enemies: EnemyEntity[] = [];
  projectiles: ProjectileEntity[] = [];
  loots: LootEntity[] = [];
  breakables: BreakableEntity[] = [];
  lightProps: AnimatedLightProp[] = [];
  spikes: SpikeInstance[] = [];
  keyPedestal: { root: THREE.Group; keyMesh: THREE.Group; halo: THREE.Sprite } | null =
    null;
  altarRig: StationRig | null = null;
  shopRig: StationRig | null = null;
  gateRig: GateRig | null = null;
  gateOpenProgress = 0;

  // Sanctuary Town & Angel Blessing State
  inTown = false;
  /** Set while the local hero is in town and the dungeon is frozen (nobody alive in it): monsters respawn on return. */
  savedDungeon: SavedDungeonSnapshot | null = null;
  /** The dungeon's own level fields, parked here while the local hero is in town and teammates keep it running. */
  dungeonCtx: LevelCtx | null = null;
  /** True while the town scene exists (the local hero is in it or is on the way). */
  townBuilt = false;
  /** True while the dungeon is simulated in the background (local hero in town): nothing may touch the screen. */
  bgSim = false;
  /** Where the bots wait while the local hero is away from the dungeon (the hero's last spot / portal). */
  awayAnchor: { x: number; z: number } | null = null;
  /** Depth of a floor change that happened while the local hero was in town (shown as a town banner). */
  pendingAwayFloor: number | null = null;
  /** Town-side gate (walk in to return to the dungeon). */
  townGatePos: { x: number; z: number } | null = null;
  angelPos: { x: number; z: number } | null = null;
  angelRig: AngelRig | null = null;
  /** The town-side gate (walk in to return to the dungeon). */
  townPortalRig: TownPortalRig | null = null;
  portalSafePos: { x: number; z: number } | null = null;
  extraTextures: THREE.Texture[] = [];

  // Dynamic 50% translucency for foreground walls occluding the hero
  readonly wallHeight = 2.65;
  wallOpaqueMeshes: THREE.InstancedMesh[] = [];
  wallFadeMeshes: THREE.InstancedMesh[] = [];
  capOpaqueMeshes: THREE.InstancedMesh[] = [];
  capFadeMeshes: THREE.InstancedMesh[] = [];
  wallTiles: WallOcclusionTile[] = [];
  wallOcclusionActive = false;

  // Pools
  particles: Particle[] = [];
  slashArcs: SlashArc[] = [];
  particleGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);

  // Game state shared by everyone in the run (per-hero state lives in `hero`, see hero.ts)
  depth = 1;
  queuedRestartClass: HeroClassId | null = null;
  queuedRestartLoadout: CharacterLoadout | null = null;
  queuedRestartDepth: number | undefined;
  /** True while a cloud-saved character is loaded (enables save checkpoints). */
  persistRun = false;
  /** Suppresses save checkpoints while a run is being (re)built from a save. */
  loadingRun = false;
  heroProjectiles: HeroProjectileEntity[] = [];
  /** Active Hunter pet companions, keyed by owner heroId (max 1 per hunter). */
  pets: Map<string, PetEntity> = new Map();
  hasKey = false;
  doorUnlocked = false;
  runElapsedSec = 0;

  // Town stash chest (the stash contents themselves belong to the hero)
  stashPos: { x: number; z: number } | null = null;
  stashRig: StashChestRig | null = null;

  // Camera & Juice
  camZoom = 1.0;
  shakeTime = 0;
  shakeMag = 0;
  hitStopTimer = 0;
  fadeOpacity = 1.0;
  transitionState: 'none' | 'fadeOut' | 'fadeIn' = 'fadeIn';
  pendingTransitionAction: (() => void) | null = null;

  // Loop & Bookkeeping
  frameId = 0;
  disposed = false;
  lastTime = 0;
  elapsed = 0;
  nextId = 1;
  hudSyncTimer = 0;
  minimapTimer = 0;

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.heroes = [this.hero];

    this.initRenderer();
    this.initScene();
    this.initParticlePool();
    this.setupBots(null);
    this.buildLevel(1);
    this.bindEvents();
    this.lastTime = performance.now();
    this.emitHud();
    this.tick();
  }

  // ---------------------------------------------------------------------------------------------------------
  // Heroes[] plumbing (P4-B): actor switching, bots, rescue
  // ---------------------------------------------------------------------------------------------------------

  static createQuietGroup(): THREE.Group {
    const real = Math.random;
    Math.random = () => 0.5;
    let g: THREE.Group;
    try {
      g = new THREE.Group();
    } finally {
      Math.random = real;
    }
    g.uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : g.uuid;
    return g;
  }

  /** `?bots=N` (0-3): dev override for the number of local bot teammates; null when absent. */
  static readBotCount(): number | null {
    try {
      const raw = new URLSearchParams(window.location.search).get('bots');
      if (raw === null) return null;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? Math.max(0, Math.min(MAX_BOTS, n)) : 0;
    } catch {
      return null;
    }
  }

  /** Clamps a requested start floor to [1, maxDepth]; a missing / invalid request means "the deepest floor". */
  static clampStartDepth(requested: number | undefined, maxDepth: number): number {
    const max = Math.max(1, Math.floor(Number(maxDepth) || 1));
    const want = Number.isFinite(requested) ? Math.floor(requested as number) : max;
    return Math.max(1, Math.min(max, want));
  }

  // ---------------------------------------------------------------------------------------------------------
  // Level contexts (P4-C): the dungeon and the town each own a set of level fields; swap them in and out
  // ---------------------------------------------------------------------------------------------------------

  static readonly RESCUE_RADIUS = 1.5;
  static readonly RESCUE_SECONDS = 3.0;
  /** True while a rescue that involves the local hero is in progress (drives a faster HUD refresh). */
  rescueHudActive = false;

  /** Disposes the town scene (the town's level fields must be the active ones). Safe when no town exists. */
  clearTown(): void {
    this.disposeGroupContents(this.townGroup);
    if (this.textures) {
      this.textures.dispose();
      this.textures = null;
    }
    if (this.extraTextures.length > 0) {
      this.extraTextures.forEach((t) => t.dispose());
      this.extraTextures = [];
    }
    this.lightProps = [];
    this.altarRig = null;
    this.shopRig = null;
    this.angelRig = null;
    this.townPortalRig = null;
    this.townGatePos = null;
    this.angelPos = null;
    this.stashPos = null;
    this.stashRig = null;
    for (const h of this.heroes) h.stashOpen = false;
    this.townBuilt = false;
  }

  /**
   * Leaves the town view for good (new floor / new run): disposes the town, then disposes (or re-activates, so the
   * caller can dispose) the parked dungeon. Afterwards the dungeon's fields are the active ones.
   */
  leaveTownScene(): void {
    if (this.townBuilt) {
      this.clearTown();
      if (this.dungeonCtx) {
        this.applyCtx(this.dungeonCtx);
        this.dungeonCtx = null;
      } else {
        this.applyCtx(this.blankCtx());
      }
    }
    this.inTown = false;
    // Room games: a teammate standing in their own town stays there while my camera leaves mine (P5-C fix: this used
    // to flag them as back in the dungeon, so the host simulated a ghost and sent them a level they never asked for)
    for (const h of this.heroes) if (!h.isRemote) h.inTown = false;
    this.setViewGroups(false);
  }

  /** Moody dusk-night town atmosphere: low ambient lighting so facility & lantern lights drive the mood. */
  applyTownAtmosphere(): void {
    this.scene.background = new THREE.Color(0x090c14);
    this.scene.fog = new THREE.Fog(0x090c14, 36, 72);
    this.hemiLight.color.setHex(0x6c88b8);
    this.hemiLight.groundColor.setHex(0x201a14);
    this.hemiLight.intensity = 0.18;
    this.rimLight.color.setHex(0x9eb8df);
    this.rimLight.intensity = 0.14;
    this.scene.environmentIntensity = 0.08;
    this.heroLight.color.setHex(0xffbe66);
  }

  buildTown(): void {
    // The caller has already parked or disposed the dungeon and activated an empty level field set for the town.
    for (const pet of this.pets.values()) pet.rig.root.visible = false;
    this.townBuilt = true;
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
      shopPos: { ...TOWN_SHOP_GRID }, // Potion Shop on screen LEFT
      altarPos: { ...TOWN_ALTAR_GRID }, // Upgrade Altar on screen LEFT (same side as Potion Shop)
      props: [],
      biome: townBiome,
    };

    this.applyTownAtmosphere();

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
    this.townGroup.add(meadow);

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
    this.townGroup.add(plazaMesh);

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
        this.townGroup.add(post, rail);
      }
    }

    // 3. Two Distinct ~2x Larger Non-Square Exterior Houses
    // Left: Grand Timber & Red-Brown Brick Tavern (no white walls) at gx 4..6, gz 9..12
    const tavern = createTownHouse('tavern', this.textures.glowMap);
    tavern.position.set(4.6 * TILE_SIZE, 0, 10.5 * TILE_SIZE);
    tavern.rotation.y = Math.PI / 2; // Long timber porch, barrels & tavern sign face +X into the plaza
    this.townGroup.add(tavern);
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
    this.townGroup.add(cottage);
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
    this.townGroup.add(well);

    // 5. Beautiful White-Robed Female Angel at (10, 10) framed between the two buildings & well
    const angel = createAngelModel(this.sharedShadowMap, this.textures.glowMap);
    const angelW = gridToWorld(10, 10);
    angel.root.position.set(angelW.x, 0, angelW.z);
    angel.root.rotation.y = Math.PI / 4;
    this.townGroup.add(angel.root);
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

    // 6. Outdoor Potion Shop on screen LEFT (TOWN_SHOP_GRID)
    {
      const sw = gridToWorld(TOWN_SHOP_GRID.gx, TOWN_SHOP_GRID.gz);
      const shop = createPotionShop(this.textures.glowMap);
      shop.root.position.set(sw.x, 0, sw.z);
      this.townGroup.add(shop.root);
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

    // 7. Outdoor Upgrade Altar on screen LEFT (same side as Potion Shop) (TOWN_ALTAR_GRID)
    {
      const aw = gridToWorld(TOWN_ALTAR_GRID.gx, TOWN_ALTAR_GRID.gz);
      const altar = createUpgradeAltar(this.textures.glowMap);
      altar.root.position.set(aw.x, 0, aw.z);
      this.townGroup.add(altar.root);
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
      this.townGroup.add(portal.root);
      this.townPortalRig = portal;
      this.townGatePos = { x: pw.x, z: pw.z };
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

    // 8b. Stash chest (town warehouse) at TOWN_STASH_GRID: open plaza area, clear of portal, altar and shop
    {
      const cg = TOWN_STASH_GRID;
      const cw = gridToWorld(cg.gx, cg.gz);
      const chest = createStashChest(this.textures.glowMap);
      chest.root.position.set(cw.x, 0, cw.z);
      chest.root.rotation.y = Math.PI / 4; // front faces the camera side
      this.townGroup.add(chest.root);
      this.stashRig = chest;
      this.stashPos = { x: cw.x, z: cw.z };
      tiles[cg.gz][cg.gx] = 2; // solid footprint so the hero walks around it
      this.lightProps.push({
        color: 0xffc060,
        baseIntensity: 30,
        distance: 9.5,
        decay: 2.0,
        phase: 3.1,
        x: cw.x,
        y: 1.5,
        z: cw.z,
        halo: chest.halo,
        decal: chest.glowRing,
        kind: 'stash',
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
      this.townGroup.add(lamp);
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
      this.townGroup.add(tree);
    }

    // 10. Place Hero in front of Central Well facing the Angel & Buildings
    const heroStart = gridToWorld(15, 15);
    this.hero.x = heroStart.x;
    this.hero.z = heroStart.z;
    this.hero.vx = 0;
    this.hero.vz = 0;
    this.hero.facing = -Math.PI * 0.75;
    this.hero.rig.root.position.set(this.hero.x, 0, this.hero.z);
    this.hero.rig.body.rotation.y = this.hero.facing;
    this.heroLight.position.set(this.hero.x, 2.0, this.hero.z);
    const camOffset = 14.5 * this.camZoom;
    this.camera.position.set(this.hero.x + camOffset, camOffset * 1.16, this.hero.z + camOffset);
    _camTarget.set(this.hero.x, 0.7, this.hero.z);
    this.camera.lookAt(_camTarget);

    this.pushBanner('庇護小鎮', '左側補給藥水與祭壇強化、向天使祈福，或走入右側傳送門返回地下城');
    this.emitHud();
    this.emitMinimap();
  }

  spawnEnemies(): void {
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

    // Spec §4 headcount scaling: +10% monsters per extra hero. The bonus is computed from the whole floor's regular
    // monster count (so it is felt even when every pack is tiny) and dealt out one by one over the combat rooms.
    const extraHeroes = this.getHeroCount() - 1;
    if (extraHeroes > 0 && combatRooms.length > 0) {
      const regularCount = this.enemies.filter((e) => !e.isBoss).length;
      const bonus = Math.floor((regularCount * extraHeroes) / 10);
      for (let i = 0; i < bonus; i++) {
        const room = combatRooms[i % combatRooms.length];
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
  }

  /** Spec §4: monster HP x (1 + (n - 1)) for n heroes - 2 heroes = 2x, 4 heroes = 4x (bosses and elites included). */
  getEnemyHpScale(): number {
    return 1 + (this.getHeroCount() - 1);
  }

  getDepthDamageScale(): number {
    return 1 + (this.depth - 1) * 0.12;
  }

  getSwarmDepthDamageScale(): number {
    return 1 + (this.depth - 1) * 0.06;
  }

  getDepthGoldScale(): number {
    // +6.5% gold per floor (within 5-8% per floor progression)
    return Math.pow(1.065, Math.max(0, this.depth - 1));
  }

  addEnemy(
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
      const maxHp = Math.round(cfg.baseHp * bossTierScale * this.getEnemyHpScale());
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
  }

  bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.renderer?.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer?.domElement.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('blur', this.handleWindowBlur);
    this.renderer?.domElement.addEventListener('contextmenu', this.handleContextMenu);
    this.renderer?.domElement.addEventListener('wheel', this.handleWheel, { passive: true });
    this.renderer?.domElement.addEventListener('webglcontextlost', this.handleContextLost);
  }

  handleResize = (): void => {
    if (!this.renderer || !this.camera) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.callbacks.onWebGLError('WebGL context was lost. Please reload the page.');
  };

  handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  handleWheel = (e: WheelEvent): void => {
    this.camZoom = THREE.MathUtils.clamp(this.camZoom + e.deltaY * 0.0005, 0.72, 1.35);
  };

  activateManualMode(): void {
    if (!this.audio.isEnabled()) {
      this.audio.unlockAndEnable();
    }
    this.hero.controlMode = 'manual';
    this.emitHud();
  }

  /** When true (menus / account screens), keyboard and pointer input no longer takes over the hero. */
  inputLocked = false;
  /** P6: a trade is being set up or running; gold / bag / stash actions are refused (see setTradeLock). */
  tradeLocked = false;

  public setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
    if (locked) {
      this.hero.input.keys.clear();
      this.hero.input.leftMouseHeld = false;
    }
  }

  handleKeyDown = (e: KeyboardEvent): void => {
    if (this.hero.isDead || this.inputLocked) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Stash window open: the hero stays put (the window handles Esc / F itself).
    if (this.hero.stashOpen) return;
    const code = e.code;

    // Hotkey F: interact with the town stash chest; in the dungeon, revive downed teammate or step through a nearby portal
    if (code === 'KeyF' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (this.inTown && this.isHeroNearStash()) {
        e.preventDefault();
        this.openStash();
      } else if (!this.inTown) {
        const nearDowned = this.heroes.some(
          (other) =>
            other.id !== this.hero.id &&
            other.isDead &&
            !other.inTown &&
            Math.hypot(other.x - this.hero.x, other.z - this.hero.z) <= 1.5
        );
        if (!nearDowned && this.findNearbyDungeonPortal(this.hero)) {
          e.preventDefault();
          this.useDungeonPortal();
        } else {
          this.hero.input.keys.add('KeyF');
        }
      }
      return;
    }

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
      this.hero.input.keys.add(code);
      if (this.inTown) {
        if (!this.audio.isEnabled()) {
          this.audio.unlockAndEnable();
        }
      } else {
        this.activateManualMode();
      }

      if (code === 'Space' && !this.inTown) {
        // Space auto-turns toward the nearest enemy (both classes) before attacking
        if (this.hero.attackCooldown <= 0) {
          this.autoFaceNearestEnemy();
          if (this.mpGuestDungeon()) this.mpQueueAction(ACT_ATTACK);
        }
        this.performAttack();
      } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
        this.performDash();
      } else if (code === 'KeyE' || code === 'KeyQ') {
        this.usePotion();
      }
    }
  };

  handleKeyUp = (e: KeyboardEvent): void => {
    this.hero.input.keys.delete(e.code);
  };

  handlePointerDown = (e: PointerEvent): void => {
    if (this.hero.isDead || this.inTown || this.inputLocked) return;
    this.activateManualMode();
    if (e.button === 2) {
      this.performPommelStrike();
    } else if (e.button === 0) {
      // Left mouse held = keep attacking toward the cursor (both classes); see updateHeldAttack
      this.hero.input.leftMouseHeld = true;
      this.hero.input.pointerClientX = e.clientX;
      this.hero.input.pointerClientY = e.clientY;
      this.updateHeldAttack();
    }
  };

  handlePointerMove = (e: PointerEvent): void => {
    this.hero.input.pointerClientX = e.clientX;
    this.hero.input.pointerClientY = e.clientY;
  };

  handlePointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.hero.input.leftMouseHeld = false;
  };

  handleWindowBlur = (): void => {
    this.hero.input.leftMouseHeld = false;
    this.hero.input.keys.delete('KeyF'); // never keep "holding" the rescue key after the window loses focus
  };

  /** Turns the hero toward the cursor. Returns false if the cursor can't be projected. */
  faceCursor(): boolean {
    if (this.hero.isRemote) {
      // A remote teammate on the host has no cursor here: its client reports the facing it aimed at
      this.hero.facing = this.hero.input.aimFacing;
      this.hero.rig.body.rotation.y = this.hero.facing;
      return true;
    }
    const target = this.screenToGround(this.hero.input.pointerClientX, this.hero.input.pointerClientY);
    if (!target) return false;
    const ax = target.x - this.hero.x;
    const az = target.z - this.hero.z;
    if (Math.hypot(ax, az) < 0.05) return true;
    this.hero.facing = Math.atan2(ax, az);
    this.hero.rig.body.rotation.y = this.hero.facing;
    return true;
  }

  /** While the left mouse button is held in manual mode: face the cursor and attack whenever ready. */
  updateHeldAttack(): void {
    if (!this.hero.input.leftMouseHeld) return;
    if (this.hero.isDead || this.inTown || this.hero.controlMode !== 'manual' || this.transitionState !== 'none') {
      return;
    }
    this.faceCursor();
    if (this.hero.attackCooldown <= 0) this.performAttack();
  }

  // Public UI Control Methods
  public triggerPommelStrike(): void {
    if (this.hero.isDead) return;
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
    if (this.mp?.role === 'guest' && mode === 'auto') return; // a teammate's hero is always steered by its player
    this.hero.controlMode = mode;
    this.hero.ai.path = [];
    this.hero.ai.combatPath = [];
    this.hero.ai.unstuckPath = [];
    this.hero.ai.unstuckTimer = 0;
    this.hero.ai.noProgressTimer = 0;
    this.hero.ai.unstuckAttempts = 0;
    this.hero.ai.progressAnchorX = this.hero.x;
    this.hero.ai.progressAnchorZ = this.hero.z;
    this.emitHud();
  }

  public triggerManualPotion(): void {
    if (this.hero.isDead) return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.usePotion();
  }

  public triggerNewDungeon(): void {
    if (this.mp || this.hero.isDead || this.inTown || this.transitionState !== 'none') return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.audio.playDescend();
    this.beginTransition(() => {
      this.buildLevel(this.depth + 1, { tickBuffFloor: true });
    });
  }

  triggerSkipFloorCheat(): void {
    if (this.mp || this.hero.isDead || this.inTown || this.transitionState !== 'none') return;
    if (this.audio.isEnabled()) {
      this.audio.playDescend();
    }
    const nextDepth = this.depth + 1;
    const bonusGold = nextDepth * 100;
    this.beginTransition(() => {
      this.hero.gold += bonusGold;
      this.hero.totalGoldEarned += bonusGold;
      this.buildLevel(nextDepth, { tickBuffFloor: true });
      this.emitFloatingText(this.hero.x, 2.0, this.hero.z, `+${bonusGold} G`, 'gold');
    });
  }

  /** Freezes the current floor so the town portal can bring the hero back to `portal`. */
  snapshotDungeon(portal: { x: number; z: number }): SavedDungeonSnapshot {
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
    return {
      depth: this.depth,
      dungeon: this.dungeon,
      hasKey: this.hasKey,
      doorUnlocked: this.doorUnlocked,
      chronosUsedThisFloor: this.hero.chronosUsedThisFloor,
      floorKills: this.hero.floorKills,
      returnX: portal.x,
      returnZ: portal.z,
      usedRuneKeys,
      brokenBreakableKeys,
    };
  }

  /** Places a hero's lingering portal landmark (replacing that hero's previous one) in the current dungeon floor. */
  placeHeroPortal(hero: Hero, x: number, z: number, depth: number): void {
    if (!this.textures) return;
    const old = this.heroPortalRigs.get(hero.id);
    if (old) {
      old.root.parent?.remove(old.root);
      old.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        } else if (obj instanceof THREE.Sprite) {
          obj.material.dispose(); // keep the shared glow texture alive
        }
      });
      this.heroPortalRigs.delete(hero.id);
    }
    this.lightProps = this.lightProps.filter((lp) => !(lp.kind === 'portal' && lp.heroId === hero.id));
    const portal = createTownPortal(this.textures.glowMap);
    portal.root.position.set(x, 0, z);
    portal.root.rotation.y = Math.PI / 4;
    this.levelGroup.add(portal.root);
    this.heroPortalRigs.set(hero.id, portal);
    hero.portal = { x, z, depth };
    this.lightProps.push({
      color: 0x35a8db,
      baseIntensity: 21,
      distance: 8.2,
      decay: 2.05,
      phase: 0.4,
      x,
      y: 1.4,
      z,
      kind: 'portal',
      heroId: hero.id,
    });
  }

  /** True while some other hero is alive in the dungeon, i.e. the dungeon keeps running without the local hero. */
  partyHoldsDungeon(): boolean {
    const local = this.localHero;
    return this.heroes.some((h) => h !== local && this.isInDungeonAlive(h));
  }

  /**
   * The local hero walks into the town (runs at the black of the fade; spec §3.4). If a teammate is still alive
   * in the dungeon it is parked and keeps being simulated; otherwise it is frozen exactly like the single player
   * flow (saved, discarded, rebuilt with fresh monsters when somebody comes back).
   */
  enterTownFromDungeon(): void {
    const local = this.localHero;
    this.awayAnchor = { x: local.x, z: local.z };
    local.inTown = true;
    if (this.mp) this.mp.town.last = null; // announce my town position (P5-C)
    if (this.partyHoldsDungeon()) {
      this.dungeonCtx = this.captureCtx();
      this.savedDungeon = null;
    } else {
      // The floor freezes: the teammates still in it (downed) hear about it one last time (P5-C)
      if (this.mp?.role === 'host') this.mpHostFreezeFlush();
      this.savedDungeon = this.snapshotDungeon({ x: local.x, z: local.z });
      this.clearLevel();
      this.dungeonCtx = null;
    }
    this.applyCtx(this.blankCtx());
    this.setViewGroups(true);
    this.buildTown();
  }

  /**
   * Death flow, step 2 (the player pressed 回到城鎮 on the death screen): pay the portal toll
   * (`depth * 10`, floored at 0 gold), refill HP/shield and go through the portal opened at the downed spot.
   */
  public confirmDeathReturn(): void {
    if (!this.hero.isDead || this.inTown || this.transitionState !== 'none') return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    if (this.mp?.role === 'guest') {
      this.mpGuestAskTown(true);
      return;
    }
    const portal = this.hero.portal ?? { x: this.hero.x, z: this.hero.z, depth: this.depth };
    this.hero.portal = portal;
    const cost = this.getTownReturnCost();
    this.hero.gold = Math.max(0, this.hero.gold - cost);
    this.audio.playPortal();
    this.hero.input.keys.clear();
    this.beginTransition(() => {
      this.hero.isDead = false;
      this.hero.restoreAfterDowned();
      this.enterTownFromDungeon();
      this.requestSave('town');
    });
  }

  /**
   * Gets a downed hero (default: the local one) back on their feet at full health, in place, without any toll.
   * The portal stays and they are briefly invulnerable. Called when a teammate finishes the 3 second rescue.
   */
  public reviveHero(target?: Hero): void {
    const t = target ?? this.localHero;
    if (!t.isDead || this.transitionState !== 'none') return;
    t.isDead = false;
    t.restoreAfterDowned();
    t.invuln = 1.5;
    t.rescueTargetId = null;
    t.rescueProgress = 0;
    this.emitFloatingText(t.x, 2.1, t.z, '被救起！', 'heal');
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.spawnParticle(
        t.x + Math.cos(a) * 0.4,
        0.6,
        t.z + Math.sin(a) * 0.4,
        Math.cos(a) * 1.8,
        1.8 + Math.random() * 1.2,
        Math.sin(a) * 1.8,
        i % 2 === 0 ? 0x7dffb0 : 0xffffff,
        1.0,
        0.6,
        -0.6
      );
    }
    this.emitHud();
  }

  public getTownReturnCost(): number {
    return this.depth * 10;
  }

  /** Removes a hero's dungeon portal data and 3D rig (used when the owner returns from town). */
  clearHeroPortal(hero: Hero): void {
    hero.portal = null;
    for (const map of [this.heroPortalRigs, this.dungeonCtx?.heroPortalRigs]) {
      const rig = map?.get(hero.id);
      if (!rig) continue;
      rig.root.parent?.remove(rig.root);
      rig.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      map?.delete(hero.id);
    }
  }

  /** Returns the owner of a nearby active dungeon portal on the current floor, or null. */
  findNearbyDungeonPortal(hero: Hero = this.hero): Hero | null {
    if (this.inTown) return null;
    for (const h of this.heroes) {
      if (!h.portal || h.portal.depth !== this.depth) continue;
      if (Math.hypot(hero.x - h.portal.x, hero.z - h.portal.z) < 2.25) return h;
    }
    return null;
  }

  /** Steps through an existing dungeon portal (own or teammate's) back to town for free (spec §3.1). */
  public useDungeonPortal(): void {
    if (this.hero.isDead || this.inTown || this.transitionState !== 'none' || this.tradeLocked) return;
    if (!this.findNearbyDungeonPortal(this.hero)) return;
    this.returnToTown(true);
  }

  public returnToTown(viaExistingPortal = false): void {
    if (this.hero.isDead || this.inTown || this.transitionState !== 'none') return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    if (this.mp?.role === 'guest') {
      this.mpGuestAskTown(false, viaExistingPortal);
      return;
    }

    const cost = viaExistingPortal ? 0 : this.getTownReturnCost();
    const spent = Math.min(this.hero.gold, cost);
    this.hero.gold = Math.max(0, this.hero.gold - cost);

    // A normal return opens a fresh portal under the hero (replacing any older one);
    // stepping through an existing portal reuses it without opening a new one.
    const partyStays = this.partyHoldsDungeon();
    if (!viaExistingPortal) {
      if (partyStays) {
        // The floor keeps running: the portal is a real, lasting landmark right now
        this.placeHeroPortal(this.hero, this.hero.x, this.hero.z, this.depth);
      } else {
        this.hero.portal = { x: this.hero.x, z: this.hero.z, depth: this.depth };
      }

      // Spawn instantaneous glowing portal at current spot before fading into Sanctuary Town
      if (!partyStays && this.textures) {
        const departPortal = createTownPortal(this.textures.glowMap);
        departPortal.root.position.set(this.hero.x, 0, this.hero.z);
        departPortal.root.rotation.y = Math.PI / 4;
        this.dynamicGroup.add(departPortal.root);
      }
    }
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.spawnParticle(
        this.hero.x + Math.cos(a) * 0.35,
        0.7,
        this.hero.z + Math.sin(a) * 0.35,
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
      this.hero.x,
      2.1,
      this.hero.z,
      spent > 0 ? `回城鎮 -${spent}G` : '回城鎮',
      'info'
    );
    this.hero.input.keys.clear();
    this.emitHud();

    this.beginTransition(() => {
      this.enterTownFromDungeon();
      this.requestSave('town');
    });
  }

  /** The dungeon data behind the town gate (parked while running, kept in the frozen snapshot otherwise). */
  getParkedDungeon(): DungeonData | null {
    return this.dungeonCtx?.dungeon ?? this.savedDungeon?.dungeon ?? null;
  }

  /**
   * Doors the town gate can lead to (spec §3.1): everybody's portal on the current floor, the local hero's first.
   * No portal at all (e.g. after a floor change): the floor entrance (spec §5.3).
   */
  getTownPortalOptions(): TownPortalOption[] {
    if (!this.inTown) return [];
    const local = this.localHero;
    const opts: TownPortalOption[] = [];
    for (const h of this.heroes) {
      if (!h.portal || h.portal.depth !== this.depth) continue;
      opts.push({
        id: h.id,
        label:
          h === local
            ? '我的傳送門'
            : h.displayName
            ? `${h.displayName} 的傳送門`
            : h.isBot
            ? `${h.displayName || `Bot ${h.botIndex}`} 的傳送門`
            : '隊友的傳送門',
        isOwn: h === local,
        downed: h.isDead || (this.mp?.role === 'guest' && h !== local && this.mp.guest.partyState.get(h.id) === 2),
      });
    }
    if (opts.length === 0) {
      opts.push({ id: 'entrance', label: `第 ${this.depth} 層入口`, isOwn: false, downed: false });
    }
    return opts;
  }

  resolveGateTarget(portalId?: string): { x: number; z: number } | null {
    const opts = this.getTownPortalOptions();
    const pick = opts.find((o) => o.id === portalId) ?? opts[0];
    if (!pick) return null;
    if (pick.id !== 'entrance') {
      const owner = this.heroById(pick.id);
      if (owner?.portal) return { x: owner.portal.x, z: owner.portal.z };
    }
    const d = this.getParkedDungeon();
    if (!d) return null;
    return gridToWorld(d.spawn.gx, d.spawn.gz);
  }

  /** The local hero steps out of the town gate into the dungeon (runs at the black of the fade). */
  enterDungeonFromTown(target: { x: number; z: number }): void {
    // Owner returning from town closes their own portal (teammates' portals stay open)
    this.clearHeroPortal(this.localHero);
    const snap = this.savedDungeon;
    if (snap) {
      // Frozen floor: rebuild it with fresh monsters around the chosen portal (spec §3.4)
      this.savedDungeon = null;
      snap.returnX = target.x;
      snap.returnZ = target.z;
      this.buildLevel(snap.depth, { savedSnapshot: snap });
      return;
    }
    if (!this.dungeonCtx) return;
    // Running floor: nothing is rebuilt, the local hero simply steps back in
    const local = this.localHero;
    this.leaveTownScene();
    this.applyDungeonAtmosphere();
    local.x = target.x;
    local.z = target.z;
    local.vx = 0;
    local.vz = 0;
    local.dashTimer = 0;
    local.invuln = Math.max(local.invuln, 1.0);
    local.ai.path = [];
    local.ai.combatPath = [];
    local.ai.progressAnchorX = local.x;
    local.ai.progressAnchorZ = local.z;
    local.ai.noProgressTimer = 0;
    local.rig.root.position.set(local.x, 0, local.z);
    local.rig.body.rotation.y = local.facing;
    this.heroLight.position.set(local.x, 2.0, local.z);
    if (this.depth > local.maxDepthReached) {
      local.maxDepthReached = this.depth;
      this.requestSave('floor');
    }
    const camOffset = 14.5 * this.camZoom;
    this.camera.position.set(local.x + camOffset, camOffset * 1.16, local.z + camOffset);
    _camTarget.set(local.x, 0.7, local.z);
    this.camera.lookAt(_camTarget);
    const g = worldToGrid(local.x, local.z);
    this.markExplored(g.gx, g.gz);
    this.pushBanner(`返回第 ${this.depth} 層`, '隊友仍在戰鬥 · 怪物沒有重生');
    this.updateWallOcclusion();
    this.emitHud();
    this.emitMinimap();
  }

  /** Walks through the town gate. `portalId` picks one of `getTownPortalOptions()` (default: the first). */
  public returnToDungeon(portalId?: string): void {
    if (this.hero.isDead || !this.inTown || this.transitionState !== 'none' || this.tradeLocked) return;
    if (this.mp?.role === 'guest') {
      this.mpGuestReturn(portalId);
      return;
    }
    if (!this.savedDungeon && !this.dungeonCtx) return;
    const target = this.resolveGateTarget(portalId);
    if (!target) return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.audio.playPortal();
    this.hero.input.keys.clear();

    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.spawnParticle(
        this.hero.x + Math.cos(a) * 0.35,
        0.7,
        this.hero.z + Math.sin(a) * 0.35,
        Math.cos(a) * 2.2,
        2.2 + Math.random() * 1.2,
        Math.sin(a) * 2.2,
        i % 2 === 0 ? 0x56e4ff : 0xffffff,
        1.05,
        0.6,
        -0.4
      );
    }

    this.requestSave('leaveTown');
    this.beginTransition(() => {
      this.enterDungeonFromTown(target);
    });
  }

  public requestAngelBlessing(): boolean {
    if (this.hero.isDead || !this.inTown || !this.isHeroNearAngel() || this.hero.angelBuff) {
      return false;
    }
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();

    const buff = rollAngelBlessing(this.depth);
    this.hero.angelBuff = buff;
    this.hero.recomputeRelicStats(true);
    this.audio.playAngelBlessing();

    const tone: FloatingLabelData['tone'] =
      buff.rarity === 'orange'
        ? 'relicOrange'
        : buff.rarity === 'yellow'
        ? 'relicYellow'
        : 'relicBlue';
    this.emitFloatingText(this.hero.x, 2.25, this.hero.z, `獲得祝福：${buff.name}`, tone);

    const ax = this.angelPos?.x ?? this.hero.x;
    const az = this.angelPos?.z ?? this.hero.z;
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
    return this.hero.classId;
  }

  /** Swap the hero 3D rig to match the given class (no-op if already matching). */
  applyHeroClassRig(classId: HeroClassId): void {
    if (!this.hero.rig || !this.sharedShadowMap) return;
    const currentClass = this.hero.rig.root.userData.heroClassId as HeroClassId | undefined;
    if (currentClass === classId) return;
    this.hero.rig.root.remove(this.hero.setAura.group);
    this.scene.remove(this.hero.rig.root);
    this.hero.rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.hero.rig = this.createHeroRigForClass(classId);
    if (this.heroLight) {
      this.heroLight.color.setHex(
        classId === 'frost_mage'
          ? 0x9fe6ff
          : classId === 'hunter'
          ? 0xff9b6a
          : this.dungeon?.biome.torchColor ?? 0xffaa44
      );
    }
    this.hero.rig.root.add(this.hero.setAura.group);
    this.hero.rig.root.position.set(this.hero.x, 0, this.hero.z);
    this.scene.add(this.hero.rig.root);
  }

  /**
   * Restarts the run. Without `loadout` this is the attract-mode / legacy restart (fresh hero, depth 1,
   * auto-pilot, nothing persisted). With `loadout` the hero is rebuilt from a character save: upgrades,
   * relics, gold, potions are restored, derived stats are recomputed and the run starts on `startDepth` (default and upper bound: `maxDepth`).
   */
  public restartRun(classId?: HeroClassId, loadout?: CharacterLoadout, startDepth?: number): void {
    const nextClass: HeroClassId = classId ?? this.hero.classId;
    if (this.transitionState !== 'none') {
      // A fade is in progress (e.g. the initial fade-in): run the restart as soon as it ends.
      this.queuedRestartClass = nextClass;
      this.queuedRestartLoadout = loadout ?? null;
      this.queuedRestartDepth = startDepth;
      return;
    }
    this.queuedRestartClass = null;
    this.queuedRestartLoadout = null;
    this.queuedRestartDepth = undefined;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.audio.playDescend();
    this.beginTransition(() => {
      this.clearAllPets();
      this.hero.resetForNewRun();
      this.inTown = false;
      this.savedDungeon = null;
      this.awayAnchor = null;
      this.pendingAwayFloor = null;
      this.portalSafePos = null;
      this.loadingRun = true;
      this.persistRun = Boolean(loadout);
      this.hero.applyClassStats(nextClass);
      this.applyHeroClassRig(nextClass);
      this.runElapsedSec = 0;
      let firstDepth = 1;
      let deepest = 1;
      if (loadout) {
        this.hero.applyLoadout(loadout);
        // The player may start shallower than their deepest floor; max depth itself never goes down
        deepest = Math.max(1, Math.floor(loadout.maxDepth));
        firstDepth = EmbervaultEngine.clampStartDepth(startDepth, deepest);
      } else {
        this.hero.controlMode = 'auto';
      }
      this.hero.maxDepthReached = deepest;
      this.hero.recomputeRelicStats(false);
      if (loadout) {
        // Derived stats (max HP / shield incl. relic bonuses) are final now: start the run at full health.
        this.hero.hp = this.hero.getEffectiveMaxHp();
        this.hero.shield = this.hero.getEffectiveMaxShield();
      }
      this.hero.input.keys.clear();
      this.hero.rig.body.rotation.z = 0;
      this.hero.rig.body.position.y = 0;
      if (this.mp) {
        // Room game: the floor comes later (host: once every loadout is in; teammate: the host's level message)
        this.setupBots(null);
        this.hero.controlMode = 'manual';
        this.mpHold('start', this.mp.role === 'host' ? '正在載入隊友的角色…' : this.mp.late ? '正在加入進行中的遊戲…' : '等待房主建立地城…');
        if (this.mp.role === 'host') this.mp.host!.waitStart = performance.now();
        return;
      }
      // Bot teammates start from a copy of the local loadout (fresh each run); none when ?bots=0
      this.setupBots(loadout ?? null);
      this.buildLevel(firstDepth);
      this.loadingRun = false;
    });
  }

  /** Snapshot of the persistent character state (gold, upgrades, relics, potions, max depth) for saving. */
  public exportCharacterState(): CharacterLoadout {
    // A local hero in town has not reached a floor a teammate may have descended to meanwhile
    return this.localHero.exportLoadout(this.localHero.inTown ? this.localHero.maxDepthReached : this.depth);
  }

  requestSave(reason: SaveCheckpointReason): void {
    // Only the local character is ever saved (bots and remote teammates never touch the API)
    if (this.hero.isBot || this.hero.isRemote) return;
    if (this.persistRun && !this.loadingRun) this.callbacks.onSaveCheckpoint?.(reason);
  }

  /**
   * P6: while a trade is open (or being requested) the town character's gold / bag / stash must not change, because D1 is
   * the authority until the trade ends. Closes the stash window; the caller flushes the save right after locking.
   */
  public setTradeLock(locked: boolean): void {
    if (locked === this.tradeLocked) return;
    if (locked && this.localHero.stashOpen) this.closeStash();
    this.tradeLocked = locked;
    this.emitHud();
  }

  /** P6: replaces the traded parts of the local character (gold, bag, stash) with the server's version after a trade. */
  public applyTradeSave(save: { gold: number; bag: RelicItem[]; stash: RelicItem[] }): void {
    const h = this.localHero;
    h.gold = save.gold;
    h.relicBag = save.bag.slice(0, h.relicBagCap).map((r) => ({ ...r }));
    h.stash = save.stash.slice(0, STASH_CAP).map((r) => ({ ...r }));
    this.emitHud();
  }

  public equipRelic(relicId: string, replaceSlotIndex?: number): boolean {
    if (this.hero.isDead || this.tradeLocked) return false;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'eq', id: relicId, s: replaceSlotIndex });
      return true;
    }
    const bagIdx = this.hero.relicBag.findIndex((r) => r.id === relicId);
    if (bagIdx === -1) return false;

    const item = this.hero.relicBag[bagIdx];
    if (this.hero.equippedRelics.length < 4 && replaceSlotIndex === undefined) {
      this.hero.relicBag.splice(bagIdx, 1);
      this.hero.equippedRelics.push(item);
    } else {
      const slot =
        replaceSlotIndex !== undefined &&
        replaceSlotIndex >= 0 &&
        replaceSlotIndex < this.hero.equippedRelics.length
          ? replaceSlotIndex
          : 0;
      const swappedOut = this.hero.equippedRelics[slot];
      this.hero.relicBag.splice(bagIdx, 1);
      this.hero.equippedRelics[slot] = item;
      if (swappedOut) {
        this.hero.relicBag.unshift(swappedOut);
      }
    }

    this.hero.recomputeRelicStats(true);
    this.audio.playRelicEquip();
    this.emitHud();
    return true;
  }

  public unequipRelic(slotIndex: number): boolean {
    if (this.hero.isDead || this.tradeLocked) return false;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'uneq', s: slotIndex });
      return true;
    }
    if (slotIndex < 0 || slotIndex >= this.hero.equippedRelics.length) return false;
    if (this.hero.relicBag.length >= this.hero.relicBagCap) return false;

    const [removed] = this.hero.equippedRelics.splice(slotIndex, 1);
    this.hero.relicBag.unshift(removed);
    this.hero.recomputeRelicStats(true);
    this.audio.playRelicEquip();
    this.emitHud();
    return true;
  }

  public sellRelic(relicId: string): boolean {
    if (this.hero.isDead || this.tradeLocked || !this.isHeroNearShop()) return false;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'sell', id: relicId });
      return true;
    }
    const bagIdx = this.hero.relicBag.findIndex((r) => r.id === relicId);
    if (bagIdx === -1) return false;

    if (!this.audio.isEnabled() && this.hero.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    const [sold] = this.hero.relicBag.splice(bagIdx, 1);
    this.hero.gold += sold.sellValue;
    this.hero.totalGoldEarned += sold.sellValue;
    this.audio.playRelicSell();
    this.emitFloatingText(this.hero.x, 1.9, this.hero.z, `+${sold.sellValue} G`, 'gold');
    this.emitHud();
    return true;
  }

  public sellCommonBagRelics(includeYellow = true): number {
    if (this.hero.isDead || this.tradeLocked || !this.isHeroNearShop()) return 0;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'sellc', y: includeYellow ? 1 : 0 });
      return 0;
    }
    let earned = 0;
    const keep: RelicItem[] = [];
    for (const r of this.hero.relicBag) {
      if (r.rarity === 'blue' || (includeYellow && r.rarity === 'yellow')) {
        earned += r.sellValue;
      } else {
        keep.push(r);
      }
    }
    if (earned <= 0) return 0;

    if (!this.audio.isEnabled() && this.hero.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    this.hero.relicBag = keep;
    this.hero.gold += earned;
    this.hero.totalGoldEarned += earned;
    this.audio.playRelicSell();
    this.emitFloatingText(this.hero.x, 2.0, this.hero.z, `售出 +${earned} G`, 'gold');
    this.emitHud();
    return earned;
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
      count: this.hero.getUpgradeCount(kind),
      maxCount: this.hero.getUpgradeMax(kind),
      maxed: this.hero.isUpgradeMaxed(kind),
    });
    if (this.hero.isMage()) {
      const speedPct = Math.round(this.hero.shieldSpeedUpgrades * FROST_MAGE.shieldSpeedStep * 100);
      return [
        row(
          'hp_shield',
          'shield',
          `HP +${FROST_MAGE.hpPerUpgrade} · 護盾 +${FROST_MAGE.shieldPerUpgrade}`,
          'HP / 護盾 MAXED',
          `${this.hero.hpShieldUpgrades} / ${FROST_MAGE.maxHpShieldUpgrades} · HP ${this.hero.maxHp} · 護盾 ${this.hero.baseMaxShield}`
        ),
        row(
          'atk',
          'atk',
          '+10% 攻擊力',
          'ATK MAXED',
          `+${this.hero.atkUpgrades * 10}% / +${FROST_MAGE.maxAtkUpgrades * 10}% DMG`
        ),
        row(
          'crit',
          'crit',
          '+2% 爆擊',
          'CRIT MAXED',
          `+${this.hero.critUpgrades * 2}% / +${FROST_MAGE.maxCritUpgrades * 2}% CRIT`
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
    if (this.hero.isHunter()) {
      const spdPct = Math.round(this.hero.atkSpeedUpgrades * HUNTER.atkSpeedStep * 100);
      const maxSpdPct = Math.round(HUNTER.maxAtkSpeedUpgrades * HUNTER.atkSpeedStep * 100);
      return [
        row(
          'hp',
          'hp',
          `+${HUNTER.hpPerUpgrade} Max HP`,
          'HP MAXED',
          `${this.hero.maxHp} / ${this.hero.getBaseMaxHpCap()} HP`
        ),
        row(
          'atk',
          'atk',
          '+10% Attack',
          'ATK MAXED',
          `+${this.hero.atkUpgrades * 10}% / +${HUNTER.maxAtkUpgrades * 10}% DMG`
        ),
        row(
          'atk_speed',
          'atkSpeed',
          '+10% 攻速',
          '攻速已滿',
          `+${spdPct}% / +${maxSpdPct}% 射速`
        ),
        row(
          'crit',
          'crit',
          `+${HUNTER.critPerUpgradePct}% Crit`,
          'CRIT MAXED',
          `+${this.hero.critUpgrades * HUNTER.critPerUpgradePct}% / +${HUNTER.maxCritUpgrades * HUNTER.critPerUpgradePct}% CRIT`
        ),
      ];
    }
    return [
      row(
        'hp',
        'hp',
        `+${WARRIOR.hpPerUpgrade} Max HP`,
        'HP MAXED',
        `${this.hero.maxHp} / ${this.hero.maxHpCap} HP`
      ),
      row(
        'atk',
        'atk',
        '+10% Attack',
        'ATK MAXED',
        `+${this.hero.atkUpgrades * 10}% / +${this.hero.maxAtkUpgrades * 10}% DMG`
      ),
      row(
        'armor',
        'armor',
        '+10% Armor',
        'DEF MAXED',
        `${this.hero.armorUpgrades * 10}% / ${this.hero.maxArmorUpgrades * 10}% DEF`
      ),
      row(
        'crit',
        'crit',
        '+2% Crit',
        'CRIT MAXED',
        `+${this.hero.critUpgrades * 2}% / +${this.hero.maxCritUpgrades * 2}% CRIT`
      ),
    ];
  }

  public getUpgradeCost(): number {
    const lv = this.hero.getTotalUpgradeLevel();
    return 40 + lv * 25 + Math.floor(lv * lv * 4);
  }

  public getPotionCost(): number {
    return this.depth * 10;
  }

  isHeroNearAltar(): boolean {
    if (!this.dungeon?.altarPos) return false;
    const aw = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
    return Math.hypot(this.hero.x - aw.x, this.hero.z - aw.z) < 2.55;
  }

  isHeroNearShop(): boolean {
    if (!this.dungeon?.shopPos) return false;
    const sw = gridToWorld(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
    return Math.hypot(this.hero.x - sw.x, this.hero.z - sw.z) < 2.55;
  }

  isHeroNearPortal(): boolean {
    if (this.inTown) {
      if (!this.townGatePos) return false;
      return Math.hypot(this.hero.x - this.townGatePos.x, this.hero.z - this.townGatePos.z) < 2.25;
    }
    return this.findNearbyDungeonPortal(this.localHero) !== null;
  }

  isHeroNearStash(): boolean {
    if (!this.inTown || !this.stashPos) return false;
    return Math.hypot(this.hero.x - this.stashPos.x, this.hero.z - this.stashPos.z) < 2.75;
  }

  /** Opens the stash window. Only in town, next to the chest, on a saved character (never for attract mode). */
  public openStash(): boolean {
    if (this.hero.isDead || !this.inTown || !this.persistRun || this.loadingRun || this.tradeLocked) return false;
    if (this.transitionState !== 'none' || !this.isHeroNearStash()) return false;
    if (this.hero.stashOpen) return true;
    this.hero.stashOpen = true;
    this.hero.input.keys.clear();
    this.hero.input.leftMouseHeld = false;
    this.audio.playRelicEquip();
    this.emitHud();
    return true;
  }

  /** Closes the stash window and asks the host to save. Safe to call when already closed. */
  public closeStash(): void {
    if (!this.hero.stashOpen) return;
    this.hero.stashOpen = false;
    this.hero.input.keys.clear();
    this.audio.playRelicEquip();
    this.requestSave('stash');
    this.emitHud();
  }

  /** Bag -> stash. Equipped relics must be unequipped to the bag first. */
  public depositRelic(relicId: string): StashMoveResult {
    if (!this.hero.stashOpen || !this.inTown || this.hero.isDead || this.tradeLocked) return { ok: false, reason: 'closed' };
    const idx = this.hero.relicBag.findIndex((r) => r.id === relicId);
    if (idx === -1) return { ok: false, reason: 'notFound' };
    if (this.hero.stash.length >= STASH_CAP) return { ok: false, reason: 'stashFull' };
    const [item] = this.hero.relicBag.splice(idx, 1);
    this.hero.stash.push(item);
    this.audio.playRelicEquip();
    this.emitHud();
    return { ok: true };
  }

  /** Sells a relic directly from the bag or town stash while the stash modal is open. */
  public sellRelicInStash(
    relicId: string,
    source: 'bag' | 'stash'
  ): { ok: true; gold: number; name: string } | { ok: false; reason: 'closed' | 'notFound' } {
    if (!this.hero.stashOpen || !this.inTown || this.hero.isDead || this.tradeLocked) {
      return { ok: false, reason: 'closed' };
    }
    const list = source === 'bag' ? this.hero.relicBag : this.hero.stash;
    const idx = list.findIndex((r) => r.id === relicId);
    if (idx === -1) return { ok: false, reason: 'notFound' };
    const [item] = list.splice(idx, 1);
    this.hero.gold += item.sellValue;
    this.hero.totalGoldEarned += item.sellValue;
    this.audio.playCoin();
    this.emitHud();
    return { ok: true, gold: item.sellValue, name: item.name };
  }

  /** Stash -> bag. */
  public withdrawRelic(relicId: string): StashMoveResult {
    if (!this.hero.stashOpen || !this.inTown || this.hero.isDead || this.tradeLocked) return { ok: false, reason: 'closed' };
    const idx = this.hero.stash.findIndex((r) => r.id === relicId);
    if (idx === -1) return { ok: false, reason: 'notFound' };
    if (this.hero.relicBag.length >= this.hero.relicBagCap) return { ok: false, reason: 'bagFull' };
    const [item] = this.hero.stash.splice(idx, 1);
    this.hero.relicBag.unshift(item);
    this.audio.playRelicEquip();
    this.emitHud();
    return { ok: true };
  }

  isHeroNearAngel(): boolean {
    if (!this.inTown || !this.angelPos) return false;
    return Math.hypot(this.hero.x - this.angelPos.x, this.hero.z - this.angelPos.z) < 2.75;
  }

  public purchaseUpgrade(kind: UpgradeKind): boolean {
    if (this.tradeLocked || !this.dungeon?.altarPos || !this.isHeroNearAltar()) return false;
    if (this.mpGuestDungeon()) {
      if (this.hero.gold < this.getUpgradeCost() || this.hero.getUpgradeMax(kind) <= 0 || this.hero.isUpgradeMaxed(kind)) return false;
      this.mpGuestCmd({ c: 'up', kind });
      return true;
    }
    const cost = this.getUpgradeCost();
    if (this.hero.gold < cost) return false;
    if (this.hero.getUpgradeMax(kind) <= 0 || this.hero.isUpgradeMaxed(kind)) return false;

    if (!this.audio.isEnabled() && this.hero.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    this.hero.gold -= cost;
    const effMax = this.hero.getEffectiveMaxHp();
    if (kind === 'hp_shield') {
      this.hero.hpShieldUpgrades += 1;
      this.hero.maxHp += FROST_MAGE.hpPerUpgrade;
      this.hero.baseMaxShield += FROST_MAGE.shieldPerUpgrade;
      this.hero.hp = this.hero.getEffectiveMaxHp();
      this.hero.shield = this.hero.getEffectiveMaxShield();
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `HP +${FROST_MAGE.hpPerUpgrade} · 護盾 +${FROST_MAGE.shieldPerUpgrade} · FULL`,
        'shieldHit'
      );
    } else if (kind === 'shield_speed') {
      this.hero.shieldSpeedUpgrades += 1;
      this.hero.hp = effMax;
      this.hero.shield = this.hero.getEffectiveMaxShield();
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `護盾回充 +${this.hero.shieldSpeedUpgrades * 12}% · FULL`,
        'shieldHit'
      );
    } else if (kind === 'atk_speed') {
      this.hero.atkSpeedUpgrades += 1;
      this.hero.hp = effMax;
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `攻速 +${Math.round(this.hero.atkSpeedUpgrades * HUNTER.atkSpeedStep * 100)}% · FULL HP`,
        'info'
      );
    } else if (kind === 'hp') {
      const hpStep = this.hero.isHunter() ? HUNTER.hpPerUpgrade : WARRIOR.hpPerUpgrade;
      this.hero.hpUpgrades += 1;
      this.hero.maxHp = Math.min(this.hero.getBaseMaxHpCap(), this.hero.maxHp + hpStep);
      this.hero.hp = this.hero.getEffectiveMaxHp();
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `+${hpStep} MAX HP · FULL HP`,
        'heal'
      );
    } else if (kind === 'armor') {
      this.hero.armorUpgrades += 1;
      this.hero.hp = effMax;
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `DEF +${this.hero.armorUpgrades * 10}% · FULL HP`,
        'info'
      );
    } else if (kind === 'crit') {
      const critStep = this.hero.isHunter() ? HUNTER.critPerUpgradePct : 2;
      this.hero.critUpgrades += 1;
      this.hero.hp = effMax;
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `CRIT +${this.hero.critUpgrades * critStep}% · FULL HP`,
        'crit'
      );
    } else {
      this.hero.atkUpgrades += 1;
      this.hero.hp = effMax;
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `ATK +${this.hero.atkUpgrades * 10}% · FULL HP`,
        'crit'
      );
    }

    if (this.hero.isMage()) {
      this.hero.shield = this.hero.getEffectiveMaxShield();
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
    if (this.hero.isDead || this.tradeLocked) return false;
    const nearShop = this.isHeroNearShop();
    const nearAltar = this.isHeroNearAltar();
    if (!nearShop && !nearAltar) return false;
    const cost = this.getPotionCost();
    if (this.hero.gold < cost) return false;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'buy' });
      return true;
    }

    if (!this.audio.isEnabled() && this.hero.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    this.hero.gold -= cost;
    this.hero.potions += 1;
    this.audio.playPotion();
    this.emitFloatingText(this.hero.x, 2.0, this.hero.z, '+1 ELIXIR', 'heal');

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

  beginTransition(action: () => void): void {
    this.transitionState = 'fadeOut';
    this.pendingTransitionAction = action;
  }

  usePotion(): void {
    const effMax = this.hero.getEffectiveMaxHp();
    // Single player: the local hero's elixir also heals the bot teammates, so drinking is allowed while any of them is hurt
    const healsBots = !this.mp && this.hero === this.localHero && !this.hero.isBot;
    const hurtBots = healsBots
      ? this.heroes.filter((h) => h.isBot && !h.isDead && !h.inTown && h.hp < h.getEffectiveMaxHp())
      : [];
    if (this.hero.isDead || this.hero.potions <= 0 || (this.hero.hp >= effMax && hurtBots.length === 0)) return;
    if (this.mpGuestDungeon()) {
      // The host drinks it for me (HP / potions come back with its next snapshot / private state)
      this.mpQueueAction(ACT_POTION);
      return;
    }

    const hasAlchemist = this.hero.hasUnique('alchemist_free_flask');
    const savedFlask = hasAlchemist && Math.random() < 0.2;
    if (!savedFlask) {
      this.hero.potions -= 1;
    }
    this.hero.potionsUsed += 1;
    if (hasAlchemist) {
      this.hero.alchemistShieldTimer = 3.0;
    }

    const noodleBonus = this.hero.hasUnique('noodle_elixir_boost') ? 15 : 0;
    const classPotionMult = HERO_CLASSES[this.hero.classId].potionHealMult;
    const baseHeal =
      Math.round(40 * classPotionMult * (1 + this.hero.relicStats.potionHealPct / 100)) +
      noodleBonus;
    const heal = Math.min(baseHeal, effMax - this.hero.hp);
    this.hero.hp = Math.min(effMax, this.hero.hp + heal);
    for (const b of hurtBots) {
      const bMax = b.getEffectiveMaxHp();
      const bHeal = Math.min(baseHeal, bMax - b.hp);
      b.hp = Math.min(bMax, b.hp + bHeal);
      if (bHeal > 0) this.emitFloatingText(b.x, 1.8, b.z, `+${Math.round(bHeal)} HP`, 'heal');
    }
    this.audio.playPotion();
    this.pushBanner(
      savedFlask ? '秘藥奇蹟 · 不耗藥水!' : noodleBonus > 0 ? '泡麵加湯回復!' : 'ELIXIR USED'
    );
    this.emitFloatingText(
      this.hero.x,
      1.8,
      this.hero.z,
      savedFlask ? `+${heal} HP (免費!)` : noodleBonus > 0 ? `+${heal} HP 暖胃!` : `+${heal} HP`,
      'heal'
    );

    // Burst of crimson & emerald restorative motes
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.spawnParticle(
        this.hero.x + Math.cos(a) * 0.4,
        0.5,
        this.hero.z + Math.sin(a) * 0.4,
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

  performDash(): void {
    if (this.hero.dashCooldown > 0 || this.hero.dashTimer > 0) return;
    if (this.mpGuestDungeon()) this.mpQueueAction(ACT_DASH); // predicted here, executed by the host too
    if (this.hero.isMage()) {
      this.performBlink();
      return;
    }
    this.hero.dashTimer = 0.16;
    this.hero.dashCooldown = Math.max(0.35, 1.1 * (1 - this.hero.relicStats.dashCdPct / 100));
    this.hero.invuln = Math.max(this.hero.invuln, 0.28);
    if (this.hero.hasUnique('phantom_dash_crit')) {
      this.hero.phantomCritTimer = 2.0;
    }
    this.hero.dashDirX = Math.sin(this.hero.facing);
    this.hero.dashDirZ = Math.cos(this.hero.facing);
    this.audio.playDash();

    // Unique: Phoenix Plume — fiery ring nova when dashing
    if (this.hero.hasUnique('phoenix_dash_nova')) {
      const dashAtkMult = 1 + this.hero.atkUpgrades * 0.1 + this.hero.relicStats.atkPct / 100;
      const fireDmg = Math.max(8, Math.round(14 * dashAtkMult));
      for (const e of this.enemies) {
        if (e.dead) continue;
        const edx = e.x - this.hero.x;
        const edz = e.z - this.hero.z;
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
          this.hero.x + Math.cos(a) * 0.35,
          0.55,
          this.hero.z + Math.sin(a) * 0.35,
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
        this.hero.x + (Math.random() - 0.5) * 0.5,
        0.4 + Math.random() * 0.7,
        this.hero.z + (Math.random() - 0.5) * 0.5,
        -this.hero.dashDirX * (1.2 + Math.random()),
        0.8 + Math.random(),
        -this.hero.dashDirZ * (1.2 + Math.random()),
        i % 2 === 0 ? 0x3be8e0 : 0xffbe55,
        1.15,
        0.38,
        0
      );
    }
    this.emitHud();
  }

  applyBonusEnemyDamage(
    enemy: EnemyEntity,
    bonusDmg: number,
    label: string,
    tone: FloatingLabelData['tone'],
    particleColor: number
  ): void {
    if (enemy.dead || bonusDmg <= 0) return;
    enemy.hp -= bonusDmg;
    enemy.hitFlash = 0.12;
    this.hero.totalDamageDealt += bonusDmg;
    this.hero.ai.lastCombatDamageTime = this.elapsed;
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

  performAttack(): void {
    if (this.hero.attackCooldown > 0) return;
    if (this.hero.isMage()) {
      this.performMageAttack();
      return;
    }
    if (this.hero.isHunter()) {
      this.performHunterAttack();
      return;
    }

    this.hero.comboStep = this.hero.comboResetTimer > 0 ? (this.hero.comboStep + 1) % 3 : 0;
    this.hero.comboResetTimer = 0.9;
    const isCleave = this.hero.comboStep === 2;

    this.hero.attackCooldown = isCleave ? 0.42 : 0.28;
    this.hero.attackAnim = isCleave ? 0.34 : 0.24;
    this.audio.playSwordSlash(isCleave);

    // Spawn luminous crescent sword slash VFX mesh
    const arcGeo = isCleave
      ? new THREE.RingGeometry(0.75, 2.05, 24, 1, 0, Math.PI * 1.85)
      : new THREE.RingGeometry(0.65, 1.85, 14, 1, -Math.PI * 0.48, Math.PI * 0.96);
    const arcColor = this.hero.hasSet4pc('dragonfire')
      ? 0xff7b29
      : this.hero.hasSet4pc('voidstalker')
      ? 0xc88cff
      : this.hero.hasSet4pc('syndicate')
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
    arcMesh.rotation.z = this.hero.facing - Math.PI / 2;
    arcMesh.position.set(this.hero.x, 0.85, this.hero.z);
    this.scene.add(arcMesh);
    this.slashArcs.push({
      mesh: arcMesh,
      life: 0,
      maxLife: isCleave ? 0.24 : 0.16,
      isCleave,
    });

    const reach = isCleave ? 2.55 : 2.25;
    const fwdX = Math.sin(this.hero.facing);
    const fwdZ = Math.cos(this.hero.facing);
    let landedHit = false;
    const effMaxHp = this.hero.getEffectiveMaxHp();
    const usePhantomCrit = this.hero.phantomCritTimer > 0;
    const hitState = { consumedPhantom: false, triggeredStorm: false };

    const avariceBonus = this.hero.hasUnique('avarice_gold_atk')
      ? Math.min(0.4, Math.floor(this.hero.gold / 100) * 0.01)
      : 0;
    const titanFuryBonus =
      this.hero.hasUnique('titan_low_hp_fury') && this.hero.hp / Math.max(1, effMaxHp) < 0.4 ? 0.18 : 0;
    const berserkerBonus = this.hero.hasUnique('berserker_combo_ramp')
      ? Math.min(0.25, this.hero.floorKills * 0.01)
      : 0;
    const atkMult =
      1 +
      this.hero.atkUpgrades * 0.1 +
      this.hero.relicStats.atkPct / 100 +
      avariceBonus +
      titanFuryBonus +
      berserkerBonus;
    const critChance = Math.min(
      0.95,
      (isCleave ? 0.5 : 0.11) + this.hero.critUpgrades * 0.02 + this.hero.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100 + (usePhantomCrit ? 0.25 : 0);
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;

    // Damage enemies in arc
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - this.hero.x;
      const dz = enemy.z - this.hero.z;
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
        originX: this.hero.x,
        originZ: this.hero.z,
        fallbackX: fwdX,
        fallbackZ: fwdZ,
        usePhantomCrit,
        effMaxHp,
        state: hitState,
      });
      landedHit = true;
    }

    if (hitState.consumedPhantom) {
      this.hero.phantomCritTimer = 0;
    }

    // Smash nearby crates & urns
    for (const br of this.breakables) {
      if (br.broken) continue;
      const dist = Math.hypot(br.x - this.hero.x, br.z - this.hero.z);
      if (dist <= reach * 0.92) {
        this.breakProp(br);
        landedHit = true;
      }
    }

    if (landedHit) {
      this.audio.playHit(isCleave);
      if (!this.isSilentActor() && !this.mp) this.hitStopTimer = isCleave ? 0.055 : 0.03;
      this.addScreenShake(isCleave ? 0.26 : 0.14, 0.14);
    }
  }

  /**
   * Applies one hero basic-attack hit to an enemy: damage roll, crit, knockback,
   * floating text, and every "on hit" relic / set effect. Shared by the warrior's
   * sword arc and the Frost Mage's ice spike explosions.
   */
  applyHeroHit(enemy: EnemyEntity, hit: HeroHitParams): void {
    const dx = enemy.x - hit.originX;
    const dz = enemy.z - hit.originZ;
    const dist = Math.hypot(dx, dz);

    const isCounter = enemy.isBoss && enemy.bossState === 'recover';
    const { atkMult, critChance, critMult, knockMult, usePhantomCrit, effMaxHp } = hit;
    const baseDmg = hit.baseDmg;
    const bananaSlip = this.hero.hasUnique('banana_slip_crit') && Math.random() < 0.15;
    const isCrit = isCounter || usePhantomCrit || bananaSlip || Math.random() < critChance;
    if (usePhantomCrit) hit.state.consumedPhantom = true;

    let mult = atkMult * (isCounter ? Math.max(1.45, critMult) : isCrit ? critMult : 1);
    if (bananaSlip) {
      mult *= 1.4;
    }
    if (enemy.isBoss || enemy.isElite) {
      mult *= 1 + this.hero.relicStats.eliteBossDmgPct / 100;
    }
    if (this.hero.hasUnique('executioner_finisher') && enemy.hp / Math.max(1, enemy.maxHp) < 0.3) {
      mult *= enemy.isBoss ? 1.25 : 1.5;
    }

    let gamblerTag = bananaSlip ? '滑倒! ' : '';
    if (this.hero.hasUnique('gambler_coin_flip')) {
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

    this.hero.totalDamageDealt += dmg;
    if (isCrit) this.hero.critCount += 1;
    this.hero.ai.lastCombatDamageTime = this.elapsed;

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
      this.hero.hasUnique('overtime_mug_fury') &&
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
    if (this.hero.hasUnique('blood_moon_leech') && this.hero.hp < effMaxHp) {
      this.hero.bloodLeechAccum += dmg * 0.015;
      const leech = Math.floor(this.hero.bloodLeechAccum);
      if (leech >= 1) {
        this.hero.bloodLeechAccum -= leech;
        this.hero.hp = Math.min(effMaxHp, this.hero.hp + leech);
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
    if (!enemy.dead && this.hero.hasUnique('astral_double_strike') && Math.random() < 0.2) {
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
    if (!enemy.dead && this.hero.hasUnique('frost_chill_aura')) {
      enemy.attackCooldown += enemy.isBoss ? 0.22 : 0.45;
      const frostDmg = Math.max(2, Math.round(dmg * 0.12));
      this.applyBonusEnemyDamage(enemy, frostDmg, `冰霜 -${frostDmg}`, 'relicBlue', 0x8be9ff);
    }

    // Unique: Cat Paw Gloves — every 3rd hit triggers rapid "喵!" bonus swat + knockback
    if (this.hero.hasUnique('cat_paw_swat')) {
      this.hero.catPawHitCounter += 1;
      if (!enemy.dead && this.hero.catPawHitCounter % 3 === 0) {
        const pawDmg = Math.max(4, Math.round(dmg * 0.35));
        enemy.vx += nx * (enemy.isBoss ? 1.6 : 6.2);
        enemy.vz += nz * (enemy.isBoss ? 1.6 : 6.2);
        this.applyBonusEnemyDamage(enemy, pawDmg, `喵! -${pawDmg}`, 'relicOrange', 0xff9ad5);
      }
    }

    // Unique: Dungeon Disco Ball — rainbow sparks on crit + 20% bonus tip coin
    if (isCrit && this.hero.hasUnique('disco_fever_aura')) {
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
    if (isCrit && this.hero.hasUnique('ember_crit_nova')) {
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
    if (hit.isEmpowered && !hit.state.triggeredStorm && this.hero.hasUnique('storm_cleave_lightning')) {
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
    if (this.hero.hasSet4pc('dragonfire')) {
      const fireDmg = Math.max(2, Math.round(dmg * 0.14));
      for (const other of this.enemies) {
        if (other.dead || other.id === enemy.id) continue;
        if (Math.hypot(other.x - enemy.x, other.z - enemy.z) <= 2.4) {
          this.applyBonusEnemyDamage(other, fireDmg, `龍炎 -${fireDmg}`, 'relicOrange', 0xff5a1f);
        }
      }
    }

    // 4pc Green Set: Voidstalker — crit resets dash & fires 3 void blades
    if (isCrit && this.hero.hasSet4pc('voidstalker')) {
      this.hero.dashCooldown = 0;
      const bladeDmg = Math.max(3, Math.round(dmg * 0.18));
      let hits = 0;
      for (const other of this.enemies) {
        if (other.dead || hits >= 3) continue;
        if (Math.hypot(other.x - this.hero.x, other.z - this.hero.z) <= 6.2) {
          hits += 1;
          this.applyBonusEnemyDamage(other, bladeDmg, `虛空刃 -${bladeDmg}`, 'info', 0xb46bff);
        }
      }
    }

    // 4pc Green Set: Gilded Syndicate — 20% Golden Smite bonus damage + gold pop
    if (!enemy.dead && this.hero.hasSet4pc('syndicate') && Math.random() < 0.2) {
      const smiteDmg = Math.max(4, Math.round(dmg * 0.18));
      this.applyBonusEnemyDamage(enemy, smiteDmg, `重金轟擊 -${smiteDmg}`, 'gold', 0xffd84a);
      this.spawnLoot(
        enemy.x + (Math.random() - 0.5) * 0.6,
        enemy.z + (Math.random() - 0.5) * 0.6,
        'gold'
      );
    }
  }

  performPommelStrike(): void {
    if (this.hero.isDead || this.hero.pommelCooldown > 0) return;
    if (this.mpGuestDungeon()) this.mpQueueAction(ACT_POMMEL);
    if (this.hero.isMage()) {
      this.performFrostNova();
      return;
    }
    if (this.hero.isHunter()) {
      this.performHunterPetSkill();
      return;
    }

    this.hero.pommelCooldown = this.hero.pommelMaxCooldown;
    this.hero.pommelAnim = 0.34;
    this.hero.attackAnim = 0;
    this.hero.attackCooldown = Math.max(this.hero.attackCooldown, 0.28);

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
    outerRing.position.set(this.hero.x, 0.22, this.hero.z);
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
    innerRing.position.set(this.hero.x, 0.26, this.hero.z);
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
        this.hero.x + Math.cos(a) * 0.45,
        0.35,
        this.hero.z + Math.sin(a) * 0.45,
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
    const effMaxHp = this.hero.getEffectiveMaxHp();
    const avariceBonus = this.hero.hasUnique('avarice_gold_atk')
      ? Math.min(0.4, Math.floor(this.hero.gold / 100) * 0.01)
      : 0;
    const titanFuryBonus =
      this.hero.hasUnique('titan_low_hp_fury') && this.hero.hp / Math.max(1, effMaxHp) < 0.4 ? 0.18 : 0;
    const berserkerBonus = this.hero.hasUnique('berserker_combo_ramp')
      ? Math.min(0.25, this.hero.floorKills * 0.01)
      : 0;
    const atkMult =
      1 +
      this.hero.atkUpgrades * 0.1 +
      this.hero.relicStats.atkPct / 100 +
      avariceBonus +
      titanFuryBonus +
      berserkerBonus;
    const critChance = Math.min(
      0.95,
      0.11 + this.hero.critUpgrades * 0.02 + this.hero.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100;
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;

    let landedHit = false;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - this.hero.x;
      const dz = enemy.z - this.hero.z;
      const dist = Math.hypot(dx, dz);
      const effectiveReach = reach + (enemy.isBoss ? 0.5 : enemy.isElite ? 0.18 : 0);
      if (dist > effectiveReach) continue;

      // 50% of normal attack damage
      const normalBase = 11 + Math.floor(Math.random() * 6);
      const isCrit = Math.random() < critChance;
      let mult = atkMult * 0.5 * (isCrit ? critMult : 1);
      if (enemy.isBoss || enemy.isElite) {
        mult *= 1 + this.hero.relicStats.eliteBossDmgPct / 100;
      }
      if (this.hero.hasUnique('executioner_finisher') && enemy.hp / Math.max(1, enemy.maxHp) < 0.3) {
        mult *= enemy.isBoss ? 1.25 : 1.5;
      }

      const dmg = Math.max(1, Math.round(normalBase * mult));
      this.hero.totalDamageDealt += dmg;
      if (isCrit) this.hero.critCount += 1;
      this.hero.ai.lastCombatDamageTime = this.elapsed;

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
      const nx = dist > 0.01 ? dx / dist : Math.sin(this.hero.facing);
      const nz = dist > 0.01 ? dz / dist : Math.cos(this.hero.facing);
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
      if (Math.hypot(br.x - this.hero.x, br.z - this.hero.z) <= reach) {
        this.breakProp(br);
        landedHit = true;
      }
    }

    if (landedHit) {
      if (!this.isSilentActor() && !this.mp) this.hitStopTimer = 0.04;
    }
    this.emitHud();
  }

  // =========================================================================
  // FROST MAGE — combat core
  // =========================================================================

  /** Rough collision radius of an enemy body for projectile / AoE checks. */
  getEnemyHitRadius(e: EnemyEntity): number {
    if (e.isBoss) return 1.0;
    if (isGuardianEnemy(e.kind) || e.isElite) return 0.55;
    if (isSwarmEnemy(e.kind)) return 0.3;
    return 0.42;
  }

  /** Visual scale for the frozen-ice shell per enemy size. */
  getFrozenShellScale(e: EnemyEntity): number {
    if (e.isBoss) return 2.2;
    if (isGuardianEnemy(e.kind)) return 1.35;
    if (e.isElite) return 1.3;
    if (isSwarmEnemy(e.kind)) return 0.75;
    return 1.05;
  }

  applySlow(e: EnemyEntity): void {
    if (e.dead) return;
    const factor = e.isBoss
      ? FROST_MAGE.bossSlowFactor
      : e.isElite || isGuardianEnemy(e.kind)
      ? FROST_MAGE.eliteSlowFactor
      : 1;
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

  applyFreeze(e: EnemyEntity, duration: number): void {
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
  autoFaceNearestEnemy(): boolean {
    const ranged = this.hero.isRangedClass();
    const range = this.hero.isHunter()
      ? HUNTER.projectileRange
      : this.hero.isMage()
      ? FROST_MAGE.projectileRange
      : 3.2;
    let best: EnemyEntity | null = null;
    let bestDist = Infinity;
    for (const e of this.viewEnemies()) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - this.hero.x, e.z - this.hero.z);
      if (d > range + this.getEnemyHitRadius(e) || d >= bestDist) continue;
      if (
        ranged &&
        !hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, e.x, e.z, this.doorUnlocked, 0.2)
      ) {
        continue;
      }
      best = e;
      bestDist = d;
    }
    if (!best) return false;
    this.hero.facing = Math.atan2(best.x - this.hero.x, best.z - this.hero.z);
    this.hero.rig.body.rotation.y = this.hero.facing;
    return true;
  }

  /** Projects a screen point onto the ground plane (y = 0.85, ice spike height). */
  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null {
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
  performMageAttack(): void {
    if (this.hero.attackCooldown > 0) return;
    const shotIdx = this.hero.mageShotIndex;
    const empowered = shotIdx === 2;
    this.hero.mageShotIndex = (this.hero.mageShotIndex + 1) % 3;
    this.hero.attackCooldown = FROST_MAGE.shotCooldown[shotIdx];
    this.hero.attackAnim = empowered ? 0.3 : 0.22;
    this.audio.playIceCast(empowered);

    const dirX = Math.sin(this.hero.facing);
    const dirZ = Math.cos(this.hero.facing);
    this.spawnIceSpike(this.hero.x + dirX * 0.55, this.hero.z + dirZ * 0.55, dirX, dirZ, shotIdx);

    // Muzzle frost sparkle at the staff tip
    for (let i = 0; i < (empowered ? 10 : 5); i++) {
      this.spawnParticle(
        this.hero.x + dirX * 0.7,
        1.05,
        this.hero.z + dirZ * 0.7,
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

  spawnIceSpike(x: number, z: number, dirX: number, dirZ: number, shotIdx: number): void {
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
      phantomCrit: this.hero.phantomCritTimer > 0,
      ownerId: this.hero.id,
    });
    this.hero.phantomCritTimer = 0;
  }

  /** Hunter basic attack: fast single-target arrow along heroFacing (no 3-hit cycle). */
  performHunterAttack(): void {
    if (this.hero.attackCooldown > 0) return;
    this.hero.attackCooldown = this.hero.getHunterShotCooldown();
    this.hero.attackAnim = 0.18;
    this.audio.playBowShot();

    const dirX = Math.sin(this.hero.facing);
    const dirZ = Math.cos(this.hero.facing);
    const x = this.hero.x + dirX * 0.55;
    const z = this.hero.z + dirZ * 0.55;
    const mesh = createHunterArrowMesh();
    mesh.position.set(x, 0.88, z);
    mesh.rotation.y = Math.atan2(dirX, dirZ);
    this.dynamicGroup.add(mesh);
    this.heroProjectiles.push({
      mesh,
      x,
      z,
      vx: dirX * HUNTER.projectileSpeed,
      vz: dirZ * HUNTER.projectileSpeed,
      traveled: 0,
      shotIdx: -1,
      phantomCrit: this.hero.phantomCritTimer > 0,
      ownerId: this.hero.id,
    });
    this.hero.phantomCritTimer = 0;
  }

  hitHunterArrow(
    x: number,
    z: number,
    target: EnemyEntity | null,
    phantomCrit = false
  ): void {
    for (let i = 0; i < (target ? 7 : 5); i++) {
      this.spawnParticle(
        x,
        0.85,
        z,
        (Math.random() - 0.5) * 3.2,
        1.0 + Math.random() * 1.4,
        (Math.random() - 0.5) * 3.2,
        i % 2 === 0 ? 0xff7b47 : 0xffd54f,
        0.65,
        0.26,
        5.5
      );
    }
    if (!target || target.dead) return;
    // Guest client only has puppet enemies; real damage is computed by host.
    if (this.mpGuestDungeon()) return;

    this.hero.hunterHitCount += 1;
    const isThunderHit = this.hero.hunterHitCount % HUNTER.thunderEveryNHits === 0;
    const atkMult = this.hero.getAtkMult();
    const critChance = Math.min(
      0.95,
      HUNTER.baseCritChance +
        this.hero.critUpgrades * (HUNTER.critPerUpgradePct / 100) +
        this.hero.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100 + (phantomCrit ? 0.25 : 0);
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;
    const effMaxHp = this.hero.getEffectiveMaxHp();
    const warriorBase = 11 + Math.floor(Math.random() * 6);
    const hitState = { consumedPhantom: false, triggeredStorm: false };

    this.applyHeroHit(target, {
      baseDmg: Math.max(1, Math.round(warriorBase * HUNTER.shotDamageMult)),
      isEmpowered: isThunderHit,
      atkMult,
      critChance,
      critMult,
      knockMult,
      knockBase: 1.9,
      originX: x,
      originZ: z,
      fallbackX: Math.sin(this.hero.facing),
      fallbackZ: Math.cos(this.hero.facing),
      usePhantomCrit: phantomCrit,
      effMaxHp,
      state: hitState,
      hitColor: 0xff7b47,
    });
    this.audio.playHit(false);
    this.emitHud();
  }

  /** Hunter right-click skill (CD 7s): summon a random pet if none alive, else buff (+20% atk/spd/def for 5s) + heal 50%. */
  performHunterPetSkill(): void {
    if (this.hero.pommelCooldown > 0 || this.hero.isDead || this.inTown) return;
    if (this.mpGuestDungeon()) {
      this.mpQueueAction(ACT_POMMEL);
      this.hero.pommelCooldown = this.hero.pommelMaxCooldown;
      this.hero.pommelAnim = 0.26;
      return;
    }
    this.hero.pommelCooldown = this.hero.pommelMaxCooldown;
    this.hero.pommelAnim = 0.28;

    const existing = this.pets.get(this.hero.id);
    if (existing && existing.hp > 0) {
      // Buff + 50% heal
      const healAmt = Math.round(existing.maxHp * HUNTER.petHealFraction);
      const actualHeal = Math.min(healAmt, existing.maxHp - existing.hp);
      existing.hp = Math.min(existing.maxHp, existing.hp + healAmt);
      existing.buffTimer = HUNTER.petBuffDuration;
      this.audio.playUpgrade();
      this.emitFloatingText(
        existing.x,
        2.0,
        existing.z,
        `★ ${existing.name} 狂野激勵 +${Math.round(actualHeal)} HP`,
        'heal'
      );
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.spawnParticle(
          existing.x + Math.cos(a) * 0.45,
          0.6,
          existing.z + Math.sin(a) * 0.45,
          Math.cos(a) * 2.2,
          1.8 + Math.random() * 1.4,
          Math.sin(a) * 2.2,
          i % 2 === 0 ? 0xff9f43 : 0x52ffa8,
          0.95,
          0.45,
          2.0
        );
      }
    } else {
      // Summon a brand-new random pet beside the Hunter
      if (existing) this.dismissPet(this.hero.id);
      if (!this.sharedShadowMap) return;
      const species = PET_SPECIES_LIST[Math.floor(Math.random() * PET_SPECIES_LIST.length)];
      const pool = PET_NAMES[species];
      const name = pool[Math.floor(Math.random() * pool.length)];
      const angle = this.hero.facing + Math.PI * 0.35;
      let sx = this.hero.x + Math.sin(angle) * 1.3;
      let sz = this.hero.z + Math.cos(angle) * 1.3;
      if (!this.canMoveTo(sx, sz, 0.45)) {
        sx = this.hero.x;
        sz = this.hero.z;
      }
      const rig = createHunterPetModel(species, name, this.sharedShadowMap);
      rig.root.position.set(sx, 0, sz);
      this.scene.add(rig.root);
      const maxHp = getHunterPetMaxHp(this.depth);
      const pet: PetEntity = {
        ownerId: this.hero.id,
        species,
        name,
        rig,
        x: sx,
        z: sz,
        vx: 0,
        vz: 0,
        facing: this.hero.facing,
        hp: maxHp,
        maxHp,
        buffTimer: 0,
        attackCooldown: 0.3,
        timeSinceDamaged: 999,
        hitFlash: 0,
        invuln: 0.4,
        walkPhase: 0,
      };
      this.pets.set(this.hero.id, pet);
      this.audio.playUpgrade();
      const speciesLabel = species === 'bear' ? '戰熊' : species === 'chocobo' ? '陸行鳥' : '戰狼';
      this.emitFloatingText(sx, 2.0, sz, `召喚 ${speciesLabel}「${name}」!`, 'relicOrange');
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        this.spawnParticle(
          sx + Math.cos(a) * 0.4,
          0.5,
          sz + Math.sin(a) * 0.4,
          Math.cos(a) * 2.6,
          1.6 + Math.random() * 1.4,
          Math.sin(a) * 2.6,
          i % 2 === 0 ? 0xff7b47 : 0xffd54f,
          1.0,
          0.45,
          3.0
        );
      }
    }
    this.emitHud();
  }

  disposePetRig(rig: PetRig): void {
    this.scene.remove(rig.root);
    rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      } else if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
  }

  dismissPet(ownerId: string): void {
    const pet = this.pets.get(ownerId);
    if (!pet) return;
    this.disposePetRig(pet.rig);
    this.pets.delete(ownerId);
  }

  clearAllPets(): void {
    for (const id of Array.from(this.pets.keys())) {
      this.dismissPet(id);
    }
  }

  repositionPetsForNewFloor(): void {
    const newMaxHp = getHunterPetMaxHp(this.depth);
    for (const pet of this.pets.values()) {
      const owner = this.heroById(pet.ownerId);
      if (!owner || owner.isDead) {
        this.dismissPet(pet.ownerId);
        continue;
      }
      pet.maxHp = newMaxHp;
      pet.hp = newMaxHp;
      pet.timeSinceDamaged = 999;
      pet.x = owner.x + 0.9;
      pet.z = owner.z + 0.9;
      if (!this.canMoveTo(pet.x, pet.z, 0.45)) {
        pet.x = owner.x;
        pet.z = owner.z;
      }
      pet.vx = 0;
      pet.vz = 0;
      pet.rig.root.position.set(pet.x, 0, pet.z);
    }
  }

  damagePet(pet: PetEntity, rawDamage: number, srcX: number, srcZ: number): void {
    if (pet.invuln > 0 || pet.hp <= 0) return;
    const defMult = pet.buffTimer > 0 ? HUNTER.petBuffDamageTakenMult : 1;
    const dmg = Math.max(1, Math.round(rawDamage * defMult));
    pet.hp = Math.max(0, pet.hp - dmg);
    pet.timeSinceDamaged = 0;
    pet.hitFlash = 0.16;
    pet.invuln = 0.35;

    const dx = pet.x - srcX;
    const dz = pet.z - srcZ;
    const dist = Math.hypot(dx, dz) || 1;
    pet.vx += (dx / dist) * 2.6;
    pet.vz += (dz / dist) * 2.6;

    this.emitFloatingText(pet.x, 1.5, pet.z, `-${dmg}`, 'playerHit');
    if (pet.hp <= 0) {
      this.emitFloatingText(pet.x, 2.0, pet.z, `${pet.name} 倒下了!`, 'playerHit');
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.spawnParticle(
          pet.x,
          0.7,
          pet.z,
          Math.cos(a) * 3.0,
          1.6 + Math.random() * 1.4,
          Math.sin(a) * 3.0,
          0xff7b47,
          0.9,
          0.45,
          4.5
        );
      }
      this.dismissPet(pet.ownerId);
    }
  }

  damagePetsInRadius(cx: number, cz: number, radius: number, rawDamage: number): void {
    for (const pet of Array.from(this.pets.values())) {
      if (pet.hp <= 0) continue;
      const owner = this.heroById(pet.ownerId);
      if (!owner || owner.isDead || owner.inTown) continue;
      if (Math.hypot(pet.x - cx, pet.z - cz) <= radius) {
        this.damagePet(pet, rawDamage, cx, cz);
      }
    }
  }

  updatePets(dt: number): void {
    const prevActor = this.hero;
    for (const [ownerId, pet] of Array.from(this.pets.entries())) {
      const owner = this.heroById(ownerId);
      if (!owner || owner.isDead) {
        this.dismissPet(ownerId);
        continue;
      }
      if (owner.inTown) {
        pet.rig.root.visible = false;
        continue;
      }
      pet.rig.root.visible = !this.inTown;

      pet.hitFlash = Math.max(0, pet.hitFlash - dt);
      pet.invuln = Math.max(0, pet.invuln - dt);
      pet.buffTimer = Math.max(0, pet.buffTimer - dt);
      pet.attackCooldown = Math.max(0, pet.attackCooldown - dt);
      pet.timeSinceDamaged += dt;

      // Out-of-combat automatic regeneration (~5s to full after delay)
      if (pet.hp < pet.maxHp && pet.timeSinceDamaged >= HUNTER.petRegenDelay) {
        pet.hp = Math.min(pet.maxHp, pet.hp + (pet.maxHp / HUNTER.petRegenRefill) * dt);
      }

      const buffed = pet.buffTimer > 0;
      const toOwnerX = owner.x - pet.x;
      const toOwnerZ = owner.z - pet.z;
      const ownerDist = Math.hypot(toOwnerX, toOwnerZ);

      let moveX = 0;
      let moveZ = 0;

      if (ownerDist > HUNTER.petTeleportDist || this.isCompanionTooFar(owner, pet.x, pet.z)) {
        // Teleport right next to owner (also once it drifts to the screen edge, e.g. snagged behind a wall)
        pet.x = owner.x + (Math.random() - 0.5) * 0.8;
        pet.z = owner.z + (Math.random() - 0.5) * 0.8;
        if (!this.canMoveTo(pet.x, pet.z, 0.45)) {
          pet.x = owner.x;
          pet.z = owner.z;
        }
        pet.vx = 0;
        pet.vz = 0;
      } else if (ownerDist > HUNTER.petLeashReturnDist) {
        // Too far from owner: disengage and rush back
        moveX = (toOwnerX / ownerDist) * HUNTER.petMoveSpeed * 1.25;
        moveZ = (toOwnerZ / ownerDist) * HUNTER.petMoveSpeed * 1.25;
        pet.facing = Math.atan2(toOwnerX, toOwnerZ);
      } else {
        // Seek nearest enemy within aggro range
        let target: EnemyEntity | null = null;
        let bestD: number = HUNTER.petAggroRange;
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dPet = Math.hypot(e.x - pet.x, e.z - pet.z);
          const dOwner = Math.hypot(e.x - owner.x, e.z - owner.z);
          if (dPet < bestD && dOwner < HUNTER.petLeashReturnDist && !this.isCompanionTooFar(owner, e.x, e.z)) {
            bestD = dPet;
            target = e;
          }
        }
        if (target) {
          const ex = target.x - pet.x;
          const ez = target.z - pet.z;
          const ed = Math.hypot(ex, ez) || 1;
          pet.facing = Math.atan2(ex, ez);
          const strikeDist = HUNTER.petAttackReach + this.getEnemyHitRadius(target);
          if (ed > strikeDist * 0.78) {
            const spd = HUNTER.petMoveSpeed * (buffed ? 1.15 : 1);
            moveX = (ex / ed) * spd;
            moveZ = (ez / ed) * spd;
          }
          if (ed <= strikeDist && pet.attackCooldown <= 0) {
            pet.attackCooldown = HUNTER.petAttackCooldown / (buffed ? HUNTER.petBuffAtkSpeedMult : 1);
            const rawBase =
              HUNTER.petDamageMin +
              Math.floor(Math.random() * (HUNTER.petDamageMax - HUNTER.petDamageMin + 1));
            const dmg = Math.max(
              1,
              Math.round(rawBase * owner.getAtkMult() * (buffed ? HUNTER.petBuffAtkMult : 1))
            );
            target.hp -= dmg;
            target.hitFlash = 0.14;
            const kb = target.isBoss ? 0.6 : target.isElite ? 1.6 : 3.2;
            target.vx += (ex / ed) * kb;
            target.vz += (ez / ed) * kb;
            this.setActor(owner);
            owner.totalDamageDealt += dmg;
            this.emitFloatingText(target.x, 1.5, target.z, `${dmg}`, buffed ? 'crit' : 'damage');
            this.audio.playHit(false);
            if (target.hp <= 0) {
              this.killEnemy(target);
            }
          }
        } else if (ownerDist > 2.0) {
          // Follow beside owner
          const spd = HUNTER.petMoveSpeed * Math.min(1.15, ownerDist / 2.6);
          moveX = (toOwnerX / ownerDist) * spd;
          moveZ = (toOwnerZ / ownerDist) * spd;
          pet.facing = Math.atan2(toOwnerX, toOwnerZ);
        }
      }

      const nextPos = this.moveWithSlide(
        pet.x,
        pet.z,
        (moveX + pet.vx) * dt,
        (moveZ + pet.vz) * dt,
        0.42
      );
      pet.x = nextPos.x;
      pet.z = nextPos.z;
      pet.vx *= Math.exp(-9 * dt);
      pet.vz *= Math.exp(-9 * dt);

      this.animatePetRig(pet, Math.hypot(moveX, moveZ), dt);
    }
    this.setActor(prevActor);
  }

  animatePetRig(pet: PetEntity, moveSpeed: number, dt: number): void {
    pet.rig.root.position.set(pet.x, 0, pet.z);
    pet.rig.body.rotation.y = pet.facing;
    const moving = moveSpeed > 0.25;
    pet.walkPhase += dt * (moving ? 14 : 3.5);
    const swing = moving ? Math.sin(pet.walkPhase) * 0.65 : 0;
    pet.rig.legs.forEach((leg, idx) => {
      leg.rotation.x = idx % 2 === 0 ? swing : -swing;
    });
    if (pet.rig.tail) {
      pet.rig.tail.rotation.y = Math.sin(pet.walkPhase * 1.2) * (moving ? 0.35 : 0.15);
    }
    pet.rig.body.position.y = moving ? Math.abs(Math.sin(pet.walkPhase)) * 0.08 : 0;

    const buffed = pet.buffTimer > 0;
    pet.rig.buffRing.visible = buffed;
    if (buffed) {
      pet.rig.buffRing.rotation.z += dt * 2.4;
    }
    for (const m of pet.rig.flashMaterials) {
      if (pet.hitFlash > 0) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.85;
      } else if (buffed) {
        m.emissive.setHex(0xff8c24);
        m.emissiveIntensity = 0.22;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  }

  removeHeroProjectileAt(idx: number): void {
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

  isPointInWall(x: number, z: number): boolean {
    const g = worldToGrid(x, z);
    return !isTileWalkable(this.dungeon, g.gx, g.gz, this.doorUnlocked);
  }

  updateHeroProjectiles(dt: number): void {
    for (let i = this.heroProjectiles.length - 1; i >= 0; i--) {
      const p = this.heroProjectiles[i];
      if (p.pid !== undefined) continue; // teammate view: another hero's spike is moved by mpGuestWorld
      // The spike explodes with its owner's stats / relics and credits the kill to them
      const owner = this.heroById(p.ownerId);
      if (!owner) {
        this.removeHeroProjectileAt(i);
        continue;
      }
      this.setActor(owner);
      const speed = Math.hypot(p.vx, p.vz);
      // Sub-step so fast spikes never tunnel through thin enemies or wall corners
      const steps = Math.max(1, Math.ceil((speed * dt) / 0.3));
      const sdt = dt / steps;
      let exploded = false;
      const isArrow = p.shotIdx === -1;
      const hitRad = isArrow ? HUNTER.projectileHitRadius : FROST_MAGE.projectileHitRadius;
      const maxRange = isArrow ? HUNTER.projectileRange : FROST_MAGE.projectileRange;
      for (let s = 0; s < steps && !exploded; s++) {
        const nx = p.x + p.vx * sdt;
        const nz = p.z + p.vz * sdt;
        if (this.isPointInWall(nx, nz)) {
          if (isArrow) this.hitHunterArrow(p.x, p.z, null, p.phantomCrit);
          else this.explodeIceSpike(p.x, p.z, p.shotIdx, p.phantomCrit);
          exploded = true;
          break;
        }
        p.x = nx;
        p.z = nz;
        p.traveled += speed * sdt;

        const hitTargets = this.mpGuestDungeon() && this.mp ? this.mp.guest.enemyList : this.enemies;
        for (const e of hitTargets) {
          if (e.dead) continue;
          if (Math.hypot(e.x - p.x, e.z - p.z) <= hitRad + this.getEnemyHitRadius(e)) {
            if (isArrow) this.hitHunterArrow(p.x, p.z, e, p.phantomCrit);
            else this.explodeIceSpike(p.x, p.z, p.shotIdx, p.phantomCrit);
            exploded = true;
            break;
          }
        }
        if (exploded) break;
        for (const br of this.breakables) {
          if (br.broken) continue;
          if (Math.hypot(br.x - p.x, br.z - p.z) <= 0.6) {
            if (isArrow) {
              if (!this.mpGuestDungeon()) this.breakProp(br);
              else this.mpGuestPredictBreak(br);
              this.hitHunterArrow(p.x, p.z, null, p.phantomCrit);
            } else {
              this.explodeIceSpike(p.x, p.z, p.shotIdx, p.phantomCrit);
            }
            exploded = true;
            break;
          }
        }
        if (!exploded && p.traveled >= maxRange) {
          if (!isArrow) this.explodeIceSpike(p.x, p.z, p.shotIdx, p.phantomCrit);
          exploded = true;
        }
      }
      if (exploded) {
        this.removeHeroProjectileAt(i);
        continue;
      }
      p.mesh.position.set(p.x, isArrow ? 0.88 : 0.85, p.z);
      if (!isArrow) {
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
      } else if (Math.random() < 0.45) {
        this.spawnParticle(
          p.x,
          0.88,
          p.z,
          (Math.random() - 0.5) * 0.3,
          0.1,
          (Math.random() - 0.5) * 0.3,
          0xff9f43,
          0.45,
          0.18,
          0
        );
      }
    }
    this.setActor(this.localHero);
  }

  explodeIceSpike(x: number, z: number, shotIdx: number, phantomCrit = false): void {
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

    const atkMult = this.hero.getAtkMult();
    const usePhantomCrit = phantomCrit;
    const hitState = { consumedPhantom: false, triggeredStorm: false };
    const critChance = Math.min(
      0.95,
      FROST_MAGE.shotBaseCrit[shotIdx] + this.hero.critUpgrades * 0.02 + this.hero.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100 + (usePhantomCrit ? 0.25 : 0);
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;
    const effMaxHp = this.hero.getEffectiveMaxHp();
    let landedHit = false;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const d = Math.hypot(enemy.x - x, enemy.z - z);
      if (d > radius + this.getEnemyHitRadius(enemy)) continue;
      // Walls block the blast
      if (d > 0.6 && !hasLineOfSight(this.dungeon, x, z, enemy.x, enemy.z, this.doorUnlocked, 0.05)) continue;
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
        fallbackX: Math.sin(this.hero.facing),
        fallbackZ: Math.cos(this.hero.facing),
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
    for (const br of this.breakables) {
      if (br.broken) continue;
      const bd = Math.hypot(br.x - x, br.z - z);
      if (
        bd <= radius + 0.35 &&
        (bd <= 0.8 || hasLineOfSight(this.dungeon, x, z, br.x, br.z, this.doorUnlocked, 0.05))
      ) {
        this.breakProp(br);
        landedHit = true;
      }
    }

    if (landedHit) {
      if (!this.isSilentActor() && !this.mp) this.hitStopTimer = Math.max(this.hitStopTimer, empowered ? 0.045 : 0.02);
      this.addScreenShake(empowered ? 0.2 : 0.08, 0.1);
    }
  }

  /** Frost Mage right-click: screen-wide expanding ice nova — freeze, damage, push. */
  performFrostNova(): void {
    if (this.hero.isDead || this.hero.pommelCooldown > 0) return;
    this.hero.pommelCooldown = this.hero.pommelMaxCooldown;
    this.hero.attackAnim = 0.34;
    this.hero.attackCooldown = Math.max(this.hero.attackCooldown, 0.3);
    this.audio.playFrostNova();
    this.addScreenShake(0.32, 0.28);

    const rings: Array<[number, number, number, number]> = [
      // [inner, outer, maxLife, color]
      // Thin rings: they scale ~19x to reach the nova radius, so keep them narrow
      [0.64, 0.7, 0.55, 0x8fe3ff],
      [0.6, 0.64, 0.42, 0xdff8ff],
      [0.67, 0.7, 0.68, 0xffe066],
    ];
    for (const [inner, outer, life, color] of rings) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(this.hero.x, 0.24, this.hero.z);
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
        this.hero.x + Math.cos(a) * 0.5,
        0.4 + Math.random() * 0.6,
        this.hero.z + Math.sin(a) * 0.5,
        Math.cos(a) * spd,
        0.8 + Math.random() * 1.6,
        Math.sin(a) * spd,
        i % 5 === 0 ? 0xffe066 : i % 2 === 0 ? 0xffffff : 0x9fe8ff,
        1.1,
        0.7,
        1.0
      );
    }

    const atkMult = this.hero.getAtkMult();
    const critChance = Math.min(0.95, 0.08 + this.hero.critUpgrades * 0.02 + this.hero.relicStats.critPct / 100);
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100;
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;
    let landedHit = false;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - this.hero.x;
      const dz = enemy.z - this.hero.z;
      const dist = Math.hypot(dx, dz);
      if (dist > FROST_MAGE.novaRadius + this.getEnemyHitRadius(enemy)) continue;

      const base = (11 + Math.floor(Math.random() * 6)) * FROST_MAGE.novaDamageMult;
      const isCrit = Math.random() < critChance;
      let mult = atkMult * (isCrit ? critMult : 1);
      if (enemy.isBoss || enemy.isElite) mult *= 1 + this.hero.relicStats.eliteBossDmgPct / 100;
      if (this.hero.hasUnique('executioner_finisher') && enemy.hp / Math.max(1, enemy.maxHp) < 0.3) {
        mult *= enemy.isBoss ? 1.25 : 1.5;
      }
      const dmg = Math.max(1, Math.round(base * mult));
      this.hero.totalDamageDealt += dmg;
      if (isCrit) this.hero.critCount += 1;
      this.hero.ai.lastCombatDamageTime = this.elapsed;
      enemy.hp -= dmg;
      enemy.hitFlash = 0.18;

      if (!enemy.isBoss) {
        const nx = dist > 0.01 ? dx / dist : Math.sin(this.hero.facing);
        const nz = dist > 0.01 ? dz / dist : Math.cos(this.hero.facing);
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
      if (
        Math.hypot(br.x - this.hero.x, br.z - this.hero.z) <= FROST_MAGE.novaRadius &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, br.x, br.z, this.doorUnlocked, 0.05)
      ) {
        this.breakProp(br);
      }
    }
    if (landedHit && !this.isSilentActor() && !this.mp) this.hitStopTimer = 0.05;
    this.emitHud();
  }

  /** Phoenix Plume fire ring at a point (shared by Dash and Blink). */
  triggerPhoenixRingAt(x: number, z: number): void {
    const fireDmg = Math.max(8, Math.round(14 * (1 + this.hero.atkUpgrades * 0.1 + this.hero.relicStats.atkPct / 100)));
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
  performBlink(dirOverride?: { x: number; z: number }): void {
    if (this.hero.dashCooldown > 0 || this.hero.dashTimer > 0) return;
    // Direction priority: explicit (AI) > current move input (manual) > facing
    let dirX = Math.sin(this.hero.facing);
    let dirZ = Math.cos(this.hero.facing);
    if (dirOverride) {
      dirX = dirOverride.x;
      dirZ = dirOverride.z;
    } else if (this.hero.controlMode === 'manual' && Math.hypot(this.hero.input.moveX, this.hero.input.moveZ) > 0.1) {
      dirX = this.hero.input.moveX;
      dirZ = this.hero.input.moveZ;
    }
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len;
    dirZ /= len;

    const startX = this.hero.x;
    const startZ = this.hero.z;
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

    this.hero.dashCooldown = Math.max(0.35, 1.1 * (1 - this.hero.relicStats.dashCdPct / 100));
    this.hero.invuln = Math.max(this.hero.invuln, 0.28);
    if (this.hero.hasUnique('phantom_dash_crit')) this.hero.phantomCritTimer = 2.0;
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
    if (this.hero.hasUnique('phoenix_dash_nova')) this.triggerPhoenixRingAt(startX, startZ);

    this.hero.x = endX;
    this.hero.z = endZ;
    this.hero.vx = 0;
    this.hero.vz = 0;
    this.hero.facing = Math.atan2(dirX, dirZ);
    this.hero.rig.root.position.set(this.hero.x, 0, this.hero.z);
    burst(endX, endZ, true);
    if (this.hero.hasUnique('phoenix_dash_nova')) this.triggerPhoenixRingAt(endX, endZ);
    this.emitHud();
  }

  breakProp(br: BreakableEntity): void {
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
  }

  killEnemy(enemy: EnemyEntity): void {
    enemy.dead = true;
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

      // Boss Treasure Hoard: 12 high-value bouncing gold coins scaled +6.5%/floor + Healing Elixir + Guaranteed Boss Relics
      // (every hero gets their own hoard)
      const goldScale = this.getDepthGoldScale();
      const bossKiller = this.hero;
      for (const h of this.heroes) {
        if (h.inTown) continue;
        this.setActor(h);
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

    const isSwarm = isSwarmEnemy(enemy.kind);
    const specialDropMult = enemy.isSpecialElite ? 1.2 : 1;
    // Every hero rolls their own drops (spec §5.2); the killer is the actor again afterwards
    const killer = this.hero;
    for (const h of this.heroes) {
      if (h.inTown) continue;
      this.setActor(h);
      const extraCoins =
        (this.hero.hasSet4pc('syndicate') ? 1 : 0) +
        (this.hero.hasUnique('frying_pan_bonk') && Math.random() < 0.15 ? 1 : 0) +
        (enemy.isElite && this.hero.hasUnique('starforged_treasure_sense') && Math.random() < 0.25 ? 2 : 0);
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
      const dropMult = 1 + this.hero.relicStats.dropRatePct / 100;
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
    }
    this.setActor(killer);

    this.emitHud();
  }

  spawnRelicDrops(
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
  }

  spawnRelicLoot(
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
  }

  /** Bot gold / potion drops go straight into the bot's own purse (same values the pickup would give). */
  grantBotLoot(type: 'gold' | 'potion', customValue?: number): void {
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
  }

  /** Mirrors the relic pickup rules of updateLoot for a bot (equip into a free slot, else upgrade, else bag, else sell). */
  grantBotRelic(item: RelicItem): void {
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
  }

  spawnLoot(x: number, z: number, type: 'gold' | 'potion', customValue?: number): void {
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
  }

  getEnemyBaseLabel(kind: EnemyKind): string {
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

  getEnemyLabel(e: EnemyEntity): string {
    if (e.isBoss) return e.bossName ?? '地城頭目';
    if (e.customName) return e.customName;
    const base = this.getEnemyBaseLabel(e.kind);
    return e.isElite ? `菁英 ${base}` : base;
  }

  damageHero(
    amount: number,
    sourceX: number,
    sourceZ: number,
    sourceLabel = '地城怪物',
    attacker?: EnemyEntity
  ): void {
    if (this.hero.isDead || this.hero.invuln > 0 || this.transitionState !== 'none') return;

    const isSwarmHit = Boolean(attacker && isSwarmEnemy(attacker.kind));
    const effMaxHp = this.hero.getEffectiveMaxHp();

    // Relic Block Chance: completely negate incoming damage
    if (this.hero.relicStats.blockPct > 0 && Math.random() * 100 < this.hero.relicStats.blockPct) {
      const hasPan = this.hero.hasUnique('frying_pan_bonk');
      this.hero.invuln = isSwarmHit ? 0.14 : 0.38;
      this.audio.playBlock(hasPan);
      this.emitFloatingText(
        this.hero.x,
        1.9,
        this.hero.z,
        hasPan ? '噹！神聖格擋!' : 'BLOCK!',
        'block'
      );
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x,
          0.95,
          this.hero.z,
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
      if (this.hero.hasUnique('aegis_block_counter')) {
        this.hero.hp = Math.min(effMaxHp, this.hero.hp + 3);
        this.emitFloatingText(this.hero.x, 2.25, this.hero.z, '+3 HP 聖盾反震', 'heal');
        for (const e of this.enemies) {
          if (e.dead) continue;
          const edx = e.x - this.hero.x;
          const edz = e.z - this.hero.z;
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
        this.spawnLoot(this.hero.x + (Math.random() - 0.5) * 0.6, this.hero.z + (Math.random() - 0.5) * 0.6, 'gold');
      }

      this.emitHud();
      return;
    }

    // Armor % reduction + Flat Relic Damage Reduction (always minimum 1 HP per hit)
    const defMult = Math.max(0.5, 1 - this.hero.armorUpgrades * 0.1);
    const titanFlat =
      this.hero.hasUnique('titan_low_hp_fury') && this.hero.hp / Math.max(1, effMaxHp) < 0.4 ? 2 : 0;
    const alchemistFlat = this.hero.alchemistShieldTimer > 0 ? 2 : 0;
    const flatReduce = this.hero.relicStats.damageReduction + titanFlat + alchemistFlat;
    const actualDamage = Math.max(1, Math.round(amount * defMult) - flatReduce);

    const dx = this.hero.x - sourceX;
    const dz = this.hero.z - sourceZ;
    const dist = Math.hypot(dx, dz) || 1;

    // Frost Mage: the shield absorbs damage first, HP only takes the remainder
    let shieldAbsorbed = 0;
    let hpDamage = actualDamage;
    if (this.hero.isMage() && this.hero.shield > 0) {
      const absorb = Math.min(this.hero.shield, actualDamage);
      this.hero.shield = Math.max(0, this.hero.shield - absorb);
      hpDamage = Math.max(0, actualDamage - Math.ceil(absorb));
      shieldAbsorbed = actualDamage - hpDamage;
      if (this.hero.shield <= 0) this.audio.playShieldBreak();
    }
    this.hero.timeSinceDamaged = 0;
    this.hero.rescueProgress = 0; // getting hit interrupts a rescue in progress

    this.hero.hp = Math.max(0, this.hero.hp - hpDamage);
    // Swarm critters use a brief invuln window so their 2/sec rapid chip bites (-1, -1, -2, -2) land cleanly
    this.hero.invuln = isSwarmHit ? 0.14 : 0.72;
    this.hero.hitFlash = isSwarmHit ? 0.1 : 0.18;
    this.hero.hitShieldOnly = hpDamage <= 0;
    this.audio.playPlayerHurt();
    this.addScreenShake(isSwarmHit ? 0.08 : 0.24, isSwarmHit ? 0.08 : 0.18);
    const labelJitterX = isSwarmHit ? (Math.random() - 0.5) * 0.55 : 0;
    const labelJitterZ = isSwarmHit ? (Math.random() - 0.5) * 0.55 : 0;
    const labelY = isSwarmHit ? 1.6 + Math.random() * 0.35 : 1.8;
    if (shieldAbsorbed > 0) {
      this.emitFloatingText(
        this.hero.x + labelJitterX - 0.15,
        labelY + (hpDamage > 0 ? 0.3 : 0),
        this.hero.z + labelJitterZ,
        `-${shieldAbsorbed}`,
        'shieldHit'
      );
    }
    if (hpDamage > 0) {
      this.emitFloatingText(
        this.hero.x + labelJitterX,
        labelY,
        this.hero.z + labelJitterZ,
        `-${hpDamage}`,
        'playerHit'
      );
    }

    // Relic Thorns: reflect fixed damage to melee attacker
    if (attacker && !attacker.dead && this.hero.relicStats.thorns > 0) {
      this.applyBonusEnemyDamage(
        attacker,
        this.hero.relicStats.thorns,
        `荊棘 -${this.hero.relicStats.thorns}`,
        'info',
        0x7eff9b
      );
    }

    // Unique: Eclipse Mirror — reflect 150% of damage taken as arcane pulse to nearby enemies
    if (this.hero.hasUnique('eclipse_reflect_beam')) {
      const refDmg = Math.max(4, Math.round(actualDamage * 1.5));
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - this.hero.x, e.z - this.hero.z) <= 3.8) {
          this.applyBonusEnemyDamage(e, refDmg, `蝕月反衝 -${refDmg}`, 'info', 0xc88cff);
        }
      }
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x,
          0.85,
          this.hero.z,
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
    if (this.hero.hasUnique('rubber_duck_squeak') && this.hero.hp > 0) {
      const duckHeal = Math.random() < 0.2;
      if (duckHeal) {
        this.hero.hp = Math.min(effMaxHp, this.hero.hp + 2);
      }
      this.emitFloatingText(
        this.hero.x,
        2.2,
        this.hero.z,
        duckHeal ? '啾！+2 HP' : '啾！',
        duckHeal ? 'heal' : 'relicYellow'
      );
      for (const e of this.enemies) {
        if (e.dead) continue;
        const edx = e.x - this.hero.x;
        const edz = e.z - this.hero.z;
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
          this.hero.x,
          0.95,
          this.hero.z,
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
    this.hero.vx += (dx / dist) * kbForce;
    this.hero.vz += (dz / dist) * kbForce;

    // Auto-heal trigger in autonomous mode if low HP
    const healThreshold = this.hero.getAutoHealThreshold(effMaxHp);
    if (this.hero.controlMode === 'auto' && this.hero.hp > 0 && this.hero.hp <= healThreshold && this.hero.potions > 0) {
      this.usePotion();
    }

    // Unique: Shattered Chronos Hourglass — cheat death once per floor!
    if (
      this.hero.hp <= 0 &&
      this.hero.hasUnique('chronos_cheat_death') &&
      !this.hero.chronosUsedThisFloor
    ) {
      this.hero.chronosUsedThisFloor = true;
      this.hero.hp = this.hero.isMage()
        ? Math.max(1, Math.round(effMaxHp * 0.2))
        : Math.max(10, Math.round(effMaxHp * 0.2));
      if (this.hero.isMage()) this.hero.shield = this.hero.getEffectiveMaxShield();
      this.hero.invuln = 1.65;
      this.audio.playUpgrade();
      this.addScreenShake(0.32, 0.25);
      this.pushBanner('時光砂漏觸發！', '時間凝滯 · 逆轉死亡');
      this.emitFloatingText(this.hero.x, 2.2, this.hero.z, 'TIME REWIND!', 'relicOrange');
      for (const e of this.enemies) {
        if (e.dead) continue;
        const edx = e.x - this.hero.x;
        const edz = e.z - this.hero.z;
        const edist = Math.hypot(edx, edz);
        if (edist < 4.5) {
          e.vx += (edx / (edist || 1)) * 10;
          e.vz += (edz / (edist || 1)) * 10;
        }
      }
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x,
          0.9,
          this.hero.z,
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

    if (this.hero.hp <= 0) {
      this.hero.isDead = true;
      this.dismissPet(this.hero.id);
      this.requestSave('death');
      this.hero.slainBy = sourceLabel;
      // Downed: open the hero's portal right where they fell (replaces any older one)
      this.placeHeroPortal(this.hero, this.hero.x, this.hero.z, this.depth);
      this.audio.playPortal();
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        this.spawnParticle(
          this.hero.x + Math.cos(a) * 0.35,
          0.7,
          this.hero.z + Math.sin(a) * 0.35,
          Math.cos(a) * 2.4,
          2.2 + Math.random() * 1.4,
          Math.sin(a) * 2.4,
          i % 2 === 0 ? 0x56e4ff : 0xd9fbff,
          1.1,
          0.65,
          -0.4
        );
      }
      this.hero.vx = 0;
      this.hero.vz = 0;
      this.hero.dashTimer = 0;
      this.hero.input.keys.clear();
      this.hero.rig.body.rotation.z = Math.PI * 0.46;
      this.hero.rig.body.position.y = 0.22;
      for (const m of this.hero.rig.flashMaterials) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
    this.emitHud();
  }

  canMoveTo(wx: number, wz: number, radius = 0.38): boolean {
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

  moveWithSlide(
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

  buildSafeGridPath(
    goalGx: number,
    goalGz: number
  ): Array<{ gx: number; gz: number }> {
    const start = worldToWalkableGrid(this.dungeon, this.hero.x, this.hero.z, this.doorUnlocked);
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
        Math.hypot(this.hero.x - curW.x, this.hero.z - curW.z) > 0.3 &&
        !hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, firstW.x, firstW.z, this.doorUnlocked, 0.42)
      ) {
        path.unshift({ gx: start.gx, gz: start.gz });
      }
    }
    return path;
  }

  followGridPath(
    path: Array<{ gx: number; gz: number }>
  ): { moveX: number; moveZ: number } | null {
    while (path.length > 0) {
      const nextTile = path[0];
      const targetW = gridToWorld(nextTile.gx, nextTile.gz);
      const dx = targetW.x - this.hero.x;
      const dz = targetW.z - this.hero.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.36) {
        path.shift();
      } else {
        return { moveX: dx / dist, moveZ: dz / dist };
      }
    }
    return null;
  }

  nudgeHeroToClearTile(): void {
    const cur = worldToGrid(this.hero.x, this.hero.z);
    const targetTile =
      this.hero.ai.path.length > 0 && isTileWalkable(this.dungeon, this.hero.ai.path[0].gx, this.hero.ai.path[0].gz, this.doorUnlocked)
        ? this.hero.ai.path[0]
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
        const dx = cw.x - this.hero.x;
        const dz = cw.z - this.hero.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const step = Math.min(d, 0.55);
          this.hero.x += (dx / d) * step;
          this.hero.z += (dz / d) * step;
          return;
        }
      }
    }
  }

  tryAutoTravelDash(moveX: number, moveZ: number, distToGoal: number): void {
    // Warrior dash travels ~2.15 units; the mage's Blink teleports 5 units, so every
    // safety check below scales with the actual travel distance.
    const mage = this.hero.isMage();
    const travel = mage ? FROST_MAGE.blinkDistance : 2.15;
    if (
      this.hero.dashCooldown > 0 ||
      this.hero.dashTimer > 0 ||
      this.hero.ai.forcePathTimer > 0 ||
      distToGoal < (mage ? travel + 1.5 : 3.4) // never blink past the key / altar / stairs
    ) {
      return;
    }

    const len = Math.hypot(moveX, moveZ);
    if (len < 0.2) return;
    const nx = moveX / len;
    const nz = moveZ / len;

    // Mage: only blink when already heading that way (within ~15°), so it never zig-zags
    if (mage) {
      let diff = Math.atan2(nx, nz) - this.hero.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 0.26) return;
    }

    // Only dash in confirmed safe zones (no nearby enemies or active projectiles)
    for (const e of this.enemies) {
      if (!e.dead && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) < 9.0) {
        return;
      }
    }
    for (const p of this.projectiles) {
      if (Math.hypot(p.x - this.hero.x, p.z - this.hero.z) < 8.0) {
        return;
      }
    }

    // Ensure a completely clear straight corridor ahead for the whole travel distance
    const checkEndX = this.hero.x + nx * (travel + 0.4);
    const checkEndZ = this.hero.z + nz * (travel + 0.4);
    const landX = this.hero.x + nx * travel;
    const landZ = this.hero.z + nz * travel;
    if (
      !hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, checkEndX, checkEndZ, this.doorUnlocked, 0.44) ||
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

    this.hero.facing = Math.atan2(nx, nz);
    this.performDash();
  }

  getPathDashDirection(
    path: Array<{ gx: number; gz: number }>,
    fallback: { moveX: number; moveZ: number }
  ): { moveX: number; moveZ: number; distToGoal: number } {
    if (path.length === 0) {
      return { moveX: fallback.moveX, moveZ: fallback.moveZ, distToGoal: 0 };
    }
    const endW = gridToWorld(path[path.length - 1].gx, path[path.length - 1].gz);
    const distToGoal = Math.hypot(endW.x - this.hero.x, endW.z - this.hero.z);

    // Look up to 3 tiles ahead along the A* path for a clean straight dash vector
    const maxLook = Math.min(path.length - 1, 2);
    for (let i = maxLook; i >= 0; i--) {
      const tw = gridToWorld(path[i].gx, path[i].gz);
      const dx = tw.x - this.hero.x;
      const dz = tw.z - this.hero.z;
      const d = Math.hypot(dx, dz);
      if (
        d > 1.2 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, tw.x, tw.z, this.doorUnlocked, 0.44)
      ) {
        const dirX = dx / d;
        const dirZ = dz / d;
        if (!this.hero.isMage()) return { moveX: dirX, moveZ: dirZ, distToGoal };
        // Mage: Blink only along a genuinely straight stretch of the path. Report how far the
        // path keeps going in this exact direction (waypoints within 0.6 of the line, in LOS),
        // so tryAutoTravelDash refuses to blink around bends.
        let straightRun = 0;
        for (const wp of path) {
          const ww = gridToWorld(wp.gx, wp.gz);
          const vx = ww.x - this.hero.x;
          const vz = ww.z - this.hero.z;
          const along = vx * dirX + vz * dirZ;
          const off = Math.abs(vx * dirZ - vz * dirX);
          if (along < 0) continue;
          if (off > 0.6) break;
          if (!hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, ww.x, ww.z, this.doorUnlocked, 0.44)) break;
          straightRun = Math.max(straightRun, along);
        }
        return { moveX: dirX, moveZ: dirZ, distToGoal: Math.min(distToGoal, straightRun) };
      }
    }
    return { moveX: fallback.moveX, moveZ: fallback.moveZ, distToGoal };
  }

  triggerStuckRecovery(emergencyWarp: boolean): void {
    this.hero.ai.strafeSign *= -1;
    this.hero.ai.path = [];
    this.hero.ai.combatPath = [];
    this.hero.ai.repathTimer = 0;
    this.hero.ai.combatRepathTimer = 0;
    this.hero.ai.forcePathTimer = 2.0;

    if (this.hero.ai.currentTargetId !== null && this.hero.ai.unstuckAttempts >= 1) {
      // Temporarily ignore a deadlocked target while repositioning around obstacles
      this.hero.ai.skipEnemyUntil.set(this.hero.ai.currentTargetId, this.elapsed + 4.5);
    }

    const heroG = worldToWalkableGrid(this.dungeon, this.hero.x, this.hero.z, this.doorUnlocked);

    // Collect verified open escape tiles (room centers + nearby clear tiles 2-4 tiles away)
    const escapeCandidates: Array<{ gx: number; gz: number; score: number }> = [];
    for (const r of this.dungeon.rooms) {
      if (r.role === 'exit' && !this.doorUnlocked) continue;
      if (!isTileWalkable(this.dungeon, r.cx, r.cz, this.doorUnlocked)) continue;
      const rw = gridToWorld(r.cx, r.cz);
      const d = Math.hypot(rw.x - this.hero.x, rw.z - this.hero.z);
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
          this.hero.x = dest.x;
          this.hero.z = dest.z;
          this.hero.vx = 0;
          this.hero.vz = 0;
          this.hero.ai.progressAnchorX = dest.x;
          this.hero.ai.progressAnchorZ = dest.z;
          this.hero.ai.unstuckAttempts = 0;
          this.hero.ai.unstuckTimer = 0;
          this.hero.ai.unstuckPath = [];
          this.hero.ai.skipEnemyUntil.clear();
          this.hero.ai.status = 'Repositioning';
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
      this.hero.ai.unstuckAttempts = 0;
      return;
    }

    // Stage 1 active detour: chart an explicit escape path to an open tile and commit to it for 1.6s
    for (const c of escapeCandidates) {
      const p = this.buildSafeGridPath(c.gx, c.gz);
      if (p.length > 0) {
        this.hero.ai.unstuckPath = p;
        this.hero.ai.unstuckTimer = 1.6;
        this.hero.ai.status = 'Repositioning';
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
  updateMageCombatAI(
    target: EnemyEntity,
    targetDist: number
  ): { moveX: number; moveZ: number } | null {
    const dx = target.x - this.hero.x;
    const dz = target.z - this.hero.z;
    const shotLOS = hasLineOfSight(
      this.dungeon,
      this.hero.x,
      this.hero.z,
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
      const d = Math.hypot(e.x - this.hero.x, e.z - this.hero.z);
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
    const shieldBroken = this.hero.getEffectiveMaxShield() > 0 && this.hero.shield <= 0.5;
    let castNova = false;

    // 1. Frost Nova
    if (
      this.hero.pommelCooldown <= 0 &&
      (within4 >= 3 || (shieldBroken && adjacent > 0) || bossWindup || swarmClose >= 2)
    ) {
      this.performFrostNova();
      this.hero.ai.status = 'Frost Nova!';
      castNova = true;
    }

    // 2. Blink out of a swarm / melee crowd when Nova is not available
    if (
      !castNova &&
      this.hero.pommelCooldown > 0 &&
      this.hero.dashCooldown <= 0 &&
      cn > 0 &&
      (swarmClose >= 2 || adjacent >= 2 || (shieldBroken && adjacent >= 1))
    ) {
      const awayX = this.hero.x - cx / cn;
      const awayZ = this.hero.z - cz / cn;
      const len = Math.hypot(awayX, awayZ);
      const baseAng = len > 0.05 ? Math.atan2(awayX, awayZ) : this.hero.facing + Math.PI;
      // Try straight away from the crowd first, then fan out
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
        const ex = Math.sin(baseAng + off);
        const ez = Math.cos(baseAng + off);
        if (this.canMoveTo(this.hero.x + ex * 2.5, this.hero.z + ez * 2.5, 0.4)) {
          this.performBlink({ x: ex, z: ez });
          this.hero.ai.status = 'Blinking Clear';
          break;
        }
      }
    }

    // 3. Shoot the target when we have a clean shot
    if (shotLOS && targetDist <= FROST_MAGE.projectileRange + this.getEnemyHitRadius(target)) {
      this.hero.facing = Math.atan2(dx, dz);
      if (this.hero.attackCooldown <= 0) this.performAttack();
    } else if (!shotLOS) {
      return null; // let the shared pathing bring us around the corner
    }

    // 4. Movement: kite, hold the band, or close in
    const tryDir = (mx: number, mz: number): { moveX: number; moveZ: number } | null => {
      const l = Math.hypot(mx, mz) || 1;
      const nx = mx / l;
      const nz = mz / l;
      if (this.canMoveTo(this.hero.x + nx * 0.7, this.hero.z + nz * 0.7, 0.4)) return { moveX: nx, moveZ: nz };
      return null;
    };

    if (closest && closestDist < 3) {
      this.hero.ai.status = 'Kiting';
      const ax = this.hero.x - closest.x;
      const az = this.hero.z - closest.z;
      const l = Math.hypot(ax, az) || 1;
      const bx = ax / l;
      const bz = az / l;
      const px = -bz * this.hero.ai.strafeSign;
      const pz = bx * this.hero.ai.strafeSign;
      const step =
        tryDir(bx, bz) ??
        tryDir(bx + px, bz + pz) ??
        tryDir(bx - px, bz - pz) ??
        tryDir(px, pz) ??
        tryDir(-px, -pz);
      if (step) return step;
      // Cornered: Blink sideways if possible, otherwise stand and shoot
      if (this.hero.dashCooldown <= 0) {
        this.performBlink({ x: px, z: pz });
      }
      return { moveX: 0, moveZ: 0 };
    }

    const l = targetDist || 1;
    if (targetDist > 7) {
      this.hero.ai.status = target.isBoss ? `Battling ${target.bossName}` : 'Closing Distance';
      return { moveX: dx / l, moveZ: dz / l };
    }
    if (targetDist < 4.5) {
      const back = tryDir(-dx / l, -dz / l);
      if (back) return { moveX: back.moveX * 0.7, moveZ: back.moveZ * 0.7 };
    }
    // Comfortable range: light strafing so slow ranged shots and boss telegraphs miss
    return {
      moveX: (-dz / l) * 0.3 * this.hero.ai.strafeSign,
      moveZ: (dx / l) * 0.3 * this.hero.ai.strafeSign,
    };
  }

  /**
   * Auto-pilot for any hero (attract mode, the local hero in auto mode, and every bot teammate). The engine's
   * per-hero code reads its hero from `this.hero`, so the body below runs with `hero` as the actor.
   */
  updateAI(hero: Hero, dt: number): { moveX: number; moveZ: number } {
    const prev = this.hero;
    this.setActor(hero);
    try {
      return this.runAI(dt);
    } finally {
      this.setActor(prev);
    }
  }

  runAI(dt: number): { moveX: number; moveZ: number } {
    this.hero.ai.forcePathTimer = Math.max(0, this.hero.ai.forcePathTimer - dt);

    // 0a. Macro Stuck Detector: if hero's XY/XZ position barely changes for 2.5s AND no enemy took damage,
    //     run a 2-stage unstuck recovery flow (Stage 1: detour around obstacle; Stage 2: clean reposition)!
    const anchorDist = Math.hypot(
      this.hero.x - this.hero.ai.progressAnchorX,
      this.hero.z - this.hero.ai.progressAnchorZ
    );
    const recentCombatDamage = this.elapsed - this.hero.ai.lastCombatDamageTime < 2.2;
    if (anchorDist > 1.35 || recentCombatDamage) {
      this.hero.ai.progressAnchorX = this.hero.x;
      this.hero.ai.progressAnchorZ = this.hero.z;
      this.hero.ai.noProgressTimer = 0;
      if (anchorDist > 1.8) {
        this.hero.ai.unstuckAttempts = 0;
      }
    } else {
      this.hero.ai.noProgressTimer += dt;
      if (this.hero.ai.noProgressTimer >= 2.5) {
        this.hero.ai.noProgressTimer = 0;
        this.hero.ai.unstuckAttempts += 1;
        this.triggerStuckRecovery(this.hero.ai.unstuckAttempts >= 2);
      }
    }

    // 0b. Micro stuck watchdog: quick 0.55s snag check for doorway corners
    this.hero.ai.stuckTimer += dt;
    if (this.hero.ai.stuckTimer > 0.55) {
      const progress = Math.hypot(this.hero.x - this.hero.ai.lastCheckX, this.hero.z - this.hero.ai.lastCheckZ);
      this.hero.ai.lastCheckX = this.hero.x;
      this.hero.ai.lastCheckZ = this.hero.z;
      this.hero.ai.stuckTimer = 0;
      if (progress < 0.22 && !recentCombatDamage) {
        this.hero.ai.stuckCount += 1;
        this.hero.ai.combatPath = [];
        this.hero.ai.repathTimer = 0;
        this.hero.ai.combatRepathTimer = 0;
        this.hero.ai.forcePathTimer = 1.4;
        this.hero.ai.strafeSign *= -1;
        if (this.hero.ai.stuckCount >= 2) {
          this.nudgeHeroToClearTile();
          this.hero.ai.stuckCount = 0;
        }
        this.hero.ai.path = [];
      } else {
        this.hero.ai.stuckCount = 0;
      }
    }

    // 1. Auto-heal check
    const healThreshold = this.hero.getAutoHealThreshold(this.hero.getEffectiveMaxHp());
    if (this.hero.hp <= healThreshold && this.hero.potions > 0) {
      this.usePotion();
    }

    // 1b. Boss Telegraph Dodge! Step or dash outside the Boss's danger zone or strafe away from ranged volley
    for (const e of this.enemies) {
      if (e.dead || !e.isBoss || e.bossState !== 'windup') continue;
      if (e.bossSkill === 'ranged_volley') {
        const bdx = this.hero.x - e.x;
        const bdz = this.hero.z - e.z;
        const bDist = Math.hypot(bdx, bdz);
        if (bDist < 8.5 && (e.bossStateTimer ?? 1) < 0.45) {
          this.hero.ai.status = 'Strafing Boss Volley';
          const dirX = bDist > 0.05 ? bdx / bDist : 1;
          const dirZ = bDist > 0.05 ? bdz / bDist : 0;
          const perpX = -dirZ * this.hero.ai.strafeSign;
          const perpZ = dirX * this.hero.ai.strafeSign;
          if (this.canMoveTo(this.hero.x + perpX * 0.7, this.hero.z + perpZ * 0.7, 0.4)) {
            return { moveX: perpX, moveZ: perpZ };
          }
          return { moveX: -perpX, moveZ: -perpZ };
        }
        continue;
      }

      const tx = e.telegraphX ?? e.x;
      const tz = e.telegraphZ ?? e.z;
      const rad = e.telegraphRadius ?? 2.8;
      const dx = this.hero.x - tx;
      const dz = this.hero.z - tz;
      const dist = Math.hypot(dx, dz);
      if (dist < rad + 0.65) {
        this.hero.ai.status = 'Evading Boss Strike';
        const escX = dist > 0.05 ? dx / dist : Math.cos(this.elapsed);
        const escZ = dist > 0.05 ? dz / dist : Math.sin(this.elapsed);
        this.hero.facing = Math.atan2(escX, escZ);
        if (this.hero.dashCooldown <= 0 && (e.bossStateTimer ?? 1) < 0.52) {
          this.performDash();
        }
        if (this.canMoveTo(this.hero.x + escX * 0.7, this.hero.z + escZ * 0.7, 0.4)) {
          return { moveX: escX, moveZ: escZ };
        }
        const perpX = -escZ * this.hero.ai.strafeSign;
        const perpZ = escX * this.hero.ai.strafeSign;
        if (this.canMoveTo(this.hero.x + perpX * 0.7, this.hero.z + perpZ * 0.7, 0.4)) {
          return { moveX: perpX, moveZ: perpZ };
        }
        return { moveX: -perpX, moveZ: -perpZ };
      }
    }

    // 1b-2. Rescue a downed teammate: ranks above fighting, below the potion check and boss dodging above
    const rescueMove = this.aiRescueStep(dt);
    if (rescueMove) return rescueMove;

    // 1b-3. Bots that drifted away from the leader drop the fight and walk back first (hysteresis: resume fighting
    //       only once they are close again)
    if (this.hero.isBot) {
      const me = this.hero;
      const leader = this.isAwayMode(me) && this.awayAnchor ? this.awayAnchor : this.localHero;
      const d = Math.hypot(leader.x - me.x, leader.z - me.z);
      if (me.ai.regrouping) {
        if (d <= BOT_REGROUP_DONE_DIST) me.ai.regrouping = false;
      } else if (d > BOT_REGROUP_DIST) {
        me.ai.regrouping = true;
        me.ai.combatPath = [];
        me.ai.currentTargetId = null;
      }
      if (me.ai.regrouping) {
        const step = this.aiFollowLeader(dt);
        me.ai.status = 'Regrouping';
        return step;
      }
    }

    // 1c. Active Unstuck Detour: commit to breaking free from a pillar/corner deadlock before re-engaging
    if (this.hero.ai.unstuckTimer > 0) {
      this.hero.ai.unstuckTimer = Math.max(0, this.hero.ai.unstuckTimer - dt);
      const escapeStep = this.followGridPath(this.hero.ai.unstuckPath);
      if (escapeStep) {
        this.hero.ai.status = 'Repositioning';
        const dashVec = this.getPathDashDirection(this.hero.ai.unstuckPath, escapeStep);
        this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
        return escapeStep;
      }
      this.hero.ai.unstuckTimer = 0;
    }

    // 1d. If standing right beside the Relic Key with clear LOS and no melee threat on top of us, grab it immediately!
    // (bots follow the local hero instead of pursuing the floor objectives)
    if (!this.hasKey && !this.hero.isBot) {
      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const kdx = kw.x - this.hero.x;
      const kdz = kw.z - this.hero.z;
      const kDist = Math.hypot(kdx, kdz);
      if (
        kDist < 2.65 &&
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, kw.x, kw.z, this.doorUnlocked, 0.36)
      ) {
        const immediateThreat = this.enemies.some(
          (e) => !e.dead && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) < 2.2
        );
        if (!immediateThreat) {
          this.hero.ai.status = 'Claiming Relic Key';
          return { moveX: kdx / (kDist || 1), moveZ: kdz / (kDist || 1) };
        }
      }
    }

    // 2. Check alive REACHABLE enemies:
    //    - Always finish every enemy inside the hero's current room before leaving!
    //    - Tactical Boss Rule: if a Boss is nearby, eliminate ranged escorts near the Boss first!
    const heroG = worldToWalkableGrid(this.dungeon, this.hero.x, this.hero.z, this.doorUnlocked);
    const currentRoom = this.dungeon.rooms.find(
      (r) =>
        heroG.gx >= r.x &&
        heroG.gx < r.x + r.w &&
        heroG.gz >= r.z &&
        heroG.gz < r.z + r.h
    );
    const exitRoom = this.dungeon.rooms.find((r) => r.role === 'exit');
    const nearbyBoss = this.enemies.find(
      (e) => !e.dead && e.isBoss && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) < 13.0
    );

    let nearestEnemy: EnemyEntity | null = null;
    let nearestEnemyDist = Infinity;
    let roomEnemy: EnemyEntity | null = null;
    let roomEnemyDist = Infinity;
    let priorityRanged: EnemyEntity | null = null;
    let priorityRangedDist = Infinity;

    // Local hero away in town: bots hold the post. They only fight what comes within 8 of the post and give up
    // any target once they have been pulled more than 10 away from it (they never explore or chase).
    const away = this.isAwayMode(this.hero);
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (away && (!this.withinLeash(this.hero.x, this.hero.z, 10) || !this.withinLeash(e.x, e.z, 8))) continue;
      const skipUntil = this.hero.ai.skipEnemyUntil.get(e.id);
      if (skipUntil !== undefined && this.elapsed < skipUntil) continue;

      const d = Math.hypot(e.x - this.hero.x, e.z - this.hero.z);
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
        this.hero.x,
        this.hero.z,
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

    this.hero.ai.currentTargetId = nearestEnemy ? nearestEnemy.id : null;

    if (nearestEnemy) {
      this.hero.ai.status = priorityRanged
        ? 'Eliminating Ranged Threat'
        : nearestEnemy.isBoss
        ? `Battling ${nearestEnemy.bossName}`
        : 'Engaging Foes';
      const dx = nearestEnemy.x - this.hero.x;
      const dz = nearestEnemy.z - this.hero.z;

      const clearLOS = hasLineOfSight(
        this.dungeon,
        this.hero.x,
        this.hero.z,
        nearestEnemy.x,
        nearestEnemy.z,
        this.doorUnlocked,
        0.42
      );

      // Frost Mage / Hunter: ranged kiting combat. Falls through to path navigation only when LOS is blocked.
      if (this.hero.isMage()) {
        const mageMove = this.updateMageCombatAI(nearestEnemy, nearestEnemyDist);
        if (mageMove) return mageMove;
      } else if (this.hero.isHunter()) {
        if (this.hero.pommelCooldown <= 0) {
          const pet = this.pets.get(this.hero.id);
          if (!pet || pet.hp <= pet.maxHp * 0.7 || nearestEnemyDist < 8.5) {
            this.performHunterPetSkill();
          }
        }
        const shotLOS = hasLineOfSight(
          this.dungeon,
          this.hero.x,
          this.hero.z,
          nearestEnemy.x,
          nearestEnemy.z,
          this.doorUnlocked,
          0.2
        );
        if (shotLOS && nearestEnemyDist <= HUNTER.projectileRange - 0.5) {
          this.hero.facing = Math.atan2(dx, dz);
          if (this.hero.attackCooldown <= 0) this.performHunterAttack();
          const len = nearestEnemyDist || 1;
          if (nearestEnemyDist < 3.6) {
            // Kite backward while shooting
            return { moveX: -dx / len, moveZ: -dz / len };
          }
          if (nearestEnemyDist > 7.5) {
            return { moveX: (dx / len) * 0.65, moveZ: (dz / len) * 0.65 };
          }
          return {
            moveX: (-dz / len) * 0.45 * this.hero.ai.strafeSign,
            moveZ: (dx / len) * 0.45 * this.hero.ai.strafeSign,
          };
        }
      }

      // Auto AI casts Pommel Strike when off CD to interrupt windups or stun nearby foes
      if (!this.hero.isRangedClass() && this.hero.pommelCooldown <= 0) {
        let inShockRange = 0;
        let hasPriorityInterrupt = false;
        let hasUnstunnedElite = false;
        for (const e of this.enemies) {
          if (e.dead) continue;
          const ed = Math.hypot(e.x - this.hero.x, e.z - this.hero.z);
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
          this.hero.facing = Math.atan2(dx, dz);
          this.performPommelStrike();
        }
      }

      const attackRange = nearestEnemy.isBoss ? 2.25 : 1.85;
      if (!this.hero.isRangedClass() && nearestEnemyDist <= attackRange && clearLOS) {
        this.hero.facing = Math.atan2(dx, dz);
        if (this.hero.attackCooldown <= 0) {
          this.performAttack();
        }
        return {
          moveX: (-dz / (nearestEnemyDist || 1)) * 0.25 * this.hero.ai.strafeSign,
          moveZ: (dx / (nearestEnemyDist || 1)) * 0.25 * this.hero.ai.strafeSign,
        };
      }

      if (clearLOS && this.hero.ai.forcePathTimer <= 0) {
        this.hero.ai.combatPath = [];
        return { moveX: dx / nearestEnemyDist, moveZ: dz / nearestEnemyDist };
      }

      // Line of sight is blocked by a wall corner or pillar: navigate cleanly via walkable-snapped A*!
      this.hero.ai.combatRepathTimer -= dt;
      if (this.hero.ai.combatPath.length === 0 || this.hero.ai.combatRepathTimer <= 0) {
        this.hero.ai.combatRepathTimer = 0.4;
        const enemyG = worldToWalkableGrid(
          this.dungeon,
          nearestEnemy.x,
          nearestEnemy.z,
          this.doorUnlocked
        );
        this.hero.ai.combatPath = this.buildSafeGridPath(enemyG.gx, enemyG.gz);
      }
      const step = this.followGridPath(this.hero.ai.combatPath);
      if (step) return step;

      // Pillar-flank fallback: if hero & enemy share a snapped tile across a pillar edge, flank sideways around it!
      const len = nearestEnemyDist || 1;
      const perpX = (-dz / len) * this.hero.ai.strafeSign;
      const perpZ = (dx / len) * this.hero.ai.strafeSign;
      if (this.canMoveTo(this.hero.x + perpX * 0.65, this.hero.z + perpZ * 0.65, 0.4)) {
        return { moveX: perpX, moveZ: perpZ };
      }
      if (this.canMoveTo(this.hero.x - perpX * 0.65, this.hero.z - perpZ * 0.65, 0.4)) {
        return { moveX: -perpX, moveZ: -perpZ };
      }
    }

    // 2a. Frost Mage: with no enemy nearby and the shield below 60%, hold position until it refills
    if (this.hero.isMage() && !nearestEnemy) {
      const maxShield = this.hero.getEffectiveMaxShield();
      const anyNear = this.enemies.some(
        (e) => !e.dead && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) < 11
      );
      if (maxShield > 0 && this.hero.shield < maxShield * 0.6) this.hero.ai.mageRecharging = true;
      if (this.hero.shield >= maxShield * 0.99) this.hero.ai.mageRecharging = false;
      if (maxShield > 0 && this.hero.ai.mageRecharging && !anyNear) {
        this.hero.ai.status = 'Recharging Frost Shield';
        this.hero.ai.progressAnchorX = this.hero.x;
        this.hero.ai.progressAnchorZ = this.hero.z;
        this.hero.ai.noProgressTimer = 0;
        this.hero.ai.stuckTimer = 0;
        this.hero.ai.lastCheckX = this.hero.x;
        this.hero.ai.lastCheckZ = this.hero.z;
        return { moveX: 0, moveZ: 0 };
      }
    }

    // Away mode: nothing else interests a bot (no key, loot, crates, runes, shops or stairs): back to the post
    if (away) return this.aiFollowLeader(dt);

    // 2b. No active threats in room: if the Relic Key is in sight nearby, claim it immediately!
    if (!this.hasKey && !this.hero.isBot) {
      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const kdx = kw.x - this.hero.x;
      const kdz = kw.z - this.hero.z;
      const kDist = Math.hypot(kdx, kdz);
      if (
        kDist < 8.5 &&
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, kw.x, kw.z, this.doorUnlocked, 0.42)
      ) {
        this.hero.ai.status = 'Claiming Relic Key';
        const dirX = kdx / (kDist || 1);
        const dirZ = kdz / (kDist || 1);
        this.tryAutoTravelDash(dirX, dirZ, kDist);
        return { moveX: dirX, moveZ: dirZ };
      }
    }

    // 3. Collect nearby loose gold & potion loot (only if body-width line-of-sight is clear)
    for (const l of this.loots) {
      if (l.collected || l.type === 'relic' || l.ownerId !== this.hero.id) continue;
      const d = Math.hypot(l.x - this.hero.x, l.z - this.hero.z);
      if (
        d < 4.5 &&
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, l.x, l.z, this.doorUnlocked, 0.42)
      ) {
        this.hero.ai.status = 'Gathering Spoils';
        return { moveX: (l.x - this.hero.x) / (d || 1), moveZ: (l.z - this.hero.z) / (d || 1) };
      }
    }

    // 4. Smash nearby crate if right next to hero
    for (const br of this.breakables) {
      if (br.broken) continue;
      const d = Math.hypot(br.x - this.hero.x, br.z - this.hero.z);
      if (d < 2.0) {
        this.hero.facing = Math.atan2(br.x - this.hero.x, br.z - this.hero.z);
        if (this.hero.attackCooldown <= 0) this.performAttack();
        break;
      }
    }

    // 4a. Pick up nearby dropped Relics (wait briefly so pop-out arc & Orange/Green beam register clearly!)
    let nearestRelic: LootEntity | null = null;
    let nearestRelicDist = Infinity;
    for (const l of this.loots) {
      if (l.collected || l.type !== 'relic' || !l.relic || l.ownerId !== this.hero.id) continue;
      const readyAge = (l.pickupDelay ?? 0.85) * 0.72;
      if (l.age < readyAge) continue;
      const d = Math.hypot(l.x - this.hero.x, l.z - this.hero.z);
      const maxSearch = l.relic.rarity === 'orange' || l.relic.rarity === 'green' ? 11.0 : 5.8;
      if (
        d < maxSearch &&
        d < nearestRelicDist &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, l.x, l.z, this.doorUnlocked, 0.36)
      ) {
        nearestRelicDist = d;
        nearestRelic = l;
      }
    }
    if (nearestRelic && nearestRelicDist > 0.3) {
      this.hero.ai.status = 'Collecting Relic';
      const dirX = (nearestRelic.x - this.hero.x) / nearestRelicDist;
      const dirZ = (nearestRelic.z - this.hero.z) / nearestRelicDist;
      return { moveX: dirX, moveZ: dirZ };
    }

    // 4a-2. Auto-Heal at any discovered Healing Sanctum (Rune Well) whenever HP is not full
    if (this.hero.hp < this.hero.getEffectiveMaxHp()) {
      let bestRune: AnimatedLightProp | null = null;
      let bestRuneDist = Infinity;
      let bestRuneGrid: { gx: number; gz: number } | null = null;

      for (const lp of this.lightProps) {
        if (lp.kind !== 'rune' || lp.used) continue;
        const rg = worldToGrid(lp.x, lp.z);
        const discovered = Boolean(this.dungeon.explored[rg.gz]?.[rg.gx]);
        const d = Math.hypot(lp.x - this.hero.x, lp.z - this.hero.z);
        const directVisible =
          d < 10.5 &&
          hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, lp.x, lp.z, this.doorUnlocked, 0.36);
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
        const dx = bestRune.x - this.hero.x;
        const dz = bestRune.z - this.hero.z;
        this.hero.ai.status = 'Healing at Sanctum';
        if (
          this.hero.ai.forcePathTimer <= 0 &&
          hasLineOfSight(
            this.dungeon,
            this.hero.x,
            this.hero.z,
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
        this.hero.ai.repathTimer -= dt;
        const lastRunePt = this.hero.ai.path[this.hero.ai.path.length - 1];
        const pathMatchesRune =
          Boolean(lastRunePt) &&
          lastRunePt.gx === bestRuneGrid.gx &&
          lastRunePt.gz === bestRuneGrid.gz;
        if (!pathMatchesRune || this.hero.ai.path.length === 0 || this.hero.ai.repathTimer <= 0) {
          this.hero.ai.repathTimer = 0.65;
          this.hero.ai.path = this.buildSafeGridPath(bestRuneGrid.gx, bestRuneGrid.gz);
        }
        const runeStep = this.followGridPath(this.hero.ai.path);
        if (runeStep) {
          const dashVec = this.getPathDashDirection(this.hero.ai.path, runeStep);
          this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
          return runeStep;
        }
      }
    }

    // 4b. Auto-Upgrade & Smart Potion Restock (Altar of Ascension & Dedicated Potion Shop)
    // Target potion stock scales with depth (4 early -> 5-8 deeper) so Auto buys potions when running low
    const targetPotions = Math.min(8, 4 + Math.floor(this.depth / 6));
    const urgentPotionNeed = this.hero.potions <= 2 && this.hero.gold >= this.getPotionCost();
    const wantsMorePotions = this.hero.potions < targetPotions && this.hero.gold >= this.getPotionCost();
    const canAutoUpgradeStat =
      this.hero.gold >= this.getUpgradeCost() &&
      this.getUpgradeOptions().some((o) => !o.maxed);
    const hasSellableBagRelics = this.hero.relicBag.some(
      (r) => r.rarity === 'blue' || r.rarity === 'yellow'
    );

    if (!this.hero.isBot && this.dungeon.altarPos && (canAutoUpgradeStat || wantsMorePotions)) {
      const aw = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
      const dx = aw.x - this.hero.x;
      const dz = aw.z - this.hero.z;
      const altarDist = Math.hypot(dx, dz);

      if (altarDist < 2.2) {
        this.hero.ai.status = urgentPotionNeed ? 'Restocking Elixirs' : 'Ascending at Altar';
        this.hero.ai.stuckTimer = 0;
        this.hero.ai.stuckCount = 0;
        this.hero.ai.noProgressTimer = 0;
        this.hero.ai.progressAnchorX = this.hero.x;
        this.hero.ai.progressAnchorZ = this.hero.z;
        this.hero.ai.upgradeCooldown -= dt;
        if (this.hero.ai.upgradeCooldown <= 0) {
          if (urgentPotionNeed) {
            if (this.purchasePotion()) {
              this.hero.ai.upgradeCooldown = 0.42;
              this.hero.ai.path = [];
            }
          } else if (this.hero.gold >= this.getUpgradeCost()) {
            const cycle: UpgradeKind[] = this.hero.isMage()
              ? ['hp_shield', 'atk', 'shield_speed', 'crit']
              : this.hero.isHunter()
              ? ['hp', 'atk', 'atk_speed', 'crit']
              : ['hp', 'atk', 'armor', 'crit'];
            const startIdx = Math.max(0, cycle.indexOf(this.hero.autoNextUpgrade));
            let choice: UpgradeKind = 'atk';
            for (let offset = 0; offset < cycle.length; offset++) {
              const cand = cycle[(startIdx + offset) % cycle.length];
              if (this.hero.isUpgradeMaxed(cand)) continue;
              choice = cand;
              break;
            }
            if (this.purchaseUpgrade(choice)) {
              const nextIdx = (cycle.indexOf(choice) + 1) % cycle.length;
              this.hero.autoNextUpgrade = cycle[nextIdx];
              this.hero.ai.upgradeCooldown = 0.55;
              this.hero.ai.path = [];
            }
          } else if (this.hero.potions < targetPotions && this.hero.gold >= this.getPotionCost()) {
            if (this.purchasePotion()) {
              this.hero.ai.upgradeCooldown = 0.42;
              this.hero.ai.path = [];
            }
          }
        }
        return { moveX: 0, moveZ: 0 };
      }

      this.hero.ai.status = 'Visiting Altar';
      if (
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, aw.x, aw.z, this.doorUnlocked, 0.42)
      ) {
        const dirX = dx / (altarDist || 1);
        const dirZ = dz / (altarDist || 1);
        this.tryAutoTravelDash(dirX, dirZ, altarDist);
        return { moveX: dirX, moveZ: dirZ };
      }
      this.hero.ai.repathTimer -= dt;
      if (this.hero.ai.path.length === 0 || this.hero.ai.repathTimer <= 0) {
        this.hero.ai.repathTimer = 0.7;
        this.hero.ai.path = this.buildSafeGridPath(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
      }
      const altarStep = this.followGridPath(this.hero.ai.path);
      if (altarStep) {
        const dashVec = this.getPathDashDirection(this.hero.ai.path, altarStep);
        this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
        return altarStep;
      }
    }

    // 4c. Dedicated Elixir Potion Shop visit on every 3rd floor (Depth 3, 6, 9, 12...)
    // Auto sells all unused Blue & Yellow relics in bag and restocks potions when needed
    if (!this.hero.isBot && this.dungeon.shopPos && (wantsMorePotions || hasSellableBagRelics)) {
      const sw = gridToWorld(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
      const dx = sw.x - this.hero.x;
      const dz = sw.z - this.hero.z;
      const shopDist = Math.hypot(dx, dz);

      if (shopDist < 2.2) {
        this.hero.ai.status = hasSellableBagRelics ? 'Selling Spare Relics' : 'Buying Elixirs';
        this.hero.ai.stuckTimer = 0;
        this.hero.ai.stuckCount = 0;
        this.hero.ai.noProgressTimer = 0;
        this.hero.ai.progressAnchorX = this.hero.x;
        this.hero.ai.progressAnchorZ = this.hero.z;
        this.hero.ai.upgradeCooldown -= dt;
        if (this.hero.ai.upgradeCooldown <= 0) {
          if (hasSellableBagRelics && this.sellCommonBagRelics(true) > 0) {
            this.hero.ai.upgradeCooldown = 0.45;
            this.hero.ai.path = [];
          } else if (this.hero.potions < targetPotions && this.purchasePotion()) {
            this.hero.ai.upgradeCooldown = 0.42;
            this.hero.ai.path = [];
          }
        }
        return { moveX: 0, moveZ: 0 };
      }

      this.hero.ai.status = 'Visiting Potion Shop';
      if (
        this.hero.ai.forcePathTimer <= 0 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, sw.x, sw.z, this.doorUnlocked, 0.42)
      ) {
        const dirX = dx / (shopDist || 1);
        const dirZ = dz / (shopDist || 1);
        this.tryAutoTravelDash(dirX, dirZ, shopDist);
        return { moveX: dirX, moveZ: dirZ };
      }
      this.hero.ai.repathTimer -= dt;
      const lastShopPt = this.hero.ai.path[this.hero.ai.path.length - 1];
      const pathMatchesShop =
        Boolean(lastShopPt) &&
        lastShopPt.gx === this.dungeon.shopPos.gx &&
        lastShopPt.gz === this.dungeon.shopPos.gz;
      if (!pathMatchesShop || this.hero.ai.path.length === 0 || this.hero.ai.repathTimer <= 0) {
        this.hero.ai.repathTimer = 0.7;
        this.hero.ai.path = this.buildSafeGridPath(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
      }
      const shopStep = this.followGridPath(this.hero.ai.path);
      if (shopStep) {
        const dashVec = this.getPathDashDirection(this.hero.ai.path, shopStep);
        this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
        return shopStep;
      }
    }

    // 5-bot. Bot teammates stick with the local hero instead of exploring on their own
    if (this.hero.isBot) return this.aiFollowLeader(dt);

    // 5. Strategic objective pathfinding
    this.hero.ai.repathTimer -= dt;
    if (this.hero.ai.path.length === 0 || this.hero.ai.repathTimer <= 0) {
      this.hero.ai.repathTimer = 0.85;
      let goal: { gx: number; gz: number } | null = null;

      if (!this.hasKey) {
        // Once the Relic Key has been discovered on the map, head straight for it instead of detouring!
        const keyDiscovered = Boolean(
          this.dungeon.explored[this.dungeon.keyPos.gz]?.[this.dungeon.keyPos.gx]
        );
        if (keyDiscovered) {
          goal = { gx: this.dungeon.keyPos.gx, gz: this.dungeon.keyPos.gz };
          this.hero.ai.status = 'Seeking Relic Key';
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
            this.hero.ai.status = 'Exploring Chambers';
          } else {
            goal = { gx: this.dungeon.keyPos.gx, gz: this.dungeon.keyPos.gz };
            this.hero.ai.status = 'Seeking Relic Key';
          }
        }
      } else if (!this.doorUnlocked) {
        // Walk adjacent to Locked Gate to unlock it
        goal = this.findApproachTile(this.dungeon.doorPos.gx, this.dungeon.doorPos.gz);
        this.hero.ai.status = 'Unlocking Seal Gate';
      } else {
        goal = { gx: this.dungeon.stairsPos.gx, gz: this.dungeon.stairsPos.gz };
        this.hero.ai.status = 'Descending Deeper';
      }

      if (goal) {
        this.hero.ai.path = this.buildSafeGridPath(goal.gx, goal.gz);
      }
    }

    const navStep = this.followGridPath(this.hero.ai.path);
    if (navStep) {
      const dashVec = this.getPathDashDirection(this.hero.ai.path, navStep);
      this.tryAutoTravelDash(dashVec.moveX, dashVec.moveZ, dashVec.distToGoal);
      return navStep;
    }

    // Fallback direct approach ONLY when line-of-sight is genuinely clear (never walk blindly into walls)
    if (!this.hasKey) {
      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const dx = kw.x - this.hero.x;
      const dz = kw.z - this.hero.z;
      const d = Math.hypot(dx, dz);
      if (
        d > 0.25 &&
        d < 3.5 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, kw.x, kw.z, this.doorUnlocked, 0.32)
      ) {
        return { moveX: dx / d, moveZ: dz / d };
      }
    } else if (!this.doorUnlocked) {
      const dw = gridToWorld(this.dungeon.doorPos.gx, this.dungeon.doorPos.gz);
      const dx = dw.x - this.hero.x;
      const dz = dw.z - this.hero.z;
      const d = Math.hypot(dx, dz);
      if (
        d > 0.25 &&
        d < 2.6 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, dw.x, dw.z, true, 0.2)
      ) {
        return { moveX: dx / d, moveZ: dz / d };
      }
    } else {
      const sw = gridToWorld(this.dungeon.stairsPos.gx, this.dungeon.stairsPos.gz);
      const dx = sw.x - this.hero.x;
      const dz = sw.z - this.hero.z;
      const d = Math.hypot(dx, dz);
      if (
        d > 0.2 &&
        d < 3.5 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, sw.x, sw.z, this.doorUnlocked, 0.32)
      ) {
        return { moveX: dx / d, moveZ: dz / d };
      }
    }

    return { moveX: 0, moveZ: 0 };
  }

  /**
   * Step 1b-2 of the auto-pilot. Walks to the nearest downed teammate and holds still beside them (announcing the
   * rescue through `rescueTargetId`, which `updateRescue` turns into progress). Returns null when there is nothing
   * to rescue, or when enemies are standing on the downed hero (fight them first so the rescue is not cancelled).
   */
  aiRescueStep(dt: number): { moveX: number; moveZ: number } | null {
    const me = this.hero;
    me.rescueTargetId = null;
    if (this.inTown) return null;
    let target: Hero | null = null;
    let bestD = Infinity;
    const away = this.isAwayMode(me);
    for (const o of this.heroes) {
      if (o === me || !o.isDead) continue;
      if (away && !this.withinLeash(o.x, o.z, 10)) continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      if (d < bestD) {
        bestD = d;
        target = o;
      }
    }
    if (!target || bestD > 45) return null;
    for (const e of this.enemies) {
      if (!e.dead && e.stunTimer <= 0.1 && Math.hypot(e.x - target.x, e.z - target.z) < 2.4) return null;
    }
    const ai = me.ai;
    if (bestD <= 1.1) {
      // Hold still next to them; keep the stuck detectors quiet
      me.rescueTargetId = target.id;
      ai.status = 'Rescuing Ally';
      ai.progressAnchorX = me.x;
      ai.progressAnchorZ = me.z;
      ai.noProgressTimer = 0;
      ai.stuckTimer = 0;
      ai.stuckCount = 0;
      ai.lastCheckX = me.x;
      ai.lastCheckZ = me.z;
      return { moveX: 0, moveZ: 0 };
    }
    ai.status = 'Running to Rescue';
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    if (ai.forcePathTimer <= 0 && hasLineOfSight(this.dungeon, me.x, me.z, target.x, target.z, this.doorUnlocked, 0.4)) {
      return { moveX: dx / bestD, moveZ: dz / bestD };
    }
    const tg = worldToWalkableGrid(this.dungeon, target.x, target.z, this.doorUnlocked);
    ai.repathTimer -= dt;
    const last = ai.path[ai.path.length - 1];
    if (ai.path.length === 0 || ai.repathTimer <= 0 || !last || last.gx !== tg.gx || last.gz !== tg.gz) {
      ai.repathTimer = 0.5;
      ai.path = this.buildSafeGridPath(tg.gx, tg.gz);
    }
    const step = this.followGridPath(ai.path);
    if (step) return step;
    return { moveX: dx / bestD, moveZ: dz / bestD };
  }

  /**
   * True when a companion (bot or pet) at (x, z) is far enough from its leader/owner to be warped back: near the
   * screen edge when the leader is the camera's hero, otherwise beyond COMPANION_WARP_DIST.
   */
  isCompanionTooFar(leader: { x: number; z: number }, x: number, z: number): boolean {
    const d = Math.hypot(x - leader.x, z - leader.z);
    if (d < 4) return false;
    if (leader !== this.localHero || this.inTown) return d > COMPANION_WARP_DIST;
    _projVec.set(x, 0.6, z).project(this.camera);
    return Math.abs(_projVec.x) > COMPANION_EDGE_NDC || Math.abs(_projVec.y) > COMPANION_EDGE_NDC;
  }

  /** Bot while the local hero is in town (spec §3.4): wait at the post the local hero left from. */
  isAwayMode(me: Hero): boolean {
    return me.isBot && this.localHero.inTown;
  }

  withinLeash(x: number, z: number, radius: number): boolean {
    const a = this.awayAnchor;
    if (!a) return true;
    return Math.hypot(x - a.x, z - a.z) <= radius;
  }

  /**
   * Bot teammates: keep within a few tiles of the local hero (or, while the local hero is in town, of the post
   * they left from); hold still (no stuck-detector churn) when close.
   */
  aiFollowLeader(dt: number): { moveX: number; moveZ: number } {
    const me = this.hero;
    const ai = me.ai;
    const away = this.isAwayMode(me);
    const leader: { x: number; z: number } =
      away && this.awayAnchor ? this.awayAnchor : this.localHero;
    if (leader === me) return { moveX: 0, moveZ: 0 };
    const dx = leader.x - me.x;
    const dz = leader.z - me.z;
    const dist = Math.hypot(dx, dz);
    // Waiting bots stand spread out within ~3 of the post
    const slot = away ? 0.9 + (me.botIndex % 3) * 0.6 : 1.8 + (me.botIndex % 3) * 0.9;
    if (away ? dist > 36 : this.isCompanionTooFar(leader, me.x, me.z)) {
      // Separated (snagged behind a wall / the gate, or about to leave the screen): catch up instantly
      this.warpHeroNear(me, leader.x, leader.z, me.botIndex - 1);
      return { moveX: 0, moveZ: 0 };
    }
    if (dist <= slot + (away ? 0.6 : 1.2)) {
      ai.status = away ? 'Holding Post' : 'Following Leader';
      ai.progressAnchorX = me.x;
      ai.progressAnchorZ = me.z;
      ai.noProgressTimer = 0;
      ai.stuckTimer = 0;
      ai.stuckCount = 0;
      ai.lastCheckX = me.x;
      ai.lastCheckZ = me.z;
      ai.path = [];
      return { moveX: 0, moveZ: 0 };
    }
    ai.status = 'Following Leader';
    if (ai.forcePathTimer <= 0 && hasLineOfSight(this.dungeon, me.x, me.z, leader.x, leader.z, this.doorUnlocked, 0.42)) {
      ai.path = [];
      if (dist > 9) this.tryAutoTravelDash(dx / dist, dz / dist, dist);
      return { moveX: dx / dist, moveZ: dz / dist };
    }
    const lg = worldToWalkableGrid(this.dungeon, leader.x, leader.z, this.doorUnlocked);
    ai.repathTimer -= dt;
    const last = ai.path[ai.path.length - 1];
    if (ai.path.length === 0 || ai.repathTimer <= 0 || !last || Math.abs(last.gx - lg.gx) + Math.abs(last.gz - lg.gz) > 3) {
      ai.repathTimer = 0.6;
      ai.path = this.buildSafeGridPath(lg.gx, lg.gz);
    }
    const step = this.followGridPath(ai.path);
    if (step) return step;
    return { moveX: dx / dist, moveZ: dz / dist };
  }

  findApproachTile(gx: number, gz: number): { gx: number; gz: number } {
    const start = worldToGrid(this.hero.x, this.hero.z);
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

  update(dt: number): void {
    // P7: while the room connection is being re-established the host freezes everything; a teammate freezes the dungeon view
    // (their own town keeps running: it is local)
    if (this.mpPaused && this.mp && (this.mp.role === 'host' || !this.inTown)) return;
    this.elapsed += dt;
    if (this.mp) this.mpPump(dt);

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
      if (this.mp?.hold) {
        // Room game: stay black until the host's answer (new floor, town hand-off, start) has arrived
        const mp = this.mp;
        if (mp.holdKind === 'level' && this.townBuilt && performance.now() - mp.holdSince > RETURN_WAIT_MS) {
          // The host never answered my hand-back: give up and fade back into my town (P5-C)
          this.mpGuestReturnFailed('房主沒有回應，無法進入地城，已留在城鎮');
        } else {
          this.fadeOpacity = 1;
          this.emitHud();
          return;
        }
      }
      this.fadeOpacity = Math.max(0, this.fadeOpacity - dt * 2.0);
      this.emitHud();
      if (this.fadeOpacity <= 0) {
        this.transitionState = 'none';
        if (this.queuedRestartClass) {
          this.restartRun(this.queuedRestartClass, this.queuedRestartLoadout ?? undefined, this.queuedRestartDepth);
        }
      }
    }

    // Everybody is downed: the dungeon freezes (spec §3.4) until a hero walks back through a portal / is
    // revived by the "back to town" button. As long as one hero stands, the world keeps running (spec §3.3).
    if (this.heroes.every((h) => h.isDead)) {
      this.mpHostFreezeFlush();
      this.mpHostFrozenTick();
      this.animateHeroPortal(dt);
      this.updateParticles(dt);
      return;
    }

    this.runElapsedSec += dt;
    this.syncBotGear(dt);

    // Brief tactile hit-stop on sword impact
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      return;
    }

    // Per-hero simulation (cooldowns, input / AI, movement, rig). Downed heroes sit still.
    const localHero = this.localHero;
    if (this.inTown) {
      // The camera is in the town: only the local hero lives here; the dungeon (if teammates are still in it)
      // is simulated without being shown (spec §3.4)
      this.setActor(localHero);
      this.updateHeroFrame(dt, true);
      this.updateRescue(dt);
      this.runDungeonBackground(dt);
      if (this.mp?.role === 'host' && !this.dungeonCtx) this.mpHostFrozenTick();
      if (this.mp) {
        // Room game: others in town are drawn, my own position goes out at 5 Hz while I move (P5-C)
        this.mpTownSend(dt);
        this.mpTownRemotes(dt);
      }
    } else if (this.mp?.role === 'guest') {
      // Teammate client: predict my own hero, draw everybody else from the host's snapshots
      this.mpGuestFrame(dt);
      this.updateRescue(dt);
      if (this.botMarkers.size > 0) {
        for (const h of this.heroes) if (h.isBot || h.isRemote) this.refreshBotPlate(h);
      }
    } else {
      if (this.mp) this.mpHostPre();
      for (const h of this.heroes) {
        if (h.isDead || h.inTown) continue;
        this.setActor(h);
        this.updateHeroFrame(dt, h === localHero);
      }
      this.setActor(localHero);
      this.updateRescue(dt);
      if (this.botMarkers.size > 0) {
        for (const h of this.heroes) if (h.isBot || h.isRemote) this.refreshBotPlate(h);
      }
    }

    // 4. Key Pickup, Locked Gate Unlock, Stairwell Descent (dungeon only)
    if (!this.inTown && this.mp?.role === 'guest') {
      // The host simulates monsters / loot / objectives; only my own spikes fly here
      this.updateHeroProjectiles(dt);
      this.mpGuestWorld(dt);
    } else if (!this.inTown) {
      this.updateObjectives(dt);

      // 5. Update Enemies, Pets & Projectiles
      this.updatePets(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updateHeroProjectiles(dt);

      // 6. Update Loot Drops
      this.updateLoot(dt);
      if (this.mp) this.mpHostPost(dt);
    }

    // 7. Update Animated Light Props, Rune Wells, Spike Traps & Wall Occlusion Fade
    this.updateEnvironment(dt);
    this.updateWallOcclusion();

    // 8. Update Pooled Particles & Sword Slash Arcs
    this.updateParticles(dt);

    // 9. Smooth Isometric Camera Follow + Screen Shake
    const camDist = 14.5 * this.camZoom;
    _camGoal.set(this.localHero.x + camDist, camDist * 1.16, this.localHero.z + camDist);
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
      THREE.MathUtils.damp(_camTarget.x, this.hero.x, 7, dt) + shakeX,
      0.65 + shakeY,
      THREE.MathUtils.damp(_camTarget.z, this.hero.z, 7, dt)
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
    const hudInterval = this.hero.pommelCooldown > 0 || this.rescueHudActive ? 0.1 : 0.25;
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

  /**
   * Spec §3.4: while the local hero is in town and a teammate is alive in the dungeon, the dungeon keeps running
   * (enemies, bot fights, projectiles, objectives) without being rendered. Its level fields are swapped in for the
   * step and nothing may reach the screen (HUD, particles, floating text, sounds ...). When nobody is left alive
   * there the floor is frozen the same way a single player return freezes it.
   */
  runDungeonBackground(dt: number): void {
    if (!this.dungeonCtx) return;
    if (!this.heroes.some((h) => this.isInDungeonAlive(h))) {
      this.freezeDungeonAway();
      return;
    }
    const local = this.localHero;
    const townCtx = this.captureCtx();
    const arcsBefore = this.slashArcs.length;
    this.applyCtx(this.dungeonCtx);
    this.inTown = false;
    this.bgSim = true;
    this.audio.suppressed = true;
    try {
      if (this.mp) this.mpHostPre();
      for (const h of this.heroes) {
        if (!this.isInDungeonAlive(h)) continue;
        this.setActor(h);
        this.updateHeroFrame(dt, false);
      }
      this.setActor(local);
      this.updateRescue(dt);
      this.updateObjectives(dt);
      this.updatePets(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updateHeroProjectiles(dt);
      if (this.mp) this.updateLoot(dt);
      this.updateEnvironmentBackground();
      if (this.mp) this.mpHostPost(dt);
    } finally {
      this.dungeonCtx = this.captureCtx();
      this.applyCtx(townCtx);
      this.inTown = true;
      this.bgSim = false;
      this.setActor(local);
      for (let i = arcsBefore; i < this.slashArcs.length; i++) this.slashArcs[i].mesh.visible = false;
      for (const bar of this.rescueBars.values()) bar.group.visible = false;
      this.rescueHudActive = false;
    }
    if (this.pendingAwayFloor !== null) {
      const depth = this.pendingAwayFloor;
      this.pendingAwayFloor = null;
      this.pushBanner(`隊伍已前往第 ${depth} 層`, '傳送門已消失 · 從城鎮傳送門回到新樓層入口');
      this.emitHud();
    }
  }

  /** The last teammate in the dungeon went down while the local hero is in town: freeze the floor (spec §3.4). */
  freezeDungeonAway(): void {
    if (!this.dungeonCtx) return;
    const townCtx = this.captureCtx();
    this.applyCtx(this.dungeonCtx);
    this.dungeonCtx = null;
    if (this.mp?.role === 'host') this.mpHostFreezeFlush();
    const sp = gridToWorld(this.dungeon.spawn.gx, this.dungeon.spawn.gz);
    this.savedDungeon = this.snapshotDungeon(sp);
    this.clearLevel();
    this.applyCtx(townCtx);
    this.emitHud();
  }

  /** One frame of one living hero (the actor must already be set to it): timers, input or AI, movement, rig animation.
   * Camera / light / minimap work only happens for the local hero.
   */
  updateHeroFrame(dt: number, isLocal: boolean): void {
    // Cooldowns & Relic Timers
    this.hero.attackCooldown = Math.max(0, this.hero.attackCooldown - dt);
    this.hero.attackAnim = Math.max(0, this.hero.attackAnim - dt);
    this.hero.pommelCooldown = Math.max(0, this.hero.pommelCooldown - dt);
    this.hero.pommelAnim = Math.max(0, this.hero.pommelAnim - dt);
    this.hero.comboResetTimer = Math.max(0, this.hero.comboResetTimer - dt);
    this.hero.dashCooldown = Math.max(0, this.hero.dashCooldown - dt);
    this.hero.invuln = Math.max(0, this.hero.invuln - dt);
    this.hero.hitFlash = Math.max(0, this.hero.hitFlash - dt);
    this.hero.phantomCritTimer = Math.max(0, this.hero.phantomCritTimer - dt);
    this.hero.alchemistShieldTimer = Math.max(0, this.hero.alchemistShieldTimer - dt);
    this.hero.updateShield(dt);

    // 4pc Green Set: Dragonfire Knight periodic fiery breath nova every 3.0s
    if (this.hero.hasSet4pc('dragonfire')) {
      this.hero.dragonAuraTimer -= dt;
      if (this.hero.dragonAuraTimer <= 0) {
        const nearbyEnemies = this.enemies.filter(
          (e) => !e.dead && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) <= 3.6
        );
        if (nearbyEnemies.length > 0) {
          this.hero.dragonAuraTimer = 3.0;
          const novaDmg = Math.max(
            5,
            Math.round((7 + this.depth * 1.1) * (1 + this.hero.atkUpgrades * 0.1 + this.hero.relicStats.atkPct / 100))
          );
          for (const e of nearbyEnemies) {
            this.applyBonusEnemyDamage(e, novaDmg, `龍息 -${novaDmg}`, 'relicOrange', 0xff5a1f);
          }
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            this.spawnParticle(
              this.hero.x + Math.cos(a) * 0.5,
              0.45,
              this.hero.z + Math.sin(a) * 0.5,
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

    if (this.hero.controlMode === 'manual' || this.inTown) {
      if (this.inTown) {
        this.hero.ai.status = '庇護小鎮休整中';
      }
      // Camera looks along (-1, -1) in XZ, so screen-up = (-1,-1) and screen-right = (1,-1)
      let ix = 0;
      let iy = 0;
      if (this.hero.input.keys.has('KeyW') || this.hero.input.keys.has('ArrowUp')) iy += 1;
      if (this.hero.input.keys.has('KeyS') || this.hero.input.keys.has('ArrowDown')) iy -= 1;
      if (this.hero.input.keys.has('KeyD') || this.hero.input.keys.has('ArrowRight')) ix += 1;
      if (this.hero.input.keys.has('KeyA') || this.hero.input.keys.has('ArrowLeft')) ix -= 1;

      if (ix !== 0 || iy !== 0) {
        moveX = ix - iy;
        moveZ = -ix - iy;
        const len = Math.hypot(moveX, moveZ) || 1;
        moveX /= len;
        moveZ /= len;
      }
    } else {
      const aiMove = this.updateAI(this.hero, dt);
      moveX = aiMove.moveX;
      moveZ = aiMove.moveZ;
    }

    this.hero.input.moveX = moveX;
    this.hero.input.moveZ = moveZ;

    // 2. Move Hero (Dash or Walk + Knockback)
    const moveSpeed =
      4.65 *
      HERO_CLASSES[this.hero.classId].moveSpeedMult *
      (1 + this.hero.relicStats.moveSpeedPct / 100);
    let dx = 0;
    let dz = 0;
    if (this.hero.dashTimer > 0) {
      this.hero.dashTimer -= dt;
      dx = this.hero.dashDirX * 13.5 * dt;
      dz = this.hero.dashDirZ * 13.5 * dt;
      if (Math.random() < 0.7) {
        this.spawnParticle(
          this.hero.x,
          0.6,
          this.hero.z,
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
      dx = (moveX * moveSpeed + this.hero.vx) * dt;
      dz = (moveZ * moveSpeed + this.hero.vz) * dt;
    }

    this.hero.vx *= Math.exp(-10 * dt);
    this.hero.vz *= Math.exp(-10 * dt);

    const moved = this.moveWithSlide(this.hero.x, this.hero.z, dx, dz, 0.4);
    this.hero.x = moved.x;
    this.hero.z = moved.z;

    const speedMag = Math.hypot(moveX, moveZ);
    if (speedMag > 0.08 && this.hero.dashTimer <= 0) {
      const desiredAngle = Math.atan2(moveX, moveZ);
      let diff = desiredAngle - this.hero.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.hero.facing += diff * Math.min(1, dt * 14);

      this.hero.walkCycle += dt * 11.5;
      this.hero.footstepTimer -= dt;
      if (this.hero.footstepTimer <= 0) {
        this.hero.footstepTimer = 0.28;
        this.audio.playFootstep();
      }
    } else {
      this.hero.walkCycle *= 0.85;
    }

    // Hold-to-attack: aim at the cursor every frame (overrides walk facing) and fire when ready
    this.updateHeldAttack();

    // 3. Animate Hero Composite Rig
    this.hero.rig.root.position.set(this.hero.x, 0, this.hero.z);
    this.hero.rig.body.rotation.y = this.hero.facing;
    const stride = Math.sin(this.hero.walkCycle) * (speedMag > 0.1 ? 0.55 : 0);
    this.hero.rig.leftLeg.rotation.x = stride;
    this.hero.rig.rightLeg.rotation.x = -stride;
    this.hero.rig.body.position.y = Math.abs(Math.sin(this.hero.walkCycle)) * (speedMag > 0.1 ? 0.08 : 0);
    this.hero.rig.cape.rotation.x = 0.14 + (speedMag > 0.1 ? 0.22 : 0) + Math.sin(this.elapsed * 3.5) * 0.05;
    this.hero.rig.lanternPivot.rotation.z = Math.sin(this.elapsed * 4.2 + this.hero.walkCycle * 0.5) * 0.16;

    // Sword swing / Pommel Strike arm & hilt animation
    if (this.hero.pommelAnim > 0) {
      const p = 1 - this.hero.pommelAnim / 0.34;
      // Reverse sword grip so pommel/hilt juts forward & slams down with a crisp torque twist
      this.hero.rig.swordGroup.rotation.x = -Math.PI * 0.56;
      const slamCurve = Math.sin(p * Math.PI);
      this.hero.rig.rightArm.rotation.x = -1.35 + slamCurve * 1.15;
      this.hero.rig.rightArm.rotation.y = -0.35 + p * 1.35;
      this.hero.rig.body.rotation.y = this.hero.facing + slamCurve * 0.72;
    } else if (this.hero.attackAnim > 0) {
      const p = 1 - this.hero.attackAnim / 0.28;
      this.hero.rig.swordGroup.rotation.x = THREE.MathUtils.damp(
        this.hero.rig.swordGroup.rotation.x,
        Math.PI * 0.42,
        22,
        dt
      );
      this.hero.rig.rightArm.rotation.x = -1.6 + p * 2.4;
      this.hero.rig.rightArm.rotation.y = -0.7 + p * 1.6;
    } else {
      this.hero.rig.swordGroup.rotation.x = THREE.MathUtils.damp(
        this.hero.rig.swordGroup.rotation.x,
        Math.PI * 0.42,
        16,
        dt
      );
      this.hero.rig.rightArm.rotation.x = THREE.MathUtils.damp(this.hero.rig.rightArm.rotation.x, -stride * 0.4, 12, dt);
      this.hero.rig.rightArm.rotation.y = THREE.MathUtils.damp(this.hero.rig.rightArm.rotation.y, 0, 12, dt);
    }

    // Hero Hit Flash
    const heroEmissive =
      this.hero.hitFlash > 0 ? (this.hero.hitShieldOnly ? 0x6fd8ff : 0xff3b3b) : 0x000000;
    for (const m of this.hero.rig.flashMaterials) {
      m.emissive.setHex(heroEmissive);
      m.emissiveIntensity = this.hero.hitFlash > 0 ? 0.75 : 0;
    }

    // Hero Flickering Lantern Light + Warm Floor Glow Pool + Rising Ember Trail + 4pc Set Aura
    const flicker =
      Math.sin(this.elapsed * 14.3) * 2.4 +
      Math.sin(this.elapsed * 29.7) * 1.4 +
      Math.cos(this.elapsed * 8.1) * 1.6;
    const lanternOffX = Math.sin(this.hero.facing - 0.55) * 0.65;
    const lanternOffZ = Math.cos(this.hero.facing - 0.55) * 0.65;
    if (isLocal) {
      // Only the local hero carries a real lantern light (bots stay cheap)
      const lanternBoost = 1 + this.hero.relicStats.lanternGlowPct / 100;
      this.heroLight.intensity = (56.0 + flicker) * lanternBoost;
      this.heroLight.distance = 11.2 * (1 + (this.hero.relicStats.lanternGlowPct / 100) * 0.45);
      // Mage: lift the light well above her head so the pale robe/hair isn't blown out at close range
      const lightRise = this.hero.isMage() ? 1.25 : 1;
      this.heroLight.position.set(
        this.hero.x + lanternOffX * lightRise,
        this.hero.isMage() ? 2.9 : 1.85,
        this.hero.z + lanternOffZ * lightRise
      );
      this.heroFloorGlow.position.set(this.hero.x + lanternOffX * 0.5, 0.022, this.hero.z + lanternOffZ * 0.5);
      (this.heroFloorGlow.material as THREE.MeshBasicMaterial).opacity = 0.36 + flicker * 0.008;
    }

    if (this.hero.setAura && this.hero.setAura.group.visible) {
      this.hero.setAura.outerRing.rotation.z += dt * 1.1;
      this.hero.setAura.innerRing.rotation.z -= dt * 1.9;
      const pulse = 0.96 + Math.sin(this.elapsed * 4.2) * 0.08;
      this.hero.setAura.group.scale.setScalar(pulse);
    }

    this.hero.emberSpawnTimer -= dt;
    if (this.hero.emberSpawnTimer <= 0) {
      this.hero.emberSpawnTimer = 0.085;
      this.spawnParticle(
        this.hero.x + lanternOffX + (Math.random() - 0.5) * 0.18,
        1.25,
        this.hero.z + lanternOffZ + (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.5) * 0.45,
        0.9 + Math.random() * 0.9,
        (Math.random() - 0.5) * 0.45,
        this.hero.isMage()
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

    if (isLocal) {
      // Keep global rim shadow camera centered on the local hero
      this.rimLight.position.set(this.hero.x - 10, 22, this.hero.z - 8);
      this.rimLight.target.position.set(this.hero.x, 0, this.hero.z);

      // Explore fog-of-war on minimap
      const heroG = worldToGrid(this.hero.x, this.hero.z);
      this.markExplored(heroG.gx, heroG.gz);
    }
  }

  updateObjectives(dt: number): void {
    // Key Pickup
    if (this.keyPedestal && !this.hasKey) {
      this.keyPedestal.keyMesh.rotation.y += dt * 2.1;
      this.keyPedestal.keyMesh.position.y = 1.05 + Math.sin(this.elapsed * 3.4) * 0.14;

      const kw = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      // The key (and the gate / hasKey flag) belong to the whole team: any living hero can claim it
      for (const h of this.heroes) {
        if (h.isDead || h.inTown || Math.hypot(h.x - kw.x, h.z - kw.z) >= 1.45) continue;
        this.setActor(h);
        this.hasKey = true;
        this.keyPedestal.keyMesh.visible = false;
        this.keyPedestal.halo.visible = false;
        this.audio.playKeyFound();
        this.pushBanner('RELIC KEY CLAIMED', 'Seek the Sealed Gate', true);
        this.emitFloatingText(kw.x, 1.8, kw.z, 'RELIC KEY!', 'key', true);
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
        this.hero.ai.path = [];
        this.setActor(this.localHero);
        this.emitHud();
        break;
      }
    }

    // Locked Gate Unlocking & Swinging Open
    if (this.gateRig) {
      const dw = gridToWorld(this.dungeon.doorPos.gx, this.dungeon.doorPos.gz);
      const opener = this.hasKey && !this.doorUnlocked
        ? this.heroes.find((h) => !h.isDead && !h.inTown && Math.hypot(h.x - dw.x, h.z - dw.z) < 2.85)
        : undefined;
      if (this.hasKey && !this.doorUnlocked) {
        if (opener) {
          this.setActor(opener);
          this.doorUnlocked = true;
          this.gateRig.lockGlow.visible = false;
          this.audio.playDoorUnlock();
          this.addScreenShake(0.18, 0.22);
          this.pushBanner('SEAL GATE UNLOCKED', 'The Stairwell Awaits', true);
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
          this.hero.ai.path = [];
          this.setActor(this.localHero);
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
      // Taking the stairs moves the whole team (any living hero can trigger it)
      if (this.heroes.some((h) => !h.isDead && !h.inTown && Math.hypot(h.x - sw.x, h.z - sw.z) < 1.25)) {
        const descend = () => {
          for (const h of this.heroes) {
            if (h.inTown) continue;
            h.hp = Math.min(h.getEffectiveMaxHp(), h.hp + 20);
          }
          this.buildLevel(this.depth + 1, { tickBuffFloor: true });
        };
        if (this.bgSim) {
          // A teammate took the stairs while the local hero is in town: no fade, the town just gets a notice
          descend();
        } else {
          this.audio.playDescend();
          this.beginTransition(descend);
        }
      }
    }
  }

  updateBoss(e: EnemyEntity, dt: number, dx: number, dz: number, dist: number): void {
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
          this.hero.x,
          this.hero.z,
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
            tx = this.hero.x;
            tz = this.hero.z;
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

          this.forEachLiveHero(() => {
            const heroDistToImpact = Math.hypot(this.hero.x - e.x, this.hero.z - e.z);
            if (heroDistToImpact <= rad) {
              this.damageHero(
                cfg.damage * 0.95 * this.getDepthDamageScale(),
                e.x,
                e.z,
                this.getEnemyLabel(e)
              );
            } else if (heroDistToImpact <= rad + 3.2) {
              this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
            }
          });
          this.damagePetsInRadius(e.x, e.z, rad, cfg.damage * 0.95 * this.getDepthDamageScale());
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

          this.forEachLiveHero(() => {
            const heroDistToImpact = Math.hypot(this.hero.x - tx, this.hero.z - tz);
            if (heroDistToImpact <= rad * 0.92) {
              this.damageHero(
                cfg.damage * 0.9 * this.getDepthDamageScale(),
                tx,
                tz,
                this.getEnemyLabel(e)
              );
            } else if (heroDistToImpact <= rad + 3.0) {
              this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
            }
          });
          this.damagePetsInRadius(tx, tz, rad * 0.92, cfg.damage * 0.9 * this.getDepthDamageScale());

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

          this.forEachLiveHero(() => {
            const heroDistToImpact = Math.hypot(this.hero.x - tx, this.hero.z - tz);
            if (heroDistToImpact <= rad) {
              this.damageHero(
                cfg.damage * this.getDepthDamageScale(),
                tx,
                tz,
                this.getEnemyLabel(e)
              );
            } else if (heroDistToImpact <= rad + 3.4) {
              this.emitFloatingText(this.hero.x, 1.95, this.hero.z, 'DODGED!', 'info');
            }
          });
          this.damagePetsInRadius(tx, tz, rad, cfg.damage * this.getDepthDamageScale());
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

  spawnProjectile(
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

  removeProjectileAt(idx: number): void {
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

  updateProjectiles(dt: number): void {
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

      // Pet collision (pets can body-block enemy projectiles)
      let hitPet: PetEntity | null = null;
      for (const pet of this.pets.values()) {
        if (pet.hp <= 0) continue;
        const owner = this.heroById(pet.ownerId);
        if (!owner || owner.isDead || owner.inTown) continue;
        if (Math.hypot(p.x - pet.x, p.z - pet.z) < 0.62) {
          hitPet = pet;
          break;
        }
      }
      if (hitPet) {
        this.damagePet(hitPet, p.damage, p.x - p.vx * 0.05, p.z - p.vz * 0.05);
        for (let k = 0; k < 6; k++) {
          this.spawnParticle(
            p.x,
            0.85,
            p.z,
            (Math.random() - 0.5) * 3.8,
            1.2 + Math.random() * 1.4,
            (Math.random() - 0.5) * 3.8,
            trailCol,
            0.72,
            0.28,
            4
          );
        }
        this.removeProjectileAt(i);
        continue;
      }

      // Hero collision (any standing hero; heroes can dash through projectiles!)
      const struck = this.heroes.find(
        (h) => !h.isDead && !h.inTown && h.dashTimer <= 0 && Math.hypot(p.x - h.x, p.z - h.z) < 0.58
      );
      if (struck) {
        this.setActor(struck);
        this.damageHero(p.damage, p.x - p.vx * 0.05, p.z - p.vz * 0.05, p.sourceLabel);
        this.setActor(this.localHero);
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

  updateRangedEnemy(e: EnemyEntity, dt: number, dx: number, dz: number, dist: number): void {
    const isArcher = isArcherLikeRanged(e.kind);
    const fireRange = isArcher ? 9.2 : 8.6;
    const minKeepDist = isArcher ? 3.5 : 3.2;
    const aggroRange = 11.5;

    let moveX = 0;
    let moveZ = 0;

    const clearLOS =
      dist < aggroRange &&
      hasLineOfSight(this.dungeon, e.x, e.z, this.hero.x, this.hero.z, this.doorUnlocked, 0.24);

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
          const eliteAtkSpeed = e.isElite ? 1.25 : 1;
          if (isArcher) {
            this.audio.playBowShot();
            e.attackCooldown = (1.55 + Math.random() * 0.25) / eliteAtkSpeed;
          } else {
            this.audio.playMageCast();
            e.attackCooldown = (1.85 + Math.random() * 0.25) / eliteAtkSpeed;
          }
        }
      } else if (clearLOS && dist <= fireRange && e.attackCooldown <= 0) {
        // Begin short readable draw/cast windup before firing
        const eliteAtkSpeed = e.isElite ? 1.25 : 1;
        e.windupTimer = (isArcher ? 0.32 : 0.42) / eliteAtkSpeed;
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

  updateEnemies(dt: number): void {
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

      // Lock onto the nearest hero (or Hunter pet for non-boss enemies)
      const prey = this.nearestLiveHero(e.x, e.z);
      if (!prey) continue;
      this.setActor(prey);
      let dx = this.hero.x - e.x;
      let dz = this.hero.z - e.z;
      let dist = Math.hypot(dx, dz);

      if (e.isBoss) {
        this.updateBoss(e, edt, dx, dz, dist);
        continue;
      }

      let targetPet: PetEntity | null = null;
      for (const pet of this.pets.values()) {
        if (pet.hp <= 0) continue;
        const owner = this.heroById(pet.ownerId);
        if (!owner || owner.isDead || owner.inTown) continue;
        const pd = Math.hypot(pet.x - e.x, pet.z - e.z);
        if (pd < dist) {
          dist = pd;
          dx = pet.x - e.x;
          dz = pet.z - e.z;
          targetPet = pet;
        }
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
      const attackReach = isGuard ? 1.45 : e.isElite ? 1.4 : isSwarm ? 1.05 : 1.12;
      if (dist < attackReach && e.attackCooldown <= 0) {
        const eliteAtkSpeed = e.isElite ? 1.25 : 1;
        e.attackCooldown = (isSwarm ? 0.5 : isGuard ? 1.15 : 1.05) / eliteAtkSpeed; // Swarm bites 2 times per second!
        const baseMelee = isGuard ? 9 : isSwarm ? 1.25 + Math.random() * 0.65 : 5;
        // Swarm critters scale gentler with depth (+6%/floor instead of +12%)
        const depthScale = isSwarm ? this.getSwarmDepthDamageScale() : this.getDepthDamageScale();
        const dmg = baseMelee * depthScale * e.damageMult;
        if (targetPet) {
          this.damagePet(targetPet, dmg, e.x, e.z);
        } else {
          this.damageHero(dmg, e.x, e.z, this.getEnemyLabel(e), e);
        }
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
    this.setActor(this.localHero);
  }

  tryAutoEquipBetterRelic(item: RelicItem): boolean {
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
  }

  updateLoot(dt: number): void {
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
  }

  /** Animates the swirling cyan portals (the town gate, or the portals the heroes left behind in the dungeon). */
  animateHeroPortal(dt: number): void {
    if (this.townPortalRig) this.animatePortalRig(this.townPortalRig, dt);
    for (const rig of this.heroPortalRigs.values()) this.animatePortalRig(rig, dt);
  }

  animatePortalRig(rig: TownPortalRig, dt: number): void {
    rig.vortex.rotation.z += dt * 1.9;
    rig.outerRing.rotation.z -= dt * 1.2;
    rig.innerRing.rotation.z += dt * 2.5;
    const pulse = 1 + Math.sin(this.elapsed * 3.6) * 0.05;
    rig.halo.scale.set(2.3 * pulse, 2.6 * pulse, 1);
    const px = rig.root.position.x;
    const pz = rig.root.position.z;
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

  /** The first living hero that is hurt and stands in an unused rune well drinks from it. */
  tryRuneDrink(lp: AnimatedLightProp): void {
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
  }

  tick = (): void => {
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

  // ---------------------------------------------------------------------------------------------------------
  // P5-B multiplayer: host-authoritative dungeon sync (docs/multiplayer-spec.md section 5.2)
  // The host's engine simulates everything; a teammate's engine runs in "guest" mode: it builds the same floor
  // (seed) without monsters, draws what the host's snapshots say, and only predicts its own hero's movement.
  // None of this runs unless `mp` is set (single player and the attract mode never touch it).
  // ---------------------------------------------------------------------------------------------------------

  static readonly MP_PRIVATE_TONES = new Set(['gold', 'heal', 'key', 'info', 'relicBlue', 'relicYellow', 'relicOrange', 'relicGreen']);
  static readonly MP_PRIVATE_SOUNDS = new Set([
    'playCoin',
    'playPotion',
    'playRelicEquip',
    'playRelicSell',
    'playRelicDrop',
    'playUpgrade',
    'playPlayerHurt',
    'playShieldBreak',
  ]);
  /** Sounds a teammate's own client already played when it predicted the action. */
  static readonly MP_PREDICTED_SOUNDS = new Set([
    'playSwordSlash',
    'playDash',
    'playPommelStrike',
    'playIceCast',
    'playFrostNova',
    'playBlink',
    'playMageCast',
    'playBowShot',
  ]);
  static readonly MP_BOSS_STATES: BossAttackState[] = ['chase', 'windup', 'strike', 'recover'];
  static readonly MP_RARITIES: Array<'blue' | 'yellow' | 'orange' | 'green'> = ['blue', 'yellow', 'orange', 'green'];

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('blur', this.handleWindowBlur);

    if (this.renderer) {
      this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
      this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
      this.renderer.domElement.removeEventListener('contextmenu', this.handleContextMenu);
      this.renderer.domElement.removeEventListener('wheel', this.handleWheel);
      this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    }

    this.leaveTownScene();
    this.clearLevel();
    for (const h of this.heroes) if (h.isBot) this.disposeBot(h);
    for (const bar of this.rescueBars.values()) {
      this.scene.remove(bar.group);
      bar.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    }
    this.rescueBars.clear();
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

// ---- method modules (src/game/engine/*): the bodies live there, mounted on the prototype ----
type HudMethods = typeof hudMethods;
type CoreMpMethods = typeof coreMpMethods;
type HostMpMethods = typeof hostMpMethods;
type GuestMpMethods = typeof guestMpMethods;
type TownMpMethods = typeof townMpMethods;
type PartyMethods = typeof partyMethods;
type SceneMethods = typeof sceneMethods;
type LevelBuildMethods = typeof levelBuildMethods;
export interface EmbervaultEngine extends HudMethods, CoreMpMethods, HostMpMethods, GuestMpMethods, TownMpMethods, PartyMethods, SceneMethods, LevelBuildMethods {}
Object.assign(EmbervaultEngine.prototype, hudMethods, coreMpMethods, hostMpMethods, guestMpMethods, townMpMethods, partyMethods, sceneMethods, levelBuildMethods);
