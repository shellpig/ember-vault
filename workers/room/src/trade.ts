import type { RelicItem } from '../../../src/game/relics';
import {
  applyTrade,
  resolveOffer,
  type TradeErrorCode,
  type TradeOffer,
  type TradeSideState,
} from '../../../shared/trade';

/**
 * P6: everything the Room Durable Object does against D1 for a trade. The DO is the only writer of both saves of a
 * trade: it reads both characters, runs the pure `applyTrade` from shared/trade.ts and writes both rows plus one `trades`
 * row in a single D1 batch. Spec: docs/multiplayer-spec.md section 7.
 */

interface TradeRow {
  id: string;
  account_id: string;
  gold: number;
  bag: string;
  stash: string;
  save_version: number;
}

export interface TradeSideData {
  state: TradeSideState;
  version: number;
}

function parseRelics(text: string): RelicItem[] {
  // Strict on purpose: falling back to [] here would make the batch overwrite (wipe) a stash we could not read.
  const v: unknown = JSON.parse(text);
  if (!Array.isArray(v)) throw new Error('bad relic json');
  return v as RelicItem[];
}

function rowToSide(row: TradeRow): TradeSideData {
  return {
    state: { gold: row.gold, bag: parseRelics(row.bag), stash: parseRelics(row.stash) },
    version: row.save_version,
  };
}

const ROW_SQL = 'SELECT id, account_id, gold, bag, stash, save_version FROM characters WHERE id = ?';

/** Reads one character the connection owns (null when it is gone or belongs to another account). */
export async function readTradeSide(db: D1Database, characterId: string, accountId: string): Promise<TradeSideData | null> {
  const row = await db.prepare(ROW_SQL).bind(characterId).first<TradeRow>();
  if (!row || row.account_id !== accountId) return null;
  return rowToSide(row);
}

/**
 * Checks an offer against the owner's current D1 save and returns the relics it names (as stored in D1, in offer order).
 * These resolved copies are what the partner sees, so a client can never show the partner an item it does not own.
 */
export async function resolveOfferFromDb(
  db: D1Database,
  characterId: string,
  accountId: string,
  offer: TradeOffer
): Promise<{ ok: true; items: RelicItem[] } | { ok: false; error: TradeErrorCode }> {
  let side: TradeSideData | null;
  try {
    side = await readTradeSide(db, characterId, accountId);
  } catch {
    return { ok: false, error: 'server_error' };
  }
  if (!side) return { ok: false, error: 'item_missing' };
  return resolveOffer(side.state, offer);
}

export interface TradeParty {
  characterId: string;
  accountId: string;
  offer: TradeOffer;
  /** The relics as they were when the offer was made; the stored ones must still match exactly at execution time. */
  snapshot: RelicItem[];
}

export interface TradeSideOutcome {
  /** New `save_version` in D1. */
  version: number;
  gold: number;
  gave: RelicItem[];
  received: RelicItem[];
}

export type ExecuteTradeResult =
  | { ok: true; a: TradeSideOutcome; b: TradeSideOutcome }
  | { ok: false; error: TradeErrorCode };

/**
 * A SELECT that raises an error ("integer overflow", the documented result of abs on the smallest 64-bit integer) when
 * the previous INSERT / UPDATE changed no row. In a D1 batch (one transaction) an error rolls back every earlier statement,
 * which is what makes the version check all-or-nothing instead of "write whatever still matches".
 */
const GUARD_PREVIOUS_CHANGED_ONE =
  'SELECT CASE WHEN changes() = 1 THEN 1 ELSE abs(-9223372036854775808) END AS guard';

const UPDATE_SQL =
  'UPDATE characters SET gold = ?, bag = ?, stash = ?, save_version = save_version + 1, updated_at = ? ' +
  'WHERE id = ? AND account_id = ? AND save_version = ?';

export async function executeTrade(db: D1Database, a: TradeParty, b: TradeParty): Promise<ExecuteTradeResult> {
  let sideA: TradeSideData | null;
  let sideB: TradeSideData | null;
  try {
    sideA = await readTradeSide(db, a.characterId, a.accountId);
    sideB = await readTradeSide(db, b.characterId, b.accountId);
  } catch {
    return { ok: false, error: 'server_error' };
  }
  if (!sideA || !sideB) return { ok: false, error: 'item_missing' };

  const result = applyTrade(sideA.state, a.offer, sideB.state, b.offer);
  if (!result.ok) return { ok: false, error: result.error };

  // The relics must be exactly what the partner saw when it confirmed (ids alone could be re-used by a tampered save).
  if (
    JSON.stringify(result.a.gave) !== JSON.stringify(a.snapshot) ||
    JSON.stringify(result.b.gave) !== JSON.stringify(b.snapshot)
  ) {
    return { ok: false, error: 'offer_changed' };
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    a: { characterId: a.characterId, gold: a.offer.gold, relics: result.a.gave },
    b: { characterId: b.characterId, gold: b.offer.gold, relics: result.b.gave },
  });
  const update = (p: TradeParty, next: TradeSideState, version: number) =>
    db
      .prepare(UPDATE_SQL)
      .bind(next.gold, JSON.stringify(next.bag), JSON.stringify(next.stash), now, p.characterId, p.accountId, version);

  try {
    await db.batch([
      update(a, result.a, sideA.version),
      db.prepare(GUARD_PREVIOUS_CHANGED_ONE),
      update(b, result.b, sideB.version),
      db.prepare(GUARD_PREVIOUS_CHANGED_ONE),
      db
        .prepare('INSERT INTO trades (id, char_a, char_b, payload, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), a.characterId, b.characterId, payload, now),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: /overflow/i.test(msg) ? 'version_conflict' : 'server_error' };
  }

  return {
    ok: true,
    a: { version: sideA.version + 1, gold: result.a.gold, gave: result.a.gave, received: result.a.received },
    b: { version: sideB.version + 1, gold: result.b.gold, gave: result.b.gave, received: result.b.received },
  };
}
