import type { EmbervaultEngine } from '../engine';
import { FROST_MAGE, HUNTER, UpgradeKind, UpgradeOptionView, WARRIOR } from '../classes';
import { gridToWorld } from '../dungeon';
import { STASH_CAP } from '../hero';
import { RelicItem, getRelicDiscardValue } from '../relics';
import type { StashMoveResult } from '../engine';

export const economyMethods = {
  equipRelic(this: EmbervaultEngine, relicId: string, replaceSlotIndex?: number): boolean {
    if (this.hero.isDead || this.tradeLocked) return false;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'eq', id: relicId, s: replaceSlotIndex });
      return true;
    }
    const bagIdx = this.hero.relicBag.findIndex((r) => r.id === relicId);
    if (bagIdx === -1) return false;

    const item = this.hero.relicBag[bagIdx];
    if (this.hero.equippedRelics.length < 4 && replaceSlotIndex === undefined) {
      this.hero.relicBag.splice(bagIdx, 1);
      this.hero.equippedRelics.push(item);
    } else {
      const slot =
        replaceSlotIndex !== undefined &&
        replaceSlotIndex >= 0 &&
        replaceSlotIndex < this.hero.equippedRelics.length
          ? replaceSlotIndex
          : 0;
      const swappedOut = this.hero.equippedRelics[slot];
      this.hero.relicBag.splice(bagIdx, 1);
      this.hero.equippedRelics[slot] = item;
      if (swappedOut) {
        this.hero.relicBag.unshift(swappedOut);
      }
    }

    this.hero.recomputeRelicStats(true);
    this.audio.playRelicEquip();
    this.emitHud();
    return true;
  },

  unequipRelic(this: EmbervaultEngine, slotIndex: number): boolean {
    if (this.hero.isDead || this.tradeLocked) return false;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'uneq', s: slotIndex });
      return true;
    }
    if (slotIndex < 0 || slotIndex >= this.hero.equippedRelics.length) return false;
    if (this.hero.relicBag.length >= this.hero.relicBagCap) return false;

    const [removed] = this.hero.equippedRelics.splice(slotIndex, 1);
    this.hero.relicBag.unshift(removed);
    this.hero.recomputeRelicStats(true);
    this.audio.playRelicEquip();
    this.emitHud();
    return true;
  },

  sellRelic(this: EmbervaultEngine, relicId: string): boolean {
    if (this.hero.isDead || this.tradeLocked || !this.isHeroNearShop()) return false;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'sell', id: relicId });
      return true;
    }
    const bagIdx = this.hero.relicBag.findIndex((r) => r.id === relicId);
    if (bagIdx === -1) return false;

    if (!this.audio.isEnabled() && this.hero.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    const [sold] = this.hero.relicBag.splice(bagIdx, 1);
    this.hero.gold += sold.sellValue;
    this.hero.totalGoldEarned += sold.sellValue;
    this.audio.playRelicSell();
    this.emitFloatingText(this.hero.x, 1.9, this.hero.z, `+${sold.sellValue} G`, 'gold');
    this.emitHud();
    return true;
  },

  /** Discards a bag relic anywhere (dungeon included) for half its sell value, freeing the slot. */
  discardRelic(this: EmbervaultEngine, relicId: string): boolean {
    if (this.hero.isDead || this.tradeLocked) return false;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'disc', id: relicId });
      return true;
    }
    const bagIdx = this.hero.relicBag.findIndex((r) => r.id === relicId);
    if (bagIdx === -1) return false;
    const [dropped] = this.hero.relicBag.splice(bagIdx, 1);
    const gained = getRelicDiscardValue(dropped);
    this.hero.gold += gained;
    this.hero.totalGoldEarned += gained;
    this.audio.playRelicSell();
    this.emitFloatingText(this.hero.x, 1.9, this.hero.z, `丟棄 +${gained} G`, 'gold');
    this.emitHud();
    return true;
  },

  /** Discards every blue relic in the bag at half value; returns the gold gained (0 for a teammate's request). */
  discardBlueBagRelics(this: EmbervaultEngine): number {
    if (this.hero.isDead || this.tradeLocked) return 0;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'discb' });
      return 0;
    }
    let gained = 0;
    const keep: RelicItem[] = [];
    for (const r of this.hero.relicBag) {
      if (r.rarity === 'blue') gained += getRelicDiscardValue(r);
      else keep.push(r);
    }
    if (keep.length === this.hero.relicBag.length) return 0;
    this.hero.relicBag = keep;
    this.hero.gold += gained;
    this.hero.totalGoldEarned += gained;
    this.audio.playRelicSell();
    this.emitFloatingText(this.hero.x, 1.9, this.hero.z, `丟棄藍色 +${gained} G`, 'gold');
    this.emitHud();
    return gained;
  },

  sellCommonBagRelics(this: EmbervaultEngine, includeYellow = true): number {
    if (this.hero.isDead || this.tradeLocked || !this.isHeroNearShop()) return 0;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'sellc', y: includeYellow ? 1 : 0 });
      return 0;
    }
    let earned = 0;
    const keep: RelicItem[] = [];
    for (const r of this.hero.relicBag) {
      if (r.rarity === 'blue' || (includeYellow && r.rarity === 'yellow')) {
        earned += r.sellValue;
      } else {
        keep.push(r);
      }
    }
    if (earned <= 0) return 0;

    if (!this.audio.isEnabled() && this.hero.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    this.hero.relicBag = keep;
    this.hero.gold += earned;
    this.hero.totalGoldEarned += earned;
    this.audio.playRelicSell();
    this.emitFloatingText(this.hero.x, 2.0, this.hero.z, `售出 +${earned} G`, 'gold');
    this.emitHud();
    return earned;
  },

  getUpgradeOptions(this: EmbervaultEngine): UpgradeOptionView[] {
    const row = (
      kind: UpgradeKind,
      accent: UpgradeOptionView['accent'],
      label: string,
      maxedLabel: string,
      progress: string
    ): UpgradeOptionView => ({
      kind,
      accent,
      label,
      maxedLabel,
      progress,
      count: this.hero.getUpgradeCount(kind),
      maxCount: this.hero.getUpgradeMax(kind),
      maxed: this.hero.isUpgradeMaxed(kind),
    });
    if (this.hero.isMage()) {
      const speedPct = Math.round(this.hero.shieldSpeedUpgrades * FROST_MAGE.shieldSpeedStep * 100);
      return [
        row(
          'hp_shield',
          'shield',
          `HP +${FROST_MAGE.hpPerUpgrade} · 護盾 +${FROST_MAGE.shieldPerUpgrade}`,
          'HP / 護盾 MAXED',
          `${this.hero.hpShieldUpgrades} / ${FROST_MAGE.maxHpShieldUpgrades} · HP ${this.hero.maxHp} · 護盾 ${this.hero.baseMaxShield}`
        ),
        row(
          'atk',
          'atk',
          '+10% 攻擊力',
          'ATK MAXED',
          `+${this.hero.atkUpgrades * 10}% / +${FROST_MAGE.maxAtkUpgrades * 10}% DMG`
        ),
        row(
          'crit',
          'crit',
          '+2% 爆擊',
          'CRIT MAXED',
          `+${this.hero.critUpgrades * 2}% / +${FROST_MAGE.maxCritUpgrades * 2}% CRIT`
        ),
        row(
          'shield_speed',
          'armor',
          '護盾回充 +12%',
          'REGEN MAXED',
          `-${speedPct}% / -${FROST_MAGE.maxShieldSpeedUpgrades * 12}% 等待與回充時間`
        ),
      ];
    }
    if (this.hero.isHunter()) {
      const spdPct = Math.round(this.hero.atkSpeedUpgrades * HUNTER.atkSpeedStep * 100);
      const maxSpdPct = Math.round(HUNTER.maxAtkSpeedUpgrades * HUNTER.atkSpeedStep * 100);
      return [
        row(
          'hp',
          'hp',
          `+${HUNTER.hpPerUpgrade} Max HP`,
          'HP MAXED',
          `${this.hero.maxHp} / ${this.hero.getBaseMaxHpCap()} HP`
        ),
        row(
          'atk',
          'atk',
          '+10% Attack',
          'ATK MAXED',
          `+${this.hero.atkUpgrades * 10}% / +${HUNTER.maxAtkUpgrades * 10}% DMG`
        ),
        row(
          'atk_speed',
          'atkSpeed',
          '+10% 攻速',
          '攻速已滿',
          `+${spdPct}% / +${maxSpdPct}% 射速`
        ),
        row(
          'crit',
          'crit',
          `+${HUNTER.critPerUpgradePct}% Crit`,
          'CRIT MAXED',
          `+${this.hero.critUpgrades * HUNTER.critPerUpgradePct}% / +${HUNTER.maxCritUpgrades * HUNTER.critPerUpgradePct}% CRIT`
        ),
      ];
    }
    return [
      row(
        'hp',
        'hp',
        `+${WARRIOR.hpPerUpgrade} Max HP`,
        'HP MAXED',
        `${this.hero.maxHp} / ${this.hero.maxHpCap} HP`
      ),
      row(
        'atk',
        'atk',
        '+10% Attack',
        'ATK MAXED',
        `+${this.hero.atkUpgrades * 10}% / +${this.hero.maxAtkUpgrades * 10}% DMG`
      ),
      row(
        'armor',
        'armor',
        '+10% Armor',
        'DEF MAXED',
        `${this.hero.armorUpgrades * 10}% / ${this.hero.maxArmorUpgrades * 10}% DEF`
      ),
      row(
        'crit',
        'crit',
        '+2% Crit',
        'CRIT MAXED',
        `+${this.hero.critUpgrades * 2}% / +${this.hero.maxCritUpgrades * 2}% CRIT`
      ),
    ];
  },

  getUpgradeCost(this: EmbervaultEngine): number {
    const lv = this.hero.getTotalUpgradeLevel();
    return 40 + lv * 25 + Math.floor(lv * lv * 4);
  },

  getPotionCost(this: EmbervaultEngine): number {
    return this.depth * 10;
  },

  isHeroNearAltar(this: EmbervaultEngine): boolean {
    if (!this.dungeon?.altarPos) return false;
    const aw = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
    return Math.hypot(this.hero.x - aw.x, this.hero.z - aw.z) < 2.55;
  },

  isHeroNearShop(this: EmbervaultEngine): boolean {
    if (!this.dungeon?.shopPos) return false;
    const sw = gridToWorld(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
    return Math.hypot(this.hero.x - sw.x, this.hero.z - sw.z) < 2.55;
  },

  isHeroNearPortal(this: EmbervaultEngine): boolean {
    if (this.inTown) {
      if (!this.townGatePos) return false;
      return Math.hypot(this.hero.x - this.townGatePos.x, this.hero.z - this.townGatePos.z) < 2.25;
    }
    return this.findNearbyDungeonPortal(this.localHero) !== null;
  },

  isHeroNearStash(this: EmbervaultEngine): boolean {
    if (!this.inTown || !this.stashPos) return false;
    return Math.hypot(this.hero.x - this.stashPos.x, this.hero.z - this.stashPos.z) < 2.75;
  },

  /** Opens the stash window. Only in town, next to the chest, on a saved character (never for attract mode). */
  openStash(this: EmbervaultEngine): boolean {
    if (this.hero.isDead || !this.inTown || !this.persistRun || this.loadingRun || this.tradeLocked) return false;
    if (this.transitionState !== 'none' || !this.isHeroNearStash()) return false;
    if (this.hero.stashOpen) return true;
    this.hero.stashOpen = true;
    this.hero.input.keys.clear();
    this.hero.input.leftMouseHeld = false;
    this.audio.playRelicEquip();
    this.emitHud();
    return true;
  },

  /** Closes the stash window and asks the host to save. Safe to call when already closed. */
  closeStash(this: EmbervaultEngine): void {
    if (!this.hero.stashOpen) return;
    this.hero.stashOpen = false;
    this.hero.input.keys.clear();
    this.audio.playRelicEquip();
    this.requestSave('stash');
    this.emitHud();
  },

  /** Bag -> stash. Equipped relics must be unequipped to the bag first. */
  depositRelic(this: EmbervaultEngine, relicId: string): StashMoveResult {
    if (!this.hero.stashOpen || !this.inTown || this.hero.isDead || this.tradeLocked) return { ok: false, reason: 'closed' };
    const idx = this.hero.relicBag.findIndex((r) => r.id === relicId);
    if (idx === -1) return { ok: false, reason: 'notFound' };
    if (this.hero.stash.length >= STASH_CAP) return { ok: false, reason: 'stashFull' };
    const [item] = this.hero.relicBag.splice(idx, 1);
    this.hero.stash.push(item);
    this.audio.playRelicEquip();
    this.emitHud();
    return { ok: true };
  },

  /** Sells a relic directly from the bag or town stash while the stash modal is open. */
  sellRelicInStash(
    this: EmbervaultEngine,
    relicId: string,
    source: 'bag' | 'stash'
  ): { ok: true; gold: number; name: string } | { ok: false; reason: 'closed' | 'notFound' } {
    if (!this.hero.stashOpen || !this.inTown || this.hero.isDead || this.tradeLocked) {
      return { ok: false, reason: 'closed' };
    }
    const list = source === 'bag' ? this.hero.relicBag : this.hero.stash;
    const idx = list.findIndex((r) => r.id === relicId);
    if (idx === -1) return { ok: false, reason: 'notFound' };
    const [item] = list.splice(idx, 1);
    this.hero.gold += item.sellValue;
    this.hero.totalGoldEarned += item.sellValue;
    this.audio.playCoin();
    this.emitHud();
    return { ok: true, gold: item.sellValue, name: item.name };
  },

  /** Stash -> bag. */
  withdrawRelic(this: EmbervaultEngine, relicId: string): StashMoveResult {
    if (!this.hero.stashOpen || !this.inTown || this.hero.isDead || this.tradeLocked) return { ok: false, reason: 'closed' };
    const idx = this.hero.stash.findIndex((r) => r.id === relicId);
    if (idx === -1) return { ok: false, reason: 'notFound' };
    if (this.hero.relicBag.length >= this.hero.relicBagCap) return { ok: false, reason: 'bagFull' };
    const [item] = this.hero.stash.splice(idx, 1);
    this.hero.relicBag.unshift(item);
    this.audio.playRelicEquip();
    this.emitHud();
    return { ok: true };
  },

  isHeroNearAngel(this: EmbervaultEngine): boolean {
    if (!this.inTown || !this.angelPos) return false;
    return Math.hypot(this.hero.x - this.angelPos.x, this.hero.z - this.angelPos.z) < 2.75;
  },

  purchaseUpgrade(this: EmbervaultEngine, kind: UpgradeKind): boolean {
    if (this.tradeLocked || !this.dungeon?.altarPos || !this.isHeroNearAltar()) return false;
    if (this.mpGuestDungeon()) {
      if (this.hero.gold < this.getUpgradeCost() || this.hero.getUpgradeMax(kind) <= 0 || this.hero.isUpgradeMaxed(kind)) return false;
      this.mpGuestCmd({ c: 'up', kind });
      return true;
    }
    const cost = this.getUpgradeCost();
    if (this.hero.gold < cost) return false;
    if (this.hero.getUpgradeMax(kind) <= 0 || this.hero.isUpgradeMaxed(kind)) return false;

    if (!this.audio.isEnabled() && this.hero.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    this.hero.gold -= cost;
    const effMax = this.hero.getEffectiveMaxHp();
    if (kind === 'hp_shield') {
      this.hero.hpShieldUpgrades += 1;
      this.hero.maxHp += FROST_MAGE.hpPerUpgrade;
      this.hero.baseMaxShield += FROST_MAGE.shieldPerUpgrade;
      this.hero.hp = this.hero.getEffectiveMaxHp();
      this.hero.shield = this.hero.getEffectiveMaxShield();
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `HP +${FROST_MAGE.hpPerUpgrade} · 護盾 +${FROST_MAGE.shieldPerUpgrade} · FULL`,
        'shieldHit'
      );
    } else if (kind === 'shield_speed') {
      this.hero.shieldSpeedUpgrades += 1;
      this.hero.hp = effMax;
      this.hero.shield = this.hero.getEffectiveMaxShield();
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `護盾回充 +${this.hero.shieldSpeedUpgrades * 12}% · FULL`,
        'shieldHit'
      );
    } else if (kind === 'atk_speed') {
      this.hero.atkSpeedUpgrades += 1;
      this.hero.hp = effMax;
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `攻速 +${Math.round(this.hero.atkSpeedUpgrades * HUNTER.atkSpeedStep * 100)}% · FULL HP`,
        'info'
      );
    } else if (kind === 'hp') {
      const hpStep = this.hero.isHunter() ? HUNTER.hpPerUpgrade : WARRIOR.hpPerUpgrade;
      this.hero.hpUpgrades += 1;
      this.hero.maxHp = Math.min(this.hero.getBaseMaxHpCap(), this.hero.maxHp + hpStep);
      this.hero.hp = this.hero.getEffectiveMaxHp();
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `+${hpStep} MAX HP · FULL HP`,
        'heal'
      );
    } else if (kind === 'armor') {
      this.hero.armorUpgrades += 1;
      this.hero.hp = effMax;
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `DEF +${this.hero.armorUpgrades * 10}% · FULL HP`,
        'info'
      );
    } else if (kind === 'crit') {
      const critStep = this.hero.isHunter() ? HUNTER.critPerUpgradePct : 2;
      this.hero.critUpgrades += 1;
      this.hero.hp = effMax;
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `CRIT +${this.hero.critUpgrades * critStep}% · FULL HP`,
        'crit'
      );
    } else {
      this.hero.atkUpgrades += 1;
      this.hero.hp = effMax;
      this.emitFloatingText(
        this.hero.x,
        2.0,
        this.hero.z,
        `ATK +${this.hero.atkUpgrades * 10}% · FULL HP`,
        'crit'
      );
    }

    if (this.hero.isMage()) {
      this.hero.shield = this.hero.getEffectiveMaxShield();
    }
    this.audio.playUpgrade();

    const aw = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const particleColor =
        kind === 'hp'
          ? i % 2 === 0
            ? 0xff5a72
            : 0xffe066
          : kind === 'armor' || kind === 'hp_shield' || kind === 'shield_speed'
          ? i % 2 === 0
            ? 0x6ecbff
            : 0xffe066
          : kind === 'crit'
          ? i % 2 === 0
            ? 0x7eff9b
            : 0xffe066
          : i % 2 === 0
          ? 0xffe066
          : 0xff9838;
      this.spawnParticle(
        aw.x + Math.cos(a) * 0.45,
        0.9,
        aw.z + Math.sin(a) * 0.45,
        Math.cos(a) * 1.8,
        2.4 + Math.random() * 1.6,
        Math.sin(a) * 1.8,
        particleColor,
        1.15,
        0.72,
        -0.8
      );
    }

    this.emitHud();
    return true;
  },

  purchasePotion(this: EmbervaultEngine): boolean {
    if (this.hero.isDead || this.tradeLocked) return false;
    const nearShop = this.isHeroNearShop();
    const nearAltar = this.isHeroNearAltar();
    if (!nearShop && !nearAltar) return false;
    const cost = this.getPotionCost();
    if (this.hero.gold < cost) return false;
    if (this.mpGuestDungeon()) {
      this.mpGuestCmd({ c: 'buy' });
      return true;
    }

    if (!this.audio.isEnabled() && this.hero.controlMode === 'manual') {
      this.audio.unlockAndEnable();
    }

    this.hero.gold -= cost;
    this.hero.potions += 1;
    this.audio.playPotion();
    this.emitFloatingText(this.hero.x, 2.0, this.hero.z, '+1 ELIXIR', 'heal');

    const stationPos = nearShop ? this.dungeon.shopPos! : this.dungeon.altarPos!;
    const sw = gridToWorld(stationPos.gx, stationPos.gz);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.spawnParticle(
        sw.x + Math.cos(a) * 0.4,
        0.9,
        sw.z + Math.sin(a) * 0.4,
        Math.cos(a) * 1.5,
        2.1 + Math.random() * 1.2,
        Math.sin(a) * 1.5,
        i % 2 === 0 ? 0xff4d6d : 0xffb3c1,
        1.0,
        0.62,
        -0.8
      );
    }

    this.emitHud();
    return true;
  },
};
