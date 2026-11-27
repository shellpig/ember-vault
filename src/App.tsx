import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Archive,
  Crosshair,
  Coins,
  DoorOpen,
  Feather,
  FlaskConical,
  Gauge,
  Gem,
  Heart,
  Home,
  KeyRound,
  LogOut,
  Shield,
  Skull,
  Snowflake,
  Sparkles,
  Sword,
  Volume2,
  VolumeX,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { TouchControls, useTouchPrimary } from './components/TouchControls';
import { EmbervaultEngine } from './game/engine';
import { HERO_CLASSES, HeroClassId, UpgradeAccent } from './game/classes';
import {
  SET_RELIC_CATALOG,
  computeRelicSummary,
  formatMaxHpStatForClass,
  formatRelicStat,
  getRarityCss,
  getRarityLabel,
  getUniqueEffectDescForClass,
} from './game/relics';
import {
  BannerEvent,
  FloatingLabelData,
  HudState,
  MinimapSnapshot,
} from './game/types';
import { RelicCompendiumModal, RelicEquipmentModal } from './components/RelicModals';
import { StashModal } from './components/StashModal';
import { TradeModal } from './components/TradeModal';
import { CharacterSelectScreen, LobbyScreen, LoginScreen } from './components/AccountScreens';
import { RoomLobbyScreen, type RoomEntry, type RoomGameStart } from './components/RoomScreens';
import type { RoomClient } from './net/roomClient';
import {
  CLOSE_RATE_LIMITED,
  CLOSE_REPLACED,
  CLOSE_ROOM_CLOSED,
  CLOSE_TOO_BIG,
  HOST_RECONNECT_WINDOW_MS,
  MEMBER_RECONNECT_WINDOW_MS,
  type ServerMessage,
  type TradeDoneMsg,
  type TradeEndReason,
  type TradeSideView,
  type WelcomeMsg,
} from '../shared/room';
import { TRADE_REQUEST_TTL_MS, type TradeErrorCode } from '../shared/trade';
import { ApiError, api, saveToLoadout } from './api';
import { SaveManager, SaveStatus } from './saveManager';
import type { CharacterSave, MeResponse } from '../shared/character';

type Screen = 'boot' | 'login' | 'characters' | 'lobby' | 'room' | 'playing';

/** One line of the in-game chat overlay. */
interface GameChatLine {
  id: number;
  name: string;
  text: string;
  at: number;
}
/** Chat lines stay fully visible this long, then fade out over the next second. */
const CHAT_SHOW_MS = 7000;
const CHAT_FADE_MS = 1200;
let chatLineId = 1;

/** P6: the local state of a trade / trade request. The server (Room DO) is the authority; this only mirrors it. */
interface TradeUi {
  /**
   * requesting: I asked (flushing my save, then waiting for the answer); incoming: I was asked (prompt);
   * preparing: I accepted and flush my save; open: both windows are open; applying: the trade ran, I fetch my new save.
   */
  phase: 'requesting' | 'incoming' | 'preparing' | 'open' | 'applying';
  tradeId: string | null;
  partnerId: string;
  partnerName: string;
  rev: number;
  mine: TradeSideView;
  theirs: TradeSideView;
  notice: { text: string; tone: 'info' | 'error' } | null;
  /** I asked to cancel; waiting for the server's answer (it may still be executing). */
  cancelling?: boolean;
}
const EMPTY_TRADE_SIDE: TradeSideView = { gold: 0, relics: [], confirmed: false };
const TRADE_ERROR_TEXT: Record<TradeErrorCode, string> = {
  invalid_offer: '提供的內容不正確',
  item_missing: '有遺物已不在原本的位置，請重新挑選',
  gold_insufficient: '金幣不足',
  no_space: '有一方的背包與倉庫空間不足，無法收下這些遺物',
  empty_trade: '雙方都還沒放入任何東西',
  offer_changed: '遺物內容在確認前被更動，交易已取消',
  version_conflict: '存檔在交易期間被更動，交易已取消，請重試',
  server_error: '伺服器忙碌，交易未完成，請稍後再試',
};
const TRADE_END_TEXT: Partial<Record<TradeEndReason, string>> = {
  cancelled: '對方取消了交易',
  timeout: '對方沒有回應',
  partner_left: '對方已離開房間，交易取消',
  left_town: '有人離開了城鎮，交易取消',
  unavailable: '現在無法交易（對方不在城鎮或正在交易中）',
  expired: '交易已失效',
};

function HeartIcon({
  state,
  halfContainer = false,
}: {
  state: 'full' | 'half' | 'empty';
  halfContainer?: boolean;
}) {
  return (
    <svg
      width="18"
      height="16"
      viewBox="0 0 18 16"
      className="shrink-0"
      aria-hidden="true"
    >
      <path
        d={
          halfContainer
            ? 'M5 1H2V4H1V7H2V9H4V11H6V13H8V15H9V4H8V3H7V2H5V1Z'
            : 'M5 1H2V4H1V7H2V9H4V11H6V13H8V15H10V13H12V11H14V9H16V7H17V4H16V1H13V2H11V3H10V4H8V3H7V2H5V1Z'
        }
        fill="#1a1c24"
        stroke="#4f4332"
        strokeWidth="1"
      />
      {!halfContainer && state === 'full' && (
        <>
          <path
            d="M5 2H3V4H2V7H3V9H5V11H7V13H9V14H9V13H11V11H13V9H15V7H16V4H15V2H13V3H11V4H9V5H9V4H7V3H5V2Z"
            fill="#d93043"
          />
          <rect x="4" y="4" width="2" height="2" fill="#ff8f9b" />
        </>
      )}
      {(state === 'half' || (halfContainer && state === 'full')) && (
        <>
          <path
            d="M5 2H3V4H2V7H3V9H5V11H7V13H9V4H7V3H5V2Z"
            fill="#d93043"
          />
          <rect x="4" y="4" width="2" height="2" fill="#ff8f9b" />
        </>
      )}
    </svg>
  );
}

const INITIAL_HUD: HudState = {
  hp: 60,
  maxHp: 60,
  baseMaxHp: 70,
  maxHpCap: 310,
  potions: 3,
  hasKey: false,
  doorUnlocked: false,
  depth: 1,
  biomeName: 'Sunken Catacombs',
  gold: 0,
  kills: 0,
  atkBonusPct: 0,
  armorBonusPct: 0,
  armorMaxPct: 50,
  atkSpeedBonusPct: 0,
  atkSpeedMaxPct: 0,
  critBonusPct: 0,
  critMaxPct: 20,
  upgradeLevel: 0,
  upgradeCost: 40,
  potionCost: 10,
  nearAltar: false,
  hasAltarOnFloor: false,
  nearShop: false,
  hasShopOnFloor: false,
  inTown: false,
  nearPortal: false,
  nearChest: false,
  portalOptions: [],
  dungeonRunning: false,
  nearAngel: false,
  townReturnCost: 10,
  angelBuff: null,
  controlMode: 'auto',
  autoAttack: false,
  soundOn: false,
  dashReady: true,
  pommelCooldown: 0,
  pommelMaxCooldown: 8,
  fadeOpacity: 1,
  aiStatus: 'Exploring Chambers',
  boss: null,
  bosses: [],
  arenaCountdown: null,
  isDead: false,
  runSummary: null,
  beingRescued: 0,
  rescuePrompt: null,
  partySize: 1,
  party: [],
  mpWait: null,
  equippedRelics: [],
  relicBag: [],
  relicBagCap: 30,
  nearStash: false,
  stashOpen: false,
  stash: [],
  stashCount: 0,
  stashCap: 200,
  relicStats: computeRelicSummary([]),
  activeSets: [],
  discoveredRelicIds: [],
  heroClass: 'warrior',
  shield: 0,
  maxShield: 0,
  shieldRegenerating: false,
  skillName: '劍柄重擊',
  mobilityName: '衝刺',
  upgradeOptions: [],
  pet: null,
  companions: [],
};

const UPGRADE_ACCENT_STYLES: Record<
  UpgradeAccent,
  { btn: string; text: string; icon: string; Icon: typeof Heart }
> = {
  hp: {
    btn: 'border-[#6e4047] bg-[#1b1216] hover:border-[#e8566c] hover:bg-[#26161d] disabled:hover:border-[#6e4047] disabled:hover:bg-[#1b1216]',
    text: 'text-[#ff8a98]',
    icon: 'text-[#e63950]',
    Icon: Heart,
  },
  atk: {
    btn: 'border-[#755a2e] bg-[#1c1710] hover:border-[#e6b953] hover:bg-[#292114] disabled:hover:border-[#755a2e] disabled:hover:bg-[#1c1710]',
    text: 'text-[#ffd773]',
    icon: 'text-[#f2b84b]',
    Icon: Sword,
  },
  armor: {
    btn: 'border-[#395e7a] bg-[#101821] hover:border-[#6cc4ff] hover:bg-[#152230] disabled:hover:border-[#395e7a] disabled:hover:bg-[#101821]',
    text: 'text-[#8fd4ff]',
    icon: 'text-[#5ebcf5]',
    Icon: Shield,
  },
  atkSpeed: {
    btn: 'border-[#395e7a] bg-[#101821] hover:border-[#6cc4ff] hover:bg-[#152230] disabled:hover:border-[#395e7a] disabled:hover:bg-[#101821]',
    text: 'text-[#8fd4ff]',
    icon: 'text-[#5ebcf5]',
    Icon: Gauge,
  },
  crit: {
    btn: 'border-[#326b46] bg-[#101c15] hover:border-[#5ce88b] hover:bg-[#16291d] disabled:hover:border-[#326b46] disabled:hover:bg-[#101c15]',
    text: 'text-[#8cffb4]',
    icon: 'text-[#5ce88b]',
    Icon: Zap,
  },
  shield: {
    btn: 'border-[#3f7a96] bg-[#0f1b24] hover:border-[#9be3ff] hover:bg-[#14283a] disabled:hover:border-[#3f7a96] disabled:hover:bg-[#0f1b24]',
    text: 'text-[#b6ecff]',
    icon: 'text-[#8fd8ff]',
    Icon: Snowflake,
  },
};

function formatDuration(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<EmbervaultEngine | null>(null);

  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [banner, setBanner] = useState<BannerEvent | null>(null);
  const [floatingLabels, setFloatingLabels] = useState<FloatingLabelData[]>([]);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const touchPrimary = useTouchPrimary();
  const onTouchMove = useCallback((x: number, y: number) => engineRef.current?.setTouchMove(x, y), []);
  const onTouchDash = useCallback(() => engineRef.current?.touchDash(), []);
  const onTouchSkill = useCallback(() => engineRef.current?.triggerPommelStrike(), []);
  const [relicModalOpen, setRelicModalOpen] = useState(false);
  const [hoveredShopRelicId, setHoveredShopRelicId] = useState<string | null>(null);
  const [codexModalOpen, setCodexModalOpen] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('boot');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [activeSave, setActiveSave] = useState<CharacterSave | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [roomEntry, setRoomEntry] = useState<RoomEntry | null>(null);
  const [lobbyNotice, setLobbyNotice] = useState<string | null>(null);
  const saveMgrRef = useRef<SaveManager | null>(null);
  /** The room connection while a room game is running (the engine talks through it). */
  const mpClientRef = useRef<RoomClient | null>(null);
  const mpEndingRef = useRef(false);
  const activeSaveRef = useRef<CharacterSave | null>(null);
  activeSaveRef.current = activeSave;
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef(0);
  /** In-game chat (P5-C): recent lines (fade out), the open input box and its draft. */
  const [gameChat, setGameChat] = useState<GameChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const [chatNow, setChatNow] = useState(() => Date.now());
  /** A room game is running on this screen (chat, member panel). */
  const [inRoomGame, setInRoomGame] = useState(false);
  /** P6 town trade (room games only). The ref mirrors the state so socket handlers never see a stale value. */
  const [trade, setTradeState] = useState<TradeUi | null>(null);
  const tradeRef = useRef<TradeUi | null>(null);
  const tradeMsgRef = useRef<(msg: ServerMessage) => void>(() => undefined);
  const cancelTradeRef = useRef<() => void>(() => undefined);
  const setTrade = useCallback((next: TradeUi | null) => {
    tradeRef.current = next;
    setTradeState(next);
  }, []);
  /**
   * P7 link state of a room game: 'self' = my connection dropped and is being re-established, 'host' = the host's did
   * (members wait for it), 'ok' otherwise. The epoch bumps after every successful re-join so per-connection state
   * (the town flag the Room DO keeps for trades) is sent again.
   */
  const [link, setLinkState] = useState<'ok' | 'self' | 'host'>('ok');
  const [linkEpoch, setLinkEpoch] = useState(0);
  const reconnectingRef = useRef(false);
  const reconnectFlushRef = useRef<Promise<void>>(Promise.resolve());
  const roomGameStartRef = useRef<(info: RoomGameStart) => void>(() => undefined);
  const screenRef = useRef<Screen>('boot');
  screenRef.current = screen;

  const drawMinimap = useCallback((snap: MinimapSnapshot) => {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cell = snap.width > 45 ? 2 : 3;
    const targetW = snap.width * cell;
    const targetH = snap.height * cell;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${targetW}px`;
      canvas.style.height = `${targetH}px`;
    }

    ctx.fillStyle = '#090b10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const wallColor =
      snap.terrainTheme === 'alien'
        ? '#3a5473'
        : snap.terrainTheme === 'flesh'
        ? '#3d1738'
        : snap.terrainTheme === 'cavern'
        ? '#332b24'
        : '#2d313d';
    const pillarColor =
      snap.terrainTheme === 'alien'
        ? '#6d94bd'
        : snap.terrainTheme === 'flesh'
        ? '#5e2454'
        : snap.terrainTheme === 'cavern'
        ? '#52473d'
        : '#474c5c';
    const floorColor =
      snap.terrainTheme === 'alien'
        ? '#8db4db'
        : snap.terrainTheme === 'flesh'
        ? '#874474'
        : snap.terrainTheme === 'cavern'
        ? '#6b6257'
        : '#5c6173';

    for (let z = 0; z < snap.height; z++) {
      for (let x = 0; x < snap.width; x++) {
        if (!snap.explored[z][x]) continue;
        const t = snap.tiles[z][x];
        if (t === 0) continue;
        if (t === 2) {
          ctx.fillStyle = wallColor;
        } else if (t === 5) {
          ctx.fillStyle = pillarColor;
        } else if (t === 3) {
          ctx.fillStyle = snap.doorUnlocked ? '#546848' : '#d6a43e';
        } else if (t === 4) {
          ctx.fillStyle = '#ffdf78';
        } else {
          ctx.fillStyle = floorColor;
        }
        ctx.fillRect(x * cell, z * cell, cell, cell);
      }
    }

    // Nearby enemies in explored area (highlight Floor Bosses & golden Elites)
    for (const e of snap.enemies) {
      if (!snap.explored[e.z]?.[e.x]) continue;
      if (e.isBoss) {
        ctx.fillStyle = '#ff384c';
        ctx.fillRect(e.x * cell - 1, e.z * cell - 1, cell + 2, cell + 2);
        ctx.fillStyle = '#ffe066';
        ctx.fillRect(e.x * cell, e.z * cell, cell, cell);
      } else if (e.isElite) {
        ctx.fillStyle = '#ff9c2a';
        ctx.fillRect(e.x * cell - 1, e.z * cell - 1, cell + 2, cell + 2);
        ctx.fillStyle = '#fff0b3';
        ctx.fillRect(e.x * cell, e.z * cell, cell, cell);
      } else {
        ctx.fillStyle = '#e55353';
        ctx.fillRect(e.x * cell, e.z * cell, cell, cell);
      }
    }

    // Key marker if explored and not collected
    if (!snap.hasKey && snap.explored[snap.keyZ]?.[snap.keyX]) {
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(snap.keyX * cell - 1, snap.keyZ * cell - 1, cell + 2, cell + 2);
    }

    // Upgrade Altar marker on pre-boss floors (4, 9, 14...)
    if (
      snap.altarX !== undefined &&
      snap.altarZ !== undefined &&
      snap.explored[snap.altarZ]?.[snap.altarX]
    ) {
      ctx.fillStyle = '#ffbe3b';
      ctx.fillRect(snap.altarX * cell - 1, snap.altarZ * cell - 1, cell + 2, cell + 2);
      ctx.fillStyle = '#fff5cc';
      ctx.fillRect(snap.altarX * cell, snap.altarZ * cell, cell, cell);
    }

    // Elixir Potion Shop marker on every 3rd floor (Depth 3, 6, 9, 12...)
    if (
      snap.shopX !== undefined &&
      snap.shopZ !== undefined &&
      snap.explored[snap.shopZ]?.[snap.shopX]
    ) {
      ctx.fillStyle = '#ff4772';
      ctx.fillRect(snap.shopX * cell - 1, snap.shopZ * cell - 1, cell + 2, cell + 2);
      ctx.fillStyle = '#ffd6e0';
      ctx.fillRect(snap.shopX * cell, snap.shopZ * cell, cell, cell);
    }

    // Treasure room chests: gold while closed, grey once opened (only where the tile was explored)
    if (snap.chests) {
      for (const c of snap.chests) {
        if (!snap.explored[c.z]?.[c.x]) continue;
        ctx.fillStyle = c.opened ? '#3d424e' : '#8a5a10';
        ctx.fillRect(c.x * cell - 1, c.z * cell - 1, cell + 2, cell + 2);
        ctx.fillStyle = c.opened ? '#9097a6' : '#ffd24a';
        ctx.fillRect(c.x * cell, c.z * cell, cell, cell);
      }
    }

    // Dropped Relic markers on minimap (highlight Orange & Green drops brightly)
    if (snap.relics) {
      for (const rel of snap.relics) {
        if (!snap.explored[rel.z]?.[rel.x]) continue;
        if (rel.rarity === 'orange') {
          ctx.fillStyle = '#ff7b1c';
          ctx.fillRect(rel.x * cell - 1, rel.z * cell - 1, cell + 2, cell + 2);
          ctx.fillStyle = '#ffd9b3';
          ctx.fillRect(rel.x * cell, rel.z * cell, cell, cell);
        } else if (rel.rarity === 'green') {
          ctx.fillStyle = '#38f27c';
          ctx.fillRect(rel.x * cell - 1, rel.z * cell - 1, cell + 2, cell + 2);
          ctx.fillStyle = '#d4ffe4';
          ctx.fillRect(rel.x * cell, rel.z * cell, cell, cell);
        } else if (rel.rarity === 'yellow') {
          ctx.fillStyle = '#ffe066';
          ctx.fillRect(rel.x * cell, rel.z * cell, cell, cell);
        } else {
          ctx.fillStyle = '#5aa9ff';
          ctx.fillRect(rel.x * cell, rel.z * cell, cell, cell);
        }
      }
    }

    // Stairs marker if explored
    if (snap.explored[snap.stairsZ]?.[snap.stairsX]) {
      ctx.fillStyle = '#58f0e8';
      ctx.fillRect(snap.stairsX * cell - 1, snap.stairsZ * cell - 1, cell + 2, cell + 2);
    }

    // Hero blip
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(snap.playerX * cell - 1, snap.playerZ * cell - 1, cell + 2, cell + 2);
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const bannerTimers: number[] = [];
    const labelTimers: number[] = [];

    const engine = new EmbervaultEngine(container, {
      onHudChange: (nextHud) => setHud(nextHud),
      onBanner: (ev) => {
        setBanner(ev);
        const tid = window.setTimeout(() => {
          setBanner((curr) => (curr && curr.id === ev.id ? null : curr));
        }, 2400);
        bannerTimers.push(tid);
      },
      onFloatingLabel: (label) => {
        setFloatingLabels((prev) => [...prev.slice(-18), label]);
        const tid = window.setTimeout(() => {
          setFloatingLabels((prev) => prev.filter((item) => item.id !== label.id));
        }, 950);
        labelTimers.push(tid);
      },
      onMinimapUpdate: (snap) => drawMinimap(snap),
      onWebGLError: (msg) => setWebglError(msg),
      onSaveCheckpoint: () => saveMgrRef.current?.request(),
    });

    engineRef.current = engine;

    return () => {
      bannerTimers.forEach((t) => clearTimeout(t));
      labelTimers.forEach((t) => clearTimeout(t));
      engine.dispose();
      engineRef.current = null;
    };
  }, [drawMinimap]);

  // Dev-only URL parameters (`?devDepth=N`) are unlocked by the Vite dev server or by a backend running with DEV_AUTH=1
  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((c) => {
        if (cancelled || !c.devAuth) return;
        EmbervaultEngine.serverDevAuth = true;
        // The attract-mode run was built before the flag was known: restart it on the requested dev floor
        if (!import.meta.env.DEV && screenRef.current !== 'playing' && EmbervaultEngine.readDevDepth() !== null) {
          engineRef.current?.restartRun('warrior');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Hidden shortcut Ctrl+I opens the Orange & Green Relic Compendium; Esc closes open modals
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && (e.code === 'KeyI' || e.key.toLowerCase() === 'i')) {
        e.preventDefault();
        setCodexModalOpen((prev) => !prev);
        return;
      }
      if (e.code === 'Escape') {
        setRelicModalOpen(false);
        setCodexModalOpen(false);
        engineRef.current?.closeStash();
        const t = tradeRef.current;
        if (t && (t.phase === 'open' || t.phase === 'requesting')) cancelTradeRef.current();
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, []);

  // The stash window replaces the equipment window while it is open.
  useEffect(() => {
    if (hud.stashOpen) setRelicModalOpen(false);
  }, [hud.stashOpen]);

  // --- Account / save flow -------------------------------------------------
  // Restore an existing session on load.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        setScreen('characters');
      })
      .catch(() => !cancelled && setScreen('login'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Menus sit on top of the attract-mode game: keep it from reacting to keys / clicks.
  useEffect(() => {
    engineRef.current?.setInputLocked(screen !== 'playing' || chatOpen);
  }, [screen, chatOpen]);

  // In-game chat (P5-C): Enter opens the box (the hero stops while typing), Enter sends, Esc cancels.
  const chatBlockedRef = useRef(false);
  chatBlockedRef.current = hud.stashOpen || relicModalOpen || codexModalOpen || hud.isDead || trade !== null;
  useEffect(() => {
    if (!inRoomGame || screen !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (chatBlockedRef.current) return;
      e.preventDefault();
      setChatOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inRoomGame, screen]);
  useEffect(() => {
    if (chatOpen) chatInputRef.current?.focus();
  }, [chatOpen]);
  useEffect(() => {
    if (gameChat.length === 0 && !chatOpen) return;
    const t = window.setInterval(() => setChatNow(Date.now()), 400);
    return () => window.clearInterval(t);
  }, [gameChat.length, chatOpen]);
  const sendGameChat = useCallback(() => {
    const text = chatDraft.trim();
    if (text) mpClientRef.current?.sendChat(text);
    setChatDraft('');
    setChatOpen(false);
  }, [chatDraft]);

  // The attract-mode hero may die behind the menus: just start another demo run (never saves: no SaveManager, persistRun=false).
  useEffect(() => {
    if (screen === 'playing' || !hud.isDead) return;
    const t = window.setTimeout(() => engineRef.current?.restartRun('warrior'), 1500);
    return () => window.clearTimeout(t);
  }, [screen, hud.isDead]);

  // Save on leaving the page. sendBeacon can only POST, hence POST /api/characters/:id/save.
  useEffect(() => {
    const onPageHide = () => {
      if (screenRef.current === 'playing') saveMgrRef.current?.beacon();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && screenRef.current === 'playing') void saveMgrRef.current?.resyncVersion();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  const handleLoggedIn = useCallback((m: MeResponse) => {
    setMe(m);
    setScreen('characters');
  }, []);

  const handleUnauthorized = useCallback(() => {
    saveMgrRef.current = null;
    setMe(null);
    setActiveSave(null);
    setScreen('login');
  }, []);

  /** Back to attract mode behind the menus. */
  const resetToAttract = useCallback(() => {
    // A room game ends with the screen: drop the engine's room state and the connection first
    if (mpClientRef.current) {
      engineRef.current?.mpEnd();
      mpClientRef.current.close();
      mpClientRef.current = null;
    }
    setGameChat([]);
    setChatOpen(false);
    setChatDraft('');
    setInRoomGame(false);
    reconnectingRef.current = false;
    setLinkState('ok');
    tradeRef.current = null;
    setTradeState(null);
    engineRef.current?.setTradeLock(false);
    saveMgrRef.current = null;
    setSaveStatus('idle');
    engineRef.current?.restartRun('warrior');
  }, []);

  const startGame = useCallback((opts: { startDepth: number; bots: HeroClassId[] }) => {
    if (!activeSave) return;
    const mgr = new SaveManager(
      activeSave.id,
      activeSave.save_version,
      () => engineRef.current?.exportCharacterState() ?? null,
      setSaveStatus
    );
    saveMgrRef.current = mgr;
    setSaveStatus('idle');
    engineRef.current?.setBotClasses(opts.bots);
    engineRef.current?.restartRun(activeSave.class_id as HeroClassId, saveToLoadout(activeSave), opts.startDepth);
    setScreen('playing');
  }, [activeSave]);

  /** Leave the running game for the character list (saves first, never blocks for long). */
  const leaveGame = useCallback(async () => {
    const mgr = saveMgrRef.current;
    const activeTrade = tradeRef.current;
    if (activeTrade) {
      // Cancel cleanly on the Room DO and skip flushing (beginTrade already flushed before locking;
      // uploading here would race an executing trade in D1).
      mpClientRef.current?.tradeCancel(activeTrade.tradeId ?? undefined);
      mgr?.endTrade();
    } else if (mgr) {
      await Promise.race([mgr.flush(), new Promise<void>((r) => window.setTimeout(r, 4000))]);
    }
    resetToAttract();
    setActiveSave(null);
    setScreen('characters');
  }, [resetToAttract]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  /**
   * The room game is over for this client (the host left / the room closed / the connection dropped): save the own
   * character first (never waiting long), then back to the lobby with a notice.
   */
  const endRoomGame = useCallback(
    async (notice: string) => {
      if (mpEndingRef.current || !mpClientRef.current) return;
      mpEndingRef.current = true;
      const mgr = saveMgrRef.current;
      // The trade (if any) is abandoned: the old version is uploaded below and, if the trade did run, rejected as stale (409)
      if (tradeRef.current) mgr?.endTrade();
      if (mgr) await Promise.race([mgr.flush(), new Promise<void>((r) => window.setTimeout(r, 4000))]);
      const id = activeSaveRef.current?.id;
      resetToAttract();
      let fresh: CharacterSave | null = null;
      if (id) {
        try {
          fresh = await api.getCharacter(id);
        } catch {
          fresh = null;
        }
      }
      if (fresh) {
        setActiveSave(fresh);
        setLobbyNotice(notice);
        setScreen('lobby');
      } else {
        setActiveSave(null);
        setScreen('characters');
      }
      mpEndingRef.current = false;
    },
    [resetToAttract]
  );
  const endRoomGameRef = useRef(endRoomGame);
  endRoomGameRef.current = endRoomGame;

  // --- P6 town trade -------------------------------------------------------------------------------------
  /** Ends the trade locally: unblocks the save manager and the engine; `serverVersion` when the trade executed. */
  const releaseTrade = useCallback(
    (serverVersion?: number) => {
      saveMgrRef.current?.endTrade(serverVersion);
      engineRef.current?.setTradeLock(false);
      setTrade(null);
    },
    [setTrade]
  );

  /** Blocks inventory / gold / stash changes and uploads, after flushing the current save so D1 is the authority. */
  const lockForTrade = useCallback(async (): Promise<boolean> => {
    const engine = engineRef.current;
    const mgr = saveMgrRef.current;
    if (!engine || !mgr) return false;
    setRelicModalOpen(false);
    engine.setTradeLock(true);
    const ok = await mgr.beginTrade();
    if (!ok) engine.setTradeLock(false);
    return ok;
  }, []);

  const startTradeRequest = useCallback(
    async (partnerId: string, partnerName: string) => {
      const client = mpClientRef.current;
      if (!client || tradeRef.current) return;
      setTrade({ phase: 'requesting', tradeId: null, partnerId, partnerName, rev: 0, mine: EMPTY_TRADE_SIDE, theirs: EMPTY_TRADE_SIDE, notice: null });
      const ok = await lockForTrade();
      if (!ok) {
        setTrade(null);
        showToast('無法同步存檔，暫時不能交易');
        return;
      }
      const cur = tradeRef.current as TradeUi | null; // changed while the save was uploading (TS narrowed it to null above)
      if (!cur || cur.phase !== 'requesting' || cur.partnerId !== partnerId || cur.cancelling) {
        releaseTrade(); // cancelled while the save was uploading
        return;
      }
      client.tradeRequest(partnerId);
    },
    [lockForTrade, releaseTrade, setTrade, showToast]
  );

  const acceptTrade = useCallback(async () => {
    const client = mpClientRef.current;
    const cur = tradeRef.current;
    if (!client || !cur || cur.phase !== 'incoming' || !cur.tradeId) return;
    const id = cur.tradeId;
    setTrade({ ...cur, phase: 'preparing' });
    const ok = await lockForTrade();
    if (!ok) {
      client.tradeCancel(id);
      setTrade(null);
      showToast('無法同步存檔，暫時不能交易');
      return;
    }
    if (tradeRef.current?.tradeId !== id) {
      releaseTrade(); // the requester gave up while the save was uploading
      return;
    }
    client.tradeAccept(id);
  }, [lockForTrade, releaseTrade, setTrade, showToast]);

  /** Cancel / decline. Anything the server already knows is only released once the server answers (it may be executing). */
  const cancelTrade = useCallback(() => {
    const cur = tradeRef.current;
    if (!cur || cur.phase === 'applying' || cur.cancelling) return;
    const client = mpClientRef.current;
    if (cur.phase === 'incoming') {
      if (cur.tradeId) client?.tradeCancel(cur.tradeId);
      setTrade(null);
      return;
    }
    if (cur.tradeId) client?.tradeCancel(cur.tradeId);
    setTrade({ ...cur, cancelling: true, notice: { text: '正在取消交易…', tone: 'info' } });
  }, [setTrade]);
  cancelTradeRef.current = cancelTrade;

  /** The trade ran on the server: replace the local gold / bag / stash with the saved version, then unlock. */
  const finishTrade = useCallback(
    async (msg: TradeDoneMsg) => {
      const cur = tradeRef.current;
      const characterId = saveMgrRef.current?.characterId;
      if (!cur || !characterId) return;
      setTrade({ ...cur, phase: 'applying', notice: { text: '交易完成，正在同步存檔…', tone: 'info' } });
      let fresh: CharacterSave | null = null;
      for (let i = 0; i < 4 && !fresh; i++) {
        try {
          const got = await api.getCharacter(characterId);
          if (got.save_version >= msg.saveVersion) fresh = got;
        } catch {
          // retry below
        }
        if (!fresh) await new Promise<void>((r) => window.setTimeout(r, 600));
      }
      if (!fresh) {
        // D1 is right but this client is stale: leave the room so the normal flow reloads the character from the cloud
        releaseTrade();
        void endRoomGameRef.current('交易已完成，但無法同步存檔，請重新進入遊戲');
        return;
      }
      engineRef.current?.applyTradeSave({ gold: fresh.gold, bag: fresh.bag, stash: fresh.stash });
      releaseTrade(fresh.save_version);
      showToast(`交易完成：收到 ${msg.received.length} 件遺物，金幣 ${msg.gold.toLocaleString('en-US')}`);
    },
    [releaseTrade, setTrade, showToast]
  );

  const handleTradeMessage = (msg: ServerMessage) => {
    const cur = tradeRef.current;
    const client = mpClientRef.current;
    switch (msg.type) {
      case 'tradeWait':
        if (cur?.phase === 'requesting' && !cur.tradeId) {
          setTrade({ ...cur, tradeId: msg.tradeId });
          if (cur.cancelling) client?.tradeCancel(msg.tradeId);
        } else {
          client?.tradeCancel(msg.tradeId); // a request I no longer care about
        }
        break;
      case 'tradeRequest':
        if (cur) {
          client?.tradeCancel(msg.tradeId); // already busy
        } else {
          setTrade({ phase: 'incoming', tradeId: msg.tradeId, partnerId: msg.from, partnerName: msg.name, rev: 0, mine: EMPTY_TRADE_SIDE, theirs: EMPTY_TRADE_SIDE, notice: null });
        }
        break;
      case 'tradeOpen':
        if (cur && cur.tradeId === msg.tradeId && (cur.phase === 'requesting' || cur.phase === 'preparing')) {
          setTrade({ ...cur, phase: 'open', partnerId: msg.partner, partnerName: msg.partnerName, notice: cur.cancelling ? cur.notice : null });
        }
        break;
      case 'tradeUpdate':
        if (cur && cur.tradeId === msg.tradeId && cur.phase === 'open') {
          setTrade({ ...cur, rev: msg.rev, mine: msg.mine, theirs: msg.theirs, notice: cur.cancelling ? cur.notice : null });
        }
        break;
      case 'tradeError':
        if (cur && cur.tradeId === msg.tradeId && cur.phase === 'open') {
          setTrade({ ...cur, notice: { text: TRADE_ERROR_TEXT[msg.code], tone: 'error' } });
        }
        break;
      case 'tradeEnd': {
        const isMine = cur && (msg.tradeId === '' ? cur.phase === 'requesting' && !cur.tradeId : cur.tradeId === msg.tradeId);
        if (!cur || !isMine || cur.phase === 'applying') break;
        if (msg.reason === 'failed') showToast(TRADE_ERROR_TEXT[msg.code ?? 'server_error']);
        else if (msg.reason !== 'self' && !cur.cancelling) showToast(TRADE_END_TEXT[msg.reason] ?? '交易已結束');
        releaseTrade();
        break;
      }
      case 'tradeDone':
        if (cur && cur.tradeId === msg.tradeId) void finishTrade(msg);
        break;
      default:
        break;
    }
  };
  tradeMsgRef.current = handleTradeMessage;

  // An unanswered request / prompt expires on its own (the server also drops it lazily)
  useEffect(() => {
    if (!trade || (trade.phase !== 'requesting' && trade.phase !== 'incoming')) return;
    const t = window.setTimeout(() => {
      if (tradeRef.current?.phase === 'requesting') showToast('對方沒有回應，交易請求已取消');
      cancelTradeRef.current();
    }, TRADE_REQUEST_TTL_MS);
    return () => window.clearTimeout(t);
  }, [trade?.phase, trade?.tradeId, showToast]);

  // Tell the Room DO whether this hero is in town (trades need both sides there); leaving town ends a trade
  useEffect(() => {
    if (inRoomGame && screen === 'playing') mpClientRef.current?.sendTownState(hud.inTown);
  }, [inRoomGame, screen, hud.inTown, linkEpoch]);
  useEffect(() => {
    if (!hud.inTown && tradeRef.current) cancelTradeRef.current();
  }, [hud.inTown]);

  // --- P7 reconnect ------------------------------------------------------------------------------------------
  /**
   * The room socket dropped unexpectedly (not a leave, not roomClosed / replaced / a rate-limit close). Freeze the game, show
   * the overlay and re-join with backoff. A member comes back as a mid-game joiner (see the `welcome` handler below); the
   * host takes its room back in place when it is quick enough (server grace window + resume token).
   */
  const beginReconnect = useCallback(
    async (client: RoomClient, isHost: boolean) => {
      if (reconnectingRef.current || mpClientRef.current !== client || mpEndingRef.current) return;
      reconnectingRef.current = true;
      setLinkState('self');
      engineRef.current?.mpSetPaused(true);
      // An open trade is cancelled by the server when the socket dropped; drop the local lock too
      if (tradeRef.current) releaseTrade();
      // A member re-joins with a fresh copy of its character: get what is local into the cloud first (never waiting long)
      const mgr = saveMgrRef.current;
      reconnectFlushRef.current =
        !isHost && mgr
          ? Promise.race([mgr.flush(), new Promise<void>((r) => window.setTimeout(r, 4000))])
          : Promise.resolve();
      const ok = await client.reconnect(isHost ? HOST_RECONNECT_WINDOW_MS : MEMBER_RECONNECT_WINDOW_MS);
      if (!ok && mpClientRef.current === client && reconnectingRef.current) {
        reconnectingRef.current = false;
        await endRoomGameRef.current('與房間的連線已中斷，無法重新連線');
      }
    },
    [releaseTrade]
  );
  const beginReconnectRef = useRef(beginReconnect);
  beginReconnectRef.current = beginReconnect;

  /** The server answered the re-join (`welcome`). */
  const onReconnectWelcome = useCallback(async (client: RoomClient, msg: WelcomeMsg) => {
    if (!reconnectingRef.current || mpClientRef.current !== client) return;
    const fail = async (notice: string) => {
      reconnectingRef.current = false;
      await endRoomGameRef.current(notice);
    };
    if (msg.isHost) {
      if (!msg.resumed) {
        await fail('與房間的連線已中斷，無法恢復房主身分');
        return;
      }
      engineRef.current?.mpHostResume(msg.members);
      reconnectingRef.current = false;
      setLinkState('ok');
      setLinkEpoch((n) => n + 1);
      return;
    }
    const host = msg.members.find((m) => m.isHost);
    const id = saveMgrRef.current?.characterId ?? activeSaveRef.current?.id;
    if (!msg.started || !host || !id) {
      await fail('與房間的連線已中斷，無法重新加入');
      return;
    }
    await reconnectFlushRef.current;
    let fresh: CharacterSave | null = null;
    try {
      fresh = await api.getCharacter(id);
    } catch {
      fresh = null;
    }
    if (mpEndingRef.current || mpClientRef.current !== client || !reconnectingRef.current) return;
    if (!fresh) {
      await fail('與房間的連線已中斷，無法同步存檔');
      return;
    }
    // The cloud copy is the truth (loot picked up since the last save is lost, spec 8.3); the join below makes a new SaveManager from it
    activeSaveRef.current = fresh;
    setActiveSave(fresh);
    reconnectingRef.current = false;
    setLinkState('ok');
    roomGameStartRef.current({ client, selfId: msg.playerId, hostId: host.playerId, isHost: false, members: msg.members, late: true });
    setLinkEpoch((n) => n + 1);
  }, []);

  /** The host pressed start: the room connection now carries the game (P5-B). */
  const handleRoomGameStart = useCallback(
    (info: RoomGameStart) => {
      const save = activeSaveRef.current;
      const engine = engineRef.current;
      if (!save || !engine) {
        info.client.close();
        return;
      }
      mpClientRef.current = info.client;
      mpEndingRef.current = false;
      setInRoomGame(true);
      setGameChat([]);
      saveMgrRef.current = new SaveManager(
        save.id,
        save.save_version,
        () => engineRef.current?.exportCharacterState() ?? null,
        setSaveStatus
      );
      setSaveStatus('idle');
      info.client.setHandlers({
        onLatency: () => undefined,
        onClose: ({ code, wasRequested }) => {
          if (wasRequested || mpEndingRef.current) return;
          if (code === CLOSE_ROOM_CLOSED || code === CLOSE_REPLACED || code === CLOSE_RATE_LIMITED || code === CLOSE_TOO_BIG) {
            void endRoomGameRef.current('與房間的連線已中斷');
            return;
          }
          void beginReconnectRef.current(info.client, info.isHost);
        },
        onMessage: (msg: ServerMessage) => {
          switch (msg.type) {
            case 'relay':
              engineRef.current?.mpOnRelay(msg.from, msg.kind, msg.payload);
              break;
            case 'townPos':
              engineRef.current?.mpOnTownPos(msg.from, msg);
              break;
            case 'chat':
              setGameChat((prev) => [...prev.slice(-19), { id: chatLineId++, name: msg.name, text: msg.text, at: Date.now() }]);
              break;
            case 'memberJoined':
              engineRef.current?.mpOnMemberJoined(msg.member);
              break;
            case 'memberLeft':
              engineRef.current?.mpOnMemberLeft(msg.playerId);
              break;
            case 'welcome':
              void onReconnectWelcome(info.client, msg);
              break;
            case 'hostState':
              // The host's link dropped (members wait for it inside the server's grace window) or is back
              if (!reconnectingRef.current) {
                setLinkState(msg.state === 'reconnecting' ? 'host' : 'ok');
                engineRef.current?.mpSetPaused(msg.state === 'reconnecting');
              }
              break;
            case 'roomClosed':
              void endRoomGameRef.current(msg.reason === 'host_left' ? '房主已離開，房間已關閉' : '房間已因閒置而關閉');
              break;
            case 'replaced':
              void endRoomGameRef.current('你已在另一個分頁加入這個房間，這個連線已中斷');
              break;
            case 'tradeWait':
            case 'tradeRequest':
            case 'tradeOpen':
            case 'tradeUpdate':
            case 'tradeError':
            case 'tradeEnd':
            case 'tradeDone':
              tradeMsgRef.current(msg);
              break;
            default:
              break;
          }
        },
      });
      engine.mpStart(
        {
          role: info.isHost ? 'host' : 'guest',
          selfId: info.selfId,
          hostId: info.hostId,
          members: info.members,
          send: (kind, payload, to) => info.client.sendRelay(kind, payload, to),
          onNotice: showToast,
          sendTownPos: (p) => info.client.sendTownPos(p),
          late: info.late,
          startDepth: info.isHost ? info.startDepth : undefined,
        },
        save.class_id as HeroClassId,
        saveToLoadout(save)
      );
      setRoomEntry(null);
      setScreen('playing');
    },
    [showToast, onReconnectWelcome]
  );
  roomGameStartRef.current = handleRoomGameStart;

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // cookie may already be gone; continue
    }
    setMe(null);
    setActiveSave(null);
    setScreen('login');
  }, []);

  /** After a 409: drop local progress and continue from the cloud copy. */
  const reloadFromCloud = useCallback(async () => {
    const mgr = saveMgrRef.current;
    if (!mgr) return;
    try {
      const fresh = await api.getCharacter(mgr.characterId);
      const next = new SaveManager(
        fresh.id,
        fresh.save_version,
        () => engineRef.current?.exportCharacterState() ?? null,
        setSaveStatus
      );
      saveMgrRef.current = next;
      setActiveSave(fresh);
      setSaveStatus('idle');
      engineRef.current?.restartRun(fresh.class_id as HeroClassId, saveToLoadout(fresh));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) handleUnauthorized();
      else if (err instanceof ApiError && err.status === 404) {
        resetToAttract();
        setActiveSave(null);
        setScreen('characters');
      }
    }
  }, [handleUnauthorized, resetToAttract]);

  const hpPct = Math.max(0, Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100));
  const shopCommonTotal = hud.relicBag
    .filter((r) => r.rarity === 'blue' || r.rarity === 'yellow')
    .reduce((sum, r) => sum + r.sellValue, 0);

  const labelToneClass = (tone: FloatingLabelData['tone']): string => {
    switch (tone) {
      case 'crit':
        return 'text-[#ffe170] text-sm font-bold tracking-wide';
      case 'playerHit':
        return 'text-[#ff5964] text-sm font-bold';
      case 'heal':
        return 'text-[#5af2a3] text-xs font-bold';
      case 'gold':
        return 'text-[#f7cb52] text-xs font-bold';
      case 'key':
        return 'text-[#ffe066] text-sm font-bold tracking-widest';
      case 'info':
        return 'text-[#70f5ee] text-xs font-bold';
      case 'block':
        return 'text-[#7ae8ff] text-sm font-bold tracking-wider';
      case 'relicBlue':
        return 'text-[#6ab8ff] text-xs font-bold';
      case 'relicYellow':
        return 'text-[#ffe066] text-xs font-bold';
      case 'relicOrange':
        return 'text-[#ff9442] text-sm font-bold tracking-wide';
      case 'relicGreen':
        return 'text-[#52f295] text-sm font-bold tracking-wide';
      case 'shieldHit':
        return 'text-[#8fd8ff] text-sm font-bold tracking-wide';
      case 'frost':
        return 'text-[#d9f6ff] text-xs font-extrabold tracking-wider [text-shadow:0_0_6px_rgba(120,220,255,0.9)]';
      case 'stun':
        return 'text-[#ffe45e] text-xs font-extrabold tracking-wide';
      default:
        return 'text-[#f5f3ec] text-xs font-bold';
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#090a0f]">
      {/* Isolated WebGL Canvas Host */}
      <div
        ref={mountRef}
        className={`absolute inset-0 w-full h-full transition-[filter] duration-500 ${
          hud.isDead
            ? 'grayscale contrast-[1.08] brightness-[0.65] cursor-default'
            : 'cursor-crosshair'
        }`}
        aria-label="Embervault 3D Dungeon Viewport"
      />

      {/* Miniature Diorama Framing Vignette */}
      <div className="pointer-events-none absolute inset-0 diorama-vignette z-10" />
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-20 tilt-blur-top z-10" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 tilt-blur-bottom z-10" />

      {/* Floor Transition Fade Curtain */}
      {hud.fadeOpacity > 0.01 && (
        <div
          className="pointer-events-none absolute inset-0 bg-[#07080d] z-40 transition-opacity duration-75"
          style={{ opacity: hud.fadeOpacity }}
        />
      )}

      {/* Room game: what the black screen is waiting for (P5-C: never a bare black screen) */}
      {hud.mpWait && hud.fadeOpacity > 0.6 && (
        <div className="pointer-events-none absolute inset-0 z-[41] flex items-center justify-center">
          <div data-testid="mp-wait" className="font-display text-lg tracking-[0.2em] text-[#e7cf93] animate-pulse">
            {hud.mpWait}
          </div>
        </div>
      )}

      {/* P7: the room link is down (mine or the host's) */}
      {inRoomGame && screen === 'playing' && link !== 'ok' && (
        <div className="pointer-events-none absolute top-16 left-0 right-0 z-[45] flex justify-center">
          <div
            data-testid="mp-reconnecting"
            className="font-display text-sm tracking-[0.2em] text-[#ffe7a8] bg-[#07080d]/85 border border-[#8f7440] px-5 py-2 animate-pulse"
          >
            {link === 'self' ? '重新連線中…' : '房主重新連線中…'}
          </div>
        </div>
      )}

      {/* WebGL Unavailable Fallback */}
      {webglError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#090a0f] p-6">
          <div className="max-w-md border border-[#8f7440] bg-[#11131b] p-6 text-center">
            <h1 className="font-display text-lg text-[#e7cf93] tracking-wider mb-2">
              Embervault
            </h1>
            <p className="text-xs text-[#b8b3a6] leading-relaxed">{webglError}</p>
          </div>
        </div>
      )}

      {/* Floating World Combat / Loot Numbers */}
      {!hud.isDead && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          {floatingLabels.map((lbl) => (
            <span
              key={lbl.id}
              style={{ left: `${lbl.x}px`, top: `${lbl.y}px` }}
              className={`floating-dmg font-hud absolute whitespace-nowrap drop-shadow-[0_2px_2px_rgba(0,0,0,0.95)] ${labelToneClass(lbl.tone)}`}
            >
              {lbl.text}
            </span>
          ))}
        </div>
      )}

      {/* Top-Left Level, Vitality, Elixir & Key Panel */}
      <div className="absolute top-4 left-4 z-30 pointer-events-auto">
        <div className="bg-[#0c0e14]/90 border border-[#8f7440]/75 px-3.5 py-2.5 shadow-[0_6px_20px_rgba(0,0,0,0.65)] min-w-[238px]">
          <div className="flex items-baseline justify-between gap-3 border-b border-[#3a3328] pb-1.5 mb-2">
            <span className="font-display text-xs font-bold tracking-[0.14em] text-[#efd89c] tabular-nums whitespace-nowrap">
              LV {1 + hud.upgradeLevel}
            </span>
          </div>

          <div
            className="flex items-center gap-2 mb-2.5"
            aria-label={`Level ${1 + hud.upgradeLevel}, Health ${hud.hp} of ${hud.maxHp}`}
          >
            <HeartIcon state={hud.hp > 0 ? 'full' : 'empty'} />
            <div className="flex-1 h-2.5 bg-[#1a161c] border border-[#5a4530] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#a81c30] via-[#d93043] to-[#f05868] transition-all duration-150"
                style={{ width: `${hpPct}%` }}
              />
            </div>
            {/* Fixed-width value column so the HP and shield bars stay the same length */}
            <span className="min-w-[62px] shrink-0 text-right font-hud text-[11px] font-semibold text-[#f2e8d4] tabular-nums whitespace-nowrap">
              {hud.hp} / {hud.maxHp}
            </span>
          </div>

          {hud.maxShield > 0 && (
            <div
              className="flex items-center gap-2 mb-2.5 -mt-1"
              aria-label={`Shield ${hud.shield} of ${hud.maxShield}`}
            >
              <Shield className="w-[18px] h-4 shrink-0 text-[#8fd8ff]" />
              <div className="relative flex-1 h-2.5 bg-[#10171e] border border-[#3f7a96] overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r from-[#3f9cc8] via-[#8fd8ff] to-[#d9f6ff] transition-all duration-150 ${
                    hud.shieldRegenerating ? 'animate-pulse' : ''
                  }`}
                  style={{
                    width: `${Math.max(0, Math.min(100, (hud.shield / Math.max(1, hud.maxShield)) * 100))}%`,
                  }}
                />
                {hud.shieldRegenerating && (
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-pulse" />
                )}
              </div>
              <span className="min-w-[62px] shrink-0 text-right font-hud text-[11px] font-semibold text-[#b6ecff] tabular-nums whitespace-nowrap">
                {Math.ceil(hud.shield)} / {hud.maxShield}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2.5 text-xs font-hud">
            <button
              type="button"
              onClick={() => engineRef.current?.triggerManualPotion()}
              disabled={hud.potions <= 0 || hud.hp >= hud.maxHp}
              title="Drink Healing Elixir (E)"
              className="flex items-center gap-1.5 px-2 py-1 border border-[#4a3e2a] bg-[#161822] text-[#f0e6d2] hover:border-[#c8a355] disabled:opacity-45 disabled:hover:border-[#4a3e2a] transition-colors cursor-pointer whitespace-nowrap"
            >
              <FlaskConical className="w-3.5 h-3.5 text-[#f04760]" />
              <span>{hud.potions}</span>
            </button>

            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 border transition-colors whitespace-nowrap ${
                hud.hasKey
                  ? 'border-[#e0b857] bg-[#2a2110] text-[#ffe184] shadow-[0_0_12px_rgba(224,184,87,0.3)]'
                  : 'border-[#2c2f3b] bg-[#11131b] text-[#666b7a]'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span className="tracking-wider font-semibold">
                {hud.doorUnlocked ? 'OPEN' : 'KEY'}
              </span>
            </div>

            {hud.atkBonusPct > 0 && (
              <div
                title={`Attack Power +${hud.atkBonusPct}%`}
                className="flex items-center gap-1 px-2 py-1 border border-[#7d6234] bg-[#1d1810] text-[#f5d37d] whitespace-nowrap"
              >
                <Sword className="w-3.5 h-3.5 text-[#f2b84b]" />
                <span>+{hud.atkBonusPct}%</span>
              </div>
            )}

            {hud.armorBonusPct > 0 && (
              <div
                title={`Armor Defense ${hud.armorBonusPct}% / ${hud.armorMaxPct}%`}
                className="flex items-center gap-1 px-2 py-1 border border-[#3a6380] bg-[#101820] text-[#8fd4ff] whitespace-nowrap"
              >
                <Shield className="w-3.5 h-3.5 text-[#64bdf5]" />
                <span>+{hud.armorBonusPct}%</span>
              </div>
            )}

            {hud.atkSpeedBonusPct > 0 && (
              <div
                title={`攻速 +${hud.atkSpeedBonusPct}% / +${hud.atkSpeedMaxPct}%`}
                className="flex items-center gap-1 px-2 py-1 border border-[#3a6380] bg-[#101820] text-[#8fd4ff] whitespace-nowrap"
              >
                <Gauge className="w-3.5 h-3.5 text-[#64bdf5]" />
                <span>+{hud.atkSpeedBonusPct}%</span>
              </div>
            )}

            {hud.critBonusPct > 0 && (
              <div
                title={`Crit Rate Bonus +${hud.critBonusPct}% / +${hud.critMaxPct}%`}
                className="flex items-center gap-1 px-2 py-1 border border-[#3c7350] bg-[#101c15] text-[#8cffb4] whitespace-nowrap"
              >
                <Zap className="w-3.5 h-3.5 text-[#5ce88b]" />
                <span>+{hud.critBonusPct}%</span>
              </div>
            )}
          </div>

          {hud.angelBuff && (() => {
            const css = getRarityCss(hud.angelBuff.rarity);
            return (
              <div
                className={`mt-2 pt-2 border-t border-[#3a3328] font-hud text-[11px]`}
                title={hud.angelBuff.flavor}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`flex items-center gap-1 font-bold truncate ${css.text}`}>
                    <Feather className="w-3 h-3 shrink-0" />
                    <span className="truncate">{hud.angelBuff.name}</span>
                  </span>
                  <span className="text-[10px] text-[#d9caa3] tabular-nums whitespace-nowrap shrink-0">
                    剩 {hud.angelBuff.floorsLeft} 層
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[#d6d9e6]">
                  {hud.angelBuff.stats.map((st, idx) => (
                    <span key={`${st.key}-${idx}`} className="whitespace-nowrap">
                      {formatRelicStat(st)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Hunter pet: compact row (same style as the teammate rows below), keeps the animal icon */}
        {!hud.inTown && hud.pet && (
          <div
            className="relative mt-1.5 w-1/2 min-w-[190px] bg-[#0c0e14]/85 border border-[#b85b3a]/70 px-1.5 py-1 font-hud text-[10px] leading-none shadow-[0_3px_10px_rgba(0,0,0,0.55)]"
            aria-label={`Pet ${hud.pet.name}, HP ${hud.pet.hp} of ${hud.pet.maxHp}`}
            title={`${hud.pet.name} · ${hud.pet.hp} / ${hud.pet.maxHp} HP${
              hud.pet.buffRemaining > 0 ? ` · 狂野激勵 +20% ${hud.pet.buffRemaining.toFixed(1)}s` : ''
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] leading-none shrink-0" aria-hidden="true">
                {hud.pet.species === 'bear' ? '🐻' : hud.pet.species === 'chocobo' ? '🐥' : '🐺'}
              </span>
              <span className="max-w-[72px] truncate font-semibold text-[#ffd6a5]">{hud.pet.name}</span>
              <div className="flex-1 min-w-[40px] h-1.5 bg-[#1a161c] border border-[#6b4432] overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r from-[#2e9e5b] via-[#4cd97b] to-[#8ff5ad] transition-all duration-150 ${
                    hud.pet.regenerating ? 'animate-pulse' : ''
                  }`}
                  style={{
                    width: `${Math.max(0, Math.min(100, (hud.pet.hp / Math.max(1, hud.pet.maxHp)) * 100))}%`,
                  }}
                />
              </div>
            </div>
            {/* Buff timer sits outside the row (to its right) so the HP bar keeps its length */}
            {hud.pet.buffRemaining > 0 && (
              <span className="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 flex items-center gap-0.5 px-1 py-0.5 bg-[#2d1a0b]/90 border border-[#ff9f43]/70 text-[#ffd166] tabular-nums whitespace-nowrap">
                <Zap className="w-2.5 h-2.5 text-[#ff9f43]" />
                {hud.pet.buffRemaining.toFixed(1)}s
              </span>
            )}
          </div>
        )}

        {/* Teammate rows: single-player bots or the other players of a room (compact: half the player panel's width) */}
        {hud.companions.length > 0 && (
          <div className="mt-1.5 w-1/2 min-w-[190px] flex flex-col gap-1">
            {hud.companions.map((c) => {
              const hpPct = Math.max(0, Math.min(100, (c.hp / Math.max(1, c.maxHp)) * 100));
              const shPct = c.maxShield > 0 ? Math.max(0, Math.min(100, (c.shield / c.maxShield) * 100)) : 0;
              return (
                <div
                  key={c.id}
                  className={`bg-[#0c0e14]/85 border border-[#3a3328] px-1.5 py-1 font-hud text-[10px] leading-none shadow-[0_3px_10px_rgba(0,0,0,0.55)] ${
                    c.isDead ? 'opacity-70' : ''
                  }`}
                  aria-label={`${c.name}, Level ${c.level}, HP ${c.hp} of ${c.maxHp}`}
                  title={`${c.name} · LV ${c.level} · ${c.hp} / ${c.maxHp} HP${c.maxShield > 0 ? ` · 護盾 ${c.shield} / ${c.maxShield}` : ''}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-1.5 h-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: HERO_CLASSES[c.classId].accentCss }}
                      aria-hidden="true"
                    />
                    <span className="shrink-0 text-[#efd89c] tabular-nums">LV{c.level}</span>
                    <span className="max-w-[72px] truncate font-semibold text-[#e7e2d6]">{c.name}</span>
                    <div className="flex-1 min-w-[40px] flex flex-col gap-[2px]">
                      <div className="h-1.5 bg-[#1a161c] border border-[#4a3a30] overflow-hidden">
                        <div
                          className={`h-full transition-all duration-150 ${
                            c.isDead ? 'bg-[#5a5560]' : 'bg-gradient-to-r from-[#b8283b] to-[#f0566a]'
                          }`}
                          style={{ width: `${c.isDead ? 0 : hpPct}%` }}
                        />
                      </div>
                      {c.maxShield > 0 && (
                        <div className="h-1 bg-[#10161d] overflow-hidden">
                          <div className="h-full bg-[#8fd8ff] transition-all duration-150" style={{ width: `${shPct}%` }} />
                        </div>
                      )}
                    </div>
                    {(c.isDead || c.inTown) && (
                      <span className={`shrink-0 ${c.isDead ? 'text-[#ff8a98]' : 'text-[#8fd4ff]'}`}>
                        {c.isDead ? '倒地' : '城鎮'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top-Center Boss Health Bar(s) — supports 1 boss or 2 side-by-side on Depth 40 dual-boss */}
      {!hud.isDead && hud.bosses.length > 0 && (
        <div
          className={`pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-30 flex gap-2.5 ${
            hud.bosses.length > 1 ? 'w-[min(680px,82vw)]' : 'w-[min(360px,54vw)]'
          }`}
        >
          {hud.bosses.map((b, idx) => (
            <div
              key={`${b.name}-${idx}`}
              className="flex-1 min-w-0 bg-[#0c0e14]/92 border border-[#b87c40]/85 px-3.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.75)]"
            >
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-display text-xs md:text-sm font-bold tracking-[0.12em] text-[#f5d58c] truncate">
                    {b.name}
                  </span>
                  {hud.bosses.length === 1 && (
                    <span className="hidden sm:inline font-hud text-[10px] text-[#9fa4b5] truncate">
                      {b.title}
                    </span>
                  )}
                </div>
                {b.state === 'windup' ? (
                  <span className="font-hud text-[10px] font-bold tracking-wider text-[#ff6b57] whitespace-nowrap">
                    DODGE!
                  </span>
                ) : b.state === 'recover' ? (
                  <span className="font-hud text-[10px] font-bold tracking-wider text-[#62f5b4] whitespace-nowrap">
                    COUNTER!
                  </span>
                ) : (
                  <span className="font-hud text-[10px] text-[#c7b68d] whitespace-nowrap tabular-nums">
                    {b.hp} / {b.maxHp}
                  </span>
                )}
              </div>
              <div className="w-full h-2 bg-[#1a161c] border border-[#4a3629] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#9e1b2d] via-[#d93043] to-[#f2784b] transition-all duration-150"
                  style={{
                    width: `${Math.max(0, Math.min(100, (b.hp / Math.max(1, b.maxHp)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top-Center Boss Test Arena 5s Wave Countdown */}
      {!hud.isDead && hud.arenaCountdown && (
        <div className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 z-30">
          <div className="bg-[#0c0e14]/95 border border-[#ff725c] px-6 py-2.5 text-center shadow-[0_8px_28px_rgba(0,0,0,0.85)]">
            <div className="font-display text-xs md:text-sm font-bold tracking-[0.16em] text-[#ffd89c] whitespace-nowrap">
              BOSS 測試戰 · 第 {hud.arenaCountdown.wave} 波（{hud.arenaCountdown.waveDepth}F）
            </div>
            <div className="font-hud text-[11px] text-[#c8ccd8] mt-0.5 whitespace-nowrap">
              {hud.arenaCountdown.label}
            </div>
            <div className="font-display text-2xl font-bold text-[#ff7c66] mt-1 tabular-nums">
              {hud.arenaCountdown.sec}
            </div>
          </div>
        </div>
      )}

      {/* Rescue prompt: standing next to a downed teammate (hold F for 3 seconds) */}
      {screen === 'playing' && !hud.isDead && hud.rescuePrompt && (
        <div
          data-testid="rescue-prompt"
          className="pointer-events-none absolute bottom-28 left-1/2 z-30 -translate-x-1/2 border border-[#7dffb0]/70 bg-[#0c0e14]/92 px-4 py-2 text-center font-hud text-xs text-[#d9ffe8] shadow-[0_8px_28px_rgba(0,0,0,0.75)]"
        >
          按住 <span className="font-bold text-[#7dffb0]">F</span> 救援 {hud.rescuePrompt.name}
          {hud.rescuePrompt.progress > 0 && (
            <span className="ml-2 tabular-nums text-[#7dffb0]">
              {Math.round(hud.rescuePrompt.progress * 100)}%
            </span>
          )}
        </div>
      )}

      {/* Top-Center Event Notification Banner */}
      {!hud.isDead && banner && (
        <div
          key={banner.id}
          className={`event-banner pointer-events-none absolute left-1/2 z-30 ${
            hud.boss ? 'top-[76px]' : 'top-5'
          }`}
        >
          <div className="bg-[#0c0e14]/95 border border-[#b89448] px-6 py-2 text-center shadow-[0_8px_28px_rgba(0,0,0,0.75)]">
            <div className="font-display text-sm md:text-base font-bold tracking-[0.18em] text-[#f3dca0] whitespace-nowrap">
              {banner.title}
            </div>
            {banner.subtitle && (
              <div className="font-hud text-[11px] text-[#9fa4b5] mt-0.5 whitespace-nowrap">
                {banner.subtitle}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top-Right Depth, Spoils & Live Minimap */}
      <div className="absolute top-4 right-4 z-30 flex flex-col items-end gap-2 pointer-events-none">
        <div className="bg-[#0c0e14]/90 border border-[#8f7440]/75 px-3.5 py-2.5 min-w-[162px] shadow-[0_6px_20px_rgba(0,0,0,0.65)]">
          <div className="flex items-baseline justify-between gap-4 border-b border-[#3a3328] pb-1.5 mb-2">
            <span className="font-display text-xs font-bold tracking-[0.15em] text-[#efd89c]">
              {hud.inTown ? `TOWN · D${hud.depth}` : `DEPTH ${hud.depth}`}
            </span>
            <span className="font-hud text-[10px] text-[#8d93a6] truncate max-w-[115px]">
              {hud.biomeName}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4 font-hud text-xs text-[#ece5d5]">
            <div className="flex items-center gap-1.5" title="Gold Collected">
              <Coins className="w-3.5 h-3.5 text-[#f2c14e]" />
              <span>{hud.gold}</span>
            </div>
            <div className="flex items-center gap-1.5" title="Enemies Slain">
              <Skull className="w-3.5 h-3.5 text-[#c9cedb]" />
              <span>{hud.kills}</span>
            </div>
          </div>
        </div>

        {inRoomGame && hud.party.length > 1 && (
          <div
            data-testid="party-panel"
            className="bg-[#0c0e14]/90 border border-[#6e5a34]/70 px-3 py-2 min-w-[162px] shadow-[0_6px_18px_rgba(0,0,0,0.6)]"
          >
            <div className="font-display text-[10px] tracking-[0.15em] text-[#bfa86a] border-b border-[#3a3328] pb-1 mb-1.5">
              隊伍 · PARTY
            </div>
            <ul className="space-y-1">
              {hud.party.map((m) => (
                <li
                  key={m.id}
                  data-testid={`party-${m.name}`}
                  data-state={m.state}
                  className="flex items-center justify-between gap-3 font-hud text-[11px]"
                >
                  <span className={`truncate max-w-[92px] ${m.isSelf ? 'text-[#ffe9b0]' : 'text-[#d8d3c4]'}`}>
                    {m.isHost ? '★ ' : ''}
                    {m.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {hud.inTown && !m.isSelf && m.state === 1 && !trade && (
                      <button
                        type="button"
                        data-testid={`trade-btn-${m.name}`}
                        onClick={() => void startTradeRequest(m.id, m.name)}
                        className="pointer-events-auto cursor-pointer border border-[#c8a355] px-1.5 text-[10px] text-[#ffe5a3] hover:bg-[#33290f]"
                      >
                        交易
                      </button>
                    )}
                    <span
                      className={`px-1.5 border text-[10px] ${
                        m.state === 2
                          ? 'border-[#a8404c] text-[#ff9ca6]'
                          : m.state === 1
                          ? 'border-[#3e9cc2] text-[#8fe3ff]'
                          : 'border-[#4e8a5c] text-[#9fe9b8]'
                      }`}
                    >
                      {m.state === 2 ? '倒地' : m.state === 1 ? '城鎮' : '地城'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-[#0c0e14]/90 border border-[#6e5a34]/70 p-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.6)]">
          <canvas
            ref={minimapCanvasRef}
            className="block"
            style={{ imageRendering: 'pixelated', width: '102px', height: '102px' }}
          />
        </div>
      </div>

      {/* Touch controls (phones / tablets only): movement stick + skill / mobility buttons */}
      {screen === 'playing' && !hud.isDead && touchPrimary && (
        <TouchControls
          onMove={onTouchMove}
          onDash={onTouchDash}
          onSkill={onTouchSkill}
          skillName={hud.skillName}
          mobilityName={hud.mobilityName}
          skillReady={hud.pommelCooldown <= 0.02}
        />
      )}

      {/* Unified Collapsible Bottom Control Dock & Contextual Altar Upgrade Panel */}
      {!hud.isDead && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center pointer-events-auto max-w-[94vw]">
        {hud.nearAltar && (
          <div className="mb-2.5 bg-[#0c0e14]/95 border border-[#c9a14a] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.85)] w-[min(710px,96vw)]">
            <div className="flex items-center justify-between gap-3 border-b border-[#3d3320] pb-2 mb-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-[#ffd566] shrink-0" />
                <span className="font-display text-xs font-bold tracking-[0.12em] text-[#f5dc99] whitespace-nowrap">
                  ALTAR OF ASCENSION
                </span>
                <span className="font-hud text-[10px] text-[#9b9ea8] whitespace-nowrap shrink-0">
                  LV {1 + hud.upgradeLevel}
                </span>
              </div>
              <div className="flex items-center gap-1 font-hud text-xs font-bold text-[#ffd25a] whitespace-nowrap shrink-0">
                <Coins className="w-3.5 h-3.5 shrink-0" />
                <span>{hud.upgradeCost} G</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {hud.upgradeOptions.map((opt) => {
                const st = UPGRADE_ACCENT_STYLES[opt.accent];
                const Icon = st.Icon;
                return (
                  <button
                    key={opt.kind}
                    type="button"
                    onClick={() => engineRef.current?.purchaseUpgrade(opt.kind)}
                    disabled={opt.maxed || hud.gold < hud.upgradeCost}
                    className={`flex flex-col items-start gap-0.5 px-2.5 py-2 border text-left disabled:opacity-45 transition-colors cursor-pointer ${st.btn}`}
                  >
                    <div className={`flex items-center gap-1.5 text-xs font-hud font-bold whitespace-nowrap ${st.text}`}>
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${st.icon}`} />
                      <span>{opt.maxed ? opt.maxedLabel : opt.label}</span>
                    </div>
                    <span className="font-hud text-[10px] text-[#a5a8b6] whitespace-nowrap tabular-nums">
                      {opt.progress}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => engineRef.current?.purchasePotion()}
                disabled={hud.gold < hud.potionCost}
                className="flex flex-col items-start gap-0.5 px-2.5 py-2 border border-[#783652] bg-[#1c1118] text-left hover:border-[#f06595] hover:bg-[#2a1522] disabled:opacity-45 disabled:hover:border-[#783652] disabled:hover:bg-[#1c1118] transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between w-full gap-1.5 text-xs font-hud font-bold text-[#ff8fb4] whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    <FlaskConical className="w-3.5 h-3.5 text-[#eb4b7b] shrink-0" />
                    <span>+1 Elixir</span>
                  </span>
                  <span className="text-[10px] text-[#ffd25a] tabular-nums">{hud.potionCost}G</span>
                </div>
                <span className="font-hud text-[10px] text-[#a5a8b6] whitespace-nowrap tabular-nums">
                  Owned: {hud.potions}
                </span>
              </button>
            </div>
          </div>
        )}

        {hud.nearShop && !hud.nearAltar && (() => {
          const hoveredShopRelic = hoveredShopRelicId
            ? hud.relicBag.find((r) => r.id === hoveredShopRelicId) ?? null
            : null;
          const hoveredCss = hoveredShopRelic ? getRarityCss(hoveredShopRelic.rarity) : null;
          const hoveredSet =
            hoveredShopRelic?.setId
              ? SET_RELIC_CATALOG.find((s) => s.setId === hoveredShopRelic.setId) ?? null
              : null;
          const hoveredUniqueDesc = hoveredShopRelic?.uniqueEffectId
            ? getUniqueEffectDescForClass(hoveredShopRelic.uniqueEffectId, hud.heroClass)
            : null;
          return (
          <div
            className="relative mb-2.5 bg-[#0c0e14]/95 border border-[#d64d74] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.85)] w-[min(420px,94vw)] space-y-2.5"
            onMouseLeave={() => setHoveredShopRelicId(null)}
          >
            {hoveredShopRelic && hoveredCss && (
              <div
                className={`pointer-events-none absolute bottom-full left-0 right-0 mb-2 bg-[#0a0c12]/98 border ${hoveredCss.border} px-3.5 py-2.5 shadow-[0_10px_32px_rgba(0,0,0,0.92)] font-hud text-[11px] space-y-1.5 z-30`}
              >
                <div className="flex items-baseline justify-between gap-2 border-b border-[#2a2d3a] pb-1.5">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className={`font-bold text-xs truncate ${hoveredCss.text}`}>
                      {hoveredShopRelic.name}
                    </span>
                    <span className="text-[10px] text-[#9aa0b4] shrink-0">
                      {getRarityLabel(hoveredShopRelic.rarity)} · Lv.{hoveredShopRelic.level}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#ffd466] tabular-nums shrink-0">
                    賣價 +{hoveredShopRelic.sellValue}G
                  </span>
                </div>
                <div className="space-y-0.5">
                  {hoveredShopRelic.stats.map((st, idx) => {
                    const mageNote =
                      st.key === 'maxHp' ? formatMaxHpStatForClass(st.value, hud.heroClass) : null;
                    return (
                      <div key={idx} className="flex items-baseline justify-between gap-2 text-[#e6e9f2]">
                        <span>{formatRelicStat(st)}</span>
                        {mageNote && <span className="text-[10px] text-[#8ecbff]/85">{mageNote}</span>}
                      </div>
                    );
                  })}
                </div>
                {hoveredUniqueDesc && (
                  <div className="pt-1 border-t border-[#2a2433] text-[#ffb86c] text-[10px] leading-snug">
                    ★ {hoveredUniqueDesc}
                  </div>
                )}
                {hoveredSet && (
                  <div className="pt-1 border-t border-[#1d3326] text-[#6bf2a4] text-[10px] space-y-0.5 leading-snug">
                    <div className="font-semibold">套裝：{hoveredSet.name}</div>
                    {hoveredSet.bonuses.map((b) => (
                      <div key={b.required}>
                        {b.required}件：{b.desc}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-b border-[#40202d] pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <FlaskConical className="w-3.5 h-3.5 text-[#ff6b93] shrink-0" />
                <span className="font-display text-xs font-bold tracking-[0.12em] text-[#ffd4e0] whitespace-nowrap">
                  藥水商店 · ELIXIR SHOP
                </span>
                <span className="font-hud text-[10px] text-[#a5a8b6] whitespace-nowrap shrink-0">
                  DEPTH {hud.depth}
                </span>
              </div>
              <div className="flex items-center gap-1 font-hud text-xs font-bold text-[#ffd25a] whitespace-nowrap shrink-0 tabular-nums">
                <Coins className="w-3.5 h-3.5 shrink-0" />
                <span>{hud.potionCost} G</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => engineRef.current?.purchasePotion()}
              disabled={hud.gold < hud.potionCost}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 border border-[#8f3d5d] bg-[#1f1119] hover:border-[#ff6b93] hover:bg-[#2d1623] disabled:opacity-45 disabled:hover:border-[#8f3d5d] disabled:hover:bg-[#1f1119] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 text-xs font-hud font-bold text-[#ff9bb8] whitespace-nowrap">
                <FlaskConical className="w-4 h-4 text-[#ff4d79] shrink-0" />
                <span>購買治療藥水 (+1)</span>
              </div>
              <span className="font-hud text-[11px] text-[#c7c2cf] whitespace-nowrap tabular-nums">
                持有：{hud.potions}
              </span>
            </button>

            {/* Relic Sell Counter inside Potion Shop */}
            <div className="pt-2 border-t border-[#361c27] space-y-2">
              <div className="flex items-center justify-between gap-2 font-hud text-[11px]">
                <span className="text-[#c9b4bc]">收購背包遺物（共 {hud.relicBag.length} 件）</span>
                <div className="flex items-center gap-1.5">
                  {shopCommonTotal > 0 && (
                    <button
                      type="button"
                      onClick={() => engineRef.current?.sellCommonBagRelics(true)}
                      className="px-2 py-0.5 border border-[#8c6829] bg-[#241b0d] text-[#ffd873] hover:border-[#f0c75e] transition-colors cursor-pointer whitespace-nowrap tabular-nums"
                    >
                      賣藍/黃 +{shopCommonTotal}G
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRelicModalOpen(true)}
                    className="px-2 py-0.5 border border-[#594635] bg-[#171923] text-[#dfd2b0] hover:border-[#c8a355] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    開啟裝備欄
                  </button>
                </div>
              </div>

              {hud.relicBag.length > 0 && (
                <div className="max-h-[116px] overflow-y-auto space-y-1 pr-0.5">
                  {hud.relicBag.map((item) => {
                    const css = getRarityCss(item.rarity);
                    const isHovered = hoveredShopRelicId === item.id;
                    return (
                      <div
                        key={item.id}
                        onMouseEnter={() => setHoveredShopRelicId(item.id)}
                        onMouseLeave={() =>
                          setHoveredShopRelicId((prev) => (prev === item.id ? null : prev))
                        }
                        className={`flex items-center justify-between gap-2 px-2 py-1 border ${
                          isHovered ? `${css.border} bg-[#1c1e2e]` : 'border-[#2d2633] bg-[#13141f]'
                        } font-hud text-[11px] transition-colors`}
                      >
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className={`font-semibold truncate ${css.text}`}>{item.name}</span>
                          <span className="text-[10px] text-[#8d93a6] tabular-nums shrink-0">
                            Lv.{item.level}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            engineRef.current?.sellRelic(item.id);
                            setHoveredShopRelicId((prev) => (prev === item.id ? null : prev));
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 border border-[#755827] bg-[#21190c] text-[#ffd466] hover:border-[#ebbf52] transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
                        >
                          <Coins className="w-3 h-3" />
                          <span>賣出 +{item.sellValue}G</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {!hud.inTown && hud.nearChest && !hud.nearAltar && !hud.nearShop && !hud.rescuePrompt && (
          <div
            data-testid="chest-prompt"
            className="mb-2.5 bg-[#0c0e14]/95 border border-[#d9a441] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.85)] w-[min(420px,94vw)] space-y-2"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#403320] pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Archive className="w-4 h-4 text-[#ffd566] shrink-0" />
                <span className="font-display text-xs font-bold tracking-[0.12em] text-[#f5dc99] whitespace-nowrap">
                  寶箱 · TREASURE CHEST
                </span>
              </div>
              <span className="font-hud text-[11px] text-[#e8c777] whitespace-nowrap">按 F 開啟</span>
            </div>
            <button
              type="button"
              data-testid="chest-open"
              onClick={() => engineRef.current?.useNearbyTreasureChest()}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-[#b8903a] bg-[#261d0e] hover:border-[#f0c75e] hover:bg-[#332712] text-[#ffe3a0] font-hud text-xs font-semibold transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-[#ffd25a] shrink-0" />
                <span>打開寶箱</span>
              </div>
              <span className="font-hud text-[11px] text-[#e0bf74] whitespace-nowrap">按 F 或點擊</span>
            </button>
          </div>
        )}

        {!hud.inTown && hud.nearPortal && !hud.nearChest && !hud.nearAltar && !hud.nearShop && !hud.rescuePrompt && (
          <div className="mb-2.5 bg-[#0c0e14]/95 border border-[#49c8f0] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.85)] w-[min(420px,94vw)] space-y-2">
            <div className="flex items-center justify-between gap-3 border-b border-[#1f3b4a] pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <DoorOpen className="w-4 h-4 text-[#66e3ff] shrink-0" />
                <span className="font-display text-xs font-bold tracking-[0.12em] text-[#ccf6ff] whitespace-nowrap">
                  城鎮傳送門 · TOWN PORTAL
                </span>
              </div>
              <span className="font-hud text-[11px] text-[#7ed7eb] whitespace-nowrap">按 F 穿越</span>
            </div>
            <button
              type="button"
              onClick={() => engineRef.current?.useDungeonPortal()}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-[#3d94b3] bg-[#0e202c] hover:border-[#7ee6ff] hover:bg-[#143042] text-[#d6f8ff] font-hud text-xs font-semibold transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <DoorOpen className="w-4 h-4 text-[#5ce1ff] shrink-0" />
                <span>穿越傳送門返回城鎮</span>
              </div>
              <span className="font-hud text-[11px] text-[#8effb8] whitespace-nowrap">免費</span>
            </button>
          </div>
        )}

        {hud.inTown && hud.nearPortal && !hud.nearAltar && !hud.nearShop && (
          <div className="mb-2.5 bg-[#0c0e14]/95 border border-[#49c8f0] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.85)] w-[min(420px,94vw)] space-y-2.5">
            <div className="flex items-center justify-between gap-3 border-b border-[#1f3b4a] pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <DoorOpen className="w-4 h-4 text-[#66e3ff] shrink-0" />
                <span className="font-display text-xs font-bold tracking-[0.12em] text-[#ccf6ff] whitespace-nowrap">
                  地下城傳送門 · DUNGEON PORTAL
                </span>
              </div>
              <span className="font-hud text-[11px] font-bold text-[#7ceeff] whitespace-nowrap shrink-0 tabular-nums">
                第 {hud.depth} 層
              </span>
            </div>

            <p className="font-hud text-[11px] text-[#aeb8c7] leading-relaxed">
              {hud.dungeonRunning
                ? '隊友仍在地下城戰鬥，怪物不會重生。選擇要穿過的傳送門。'
                : hud.portalOptions[0]?.id === 'entrance'
                ? '這一層沒有任何傳送門可用，將從樓層入口出發。本層怪物已重新生成。'
                : '穿過傳送門返回地下城。本層怪物將會重新復活，但傳送門周圍保持安全。'}
            </p>

            <div className="space-y-1.5" data-testid="portal-options">
              {hud.portalOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`portal-option-${opt.id}`}
                  onClick={() => engineRef.current?.returnToDungeon(opt.id)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border border-[#3e9cc2] bg-[#102430] hover:border-[#7eeaff] hover:bg-[#163344] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-xs font-hud font-bold text-[#b8f4ff] whitespace-nowrap">
                    <DoorOpen className="w-4 h-4 text-[#5ce1ff] shrink-0" />
                    <span>
                      {hud.portalOptions.length > 1 || opt.id === 'entrance'
                        ? `${opt.label}${opt.downed ? '（隊友倒地）' : ''}`
                        : `返回第 ${hud.depth} 層地下城`}
                    </span>
                  </div>
                  <span className="font-hud text-[11px] text-[#7ed7eb] whitespace-nowrap">點擊傳送</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {hud.inTown && hud.nearStash && !hud.stashOpen && !hud.nearAltar && !hud.nearShop && !hud.nearPortal && (
          <div
            data-testid="stash-prompt"
            className="mb-2.5 bg-[#0c0e14]/95 border border-[#d9a441] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.85)] w-[min(420px,94vw)] space-y-2.5"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#403320] pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Archive className="w-4 h-4 text-[#ffd566] shrink-0" />
                <span className="font-display text-xs font-bold tracking-[0.12em] text-[#f5dc99] whitespace-nowrap">
                  城鎮倉庫
                </span>
              </div>
              <span className="font-hud text-[11px] font-bold text-[#e8c777] whitespace-nowrap shrink-0 tabular-nums">
                {hud.stashCount} / {hud.stashCap}
              </span>
            </div>
            <p className="font-hud text-[11px] text-[#aeb8c7] leading-relaxed">
              存放暫時用不到的遺物，內容會跨局保留。
            </p>
            <button
              type="button"
              data-testid="stash-open"
              onClick={() => engineRef.current?.openStash()}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border border-[#b8903a] bg-[#261d0e] hover:border-[#f0c75e] hover:bg-[#332712] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 text-xs font-hud font-bold text-[#ffe3a0] whitespace-nowrap">
                <Archive className="w-4 h-4 text-[#ffd25a] shrink-0" />
                <span>打開倉庫</span>
              </div>
              <span className="font-hud text-[11px] text-[#e0bf74] whitespace-nowrap">按 F 或點擊</span>
            </button>
          </div>
        )}

        {hud.inTown && hud.nearAngel && !hud.nearAltar && !hud.nearShop && !hud.nearPortal && (
          <div className="mb-2.5 bg-[#0c0e14]/95 border border-[#f0d98c] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.85)] w-[min(440px,94vw)] space-y-2.5">
            <div className="flex items-center justify-between gap-3 border-b border-[#403723] pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Feather className="w-4 h-4 text-[#fff0a8] shrink-0" />
                <span className="font-display text-xs font-bold tracking-[0.12em] text-[#fff3cc] whitespace-nowrap">
                  聖光天使 瑟拉菲娜 · 庇護祝福
                </span>
              </div>
              <span className="font-hud text-[10px] text-[#d9caa3] whitespace-nowrap shrink-0">
                維持 3 層
              </span>
            </div>

            {!hud.angelBuff ? (
              <>
                <p className="font-hud text-[11px] text-[#d4d2cc] leading-relaxed">
                  「遠道而來的冒險者，我是瑟拉菲娜，願微光照耀你的前路。接受祝福後將獲得一件隨機普通屬性加護，效果維持 3 層——命運偶爾也有點調皮喔。」
                </p>
                <div className="font-hud text-[10px] text-[#9ea6b8]">
                  祝福品質機率：80% 藍裝數值 · 16% 黃裝數值 · 4% 橘裝數值（僅普通屬性）
                </div>
                <button
                  type="button"
                  onClick={() => engineRef.current?.requestAngelBlessing()}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border border-[#d6b85c] bg-[#262010] hover:border-[#fff0a8] hover:bg-[#362d14] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-xs font-hud font-bold text-[#fff2b8] whitespace-nowrap">
                    <Sparkles className="w-4 h-4 text-[#ffe066] shrink-0" />
                    <span>向瑟拉菲娜祈福（領取 3 層祝福）</span>
                  </div>
                  <span className="font-hud text-[11px] text-[#f0d98c] whitespace-nowrap">
                    免費
                  </span>
                </button>
              </>
            ) : (
              (() => {
                const css = getRarityCss(hud.angelBuff.rarity);
                return (
                  <div className="space-y-2">
                    <p className="font-hud text-[11px] text-[#c7c4bc] leading-relaxed">
                      「你身上仍有未消散的天使祝福，請待現有祝福結束後再回來祈福。」
                    </p>
                    <div className={`px-3 py-2 border ${css.border} bg-[#141621] space-y-1`}>
                      <div className="flex items-center justify-between gap-2 font-hud text-xs">
                        <span className={`font-bold ${css.text}`}>{hud.angelBuff.name}</span>
                        <span className="text-[11px] text-[#d9caa3] tabular-nums">
                          剩餘 {hud.angelBuff.floorsLeft} 層
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-hud text-[11px] text-[#e6e9f2]">
                        {hud.angelBuff.stats.map((st, idx) => (
                          <span key={`${st.key}-${idx}`}>{formatRelicStat(st)}</span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled
                      className="w-full px-3 py-2 border border-[#3a362c] bg-[#15161f] font-hud text-xs text-[#7e8394] cursor-not-allowed"
                    >
                      已有祝福生效中（無法重複領取）
                    </button>
                  </div>
                );
              })()
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="mb-1 flex items-center gap-1.5 px-3 py-1 bg-[#0c0e14]/90 border border-[#6e5a34]/75 text-[11px] font-hud text-[#c7b68d] hover:text-[#f5e3b3] hover:border-[#b89448] transition-colors cursor-pointer whitespace-nowrap"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>Show Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>Hide Controls</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="bg-[#0c0e14]/92 border border-[#8f7440]/80 px-2.5 py-1.5 flex flex-nowrap items-center justify-center gap-2 shadow-[0_10px_28px_rgba(0,0,0,0.75)]">
            {/* Control Mode Switch */}
            <div className="flex items-center bg-[#151822] border border-[#3a3428] p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => engineRef.current?.setControlMode('auto')}
                className={`px-2 py-1 text-xs font-hud transition-colors cursor-pointer whitespace-nowrap ${
                  hud.controlMode === 'auto'
                    ? 'bg-[#8f7440] text-[#0c0e14] font-bold'
                    : 'text-[#a3a8b8] hover:text-[#ece6d8]'
                }`}
              >
                Auto
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.setControlMode('manual')}
                className={`px-2 py-1 text-xs font-hud transition-colors cursor-pointer whitespace-nowrap ${
                  hud.controlMode === 'manual'
                    ? 'bg-[#8f7440] text-[#0c0e14] font-bold'
                    : 'text-[#a3a8b8] hover:text-[#ece6d8]'
                }`}
              >
                Manual
              </button>
            </div>

            {/* Auto-attack toggle (all platforms; T) */}
            <button
              type="button"
              onClick={() => engineRef.current?.setAutoAttack(!hud.autoAttack)}
              title="自動攻擊（T）：手動模式下，攻擊範圍內有怪就自動普攻，不會自動放技能"
              aria-pressed={hud.autoAttack}
              className={`flex items-center gap-1 px-2 py-1.5 border text-xs font-hud transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                hud.autoAttack
                  ? 'border-[#e6be63] bg-[#241c0f] text-[#fff0bf] shadow-[0_0_10px_rgba(230,190,99,0.25)]'
                  : 'border-[#3a3428] bg-[#151822] text-[#a3a8b8] hover:text-[#ece6d8]'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>自動攻擊 {hud.autoAttack ? 'ON' : 'OFF'}</span>
            </button>

            {/* Camera Zoom */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => engineRef.current?.adjustZoom(-0.14)}
                title="Zoom In"
                className="p-1.5 border border-[#3a3428] bg-[#151822] text-[#c7b68d] hover:border-[#b89448] hover:text-[#f3dca0] transition-colors cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.adjustZoom(0.14)}
                title="Zoom Out"
                className="p-1.5 border border-[#3a3428] bg-[#151822] text-[#c7b68d] hover:border-[#b89448] hover:text-[#f3dca0] transition-colors cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Class Skill (Right-Click) */}
            {(() => {
              const isMage = hud.heroClass === 'frost_mage';
              const cd = hud.pommelCooldown;
              const maxCd = Math.max(0.1, hud.pommelMaxCooldown);
              const isReady = cd <= 0.02;
              const progressPct = isReady
                ? 100
                : Math.max(0, Math.min(100, ((maxCd - cd) / maxCd) * 100));
              return (
                <button
                  type="button"
                  onClick={() => engineRef.current?.triggerPommelStrike()}
                  title={
                    isMage
                      ? `滑鼠右鍵施放 · ${hud.skillName}：全螢幕冰爆，凍結並擊退敵人（CD ${Math.round(maxCd)}s）`
                      : `滑鼠右鍵施放 · 劍柄敲擊 360° 衝擊波：50% 傷害並中斷攻擊/施法（小怪暈 2.5s / 菁英 1.5s / BOSS 0.8s · CD ${Math.round(maxCd)}s）`
                  }
                  className={`relative overflow-hidden flex items-center gap-1.5 px-2.5 py-1.5 border text-xs font-hud transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    isReady
                      ? isMage
                        ? 'border-[#8fd8ff] bg-[#0f1e2a] text-[#e3f7ff] hover:border-[#c4eeff] hover:bg-[#15293a] shadow-[0_0_12px_rgba(143,216,255,0.32)]'
                        : 'border-[#e6be63] bg-[#241c0f] text-[#fff0bf] hover:border-[#ffe28a] hover:bg-[#302412] shadow-[0_0_12px_rgba(230,190,99,0.28)]'
                      : 'border-[#3d382e] bg-[#13151d] text-[#8d92a2]'
                  }`}
                >
                  {!isReady && (
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-75 ${isMage ? 'bg-[#5aa9d0]/28' : 'bg-[#8f7440]/28'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  )}
                  {isMage ? (
                    <Snowflake
                      className={`relative z-10 w-3.5 h-3.5 ${
                        isReady ? 'text-[#9be3ff]' : 'text-[#707585]'
                      }`}
                    />
                  ) : (
                    <Sparkles
                      className={`relative z-10 w-3.5 h-3.5 ${
                        isReady ? 'text-[#ffe066]' : 'text-[#707585]'
                      }`}
                    />
                  )}
                  <span className="relative z-10 px-1 py-0.5 bg-[#0c0e14]/80 border border-[#5c4c2f]/80 text-[10px] leading-none text-[#d9c28a]">
                    右鍵
                  </span>
                  <span className="relative z-10 font-semibold">{hud.skillName}</span>
                  <span
                    className={`relative z-10 text-[11px] font-bold min-w-[2.4rem] text-right ${
                      isReady
                        ? isMage
                          ? 'text-[#9be3ff]'
                          : 'text-[#ffe066]'
                        : 'text-[#c9b78a]'
                    }`}
                  >
                    {isReady ? '就緒' : `${cd.toFixed(1)}s`}
                  </span>
                </button>
              );
            })()}

            {/* Open Relic Equipment Vault */}
            <button
              type="button"
              onClick={() => setRelicModalOpen((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-xs font-hud transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                relicModalOpen
                  ? 'border-[#e6a44e] bg-[#2a1d10] text-[#ffe1a8] font-bold'
                  : 'border-[#5c4830] bg-[#151822] text-[#f0dab0] hover:border-[#d6a34e] hover:text-[#fff0c4]'
              }`}
            >
              <Gem className="w-3.5 h-3.5 text-[#ff9e4a]" />
              <span>
                遺物 {hud.equippedRelics.length}/4
                {hud.relicBag.length > 0 ? ` · 袋${hud.relicBag.length}` : ''}
              </span>
            </button>

            {/* Return to Sanctuary Town [B] */}
            <button
              type="button"
              onClick={() => engineRef.current?.returnToTown()}
              disabled={hud.inTown}
              title={
                hud.inTown
                  ? '目前位於庇護小鎮，走近傳送門即可返回地下城'
                  : `快捷鍵 B · 消耗 ${hud.townReturnCost}G（不足扣至 0）瞬間傳送回城鎮並在原地留下傳送門`
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-xs font-hud transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                hud.inTown
                  ? 'border-[#3a6c80] bg-[#112029] text-[#8be6ff] cursor-default'
                  : 'border-[#3e7d99] bg-[#121e28] text-[#bceeff] hover:border-[#6ce4ff] hover:bg-[#192c3b] cursor-pointer'
              }`}
            >
              <Home className="w-3.5 h-3.5 text-[#5ce1ff]" />
              {hud.inTown ? (
                <span>城鎮中</span>
              ) : (
                <>
                  <span className="px-1 py-0.5 bg-[#0c0e14]/80 border border-[#34647a]/80 text-[10px] leading-none text-[#8be6ff]">
                    B
                  </span>
                  <span>回城鎮</span>
                  <span className="text-[11px] font-bold text-[#ffd466]">
                    {hud.townReturnCost}G
                  </span>
                </>
              )}
            </button>

            {/* Sound Toggle */}
            <button
              type="button"
              onClick={() => engineRef.current?.toggleSound()}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-xs font-hud transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                hud.soundOn
                  ? 'border-[#b89448] bg-[#241d10] text-[#f5dc99]'
                  : 'border-[#3a3428] bg-[#151822] text-[#9ea3b2] hover:text-[#ece6d8]'
              }`}
            >
              {hud.soundOn ? (
                <Volume2 className="w-3.5 h-3.5 text-[#e6be63]" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              )}
              <span>{hud.soundOn ? 'Sound: On' : 'Sound: Off'}</span>
            </button>

            {/* Back to character list */}
            <button
              type="button"
              onClick={() => void leaveGame()}
              title="存檔並回到角色選單"
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[#3a3428] bg-[#151822] text-xs font-hud text-[#9ea3b2] hover:text-[#ece6d8] hover:border-[#b89448] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{activeSave?.name ?? '角色'}</span>
              <span
                className={
                  saveStatus === 'error'
                    ? 'text-[#ff8a98]'
                    : saveStatus === 'saving'
                    ? 'text-[#f7cb52]'
                    : 'text-[#6a6f80]'
                }
              >
                {saveStatus === 'error' ? '存檔失敗' : saveStatus === 'saving' ? '存檔中…' : saveStatus === 'saved' ? '已存檔' : ''}
              </span>
            </button>

            {/* Quiet Controls Hint */}
            <div className="hidden xl:flex items-center gap-2 pl-2 border-l border-[#3a3428] text-[11px] font-hud text-[#9096a8] whitespace-nowrap shrink-0">
              <span>WASD Move</span>
              <span aria-hidden="true">·</span>
              <span>{hud.heroClass === 'frost_mage' ? 'Click 冰尖彈' : 'Click Slash'}</span>
              <span aria-hidden="true">·</span>
              <span>Right-Click {hud.skillName}</span>
              <span aria-hidden="true">·</span>
              <span>Shift / Space {hud.mobilityName}</span>
              <span aria-hidden="true">·</span>
              <span>T 自動攻擊</span>
              <span aria-hidden="true">·</span>
              <span>E Heal</span>
              <span aria-hidden="true">·</span>
              <span>B 回城</span>
            </div>
          </div>
        )}
        </div>
      )}

      {/* Monochrome Death Screen & Run Summary Overlay */}
      {screen === 'playing' && hud.isDead && hud.runSummary && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-summary-title"
          className="absolute inset-0 z-40 flex items-center justify-center bg-[#06070a]/55 p-4 pointer-events-auto"
        >
          <div className="w-[min(480px,94vw)] bg-[#0b0d13]/96 border border-[#b89448]/85 px-6 py-6 shadow-[0_24px_64px_rgba(0,0,0,0.92)]">
            {/* Header */}
            <div className="text-center border-b border-[#322b1e] pb-4 mb-5">
              <div className="font-display text-xs tracking-[0.28em] text-[#9b8a64] mb-1">
                FALLEN IN THE VAULT
              </div>
              <h2
                id="run-summary-title"
                className="font-display text-2xl font-bold tracking-[0.14em] text-[#f3e1b4]"
              >
                你倒下了
              </h2>
              <div className="mt-2 font-display text-sm tracking-[0.2em] text-[#d9c28a]">
                {HERO_CLASSES[hud.runSummary.heroClass].name}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-hud text-xs text-[#a5aab8] tabular-nums">
                <span>第 {hud.runSummary.depth} 層</span>
                <span aria-hidden="true">·</span>
                <span>{hud.runSummary.biomeName}</span>
                <span aria-hidden="true">·</span>
                <span>存活 {formatDuration(hud.runSummary.durationSec)}</span>
              </div>
              <div className="mt-1.5 font-hud text-xs text-[#d67880]">
                最終擊倒者：{hud.runSummary.slainBy}
              </div>
              {hud.partySize > 1 && (
                <div data-testid="death-rescue" className="mt-2 font-hud text-xs text-[#9fe9c0]">
                  {hud.beingRescued > 0
                    ? `隊友正在救你… ${Math.round(hud.beingRescued * 100)}%`
                    : '隊友可以按住 F 3 秒把你救起來（地城仍在進行）'}
                  {hud.beingRescued > 0 && (
                    <div className="mx-auto mt-1 h-1.5 w-40 bg-[#1c2230]">
                      <div className="h-full bg-[#7dffb0]" style={{ width: `${Math.round(hud.beingRescued * 100)}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Core Run Metrics */}
            <div className="grid grid-cols-3 gap-4 border-b border-[#29241b] pb-4 mb-4 tabular-nums">
              <div>
                <div className="font-hud text-[11px] text-[#8d93a6] mb-1">冒險等級</div>
                <div className="font-display text-xl font-bold text-[#f3dca0]">
                  LV {1 + hud.runSummary.upgradeLevel}
                </div>
                <div className="font-hud text-[11px] text-[#7f8596] mt-0.5">
                  祭壇強化 {hud.runSummary.upgradeLevel} 次
                </div>
              </div>

              <div>
                <div className="font-hud text-[11px] text-[#8d93a6] mb-1">總金幣</div>
                <div className="font-display text-xl font-bold text-[#ffd25a]">
                  {hud.runSummary.totalGoldEarned.toLocaleString()} G
                </div>
                <div className="font-hud text-[11px] text-[#7f8596] mt-0.5">
                  剩餘 {hud.runSummary.goldRemaining.toLocaleString()} G
                </div>
              </div>

              <div>
                <div className="font-hud text-[11px] text-[#8d93a6] mb-1">總擊殺</div>
                <div className="font-display text-xl font-bold text-[#f0ede4]">
                  {hud.runSummary.totalKills}
                </div>
                <div className="font-hud text-[11px] text-[#7f8596] mt-0.5">
                  抵達第 {hud.runSummary.depth} 層
                </div>
              </div>
            </div>

            {/* Kill Breakdown by Enemy Tier */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#29241b] pb-4 mb-4 font-hud text-xs tabular-nums">
              <span className="text-[#8d93a6]">擊殺分類</span>
              <div className="flex items-center gap-2.5 text-[#d8d4c8]">
                <span>小怪 {hud.runSummary.normalKills}</span>
                <span className="text-[#565c6e]" aria-hidden="true">·</span>
                <span className="text-[#ffb957]">菁英怪 {hud.runSummary.eliteKills}</span>
                <span className="text-[#565c6e]" aria-hidden="true">·</span>
                <span className="text-[#ff6b7a]">Boss {hud.runSummary.bossKills}</span>
              </div>
            </div>

            {/* Upgrade Breakdown */}
            <div className="border-b border-[#29241b] pb-4 mb-4">
              <div className="font-hud text-[11px] text-[#8d93a6] mb-2">升級選項明細</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-hud text-xs tabular-nums">
                <div>
                  <div className="text-[#ff8a98] font-semibold">
                    {hud.runSummary.heroClass === 'frost_mage' ? 'HP/護盾' : '生命'} +{hud.runSummary.hpUpgrades}
                  </div>
                  <div className="text-[11px] text-[#8d93a6] mt-0.5">
                    上限 {hud.runSummary.maxHp} HP
                  </div>
                </div>

                <div>
                  <div className="text-[#ffd773] font-semibold">
                    攻擊 +{hud.runSummary.atkUpgrades}
                  </div>
                  <div className="text-[11px] text-[#8d93a6] mt-0.5">
                    傷害 +{hud.runSummary.atkBonusPct}%
                  </div>
                </div>

                <div>
                  <div className="text-[#8fd4ff] font-semibold">
                    {hud.runSummary.heroClass === 'frost_mage'
                      ? '護盾加速'
                      : hud.runSummary.heroClass === 'hunter'
                      ? '攻速'
                      : '護甲'}{' '}
                    +{hud.runSummary.armorUpgrades}
                  </div>
                  <div className="text-[11px] text-[#8d93a6] mt-0.5">
                    {hud.runSummary.heroClass === 'frost_mage'
                      ? `回充加快 ${Math.round(hud.runSummary.armorUpgrades * 12)}%`
                      : hud.runSummary.heroClass === 'hunter'
                      ? `射速 +${hud.runSummary.atkSpeedBonusPct}%`
                      : `減傷 +${hud.runSummary.armorBonusPct}%`}
                  </div>
                </div>

                <div>
                  <div className="text-[#8cffb4] font-semibold">
                    暴擊 +{hud.runSummary.critUpgrades}
                  </div>
                  <div className="text-[11px] text-[#8d93a6] mt-0.5">
                    機率 +{hud.runSummary.critBonusPct}%
                  </div>
                </div>
              </div>
            </div>

            {/* Extra Combat Record */}
            <div className="flex flex-wrap items-center justify-between gap-2 font-hud text-xs text-[#9ea4b5] mb-6 tabular-nums">
              <span>總輸出 {hud.runSummary.totalDamageDealt.toLocaleString()}</span>
              <span aria-hidden="true">·</span>
              <span>暴擊 {hud.runSummary.critCount} 次</span>
              <span aria-hidden="true">·</span>
              <span>
                消耗藥水 {hud.runSummary.potionsUsed} 瓶（餘 {hud.runSummary.potionsLeft}）
              </span>
            </div>

            {/* Portal toll + return-to-town (death no longer ends the run) */}
            <div
              data-testid="death-toll"
              className="mb-3 border border-[#3a3428] bg-[#12141c] px-3 py-2 text-center font-hud text-xs text-[#b9b4a4]"
            >
              傳送門已在倒下處開啟。回城將扣除{' '}
              <span className="font-bold text-[#ffd479] tabular-nums">
                {Math.min(hud.gold, hud.townReturnCost).toLocaleString()} G
              </span>
              {hud.gold < hud.townReturnCost && (
                <span className="text-[#8d93a6]">（金幣不足，最多扣到 0；原價 {hud.townReturnCost} G）</span>
              )}
            </div>
            <button
              type="button"
              data-testid="death-return-town"
              onClick={() => engineRef.current?.confirmDeathReturn()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-[#d6b25e] bg-[#2a2110] text-sm font-display font-bold tracking-[0.16em] text-[#ffe7a8] hover:bg-[#3a2d15] hover:border-[#f0cf7b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0cf7b] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Home className="w-4 h-4 shrink-0" />
              <span>回到城鎮</span>
            </button>
            <button
              type="button"
              onClick={() => void leaveGame()}
              className="mt-2 w-full px-4 py-2 border border-[#3a3428] bg-[#151822] font-hud text-xs text-[#b9b4a4] hover:text-[#ece6d8] hover:border-[#b89448] transition-colors cursor-pointer whitespace-nowrap"
            >
              回到角色選單（{activeSave?.name ?? HERO_CLASSES[hud.heroClass].name}）
            </button>
          </div>
        </div>
      )}

      {/* Account screens (attract mode keeps running behind them) */}
      {screen === 'login' && <LoginScreen onLoggedIn={handleLoggedIn} />}
      {screen === 'characters' && me && (
        <CharacterSelectScreen
          me={me}
          onPick={(save) => {
            setActiveSave(save);
            setScreen('lobby');
          }}
          onLogout={() => void logout()}
          onUnauthorized={handleUnauthorized}
        />
      )}
      {screen === 'lobby' && activeSave && (
        <LobbyScreen
          save={activeSave}
          notice={lobbyNotice}
          onStart={(opts) => {
            setLobbyNotice(null);
            startGame(opts);
          }}
          onCreateRoom={() => {
            setLobbyNotice(null);
            setRoomEntry({ kind: 'create' });
            setScreen('room');
          }}
          onJoinRoom={(code) => {
            setLobbyNotice(null);
            setRoomEntry({ kind: 'join', code });
            setScreen('room');
          }}
          onBack={() => {
            setActiveSave(null);
            setScreen('characters');
          }}
        />
      )}

      {screen === 'room' && activeSave && roomEntry && (
        <RoomLobbyScreen
          key={roomEntry.kind === 'join' ? roomEntry.code : 'create'}
          save={activeSave}
          entry={roomEntry}
          onExit={(notice) => {
            setRoomEntry(null);
            setLobbyNotice(notice ?? null);
            setScreen('lobby');
          }}
          onGameStart={handleRoomGameStart}
        />
      )}

      {/* In-game chat (P5-C) */}
      {inRoomGame && screen === 'playing' && (
        <div className="absolute left-4 bottom-[76px] z-[35] w-[min(360px,46vw)] flex flex-col gap-1 pointer-events-none">
          <div data-testid="game-chat-lines" className="flex flex-col gap-0.5">
            {gameChat.map((l) => {
              const age = chatNow - l.at;
              if (!chatOpen && age > CHAT_SHOW_MS + CHAT_FADE_MS) return null;
              const op = chatOpen || age <= CHAT_SHOW_MS ? 1 : Math.max(0, 1 - (age - CHAT_SHOW_MS) / CHAT_FADE_MS);
              return (
                <div
                  key={l.id}
                  style={{ opacity: op, transition: 'opacity 0.4s linear' }}
                  className="font-hud text-xs leading-snug text-[#efe8d4] bg-[#07080d]/70 px-2 py-0.5 break-words"
                >
                  <span className="text-[#e7cf93] font-bold">{l.name}：</span>
                  {l.text}
                </div>
              );
            })}
          </div>
          {chatOpen && (
            <input
              ref={chatInputRef}
              data-testid="game-chat-input"
              value={chatDraft}
              maxLength={200}
              placeholder="輸入訊息，Enter 送出，Esc 取消"
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendGameChat();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setChatDraft('');
                  setChatOpen(false);
                }
              }}
              onBlur={() => setChatOpen(false)}
              className="pointer-events-auto w-full bg-[#0b0d13]/92 border border-[#b89448]/85 px-2 py-1 font-hud text-xs text-[#f3e1b4] outline-none placeholder:text-[#7c7560]"
            />
          )}
        </div>
      )}

      {toast && (
        <div
          role="status"
          data-testid="toast"
          className="absolute top-20 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 border border-[#b89448]/85 bg-[#0b0d13]/92 font-hud text-sm text-[#f3e1b4] pointer-events-none"
        >
          {toast}
        </div>
      )}

      {/* Save conflict: another session updated this character */}
      {screen === 'playing' && saveStatus === 'conflict' && (
        <div
          role="alertdialog"
          aria-modal="true"
          className="absolute inset-0 z-[60] flex items-center justify-center bg-[#06070a]/80 p-4 pointer-events-auto"
        >
          <div className="w-[min(420px,94vw)] bg-[#0b0d13]/96 border border-[#b89448]/85 px-6 py-6 text-center">
            <h2 className="font-display text-xl font-bold tracking-[0.12em] text-[#f3e1b4] mb-3">存檔版本衝突</h2>
            <p className="font-hud text-xs text-[#cfc9ba] leading-relaxed mb-5">
              此角色的雲端存檔已在其他地方更新（例如另一個分頁或裝置）。為避免覆蓋，
              本次遊玩的進度不會上傳。請載入雲端存檔後繼續。
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => void reloadFromCloud()}
                className="px-4 py-2 border border-[#d6b25e] bg-[#2a2110] text-sm font-hud text-[#ffe7a8] hover:bg-[#3a2d15] cursor-pointer"
              >
                載入雲端存檔
              </button>
              <button
                type="button"
                onClick={() => {
                  resetToAttract();
                  setActiveSave(null);
                  setScreen('characters');
                }}
                className="px-4 py-2 border border-[#3a3428] bg-[#151822] text-sm font-hud text-[#b9b4a4] hover:text-[#ece6d8] cursor-pointer"
              >
                回到角色選單
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Relic Equipment & Bag Vault Modal */}
      {relicModalOpen && !hud.isDead && (
        <RelicEquipmentModal
          heroClass={hud.heroClass}
          equipped={hud.equippedRelics}
          bag={hud.relicBag}
          bagCap={hud.relicBagCap}
          relicStats={hud.relicStats}
          activeSets={hud.activeSets}
          nearShop={hud.nearShop}
          onEquip={(relicId, slotIdx) => engineRef.current?.equipRelic(relicId, slotIdx)}
          onUnequip={(slotIdx) => engineRef.current?.unequipRelic(slotIdx)}
          onSell={(relicId) => engineRef.current?.sellRelic(relicId)}
          onSellCommon={() => engineRef.current?.sellCommonBagRelics(true)}
          onClose={() => setRelicModalOpen(false)}
        />
      )}

      {/* Town stash window (engine blocks hero input while open; closing it triggers a save) */}
      {hud.stashOpen && hud.inTown && !hud.isDead && (
        <StashModal
          heroClass={hud.heroClass}
          gold={hud.gold}
          equipped={hud.equippedRelics}
          bag={hud.relicBag}
          bagCap={hud.relicBagCap}
          stash={hud.stash}
          stashCap={hud.stashCap}
          onDeposit={(id) => engineRef.current!.depositRelic(id)}
          onWithdraw={(id) => engineRef.current!.withdrawRelic(id)}
          onSell={(id, source) => engineRef.current!.sellRelicInStash(id, source)}
          onUnequip={(slotIdx) => engineRef.current?.unequipRelic(slotIdx)}
          onClose={() => engineRef.current?.closeStash()}
        />
      )}

      {/* P6 trade: request prompts and the trade window (room games only) */}
      {trade && (trade.phase === 'incoming' || trade.phase === 'requesting' || trade.phase === 'preparing') && (
        <div
          data-testid="trade-prompt"
          className="pointer-events-auto absolute left-1/2 top-24 z-40 -translate-x-1/2 border border-[#c8a355] bg-[#0c0e14]/95 px-4 py-3 text-center font-hud text-xs text-[#f0e6c8] shadow-[0_10px_30px_rgba(0,0,0,0.85)]"
        >
          {trade.phase === 'incoming' && (
            <>
              <div className="mb-2">
                <span className="font-bold text-[#ffe5a3]">{trade.partnerName}</span> 想與你交易
              </div>
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  data-testid="trade-accept"
                  onClick={() => void acceptTrade()}
                  className="cursor-pointer border border-[#3e6a5a] bg-[#122019] px-3 py-1 font-semibold text-[#b9f2d6] hover:border-[#6ee0a8]"
                >
                  接受
                </button>
                <button
                  type="button"
                  data-testid="trade-decline"
                  onClick={cancelTrade}
                  className="cursor-pointer border border-[#6a4040] bg-[#201315] px-3 py-1 text-[#f2c4c4] hover:border-[#e08080]"
                >
                  拒絕
                </button>
              </div>
            </>
          )}
          {trade.phase === 'requesting' && (
            <div className="flex items-center gap-3">
              <span>正在向 {trade.partnerName} 發出交易請求…</span>
              <button
                type="button"
                data-testid="trade-request-cancel"
                onClick={cancelTrade}
                disabled={trade.cancelling}
                className="cursor-pointer border border-[#4a3e2a] bg-[#171a26] px-2.5 py-1 text-[#c7b68d] hover:border-[#d6b25e] disabled:opacity-40"
              >
                取消
              </button>
            </div>
          )}
          {trade.phase === 'preparing' && <span>正在同步存檔，準備交易…</span>}
        </div>
      )}
      {trade && (trade.phase === 'open' || trade.phase === 'applying') && !hud.isDead && (
        <TradeModal
          heroClass={hud.heroClass}
          partnerName={trade.partnerName}
          bag={hud.relicBag}
          stash={hud.stash}
          gold={hud.gold}
          mine={trade.mine}
          theirs={trade.theirs}
          notice={trade.notice}
          busy={trade.phase === 'applying' || trade.cancelling === true || (trade.mine.confirmed && trade.theirs.confirmed)}
          onOffer={(offer) => {
            if (trade.tradeId) mpClientRef.current?.tradeOffer(trade.tradeId, offer);
          }}
          onConfirm={() => {
            if (trade.tradeId) mpClientRef.current?.tradeConfirm(trade.tradeId, trade.rev);
          }}
          onCancel={cancelTrade}
        />
      )}

      {/* Hidden Ctrl+I Orange & Green Relic Compendium */}
      {codexModalOpen && (
        <RelicCompendiumModal
          heroClass={hud.heroClass}
          discoveredIds={hud.discoveredRelicIds}
          onClose={() => setCodexModalOpen(false)}
        />
      )}
    </div>
  );
}
