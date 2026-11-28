import type { EmbervaultEngine } from '../engine';
import { ACT_POMMEL } from '../../../shared/game';
import { FROST_MAGE, HUNTER, PET_NAMES, PET_SPECIES_LIST, getHunterPetMaxHp } from '../classes';
import { hasLineOfSight } from '../dungeon';
import { EnemyEntity, PetEntity } from './entities';
import { PetRig, createHunterArrowMesh, createHunterPetModel, createIceSpikeMesh } from '../models';
import * as THREE from 'three';

export const classSkillsMethods = {
  /** Frost Mage basic attack: fires one ice spike along heroFacing (3-shot cycle, never resets). */
  performMageAttack(this: EmbervaultEngine): void {
    if (this.hero.attackCooldown > 0) return;
    const shotIdx = this.hero.mageShotIndex;
    const empowered = shotIdx === 2;
    this.hero.mageShotIndex = (this.hero.mageShotIndex + 1) % 3;
    this.hero.attackCooldown = FROST_MAGE.shotCooldown[shotIdx];
    this.hero.attackAnim = empowered ? 0.3 : 0.22;
    this.audio.playIceCast(empowered);

    const dirX = Math.sin(this.hero.facing);
    const dirZ = Math.cos(this.hero.facing);
    this.spawnIceSpike(this.hero.x + dirX * 0.55, this.hero.z + dirZ * 0.55, dirX, dirZ, shotIdx);

    // Muzzle frost sparkle at the staff tip
    for (let i = 0; i < (empowered ? 10 : 5); i++) {
      this.spawnParticle(
        this.hero.x + dirX * 0.7,
        1.05,
        this.hero.z + dirZ * 0.7,
        dirX * 2 + (Math.random() - 0.5) * 1.6,
        0.6 + Math.random(),
        dirZ * 2 + (Math.random() - 0.5) * 1.6,
        i % 2 === 0 ? 0xbff4ff : empowered ? 0xffe066 : 0x7fdcff,
        0.8,
        0.28,
        1.5
      );
    }
  },

  spawnIceSpike(this: EmbervaultEngine, x: number, z: number, dirX: number, dirZ: number, shotIdx: number): void {
    const empowered = shotIdx === 2;
    const mesh = createIceSpikeMesh(empowered);
    mesh.position.set(x, 0.85, z);
    mesh.rotation.y = Math.atan2(dirX, dirZ);
    this.dynamicGroup.add(mesh);
    this.heroProjectiles.push({
      mesh,
      x,
      z,
      vx: dirX * FROST_MAGE.projectileSpeed,
      vz: dirZ * FROST_MAGE.projectileSpeed,
      traveled: 0,
      shotIdx,
      phantomCrit: this.hero.phantomCritTimer > 0,
      ownerId: this.hero.id,
    });
    this.hero.phantomCritTimer = 0;
  },

  /** Hunter basic attack: fast single-target arrow along heroFacing (no 3-hit cycle). */
  performHunterAttack(this: EmbervaultEngine): void {
    if (this.hero.attackCooldown > 0) return;
    this.hero.attackCooldown = this.hero.getHunterShotCooldown();
    this.hero.attackAnim = 0.18;
    this.audio.playBowShot();

    const dirX = Math.sin(this.hero.facing);
    const dirZ = Math.cos(this.hero.facing);
    const x = this.hero.x + dirX * 0.55;
    const z = this.hero.z + dirZ * 0.55;
    // Unique: Amazon Queen Moon Bow (Hunter) — every 5th arrow is a piercing moonlight arrow (+60% damage)
    this.hero.moonArrowCount += 1;
    const moon = this.hero.hasUnique('moon_arrow_volley') && this.hero.moonArrowCount % 5 === 0;
    const mesh = createHunterArrowMesh();
    mesh.position.set(x, 0.88, z);
    mesh.rotation.y = Math.atan2(dirX, dirZ);
    if (moon) {
      mesh.scale.setScalar(1.6);
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color?.setHex(0xbfd8ff);
          if (mat.emissive) mat.emissive.setHex(0x6a9cff);
          m.material = mat;
        }
      });
    }
    this.dynamicGroup.add(mesh);
    this.heroProjectiles.push({
      moon,
      pierced: moon ? new Set<number>() : undefined,
      mesh,
      x,
      z,
      vx: dirX * HUNTER.projectileSpeed,
      vz: dirZ * HUNTER.projectileSpeed,
      traveled: 0,
      shotIdx: -1,
      phantomCrit: this.hero.phantomCritTimer > 0,
      ownerId: this.hero.id,
    });
    this.hero.phantomCritTimer = 0;
  },

  hitHunterArrow(
    this: EmbervaultEngine,
    x: number,
    z: number,
    target: EnemyEntity | null,
    phantomCrit = false,
    dmgMult = 1
  ): void {
    for (let i = 0; i < (target ? 7 : 5); i++) {
      this.spawnParticle(
        x,
        0.85,
        z,
        (Math.random() - 0.5) * 3.2,
        1.0 + Math.random() * 1.4,
        (Math.random() - 0.5) * 3.2,
        i % 2 === 0 ? 0xff7b47 : 0xffd54f,
        0.65,
        0.26,
        5.5
      );
    }
    if (!target || target.dead || target.bossWarpUntargetable) return;
    // Guest client only has puppet enemies; real damage is computed by host.
    if (this.mpGuestDungeon()) return;

    this.hero.hunterHitCount += 1;
    const isThunderHit = this.hero.hunterHitCount % HUNTER.thunderEveryNHits === 0;
    const atkMult = this.hero.getAtkMult();
    const critChance = Math.min(
      0.95,
      HUNTER.baseCritChance +
        this.hero.critUpgrades * (HUNTER.critPerUpgradePct / 100) +
        this.hero.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100 + (phantomCrit ? 0.25 : 0);
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;
    const effMaxHp = this.hero.getEffectiveMaxHp();
    const warriorBase = 11 + Math.floor(Math.random() * 6);
    const hitState = { consumedPhantom: false, triggeredStorm: false };

    this.applyHeroHit(target, {
      baseDmg: Math.max(1, Math.round(warriorBase * HUNTER.shotDamageMult * dmgMult)),
      isEmpowered: isThunderHit,
      atkMult,
      critChance,
      critMult,
      knockMult,
      knockBase: 1.9,
      originX: x,
      originZ: z,
      fallbackX: Math.sin(this.hero.facing),
      fallbackZ: Math.cos(this.hero.facing),
      usePhantomCrit: phantomCrit,
      effMaxHp,
      state: hitState,
      hitColor: 0xff7b47,
    });
    this.audio.playHit(false);
    this.emitHud();
  },

  /** Hunter right-click skill (CD 7s): summon a random pet if none alive, else buff (+20% atk/spd/def for 5s) + heal 50%. */
  performHunterPetSkill(this: EmbervaultEngine): void {
    if (this.hero.pommelCooldown > 0 || this.hero.isDead || this.inTown) return;
    if (this.mpGuestDungeon()) {
      this.mpQueueAction(ACT_POMMEL);
      this.hero.pommelCooldown = this.hero.pommelMaxCooldown;
      this.hero.pommelAnim = 0.26;
      return;
    }
    this.hero.pommelCooldown = this.hero.pommelMaxCooldown;
    this.hero.pommelAnim = 0.28;

    const existing = this.pets.get(this.hero.id);
    if (existing && existing.hp > 0) {
      // Buff + 50% heal
      const healAmt = Math.round(existing.maxHp * HUNTER.petHealFraction);
      const actualHeal = Math.min(healAmt, existing.maxHp - existing.hp);
      existing.hp = Math.min(existing.maxHp, existing.hp + healAmt);
      existing.buffTimer = HUNTER.petBuffDuration;
      this.audio.playUpgrade();
      this.emitFloatingText(
        existing.x,
        2.0,
        existing.z,
        `★ ${existing.name} 狂野激勵 +${Math.round(actualHeal)} HP`,
        'heal'
      );
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.spawnParticle(
          existing.x + Math.cos(a) * 0.45,
          0.6,
          existing.z + Math.sin(a) * 0.45,
          Math.cos(a) * 2.2,
          1.8 + Math.random() * 1.4,
          Math.sin(a) * 2.2,
          i % 2 === 0 ? 0xff9f43 : 0x52ffa8,
          0.95,
          0.45,
          2.0
        );
      }
    } else {
      // Summon a brand-new random pet beside the Hunter
      if (existing) this.dismissPet(this.hero.id);
      if (!this.sharedShadowMap) return;
      const species = PET_SPECIES_LIST[Math.floor(Math.random() * PET_SPECIES_LIST.length)];
      const pool = PET_NAMES[species];
      const name = pool[Math.floor(Math.random() * pool.length)];
      const angle = this.hero.facing + Math.PI * 0.35;
      let sx = this.hero.x + Math.sin(angle) * 1.3;
      let sz = this.hero.z + Math.cos(angle) * 1.3;
      if (!this.canMoveTo(sx, sz, 0.45)) {
        sx = this.hero.x;
        sz = this.hero.z;
      }
      const rig = createHunterPetModel(species, name, this.sharedShadowMap);
      rig.root.position.set(sx, 0, sz);
      this.scene.add(rig.root);
      const maxHp = getHunterPetMaxHp(this.depth);
      const pet: PetEntity = {
        ownerId: this.hero.id,
        species,
        name,
        rig,
        x: sx,
        z: sz,
        vx: 0,
        vz: 0,
        facing: this.hero.facing,
        hp: maxHp,
        maxHp,
        buffTimer: 0,
        attackCooldown: 0.3,
        timeSinceDamaged: 999,
        hitFlash: 0,
        invuln: 0.4,
        walkPhase: 0,
      };
      this.pets.set(this.hero.id, pet);
      this.audio.playUpgrade();
      const speciesLabel = species === 'bear' ? '戰熊' : species === 'chocobo' ? '陸行鳥' : '戰狼';
      this.emitFloatingText(sx, 2.0, sz, `召喚 ${speciesLabel}「${name}」!`, 'relicOrange');
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        this.spawnParticle(
          sx + Math.cos(a) * 0.4,
          0.5,
          sz + Math.sin(a) * 0.4,
          Math.cos(a) * 2.6,
          1.6 + Math.random() * 1.4,
          Math.sin(a) * 2.6,
          i % 2 === 0 ? 0xff7b47 : 0xffd54f,
          1.0,
          0.45,
          3.0
        );
      }
    }
    this.emitHud();
  },

  disposePetRig(this: EmbervaultEngine, rig: PetRig): void {
    this.scene.remove(rig.root);
    rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      } else if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
  },

  dismissPet(this: EmbervaultEngine, ownerId: string): void {
    const pet = this.pets.get(ownerId);
    if (!pet) return;
    this.disposePetRig(pet.rig);
    this.pets.delete(ownerId);
  },

  clearAllPets(this: EmbervaultEngine): void {
    for (const id of Array.from(this.pets.keys())) {
      this.dismissPet(id);
    }
  },

  repositionPetsForNewFloor(this: EmbervaultEngine): void {
    const newMaxHp = getHunterPetMaxHp(this.depth);
    for (const pet of this.pets.values()) {
      const owner = this.heroById(pet.ownerId);
      if (!owner || owner.isDead) {
        this.dismissPet(pet.ownerId);
        continue;
      }
      pet.maxHp = newMaxHp;
      pet.hp = newMaxHp;
      pet.timeSinceDamaged = 999;
      pet.x = owner.x + 0.9;
      pet.z = owner.z + 0.9;
      if (!this.canMoveTo(pet.x, pet.z, 0.45)) {
        pet.x = owner.x;
        pet.z = owner.z;
      }
      pet.vx = 0;
      pet.vz = 0;
      pet.rig.root.position.set(pet.x, 0, pet.z);
    }
  },

  damagePet(
    this: EmbervaultEngine,
    pet: PetEntity,
    rawDamage: number,
    srcX: number,
    srcZ: number,
    invulnOverride?: number
  ): void {
    if (pet.invuln > 0 || pet.hp <= 0) return;
    const defMult = pet.buffTimer > 0 ? HUNTER.petBuffDamageTakenMult : 1;
    const dmg = Math.max(1, Math.round(rawDamage * defMult));
    pet.hp = Math.max(0, pet.hp - dmg);
    pet.timeSinceDamaged = 0;
    pet.hitFlash = 0.16;
    pet.invuln = invulnOverride !== undefined ? invulnOverride : 0.35;

    const dx = pet.x - srcX;
    const dz = pet.z - srcZ;
    const dist = Math.hypot(dx, dz) || 1;
    pet.vx += (dx / dist) * 2.6;
    pet.vz += (dz / dist) * 2.6;

    this.emitFloatingText(pet.x, 1.5, pet.z, `-${dmg}`, 'playerHit');
    if (pet.hp <= 0) {
      this.emitFloatingText(pet.x, 2.0, pet.z, `${pet.name} 倒下了!`, 'playerHit');
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.spawnParticle(
          pet.x,
          0.7,
          pet.z,
          Math.cos(a) * 3.0,
          1.6 + Math.random() * 1.4,
          Math.sin(a) * 3.0,
          0xff7b47,
          0.9,
          0.45,
          4.5
        );
      }
      this.dismissPet(pet.ownerId);
    }
  },

  damagePetsInRadius(this: EmbervaultEngine, cx: number, cz: number, radius: number, rawDamage: number): void {
    for (const pet of Array.from(this.pets.values())) {
      if (pet.hp <= 0) continue;
      const owner = this.heroById(pet.ownerId);
      if (!owner || owner.isDead || owner.inTown) continue;
      if (Math.hypot(pet.x - cx, pet.z - cz) <= radius) {
        this.damagePet(pet, rawDamage, cx, cz);
      }
    }
  },

  updatePets(this: EmbervaultEngine, dt: number): void {
    const prevActor = this.hero;
    for (const [ownerId, pet] of Array.from(this.pets.entries())) {
      const owner = this.heroById(ownerId);
      if (!owner || owner.isDead) {
        this.dismissPet(ownerId);
        continue;
      }
      if (owner.inTown) {
        pet.rig.root.visible = false;
        continue;
      }
      pet.rig.root.visible = !this.inTown;

      pet.hitFlash = Math.max(0, pet.hitFlash - dt);
      pet.invuln = Math.max(0, pet.invuln - dt);
      pet.buffTimer = Math.max(0, pet.buffTimer - dt);
      pet.attackCooldown = Math.max(0, pet.attackCooldown - dt);
      pet.timeSinceDamaged += dt;

      // Out-of-combat automatic regeneration (slow on purpose: the hunter's skill is the main heal)
      if (pet.hp < pet.maxHp && pet.timeSinceDamaged >= HUNTER.petRegenDelay) {
        pet.hp = Math.min(pet.maxHp, pet.hp + (pet.maxHp / HUNTER.petRegenRefill) * dt);
      }

      const buffed = pet.buffTimer > 0;
      const toOwnerX = owner.x - pet.x;
      const toOwnerZ = owner.z - pet.z;
      const ownerDist = Math.hypot(toOwnerX, toOwnerZ);

      let moveX = 0;
      let moveZ = 0;

      // Owner hidden behind a wall for a while (the pet only walks straight lines): warp instead of hugging the wall
      const ownerVisible =
        ownerDist <= 2.0 || hasLineOfSight(this.dungeon, pet.x, pet.z, owner.x, owner.z, this.doorUnlocked, 0.2);
      pet.noLosTimer = ownerVisible ? 0 : (pet.noLosTimer ?? 0) + dt;
      const lostSight = (pet.noLosTimer ?? 0) >= HUNTER.petNoLosWarpSec;

      if (ownerDist > HUNTER.petTeleportDist || lostSight || this.isCompanionTooFar(owner, pet.x, pet.z)) {
        if (lostSight && !this.bgSim) this.spawnPetWarpPuff(pet.x, pet.z);
        pet.noLosTimer = 0;
        // Teleport right next to owner (also once it drifts to the screen edge, e.g. snagged behind a wall)
        pet.x = owner.x + (Math.random() - 0.5) * 0.8;
        pet.z = owner.z + (Math.random() - 0.5) * 0.8;
        if (!this.canMoveTo(pet.x, pet.z, 0.45)) {
          pet.x = owner.x;
          pet.z = owner.z;
        }
        pet.vx = 0;
        pet.vz = 0;
        if (lostSight && !this.bgSim) this.spawnPetWarpPuff(pet.x, pet.z);
      } else if (ownerDist > HUNTER.petLeashReturnDist) {
        // Too far from owner: disengage and rush back
        moveX = (toOwnerX / ownerDist) * HUNTER.petMoveSpeed * 1.25;
        moveZ = (toOwnerZ / ownerDist) * HUNTER.petMoveSpeed * 1.25;
        pet.facing = Math.atan2(toOwnerX, toOwnerZ);
      } else {
        // Seek nearest enemy within aggro range
        let target: EnemyEntity | null = null;
        let bestD: number = HUNTER.petAggroRange;
        for (const e of this.enemies) {
          if (e.dead || e.bossWarpUntargetable) continue;
          const dPet = Math.hypot(e.x - pet.x, e.z - pet.z);
          const dOwner = Math.hypot(e.x - owner.x, e.z - owner.z);
          if (
            dPet < bestD &&
            dOwner < HUNTER.petLeashReturnDist &&
            !this.isCompanionTooFar(owner, e.x, e.z) &&
            hasLineOfSight(this.dungeon, pet.x, pet.z, e.x, e.z, this.doorUnlocked, 0.2)
          ) {
            bestD = dPet;
            target = e;
          }
        }
        if (target) {
          const ex = target.x - pet.x;
          const ez = target.z - pet.z;
          const ed = Math.hypot(ex, ez) || 1;
          pet.facing = Math.atan2(ex, ez);
          const strikeDist = HUNTER.petAttackReach + this.getEnemyHitRadius(target);
          if (ed > strikeDist * 0.78) {
            const spd = HUNTER.petMoveSpeed * (buffed ? 1.15 : 1);
            moveX = (ex / ed) * spd;
            moveZ = (ez / ed) * spd;
          }
          if (ed <= strikeDist && pet.attackCooldown <= 0) {
            pet.attackCooldown = HUNTER.petAttackCooldown / (buffed ? HUNTER.petBuffAtkSpeedMult : 1);
            pet.attackAnim = 0.26;
            const rawBase =
              HUNTER.petDamageMin +
              Math.floor(Math.random() * (HUNTER.petDamageMax - HUNTER.petDamageMin + 1));
            // Moon Bow (Hunter): +20% pet attack while the pet is within 4 of its owner
            const moonPet = owner.hasUnique('moon_arrow_volley') && Math.hypot(pet.x - owner.x, pet.z - owner.z) <= 4 ? 1.2 : 1;
            const dmg = this.scaleEnemyDamageTaken(
              target,
              Math.max(1, Math.round(rawBase * owner.getAtkMult() * moonPet * (buffed ? HUNTER.petBuffAtkMult : 1)))
            );
            target.hp -= dmg;
            target.hitFlash = 0.14;
            const kb = target.isBoss ? 0.6 : target.isElite ? 1.6 : 3.2;
            target.vx += (ex / ed) * kb;
            target.vz += (ez / ed) * kb;
            this.setActor(owner);
            owner.totalDamageDealt += dmg;
            this.emitFloatingText(target.x, 1.5, target.z, `${dmg}`, buffed ? 'crit' : 'damage');
            this.audio.playHit(false);

            // Claw / bite / peck slash arc & impact sparks
            if (!this.bgSim) {
              const slashColor = buffed ? 0xffa638 : pet.species === 'wolf' ? 0xd8f0ff : pet.species === 'chocobo' ? 0xffe46b : 0xffd2a6;
              const arcGeo = new THREE.RingGeometry(0.32, 0.72, 16, 1, -Math.PI * 0.42, Math.PI * 0.84);
              const arcMat = new THREE.MeshBasicMaterial({
                color: slashColor,
                transparent: true,
                opacity: 0.92,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
              });
              const arcMesh = new THREE.Mesh(arcGeo, arcMat);
              arcMesh.position.set(
                (pet.x + target.x) * 0.5,
                0.78,
                (pet.z + target.z) * 0.5
              );
              arcMesh.rotation.order = 'YXZ';
              arcMesh.rotation.y = pet.facing;
              arcMesh.rotation.x = Math.PI / 2 - (pet.species === 'bear' ? 0.45 : 0.2);
              this.scene.add(arcMesh);
              this.slashArcs.push({
                mesh: arcMesh,
                life: 0,
                maxLife: 0.18,
                isCleave: false,
              });
              for (let s = 0; s < 6; s++) {
                const a = pet.facing + (Math.random() - 0.5) * 1.6;
                const spd = 2.2 + Math.random() * 2.8;
                this.spawnParticle(
                  target.x,
                  0.75,
                  target.z,
                  Math.sin(a) * spd,
                  1.2 + Math.random() * 1.8,
                  Math.cos(a) * spd,
                  s % 2 === 0 ? 0xffffff : slashColor,
                  0.8,
                  0.28,
                  5.5
                );
              }
            }

            if (target.hp <= 0) {
              this.killEnemy(target);
            }
          }
        } else if (ownerDist > 2.0) {
          // Follow beside owner
          const spd = HUNTER.petMoveSpeed * Math.min(1.15, ownerDist / 2.6);
          moveX = (toOwnerX / ownerDist) * spd;
          moveZ = (toOwnerZ / ownerDist) * spd;
          pet.facing = Math.atan2(toOwnerX, toOwnerZ);
        }
      }

      const nextPos = this.moveWithSlide(
        pet.x,
        pet.z,
        (moveX + pet.vx) * dt,
        (moveZ + pet.vz) * dt,
        0.42
      );
      pet.x = nextPos.x;
      pet.z = nextPos.z;
      pet.vx *= Math.exp(-9 * dt);
      pet.vz *= Math.exp(-9 * dt);

      this.animatePetRig(pet, Math.hypot(moveX, moveZ), dt);
    }
    this.setActor(prevActor);
  },

  /** Small smoke puff where a pet vanishes / reappears when it warps back to its owner. */
  spawnPetWarpPuff(this: EmbervaultEngine, x: number, z: number): void {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.spawnParticle(x, 0.4, z, Math.cos(a) * 1.6, 0.8 + Math.random() * 0.8, Math.sin(a) * 1.6, 0xd8dde6, 0.7, 0.4, 2.5);
    }
  },

  animatePetRig(this: EmbervaultEngine, pet: PetEntity, moveSpeed: number, dt: number): void {
    pet.rig.root.position.set(pet.x, 0, pet.z);
    pet.rig.body.rotation.y = pet.facing;
    const moving = moveSpeed > 0.25;
    pet.walkPhase += dt * (moving ? 14 : 3.5);
    const swing = moving ? Math.sin(pet.walkPhase) * 0.65 : 0;

    pet.attackAnim = Math.max(0, (pet.attackAnim ?? 0) - dt);
    const atkDur = 0.26;
    const atkFrac = pet.attackAnim > 0 ? 1 - pet.attackAnim / atkDur : 0; // 0 -> 1 over attack
    let lunge = 0;
    let jumpY = 0;
    let pitch = 0;

    if (pet.attackAnim > 0) {
      const wave = Math.sin(atkFrac * Math.PI);
      if (pet.species === 'bear') {
        // Rear up briefly, then heavy paw-slam forward
        if (atkFrac < 0.35) {
          const p = atkFrac / 0.35;
          jumpY = p * 0.22;
          pitch = -p * 0.36;
          lunge = -p * 0.12;
        } else {
          const p = (atkFrac - 0.35) / 0.65;
          const slam = Math.sin(p * Math.PI);
          jumpY = Math.max(0, (1 - p) * 0.18);
          pitch = slam * 0.42;
          lunge = slam * 0.48;
        }
      } else if (pet.species === 'wolf') {
        // Fast horizontal lunge bite
        lunge = wave * 0.58;
        jumpY = wave * 0.18;
        pitch = wave * 0.26;
      } else {
        // Chocobo hop & forward beak peck
        lunge = wave * 0.44;
        jumpY = wave * 0.36;
        pitch = wave * 0.48;
      }
    }

    pet.rig.legs.forEach((leg, idx) => {
      if (pet.attackAnim && pet.attackAnim > 0) {
        const atkSwing = Math.sin(atkFrac * Math.PI) * (pet.species === 'bear' ? 1.1 : 0.85);
        leg.rotation.x = idx < 2 ? -atkSwing : atkSwing * 0.5;
      } else {
        leg.rotation.x = idx % 2 === 0 ? swing : -swing;
      }
    });
    if (pet.rig.tail) {
      pet.rig.tail.rotation.y = Math.sin(pet.walkPhase * 1.2) * (moving || (pet.attackAnim ?? 0) > 0 ? 0.4 : 0.15);
    }
    const baseBob = moving ? Math.abs(Math.sin(pet.walkPhase)) * 0.08 : 0;
    pet.rig.body.position.set(
      Math.sin(pet.facing) * lunge,
      baseBob + jumpY,
      Math.cos(pet.facing) * lunge
    );
    pet.rig.body.rotation.x = pitch;

    const buffed = pet.buffTimer > 0;
    pet.rig.buffRing.visible = buffed;
    if (buffed) {
      pet.rig.buffRing.rotation.z += dt * 2.4;
    }
    for (const m of pet.rig.flashMaterials) {
      if (pet.hitFlash > 0) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.85;
      } else if (buffed) {
        m.emissive.setHex(0xff8c24);
        m.emissiveIntensity = 0.22;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  },

  removeHeroProjectileAt(this: EmbervaultEngine, idx: number): void {
    const p = this.heroProjectiles[idx];
    this.dynamicGroup.remove(p.mesh);
    p.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.heroProjectiles.splice(idx, 1);
  },

  updateHeroProjectiles(this: EmbervaultEngine, dt: number): void {
    for (let i = this.heroProjectiles.length - 1; i >= 0; i--) {
      const p = this.heroProjectiles[i];
      if (p.pid !== undefined) continue; // teammate view: another hero's spike is moved by mpGuestWorld
      // The spike explodes with its owner's stats / relics and credits the kill to them
      const owner = this.heroById(p.ownerId);
      if (!owner) {
        this.removeHeroProjectileAt(i);
        continue;
      }
      this.setActor(owner);
      const speed = Math.hypot(p.vx, p.vz);
      // Sub-step so fast spikes never tunnel through thin enemies or wall corners
      const steps = Math.max(1, Math.ceil((speed * dt) / 0.3));
      const sdt = dt / steps;
      let exploded = false;
      const isArrow = p.shotIdx === -1;
      const hitRad = isArrow ? HUNTER.projectileHitRadius : FROST_MAGE.projectileHitRadius;
      const maxRange = isArrow ? HUNTER.projectileRange : FROST_MAGE.projectileRange;
      for (let s = 0; s < steps && !exploded; s++) {
        const nx = p.x + p.vx * sdt;
        const nz = p.z + p.vz * sdt;
        if (this.isPointInWall(nx, nz)) {
          if (isArrow) this.hitHunterArrow(p.x, p.z, null, p.phantomCrit);
          else this.explodeIceSpike(p.x, p.z, p.shotIdx, p.phantomCrit);
          exploded = true;
          break;
        }
        p.x = nx;
        p.z = nz;
        p.traveled += speed * sdt;

        const hitTargets = this.mpGuestDungeon() && this.mp ? this.mp.guest.enemyList : this.enemies;
        for (const e of hitTargets) {
          if (e.dead || e.bossWarpUntargetable) continue;
          if (Math.hypot(e.x - p.x, e.z - p.z) <= hitRad + this.getEnemyHitRadius(e)) {
            if (isArrow && p.moon) {
              // Moonlight arrow pierces: damages each enemy once and keeps flying
              if (!p.pierced?.has(e.id)) {
                p.pierced?.add(e.id);
                this.hitHunterArrow(p.x, p.z, e, p.phantomCrit, 1.6);
              }
              continue;
            }
            if (isArrow) this.hitHunterArrow(p.x, p.z, e, p.phantomCrit);
            else this.explodeIceSpike(p.x, p.z, p.shotIdx, p.phantomCrit);
            exploded = true;
            break;
          }
        }
        if (exploded) break;
        for (const br of this.breakables) {
          if (br.broken) continue;
          if (Math.hypot(br.x - p.x, br.z - p.z) <= 0.6) {
            if (isArrow) {
              if (!this.mpGuestDungeon()) this.breakProp(br);
              else this.mpGuestPredictBreak(br);
              this.hitHunterArrow(p.x, p.z, null, p.phantomCrit);
            } else {
              this.explodeIceSpike(p.x, p.z, p.shotIdx, p.phantomCrit);
            }
            exploded = true;
            break;
          }
        }
        if (!exploded && p.traveled >= maxRange) {
          if (!isArrow) this.explodeIceSpike(p.x, p.z, p.shotIdx, p.phantomCrit);
          exploded = true;
        }
      }
      if (exploded) {
        this.removeHeroProjectileAt(i);
        continue;
      }
      p.mesh.position.set(p.x, isArrow ? 0.88 : 0.85, p.z);
      if (!isArrow) {
        p.mesh.rotation.z += dt * (p.shotIdx === 2 ? 9 : 5);
        if (Math.random() < (p.shotIdx === 2 ? 0.9 : 0.5)) {
          this.spawnParticle(
            p.x,
            0.85,
            p.z,
            (Math.random() - 0.5) * 0.4,
            0.2 + Math.random() * 0.4,
            (Math.random() - 0.5) * 0.4,
            p.shotIdx === 2 && Math.random() < 0.3 ? 0xffe066 : 0xbff4ff,
            0.6,
            0.24,
            0
          );
        }
      } else if (Math.random() < 0.45) {
        this.spawnParticle(
          p.x,
          0.88,
          p.z,
          (Math.random() - 0.5) * 0.3,
          0.1,
          (Math.random() - 0.5) * 0.3,
          0xff9f43,
          0.45,
          0.18,
          0
        );
      }
    }
    this.setActor(this.localHero);
  },

  explodeIceSpike(this: EmbervaultEngine, x: number, z: number, shotIdx: number, phantomCrit = false): void {
    const empowered = shotIdx === 2;
    const radius = FROST_MAGE.shotExplosionRadius[shotIdx];
    this.audio.playIceShatter(empowered);

    // Expanding frost ring on the floor
    const ringMat = new THREE.MeshBasicMaterial({
      color: empowered ? 0xbff4ff : 0x8fe3ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 28), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.2, z);
    this.scene.add(ring);
    this.slashArcs.push({
      mesh: ring,
      life: 0,
      maxLife: empowered ? 0.3 : 0.2,
      isCleave: false,
      isShockwave: true,
      targetScale: radius / 0.62,
    });
    for (let i = 0; i < (empowered ? 18 : 9); i++) {
      const a = (i / (empowered ? 18 : 9)) * Math.PI * 2;
      const spd = (empowered ? 4.2 : 2.6) + Math.random() * 1.6;
      this.spawnParticle(
        x,
        0.75,
        z,
        Math.cos(a) * spd,
        1.4 + Math.random() * 1.8,
        Math.sin(a) * spd,
        i % 3 === 0 ? 0xffffff : empowered && i % 4 === 1 ? 0xffe066 : 0x9fe8ff,
        empowered ? 1.0 : 0.8,
        0.4,
        6.5
      );
    }

    const atkMult = this.hero.getAtkMult();
    const usePhantomCrit = phantomCrit;
    const hitState = { consumedPhantom: false, triggeredStorm: false };
    const critChance = Math.min(
      0.95,
      FROST_MAGE.shotBaseCrit[shotIdx] + this.hero.critUpgrades * 0.02 + this.hero.relicStats.critPct / 100
    );
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100 + (usePhantomCrit ? 0.25 : 0);
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;
    const effMaxHp = this.hero.getEffectiveMaxHp();
    let landedHit = false;

    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.bossWarpUntargetable) continue;
      const d = Math.hypot(enemy.x - x, enemy.z - z);
      if (d > radius + this.getEnemyHitRadius(enemy)) continue;
      // Walls block the blast
      if (d > 0.6 && !hasLineOfSight(this.dungeon, x, z, enemy.x, enemy.z, this.doorUnlocked, 0.05)) continue;
      const warriorBase = 11 + Math.floor(Math.random() * 6);
      this.applyHeroHit(enemy, {
        baseDmg: Math.max(1, Math.round(warriorBase * FROST_MAGE.shotDamageMult[shotIdx])),
        isEmpowered: empowered,
        atkMult,
        critChance,
        critMult,
        knockMult,
        knockBase: empowered ? 3.6 : 1.8,
        originX: x,
        originZ: z,
        fallbackX: Math.sin(this.hero.facing),
        fallbackZ: Math.cos(this.hero.facing),
        usePhantomCrit,
        effMaxHp,
        state: hitState,
        hitColor: 0xbff4ff,
        isMageHit: true,
      });
      landedHit = true;
      if (!enemy.dead && Math.random() < FROST_MAGE.shotSlowChance[shotIdx]) {
        this.applySlow(enemy);
      }
    }
    for (const br of this.breakables) {
      if (br.broken) continue;
      const bd = Math.hypot(br.x - x, br.z - z);
      if (
        bd <= radius + 0.35 &&
        (bd <= 0.8 || hasLineOfSight(this.dungeon, x, z, br.x, br.z, this.doorUnlocked, 0.05))
      ) {
        this.breakProp(br);
        landedHit = true;
      }
    }

    if (landedHit) {
      if (!this.isSilentActor() && !this.mp) this.hitStopTimer = Math.max(this.hitStopTimer, empowered ? 0.045 : 0.02);
      this.addScreenShake(empowered ? 0.2 : 0.08, 0.1);
    }
  },

  /** Frost Mage right-click: screen-wide expanding ice nova — freeze, damage, push. */
  performFrostNova(this: EmbervaultEngine): void {
    if (this.hero.isDead || this.hero.pommelCooldown > 0) return;
    // Unique: Frost Whisperer Staff — Frost Nova cooldown -15%
    this.hero.pommelCooldown = this.hero.pommelMaxCooldown * (this.hero.hasUnique('frost_shard_resonance') ? 0.85 : 1);
    this.hero.attackAnim = 0.34;
    this.hero.attackCooldown = Math.max(this.hero.attackCooldown, 0.3);
    this.audio.playFrostNova();
    this.addScreenShake(0.32, 0.28);

    const rings: Array<[number, number, number, number]> = [
      // [inner, outer, maxLife, color]
      // Thin rings: they scale ~19x to reach the nova radius, so keep them narrow
      [0.64, 0.7, 0.55, 0x8fe3ff],
      [0.6, 0.64, 0.42, 0xdff8ff],
      [0.67, 0.7, 0.68, 0xffe066],
    ];
    for (const [inner, outer, life, color] of rings) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(this.hero.x, 0.24, this.hero.z);
      this.scene.add(mesh);
      this.slashArcs.push({
        mesh,
        life: 0,
        maxLife: life,
        isCleave: false,
        isShockwave: true,
        targetScale: FROST_MAGE.novaRadius / outer,
      });
    }
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const spd = 8 + Math.random() * 6;
      this.spawnParticle(
        this.hero.x + Math.cos(a) * 0.5,
        0.4 + Math.random() * 0.6,
        this.hero.z + Math.sin(a) * 0.5,
        Math.cos(a) * spd,
        0.8 + Math.random() * 1.6,
        Math.sin(a) * spd,
        i % 5 === 0 ? 0xffe066 : i % 2 === 0 ? 0xffffff : 0x9fe8ff,
        1.1,
        0.7,
        1.0
      );
    }

    const atkMult = this.hero.getAtkMult();
    const critChance = Math.min(0.95, 0.08 + this.hero.critUpgrades * 0.02 + this.hero.relicStats.critPct / 100);
    const critMult = 1.35 + this.hero.relicStats.critDmgPct / 100;
    const knockMult = 1 + this.hero.relicStats.dramaticKnockback / 100;
    let landedHit = false;

    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.bossWarpUntargetable) continue;
      const dx = enemy.x - this.hero.x;
      const dz = enemy.z - this.hero.z;
      const dist = Math.hypot(dx, dz);
      if (dist > FROST_MAGE.novaRadius + this.getEnemyHitRadius(enemy)) continue;

      const base = (11 + Math.floor(Math.random() * 6)) * FROST_MAGE.novaDamageMult;
      const isCrit = Math.random() < critChance;
      let mult = atkMult * (isCrit ? critMult : 1);
      if (enemy.isBoss || enemy.isElite) mult *= 1 + this.hero.relicStats.eliteBossDmgPct / 100;
      if (this.hero.hasUnique('executioner_finisher') && enemy.hp / Math.max(1, enemy.maxHp) < 0.3) {
        mult *= enemy.isBoss ? 1.25 : 1.5;
      }
      const dmg = this.scaleEnemyDamageTaken(enemy, Math.max(1, Math.round(base * mult)));
      this.hero.totalDamageDealt += dmg;
      if (isCrit) this.hero.critCount += 1;
      this.hero.ai.lastCombatDamageTime = this.elapsed;
      enemy.hp -= dmg;
      enemy.hitFlash = 0.18;

      if (!enemy.isBoss) {
        const nx = dist > 0.01 ? dx / dist : Math.sin(this.hero.facing);
        const nz = dist > 0.01 ? dz / dist : Math.cos(this.hero.facing);
        const knock = FROST_MAGE.novaKnockback * knockMult * (enemy.isElite ? 0.45 : 1);
        enemy.vx += nx * knock;
        enemy.vz += nz * knock;
      }
      this.applyFreeze(enemy, FROST_MAGE.novaFreeze);
      this.emitFloatingText(
        enemy.x,
        enemy.isBoss ? 2.45 : enemy.isElite ? 2.15 : 1.65,
        enemy.z,
        isCrit ? `冰封 CRIT -${dmg}` : `冰封 -${dmg}`,
        isCrit ? 'crit' : 'frost'
      );
      for (let i = 0; i < 6; i++) {
        this.spawnParticle(
          enemy.x,
          enemy.isBoss ? 1.3 : 0.85,
          enemy.z,
          (Math.random() - 0.5) * 3.6,
          1.4 + Math.random() * 1.8,
          (Math.random() - 0.5) * 3.6,
          i % 2 === 0 ? 0xbff4ff : 0xffffff,
          0.9,
          0.4,
          6
        );
      }
      landedHit = true;
      if (enemy.hp <= 0) this.killEnemy(enemy);
    }

    for (const br of this.breakables) {
      if (br.broken) continue;
      if (
        Math.hypot(br.x - this.hero.x, br.z - this.hero.z) <= FROST_MAGE.novaRadius &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, br.x, br.z, this.doorUnlocked, 0.05)
      ) {
        this.breakProp(br);
      }
    }
    if (landedHit && !this.isSilentActor() && !this.mp) this.hitStopTimer = 0.05;
    this.emitHud();
  },

  /** Phoenix Plume fire ring at a point (shared by Dash and Blink). */
  triggerPhoenixRingAt(this: EmbervaultEngine, x: number, z: number): void {
    const fireDmg = Math.max(8, Math.round(14 * (1 + this.hero.atkUpgrades * 0.1 + this.hero.relicStats.atkPct / 100)));
    for (const e of this.enemies) {
      if (e.dead || e.bossWarpUntargetable) continue;
      const edx = e.x - x;
      const edz = e.z - z;
      const edist = Math.hypot(edx, edz);
      if (edist <= 3.4) {
        const push = e.isBoss ? 1.8 : 6.0;
        e.vx += (edx / (edist || 1)) * push;
        e.vz += (edz / (edist || 1)) * push;
        this.applyBonusEnemyDamage(e, fireDmg, `鳳焰 -${fireDmg}`, 'relicOrange', 0xff6224);
      }
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      this.spawnParticle(
        x + Math.cos(a) * 0.35,
        0.55,
        z + Math.sin(a) * 0.35,
        Math.cos(a) * 5.2,
        1.1 + Math.random() * 1.4,
        Math.sin(a) * 5.2,
        i % 2 === 0 ? 0xff5a1f : 0xffd24a,
        1.2,
        0.45,
        1.5
      );
    }
  },

  /** Frost Mage mobility: instant short teleport along the move direction (or facing). */
  performBlink(this: EmbervaultEngine, dirOverride?: { x: number; z: number }): void {
    if (this.hero.dashCooldown > 0 || this.hero.dashTimer > 0) return;
    // Direction priority: explicit (AI) > current move input (manual) > facing
    let dirX = Math.sin(this.hero.facing);
    let dirZ = Math.cos(this.hero.facing);
    if (dirOverride) {
      dirX = dirOverride.x;
      dirZ = dirOverride.z;
    } else if (this.hero.controlMode === 'manual' && Math.hypot(this.hero.input.moveX, this.hero.input.moveZ) > 0.1) {
      dirX = this.hero.input.moveX;
      dirZ = this.hero.input.moveZ;
    }
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len;
    dirZ /= len;

    const startX = this.hero.x;
    const startZ = this.hero.z;
    let endX = startX;
    let endZ = startZ;
    const stepLen = 0.2;
    for (let d = stepLen; d <= FROST_MAGE.blinkDistance + 1e-6; d += stepLen) {
      const tx = startX + dirX * d;
      const tz = startZ + dirZ * d;
      if (!this.canMoveTo(tx, tz, 0.4)) break; // stop in front of walls (enemies don't block)
      endX = tx;
      endZ = tz;
    }

    this.hero.dashCooldown = Math.max(0.35, 1.1 * (1 - this.hero.relicStats.dashCdPct / 100));
    this.hero.invuln = Math.max(this.hero.invuln, 0.28);
    if (this.hero.hasUnique('phantom_dash_crit')) this.hero.phantomCritTimer = 2.0;
    this.audio.playBlink();

    const burst = (bx: number, bz: number, outward: boolean) => {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const spd = outward ? 2.6 : -1.2;
        this.spawnParticle(
          bx + Math.cos(a) * 0.3,
          0.3 + Math.random() * 1.0,
          bz + Math.sin(a) * 0.3,
          Math.cos(a) * spd,
          0.8 + Math.random() * 1.2,
          Math.sin(a) * spd,
          i % 4 === 0 ? 0xffe066 : i % 2 === 0 ? 0xffffff : 0x9fe8ff,
          1.0,
          0.42,
          -0.4
        );
      }
    };
    burst(startX, startZ, false);
    if (this.hero.hasUnique('phoenix_dash_nova')) this.triggerPhoenixRingAt(startX, startZ);

    this.hero.x = endX;
    this.hero.z = endZ;
    this.hero.vx = 0;
    this.hero.vz = 0;
    this.hero.facing = Math.atan2(dirX, dirZ);
    this.hero.rig.root.position.set(this.hero.x, 0, this.hero.z);
    burst(endX, endZ, true);
    if (this.hero.hasUnique('phoenix_dash_nova')) this.triggerPhoenixRingAt(endX, endZ);
    this.onRelicDash(startX, startZ, endX, endZ);
    this.emitHud();
  },
};
