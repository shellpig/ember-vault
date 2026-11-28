import { useMemo, useState } from 'react';
import { BookOpen, Sparkles, X } from 'lucide-react';
import {
  CODEX_BONUS_KEYS,
  CODEX_BONUS_LABEL,
  CODEX_BONUS_VALUE,
  CODEX_ENTRIES,
  SET_RELIC_CATALOG,
  computeCodexBonus,
  formatStatRange,
  getRarityCss,
  getRarityLabel,
  getUniqueEffectDescForClass,
  getUniqueEffectInactiveNote,
  isCodexRelic,
} from '../game/relics';
import type { CodexBonusKey, CodexEntry, RelicItem } from '../game/relics';
import type { HeroClassId } from '../game/classes';
import type { CodexDonateResult } from '../game/engine';

const BONUS_COLOR: Record<CodexBonusKey, string> = {
  hpPct: 'text-[#ff8f8f]',
  atkPct: 'text-[#ffb46b]',
  critPct: 'text-[#ffe066]',
  goldPct: 'text-[#8ef5a8]',
};

const BONUS_SHORT: Record<CodexBonusKey, string> = { hpPct: 'HP', atkPct: '攻擊', critPct: '暴擊', goldPct: '金幣' };

function formatBonusValue(value: number): string {
  return `+${Number(value.toFixed(2))}%`;
}

function CodexBonusBadge({ bonus }: { bonus: CodexBonusKey }) {
  return (
    <span className={`font-hud text-[10px] font-bold ${BONUS_COLOR[bonus]}`}>
      永久 {CODEX_BONUS_LABEL[bonus]} {formatBonusValue(CODEX_BONUS_VALUE[bonus])}
    </span>
  );
}

function CodexEntryCard({ entry, found, heroClass }: { entry: CodexEntry; found: boolean; heroClass: HeroClassId }) {
  const css = getRarityCss(entry.rarity);
  if (!found) {
    return (
      <div
        data-testid="codex-entry-unknown"
        className={`border ${css.border} bg-[#0d0f16] p-3 flex flex-col items-center justify-center min-h-[96px] opacity-80`}
      >
        <span className={`font-display text-3xl leading-none ${css.text} opacity-40`}>？</span>
        <span className="mt-1.5 font-hud text-[10px] text-[#5f6578]">{getRarityLabel(entry.rarity)} · 尚未收錄</span>
      </div>
    );
  }
  return (
    <div data-testid="codex-entry-found" data-template-id={entry.templateId} className={`border ${css.border} ${css.bg} p-2.5 flex flex-col gap-1.5`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-hud text-xs font-bold truncate ${css.text}`}>{entry.name}</span>
        <span className="font-hud text-[9px] text-[#8d93a6] shrink-0">{getRarityLabel(entry.rarity)}</span>
      </div>
      <div className="space-y-0.5 font-hud text-[10px] text-[#e5e0d4] tabular-nums">
        {entry.statKeys.map((k) => (
          <div key={k}>{formatStatRange(k)}</div>
        ))}
      </div>
      {entry.uniqueEffectTitle && entry.uniqueEffectId && (
        <div
          className={`font-hud text-[10px] leading-snug ${
            getUniqueEffectInactiveNote(entry.uniqueEffectId, heroClass) ? 'text-[#7d8394]' : 'text-[#ffc994]'
          }`}
        >
          <span className="font-bold text-[#ff9b4a]">【{entry.uniqueEffectTitle}】</span>
          {getUniqueEffectDescForClass(entry.uniqueEffectId, heroClass)}
          {getUniqueEffectInactiveNote(entry.uniqueEffectId, heroClass)}
        </div>
      )}
      {entry.setName && (
        <div className="font-hud text-[10px] text-[#8ef5a8]">
          {entry.setName} · 第 {(entry.pieceIndex ?? 0) + 1} 件
        </div>
      )}
      <div className="font-hud text-[10px] italic text-[#8f8878] leading-snug">「{entry.flavor}」</div>
      <div className="mt-auto pt-1 border-t border-white/10 flex items-center gap-1">
        <Sparkles className="w-3 h-3 text-[#c99bff] shrink-0" />
        <CodexBonusBadge bonus={entry.codexBonus} />
      </div>
    </div>
  );
}

interface DonateRowProps {
  item: RelicItem;
  from: 'bag' | 'stash';
  registered: boolean;
  confirmId: string | null;
  setConfirmId: (id: string | null) => void;
  onDonate: (item: RelicItem, from: 'bag' | 'stash') => void;
}

function DonateRow({ item, from, registered, confirmId, setConfirmId, onDonate }: DonateRowProps) {
  const css = getRarityCss(item.rarity);
  const needsConfirm = item.rarity === 'orange';
  const confirming = confirmId === item.id;
  return (
    <div className={`flex items-center justify-between gap-2 border ${css.border} ${css.bg} px-2 py-1.5`}>
      <div className="min-w-0">
        <div className={`font-hud text-[11px] font-bold truncate ${css.text}`}>{item.name}</div>
        <div className="font-hud text-[9px] text-[#8d93a6]">
          {getRarityLabel(item.rarity)} · L{item.level}
        </div>
      </div>
      {registered ? (
        <button
          type="button"
          disabled
          className="shrink-0 px-2 py-1 border border-[#3a3f4f] bg-[#161923] font-hud text-[10px] text-[#6b7082] cursor-not-allowed"
        >
          已收錄
        </button>
      ) : (
        <button
          type="button"
          data-testid={`codex-donate-${item.id}`}
          onClick={() => {
            if (needsConfirm && !confirming) {
              setConfirmId(item.id);
              return;
            }
            setConfirmId(null);
            onDonate(item, from);
          }}
          onMouseLeave={() => {
            if (confirming) setConfirmId(null);
          }}
          className={`shrink-0 px-2 py-1 border font-hud text-[10px] font-bold cursor-pointer transition-colors ${
            confirming
              ? 'border-[#ff7a7a] bg-[#3a1414] text-[#ffd0d0]'
              : 'border-[#9a6cff] bg-[#1f1535] text-[#e3d0ff] hover:border-[#d0b0ff] hover:bg-[#2c1c4a]'
          }`}
        >
          {confirming ? '確認交出？' : '交給商人'}
        </button>
      )}
    </div>
  );
}

interface CodexModalProps {
  heroClass: HeroClassId;
  codexIds: string[];
  bag: RelicItem[];
  stash: RelicItem[];
  onDonate: (relicId: string, from: 'bag' | 'stash') => CodexDonateResult;
  onClose: () => void;
}

export function CodexModal({ heroClass, codexIds, bag, stash, onDonate, onClose }: CodexModalProps) {
  const registered = useMemo(() => new Set(codexIds), [codexIds]);
  const bonus = useMemo(() => computeCodexBonus(codexIds), [codexIds]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const orangeEntries = CODEX_ENTRIES.filter((e) => e.rarity === 'orange');
  const donatableBag = bag.filter(isCodexRelic);
  const donatableStash = stash.filter(isCodexRelic);

  const donate = (item: RelicItem, from: 'bag' | 'stash') => {
    const res = onDonate(item.id, from);
    if (res.ok) setNotice(`圖鑑收錄：${res.name}`);
    else if (res.reason === 'registered') setNotice('這件已經收錄過了');
    else setNotice('商人搖了搖頭，沒有收下');
  };

  const section = (key: string, title: string, entries: CodexEntry[], accent: string, sub?: string) => {
    const got = entries.filter((e) => registered.has(e.templateId)).length;
    return (
      <div key={key} className="space-y-2">
        <div className="flex items-baseline justify-between gap-2 border-b border-white/10 pb-1">
          <div className="flex items-baseline gap-2">
            <h3 className={`font-display text-sm font-bold tracking-wider ${accent}`}>{title}</h3>
            {sub && <span className="font-hud text-[10px] text-[#8d93a6]">{sub}</span>}
          </div>
          <span className="font-hud text-[11px] text-[#c8b6ee] tabular-nums">
            {got} / {entries.length}
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {entries.map((e) => (
            <CodexEntryCard key={e.templateId} entry={e} found={registered.has(e.templateId)} heroClass={heroClass} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="codex-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="relic-codex-merchant-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#06070c]/84 p-4 pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(1100px,96vw)] max-h-[90vh] flex flex-col bg-[#0c0e15] border border-[#8c63d6]/90 shadow-[0_24px_64px_rgba(0,0,0,0.95)] overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-[#2c2442] bg-[#120f1d]">
          <div className="flex items-center gap-3 min-w-0">
            <BookOpen className="w-4 h-4 text-[#c99bff] shrink-0" />
            <h2
              id="relic-codex-merchant-title"
              className="font-display text-base font-bold tracking-[0.14em] text-[#e3d0ff] whitespace-nowrap"
            >
              神秘旅行商人 · 遺物圖鑑
            </h2>
            <span data-testid="codex-progress" className="font-hud text-xs font-bold text-[#c8b6ee] tabular-nums whitespace-nowrap">
              已收錄 {registered.size} / {CODEX_ENTRIES.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉圖鑑"
            className="p-1.5 border border-[#4a3e6a] bg-[#171a26] text-[#c7b8e8] hover:border-[#b08cf0] hover:text-[#f0e4ff] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Total permanent bonus */}
        <div
          data-testid="codex-bonus-summary"
          className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2 border-b border-[#241d36] bg-[#0f0d18] font-hud text-xs"
        >
          <span className="text-[#8d93a6]">永久加成</span>
          {CODEX_BONUS_KEYS.map((k) => (
            <span key={k} className={`tabular-nums ${BONUS_COLOR[k]}`}>
              {BONUS_SHORT[k]} {formatBonusValue(bonus[k])}
            </span>
          ))}
          <span className="text-[#6b7082] text-[10px]">
            每件收錄：HP +{CODEX_BONUS_VALUE.hpPct}% · 攻擊 +{CODEX_BONUS_VALUE.atkPct}% · 暴擊 +{CODEX_BONUS_VALUE.critPct}% · 金幣 +
            {CODEX_BONUS_VALUE.goldPct}%（依條目固定）
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_300px]">
          <div className="overflow-y-auto p-4 space-y-5 min-h-0">
            {section('orange', '橘色遺物', orangeEntries, 'text-[#ff9b4a]', '獨特遺物')}
            {SET_RELIC_CATALOG.map((set) =>
              section(
                set.setId,
                set.name,
                CODEX_ENTRIES.filter((e) => e.setId === set.setId),
                'text-[#5cf29c]',
                '綠色套裝'
              )
            )}
          </div>

          <div className="border-t md:border-t-0 md:border-l border-[#2c2442] bg-[#0e0c17] overflow-y-auto p-4 space-y-3 min-h-0">
            <div>
              <h3 className="font-display text-sm font-bold tracking-wider text-[#e3d0ff]">交給商人</h3>
              <p className="font-hud text-[10px] text-[#8d93a6] leading-relaxed mt-1">
                商人收下背包或倉庫中的橘色／綠色遺物（交出後遺物消失），同款遺物只收錄一次。裝備中的遺物請先卸下。
              </p>
            </div>
            {notice && (
              <div data-testid="codex-notice" className="border border-[#6b4fb0] bg-[#1a1230] px-2 py-1.5 font-hud text-[11px] text-[#e3d0ff]">
                {notice}
              </div>
            )}
            <div className="space-y-1.5">
              <div className="font-hud text-[11px] font-bold text-[#c8b6ee]">背包（{donatableBag.length}）</div>
              {donatableBag.length === 0 && <div className="font-hud text-[10px] text-[#5f6578]">背包裡沒有橘色或綠色遺物</div>}
              {donatableBag.map((item) => (
                <DonateRow
                  key={item.id}
                  item={item}
                  from="bag"
                  registered={registered.has(item.templateId)}
                  confirmId={confirmId}
                  setConfirmId={setConfirmId}
                  onDonate={donate}
                />
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="font-hud text-[11px] font-bold text-[#c8b6ee]">倉庫（{donatableStash.length}）</div>
              {donatableStash.length === 0 && <div className="font-hud text-[10px] text-[#5f6578]">倉庫裡沒有橘色或綠色遺物</div>}
              {donatableStash.map((item) => (
                <DonateRow
                  key={item.id}
                  item={item}
                  from="stash"
                  registered={registered.has(item.templateId)}
                  confirmId={confirmId}
                  setConfirmId={setConfirmId}
                  onDonate={donate}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
