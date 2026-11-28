import { EmbervaultEngine } from '../engine';
import { HeroClassId } from '../classes';
import { gridToWorld, worldToGrid } from '../dungeon';
import { SavedDungeonSnapshot } from './entities';
import { DEATH_RETURN_COST_MULT } from './data';
import { _camTarget } from './scratch';
import { Hero, STASH_CAP } from '../hero';
import type { CharacterLoadout } from '../hero';
import { TownPortalRig, createTownPortal } from '../models';
import { RelicItem, rollAngelBlessing } from '../relics';
import { DungeonData, FloatingLabelData, TownPortalOption } from '../types';
import * as THREE from 'three';
import type { SaveCheckpointReason } from '../engine';

export const travelMethods = {
  /** Freezes the current floor so the town portal can bring the hero back to `portal`. */
  snapshotDungeon(this: EmbervaultEngine, portal: { x: number; z: number }): SavedDungeonSnapshot {
    // Record consumed rune wells & broken crates so the floor stays consistent on return
    const usedRuneKeys = new Set<string>();
    for (const lp of this.lightProps) {
      if (lp.kind === 'rune' && lp.used) {
        const g = worldToGrid(lp.x, lp.z);
        usedRuneKeys.add(`${g.gx},${g.gz}`);
      }
    }
    const brokenBreakableKeys = new Set<string>();
    for (const b of this.breakables) {
      if (b.broken) {
        const g = worldToGrid(b.x, b.z);
        brokenBreakableKeys.add(`${g.gx},${g.gz}`);
      }
    }
    return {
      depth: this.depth,
      dungeon: this.dungeon,
      hasKey: this.hasKey,
      doorUnlocked: this.doorUnlocked,
      chronosUsedThisFloor: this.hero.chronosUsedThisFloor,
      floorKills: this.hero.floorKills,
      returnX: portal.x,
      returnZ: portal.z,
      usedRuneKeys,
      brokenBreakableKeys,
      loots: this.loots
        .filter((l) => !l.collected)
        .map((l) => ({ ownerId: l.ownerId, type: l.type, value: l.value, relic: l.relic, x: l.x, z: l.z })),
    };
  },

  /** Places a hero's lingering portal landmark (replacing that hero's previous one) in the current dungeon floor. */
  placeHeroPortal(this: EmbervaultEngine, hero: Hero, x: number, z: number, depth: number): void {
    if (!this.textures) return;
    const old = this.heroPortalRigs.get(hero.id);
    if (old) {
      old.root.parent?.remove(old.root);
      old.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        } else if (obj instanceof THREE.Sprite) {
          obj.material.dispose(); // keep the shared glow texture alive
        }
      });
      this.heroPortalRigs.delete(hero.id);
    }
    this.lightProps = this.lightProps.filter((lp) => !(lp.kind === 'portal' && lp.heroId === hero.id));
    const portal = createTownPortal(this.textures.glowMap);
    portal.root.position.set(x, 0, z);
    portal.root.rotation.y = Math.PI / 4;
    this.levelGroup.add(portal.root);
    this.heroPortalRigs.set(hero.id, portal);
    hero.portal = { x, z, depth };
    this.lightProps.push({
      color: 0x35a8db,
      baseIntensity: 21,
      distance: 8.2,
      decay: 2.05,
      phase: 0.4,
      x,
      y: 1.4,
      z,
      kind: 'portal',
      heroId: hero.id,
    });
  },

  /** True while some other hero is alive in the dungeon, i.e. the dungeon keeps running without the local hero. */
  partyHoldsDungeon(this: EmbervaultEngine): boolean {
    const local = this.localHero;
    return this.heroes.some((h) => h !== local && this.isInDungeonAlive(h));
  },

  /**
   * The local hero walks into the town (runs at the black of the fade; spec §3.4). If a teammate is still alive
   * in the dungeon it is parked and keeps being simulated; otherwise it is frozen exactly like the single player
   * flow (saved, discarded, rebuilt with fresh monsters when somebody comes back).
   */
  enterTownFromDungeon(this: EmbervaultEngine): void {
    const local = this.localHero;
    this.awayAnchor = { x: local.x, z: local.z };
    local.inTown = true;
    if (this.mp) this.mp.town.last = null; // announce my town position (P5-C)
    if (this.partyHoldsDungeon()) {
      this.dungeonCtx = this.captureCtx();
      this.savedDungeon = null;
    } else {
      // The floor freezes: the teammates still in it (downed) hear about it one last time (P5-C)
      if (this.mp?.role === 'host') this.mpHostFreezeFlush();
      this.savedDungeon = this.snapshotDungeon({ x: local.x, z: local.z });
      this.clearLevel();
      this.dungeonCtx = null;
    }
    this.applyCtx(this.blankCtx());
    this.setViewGroups(true);
    this.buildTown();
  },

  /**
   * Death flow, step 2 (the player pressed 回到城鎮 on the death screen): pay the rescue toll
   * (`getDeathReturnCost()`, floored at 0 gold), refill HP/shield and go through the portal opened at the downed spot.
   */
  confirmDeathReturn(this: EmbervaultEngine): void {
    if (!this.hero.isDead || this.inTown || this.transitionState !== 'none') return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    if (this.mp?.role === 'guest') {
      this.mpGuestAskTown(true);
      return;
    }
    const portal = this.hero.portal ?? { x: this.hero.x, z: this.hero.z, depth: this.depth };
    this.hero.portal = portal;
    const cost = this.getDeathReturnCost();
    this.hero.gold = Math.max(0, this.hero.gold - cost);
    this.audio.playPortal();
    this.hero.input.keys.clear();
    this.beginTransition(() => {
      this.hero.isDead = false;
      this.hero.restoreAfterDowned();
      this.enterTownFromDungeon();
      this.requestSave('town');
    });
  },

  /**
   * Gets a downed hero (default: the local one) back on their feet at full health, in place, without any toll.
   * The portal stays and they are briefly invulnerable. Called when a teammate finishes the 3 second rescue.
   */
  reviveHero(this: EmbervaultEngine, target?: Hero): void {
    const t = target ?? this.localHero;
    if (!t.isDead || this.transitionState !== 'none') return;
    t.isDead = false;
    t.restoreAfterDowned();
    t.invuln = 1.5;
    t.rescueTargetId = null;
    t.rescueProgress = 0;
    this.emitFloatingText(t.x, 2.1, t.z, '被救起！', 'heal');
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.spawnParticle(
        t.x + Math.cos(a) * 0.4,
        0.6,
        t.z + Math.sin(a) * 0.4,
        Math.cos(a) * 1.8,
        1.8 + Math.random() * 1.2,
        Math.sin(a) * 1.8,
        i % 2 === 0 ? 0x7dffb0 : 0xffffff,
        1.0,
        0.6,
        -0.6
      );
    }
    this.emitHud();
  },

  getTownReturnCost(this: EmbervaultEngine): number {
    return this.depth * 10;
  },

  /** Death toll ("rescue team"): the portal toll x DEATH_RETURN_COST_MULT, a small death penalty. */
  getDeathReturnCost(this: EmbervaultEngine): number {
    return this.getTownReturnCost() * DEATH_RETURN_COST_MULT;
  },

  /** Removes a hero's dungeon portal data and 3D rig (used when the owner returns from town). */
  clearHeroPortal(this: EmbervaultEngine, hero: Hero): void {
    hero.portal = null;
    for (const map of [this.heroPortalRigs, this.dungeonCtx?.heroPortalRigs]) {
      const rig = map?.get(hero.id);
      if (!rig) continue;
      rig.root.parent?.remove(rig.root);
      rig.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      map?.delete(hero.id);
    }
  },

  /** Steps through an existing dungeon portal (own or teammate's) back to town for free (spec §3.1). */
  useDungeonPortal(this: EmbervaultEngine): void {
    if (this.hero.isDead || this.inTown || this.transitionState !== 'none' || this.tradeLocked) return;
    if (!this.findNearbyDungeonPortal(this.hero)) return;
    this.returnToTown(true);
  },

  returnToTown(this: EmbervaultEngine, viaExistingPortal = false): void {
    if (this.hero.isDead || this.inTown || this.transitionState !== 'none') return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    if (this.mp?.role === 'guest') {
      this.mpGuestAskTown(false, viaExistingPortal);
      return;
    }

    const cost = viaExistingPortal ? 0 : this.getTownReturnCost();
    const spent = Math.min(this.hero.gold, cost);
    this.hero.gold = Math.max(0, this.hero.gold - cost);

    // A normal return opens a fresh portal under the hero (replacing any older one);
    // stepping through an existing portal reuses it without opening a new one.
    const partyStays = this.partyHoldsDungeon();
    if (!viaExistingPortal) {
      if (partyStays) {
        // The floor keeps running: the portal is a real, lasting landmark right now
        this.placeHeroPortal(this.hero, this.hero.x, this.hero.z, this.depth);
      } else {
        this.hero.portal = { x: this.hero.x, z: this.hero.z, depth: this.depth };
      }

      // Spawn instantaneous glowing portal at current spot before fading into Sanctuary Town
      if (!partyStays && this.textures) {
        const departPortal = createTownPortal(this.textures.glowMap);
        departPortal.root.position.set(this.hero.x, 0, this.hero.z);
        departPortal.root.rotation.y = Math.PI / 4;
        this.dynamicGroup.add(departPortal.root);
      }
    }
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.spawnParticle(
        this.hero.x + Math.cos(a) * 0.35,
        0.7,
        this.hero.z + Math.sin(a) * 0.35,
        Math.cos(a) * 2.4,
        2.2 + Math.random() * 1.4,
        Math.sin(a) * 2.4,
        i % 2 === 0 ? 0x56e4ff : 0xd9fbff,
        1.1,
        0.65,
        -0.4
      );
    }

    this.audio.playPortal();
    this.emitFloatingText(
      this.hero.x,
      2.1,
      this.hero.z,
      spent > 0 ? `回城鎮 -${spent}G` : '回城鎮',
      'info'
    );
    this.hero.input.keys.clear();
    this.emitHud();

    this.beginTransition(() => {
      this.enterTownFromDungeon();
      this.requestSave('town');
    });
  },

  /** The dungeon data behind the town gate (parked while running, kept in the frozen snapshot otherwise). */
  getParkedDungeon(this: EmbervaultEngine): DungeonData | null {
    return this.dungeonCtx?.dungeon ?? this.savedDungeon?.dungeon ?? null;
  },

  /**
   * Doors the town gate can lead to (spec §3.1): everybody's portal on the current floor, the local hero's first.
   * No portal at all (e.g. after a floor change): the floor entrance (spec §5.3).
   */
  getTownPortalOptions(this: EmbervaultEngine): TownPortalOption[] {
    if (!this.inTown) return [];
    const local = this.localHero;
    const opts: TownPortalOption[] = [];
    for (const h of this.heroes) {
      if (!h.portal || h.portal.depth !== this.depth) continue;
      opts.push({
        id: h.id,
        label:
          h === local
            ? '我的傳送門'
            : h.displayName
            ? `${h.displayName} 的傳送門`
            : h.isBot
            ? `${h.displayName || `Bot ${h.botIndex}`} 的傳送門`
            : '隊友的傳送門',
        isOwn: h === local,
        downed: h.isDead || (this.mp?.role === 'guest' && h !== local && this.mp.guest.partyState.get(h.id) === 2),
      });
    }
    if (opts.length === 0) {
      opts.push({ id: 'entrance', label: `第 ${this.depth} 層入口`, isOwn: false, downed: false });
    }
    return opts;
  },

  resolveGateTarget(this: EmbervaultEngine, portalId?: string): { x: number; z: number } | null {
    const opts = this.getTownPortalOptions();
    const pick = opts.find((o) => o.id === portalId) ?? opts[0];
    if (!pick) return null;
    if (pick.id !== 'entrance') {
      const owner = this.heroById(pick.id);
      if (owner?.portal) return { x: owner.portal.x, z: owner.portal.z };
    }
    const d = this.getParkedDungeon();
    if (!d) return null;
    return gridToWorld(d.spawn.gx, d.spawn.gz);
  },

  /** The local hero steps out of the town gate into the dungeon (runs at the black of the fade). */
  enterDungeonFromTown(this: EmbervaultEngine, target: { x: number; z: number }): void {
    // Owner returning from town closes their own portal (teammates' portals stay open)
    this.clearHeroPortal(this.localHero);
    const snap = this.savedDungeon;
    if (snap) {
      // Frozen floor: rebuild it with fresh monsters around the chosen portal (spec §3.4)
      this.savedDungeon = null;
      snap.returnX = target.x;
      snap.returnZ = target.z;
      this.buildLevel(snap.depth, { savedSnapshot: snap });
      return;
    }
    if (!this.dungeonCtx) return;
    // Running floor: nothing is rebuilt, the local hero simply steps back in
    const local = this.localHero;
    this.leaveTownScene();
    this.applyDungeonAtmosphere();
    local.x = target.x;
    local.z = target.z;
    local.vx = 0;
    local.vz = 0;
    local.dashTimer = 0;
    local.invuln = Math.max(local.invuln, 1.0);
    local.ai.path = [];
    local.ai.combatPath = [];
    local.ai.progressAnchorX = local.x;
    local.ai.progressAnchorZ = local.z;
    local.ai.noProgressTimer = 0;
    local.rig.root.position.set(local.x, 0, local.z);
    local.rig.body.rotation.y = local.facing;
    this.heroLight.position.set(local.x, 2.0, local.z);
    if (this.depth > local.maxDepthReached && !this.devDepthRun) {
      local.maxDepthReached = this.depth;
      this.requestSave('floor');
    }
    const camOffset = 14.5 * this.camZoom;
    this.camera.position.set(local.x + camOffset, camOffset * 1.16, local.z + camOffset);
    _camTarget.set(local.x, 0.7, local.z);
    this.camera.lookAt(_camTarget);
    const g = worldToGrid(local.x, local.z);
    this.markExplored(g.gx, g.gz);
    this.pushBanner(`返回第 ${this.depth} 層`, '隊友仍在戰鬥 · 怪物沒有重生');
    this.updateWallOcclusion();
    this.emitHud();
    this.emitMinimap();
  },

  /** Walks through the town gate. `portalId` picks one of `getTownPortalOptions()` (default: the first). */
  returnToDungeon(this: EmbervaultEngine, portalId?: string): void {
    if (this.hero.isDead || !this.inTown || this.transitionState !== 'none' || this.tradeLocked) return;
    if (this.mp?.role === 'guest') {
      this.mpGuestReturn(portalId);
      return;
    }
    if (!this.savedDungeon && !this.dungeonCtx) return;
    const target = this.resolveGateTarget(portalId);
    if (!target) return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.audio.playPortal();
    this.hero.input.keys.clear();

    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.spawnParticle(
        this.hero.x + Math.cos(a) * 0.35,
        0.7,
        this.hero.z + Math.sin(a) * 0.35,
        Math.cos(a) * 2.2,
        2.2 + Math.random() * 1.2,
        Math.sin(a) * 2.2,
        i % 2 === 0 ? 0x56e4ff : 0xffffff,
        1.05,
        0.6,
        -0.4
      );
    }

    this.requestSave('leaveTown');
    this.beginTransition(() => {
      this.enterDungeonFromTown(target);
    });
  },

  requestAngelBlessing(this: EmbervaultEngine): boolean {
    if (this.hero.isDead || !this.inTown || !this.isHeroNearAngel() || this.hero.angelBuff) {
      return false;
    }
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();

    const buff = rollAngelBlessing(this.depth);
    this.hero.angelBuff = buff;
    this.hero.recomputeRelicStats(true);
    this.audio.playAngelBlessing();

    const tone: FloatingLabelData['tone'] =
      buff.rarity === 'orange'
        ? 'relicOrange'
        : buff.rarity === 'yellow'
        ? 'relicYellow'
        : 'relicBlue';
    this.emitFloatingText(this.hero.x, 2.25, this.hero.z, `獲得祝福：${buff.name}`, tone);

    const ax = this.angelPos?.x ?? this.hero.x;
    const az = this.angelPos?.z ?? this.hero.z;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.spawnParticle(
        ax + Math.cos(a) * 0.5,
        1.1,
        az + Math.sin(a) * 0.5,
        Math.cos(a) * 2.1,
        2.0 + Math.random() * 1.8,
        Math.sin(a) * 2.1,
        i % 2 === 0 ? 0xfff0a8 : 0xffffff,
        1.15,
        0.85,
        -0.5
      );
    }

    this.emitHud();
    return true;
  },

  getHeroClass(this: EmbervaultEngine): HeroClassId {
    return this.hero.classId;
  },

  /** Swap the hero 3D rig to match the given class (no-op if already matching). */
  applyHeroClassRig(this: EmbervaultEngine, classId: HeroClassId): void {
    if (!this.hero.rig || !this.sharedShadowMap) return;
    const currentClass = this.hero.rig.root.userData.heroClassId as HeroClassId | undefined;
    if (currentClass === classId) return;
    this.hero.rig.root.remove(this.hero.setAura.group);
    this.scene.remove(this.hero.rig.root);
    this.hero.rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.hero.rig = this.createHeroRigForClass(classId);
    if (this.heroLight) {
      this.heroLight.color.setHex(
        classId === 'frost_mage'
          ? 0x9fe6ff
          : classId === 'hunter'
          ? 0xff9b6a
          : this.dungeon?.biome.torchColor ?? 0xffaa44
      );
    }
    this.hero.rig.root.add(this.hero.setAura.group);
    this.hero.rig.root.position.set(this.hero.x, 0, this.hero.z);
    this.scene.add(this.hero.rig.root);
  },

  /**
   * Restarts the run. Without `loadout` this is the attract-mode / legacy restart (fresh hero, depth 1,
   * auto-pilot, nothing persisted). With `loadout` the hero is rebuilt from a character save: upgrades,
   * relics, gold, potions are restored, derived stats are recomputed and the run starts on `startDepth` (default and upper bound: `maxDepth`).
   */
  restartRun(this: EmbervaultEngine, classId?: HeroClassId, loadout?: CharacterLoadout, startDepth?: number): void {
    const nextClass: HeroClassId = classId ?? this.hero.classId;
    if (this.transitionState !== 'none') {
      // A fade is in progress (e.g. the initial fade-in): run the restart as soon as it ends.
      this.queuedRestartClass = nextClass;
      this.queuedRestartLoadout = loadout ?? null;
      this.queuedRestartDepth = startDepth;
      return;
    }
    this.queuedRestartClass = null;
    this.queuedRestartLoadout = null;
    this.queuedRestartDepth = undefined;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.audio.playDescend();
    this.beginTransition(() => {
      this.clearAllPets();
      this.hero.resetForNewRun();
      this.inTown = false;
      this.savedDungeon = null;
      this.awayAnchor = null;
      this.pendingAwayFloor = null;
      this.portalSafePos = null;
      this.loadingRun = true;
      this.persistRun = Boolean(loadout);
      this.hero.applyClassStats(nextClass);
      this.applyHeroClassRig(nextClass);
      this.runElapsedSec = 0;
      let firstDepth = 1;
      let deepest = 1;
      if (loadout) {
        this.hero.applyLoadout(loadout);
        // The player may start shallower than their deepest floor; max depth itself never goes down
        deepest = Math.max(1, Math.floor(loadout.maxDepth));
        firstDepth = EmbervaultEngine.clampStartDepth(startDepth, deepest);
      } else {
        this.hero.controlMode = 'auto';
      }
      // Dev only: `?devDepth=N` overrides the start floor (single player; it never counts as reaching that floor)
      const devDepth = EmbervaultEngine.readDevDepth();
      this.devDepthRun = devDepth !== null;
      if (devDepth !== null) firstDepth = devDepth;
      this.hero.maxDepthReached = deepest;
      this.hero.recomputeRelicStats(false);
      if (loadout) {
        // Derived stats (max HP / shield incl. relic bonuses) are final now: start the run at full health.
        this.hero.hp = this.hero.getEffectiveMaxHp();
        this.hero.shield = this.hero.getEffectiveMaxShield();
      }
      this.hero.input.keys.clear();
      this.hero.rig.body.rotation.z = 0;
      this.hero.rig.body.position.y = 0;
      if (this.mp) {
        // Room game: the floor comes later (host: once every loadout is in; teammate: the host's level message)
        this.setupBots(null);
        this.hero.controlMode = 'manual';
        this.mpHold('start', this.mp.role === 'host' ? '正在載入隊友的角色…' : this.mp.late ? '正在加入進行中的遊戲…' : '等待房主建立地城…');
        if (this.mp.role === 'host') this.mp.host!.waitStart = performance.now();
        return;
      }
      // Bot teammates start from a copy of the local loadout (fresh each run); none when ?bots=0
      this.setupBots(loadout ?? null);
      this.buildLevel(firstDepth);
      this.loadingRun = false;
      this.requestSave('floor'); // the first floor's treasure room roll moved the pity counter (checkpoints were off while loading)
    });
  },

  /** Snapshot of the persistent character state (gold, upgrades, relics, potions, max depth) for saving. */
  exportCharacterState(this: EmbervaultEngine): CharacterLoadout {
    // A local hero in town has not reached a floor a teammate may have descended to meanwhile
    return this.localHero.exportLoadout(
      this.localHero.inTown || this.devDepthRun ? this.localHero.maxDepthReached : this.depth
    );
  },

  requestSave(this: EmbervaultEngine, reason: SaveCheckpointReason): void {
    // Only the local character is ever saved (bots and remote teammates never touch the API)
    if (this.hero.isBot || this.hero.isRemote || this.devDepthRun) return;
    if (this.persistRun && !this.loadingRun) this.callbacks.onSaveCheckpoint?.(reason);
  },

  /**
   * P6: while a trade is open (or being requested) the town character's gold / bag / stash must not change, because D1 is
   * the authority until the trade ends. Closes the stash window; the caller flushes the save right after locking.
   */
  setTradeLock(this: EmbervaultEngine, locked: boolean): void {
    if (locked === this.tradeLocked) return;
    if (locked && this.localHero.stashOpen) this.closeStash();
    if (locked && this.localHero.codexOpen) this.closeCodex();
    this.tradeLocked = locked;
    this.emitHud();
  },

  /** P6: replaces the traded parts of the local character (gold, bag, stash) with the server's version after a trade. */
  applyTradeSave(this: EmbervaultEngine, save: { gold: number; bag: RelicItem[]; stash: RelicItem[] }): void {
    const h = this.localHero;
    h.gold = save.gold;
    h.relicBag = save.bag.slice(0, h.relicBagCap).map((r) => ({ ...r }));
    h.stash = save.stash.slice(0, STASH_CAP).map((r) => ({ ...r }));
    this.emitHud();
  },

  beginTransition(this: EmbervaultEngine, action: () => void): void {
    this.transitionState = 'fadeOut';
    this.pendingTransitionAction = action;
  },

  /** Animates the swirling cyan portals (the town gate, or the portals the heroes left behind in the dungeon). */
  animateHeroPortal(this: EmbervaultEngine, dt: number): void {
    if (this.townPortalRig) this.animatePortalRig(this.townPortalRig, dt);
    for (const rig of this.heroPortalRigs.values()) this.animatePortalRig(rig, dt);
  },

  animatePortalRig(this: EmbervaultEngine, rig: TownPortalRig, dt: number): void {
    rig.vortex.rotation.z += dt * 1.9;
    rig.outerRing.rotation.z -= dt * 1.2;
    rig.innerRing.rotation.z += dt * 2.5;
    const pulse = 1 + Math.sin(this.elapsed * 3.6) * 0.05;
    rig.halo.scale.set(2.3 * pulse, 2.6 * pulse, 1);
    const px = rig.root.position.x;
    const pz = rig.root.position.z;
    if (Math.random() < dt * 3.5) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.55;
      this.spawnParticle(
        px + Math.cos(a) * r,
        0.3 + Math.random() * 1.4,
        pz + Math.sin(a) * r,
        (Math.random() - 0.5) * 0.3,
        0.9 + Math.random() * 0.7,
        (Math.random() - 0.5) * 0.3,
        Math.random() < 0.5 ? 0x35a8db : 0x8be2ff,
        0.52,
        0.85,
        -0.15
      );
    }
  },
};
