import type { EmbervaultEngine } from '../engine';
import { ENEMY_AURA_DEFS } from './data';
import type { EnemyEntity } from './entities';
import type { Hero } from '../hero';
import * as THREE from 'three';

/** One entry of the relic-buff HUD strip (Selfie Stick, stolen aura, low-battery shutdown). */
export interface RelicBuffHud {
  id: string;
  label: string;
  left: number;
  css: string;
}

/**
 * Batch 2 relic effects that are not tied to one hit / damage hook: periodic timers (Ember Lantern, Third Eye,
 * low-battery phone), kill hooks (Selfie Stick, Aura Thief, courier tips) and dash hooks (Alien Remote, courier 4pc).
 * The one-shot hooks inside combat live next to the existing uniques in heroCombat.ts / classSkills.ts.
 */
export const relicEffectMethods = {
  /** Expanding flat ring (reuses the shockwave `slashArcs` animation). `radius` is the final outer radius. */
  spawnRelicRing(this: EmbervaultEngine, x: number, z: number, color: number, radius: number, life = 0.4): void {
    if (this.bgSim) return;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 32), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.24, z);
    this.scene.add(ring);
    this.slashArcs.push({ mesh: ring, life: 0, maxLife: life, isCleave: false, isShockwave: true, targetScale: radius / 0.62 });
  },

  /** Per-hero, per-frame timers for the batch 2 uniques (called from updateHeroFrame for the current actor). */
  tickRelicEffects(this: EmbervaultEngine, dt: number): void {
    const h = this.hero;
    if (h.inTown || h.isDead) return;

    // Temporary buffs: tick down and re-fold into relicStats when the active set changes
    h.selfieLeft = Math.max(0, h.selfieLeft - dt);
    if (h.plunder) {
      h.plunder.left -= dt;
      if (h.plunder.left <= 0) h.plunder = null;
    }
    h.fishCd = Math.max(0, h.fishCd - dt);
    h.phoneOffLeft = Math.max(0, h.phoneOffLeft - dt);
    const buffKey = `${h.selfieLeft > 0 ? 1 : 0}|${h.plunder?.type ?? ''}`;
    if (buffKey !== h.buffKey) {
      h.buffKey = buffKey;
      h.recomputeRelicStats(false);
    }

    // Low-battery phone: shuts down for 1 s every 30 s (attacks are blocked in performAttack)
    if (h.hasUnique('low_battery_mode')) {
      h.phoneCycle += dt;
      if (h.phoneCycle >= 30) {
        h.phoneCycle = 0;
        h.phoneOffLeft = 1;
        this.emitFloatingText(h.x, 2.2, h.z, '沒電了…', 'relicYellow');
      }
    } else {
      h.phoneCycle = 0;
    }

    // Ember Lantern: every 8 s a ring of embers burns nearby enemies and slows their attacks for 3 s
    if (h.hasUnique('ember_lantern_pulse')) {
      h.lanternPulseTimer -= dt;
      if (h.lanternPulseTimer <= 0) {
        h.lanternPulseTimer = 8;
        const dmg = Math.max(6, Math.round(0.3 * (30 + this.depth * 1.5) * h.getAtkMult()));
        this.spawnRelicRing(h.x, h.z, 0xff8a3d, 4.6, 0.5);
        this.emitFloatingText(h.x, 2.3, h.z, '餘燼護佑', 'relicOrange');
        for (const e of this.enemies) {
          if (e.dead || e.bossWarpUntargetable) continue;
          if (Math.hypot(e.x - h.x, e.z - h.z) > 4.6) continue;
          e.atkSlowTimer = 3;
          this.applyBonusEnemyDamage(e, dmg, `燼火 -${dmg}`, 'relicOrange', 0xff8a3d);
        }
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          this.spawnParticle(h.x + Math.cos(a) * 0.5, 0.5, h.z + Math.sin(a) * 0.5, Math.cos(a) * 5, 0.9 + Math.random(), Math.sin(a) * 5, i % 2 ? 0xffd24a : 0xff6a1f, 1.1, 0.5, 0.6);
        }
      }
    }

    // Third Eye: keep the highest-HP enemy nearby marked (+30% damage, first hit crits)
    if (h.hasUnique('weakness_mark')) {
      if (h.markLeft > 0) {
        h.markLeft -= dt;
        const target = this.enemies.find((e) => e.id === h.markId);
        if (!target || target.dead || h.markLeft <= 0) this.clearWeaknessMark(h);
        else if (h.markMesh) h.markMesh.rotation.y += dt * 3;
      }
      if (h.markLeft <= 0) {
        let best: EnemyEntity | null = null;
        for (const e of this.enemies) {
          if (e.dead || e.bossWarpUntargetable) continue;
          if (Math.hypot(e.x - h.x, e.z - h.z) > 9) continue;
          if (!best || e.hp > best.hp) best = e;
        }
        if (best) {
          h.markId = best.id;
          h.markLeft = 6;
          h.markCritPending = true;
          if (!this.bgSim) {
            const mark = new THREE.Group();
            const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0xff3b5c }));
            const ring = new THREE.Mesh(
              new THREE.TorusGeometry(0.3, 0.025, 6, 20),
              new THREE.MeshBasicMaterial({ color: 0xffd1dc })
            );
            ring.rotation.x = Math.PI / 2;
            mark.add(gem, ring);
            mark.position.y = best.isBoss ? 3.8 : best.isElite ? 2.7 : 2.3;
            best.rig.root.add(mark);
            h.markMesh = mark;
          }
          this.emitFloatingText(best.x, best.isBoss ? 3.0 : 2.4, best.z, '弱點標記', 'crit');
        }
      }
    } else if (h.markLeft > 0 || h.markMesh) {
      this.clearWeaknessMark(h);
    }

    // Slow per-frame fade of the courier ghosts is handled by the shared slashArcs animation
  },

  clearWeaknessMark(this: EmbervaultEngine, h: Hero): void {
    h.markLeft = 0;
    h.markId = null;
    h.markCritPending = false;
    if (h.markMesh) {
      h.markMesh.parent?.remove(h.markMesh);
      h.markMesh.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
      h.markMesh = null;
    }
  },

  /** Kill hooks (current actor is the killer): Selfie Stick, Aura Thief and the courier 4pc tip bag. */
  onRelicKill(this: EmbervaultEngine, enemy: EnemyEntity): void {
    const h = this.hero;
    if (h.markId === enemy.id) this.clearWeaknessMark(h);

    // Selfie Stick: 10 kills within 10 s -> donation shower + 5 s of +20% attack
    if (h.hasUnique('livestream_donation')) {
      h.killTimes.push(this.elapsed);
      h.killTimes = h.killTimes.filter((t) => this.elapsed - t <= 10);
      if (h.killTimes.length >= 10) {
        h.killTimes = [];
        h.selfieLeft = 5;
        this.emitFloatingText(h.x, 2.4, h.z, '感謝乾爹斗內！', 'gold');
        for (let i = 0; i < 6; i++) {
          this.spawnLoot(h.x + (Math.random() - 0.5) * 1.6, h.z + (Math.random() - 0.5) * 1.6, 'gold');
        }
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          this.spawnParticle(h.x, 1.0, h.z, Math.cos(a) * 3.4, 2 + Math.random() * 2, Math.sin(a) * 3.4, i % 2 ? 0xffe066 : 0xff7ad9, 1.0, 0.6, 3);
        }
      }
    }

    // Aura Thief: a named elite's aura is stolen for 20 s (+15% of the matching stat)
    if (enemy.aura && h.hasUnique('aura_plunder')) {
      const def = ENEMY_AURA_DEFS[enemy.aura];
      h.plunder = { type: enemy.aura, left: 20 };
      h.recomputeRelicStats(false);
      h.buffKey = `${h.selfieLeft > 0 ? 1 : 0}|${enemy.aura}`;
      this.emitFloatingText(h.x, 2.4, h.z, `掠奪光環：${def.label}`, 'relicOrange');
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.spawnParticle(enemy.x, 1.0, enemy.z, -Math.cos(a) * 3, 1 + Math.random() * 2, -Math.sin(a) * 3, def.color, 1.0, 0.6, 1);
      }
    }

    // Courier 4pc: every 20 kills a customer tips a bag of coins
    if (h.hasSet4pc('courier')) {
      h.courierKills += 1;
      if (h.courierKills >= 20) {
        h.courierKills = 0;
        this.emitFloatingText(h.x, 2.2, h.z, '客人給的小費！', 'gold');
        for (let i = 0; i < 5; i++) {
          this.spawnLoot(enemy.x + (Math.random() - 0.5) * 1.2, enemy.z + (Math.random() - 0.5) * 1.2, 'gold');
        }
      }
    }
  },

  /**
   * Dash hook (warrior / hunter dash and mage blink): Alien Remote channel surf and the courier 4pc bike afterimage.
   * (x0, z0) -> (x1, z1) is the path covered by the dash; the hero's current position is used as the centre of the surf.
   */
  onRelicDash(this: EmbervaultEngine, x0: number, z0: number, x1: number, z1: number): void {
    const h = this.hero;
    if (h.hasUnique('channel_surf') && Math.random() < 0.2) {
      this.emitFloatingText(h.x, 2.3, h.z, '切台！', 'relicOrange');
      this.spawnRelicRing(h.x, h.z, 0x9fe8ff, 4, 0.4);
      for (const e of this.enemies) {
        if (e.dead || e.bossWarpUntargetable) continue;
        if (Math.hypot(e.x - h.x, e.z - h.z) > 4) continue;
        e.stunTimer = Math.max(e.stunTimer, 1);
        for (let i = 0; i < 8; i++) {
          this.spawnParticle(
            e.x + (Math.random() - 0.5) * 0.8,
            0.4 + Math.random() * 1.2,
            e.z + (Math.random() - 0.5) * 0.8,
            0,
            0.2,
            0,
            [0xffffff, 0x8aa0ff, 0xff6bd0, 0x6bffe8][i % 4],
            0.7,
            0.5,
            0
          );
        }
      }
    }

    if (h.hasSet4pc('courier')) {
      const sx = x1 - x0;
      const sz = z1 - z0;
      const len2 = sx * sx + sz * sz || 1;
      const dmg = Math.max(4, Math.round(13.5 * h.getAtkMult() * 0.4));
      for (const e of this.enemies) {
        if (e.dead || e.bossWarpUntargetable) continue;
        const t = Math.max(0, Math.min(1, ((e.x - x0) * sx + (e.z - z0) * sz) / len2));
        const px = x0 + sx * t;
        const pz = z0 + sz * t;
        const d = Math.hypot(e.x - px, e.z - pz);
        if (d > 1.6) continue;
        const nx = d > 0.01 ? (e.x - px) / d : sz / Math.sqrt(len2);
        const nz = d > 0.01 ? (e.z - pz) / d : -sx / Math.sqrt(len2);
        const push = e.isBoss ? 1.8 : 7;
        e.vx += nx * push;
        e.vz += nz * push;
        this.applyBonusEnemyDamage(e, dmg, `急件 -${dmg}`, 'gold', 0xffe066);
      }
      if (!this.bgSim) {
        // Delivery-bike afterimage left at the start of the dash (flat additive boxes fading like a shockwave)
        const yaw = Math.atan2(sx, sz);
        const parts: Array<[number, number, number, number, number, number, number]> = [
          [0.45, 0.5, 1.4, 0, 0.4, 0, 0x7cf24a],
          [0.75, 0.6, 0.7, 0, 0.95, -0.35, 0xffe066],
        ];
        for (const [w, hh, d, ox, oy, oz, color] of parts) {
          const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
          const ghost = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
          ghost.position.set(x0 + sx * 0.5 + Math.sin(yaw) * oz + Math.cos(yaw) * ox, oy, z0 + sz * 0.5 + Math.cos(yaw) * oz - Math.sin(yaw) * ox);
          ghost.rotation.y = yaw;
          this.scene.add(ghost);
          this.slashArcs.push({ mesh: ghost, life: 0, maxLife: 0.55, isCleave: false, isShockwave: true, targetScale: 1.05 });
        }
      }
      for (let i = 0; i < 10; i++) {
        this.spawnParticle(x0 + sx * Math.random(), 0.4, z0 + sz * Math.random(), 0, 0.8 + Math.random(), 0, i % 2 ? 0x7cf24a : 0xffe066, 0.9, 0.4, 0);
      }
    }
  },

  /** Buff chips shown next to the HUD (Selfie Stick, stolen aura, phone shutdown). */
  getRelicBuffs(this: EmbervaultEngine, h: Hero): RelicBuffHud[] {
    const out: RelicBuffHud[] = [];
    if (h.selfieLeft > 0) out.push({ id: 'selfie', label: '乾爹斗內 攻擊 +20%', left: h.selfieLeft, css: '#ffe066' });
    if (h.plunder && h.plunder.left > 0) {
      const def = ENEMY_AURA_DEFS[h.plunder.type];
      out.push({ id: 'plunder', label: `掠奪光環：${def.label} +15%`, left: h.plunder.left, css: def.css });
    }
    if (h.phoneOffLeft > 0) out.push({ id: 'phone', label: '手機關機中', left: h.phoneOffLeft, css: '#9aa3b8' });
    return out;
  },
};
