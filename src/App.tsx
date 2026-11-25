import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Coins,
  Compass,
  FlaskConical,
  Gem,
  Heart,
  KeyRound,
  RotateCcw,
  Shield,
  Skull,
  Sparkles,
  Sword,
  Volume2,
  VolumeX,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { EmbervaultEngine } from './game/engine';
import { computeRelicSummary, getRarityCss } from './game/relics';
import {
  BannerEvent,
  FloatingLabelData,
  HudState,
  MinimapSnapshot,
} from './game/types';
import { RelicCompendiumModal, RelicEquipmentModal } from './components/RelicModals';

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
  baseMaxHp: 60,
  maxHpCap: 300,
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
  critBonusPct: 0,
  critMaxPct: 20,
  upgradeLevel: 0,
  upgradeCost: 40,
  potionCost: 10,
  nearAltar: false,
  hasAltarOnFloor: false,
  nearShop: false,
  hasShopOnFloor: false,
  controlMode: 'auto',
  soundOn: false,
  dashReady: true,
  fadeOpacity: 1,
  aiStatus: 'Exploring Chambers',
  boss: null,
  isDead: false,
  runSummary: null,
  equippedRelics: [],
  relicBag: [],
  relicBagCap: 30,
  relicStats: computeRelicSummary([]),
  activeSets: [],
  discoveredRelicIds: [],
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
  const [relicModalOpen, setRelicModalOpen] = useState(false);
  const [codexModalOpen, setCodexModalOpen] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);

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
      snap.terrainTheme === 'flesh'
        ? '#3d1738'
        : snap.terrainTheme === 'cavern'
        ? '#332b24'
        : '#2d313d';
    const pillarColor =
      snap.terrainTheme === 'flesh'
        ? '#5e2454'
        : snap.terrainTheme === 'cavern'
        ? '#52473d'
        : '#474c5c';
    const floorColor =
      snap.terrainTheme === 'flesh'
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
    });

    engineRef.current = engine;

    return () => {
      bannerTimers.forEach((t) => clearTimeout(t));
      labelTimers.forEach((t) => clearTimeout(t));
      engine.dispose();
      engineRef.current = null;
    };
  }, [drawMinimap]);

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
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, []);

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
            <span className="font-hud text-[11px] font-semibold text-[#f2e8d4] tabular-nums whitespace-nowrap">
              {hud.hp} / {hud.maxHp} HP
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
          </div>

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
        </div>
      </div>

      {/* Top-Center Boss Health Bar (Appears when engaging a Floor Boss) */}
      {!hud.isDead && hud.boss && (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-30 w-[min(360px,54vw)]">
          <div className="bg-[#0c0e14]/92 border border-[#b87c40]/85 px-3.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.75)]">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="font-display text-xs md:text-sm font-bold tracking-[0.14em] text-[#f5d58c] truncate">
                  {hud.boss.name}
                </span>
                <span className="hidden sm:inline font-hud text-[10px] text-[#9fa4b5] truncate">
                  {hud.boss.title}
                </span>
              </div>
              {hud.boss.state === 'windup' ? (
                <span className="font-hud text-[10px] font-bold tracking-wider text-[#ff6b57] whitespace-nowrap">
                  DODGE!
                </span>
              ) : hud.boss.state === 'recover' ? (
                <span className="font-hud text-[10px] font-bold tracking-wider text-[#62f5b4] whitespace-nowrap">
                  COUNTER!
                </span>
              ) : (
                <span className="font-hud text-[10px] text-[#c7b68d] whitespace-nowrap">
                  {hud.boss.hp} / {hud.boss.maxHp}
                </span>
              )}
            </div>
            <div className="w-full h-2 bg-[#1a161c] border border-[#4a3629] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#9e1b2d] via-[#d93043] to-[#f2784b] transition-all duration-150"
                style={{
                  width: `${Math.max(0, Math.min(100, (hud.boss.hp / Math.max(1, hud.boss.maxHp)) * 100))}%`,
                }}
              />
            </div>
          </div>
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
              DEPTH {hud.depth}
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

        <div className="bg-[#0c0e14]/90 border border-[#6e5a34]/70 p-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.6)]">
          <canvas
            ref={minimapCanvasRef}
            className="block"
            style={{ imageRendering: 'pixelated', width: '102px', height: '102px' }}
          />
        </div>
      </div>

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
              <button
                type="button"
                onClick={() => engineRef.current?.purchaseUpgrade('hp')}
                disabled={hud.baseMaxHp >= hud.maxHpCap || hud.gold < hud.upgradeCost}
                className="flex flex-col items-start gap-0.5 px-2.5 py-2 border border-[#6e4047] bg-[#1b1216] text-left hover:border-[#e8566c] hover:bg-[#26161d] disabled:opacity-45 disabled:hover:border-[#6e4047] disabled:hover:bg-[#1b1216] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 text-xs font-hud font-bold text-[#ff8a98] whitespace-nowrap">
                  <Heart className="w-3.5 h-3.5 text-[#e63950] shrink-0" />
                  <span>{hud.baseMaxHp >= hud.maxHpCap ? 'HP MAXED' : '+10 Max HP'}</span>
                </div>
                <span className="font-hud text-[10px] text-[#a5a8b6] whitespace-nowrap tabular-nums">
                  {hud.baseMaxHp} / {hud.maxHpCap} HP
                </span>
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.purchaseUpgrade('atk')}
                disabled={hud.gold < hud.upgradeCost}
                className="flex flex-col items-start gap-0.5 px-2.5 py-2 border border-[#755a2e] bg-[#1c1710] text-left hover:border-[#e6b953] hover:bg-[#292114] disabled:opacity-45 disabled:hover:border-[#755a2e] disabled:hover:bg-[#1c1710] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 text-xs font-hud font-bold text-[#ffd773] whitespace-nowrap">
                  <Sword className="w-3.5 h-3.5 text-[#f2b84b] shrink-0" />
                  <span>+10% Attack</span>
                </div>
                <span className="font-hud text-[10px] text-[#a5a8b6] whitespace-nowrap">
                  +{hud.atkBonusPct}% → +{hud.atkBonusPct + 10}% DMG
                </span>
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.purchaseUpgrade('armor')}
                disabled={hud.armorBonusPct >= hud.armorMaxPct || hud.gold < hud.upgradeCost}
                className="flex flex-col items-start gap-0.5 px-2.5 py-2 border border-[#395e7a] bg-[#101821] text-left hover:border-[#6cc4ff] hover:bg-[#152230] disabled:opacity-45 disabled:hover:border-[#395e7a] disabled:hover:bg-[#101821] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 text-xs font-hud font-bold text-[#8fd4ff] whitespace-nowrap">
                  <Shield className="w-3.5 h-3.5 text-[#5ebcf5] shrink-0" />
                  <span>{hud.armorBonusPct >= hud.armorMaxPct ? 'DEF MAXED' : '+10% Armor'}</span>
                </div>
                <span className="font-hud text-[10px] text-[#a5a8b6] whitespace-nowrap">
                  {hud.armorBonusPct}% / {hud.armorMaxPct}% DEF
                </span>
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.purchaseUpgrade('crit')}
                disabled={hud.critBonusPct >= hud.critMaxPct || hud.gold < hud.upgradeCost}
                className="flex flex-col items-start gap-0.5 px-2.5 py-2 border border-[#326b46] bg-[#101c15] text-left hover:border-[#5ce88b] hover:bg-[#16291d] disabled:opacity-45 disabled:hover:border-[#326b46] disabled:hover:bg-[#101c15] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 text-xs font-hud font-bold text-[#8cffb4] whitespace-nowrap">
                  <Zap className="w-3.5 h-3.5 text-[#5ce88b] shrink-0" />
                  <span>{hud.critBonusPct >= hud.critMaxPct ? 'CRIT MAXED' : '+2% Crit'}</span>
                </div>
                <span className="font-hud text-[10px] text-[#a5a8b6] whitespace-nowrap">
                  +{hud.critBonusPct}% / +{hud.critMaxPct}% CRIT
                </span>
              </button>

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

        {hud.nearShop && !hud.nearAltar && (
          <div className="mb-2.5 bg-[#0c0e14]/95 border border-[#d64d74] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.85)] w-[min(420px,94vw)] space-y-2.5">
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
                  {hud.relicBag.slice(0, 6).map((item) => {
                    const css = getRarityCss(item.rarity);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 px-2 py-1 border border-[#2d2633] bg-[#13141f] font-hud text-[11px]"
                      >
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className={`font-semibold truncate ${css.text}`}>{item.name}</span>
                          <span className="text-[10px] text-[#8d93a6] tabular-nums shrink-0">
                            Lv.{item.level}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => engineRef.current?.sellRelic(item.id)}
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

            {/* Skip / Generate Next Floor */}
            <button
              type="button"
              onClick={() => engineRef.current?.triggerNewDungeon()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[#4a3e2a] bg-[#151822] text-xs font-hud text-[#dfd2b0] hover:border-[#c8a355] hover:text-[#fff0c4] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Compass className="w-3.5 h-3.5 text-[#d4a94e]" />
              <span>Next Floor</span>
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

            {/* Quiet Controls Hint */}
            <div className="hidden xl:flex items-center gap-2 pl-2 border-l border-[#3a3428] text-[11px] font-hud text-[#9096a8] whitespace-nowrap shrink-0">
              <span>WASD Move</span>
              <span aria-hidden="true">·</span>
              <span>Space/Click Slash</span>
              <span aria-hidden="true">·</span>
              <span>Shift Dash</span>
              <span aria-hidden="true">·</span>
              <span>E Heal</span>
            </div>
          </div>
        )}
        </div>
      )}

      {/* Monochrome Death Screen & Run Summary Overlay */}
      {hud.isDead && hud.runSummary && (
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
                冒險終結
              </h2>
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
                    生命 +{hud.runSummary.hpUpgrades}
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
                    護甲 +{hud.runSummary.armorUpgrades}
                  </div>
                  <div className="text-[11px] text-[#8d93a6] mt-0.5">
                    減傷 +{hud.runSummary.armorBonusPct}%
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

            {/* Player-Controlled Restart Button */}
            <button
              type="button"
              onClick={() => engineRef.current?.restartRun()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-[#d6b25e] bg-[#2a2110] text-sm font-display font-bold tracking-[0.16em] text-[#ffe7a8] hover:bg-[#3a2d15] hover:border-[#f0cf7b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0cf7b] transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>重新開始冒險</span>
            </button>
          </div>
        </div>
      )}

      {/* Relic Equipment & Bag Vault Modal */}
      {relicModalOpen && !hud.isDead && (
        <RelicEquipmentModal
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

      {/* Hidden Ctrl+I Orange & Green Relic Compendium */}
      {codexModalOpen && (
        <RelicCompendiumModal
          discoveredIds={hud.discoveredRelicIds}
          onClose={() => setCodexModalOpen(false)}
        />
      )}
    </div>
  );
}
