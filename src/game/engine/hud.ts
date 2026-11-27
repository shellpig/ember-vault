import type { EmbervaultEngine } from '../engine';
import { HERO_CLASSES, HUNTER } from '../classes';
import { worldToGrid } from '../dungeon';
import { _projVec } from '../engine/scratch';
import { STASH_CAP } from '../hero';
import { FloatingLabelData, RunSummary } from '../types';

export const hudMethods = {
  buildRunSummary(this: EmbervaultEngine): RunSummary {
    return {
      heroClass: this.hero.classId,
      depth: this.depth,
      biomeName: this.dungeon.biome.name,
      durationSec: Math.max(1, Math.floor(this.runElapsedSec)),
      totalGoldEarned: this.hero.totalGoldEarned,
      goldRemaining: this.hero.gold,
      totalKills: this.hero.kills,
      normalKills: this.hero.normalKills,
      eliteKills: this.hero.eliteKills,
      bossKills: this.hero.bossKills,
      upgradeLevel: this.hero.getTotalUpgradeLevel(),
      // For the Frost Mage, "hpUpgrades" reports HP+shield upgrades and "armorUpgrades" reports shield-speed upgrades.
      // For the Hunter, "armorUpgrades" reports attack-speed upgrades and crit gives +3% per level.
      hpUpgrades: this.hero.isMage() ? this.hero.hpShieldUpgrades : this.hero.hpUpgrades,
      atkUpgrades: this.hero.atkUpgrades,
      armorUpgrades: this.hero.isMage()
        ? this.hero.shieldSpeedUpgrades
        : this.hero.isHunter()
        ? this.hero.atkSpeedUpgrades
        : this.hero.armorUpgrades,
      critUpgrades: this.hero.critUpgrades,
      maxHp: this.hero.maxHp,
      atkBonusPct: this.hero.atkUpgrades * 10,
      armorBonusPct: this.hero.armorUpgrades * 10,
      atkSpeedBonusPct: this.hero.isHunter()
        ? Math.round(this.hero.atkSpeedUpgrades * HUNTER.atkSpeedStep * 100)
        : 0,
      critBonusPct: this.hero.critUpgrades * (this.hero.isHunter() ? HUNTER.critPerUpgradePct : 2),
      potionsUsed: this.hero.potionsUsed,
      potionsLeft: this.hero.potions,
      totalDamageDealt: this.hero.totalDamageDealt,
      critCount: this.hero.critCount,
      slainBy: this.hero.slainBy,
    };
  },

  /** Bot actions stay quiet unless `force` (team-wide events like the key / gate / boss kill). */
  pushBanner(this: EmbervaultEngine, title: string, subtitle?: string, force = false): void {
    if (this.mp?.role === 'host' && (force || this.hero.isRemote)) {
      this.mpEmit(['b', title, subtitle ?? '', force ? '' : this.hero.id]);
    }
    if (this.bgSim || (this.isSilentActor() && !force)) return;
    this.callbacks.onBanner({ id: this.nextId++, title, subtitle });
  },

  emitFloatingText(
    this: EmbervaultEngine,
    wx: number,
    wy: number,
    wz: number,
    text: string,
    tone: FloatingLabelData['tone'],
    force = false
  ): void {
    if (this.mp?.role === 'host') this.mpCaptureFloat(wx, wy, wz, text, tone);
    if (!this.camera || !this.renderer || this.bgSim) return;
    if (this.isSilentActor() && !force) return;
    _projVec.set(wx, wy, wz).project(this.camera);
    if (_projVec.z > 1) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const sx = (_projVec.x * 0.5 + 0.5) * w;
    const sy = (-_projVec.y * 0.5 + 0.5) * h;
    this.callbacks.onFloatingLabel({
      id: this.nextId++,
      text,
      x: sx,
      y: sy,
      tone,
    });
  },

  emitHud(this: EmbervaultEngine): void {
    if (this.bgSim || this.isSilentActor()) return; // the HUD only ever shows the local hero
    const lh = this.localHero;
    const rescueHud = this.getRescueHud();
    const activeBoss = this.viewEnemies().find(
      (e) =>
        e.isBoss &&
        !e.dead &&
        Math.hypot(e.x - lh.x, e.z - lh.z) < 15.5
    );

    this.callbacks.onHudChange({
      hp: lh.hp,
      maxHp: lh.getEffectiveMaxHp(),
      baseMaxHp: lh.maxHp,
      maxHpCap: lh.getBaseMaxHpCap(),
      potions: lh.potions,
      hasKey: this.hasKey,
      doorUnlocked: this.doorUnlocked,
      depth: this.depth,
      biomeName: this.inTown ? '庇護小鎮' : this.dungeon.biome.name,
      gold: lh.gold,
      kills: lh.kills,
      atkBonusPct: lh.atkUpgrades * 10,
      armorBonusPct: lh.armorUpgrades * 10,
      armorMaxPct: lh.maxArmorUpgrades * 10,
      atkSpeedBonusPct: lh.isHunter() ? Math.round(lh.atkSpeedUpgrades * HUNTER.atkSpeedStep * 100) : 0,
      atkSpeedMaxPct: Math.round(HUNTER.maxAtkSpeedUpgrades * HUNTER.atkSpeedStep * 100),
      critBonusPct: lh.critUpgrades * (lh.isHunter() ? HUNTER.critPerUpgradePct : 2),
      critMaxPct: lh.getUpgradeMax('crit') * (lh.isHunter() ? HUNTER.critPerUpgradePct : 2),
      upgradeLevel: lh.getTotalUpgradeLevel(),
      upgradeCost: this.getUpgradeCost(),
      potionCost: this.getPotionCost(),
      nearAltar: this.isHeroNearAltar(),
      hasAltarOnFloor: Boolean(this.dungeon.altarPos),
      nearShop: this.isHeroNearShop(),
      hasShopOnFloor: Boolean(this.dungeon.shopPos),
      inTown: this.inTown,
      nearPortal: this.isHeroNearPortal(),
      portalOptions: this.getTownPortalOptions(),
      dungeonRunning: this.inTown && this.dungeonCtx !== null,
      nearAngel: this.isHeroNearAngel(),
      townReturnCost: this.getTownReturnCost(),
      angelBuff: lh.angelBuff ? { ...lh.angelBuff } : null,
      controlMode: lh.controlMode,
      soundOn: this.audio.isEnabled(),
      dashReady: lh.dashCooldown <= 0,
      pommelCooldown: lh.pommelCooldown,
      pommelMaxCooldown: lh.pommelMaxCooldown,
      fadeOpacity: this.fadeOpacity,
      aiStatus: lh.ai.status,
      boss: activeBoss
        ? {
            name: activeBoss.bossName ?? 'DUNGEON BOSS',
            title: activeBoss.bossTitle ?? '',
            hp: Math.max(0, activeBoss.hp),
            maxHp: activeBoss.maxHp,
            state: activeBoss.bossState ?? 'chase',
          }
        : null,
      isDead: lh.isDead,
      runSummary: lh.isDead ? this.buildRunSummary() : null,
      beingRescued: rescueHud.beingRescued,
      rescuePrompt: rescueHud.prompt,
      partySize: this.heroes.length,
      party: this.mpPartyInfo(),
      mpWait: this.mp?.hold ? this.mp.holdText || null : null,
      equippedRelics: [...lh.equippedRelics],
      relicBag: [...lh.relicBag],
      relicBagCap: lh.relicBagCap,
      nearStash: this.isHeroNearStash(),
      stashOpen: lh.stashOpen,
      // The trade window picks from the stash too (P6), so it is exposed while a trade holds the lock
      stash: lh.stashOpen || this.tradeLocked ? [...lh.stash] : [],
      stashCount: lh.stash.length,
      stashCap: STASH_CAP,
      relicStats: lh.relicStats,
      activeSets: lh.relicStats.activeSets,
      discoveredRelicIds: Array.from(lh.discoveredRelicIds),
      heroClass: lh.classId,
      shield: Math.round(lh.shield),
      maxShield: lh.getEffectiveMaxShield(),
      shieldRegenerating:
        lh.isMage() &&
        lh.shield < lh.getEffectiveMaxShield() &&
        lh.timeSinceDamaged >= lh.getShieldRegenDelay(),
      skillName: HERO_CLASSES[lh.classId].skillName,
      mobilityName: HERO_CLASSES[lh.classId].mobilityName,
      upgradeOptions: this.getUpgradeOptions(),
      pet: (() => {
        const p = this.pets.get(lh.id);
        if (!p || lh.isDead) return null;
        return {
          species: p.species,
          name: p.name,
          hp: Math.max(0, Math.round(p.hp)),
          maxHp: p.maxHp,
          buffRemaining: Math.max(0, p.buffTimer),
          buffMax: HUNTER.petBuffDuration,
          regenerating: p.hp < p.maxHp && p.timeSinceDamaged >= HUNTER.petRegenDelay,
        };
      })(),
      companions: this.heroes
        .filter((h) => h !== lh && (h.isBot || h.isRemote))
        .map((h) => ({
          id: h.id,
          name: h.displayName || (h.isBot ? `Bot ${h.botIndex}` : this.mp ? this.mpNameOf(h.id) : '隊友'),
          classId: h.classId,
          level: h.netLevel ?? 1 + h.getTotalUpgradeLevel(),
          hp: Math.max(0, Math.round(h.hp)),
          maxHp: Math.max(1, Math.round(h.getEffectiveMaxHp())),
          shield: Math.max(0, Math.round(h.shield)),
          maxShield: Math.round(h.netMaxShield ?? h.getEffectiveMaxShield()),
          isDead: h.isDead,
          inTown: h.inTown,
        })),
    });
  },

  emitMinimap(this: EmbervaultEngine): void {
    if (this.bgSim || this.isSilentActor()) return;
    const lh = this.localHero;
    const heroG = worldToGrid(lh.x, lh.z);
    this.callbacks.onMinimapUpdate({
      width: this.dungeon.width,
      height: this.dungeon.height,
      tiles: this.dungeon.tiles,
      explored: this.dungeon.explored,
      playerX: heroG.gx,
      playerZ: heroG.gz,
      keyX: this.dungeon.keyPos.gx,
      keyZ: this.dungeon.keyPos.gz,
      hasKey: this.hasKey,
      doorX: this.dungeon.doorPos.gx,
      doorZ: this.dungeon.doorPos.gz,
      doorUnlocked: this.doorUnlocked,
      stairsX: this.dungeon.stairsPos.gx,
      stairsZ: this.dungeon.stairsPos.gz,
      altarX: this.dungeon.altarPos?.gx,
      altarZ: this.dungeon.altarPos?.gz,
      shopX: this.dungeon.shopPos?.gx,
      shopZ: this.dungeon.shopPos?.gz,
      terrainTheme: this.dungeon.biome.terrainTheme,
      enemies: this.viewEnemies()
        .filter((e) => !e.dead)
        .map((e) => {
          const g = worldToGrid(e.x, e.z);
          return { x: g.gx, z: g.gz, isBoss: e.isBoss, isElite: e.isElite };
        }),
      relics: this.loots
        .filter((l) => !l.collected && l.type === 'relic' && (l.relic || l.rarity) && l.ownerId === this.localHeroId)
        .map((l) => {
          const g = worldToGrid(l.x, l.z);
          return { x: g.gx, z: g.gz, rarity: (l.relic?.rarity ?? l.rarity)! };
        }),
    });
  },

  markExplored(this: EmbervaultEngine, cgx: number, cgz: number): void {
    const radius = 5;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const nx = cgx + dx;
        const nz = cgz + dz;
        if (nx >= 0 && nz >= 0 && nx < this.dungeon.width && nz < this.dungeon.height) {
          this.dungeon.explored[nz][nx] = true;
        }
      }
    }
  },
};
