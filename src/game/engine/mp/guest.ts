import { EmbervaultEngine } from '../../engine';
import type { DoorSnap, EnemyStatic, GameEvent, InputPayload, LevelPayload, PrivatePayload, SnapshotPayload, WorldSnap } from '../../../../shared/game';
import { EF_BOSS_SHIFT, EF_ENRAGED, EF_FROZEN, EF_HIT, EF_SLOW, EF_STUN, HF_DEAD, HF_HIT, HF_HIT_SHIELD, HF_TOWN, INPUT_KEEPALIVE_MS, INPUT_MAX_HZ, KEY_A, KEY_D, KEY_F, KEY_S, KEY_W, q100 } from '../../../../shared/game';
import { HeroClassId, PetSpecies } from '../../classes';
import { BOSS_CONFIGS, BOSS_ENRAGE, BOSS_PRISM, BOSS_SKILL_LIST, BOSS_WARP, ENEMY_AURA_DEFS, ENEMY_AURA_INTERVAL, MP_BREAK_CONFIRM_MS, auraTypeFromKey, isFloorBoss, isRangedEnemy } from '../data';
import { BreakableEntity, EnemyEntity, HeroProjectileEntity, LootEntity, MpGuestState, MpSample, ProjectileEntity } from '../entities';
import { Hero } from '../../hero';
import { AuraHolderFx, BossTelegraphRig, applyEliteVisuals, createBossTelegraph, createEnemyModel, createHunterArrowMesh, createHunterPetModel, createIceSpikeMesh, createLootMesh, createProjectileMesh, createRelicLootMesh } from '../../models';
import { EnemyKind, FloatingLabelData, ProjectileKind } from '../../types';
import * as THREE from 'three';

// Multiplayer guest (teammate) side: remote mode, snapshot / world application, prediction, puppets, input send.
export const guestMpMethods = {
  /** Drops every puppet entity (the meshes themselves go with the level groups). */
  mpGuestClearEntities(this: EmbervaultEngine): void {
    const g = this.mp?.guest;
    if (!g) return;
    g.enemies.clear();
    g.enemyList = [];
    g.projs.clear();
    g.hprojs.clear();
    g.loots.clear();
    g.heroBufs.clear();
    g.history = [];
    g.usedRunes.clear();
    g.brokenProps.clear();
    g.pendingBreaks.clear();
    g.lastHasKey = false;
    g.lastUnlocked = false;
    g.doorSig = '';
  },

  mpGuestBuild(this: EmbervaultEngine, lv: LevelPayload): void {
    const mp = this.mp!;
    const g = mp.guest;
    this.mpGuestClearEntities();
    g.built = false;
    // Everybody in the party (a teammate that joined the roster late is simply created here)
    const ids = new Set(lv.roster.map((r) => r.id));
    for (const h of [...this.heroes]) if (h.isRemote && !ids.has(h.id)) this.mpRemoveHero(h);
    for (const r of lv.roster) {
      if (r.id === mp.selfId) continue;
      let h = this.heroById(r.id);
      if (!h) h = this.mpCreateHero(r.id, r.name, (r.cls as HeroClassId) ?? 'warrior', null, null);
      h.inTown = r.tw === 1;
    }
    this.mpGuestApplyPrivate(lv.priv);
    const local = this.localHero;
    local.isDead = false;
    local.inTown = false;
    local.rig.body.rotation.z = 0;
    local.rig.body.position.y = 0;
    g.depth = lv.n;
    this.depth = lv.n;
    const mpTreasure = lv.tr
      ? { roomId: lv.tr.r, chests: lv.tr.c.map(([gx, gz, opened]) => ({ gx, gz, opened: opened === 1 })) }
      : undefined;
    this.buildLevel(lv.n, { mpSeed: lv.seed, guest: true, mpTreasure });
    g.built = true;
    this.mpApplyViewGroupsForRemotes();
    this.mpGuestApplySnapshot(lv.snap, true);
    const me = lv.snap.hs.find((s) => s[0] === mp.selfId);
    if (me) {
      local.x = me[1] / 100;
      local.z = me[2] / 100;
      local.rig.root.position.set(local.x, 0, local.z);
      this.camera.position.set(local.x + 14.5 * this.camZoom, 14.5 * this.camZoom * 1.16, local.z + 14.5 * this.camZoom);
    }
    g.history = [];
    this.loadingRun = false;
    this.emitHud();
    this.emitMinimap();
  },

  mpGuestApplyPrivate(this: EmbervaultEngine, p: PrivatePayload): void {
    const h = this.localHero;
    const ownStash = h.stash; // never sent over the wire: this machine owns it
    const ownPity = h.treasurePity; // the treasure room counter is the host's business only: never take theirs over mine
    h.applyLoadout(p.ld);
    h.stash = ownStash;
    h.treasurePity = ownPity;
    h.angelBuff = p.ab ? { ...p.ab } : null;
    [h.kills, h.normalKills, h.eliteKills, h.bossKills, h.totalGoldEarned, h.totalDamageDealt, h.critCount, h.potionsUsed] = p.st;
    h.chronosUsedThisFloor = p.ch === 1;
    h.slainBy = p.sl;
    h.maxDepthReached = Math.max(h.maxDepthReached, Math.floor(p.ld.maxDepth));
    h.recomputeRelicStats(false);
    if (h.hp > h.getEffectiveMaxHp()) h.hp = h.getEffectiveMaxHp();
    this.emitHud();
  },

  /** Remote hero's pose when downed / back up. */
  mpSetDownedPose(this: EmbervaultEngine, h: Hero, downed: boolean): void {
    if (downed) {
      h.vx = 0;
      h.vz = 0;
      h.dashTimer = 0;
      h.input.keys.clear();
      h.rig.body.rotation.z = Math.PI * 0.46;
      h.rig.body.position.y = 0.22;
      for (const m of h.rig.flashMaterials) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    } else {
      h.rig.body.rotation.z = 0;
      h.rig.body.position.y = 0;
    }
  },

  mpGuestApplySnapshot(this: EmbervaultEngine, s: SnapshotPayload, full: boolean): void {
    const mp = this.mp!;
    const g = mp.guest;
    if (!full && s.d !== this.depth) return;
    const recv = performance.now();
    const off = recv - s.ts;
    mp.clockOff = Math.min(mp.clockOff + 0.05, off);
    g.lastSnapAt = recv;
    const local = this.localHero;

    // Heroes
    for (const e of s.hs) {
      const id = e[0];
      const flags = e[7];
      if (id === mp.selfId) {
        const wasDead = local.isDead;
        const dead = (flags & HF_DEAD) !== 0;
        local.hp = e[4];
        local.shield = e[6];
        if (dead && !wasDead) {
          local.isDead = true;
          this.mpSetDownedPose(local, true);
          this.requestSave('death');
        } else if (!dead && wasDead) {
          local.isDead = false;
          this.mpSetDownedPose(local, false);
          local.invuln = 1.5;
          this.emitFloatingText(local.x, 2.1, local.z, '被救起！', 'heal');
        }
        local.hp = e[4];
        local.rescueTargetId = e[13] || null;
        local.rescueProgress = e[14] / 100;
        // Reconcile the predicted position with the host's (it is the authority: knockback, spikes, rescue ...)
        const hx = e[1] / 100;
        const hz = e[2] / 100;
        if (local.isDead || full) {
          local.x = hx;
          local.z = hz;
          g.history = [];
        } else if (e[10] > 0) {
          const tEq = e[10] + e[11];
          const at = this.mpHistoryAt(g, tEq);
          if (at) {
            const ex = hx - at.x;
            const ez = hz - at.z;
            const err = Math.hypot(ex, ez);
            if (err > 2.5) {
              local.x = hx;
              local.z = hz;
              g.history = [];
            } else if (err > 0.04) {
              const gain = 0.3;
              const nx = local.x + ex * gain;
              const nz = local.z + ez * gain;
              if (this.canMoveTo(nx, nz, 0.4)) {
                local.x = nx;
                local.z = nz;
                for (const hp of g.history) {
                  hp.x += ex * gain;
                  hp.z += ez * gain;
                }
              }
            }
          }
        }
        continue;
      }
      let h = this.heroById(id);
      if (!h) h = this.mpCreateHero(id, this.mpNameOf(id), this.mpClassOf(id), null, null);
      h.inTown = (flags & HF_TOWN) !== 0;
      const dead = (flags & HF_DEAD) !== 0;
      if (dead !== h.isDead) {
        h.isDead = dead;
        this.mpSetDownedPose(h, dead);
      }
      h.hp = e[4];
      h.maxHp = e[5];
      h.shield = e[6];
      if (e[15] !== undefined) h.netLevel = e[15];
      if (e[16] !== undefined) h.netMaxShield = e[16];
      h.hitFlash = (flags & HF_HIT) !== 0 ? 0.12 : h.hitFlash;
      h.hitShieldOnly = (flags & HF_HIT_SHIELD) !== 0;
      if (e[8] > 0 && h.attackAnim <= 0.02) h.attackAnim = e[8] / 100;
      if (e[9] > 0 && h.pommelAnim <= 0.02) h.pommelAnim = e[9] / 100;
      h.rescueTargetId = e[13] || null;
      h.rescueProgress = e[14] / 100;
      let hb = g.heroBufs.get(id);
      if (!hb) {
        hb = { buf: [], speed: 0 };
        g.heroBufs.set(id, hb);
        h.x = e[1] / 100;
        h.z = e[2] / 100;
      }
      hb.buf.push({ t: s.ts, x: e[1] / 100, z: e[2] / 100, f: e[3] / 100 });
      if (hb.buf.length > 8) hb.buf.shift();
    }

    // Monsters
    if (s.en) for (const st of s.en) this.mpGuestSpawnEnemy(st);
    if (s.es) {
      for (const en of s.es) {
        const p = g.enemies.get(en[0]);
        if (!p) continue;
        p.buf.push({ t: s.ts, x: en[1] / 100, z: en[2] / 100, f: en[3] / 100 });
        if (p.buf.length > 8) p.buf.shift();
        const prevHp = p.e.hp;
        p.e.hp = en[4];
        const flags = en[5];
        p.e.stunTimer = flags & EF_STUN ? 0.3 : 0;
        p.e.frozenTimer = flags & EF_FROZEN ? 0.3 : 0;
        p.e.slowTimer = flags & EF_SLOW ? 0.3 : 0;
        if (flags & EF_HIT || en[4] < prevHp) p.e.hitFlash = 0.12;
        if (p.e.isBoss) {
          const nextState = EmbervaultEngine.MP_BOSS_STATES[(flags >> EF_BOSS_SHIFT) & 3] ?? 'chase';
          const nextSkill = en[10] !== undefined ? BOSS_SKILL_LIST[en[10]] ?? 'slam' : p.e.bossSkill ?? 'slam';
          p.e.bossState = nextState;
          p.e.bossEnraged = (flags & EF_ENRAGED) !== 0;
          p.e.bossStateDuration = 1;
          p.e.bossStateTimer = (en[6] ?? 0) / 100;
          p.e.telegraphX = (en[7] ?? 0) / 100;
          p.e.telegraphZ = (en[8] ?? 0) / 100;
          p.e.telegraphRadius = (en[9] ?? 0) / 100;
          p.e.bossSkill = nextSkill;
          p.e.bossWarpUntargetable = nextState === 'strike' && nextSkill === 'warp_ambush';
          // Flush interpolation buffer on warp_ambush jump so the vanished boss teleports cleanly instead of sliding
          if (nextState === 'strike' && nextSkill === 'warp_ambush' && p.buf.length >= 2) {
            const prevS = p.buf[p.buf.length - 2];
            const curS = p.buf[p.buf.length - 1];
            if (Math.hypot(curS.x - prevS.x, curS.z - prevS.z) > 0.9) {
              p.buf = [curS];
            }
          }
        }
      }
    }
    if (s.er) for (const id of s.er) this.mpGuestRemoveEnemy(id);

    // Projectiles
    if (s.ps) {
      for (const [pid, kind, x, z, vx, vz] of s.ps) {
        if (g.projs.has(pid)) continue;
        const px = x / 100;
        const pz = z / 100;
        const isBossHeavy = g.enemyList.some(
          (e) =>
            !e.dead &&
            e.isBoss &&
            e.bossSkill === 'ranged_volley' &&
            Math.hypot(e.x - px, e.z - pz) < 2.6
        );
        const mesh = createProjectileMesh(kind as ProjectileKind, isBossHeavy);
        if (isBossHeavy) mesh.scale.setScalar(1.08);
        mesh.position.set(px, 0.85, pz);
        mesh.rotation.y = Math.atan2(vx, vz);
        this.dynamicGroup.add(mesh);
        const ent: ProjectileEntity = {
          kind: kind as ProjectileKind,
          mesh,
          x: px,
          z: pz,
          vx: vx / 100,
          vz: vz / 100,
          damage: 0,
          sourceLabel: '',
          life: 0,
          maxLife: 3.2,
          isBossHeavy,
          pid,
        };
        this.projectiles.push(ent);
        g.projs.set(pid, ent);
      }
    }
    if (s.hp) {
      for (const [pid, owner, x, z, vx, vz, shot] of s.hp) {
        if (owner === mp.selfId || g.hprojs.has(pid)) continue;
        const mesh = shot === -1 ? createHunterArrowMesh() : createIceSpikeMesh(shot === 2);
        mesh.position.set(x / 100, shot === -1 ? 0.88 : 0.85, z / 100);
        mesh.rotation.y = Math.atan2(vx, vz);
        this.dynamicGroup.add(mesh);
        const ent: HeroProjectileEntity = {
          mesh,
          x: x / 100,
          z: z / 100,
          vx: vx / 100,
          vz: vz / 100,
          traveled: 0,
          shotIdx: shot,
          phantomCrit: false,
          ownerId: owner,
          pid,
        };
        this.heroProjectiles.push(ent);
        g.hprojs.set(pid, ent);
      }
    }
    if (s.pr) {
      for (const pid of s.pr) {
        const p = g.projs.get(pid);
        if (p) {
          const i = this.projectiles.indexOf(p);
          if (i >= 0) this.removeProjectileAt(i);
          g.projs.delete(pid);
        }
        const hpj = g.hprojs.get(pid);
        if (hpj) {
          const i = this.heroProjectiles.indexOf(hpj);
          if (i >= 0) this.removeHeroProjectileAt(i);
          g.hprojs.delete(pid);
        }
      }
    }

    // Hunter pets (reconciled from host snapshot)
    const seenPets = new Set<string>();
    if (s.pets && this.sharedShadowMap) {
      for (const [ownerId, spIdx, name, x100, z100, f100, hp, maxHp, buff100, hit] of s.pets) {
        seenPets.add(ownerId);
        const species: PetSpecies = spIdx === 0 ? 'bear' : spIdx === 1 ? 'chocobo' : 'wolf';
        let pet = this.pets.get(ownerId);
        if (!pet || pet.species !== species || pet.name !== name) {
          if (pet) this.dismissPet(ownerId);
          const rig = createHunterPetModel(species, name, this.sharedShadowMap);
          rig.root.position.set(x100 / 100, 0, z100 / 100);
          this.scene.add(rig.root);
          pet = {
            ownerId,
            species,
            name,
            rig,
            x: x100 / 100,
            z: z100 / 100,
            vx: 0,
            vz: 0,
            facing: f100 / 100,
            hp,
            maxHp,
            buffTimer: buff100 / 100,
            attackCooldown: 0,
            timeSinceDamaged: 999,
            hitFlash: hit ? 0.14 : 0,
            invuln: 0,
            walkPhase: 0,
            targetX: x100 / 100,
            targetZ: z100 / 100,
            targetFacing: f100 / 100,
          };
          this.pets.set(ownerId, pet);
        } else {
          pet.targetX = x100 / 100;
          pet.targetZ = z100 / 100;
          pet.targetFacing = f100 / 100;
          pet.hp = hp;
          pet.maxHp = maxHp;
          pet.buffTimer = buff100 / 100;
          if (hit) pet.hitFlash = 0.14;
        }
      }
    }
    for (const id of Array.from(this.pets.keys())) {
      if (!seenPets.has(id)) this.dismissPet(id);
    }

    // My own loot
    if (s.ls) {
      for (const [id, owner, type, x, z, rar] of s.ls) {
        if (owner !== mp.selfId || g.loots.has(id)) continue;
        const rarity = EmbervaultEngine.MP_RARITIES[rar] ?? 'blue';
        if (type === 2) {
          const rig = createRelicLootMesh(rarity, this.textures?.glowMap);
          rig.root.position.set(x / 100, 0, z / 100);
          this.dynamicGroup.add(rig.root);
          const ent: LootEntity = {
            id,
            ownerId: owner,
            type: 'relic',
            value: 0,
            mesh: rig.root,
            relicRig: rig,
            x: x / 100,
            z: z / 100,
            y: 0.32,
            vy: 4.6,
            age: 0,
            collected: false,
            rarity,
          };
          this.loots.push(ent);
          g.loots.set(id, ent);
        } else {
          const kind = type === 1 ? 'potion' : 'gold';
          const mesh = createLootMesh(kind);
          mesh.position.set(x / 100, 0.3, z / 100);
          this.dynamicGroup.add(mesh);
          const ent: LootEntity = { id, ownerId: owner, type: kind, value: 0, mesh, x: x / 100, z: z / 100, y: 0.3, vy: 3.8, age: 0, collected: false };
          this.loots.push(ent);
          g.loots.set(id, ent);
        }
      }
    }
    if (s.lr) {
      for (const id of s.lr) {
        const l = g.loots.get(id);
        if (l) {
          l.collected = true;
          l.mesh.visible = false;
          g.loots.delete(id);
        }
      }
    }

    // Doors
    if (s.dr) this.mpGuestApplyDoors(s.dr);
    // Objectives, wells, crates
    if (s.w) this.mpGuestApplyWorld(s.w);
    if (s.el !== undefined) g.spikeOffset = s.el / 100 - this.elapsed;
    if (s.ev) for (const ev of s.ev) this.mpGuestEvent(ev);
  },

  /** In town the teammate client only follows which floor the party is on and where the doors (portals) are. */
  mpGuestTownSnapshot(this: EmbervaultEngine, s: SnapshotPayload): void {
    const g = this.mp!.guest;
    if (s.d !== this.depth) {
      this.depth = s.d;
      for (const h of this.heroes) h.portal = null;
      g.doorSig = '';
    }
    if (s.dr) this.mpGuestApplyDoors(s.dr);
  },

  mpHistoryAt(this: EmbervaultEngine, g: MpGuestState, t: number): { x: number; z: number } | null {
    const h = g.history;
    if (h.length === 0) return null;
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1];
        const b = h[i];
        const k = b.t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 0;
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
      }
    }
    return h[h.length - 1];
  },

  mpGuestSpawnEnemy(this: EmbervaultEngine, st: EnemyStatic): void {
    const g = this.mp!.guest;
    if (g.enemies.has(st.i)) return;
    const kind = st.k as EnemyKind;
    const rig = createEnemyModel(kind, this.dungeon.biome, this.sharedShadowMap);
    rig.root.position.set(0, -50, 0);
    this.dynamicGroup.add(rig.root);
    let telegraph: BossTelegraphRig | undefined;
    const isBoss = isFloorBoss(kind);
    if (isBoss) {
      telegraph = createBossTelegraph(BOSS_CONFIGS[kind].telegraphColor);
      this.dynamicGroup.add(telegraph.group);
    }
    // Named-elite aura (host decides; teammates only draw the name tag label and the ground ring)
    const aura = isBoss ? undefined : auraTypeFromKey(st.a);
    let auraHolderFx: AuraHolderFx | undefined;
    if (st.e > 0 && !isBoss) {
      const def = aura ? ENEMY_AURA_DEFS[aura] : undefined;
      auraHolderFx = applyEliteVisuals(
        rig,
        st.n ?? `菁英 ${this.getEnemyBaseLabel(kind)}`,
        st.e === 2,
        def ? { label: def.label, css: def.css, color: def.color } : undefined
      );
    }
    const e: EnemyEntity = {
      id: st.i,
      kind,
      rig,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      hp: st.m,
      maxHp: st.m,
      speed: 0,
      attackCooldown: 0,
      windupTimer: 0,
      stunTimer: 0,
      hitFlash: 0,
      hopPhase: st.i,
      facing: 0,
      dead: false,
      isBoss,
      isRanged: isRangedEnemy(kind),
      isElite: st.e > 0,
      isSpecialElite: st.e === 2,
      customName: st.n,
      damageMult: 1,
      critChance: 0,
      aura,
      auraHolderFx,
      bossName: st.bn,
      bossTitle: st.bt,
      bossState: 'chase',
      telegraph,
    };
    g.enemies.set(st.i, { e, buf: [], placed: false });
    g.enemyList.push(e);
  },

  mpGuestRemoveEnemy(this: EmbervaultEngine, id: number): void {
    const g = this.mp!.guest;
    const p = g.enemies.get(id);
    if (!p) return;
    p.e.dead = true;
    p.e.rig.root.visible = false;
    if (p.e.telegraph) p.e.telegraph.group.visible = false;
    this.hideBossWindupVfx(id);
    this.dynamicGroup.remove(p.e.rig.root);
    if (p.e.telegraph) this.dynamicGroup.remove(p.e.telegraph.group);
    g.enemies.delete(id);
    g.enemyList = g.enemyList.filter((e) => e !== p.e);
  },

  mpGuestApplyDoors(this: EmbervaultEngine, dr: DoorSnap[]): void {
    const g = this.mp!.guest;
    const sig = JSON.stringify(dr);
    if (sig === g.doorSig) return;
    g.doorSig = sig;
    const present = new Set<string>();
    for (const [id, x, z, downed] of dr) {
      present.add(id);
      const h = this.heroById(id);
      if (!h) continue;
      const px = x / 100;
      const pz = z / 100;
      void downed;
      if (!h.portal || h.portal.x !== px || h.portal.z !== pz || h.portal.depth !== this.depth || !this.heroPortalRigs.has(id)) {
        if (this.inTown || !this.textures) h.portal = { x: px, z: pz, depth: this.depth };
        else this.placeHeroPortal(h, px, pz, this.depth);
      }
    }
    for (const h of this.heroes) {
      if (present.has(h.id) || !h.portal) continue;
      h.portal = null;
      const rig = this.heroPortalRigs.get(h.id);
      if (rig) {
        rig.root.parent?.remove(rig.root);
        this.heroPortalRigs.delete(h.id);
      }
      this.lightProps = this.lightProps.filter((lp) => !(lp.kind === 'portal' && lp.heroId === h.id));
    }
  },

  /** Visual-only shatter of a crate / urn my hero just hit on a teammate client (P5-C). */
  mpGuestPredictBreak(this: EmbervaultEngine, br: BreakableEntity): void {
    const g = this.mp!.guest;
    if (this.hero !== this.localHero || br.broken) return; // only my own hits are predicted
    br.broken = true;
    br.mesh.visible = false;
    g.pendingBreaks.set(br, performance.now() + MP_BREAK_CONFIRM_MS);
    this.audio.playCrateBreak();
    this.mpBreakBurst(br);
  },

  mpBreakBurst(this: EmbervaultEngine, br: BreakableEntity): void {
    const color = this.getBreakableDebrisColor(br.kind);
    for (let i = 0; i < 10; i++) {
      this.spawnParticle(
        br.x + (Math.random() - 0.5) * 0.4,
        0.5,
        br.z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 4.2,
        2.2 + Math.random() * 2.4,
        (Math.random() - 0.5) * 4.2,
        color,
        1.25,
        0.55,
        9.5
      );
    }
  },

  /** Predicted crates the host never confirmed within the grace period come back (the host did not break them). */
  mpGuestCheckBreaks(this: EmbervaultEngine): void {
    const g = this.mp!.guest;
    if (g.pendingBreaks.size === 0) return;
    const now = performance.now();
    for (const [br, deadline] of g.pendingBreaks) {
      if (now < deadline) continue;
      g.pendingBreaks.delete(br);
      br.broken = false;
      br.mesh.visible = true;
    }
  },

  mpGuestApplyWorld(this: EmbervaultEngine, w: WorldSnap): void {
    const g = this.mp!.guest;
    this.hasKey = w.k === 1;
    this.doorUnlocked = w.u === 1;
    if (this.hasKey && !g.lastHasKey && this.keyPedestal) {
      this.keyPedestal.keyMesh.visible = false;
      this.keyPedestal.halo.visible = false;
    }
    g.lastHasKey = this.hasKey;
    if (this.doorUnlocked && this.gateRig) this.gateRig.lockGlow.visible = false;
    g.lastUnlocked = this.doorUnlocked;
    const runes = this.lightProps.filter((lp) => lp.kind === 'rune');
    for (const i of w.ru) {
      const lp = runes[i];
      if (!lp || lp.used) continue;
      lp.used = true;
      if (lp.crystal) lp.crystal.visible = false;
      if (lp.halo) lp.halo.visible = false;
      if (lp.decal) (lp.decal.material as THREE.MeshBasicMaterial).opacity = 0.46;
      if (lp.pool) (lp.pool.material as THREE.MeshBasicMaterial).opacity = 0.12;
    }
    // Treasure chests the host opened (the burst plays once; a chest built already open stays as it is)
    const treasure = this.dungeon.treasure;
    if (w.tc && treasure) {
      for (const i of w.tc) {
        const c = treasure.chests[i];
        if (!c || c.opened) continue;
        c.opened = true;
        this.playChestOpened(i);
        this.emitMinimap();
      }
    }
    for (const i of w.br) {
      const br = this.breakables[i];
      if (!br) continue;
      if (br.broken) {
        g.pendingBreaks.delete(br); // my own prediction, now confirmed by the host
        continue;
      }
      br.broken = true;
      br.mesh.visible = false;
      for (let k = 0; k < 8; k++) {
        this.spawnParticle(
          br.x + (Math.random() - 0.5) * 0.4,
          0.5,
          br.z + (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 4,
          2 + Math.random() * 2.4,
          (Math.random() - 0.5) * 4,
          this.getBreakableDebrisColor(br.kind),
          1.2,
          0.5,
          9.5
        );
      }
    }
  },

  mpGuestEvent(this: EmbervaultEngine, ev: GameEvent): void {
    const mp = this.mp!;
    const t = ev[0];
    if (t === 'f') {
      const to = String(ev[6] ?? '');
      if (to && to !== mp.selfId) return;
      this.emitFloatingText(Number(ev[1]) / 100, Number(ev[2]) / 100, Number(ev[3]) / 100, String(ev[4]), ev[5] as FloatingLabelData['tone'], true);
    } else if (t === 's') {
      const name = String(ev[1]);
      const origin = String(ev[2]);
      const to = String(ev[3] ?? '');
      if (to && to !== mp.selfId) return;
      if (origin === mp.selfId && EmbervaultEngine.MP_PREDICTED_SOUNDS.has(name)) return;
      const fn = (this.audio as unknown as Record<string, unknown>)[name];
      if (typeof fn === 'function') (fn as (...a: unknown[]) => void).apply(this.audio, ev.slice(4));
    } else if (t === 'b') {
      const to = String(ev[3] ?? '');
      if (to && to !== mp.selfId) return;
      this.pushBanner(String(ev[1]), String(ev[2]) || undefined, true);
    } else if (t === 'k') {
      if (String(ev[3]) !== mp.selfId) return;
      this.addScreenShake(Number(ev[1]) / 100, Number(ev[2]) / 100);
    } else if (t === 'x') {
      const x = Number(ev[1]) / 100;
      const z = Number(ev[2]) / 100;
      const big = Number(ev[3]) === 1;
      for (let i = 0; i < (big ? 22 : 9); i++) {
        const a = (i / (big ? 22 : 9)) * Math.PI * 2;
        this.spawnParticle(x, 0.6, z, Math.cos(a) * 3.2, 1.6 + Math.random() * 2, Math.sin(a) * 3.2, big ? 0xffd24a : 0xcfd6e6, 1.1, 0.5, 6);
      }
    }
  },

  /** Samples a buffer of host-timestamped positions at the (delayed) render time. */
  mpSample(this: EmbervaultEngine, buf: MpSample[], t: number, out: { x: number; z: number; f: number }): boolean {
    const n = buf.length;
    if (n === 0) return false;
    if (n === 1 || t <= buf[0].t) {
      const a = buf[0];
      out.x = a.x;
      out.z = a.z;
      out.f = a.f;
      return true;
    }
    for (let i = n - 1; i > 0; i--) {
      const a = buf[i - 1];
      const b = buf[i];
      if (a.t <= t) {
        const span = b.t - a.t;
        const k = span > 0 ? Math.min(1, (t - a.t) / span) : 1;
        out.x = a.x + (b.x - a.x) * k;
        out.z = a.z + (b.z - a.z) * k;
        let df = b.f - a.f;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        out.f = a.f + df * k;
        return true;
      }
    }
    const last = buf[n - 1];
    out.x = last.x;
    out.z = last.z;
    out.f = last.f;
    return true;
  },

  /** One frame of the teammate client in the dungeon: predict my hero, draw the others from the host's snapshots. */
  mpGuestFrame(this: EmbervaultEngine, dt: number): void {
    const mp = this.mp!;
    const g = mp.guest;
    const local = this.localHero;
    const now = performance.now();
    this.setActor(local);
    if (g.built && !local.isDead) {
      this.updateHeroFrame(dt, true);
      g.history.push({ t: now, x: local.x, z: local.z });
      while (g.history.length > 0 && now - g.history[0].t > 2000) g.history.shift();
    } else if (g.built) {
      this.updateHeroFrame(dt, true);
    }
    this.mpGuestSendInput(now);
    // The others
    const renderT = now - (Number.isFinite(mp.clockOff) ? mp.clockOff : 0) - g.interpDelay;
    const tmp = { x: 0, z: 0, f: 0 };
    for (const h of this.heroes) {
      if (!h.isRemote) continue;
      const hb = g.heroBufs.get(h.id);
      const px = h.x;
      const pz = h.z;
      if (hb && !h.inTown && this.mpSample(hb.buf, renderT, tmp)) {
        h.x = tmp.x;
        h.z = tmp.z;
        h.facing = tmp.f;
        const sp = dt > 0 ? Math.hypot(h.x - px, h.z - pz) / dt : 0;
        hb.speed += (sp - hb.speed) * Math.min(1, dt * 10);
      }
      this.mpAnimatePuppetHero(h, dt, hb?.speed ?? 0);
    }
    this.setActor(local);
  },

  mpAnimatePuppetHero(this: EmbervaultEngine, h: Hero, dt: number, speed: number, at?: { x: number; z: number; f: number }): void {
    // `at`: drawn in my town at the position its owner broadcast (their dungeon position `h.x / h.z` stays untouched)
    h.rig.root.visible = at ? true : !this.inTown && !h.inTown;
    h.rig.root.position.set(at ? at.x : h.x, 0, at ? at.z : h.z);
    h.rig.body.rotation.y = at ? at.f : h.facing;
    h.hitFlash = Math.max(0, h.hitFlash - dt);
    h.attackAnim = Math.max(0, h.attackAnim - dt);
    h.pommelAnim = Math.max(0, h.pommelAnim - dt);
    if (h.isDead) return;
    const moving = speed > 0.5;
    if (moving) h.walkCycle += dt * 11.5;
    else h.walkCycle *= 0.85;
    const stride = Math.sin(h.walkCycle) * (moving ? 0.55 : 0);
    h.rig.leftLeg.rotation.x = stride;
    h.rig.rightLeg.rotation.x = -stride;
    h.rig.body.position.y = Math.abs(Math.sin(h.walkCycle)) * (moving ? 0.08 : 0);
    h.rig.cape.rotation.x = 0.14 + (moving ? 0.22 : 0) + Math.sin(this.elapsed * 3.5) * 0.05;
    if (h.pommelAnim > 0) {
      const p = 1 - h.pommelAnim / 0.34;
      h.rig.swordGroup.rotation.x = -Math.PI * 0.56;
      const slam = Math.sin(p * Math.PI);
      h.rig.rightArm.rotation.x = -1.35 + slam * 1.15;
      h.rig.rightArm.rotation.y = -0.35 + p * 1.35;
      h.rig.body.rotation.y = (at ? at.f : h.facing) + slam * 0.72;
    } else if (h.attackAnim > 0) {
      const p = 1 - h.attackAnim / 0.28;
      h.rig.swordGroup.rotation.x = THREE.MathUtils.damp(h.rig.swordGroup.rotation.x, Math.PI * 0.42, 22, dt);
      h.rig.rightArm.rotation.x = -1.6 + p * 2.4;
      h.rig.rightArm.rotation.y = -0.7 + p * 1.6;
    } else {
      h.rig.swordGroup.rotation.x = THREE.MathUtils.damp(h.rig.swordGroup.rotation.x, Math.PI * 0.42, 16, dt);
      h.rig.rightArm.rotation.x = THREE.MathUtils.damp(h.rig.rightArm.rotation.x, -stride * 0.4, 12, dt);
      h.rig.rightArm.rotation.y = THREE.MathUtils.damp(h.rig.rightArm.rotation.y, 0, 12, dt);
    }
    const em = h.hitFlash > 0 ? (h.hitShieldOnly ? 0x6fd8ff : 0xff3b3b) : 0x000000;
    for (const m of h.rig.flashMaterials) {
      m.emissive.setHex(em);
      m.emissiveIntensity = h.hitFlash > 0 ? 0.75 : 0;
    }
  },

  /** The teammate's controls to the host: only on change, at most 20 per second, one keepalive per second. */
  mpGuestSendInput(this: EmbervaultEngine, now: number): void {
    const mp = this.mp!;
    const g = mp.guest;
    const local = this.localHero;
    if (!g.built || this.inTown || mp.hold) return;
    const keys = local.input.keys;
    let k = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) k |= KEY_W;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) k |= KEY_A;
    if (keys.has('KeyS') || keys.has('ArrowDown')) k |= KEY_S;
    if (keys.has('KeyD') || keys.has('ArrowRight')) k |= KEY_D;
    if (keys.has('KeyF')) k |= KEY_F;
    const f = q100(local.facing);
    const h: 0 | 1 = local.input.leftMouseHeld ? 1 : 0;
    const ls = g.lastSent;
    const changed = k !== ls.k || h !== ls.h || (h === 1 && Math.abs(f - ls.f) > 6);
    const hasActions = g.actions.length > 0;
    const due = now - ls.at >= 1000 / INPUT_MAX_HZ;
    const keepalive = now - ls.at >= INPUT_KEEPALIVE_MS;
    if (!((changed || hasActions) && due) && !keepalive) return;
    const payload: InputPayload = { t: Math.round(now), k, f, h };
    if (hasActions) payload.a = g.actions.splice(0, 8);
    ls.k = k;
    ls.f = f;
    ls.h = h;
    ls.at = now;
    mp.send('in', payload, mp.hostId);
  },

  mpQueueAction(this: EmbervaultEngine, a: number): void {
    const mp = this.mp;
    if (mp?.role === 'guest' && mp.guest.actions.length < 8) mp.guest.actions.push(a);
  },

  /** Teammate: everything that is not the hero's own movement (monsters, projectiles, loot, objectives). */
  mpGuestWorld(this: EmbervaultEngine, dt: number): void {
    // Smoothly interpolate puppet Hunter pets on guest clients
    for (const pet of this.pets.values()) {
      pet.rig.root.visible = !this.inTown;
      pet.hitFlash = Math.max(0, pet.hitFlash - dt);
      pet.buffTimer = Math.max(0, pet.buffTimer - dt);
      const tx = pet.targetX ?? pet.x;
      const tz = pet.targetZ ?? pet.z;
      const dist = Math.hypot(tx - pet.x, tz - pet.z);
      if (dist > 4) {
        pet.x = tx;
        pet.z = tz;
      } else {
        pet.x = THREE.MathUtils.damp(pet.x, tx, 14, dt);
        pet.z = THREE.MathUtils.damp(pet.z, tz, 14, dt);
      }
      if (pet.targetFacing !== undefined) {
        pet.facing = pet.targetFacing;
      }
      this.animatePetRig(pet, dist * 8, dt);
    }
    const mp = this.mp!;
    const g = mp.guest;
    this.mpGuestCheckBreaks();
    const renderT = performance.now() - (Number.isFinite(mp.clockOff) ? mp.clockOff : 0) - g.interpDelay;
    const tmp = { x: 0, z: 0, f: 0 };
    for (const p of g.enemies.values()) {
      const e = p.e;
      if (!this.mpSample(p.buf, renderT, tmp)) continue;
      const moved = Math.hypot(tmp.x - e.x, tmp.z - e.z);
      e.x = tmp.x;
      e.z = tmp.z;
      e.facing = tmp.f;
      const first = !p.placed;
      p.placed = true;
      e.rig.root.position.set(e.x, 0, e.z);
      e.rig.body.rotation.y = e.facing;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      if (!first && moved > 0.002) {
        e.hopPhase += dt * 9;
        e.rig.body.position.y = Math.abs(Math.sin(e.hopPhase)) * 0.07;
        const sw = Math.sin(e.hopPhase) * 0.5;
        if (e.rig.leftLeg) e.rig.leftLeg.rotation.x = sw;
        if (e.rig.rightLeg) e.rig.rightLeg.rotation.x = -sw;
      } else {
        e.rig.body.position.y *= 0.8;
      }
      const frozen = (e.frozenTimer ?? 0) > 0;
      const slowed = (e.slowTimer ?? 0) > 0;
      if (e.rig.frozenShell) e.rig.frozenShell.visible = frozen;
      if (e.rig.slowMarker) e.rig.slowMarker.visible = slowed && !frozen;
      if (e.rig.stunStars) {
        e.rig.stunStars.visible = e.stunTimer > 0;
        if (e.stunTimer > 0) e.rig.stunStars.rotation.y += dt * 5.8;
      }
      const isGuestWarp =
        e.isBoss &&
        e.bossSkill === 'warp_ambush' &&
        (e.bossState === 'windup' || e.bossState === 'strike');
      for (const m of e.rig.flashMaterials) {
        if (e.hitFlash > 0) {
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = 0.85;
        } else if (frozen) {
          m.emissive.setHex(0x7fdcff);
          m.emissiveIntensity = 0.45;
        } else if (isGuestWarp) {
          m.emissive.setHex(BOSS_WARP.color);
          m.emissiveIntensity = 0.42 + Math.sin(this.elapsed * 26) * 0.2;
        } else if (e.isBoss && e.bossEnraged) {
          m.emissive.setHex(BOSS_ENRAGE.color);
          m.emissiveIntensity = 0.3 + Math.sin(this.elapsed * 6 + e.id) * 0.12;
        } else if (e.isElite) {
          m.emissive.setHex(0xffd24d);
          m.emissiveIntensity = 0.16;
        } else {
          m.emissive.setHex(0x000000);
          m.emissiveIntensity = 0;
        }
      }
      if (e.rig.auraRing) e.rig.auraRing.rotation.z += dt * 1.1;
      if (e.isBoss) this.updateBossRageVisual(e, dt);
      if (e.isBoss) {
        const skill = e.bossSkill ?? 'slam';
        const tx = e.telegraphX ?? e.x;
        const tz = e.telegraphZ ?? e.z;
        const rad = e.telegraphRadius ?? 0;

        // Capture charge_slam start position when entering windup so the chevron lane draws accurately
        if (
          e.bossState === 'windup' &&
          skill === 'charge_slam' &&
          (e.prevBossState !== 'windup' || e.prevBossSkill !== 'charge_slam')
        ) {
          e.bossChargeStartX = e.x;
          e.bossChargeStartZ = e.z;
        }

        // Trigger burst VFX once on windup -> strike transition (and on charge_slam arrival)
        if (e.prevBossState === 'windup' && e.bossState === 'strike' && rad > 0 && isFloorBoss(e.kind)) {
          const cfg = BOSS_CONFIGS[e.kind];
          this.hideBossWindupVfx(e.id);
          if (skill === 'slam') {
            this.spawnBossSlamVfx(tx, tz, rad, cfg.telegraphColor, e.kind);
          } else if (skill === 'charge_slam') {
            e.bossChargeStartX = e.x;
            e.bossChargeStartZ = e.z;
            this.spawnBossChargeDashVfx(e.x, e.z, tx, tz, 0.3, cfg.telegraphColor);
          } else if (skill === 'warp_ambush') {
            e.bossWarpGuestTimer = 0;
            e.bossWarpGuestDescTimer = 0;
            e.bossWarpGuestArrived = false;
            e.bossWarpOriginX = e.x;
            e.bossWarpOriginZ = e.z;
            this.setBossWarpVisual(e, 0.35, 1, true);
            this.spawnBossWarpTakeoffVfx(e.x, e.z, BOSS_WARP.ascendDur);
          } else if (skill === 'nova_ring') {
            const beams = this.computeNovaBeams(tx, tz, e.facing);
            const laserColor = e.kind === 'boss_mothership_ai' ? 0x38c8ff : cfg.telegraphColor;
            this.spawnBossNovaLaserVfx(tx, tz, rad, beams, laserColor);
          } else if (skill === 'prism_cone') {
            this.spawnBossPrismConeVfx(e.x, e.z, e.facing, BOSS_PRISM.range, BOSS_PRISM.halfAngle, cfg.telegraphColor, e.kind);
          } else if (skill === 'orbital_barrage') {
            this.spawnBossOrbitalPillarVfx(tx, tz, rad, cfg.telegraphColor);
          } else if (skill === 'targeted_blast') {
            this.spawnBossBlackHoleVfx(tx, tz, rad, cfg.telegraphColor);
          } else if (skill === 'ranged_volley') {
            this.spawnBossVolleyVfx(e.x, e.z, e.facing, cfg.telegraphColor);
          }
        } else if (e.prevBossState === 'strike' && e.bossState === 'recover' && skill === 'charge_slam' && rad > 0 && isFloorBoss(e.kind)) {
          this.spawnBossChargeImpactVfx(
            e.bossChargeStartX ?? e.x,
            e.bossChargeStartZ ?? e.z,
            e.x,
            e.z,
            rad,
            BOSS_CONFIGS[e.kind].telegraphColor
          );
        }

        // Sync warp_ambush Phase 1 (levitation) + Phase 2 (ascend fade-out) & Phase 3 (landing 5 rings + descend fade-in)
        if (e.bossState === 'windup' && skill === 'warp_ambush' && rad > 0) {
          const prog = 1 - (e.bossStateTimer ?? 0);
          e.rig.body.position.y = prog * 0.35;
        }
        if (e.bossState === 'strike' && skill === 'warp_ambush') {
          e.bossWarpGuestTimer = (e.bossWarpGuestTimer ?? 0) + dt;
          const strikeProg = 1 - (e.bossStateTimer ?? 0);
          const ascendFrac = BOSS_WARP.ascendDur / (BOSS_WARP.ascendDur + BOSS_WARP.descendDur);
          const teleMoved =
            Math.hypot(tx - (e.bossWarpOriginX ?? tx), tz - (e.bossWarpOriginZ ?? tz)) > 0.5;
          if (!e.bossWarpGuestArrived && (teleMoved || strikeProg >= ascendFrac)) {
            e.bossWarpGuestArrived = true;
            e.bossWarpGuestDescTimer = 0;
            e.x = tx;
            e.z = tz;
            e.rig.root.position.set(tx, 0, tz);
            this.spawnBossWarpArriveVfx(tx, tz, BOSS_WARP.descendDur);
          }
          if (!e.bossWarpGuestArrived) {
            const pAsc = THREE.MathUtils.clamp((e.bossWarpGuestTimer ?? 0) / BOSS_WARP.ascendDur, 0, 1);
            this.setBossWarpVisual(e, 0.35 + pAsc * pAsc * BOSS_WARP.liftHeight, 1 - pAsc, true);
          } else {
            e.bossWarpGuestDescTimer = (e.bossWarpGuestDescTimer ?? 0) + dt;
            const pDesc = THREE.MathUtils.clamp(e.bossWarpGuestDescTimer / BOSS_WARP.descendDur, 0, 1);
            const easeOut = 1 - Math.pow(1 - pDesc, 2.2);
            this.setBossWarpVisual(e, (1 - easeOut) * BOSS_WARP.liftHeight, pDesc, pDesc < 0.85);
          }
        } else if (e.bossWarpVisualDirty) {
          this.resetBossWarpVisual(e);
        }

        e.prevBossState = e.bossState;
        e.prevBossSkill = skill;

        if (e.telegraph) {
          // A windup without a telegraph radius is a basic attack: nothing on the ground
          if (e.bossState === 'windup' && rad > 0) {
            // bossStateTimer is the REMAINING fraction of the windup here: the circle fills up as it runs out
            const prog = 1 - (e.bossStateTimer ?? 0);
            const customWindup = this.updateBossWindupVfx(e, skill, tx, tz, rad, prog, e.facing);
            if (customWindup) {
              e.telegraph.group.visible = false;
            } else {
              e.telegraph.group.position.set(tx, 0, tz);
              e.telegraph.group.scale.setScalar(rad);
              e.telegraph.fillDisk.scale.setScalar(0.12 + prog * 0.88);
              e.telegraph.fillMat.opacity = 0.2 + prog * 0.34;
              e.telegraph.ringMat.opacity = 0.72 + Math.sin(this.elapsed * 26) * 0.24;
              e.telegraph.group.visible = true;
            }
          } else {
            e.telegraph.group.visible = false;
            this.hideBossWindupVfx(e.id);
          }
        }
      }
    }
    // Aura rings only: membership from the interpolated positions + the host's `a` field. No gameplay flags are set here.
    this.enemyAuraTimer -= dt;
    if (this.enemyAuraTimer <= 0) {
      this.enemyAuraTimer = ENEMY_AURA_INTERVAL;
      this.refreshAuraMask(g.enemyList, false);
    }
    this.updateAuraRings(g.enemyList, dt);
    // Monster projectiles and the other heroes' ice spikes fly in a straight line until the host says they ended
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.life += dt;
      p.mesh.position.set(p.x, 0.85, p.z);
      if (p.isBossHeavy) {
        const ringA = p.mesh.userData.heavyRingA as THREE.Mesh | undefined;
        const ringB = p.mesh.userData.heavyRingB as THREE.Mesh | undefined;
        if (ringA) ringA.rotation.z += dt * 14;
        if (ringB) ringB.rotation.z -= dt * 18;
        if (!this.isSoftwareGl && Math.random() < dt * 52) {
          const col =
            p.kind === 'plasma_bolt'
              ? 0x39ff7a
              : p.kind === 'bone_dart'
              ? 0xff5a2a
              : p.kind === 'bio_orb'
              ? 0x36f5d4
              : p.kind === 'ion_orb'
              ? 0xff4785
              : 0x3be8ff;
          this.spawnParticle(
            p.x + (Math.random() - 0.5) * 0.25,
            0.85,
            p.z + (Math.random() - 0.5) * 0.25,
            -p.vx * 0.14,
            0,
            -p.vz * 0.14,
            Math.random() < 0.4 ? 0xffffff : col,
            0.9,
            0.28,
            0
          );
        }
      }
      if (p.life >= p.maxLife || this.isPointInWall(p.x, p.z)) {
        if (p.isBossHeavy) {
          const col =
            p.kind === 'plasma_bolt'
              ? 0x39ff7a
              : p.kind === 'bone_dart'
              ? 0xff5a2a
              : p.kind === 'bio_orb'
              ? 0x36f5d4
              : p.kind === 'ion_orb'
              ? 0xff4785
              : 0x3be8ff;
          this.spawnBossProjectileImpactVfx(p.x, p.z, col);
        }
        if (p.pid !== undefined) g.projs.delete(p.pid);
        this.removeProjectileAt(i);
      }
    }
    for (let i = this.heroProjectiles.length - 1; i >= 0; i--) {
      const p = this.heroProjectiles[i];
      if (p.pid === undefined) continue; // my own spikes are simulated by updateHeroProjectiles
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.traveled += Math.hypot(p.vx, p.vz) * dt;
      p.mesh.position.set(p.x, 0.85, p.z);
      if (this.isPointInWall(p.x, p.z) || p.traveled > 22) {
        g.hprojs.delete(p.pid);
        this.removeHeroProjectileAt(i);
      }
    }
    // My loot (hovering only: the host decides when it is picked up)
    for (const l of this.loots) {
      if (l.collected) continue;
      l.age += dt;
      if (l.y > 0 || l.vy > 0) {
        l.vy -= 13.5 * dt;
        l.y = Math.max(0, l.y + l.vy * dt);
        if (l.y === 0) l.vy = 0;
      }
      if (l.type === 'relic' && l.relicRig) {
        l.mesh.position.set(l.x, 0, l.z);
        l.relicRig.artifact.position.y = 0.36 + l.y + Math.sin(this.elapsed * 3.8 + l.id) * 0.1;
        l.relicRig.artifact.rotation.y += dt * 2.4;
        l.relicRig.ring.rotation.z -= dt * 1.2;
        if (l.relicRig.beam) {
          l.relicRig.beam.rotation.y += dt * 0.85;
          if (!this.isSoftwareGl && Math.random() < dt * 12) {
            const a = Math.random() * Math.PI * 2;
            const r = 0.08 + Math.random() * 0.42;
            const col = l.rarity === 'green' ? 0x38f27c : 0xff7b1c;
            this.spawnParticle(
              l.x + Math.cos(a) * r,
              0.2 + Math.random() * 0.35,
              l.z + Math.sin(a) * r,
              (Math.random() - 0.5) * 0.25,
              2.4 + Math.random() * 2.1,
              (Math.random() - 0.5) * 0.25,
              Math.random() < 0.35 ? 0xfff4d2 : col,
              0.48 + Math.random() * 0.36,
              0.95 + Math.random() * 0.45,
              -0.25
            );
          }
        }
      } else {
        l.mesh.position.set(l.x, l.y + Math.sin(this.elapsed * 4.5 + l.id) * 0.08, l.z);
        l.mesh.rotation.y += dt * 2.8;
      }
    }
    // Key pedestal / gate animation (the flags themselves come from the host)
    if (this.keyPedestal && !this.hasKey) {
      this.keyPedestal.keyMesh.rotation.y += dt * 2.1;
      this.keyPedestal.keyMesh.position.y = 1.05 + Math.sin(this.elapsed * 3.4) * 0.14;
    }
    if (this.gateRig && this.doorUnlocked && this.gateOpenProgress < 1) {
      this.gateOpenProgress = Math.min(1, this.gateOpenProgress + dt * 2.4);
      const ease = 1 - Math.pow(1 - this.gateOpenProgress, 3);
      this.gateRig.leftPivot.rotation.y = -ease * Math.PI * 0.62;
      this.gateRig.rightPivot.rotation.y = ease * Math.PI * 0.62;
    }
  },
};
