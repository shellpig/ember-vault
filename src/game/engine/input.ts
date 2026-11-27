import type { EmbervaultEngine } from '../engine';
import * as THREE from 'three';
import { ACT_ATTACK } from '../../../shared/game';
import { FROST_MAGE, HUNTER } from '../classes';
import { hasLineOfSight } from '../dungeon';
import type { EnemyEntity } from './entities';

/** Auto-attack toggle (all platforms): remembered per browser. */
const AUTO_ATTACK_STORAGE_KEY = 'embervault.autoAttack.v1';
/** Warrior slash reach used by auto-attack (heroCombat performAttack: 2.25, cleave 2.55). */
const AUTO_ATTACK_MELEE_REACH = 2.25;
/** Touch joystick dead zone (0..1 of the stick radius). */
const TOUCH_DEAD_ZONE = 0.28;
const TOUCH_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const;

/** Phones / tablets: no hover and a coarse pointer (touch-screen laptops with a mouse count as desktop). */
export function isTouchPrimaryDevice(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export const inputMethods = {
  bindEvents(this: EmbervaultEngine): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.renderer?.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer?.domElement.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('blur', this.handleWindowBlur);
    this.renderer?.domElement.addEventListener('contextmenu', this.handleContextMenu);
    this.renderer?.domElement.addEventListener('wheel', this.handleWheel, { passive: true });
    this.renderer?.domElement.addEventListener('webglcontextlost', this.handleContextLost);
  },

  activateManualMode(this: EmbervaultEngine): void {
    if (!this.audio.isEnabled()) {
      this.audio.unlockAndEnable();
    }
    this.hero.controlMode = 'manual';
    this.emitHud();
  },

  setInputLocked(this: EmbervaultEngine, locked: boolean): void {
    this.inputLocked = locked;
    if (locked) {
      this.hero.input.keys.clear();
      this.hero.input.leftMouseHeld = false;
    }
  },

  /** Turns the hero toward the cursor. Returns false if the cursor can't be projected. */
  faceCursor(this: EmbervaultEngine): boolean {
    if (this.hero.isRemote) {
      // A remote teammate on the host has no cursor here: its client reports the facing it aimed at
      this.hero.facing = this.hero.input.aimFacing;
      this.hero.rig.body.rotation.y = this.hero.facing;
      return true;
    }
    const target = this.screenToGround(this.hero.input.pointerClientX, this.hero.input.pointerClientY);
    if (!target) return false;
    const ax = target.x - this.hero.x;
    const az = target.z - this.hero.z;
    if (Math.hypot(ax, az) < 0.05) return true;
    this.hero.facing = Math.atan2(ax, az);
    this.hero.rig.body.rotation.y = this.hero.facing;
    return true;
  },

  /** While the left mouse button is held in manual mode: face the cursor and attack whenever ready. */
  updateHeldAttack(this: EmbervaultEngine): void {
    if (!this.hero.input.leftMouseHeld) return;
    if (this.hero.isDead || this.inTown || this.hero.controlMode !== 'manual' || this.transitionState !== 'none') {
      return;
    }
    this.faceCursor();
    if (this.hero.attackCooldown <= 0) this.performAttack();
  },

  // Public UI Control Methods
  triggerPommelStrike(this: EmbervaultEngine): void {
    if (this.hero.isDead) return;
    if (!this.audio.isEnabled()) {
      this.audio.unlockAndEnable();
    }
    this.performPommelStrike();
  },

  toggleSound(this: EmbervaultEngine): boolean {
    const on = this.audio.toggle();
    this.emitHud();
    return on;
  },

  setControlMode(this: EmbervaultEngine, mode: 'auto' | 'manual'): void {
    if (this.mp?.role === 'guest' && mode === 'auto') return; // a teammate's hero is always steered by its player
    this.hero.controlMode = mode;
    this.hero.ai.path = [];
    this.hero.ai.combatPath = [];
    this.hero.ai.unstuckPath = [];
    this.hero.ai.unstuckTimer = 0;
    this.hero.ai.noProgressTimer = 0;
    this.hero.ai.unstuckAttempts = 0;
    this.hero.ai.progressAnchorX = this.hero.x;
    this.hero.ai.progressAnchorZ = this.hero.z;
    this.emitHud();
  },

  triggerManualPotion(this: EmbervaultEngine): void {
    if (this.hero.isDead) return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.usePotion();
  },

  triggerNewDungeon(this: EmbervaultEngine): void {
    if (this.mp || this.hero.isDead || this.inTown || this.transitionState !== 'none') return;
    if (!this.audio.isEnabled()) this.audio.unlockAndEnable();
    this.audio.playDescend();
    this.beginTransition(() => {
      this.buildLevel(this.depth + 1, { tickBuffFloor: true });
    });
  },

  triggerSkipFloorCheat(this: EmbervaultEngine): void {
    if (this.mp || this.hero.isDead || this.inTown || this.transitionState !== 'none') return;
    if (this.audio.isEnabled()) {
      this.audio.playDescend();
    }
    const nextDepth = this.depth + 1;
    const bonusGold = nextDepth * 100;
    this.beginTransition(() => {
      this.hero.gold += bonusGold;
      this.hero.totalGoldEarned += bonusGold;
      this.buildLevel(nextDepth, { tickBuffFloor: true });
      this.emitFloatingText(this.hero.x, 2.0, this.hero.z, `+${bonusGold} G`, 'gold');
    });
  },

  /** Projects a screen point onto the ground plane (y = 0.85, ice spike height). */
  screenToGround(this: EmbervaultEngine, clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.camera || !this.renderer) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.85);
    const hitPoint = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hitPoint)) return null;
    return { x: hitPoint.x, z: hitPoint.z };
  },

  /** Reads the remembered auto-attack setting (default: on for touch devices, off for desktop). */
  loadAutoAttackSetting(this: EmbervaultEngine): void {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(AUTO_ATTACK_STORAGE_KEY);
    } catch {
      saved = null;
    }
    this.autoAttackEnabled = saved === null ? isTouchPrimaryDevice() : saved === '1';
  },

  setAutoAttack(this: EmbervaultEngine, enabled: boolean): void {
    this.autoAttackEnabled = enabled;
    try {
      window.localStorage.setItem(AUTO_ATTACK_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // storage unavailable: keep it for this session only
    }
    this.emitHud();
  },

  /**
   * Auto-attack (manual mode only): when an enemy is inside the class's attack range (ranged classes also need line of
   * sight), turn to the nearest one and swing / shoot. Never casts the skill, dashes or drinks. A held left mouse
   * button (manual aim) takes precedence.
   */
  updateAutoAttack(this: EmbervaultEngine): void {
    if (!this.autoAttackEnabled || this.hero !== this.localHero) return;
    const h = this.hero;
    if (h.isDead || this.inTown || h.controlMode !== 'manual' || this.transitionState !== 'none') return;
    if (this.inputLocked || h.input.leftMouseHeld || h.attackCooldown > 0) return;
    const ranged = h.isRangedClass();
    const range = h.isHunter() ? HUNTER.projectileRange : h.isMage() ? FROST_MAGE.projectileRange : AUTO_ATTACK_MELEE_REACH;
    let best: EnemyEntity | null = null;
    let bestDist = Infinity;
    for (const e of this.viewEnemies()) {
      if (e.dead || e.bossWarpUntargetable) continue;
      const d = Math.hypot(e.x - h.x, e.z - h.z);
      if (d > range + this.getEnemyHitRadius(e) || d >= bestDist) continue;
      if (ranged && !hasLineOfSight(this.dungeon, h.x, h.z, e.x, e.z, this.doorUnlocked, 0.2)) continue;
      best = e;
      bestDist = d;
    }
    if (!best) return;
    h.facing = Math.atan2(best.x - h.x, best.z - h.z);
    h.rig.body.rotation.y = h.facing;
    if (this.mpGuestDungeon()) this.mpQueueAction(ACT_ATTACK);
    this.performAttack();
  },

  /**
   * Touch joystick: `x` right, `y` up, both -1..1 (screen space). Mapped onto the WASD keys (8 directions) so movement,
   * multiplayer input and prediction behave exactly like the keyboard.
   */
  setTouchMove(this: EmbervaultEngine, x: number, y: number): void {
    const keys = this.localHero.input.keys;
    for (const k of TOUCH_KEYS) if (this.touchKeys.has(k)) keys.delete(k);
    this.touchKeys.clear();
    const mag = Math.hypot(x, y);
    if (mag < TOUCH_DEAD_ZONE || this.inputLocked || this.localHero.isDead) return;
    const oct = Math.round(Math.atan2(y, x) / (Math.PI / 4)); // 0 = right, 2 = up, 4/-4 = left, -2 = down
    const want: string[] = [];
    if (oct === 0 || oct === 1 || oct === -1) want.push('KeyD');
    if (oct === 4 || oct === -4 || oct === 3 || oct === -3) want.push('KeyA');
    if (oct === 2 || oct === 1 || oct === 3) want.push('KeyW');
    if (oct === -2 || oct === -1 || oct === -3) want.push('KeyS');
    for (const k of want) {
      keys.add(k);
      this.touchKeys.add(k);
    }
    if (!this.inTown) this.activateManualMode();
  },

  /** Touch button: class mobility skill (same as Shift / Space). */
  touchDash(this: EmbervaultEngine): void {
    if (this.localHero.isDead || this.inputLocked || this.hero !== this.localHero) return;
    if (!this.inTown) this.activateManualMode();
    this.performDash();
  },
};
