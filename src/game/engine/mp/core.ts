import { EmbervaultEngine } from '../../engine';
import type { GameKind, LevelPayload, LoadoutPayload, PartyStatePayload, PrivatePayload, SnapshotPayload, TownPayload } from '../../../../shared/game';
import { INTERP_DELAY_MAX_MS, INTERP_DELAY_MS, INTERP_JITTER_K, LOADOUT_WAIT_MS } from '../../../../shared/game';
import type { RoomMember } from '../../../../shared/room';
import { HERO_CLASSES, HeroClassId } from '../../classes';
import { EnemyEntity, MpGuestState, MpState, MpTownPeer } from '../entities';
import type { CharacterLoadout } from '../../hero';
import { Hero } from '../../hero';
import { createHeroSetAura } from '../../models';
import type { AngelBuff } from '../../relics';
import type { MpConfig } from '../../engine';

// Multiplayer (P5-B..P7) core: session start/stop, relay routing, membership, hold screen, pump.
export const coreMpMethods = {
  /** True while this engine is a teammate's (guest) client with the camera in the dungeon. */
  mpGuestDungeon(this: EmbervaultEngine): boolean {
    return this.mp?.role === 'guest' && !this.inTown;
  },

  /** The monsters to show on the HUD / minimap (a guest keeps its puppets out of `enemies` so nothing hits them). */
  viewEnemies(this: EmbervaultEngine): EnemyEntity[] {
    return this.mp?.role === 'guest' ? this.mp.guest.enemyList : this.enemies;
  },

  /** Starts a room game (called when the host pressed start). The caller then sees the dungeon appear. */
  mpStart(this: EmbervaultEngine, cfg: MpConfig, classId: HeroClassId, loadout: CharacterLoadout): void {
    this.mpEnd();
    const base = {
      selfId: cfg.selfId,
      hostId: cfg.hostId,
      members: cfg.members.map((m) => ({ ...m })),
      send: cfg.send,
      onNotice: cfg.onNotice,
      sendTownPos: cfg.sendTownPos,
      late: cfg.late === true,
      startDepth: EmbervaultEngine.clampStartDepth(cfg.startDepth, loadout.maxDepth),
      hold: false,
      holdText: '',
      holdKind: null as MpState['holdKind'],
      holdSince: 0,
      town: { peers: new Map<string, MpTownPeer>(), acc: 0, last: null as MpState['town']['last'] },
      inbox: [] as Array<{ kind: GameKind; payload: unknown }>,
      clockOff: Infinity,
      classId,
      loadout,
    };
    if (cfg.role === 'host') {
      this.mp = {
        ...base,
        role: 'host',
        host: {
          pending: new Map(),
          waitStart: performance.now(),
          launched: false,
          inputs: new Map(),
          actions: new Map(),
          cmds: [],
          handbacks: [],
          joiners: [],
          sendAcc: 0,
          sentEnemies: new Map(),
          sentProj: new Map(),
          sentHproj: new Map(),
          sentLoot: new Set(),
          events: [],
          eventKeys: new Set(),
          nextPid: 1,
          privSig: new Map(),
          privAt: new Map(),
          doorSig: '',
          worldSig: '',
          stSig: '',
          frozenFlushed: false,
          tapped: false,
          pids: new WeakMap(),
          lastHeroSig: '',
          lastSentAt: 0,
          lastDepthSent: 0,
        },
        guest: this.mpNewGuest(),
      };
      this.mpInstallAudioTap();
    } else {
      this.mp = { ...base, role: 'guest', guest: this.mpNewGuest() };
    }
    this.mp.hostId = cfg.hostId;
    this.hero.id = cfg.selfId;
    this.localHeroId = cfg.selfId;
    this.persistRun = true;
    this.restartRun(classId, loadout);
    // The stash (up to 200 relics) stays on the owner's machine: the host never needs it and it would not fit a message
    if (cfg.role === 'guest') cfg.send('loadout', { classId, loadout: { ...loadout, stash: [] }, angel: null } as LoadoutPayload, cfg.hostId);
  },

  mpNewGuest(this: EmbervaultEngine): MpGuestState {
    return {
      enemies: new Map(),
      enemyList: [],
      projs: new Map(),
      hprojs: new Map(),
      loots: new Map(),
      heroBufs: new Map(),
      history: [],
      lastSent: { k: -1, f: 0, h: -1, at: 0 },
      actions: [],
      lastHasKey: false,
      lastUnlocked: false,
      usedRunes: new Set(),
      brokenProps: new Set(),
      pendingBreaks: new Map(),
      partyState: new Map(),
      doorSig: '',
      lastSnapAt: 0,
      depth: 0,
      built: false,
      jitter: 0,
      interpDelay: INTERP_DELAY_MS,
      lastTransit: Number.NaN,
    };
  },

  /** Leaves the room game: the engine goes back to being a plain single-player engine. */
  mpEnd(this: EmbervaultEngine): void {
    if (!this.mp) return;
    if (this.mp.role === 'host') this.mpRemoveAudioTap();
    const heroes = this.heroes.filter((h) => h.isRemote);
    for (const h of heroes) this.disposeBot(h);
    this.heroes = this.heroes.filter((h) => !h.isRemote);
    this.mpGuestClearEntities();
    this.mp = null;
    this.mpPaused = false;
    this.localHeroId = 'hero-0';
    this.hero = this.heroes[0] ?? this.hero;
    this.hero.id = 'hero-0';
    this.localHeroId = this.hero.id;
  },

  mpActive(this: EmbervaultEngine): boolean {
    return this.mp !== null;
  },

  /** Relay message from the room (already stamped with the sender's id by the server). */
  mpOnRelay(this: EmbervaultEngine, from: string, kind: string, payload: unknown): void {
    const mp = this.mp;
    if (!mp) return;
    if (mp.role === 'host') {
      if (from === mp.selfId) return;
      this.mpHostOnMessage(from, kind as GameKind, payload);
    } else {
      if (from !== mp.hostId) return;
      if (kind === 's') {
        this.mpMeasureJitter(payload as SnapshotPayload);
        mp.inbox.push({ kind: 's', payload });
        if (mp.inbox.length > 60) mp.inbox.splice(0, mp.inbox.length - 40);
      } else if (kind === 'level' || kind === 'tw' || kind === 'priv' || kind === 'abort' || kind === 'st' || kind === 'hbx') {
        mp.inbox.push({ kind: kind as GameKind, payload });
      }
    }
  },

  /**
   * P7 adaptive interpolation: smoothed variation of the snapshot transit time (RFC 3550 style, measured on arrival, so
   * it needs no extra messages). The remote entities are drawn `base + K * jitter` in the past, bounded.
   */
  mpMeasureJitter(this: EmbervaultEngine, s: SnapshotPayload): void {
    const g = this.mp?.guest;
    if (!g || typeof s.ts !== 'number') return;
    const transit = performance.now() - s.ts;
    if (Number.isFinite(g.lastTransit)) {
      const d = Math.min(400, Math.abs(transit - g.lastTransit));
      g.jitter += (d - g.jitter) / 16;
    }
    g.lastTransit = transit;
    const target = Math.min(INTERP_DELAY_MAX_MS, INTERP_DELAY_MS + INTERP_JITTER_K * g.jitter);
    g.interpDelay += (target - g.interpDelay) * 0.1;
  },

  /** P7: freeze / unfreeze this engine while the room connection is re-established (see `update`). */
  mpSetPaused(this: EmbervaultEngine, paused: boolean): void {
    this.mpPaused = paused && this.mp !== null;
  },

  mpOnMemberJoined(this: EmbervaultEngine, m: RoomMember): void {
    if (!this.mp) return;
    if (!this.mp.members.some((x) => x.playerId === m.playerId)) this.mp.members.push({ ...m });
  },

  /** A teammate left the room (closed the tab, pressed leave, got disconnected). */
  mpOnMemberLeft(this: EmbervaultEngine, playerId: string): void {
    const mp = this.mp;
    if (!mp) return;
    const name = this.heroById(playerId)?.displayName || mp.members.find((m) => m.playerId === playerId)?.name || '隊友';
    mp.members = mp.members.filter((m) => m.playerId !== playerId);
    const h = this.heroById(playerId);
    if (mp.role === 'host') {
      mp.host!.pending.delete(playerId);
      mp.host!.joiners = mp.host!.joiners.filter((j) => j.from !== playerId);
      mp.host!.inputs.delete(playerId);
      mp.host!.actions.delete(playerId);
      mp.host!.privSig.delete(playerId);
      mp.host!.cmds = mp.host!.cmds.filter((c) => c.from !== playerId);
      mp.host!.handbacks = mp.host!.handbacks.filter((c) => c.from !== playerId);
    }
    if (!h || !h.isRemote) return;
    this.mpRemoveHero(h);
    mp.onNotice(`${name} 已離開`);
    this.emitHud();
  },

  mpRemoveHero(this: EmbervaultEngine, h: Hero): void {
    const rig = this.heroPortalRigs.get(h.id);
    if (rig) {
      rig.root.parent?.remove(rig.root);
      this.heroPortalRigs.delete(h.id);
    }
    this.dungeonCtx?.heroPortalRigs.delete(h.id);
    this.lightProps = this.lightProps.filter((lp) => !(lp.kind === 'portal' && lp.heroId === h.id));
    for (const l of this.loots) {
      if (l.ownerId === h.id) {
        l.collected = true;
        l.mesh.visible = false;
      }
    }
    const bar = this.rescueBars.get(h.id);
    if (bar) {
      bar.group.visible = false;
      this.rescueBars.delete(h.id);
      this.scene.remove(bar.group);
    }
    this.dismissPet(h.id);
    this.disposeBot(h);
    this.heroes = this.heroes.filter((x) => x !== h);
    this.mp?.guest.heroBufs.delete(h.id);
  },

  /** A remote teammate (host: simulated from their inputs; guest: puppet driven by snapshots). */
  mpCreateHero(this: EmbervaultEngine, id: string, name: string, classId: HeroClassId, loadout: CharacterLoadout | null, angel: AngelBuff | null): Hero {
    const h = new Hero(id);
    h.isRemote = true;
    h.displayName = name;
    h.rig = this.createHeroRigForClass(classId);
    h.setAura = createHeroSetAura();
    h.rig.root.add(h.setAura.group);
    this.scene.add(h.rig.root);
    h.resetForNewRun();
    h.applyClassStats(classId);
    if (loadout) {
      h.applyLoadout(loadout);
      h.maxDepthReached = Math.max(1, Math.floor(loadout.maxDepth));
    }
    h.angelBuff = angel;
    h.controlMode = 'manual';
    h.recomputeRelicStats(false);
    h.hp = h.getEffectiveMaxHp();
    h.shield = h.getEffectiveMaxShield();
    this.createBotMarker(h);
    this.heroes.push(h);
    return h;
  },

  /** Room games: a spike trap's phase comes from its tile, so every client's trap cycle lines up with the host's. */
  mpSpikePhase(this: EmbervaultEngine, gx: number, gz: number): number {
    return (((gx * 73856093) ^ (gz * 19349663)) >>> 0) % 4000 / 1000;
  },

  /** Offset that lines the trap clock of a teammate client up with the host's (0 everywhere else). */
  mpSpikeClock(this: EmbervaultEngine): number {
    return this.mp?.role === 'guest' ? this.mp.guest.spikeOffset ?? 0 : 0;
  },

  mpNameOf(this: EmbervaultEngine, id: string): string {
    return this.mp?.members.find((m) => m.playerId === id)?.name ?? '隊友';
  },

  /** P7: class of a member that joined mid-game (its rig must match; a puppet made from a snapshot has no roster entry). */
  mpClassOf(this: EmbervaultEngine, id: string): HeroClassId {
    const cls = this.mp?.members.find((m) => m.playerId === id)?.classId;
    return cls && cls in HERO_CLASSES ? (cls as HeroClassId) : 'warrior';
  },

  /** Per-frame work that must run for every frame, whatever state the fade is in (message inbox, host launch). */
  mpPump(this: EmbervaultEngine, dt: number): void {
    const mp = this.mp;
    if (!mp) return;
    if (mp.role === 'host') {
      if (!mp.host!.launched) {
        if (mp.hold && this.transitionState === 'fadeIn') this.mpHostTryLaunch();
        return;
      }
      this.mpHostSendParty(false);
      return;
    }
    const g = mp.guest;
    // Snapshots: keep the newest, apply the rest immediately in order (they are deltas)
    const rest: typeof mp.inbox = [];
    for (const m of mp.inbox) {
      if (m.kind === 'priv') {
        this.mpGuestApplyPrivate(m.payload as PrivatePayload);
      } else if (m.kind === 'st') {
        this.mpGuestApplyParty(m.payload as PartyStatePayload);
      } else if (m.kind === 'hbx') {
        if (mp.hold && mp.holdKind === 'level') this.mpGuestReturnFailed('房主目前無法帶你回到地城，已留在城鎮');
      } else if (m.kind === 'abort') {
        mp.onNotice('房主無法開始遊戲（沒有收到你的角色資料）');
      } else {
        rest.push(m);
      }
    }
    mp.inbox = [];
    for (const m of rest) {
      if (m.kind === 's') {
        if (g.built && !this.inTown) this.mpGuestApplySnapshot(m.payload as SnapshotPayload, false);
        else if (this.inTown) this.mpGuestTownSnapshot(m.payload as SnapshotPayload);
      } else if (m.kind === 'level') {
        const lv = m.payload as LevelPayload;
        if (this.localHero.inTown && !(mp.hold && mp.holdKind === 'level')) {
          // A late answer to a hand-back I already gave up on: I am (and stay) in my town
          continue;
        }
        if (mp.hold && this.transitionState === 'fadeIn') {
          if (this.townBuilt) this.mpGuestTownToHold();
          this.mpGuestBuild(lv);
          this.mpReleaseHold();
        } else if (this.transitionState === 'none' && !mp.hold) {
          // A floor change the host made: fade out, then the held message builds the new floor
          this.mpHold('level', `正在前往第 ${lv.n} 層…`);
          this.beginTransition(() => undefined);
          mp.inbox.push(m);
        } else {
          mp.inbox.push(m); // wait for the fade
        }
      } else if (m.kind === 'tw') {
        if (mp.hold && this.transitionState === 'fadeIn') {
          this.mpGuestEnterTown(m.payload as TownPayload);
          this.mpReleaseHold();
        } else {
          mp.inbox.push(m);
        }
      }
    }
  },

  /** Holds the screen at black with a message (P5-C): the player always sees what the game is waiting for. */
  mpHold(this: EmbervaultEngine, kind: NonNullable<MpState['holdKind']>, text: string): void {
    const mp = this.mp;
    if (!mp) return;
    mp.hold = true;
    mp.holdKind = kind;
    mp.holdText = text;
    mp.holdSince = performance.now();
  },

  mpReleaseHold(this: EmbervaultEngine): void {
    const mp = this.mp;
    if (!mp) return;
    mp.hold = false;
    mp.holdKind = null;
    mp.holdText = '';
  },

  mpHostTryLaunch(this: EmbervaultEngine): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host') return;
    const host = mp.host!;
    const others = mp.members.filter((m) => m.playerId !== mp.selfId);
    const waited = performance.now() - host.waitStart;
    const missing = others.filter((m) => !host.pending.has(m.playerId));
    if (missing.length > 0 && waited < LOADOUT_WAIT_MS) return;
    host.launched = true;
    for (const m of missing) {
      mp.send('abort', {}, m.playerId);
      mp.members = mp.members.filter((x) => x.playerId !== m.playerId);
    }
    this.setupBots(null);
    for (const m of others) {
      const p = host.pending.get(m.playerId);
      if (!p) continue;
      this.mpCreateHero(m.playerId, m.name, (p.classId as HeroClassId) ?? 'warrior', p.loadout, p.angel ?? null);
    }
    const startDepth = EmbervaultEngine.clampStartDepth(mp.startDepth, mp.loadout.maxDepth);
    this.mpApplyViewGroupsForRemotes();
    this.buildLevel(startDepth);
    this.loadingRun = false;
    this.requestSave('floor'); // the first floor's treasure room roll moved the host's pity counter
    this.mpReleaseHold();
  },

  mpApplyViewGroupsForRemotes(this: EmbervaultEngine): void {
    for (const h of this.heroes) if (h.isRemote) h.rig.root.visible = !this.inTown && !h.inTown;
  },
};
