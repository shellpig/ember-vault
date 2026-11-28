import type { EmbervaultEngine } from '../engine';
import { gridToWorld, worldToGrid } from '../dungeon';
import { Hero } from '../hero';
import { createTreasureChest } from '../models';
import { generateRelic } from '../relics';
import { TREASURE_CONFIG, planTreasureForFloor, rollTreasureOutcome } from '../treasure';
import type { TreasureOutcome } from '../treasure';
import type { TreasureRoomData } from '../types';
import { TreasureChestEntity } from './entities';
import type { EnemyLootProfile } from './loot';
import * as THREE from 'three';

/** How far an opened lid swings (same pose as the town stash chest). */
const LID_OPEN_ANGLE = -1.15;

/** What the chest says over itself, per outcome (private floating text of the hero who rolled it). */
const OUTCOME_LABEL: Record<TreasureOutcome, { text: string; tone: 'key' | 'relicOrange' }> = {
  coins: { text: '金幣寶箱', tone: 'key' },
  elite: { text: '菁英寶藏', tone: 'key' },
  named: { text: '★ 具名菁英寶藏', tone: 'relicOrange' },
  boss: { text: '頭目寶藏！', tone: 'relicOrange' },
  bossPlus: { text: '傳說寶藏！！', tone: 'relicOrange' },
};

const PLAIN_ELITE: EnemyLootProfile = { guardian: false, elite: true, swarm: false, special: false };
const NAMED_ELITE: EnemyLootProfile = { guardian: false, elite: true, swarm: false, special: true };

// Treasure room (docs/treasure-room-spec.md): per-floor roll, chest rigs, opening, loot, banner. Numbers: TREASURE_CONFIG.
export const treasureMethods = {
  /**
   * Decides whether the floor just generated in `this.dungeon` has a treasure room and moves the pity counter of the
   * LOCAL hero (single player, or the room host: a room game uses the host's counter only). Never called for a teammate's
   * client (it receives the host's result) or when a frozen floor is restored. `?devDepth` runs neither read nor write it.
   */
  rollTreasureRoom(this: EmbervaultEngine): void {
    this.dungeon.treasure = undefined;
    if (this.devDepthRun) return;
    const hero = this.localHero;
    const plan = planTreasureForFloor(this.dungeon, this.depth, hero.treasurePity, Math.random);
    hero.treasurePity = plan.pity;
    this.dungeon.treasure = plan.treasure ?? undefined;
  },

  /** Teammate client: takes over the host's treasure room (the dungeon itself is regenerated from the seed). */
  adoptTreasureRoom(this: EmbervaultEngine, t: TreasureRoomData | undefined): void {
    this.dungeon.treasure = t
      ? { roomId: t.roomId, chests: t.chests.map((c) => ({ gx: c.gx, gz: c.gz, opened: c.opened })) }
      : undefined;
  },

  /** Builds the chest models of `this.dungeon.treasure` (opened ones are already lying open). */
  buildTreasureChests(this: EmbervaultEngine): void {
    this.treasureRigs = [];
    const t = this.dungeon.treasure;
    if (!t || !this.textures) return;
    for (const c of t.chests) {
      const { x, z } = gridToWorld(c.gx, c.gz);
      const rig = createTreasureChest(this.textures.glowMap);
      rig.root.position.set(x, 0, z);
      rig.root.rotation.y = Math.PI / 4; // front faces the camera side, like the town stash chest
      this.levelGroup.add(rig.root);
      const light = {
        color: 0xffb445,
        baseIntensity: 22,
        distance: 6.4,
        decay: 2.05,
        phase: Math.random() * 6,
        x,
        y: 1.0,
        z,
        kind: 'chest' as const,
        used: c.opened,
      };
      this.lightProps.push(light);
      const ent: TreasureChestEntity = { rig, light, x, z };
      this.treasureRigs.push(ent);
      if (c.opened) this.setChestOpenLook(ent, true);
    }
  },

  /** The "opened" look: lid up, glow and halo off, light off. `instant` skips the lid animation. */
  setChestOpenLook(this: EmbervaultEngine, ent: TreasureChestEntity, instant: boolean): void {
    ent.light.used = true;
    ent.rig.halo.visible = false;
    ent.rig.glowRing.visible = false;
    for (const m of ent.rig.glowMats) m.emissiveIntensity = 0.12;
    if (instant) ent.rig.lid.rotation.x = LID_OPEN_ANGLE;
  },

  /** Golden burst + sound-less visual part of opening chest `i`; also what a teammate's client does when the host says it opened. */
  playChestOpened(this: EmbervaultEngine, i: number): void {
    const ent = this.treasureRigs[i];
    if (!ent) return;
    this.setChestOpenLook(ent, false);
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const spd = 1.4 + Math.random() * 2.4;
      this.spawnParticle(
        ent.x,
        0.7,
        ent.z,
        Math.cos(a) * spd,
        2.4 + Math.random() * 2.6,
        Math.sin(a) * spd,
        k % 3 === 0 ? 0xfff0a0 : 0xffc23a,
        1.2,
        0.7,
        6
      );
    }
  },

  /** Index of the closest unopened chest within `range` of the hero, or -1. */
  findNearbyTreasureChest(this: EmbervaultEngine, hero: Hero, range: number): number {
    const t = this.dungeon?.treasure;
    if (!t || this.inTown || hero.inTown) return -1;
    let best = -1;
    let bestD = range;
    for (let i = 0; i < t.chests.length; i++) {
      const ent = this.treasureRigs[i];
      if (!ent || t.chests[i].opened) continue;
      const d = Math.hypot(ent.x - hero.x, ent.z - hero.z);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  },

  /** HUD: the local hero stands next to a chest that can be opened with F. */
  isHeroNearTreasureChest(this: EmbervaultEngine): boolean {
    const lh = this.localHero;
    if (lh.isDead || this.inTown) return false;
    return this.findNearbyTreasureChest(lh, TREASURE_CONFIG.openRange) >= 0;
  },

  /**
   * F key / prompt button / auto-pilot: opens the closest chest in reach for the CURRENT actor. A teammate's client only asks
   * the host (the answer arrives in the next world snapshot). Returns true when a chest was in reach.
   */
  useNearbyTreasureChest(this: EmbervaultEngine, range: number = TREASURE_CONFIG.openRange): boolean {
    if (this.hero.isDead || this.inTown || this.transitionState !== 'none') return false;
    const i = this.findNearbyTreasureChest(this.hero, range);
    if (i < 0) return false;
    if (this.mp?.role === 'guest') {
      this.mpGuestCmd({ c: 'chest', i });
      return true;
    }
    return this.openTreasureChest(i, this.hero);
  },

  /**
   * Authority side (single player / room host): opens chest `index` on behalf of `opener` (the current actor). Every hero
   * alive in the dungeon, bots included, rolls their own outcome and gets the loot as personal drops (spec 5).
   */
  openTreasureChest(this: EmbervaultEngine, index: number, opener: Hero): boolean {
    const t = this.dungeon.treasure;
    const ent = this.treasureRigs[index];
    const chest = t?.chests[index];
    if (!t || !ent || !chest || chest.opened || opener.isDead || opener.inTown) return false;
    chest.opened = true;
    const prev = this.hero;
    this.setActor(opener);
    this.audio.playChestOpen();
    this.playChestOpened(index);
    this.setActor(prev);
    for (const h of this.heroes) {
      if (!this.isInDungeonAlive(h)) continue;
      this.setActor(h);
      this.dropTreasureLoot(ent.x, ent.z);
    }
    this.setActor(prev);
    this.emitHud();
    this.emitMinimap();
    return true;
  },

  /** One hero's roll on the chest table (spec 3), reusing the monster / boss drop functions so the numbers stay the same. */
  dropTreasureLoot(this: EmbervaultEngine, x: number, z: number): void {
    const outcome = rollTreasureOutcome(Math.random);
    const firstNew = this.loots.length;
    switch (outcome) {
      case 'coins':
        for (let i = 0; i < TREASURE_CONFIG.coinsEliteCount; i++) this.dropEnemyLoot(x, z, PLAIN_ELITE, false);
        break;
      case 'elite':
        this.dropEnemyLoot(x, z, PLAIN_ELITE);
        break;
      case 'named':
        this.dropEnemyLoot(x, z, NAMED_ELITE);
        break;
      case 'boss':
        this.dropBossHoard(x, z);
        break;
      case 'bossPlus': {
        this.dropBossHoard(x, z);
        const rarity = Math.random() < TREASURE_CONFIG.bossPlusOrangeChance ? 'orange' : 'green';
        this.spawnRelicItems(x, z, [generateRelic(this.depth, 'boss', this.nextId++, rarity, this.hero.classId)]);
        break;
      }
    }
    // Gold and elixirs spray out of the chest like the relics do (a short pickup delay lets the arc show)
    for (let i = firstNew; i < this.loots.length; i++) {
      const l = this.loots[i];
      if (l.type === 'relic') continue;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.2;
      l.vx = Math.cos(a) * sp;
      l.vz = Math.sin(a) * sp;
      l.vy += 1.2;
      l.pickupDelay = 0.5;
    }
    const label = OUTCOME_LABEL[outcome];
    this.emitFloatingText(x, 1.7, z, label.text, label.tone);
  },

  /** Per frame (dungeon view, every client): chest animation and the first-time "treasure room found" banner. */
  updateTreasure(this: EmbervaultEngine, dt: number): void {
    const t = this.dungeon.treasure;
    if (!t) return;
    for (let i = 0; i < this.treasureRigs.length; i++) {
      const ent = this.treasureRigs[i];
      const opened = t.chests[i]?.opened ?? false;
      const lid = ent.rig.lid;
      const target = opened ? LID_OPEN_ANGLE : 0;
      lid.rotation.x = THREE.MathUtils.lerp(lid.rotation.x, target, Math.min(1, dt * 9));
      if (opened) continue;
      const pulse = Math.sin(this.elapsed * 2.4 + ent.light.phase);
      const hs = 1.6 + pulse * 0.16;
      ent.rig.halo.scale.set(hs, hs, 1);
      ent.rig.glowRing.rotation.z += dt * 0.3;
      if (Math.random() < dt * 1.6) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.2 + Math.random() * 0.5;
        this.spawnParticle(ent.x + Math.cos(a) * r, 0.5, ent.z + Math.sin(a) * r, 0, 0.9 + Math.random() * 0.7, 0, 0xffd45a, 0.5, 0.9, -0.15);
      }
    }
    const local = this.localHero;
    if (!t.announced && !local.inTown && !local.isDead) {
      const room = this.dungeon.rooms.find((r) => r.id === t.roomId);
      const g = worldToGrid(local.x, local.z);
      if (room && g.gx >= room.x && g.gx < room.x + room.w && g.gz >= room.z && g.gz < room.z + room.h) {
        t.announced = true;
        this.audio.playTreasureFound();
        this.pushBanner('發現寶藏室！', `${t.chests.length} 個寶箱 · 靠近按 F 開啟`);
      }
    }
  },
};
