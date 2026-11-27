import type { EmbervaultEngine } from '../engine';
import * as THREE from 'three';

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
};
