import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE_RATE_LIMITED,
  CLOSE_REPLACED,
  CLOSE_ROOM_CLOSED,
  CLOSE_TOO_BIG,
  IDENTITY_HEADER,
  BIG_MEMBER_RELAY_KINDS,
  HOST_MAX_MESSAGE_BYTES,
  KEEPALIVE_PING,
  KEEPALIVE_PONG,
  MAX_CHAT_LENGTH,
  MAX_MESSAGE_BYTES,
  RATE_LIMITS,
  ROOM_IDLE_TTL_MS,
  ROOM_MAX_PLAYERS,
  type ClientMessage,
  type RoomErrorCode,
  type RoomMember,
  type ServerMessage,
  type VerifiedIdentity,
} from '../../../shared/room';

/**
 * Room Durable Object (one instance per room code). Docs: docs/multiplayer-spec.md section 5.
 *
 * Trust model: this Worker has no public route. Only the Pages project can reach it (through its
 * `ROOM` binding) and the Pages Function has already verified the session and the character. The
 * identity arrives in the IDENTITY_HEADER set by that function; nothing the browser sends is trusted.
 *
 * Cost model (free plan: 100k DO requests / day, inbound WebSocket messages billed 20:1, outbound
 * and auto-responses free): the DO uses the WebSocket Hibernation API so it is evicted from memory
 * while idle, keep-alive pings are answered by setWebSocketAutoResponse without waking it, and
 * P5-A has no high-frequency messages (only join / leave / chat / a ping every few seconds).
 *
 * P5-B: `relay` messages (host -> everybody or one member, member -> host) carry the game traffic. They are only
 * accepted once the host has started the game. The sender id is stamped here. Sizes and rates depend on the role
 * (the host sends 15 Hz snapshots up to 32 KB, members send small inputs). Clients must send only on change.
 */
interface RoomMeta {
  hostAccountId: string;
  createdAt: number;
  /** Set by the host's `startGame`; from then on new members are refused (409 game_started). */
  started?: boolean;
}

/** Stored with serializeAttachment so it survives hibernation. */
interface Attachment extends RoomMember {
  accountId: string;
  /** Set on a connection that is being replaced by a newer one from the same account. */
  replaced?: boolean;
}

interface Bucket {
  tokens: number;
  last: number;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(status: number, error: RoomErrorCode): Response {
  return jsonResponse(status, { error });
}

function parseIdentity(request: Request): VerifiedIdentity | null {
  const raw = request.headers.get(IDENTITY_HEADER);
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<VerifiedIdentity>;
    if (
      typeof v.accountId === 'string' &&
      typeof v.name === 'string' &&
      typeof v.classId === 'string' &&
      typeof v.maxDepth === 'number'
    ) {
      return { accountId: v.accountId, name: v.name, classId: v.classId, maxDepth: v.maxDepth };
    }
  } catch {
    // fall through
  }
  return null;
}

export class Room extends DurableObject<Record<string, never>> {
  private meta: RoomMeta | null | undefined; // undefined = not loaded yet
  private readonly buckets = new WeakMap<WebSocket, Bucket>();
  private readonly latencies = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    // Keep-alive: the client sends the text "ping" every ~30 s; the runtime answers "pong" without waking the DO.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_PING, KEEPALIVE_PONG));
  }

  private async loadMeta(): Promise<RoomMeta | null> {
    if (this.meta === undefined) this.meta = (await this.ctx.storage.get<RoomMeta>('meta')) ?? null;
    return this.meta;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/init') return this.handleInit(request);
    if (path.endsWith('/ws')) return this.handleJoin(request);
    return errorResponse(404, 'room_not_found');
  }

  // --- Internal: create ---------------------------------------------------------------------------

  private async handleInit(request: Request): Promise<Response> {
    const hostAccountId = request.headers.get('x-ev-host-account');
    if (request.method !== 'POST' || !hostAccountId) return errorResponse(400, 'bad_request');
    if (await this.loadMeta()) return jsonResponse(409, { error: 'code_taken' });
    this.meta = { hostAccountId, createdAt: Date.now() };
    await this.ctx.storage.put('meta', this.meta);
    // If the host never connects the room is removed after the idle TTL.
    await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
    return jsonResponse(200, { ok: true });
  }

  // --- Internal: join -------------------------------------------------------------------------------

  private liveSockets(): Array<{ ws: WebSocket; att: Attachment }> {
    const out: Array<{ ws: WebSocket; att: Attachment }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && !att.replaced) out.push({ ws, att });
    }
    return out;
  }

  private publicMember(att: Attachment): RoomMember {
    return {
      playerId: att.playerId,
      name: att.name,
      classId: att.classId,
      maxDepth: att.maxDepth,
      isHost: att.isHost,
    };
  }

  private async handleJoin(request: Request): Promise<Response> {
    const identity = parseIdentity(request);
    if (!identity) return errorResponse(400, 'bad_request');
    const meta = await this.loadMeta();
    if (!meta) return errorResponse(404, 'room_not_found');

    const live = this.liveSockets();
    const isHost = identity.accountId === meta.hostAccountId;
    const existing = live.find((s) => s.att.accountId === identity.accountId);
    // A guest can only join a room whose host is present (the room ends when the host leaves).
    if (!isHost && !live.some((s) => s.att.isHost)) return errorResponse(404, 'room_not_found');
    if (!existing && meta.started) return errorResponse(409, 'game_started');
    if (!existing && live.length >= ROOM_MAX_PLAYERS) return errorResponse(409, 'room_full');

    // A plain GET (no Upgrade) is a dry run the browser uses to learn the exact error before opening the socket.
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return jsonResponse(200, { ok: true });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Same account again (second tab / reconnect): the new connection takes over the old one's player id.
    let playerId = crypto.randomUUID().slice(0, 8);
    if (existing) {
      playerId = existing.att.playerId;
      existing.ws.serializeAttachment({ ...existing.att, replaced: true } satisfies Attachment);
      this.send(existing.ws, { type: 'replaced' });
      try {
        existing.ws.close(CLOSE_REPLACED, 'replaced');
      } catch {
        // already closed
      }
    }

    const att: Attachment = {
      playerId,
      accountId: identity.accountId,
      name: identity.name,
      classId: identity.classId,
      maxDepth: identity.maxDepth,
      isHost,
    };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(att);
    if (isHost) await this.ctx.storage.deleteAlarm();

    const members = this.liveSockets().map((s) => this.publicMember(s.att));
    this.send(server, {
      type: 'welcome',
      code: this.codeFromRequest(request),
      playerId,
      isHost,
      members,
      started: meta.started === true,
    });
    this.broadcast({ type: 'memberJoined', member: this.publicMember(att) }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  private codeFromRequest(request: Request): string {
    // /api/rooms/:code/ws as forwarded by the Pages Function
    const parts = new URL(request.url).pathname.split('/');
    return parts[parts.length - 2] ?? '';
  }

  // --- Sending -----------------------------------------------------------------------------------------

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket already closed
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const text = JSON.stringify(msg);
    for (const { ws } of this.liveSockets()) {
      if (ws === except) continue;
      try {
        ws.send(text);
      } catch {
        // socket already closed
      }
    }
  }

  // --- Hibernation handlers ------------------------------------------------------------------------

  /** Token bucket. Returns false when the connection is over its rate. */
  private allow(ws: WebSocket, isHost: boolean): boolean {
    const now = Date.now();
    const lim = isHost ? RATE_LIMITS.host : RATE_LIMITS.member;
    const b = this.buckets.get(ws) ?? { tokens: lim.bucket, last: now };
    b.tokens = Math.min(lim.bucket, b.tokens + ((now - b.last) / 1000) * lim.refill);
    b.last = now;
    this.buckets.set(ws, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.replaced) return;
    if (typeof message !== 'string') {
      ws.close(1003, 'binary_not_supported');
      return;
    }
    // Absolute cap for everybody; members are held to the small limit below unless the relay kind is allowed to be big
    if (message.length > HOST_MAX_MESSAGE_BYTES) {
      ws.close(CLOSE_TOO_BIG, 'message_too_big');
      return;
    }
    if (!this.allow(ws, att.isHost)) {
      ws.close(CLOSE_RATE_LIMITED, 'rate_limited');
      return;
    }

    let msg: ClientMessage;
    try {
      const parsed: unknown = JSON.parse(message);
      if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
        throw new Error('bad shape');
      }
      msg = parsed as ClientMessage;
    } catch {
      ws.close(CLOSE_RATE_LIMITED, 'bad_message');
      return;
    }

    switch (msg.type) {
      case 'ping': {
        if (typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) {
          this.latencies.set(att.playerId, Math.max(0, Math.min(9999, Math.round(msg.rtt))));
        }
        this.send(ws, { type: 'pong', t: typeof msg.t === 'number' ? msg.t : 0, latencies: Object.fromEntries(this.latencies) });
        return;
      }
      case 'chat': {
        if (typeof msg.text !== 'string') return;
        // eslint-disable-next-line no-control-regex
        const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
        if (text.length === 0 || Array.from(text).length > MAX_CHAT_LENGTH) return;
        // `from` / `name` always come from the server-side attachment, never from the message.
        this.broadcast({ type: 'chat', from: att.playerId, name: att.name, text, ts: Date.now() });
        return;
      }
      case 'startGame': {
        if (!att.isHost) return;
        const meta = await this.loadMeta();
        if (!meta || meta.started) return;
        meta.started = true;
        await this.ctx.storage.put('meta', meta);
        this.broadcast({ type: 'gameStarted' });
        return;
      }
      case 'relay': {
        if (!(await this.loadMeta())?.started) return;
        // Members may only send small messages, except for the rare loadout hand-over
        if (!att.isHost && message.length > MAX_MESSAGE_BYTES && !BIG_MEMBER_RELAY_KINDS.includes(String(msg.kind))) {
          ws.close(CLOSE_TOO_BIG, 'message_too_big');
          return;
        }
        this.relay(att, msg);
        return;
      }
      default:
        return; // unknown types are ignored (forward compatible)
    }
  }

  /**
   * Relay routing: the host may address everybody else or one member (`to` = playerId), a member may only talk to the
   * host. The sender id is stamped here so nobody can spoof `from`.
   */
  private relay(att: Attachment, msg: Extract<ClientMessage, { type: 'relay' }>): void {
    if (typeof msg.kind !== 'string' || msg.kind.length > 32) return;
    const out: ServerMessage = { type: 'relay', from: att.playerId, kind: msg.kind, payload: msg.payload };
    const targets = this.liveSockets().filter((s) => s.att.playerId !== att.playerId);
    if (att.isHost) {
      const to = typeof msg.to === 'string' && msg.to !== 'all' ? msg.to : null;
      const text = JSON.stringify(out);
      for (const t of targets) {
        if (to && t.att.playerId !== to) continue;
        try {
          t.ws.send(text);
        } catch {
          // socket already closed
        }
      }
    } else {
      const host = targets.find((t) => t.att.isHost);
      if (host) this.send(host.ws, out);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }

  private async onDisconnect(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.replaced) return; // replaced connections are not a leave
    if (!(await this.loadMeta())) return; // room already closed
    this.latencies.delete(att.playerId);
    if (att.isHost) {
      await this.closeRoom('host_left');
      return;
    }
    this.broadcast({ type: 'memberLeft', playerId: att.playerId }, ws);
  }

  /** Tells everybody, closes every connection and wipes all room state (the code becomes reusable). */
  private async closeRoom(reason: 'host_left' | 'idle'): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    this.meta = null; // from here on joins get 404 and disconnects are ignored
    for (const ws of sockets) {
      this.send(ws, { type: 'roomClosed', reason });
      try {
        ws.close(CLOSE_ROOM_CLOSED, 'room_closed');
      } catch {
        // already closed
      }
    }
    this.latencies.clear();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    // Idle clean-up: nobody ever connected (or everybody dropped without a close event).
    if (!(await this.loadMeta())) return;
    if (this.liveSockets().length === 0) await this.closeRoom('idle');
  }
}

export default {
  // The Worker is private (no routes, workers_dev = false); answer 404 to anything that gets here anyway.
  fetch(): Response {
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler;
