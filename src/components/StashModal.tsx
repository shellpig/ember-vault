import { useMemo, useState } from 'react';
import { ArrowLeftRight, Archive, X } from 'lucide-react';
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
function compareRarityLevel(a: RelicItem, b: RelicItem): number {
  return RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || b.level - a.level;
}

interface StashModalProps {
  heroClass: HeroClassId;
  equipped: RelicItem[];
  bag: RelicItem[];
  bagCap: number;
  stash: RelicItem[];
  stashCap: number;
  onDeposit: (relicId: string) => StashMoveResult;
  onWithdraw: (relicId: string) => StashMoveResult;
  onUnequip: (slotIndex: number) => void;
  onClose: () => void;
}

function RelicMiniCard({
  item,
  heroClass,
  action,
}: {
  item: RelicItem;
  heroClass: HeroClassId;
  action: React.ReactNode;
}) {
  const css = getRarityCss(item.rarity);
  const tip = [
    `${item.name} Lv.${item.level}（${getRarityLabel(item.rarity)}${item.setName ? ` · ${item.setName}` : ''}）`,
    ...item.stats.map((s) => formatRelicStat(s)),
    item.uniqueEffectTitle
      ? `【${item.uniqueEffectTitle}】${
          item.uniqueEffectId
            ? getUniqueEffectDescForClass(item.uniqueEffectId, heroClass)
            : item.uniqueEffectDesc ?? ''
        }`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div
      title={tip}
      data-relic-id={item.id}
      className={`flex flex-col justify-between border p-2.5 ${css.bg} ${css.border}`}
    >
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <span className={`font-hud text-xs font-bold truncate ${css.text}`}>{item.name}</span>
          <span className="font-hud text-[10px] text-[#a5aab8] tabular-nums shrink-0">Lv.{item.level}</span>
        </div>
        <div className="font-hud text-[10px] text-[#8d93a6] mb-1.5 truncate">
          {getRarityLabel(item.rarity)}
          {item.setName ? ` · ${item.setName}` : ''}
        </div>
        <div className="space-y-0.5 font-hud text-[11px] text-[#ebe7dc] tabular-nums">
          {item.stats.map((s, idx) => {
            const note = s.key === 'maxHp' ? formatMaxHpStatForClass(s.value, heroClass) : null;
            return (
              <div key={idx}>
                {formatRelicStat(s)}
                {note && <div className="text-[9px] text-[#8ecbff]/80">{note}</div>}
              </div>
            );
          })}
        </div>
        {item.uniqueEffectTitle && (
          <div className="mt-1.5 pt-1 border-t border-[#4f3018] font-hud text-[10px] leading-relaxed text-[#ffb878]">
            <span className="font-bold">【{item.uniqueEffectTitle}】</span>
            {item.uniqueEffectId
              ? getUniqueEffectDescForClass(item.uniqueEffectId, heroClass)
              : item.uniqueEffectDesc}
          </div>
        )}
      </div>
      <div className="mt-2 pt-1.5 border-t border-white/10 flex justify-end">{action}</div>
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
  equipped,
  bag,
  bagCap,
  stash,
  stashCap,
  onDeposit,
  onWithdraw,
  onUnequip,
  onClose,
}: StashModalProps) {
  const [sortKey, setSortKey] = useState<SortKey>('rarity');
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all');
  const [setFilter, setSetFilter] = useState<string>('all');
  const [mobileTab, setMobileTab] = useState<'bag' | 'stash'>('stash');
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);

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
    if (res.ok) setNotice({ text: okText, tone: 'info' });
    else setNotice({ text: MOVE_ERRORS[res.reason] ?? '操作失敗', tone: 'error' });
  };

  const stashFull = stash.length >= stashCap;
  const bagFull = bag.length >= bagCap;

  const bagPanel = (
    <section className={`${mobileTab === 'bag' ? 'block' : 'hidden'} lg:block min-w-0`} data-testid="stash-bag-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="font-hud text-xs font-semibold text-[#d4be8a] tracking-wide">
          背包 <span className="tabular-nums">{bag.length} / {bagCap}</span>
        </div>
        {bagFull && <span className="font-hud text-[11px] text-[#ff9c7a]">背包已滿</span>}
      </div>

      <div className="mb-3 p-2 border border-[#2a2e3d] bg-[#0e1018]">
        <div className="font-hud text-[11px] text-[#8d93a6] mb-1.5">
          裝備中 {equipped.length} / 4 · 裝備中的遺物不能直接存入，請先卸下到背包
        </div>
        {equipped.length === 0 ? (
          <div className="font-hud text-[11px] text-[#5d6377]">目前沒有裝備遺物</div>
        ) : (
          <div className="space-y-1">
            {equipped.map((item, idx) => {
              const css = getRarityCss(item.rarity);
              return (
                <div key={item.id} className="flex items-center justify-between gap-2" data-equipped-slot={idx}>
                  <span className={`font-hud text-[11px] font-bold truncate ${css.text}`}>
                    {item.name} <span className="text-[#9096a8] font-normal">Lv.{item.level}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (bagFull) {
                        setNotice({ text: '背包已滿，無法卸下；請先把背包遺物存入倉庫。', tone: 'error' });
                        return;
                      }
                      onUnequip(idx);
                      setNotice({ text: `已卸下「${item.name}」到背包`, tone: 'info' });
                    }}
                    className="px-2 py-0.5 border border-[#4f4635] bg-[#171923] font-hud text-[11px] text-[#d6ccb4] hover:border-[#c8a355] hover:text-[#fff2cc] cursor-pointer whitespace-nowrap shrink-0"
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2.5">
          {sortedBag.map((item) => (
            <RelicMiniCard
              key={item.id}
              item={item}
              heroClass={heroClass}
              action={
                <button
                  type="button"
                  data-action="deposit"
                  onClick={() => handleMove(onDeposit(item.id), `已存入「${item.name}」`)}
                  className="flex items-center gap-1 px-2.5 py-1 border border-[#5e523a] bg-[#1a1d28] font-hud text-[11px] font-semibold text-[#f0e2be] hover:border-[#d6b25e] hover:bg-[#272318] cursor-pointer whitespace-nowrap"
                >
                  存入倉庫 <ArrowLeftRight className="w-3 h-3 rotate-0" />
                </button>
              }
            />
          ))}
        </div>
      )}
    </section>
  );

  const stashPanel = (
    <section className={`${mobileTab === 'stash' ? 'block' : 'hidden'} lg:block min-w-0`} data-testid="stash-stash-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="font-hud text-xs font-semibold text-[#d4be8a] tracking-wide">
          倉庫 <span className="tabular-nums">{stash.length} / {stashCap}</span>
        </div>
        {stashFull && <span className="font-hud text-[11px] text-[#ff9c7a]">倉庫已滿</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <div className="flex flex-wrap items-center gap-1">
          {RARITY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setRarityFilter(tab.id)}
              className={`px-2 py-1 font-hud text-xs border transition-colors cursor-pointer whitespace-nowrap ${
                rarityFilter === tab.id
                  ? 'border-[#c8a355] bg-[#261f12] text-[#ffe5a3] font-semibold'
                  : 'border-[#2f3342] bg-[#131620] text-[#9096a8] hover:text-[#e6e1d3]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 font-hud text-xs text-[#9096a8]">
          套裝
          <select
            value={setFilter}
            onChange={(e) => setSetFilter(e.target.value)}
            className="bg-[#131620] border border-[#2f3342] text-[#e6e1d3] px-1.5 py-1 text-xs max-w-[9rem]"
          >
            <option value="all">全部</option>
            {setNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 font-hud text-xs text-[#9096a8]">
          排序
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="bg-[#131620] border border-[#2f3342] text-[#e6e1d3] px-1.5 py-1 text-xs"
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
          {stash.length === 0 ? '倉庫是空的。把背包裡暫時用不到的遺物存進來吧。' : '沒有符合篩選條件的遺物。'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2.5">
          {visibleStash.map((item) => (
            <RelicMiniCard
              key={item.id}
              item={item}
              heroClass={heroClass}
              action={
                <button
                  type="button"
                  data-action="withdraw"
                  onClick={() => handleMove(onWithdraw(item.id), `已取出「${item.name}」到背包`)}
                  className="flex items-center gap-1 px-2.5 py-1 border border-[#3e6a5a] bg-[#122019] font-hud text-[11px] font-semibold text-[#b9f2d6] hover:border-[#6ee0a8] hover:bg-[#183226] cursor-pointer whitespace-nowrap"
                >
                  取出到背包
                </button>
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
      <div className="w-[min(1100px,97vw)] max-h-[92vh] flex flex-col bg-[#0c0e15] border border-[#b89448]/85 shadow-[0_24px_64px_rgba(0,0,0,0.94)] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#342c1f] bg-[#10131d]">
          <div className="flex items-center gap-2 min-w-0">
            <Archive className="w-4 h-4 text-[#ffd566] shrink-0" />
            <h2
              id="stash-title"
              className="font-display text-base font-bold tracking-[0.14em] text-[#f5dc99] whitespace-nowrap"
            >
              城鎮倉庫
            </h2>
            <span className="font-hud text-xs text-[#9ea4b5] tabular-nums whitespace-nowrap">
              倉庫 {stash.length} / {stashCap}
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

        {/* Status line (aria-live so move results / "full" hints are announced) */}
        <div
          role="status"
          data-testid="stash-notice"
          className={`min-h-[28px] px-4 py-1.5 font-hud text-xs border-b border-[#232634] ${
            notice?.tone === 'error' ? 'text-[#ff9c7a] bg-[#2a1511]' : 'text-[#9fd9b8] bg-[#0e1612]'
          } ${notice ? '' : 'invisible'}`}
        >
          {notice?.text ?? ' '}
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

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-5">
          {bagPanel}
          {stashPanel}
        </div>

        <div className="px-4 py-2 border-t border-[#232634] bg-[#10131d] font-hud text-[11px] text-[#7d8396]">
          關閉倉庫時會自動存檔 · 倉庫內不能出售遺物 · 按 Esc 關閉
        </div>
      </div>
    </div>
  );
}
