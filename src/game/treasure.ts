// Treasure room (docs/treasure-room-spec.md): numbers, room choice, chest placement, pity step and the chest outcome roll.
// Pure functions (no three.js, no engine) so a plain script can simulate them. Every probability and count lives in
// TREASURE_CONFIG; the engine side is src/game/engine/treasure.ts.

import { MAX_TREASURE_PITY } from '../../shared/character';
import type { DungeonData, RoomRect, TreasureChestData, TreasureRoomData } from './types';

/** What a chest holds, see the table in spec section 3. */
export type TreasureOutcome = 'coins' | 'elite' | 'named' | 'boss' | 'bossPlus';

export const TREASURE_CONFIG = {
  /** Chance that a floor gets a treasure room (spec 1). */
  roomChance: 0.1,
  /** After this many floors in a row without one, the next eligible floor always has one. */
  pityMisses: 8,
  /** Floors with fewer combat rooms never get a treasure room (the counter still goes up). */
  minCombatRooms: 3,
  /** Boss floors (`depth % bossFloorEvery === 0`) never get one (the counter still goes up). */
  bossFloorEvery: 5,
  /** Chests in the room, uniformly between min and max (spec 2). */
  chestMin: 3,
  chestMax: 6,
  /** A hero within this distance (world units) of a chest can open it with F (spec 4). */
  openRange: 1.6,
  /** The host accepts a teammate's open request within this distance (prediction / latency slack). */
  hostOpenRange: 2.8,
  /** The auto-pilot walks to a chest until it is this close, then opens it. */
  autoOpenRange: 1.35,
  /** The auto-pilot only goes for chests when no live monster is closer than this to the hero or the chest. */
  autoThreatRange: 9,
  /** Chest outcome table, weights in percent (spec 3). */
  outcomes: [
    { id: 'coins', weight: 20 },
    { id: 'elite', weight: 50 },
    { id: 'named', weight: 20 },
    { id: 'boss', weight: 9 },
    { id: 'bossPlus', weight: 1 },
  ] as ReadonlyArray<{ id: TreasureOutcome; weight: number }>,
  /** 'coins': gold and elixirs of this many plain elites (no relic rolls). */
  coinsEliteCount: 3,
  /** 'bossPlus': the extra relic is orange with this chance, otherwise green. */
  bossPlusOrangeChance: 0.5,
} as const;

type Rng = () => number;

/** Id of the room that carries the guaranteed floor elite (the last non-start / key / exit room). Same rule as spawnEnemies. */
export function lastCombatRoomId(d: DungeonData): number {
  let id = -1;
  for (const r of d.rooms) if (r.role !== 'start' && r.role !== 'key' && r.role !== 'exit') id = r.id;
  return id;
}

function isFloorTile(d: DungeonData, gx: number, gz: number): boolean {
  const t = d.tiles[gz]?.[gx];
  return t === 1 || t === 3 || t === 4 || t === 6;
}

/** The cells of a room's border that lead outside (floor on both sides of the wall line), as [inside, outside] pairs. */
function doorwayPairs(d: DungeonData, r: RoomRect): Array<Array<{ gx: number; gz: number }>> {
  // One list per side, ordered along the side, so neighbouring open cells (a 2 wide corridor) form one doorway
  const sides: Array<Array<{ gx: number; gz: number; open: boolean }>> = [[], [], [], []];
  for (let i = 0; i < r.w; i++) {
    const gx = r.x + i;
    sides[0].push({ gx, gz: r.z, open: isFloorTile(d, gx, r.z) && isFloorTile(d, gx, r.z - 1) });
    sides[1].push({ gx, gz: r.z + r.h - 1, open: isFloorTile(d, gx, r.z + r.h - 1) && isFloorTile(d, gx, r.z + r.h) });
  }
  for (let i = 0; i < r.h; i++) {
    const gz = r.z + i;
    sides[2].push({ gx: r.x, gz, open: isFloorTile(d, r.x, gz) && isFloorTile(d, r.x - 1, gz) });
    sides[3].push({ gx: r.x + r.w - 1, gz, open: isFloorTile(d, r.x + r.w - 1, gz) && isFloorTile(d, r.x + r.w, gz) });
  }
  const runs: Array<Array<{ gx: number; gz: number }>> = [];
  for (const side of sides) {
    let run: Array<{ gx: number; gz: number }> = [];
    for (const c of side) {
      if (c.open) {
        run.push({ gx: c.gx, gz: c.gz });
      } else if (run.length > 0) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length > 0) runs.push(run);
  }
  return runs;
}

/** Number of separate doorways of a room (1 = dead end). Contiguous open border cells (a wide corridor) count once. */
export function countRoomEntrances(d: DungeonData, r: RoomRect): number {
  return doorwayPairs(d, r).length;
}

/**
 * The room that holds the treasure: a combat room (not start / key / exit / shrine, not the room that carries the guaranteed
 * floor elite), preferably a dead end (fewest doorways); ties are broken at random. Null when there is none.
 */
export function pickTreasureRoom(d: DungeonData, rng: Rng): RoomRect | null {
  const skip = lastCombatRoomId(d);
  const cands = d.rooms.filter((r) => r.role === 'combat' && r.id !== skip);
  if (cands.length === 0) return null;
  let best = Infinity;
  let pool: RoomRect[] = [];
  for (const r of cands) {
    const n = countRoomEntrances(d, r);
    if (n < best) {
      best = n;
      pool = [r];
    } else if (n === best) {
      pool.push(r);
    }
  }
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/**
 * `count` chest cells spread over the room's free floor, each as far as possible from the ones already chosen. Tiles next to a
 * doorway are used last (the entrance stays clear), the room's outer ring only when the inside is full.
 */
export function placeTreasureChests(d: DungeonData, room: RoomRect, count: number, rng: Rng): TreasureChestData[] {
  const occupied = new Set<string>();
  const mark = (p?: { gx: number; gz: number }): void => {
    if (p) occupied.add(`${p.gx},${p.gz}`);
  };
  mark(d.spawn);
  mark(d.keyPos);
  mark(d.doorPos);
  mark(d.stairsPos);
  mark(d.altarPos);
  mark(d.shopPos);
  for (const p of d.props) mark(p);

  const doorCells = doorwayPairs(d, room).flat();
  const nearDoor = (gx: number, gz: number): boolean =>
    doorCells.some((c) => Math.abs(c.gx - gx) <= 1 && Math.abs(c.gz - gz) <= 1);

  const tier1: Array<{ gx: number; gz: number }> = []; // inside, away from the doorways
  const tier2: Array<{ gx: number; gz: number }> = []; // inside
  const tier3: Array<{ gx: number; gz: number }> = []; // anywhere in the room
  for (let gz = room.z; gz < room.z + room.h; gz++) {
    for (let gx = room.x; gx < room.x + room.w; gx++) {
      if (d.tiles[gz]?.[gx] !== 1 || occupied.has(`${gx},${gz}`)) continue;
      const inside = gx > room.x && gx < room.x + room.w - 1 && gz > room.z && gz < room.z + room.h - 1;
      if (inside && !nearDoor(gx, gz)) tier1.push({ gx, gz });
      else if (inside) tier2.push({ gx, gz });
      else tier3.push({ gx, gz });
    }
  }

  const chosen: TreasureChestData[] = [];
  const tiers = [tier1, tier2, tier3];
  while (chosen.length < count) {
    const pool = tiers.find((t) => t.length > 0);
    if (!pool) break;
    let pickIdx = 0;
    if (chosen.length === 0) {
      pickIdx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    } else {
      let bestScore = -1;
      pool.forEach((c, i) => {
        let minD = Infinity;
        for (const o of chosen) minD = Math.min(minD, Math.hypot(o.gx - c.gx, o.gz - c.gz));
        const score = minD + rng() * 0.01; // tie-break
        if (score > bestScore) {
          bestScore = score;
          pickIdx = i;
        }
      });
    }
    const [c] = pool.splice(pickIdx, 1);
    chosen.push({ gx: c.gx, gz: c.gz, opened: false });
  }
  return chosen;
}

export interface TreasurePlan {
  treasure: TreasureRoomData | null;
  /** The pity counter after this floor (0 when a room appeared). */
  pity: number;
}

/**
 * One floor's treasure decision (spec 1 + 2): boss floors never get a room and leave the counter untouched; floors with
 * fewer than `minCombatRooms` combat rooms never get a room (the counter still grows); otherwise the room appears with `roomChance`, or for sure once the counter reached
 * `pityMisses`. Returns the new counter together with the room and its chests.
 */
export function planTreasureForFloor(d: DungeonData, depth: number, pity: number, rng: Rng): TreasurePlan {
  const cfg = TREASURE_CONFIG;
  const miss = (): TreasurePlan => ({ treasure: null, pity: Math.min(MAX_TREASURE_PITY, Math.max(0, Math.floor(pity)) + 1) });
  if (depth % cfg.bossFloorEvery === 0) return { treasure: null, pity: Math.max(0, Math.floor(pity)) };
  if (d.rooms.filter((r) => r.role === 'combat').length < cfg.minCombatRooms) return miss();
  const appear = pity >= cfg.pityMisses || rng() < cfg.roomChance;
  if (!appear) return miss();
  const room = pickTreasureRoom(d, rng);
  if (!room) return miss();
  const count = cfg.chestMin + Math.min(cfg.chestMax - cfg.chestMin, Math.floor(rng() * (cfg.chestMax - cfg.chestMin + 1)));
  const chests = placeTreasureChests(d, room, count, rng);
  if (chests.length < cfg.chestMin) return miss();
  return { treasure: { roomId: room.id, chests }, pity: 0 };
}

/** Rolls what one hero gets out of one chest (spec 3). */
export function rollTreasureOutcome(rng: Rng): TreasureOutcome {
  const total = TREASURE_CONFIG.outcomes.reduce((s, o) => s + o.weight, 0);
  let r = rng() * total;
  for (const o of TREASURE_CONFIG.outcomes) {
    if (r < o.weight) return o.id;
    r -= o.weight;
  }
  return TREASURE_CONFIG.outcomes[0].id;
}
