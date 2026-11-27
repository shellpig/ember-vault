import { EmbervaultEngine } from '../engine';
import { BOT_RELIC_SCALE, HeroClassId, MAX_BOTS, distributeUpgradePoints, pickBotNames, sumUpgradeLevels } from '../classes';
import { LevelCtx } from './entities';
import { Hero } from '../hero';
import type { CharacterLoadout } from '../hero';
import { HeroRig, createFrostMageModel, createHeroModel, createHeroSetAura, createHunterModel } from '../models';
import { RelicItem } from '../relics';
import * as THREE from 'three';

export const partyMethods = {
  /** Single-player bot setup from the pre-run screen (one class per bot). Applied by the next `restartRun`. */
  setBotClasses(this: EmbervaultEngine, classes: HeroClassId[]): void {
    this.botClasses = classes.slice(0, MAX_BOTS);
  },

  heroById(this: EmbervaultEngine, id: string): Hero | undefined {
    for (const h of this.heroes) if (h.id === id) return h;
    return undefined;
  },

  /** Makes `h` the hero that the per-hero engine code operates on (bots and remote teammates are silent). */
  setActor(this: EmbervaultEngine, h: Hero): void {
    this.hero = h;
    this.audio.suppressed = h.isBot || h.isRemote || this.bgSim;
  },

  /** The current actor is not the local player: nothing it does may reach this screen (HUD, shake, banners ...). */
  isSilentActor(this: EmbervaultEngine): boolean {
    return this.hero.isBot || this.hero.isRemote;
  },

  /** A hero that is part of the dungeon simulation: on its feet and not away in the local town. */
  isInDungeonAlive(this: EmbervaultEngine, h: Hero): boolean {
    return !h.isDead && !h.inTown;
  },

  /** A fresh, empty level field set (the town starts from it). Key / gate flags carry over for the HUD. */
  blankCtx(this: EmbervaultEngine): LevelCtx {
    return {
      dungeon: this.dungeon,
      enemies: [],
      projectiles: [],
      heroProjectiles: [],
      loots: [],
      breakables: [],
      lightProps: [],
      spikes: [],
      keyPedestal: null,
      altarRig: null,
      shopRig: null,
      gateRig: null,
      gateOpenProgress: 0,
      wallOpaqueMeshes: [],
      wallFadeMeshes: [],
      capOpaqueMeshes: [],
      capFadeMeshes: [],
      wallTiles: [],
      wallOcclusionActive: false,
      textures: null,
      extraTextures: [],
      hasKey: this.hasKey,
      doorUnlocked: this.doorUnlocked,
      heroPortalRigs: new Map(),
      treasureRigs: [],
    };
  },

  captureCtx(this: EmbervaultEngine): LevelCtx {
    return {
      dungeon: this.dungeon,
      enemies: this.enemies,
      projectiles: this.projectiles,
      heroProjectiles: this.heroProjectiles,
      loots: this.loots,
      breakables: this.breakables,
      lightProps: this.lightProps,
      spikes: this.spikes,
      keyPedestal: this.keyPedestal,
      altarRig: this.altarRig,
      shopRig: this.shopRig,
      gateRig: this.gateRig,
      gateOpenProgress: this.gateOpenProgress,
      wallOpaqueMeshes: this.wallOpaqueMeshes,
      wallFadeMeshes: this.wallFadeMeshes,
      capOpaqueMeshes: this.capOpaqueMeshes,
      capFadeMeshes: this.capFadeMeshes,
      wallTiles: this.wallTiles,
      wallOcclusionActive: this.wallOcclusionActive,
      textures: this.textures,
      extraTextures: this.extraTextures,
      hasKey: this.hasKey,
      doorUnlocked: this.doorUnlocked,
      heroPortalRigs: this.heroPortalRigs,
      treasureRigs: this.treasureRigs,
    };
  },

  applyCtx(this: EmbervaultEngine, c: LevelCtx): void {
    this.dungeon = c.dungeon;
    this.enemies = c.enemies;
    this.projectiles = c.projectiles;
    this.heroProjectiles = c.heroProjectiles;
    this.loots = c.loots;
    this.breakables = c.breakables;
    this.lightProps = c.lightProps;
    this.spikes = c.spikes;
    this.keyPedestal = c.keyPedestal;
    this.altarRig = c.altarRig;
    this.shopRig = c.shopRig;
    this.gateRig = c.gateRig;
    this.gateOpenProgress = c.gateOpenProgress;
    this.wallOpaqueMeshes = c.wallOpaqueMeshes;
    this.wallFadeMeshes = c.wallFadeMeshes;
    this.capOpaqueMeshes = c.capOpaqueMeshes;
    this.capFadeMeshes = c.capFadeMeshes;
    this.wallTiles = c.wallTiles;
    this.wallOcclusionActive = c.wallOcclusionActive;
    this.textures = c.textures;
    this.extraTextures = c.extraTextures;
    this.hasKey = c.hasKey;
    this.doorUnlocked = c.doorUnlocked;
    this.heroPortalRigs = c.heroPortalRigs;
    this.treasureRigs = c.treasureRigs;
  },

  /** Shows the group set of the level the local hero is in (the other one is not rendered at all). */
  setViewGroups(this: EmbervaultEngine, town: boolean): void {
    this.levelGroup.visible = !town;
    this.dynamicGroup.visible = !town;
    this.debrisGroup.visible = !town;
    this.townGroup.visible = town;
    // Teammates live in the dungeon scene graph root: hide them while the camera is in town
    for (const h of this.heroes) if (h.isBot || h.isRemote) h.rig.root.visible = !town && !h.inTown;
  },

  /** Runs `fn` once for every living hero with that hero as the actor, then restores the previous actor. */
  forEachLiveHero(this: EmbervaultEngine, fn: (h: Hero) => void): void {
    const prev = this.hero;
    for (const h of this.heroes) {
      if (h.isDead || h.inTown) continue;
      this.setActor(h);
      fn(h);
    }
    this.setActor(prev);
  },

  /** Enemy targeting (spec §3.3 / §6): the nearest hero that is not downed, or null. */
  nearestLiveHero(this: EmbervaultEngine, x: number, z: number): Hero | null {
    let best: Hero | null = null;
    let bestD = Infinity;
    for (const h of this.heroes) {
      if (h.isDead || h.inTown) continue;
      const d = (h.x - x) * (h.x - x) + (h.z - z) * (h.z - z);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  },

  /** Difficulty scaling input (spec §4): everybody in the run counts, bots included. */
  getHeroCount(this: EmbervaultEngine): number {
    return this.heroes.length;
  },

  createHeroRigForClass(this: EmbervaultEngine, classId: HeroClassId): HeroRig {
    const sm = this.sharedShadowMap!;
    const rig =
      classId === 'frost_mage'
        ? createFrostMageModel(sm)
        : classId === 'hunter'
        ? createHunterModel(sm)
        : createHeroModel(sm);
    rig.root.userData.heroClassId = classId;
    rig.root.userData.isFrostMage = classId === 'frost_mage';
    return rig;
  },

  /**
   * (Re)creates the bot teammates. With a character loadout (`base`) bot classes come from the pre-run setup and each
   * bot gets the player's total upgrade level plus 80% of the player's relic bonuses; without one (attract mode) only the
   * `?bots=N` dev override creates (bare) bots.
   */
  setupBots(this: EmbervaultEngine, base: CharacterLoadout | null): void {
    for (const h of this.heroes) if (h.isBot || h.isRemote) this.disposeBot(h);
    this.heroes = this.heroes.filter((h) => !h.isBot && !h.isRemote);
    this.botGearKey = '';
    if (!this.sharedShadowMap) return;
    // Room games never have local bots (every other hero is a real teammate)
    let classes: HeroClassId[] = [];
    if (!this.mp) {
      if (this.botUrlOverride !== null) {
        classes = Array.from({ length: this.botUrlOverride }, (_, i) => {
          const picked = this.botClasses[i];
          if (picked) return picked;
          const roll = Math.random();
          return roll < 0.34 ? 'warrior' : roll < 0.67 ? 'frost_mage' : 'hunter';
        });
      } else if (base) {
        classes = this.botClasses.slice(0, MAX_BOTS);
      }
    }
    const botNames = pickBotNames(classes.length);
    for (let i = 0; i < classes.length; i++) {
      const classId = classes[i];
      const bot = new Hero(`bot-${i + 1}`);
      bot.isBot = true;
      bot.botIndex = i + 1;
      bot.displayName = botNames[i] ?? `Bot ${i + 1}`;
      bot.rig = this.createHeroRigForClass(classId);
      bot.setAura = createHeroSetAura();
      bot.rig.root.add(bot.setAura.group);
      this.scene.add(bot.rig.root);
      bot.resetForNewRun();
      bot.applyClassStats(classId);
      bot.relicScale = BOT_RELIC_SCALE;
      if (base) {
        this.applyBotGear(bot, sumUpgradeLevels(base.upgrades), base.equipped, Math.max(3, Math.min(6, base.potions)));
      }
      bot.controlMode = 'auto';
      bot.maxDepthReached = 1;
      bot.recomputeRelicStats(false);
      bot.hp = bot.getEffectiveMaxHp();
      bot.shield = bot.getEffectiveMaxShield();
      this.createBotMarker(bot);
      this.heroes.push(bot);
    }
  },

  /**
   * Gives a bot its gear: `level` upgrade points spread evenly over the bot class's altar options (capped options pass
   * their share on) and the player's equipped relics (numeric bonuses scaled by `bot.relicScale`). Never touches the
   * player, the save or the API.
   */
  applyBotGear(this: EmbervaultEngine, bot: Hero, level: number, equipped: RelicItem[], potions: number): void {
    bot.applyLoadout({
      gold: 0,
      maxDepth: 1,
      potions,
      upgrades: distributeUpgradePoints(bot.classId, level),
      equipped,
      bag: [],
      stash: [],
    });
    bot.relicScale = BOT_RELIC_SCALE;
  },

  /**
   * Keeps bots in step with the local hero: when the player's total upgrade level or equipped relics change (altar
   * purchase, relic swap, coming back from town), every bot's gear is recomputed. Checked twice a second; bots keep their
   * current HP / shield (the increase of max HP is granted as healing, like a relic swap on the player).
   */
  syncBotGear(this: EmbervaultEngine, dt: number): void {
    if (this.mp || !this.heroes.some((h) => h.isBot)) return;
    this.botGearTimer -= dt;
    if (this.botGearTimer > 0) return;
    this.botGearTimer = 0.5;
    const local = this.localHero;
    const equipped = local.equippedRelics;
    const key = `${local.getTotalUpgradeLevel()}|${equipped.map((r) => r.id).join(',')}`;
    if (key === this.botGearKey) return;
    const first = this.botGearKey === '';
    this.botGearKey = key;
    if (first) return; // setupBots just built them from the same state
    for (const bot of this.heroes) {
      if (!bot.isBot) continue;
      const prevHp = bot.getEffectiveMaxHp();
      const prevShield = bot.getEffectiveMaxShield();
      this.applyBotGear(bot, local.getTotalUpgradeLevel(), equipped, bot.potions);
      bot.recomputeRelicStats(false);
      const nextHp = bot.getEffectiveMaxHp();
      const nextShield = bot.getEffectiveMaxShield();
      if (!bot.isDead) {
        bot.hp = Math.min(nextHp, bot.hp + Math.max(0, nextHp - prevHp));
        bot.shield = Math.min(nextShield, bot.shield + Math.max(0, nextShield - prevShield));
      }
    }
  },

  disposeBot(this: EmbervaultEngine, bot: Hero): void {
    this.scene.remove(bot.rig.root);
    bot.rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      } else if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
    this.botMarkers.delete(bot.id);
    const bar = this.rescueBars.get(bot.id);
    if (bar) {
      this.scene.remove(bar.group);
      this.rescueBars.delete(bot.id);
    }
    const portal = this.heroPortalRigs.get(bot.id);
    if (portal) {
      portal.root.parent?.remove(portal.root);
      this.heroPortalRigs.delete(bot.id);
    }
  },

  /** Lightweight bot look: a coloured ring under the feet and a "Bot N" nameplate above the head. */
  createBotMarker(this: EmbervaultEngine, bot: Hero): void {
    const colors = [0x4fd8ff, 0x7dff8a, 0xff7ad9];
    const col = colors[(bot.botIndex - 1) % colors.length];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.78, 28),
      new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    bot.rig.root.add(ring);

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 48;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
    );
    plate.scale.set(1.6, 0.48, 1);
    plate.position.y = bot.isMage() ? 2.75 : 2.55;
    plate.renderOrder = 30;
    bot.rig.root.add(plate);
    const marker = { ring, plate, label: '' };
    this.botMarkers.set(bot.id, marker);
    this.refreshBotPlate(bot, col);
  },

  refreshBotPlate(this: EmbervaultEngine, bot: Hero, colorHex?: number): void {
    const marker = this.botMarkers.get(bot.id);
    if (!marker) return;
    const baseName = bot.displayName || `Bot ${bot.botIndex}`;
    const label = bot.isDead ? `${baseName} 倒地` : baseName;
    if (marker.label === label) return;
    marker.label = label;
    const mat = marker.plate.material as THREE.SpriteMaterial;
    const canvas = mat.map!.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const col = colorHex ?? (marker.ring.material as THREE.MeshBasicMaterial).color.getHex();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(8,10,16,0.72)';
    ctx.fillRect(2, 6, canvas.width - 4, canvas.height - 12);
    ctx.strokeStyle = bot.isDead ? '#ff6b7a' : `#${col.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 6, canvas.width - 4, canvas.height - 12);
    ctx.fillStyle = bot.isDead ? '#ffb3bb' : '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 1);
    (mat.map as THREE.CanvasTexture).needsUpdate = true;
  },

  /**
   * New floor (spec §3.4 / §5.3): every hero that is in the dungeon gets back on their feet (downed ones at full
   * health) and teammates are put around (cx, cz), the floor entrance. The local hero positions themself, and a
   * local hero who is in town is not part of the dungeon: they stay where they are.
   */
  placeTeamAround(this: EmbervaultEngine, cx: number, cz: number): void {
    const local = this.localHero;
    let slot = 0;
    for (const h of this.heroes) {
      if (h.inTown) continue;
      if (h.isDead) {
        h.isDead = false;
        h.restoreAfterDowned();
        h.invuln = Math.max(h.invuln, 1.0);
      }
      h.rescueTargetId = null;
      h.rescueProgress = 0;
      if (h === local) continue;
      this.warpHeroNear(h, cx, cz, slot);
      slot += 1;
    }
  },

  /** Moves `h` to a free spot around (cx, cz); `slot` spreads teammates on different sides. */
  warpHeroNear(this: EmbervaultEngine, h: Hero, cx: number, cz: number, slot: number): void {
    const a0 = 0.8 + slot * ((Math.PI * 2) / 3);
    let px = cx;
    let pz = cz;
    let found = false;
    for (const r of [1.4, 1.0, 0.6]) {
      for (let k = 0; k < 8 && !found; k++) {
        const a = a0 + (k * Math.PI) / 4;
        const tx = cx + Math.cos(a) * r;
        const tz = cz + Math.sin(a) * r;
        if (this.canMoveTo(tx, tz, 0.4)) {
          px = tx;
          pz = tz;
          found = true;
        }
      }
      if (found) break;
    }
    h.x = px;
    h.z = pz;
    h.vx = 0;
    h.vz = 0;
    h.dashTimer = 0;
    h.facing = this.localHero.facing;
    h.rig.root.position.set(px, 0, pz);
    h.rig.body.rotation.y = h.facing;
    h.ai.path = [];
    h.ai.combatPath = [];
    h.ai.progressAnchorX = px;
    h.ai.progressAnchorZ = pz;
    h.ai.noProgressTimer = 0;
  },

  /** Rescue progress (0-1) of the best rescuer currently working on `target`. */
  getRescueProgress(this: EmbervaultEngine, target: Hero): number {
    let best = 0;
    for (const h of this.heroes) {
      if (h.rescueTargetId === target.id) best = Math.max(best, h.rescueProgress);
    }
    return Math.min(1, best / EmbervaultEngine.RESCUE_SECONDS);
  },

  /**
   * Rescue (spec §3.3): a living hero within 1.5 of a downed one who keeps the interact key held (the local
   * player holds F; a bot's AI "holds" it) for 3 seconds gets the downed hero back on their feet.
   * Taking damage resets the rescuer's progress (see damageHero).
   */
  updateRescue(this: EmbervaultEngine, dt: number): void {
    const R = EmbervaultEngine.RESCUE_RADIUS;
    let anyDowned = false;
    for (const h of this.heroes) if (h.isDead) anyDowned = true;
    const simulateRescue = !this.mpGuestDungeon();
    if (!anyDowned || this.inTown) {
      this.rescueHudActive = false;
      if (this.rescueBars.size > 0) for (const bar of this.rescueBars.values()) bar.group.visible = false;
      if (simulateRescue) {
        for (const h of this.heroes) {
          h.rescueTargetId = null;
          h.rescueProgress = 0;
        }
      }
      return;
    }
    const local = this.localHero;
    for (const h of simulateRescue ? this.heroes : []) {
      if (h.isDead || h.inTown) {
        h.rescueTargetId = null;
        h.rescueProgress = 0;
        continue;
      }
      let target: Hero | null = null;
      if (h.isBot || h.controlMode === 'auto') {
        // AI heroes announce who they are reviving (aiRescueStep sets it while standing next to the target)
        target = h.rescueTargetId ? this.heroById(h.rescueTargetId) ?? null : null;
      } else if (h.input.keys.has('KeyF') && !h.stashOpen) {
        let bestD = Infinity;
        for (const o of this.heroes) {
          if (o === h || !o.isDead) continue;
          const d = Math.hypot(o.x - h.x, o.z - h.z);
          if (d <= R && d < bestD) {
            bestD = d;
            target = o;
          }
        }
      }
      if (target && target.isDead && Math.hypot(target.x - h.x, target.z - h.z) <= R) {
        if (h.rescueTargetId !== target.id) {
          h.rescueTargetId = target.id;
          h.rescueProgress = 0;
        }
        h.rescueProgress += dt;
        if (h.rescueProgress >= EmbervaultEngine.RESCUE_SECONDS) {
          this.reviveHero(target);
          h.rescueTargetId = null;
          h.rescueProgress = 0;
        }
      } else {
        h.rescueTargetId = null;
        h.rescueProgress = 0;
      }
    }

    // Progress bars over the downed heroes (billboarded, hidden when nobody is working on them)
    let hudActive = false;
    for (const h of this.heroes) {
      let bar = this.rescueBars.get(h.id);
      const progress = h.isDead ? this.getRescueProgress(h) : 0;
      if (progress <= 0) {
        if (bar) bar.group.visible = false;
        continue;
      }
      if (!bar) {
        const group = new THREE.Group();
        // transparent + high renderOrder so the bar is drawn after (on top of) the portal glow around the downed hero
        const bgMat = new THREE.MeshBasicMaterial({ color: 0x07090f, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
        const bg = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.34), bgMat);
        const fillMat = new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
        const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.96, 0.22), fillMat);
        fill.position.z = 0.01;
        bg.renderOrder = 40;
        fill.renderOrder = 41;
        group.add(bg);
        group.add(fill);
        this.scene.add(group);
        bar = { group, fill };
        this.rescueBars.set(h.id, bar);
      }
      bar.group.visible = true;
      bar.group.position.set(h.x, 2.15, h.z);
      bar.group.quaternion.copy(this.camera.quaternion);
      bar.fill.scale.x = Math.max(0.001, progress);
      bar.fill.position.x = -0.98 * (1 - progress);
    }
    // HUD refresh rate: fast while the local hero is rescuing / being rescued
    if (local.isDead) hudActive = this.getRescueProgress(local) > 0;
    else if (local.rescueTargetId) hudActive = true;
    this.rescueHudActive = hudActive;
  },

  /** What the HUD shows for rescues: progress on the (downed) local hero and the "hold F" prompt. */
  getRescueHud(this: EmbervaultEngine): { beingRescued: number; prompt: { name: string; progress: number } | null } {
    const local = this.localHero;
    if (local.isDead) return { beingRescued: this.getRescueProgress(local), prompt: null };
    if (this.inTown) return { beingRescued: 0, prompt: null };
    let near: Hero | null = null;
    let bestD = Infinity;
    for (const o of this.heroes) {
      if (o === local || !o.isDead) continue;
      const d = Math.hypot(o.x - local.x, o.z - local.z);
      if (d <= EmbervaultEngine.RESCUE_RADIUS && d < bestD) {
        bestD = d;
        near = o;
      }
    }
    if (!near) return { beingRescued: 0, prompt: null };
    return {
      beingRescued: 0,
      prompt: { name: near.displayName || (near.isBot ? `Bot ${near.botIndex}` : '隊友'), progress: local.rescueTargetId === near.id ? Math.min(1, local.rescueProgress / EmbervaultEngine.RESCUE_SECONDS) : 0 },
    };
  },
};
