// P5-B game protocol: the payloads carried inside `relay` messages (see shared/room.ts) between the host's engine
// (authoritative dungeon simulation) and the teammates' engines (render-only "remote mode" + movement prediction).
// Everything here is plain JSON. Numbers are quantised (x100 integers) to keep messages small.
// Spec: docs/multiplayer-spec.md section 5.2.

import type { CharacterLoadout } from '../src/game/hero';
import type { AngelBuff, RelicItem } from '../src/game/relics';

// --- Rates (spec 5.2.1: inbound DO messages are what costs requests, so everything is "send on change") ---------
/** Host -> everybody snapshot rate. */
export const SNAPSHOT_HZ = 15;
/** Highest rate of a teammate's input messages (only sent when the input changed). */
export const INPUT_MAX_HZ = 20;
/** A teammate whose input did not change still sends one message this often (loss guard + movement echo). */
export const INPUT_KEEPALIVE_MS = 1000;
/** Remote entities are drawn this far in the past so there are always two snapshots to blend between (P7: lower bound, grows with jitter). */
export const INTERP_DELAY_MS = 110;
/** P7: adaptive interpolation delay = base + INTERP_JITTER_K * measured arrival jitter, clamped to [base, max]. */
export const INTERP_DELAY_MAX_MS = 220;
export const INTERP_JITTER_K = 2.5;
export const TOWN_INTERP_DELAY_MAX_MS = 420;
/** Host stops moving a teammate whose input stream went silent for this long. */
export const INPUT_STALE_MS = 3000;
/** Host waits this long for the teammates' loadouts after the start. */
export const LOADOUT_WAIT_MS = 10_000;
/** P5-C: a teammate in town broadcasts its town position at this rate, only while it is moving (spec 5.2.1). */
export const TOWN_POS_HZ = 5;
/** Town puppets are drawn this far in the past (the 5 Hz stream has 200 ms gaps; two samples must bracket the time). */
export const TOWN_INTERP_DELAY_MS = 260;
/** A teammate returning to the dungeon waits this long for the host's answer before giving up and staying in town. */
export const RETURN_WAIT_MS = 10_000;
/** Cap on events per snapshot (damage numbers / sounds / banners are merged into the snapshot, never sent alone). */
export const MAX_EVENTS_PER_SNAPSHOT = 28;

/** `relay.kind` values. */
export type GameKind =
  | 'loadout' // member -> host: character to bring into the dungeon
  | 'abort' // host -> member: the host could not start with you (loadout missing)
  | 'level' // host -> member(s): build this floor + the complete world state
  | 's' // host -> all: snapshot (delta)
  | 'priv' // host -> one member: that hero's private state (gold, relics, upgrades ...)
  | 'in' // member -> host: input state + one-shot actions
  | 'cmd' // member -> host: UI command (equip, sell, buy, go to town ...)
  | 'tw' // host -> one member: you are in town now (final private state)
  | 'handback' // member -> host: leaving town through a door, here is my current loadout
  | 'st' // host -> all: party state (who is in town / downed, which doors exist); only sent on change (P5-C)
  | 'hbc' // member -> host: I gave up waiting for the level, put me back in town (P5-C)
  | 'hbx'; // host -> member: your hand-back could not be done, stay in town (P5-C)

// --- Teammate -> host ------------------------------------------------------------------------------------------
export const KEY_W = 1;
export const KEY_A = 2;
export const KEY_S = 4;
export const KEY_D = 8;
/** Held "interact" key = revive a downed teammate. */
export const KEY_F = 16;

export const ACT_ATTACK = 1;
export const ACT_DASH = 2;
export const ACT_POMMEL = 3;
export const ACT_POTION = 4;

export interface LoadoutPayload {
  classId: string;
  loadout: CharacterLoadout;
  angel: AngelBuff | null;
}

export interface InputPayload {
  /** The sender's clock (performance.now, integer ms). The host echoes it back so the sender can reconcile. */
  t: number;
  /** KEY_* bit mask of held keys. */
  k: number;
  /** Facing angle x100 (what the cursor / auto aim chose). */
  f: number;
  /** Left mouse (hold to attack) held. */
  h: 0 | 1;
  /** One-shot actions since the last message (ACT_*). */
  a?: number[];
}

export type CommandPayload =
  | { c: 'eq'; id: string; s?: number }
  | { c: 'uneq'; s: number }
  | { c: 'sell'; id: string }
  | { c: 'sellc'; y?: 0 | 1 }
  | { c: 'up'; kind: string }
  | { c: 'buy' }
  /** Back to town (B, or free = 1 when walking through an existing dungeon portal). */
  | { c: 'town'; free?: 1 }
  /** The "回到城鎮" button on the downed screen. */
  | { c: 'death' }
  /** Treasure room: open chest number `i` (index in the level payload's chest list; the host checks reach and state). */
  | { c: 'chest'; i: number };

export interface HandbackPayload {
  /** Hero id whose portal to leave through, or 'entrance'. */
  door: string;
  classId: string;
  loadout: CharacterLoadout;
  angel: AngelBuff | null;
  hp: number;
  shield: number;
}

// --- Host -> teammates -------------------------------------------------------------------------------------------
/** The state of ONE hero that only its owner needs (everybody else sees position / HP only). */
export interface PrivatePayload {
  /** gold, potions, upgrades, equipped / bag relics, max depth (the shape of a character save; the stash never travels). */
  ld: CharacterLoadout;
  /** Angel blessing. */
  ab: AngelBuff | null;
  /** kills, normal, elite, boss, goldEarned, damage, crits, potionsUsed */
  st: [number, number, number, number, number, number, number, number];
  /** Chronos hourglass used on this floor. */
  ch: 0 | 1;
  /** Name of what downed this hero (death screen). */
  sl: string;
}

export interface RosterEntry {
  id: string;
  name: string;
  cls: string;
  x: number;
  z: number;
  /** In town right now. */
  tw?: 1;
}

export interface LevelPayload {
  n: number;
  seed: number;
  roster: RosterEntry[];
  /** 1 = a new floor (not a rebuild of the same one). */
  fl?: 1;
  /** The complete world (all enemies etc.). */
  snap: SnapshotPayload;
  /** Optional (treasure room floors only): room id and chests as [gx, gz, opened 0 | 1]. Older clients ignore it. */
  tr?: { r: number; c: Array<[number, number, 0 | 1]> };
  /** The receiver's own private state. */
  priv: PrivatePayload;
}

/**
 * Hero entry of a snapshot:
 * [id, x100, z100, facing100, hp, maxHp, shield, flags, attackAnim100, pommelAnim100, echoT, echoAgeMs,
 *  rescueProgressOnMe100, myRescueTargetId, myRescueProgress100, level?, maxShield?]
 * The last two are optional (added later; older clients ignore them) and feed the teammate rows of the HUD.
 */
export type HeroSnap = [string, number, number, number, number, number, number, number, number, number, number, number, number, string, number, number?, number?];
export const HF_DEAD = 1;
export const HF_TOWN = 2;
export const HF_DASH = 4;
export const HF_HIT = 8;
export const HF_HIT_SHIELD = 16;

export interface EnemyStatic {
  i: number;
  k: string;
  m: number;
  /** 0 normal, 1 elite, 2 special elite */
  e: 0 | 1 | 2;
  n?: string;
  bn?: string;
  bt?: string;
}

/**
 * Enemy entry: [id, x100, z100, facing100, hp, flags, (boss) windupProgress100, telegraphX100, telegraphZ100,
 * telegraphRadius100, skillIndex]. A telegraphRadius of 0 on a windup means a basic attack (no ground circle). Only entries that changed since the last snapshot are sent.
 */
export type EnemySnap = number[];
export const EF_STUN = 1;
export const EF_FROZEN = 2;
export const EF_SLOW = 4;
export const EF_HIT = 8;
export const EF_AC34 = 16;
export const EF_AC75 = 32;
/** Boss state is `flags >> EF_BOSS_SHIFT` (0 chase, 1 windup, 2 strike, 3 recover). */
export const EF_BOSS_SHIFT = 6;
/** Boss only (optional, bit 8 sits above the 2-bit boss state): the boss is enraged. Older clients ignore it. */
export const EF_ENRAGED = 256;

/** Enemy projectile (flies straight, the receiver moves it): [pid, kind, x100, z100, vx100, vz100] */
export type ProjSnap = [number, string, number, number, number, number];
/** Hero projectile (ice spike shotIdx 0..2, hunter arrow shotIdx -1): [pid, ownerId, x100, z100, vx100, vz100, shotIdx] */
export type HeroProjSnap = [number, string, number, number, number, number, number];
/** Hunter pet: [ownerId, species 0 bear / 1 chocobo / 2 wolf, name, x100, z100, facing100, hp, maxHp, buffSec100, hitFlash] */
export type PetSnap = [string, 0 | 1 | 2, string, number, number, number, number, number, number, 0 | 1];
/** Loot of a teammate (only the owner draws it): [id, ownerId, type 0 gold / 1 potion / 2 relic, x100, z100, rarity 0-3] */
export type LootSnap = [number, string, number, number, number, number];
/** A hero's lingering portal: [ownerId, x100, z100, downed] */
export type DoorSnap = [string, number, number, number];

export interface WorldSnap {
  k: 0 | 1;
  u: 0 | 1;
  /** Indices (in build order) of the rune wells that were used up */
  ru: number[];
  /** Indices (in build order) of the broken crates / urns */
  br: number[];
  /** Optional (treasure room floors only): indices of the opened treasure chests. Older clients ignore it. */
  tc?: number[];
}

/**
 * Event: batched into the snapshot (never sent alone). The first element is the type:
 *  ['f', x100, y100, z100, text, tone, toId?]   floating text (damage numbers are public, pickups private)
 *  ['s', soundName, originId, toId?]            sound
 *  ['b', title, subtitle, toId?]                banner
 *  ['k', mag100, dur100, toId]                  screen shake (private)
 *  ['x', x100, z100, big]                       an enemy died here (burst)
 */
export type GameEvent = Array<string | number>;

export interface SnapshotPayload {
  /** Host clock (performance.now ms) when it was built. */
  ts: number;
  d: number;
  /** Host `elapsed` x100, keeps the spike trap cycle in step. */
  el: number;
  hs: HeroSnap[];
  /** New enemies (static part). */
  en?: EnemyStatic[];
  /** Changed enemies. */
  es?: EnemySnap[];
  /** Enemies that died / vanished. */
  er?: number[];
  /** New projectiles. */
  ps?: ProjSnap[];
  hp?: HeroProjSnap[];
  /** Ended projectiles (enemy + hero). */
  pr?: number[];
  /** Loot: new or moved, and gone. */
  ls?: LootSnap[];
  lr?: number[];
  w?: WorldSnap;
  dr?: DoorSnap[];
  /** Active hunter pets in the dungeon. */
  pets?: PetSnap[];
  ev?: GameEvent[];
}

/** Party state: [heroId, 0 in the dungeon | 1 in town | 2 downed]. Sent by the host whenever it (or the doors) change. */
export interface PartyStatePayload {
  /** Depth of the floor the doors belong to. */
  d: number;
  h: Array<[string, 0 | 1 | 2]>;
  dr: DoorSnap[];
}

export interface TownPayload {
  priv: PrivatePayload;
  /** P7: sent to a mid-game joiner so its town knows the floor depth, doors and who is where (it never saw a `level`). */
  st?: PartyStatePayload;
  /** The hero's HP / shield when leaving the dungeon. */
  hp: number;
  sh: number;
}

export function q100(v: number): number {
  return Math.round(v * 100);
}
