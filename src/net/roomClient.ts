// Browser side of the room connection (P5-A: lobby only). Single player never imports or calls this.
// Reconnect is intentionally not implemented yet (P7): a dropped connection is reported and the UI returns to the lobby.

import {
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_PING,
  MAX_CHAT_LENGTH,
  PING_INTERVAL_MS,
  ROOM_CODE_PATTERN,
  type ClientMessage,
  type ServerMessage,
} from '../../shared/room';

export type RoomErrorKind =
  | 'invalid_code'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'full'
  | 'game_started'
  | 'network'
  | 'connect_failed';

export class RoomConnectError extends Error {
  readonly kind: RoomErrorKind;
  constructor(kind: RoomErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

export function roomErrorText(kind: RoomErrorKind): string {
  switch (kind) {
    case 'invalid_code':
      return '房號格式不正確（6 碼英數字）';
    case 'unauthorized':
      return '登入已過期，請重新登入';
    case 'forbidden':
      return '無法使用這個角色加入房間';
    case 'not_found':
      return '找不到房間，請確認房號是否正確';
    case 'full':
      return '房間已滿（最多 4 人）';
    case 'game_started':
      return '遊戲已開始，無法加入（中途加入尚未開放）';
    case 'network':
      return '無法連線到伺服器';
    default:
      return '連線失敗，請稍後再試';
  }
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

export function isRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

export interface RoomClientHandlers {
  onMessage: (msg: ServerMessage) => void;
  /** Own latency (ms), updated about every PING_INTERVAL_MS. */
  onLatency: (ms: number) => void;
  /** The socket closed (for any reason; also fires after roomClosed / replaced). */
  onClose: (info: { code: number; wasRequested: boolean }) => void;
}

function wsUrl(code: string, characterId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/rooms/${code}/ws?characterId=${encodeURIComponent(characterId)}`;
}

export class RoomClient {
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private keepAliveTimer = 0;
  private lastRtt: number | undefined;
  private requestedClose = false;

  constructor(private handlers: RoomClientHandlers) {}

  /** The lobby hands the open connection over to the game (P5-B): the new handlers receive everything from now on. */
  setHandlers(handlers: RoomClientHandlers): void {
    this.handlers = handlers;
  }

  /** Dry-run over HTTP first (precise errors), then opens the WebSocket. Resolves once the socket is open. */
  async connect(rawCode: string, characterId: string): Promise<void> {
    const code = normalizeRoomCode(rawCode);
    if (!isRoomCode(code)) throw new RoomConnectError('invalid_code');

    let res: Response;
    try {
      res = await fetch(`/api/rooms/${code}/ws?characterId=${encodeURIComponent(characterId)}`, {
        credentials: 'same-origin',
      });
    } catch {
      throw new RoomConnectError('network');
    }
    if (!res.ok) {
      if (res.status === 401) throw new RoomConnectError('unauthorized');
      if (res.status === 403) throw new RoomConnectError('forbidden');
      if (res.status === 404) throw new RoomConnectError('not_found');
      if (res.status === 409) {
        let code = '';
        try {
          code = String(((await res.json()) as { error?: unknown }).error ?? '');
        } catch {
          // no body: treat as full
        }
        throw new RoomConnectError(code === 'game_started' ? 'game_started' : 'full');
      }
      throw new RoomConnectError('connect_failed');
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl(code, characterId));
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.startTimers();
        resolve();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        if (ev.data === 'pong') return; // keep-alive auto-response
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === 'pong') {
          this.lastRtt = Math.max(0, Math.round(performance.now() - msg.t));
          this.handlers.onLatency(this.lastRtt);
        }
        this.handlers.onMessage(msg);
      };
      ws.onerror = () => {
        if (!opened) reject(new RoomConnectError('connect_failed'));
      };
      ws.onclose = (ev) => {
        this.stopTimers();
        if (!opened) {
          reject(new RoomConnectError('connect_failed'));
          return;
        }
        this.handlers.onClose({ code: ev.code, wasRequested: this.requestedClose });
      };
    });
  }

  private startTimers(): void {
    this.sendPing();
    // A second early ping reports our first measured rtt so others see our latency soon after joining.
    window.setTimeout(() => this.sendPing(), 1500);
    this.pingTimer = window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    this.keepAliveTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(KEEPALIVE_PING);
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopTimers(): void {
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.keepAliveTimer);
  }

  private sendPing(): void {
    this.send({ type: 'ping', t: performance.now(), rtt: this.lastRtt });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Host only: lock the room and tell everybody the game begins. */
  startGame(): void {
    this.send({ type: 'startGame' });
  }

  /** Game traffic (P5-B). Host: `to` = one playerId or omitted for everybody else. Member: always goes to the host. */
  sendRelay(kind: string, payload: unknown, to?: string): void {
    this.send({ type: 'relay', kind, payload, to });
  }

  sendChat(text: string): void {
    const t = text.trim();
    if (t && Array.from(t).length <= MAX_CHAT_LENGTH) this.send({ type: 'chat', text: t });
  }

  /** Leave the room on purpose (the host leaving ends the room for everybody). */
  close(): void {
    this.requestedClose = true;
    this.stopTimers();
    this.ws?.close(1000, 'leave');
  }
}
