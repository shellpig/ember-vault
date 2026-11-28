import type { CommandPayload, GameEvent, GameKind, HandbackPayload, LoadoutPayload } from '../../../shared/game';
import type { RoomMember } from '../../../shared/room';
import { HeroClassId, PetSpecies } from '../classes';
import type { BossBeamSpec } from './bossVfx';
import { BossActionType, BossSkillKind, EnemyAuraType } from './data';
import type { CharacterLoadout } from '../hero';
import { AuraHolderFx, BossTelegraphRig, EnemyRig, GateRig, PetRig, RelicLootRig, SpikeTrapRig, TownPortalRig, TreasureChestRig } from '../models';
import { RelicItem } from '../relics';
import { DungeonTextureSet } from '../textures';
import { BossAttackState, DungeonData, EnemyKind, ProjectileKind } from '../types';
import * as THREE from 'three';

/** One teammate's town position stream (P5-C). Positions are stamped with the local receive time. */
export interface MpTownPeer {
  buf: MpSample[];
  /** A position is known and the teammate is still in town (cleared when the host says they left). */
  has: boolean;
  speed: number;
  lastAt?: number;
  lastMoving?: boolean;
  /** P7: smoothed deviation (ms) of the arrival gaps of its moving 5 Hz stream from 200 ms; drives the adaptive delay. */
  jitter?: number;
}

export interface MpSample {
  t: number;
  x: number;
  z: number;
  f: number;
}

export interface MpEnemyPuppet {
  e: EnemyEntity;
  buf: MpSample[];
  placed: boolean;
}

export interface MpGuestState {
  enemies: Map<number, MpEnemyPuppet>;
  /** The puppets as a plain list (HUD boss bar / minimap read it instead of `enemies`). */
  enemyList: EnemyEntity[];
  projs: Map<number, ProjectileEntity>;
  hprojs: Map<number, HeroProjectileEntity>;
  loots: Map<number, LootEntity>;
  heroBufs: Map<string, { buf: MpSample[]; speed: number }>;
  /** My own recent positions (local clock) for reconciling against the host's echo. */
  history: Array<{ t: number; x: number; z: number }>;
  lastSent: { k: number; f: number; h: number; at: number };
  actions: number[];
  lastHasKey: boolean;
  lastUnlocked: boolean;
  usedRunes: Set<number>;
  brokenProps: Set<number>;
  /** Crates / urns this client already shattered locally (visual only), mapped to the time the host has to confirm. */
  pendingBreaks: Map<BreakableEntity, number>;
  /** Party states the host reported (heroId -> 0 dungeon / 1 town / 2 downed); authoritative while I am in town. */
  partyState: Map<string, 0 | 1 | 2>;
  doorSig: string;
  lastSnapAt: number;
  depth: number;
  /** A floor is built and snapshots may be applied. */
  built: boolean;
  spikeOffset?: number;
  /** P7 adaptive interpolation: RFC 3550 style jitter (ms) of the snapshot transit time, and the delay derived from it. */
  jitter: number;
  interpDelay: number;
  lastTransit: number;
}

export interface MpHostState {
  pending: Map<string, LoadoutPayload>;
  waitStart: number;
  launched: boolean;
  inputs: Map<string, { t: number; k: number; f: number; h: number; at: number }>;
  actions: Map<string, number[]>;
  cmds: Array<{ from: string; cmd: CommandPayload }>;
  handbacks: Array<{ from: string; hb: HandbackPayload }>;
  /** P7: loadouts of members that joined after the start, waiting to be given a hero. */
  joiners: Array<{ from: string; p: LoadoutPayload }>;
  sendAcc: number;
  sentEnemies: Map<number, string>;
  sentProj: Map<ProjectileEntity, number>;
  sentHproj: Map<HeroProjectileEntity, number>;
  sentLoot: Set<number>;
  events: GameEvent[];
  eventKeys: Set<string>;
  nextPid: number;
  pids: WeakMap<object, number>;
  privSig: Map<string, string>;
  privAt: Map<string, number>;
  doorSig: string;
  worldSig: string;
  /** P7: the host's link came back; send everybody a fresh `level` + party state from inside the (running) dungeon. */
  resync?: boolean;
  tapped: boolean;
  /** Last party state message (sent only when it changes). */
  stSig: string;
  /** The "nobody is alive in the dungeon" freeze has been announced (final snapshot + private states sent). */
  frozenFlushed: boolean;
  lastHeroSig: string;
  lastSentAt: number;
  lastDepthSent: number;
}

export interface MpState {
  role: 'host' | 'guest';
  selfId: string;
  hostId: string;
  members: RoomMember[];
  send: (kind: GameKind, payload: unknown, to?: string) => void;
  onNotice: (msg: string) => void;
  /** Holding at black: waiting for the host's reply (level / town) or for the loadouts. */
  hold: boolean;
  /** What the held screen says (P5-C: never a bare black screen) and what it waits for. */
  holdText: string;
  holdKind: 'start' | 'level' | 'town' | null;
  holdSince: number;
  /** P7: this client joined a running game. */
  late: boolean;
  /** Host: the floor chosen in the room lobby (already clamped to [1, loadout.maxDepth]). */
  startDepth: number;
  /** Town positions of the others + what I sent last (P5-C). */
  town: { peers: Map<string, MpTownPeer>; acc: number; last: { x: number; z: number; f: number; a: 0 | 1 | 2 } | null };
  sendTownPos: (p: { x: number; z: number; f: number; a: 0 | 1 | 2 }) => void;
  inbox: Array<{ kind: GameKind; payload: unknown }>;
  /** min(local receive time - host timestamp): maps the host clock to ours. */
  clockOff: number;
  classId: HeroClassId;
  loadout: CharacterLoadout;
  host?: MpHostState;
  guest: MpGuestState;
}

export interface EnemyEntity {
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
  /** Chance (0-1) that a basic attack crits for ENEMY_CRIT_MULT x damage (base ENEMY_BASE_CRIT, set at spawn). */
  critChance: number;
  /** Named-elite aura this enemy carries (host / single player: gameplay + visuals; teammate: visuals only). */
  aura?: EnemyAuraType;
  /** Ground ring under an aura holder (child of rig.root, disposed with the level). */
  auraHolderFx?: AuraHolderFx;
  /** Cached effect of the auras currently covering this enemy (host / single player, refreshed every ENEMY_AURA_INTERVAL). */
  fxAtkSpd?: boolean;
  fxAtk?: boolean;
  fxDr?: boolean;
  fxMove?: boolean;
  fxCrit?: boolean;
  /** Ember Lantern: seconds left of the -20% attack speed debuff (attack cooldowns tick at 80%). */
  atkSlowTimer?: number;
  /** Visual (all clients): bit per ENEMY_AURA_TYPES index of the auras currently covering this enemy. */
  auraMask?: number;
  /** Thin ground rings per covering aura type, fading in/out (see updateAuraRings). */
  auraPool?: { mesh: THREE.Mesh; alpha: number };
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
  /** Shared single-hit target set across the dash corridor + landing circle of one `charge_slam`. */
  bossChargeHitIds?: Set<string>;
  /** Once woken (within wake range, damaged, or in Boss Test Arena), the boss pursues indefinitely. */
  bossAggroed?: boolean;
  /** Cached A* path used by an aggroed boss when pursuing around corners/doorways. */
  bossPath?: Array<{ gx: number; gz: number }>;
  bossPathTimer?: number;
  /** What the current windup / strike / recover belongs to: a skill (ground telegraph) or a basic attack (no telegraph). */
  bossAction?: BossActionType;
  /** The type decided for the next action (section 5); rolled once when the previous action finishes. */
  bossNextType?: BossActionType;
  /** Type of the last executed action and how many of that type happened in a row. */
  bossLastType?: BossActionType;
  bossStreak?: number;
  /** Seconds a melee boss has chased while waiting to land a basic attack; past timeout it switches to a skill. */
  bossBasicChaseTimer?: number;
  /** Enraged (HP first dropped under 50%): faster and hits harder until it dies. */
  bossEnraged?: boolean;
  /** Locked base angle of nova_ring laser beams (set at windup start so charge lines match burst). */
  bossNovaAngle?: number;
  /** Active nova_ring laser hit window (single hit per hero/pet across centre circle + all beams). */
  bossNovaActiveBeams?: {
    ox: number;
    oz: number;
    rad: number;
    beams: BossBeamSpec[];
    timer: number;
    dmg: number;
    hitIds: Set<string>;
    dodgedChecked?: boolean;
  };
  /** Guest only: previous bossState / bossSkill so transitions trigger VFX once. */
  prevBossState?: BossAttackState;
  prevBossSkill?: BossSkillKind;
  /** warp_ambush runtime state (host & guest visual sync). */
  bossWarpPhase?: 'ascend' | 'descend';
  /** True while boss is mid-warp (ascend/descend): untargetable, no collision, shadow hidden. */
  bossWarpUntargetable?: boolean;
  /** Chosen distant hero id for warp_ambush landing. */
  bossWarpTargetId?: string;
  /** True when current slam/charge_slam was seamlessly chained from warp_ambush (don't double-advance skill index). */
  bossWarpChained?: boolean;
  /** True when boss materials/shadow have been modified by warp fade and need restoration. */
  bossWarpVisualDirty?: boolean;
  /** Guest-side local animation clocks & takeoff anchor for warp_ambush. */
  bossWarpGuestTimer?: number;
  bossWarpGuestDescTimer?: number;
  bossWarpGuestArrived?: boolean;
  bossWarpOriginX?: number;
  bossWarpOriginZ?: number;
  /** Queued follow-up strikes of `orbital_barrage` (shots 2 & 3 track live heroes independently). */
  bossOrbitalQueue?: Array<{
    x: number;
    z: number;
    delay: number;
    windup: number;
    spawnedTelegraph: boolean;
    dmg: number;
    rad: number;
  }>;
  // Frost Mage debuffs
  /** Seconds of slow remaining. */
  slowTimer?: number;
  /** Fraction of move/attack speed removed while slowed (0.4 normal, 0.2 elite, 0.1 boss). */
  slowPct?: number;
  /** Seconds of Frost Nova freeze remaining (acts like a stun). */
  frozenTimer?: number;
}

export interface HeroProjectileEntity {
  mesh: THREE.Group;
  x: number;
  z: number;
  vx: number;
  vz: number;
  traveled: number;
  /** Frost Mage: 0, 1 = normal spike, 2 = empowered spike. Hunter arrow: -1. */
  shotIdx: number;
  /** Phantom Boots guaranteed crit captured when the projectile was fired. */
  phantomCrit: boolean;
  /** The hero that fired it (its stats and kill credit apply when it hits). */
  ownerId: string;
  /** Teammate view only: a projectile of another hero, mirrored from the host's snapshots (never simulated here). */
  pid?: number;
  /** Moon Bow: piercing moonlight arrow (+60% damage) and the enemy ids it already hit. */
  moon?: boolean;
  pierced?: Set<number>;
}

export interface PetEntity {
  ownerId: string;
  species: PetSpecies;
  name: string;
  rig: PetRig;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  hp: number;
  maxHp: number;
  buffTimer: number;
  attackCooldown: number;
  timeSinceDamaged: number;
  hitFlash: number;
  invuln: number;
  walkPhase: number;
  /** Remaining seconds of the pet's lunge / paw-slam / peck attack animation. */
  attackAnim?: number;
  /** Seconds the owner has been out of the pet's line of sight (warps beside the owner past PET_NO_LOS_WARP_SEC). */
  noLosTimer?: number;
  targetX?: number;
  targetZ?: number;
  targetFacing?: number;
}

export interface HeroHitParams {
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

export interface ProjectileEntity {
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
  /** True for boss `ranged_volley` railgun heavy shells (enhanced rings, trail & impact burst). */
  isBossHeavy?: boolean;
  /** Enemy crit rolled when the shot was fired (damage already includes ENEMY_CRIT_MULT). */
  crit?: boolean;
  /** Teammate view only: id of the host's projectile this one mirrors (moved by the snapshot stream). */
  pid?: number;
}

export interface LootEntity {
  id: number;
  /** Whose drop this is (spec §5.2): only the owner sees and can pick it up. */
  ownerId: string;
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
  /** Teammate view only: the rarity of a relic whose details the host never sent (minimap / mesh colour). */
  rarity?: 'blue' | 'yellow' | 'orange' | 'green';
}

export interface BreakableEntity {
  id: number;
  kind: 'crate' | 'urn';
  mesh: THREE.Group;
  x: number;
  z: number;
  broken: boolean;
}

export interface Particle {
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

export interface SlashArc {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  isCleave: boolean;
  isShockwave?: boolean;
  targetScale?: number;
}

export interface AnimatedLightProp {
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
    | 'stash'
    | 'merchant'
    | 'chest'
    | 'lamp';
  used?: boolean;
  /** For `kind: 'portal'` lights of a hero's dungeon portal: whose portal it is. */
  heroId?: string;
}

/** A treasure chest model in the scene (index-aligned with `dungeon.treasure.chests`; the opened flag lives there). */
export interface TreasureChestEntity {
  rig: TreasureChestRig;
  light: AnimatedLightProp;
  x: number;
  z: number;
}

export interface SavedDungeonSnapshot {
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
  /** Drops still lying on the floor when it froze; put back on rebuild (memory only, never saved to D1). */
  loots: SavedLoot[];
}

export interface SavedLoot {
  ownerId: string;
  type: 'gold' | 'potion' | 'relic';
  value: number;
  relic?: RelicItem;
  x: number;
  z: number;
}

/**
 * Everything that belongs to "the level the engine is currently looking at" (P4-C). The engine code works on one
 * set of fields (`this.dungeon`, `this.enemies` ...). The dungeon and the town each own such a set: while the local
 * hero is in town the dungeon's set is parked in `dungeonCtx` and swapped in only for the background simulation.
 */
export type StationRig = {
  root: THREE.Group;
  crystal: THREE.Group;
  ring: THREE.Mesh;
  halo: THREE.Sprite;
};

export interface LevelCtx {
  dungeon: DungeonData;
  enemies: EnemyEntity[];
  projectiles: ProjectileEntity[];
  heroProjectiles: HeroProjectileEntity[];
  loots: LootEntity[];
  breakables: BreakableEntity[];
  lightProps: AnimatedLightProp[];
  spikes: SpikeInstance[];
  keyPedestal: { root: THREE.Group; keyMesh: THREE.Group; halo: THREE.Sprite } | null;
  altarRig: StationRig | null;
  shopRig: StationRig | null;
  gateRig: GateRig | null;
  gateOpenProgress: number;
  wallOpaqueMeshes: THREE.InstancedMesh[];
  wallFadeMeshes: THREE.InstancedMesh[];
  capOpaqueMeshes: THREE.InstancedMesh[];
  capFadeMeshes: THREE.InstancedMesh[];
  wallTiles: WallOcclusionTile[];
  wallOcclusionActive: boolean;
  textures: DungeonTextureSet | null;
  extraTextures: THREE.Texture[];
  hasKey: boolean;
  doorUnlocked: boolean;
  heroPortalRigs: Map<string, TownPortalRig>;
  treasureRigs: TreasureChestEntity[];
}

export interface WallOcclusionTile {
  gx: number;
  gz: number;
  wx: number;
  wz: number;
  bucketIdx: number;
  wallInstIdx: number;
  capBucketIdx: number;
  capInstIdx: number;
  rotY: number;
  capRotY: number;
  occluded: boolean;
}

export interface SpikeInstance {
  rig: SpikeTrapRig;
  x: number;
  z: number;
  phaseOffset: number;
  extended: boolean;
}
