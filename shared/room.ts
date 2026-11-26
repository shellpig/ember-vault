// Room protocol shared by the Room Durable Object (workers/room), the Pages Functions and the browser client.
// Keep this file free of DOM / Workers specific APIs. See docs/multiplayer-spec.md section 5.

import type { RelicItem } from '../src/game/relics';
import type { TradeErrorCode, TradeOfferItem } from './trade';

export const ROOM_MAX_PLAYERS = 4;
export const ROOM_CODE_LENGTH = 6;
/** Upper-case letters and digits without the easily confused 0 / O / 1 / I / L (31 symbols). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export const MAX_CHAT_LENGTH = 200;
/** Largest accepted inbound WebSocket message from a member (UTF-16 code units of the JSON text). */
export const MAX_MESSAGE_BYTES = 4096;
/**
 * P5-B: the host's relay messages (snapshots, full level state) are bigger; the host gets a higher cap. Members may
 * send big messages only for the rare `BIG_MEMBER_RELAY_KINDS` (a character loadout is ~10 KB of relics).
 */
export const HOST_MAX_MESSAGE_BYTES = 32768;
export const BIG_MEMBER_RELAY_KINDS: readonly string[] = ['loadout', 'handback'];
/**
 * Token bucket per connection: a burst of `bucket` messages, refilled at `refill` per second. Chosen from the steady
 * traffic of section 5.2.1: the host sends a 15 Hz snapshot + a few events / private states (about 20 / s), a member
 * sends at most 20 Hz input + commands (about 22 / s). Sustained flooding beyond that is closed with 1008.
 */
export const RATE_LIMITS = {
  host: { bucket: 80, refill: 40 },
  member: { bucket: 50, refill: 30 },
} as const;
/** Application-level latency ping interval (ms). Keep it low: inbound messages are billed 20:1. */
export const PING_INTERVAL_MS = 5000;
/** Plain-text keep-alive answered by setWebSocketAutoResponse (never wakes the DO, not billed). */
export const KEEPALIVE_PING = 'ping';
export const KEEPALIVE_PONG = 'pong';
export const KEEPALIVE_INTERVAL_MS = 30_000;
/** A room nobody is connected to is deleted after this long. */
export const ROOM_IDLE_TTL_MS = 2 * 60 * 1000;

/** P7: after the host's socket drops in a running game the room stays alive this long for the same page to resume. */
export const HOST_GRACE_MS = 15_000;
/** P7: a member whose socket dropped retries the join for this long (backoff 1 s, 2 s, 4 s, 8 s, 8 s ...). */
export const MEMBER_RECONNECT_WINDOW_MS = 30_000;
/** P7: the host must be back before the grace window ends (the DO closes the room at HOST_GRACE_MS). */
export const HOST_RECONNECT_WINDOW_MS = HOST_GRACE_MS - 1000;
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 8000;
/** P7: per-page random token the host's browser sends on every join; the DO accepts a host resume only with the same one. */
export const RESUME_HEADER = 'x-ev-resume';
export const RESUME_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** P7: at most this many `POST /api/rooms` per account in the window (D1 table `room_creates`). */
export const ROOM_CREATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 } as const;

/** Custom WebSocket close codes (4000-4999 are free for applications). */
export const CLOSE_REPLACED = 4001; // same account joined again from another tab
export const CLOSE_ROOM_CLOSED = 4002; // host left
export const CLOSE_RATE_LIMITED = 1008;
export const CLOSE_TOO_BIG = 1009;

export interface RoomMember {
  playerId: string;
  name: string;
  classId: string;
  maxDepth: number;
  isHost: boolean;
}

// --- Client -> server ---------------------------------------------------------------------------

export interface ChatSend {
  type: 'chat';
  text: string;
}
/** `rtt` is the client's last measured round trip (ms) so the server can share everybody's latency. */
export interface PingSend {
  type: 'ping';
  t: number;
  rtt?: number;
}
/**
 * P5-B relay. Host -> everybody else (`to` omitted / 'all') or one member (`to` = that member's playerId).
 * Member -> host only (`to` is ignored). The server stamps `from`; `payload` is opaque and bounded by the message size
 * limits above. Only accepted after the game has started. The `kind` list lives in shared/game.ts.
 */
export interface RelaySend {
  type: 'relay';
  to?: string;
  kind: string;
  payload: unknown;
}
/** Host only: close the room to new members and tell everybody the game begins (spec section 5.2). */
export interface StartGameSend {
  type: 'startGame';
}
/**
 * P5-C: position of a hero walking around its own town. Everybody in the room (not only the host) can send it and the
 * server fans it out to all other members directly, so it never goes through the host (that would count twice in the
 * Durable Object request budget, spec 5.2.1). Numbers are x100 integers; `a`: 0 standing, 1 walking, 2 (re)appeared here.
 */
export interface TownPosSend {
  type: 'townPos';
  x: number;
  z: number;
  f: number;
  a: 0 | 1 | 2;
}
/**
 * P6: the client tells the DO whether its hero is in town (sent on change only). Trades need both sides in town and end
 * when one leaves. Client reported on purpose: the town runs locally (spec 7).
 */
export interface TownStateSend {
  type: 'townState';
  inTown: boolean;
}
/** P6: ask `to` (a playerId) for a trade. Both must be in town and free of any other trade. */
export interface TradeReqSend {
  type: 'tradeReq';
  to: string;
}
/** P6: the receiver accepts the pending request. */
export interface TradeAcceptSend {
  type: 'tradeAccept';
  tradeId: string;
}
/** P6: replaces my whole offer (the server re-reads my save and resets both confirmations). */
export interface TradeOfferSend {
  type: 'tradeOffer';
  tradeId: string;
  gold: number;
  relics: TradeOfferItem[];
}
/** P6: confirm the offers as I saw them; `rev` must be the revision of the last `tradeUpdate` I received. */
export interface TradeConfirmSend {
  type: 'tradeConfirm';
  tradeId: string;
  rev: number;
}
/** P6: cancel (or decline) my current trade or request. */
export interface TradeCancelSend {
  type: 'tradeCancel';
  tradeId?: string;
}
export type ClientMessage =
  | ChatSend
  | PingSend
  | RelaySend
  | StartGameSend
  | TownPosSend
  | TownStateSend
  | TradeReqSend
  | TradeAcceptSend
  | TradeOfferSend
  | TradeConfirmSend
  | TradeCancelSend;

// --- Server -> client ---------------------------------------------------------------------------

export interface WelcomeMsg {
  type: 'welcome';
  code: string;
  playerId: string;
  isHost: boolean;
  members: RoomMember[];
  /** True once the host pressed start. P7: a joiner (new or reconnecting) that sees this goes straight into the game. */
  started?: boolean;
  /** P7: the host's page reconnected inside the grace window and keeps its authority (it re-announces the floor). */
  resumed?: boolean;
}
/** The host started the game: every member leaves the lobby and loads the dungeon. */
export interface GameStartedMsg {
  type: 'gameStarted';
}
export interface MemberJoinedMsg {
  type: 'memberJoined';
  member: RoomMember;
}
export interface MemberLeftMsg {
  type: 'memberLeft';
  playerId: string;
}
export interface RoomClosedMsg {
  type: 'roomClosed';
  reason: 'host_left' | 'idle';
}
/**
 * P7: the host's connection dropped (`reconnecting`, the room waits `graceMs`) or is back (`ok`). Members freeze their
 * dungeon view meanwhile; if the host does not come back the room closes with `roomClosed`.
 */
export interface HostStateMsg {
  type: 'hostState';
  state: 'reconnecting' | 'ok';
  graceMs?: number;
}
export interface ChatMsg {
  type: 'chat';
  from: string;
  name: string;
  text: string;
  ts: number;
}
export interface PongMsg {
  type: 'pong';
  t: number;
  /** Latest known round trip (ms) per playerId. */
  latencies: Record<string, number>;
}
/** Same account joined from another tab: this connection is being replaced. */
export interface ReplacedMsg {
  type: 'replaced';
}
export interface RelayMsg {
  type: 'relay';
  from: string;
  kind: string;
  payload: unknown;
}
export interface TownPosMsg {
  type: 'townPos';
  from: string;
  x: number;
  z: number;
  f: number;
  a: 0 | 1 | 2;
}
/** P6: you asked for a trade; waiting for `partner` to answer. */
export interface TradeWaitMsg {
  type: 'tradeWait';
  tradeId: string;
  partner: string;
  partnerName: string;
}
/** P6: `from` wants to trade with you. */
export interface TradeRequestMsg {
  type: 'tradeRequest';
  tradeId: string;
  from: string;
  name: string;
}
/** P6: the receiver accepted; both sides open the trade window. */
export interface TradeOpenMsg {
  type: 'tradeOpen';
  tradeId: string;
  partner: string;
  partnerName: string;
}
/** One side of an open trade as the server sees it. Relics are resolved from the owner's D1 save, never client supplied. */
export interface TradeSideView {
  gold: number;
  relics: Array<{ id: string; from: TradeOfferItem['from']; item: RelicItem }>;
  confirmed: boolean;
}
/** P6: the full state of an open trade, sent to both sides after every change (each gets its own `mine` / `theirs`). */
export interface TradeUpdateMsg {
  type: 'tradeUpdate';
  tradeId: string;
  rev: number;
  mine: TradeSideView;
  theirs: TradeSideView;
}
/** P6: a rejected offer / confirmation. The trade stays open with the previous offer. */
export interface TradeErrorMsg {
  type: 'tradeError';
  tradeId: string;
  code: TradeErrorCode;
}
export type TradeEndReason =
  | 'cancelled' // the other side cancelled / declined
  | 'self' // answer to my own cancel
  | 'timeout'
  | 'partner_left' // disconnected or replaced
  | 'left_town'
  | 'unavailable' // request refused: not in town, already busy, unknown partner
  | 'expired' // the server no longer knows this trade (e.g. it was evicted)
  | 'failed'; // execution failed, nothing changed (see `code`)
/** P6: the trade (or request) is over and nothing was transferred. */
export interface TradeEndMsg {
  type: 'tradeEnd';
  tradeId: string;
  reason: TradeEndReason;
  code?: TradeErrorCode;
}
/**
 * P6: the trade was executed. The new save is already in D1 (version `saveVersion`); the client fetches it over HTTP and
 * replaces its local state with it. The stash (up to 200 relics) deliberately never travels over the socket (AGENTS rule 4).
 */
export interface TradeDoneMsg {
  type: 'tradeDone';
  tradeId: string;
  saveVersion: number;
  gold: number;
  gave: RelicItem[];
  received: RelicItem[];
}
export type ServerMessage =
  | WelcomeMsg
  | MemberJoinedMsg
  | MemberLeftMsg
  | RoomClosedMsg
  | ChatMsg
  | PongMsg
  | ReplacedMsg
  | HostStateMsg
  | GameStartedMsg
  | RelayMsg
  | TownPosMsg
  | TradeWaitMsg
  | TradeRequestMsg
  | TradeOpenMsg
  | TradeUpdateMsg
  | TradeErrorMsg
  | TradeEndMsg
  | TradeDoneMsg;

/** Header the Pages Function uses to hand the verified identity to the DO (URI-encoded JSON). */
export const IDENTITY_HEADER = 'x-ev-identity';
export interface VerifiedIdentity {
  accountId: string;
  /** P6: the character this connection plays (checked against the session by the Pages Function). Trades use it. */
  characterId: string;
  name: string;
  classId: string;
  maxDepth: number;
}

export type RoomErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'room_not_found'
  | 'room_full'
  | 'game_started'
  | 'bad_request'
  /** P7: HTTP 429 of `POST /api/rooms` (ROOM_CREATE_LIMIT). */
  | 'room_create_limited';
