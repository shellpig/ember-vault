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
  RETURN_WAIT_MS,
} from '../../shared/game';
import {
  TILE_SIZE,
  gridToWorld,
  hasLineOfSight,
  worldToGrid,
} from './dungeon';
import {
  AngelRig,
  GateRig,
  StashChestRig,
  TownPortalRig,
  createProjectileMesh,
} from './models';
import { DungeonTextureSet } from './textures';
import {
  HERO_CLASSES,
  HeroClassId,
  MAX_BOTS,
} from './classes';
import {
  BannerEvent,
  BossAttackState,
  DungeonData,
  FloatingLabelData,
  HudState,
  MinimapSnapshot,
  ProjectileKind,
} from './types';


















import {
  BOSS_CONFIGS,
  BossSkillKind,
  getRangedProjectileKind,
  isArcherLikeRanged,
  isFloorBoss,
  isGuardianEnemy,
  isSwarmEnemy,
} from './engine/data';
import {
  AnimatedLightProp,
  BreakableEntity,
  EnemyEntity,
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
} from './engine/scratch';
import { hudMethods } from './engine/hud';
import { coreMpMethods } from './engine/mp/core';
import { hostMpMethods } from './engine/mp/host';
import { guestMpMethods } from './engine/mp/guest';
import { townMpMethods } from './engine/mp/town';
import { partyMethods } from './engine/party';
import { sceneMethods } from './engine/scene';
import { levelBuildMethods } from './engine/levelBuild';
import { townMethods } from './engine/town';
import { spawnMethods } from './engine/spawn';
import { inputMethods } from './engine/input';
import { travelMethods } from './engine/travel';
import { economyMethods } from './engine/economy';
import { heroCombatMethods } from './engine/heroCombat';
import { classSkillsMethods } from './engine/classSkills';
import { lootMethods } from './engine/loot';
import { movementMethods } from './engine/movement';
import { aiMethods } from './engine/ai';

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

  /** When true (menus / account screens), keyboard and pointer input no longer takes over the hero. */
  inputLocked = false;
  /** P6: a trade is being set up or running; gold / bag / stash actions are refused (see setTradeLock). */
  tradeLocked = false;

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

  /** Returns the owner of a nearby active dungeon portal on the current floor, or null. */
  findNearbyDungeonPortal(hero: Hero = this.hero): Hero | null {
    if (this.inTown) return null;
    for (const h of this.heroes) {
      if (!h.portal || h.portal.depth !== this.depth) continue;
      if (Math.hypot(hero.x - h.portal.x, hero.z - h.portal.z) < 2.25) return h;
    }
    return null;
  }

  // =========================================================================
  // FROST MAGE — combat core
  // =========================================================================

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
type TownMethods = typeof townMethods;
type SpawnMethods = typeof spawnMethods;
type InputMethods = typeof inputMethods;
type TravelMethods = typeof travelMethods;
type EconomyMethods = typeof economyMethods;
type HeroCombatMethods = typeof heroCombatMethods;
type ClassSkillsMethods = typeof classSkillsMethods;
type LootMethods = typeof lootMethods;
type MovementMethods = typeof movementMethods;
type AiMethods = typeof aiMethods;
export interface EmbervaultEngine extends HudMethods, CoreMpMethods, HostMpMethods, GuestMpMethods, TownMpMethods, PartyMethods, SceneMethods, LevelBuildMethods, TownMethods, SpawnMethods, InputMethods, TravelMethods, EconomyMethods, HeroCombatMethods, ClassSkillsMethods, LootMethods, MovementMethods, AiMethods {}
Object.assign(EmbervaultEngine.prototype, hudMethods, coreMpMethods, hostMpMethods, guestMpMethods, townMpMethods, partyMethods, sceneMethods, levelBuildMethods, townMethods, spawnMethods, inputMethods, travelMethods, economyMethods, heroCombatMethods, classSkillsMethods, lootMethods, movementMethods, aiMethods);
