import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, LogOut, Plus, Shield, Trash2 } from 'lucide-react';
import { ApiError, api } from '../api';
import { HERO_CLASSES, MAX_BOTS, SELECTABLE_CLASS_IDS, HeroClassId } from '../game/classes';
import { loadBotSetup, saveBotSetup, type BotSetup } from '../botSetup';
import { ClassEmblem } from './ClassEmblem';
import { isRoomCode, normalizeRoomCode, roomErrorText } from '../net/roomClient';
import { ROOM_CODE_LENGTH } from '../../shared/room';
import {
  MAX_CHARACTERS_PER_ACCOUNT,
  MAX_NAME_LENGTH,
  type CharacterSave,
  type CharacterSummary,
  type MeResponse,
} from '../../shared/character';


export const PANEL = 'bg-[#0b0d13]/95 border border-[#b89448]/70 shadow-[0_24px_64px_rgba(0,0,0,0.9)]';
export const BTN =
  'px-4 py-2 border font-hud text-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
export const BTN_PRIMARY = `${BTN} border-[#d6b25e] bg-[#2a2110] text-[#ffe7a8] hover:bg-[#3a2d15] hover:border-[#f0cf7b]`;
export const BTN_PLAIN = `${BTN} border-[#3a3428] bg-[#151822] text-[#b9b4a4] hover:text-[#ece6d8] hover:border-[#b89448]`;

export function Shell({ title, subtitle, children, wide }: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="absolute inset-0 z-[45] flex items-center justify-center bg-[#06070a]/72 backdrop-blur-[3px] p-4 overflow-y-auto pointer-events-auto"
    >
      <div className={`${wide ? 'w-[min(960px,96vw)]' : 'w-[min(440px,94vw)]'} my-auto`}>
        <div className="text-center mb-6">
          <div className="font-display text-xs tracking-[0.3em] text-[#9b8a64] mb-1">{subtitle}</div>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-[0.16em] text-[#f3e1b4]">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'character_limit') return `角色已達上限（${MAX_CHARACTERS_PER_ACCOUNT} 個）`;
    if (err.status === 401) return '登入已過期，請重新登入';
    return `伺服器錯誤（${err.code}）`;
  }
  return '無法連線到伺服器';
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

interface GoogleIdApi {
  initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

let gsiPromise: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://accounts.google.com/gsi/client';
      el.async = true;
      el.defer = true;
      el.onload = () => resolve();
      el.onerror = () => {
        gsiPromise = null;
        reject(new Error('gsi load failed'));
      };
      document.head.appendChild(el);
    });
  }
  return gsiPromise;
}

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (me: MeResponse) => void }) {
  const btnRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // undefined = still loading, '' = not configured on the server
  const [clientId, setClientId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((c) => !cancelled && setClientId(c.googleClientId))
      .catch(() => !cancelled && setClientId(''));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !btnRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            setBusy(true);
            setError(null);
            try {
              onLoggedIn(await api.googleLogin(credential));
            } catch (err) {
              setError(err instanceof ApiError && err.status === 401 ? 'Google 登入驗證失敗' : errorText(err));
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: 'filled_black',
          size: 'large',
          text: 'signin_with',
          locale: 'zh-TW',
        });
      })
      .catch(() => !cancelled && setError('無法載入 Google 登入（請檢查網路或廣告攔截）'));
    return () => {
      cancelled = true;
    };
  }, [onLoggedIn, clientId]);

  // Dev only: ?devuser=dev2 preselects the fake account (dev1..dev8), handy for multi-player testing in several windows.
  const [devUser, setDevUser] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('devuser');
    return q && /^dev[1-8]$/.test(q) ? q : 'dev1';
  });

  const devLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await api.devLogin(devUser));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? '開發登入未啟用（需 DEV_AUTH=1 與 API 伺服器）' : errorText(err));
      setBusy(false);
    }
  };

  return (
    <Shell title="燼窖" subtitle="EMBERVAULT">
      <div className={`${PANEL} px-6 py-7 flex flex-col items-center gap-5`}>
        <p className="font-hud text-xs text-[#aeb3c2] text-center leading-relaxed">
          登入後即可建立角色，金幣、遺物與升級會保存在雲端。
        </p>
        {clientId ? (
          <div ref={btnRef} className={busy ? 'opacity-50 pointer-events-none' : ''} />
        ) : clientId === '' ? (
          <p className="font-hud text-xs text-[#ff8a98] text-center">伺服器未設定 GOOGLE_CLIENT_ID，無法使用 Google 登入。</p>
        ) : (
          <p className="font-hud text-xs text-[#aeb3c2] text-center">載入中…</p>
        )}
        {import.meta.env.DEV && (
          <div className="flex items-center gap-2">
            <select
              aria-label="開發帳號"
              value={devUser}
              onChange={(e) => setDevUser(e.target.value)}
              disabled={busy}
              className="px-2 py-2 bg-[#10131c] border border-[#3a3428] text-[#b9b4a4] font-hud text-sm"
            >
              {Array.from({ length: 8 }, (_, i) => `dev${i + 1}`).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <button type="button" onClick={devLogin} disabled={busy} className={BTN_PLAIN}>
              開發登入
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="font-hud text-xs text-[#ff8a98] text-center">
            {error}
          </p>
        )}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Character select / create
// ---------------------------------------------------------------------------

export function CharacterSelectScreen({
  me,
  onPick,
  onLogout,
  onUnauthorized,
}: {
  me: MeResponse;
  onPick: (save: CharacterSave) => void;
  onLogout: () => void;
  onUnauthorized: () => void;
}) {
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newClass, setNewClass] = useState<HeroClassId>('warrior');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(errorText(err));
    },
    [onUnauthorized]
  );

  const reload = useCallback(async () => {
    try {
      setCharacters((await api.listCharacters()).characters);
      setError(null);
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pick = async (id: string) => {
    setBusy(true);
    try {
      onPick(await api.getCharacter(id));
    } catch (err) {
      handleError(err);
      setBusy(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      onPick(await api.createCharacter(name, newClass));
    } catch (err) {
      handleError(err);
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await api.deleteCharacter(id);
      setConfirmDeleteId(null);
      await reload();
    } catch (err) {
      handleError(err);
    }
    setBusy(false);
  };

  const count = characters?.length ?? 0;

  if (creating) {
    return (
      <Shell title="建立角色" subtitle="NEW CHARACTER" wide>
        <div className="flex flex-col items-center gap-4">
          <label className="flex flex-col gap-1 font-hud text-xs text-[#aeb3c2] w-[min(360px,90vw)]">
            角色名稱（最多 {MAX_NAME_LENGTH} 字）
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              autoFocus
              className="select-text px-3 py-2 bg-[#10131c] border border-[#3a3428] text-[#f3e1b4] text-sm outline-none focus:border-[#d6b25e]"
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
            {SELECTABLE_CLASS_IDS.map((id) => {
              const c = HERO_CLASSES[id];
              const selected = newClass === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setNewClass(id)}
                  style={{ ['--cls' as string]: c.accentCss }}
                  className={`flex flex-col items-center gap-3 px-5 py-5 bg-[#0b0d13]/95 border transition-all cursor-pointer ${
                    selected
                      ? 'border-[color:var(--cls)] shadow-[0_0_26px_-4px_var(--cls)]'
                      : 'border-[color:var(--cls)]/35 hover:border-[color:var(--cls)]/80'
                  }`}
                >
                  <div className="p-3 border border-[color:var(--cls)]/40 bg-[#10131c]">
                    <ClassEmblem id={id} color={c.accentCss} accent={c.secondaryCss === '#1b5a5e' ? '#f0c96a' : c.secondaryCss} />
                  </div>
                  <div className="text-center">
                    <div className="font-display text-xl font-bold tracking-[0.12em] text-[color:var(--cls)]">{c.name}</div>
                    <div className="font-display text-[11px] tracking-[0.22em] text-[#8d93a6] uppercase">{c.title}</div>
                  </div>
                  <p className="font-hud text-[12px] leading-relaxed text-[#cfc9ba] self-stretch min-h-[4.875em]">{c.description}</p>
                  <div className="flex items-center justify-center gap-4 font-hud text-xs tabular-nums">
                    <span className="flex items-center gap-1 text-[#ff8a98]">
                      <Heart className="w-3.5 h-3.5 text-[#e63950]" />
                      HP {c.baseHp}
                    </span>
                    <span className={`flex items-center gap-1 ${c.baseShield > 0 ? 'text-[#b6ecff]' : 'text-[#5d6272]'}`}>
                      <Shield className="w-3.5 h-3.5" />
                      護盾 {c.baseShield}
                    </span>
                  </div>
                  <div className="font-hud text-[11px] text-[#8d93a6] border-t border-[#29241b] pt-2 self-stretch text-center">
                    技能：<span className="text-[color:var(--cls)] font-semibold">{c.skillName}</span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    位移：<span className="text-[#d8d4c8]">{c.mobilityName}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="font-hud text-[11px] text-[#8d93a6]">職業建立後無法更改。</p>
          {error && (
            <p role="alert" className="font-hud text-xs text-[#ff8a98]">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" className={BTN_PLAIN} disabled={busy} onClick={() => setCreating(false)}>
              返回
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={busy || newName.trim().length === 0} onClick={create}>
              建立角色
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="選擇角色" subtitle={me.display_name ?? me.email ?? 'CHOOSE YOUR CHARACTER'} wide>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: MAX_CHARACTERS_PER_ACCOUNT }, (_, i) => {
          const ch = characters?.[i];
          if (!ch) {
            const canCreate = characters !== null && !busy;
            return (
              <button
                key={`empty-${i}`}
                type="button"
                disabled={!canCreate}
                onClick={() => {
                  setNewName('');
                  setCreating(true);
                  setError(null);
                }}
                className="flex flex-col items-center justify-center gap-2 min-h-[150px] border border-dashed border-[#3a3428] bg-[#0b0d13]/70 text-[#7d8296] hover:text-[#f3e1b4] hover:border-[#b89448] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="w-6 h-6" />
                <span className="font-hud text-xs">建立角色</span>
              </button>
            );
          }
          const cls = HERO_CLASSES[ch.class_id as HeroClassId];
          const confirming = confirmDeleteId === ch.id;
          return (
            <div
              key={ch.id}
              style={{ ['--cls' as string]: cls?.accentCss ?? '#d4a94e' }}
              className="relative flex flex-col min-h-[150px] border border-[color:var(--cls)]/50 bg-[#0b0d13]/95"
            >
              {confirming ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 p-3 text-center">
                  <p className="font-hud text-xs text-[#ff8a98]">確定刪除「{ch.name}」？此動作無法復原。</p>
                  <div className="flex gap-2">
                    <button type="button" className={`${BTN_PLAIN} !px-3 !py-1 !text-xs`} disabled={busy} onClick={() => setConfirmDeleteId(null)}>
                      取消
                    </button>
                    <button
                      type="button"
                      className={`${BTN} !px-3 !py-1 !text-xs border-[#a8324a] bg-[#2a1018] text-[#ffb3c0] hover:bg-[#3a1620]`}
                      disabled={busy}
                      onClick={() => remove(ch.id)}
                    >
                      確定刪除
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pick(ch.id)}
                    className="flex-1 flex flex-col items-center justify-center gap-1 p-3 hover:bg-[#12151e] transition-colors cursor-pointer disabled:cursor-wait"
                  >
                    <div className="font-display text-lg font-bold tracking-[0.1em] text-[color:var(--cls)] break-all">{ch.name}</div>
                    <div className="font-hud text-[11px] text-[#aeb3c2]">{cls?.name ?? ch.class_id}</div>
                    <div className="font-hud text-[11px] text-[#8d93a6] tabular-nums">
                      最深 {ch.max_depth} 層 · {ch.gold.toLocaleString()} G
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={`刪除 ${ch.name}`}
                    disabled={busy}
                    onClick={() => setConfirmDeleteId(ch.id)}
                    className="absolute top-1.5 right-1.5 p-1 text-[#6a6f80] hover:text-[#ff8a98] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-col items-center gap-3">
        <p className="font-hud text-[11px] text-[#8d93a6]">
          {count} / {MAX_CHARACTERS_PER_ACCOUNT} 個角色
        </p>
        {error && (
          <p role="alert" className="font-hud text-xs text-[#ff8a98]">
            {error}
          </p>
        )}
        <button type="button" className={`${BTN_PLAIN} flex items-center gap-2`} onClick={onLogout}>
          <LogOut className="w-4 h-4" />
          登出
        </button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

/** Start floor slider (1..max depth). Renders nothing for a character that has not been past floor 1. */
export function StartDepthPicker({ maxDepth, value, onChange }: { maxDepth: number; value: number; onChange: (v: number) => void }) {
  if (maxDepth <= 1) return null;
  return (
    <div className="w-full flex flex-col gap-1" data-testid="start-depth-picker">
      <div className="flex items-center justify-between font-hud text-xs text-[#aeb3c2]">
        <label htmlFor="start-depth">起始層數</label>
        <span className="tabular-nums text-[#f3e1b4]" data-testid="start-depth-value">
          第 {value} 層
        </span>
      </div>
      <input
        id="start-depth"
        data-testid="start-depth"
        type="range"
        min={1}
        max={maxDepth}
        step={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.min(maxDepth, Number(e.target.value) || maxDepth)))}
        className="w-full accent-[#d6b25e]"
      />
      <div className="flex items-center justify-between font-hud text-[10px] text-[#6a6f80] tabular-nums">
        <span>1</span>
        <button type="button" className="hover:text-[#f3e1b4] cursor-pointer" onClick={() => onChange(maxDepth)}>
          最深 {maxDepth}
        </button>
      </div>
    </div>
  );
}

export function LobbyScreen({
  save,
  notice,
  onStart,
  onBack,
  onCreateRoom,
  onJoinRoom,
}: {
  save: CharacterSave;
  /** Message carried over from the room screen (host left, connection failed, ...). */
  notice?: string | null;
  onStart: (opts: { startDepth: number; bots: BotSetup }) => void;
  onBack: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
}) {
  const cls = HERO_CLASSES[save.class_id as HeroClassId];
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [startDepth, setStartDepth] = useState(Math.max(1, save.max_depth));
  const [bots, setBots] = useState<BotSetup>(() => loadBotSetup());

  const setBotCount = (n: number) => {
    setBots((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(prev[next.length] ?? prev[prev.length - 1] ?? 'warrior');
      return next;
    });
  };

  const join = () => {
    const normalized = normalizeRoomCode(code);
    if (!isRoomCode(normalized)) {
      setCodeError(roomErrorText('invalid_code'));
      return;
    }
    setCodeError(null);
    onJoinRoom(normalized);
  };

  return (
    <Shell title="大廳" subtitle="LOBBY">
      <div className={`${PANEL} px-6 py-6 flex flex-col items-center gap-4`}>
        <div className="text-center">
          <div className="font-display text-xl font-bold tracking-[0.12em] text-[#f3e1b4]">{save.name}</div>
          <div className="font-hud text-xs text-[#aeb3c2] mt-1">{cls?.name ?? save.class_id}</div>
          <div className="font-hud text-[11px] text-[#8d93a6] mt-1 tabular-nums">
            最深 {save.max_depth} 層 · {save.gold.toLocaleString()} G · 藥水 {save.potions}
          </div>
        </div>
        <div className="font-hud text-xs text-[#6a6f80] cursor-not-allowed select-none" aria-disabled="true">
          難度：即將推出
        </div>
        <StartDepthPicker maxDepth={save.max_depth} value={startDepth} onChange={setStartDepth} />
        <div className="w-full flex flex-col gap-2" data-testid="bot-picker">
          <div className="flex items-center justify-between font-hud text-xs text-[#aeb3c2]">
            <span>單人機器人隊友</span>
            <div className="flex gap-1">
              {Array.from({ length: MAX_BOTS + 1 }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  data-testid={`bot-count-${n}`}
                  aria-pressed={bots.length === n}
                  onClick={() => setBotCount(n)}
                  className={`w-7 h-7 border text-xs tabular-nums cursor-pointer ${
                    bots.length === n
                      ? 'border-[#d6b25e] bg-[#2a2110] text-[#ffe7a8]'
                      : 'border-[#3a3428] bg-[#151822] text-[#b9b4a4] hover:border-[#b89448]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {bots.map((c, i) => (
            <label key={i} className="flex items-center justify-between gap-2 font-hud text-xs text-[#8d93a6]">
              <span>機器人 {i + 1}</span>
              <select
                data-testid={`bot-class-${i}`}
                value={c}
                onChange={(e) => setBots((prev) => prev.map((x, j) => (j === i ? (e.target.value as HeroClassId) : x)))}
                className="flex-1 max-w-[180px] px-2 py-1 bg-[#10131c] border border-[#3a3428] text-[#f3e1b4] text-xs outline-none focus:border-[#d6b25e]"
              >
                {SELECTABLE_CLASS_IDS.map((id) => (
                  <option key={id} value={id}>
                    {HERO_CLASSES[id].name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {bots.length > 0 && (
            <p className="font-hud text-[10px] text-[#6a6f80]">機器人等級同你的升級總數，遺物加成為你的 80%；怪物依隊伍人數增強。</p>
          )}
        </div>
        {notice && (
          <p role="alert" data-testid="lobby-notice" className="font-hud text-xs text-[#ff8a98] text-center">
            {notice}
          </p>
        )}
        <div className="w-full flex flex-col gap-3">
          <button type="button" data-testid="start-solo" className={`${BTN_PRIMARY} w-full`} onClick={() => {
              saveBotSetup(bots);
              onStart({ startDepth, bots });
            }}
          >
            單人開始
            <span className="block font-hud text-[11px] text-[#b9a77a]">
              從第 {startDepth} 層開始{bots.length > 0 ? ` · ${bots.length} 位機器人` : ''} · 不連線
            </span>
          </button>
          <button type="button" data-testid="create-room" className={`${BTN_PLAIN} w-full`} onClick={onCreateRoom}>
            建立房間
          </button>
          <div className="flex gap-2">
            <input
              data-testid="join-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setCodeError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="輸入房號"
              aria-label="房號"
              autoComplete="off"
              spellCheck={false}
              className="select-text flex-1 min-w-0 px-3 py-2 bg-[#10131c] border border-[#3a3428] text-[#f3e1b4] text-sm tracking-[0.3em] text-center uppercase outline-none focus:border-[#d6b25e]"
            />
            <button type="button" data-testid="join-room" className={BTN_PLAIN} onClick={join}>
              加入
            </button>
          </div>
          {codeError && (
            <p role="alert" className="font-hud text-xs text-[#ff8a98] text-center">
              {codeError}
            </p>
          )}
        </div>
        <button type="button" className={BTN_PLAIN} onClick={onBack}>
          返回
        </button>
      </div>
    </Shell>
  );
}
