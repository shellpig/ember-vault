import { useMemo, useState } from 'react';
import { Coins, Gem, Shield, Sparkles, X } from 'lucide-react';
import {
  ActiveSetBonus,
  RelicItem,
  RelicRarity,
  RelicSummaryStats,
  SET_RELIC_CATALOG,
  UNIQUE_RELIC_CATALOG,
  formatMaxHpStatForClass,
  formatRelicStat,
  formatStatRange,
  getRarityCss,
  getRarityLabel,
  getUniqueEffectDescForClass,
} from '../game/relics';
import type { HeroClassId } from '../game/classes';

function MageHpNote({ value, heroClass }: { value: number; heroClass: HeroClassId }) {
  const note = formatMaxHpStatForClass(value, heroClass);
  if (!note) return null;
  return <div className="text-[9px] text-[#8ecbff]/80">{note}</div>;
}

interface RelicEquipmentModalProps {
  equipped: RelicItem[];
  bag: RelicItem[];
  bagCap: number;
  relicStats: RelicSummaryStats;
  activeSets: ActiveSetBonus[];
  nearShop: boolean;
  onEquip: (relicId: string, replaceSlotIndex?: number) => void;
  onUnequip: (slotIndex: number) => void;
  onSell: (relicId: string) => void;
  onSellCommon: () => void;
  onClose: () => void;
  heroClass?: HeroClassId;
}

const RARITY_ORDER: Record<RelicRarity, number> = {
  orange: 0,
  green: 1,
  yellow: 2,
  blue: 3,
};

export function RelicEquipmentModal({
  equipped,
  bag,
  bagCap,
  relicStats,
  activeSets,
  nearShop,
  onEquip,
  onUnequip,
  onSell,
  onSellCommon,
  onClose,
  heroClass = 'warrior',
}: RelicEquipmentModalProps) {
  const [filter, setFilter] = useState<'all' | RelicRarity>('all');
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);

  const sortedBag = useMemo(() => {
    const list = filter === 'all' ? bag : bag.filter((r) => r.rarity === filter);
    return [...list].sort(
      (a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || b.level - a.level
    );
  }, [bag, filter]);

  const commonSellTotal = useMemo(
    () =>
      bag
        .filter((r) => r.rarity === 'blue' || r.rarity === 'yellow')
        .reduce((sum, r) => sum + r.sellValue, 0),
    [bag]
  );

  const summaryItems = useMemo(() => {
    const rows: Array<{ label: string; value: string; note?: string }> = [];
    if (relicStats.atkPct > 0) rows.push({ label: '攻擊力', value: `+${relicStats.atkPct}%` });
    if (relicStats.critPct > 0) rows.push({ label: '暴擊率', value: `+${relicStats.critPct}%` });
    if (relicStats.critDmgPct > 0)
      rows.push({ label: '暴擊傷害', value: `+${relicStats.critDmgPct}%` });
    if (relicStats.maxHp > 0) rows.push({
        label: '血量上限',
        value: `+${relicStats.maxHp}`,
        note: formatMaxHpStatForClass(relicStats.maxHp, heroClass) ?? undefined,
      });
    if (relicStats.damageReduction > 0)
      rows.push({ label: '受傷害', value: `-${relicStats.damageReduction}` });
    if (relicStats.blockPct > 0) rows.push({ label: '格擋率', value: `${relicStats.blockPct}%` });
    if (relicStats.eliteBossDmgPct > 0)
      rows.push({ label: '菁英/Boss增傷', value: `+${relicStats.eliteBossDmgPct}%` });
    if (relicStats.goldPct > 0) rows.push({ label: '金幣獲取', value: `+${relicStats.goldPct}%` });
    if (relicStats.dropRatePct > 0)
      rows.push({ label: '掉寶率', value: `+${relicStats.dropRatePct}%` });
    if (relicStats.moveSpeedPct > 0)
      rows.push({ label: '移動速度', value: `+${relicStats.moveSpeedPct}%` });
    if (relicStats.dashCdPct > 0)
      rows.push({ label: '衝刺冷卻', value: `-${relicStats.dashCdPct}%` });
    if (relicStats.lifeOnKill > 0)
      rows.push({ label: '擊殺回血', value: `+${relicStats.lifeOnKill}` });
    if (relicStats.potionHealPct > 0)
      rows.push({ label: '藥水回復', value: `+${relicStats.potionHealPct}%` });
    if (relicStats.thorns > 0) rows.push({ label: '荊棘反傷', value: `+${relicStats.thorns}` });
    return rows;
  }, [relicStats]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="relic-vault-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#06070c]/82 p-4 pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(980px,95vw)] max-h-[88vh] flex flex-col bg-[#0c0e15] border border-[#b89448]/85 shadow-[0_24px_64px_rgba(0,0,0,0.94)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-[#342c1f] bg-[#10131d]">
          <div className="flex items-baseline gap-3 min-w-0">
            <h2
              id="relic-vault-title"
              className="font-display text-base font-bold tracking-[0.14em] text-[#f5dc99] whitespace-nowrap"
            >
              遺物裝備欄
            </h2>
            <div className="flex items-center gap-2 font-hud text-xs text-[#9ea4b5] tabular-nums whitespace-nowrap">
              <span>已裝備 {equipped.length} / 4</span>
              <span aria-hidden="true">·</span>
              <span>
                背包 {bag.length} / {bagCap}
              </span>
              {nearShop && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#ff8fb4]">藥水商店範圍內（可出售）</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉遺物裝備欄"
            className="p-1.5 border border-[#4a3e2a] bg-[#171a26] text-[#c7b68d] hover:border-[#d6b25e] hover:text-[#fff0c4] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Equipped 4 Slots */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <div className="font-hud text-xs font-semibold text-[#d4be8a] tracking-wide">
                已裝備遺物（最多 4 件 · 不分部位）
              </div>
              {swapTargetId && (
                <div className="flex items-center gap-2 font-hud text-xs text-[#ffae66]">
                  <span>請點擊下方欲替換的欄位</span>
                  <button
                    type="button"
                    onClick={() => setSwapTargetId(null)}
                    className="px-2 py-0.5 border border-[#6e5a34] bg-[#1b1710] text-[#e8d5a3] hover:border-[#d6b25e] cursor-pointer whitespace-nowrap"
                  >
                    取消替換
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((slotIdx) => {
                const item = equipped[slotIdx];
                if (!item) {
                  return (
                    <div
                      key={slotIdx}
                      className="min-h-[146px] flex flex-col items-center justify-center border border-dashed border-[#34384a] bg-[#0e1119] p-3 text-center"
                    >
                      <Gem className="w-5 h-5 text-[#43495e] mb-1.5" />
                      <div className="font-hud text-xs text-[#697085]">遺物欄位 {slotIdx + 1}</div>
                      <div className="font-hud text-[11px] text-[#4c5266] mt-0.5">尚未裝備</div>
                    </div>
                  );
                }

                const css = getRarityCss(item.rarity);
                const isSwapHighlight = Boolean(swapTargetId);

                return (
                  <div
                    key={item.id}
                    className={`min-h-[146px] flex flex-col justify-between border p-3 transition-colors ${css.bg} ${
                      isSwapHighlight
                        ? 'border-[#ff9c42] ring-1 ring-[#ff9c42]/50'
                        : css.border
                    }`}
                  >
                    <div>
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className={`font-hud text-xs font-bold truncate ${css.text}`}>
                          {item.name}
                        </span>
                        <span className="font-hud text-[10px] text-[#a5aab8] tabular-nums shrink-0">
                          Lv.{item.level}
                        </span>
                      </div>
                      <div className="font-hud text-[10px] text-[#9096a8] mb-2">
                        {getRarityLabel(item.rarity)}
                        {item.setName ? ` · ${item.setName}` : ''}
                      </div>
                      <div className="space-y-0.5 font-hud text-[11px] text-[#e8e4da] tabular-nums">
                        {item.stats.map((s, idx) => (
                          <div key={idx}>
                            {formatRelicStat(s)}
                            {s.key === 'maxHp' && <MageHpNote value={s.value} heroClass={heroClass} />}
                          </div>
                        ))}
                      </div>
                      {item.uniqueEffectTitle && (
                        <div className="mt-2 pt-1.5 border-t border-[#4f3018] font-hud text-[10px] leading-relaxed text-[#ffb878]">
                          <span className="font-bold">【{item.uniqueEffectTitle}】</span>
                          {item.uniqueEffectId
                            ? getUniqueEffectDescForClass(item.uniqueEffectId, heroClass)
                            : item.uniqueEffectDesc}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                      {isSwapHighlight ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (swapTargetId) {
                              onEquip(swapTargetId, slotIdx);
                              setSwapTargetId(null);
                            }
                          }}
                          className="w-full px-2.5 py-1 border border-[#ff9c42] bg-[#361d0b] font-hud text-xs font-bold text-[#ffd2a1] hover:bg-[#4a2810] transition-colors cursor-pointer whitespace-nowrap"
                        >
                          替換欄位 {slotIdx + 1}
                        </button>
                      ) : (
                        <>
                          <span className="font-hud text-[10px] text-[#8d93a6] tabular-nums">
                            欄位 {slotIdx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => onUnequip(slotIdx)}
                            disabled={bag.length >= bagCap}
                            className="px-2.5 py-1 border border-[#4f4635] bg-[#171923] font-hud text-[11px] text-[#d6ccb4] hover:border-[#c8a355] hover:text-[#fff2cc] disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            卸下
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Active Set Bonuses & Aggregated Relic Stats */}
          {(activeSets.length > 0 || summaryItems.length > 0) && (
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-[#262936]">
              {/* Aggregated Stat Summary */}
              <div>
                <div className="font-hud text-xs font-semibold text-[#c7b68d] mb-2">
                  遺物總屬性加成
                </div>
                {summaryItems.length === 0 ? (
                  <div className="font-hud text-xs text-[#6f7588]">尚無數值加成</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 font-hud text-xs tabular-nums">
                    {summaryItems.map((row) => (
                      <div key={row.label}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[#949aaf] truncate">{row.label}</span>
                          <span className="text-[#f2e2b6] font-semibold shrink-0">{row.value}</span>
                        </div>
                        {row.note && <div className="text-[9px] text-[#8ecbff]/80">{row.note}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active Set Progress */}
              <div>
                <div className="font-hud text-xs font-semibold text-[#6cf2a3] mb-2">
                  套裝效果啟動狀態
                </div>
                {activeSets.length === 0 ? (
                  <div className="font-hud text-xs text-[#6f7588]">
                    裝備同系列綠色套裝遺物達 2 / 3 / 4 件即可啟動套裝效果。
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activeSets.map((set) => (
                      <div
                        key={set.setId}
                        className="border border-[#24593a] bg-[#0b1912] p-2.5"
                      >
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className="font-hud text-xs font-bold text-[#66f7a4]">
                            {set.setName}
                          </span>
                          <span className="font-hud text-[11px] text-[#9fd9b8] tabular-nums">
                            {set.equippedCount} / 4 件
                          </span>
                        </div>
                        <div className="space-y-1 font-hud text-[11px]">
                          {set.bonuses.map((b) => (
                            <div
                              key={b.required}
                              className={b.active ? 'text-[#d9ffe8]' : 'text-[#5b7365]'}
                            >
                              <span className="font-semibold">
                                ({b.required}件) {b.title}：
                              </span>
                              <span>{b.desc}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Relic Bag */}
          <section className="pt-3 border-t border-[#262936]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: `全部 (${bag.length})` },
                    { id: 'orange', label: '獨特' },
                    { id: 'green', label: '套裝' },
                    { id: 'yellow', label: '高級' },
                    { id: 'blue', label: '普通' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`px-2.5 py-1 font-hud text-xs border transition-colors cursor-pointer whitespace-nowrap ${
                      filter === tab.id
                        ? 'border-[#c8a355] bg-[#261f12] text-[#ffe5a3] font-semibold'
                        : 'border-[#2f3342] bg-[#131620] text-[#9096a8] hover:text-[#e6e1d3]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {nearShop && commonSellTotal > 0 && (
                <button
                  type="button"
                  onClick={onSellCommon}
                  className="flex items-center gap-1.5 px-3 py-1 border border-[#a87c32] bg-[#261d0e] font-hud text-xs font-semibold text-[#ffd773] hover:border-[#f0c75e] hover:bg-[#332712] transition-colors cursor-pointer whitespace-nowrap tabular-nums"
                >
                  <Coins className="w-3.5 h-3.5 text-[#ffd25a]" />
                  <span>一鍵賣出藍/黃遺物 (+{commonSellTotal} G)</span>
                </button>
              )}
            </div>

            {sortedBag.length === 0 ? (
              <div className="py-10 text-center font-hud text-xs text-[#70768a] border border-[#232634] bg-[#0e1018]">
                {bag.length === 0
                  ? '背包目前沒有遺物。擊敗怪物、開啟木箱或挑戰菁英怪與 Boss 來獲取遺物！'
                  : '此稀有度篩選下沒有遺物。'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedBag.map((item) => {
                  const css = getRarityCss(item.rarity);
                  const isPendingSwap = swapTargetId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col justify-between border p-3 ${css.bg} ${
                        isPendingSwap ? 'border-[#ff9c42] ring-1 ring-[#ff9c42]' : css.border
                      }`}
                    >
                      <div>
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className={`font-hud text-xs font-bold truncate ${css.text}`}>
                            {item.name}
                          </span>
                          <span className="font-hud text-[10px] text-[#a5aab8] tabular-nums shrink-0">
                            Lv.{item.level}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 font-hud text-[10px] text-[#8d93a6] mb-2">
                          <span className="truncate">
                            {getRarityLabel(item.rarity)}
                            {item.setName ? ` · ${item.setName}` : ''}
                          </span>
                          <span className="text-[#d9b65b] tabular-nums shrink-0">
                            售價 {item.sellValue}G
                          </span>
                        </div>
                        <div className="space-y-0.5 font-hud text-[11px] text-[#ebe7dc] tabular-nums">
                          {item.stats.map((s, idx) => (
                            <div key={idx}>
                              {formatRelicStat(s)}
                              {s.key === 'maxHp' && <MageHpNote value={s.value} heroClass={heroClass} />}
                            </div>
                          ))}
                        </div>
                        {item.uniqueEffectTitle && (
                          <div className="mt-2 pt-1.5 border-t border-[#4f3018] font-hud text-[10px] leading-relaxed text-[#ffb878]">
                            <span className="font-bold">【{item.uniqueEffectTitle}】</span>
                            {item.uniqueEffectId
                            ? getUniqueEffectDescForClass(item.uniqueEffectId, heroClass)
                            : item.uniqueEffectDesc}
                          </div>
                        )}
                      </div>

                      <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-end gap-2">
                        {nearShop && (
                          <button
                            type="button"
                            onClick={() => {
                              if (swapTargetId === item.id) setSwapTargetId(null);
                              onSell(item.id);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 border border-[#785928] bg-[#21190d] font-hud text-[11px] font-semibold text-[#ffd266] hover:border-[#e6b953] hover:bg-[#302412] transition-colors cursor-pointer whitespace-nowrap tabular-nums"
                          >
                            <Coins className="w-3 h-3" />
                            <span>賣出 +{item.sellValue}G</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (equipped.length < 4) {
                              onEquip(item.id);
                            } else {
                              setSwapTargetId((prev) => (prev === item.id ? null : item.id));
                            }
                          }}
                          className={`px-3 py-1 border font-hud text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            isPendingSwap
                              ? 'border-[#ff9c42] bg-[#3b1f0b] text-[#ffd4a6]'
                              : 'border-[#5e523a] bg-[#1a1d28] text-[#f0e2be] hover:border-[#d6b25e] hover:bg-[#272318]'
                          }`}
                        >
                          {equipped.length < 4 ? '裝備' : isPendingSwap ? '選擇上方欄位' : '替換裝備'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

interface RelicCompendiumModalProps {
  discoveredIds: string[];
  onClose: () => void;
  heroClass?: HeroClassId;
}

export function RelicCompendiumModal({
  discoveredIds,
  onClose,
  heroClass = 'warrior',
}: RelicCompendiumModalProps) {
  const [tab, setTab] = useState<'orange' | 'green'>('orange');
  const discoveredSet = useMemo(() => new Set(discoveredIds), [discoveredIds]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="relic-codex-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#06070c]/84 p-4 pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(1020px,95vw)] max-h-[88vh] flex flex-col bg-[#0c0e15] border border-[#c99b44]/90 shadow-[0_24px_64px_rgba(0,0,0,0.95)] overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[#342c1f] bg-[#10131d]">
          <div className="flex items-baseline gap-3">
            <h2
              id="relic-codex-title"
              className="font-display text-base font-bold tracking-[0.14em] text-[#f5dc99] whitespace-nowrap"
            >
              遺物秘典
            </h2>
            <span className="font-hud text-xs text-[#949aaf]">
              獨特與套裝遺物目錄 · 數值範圍依掉落層數（遺物等級）浮動
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center border border-[#3a3428] bg-[#151822] p-0.5">
              <button
                type="button"
                onClick={() => setTab('orange')}
                className={`px-3 py-1 font-hud text-xs transition-colors cursor-pointer whitespace-nowrap ${
                  tab === 'orange'
                    ? 'bg-[#b85318] text-[#fff2e6] font-bold'
                    : 'text-[#a3a8b8] hover:text-[#ffd2ad]'
                }`}
              >
                獨特遺物（橘 · {UNIQUE_RELIC_CATALOG.length}）
              </button>
              <button
                type="button"
                onClick={() => setTab('green')}
                className={`px-3 py-1 font-hud text-xs transition-colors cursor-pointer whitespace-nowrap ${
                  tab === 'green'
                    ? 'bg-[#1f8a4c] text-[#ecfff4] font-bold'
                    : 'text-[#a3a8b8] hover:text-[#9effc7]'
                }`}
              >
                套裝遺物（綠 · {SET_RELIC_CATALOG.length} 套）
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="關閉遺物秘典"
              className="p-1.5 border border-[#4a3e2a] bg-[#171a26] text-[#c7b68d] hover:border-[#d6b25e] hover:text-[#fff0c4] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'orange' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {UNIQUE_RELIC_CATALOG.map((u, idx) => {
                const found = discoveredSet.has(u.templateId);
                return (
                  <div
                    key={u.templateId}
                    className="border border-[#9e4c18] bg-[#1a110b] p-3.5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-hud text-[11px] text-[#9e6f4a] tabular-nums">
                            {String(idx + 1).padStart(2, '0')}.
                          </span>
                          <span className="font-hud text-sm font-bold text-[#ff9b4a] truncate">
                            {u.name}
                          </span>
                        </div>
                        <span
                          className={`font-hud text-[10px] shrink-0 ${
                            found ? 'text-[#6cf2a3]' : 'text-[#6b7082]'
                          }`}
                        >
                          {found ? '本局已獲得' : '尚未獲得'}
                        </span>
                      </div>

                      <div className="font-hud text-[11px] text-[#998c7e] italic mb-2.5">
                        「{u.flavor}」
                      </div>

                      <div className="space-y-1 font-hud text-xs text-[#ece5d5] tabular-nums mb-2.5">
                        {u.statKeys.map((k) => (
                          <div key={k} className="flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3 text-[#ff9b4a] shrink-0" />
                            <span>
                              {formatStatRange(k)}
                              {k === 'maxHp' && heroClass === 'frost_mage' && (
                                <span className="ml-1 text-[9px] text-[#8ecbff]/80">（法師：30% HP / 70% 護盾）</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#4a2812] font-hud text-xs leading-relaxed text-[#ffc994]">
                      <span className="font-bold text-[#ff9b4a]">獨特能力【{u.uniqueEffectTitle}】：</span>
                      <span>{getUniqueEffectDescForClass(u.uniqueEffectId, heroClass)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-5">
              {SET_RELIC_CATALOG.map((set, setIdx) => (
                <div
                  key={set.setId}
                  className="border border-[#277a4a] bg-[#0b1811] p-4 space-y-3.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#1c4a30] pb-2.5">
                    <div className="flex items-baseline gap-2.5">
                      <span className="font-hud text-xs text-[#549e72] tabular-nums">
                        套裝 0{setIdx + 1}
                      </span>
                      <h3 className="font-display text-sm font-bold tracking-wider text-[#5cf29c]">
                        {set.name}
                      </h3>
                    </div>
                    <span className="font-hud text-xs text-[#8eb89f]">{set.themeDesc}</span>
                  </div>

                  {/* 4 Set Pieces */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {set.pieces.map((p) => {
                      const found = discoveredSet.has(p.templateId);
                      return (
                        <div
                          key={p.templateId}
                          className="border border-[#215939] bg-[#102419] p-2.5 flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-baseline justify-between gap-1 mb-1">
                              <span className="font-hud text-xs font-bold text-[#73ffad] truncate">
                                {p.name}
                              </span>
                              <span
                                className={`font-hud text-[10px] shrink-0 ${
                                  found ? 'text-[#ffd85c]' : 'text-[#5a7565]'
                                }`}
                              >
                                {found ? '已獲' : '未獲'}
                              </span>
                            </div>
                            <div className="font-hud text-[10px] text-[#7ca38c] mb-2">
                              {p.flavor}
                            </div>
                            <div className="space-y-0.5 font-hud text-[11px] text-[#e3f5ea] tabular-nums">
                              {p.statKeys.map((k) => (
                                <div key={k}>{formatStatRange(k)}</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 2 / 3 / 4 Set Bonuses */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
                    {set.bonuses.map((b) => (
                      <div
                        key={b.required}
                        className={`border p-2.5 font-hud text-xs ${
                          b.required === 4
                            ? 'border-[#3ec476] bg-[#132e1f] text-[#e3ffef]'
                            : 'border-[#1f4f33] bg-[#0e2016] text-[#c7ebd6]'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-[#66f7a4] mb-1">
                          <Shield className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {b.required} 件套 · {b.title}
                          </span>
                        </div>
                        <div className="text-[11px] leading-relaxed">{b.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
