// Room protocol shared by the Room Durable Object (workers/room), the Pages Functions and the browser client.
// Keep this file free of DOM / Workers specific APIs. See docs/multiplayer-spec.md section 5.

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
export type ClientMessage = ChatSend | PingSend | RelaySend | StartGameSend | TownPosSend;

// --- Server -> client ---------------------------------------------------------------------------

export interface WelcomeMsg {
  type: 'welcome';
  code: string;
  playerId: string;
  isHost: boolean;
  members: RoomMember[];
  /** True once the host pressed start (only reachable by a reconnect of an existing member). */
  started?: boolean;
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
export type ServerMessage =
  | WelcomeMsg
  | MemberJoinedMsg
  | MemberLeftMsg
  | RoomClosedMsg
  | ChatMsg
  | PongMsg
  | ReplacedMsg
  | GameStartedMsg
  | RelayMsg
  | TownPosMsg;

/** Header the Pages Function uses to hand the verified identity to the DO (URI-encoded JSON). */
export const IDENTITY_HEADER = 'x-ev-identity';
export interface VerifiedIdentity {
  accountId: string;
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
  | 'bad_request';
