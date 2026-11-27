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
  AngelRig,
  GateRig,
  StashChestRig,
  TownPortalRig,
} from './models';
import { DungeonTextureSet } from './textures';
import {
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
} from './types';




















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
import { frameMethods } from './engine/frame';
import { enemiesMethods } from './engine/enemies';

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
/**
 * Engine state + constructor + main loop + public API. The fields are deliberately not `private`: the method
 * modules in src/game/engine/*.ts (mounted below with `Object.assign(EmbervaultEngine.prototype, ...)`) operate on
 * `this`. New methods go into the module that matches their domain (see AGENTS.md).
 */
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
  // Static helpers and constants (the per-hero / level / multiplayer methods live in src/game/engine/*.ts)
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
type FrameMethods = typeof frameMethods;
type EnemiesMethods = typeof enemiesMethods;
export interface EmbervaultEngine
  extends HudMethods,
    CoreMpMethods,
    HostMpMethods,
    GuestMpMethods,
    TownMpMethods,
    PartyMethods,
    SceneMethods,
    LevelBuildMethods,
    TownMethods,
    SpawnMethods,
    InputMethods,
    TravelMethods,
    EconomyMethods,
    HeroCombatMethods,
    ClassSkillsMethods,
    LootMethods,
    MovementMethods,
    AiMethods,
    FrameMethods,
    EnemiesMethods {}
Object.assign(
  EmbervaultEngine.prototype,
  hudMethods,
  coreMpMethods,
  hostMpMethods,
  guestMpMethods,
  townMpMethods,
  partyMethods,
  sceneMethods,
  levelBuildMethods,
  townMethods,
  spawnMethods,
  inputMethods,
  travelMethods,
  economyMethods,
  heroCombatMethods,
  classSkillsMethods,
  lootMethods,
  movementMethods,
  aiMethods,
  frameMethods,
  enemiesMethods,
);
