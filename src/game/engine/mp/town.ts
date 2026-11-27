import type { EmbervaultEngine } from '../../engine';
import { INTERP_JITTER_K, TOWN_INTERP_DELAY_MAX_MS, TOWN_INTERP_DELAY_MS, TOWN_POS_HZ, q100 } from '../../../../shared/game';
import type { CommandPayload, HandbackPayload, PartyStatePayload, TownPayload } from '../../../../shared/game';
import { Hero } from '../../hero';
import { PartyMemberInfo } from '../../types';

// Multiplayer town side (P5-C): town positions, party info, town hand-off with the host.
export const townMpMethods = {
  /** A teammate's town position arrived (broadcast by the room server; kept even while I am not in town). */
  mpOnTownPos(this: EmbervaultEngine, from: string, p: { x: number; z: number; f: number; a: number }): void {
    const mp = this.mp;
    if (!mp || from === mp.selfId) return;
    let peer = mp.town.peers.get(from);
    if (!peer) {
      peer = { buf: [], has: false, speed: 0 };
      mp.town.peers.set(from, peer);
    }
    if (p.a === 2) {
      peer.buf = []; // (re)appeared: no sliding in from wherever they were before
      peer.speed = 0;
    }
    // P7: the gaps of a moving peer's 5 Hz stream feed the adaptive delay (stops / restarts are not jitter)
    const arrived = performance.now();
    if (peer.lastMoving && p.a === 1 && peer.lastAt !== undefined && arrived - peer.lastAt < 600) {
      const jitter = peer.jitter ?? 0;
      peer.jitter = jitter + (Math.min(300, Math.abs(arrived - peer.lastAt - 1000 / TOWN_POS_HZ)) - jitter) / 8;
    }
    peer.lastAt = arrived;
    peer.lastMoving = p.a === 1;
    peer.buf.push({ t: arrived, x: p.x / 100, z: p.z / 100, f: p.f / 100 });
    if (peer.buf.length > 8) peer.buf.shift();
    peer.has = true;
  },

  /** I am in town (and not fading): broadcast my position at 5 Hz while moving, once more when I stop (spec 5.2). */
  mpTownSend(this: EmbervaultEngine, dt: number): void {
    const mp = this.mp!;
    const t = mp.town;
    t.acc += dt;
    const local = this.localHero;
    if (this.transitionState !== 'none' || mp.hold || local.isDead) return;
    const x = q100(local.x);
    const z = q100(local.z);
    const f = q100(local.facing);
    if (!t.last) {
      t.last = { x, z, f, a: 2 };
      t.acc = 0;
      mp.sendTownPos({ x, z, f, a: 2 });
      return;
    }
    if (t.acc < 1 / TOWN_POS_HZ - 1e-6) return;
    const moved = Math.abs(x - t.last.x) > 2 || Math.abs(z - t.last.z) > 2;
    let a: 0 | 1;
    if (moved) a = 1;
    else if (t.last.a !== 0) a = 0;
    else return;
    t.acc = 0;
    t.last = { x, z, f, a };
    mp.sendTownPos({ x, z, f, a });
  },

  /** Draws the teammates that are in town right now (host: their town is their own machine's; guest: same). */
  mpTownRemotes(this: EmbervaultEngine, dt: number): void {
    const mp = this.mp!;
    const tmp = { x: 0, z: 0, f: 0 };
    for (const h of this.heroes) {
      if (!h.isRemote) continue;
      const peer = mp.town.peers.get(h.id);
      const state = this.mpHeroState(h);
      const delay = Math.min(TOWN_INTERP_DELAY_MAX_MS, TOWN_INTERP_DELAY_MS + INTERP_JITTER_K * (peer?.jitter ?? 0));
      const renderT = performance.now() - delay;
      if (state !== 1 || !peer || !peer.has || !this.mpSample(peer.buf, renderT, tmp)) {
        h.rig.root.visible = false;
        continue;
      }
      const px = h.rig.root.position.x;
      const pz = h.rig.root.position.z;
      const moved = h.rig.root.visible ? Math.hypot(tmp.x - px, tmp.z - pz) / Math.max(dt, 1e-4) : 0;
      peer.speed += (moved - peer.speed) * Math.min(1, dt * 10);
      this.mpAnimatePuppetHero(h, dt, peer.speed, tmp);
      this.refreshBotPlate(h);
    }
  },

  /** 0 in the dungeon, 1 in town, 2 downed: what this client believes about a hero. */
  mpHeroState(this: EmbervaultEngine, h: Hero): 0 | 1 | 2 {
    const mp = this.mp;
    if (mp?.role === 'guest' && h !== this.localHero && this.inTown) {
      // In town the host's party messages are the freshest source (no snapshots flow while the floor is frozen)
      const st = mp.guest.partyState.get(h.id);
      if (st !== undefined) return st;
    }
    return h.isDead ? 2 : h.inTown ? 1 : 0;
  },

  /** The member panel (town and dungeon): who is where. Empty outside room games. */
  mpPartyInfo(this: EmbervaultEngine): PartyMemberInfo[] {
    const mp = this.mp;
    if (!mp) return [];
    return this.heroes.map((h) => ({
      id: h.id,
      name: h === this.localHero ? this.mpNameOf(h.id) : h.displayName || this.mpNameOf(h.id),
      classId: h.classId,
      isSelf: h === this.localHero,
      isHost: h.id === mp.hostId,
      state: this.mpHeroState(h),
    }));
  },

  /** Guest: the host's party state (P5-C): who is in town / downed, which floor and which doors. Applied while in town. */
  mpGuestApplyParty(this: EmbervaultEngine, p: PartyStatePayload): void {
    const mp = this.mp!;
    const g = mp.guest;
    for (const [id, st] of p.h) {
      g.partyState.set(id, st);
      if (id === mp.selfId) continue;
      // P7: a mid-game joiner (or somebody who joined after me) is not in any `level` roster yet: make its puppet from the room's member list
      if (!this.heroById(id) && mp.members.some((m) => m.playerId === id)) {
        const nh = this.mpCreateHero(id, this.mpNameOf(id), this.mpClassOf(id), null, null);
        nh.inTown = st === 1;
        nh.rig.root.visible = false;
      }
      if (st !== 1) {
        const peer = mp.town.peers.get(id);
        if (peer) peer.has = false;
      }
    }
    if (!this.inTown) return; // in the dungeon the snapshots carry the same truth, with positions
    if (p.d !== this.depth) {
      this.depth = p.d;
      for (const h of this.heroes) h.portal = null;
      g.doorSig = '';
    }
    for (const [id, st] of p.h) {
      if (id === mp.selfId) continue;
      const h = this.heroById(id);
      if (!h) continue;
      h.inTown = st === 1;
      if (st !== 2 && h.isDead) {
        // Went to town from the death screen while I was not looking: stand them up again
        h.isDead = false;
        this.mpSetDownedPose(h, false);
      }
    }
    this.mpGuestApplyDoors(p.dr);
    this.emitHud();
  },

  /** The host sent me to town: I own my character from here on (the town runs locally, spec 5.2). */
  mpGuestEnterTown(this: EmbervaultEngine, tw: TownPayload): void {
    const mp = this.mp!;
    const g = mp.guest;
    const local = this.localHero;
    this.mpGuestApplyPrivate(tw.priv);
    local.hp = tw.hp;
    local.shield = tw.sh;
    local.isDead = false;
    this.mpSetDownedPose(local, false);
    local.restoreAfterDowned();
    local.inTown = true;
    mp.town.last = null;
    this.awayAnchor = { x: local.x, z: local.z };
    g.built = false;
    g.enemies.clear();
    g.enemyList = [];
    g.projs.clear();
    g.hprojs.clear();
    g.loots.clear();
    this.clearLevel();
    this.applyCtx(this.blankCtx());
    this.setViewGroups(true);
    this.buildTown();
    // P7: a mid-game joiner learns the floor depth, the doors and who is where from the same message
    if (tw.st) {
      this.depth = tw.st.d;
      g.depth = tw.st.d;
      this.mpGuestApplyParty(tw.st);
    }
    this.requestSave('town');
    this.emitHud();
  },

  /** Town gate: tell the host which door and hand my final state back. */
  mpGuestReturn(this: EmbervaultEngine, portalId?: string): void {
    const mp = this.mp!;
    const local = this.localHero;
    const opts = this.getTownPortalOptions();
    const pick = opts.find((o) => o.id === portalId) ?? opts[0];
    this.requestSave('leaveTown');
    const hb: HandbackPayload = {
      door: pick?.id ?? 'entrance',
      classId: local.classId,
      loadout: { ...local.exportLoadout(local.maxDepthReached), stash: [] },
      angel: local.angelBuff ? { ...local.angelBuff } : null,
      hp: local.getEffectiveMaxHp(),
      shield: local.getEffectiveMaxShield(),
    };
    this.audio.playPortal();
    local.input.keys.clear();
    // The town stays built (and is shown again if the host never answers); it is dropped when the level arrives
    this.mpHold('level', `正在進入第 ${this.depth} 層…`);
    this.beginTransition(() => {
      mp.send('handback', hb, mp.hostId);
    });
  },

  /** The host did not answer my hand-back in time (or refused): stay in town and tell the host to keep me there. */
  mpGuestReturnFailed(this: EmbervaultEngine, notice: string): void {
    const mp = this.mp!;
    this.mpReleaseHold();
    mp.send('hbc', {}, mp.hostId);
    mp.town.last = null; // show everybody where I stand again
    mp.onNotice(notice);
  },

  /** At the black of a fade: the town is dropped, the next 'level' message builds the dungeon. */
  mpGuestTownToHold(this: EmbervaultEngine): void {
    const local = this.localHero;
    this.leaveTownScene();
    local.inTown = false;
    this.applyCtx(this.blankCtx());
    this.clearLevel();
  },

  /** Guest: send a UI command to the host (the answer is a `priv` message). */
  mpGuestCmd(this: EmbervaultEngine, cmd: CommandPayload): void {
    const mp = this.mp;
    if (mp?.role === 'guest') mp.send('cmd', cmd, mp.hostId);
  },

  /** Guest in the dungeon asked for town (B / death screen / existing portal): hold at black until the host's reply arrives. */
  mpGuestAskTown(this: EmbervaultEngine, death: boolean, viaExistingPortal = false): void {
    const mp = this.mp!;
    this.mpHold('town', '正在返回城鎮…');
    this.audio.playPortal();
    this.localHero.input.keys.clear();
    this.localHero.input.leftMouseHeld = false;
    this.beginTransition(() => undefined);
    this.mpGuestCmd(death ? { c: 'death' } : viaExistingPortal ? { c: 'town', free: 1 } : { c: 'town' });
  },
};
