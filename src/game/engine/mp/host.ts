import { EmbervaultEngine } from '../../engine';
import type { CommandPayload, DoorSnap, EnemySnap, EnemyStatic, GameEvent, GameKind, HandbackPayload, HeroProjSnap, HeroSnap, InputPayload, LevelPayload, LoadoutPayload, LootSnap, PartyStatePayload, PetSnap, PrivatePayload, ProjSnap, RosterEntry, SnapshotPayload, TownPayload, WorldSnap } from '../../../../shared/game';
import { ACT_ATTACK, ACT_DASH, ACT_POMMEL, ACT_POTION, EF_BOSS_SHIFT, EF_BURN, EF_ENRAGED, EF_FROZEN, EF_HIT, EF_SLOW, EF_STUN, HF_DASH, HF_DEAD, HF_HIT, HF_HIT_SHIELD, HF_TOWN, INPUT_STALE_MS, KEY_A, KEY_D, KEY_F, KEY_S, KEY_W, MAX_EVENTS_PER_SNAPSHOT, SNAPSHOT_HZ, q100 } from '../../../../shared/game';
import { ROOM_MAX_PLAYERS } from '../../../../shared/room';
import type { RoomMember } from '../../../../shared/room';
import { HeroClassId, UpgradeKind } from '../../classes';
import { gridToWorld } from '../../dungeon';
import { TREASURE_CONFIG } from '../../treasure';
import { BOSS_SKILL_LIST, ENEMY_AURA_DEFS } from '../data';
import { EnemyEntity, MpHostState, SavedDungeonSnapshot } from '../entities';
import { Hero } from '../../hero';

// Multiplayer host side: authoritative sim hooks, joiners, freeze/handback, level + private state, snapshot builder.
export const hostMpMethods = {
  mpHostOnMessage(this: EmbervaultEngine, from: string, kind: GameKind, payload: unknown): void {
    const mp = this.mp!;
    const host = mp.host!;
    if (kind === 'loadout') {
      host.pending.set(from, payload as LoadoutPayload);
      if (host.launched) host.joiners.push({ from, p: payload as LoadoutPayload }); // mid-game join: handled inside the simulation step
      return;
    }
    const h = this.heroById(from);
    if (!h || !h.isRemote) return;
    if (kind === 'in') {
      const p = payload as InputPayload;
      let st = host.inputs.get(from);
      if (!st) {
        st = { t: 0, k: 0, f: 0, h: 0, at: 0 };
        host.inputs.set(from, st);
      }
      st.t = p.t;
      st.k = p.k | 0;
      st.f = Number(p.f) || 0;
      st.h = p.h ? 1 : 0;
      st.at = performance.now();
      if (p.a && p.a.length > 0) {
        const q = host.actions.get(from) ?? [];
        for (const a of p.a) if (q.length < 8) q.push(a);
        host.actions.set(from, q);
      }
    } else if (kind === 'cmd') {
      if (host.cmds.length < 64) host.cmds.push({ from, cmd: payload as CommandPayload });
    } else if (kind === 'handback') {
      host.handbacks.push({ from, hb: payload as HandbackPayload });
    } else if (kind === 'hbc') {
      // The teammate gave up waiting for the level: forget a hand-back still in the queue, or take them out of the
      // dungeon again if it was already done (they are standing in their town)
      const queued = host.handbacks.length;
      host.handbacks = host.handbacks.filter((x) => x.from !== from);
      if (host.handbacks.length === queued && !h.inTown) {
        h.inTown = true;
        h.input.keys.clear();
        h.input.leftMouseHeld = false;
        h.rig.root.visible = false;
        h.rescueTargetId = null;
        h.rescueProgress = 0;
        host.privSig.delete(from);
      }
    }
  },

  /**
   * P7 mid-game join: a member that arrived after the start sent its loadout. It gets a hero here and always spawns in town
   * (it walks through a teammate's portal like anyone coming back). If there is no way into the floor at all (every hero is
   * in the dungeon and nobody has a portal open) it is put at the floor entrance (room 0) at once with the same hand-off a
   * town gate would do. Monsters already spawned keep their HP; the party size is read again when the next floor is built.
   */
  mpHostAddJoiner(this: EmbervaultEngine, from: string, p: LoadoutPayload): void {
    const mp = this.mp!;
    const host = mp.host!;
    const member = mp.members.find((m) => m.playerId === from);
    if (!member) return; // not (or no longer) in the room
    const old = this.heroById(from);
    if (old) {
      // The same player came back before the room noticed the old connection was gone: start over, like a fresh join
      if (!old.isRemote) return;
      host.inputs.delete(from);
      host.actions.delete(from);
      host.privSig.delete(from);
      host.cmds = host.cmds.filter((c) => c.from !== from);
      host.handbacks = host.handbacks.filter((c) => c.from !== from);
      this.mpRemoveHero(old);
    }
    if (this.heroes.length >= ROOM_MAX_PLAYERS) return;
    const h = this.mpCreateHero(from, member.name, (p.classId as HeroClassId) ?? 'warrior', p.loadout, p.angel ?? null);
    h.inTown = true;
    h.rig.root.visible = false;
    const nobodyInTown = !this.heroes.some((x) => x !== h && x.inTown);
    if (this.mpDoors().length === 0 && nobodyInTown && !this.inTown) {
      this.mpHostOnHandback(from, {
        door: 'entrance',
        classId: h.classId,
        loadout: { ...p.loadout, stash: [] },
        angel: p.angel ?? null,
        hp: h.getEffectiveMaxHp(),
        shield: h.getEffectiveMaxShield(),
      });
    } else {
      const payload: TownPayload = { priv: this.mpPrivOf(h), hp: h.hp, sh: h.shield, st: this.mpPartyPayload() };
      mp.send('tw', payload, from);
    }
    this.mpHostSendParty(true);
    this.emitHud();
  },

  mpHostDrainJoiners(this: EmbervaultEngine): void {
    const host = this.mp!.host!;
    if (host.joiners.length === 0) return;
    const list = host.joiners;
    host.joiners = [];
    for (const j of list) this.mpHostAddJoiner(j.from, j.p);
  },

  /**
   * P7: the host's room connection came back inside the grace window (same page, same resume token). Heroes of members that
   * left meanwhile are dropped (their `memberLeft` went nowhere), then everybody gets the floor / party state again.
   */
  mpHostResume(this: EmbervaultEngine, members: RoomMember[]): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host') return;
    const ids = new Set(members.map((m) => m.playerId));
    for (const m of [...mp.members]) if (!ids.has(m.playerId)) this.mpOnMemberLeft(m.playerId);
    for (const h of [...this.heroes]) if (h.isRemote && !ids.has(h.id)) this.mpOnMemberLeft(h.id);
    for (const m of members) this.mpOnMemberJoined(m);
    mp.host!.resync = true;
    this.mpPaused = false;
  },

  /** P7: runs inside the dungeon simulation (also the background one) after `mpHostResume`: every teammate in the floor gets a fresh `level`. */
  mpHostResyncNow(this: EmbervaultEngine): void {
    const host = this.mp!.host!;
    host.resync = false;
    for (const h of this.heroes) if (h.isRemote && !h.inTown) this.mpHostSendLevelTo(h.id, false);
    host.privSig.clear();
    this.mpHostSendParty(true);
    this.mpHostFlushPrivate(true);
  },

  /** Applies the teammates' latest inputs to their heroes (before the hero loop of the dungeon in progress). */
  mpHostPre(this: EmbervaultEngine): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host') return;
    const host = mp.host!;
    const now = performance.now();
    const prev = this.hero;
    for (const h of this.heroes) {
      if (!h.isRemote) continue;
      const st = host.inputs.get(h.id);
      if (!st || h.inTown || h.isDead) {
        h.input.keys.clear();
        h.input.leftMouseHeld = false;
        host.actions.delete(h.id);
        continue;
      }
      const stale = now - st.at > INPUT_STALE_MS;
      const k = stale ? 0 : st.k;
      const keys = h.input.keys;
      keys.clear();
      if (k & KEY_W) keys.add('KeyW');
      if (k & KEY_A) keys.add('KeyA');
      if (k & KEY_S) keys.add('KeyS');
      if (k & KEY_D) keys.add('KeyD');
      if (k & KEY_F) keys.add('KeyF');
      h.input.leftMouseHeld = !stale && st.h === 1;
      h.input.aimFacing = st.f / 100;
      h.controlMode = 'manual';
      const acts = host.actions.get(h.id);
      if (acts && acts.length > 0) {
        host.actions.delete(h.id);
        this.setActor(h);
        for (const a of acts) {
          if (a === ACT_ATTACK) {
            h.facing = h.input.aimFacing;
            this.performAttack();
          } else if (a === ACT_DASH) {
            h.facing = h.input.aimFacing;
            this.performDash();
          } else if (a === ACT_POMMEL) {
            h.facing = h.input.aimFacing;
            this.performPommelStrike();
          } else if (a === ACT_POTION) {
            this.usePotion();
          }
        }
        this.setActor(prev);
      }
    }
    this.setActor(prev);
  },

  /** After the dungeon simulation step: UI commands, hand-backs from town, snapshot / private state sending. */
  mpHostPost(this: EmbervaultEngine, dt: number): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host') return;
    const host = mp.host!;
    host.frozenFlushed = false; // the dungeon is running again
    if (host.resync) this.mpHostResyncNow();
    this.mpHostDrainJoiners();
    if (host.cmds.length > 0) {
      const cmds = host.cmds;
      host.cmds = [];
      for (const c of cmds) this.mpHostRunCmd(c.from, c.cmd);
    }
    if (host.handbacks.length > 0) {
      const hbs = host.handbacks;
      host.handbacks = [];
      for (const hb of hbs) this.mpHostOnHandback(hb.from, hb.hb);
    }
    host.sendAcc += dt;
    if (host.sendAcc >= 1 / SNAPSHOT_HZ) {
      host.sendAcc = host.sendAcc % (1 / SNAPSHOT_HZ);
      this.mpHostSendSnapshot();
      this.mpHostFlushPrivate(false);
    }
  },

  /** The doors (portals heroes left behind) of the current floor, as sent in snapshots and party states. */
  mpDoors(this: EmbervaultEngine): DoorSnap[] {
    const dr: DoorSnap[] = [];
    for (const h of this.heroes) {
      if (h.portal && h.portal.depth === this.depth) dr.push([h.id, q100(h.portal.x), q100(h.portal.z), h.isDead ? 1 : 0]);
    }
    return dr;
  },

  /**
   * P5-C party state, host -> everybody, only when it changes: which hero is in town / downed and where the doors are.
   * Snapshots stop while the floor is frozen or nobody is in it, but the town UI (door list, member panel) must keep up.
   */
  mpHostSendParty(this: EmbervaultEngine, force: boolean): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || !mp.host!.launched) return;
    const host = mp.host!;
    const st = this.mpPartyPayload();
    const sig = JSON.stringify([st.d, st.h, st.dr]);
    if (!force && sig === host.stSig) return;
    host.stSig = sig;
    if (!this.heroes.some((x) => x.isRemote)) return;
    mp.send('st', st);
  },

  mpPartyPayload(this: EmbervaultEngine): PartyStatePayload {
    return {
      d: this.depth,
      h: this.heroes.map((x) => [x.id, x.isDead ? 2 : x.inTown ? 1 : 0]),
      dr: this.mpDoors(),
    };
  },

  /**
   * The dungeon is about to freeze (nobody alive in it, spec 3.4): the downed teammates still in it get a last snapshot and
   * their private state (death flags, doors) because no snapshot is sent from now until somebody comes back.
   */
  mpHostFreezeFlush(this: EmbervaultEngine): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || !mp.host!.launched) return;
    const host = mp.host!;
    if (host.frozenFlushed) return;
    host.frozenFlushed = true;
    host.lastHeroSig = '';
    this.mpHostSendSnapshot();
    this.mpHostFlushPrivate(true);
  },

  /** Teammates that asked to go to town while the whole dungeon is parked / frozen (nobody can run commands). */
  mpHostFrozenTick(this: EmbervaultEngine): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host') return;
    const host = mp.host!;
    if (host.resync) {
      // Nobody is in the (frozen) floor: only the party state and the downed teammates' last snapshot go out again
      host.resync = false;
      host.frozenFlushed = false;
      host.privSig.clear();
      this.mpHostSendParty(true);
    }
    this.mpHostDrainJoiners();
    if (host.handbacks.length > 0 && this.transitionState === 'none') {
      // Teammates walking back through a town gate while the floor is frozen: they do not wait for the host (P5-C)
      const hbs = host.handbacks;
      host.handbacks = [];
      for (const hb of hbs) this.mpHostOnHandback(hb.from, hb.hb);
    }
    if (host.cmds.length === 0) return;
    const keep: typeof host.cmds = [];
    for (const c of host.cmds) {
      if (c.cmd.c === 'town' || c.cmd.c === 'death') this.mpHostRunCmd(c.from, c.cmd);
      else keep.push(c);
    }
    host.cmds = keep;
  },

  mpHostRunCmd(this: EmbervaultEngine, from: string, cmd: CommandPayload): void {
    const h = this.heroById(from);
    if (!h || !h.isRemote || h.inTown) return;
    const prev = this.hero;
    this.setActor(h);
    try {
      switch (cmd.c) {
        case 'eq':
          this.equipRelic(cmd.id, cmd.s);
          break;
        case 'uneq':
          this.unequipRelic(cmd.s);
          break;
        case 'sell':
          this.sellRelic(cmd.id);
          break;
        case 'sellc':
          this.sellCommonBagRelics(cmd.y !== 0);
          break;
        case 'disc':
          this.discardRelic(cmd.id);
          break;
        case 'discb':
          this.discardBlueBagRelics();
          break;
        case 'up':
          this.purchaseUpgrade(cmd.kind as UpgradeKind);
          break;
        case 'buy':
          this.purchasePotion();
          break;
        case 'town':
          if (!h.isDead) {
            const viaExisting = cmd.free === 1 && this.findNearbyDungeonPortal(h) !== null;
            this.mpHostSendToTown(h, false, viaExisting);
          }
          break;
        case 'death':
          if (h.isDead) this.mpHostSendToTown(h, true);
          break;
        case 'chest': {
          // Treasure chest: the host judges reach and state; everybody learns the result from the world snapshot
          const ent = typeof cmd.i === 'number' ? this.treasureRigs[cmd.i] : undefined;
          if (ent && !h.isDead && Math.hypot(ent.x - h.x, ent.z - h.z) <= TREASURE_CONFIG.hostOpenRange) {
            this.openTreasureChest(cmd.i, h);
          }
          break;
        }
      }
    } finally {
      this.setActor(prev);
    }
    this.mpHostFlushPrivate(true, from);
  },

  /** `h` (a remote hero) goes to the town: it leaves the simulation and receives its final state. */
  mpHostSendToTown(this: EmbervaultEngine, h: Hero, fromDeath: boolean, viaExistingPortal = false): void {
    const mp = this.mp!;
    const cost = viaExistingPortal ? 0 : fromDeath ? this.getDeathReturnCost() : this.getTownReturnCost();
    const spent = Math.min(h.gold, cost);
    h.gold = Math.max(0, h.gold - cost);
    void spent;
    if (fromDeath) {
      h.isDead = false;
      h.restoreAfterDowned();
    }
    if (!viaExistingPortal) {
      const active = !this.inTown || this.dungeonCtx !== null;
      if (active && this.textures) this.placeHeroPortal(h, h.x, h.z, this.depth);
      else h.portal = { x: h.x, z: h.z, depth: this.depth };
    }
    h.inTown = true;
    h.input.keys.clear();
    h.input.leftMouseHeld = false;
    h.rig.root.visible = false;
    h.rescueTargetId = null;
    h.rescueProgress = 0;
    const payload: TownPayload = {
      priv: this.mpPrivOf(h),
      hp: h.hp,
      sh: h.shield,
    };
    mp.send('tw', payload, h.id);
    mp.host!.privSig.delete(h.id);
  },

  /** A teammate comes back from town through one of the doors (or the entrance). */
  mpHostOnHandback(this: EmbervaultEngine, from: string, hb: HandbackPayload): void {
    const mp = this.mp!;
    const h = this.heroById(from);
    if (!h || !h.isRemote || !h.inTown) return;
    // Their town character is authoritative: take over what they bought / equipped there
    h.applyLoadout(hb.loadout);
    h.angelBuff = hb.angel ?? null;
    h.recomputeRelicStats(false);
    h.hp = Math.min(h.getEffectiveMaxHp(), Math.max(1, hb.hp));
    h.shield = Math.min(h.getEffectiveMaxShield(), hb.shield);
    // P5-C: the floor is frozen (nobody is alive in it, the host is in town too): the first one to come back rebuilds it
    // right here in the background, with fresh monsters (spec 3.4) and without waiting for the host.
    const frozen = this.inTown && !this.dungeonCtx;
    const parked = frozen ? this.savedDungeon : null;
    if (frozen && !parked) {
      mp.send('hbx', {}, from);
      return;
    }
    h.maxDepthReached = Math.max(h.maxDepthReached, hb.loadout.maxDepth, parked ? parked.depth : this.depth);
    let tx: number;
    let tz: number;
    const doorDepth = parked ? parked.depth : this.depth;
    const door = hb.door !== 'entrance' ? this.heroById(hb.door)?.portal : null;
    if (door && door.depth === doorDepth) {
      tx = door.x;
      tz = door.z;
    } else {
      const d = parked ? parked.dungeon : this.dungeon;
      const sp = gridToWorld(d.spawn.gx, d.spawn.gz);
      tx = sp.x;
      tz = sp.z;
    }
    // Owner returning from town closes their own portal (other heroes' portals stay open)
    this.clearHeroPortal(h);
    h.inTown = false;
    h.isDead = false;
    h.x = tx;
    h.z = tz;
    h.vx = 0;
    h.vz = 0;
    h.dashTimer = 0;
    h.invuln = 1.2;
    h.rig.root.position.set(tx, 0, tz);
    h.rig.root.visible = !this.inTown;
    h.rig.body.rotation.z = 0;
    h.rig.body.position.y = 0;
    if (parked) {
      // buildLevel announces the rebuilt floor to every teammate that is in it, this one included
      this.mpHostRebuildAway(parked, { x: tx, z: tz });
    } else {
      this.mpHostSendLevelTo(h.id, false);
    }
    mp.host!.privSig.delete(h.id);
  },

  /**
   * The host is in town and the floor is frozen; a teammate walked back through a gate. Rebuild the frozen floor in the
   * background (monsters respawn, doors stay, the arriving teammate stands at their chosen door) exactly like a floor
   * change that happens while the local hero is in town: the new level becomes the parked dungeon (`dungeonCtx`) and
   * keeps being simulated, so the host can step into it later through any door.
   */
  mpHostRebuildAway(this: EmbervaultEngine, snap: SavedDungeonSnapshot, target: { x: number; z: number }): void {
    const local = this.localHero;
    this.savedDungeon = null;
    snap.returnX = target.x;
    snap.returnZ = target.z;
    const townCtx = this.captureCtx();
    this.applyCtx(this.blankCtx());
    this.inTown = false;
    this.bgSim = true;
    this.audio.suppressed = true;
    const arcsBefore = this.slashArcs.length;
    try {
      this.buildLevel(snap.depth, { savedSnapshot: snap });
    } finally {
      this.dungeonCtx = this.captureCtx();
      this.applyCtx(townCtx);
      this.inTown = true;
      this.bgSim = false;
      this.setActor(local);
      for (let i = arcsBefore; i < this.slashArcs.length; i++) this.slashArcs[i].mesh.visible = false;
      for (const bar of this.rescueBars.values()) bar.group.visible = false;
      this.pendingAwayFloor = null; // not a new floor: nothing to announce to the host
    }
    if (this.mp?.role === 'host') this.mp.host!.frozenFlushed = false;
    this.emitHud();
  },

  /** Called at the end of `buildLevel` on the host: every teammate in the dungeon gets the new floor. */
  mpHostAnnounceLevel(this: EmbervaultEngine, isNewFloor: boolean): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || !mp.host!.launched) return;
    const host = mp.host!;
    host.sentEnemies.clear();
    host.sentProj.clear();
    host.sentHproj.clear();
    host.sentLoot.clear();
    host.doorSig = '';
    host.worldSig = '';
    host.frozenFlushed = false;
    host.events = [];
    host.eventKeys.clear();
    const snap = this.mpBuildSnapshot(true);
    for (const h of this.heroes) {
      if (!h.isRemote || h.inTown) continue;
      this.mpSendLevel(h, snap, isNewFloor);
    }
    this.mpHostFlushPrivate(true);
  },

  mpHostSendLevelTo(this: EmbervaultEngine, id: string, isNewFloor: boolean): void {
    const h = this.heroById(id);
    if (!h) return;
    this.mpSendLevel(h, this.mpBuildSnapshot(true), isNewFloor);
  },

  mpSendLevel(this: EmbervaultEngine, h: Hero, snap: SnapshotPayload, isNewFloor: boolean): void {
    const mp = this.mp!;
    const roster: RosterEntry[] = this.heroes.map((o) => ({
      id: o.id,
      name: o.id === mp.selfId ? this.mpNameOf(o.id) : o.displayName || this.mpNameOf(o.id),
      cls: o.classId,
      x: q100(o.x),
      z: q100(o.z),
      ...(o.inTown ? { tw: 1 as const } : {}),
    }));
    const treasure = this.dungeon.treasure;
    const payload: LevelPayload = {
      n: this.depth,
      seed: this.dungeon.genSeed ?? 0,
      roster,
      snap,
      priv: this.mpPrivOf(h),
      ...(isNewFloor ? { fl: 1 as const } : {}),
      ...(treasure
        ? { tr: { r: treasure.roomId, c: treasure.chests.map((c): [number, number, 0 | 1] => [c.gx, c.gz, c.opened ? 1 : 0]) } }
        : {}),
    };
    mp.send('level', payload, h.id);
  },

  mpPrivOf(this: EmbervaultEngine, h: Hero): PrivatePayload {
    return {
      ld: { ...h.exportLoadout(this.depth), stash: [], codex: [] }, // codex stays with its owner like the stash
      ab: h.angelBuff ? { ...h.angelBuff } : null,
      st: [h.kills, h.normalKills, h.eliteKills, h.bossKills, h.totalGoldEarned, h.totalDamageDealt, h.critCount, h.potionsUsed],
      ch: h.chronosUsedThisFloor ? 1 : 0,
      sl: h.slainBy,
    };
  },

  /** Sends each teammate's private state when it changed (gold, potions, relics, upgrades, death ...). */
  mpHostFlushPrivate(this: EmbervaultEngine, force: boolean, only?: string): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host') return;
    const host = mp.host!;
    const now = performance.now();
    for (const h of this.heroes) {
      if (!h.isRemote || h.inTown) continue;
      if (only && h.id !== only) continue;
      const sig = JSON.stringify([
        h.gold,
        h.potions,
        h.hpUpgrades,
        h.atkUpgrades,
        h.armorUpgrades,
        h.critUpgrades,
        h.hpShieldUpgrades,
        h.shieldSpeedUpgrades,
        h.equippedRelics.map((r) => r.id),
        h.relicBag.map((r) => r.id),
        h.angelBuff?.floorsLeft ?? -1,
        h.isDead,
        h.kills,
        h.chronosUsedThisFloor,
      ]);
      if (host.privSig.get(h.id) === sig) continue;
      if (!force && now - (host.privAt.get(h.id) ?? 0) < 400) continue;
      host.privSig.set(h.id, sig);
      host.privAt.set(h.id, now);
      mp.send('priv', this.mpPrivOf(h), h.id);
    }
  },

  mpEmit(this: EmbervaultEngine, ev: GameEvent): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host') return;
    const host = mp.host!;
    if (host.events.length >= MAX_EVENTS_PER_SNAPSHOT) return;
    // Identical events within one snapshot window are merged (a sound / text a dozen times is still one)
    const key = ev.join('|');
    if (host.eventKeys.has(key)) return;
    host.eventKeys.add(key);
    host.events.push(ev);
  },

  mpCaptureFloat(this: EmbervaultEngine, wx: number, wy: number, wz: number, text: string, tone: string): void {
    if (EmbervaultEngine.MP_PRIVATE_TONES.has(tone)) {
      if (!this.hero.isRemote) return; // the host sees its own pickups itself
      this.mpEmit(['f', q100(wx), q100(wy), q100(wz), text, tone, this.hero.id]);
    } else {
      this.mpEmit(['f', q100(wx), q100(wy), q100(wz), text, tone, '']);
    }
  },

  mpInstallAudioTap(this: EmbervaultEngine): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || mp.host!.tapped) return;
    const audio = this.audio as unknown as Record<string, unknown>;
    const proto = Object.getPrototypeOf(this.audio) as object;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (!name.startsWith('play') || name === 'playFootstep') continue;
      const orig = audio[name] as (...a: unknown[]) => void;
      const wrapped = (...args: unknown[]): void => {
        this.mpAudioEvent(name, args);
        orig.apply(this.audio, args);
      };
      audio[name] = wrapped;
    }
    mp.host!.tapped = true;
  },

  mpRemoveAudioTap(this: EmbervaultEngine): void {
    const audio = this.audio as unknown as Record<string, unknown>;
    const proto = Object.getPrototypeOf(this.audio) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (!name.startsWith('play')) continue;
      if (Object.prototype.hasOwnProperty.call(audio, name)) delete audio[name];
    }
    if (this.mp?.host) this.mp.host.tapped = false;
  },

  mpAudioEvent(this: EmbervaultEngine, name: string, args: unknown[]): void {
    const mp = this.mp;
    if (!mp || mp.role !== 'host') return;
    const actor = this.hero;
    if (EmbervaultEngine.MP_PRIVATE_SOUNDS.has(name)) {
      if (!actor.isRemote) return;
      this.mpEmit(['s', name, actor.id, actor.id, ...(args as Array<string | number>)]);
    } else {
      this.mpEmit(['s', name, actor.id, '', ...(args as Array<string | number>)]);
    }
  },

  mpPid(this: EmbervaultEngine, host: MpHostState, obj: object): number {
    let pid = host.pids.get(obj);
    if (pid === undefined) {
      pid = host.nextPid++;
      host.pids.set(obj, pid);
    }
    return pid;
  },

  mpEnemyEntry(this: EmbervaultEngine, e: EnemyEntity): EnemySnap {
    let flags = 0;
    if (e.stunTimer > 0) flags |= EF_STUN;
    if ((e.frozenTimer ?? 0) > 0) flags |= EF_FROZEN;
    if ((e.slowTimer ?? 0) > 0) flags |= EF_SLOW;
    if ((e.burnTimer ?? 0) > 0) flags |= EF_BURN;
    if (e.hitFlash > 0) flags |= EF_HIT;
    const entry: EnemySnap = [e.id, q100(e.x), q100(e.z), q100(e.facing), Math.max(0, Math.ceil(e.hp)), flags];
    if (e.isBoss) {
      const st = Math.max(0, EmbervaultEngine.MP_BOSS_STATES.indexOf(e.bossState ?? 'chase'));
      entry[5] = flags | (st << EF_BOSS_SHIFT) | (e.bossEnraged ? EF_ENRAGED : 0);
      const dur = e.bossStateDuration ?? 0;
      entry.push(dur > 0 ? q100(Math.min(1, (e.bossStateTimer ?? 0) / dur)) : 0);
      entry.push(q100(e.telegraphX ?? e.x), q100(e.telegraphZ ?? e.z), q100(e.telegraphRadius ?? 0));
      entry.push(Math.max(0, BOSS_SKILL_LIST.indexOf(e.bossSkill ?? 'slam')));
    }
    return entry;
  },

  /**
   * The world as the teammates should see it. `full` = everything (a new floor / a teammate coming back from town),
   * otherwise only what changed since the last delta. `commit` records what was sent (and takes the queued events).
   */
  mpBuildSnapshot(this: EmbervaultEngine, full: boolean, commit = true): SnapshotPayload {
    const mp = this.mp!;
    const host = mp.host!;
    const now = performance.now();
    const hs: HeroSnap[] = this.heroes.map((h) => {
      const st = host.inputs.get(h.id);
      let flags = 0;
      if (h.isDead) flags |= HF_DEAD;
      if (h.inTown) flags |= HF_TOWN;
      if (h.dashTimer > 0) flags |= HF_DASH;
      if (h.hitFlash > 0) flags |= HF_HIT;
      if (h.hitFlash > 0 && h.hitShieldOnly) flags |= HF_HIT_SHIELD;
      return [
        h.id,
        q100(h.x),
        q100(h.z),
        q100(h.facing),
        Math.round(h.hp),
        Math.round(h.getEffectiveMaxHp()),
        Math.round(h.shield),
        flags,
        q100(h.attackAnim),
        q100(h.pommelAnim),
        st ? st.t : 0,
        st ? Math.round(now - st.at) : 0,
        0,
        h.rescueTargetId ?? '',
        q100(h.rescueProgress),
        1 + h.getTotalUpgradeLevel(),
        Math.round(h.getEffectiveMaxShield()),
      ] as HeroSnap;
    });
    const snap: SnapshotPayload = { ts: Math.round(now), d: this.depth, el: q100(this.elapsed), hs };

    // Monsters
    const en: EnemyStatic[] = [];
    const es: EnemySnap[] = [];
    const seen = new Set<number>();
    for (const e of this.enemies) {
      if (e.dead) continue;
      seen.add(e.id);
      const known = host.sentEnemies.has(e.id);
      if (full || !known) {
        const st: EnemyStatic = { i: e.id, k: e.kind, m: e.maxHp, e: e.isSpecialElite ? 2 : e.isElite ? 1 : 0 };
        if (e.customName) st.n = e.customName;
        if (e.aura) st.a = ENEMY_AURA_DEFS[e.aura].key;
        if (e.bossName) st.bn = e.bossName;
        if (e.bossTitle) st.bt = e.bossTitle;
        en.push(st);
      }
      const entry = this.mpEnemyEntry(e);
      const sig = entry.join(',');
      if (full || host.sentEnemies.get(e.id) !== sig) {
        es.push(entry);
        if (commit) host.sentEnemies.set(e.id, sig);
      }
    }
    const er: number[] = [];
    if (commit) {
      for (const id of host.sentEnemies.keys()) {
        if (!seen.has(id)) {
          er.push(id);
          host.sentEnemies.delete(id);
        }
      }
    }
    if (en.length) snap.en = en;
    if (es.length) snap.es = es;
    if (er.length) snap.er = er;

    // Projectiles (monster arrows / orbs and the ice spikes of every hero): sent once, the receiver flies them
    const ps: ProjSnap[] = [];
    const hp: HeroProjSnap[] = [];
    const livePids = new Set<number>();
    for (const p of this.projectiles) {
      const pid = this.mpPid(host, p);
      livePids.add(pid);
      if (full || !host.sentProj.has(p)) {
        ps.push([pid, p.kind, q100(p.x), q100(p.z), q100(p.vx), q100(p.vz)]);
        if (commit) host.sentProj.set(p, pid);
      }
    }
    for (const p of this.heroProjectiles) {
      const pid = this.mpPid(host, p);
      livePids.add(pid);
      if (full || !host.sentHproj.has(p)) {
        hp.push([pid, p.ownerId, q100(p.x), q100(p.z), q100(p.vx), q100(p.vz), p.shotIdx]);
        if (commit) host.sentHproj.set(p, pid);
      }
    }
    const pr: number[] = [];
    if (commit) {
      for (const [p, pid] of host.sentProj) {
        if (!livePids.has(pid)) {
          pr.push(pid);
          host.sentProj.delete(p);
        }
      }
      for (const [p, pid] of host.sentHproj) {
        if (!livePids.has(pid)) {
          pr.push(pid);
          host.sentHproj.delete(p);
        }
      }
    }
    if (ps.length) snap.ps = ps;
    if (hp.length) snap.hp = hp;
    if (pr.length) snap.pr = pr;

    // Loot of the teammates (the host sees its own drops itself, everybody else's are not drawn on this screen)
    const ls: LootSnap[] = [];
    const liveLoot = new Set<number>();
    for (const l of this.loots) {
      if (l.collected) continue;
      const owner = this.heroById(l.ownerId);
      if (!owner || !owner.isRemote) continue;
      liveLoot.add(l.id);
      if (full || !host.sentLoot.has(l.id)) {
        const rar = l.relic ? Math.max(0, EmbervaultEngine.MP_RARITIES.indexOf(l.relic.rarity)) : 0;
        ls.push([l.id, l.ownerId, l.type === 'gold' ? 0 : l.type === 'potion' ? 1 : 2, q100(l.x), q100(l.z), rar]);
        if (commit) host.sentLoot.add(l.id);
      }
    }
    const lr: number[] = [];
    if (commit) {
      for (const id of host.sentLoot) {
        if (!liveLoot.has(id)) {
          lr.push(id);
          host.sentLoot.delete(id);
        }
      }
    }
    if (ls.length) snap.ls = ls;
    if (lr.length) snap.lr = lr;

    // Doors (the portals heroes left behind) and the shared objectives
    const dr = this.mpDoors();
    const doorSig = JSON.stringify(dr);
    if (full || doorSig !== host.doorSig) {
      snap.dr = dr;
      if (commit) host.doorSig = doorSig;
    }
    if (this.pets.size > 0) {
      const petsArr: PetSnap[] = [];
      for (const pet of this.pets.values()) {
        const owner = this.heroById(pet.ownerId);
        if (!owner || owner.isDead || owner.inTown) continue;
        const spIdx: 0 | 1 | 2 = pet.species === 'bear' ? 0 : pet.species === 'chocobo' ? 1 : 2;
        petsArr.push([
          pet.ownerId,
          spIdx,
          pet.name,
          q100(pet.x),
          q100(pet.z),
          q100(pet.facing),
          Math.max(0, Math.round(pet.hp)),
          pet.maxHp,
          q100(Math.max(0, pet.buffTimer)),
          pet.hitFlash > 0 ? 1 : 0,
        ]);
      }
      if (petsArr.length) snap.pets = petsArr;
    }
    const world: WorldSnap = {
      k: this.hasKey ? 1 : 0,
      u: this.doorUnlocked ? 1 : 0,
      ru: this.lightProps.filter((lp) => lp.kind === 'rune').flatMap((lp, i) => (lp.used ? [i] : [])),
      br: this.breakables.flatMap((b, i) => (b.broken ? [i] : [])),
    };
    const chests = this.dungeon.treasure?.chests;
    if (chests) world.tc = chests.flatMap((c, i) => (c.opened ? [i] : []));
    const worldSig = JSON.stringify(world);
    if (full || worldSig !== host.worldSig) {
      snap.w = world;
      if (commit) host.worldSig = worldSig;
    }
    if (commit && host.events.length > 0) {
      snap.ev = host.events;
      host.events = [];
      host.eventKeys.clear();
    }
    return snap;
  },

  mpHostSendSnapshot(this: EmbervaultEngine): void {
    const mp = this.mp!;
    const host = mp.host!;
    const anyRemote = this.heroes.some((h) => h.isRemote);
    if (!anyRemote) return; // nobody to tell
    const snap = this.mpBuildSnapshot(false, true);
    const now = performance.now();
    if (!this.heroes.some((h) => h.isRemote && !h.inTown)) {
      // Everybody else is in town: they only need to hear about doors and floor changes
      if (!snap.dr && host.lastDepthSent === this.depth) return;
      host.lastDepthSent = this.depth;
      host.lastSentAt = now;
      mp.send('s', snap);
      return;
    }
    host.lastDepthSent = this.depth;
    // Idle floor: skip the message when nothing at all changed (a keepalive every second keeps the clocks in step)
    const sig = JSON.stringify([
      snap.hs.map((h) => [h[1], h[2], h[3], h[4], h[6], h[7], h[8], h[9], h[13], h[14]]),
      snap.pets ?? null,
    ]);
    const quiet =
      !snap.en && !snap.es && !snap.er && !snap.ps && !snap.hp && !snap.pr && !snap.ls && !snap.lr && !snap.dr && !snap.w && !snap.ev;
    if (quiet && sig === host.lastHeroSig && now - host.lastSentAt < 1000) return;
    host.lastHeroSig = sig;
    host.lastSentAt = now;
    mp.send('s', snap);
  },
};
