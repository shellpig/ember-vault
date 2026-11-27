import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Crown, LogOut } from 'lucide-react';
import { ApiError, api } from '../api';
import { HERO_CLASSES, type HeroClassId } from '../game/classes';
import { RoomClient, RoomConnectError, roomErrorText } from '../net/roomClient';
import { MAX_CHAT_LENGTH, ROOM_MAX_PLAYERS, type ChatMsg, type RoomMember, type ServerMessage } from '../../shared/room';
import type { CharacterSave } from '../../shared/character';
import { BTN_PLAIN, PANEL, Shell, StartDepthPicker, isBossArenaUnlocked } from './AccountScreens';

export type RoomEntry = { kind: 'create' } | { kind: 'join'; code: string };

/** What the lobby hands to the game when the host starts it (P5-B): the open connection and who is in the room. */
export interface RoomGameStart {
  client: RoomClient;
  selfId: string;
  hostId: string;
  isHost: boolean;
  members: RoomMember[];
  /** P7: the room's game was already running when this client joined (mid-game join): the host adds the hero in town. */
  late?: boolean;
  /** Host only: the floor chosen in the lobby (1..max depth); stays on this client, the protocol does not carry it. */
  startDepth?: number;
}

const MAX_CHAT_LINES = 100;

export function RoomLobbyScreen({
  save,
  entry,
  onExit,
  onGameStart,
}: {
  save: CharacterSave;
  entry: RoomEntry;
  /** Back to the lobby; `notice` is shown there (omit for a plain leave). */
  onExit: (notice?: string) => void;
  /** The host started the game: the connection now belongs to the game. */
  onGameStart: (info: RoomGameStart) => void;
}) {
  const [code, setCode] = useState(entry.kind === 'join' ? entry.code : '');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [latencies, setLatencies] = useState<Record<string, number>>({});
  const [ownLatency, setOwnLatency] = useState<number | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'open'>('connecting');
  const clientRef = useRef<RoomClient | null>(null);
  const exitedRef = useRef(false);
  const closedNoticeRef = useRef<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onGameStartRef = useRef(onGameStart);
  onGameStartRef.current = onGameStart;
  const membersRef = useRef<RoomMember[]>([]);
  const selfIdRef = useRef<string | null>(null);
  const handedOffRef = useRef(false);
  const [startDepth, setStartDepth] = useState(Math.max(1, save.max_depth));
  const startDepthRef = useRef(startDepth);
  startDepthRef.current = startDepth;

  const exit = useCallback((notice?: string) => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    onExitRef.current(notice);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const client = new RoomClient({
      onLatency: (ms) => !cancelled && setOwnLatency(ms),
      onClose: ({ wasRequested }) => {
        if (cancelled || wasRequested) return;
        exit(closedNoticeRef.current ?? '與房間的連線已中斷');
      },
      onMessage: (msg: ServerMessage) => {
        if (cancelled) return;
        switch (msg.type) {
          case 'welcome':
            selfIdRef.current = msg.playerId;
            membersRef.current = msg.members;
            setSelfId(msg.playerId);
            setMembers(msg.members);
            setCode(msg.code);
            setStatus('open');
            // P7: the game is already running: skip the lobby and join it (the host puts this hero in town)
            if (msg.started && !msg.isHost && !handedOffRef.current) {
              const host = msg.members.find((m) => m.isHost);
              if (!host) break;
              handedOffRef.current = true;
              exitedRef.current = true;
              onGameStartRef.current({ client, selfId: msg.playerId, hostId: host.playerId, isHost: false, members: msg.members, late: true });
            }
            break;
          case 'memberJoined':
            membersRef.current = [...membersRef.current.filter((m) => m.playerId !== msg.member.playerId), msg.member];
            setMembers((prev) => [...prev.filter((m) => m.playerId !== msg.member.playerId), msg.member]);
            break;
          case 'gameStarted': {
            const selfId = selfIdRef.current;
            const members = membersRef.current;
            const host = members.find((m) => m.isHost);
            if (!selfId || !host || handedOffRef.current) break;
            handedOffRef.current = true;
            exitedRef.current = true;
            onGameStartRef.current({
              client,
              selfId,
              hostId: host.playerId,
              isHost: host.playerId === selfId,
              members,
              startDepth: startDepthRef.current,
            });
            break;
          }
          case 'memberLeft':
            membersRef.current = membersRef.current.filter((m) => m.playerId !== msg.playerId);
            setMembers((prev) => prev.filter((m) => m.playerId !== msg.playerId));
            setLatencies((prev) => {
              const next = { ...prev };
              delete next[msg.playerId];
              return next;
            });
            break;
          case 'pong':
            setLatencies(msg.latencies);
            break;
          case 'chat':
            setChat((prev) => [...prev, msg].slice(-MAX_CHAT_LINES));
            break;
          case 'roomClosed':
            closedNoticeRef.current = msg.reason === 'host_left' ? '房主已離開，房間已關閉' : '房間已因閒置而關閉';
            exit(closedNoticeRef.current); // do not wait for the close frame
            break;
          case 'replaced':
            closedNoticeRef.current = '你已在另一個分頁加入這個房間，這個連線已中斷';
            exit(closedNoticeRef.current);
            break;
          default:
            break;
        }
      },
    });
    clientRef.current = client;

    void (async () => {
      try {
        let target = entry.kind === 'join' ? entry.code : '';
        if (entry.kind === 'create') {
          target = (await api.createRoom(save.id)).code;
          if (cancelled) return;
          setCode(target);
        }
        await client.connect(target, save.id);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof RoomConnectError) exit(roomErrorText(err.kind));
        else if (err instanceof ApiError) {
          if (err.status === 401) exit(roomErrorText('unauthorized'));
          else if (err.status === 429) exit('建立房間太頻繁（10 分鐘內最多 5 次），請稍後再試');
          else exit('無法建立房間，請稍後再試');
        } else exit(roomErrorText('network'));
      }
    })();

    return () => {
      cancelled = true;
      // After the hand-off the game owns the connection
      if (!handedOffRef.current) client.close();
      clientRef.current = null;
    };
    // The connection is set up once per mount; entry / save never change while this screen is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [chat]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const sendChat = () => {
    if (!draft.trim()) return;
    clientRef.current?.sendChat(draft);
    setDraft('');
  };

  const isHost = members.find((m) => m.playerId === selfId)?.isHost ?? entry.kind === 'create';
  const sorted = [...members].sort((a, b) => Number(b.isHost) - Number(a.isHost));

  return (
    <Shell title="房間" subtitle="ROOM" wide>
      <div className="mx-auto w-[min(720px,96vw)] flex flex-col gap-4">
        <div className={`${PANEL} px-6 py-4 flex flex-col items-center gap-2`}>
          <div className="font-hud text-[11px] text-[#8d93a6]">房號（分享給朋友）</div>
          <div className="flex items-center gap-3">
            <div data-testid="room-code" className="select-text font-display text-4xl font-bold tracking-[0.35em] text-[#f3e1b4] pl-[0.35em]">
              {code || '······'}
            </div>
            <button type="button" aria-label="複製房號" disabled={!code} onClick={() => void copyCode()} className={`${BTN_PLAIN} !px-3 flex items-center gap-1`}>
              {copied ? <Check className="w-4 h-4 text-[#9be3a6]" /> : <Copy className="w-4 h-4" />}
              <span className="text-xs">{copied ? '已複製' : '複製'}</span>
            </button>
          </div>
          {status === 'connecting' && <div className="font-hud text-[11px] text-[#8d93a6]">連線中…</div>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`${PANEL} px-4 py-4`}>
            <div className="font-hud text-xs text-[#aeb3c2] mb-2" data-testid="member-count">
              成員（{members.length} / {ROOM_MAX_PLAYERS}）
            </div>
            <ul className="flex flex-col gap-2" data-testid="member-list">
              {sorted.map((m) => {
                const cls = HERO_CLASSES[m.classId as HeroClassId];
                const ms = m.playerId === selfId ? (ownLatency ?? latencies[m.playerId]) : latencies[m.playerId];
                return (
                  <li
                    key={m.playerId}
                    data-testid="member"
                    style={{ ['--cls' as string]: cls?.accentCss ?? '#d4a94e' }}
                    className="flex items-center justify-between gap-2 border border-[color:var(--cls)]/40 bg-[#10131c] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-display text-sm font-bold text-[color:var(--cls)] break-all">
                        {m.isHost && <Crown className="w-3.5 h-3.5 shrink-0 text-[#f0cf7b]" aria-label="房主" />}
                        <span data-testid="member-name">{m.name}</span>
                        {m.playerId === selfId && <span className="font-hud text-[10px] text-[#8d93a6]">（你）</span>}
                      </div>
                      <div className="font-hud text-[11px] text-[#aeb3c2] tabular-nums">
                        {cls?.name ?? m.classId} · 最深 {m.maxDepth} 層
                      </div>
                    </div>
                    <div data-testid="member-latency" className="font-hud text-[11px] text-[#8d93a6] tabular-nums shrink-0">
                      {ms === undefined ? '— ms' : `${ms} ms`}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className={`${PANEL} px-4 py-4 flex flex-col`}>
            <div className="font-hud text-xs text-[#aeb3c2] mb-2">聊天</div>
            <div data-testid="chat-log" className="select-text flex-1 min-h-[140px] max-h-[220px] overflow-y-auto flex flex-col gap-1 font-hud text-xs text-[#cfc9ba]">
              {chat.length === 0 && <div className="text-[#6a6f80]">還沒有訊息</div>}
              {chat.map((c, i) => (
                <div key={`${c.ts}-${i}`} className="break-words">
                  <span className={c.from === selfId ? 'text-[#f0cf7b]' : 'text-[#9fc4ff]'}>{c.name}</span>：{c.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2 mt-2">
              <input
                data-testid="chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                maxLength={MAX_CHAT_LENGTH}
                placeholder="輸入訊息"
                aria-label="聊天訊息"
                disabled={status !== 'open'}
                className="select-text flex-1 min-w-0 px-2 py-1.5 bg-[#10131c] border border-[#3a3428] text-[#f3e1b4] text-xs outline-none focus:border-[#d6b25e]"
              />
              <button type="button" data-testid="chat-send" className={`${BTN_PLAIN} !py-1.5 !text-xs`} disabled={status !== 'open'} onClick={sendChat}>
                送出
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          {isHost && (
            <div className="w-[min(360px,90vw)]">
              <StartDepthPicker
                maxDepth={save.max_depth}
                value={startDepth}
                onChange={setStartDepth}
                arenaUnlocked={isBossArenaUnlocked()}
              />
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" data-testid="leave-room" className={`${BTN_PLAIN} flex items-center gap-2`} onClick={() => exit()}>
              <LogOut className="w-4 h-4" />
              離開房間
            </button>
            {isHost && (
              <button
                type="button"
                data-testid="start-game"
                disabled={status !== 'open'}
                onClick={() => clientRef.current?.startGame()}
                className="px-4 py-2 border border-[#d6b25e] bg-[#2a2110] font-hud text-sm text-[#ffe7a8] hover:bg-[#3a2d15] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                開始遊戲
              </button>
            )}
          </div>
          {isHost ? (
            <p className="font-hud text-[11px] text-[#8d93a6]">你是房主：按下「開始遊戲」後大家一起進入地城；你離開時房間會關閉。</p>
          ) : (
            <p className="font-hud text-[11px] text-[#8d93a6]">等待房主開始遊戲。</p>
          )}
        </div>
      </div>
    </Shell>
  );
}
