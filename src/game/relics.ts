export type RelicRarity = 'blue' | 'yellow' | 'orange' | 'green';

export type RelicStatKey =
  // Core requested stats
  | 'damageReduction' // 受到傷害 -1 ~ -10
  | 'atkPct' // 攻擊力 +2% ~ +200%
  | 'critPct' // 暴擊率 +1% ~ +25%
  | 'maxHp' // 血量 +5 ~ +200
  | 'goldPct' // 獲得金幣 +5% ~ +100%
  | 'dropRatePct' // 掉寶率（遺物與藥水） +1% ~ +30%
  | 'blockPct' // 格擋率 3% ~ 15%
  | 'eliteBossDmgPct' // 對菁英怪與Boss傷害 +5% ~ +50%
  // Extra useful combat / utility stats
  | 'moveSpeedPct' // 移動速度 +3% ~ +25%
  | 'critDmgPct' // 暴擊傷害 +10% ~ +80%
  | 'lifeOnKill' // 擊殺回復生命 +1 ~ +12
  | 'dashCdPct' // 衝刺冷卻縮減 +5% ~ +35%
  | 'potionHealPct' // 藥水回復量 +10% ~ +60%
  | 'thorns' // 荊棘反傷 +3 ~ +40
  // Fun / quirky / mildly useful stats
  | 'crateDmgPct' // 對木箱與陶罐傷害 +50% ~ +999%
  | 'lanternGlowPct' // 提燈亮度 +10% ~ +80%
  | 'dramaticKnockback' // 華麗擊退感 +15% ~ +60%
  | 'politeness' // 怪物臨終敬意 +1 ~ +100
  | 'footstepEcho' // 腳步聲氣勢 +10% ~ +100%
  | 'shinyGoldFeel'; // 金幣閃耀度 +10% ~ +100%

export interface RelicStat {
  key: RelicStatKey;
  value: number;
}

export type UniqueEffectId =
  | 'ember_crit_nova'
  | 'aegis_block_counter'
  | 'avarice_gold_atk'
  | 'phantom_dash_crit'
  | 'blood_moon_leech'
  | 'executioner_finisher'
  | 'alchemist_free_flask'
  | 'titan_low_hp_fury'
  | 'storm_cleave_lightning'
  | 'gambler_coin_flip'
  | 'frying_pan_bonk'
  | 'chronos_cheat_death';

export type RelicSetId = 'dragonfire' | 'voidstalker' | 'syndicate';

export interface RelicItem {
  id: string;
  templateId: string;
  name: string;
  rarity: RelicRarity;
  level: number;
  stats: RelicStat[];
  sellValue: number;
  uniqueEffectId?: UniqueEffectId;
  uniqueEffectTitle?: string;
  uniqueEffectDesc?: string;
  setId?: RelicSetId;
  setName?: string;
  setPieceIndex?: number; // 0..3
  flavor?: string;
}

export interface ActiveSetBonus {
  setId: RelicSetId;
  setName: string;
  equippedCount: number;
  equippedPieceIds: string[];
  bonuses: Array<{
    required: 2 | 3 | 4;
    title: string;
    desc: string;
    active: boolean;
  }>;
}

export interface RelicSummaryStats {
  damageReduction: number;
  atkPct: number;
  critPct: number;
  maxHp: number;
  goldPct: number;
  dropRatePct: number;
  blockPct: number;
  eliteBossDmgPct: number;
  moveSpeedPct: number;
  critDmgPct: number;
  lifeOnKill: number;
  dashCdPct: number;
  potionHealPct: number;
  thorns: number;
  crateDmgPct: number;
  lanternGlowPct: number;
  dramaticKnockback: number;
  politeness: number;
  footstepEcho: number;
  shinyGoldFeel: number;
  uniqueEffects: UniqueEffectId[];
  activeSetIds4pc: RelicSetId[];
  activeSets: ActiveSetBonus[];
}

export interface StatDefinition {
  key: RelicStatKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  prefix: string;
  quirky?: boolean;
  weight: number;
  hint?: string;
}

export const STAT_DEFS: Record<RelicStatKey, StatDefinition> = {
  damageReduction: {
    key: 'damageReduction',
    label: '受到傷害',
    min: 1,
    max: 10,
    step: 1,
    unit: '',
    prefix: '-',
    weight: 10,
    hint: '每次受傷最低仍為 1 滴血',
  },
  atkPct: {
    key: 'atkPct',
    label: '攻擊力',
    min: 2,
    max: 200,
    step: 2,
    unit: '%',
    prefix: '+',
    weight: 13,
  },
  critPct: {
    key: 'critPct',
    label: '暴擊率',
    min: 1,
    max: 25,
    step: 1,
    unit: '%',
    prefix: '+',
    weight: 10,
  },
  maxHp: {
    key: 'maxHp',
    label: '血量上限',
    min: 5,
    max: 200,
    step: 5,
    unit: '',
    prefix: '+',
    weight: 12,
  },
  goldPct: {
    key: 'goldPct',
    label: '獲得金幣',
    min: 5,
    max: 100,
    step: 5,
    unit: '%',
    prefix: '+',
    weight: 9,
  },
  dropRatePct: {
    key: 'dropRatePct',
    label: '掉寶率',
    min: 1,
    max: 30,
    step: 1,
    unit: '%',
    prefix: '+',
    weight: 8,
    hint: '提升遺物與藥水掉落機率',
  },
  blockPct: {
    key: 'blockPct',
    label: '格擋率',
    min: 3,
    max: 15,
    step: 3,
    unit: '%',
    prefix: '+',
    weight: 8,
    hint: '機率完全抵擋該次傷害',
  },
  eliteBossDmgPct: {
    key: 'eliteBossDmgPct',
    label: '對菁英與Boss傷害',
    min: 5,
    max: 50,
    step: 5,
    unit: '%',
    prefix: '+',
    weight: 9,
  },
  moveSpeedPct: {
    key: 'moveSpeedPct',
    label: '移動速度',
    min: 3,
    max: 25,
    step: 1,
    unit: '%',
    prefix: '+',
    weight: 7,
  },
  critDmgPct: {
    key: 'critDmgPct',
    label: '暴擊傷害',
    min: 10,
    max: 80,
    step: 5,
    unit: '%',
    prefix: '+',
    weight: 7,
  },
  lifeOnKill: {
    key: 'lifeOnKill',
    label: '擊殺回復生命',
    min: 1,
    max: 12,
    step: 1,
    unit: ' HP',
    prefix: '+',
    weight: 6,
  },
  dashCdPct: {
    key: 'dashCdPct',
    label: '衝刺冷卻縮減',
    min: 5,
    max: 35,
    step: 5,
    unit: '%',
    prefix: '+',
    weight: 6,
  },
  potionHealPct: {
    key: 'potionHealPct',
    label: '藥水回復量',
    min: 10,
    max: 60,
    step: 5,
    unit: '%',
    prefix: '+',
    weight: 6,
  },
  thorns: {
    key: 'thorns',
    label: '荊棘反傷',
    min: 3,
    max: 40,
    step: 1,
    unit: '',
    prefix: '+',
    weight: 6,
  },
  // Fun / quirky affixes
  crateDmgPct: {
    key: 'crateDmgPct',
    label: '對木箱與陶罐傷害',
    min: 50,
    max: 999,
    step: 25,
    unit: '%',
    prefix: '+',
    quirky: true,
    weight: 3.5,
    hint: '反正本來就一刀爆，純粹打得比較爽',
  },
  lanternGlowPct: {
    key: 'lanternGlowPct',
    label: '提燈照明強度',
    min: 10,
    max: 80,
    step: 5,
    unit: '%',
    prefix: '+',
    quirky: true,
    weight: 3.5,
    hint: '讓你的提燈更亮一點點',
  },
  dramaticKnockback: {
    key: 'dramaticKnockback',
    label: '華麗擊退感',
    min: 15,
    max: 60,
    step: 5,
    unit: '%',
    prefix: '+',
    quirky: true,
    weight: 3.5,
    hint: '把怪物敲飛得更誇張',
  },
  politeness: {
    key: 'politeness',
    label: '怪物臨終敬意',
    min: 5,
    max: 100,
    step: 5,
    unit: '',
    prefix: '+',
    quirky: true,
    weight: 3,
    hint: '怪物倒下時偶爾會稱讚你很強',
  },
  footstepEcho: {
    key: 'footstepEcho',
    label: '腳步聲氣勢',
    min: 10,
    max: 100,
    step: 10,
    unit: '%',
    prefix: '+',
    quirky: true,
    weight: 2.5,
    hint: '走起來彷彿自帶主角配樂（心理作用）',
  },
  shinyGoldFeel: {
    key: 'shinyGoldFeel',
    label: '金幣閃耀度',
    min: 10,
    max: 100,
    step: 10,
    unit: '%',
    prefix: '+',
    quirky: true,
    weight: 2.5,
    hint: '讓撿到的錢看起來更尊爵不凡',
  },
};

export interface UniqueRelicTemplate {
  templateId: string;
  name: string;
  statKeys: RelicStatKey[]; // 2..4 guaranteed stats
  uniqueEffectId: UniqueEffectId;
  uniqueEffectTitle: string;
  uniqueEffectDesc: string;
  flavor: string;
}

export const UNIQUE_RELIC_CATALOG: UniqueRelicTemplate[] = [
  {
    templateId: 'uniq_ember_crown',
    name: '燼火君王的斷冠',
    statKeys: ['atkPct', 'critPct', 'eliteBossDmgPct'],
    uniqueEffectId: 'ember_crit_nova',
    uniqueEffectTitle: '焚世爆擊',
    uniqueEffectDesc: '暴擊時引發火焰衝擊波，對周圍敵人造成本次傷害 45% 的範圍灼燒。',
    flavor: '殘存於灰燼王座上的焦黑王冠，仍炙燙如初。',
  },
  {
    templateId: 'uniq_eternal_aegis',
    name: '永恆誓言之盾',
    statKeys: ['damageReduction', 'blockPct', 'maxHp'],
    uniqueEffectId: 'aegis_block_counter',
    uniqueEffectTitle: '聖盾反震',
    uniqueEffectDesc: '成功格擋攻擊時回復 12 HP，並震飛周圍敵人造成 25 傷害。',
    flavor: '只要握盾者未曾退縮，誓言便永不碎裂。',
  },
  {
    templateId: 'uniq_avarice_chalice',
    name: '貪婪魔神的金杯',
    statKeys: ['goldPct', 'dropRatePct', 'maxHp'],
    uniqueEffectId: 'avarice_gold_atk',
    uniqueEffectTitle: '黃金之力',
    uniqueEffectDesc: '身上每持有 100 金幣，額外獲得 +2% 攻擊力（最高 +80%）。',
    flavor: '杯中永遠裝不滿金幣，卻總能倒出殺意。',
  },
  {
    templateId: 'uniq_phantom_greaves',
    name: '幽影行者的瞬步靴',
    statKeys: ['moveSpeedPct', 'dashCdPct', 'critPct'],
    uniqueEffectId: 'phantom_dash_crit',
    uniqueEffectTitle: '殘影斬擊',
    uniqueEffectDesc: '衝刺後的 2 秒內，下一次攻擊必定暴擊且額外造成 +50% 傷害。',
    flavor: '敵人聽見靴聲時，劍鋒早已掠過咽喉。',
  },
  {
    templateId: 'uniq_blood_moon_fang',
    name: '血月收割者的獠牙',
    statKeys: ['atkPct', 'lifeOnKill', 'critDmgPct'],
    uniqueEffectId: 'blood_moon_leech',
    uniqueEffectTitle: '嗜血掠奪',
    uniqueEffectDesc: '每次近戰命中回復造成傷害 6% 的生命（至少 1 HP）。',
    flavor: '在猩紅月色下愈戰愈狂，傷口是它最好的美酒。',
  },
  {
    templateId: 'uniq_executioner_signet',
    name: '審判官的斬首印戒',
    statKeys: ['eliteBossDmgPct', 'critPct', 'atkPct'],
    uniqueEffectId: 'executioner_finisher',
    uniqueEffectTitle: '處決宣告',
    uniqueEffectDesc: '對血量低於 30% 的敵人造成雙倍傷害（對 Boss 改為 +50%）。',
    flavor: '當印戒微微發燙，死刑已經寫在對方的額頭上。',
  },
  {
    templateId: 'uniq_alchemist_flask',
    name: '煉金術士的無限燒瓶',
    statKeys: ['potionHealPct', 'dropRatePct', 'damageReduction'],
    uniqueEffectId: 'alchemist_free_flask',
    uniqueEffectTitle: '秘藥奇蹟',
    uniqueEffectDesc: '飲用藥水時有 35% 機率不消耗瓶數，並獲得 3 秒額外 -4 減傷護盾。',
    flavor: '搖一搖總覺得裡面還剩最後一口。',
  },
  {
    templateId: 'uniq_titan_heart',
    name: '泰坦之心臟碎片',
    statKeys: ['maxHp', 'damageReduction', 'thorns', 'atkPct'],
    uniqueEffectId: 'titan_low_hp_fury',
    uniqueEffectTitle: '不屈巨人',
    uniqueEffectDesc: '生命低於 40% 時觸發狂怒：攻擊力 +35% 且受到傷害額外 -3。',
    flavor: '瀕死之際，遠古巨人的心跳會接管你的胸膛。',
  },
  {
    templateId: 'uniq_storm_hammer',
    name: '雷霆鍛造師的轟雷錘',
    statKeys: ['atkPct', 'critDmgPct', 'moveSpeedPct'],
    uniqueEffectId: 'storm_cleave_lightning',
    uniqueEffectTitle: '連鎖落雷',
    uniqueEffectDesc: '每第 3 下橫掃重擊釋放雷電，連鎖電擊附近最多 3 名敵人造成 40% 額外傷害。',
    flavor: '每一次重揮都伴隨鍛爐與雷雲的低鳴。',
  },
  {
    templateId: 'uniq_gambler_coin',
    name: '深淵賭徒的雙面硬幣',
    statKeys: ['goldPct', 'critPct'],
    uniqueEffectId: 'gambler_coin_flip',
    uniqueEffectTitle: '命運輪盤',
    uniqueEffectDesc: '每次攻擊有 25% 機率爆發 2.2 倍超高傷害，但有 10% 機率手滑只剩 50% 傷害。',
    flavor: '正面贏走一切，反面笑著重來。',
  },
  {
    templateId: 'uniq_frying_pan',
    name: '勇者的破舊平底鍋',
    statKeys: ['blockPct', 'crateDmgPct', 'politeness'],
    uniqueEffectId: 'frying_pan_bonk',
    uniqueEffectTitle: '神聖噹一聲',
    uniqueEffectDesc: '格擋率額外 +8%；成功格擋或擊殺敵人時有 25% 機率敲出額外金幣！',
    flavor: '看似只是宿營廚具，實則擋過無數魔王必殺技。',
  },
  {
    templateId: 'uniq_chronos_hourglass',
    name: '時光砂漏的破碎核心',
    statKeys: ['dashCdPct', 'moveSpeedPct', 'critPct', 'dropRatePct'],
    uniqueEffectId: 'chronos_cheat_death',
    uniqueEffectTitle: '時間凝滯',
    uniqueEffectDesc: '受到致命傷害時逆轉時間抵擋死亡，回復至 40% 血量並震飛周圍敵人（每層限 1 次）。',
    flavor: '砂粒倒流的瞬間，連死神也只能撲空。',
  },
];

export interface SetPieceTemplate {
  templateId: string;
  setId: RelicSetId;
  pieceIndex: number;
  name: string;
  statKeys: [RelicStatKey, RelicStatKey];
  flavor: string;
}

export interface RelicSetTemplate {
  setId: RelicSetId;
  name: string;
  themeDesc: string;
  auraColor: number;
  pieces: SetPieceTemplate[];
  bonuses: Array<{
    required: 2 | 3 | 4;
    title: string;
    desc: string;
  }>;
}

export const SET_RELIC_CATALOG: RelicSetTemplate[] = [
  {
    setId: 'dragonfire',
    name: '龍炎騎士的遺產',
    themeDesc: '炙烈火龍之力，結合高爆發與近戰龍息焚燒。',
    auraColor: 0xff6229,
    pieces: [
      {
        templateId: 'set_dragon_0',
        setId: 'dragonfire',
        pieceIndex: 0,
        name: '龍炎之角',
        statKeys: ['atkPct', 'critPct'],
        flavor: '從古龍額骨折下的赤紅殘角。',
      },
      {
        templateId: 'set_dragon_1',
        setId: 'dragonfire',
        pieceIndex: 1,
        name: '龍炎逆鱗',
        statKeys: ['maxHp', 'damageReduction'],
        flavor: '覆滿暗金裂紋的堅硬鱗甲。',
      },
      {
        templateId: 'set_dragon_2',
        setId: 'dragonfire',
        pieceIndex: 2,
        name: '龍炎之心',
        statKeys: ['eliteBossDmgPct', 'critDmgPct'],
        flavor: '仍在脈動的熔岩火核。',
      },
      {
        templateId: 'set_dragon_3',
        setId: 'dragonfire',
        pieceIndex: 3,
        name: '龍炎誓印',
        statKeys: ['atkPct', 'blockPct'],
        flavor: '龍騎團團長世代傳承的炙焰徽記。',
      },
    ],
    bonuses: [
      { required: 2, title: '龍血沸騰', desc: '攻擊力 +25%，血量上限 +30。' },
      { required: 3, title: '屠龍威勢', desc: '暴擊率 +10%，對菁英與 Boss 傷害 +20%。' },
      {
        required: 4,
        title: '龍息焚城',
        desc: '周身燃起龍炎光環：每 3 秒自動噴發龍息火環灼燒周圍敵人，且所有攻擊附帶火焰爆裂濺射！',
      },
    ],
  },
  {
    setId: 'voidstalker',
    name: '虛空影刺的默示錄',
    themeDesc: '極致機動與致命暴擊，化作不可捉摸的虛空殘影。',
    auraColor: 0x9b5cff,
    pieces: [
      {
        templateId: 'set_void_0',
        setId: 'voidstalker',
        pieceIndex: 0,
        name: '虛空之眼',
        statKeys: ['critPct', 'critDmgPct'],
        flavor: '凝視裂隙深處的紫晶魔瞳。',
      },
      {
        templateId: 'set_void_1',
        setId: 'voidstalker',
        pieceIndex: 1,
        name: '虛空利爪',
        statKeys: ['atkPct', 'moveSpeedPct'],
        flavor: '彷彿能撕開空間的暗影指刃。',
      },
      {
        templateId: 'set_void_2',
        setId: 'voidstalker',
        pieceIndex: 2,
        name: '虛空斗篷紋章',
        statKeys: ['dashCdPct', 'blockPct'],
        flavor: '在陰影中隱去身形的無聲扣環。',
      },
      {
        templateId: 'set_void_3',
        setId: 'voidstalker',
        pieceIndex: 3,
        name: '虛空低語吊墜',
        statKeys: ['dropRatePct', 'lifeOnKill'],
        flavor: '耳畔時常傳來異界的輕笑與指引。',
      },
    ],
    bonuses: [
      { required: 2, title: '影步疾行', desc: '移動速度 +15%，衝刺冷卻縮減 +20%。' },
      { required: 3, title: '要害洞察', desc: '暴擊率 +12%，暴擊傷害 +35%。' },
      {
        required: 4,
        title: '虛空瞬殺',
        desc: '周身環繞虛空光環：暴擊時立刻重置衝刺冷卻，並射出 3 道虛空飛刃自動追擊附近敵人！',
      },
    ],
  },
  {
    setId: 'syndicate',
    name: '黃金商會的秘寶錄',
    themeDesc: '財富與幸運的極致化身，以萬貫家財碾壓地城。',
    auraColor: 0xffd24a,
    pieces: [
      {
        templateId: 'set_synd_0',
        setId: 'syndicate',
        pieceIndex: 0,
        name: '金庫萬能鑰',
        statKeys: ['goldPct', 'dropRatePct'],
        flavor: '沒有這把金鑰打不開的寶箱。',
      },
      {
        templateId: 'set_synd_1',
        setId: 'syndicate',
        pieceIndex: 1,
        name: '鑲鑽算盤珠',
        statKeys: ['goldPct', 'maxHp'],
        flavor: '每一顆珠子都價值一座城鎮。',
      },
      {
        templateId: 'set_synd_2',
        setId: 'syndicate',
        pieceIndex: 2,
        name: '商會印璽戒',
        statKeys: ['blockPct', 'damageReduction'],
        flavor: '有錢能使鬼推磨，也能買通死神。',
      },
      {
        templateId: 'set_synd_3',
        setId: 'syndicate',
        pieceIndex: 3,
        name: '天秤護符',
        statKeys: ['potionHealPct', 'eliteBossDmgPct'],
        flavor: '絕對公平的黃金天秤，永遠偏向出價更高的一方。',
      },
    ],
    bonuses: [
      { required: 2, title: '日進斗金', desc: '獲得金幣 +35%，掉寶率 +10%。' },
      { required: 3, title: '重金護體', desc: '受到傷害 -3，格擋率 +8%。' },
      {
        required: 4,
        title: '點石成金',
        desc: '周身閃耀黃金輝光：擊殺敵人必定噴出額外金雨，攻擊有 30% 機率觸發「重金轟擊」造成額外傷害並爆出金幣！',
      },
    ],
  },
];

const BLUE_PREFIXES = [
  '陳舊的',
  '微光的',
  '地穴',
  '石刻',
  '旅人的',
  '鐵鑄',
  '青銅',
  '古舊',
  '學徒的',
  '殘破',
];

const YELLOW_PREFIXES = [
  '精鑄的',
  '耀金',
  '秘法',
  '王室',
  '聖殿',
  '龍紋',
  '淬火',
  '高階',
  '榮耀',
  '璀璨',
];

const RELIC_NOUNS = [
  '護符',
  '紋章',
  '指環',
  '聖印',
  '吊墜',
  '懷錶',
  '羅盤',
  '寶珠',
  '徽記',
  '骨笛',
  '印章',
  '鏡片',
];

export function formatRelicStat(stat: RelicStat): string {
  const def = STAT_DEFS[stat.key];
  return `${def.label} ${def.prefix}${stat.value}${def.unit}`;
}

export function formatStatRange(key: RelicStatKey): string {
  const def = STAT_DEFS[key];
  return `${def.label} ${def.prefix}${def.min}${def.unit} ~ ${def.prefix}${def.max}${def.unit}`;
}

export function getRarityLabel(rarity: RelicRarity): string {
  switch (rarity) {
    case 'blue':
      return '普通遺物';
    case 'yellow':
      return '高級遺物';
    case 'orange':
      return '獨特遺物';
    case 'green':
      return '套裝遺物';
  }
}

export function getRarityColorHex(rarity: RelicRarity): number {
  switch (rarity) {
    case 'blue':
      return 0x4da6ff;
    case 'yellow':
      return 0xffd84d;
    case 'orange':
      return 0xff7b1c;
    case 'green':
      return 0x38f27c;
  }
}

export function getRarityCss(rarity: RelicRarity): {
  text: string;
  border: string;
  bg: string;
  accent: string;
} {
  switch (rarity) {
    case 'blue':
      return {
        text: 'text-[#6ab8ff]',
        border: 'border-[#336ca3]',
        bg: 'bg-[#0f1924]',
        accent: '#6ab8ff',
      };
    case 'yellow':
      return {
        text: 'text-[#ffe066]',
        border: 'border-[#9e802e]',
        bg: 'bg-[#1f1b0e]',
        accent: '#ffe066',
      };
    case 'orange':
      return {
        text: 'text-[#ff9442]',
        border: 'border-[#bd5c1a]',
        bg: 'bg-[#24140a]',
        accent: '#ff9442',
      };
    case 'green':
      return {
        text: 'text-[#52f295]',
        border: 'border-[#278c52]',
        bg: 'bg-[#0d2016]',
        accent: '#52f295',
      };
  }
}

function snapToStep(val: number, min: number, max: number, step: number): number {
  const clamped = Math.max(min, Math.min(max, val));
  const steps = Math.round((clamped - min) / step);
  return Math.max(min, Math.min(max, min + steps * step));
}

function rollStatValue(key: RelicStatKey, level: number, rarity: RelicRarity): number {
  const def = STAT_DEFS[key];
  // Scale progress smoothly across floors 1..30 (and still climbs slightly past 30 up to cap)
  const lvNorm = Math.min(1.0, Math.max(0, (level - 1) / 28));
  const rarityBoost =
    rarity === 'orange' ? 0.16 : rarity === 'green' ? 0.12 : rarity === 'yellow' ? 0.05 : 0;
  // Base center scales from ~12% at Lv1 up to ~88% at Lv29+
  const center = Math.min(0.95, 0.08 + lvNorm * 0.78 + rarityBoost);
  // Random spread ±20%
  const spread = (Math.random() * 2 - 1) * 0.2;
  const factor = Math.max(0, Math.min(1, center + spread));
  const raw = def.min + (def.max - def.min) * factor;
  return snapToStep(raw, def.min, def.max, def.step);
}

function pickRandomStatKeys(count: number, allowQuirky = true): RelicStatKey[] {
  const pool = Object.values(STAT_DEFS).filter((d) => allowQuirky || !d.quirky);
  const chosen: RelicStatKey[] = [];
  const available = [...pool];

  for (let i = 0; i < count && available.length > 0; i++) {
    const totalWeight = available.reduce((sum, d) => sum + d.weight, 0);
    let r = Math.random() * totalWeight;
    let pickIdx = 0;
    for (let j = 0; j < available.length; j++) {
      r -= available[j].weight;
      if (r <= 0) {
        pickIdx = j;
        break;
      }
    }
    chosen.push(available[pickIdx].key);
    available.splice(pickIdx, 1);
  }
  return chosen;
}

function computeSellValue(rarity: RelicRarity, level: number): number {
  switch (rarity) {
    case 'blue':
      return 12 + level * 4;
    case 'yellow':
      return 26 + level * 8;
    case 'green':
      return 52 + level * 15;
    case 'orange':
      return 60 + level * 17;
  }
}

export type RelicDropSource = 'crate' | 'mob' | 'elite' | 'boss';

function rollRarity(source: RelicDropSource, depth: number): RelicRarity {
  // Smooth depth progression: 0.0 at Depth 1 -> 1.0 at Depth 30 (clamped for >30)
  const t = Math.min(1, Math.max(0, (depth - 1) / 29));
  const r = Math.random() * 100;

  if (source === 'boss') {
    // Low floors (Depth 5): ~12% orange / ~12% green / ~54% yellow / ~22% blue
    // Deep floors (Depth 25-30+): ~40% orange / ~40% green / ~20% yellow / 0% blue
    const orangeChance = 8 + t * 33;
    const greenChance = 8 + t * 33;
    const blueChance = Math.max(0, 26 * Math.pow(1 - t, 1.8));
    const yellowChance = Math.max(0, 100 - orangeChance - greenChance - blueChance);
    if (r < orangeChance) return 'orange';
    if (r < orangeChance + greenChance) return 'green';
    if (r < orangeChance + greenChance + yellowChance) return 'yellow';
    return 'blue';
  }

  if (source === 'elite') {
    // Low floors (Depth 1): ~4.5% orange / ~4.5% green / ~38% yellow / ~53% blue
    // Deep floors (Depth 30): ~30% orange / ~30% green / ~38% yellow / ~2% blue
    const orangeChance = 4.5 + t * 25.5;
    const greenChance = 4.5 + t * 25.5;
    const blueChance = Math.max(2, 53 * Math.pow(1 - t, 1.55));
    const yellowChance = Math.max(0, 100 - orangeChance - greenChance - blueChance);
    if (r < orangeChance) return 'orange';
    if (r < orangeChance + greenChance) return 'green';
    if (r < orangeChance + greenChance + yellowChance) return 'yellow';
    return 'blue';
  }

  // Normal mob or crate: low early Orange/Green jackpot, very rare Blue on high floors
  // Depth 1: ~1.2% orange / ~1.2% green / ~22% yellow / ~75.6% blue
  // Depth 30: ~16% orange / ~16% green / ~62% yellow / ~6% blue
  const orangeChance = 1.2 + t * 14.8;
  const greenChance = 1.2 + t * 14.8;
  const blueChance = Math.max(5, 75.6 * Math.pow(1 - t, 1.45));
  const yellowChance = Math.max(0, 100 - orangeChance - greenChance - blueChance);
  if (r < orangeChance) return 'orange';
  if (r < orangeChance + greenChance) return 'green';
  if (r < orangeChance + greenChance + yellowChance) return 'yellow';
  return 'blue';
}

export function generateRelic(
  depth: number,
  source: RelicDropSource,
  idNum: number,
  forcedRarity?: RelicRarity
): RelicItem {
  const level = Math.max(1, depth);
  const rarity = forcedRarity ?? rollRarity(source, depth);
  const id = `relic_${idNum}`;

  if (rarity === 'orange') {
    const tpl = UNIQUE_RELIC_CATALOG[Math.floor(Math.random() * UNIQUE_RELIC_CATALOG.length)];
    const stats: RelicStat[] = tpl.statKeys.map((k) => ({
      key: k,
      value: rollStatValue(k, level, 'orange'),
    }));
    return {
      id,
      templateId: tpl.templateId,
      name: tpl.name,
      rarity: 'orange',
      level,
      stats,
      sellValue: computeSellValue('orange', level),
      uniqueEffectId: tpl.uniqueEffectId,
      uniqueEffectTitle: tpl.uniqueEffectTitle,
      uniqueEffectDesc: tpl.uniqueEffectDesc,
      flavor: tpl.flavor,
    };
  }

  if (rarity === 'green') {
    const setTpl = SET_RELIC_CATALOG[Math.floor(Math.random() * SET_RELIC_CATALOG.length)];
    const piece = setTpl.pieces[Math.floor(Math.random() * setTpl.pieces.length)];
    const stats: RelicStat[] = piece.statKeys.map((k) => ({
      key: k,
      value: rollStatValue(k, level, 'green'),
    }));
    return {
      id,
      templateId: piece.templateId,
      name: piece.name,
      rarity: 'green',
      level,
      stats,
      sellValue: computeSellValue('green', level),
      setId: setTpl.setId,
      setName: setTpl.name,
      setPieceIndex: piece.pieceIndex,
      flavor: piece.flavor,
    };
  }

  if (rarity === 'yellow') {
    const statKeys = pickRandomStatKeys(2, true);
    const prefix = YELLOW_PREFIXES[Math.floor(Math.random() * YELLOW_PREFIXES.length)];
    const noun = RELIC_NOUNS[Math.floor(Math.random() * RELIC_NOUNS.length)];
    return {
      id,
      templateId: `yellow_${statKeys.join('_')}`,
      name: `${prefix}${noun}`,
      rarity: 'yellow',
      level,
      stats: statKeys.map((k) => ({ key: k, value: rollStatValue(k, level, 'yellow') })),
      sellValue: computeSellValue('yellow', level),
    };
  }

  // Blue (1 stat)
  const statKeys = pickRandomStatKeys(1, true);
  const prefix = BLUE_PREFIXES[Math.floor(Math.random() * BLUE_PREFIXES.length)];
  const noun = RELIC_NOUNS[Math.floor(Math.random() * RELIC_NOUNS.length)];
  return {
    id,
    templateId: `blue_${statKeys[0]}`,
    name: `${prefix}${noun}`,
    rarity: 'blue',
    level,
    stats: [{ key: statKeys[0], value: rollStatValue(statKeys[0], level, 'blue') }],
    sellValue: computeSellValue('blue', level),
  };
}

export function rollRelicDrops(
  depth: number,
  source: RelicDropSource,
  dropRatePct: number,
  allocId: () => number
): RelicItem[] {
  const dropMult = 1 + Math.max(0, dropRatePct) / 100;
  const results: RelicItem[] = [];

  if (source === 'crate') {
    const chance = Math.min(0.24, 0.045 * dropMult);
    if (Math.random() < chance) {
      results.push(generateRelic(depth, 'crate', allocId()));
    }
    return results;
  }

  if (source === 'mob') {
    const chance = Math.min(0.28, 0.055 * dropMult);
    if (Math.random() < chance) {
      results.push(generateRelic(depth, 'mob', allocId()));
    }
    return results;
  }

  if (source === 'elite') {
    // Guaranteed at least 1 relic from elites
    results.push(generateRelic(depth, 'elite', allocId()));
    // Depth-scaling chance for a 2nd relic
    const secondChance = Math.min(0.82, (0.16 + depth * 0.025) * dropMult);
    if (Math.random() < secondChance) {
      results.push(generateRelic(depth, 'elite', allocId()));
    }
    // Deep floor bonus chance for a 3rd relic
    if (depth >= 12) {
      const thirdChance = Math.min(0.4, ((depth - 10) * 0.015) * dropMult);
      if (Math.random() < thirdChance) {
        results.push(generateRelic(depth, 'elite', allocId()));
      }
    }
    return results;
  }

  // Boss: Guaranteed 1 relic + high depth-scaling chance for 2nd & 3rd
  results.push(generateRelic(depth, 'boss', allocId()));
  const secondChance = Math.min(0.95, (0.45 + depth * 0.03) * dropMult);
  if (Math.random() < secondChance) {
    results.push(generateRelic(depth, 'boss', allocId()));
  }
  if (depth >= 10) {
    const thirdChance = Math.min(0.65, (0.12 + (depth - 9) * 0.022) * dropMult);
    if (Math.random() < thirdChance) {
      results.push(generateRelic(depth, 'boss', allocId()));
    }
  }
  return results;
}

export function computeRelicSummary(equipped: RelicItem[]): RelicSummaryStats {
  const summary: RelicSummaryStats = {
    damageReduction: 0,
    atkPct: 0,
    critPct: 0,
    maxHp: 0,
    goldPct: 0,
    dropRatePct: 0,
    blockPct: 0,
    eliteBossDmgPct: 0,
    moveSpeedPct: 0,
    critDmgPct: 0,
    lifeOnKill: 0,
    dashCdPct: 0,
    potionHealPct: 0,
    thorns: 0,
    crateDmgPct: 0,
    lanternGlowPct: 0,
    dramaticKnockback: 0,
    politeness: 0,
    footstepEcho: 0,
    shinyGoldFeel: 0,
    uniqueEffects: [],
    activeSetIds4pc: [],
    activeSets: [],
  };

  const uniqueSet = new Set<UniqueEffectId>();
  const setPiecesEquipped = new Map<RelicSetId, Set<string>>();

  for (const r of equipped) {
    for (const s of r.stats) {
      summary[s.key] += s.value;
    }
    if (r.uniqueEffectId) {
      uniqueSet.add(r.uniqueEffectId);
    }
    if (r.setId) {
      let pieceSet = setPiecesEquipped.get(r.setId);
      if (!pieceSet) {
        pieceSet = new Set<string>();
        setPiecesEquipped.set(r.setId, pieceSet);
      }
      pieceSet.add(r.templateId);
    }
  }

  // Unique passive stat bonuses
  if (uniqueSet.has('frying_pan_bonk')) {
    summary.blockPct += 8;
  }

  // Compute active Set Bonuses (counts distinct named pieces per set)
  for (const setTpl of SET_RELIC_CATALOG) {
    const equippedPieces = setPiecesEquipped.get(setTpl.setId);
    const count = equippedPieces ? equippedPieces.size : 0;
    if (count <= 0) continue;

    if (setTpl.setId === 'dragonfire') {
      if (count >= 2) {
        summary.atkPct += 25;
        summary.maxHp += 30;
      }
      if (count >= 3) {
        summary.critPct += 10;
        summary.eliteBossDmgPct += 20;
      }
      if (count >= 4) {
        summary.activeSetIds4pc.push('dragonfire');
      }
    } else if (setTpl.setId === 'voidstalker') {
      if (count >= 2) {
        summary.moveSpeedPct += 15;
        summary.dashCdPct += 20;
      }
      if (count >= 3) {
        summary.critPct += 12;
        summary.critDmgPct += 35;
      }
      if (count >= 4) {
        summary.activeSetIds4pc.push('voidstalker');
      }
    } else if (setTpl.setId === 'syndicate') {
      if (count >= 2) {
        summary.goldPct += 35;
        summary.dropRatePct += 10;
      }
      if (count >= 3) {
        summary.damageReduction += 3;
        summary.blockPct += 8;
      }
      if (count >= 4) {
        summary.activeSetIds4pc.push('syndicate');
      }
    }

    summary.activeSets.push({
      setId: setTpl.setId,
      setName: setTpl.name,
      equippedCount: count,
      equippedPieceIds: Array.from(equippedPieces ?? []),
      bonuses: setTpl.bonuses.map((b) => ({
        required: b.required,
        title: b.title,
        desc: b.desc,
        active: count >= b.required,
      })),
    });
  }

  // Apply sensible caps on stacked stats so combat stays exciting & balanced
  summary.blockPct = Math.min(60, summary.blockPct);
  summary.dashCdPct = Math.min(65, summary.dashCdPct);
  summary.moveSpeedPct = Math.min(65, summary.moveSpeedPct);
  summary.uniqueEffects = Array.from(uniqueSet);

  return summary;
}

export function getRelicPowerScore(r: RelicItem): number {
  const rarityBase =
    r.rarity === 'orange' ? 120 : r.rarity === 'green' ? 105 : r.rarity === 'yellow' ? 50 : 20;
  let score = rarityBase + r.level * 4;
  for (const s of r.stats) {
    const def = STAT_DEFS[s.key];
    if (def.quirky) {
      score += 2;
    } else {
      const norm = (s.value - def.min) / Math.max(1, def.max - def.min);
      score += 18 + norm * 45;
    }
  }
  return score;
}

/**
 * Evaluates total combat effectiveness of a 4-slot relic loadout, accounting for
 * aggregated stats, distinct Orange unique effects, and active Green 2/3/4-piece set bonuses.
 */
export function evaluateRelicLoadoutScore(equipped: RelicItem[]): number {
  const s = computeRelicSummary(equipped);
  let score = 0;

  // Combat & utility stat weights
  score += s.atkPct * 1.65;
  score += s.critPct * 5.2;
  score += s.critDmgPct * 1.1;
  score += s.maxHp * 0.95;
  score += s.damageReduction * 14.0;
  score += s.blockPct * 5.8;
  score += s.eliteBossDmgPct * 1.45;
  score += s.lifeOnKill * 5.5;
  score += s.moveSpeedPct * 1.25;
  score += s.dashCdPct * 0.9;
  score += s.potionHealPct * 0.65;
  score += s.thorns * 1.35;
  score += s.goldPct * 0.45;
  score += s.dropRatePct * 1.4;
  // Tiny tie-breaker for quirky stats
  score +=
    (s.crateDmgPct +
      s.lanternGlowPct +
      s.dramaticKnockback +
      s.politeness +
      s.footstepEcho +
      s.shinyGoldFeel) *
    0.04;

  // Distinct Orange unique special abilities carry high tactical value
  score += s.uniqueEffects.length * 95;

  // Progressive Green Set synergies (on top of the raw stats already included in summary)
  for (const active of s.activeSets) {
    if (active.equippedCount >= 2) score += 35;
    if (active.equippedCount >= 3) score += 80;
    if (active.equippedCount >= 4) score += 260;
  }

  // Mild rarity & level tiebreaker so upgrades feel crisp
  for (const r of equipped) {
    score += r.level * 1.2;
    if (r.rarity === 'orange') score += 18;
    else if (r.rarity === 'green') score += 14;
    else if (r.rarity === 'yellow') score += 6;
  }

  return score;
}
