import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Check, Coins, X } from 'lucide-react';
import type { RelicItem } from '../game/relics';
import type { HeroClassId } from '../game/classes';
import type { TradeSideView } from '../../shared/room';
import { MAX_TRADE_RELICS, type TradeOfferItem, type TradeSource } from '../../shared/trade';
import { RelicMiniCard, compareRarityLevel } from './StashModal';

export interface TradeOfferDraft {
  gold: number;
  relics: TradeOfferItem[];
}

interface TradeModalProps {
  heroClass: HeroClassId;
  partnerName: string;
  /** My own tradable containers (equipped relics cannot be traded). */
  bag: RelicItem[];
  stash: RelicItem[];
  gold: number;
  mine: TradeSideView;
  theirs: TradeSideView;
  notice: { text: string; tone: 'info' | 'error' } | null;
  /** Both confirmed: the server is executing the trade, nothing can change any more. */
  busy: boolean;
  onOffer: (offer: TradeOfferDraft) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatGold(n: number): string {
  return n.toLocaleString('en-US');
}

/** P6 town trade window: both offers side by side, my bag / stash below to pick from. */
export function TradeModal({
  heroClass,
  partnerName,
  bag,
  stash,
  gold,
  mine,
  theirs,
  notice,
  busy,
  onOffer,
  onConfirm,
  onCancel,
}: TradeModalProps) {
  const [tab, setTab] = useState<TradeSource>('bag');
  const [goldDraft, setGoldDraft] = useState(String(mine.gold));
  useEffect(() => setGoldDraft(String(mine.gold)), [mine.gold]);

  const offeredIds = useMemo(() => new Set(mine.relics.map((r) => r.id)), [mine.relics]);
  const source = tab === 'bag' ? bag : stash;
  const pickable = useMemo(() => source.filter((r) => !offeredIds.has(r.id)).sort(compareRarityLevel), [source, offeredIds]);

  const current = (): TradeOfferDraft => ({
    gold: mine.gold,
    relics: mine.relics.map((r) => ({ id: r.id, from: r.from })),
  });
  const addRelic = (id: string, from: TradeSource) => {
    const o = current();
    onOffer({ ...o, relics: [...o.relics, { id, from }] });
  };
  const removeRelic = (id: string) => {
    const o = current();
    onOffer({ ...o, relics: o.relics.filter((r) => r.id !== id) });
  };
  const commitGold = () => {
    const n = Math.max(0, Math.min(gold, Math.floor(Number(goldDraft) || 0)));
    setGoldDraft(String(n));
    if (n !== mine.gold) onOffer({ ...current(), gold: n });
  };

  const emptyTrade = mine.gold === 0 && mine.relics.length === 0 && theirs.gold === 0 && theirs.relics.length === 0;
  const atLimit = mine.relics.length >= MAX_TRADE_RELICS;

  const confirmBadge = (confirmed: boolean) => (
    <span
      className={`inline-flex items-center gap-1 px-1.5 border font-hud text-[10px] ${
        confirmed ? 'border-[#4e8a5c] text-[#9fe9b8]' : 'border-[#4a4f60] text-[#8d93a6]'
      }`}
    >
      {confirmed && <Check className="w-3 h-3" />}
      {confirmed ? '已確認' : '尚未確認'}
    </span>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trade-title"
      data-testid="trade-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#06070c]/84 p-2 sm:p-4 pointer-events-auto"
    >
      <div className="w-[min(1100px,97vw)] max-h-[92vh] flex flex-col bg-[#0c0e15] border border-[#b89448]/85 shadow-[0_24px_64px_rgba(0,0,0,0.94)] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#342c1f] bg-[#10131d]">
          <div className="flex items-center gap-2 min-w-0">
            <ArrowLeftRight className="w-4 h-4 text-[#ffd566] shrink-0" />
            <h2 id="trade-title" className="font-display text-base font-bold tracking-[0.14em] text-[#f5dc99] truncate">
              與 {partnerName} 交易
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="取消交易"
            data-testid="trade-close"
            className="p-1.5 border border-[#4a3e2a] bg-[#171a26] text-[#c7b68d] hover:border-[#d6b25e] hover:text-[#fff0c4] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          role="status"
          data-testid="trade-notice"
          className={`min-h-[28px] px-4 py-1.5 font-hud text-xs border-b border-[#232634] ${
            notice?.tone === 'error' ? 'text-[#ff9c7a] bg-[#2a1511]' : 'text-[#9fd9b8] bg-[#0e1612]'
          } ${notice ? '' : 'invisible'}`}
        >
          {notice?.text ?? ' '}
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section data-testid="trade-mine" className="min-w-0 border border-[#2a2e3d] bg-[#0e1018] p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-hud text-xs font-semibold text-[#d4be8a] tracking-wide">
                  我的提供（{mine.relics.length} / {MAX_TRADE_RELICS}）
                </div>
                {confirmBadge(mine.confirmed)}
              </div>
              <label className="flex items-center gap-2 mb-3 font-hud text-xs text-[#9096a8]">
                <Coins className="w-3.5 h-3.5 text-[#f7cb52]" />
                金幣
                <input
                  type="number"
                  min={0}
                  max={gold}
                  value={goldDraft}
                  disabled={busy}
                  data-testid="trade-gold-input"
                  onChange={(e) => setGoldDraft(e.target.value)}
                  onBlur={commitGold}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitGold();
                  }}
                  className="w-32 bg-[#131620] border border-[#2f3342] text-[#e6e1d3] px-1.5 py-1 text-xs tabular-nums"
                />
                <span className="tabular-nums">/ {formatGold(gold)}</span>
              </label>
              {mine.relics.length === 0 ? (
                <div className="py-5 text-center font-hud text-xs text-[#70768a] border border-[#232634]">
                  從下方挑選要交易的遺物
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {mine.relics.map((r) => (
                    <RelicMiniCard
                      key={r.id}
                      item={r.item}
                      heroClass={heroClass}
                      action={
                        <button
                          type="button"
                          disabled={busy}
                          data-action="remove-offer"
                          onClick={() => removeRelic(r.id)}
                          className="px-2.5 py-1 border border-[#6a4040] bg-[#201315] font-hud text-[11px] font-semibold text-[#f2c4c4] hover:border-[#e08080] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          移除
                        </button>
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            <section data-testid="trade-theirs" className="min-w-0 border border-[#2a2e3d] bg-[#0e1018] p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-hud text-xs font-semibold text-[#d4be8a] tracking-wide truncate">
                  {partnerName} 的提供（{theirs.relics.length}）
                </div>
                {confirmBadge(theirs.confirmed)}
              </div>
              <div className="flex items-center gap-2 mb-3 font-hud text-xs text-[#9096a8]">
                <Coins className="w-3.5 h-3.5 text-[#f7cb52]" />
                金幣
                <span data-testid="trade-their-gold" className="tabular-nums text-[#f5dc99]">
                  {formatGold(theirs.gold)}
                </span>
              </div>
              {theirs.relics.length === 0 ? (
                <div className="py-5 text-center font-hud text-xs text-[#70768a] border border-[#232634]">
                  對方尚未放入遺物
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {theirs.relics.map((r) => (
                    <RelicMiniCard key={r.id} item={r.item} heroClass={heroClass} action={null} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <section data-testid="trade-picker" className="min-w-0">
            <div className="flex items-center gap-1 mb-2">
              {(
                [
                  { id: 'bag', label: `背包 ${bag.length}` },
                  { id: 'stash', label: `倉庫 ${stash.length}` },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1 font-hud text-xs border cursor-pointer ${
                    tab === t.id
                      ? 'border-[#c8a355] bg-[#261f12] text-[#ffe5a3] font-semibold'
                      : 'border-[#2f3342] bg-[#131620] text-[#9096a8] hover:text-[#e6e1d3]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <span className="ml-2 font-hud text-[11px] text-[#7d8396]">裝備中的遺物不能交易</span>
            </div>
            {pickable.length === 0 ? (
              <div className="py-6 text-center font-hud text-xs text-[#70768a] border border-[#232634] bg-[#0e1018]">
                {tab === 'bag' ? '背包沒有可放入的遺物' : '倉庫沒有可放入的遺物'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {pickable.map((item) => (
                  <RelicMiniCard
                    key={item.id}
                    item={item}
                    heroClass={heroClass}
                    action={
                      <button
                        type="button"
                        disabled={busy || atLimit}
                        data-action="add-offer"
                        onClick={() => addRelic(item.id, tab)}
                        className="px-2.5 py-1 border border-[#3e6a5a] bg-[#122019] font-hud text-[11px] font-semibold text-[#b9f2d6] hover:border-[#6ee0a8] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        放入交易
                      </button>
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-[#232634] bg-[#10131d]">
          <div className="font-hud text-[11px] text-[#7d8396]">
            {busy
              ? '雙方都已確認，伺服器處理中…'
              : '任何一方修改內容，雙方都要重新確認 · 交易期間暫停存檔與背包操作'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              data-testid="trade-cancel"
              className="px-3 py-1.5 border border-[#4a3e2a] bg-[#171a26] font-hud text-xs text-[#c7b68d] hover:border-[#d6b25e] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              取消交易
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || mine.confirmed || emptyTrade}
              data-testid="trade-confirm"
              className="px-4 py-1.5 border border-[#c8a355] bg-[#261f12] font-hud text-xs font-semibold text-[#ffe5a3] hover:bg-[#33290f] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {mine.confirmed ? '等待對方確認' : '確認交易'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
