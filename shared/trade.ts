// P6 town trading: offer types and the pure trade calculation shared by the Room Durable Object (the only place that
// executes a trade) and the browser. Keep this file free of DOM / Workers specific APIs.
// Spec: docs/multiplayer-spec.md section 7.

import type { RelicItem } from '../src/game/relics';
import { MAX_BAG, MAX_STASH } from './character';

export type TradeSource = 'bag' | 'stash';

/** One relic a player puts on the table: its id and the container it comes from (equipped relics cannot be traded). */
export interface TradeOfferItem {
  id: string;
  from: TradeSource;
}

export interface TradeOffer {
  gold: number;
  relics: TradeOfferItem[];
}

/** Most relics one side may offer in a single trade (keeps messages and the modal small). */
export const MAX_TRADE_RELICS = 20;
/** Same ceiling the save validation uses for gold. */
export const MAX_TRADE_GOLD = 1_000_000_000_000;
/** A request nobody answered is dropped after this long (ms). */
export const TRADE_REQUEST_TTL_MS = 30_000;

export type TradeErrorCode =
  | 'invalid_offer'
  | 'item_missing'
  | 'gold_insufficient'
  | 'no_space'
  | 'empty_trade'
  | 'offer_changed'
  | 'version_conflict'
  | 'server_error';

export const EMPTY_TRADE_OFFER: TradeOffer = { gold: 0, relics: [] };

/** Validates an untrusted offer coming from a browser. Returns null when it is malformed. */
export function parseTradeOffer(v: unknown): TradeOffer | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { gold?: unknown; relics?: unknown };
  if (typeof o.gold !== 'number' || !Number.isInteger(o.gold) || o.gold < 0 || o.gold > MAX_TRADE_GOLD) return null;
  if (!Array.isArray(o.relics) || o.relics.length > MAX_TRADE_RELICS) return null;
  const seen = new Set<string>();
  const relics: TradeOfferItem[] = [];
  for (const r of o.relics) {
    if (!r || typeof r !== 'object') return null;
    const { id, from } = r as { id?: unknown; from?: unknown };
    if (typeof id !== 'string' || id.length === 0 || id.length > 64 || seen.has(id)) return null;
    if (from !== 'bag' && from !== 'stash') return null;
    seen.add(id);
    relics.push({ id, from });
  }
  return { gold: o.gold, relics };
}

/** The tradable part of a character save. */
export interface TradeSideState {
  gold: number;
  bag: RelicItem[];
  stash: RelicItem[];
}

export interface TradeSideResult extends TradeSideState {
  /** What this side gave (in offer order, as read from its own save) and received (in the other side's offer order). */
  gave: RelicItem[];
  received: RelicItem[];
}

export type TradeSideId = 'a' | 'b';

export type ApplyTradeResult =
  | { ok: true; a: TradeSideResult; b: TradeSideResult }
  | { ok: false; error: TradeErrorCode; side: TradeSideId };

interface Taken {
  bag: RelicItem[];
  stash: RelicItem[];
  gave: RelicItem[];
}

/** Removes the offered relics from their declared containers; null when one of them is not there. */
function takeOffered(side: TradeSideState, offer: TradeOffer): Taken | null {
  const bag = [...side.bag];
  const stash = [...side.stash];
  const gave: RelicItem[] = [];
  for (const o of offer.relics) {
    const list = o.from === 'bag' ? bag : stash;
    const idx = list.findIndex((r) => r.id === o.id);
    if (idx === -1) return null;
    gave.push(list.splice(idx, 1)[0]);
  }
  return { bag, stash, gave };
}

/** Received relics go to the front of the bag (like a stash withdrawal) while it has room, the rest to the stash. */
function receive(bag: RelicItem[], stash: RelicItem[], incoming: RelicItem[]): { bag: RelicItem[]; stash: RelicItem[] } | null {
  const room = Math.max(0, MAX_BAG - bag.length);
  const toBag = incoming.slice(0, room);
  const toStash = incoming.slice(room);
  if (stash.length + toStash.length > MAX_STASH) return null;
  return { bag: [...toBag, ...bag], stash: [...stash, ...toStash] };
}

/**
 * The whole trade arithmetic, nothing else: checks the items exist in the declared containers, the gold is there and the
 * receiver has room (bag first, overflow to the stash, both caps respected), then returns both new states.
 * Space is computed after both sides gave their items away, so a swap works even with full bags.
 */
export function applyTrade(a: TradeSideState, offerA: TradeOffer, b: TradeSideState, offerB: TradeOffer): ApplyTradeResult {
  if (parseTradeOffer(offerA) === null) return { ok: false, error: 'invalid_offer', side: 'a' };
  if (parseTradeOffer(offerB) === null) return { ok: false, error: 'invalid_offer', side: 'b' };
  if (offerA.gold === 0 && offerA.relics.length === 0 && offerB.gold === 0 && offerB.relics.length === 0) {
    return { ok: false, error: 'empty_trade', side: 'a' };
  }
  const takenA = takeOffered(a, offerA);
  if (!takenA) return { ok: false, error: 'item_missing', side: 'a' };
  const takenB = takeOffered(b, offerB);
  if (!takenB) return { ok: false, error: 'item_missing', side: 'b' };
  if (a.gold < offerA.gold) return { ok: false, error: 'gold_insufficient', side: 'a' };
  if (b.gold < offerB.gold) return { ok: false, error: 'gold_insufficient', side: 'b' };

  const goldA = a.gold - offerA.gold + offerB.gold;
  const goldB = b.gold - offerB.gold + offerA.gold;
  if (goldA > MAX_TRADE_GOLD) return { ok: false, error: 'invalid_offer', side: 'a' };
  if (goldB > MAX_TRADE_GOLD) return { ok: false, error: 'invalid_offer', side: 'b' };

  const nextA = receive(takenA.bag, takenA.stash, takenB.gave);
  if (!nextA) return { ok: false, error: 'no_space', side: 'a' };
  const nextB = receive(takenB.bag, takenB.stash, takenA.gave);
  if (!nextB) return { ok: false, error: 'no_space', side: 'b' };

  return {
    ok: true,
    a: { gold: goldA, bag: nextA.bag, stash: nextA.stash, gave: takenA.gave, received: takenB.gave },
    b: { gold: goldB, bag: nextB.bag, stash: nextB.stash, gave: takenB.gave, received: takenA.gave },
  };
}

/** Resolves an offer against a save: the relics (from the declared containers) or the first problem found. */
export function resolveOffer(
  side: TradeSideState,
  offer: TradeOffer
): { ok: true; items: RelicItem[] } | { ok: false; error: TradeErrorCode } {
  if (side.gold < offer.gold) return { ok: false, error: 'gold_insufficient' };
  const taken = takeOffered(side, offer);
  if (!taken) return { ok: false, error: 'item_missing' };
  return { ok: true, items: taken.gave };
}
