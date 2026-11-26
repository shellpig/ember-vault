import { useMemo, useState } from 'react';
import { Archive, Coins, Sparkles, X } from 'lucide-react';
import {
  RelicItem,
  RelicRarity,
  formatMaxHpStatForClass,
  formatRelicStat,
  getRarityCss,
  getRarityLabel,
  getUniqueEffectDescForClass,
} from '../game/relics';
import type { HeroClassId } from '../game/classes';
import type { StashMoveResult } from '../game/engine';

type SortKey = 'rarity' | 'level' | 'name' | 'recent';
type RarityFilter = 'all' | RelicRarity;

const RARITY_ORDER: Record<RelicRarity, number> = { orange: 0, green: 1, yellow: 2, blue: 3 };

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'rarity', label: '稀有度' },
  { id: 'level', label: '等級' },
  { id: 'name', label: '名稱' },
  { id: 'recent', label: '最近存入' },
];

const RARITY_TABS: Array<{ id: RarityFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'orange', label: '獨特' },
  { id: 'green', label: '套裝' },
  { id: 'yellow', label: '高級' },
  { id: 'blue', label: '普通' },
];

/** Same ordering used by the equipment modal: rarity first, then level (high to low). */
export function compareRarityLevel(a: RelicItem, b: RelicItem): number {
  return RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || b.level - a.level;
}

export type StashSellResult =
  | { ok: true; gold: number; name: string }
  | { ok: false; reason: 'closed' | 'notFound' };

interface StashModalProps {
  heroClass: HeroClassId;
  gold: number;
  equipped: RelicItem[];
  bag: RelicItem[];
  bagCap: number;
  stash: RelicItem[];
  stashCap: number;
  onDeposit: (relicId: string) => StashMoveResult;
  onWithdraw: (relicId: string) => StashMoveResult;
  onSell: (relicId: string, source: 'bag' | 'stash') => StashSellResult;
  onUnequip: (slotIndex: number) => void;
  onClose: () => void;
}

function buildRelicTooltipText(item: RelicItem, heroClass: HeroClassId): string {
  return [
    `${item.name} Lv.${item.level}（${getRarityLabel(item.rarity)}${item.setName ? ` · ${item.setName}` : ''}）`,
    ...item.stats.map((s) => formatRelicStat(s)),
    item.uniqueEffectTitle
      ? `【${item.uniqueEffectTitle}】${
          item.uniqueEffectId
            ? getUniqueEffectDescForClass(item.uniqueEffectId, heroClass)
            : item.uniqueEffectDesc ?? ''
        }`
      : '',
    `售價：${item.sellValue}G`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Compact square relic tile (shared by StashModal and TradeModal). Full details appear on hover. */
export function RelicMiniCard({
  item,
  heroClass,
  action,
  onHover,
}: {
  item: RelicItem;
  heroClass: HeroClassId;
  action: React.ReactNode;
  onHover?: (item: RelicItem | null, e?: React.MouseEvent) => void;
}) {
  const css = getRarityCss(item.rarity);
  const tip = buildRelicTooltipText(item, heroClass);
  const visibleStats = item.stats.slice(0, 2);
  const extraCount = item.stats.length - visibleStats.length;

  return (
    <div
      title={onHover ? undefined : tip}
      data-relic-id={item.id}
      onMouseEnter={(e) => onHover?.(item, e)}
      onMouseMove={(e) => onHover?.(item, e)}
      onMouseLeave={() => onHover?.(null)}
      className={`flex flex-col justify-between border p-1.5 min-h-[92px] ${css.bg} ${css.border}`}
    >
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className={`font-hud text-[11px] font-bold truncate leading-tight ${css.text}`}>
            {item.name}
          </span>
          <span className="font-hud text-[9px] text-[#9ea4b5] tabular-nums shrink-0">
            L{item.level}
          </span>
        </div>

        <div className="mt-1 space-y-0.5 font-hud text-[10px] leading-tight text-[#e5e0d4] tabular-nums">
          {visibleStats.map((s, idx) => (
            <div key={idx} className="truncate">
              {formatRelicStat(s)}
            </div>
          ))}
          {extraCount > 0 && (
            <div className="text-[9px] text-[#9ea4b5]">+{extraCount} 項屬性…</div>
          )}
          {item.uniqueEffectTitle && (
            <div className="flex items-center gap-0.5 text-[9px] text-[#ffb878] truncate">
              <Sparkles className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{item.uniqueEffectTitle}</span>
            </div>
          )}
          {!item.uniqueEffectTitle && item.setName && (
            <div className="text-[9px] text-[#8ef5a8] truncate">套裝 · {item.setName}</div>
          )}
        </div>
      </div>

      <div className="mt-1.5 pt-1 border-t border-white/10 flex items-center justify-end gap-1">
        {action}
      </div>
    </div>
  );
}

/** Floating rich tooltip rendered above the modal so long orange/set descriptions are never clipped. */
function RelicHoverTooltip({
  item,
  heroClass,
  x,
  y,
}: {
  item: RelicItem;
  heroClass: HeroClassId;
  x: number;
  y: number;
}) {
  const css = getRarityCss(item.rarity);
  const w = 270;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  const left = Math.max(8, Math.min(x + 14, vw - w - 12));
  const top = y + 180 > vh ? Math.max(8, y - 180) : y + 14;

  return (
    <div
      className={`pointer-events-none fixed z-[70] w-[270px] border p-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.92)] bg-[#0b0d14]/98 ${css.border}`}
      style={{ left, top }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className={`font-hud text-xs font-bold ${css.text}`}>{item.name}</span>
        <span className="font-hud text-[10px] text-[#a5aab8] tabular-nums shrink-0">
          Lv.{item.level}
        </span>
      </div>
      <div className="font-hud text-[10px] text-[#8d93a6] mb-1.5">
        {getRarityLabel(item.rarity)}
        {item.setName ? ` · ${item.setName}` : ''}
      </div>
      <div className="space-y-0.5 font-hud text-[11px] text-[#ebe7dc] tabular-nums">
        {item.stats.map((s, idx) => {
          const note = s.key === 'maxHp' ? formatMaxHpStatForClass(s.value, heroClass) : null;
          return (
            <div key={idx}>
              {formatRelicStat(s)}
              {note && <div className="text-[9px] text-[#8ecbff]/85">{note}</div>}
            </div>
          );
        })}
      </div>
      {item.uniqueEffectTitle && (
        <div className="mt-1.5 pt-1.5 border-t border-[#4f3018] font-hud text-[10px] leading-relaxed text-[#ffb878]">
          <span className="font-bold">【{item.uniqueEffectTitle}】</span>
          {item.uniqueEffectId
            ? getUniqueEffectDescForClass(item.uniqueEffectId, heroClass)
            : item.uniqueEffectDesc}
        </div>
      )}
      <div className="mt-1.5 pt-1 border-t border-white/10 flex items-center justify-between font-hud text-[10px] text-[#e6c46a] tabular-nums">
        <span>出售價格</span>
        <span>+{item.sellValue}G</span>
      </div>
    </div>
  );
}

const MOVE_ERRORS: Record<string, string> = {
  bagFull: '背包已滿，請先騰出空間再取出。',
  stashFull: '倉庫已滿，無法再存入。',
  notFound: '找不到這件遺物。',
  closed: '倉庫已關閉。',
};

export function StashModal({
  heroClass,
  gold,
  equipped,
  bag,
  bagCap,
  stash,
  stashCap,
  onDeposit,
  onWithdraw,
  onSell,
  onUnequip,
  onClose,
}: StashModalProps) {
  const [sortKey, setSortKey] = useState<SortKey>('rarity');
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all');
  const [setFilter, setSetFilter] = useState<string>('all');
  const [mobileTab, setMobileTab] = useState<'bag' | 'stash'>('stash');
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [hovered, setHovered] = useState<{ item: RelicItem; x: number; y: number } | null>(null);

  const handleHover = (item: RelicItem | null, e?: React.MouseEvent) => {
    if (!item || !e) {
      setHovered(null);
    } else {
      setHovered({ item, x: e.clientX, y: e.clientY });
    }
  };

  const setNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of stash) if (r.setName) names.add(r.setName);
    return Array.from(names).sort();
  }, [stash]);

  const visibleStash = useMemo(() => {
    let list = stash;
    if (rarityFilter !== 'all') list = list.filter((r) => r.rarity === rarityFilter);
    if (setFilter !== 'all') list = list.filter((r) => r.setName === setFilter);
    const sorted = [...list];
    switch (sortKey) {
      case 'rarity':
        sorted.sort(compareRarityLevel);
        break;
      case 'level':
        sorted.sort((a, b) => b.level - a.level || RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]);
        break;
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || compareRarityLevel(a, b));
        break;
      case 'recent':
        sorted.reverse(); // stash array is oldest deposit first
        break;
    }
    return sorted;
  }, [stash, rarityFilter, setFilter, sortKey]);

  const sortedBag = useMemo(() => [...bag].sort(compareRarityLevel), [bag]);

  const handleMove = (res: StashMoveResult, okText: string) => {
    setHovered(null);
    if (res.ok) setNotice({ text: okText, tone: 'info' });
    else setNotice({ text: MOVE_ERRORS[res.reason] ?? '操作失敗', tone: 'error' });
  };

  const handleSell = (item: RelicItem, source: 'bag' | 'stash') => {
    setHovered(null);
    const res = onSell(item.id, source);
    if (res.ok) {
      setNotice({ text: `已出售「${res.name}」獲得 +${res.gold}G`, tone: 'info' });
    } else {
      setNotice({ text: MOVE_ERRORS[res.reason] ?? '出售失敗', tone: 'error' });
    }
  };

  const stashFull = stash.length >= stashCap;
  const bagFull = bag.length >= bagCap;

  const bagPanel = (
    <section
      className={`${mobileTab === 'bag' ? 'block' : 'hidden'} lg:block min-w-0`}
      data-testid="stash-bag-panel"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-hud text-xs font-semibold text-[#d4be8a] tracking-wide">
          背包 <span className="tabular-nums">{bag.length} / {bagCap}</span>
        </div>
        {bagFull && <span className="font-hud text-[11px] text-[#ff9c7a]">背包已滿</span>}
      </div>

      <div className="mb-2.5 p-2 border border-[#2a2e3d] bg-[#0e1018]">
        <div className="font-hud text-[10px] text-[#8d93a6] mb-1">
          裝備中 {equipped.length} / 4（請先卸下再存入或出售）
        </div>
        {equipped.length === 0 ? (
          <div className="font-hud text-[11px] text-[#5d6377]">目前沒有裝備遺物</div>
        ) : (
          <div className="space-y-1">
            {equipped.map((item, idx) => {
              const css = getRarityCss(item.rarity);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2"
                  data-equipped-slot={idx}
                  onMouseEnter={(e) => handleHover(item, e)}
                  onMouseMove={(e) => handleHover(item, e)}
                  onMouseLeave={() => handleHover(null)}
                >
                  <span className={`font-hud text-[11px] font-bold truncate ${css.text}`}>
                    {item.name} <span className="text-[#9096a8] font-normal">Lv.{item.level}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (bagFull) {
                        setNotice({
                          text: '背包已滿，無法卸下；請先把背包遺物存入倉庫或出售。',
                          tone: 'error',
                        });
                        return;
                      }
                      onUnequip(idx);
                      setNotice({ text: `已卸下「${item.name}」到背包`, tone: 'info' });
                    }}
                    className="px-2 py-0.5 border border-[#4f4635] bg-[#171923] font-hud text-[10px] text-[#d6ccb4] hover:border-[#c8a355] hover:text-[#fff2cc] cursor-pointer whitespace-nowrap shrink-0"
                  >
                    卸下
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {sortedBag.length === 0 ? (
        <div className="py-8 text-center font-hud text-xs text-[#70768a] border border-[#232634] bg-[#0e1018]">
          背包目前沒有遺物
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-1.5">
          {sortedBag.map((item) => (
            <RelicMiniCard
              key={item.id}
              item={item}
              heroClass={heroClass}
              onHover={handleHover}
              action={
                <>
                  <button
                    type="button"
                    data-action="deposit"
                    onClick={() => handleMove(onDeposit(item.id), `已存入「${item.name}」`)}
                    className="px-1.5 py-0.5 border border-[#5e523a] bg-[#1a1d28] font-hud text-[10px] font-semibold text-[#f0e2be] hover:border-[#d6b25e] hover:bg-[#272318] cursor-pointer whitespace-nowrap"
                  >
                    存入
                  </button>
                  <button
                    type="button"
                    data-action="sell-bag"
                    title={`出售獲得 +${item.sellValue}G`}
                    onClick={() => handleSell(item, 'bag')}
                    className="px-1.5 py-0.5 border border-[#6e5225] bg-[#21190c] font-hud text-[10px] font-semibold text-[#ffd466] hover:border-[#ebbf52] hover:bg-[#2e2310] cursor-pointer whitespace-nowrap tabular-nums"
                  >
                    賣+{item.sellValue}G
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}
    </section>
  );

  const stashPanel = (
    <section
      className={`${mobileTab === 'stash' ? 'block' : 'hidden'} lg:block min-w-0`}
      data-testid="stash-stash-panel"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-hud text-xs font-semibold text-[#d4be8a] tracking-wide">
          倉庫 <span className="tabular-nums">{stash.length} / {stashCap}</span>
        </div>
        {stashFull && <span className="font-hud text-[11px] text-[#ff9c7a]">倉庫已滿</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mb-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {RARITY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setRarityFilter(tab.id)}
              className={`px-2 py-0.5 font-hud text-[11px] border transition-colors cursor-pointer whitespace-nowrap ${
                rarityFilter === tab.id
                  ? 'border-[#c8a355] bg-[#261f12] text-[#ffe5a3] font-semibold'
                  : 'border-[#2f3342] bg-[#131620] text-[#9096a8] hover:text-[#e6e1d3]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 font-hud text-[11px] text-[#9096a8]">
          套裝
          <select
            value={setFilter}
            onChange={(e) => setSetFilter(e.target.value)}
            className="bg-[#131620] border border-[#2f3342] text-[#e6e1d3] px-1.5 py-0.5 text-[11px] max-w-[9rem]"
          >
            <option value="all">全部</option>
            {setNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 font-hud text-[11px] text-[#9096a8]">
          排序
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="bg-[#131620] border border-[#2f3342] text-[#e6e1d3] px-1.5 py-0.5 text-[11px]"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visibleStash.length === 0 ? (
        <div className="py-10 text-center font-hud text-xs text-[#70768a] border border-[#232634] bg-[#0e1018]">
          {stash.length === 0
            ? '倉庫是空的。把背包裡暫時用不到的遺物存進來吧。'
            : '沒有符合篩選條件的遺物。'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-1.5">
          {visibleStash.map((item) => (
            <RelicMiniCard
              key={item.id}
              item={item}
              heroClass={heroClass}
              onHover={handleHover}
              action={
                <>
                  <button
                    type="button"
                    data-action="withdraw"
                    onClick={() =>
                      handleMove(onWithdraw(item.id), `已取出「${item.name}」到背包`)
                    }
                    className="px-1.5 py-0.5 border border-[#3e6a5a] bg-[#122019] font-hud text-[10px] font-semibold text-[#b9f2d6] hover:border-[#6ee0a8] hover:bg-[#183226] cursor-pointer whitespace-nowrap"
                  >
                    取出
                  </button>
                  <button
                    type="button"
                    data-action="sell-stash"
                    title={`出售獲得 +${item.sellValue}G`}
                    onClick={() => handleSell(item, 'stash')}
                    className="px-1.5 py-0.5 border border-[#6e5225] bg-[#21190c] font-hud text-[10px] font-semibold text-[#ffd466] hover:border-[#ebbf52] hover:bg-[#2e2310] cursor-pointer whitespace-nowrap tabular-nums"
                  >
                    賣+{item.sellValue}G
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stash-title"
      data-testid="stash-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#06070c]/84 p-2 sm:p-4 pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(1180px,97vw)] max-h-[92vh] flex flex-col bg-[#0c0e15] border border-[#b89448]/85 shadow-[0_24px_64px_rgba(0,0,0,0.94)] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[#342c1f] bg-[#10131d]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Archive className="w-4 h-4 text-[#ffd566] shrink-0" />
              <h2
                id="stash-title"
                className="font-display text-base font-bold tracking-[0.14em] text-[#f5dc99] whitespace-nowrap"
              >
                城鎮倉庫
              </h2>
            </div>
            <span className="font-hud text-xs text-[#9ea4b5] tabular-nums whitespace-nowrap">
              倉庫 {stash.length} / {stashCap}
            </span>
            <span className="flex items-center gap-1 font-hud text-xs font-semibold text-[#ffd466] tabular-nums whitespace-nowrap">
              <Coins className="w-3.5 h-3.5 text-[#f2b84b]" />
              {gold.toLocaleString('en-US')}G
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉倉庫"
            data-testid="stash-close"
            className="p-1.5 border border-[#4a3e2a] bg-[#171a26] text-[#c7b68d] hover:border-[#d6b25e] hover:text-[#fff0c4] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status line */}
        <div
          role="status"
          data-testid="stash-notice"
          className={`min-h-[26px] px-4 py-1 font-hud text-xs border-b border-[#232634] ${
            notice?.tone === 'error' ? 'text-[#ff9c7a] bg-[#2a1511]' : 'text-[#9fd9b8] bg-[#0e1612]'
          } ${notice ? '' : 'invisible'}`}
        >
          {notice?.text ?? '\u00A0'}
        </div>

        {/* Small screens: one panel at a time */}
        <div className="lg:hidden flex border-b border-[#232634]">
          {(
            [
              { id: 'bag', label: `背包 ${bag.length}/${bagCap}` },
              { id: 'stash', label: `倉庫 ${stash.length}/${stashCap}` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMobileTab(t.id)}
              className={`flex-1 py-2 font-hud text-xs border-b-2 cursor-pointer ${
                mobileTab === t.id
                  ? 'border-[#c8a355] text-[#ffe5a3] bg-[#161a26]'
                  : 'border-transparent text-[#9096a8]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-4">
          {bagPanel}
          {stashPanel}
        </div>

        <div className="px-4 py-2 border-t border-[#232634] bg-[#10131d] font-hud text-[11px] text-[#7d8396]">
          關閉倉庫時會自動存檔 · 可直接出售背包或倉庫遺物 · 滑鼠移至遺物檢視完整屬性 · 按 Esc 關閉
        </div>
      </div>

      {hovered && (
        <RelicHoverTooltip
          item={hovered.item}
          heroClass={heroClass}
          x={hovered.x}
          y={hovered.y}
        />
      )}
    </div>
  );
}
