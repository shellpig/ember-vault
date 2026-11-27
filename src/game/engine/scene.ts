import type { EmbervaultEngine } from '../engine';
import { q100 } from '../../../shared/game';
import { AnimatedLightProp, WallOcclusionTile } from './entities';
import { _mat4, _pos, _quat, _scale, _upAxis } from './scratch';
import { createHeroModel, createHeroSetAura } from '../models';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const sceneMethods = {
  detectSoftwareGl(this: EmbervaultEngine): boolean {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  },

  initRenderer(this: EmbervaultEngine): void {
    this.isSoftwareGl = this.detectSoftwareGl();

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      this.callbacks.onWebGLError('WebGL is unavailable in this browser context.');
      return;
    }

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);
  },

  initScene(this: EmbervaultEngine): void {
    if (!this.renderer) return;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060b);
    this.scene.fog = new THREE.Fog(0x05060b, 32, 54);

    // Mandatory Studio Environment Reflection for metallic glints (very subtle so unlit stone stays truly dark)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.07;
    pmrem.dispose();

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // Tight FOV isometric miniature perspective (tilt-shift tabletop diorama feel)
    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.5, 110);

    // Very low ambient fill so areas away from torches & rune circles fall into deep shadow
    this.hemiLight = new THREE.HemisphereLight(0x3a4f78, 0x120b07, 0.12);
    this.scene.add(this.hemiLight);

    this.rimLight = new THREE.DirectionalLight(0x6c8cc4, 0.09);
    this.rimLight.position.set(-12, 22, -10);
    if (!this.isSoftwareGl) {
      this.rimLight.castShadow = true;
      this.rimLight.shadow.mapSize.set(1024, 1024);
      const d = 16;
      this.rimLight.shadow.camera.left = -d;
      this.rimLight.shadow.camera.right = d;
      this.rimLight.shadow.camera.top = d;
      this.rimLight.shadow.camera.bottom = -d;
      this.rimLight.shadow.camera.near = 2;
      this.rimLight.shadow.camera.far = 48;
      this.rimLight.shadow.bias = -0.0006;
      this.rimLight.shadow.normalBias = 0.03;
    }
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    // Persistent soft radial contact shadow texture for hero & enemies
    const sc = document.createElement('canvas');
    sc.width = 64;
    sc.height = 64;
    const sctx = sc.getContext('2d')!;
    const sgrad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    sgrad.addColorStop(0, 'rgba(0,0,0,0.65)');
    sgrad.addColorStop(0.62, 'rgba(0,0,0,0.28)');
    sgrad.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = sgrad;
    sctx.fillRect(0, 0, 64, 64);
    this.sharedShadowMap = new THREE.CanvasTexture(sc);

    // Hero & bright flickering handheld Lantern light
    this.hero.rig = createHeroModel(this.sharedShadowMap);
    this.hero.setAura = createHeroSetAura();
    this.hero.rig.root.add(this.hero.setAura.group);
    this.scene.add(this.hero.rig.root);

    this.heroLight = new THREE.PointLight(0xffaa44, 56, 11.2, 2.05);
    this.heroLight.position.set(0, 1.85, 0);
    if (!this.isSoftwareGl) {
      this.heroLight.castShadow = true;
      this.heroLight.shadow.mapSize.set(1024, 1024);
      this.heroLight.shadow.camera.near = 0.3;
      this.heroLight.shadow.camera.far = 12;
      this.heroLight.shadow.bias = -0.0025;
      this.heroLight.shadow.normalBias = 0.04;
    }
    this.scene.add(this.heroLight);

    // Subtle additive warm floor glow tightly hugging the hero's lantern without washing out brick detail
    const hgc = document.createElement('canvas');
    hgc.width = 64;
    hgc.height = 64;
    const hgctx = hgc.getContext('2d')!;
    const hgg = hgctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    hgg.addColorStop(0, 'rgba(255,186,92,0.44)');
    hgg.addColorStop(0.42, 'rgba(255,142,48,0.14)');
    hgg.addColorStop(1, 'rgba(255,120,30,0)');
    hgctx.fillStyle = hgg;
    hgctx.fillRect(0, 0, 64, 64);
    const heroGlowTex = new THREE.CanvasTexture(hgc);
    heroGlowTex.colorSpace = THREE.SRGBColorSpace;
    this.heroFloorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({
        map: heroGlowTex,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    this.heroFloorGlow.rotation.x = -Math.PI / 2;
    this.heroFloorGlow.position.y = 0.022;
    this.scene.add(this.heroFloorGlow);

    // Fast fixed pool of 8 dynamic PointLights for nearest scene torches, braziers & magic rune circles
    for (let i = 0; i < 8; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 10, 2.05);
      pl.position.set(0, -10, 0);
      this.scene.add(pl);
      this.propLightPool.push(pl);
    }

    this.scene.add(this.levelGroup);
    this.scene.add(this.dynamicGroup);
    this.scene.add(this.debrisGroup);
    this.townGroup.visible = false;
    this.scene.add(this.townGroup);
  },

  initParticlePool(this: EmbervaultEngine): void {
    const poolSize = 140;
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffb84d,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        active: false,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        gravity: 0,
        baseScale: 1,
        shrink: true,
      });
    }
  },

  spawnParticle(
    this: EmbervaultEngine,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    scale: number,
    maxLife: number,
    gravity = 0
  ): void {
    if (this.bgSim) return; // the background dungeon is not on screen
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.mesh.visible = true;
        p.mesh.position.set(x, y, z);
        p.mesh.scale.setScalar(scale);
        const mat = p.mesh.material as THREE.MeshBasicMaterial;
        mat.color.setHex(colorHex);
        mat.opacity = 1;
        p.vx = vx;
        p.vy = vy;
        p.vz = vz;
        p.life = 0;
        p.maxLife = maxLife;
        p.gravity = gravity;
        p.baseScale = scale;
        p.shrink = true;
        return;
      }
    }
  },

  disposeGroupContents(this: EmbervaultEngine, group: THREE.Group): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      } else if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  },

  adjustZoom(this: EmbervaultEngine, delta: number): void {
    this.camZoom = THREE.MathUtils.clamp(this.camZoom + delta, 0.72, 1.35);
  },

  addScreenShake(this: EmbervaultEngine, magnitude: number, duration: number): void {
    if (this.mp?.role === 'host' && this.hero.isRemote) this.mpEmit(['k', q100(magnitude), q100(duration), this.hero.id]);
    if (this.bgSim || this.isSilentActor()) return; // only the local player feels the shake
    this.shakeMag = Math.max(this.shakeMag, magnitude);
    this.shakeTime = Math.max(this.shakeTime, duration);
  },

  /** The parts of updateEnvironment that change the game (not the looks): rune wells and spike traps. */
  updateEnvironmentBackground(this: EmbervaultEngine): void {
    for (const lp of this.lightProps) {
      if (lp.kind === 'rune' && !lp.used) this.tryRuneDrink(lp);
    }
    for (const sp of this.spikes) {
      const cycle = (this.elapsed + sp.phaseOffset) % 3.6;
      if (cycle > 2.35 && cycle <= 3.15) {
        this.forEachLiveHero(() => {
          if (Math.hypot(this.hero.x - sp.x, this.hero.z - sp.z) < 0.72) {
            this.damageHero(6 * this.getDepthDamageScale(), sp.x, sp.z, '尖刺陷阱');
          }
        });
      }
    }
  },

  updateEnvironment(this: EmbervaultEngine, dt: number): void {
    // Animate props and collect active light candidates sorted by proximity to hero
    const activeLights: Array<{ prop: AnimatedLightProp; dist: number; intensity: number }> = [];

    const maxLightDist = this.inTown ? 30 : 22;
    for (const lp of this.lightProps) {
      const dist = Math.hypot(lp.x - this.hero.x, lp.z - this.hero.z);
      if (lp.kind === 'key' && this.hasKey) continue;
      if (lp.kind === 'gate' && this.doorUnlocked) continue;
      if (lp.kind === 'chest' && lp.used) continue; // an opened treasure chest stops glowing
      if (dist > maxLightDist) continue;

      let intensity = lp.baseIntensity;

      if (lp.kind === 'brazier' || lp.kind === 'torch') {
        const f =
          Math.sin(this.elapsed * 12.5 + lp.phase) * 3.0 +
          Math.cos(this.elapsed * 23.1 + lp.phase * 1.7) * 1.8;
        intensity = lp.baseIntensity + f;
        if (lp.flame) {
          lp.flame.scale.set(1 + f * 0.025, 1 + f * 0.045, 1 + f * 0.025);
          lp.flame.rotation.y += dt * 3.0;
        }
        if (lp.kind === 'brazier' && Math.random() < dt * 4.5) {
          this.spawnParticle(
            lp.x + (Math.random() - 0.5) * 0.3,
            1.1,
            lp.z + (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.4,
            1.2 + Math.random() * 1.1,
            (Math.random() - 0.5) * 0.4,
            lp.color,
            0.75,
            0.9,
            -0.2
          );
        }
      } else if (lp.kind === 'rune') {
        const pulse = Math.sin(this.elapsed * 3.0 + lp.phase) * 4.0;
        intensity = lp.used
          ? lp.baseIntensity * 0.5 + pulse * 0.5
          : lp.baseIntensity + pulse;
        if (lp.crystal) {
          lp.crystal.visible = !lp.used;
          if (!lp.used) {
            lp.crystal.rotation.y += dt * 1.6;
            lp.crystal.position.y = 0.78 + Math.sin(this.elapsed * 2.6 + lp.phase) * 0.14;
          }
        }
        if (lp.decal) {
          lp.decal.rotation.z += dt * (lp.used ? 0.16 : 0.35);
        }
        if (lp.halo) {
          lp.halo.visible = !lp.used;
          if (!lp.used) {
            const hs = 1.12 + Math.sin(this.elapsed * 3.0 + lp.phase) * 0.16;
            lp.halo.scale.set(hs, hs, 1);
            if (lp.crystal) lp.halo.position.y = lp.crystal.position.y;
          }
        }
        // Gently rising cool arcane sparks from the magic circle
        if (Math.random() < dt * (lp.used ? 1.1 : 4.2)) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.3 + Math.random() * 0.9;
          this.spawnParticle(
            lp.x + Math.cos(a) * r,
            0.12,
            lp.z + Math.sin(a) * r,
            0,
            1.1 + Math.random() * 0.9,
            0,
            lp.color,
            lp.used ? 0.48 : 0.68,
            0.95,
            -0.15
          );
        }
        if (this.mp?.role !== 'guest') this.tryRuneDrink(lp);
      } else if (lp.kind === 'stash') {
        intensity = lp.baseIntensity + Math.sin(this.elapsed * 2.2 + lp.phase) * 3.5;
        if (lp.halo) {
          const hs = 2.6 + Math.sin(this.elapsed * 2.2 + lp.phase) * 0.22;
          lp.halo.scale.set(hs, hs, 1);
        }
        if (lp.decal) lp.decal.rotation.z += dt * 0.25;
        if (this.hero.stashOpen && this.stashRig) {
          this.stashRig.lid.rotation.x = THREE.MathUtils.lerp(this.stashRig.lid.rotation.x, -1.15, Math.min(1, dt * 8));
        } else if (this.stashRig) {
          this.stashRig.lid.rotation.x = THREE.MathUtils.lerp(this.stashRig.lid.rotation.x, 0, Math.min(1, dt * 8));
        }
      } else if (lp.kind === 'altar' || lp.kind === 'shop') {
        const isShop = lp.kind === 'shop';
        const pulse = Math.sin(this.elapsed * 2.8 + lp.phase) * 4.5;
        intensity = lp.baseIntensity + pulse;
        if (lp.crystal) {
          lp.crystal.rotation.y += dt * (isShop ? 1.65 : 1.45);
          lp.crystal.position.y = (isShop ? 1.38 : 1.32) + Math.sin(this.elapsed * 2.4 + lp.phase) * 0.1;
        }
        if (lp.decal) {
          lp.decal.rotation.z -= dt * 0.45;
        }
        if (lp.halo) {
          const hs = (isShop ? 1.36 : 1.42) + Math.sin(this.elapsed * 2.8 + lp.phase) * 0.15;
          lp.halo.scale.set(hs, hs, 1);
          if (lp.crystal) lp.halo.position.y = lp.crystal.position.y;
        }
        if (Math.random() < dt * 4.2) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.28 + Math.random() * 0.65;
          this.spawnParticle(
            lp.x + Math.cos(a) * r,
            0.25,
            lp.z + Math.sin(a) * r,
            0,
            1.15 + Math.random() * 0.85,
            0,
            isShop ? 0xff6b8b : 0xffd966,
            0.66,
            0.95,
            -0.18
          );
        }
      } else {
        intensity = lp.baseIntensity + Math.sin(this.elapsed * 3.5 + lp.phase) * 3.5;
      }

      // Slightly prioritize altars, potion shops, portals, angel, arcane rune circles, and key pedestals
      const priorityBias =
        lp.kind === 'altar' ||
        lp.kind === 'shop' ||
        lp.kind === 'angel' ||
        lp.kind === 'portal' ||
        lp.kind === 'stash' ||
        lp.kind === 'chest'
          ? -4.5
          : lp.kind === 'rune' || lp.kind === 'key' || lp.kind === 'stairs'
          ? -3.5
          : 0;
      activeLights.push({ prop: lp, dist: dist + priorityBias, intensity });
    }

    activeLights.sort((a, b) => a.dist - b.dist);

    // Assign top 8 nearest active light sources into the fast pooled PointLights
    for (let i = 0; i < this.propLightPool.length; i++) {
      const pl = this.propLightPool[i];
      const item = activeLights[i];
      if (item) {
        pl.color.setHex(item.prop.color);
        pl.intensity = item.intensity;
        pl.distance = item.prop.distance;
        pl.decay = item.prop.decay;
        pl.position.set(item.prop.x, item.prop.y, item.prop.z);
      } else {
        pl.intensity = 0;
      }
    }

    // Animate Sanctuary Town White-Robed Angel
    if (this.angelRig) {
      this.angelRig.body.position.y = Math.sin(this.elapsed * 2.1) * 0.08;
      const wingFlutter = Math.sin(this.elapsed * 2.6) * 0.16;
      this.angelRig.leftWing.rotation.y = -0.24 + wingFlutter;
      this.angelRig.rightWing.rotation.y = 0.24 - wingFlutter;
      this.angelRig.haloRing.position.y = 2.08 + Math.sin(this.elapsed * 3.0) * 0.05;
      this.angelRig.lightOrb.rotation.y += dt * 1.9;
      this.angelRig.lightOrb.rotation.x += dt * 1.1;
      this.angelRig.auraPool.rotation.z += dt * 0.55;
      const hs = 2.15 + Math.sin(this.elapsed * 2.4) * 0.18;
      this.angelRig.haloSprite.scale.set(hs, hs, 1);

      if (this.angelPos && Math.random() < dt * 3.8) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.35 + Math.random() * 0.65;
        this.spawnParticle(
          this.angelPos.x + Math.cos(a) * r,
          0.35,
          this.angelPos.z + Math.sin(a) * r,
          0,
          1.0 + Math.random() * 0.85,
          0,
          Math.random() < 0.5 ? 0xfff0a8 : 0xffffff,
          0.62,
          1.15,
          -0.12
        );
      }
    }

    this.animateHeroPortal(dt);

    // Periodic Spike Traps
    for (const sp of this.spikes) {
      const cycle = (this.elapsed + sp.phaseOffset + this.mpSpikeClock()) % 3.6;
      const isWarning = cycle > 1.8 && cycle <= 2.35;
      const isUp = cycle > 2.35 && cycle <= 3.15;
      sp.extended = isUp;

      const targetY = isUp ? 0.04 : -0.46;
      sp.rig.spikesGroup.position.y = THREE.MathUtils.damp(
        sp.rig.spikesGroup.position.y,
        targetY,
        18,
        dt
      );
      sp.rig.warningMat.emissiveIntensity = isWarning ? 1.1 : isUp ? 1.5 : 0.15;

      if (isUp && !this.mpGuestDungeon()) {
        this.forEachLiveHero(() => {
          if (Math.hypot(this.hero.x - sp.x, this.hero.z - sp.z) < 0.72) {
            this.damageHero(6 * this.getDepthDamageScale(), sp.x, sp.z, '尖刺陷阱');
          }
        });
      }
    }
  },

  getBreakableDebrisColor(this: EmbervaultEngine, kind: 'crate' | 'urn'): number {
    const theme = this.dungeon.biome.terrainTheme;
    if (theme === 'alien') return 0x70d8ff;
    if (theme === 'cavern') return kind === 'crate' ? 0x5e4d3c : 0x62cc94;
    if (theme === 'flesh') return kind === 'crate' ? 0xb5448c : 0xd9bfd0;
    return kind === 'crate' ? 0x7c502d : 0xb38252;
  },

  updateWallOcclusion(this: EmbervaultEngine): void {
    if (this.wallTiles.length === 0 || this.capOpaqueMeshes.length === 0 || this.capFadeMeshes.length === 0) return;

    // 1. Check with slight hysteresis whether any foreground wall is currently blocking the hero
    let hasBlocker = false;
    const fwdMin = this.wallOcclusionActive ? 0.05 : 0.2;
    const fwdMax = this.wallOcclusionActive ? 4.0 : 3.65;
    const sideMax = this.wallOcclusionActive ? 2.15 : 1.88;

    for (let i = 0; i < this.wallTiles.length; i++) {
      const t = this.wallTiles[i];
      const dx = t.wx - this.hero.x;
      const dz = t.wz - this.hero.z;
      const fwd = (dx + dz) * 0.70710678;
      if (fwd <= fwdMin || fwd >= fwdMax) continue;
      const side = Math.abs(dx - dz) * 0.70710678;
      if (side < sideMax) {
        hasBlocker = true;
        break;
      }
    }
    this.wallOcclusionActive = hasBlocker;

    // 2. When occluded, ALWAYS fade the nearest 4 foreground wall tiles (with slight distance hysteresis to prevent wobble)
    const desiredOccluded = new Set<WallOcclusionTile>();
    if (hasBlocker) {
      const candidates: Array<{ tile: WallOcclusionTile; score: number }> = [];
      for (let i = 0; i < this.wallTiles.length; i++) {
        const t = this.wallTiles[i];
        const dx = t.wx - this.hero.x;
        const dz = t.wz - this.hero.z;
        const fwd = (dx + dz) * 0.70710678;
        if (fwd <= -0.35 || fwd >= 6.4) continue;
        const side = Math.abs(dx - dz) * 0.70710678;
        if (side >= 5.0) continue;
        // Stickiness bonus (-0.28) keeps the 4-tile window steady while walking
        const score = Math.hypot(dx, dz) - (t.occluded ? 0.28 : 0);
        candidates.push({ tile: t, score });
      }
      candidates.sort((a, b) => a.score - b.score);
      const count = Math.min(4, candidates.length);
      for (let i = 0; i < count; i++) {
        desiredOccluded.add(candidates[i].tile);
      }
    }

    let changed = false;
    for (let i = 0; i < this.wallTiles.length; i++) {
      const t = this.wallTiles[i];
      const shouldOcclude = desiredOccluded.has(t);
      if (shouldOcclude !== t.occluded) {
        t.occluded = shouldOcclude;
        changed = true;

        const opaqueWall = this.wallOpaqueMeshes[t.bucketIdx];
        const opaqueCap = this.capOpaqueMeshes[t.capBucketIdx];
        if (shouldOcclude) {
          _pos.set(t.wx, -100, t.wz);
          _quat.identity();
          _scale.set(0, 0, 0);
          _mat4.compose(_pos, _quat, _scale);
          opaqueWall.setMatrixAt(t.wallInstIdx, _mat4);
          opaqueCap.setMatrixAt(t.capInstIdx, _mat4);
        } else {
          _pos.set(t.wx, this.wallHeight / 2, t.wz);
          _quat.setFromAxisAngle(_upAxis, t.rotY);
          _scale.set(1, 1, 1);
          _mat4.compose(_pos, _quat, _scale);
          opaqueWall.setMatrixAt(t.wallInstIdx, _mat4);

          _pos.set(t.wx, this.wallHeight, t.wz);
          _quat.setFromAxisAngle(_upAxis, t.capRotY);
          _mat4.compose(_pos, _quat, _scale);
          opaqueCap.setMatrixAt(t.capInstIdx, _mat4);
        }
        opaqueWall.instanceMatrix.needsUpdate = true;
        opaqueCap.instanceMatrix.needsUpdate = true;
      }
    }

    if (!changed) return;

    // Collect currently occluded wall tiles and sort front-to-back so depthWrite avoids double-blending
    const occludedList: WallOcclusionTile[] = [];
    for (let i = 0; i < this.wallTiles.length; i++) {
      if (this.wallTiles[i].occluded) occludedList.push(this.wallTiles[i]);
    }
    occludedList.sort((a, b) => b.gx + b.gz - (a.gx + a.gz));

    const bucketCounts = new Array<number>(this.wallFadeMeshes.length).fill(0);
    const capBucketCounts = new Array<number>(this.capFadeMeshes.length).fill(0);

    for (let i = 0; i < occludedList.length; i++) {
      const t = occludedList[i];
      const fadeWall = this.wallFadeMeshes[t.bucketIdx];
      const maxWall = fadeWall.instanceMatrix.count;

      if (bucketCounts[t.bucketIdx] < maxWall) {
        _pos.set(t.wx, this.wallHeight / 2, t.wz);
        _quat.setFromAxisAngle(_upAxis, t.rotY);
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        fadeWall.setMatrixAt(bucketCounts[t.bucketIdx]++, _mat4);
      }

      const fadeCap = this.capFadeMeshes[t.capBucketIdx];
      const maxCap = fadeCap.instanceMatrix.count;
      if (capBucketCounts[t.capBucketIdx] < maxCap) {
        _pos.set(t.wx, this.wallHeight, t.wz);
        _quat.setFromAxisAngle(_upAxis, t.capRotY);
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        fadeCap.setMatrixAt(capBucketCounts[t.capBucketIdx]++, _mat4);
      }
    }

    for (let c = 0; c < this.capFadeMeshes.length; c++) {
      this.capFadeMeshes[c].count = capBucketCounts[c];
      this.capFadeMeshes[c].instanceMatrix.needsUpdate = true;
    }

    for (let b = 0; b < this.wallFadeMeshes.length; b++) {
      this.wallFadeMeshes[b].count = bucketCounts[b];
      this.wallFadeMeshes[b].instanceMatrix.needsUpdate = true;
    }
  },

  updateParticles(this: EmbervaultEngine, dt: number): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0.05, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;
      const t = p.life / p.maxLife;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - t;
      if (p.shrink) {
        p.mesh.scale.setScalar(p.baseScale * (1 - t * 0.65));
      }
    }

    for (let i = this.slashArcs.length - 1; i >= 0; i--) {
      const s = this.slashArcs[i];
      s.life += dt;
      const t = s.life / s.maxLife;
      if (t >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.slashArcs.splice(i, 1);
        continue;
      }
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      if (s.isShockwave) {
        const easeOut = 1 - Math.pow(1 - t, 2.2);
        mat.opacity = (1 - t) * 0.88;
        s.mesh.scale.setScalar(0.8 + easeOut * ((s.targetScale ?? 4.2) - 0.8));
      } else {
        mat.opacity = (1 - t) * 0.9;
        s.mesh.scale.setScalar(1 + t * (s.isCleave ? 0.35 : 0.22));
        s.mesh.rotation.z += dt * (s.isCleave ? 12 : 8);
      }
    }
  },

  afterDraw(this: EmbervaultEngine, cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  },
};
