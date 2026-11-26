// Room protocol shared by the Room Durable Object (workers/room), the Pages Functions and the browser client.
// Keep this file free of DOM / Workers specific APIs. See docs/multiplayer-spec.md section 5.

export const ROOM_MAX_PLAYERS = 4;
export const ROOM_CODE_LENGTH = 6;
/** Upper-case letters and digits without the easily confused 0 / O / 1 / I / L (31 symbols). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export const MAX_CHAT_LENGTH = 200;
/** Largest accepted inbound WebSocket message (UTF-16 code units of the JSON text). */
export const MAX_MESSAGE_BYTES = 4096;
/** Token bucket per connection: burst of RATE_BUCKET_SIZE messages, refilled at RATE_REFILL_PER_SEC. */
export const RATE_BUCKET_SIZE = 20;
export const RATE_REFILL_PER_SEC = 5;
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
 * RESERVED FOR P5-B (not enabled in P5-A; the DO ignores it while RELAY_ENABLED is false).
 * Host -> everybody else: `to` omitted (or 'all'). Member -> host only: `to` omitted / 'host'.
 * The server stamps `from`; `payload` is opaque and its size is bounded by MAX_MESSAGE_BYTES.
 */
export interface RelaySend {
  type: 'relay';
  to?: 'all' | 'host';
  kind: string; // e.g. 'input', 'snapshot', 'event', 'location'
  payload: unknown;
}
export type ClientMessage = ChatSend | PingSend | RelaySend;

// --- Server -> client ---------------------------------------------------------------------------

export interface WelcomeMsg {
  type: 'welcome';
  code: string;
  playerId: string;
  isHost: boolean;
  members: RoomMember[];
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
export type ServerMessage =
  | WelcomeMsg
  | MemberJoinedMsg
  | MemberLeftMsg
  | RoomClosedMsg
  | ChatMsg
  | PongMsg
  | ReplacedMsg
  | RelayMsg;

/** Header the Pages Function uses to hand the verified identity to the DO (URI-encoded JSON). */
export const IDENTITY_HEADER = 'x-ev-identity';
export interface VerifiedIdentity {
  accountId: string;
  name: string;
  classId: string;
  maxDepth: number;
}

export type RoomErrorCode = 'unauthorized' | 'forbidden' | 'room_not_found' | 'room_full' | 'bad_request';
