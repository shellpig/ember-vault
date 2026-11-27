import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE_RATE_LIMITED,
  CLOSE_REPLACED,
  CLOSE_ROOM_CLOSED,
  CLOSE_TOO_BIG,
  HOST_GRACE_MS,
  IDENTITY_HEADER,
  BIG_MEMBER_RELAY_KINDS,
  HOST_MAX_MESSAGE_BYTES,
  KEEPALIVE_PING,
  KEEPALIVE_PONG,
  MAX_CHAT_LENGTH,
  MAX_MESSAGE_BYTES,
  RATE_LIMITS,
  RESUME_HEADER,
  RESUME_TOKEN_PATTERN,
  ROOM_IDLE_TTL_MS,
  ROOM_MAX_PLAYERS,
  type ClientMessage,
  type RoomErrorCode,
  type RoomMember,
  type ServerMessage,
  type TradeEndReason,
  type TradeSideView,
  type VerifiedIdentity,
} from '../../../shared/room';
import {
  EMPTY_TRADE_OFFER,
  TRADE_REQUEST_TTL_MS,
  parseTradeOffer,
  type TradeErrorCode,
  type TradeOffer,
} from '../../../shared/trade';
import type { RelicItem } from '../../../src/game/relics';
import { executeTrade, resolveOfferFromDb } from './trade';

/** Bindings of the Room Worker (workers/room/wrangler.toml). `DB` is the same D1 database the Pages project uses (P6 trades). */
interface Env {
  DB: D1Database;
}

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
 *
 * P6 trades: the DO arbitrates trades between two members who are both in town (as reported by their clients). Offers are
 * kept in memory only (a hibernation eviction simply drops them; clients that talk about an unknown trade are told it
 * `expired`). Execution reads both characters from D1 and writes both saves plus a `trades` row in one batch
 * (workers/room/src/trade.ts). Nothing periodic is added: every trade message is user driven.
 */
interface RoomMeta {
  hostAccountId: string;
  createdAt: number;
  /** Set by the host's `startGame`. P7: a started room still accepts joiners (mid-game join), up to the member limit. */
  started?: boolean;
  /** P7: the host page's random resume token (from its first join). Only the same token may resume after a drop. */
  hostToken?: string;
  /** P7: the host's socket dropped; the room waits until this time (epoch ms) for the same page to come back. */
  hostGoneUntil?: number;
  /** P7: the dropped host's player id; a resuming host page keeps it so every client's host / hero ids still match. */
  hostPlayerId?: string;
}

/** Stored with serializeAttachment so it survives hibernation. */
interface Attachment extends RoomMember {
  accountId: string;
  /** The character this connection plays (from the verified identity); P6 trades read / write its D1 row. */
  characterId: string;
  /** P6: client reported "my hero is in town". Survives hibernation with the attachment. */
  inTown?: boolean;
  /** Set on a connection that is being replaced by a newer one from the same account. */
  replaced?: boolean;
}

interface Bucket {
  tokens: number;
  last: number;
}

/** One player's half of a trade (in memory only). */
interface TradeSide {
  playerId: string;
  characterId: string;
  accountId: string;
  name: string;
  offer: TradeOffer;
  /** The offered relics as read from D1 when the offer was made (shown to the partner, compared again at execution). */
  items: RelicItem[];
  confirmed: boolean;
  /** Counts offer messages; an offer whose D1 read finishes after a newer one arrived is dropped. */
  seq: number;
}

interface Trade {
  id: string;
  /** The player who asked. */
  a: TradeSide;
  /** The player who was asked. */
  b: TradeSide;
  state: 'pending' | 'open';
  /** Bumped on every offer change; a confirmation only counts for the revision it was made on. */
  rev: number;
  createdAt: number;
  /** Offer reads from D1 still in flight (confirmations wait for them to settle). */
  inflight: number;
  /** The D1 batch is running: the trade can no longer be changed or cancelled. */
  executing: boolean;
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

/** P7: the resume token the Pages Function forwarded (browser supplied; never an identity, only an extra check for the host). */
function parseResumeToken(request: Request): string | null {
  const raw = request.headers.get(RESUME_HEADER);
  return raw && RESUME_TOKEN_PATTERN.test(raw) ? raw : null;
}

function parseIdentity(request: Request): VerifiedIdentity | null {
  const raw = request.headers.get(IDENTITY_HEADER);
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<VerifiedIdentity>;
    if (
      typeof v.accountId === 'string' &&
      typeof v.characterId === 'string' &&
      v.characterId.length > 0 &&
      typeof v.name === 'string' &&
      typeof v.classId === 'string' &&
      typeof v.maxDepth === 'number'
    ) {
      return { accountId: v.accountId, characterId: v.characterId, name: v.name, classId: v.classId, maxDepth: v.maxDepth };
    }
  } catch {
    // fall through
  }
  return null;
}

export class Room extends DurableObject<Env> {
  private meta: RoomMeta | null | undefined; // undefined = not loaded yet
  private readonly buckets = new WeakMap<WebSocket, Bucket>();
  private readonly latencies = new Map<string, number>();
  /** P6: active trades by id (at most one per player; never persisted). */
  private readonly trades = new Map<string, Trade>();

  constructor(ctx: DurableObjectState, env: Env) {
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
    const resume = parseResumeToken(request);
    // P7 host grace: only the same host page (same account AND same resume token) takes the room back. A reload (no token),
    // a wrong token or an expired window ends the room as it always did.
    const inGrace = isHost && meta.hostGoneUntil !== undefined;
    if (inGrace && (Date.now() > (meta.hostGoneUntil as number) || !resume || resume !== meta.hostToken)) {
      await this.closeRoom('host_left');
      return errorResponse(404, 'room_not_found');
    }
    // A guest can only join a room whose host is present (the room ends when the host leaves; during the grace window
    // members wait for the host and retry).
    if (!isHost && !live.some((s) => s.att.isHost)) return errorResponse(404, 'room_not_found');
    // P7: a started room accepts joiners too (mid-game join / reconnect); only the member limit applies.
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
    // P7: a host resuming within the grace window (validated above) keeps its old player id: the teammates' engines and
    // its own still address the host hero / handbacks by that id
    if (inGrace && meta.hostPlayerId) playerId = meta.hostPlayerId;
    if (existing) {
      playerId = existing.att.playerId;
      existing.ws.serializeAttachment({ ...existing.att, replaced: true } satisfies Attachment);
      this.send(existing.ws, { type: 'replaced' });
      this.cancelTradesOf(playerId, 'partner_left');
      try {
        existing.ws.close(CLOSE_REPLACED, 'replaced');
      } catch {
        // already closed
      }
    }

    const att: Attachment = {
      playerId,
      accountId: identity.accountId,
      characterId: identity.characterId,
      name: identity.name,
      classId: identity.classId,
      maxDepth: identity.maxDepth,
      isHost,
    };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(att);
    let resumed = false;
    if (isHost) {
      await this.ctx.storage.deleteAlarm();
      resumed = meta.started === true && resume !== null && resume === meta.hostToken && (inGrace || existing !== undefined);
      if (inGrace || (resume && meta.hostToken !== resume)) {
        if (resume) meta.hostToken = resume;
        delete meta.hostGoneUntil;
        delete meta.hostPlayerId;
        await this.ctx.storage.put('meta', meta);
      }
    }

    const members = this.liveSockets().map((s) => this.publicMember(s.att));
    this.send(server, {
      type: 'welcome',
      code: this.codeFromRequest(request),
      playerId,
      isHost,
      members,
      started: meta.started === true,
      ...(resumed ? { resumed: true } : {}),
    });
    if (inGrace) this.broadcast({ type: 'hostState', state: 'ok' }, server);
    // A resuming host is not a new member (its member entry never left the others' lists)
    if (!resumed) this.broadcast({ type: 'memberJoined', member: this.publicMember(att) }, server);

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
      case 'townPos': {
        // P5-C: town positions go straight to everybody else (never through the host). `from` is stamped here.
        if (!(await this.loadMeta())?.started) return;
        const num = (v: unknown, lim: number): number | null =>
          typeof v === 'number' && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, Math.round(v))) : null;
        const x = num(msg.x, 100000);
        const z = num(msg.z, 100000);
        const f = num(msg.f, 1000);
        const a = msg.a === 1 || msg.a === 2 ? msg.a : 0;
        if (x === null || z === null || f === null) return;
        this.broadcast({ type: 'townPos', from: att.playerId, x, z, f, a }, ws);
        return;
      }
      case 'townState': {
        if (!(await this.loadMeta())?.started) return;
        const inTown = msg.inTown === true;
        if (att.inTown === inTown) return;
        ws.serializeAttachment({ ...att, inTown } satisfies Attachment);
        if (!inTown) this.cancelTradesOf(att.playerId, 'left_town');
        return;
      }
      case 'tradeReq':
      case 'tradeAccept':
      case 'tradeOffer':
      case 'tradeConfirm':
      case 'tradeCancel': {
        if (message.length > MAX_MESSAGE_BYTES) {
          ws.close(CLOSE_TOO_BIG, 'message_too_big');
          return;
        }
        if (!(await this.loadMeta())?.started) return;
        await this.onTradeMessage(ws, att, msg);
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

  // --- P6: trades -----------------------------------------------------------------------------------------

  private socketOf(playerId: string): { ws: WebSocket; att: Attachment } | undefined {
    return this.liveSockets().find((s) => s.att.playerId === playerId);
  }

  private tradeOf(playerId: string): Trade | undefined {
    for (const t of this.trades.values()) if (t.a.playerId === playerId || t.b.playerId === playerId) return t;
    return undefined;
  }

  private sendTo(playerId: string, msg: ServerMessage): void {
    const s = this.socketOf(playerId);
    if (s) this.send(s.ws, msg);
  }

  /** Ends a trade that did not execute. `by` (the one who caused it) is told 'self', the other side gets `reason`. */
  private endTrade(trade: Trade, by: string | null, reason: TradeEndReason, code?: TradeErrorCode): void {
    this.trades.delete(trade.id);
    for (const side of [trade.a, trade.b]) {
      this.sendTo(side.playerId, {
        type: 'tradeEnd',
        tradeId: trade.id,
        reason: side.playerId === by ? 'self' : reason,
        code,
      });
    }
  }

  /** The player left (disconnected, replaced, left town ...): their trade, if any, is over. A running execution is left alone. */
  private cancelTradesOf(playerId: string, reason: TradeEndReason): void {
    const t = this.tradeOf(playerId);
    if (t && !t.executing) this.endTrade(t, playerId, reason);
  }

  private tradeView(side: TradeSide): TradeSideView {
    return {
      gold: side.offer.gold,
      relics: side.offer.relics.map((o, i) => ({ id: o.id, from: o.from, item: side.items[i] })),
      confirmed: side.confirmed,
    };
  }

  private sendTradeUpdate(trade: Trade): void {
    const a = this.tradeView(trade.a);
    const b = this.tradeView(trade.b);
    this.sendTo(trade.a.playerId, { type: 'tradeUpdate', tradeId: trade.id, rev: trade.rev, mine: a, theirs: b });
    this.sendTo(trade.b.playerId, { type: 'tradeUpdate', tradeId: trade.id, rev: trade.rev, mine: b, theirs: a });
  }

  private refuseTrade(ws: WebSocket, tradeId: string, reason: TradeEndReason): void {
    this.send(ws, { type: 'tradeEnd', tradeId, reason });
  }

  private async onTradeMessage(
    ws: WebSocket,
    att: Attachment,
    msg: Extract<ClientMessage, { type: 'tradeReq' | 'tradeAccept' | 'tradeOffer' | 'tradeConfirm' | 'tradeCancel' }>
  ): Promise<void> {
    if (msg.type === 'tradeReq') {
      this.onTradeReq(ws, att, msg.to);
      return;
    }
    const trade = this.tradeOf(att.playerId);
    const id = typeof msg.tradeId === 'string' ? msg.tradeId : '';
    if (msg.type === 'tradeCancel') {
      if (trade && !trade.executing && (!id || id === trade.id)) this.endTrade(trade, att.playerId, 'cancelled');
      // A trade we no longer know (evicted, already over): tell the client so it stops waiting for an answer
      else if (!trade && id) this.refuseTrade(ws, id, 'expired');
      return;
    }
    // Everything else must name the sender's current trade; otherwise it is gone (e.g. the DO was evicted)
    if (!trade || trade.id !== id) {
      this.refuseTrade(ws, id, 'expired');
      return;
    }
    if (trade.executing) return;
    const me = trade.a.playerId === att.playerId ? trade.a : trade.b;
    const other = me === trade.a ? trade.b : trade.a;

    if (msg.type === 'tradeAccept') {
      if (trade.state !== 'pending' || trade.b.playerId !== att.playerId) return;
      if (Date.now() - trade.createdAt > TRADE_REQUEST_TTL_MS + 5000) {
        this.endTrade(trade, null, 'timeout');
        return;
      }
      if (!att.inTown || !this.socketOf(other.playerId)?.att.inTown) {
        this.endTrade(trade, null, 'left_town');
        return;
      }
      trade.state = 'open';
      trade.rev = 0;
      this.sendTo(trade.a.playerId, { type: 'tradeOpen', tradeId: trade.id, partner: trade.b.playerId, partnerName: trade.b.name });
      this.sendTo(trade.b.playerId, { type: 'tradeOpen', tradeId: trade.id, partner: trade.a.playerId, partnerName: trade.a.name });
      this.sendTradeUpdate(trade);
      return;
    }

    if (trade.state !== 'open') return;

    if (msg.type === 'tradeOffer') {
      const offer = parseTradeOffer({ gold: msg.gold, relics: msg.relics });
      if (!offer) {
        this.send(ws, { type: 'tradeError', tradeId: trade.id, code: 'invalid_offer' });
        return;
      }
      const seq = ++me.seq;
      trade.inflight++;
      let res: Awaited<ReturnType<typeof resolveOfferFromDb>>;
      try {
        res = await resolveOfferFromDb(this.env.DB, me.characterId, me.accountId, offer);
      } finally {
        trade.inflight--;
      }
      // The trade may have ended / started executing, or a newer offer may have arrived, while D1 was read
      if (this.trades.get(trade.id) !== trade || trade.executing || me.seq !== seq) return;
      if (!res.ok) {
        this.send(ws, { type: 'tradeError', tradeId: trade.id, code: res.error });
        return;
      }
      me.offer = offer;
      me.items = res.items;
      trade.a.confirmed = false;
      trade.b.confirmed = false;
      trade.rev++;
      this.sendTradeUpdate(trade);
      return;
    }

    if (msg.type === 'tradeConfirm') {
      // Only the exact state the player was looking at can be confirmed; offers still being read settle first
      if (msg.rev !== trade.rev || trade.inflight > 0 || me.confirmed) return;
      const empty = (s: TradeSide) => s.offer.gold === 0 && s.offer.relics.length === 0;
      if (empty(trade.a) && empty(trade.b)) {
        this.send(ws, { type: 'tradeError', tradeId: trade.id, code: 'empty_trade' });
        return;
      }
      me.confirmed = true;
      this.sendTradeUpdate(trade);
      if (other.confirmed) await this.runTrade(trade);
    }
  }

  private onTradeReq(ws: WebSocket, att: Attachment, to: unknown): void {
    const target = typeof to === 'string' && to !== att.playerId ? this.socketOf(to) : undefined;
    if (!target) return this.refuseTrade(ws, '', 'unavailable');
    // A request nobody answered is dropped lazily so it cannot block either player forever
    for (const pid of [att.playerId, target.att.playerId]) {
      const old = this.tradeOf(pid);
      if (old && old.state === 'pending' && !old.executing && Date.now() - old.createdAt > TRADE_REQUEST_TTL_MS + 5000) {
        this.endTrade(old, null, 'timeout');
      }
    }
    if (!att.inTown || !target.att.inTown || this.tradeOf(att.playerId) || this.tradeOf(target.att.playerId)) {
      return this.refuseTrade(ws, '', 'unavailable');
    }
    const side = (a: Attachment): TradeSide => ({
      playerId: a.playerId,
      characterId: a.characterId,
      accountId: a.accountId,
      name: a.name,
      offer: EMPTY_TRADE_OFFER,
      items: [],
      confirmed: false,
      seq: 0,
    });
    const trade: Trade = {
      id: crypto.randomUUID().slice(0, 8),
      a: side(att),
      b: side(target.att),
      state: 'pending',
      rev: 0,
      createdAt: Date.now(),
      inflight: 0,
      executing: false,
    };
    this.trades.set(trade.id, trade);
    this.send(ws, { type: 'tradeWait', tradeId: trade.id, partner: trade.b.playerId, partnerName: trade.b.name });
    this.send(target.ws, { type: 'tradeRequest', tradeId: trade.id, from: trade.a.playerId, name: trade.a.name });
  }

  /** Both confirmed: read both saves, check, write both + the trade row in one batch, then tell both players. */
  private async runTrade(trade: Trade): Promise<void> {
    trade.executing = true;
    let res: Awaited<ReturnType<typeof executeTrade>>;
    try {
      const party = (s: TradeSide) => ({ characterId: s.characterId, accountId: s.accountId, offer: s.offer, snapshot: s.items });
      res = await executeTrade(this.env.DB, party(trade.a), party(trade.b));
    } catch {
      res = { ok: false, error: 'server_error' };
    }
    this.trades.delete(trade.id);
    if (!res.ok) {
      for (const s of [trade.a, trade.b]) {
        this.sendTo(s.playerId, { type: 'tradeEnd', tradeId: trade.id, reason: 'failed', code: res.error });
      }
      return;
    }
    for (const [s, r] of [[trade.a, res.a], [trade.b, res.b]] as const) {
      this.sendTo(s.playerId, {
        type: 'tradeDone',
        tradeId: trade.id,
        saveVersion: r.version,
        gold: r.gold,
        gave: r.gave,
        received: r.received,
      });
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
    this.cancelTradesOf(att.playerId, 'partner_left');
    if (att.isHost) {
      const meta = await this.loadMeta();
      if (meta?.started && meta.hostToken) {
        // P7: a running game gets a short grace window; the same host page may come back and keep its authority
        meta.hostGoneUntil = Date.now() + HOST_GRACE_MS;
        meta.hostPlayerId = att.playerId;
        await this.ctx.storage.put('meta', meta);
        await this.ctx.storage.setAlarm(meta.hostGoneUntil);
        this.broadcast({ type: 'hostState', state: 'reconnecting', graceMs: HOST_GRACE_MS }, ws);
      } else {
        await this.closeRoom('host_left');
      }
      return;
    }
    this.broadcast({ type: 'memberLeft', playerId: att.playerId }, ws);
  }

  /** Tells everybody, closes every connection and wipes all room state (the code becomes reusable). */
  private async closeRoom(reason: 'host_left' | 'idle'): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    this.meta = null; // from here on joins get 404 and disconnects are ignored
    this.trades.clear();
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
    const meta = await this.loadMeta();
    if (!meta) return;
    // P7: the host did not come back inside the grace window
    if (meta.hostGoneUntil !== undefined) {
      if (this.liveSockets().some((s) => s.att.isHost)) return;
      if (Date.now() >= meta.hostGoneUntil) await this.closeRoom('host_left');
      else await this.ctx.storage.setAlarm(meta.hostGoneUntil);
      return;
    }
    // Idle clean-up: nobody ever connected (or everybody dropped without a close event).
    if (this.liveSockets().length === 0) await this.closeRoom('idle');
  }
}

export default {
  // The Worker is private (no routes, workers_dev = false); answer 404 to anything that gets here anyway.
  fetch(): Response {
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler;
