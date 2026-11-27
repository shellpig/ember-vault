import type { EmbervaultEngine } from '../engine';
import { TILE_SIZE, generateDungeon, gridToWorld, worldToGrid } from '../dungeon';
import { BOSS_CONFIGS, getBossForDepth } from './data';
import { SavedDungeonSnapshot } from './entities';
import type { TreasureRoomData } from '../types';
import { _camTarget, _color, _mat4, _pos, _quat, _scale } from './scratch';
import { createAmbientDecorProp, createBrazier, createCrateProp, createKeyPedestal, createLockedGate, createPotionShop, createRuneWell, createSpikeTrap, createStairwell, createUpgradeAltar, createWallCapGeometries, createWallTorch } from '../models';
import { createDungeonTextures } from '../textures';
import * as THREE from 'three';

export const levelBuildMethods = {
  /**
   * Throws away the dungeon level the engine currently holds (its fields must be the active ones): scene groups,
   * textures, entities and the per-level bits of every hero's AI. The town is untouched (see clearTown).
   */
  clearLevel(this: EmbervaultEngine): void {
    this.clearBossVfx();
    this.disposeGroupContents(this.levelGroup);
    this.disposeGroupContents(this.dynamicGroup);
    this.disposeGroupContents(this.debrisGroup);

    if (this.textures) {
      this.textures.dispose();
      this.textures = null;
    }
    if (this.extraTextures.length > 0) {
      this.extraTextures.forEach((t) => t.dispose());
      this.extraTextures = [];
    }

    this.enemies = [];
    this.projectiles = [];
    this.heroProjectiles = [];
    this.loots = [];
    this.breakables = [];
    this.lightProps = [];
    this.spikes = [];
    this.keyPedestal = null;
    this.altarRig = null;
    this.shopRig = null;
    this.gateRig = null;
    this.gateOpenProgress = 0;
    this.heroPortalRigs = new Map();
    this.treasureRigs = [];
    this.wallOpaqueMeshes = [];
    this.wallFadeMeshes = [];
    this.capOpaqueMeshes = [];
    this.capFadeMeshes = [];
    this.wallTiles = [];
    this.wallOcclusionActive = false;
    for (const h of this.heroes) {
      h.ai.path = [];
      h.ai.combatPath = [];
      h.ai.stuckTimer = 0;
      h.ai.stuckCount = 0;
      h.ai.noProgressTimer = 0;
      h.ai.unstuckTimer = 0;
      h.ai.unstuckPath = [];
      h.ai.currentTargetId = null;
      h.ai.unstuckAttempts = 0;
      h.ai.skipEnemyUntil.clear();
      h.ai.lastCombatDamageTime = -10;
      h.ai.upgradeCooldown = 0;
    }
  },

  buildLevel(
    this: EmbervaultEngine,
    depth: number,
    options?: {
      savedSnapshot?: SavedDungeonSnapshot;
      tickBuffFloor?: boolean;
      mpSeed?: number;
      guest?: boolean;
      /** Teammate client: the host's treasure room of this floor (`level` payload), adopted instead of rolling one. */
      mpTreasure?: TreasureRoomData;
    }
  ): void {
    // `bg`: a floor change that happens while the local hero is in town (a teammate took the stairs). The dungeon's
    // fields are swapped in for it, and nothing may touch the screen, the camera or the local hero.
    const bg = this.bgSim;
    if (!bg) this.leaveTownScene();
    this.clearLevel();
    this.inTown = false;
    this.depth = depth;
    // maxDepth only moves for heroes that actually stand in the dungeon (a local hero in town reaches the new floor
    // later, see enterDungeonFromTown). Raising it is a save point; restoring a frozen floor is not.
    let localDepthRaised = false;
    for (const h of this.heroes) {
      if (h.inTown || this.devDepthRun || depth <= h.maxDepthReached) continue;
      h.maxDepthReached = depth;
      if (h === this.localHero) localDepthRaised = true;
    }
    // (the 'floor' save is requested below, after the treasure room roll: that roll moves the pity counter that is saved)
    const saveFloor = !bg && (!options?.savedSnapshot || localDepthRaised);

    let buffExpired = false;
    for (const h of this.heroes) {
      if (h.inTown) continue;
      if (options?.tickBuffFloor && h.angelBuff) {
        h.angelBuff.floorsLeft -= 1;
        if (h.angelBuff.floorsLeft <= 0) {
          h.angelBuff = null;
          h.recomputeRelicStats(true);
          if (h === this.hero) buffExpired = true;
        }
      }
    }

    const snap = options?.savedSnapshot;
    if (snap) {
      this.hasKey = snap.hasKey;
      this.doorUnlocked = snap.doorUnlocked;
      this.localHero.chronosUsedThisFloor = snap.chronosUsedThisFloor;
      this.localHero.floorKills = snap.floorKills;
      this.dungeon = snap.dungeon;
    } else {
      this.hasKey = false;
      this.doorUnlocked = false;
      for (const h of this.heroes) {
        h.chronosUsedThisFloor = false;
        h.floorKills = 0;
      }
      // Room game teammates build the host's floor from its seed (everything static comes out of this generator)
      this.dungeon = generateDungeon(depth, options?.mpSeed);
      // Treasure room: the host / single player rolls it (and moves the pity counter); a teammate adopts the host's result
      if (options?.guest) this.adoptTreasureRoom(options.mpTreasure);
      else this.rollTreasureRoom();
    }
    if (saveFloor) this.requestSave('floor');
    const biome = this.dungeon.biome;

    // Update scene atmosphere to match biome (bright blue-silver sci-fi lighting for Alien Starship Deck!)
    if (!bg) this.applyDungeonAtmosphere();

    this.textures = createDungeonTextures(
      biome,
      this.renderer.capabilities.getMaxAnisotropy(),
      depth * 997 + 13
    );

    const { width, height, tiles } = this.dungeon;

    // Count tiles for InstancedMesh batching
    const floorCoords: Array<[number, number]> = [];
    const wallCoords: Array<[number, number]> = [];
    const pillarCoords: Array<[number, number]> = [];

    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const t = tiles[gz][gx];
        if (t === 1 || t === 3 || t === 5 || t === 6) {
          floorCoords.push([gx, gz]);
        }
        if (t === 2) {
          wallCoords.push([gx, gz]);
        }
        if (t === 5) {
          pillarCoords.push([gx, gz]);
        }
      }
    }

    // 1. Instanced Terrain Floors (Dungeon Flagstone / Cavern Rock / Organic Tissue)
    const theme = biome.terrainTheme;
    const upAxis = new THREE.Vector3(0, 1, 0);
    const floorGeo = new THREE.BoxGeometry(TILE_SIZE, 0.3, TILE_SIZE);
    const floorVariants = this.textures.floorVariants;

    if (floorVariants && floorVariants.length > 1) {
      // Multi-variant floor (Cavern & Flesh: 6 distinct structural textures + 90-degree rotation + subtle tint)
      const buckets: Array<Array<[number, number]>> = floorVariants.map(() => []);
      for (const coord of floorCoords) {
        const [gx, gz] = coord;
        const hash = Math.abs((gx * 73856093) ^ (gz * 19349663) ^ (gx * gz * 83492791));
        const variantIdx = hash % floorVariants.length;
        buckets[variantIdx].push(coord);
      }
      const floorBumpMap = this.textures.floorBump;
      const varBumpScale = theme === 'flesh' ? 0.055 : 0.06;
      const varRoughness = theme === 'flesh' ? 0.56 : 0.94;
      const varMetalness = theme === 'flesh' ? 0.08 : 0.06;

      buckets.forEach((coords, vIdx) => {
        if (coords.length === 0) return;
        const mat = new THREE.MeshStandardMaterial({
          map: floorVariants[vIdx],
          bumpMap: floorBumpMap,
          bumpScale: varBumpScale,
          roughness: varRoughness,
          metalness: varMetalness,
        });
        const mesh = new THREE.InstancedMesh(floorGeo, mat, coords.length);
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        coords.forEach(([gx, gz], i) => {
          _pos.set(gx * TILE_SIZE, -0.15, gz * TILE_SIZE);
          const rotSteps = Math.abs(gx * 3 + gz * 5 + vIdx) & 3;
          _quat.setFromAxisAngle(upAxis, rotSteps * (Math.PI / 2));
          _scale.set(1, 1, 1);
          _mat4.compose(_pos, _quat, _scale);
          mesh.setMatrixAt(i, _mat4);
          const tint = 0.9 + ((gx * 17 + gz * 31 + vIdx * 7) % 15) * 0.013;
          _color.setRGB(tint, tint, tint);
          mesh.setColorAt(i, _color);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.levelGroup.add(mesh);
      });
    } else {
      const floorMat = new THREE.MeshStandardMaterial({
        map: this.textures.floorMap,
        bumpMap: this.textures.floorBump,
        bumpScale:
          theme === 'alien' ? 0.032 : theme === 'flesh' ? 0.055 : theme === 'cavern' ? 0.06 : 0.04,
        roughness:
          theme === 'alien' ? 0.24 : theme === 'flesh' ? 0.44 : theme === 'cavern' ? 0.94 : 0.86,
        metalness: theme === 'alien' ? 0.58 : theme === 'flesh' ? 0.1 : 0.06,
      });
      const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, floorCoords.length);
      floorMesh.receiveShadow = true;
      floorMesh.frustumCulled = false;

      floorCoords.forEach(([gx, gz], i) => {
        _pos.set(gx * TILE_SIZE, -0.15, gz * TILE_SIZE);
        _quat.identity();
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        floorMesh.setMatrixAt(i, _mat4);
        const tint =
          theme === 'alien'
            ? 0.97 + ((gx * 17 + gz * 31) % 7) * 0.008
            : 0.92 + ((gx * 17 + gz * 31) % 13) * 0.012;
        _color.setRGB(tint, tint, tint);
        floorMesh.setColorAt(i, _color);
      });
      floorMesh.instanceMatrix.needsUpdate = true;
      if (floorMesh.instanceColor) floorMesh.instanceColor.needsUpdate = true;
      this.levelGroup.add(floorMesh);
    }

    // 1b. Clean Cross-Tile Floor Decals (Cavern cracks/moss/pebbles; Flesh folds/stains/veins)
    const floorDecalMaps = this.textures.floorDecalMaps;
    if (floorDecalMaps && floorDecalMaps.length > 0 && (theme === 'cavern' || theme === 'flesh')) {
      let ds = ((depth * 4099 + (this.dungeon.genSeed ?? 0) * 131) >>> 0) || 1;
      const drand = () => {
        ds = (ds * 1664525 + 1013904223) >>> 0;
        return ds / 4294967296;
      };
      const runeKeys = new Set<string>();
      for (const p of this.dungeon.props) {
        if (p.type === 'rune_well' || p.type === 'spike') runeKeys.add(`${p.gx},${p.gz}`);
      }
      const decalBuckets: Array<Array<{ x: number; z: number; rot: number; sc: number }>> =
        floorDecalMaps.map(() => []);

      for (let gz = 2; gz < height - 2; gz++) {
        for (let gx = 2; gx < width - 2; gx++) {
          if (tiles[gz][gx] !== 1 || runeKeys.has(`${gx},${gz}`)) continue;
          if (drand() > 0.16) continue;
          const dIdx = Math.floor(drand() * floorDecalMaps.length);
          // Slight seam-straddling offset only toward neighboring open floor so decals never clip walls
          const canPosX = tiles[gz][gx + 1] === 1;
          const canNegX = tiles[gz][gx - 1] === 1;
          const canPosZ = tiles[gz + 1][gx] === 1;
          const canNegZ = tiles[gz - 1][gx] === 1;
          const ox = (canPosX && canNegX ? (drand() - 0.5) * 0.95 : canPosX ? drand() * 0.45 : canNegX ? -drand() * 0.45 : 0);
          const oz = (canPosZ && canNegZ ? (drand() - 0.5) * 0.95 : canPosZ ? drand() * 0.45 : canNegZ ? -drand() * 0.45 : 0);
          decalBuckets[dIdx].push({
            x: gx * TILE_SIZE + ox,
            z: gz * TILE_SIZE + oz,
            rot: Math.floor(drand() * 8) * (Math.PI / 4),
            sc: 0.88 + drand() * 0.48,
          });
        }
      }

      const decalGeo = new THREE.PlaneGeometry(1.55, 1.55);
      decalGeo.rotateX(-Math.PI / 2);
      decalBuckets.forEach((entries, dIdx) => {
        if (entries.length === 0) return;
        const decalMat = new THREE.MeshStandardMaterial({
          map: floorDecalMaps[dIdx],
          transparent: true,
          depthWrite: false,
          roughness: theme === 'flesh' ? 0.62 : 0.95,
          metalness: 0.02,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const inst = new THREE.InstancedMesh(decalGeo, decalMat, entries.length);
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        entries.forEach((e, i) => {
          _pos.set(e.x, 0.015, e.z);
          _quat.setFromAxisAngle(upAxis, e.rot);
          _scale.set(e.sc, 1, e.sc);
          _mat4.compose(_pos, _quat, _scale);
          inst.setMatrixAt(i, _mat4);
        });
        inst.instanceMatrix.needsUpdate = true;
        this.levelGroup.add(inst);
      });
    }

    // 2. Instanced Thick Walls (+ Natural Sculpted Wall Tops for Cavern/Flesh + 50% translucent occlusion layer)
    const wallHeight = this.wallHeight;
    const wallGeo = new THREE.BoxGeometry(TILE_SIZE, wallHeight, TILE_SIZE);
    const wallVariants = this.textures.wallVariants;
    const maxFadeWalls = 48;

    const capGeos = createWallCapGeometries(theme, TILE_SIZE);
    const capBaseMat = new THREE.MeshStandardMaterial({
      color:
        theme === 'alien'
          ? 0x223b59
          : theme === 'flesh'
          ? 0x3b1233
          : theme === 'cavern'
          ? 0x26221e
          : 0x13151d,
      roughness: theme === 'alien' ? 0.34 : theme === 'flesh' ? 0.64 : 0.95,
      metalness: theme === 'alien' ? 0.72 : 0.05,
    });

    this.capOpaqueMeshes = [];
    this.capFadeMeshes = [];
    this.wallOpaqueMeshes = [];
    this.wallFadeMeshes = [];
    this.wallTiles = [];

    // Pre-assign each wall coordinate to a cap bucket (1 flat cap for Stone/Alien; 3 sculpted variants for Cavern/Flesh)
    const capBuckets: Array<Array<{ gx: number; gz: number; rotY: number }>> = capGeos.map(() => []);
    const capAssignment: Array<{ capBucketIdx: number; capInstIdx: number; capRotY: number }> = [];
    wallCoords.forEach(([gx, gz]) => {
      const capBucketIdx =
        capGeos.length > 1 ? Math.abs((gx * 53 + gz * 79) ^ (gx * 13 + gz * 29)) % capGeos.length : 0;
      const capRotY =
        capGeos.length > 1 ? (Math.abs(gx * 5 + gz * 9) & 3) * (Math.PI / 2) : 0;
      const capInstIdx = capBuckets[capBucketIdx].length;
      capBuckets[capBucketIdx].push({ gx, gz, rotY: capRotY });
      capAssignment.push({ capBucketIdx, capInstIdx, capRotY });
    });

    capBuckets.forEach((entries, cIdx) => {
      const cMat = cIdx === 0 ? capBaseMat : capBaseMat.clone();
      const cMesh = new THREE.InstancedMesh(capGeos[cIdx], cMat, Math.max(1, entries.length));
      cMesh.count = entries.length;
      cMesh.receiveShadow = true;
      if (capGeos.length > 1) cMesh.castShadow = true;
      cMesh.frustumCulled = false;

      const cFadeMat = cMat.clone();
      cFadeMat.transparent = true;
      cFadeMat.opacity = 0.5;
      cFadeMat.depthWrite = true;
      const cFadeMesh = new THREE.InstancedMesh(capGeos[cIdx], cFadeMat, maxFadeWalls);
      cFadeMesh.count = 0;
      cFadeMesh.frustumCulled = false;
      cFadeMesh.renderOrder = 5;

      entries.forEach(({ gx, gz, rotY }, i) => {
        _pos.set(gx * TILE_SIZE, wallHeight, gz * TILE_SIZE);
        _quat.setFromAxisAngle(upAxis, rotY);
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        cMesh.setMatrixAt(i, _mat4);
      });
      cMesh.instanceMatrix.needsUpdate = true;
      this.capOpaqueMeshes.push(cMesh);
      this.capFadeMeshes.push(cFadeMesh);
      this.levelGroup.add(cMesh, cFadeMesh);
    });

    if (wallVariants && wallVariants.length > 1) {
      const wallBuckets: Array<
        Array<{ gx: number; gz: number; capBucketIdx: number; capInstIdx: number; capRotY: number }>
      > = wallVariants.map(() => []);
      wallCoords.forEach((coord, i) => {
        const [gx, gz] = coord;
        const vIdx = Math.abs((gx * 37 + gz * 91) ^ (gx * gz * 17)) % wallVariants.length;
        const ca = capAssignment[i];
        wallBuckets[vIdx].push({ gx, gz, ...ca });
      });
      const wallBumpMap = this.textures.wallBump;
      const wBumpScale = theme === 'flesh' ? 0.06 : 0.065;
      const wRoughness = theme === 'flesh' ? 0.54 : 0.96;
      const wMetalness = theme === 'flesh' ? 0.08 : 0.04;

      wallBuckets.forEach((entries, vIdx) => {
        if (entries.length === 0) return;
        const bucketIdx = this.wallOpaqueMeshes.length;
        const mat = new THREE.MeshStandardMaterial({
          map: wallVariants[vIdx],
          bumpMap: wallBumpMap,
          bumpScale: wBumpScale,
          roughness: wRoughness,
          metalness: wMetalness,
        });
        const mesh = new THREE.InstancedMesh(wallGeo, mat, entries.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        const fadeMat = mat.clone();
        fadeMat.transparent = true;
        fadeMat.opacity = 0.5;
        fadeMat.depthWrite = true;
        const fadeMesh = new THREE.InstancedMesh(wallGeo, fadeMat, maxFadeWalls);
        fadeMesh.count = 0;
        fadeMesh.receiveShadow = true;
        fadeMesh.frustumCulled = false;
        fadeMesh.renderOrder = 6;

        entries.forEach(({ gx, gz, capBucketIdx, capInstIdx, capRotY }, i) => {
          const wx = gx * TILE_SIZE;
          const wz = gz * TILE_SIZE;
          const rotSteps = Math.abs(gx * 7 + gz * 11) & 3;
          const rotY = rotSteps * (Math.PI / 2);
          _pos.set(wx, wallHeight / 2, wz);
          _quat.setFromAxisAngle(upAxis, rotY);
          _scale.set(1, 1, 1);
          _mat4.compose(_pos, _quat, _scale);
          mesh.setMatrixAt(i, _mat4);

          this.wallTiles.push({
            gx,
            gz,
            wx,
            wz,
            bucketIdx,
            wallInstIdx: i,
            capBucketIdx,
            capInstIdx,
            rotY,
            capRotY,
            occluded: false,
          });
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.wallOpaqueMeshes.push(mesh);
        this.wallFadeMeshes.push(fadeMesh);
        this.levelGroup.add(mesh, fadeMesh);
      });
    } else {
      const wallMat = new THREE.MeshStandardMaterial({
        map: this.textures.wallMap,
        bumpMap: this.textures.wallBump,
        bumpScale:
          theme === 'alien' ? 0.035 : theme === 'flesh' ? 0.06 : theme === 'cavern' ? 0.065 : 0.05,
        roughness:
          theme === 'alien' ? 0.26 : theme === 'flesh' ? 0.48 : theme === 'cavern' ? 0.96 : 0.9,
        metalness: theme === 'alien' ? 0.62 : theme === 'flesh' ? 0.08 : 0.04,
      });
      const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCoords.length);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      wallMesh.frustumCulled = false;

      const wallFadeMat = wallMat.clone();
      wallFadeMat.transparent = true;
      wallFadeMat.opacity = 0.5;
      wallFadeMat.depthWrite = true;
      const wallFadeMesh = new THREE.InstancedMesh(wallGeo, wallFadeMat, maxFadeWalls);
      wallFadeMesh.count = 0;
      wallFadeMesh.receiveShadow = true;
      wallFadeMesh.frustumCulled = false;
      wallFadeMesh.renderOrder = 6;

      wallCoords.forEach(([gx, gz], i) => {
        const wx = gx * TILE_SIZE;
        const wz = gz * TILE_SIZE;
        const ca = capAssignment[i];
        _pos.set(wx, wallHeight / 2, wz);
        _quat.identity();
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        wallMesh.setMatrixAt(i, _mat4);

        this.wallTiles.push({
          gx,
          gz,
          wx,
          wz,
          bucketIdx: 0,
          wallInstIdx: i,
          capBucketIdx: ca.capBucketIdx,
          capInstIdx: ca.capInstIdx,
          rotY: 0,
          capRotY: ca.capRotY,
          occluded: false,
        });
      });
      wallMesh.instanceMatrix.needsUpdate = true;
      this.wallOpaqueMeshes.push(wallMesh);
      this.wallFadeMeshes.push(wallFadeMesh);
      this.levelGroup.add(wallMesh, wallFadeMesh);
    }

    // 3. Instanced Pillars (Stone Columns / Cavern Stalagmites / Organic Bone-Sinew Ribs / Sci-Fi Reactor Columns)
    if (pillarCoords.length > 0) {
      const shaftGeo =
        theme === 'cavern'
          ? new THREE.CylinderGeometry(0.32, 0.58, 2.45, 6)
          : theme === 'flesh'
          ? new THREE.CylinderGeometry(0.4, 0.52, 2.45, 7)
          : theme === 'alien'
          ? new THREE.CylinderGeometry(0.44, 0.44, 2.5, 10)
          : new THREE.CylinderGeometry(0.46, 0.52, 2.5, 8);
      const pillarMat = new THREE.MeshStandardMaterial({
        map: this.textures.pillarMap,
        roughness:
          theme === 'alien' ? 0.22 : theme === 'flesh' ? 0.48 : theme === 'cavern' ? 0.92 : 0.82,
        metalness: theme === 'alien' ? 0.72 : theme === 'flesh' ? 0.08 : 0.12,
      });
      const shaftInst = new THREE.InstancedMesh(shaftGeo, pillarMat, pillarCoords.length);
      shaftInst.castShadow = true;
      shaftInst.receiveShadow = true;
      shaftInst.frustumCulled = false;

      if (theme === 'cavern' || theme === 'flesh') {
        // Organic stepped rock / sinew base & crown instead of medieval square plinths
        const baseGeo =
          theme === 'cavern'
            ? new THREE.CylinderGeometry(0.64, 0.84, 0.34, 6)
            : new THREE.CylinderGeometry(0.6, 0.82, 0.32, 7);
        const topGeo =
          theme === 'cavern'
            ? new THREE.CylinderGeometry(0.48, 0.36, 0.28, 6)
            : new THREE.CylinderGeometry(0.54, 0.42, 0.26, 7);
        const baseMat = new THREE.MeshStandardMaterial({
          color: theme === 'flesh' ? 0x45133a : 0x35312c,
          roughness: theme === 'flesh' ? 0.58 : 0.94,
          metalness: 0.05,
        });
        const topMat = new THREE.MeshStandardMaterial({
          color: theme === 'flesh' ? 0xd4bec8 : 0x453f38,
          roughness: theme === 'flesh' ? 0.54 : 0.92,
          metalness: 0.06,
        });
        const baseInst = new THREE.InstancedMesh(baseGeo, baseMat, pillarCoords.length);
        baseInst.castShadow = true;
        baseInst.receiveShadow = true;
        baseInst.frustumCulled = false;

        const topInst = new THREE.InstancedMesh(topGeo, topMat, pillarCoords.length);
        topInst.castShadow = true;
        topInst.receiveShadow = true;
        topInst.frustumCulled = false;

        pillarCoords.forEach(([gx, gz], i) => {
          const wx = gx * TILE_SIZE;
          const wz = gz * TILE_SIZE;
          const rot = ((gx * 3 + gz * 7) & 7) * (Math.PI / 4);
          _quat.setFromAxisAngle(upAxis, rot);
          _scale.set(1, 1, 1);

          _pos.set(wx, 1.24, wz);
          _mat4.compose(_pos, _quat, _scale);
          shaftInst.setMatrixAt(i, _mat4);

          _pos.set(wx, 0.17, wz);
          _mat4.compose(_pos, _quat, _scale);
          baseInst.setMatrixAt(i, _mat4);

          _pos.set(wx, 2.52, wz);
          _mat4.compose(_pos, _quat, _scale);
          topInst.setMatrixAt(i, _mat4);
        });
        shaftInst.instanceMatrix.needsUpdate = true;
        baseInst.instanceMatrix.needsUpdate = true;
        topInst.instanceMatrix.needsUpdate = true;
        this.levelGroup.add(shaftInst, baseInst, topInst);
      } else {
        const plinthGeo = new THREE.BoxGeometry(1.18, 0.28, 1.18);
        const plinthMat = new THREE.MeshStandardMaterial({
          color: theme === 'alien' ? 0x2b496b : 0x2c303a,
          roughness: theme === 'alien' ? 0.28 : 0.85,
          metalness: theme === 'alien' ? 0.78 : 0.15,
        });
        const plinthInst = new THREE.InstancedMesh(plinthGeo, plinthMat, pillarCoords.length * 2);
        plinthInst.castShadow = true;
        plinthInst.receiveShadow = true;
        plinthInst.frustumCulled = false;

        pillarCoords.forEach(([gx, gz], i) => {
          const wx = gx * TILE_SIZE;
          const wz = gz * TILE_SIZE;
          _pos.set(wx, 1.25, wz);
          _quat.identity();
          _scale.set(1, 1, 1);
          _mat4.compose(_pos, _quat, _scale);
          shaftInst.setMatrixAt(i, _mat4);

          _pos.set(wx, 0.14, wz);
          _mat4.compose(_pos, _quat, _scale);
          plinthInst.setMatrixAt(i * 2, _mat4);

          _pos.set(wx, 2.52, wz);
          _mat4.compose(_pos, _quat, _scale);
          plinthInst.setMatrixAt(i * 2 + 1, _mat4);
        });
        shaftInst.instanceMatrix.needsUpdate = true;
        plinthInst.instanceMatrix.needsUpdate = true;
        this.levelGroup.add(shaftInst, plinthInst);
      }
    }

    // 4. Props (Torches, Braziers, Rune Wells, Crates, Urns, Banners, Spike Traps)
    const bannerGeo = new THREE.PlaneGeometry(0.95, 1.4);
    const bannerMat = new THREE.MeshStandardMaterial({
      map: this.textures.bannerMap,
      transparent: true,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
      roughness: theme === 'alien' ? 0.25 : 0.9,
      emissive: theme === 'alien' ? new THREE.Color(0x1f9ce8) : new THREE.Color(0x000000),
      emissiveIntensity: theme === 'alien' ? 0.58 : 0,
    });
    const propLightColor = theme === 'dungeon' ? 0xff9838 : biome.torchColor;

    for (const prop of this.dungeon.props) {
      const { x, z } = gridToWorld(prop.gx, prop.gz);

      if (prop.type === 'brazier') {
        const b = createBrazier(this.textures.glowMap, propLightColor, theme);
        b.root.position.set(x, 0, z);
        this.levelGroup.add(b.root);
        this.lightProps.push({
          color: propLightColor,
          baseIntensity: theme === 'alien' ? 52 : 46,
          distance: theme === 'alien' ? 10.5 : 8.8,
          decay: 2.1,
          phase: Math.random() * 10,
          x,
          y: 1.62,
          z,
          flame: b.flame,
          kind: 'brazier',
        });
      } else if (prop.type === 'torch') {
        const t = createWallTorch(this.textures.glowMap, propLightColor, theme);
        const rot = prop.facing ?? 0;
        t.root.rotation.y = rot;
        // Offset flush against north (-Z) or west (-X) wall face
        const ox = rot === Math.PI / 2 ? -TILE_SIZE * 0.48 : 0;
        const oz = rot === 0 ? -TILE_SIZE * 0.48 : 0;
        t.root.position.set(x + ox, 0, z + oz);
        this.levelGroup.add(t.root);
        this.lightProps.push({
          color: propLightColor,
          baseIntensity: 36,
          distance: 7.4,
          decay: 2.1,
          phase: Math.random() * 10,
          x: x + ox + (rot === Math.PI / 2 ? 0.55 : 0),
          y: 1.75,
          z: z + oz + (rot === 0 ? 0.55 : 0),
          flame: t.flame,
          kind: 'torch',
        });
      } else if (prop.type === 'banner') {
        const mesh = new THREE.Mesh(bannerGeo, bannerMat);
        const rot = prop.facing ?? 0;
        mesh.rotation.y = rot;
        const ox = rot === Math.PI / 2 ? -TILE_SIZE * 0.46 : 0;
        const oz = rot === 0 ? -TILE_SIZE * 0.46 : 0;
        mesh.position.set(x + ox, 1.48, z + oz);
        this.levelGroup.add(mesh);
      } else if (prop.type === 'rune_well') {
        const rw = createRuneWell(biome, this.textures);
        rw.root.position.set(x, 0, z);
        const alreadyUsed = Boolean(snap?.usedRuneKeys.has(`${prop.gx},${prop.gz}`));
        if (alreadyUsed) {
          rw.crystal.visible = false;
          rw.halo.visible = false;
          (rw.decal.material as THREE.MeshBasicMaterial).opacity = 0.46;
          (rw.pool.material as THREE.MeshBasicMaterial).opacity = 0.12;
        }
        this.levelGroup.add(rw.root);
        this.lightProps.push({
          color: biome.runeColor,
          baseIntensity: 42,
          distance: 9.6,
          decay: 2.05,
          phase: Math.random() * 6,
          x,
          y: 1.58,
          z,
          crystal: rw.crystal,
          decal: rw.decal,
          pool: rw.pool,
          halo: rw.halo,
          kind: 'rune',
          used: alreadyUsed,
        });
      } else if (prop.type === 'crate' || prop.type === 'urn') {
        if (snap?.brokenBreakableKeys.has(`${prop.gx},${prop.gz}`)) {
          continue;
        }
        const mesh = createCrateProp(prop.type, this.textures, theme);
        mesh.position.set(x, 0, z);
        mesh.rotation.y = (Math.random() - 0.5) * 0.35;
        this.dynamicGroup.add(mesh);
        this.breakables.push({
          id: this.nextId++,
          kind: prop.type,
          mesh,
          x,
          z,
          broken: false,
        });
      } else if (prop.type === 'spike') {
        const spikeRig = createSpikeTrap();
        spikeRig.root.position.set(x, 0, z);
        this.levelGroup.add(spikeRig.root);
        this.spikes.push({
          rig: spikeRig,
          x,
          z,
          phaseOffset: this.mp ? this.mpSpikePhase(prop.gx, prop.gz) : Math.random() * 4,
          extended: false,
        });
      }
    }

    // 4b. Sparse, Non-Blocking Ambient Micro-Decorations (Cavern & Flesh only, deterministic per seed)
    if (theme === 'cavern' || theme === 'flesh') {
      let as = ((depth * 6151 + (this.dungeon.genSeed ?? 0) * 257) >>> 0) || 1;
      const arand = () => {
        as = (as * 1664525 + 1013904223) >>> 0;
        return as / 4294967296;
      };
      const blocked = new Set<string>([
        `${this.dungeon.spawn.gx},${this.dungeon.spawn.gz}`,
        `${this.dungeon.keyPos.gx},${this.dungeon.keyPos.gz}`,
        `${this.dungeon.doorPos.gx},${this.dungeon.doorPos.gz}`,
        `${this.dungeon.stairsPos.gx},${this.dungeon.stairsPos.gz}`,
      ]);
      if (this.dungeon.altarPos) blocked.add(`${this.dungeon.altarPos.gx},${this.dungeon.altarPos.gz}`);
      if (this.dungeon.shopPos) blocked.add(`${this.dungeon.shopPos.gx},${this.dungeon.shopPos.gz}`);
      for (const p of this.dungeon.props) blocked.add(`${p.gx},${p.gz}`);

      let rareMinerCount = 0;
      for (const r of this.dungeon.rooms) {
        const candidates: Array<{ gx: number; gz: number; ox: number; oz: number }> = [];
        // Collect perimeter floor cells hugging a wall (strictly avoiding doorways & corridor openings)
        for (let gz = r.z; gz < r.z + r.h; gz++) {
          for (let gx = r.x; gx < r.x + r.w; gx++) {
            const onEdge = gx === r.x || gx === r.x + r.w - 1 || gz === r.z || gz === r.z + r.h - 1;
            if (!onEdge || tiles[gz]?.[gx] !== 1 || blocked.has(`${gx},${gz}`)) continue;
            const nWall = tiles[gz - 1]?.[gx] === 2;
            const sWall = tiles[gz + 1]?.[gx] === 2;
            const wWall = tiles[gz]?.[gx - 1] === 2;
            const eWall = tiles[gz]?.[gx + 1] === 2;
            if (!nWall && !sWall && !wWall && !eWall) continue;
            // Push micro-decor right up against the wall base so walkable floor stays clear
            const ox = wWall ? -0.58 : eWall ? 0.58 : (arand() - 0.5) * 0.35;
            const oz = nWall ? -0.58 : sWall ? 0.58 : (arand() - 0.5) * 0.35;
            candidates.push({ gx, gz, ox, oz });
          }
        }
        const targetCount = Math.min(candidates.length, 2 + Math.floor(arand() * 2));
        for (let c = 0; c < targetCount; c++) {
          const pickIdx = Math.floor(arand() * candidates.length);
          const spot = candidates.splice(pickIdx, 1)[0];
          if (!spot) break;
          blocked.add(`${spot.gx},${spot.gz}`);

          let kind: number;
          if (theme === 'cavern') {
            const roll = arand();
            if (rareMinerCount < 2 && roll > 0.9) {
              kind = 3; // Sparse miner's pickaxe prop
              rareMinerCount++;
            } else if (biome.id === 'cavern_fungal') {
              kind = roll < 0.45 ? 1 : roll < 0.78 ? 0 : 2;
            } else {
              kind = roll < 0.42 ? 2 : roll < 0.78 ? 0 : 1;
            }
          } else {
            const roll = arand();
            kind = roll < 0.3 ? 0 : roll < 0.62 ? 1 : roll < 0.84 ? 2 : 3;
          }

          const decor = createAmbientDecorProp(theme, biome.id, kind, biome.runeColor);
          const { x: wx, z: wz } = gridToWorld(spot.gx, spot.gz);
          decor.position.set(wx + spot.ox, 0, wz + spot.oz);
          decor.rotation.y = arand() * Math.PI * 2;
          const s = 0.85 + arand() * 0.28;
          decor.scale.set(s, s, s);
          this.levelGroup.add(decor);
        }
      }
    }

    // 4c. Treasure room chests (docs/treasure-room-spec.md; none on most floors)
    this.buildTreasureChests();

    // 5. Floating Golden Relic Key Pedestal
    {
      const { x, z } = gridToWorld(this.dungeon.keyPos.gx, this.dungeon.keyPos.gz);
      const ped = createKeyPedestal(this.sharedShadowMap, this.textures.glowMap);
      ped.root.position.set(x, 0, z);
      if (this.hasKey) {
        ped.keyMesh.visible = false;
        ped.halo.visible = false;
      }
      this.dynamicGroup.add(ped.root);
      this.keyPedestal = ped;
      this.lightProps.push({
        color: 0xffd252,
        baseIntensity: 40,
        distance: 8.2,
        decay: 2.05,
        phase: 0,
        x,
        y: 1.55,
        z,
        halo: ped.halo,
        kind: 'key',
      });
    }

    // 6. Locked Bronze-Oak Gate
    {
      const { gx, gz, horizontal } = this.dungeon.doorPos;
      const { x, z } = gridToWorld(gx, gz);
      this.gateRig = createLockedGate(horizontal, this.textures);
      this.gateRig.root.position.set(x, 0, z);
      if (this.doorUnlocked) {
        this.gateRig.lockGlow.visible = false;
        this.gateOpenProgress = 1;
        this.gateRig.leftPivot.rotation.y = -Math.PI * 0.62;
        this.gateRig.rightPivot.rotation.y = Math.PI * 0.62;
      }
      this.levelGroup.add(this.gateRig.root);
      this.lightProps.push({
        color: 0xffd052,
        baseIntensity: 28,
        distance: 7.2,
        decay: 2.05,
        phase: 1.5,
        x,
        y: 1.65,
        z,
        kind: 'gate',
      });
    }

    // 7. Descending Illuminated Stone Stairwell
    {
      const { x, z } = gridToWorld(this.dungeon.stairsPos.gx, this.dungeon.stairsPos.gz);
      const stairs = createStairwell(this.textures);
      stairs.root.position.set(x, 0, z);
      this.levelGroup.add(stairs.root);
      this.lightProps.push({
        color: 0xffd26e,
        baseIntensity: 44,
        distance: 8.8,
        decay: 2.05,
        phase: 2.3,
        x,
        y: 1.7,
        z,
        kind: 'stairs',
      });
    }

    // 7b. Altar of Ascension on pre-boss floors (Depth 4, 9, 14, 19...)
    if (this.dungeon.altarPos) {
      const { x, z } = gridToWorld(this.dungeon.altarPos.gx, this.dungeon.altarPos.gz);
      const altar = createUpgradeAltar(this.textures.glowMap);
      altar.root.position.set(x, 0, z);
      this.levelGroup.add(altar.root);
      this.altarRig = altar;
      this.lightProps.push({
        color: 0xffd25c,
        baseIntensity: 48,
        distance: 9.5,
        decay: 2.05,
        phase: 0.7,
        x,
        y: 1.75,
        z,
        crystal: altar.crystal,
        decal: altar.ring,
        halo: altar.halo,
        kind: 'altar',
      });
    }

    // 7c. Dedicated Elixir Potion Shop on every 3rd floor (Depth 3, 6, 9, 12, 15...)
    if (this.dungeon.shopPos) {
      const { x, z } = gridToWorld(this.dungeon.shopPos.gx, this.dungeon.shopPos.gz);
      const shop = createPotionShop(this.textures.glowMap);
      shop.root.position.set(x, 0, z);
      this.levelGroup.add(shop.root);
      this.shopRig = shop;
      this.lightProps.push({
        color: 0xff5a7e,
        baseIntensity: 44,
        distance: 9.0,
        decay: 2.05,
        phase: 1.9,
        x,
        y: 1.7,
        z,
        crystal: shop.crystal,
        decal: shop.ring,
        halo: shop.halo,
        kind: 'shop',
      });
    }

    // 8. Spawn Hero at Room 0 (or at left-behind Town Portal when returning from Town)
    const spawnW = snap
      ? { x: snap.returnX, z: snap.returnZ }
      : gridToWorld(this.dungeon.spawn.gx, this.dungeon.spawn.gz);
    const local = this.localHero;
    if (!local.inTown) {
      local.x = spawnW.x;
      local.z = spawnW.z;
      local.ai.progressAnchorX = local.x;
      local.ai.progressAnchorZ = local.z;
      local.vx = 0;
      local.vz = 0;
      local.rig.root.position.set(local.x, 0, local.z);
      this.heroLight.position.set(local.x, 2.0, local.z);
    }
    if (!snap) {
      // New floor: everybody in the dungeon starts at the entrance (downed ones back on their feet). Teammates that
      // were left behind in a frozen / running floor stay where they are when the local hero comes back (snap).
      this.placeTeamAround(spawnW.x, spawnW.z);
    }

    // Floor change clears everybody's portal; returning through a portal keeps all of them (frozen floors rebuild
    // the landmarks, teammates' included, at their exact spots)
    if (!snap) for (const h of this.heroes) h.portal = null;
    else for (const h of this.heroes) if (h.portal && h.portal.depth === depth) this.placeHeroPortal(h, h.portal.x, h.portal.z, depth);

    // Snap camera immediately to new floor spawn
    if (!bg && !local.inTown) {
      const camOffset = 14.5 * this.camZoom;
      this.camera.position.set(local.x + camOffset, camOffset * 1.16, local.z + camOffset);
      _camTarget.set(local.x, 0.7, local.z);
      this.camera.lookAt(_camTarget);
    }

    // 9. Spawn Enemies across non-start rooms (protect Town Portal safe zone when returning)
    this.portalSafePos = snap ? { x: snap.returnX, z: snap.returnZ } : null;
    // A teammate's client never spawns monsters: they arrive in the host's snapshots
    if (!options?.guest) this.spawnEnemies();
    this.portalSafePos = null;
    const spawnG = worldToGrid(spawnW.x, spawnW.z);
    this.markExplored(spawnG.gx, spawnG.gz);

    if (!this.isSoftwareGl && depth === 1 && !snap && !bg) {
      this.renderer.compile(this.scene, this.camera);
    }

    if (buffExpired) {
      this.emitFloatingText(this.hero.x, 2.25, this.hero.z, '天使祝福已消散', 'info');
    }

    if (bg) {
      // The waiting teammates now wait at the entrance of the new floor
      this.awayAnchor = { x: spawnW.x, z: spawnW.z };
      // The local hero is in town: tell them once the screen is theirs again (see runDungeonBackground)
      this.pendingAwayFloor = depth;
    } else if (snap) {
      this.pushBanner(`返回第 ${depth} 層`, '怪物已復活 · 傳送門周圍安全');
    } else if (depth % 5 === 0) {
      const bossKind = getBossForDepth(depth, biome.terrainTheme, this.dungeon.genSeed);
      const cfg = BOSS_CONFIGS[bossKind];
      const shopNote = this.dungeon.shopPos ? ' · Elixir Shop Open' : '';
      this.pushBanner(`DEPTH ${depth} — BOSS FLOOR`, `${cfg.name} Guards the Relic Key${shopNote}`);
    } else if (depth % 5 === 4) {
      const shopNote = this.dungeon.shopPos ? ' · Elixir Shop Open' : '';
      this.pushBanner(
        `DEPTH ${depth} — ALTAR OF ASCENSION`,
        `Spend Gold Before the Depth ${depth + 1} Boss${shopNote}`
      );
    } else if (this.dungeon.shopPos) {
      this.pushBanner(
        `DEPTH ${depth} — ELIXIR SHOP`,
        `${biome.name} · Elixirs ${depth * 10}G Each`
      );
    } else {
      this.pushBanner(`DEPTH ${depth}`, biome.name);
    }
    if (!bg) this.updateWallOcclusion();
    this.repositionPetsForNewFloor();
    this.emitHud();
    this.emitMinimap();
    // Room game host: the new floor (or the rebuilt one) goes to every teammate that is in the dungeon
    if (this.mp?.role === 'host') this.mpHostAnnounceLevel(!snap);
  },

  /** Scene atmosphere (background, fog, ambient / rim light, lantern colour) of the dungeon floor in `this.dungeon`. */
  applyDungeonAtmosphere(this: EmbervaultEngine): void {
    const biome = this.dungeon.biome;
    const isAlienDeck = biome.terrainTheme === 'alien';
    this.scene.background = new THREE.Color(biome.fogColor);
    this.scene.fog = new THREE.Fog(biome.fogColor, isAlienDeck ? 38 : 32, isAlienDeck ? 62 : 54);
    this.hemiLight.color.setHex(biome.hemiSky);
    this.hemiLight.groundColor.setHex(biome.hemiGround);
    this.hemiLight.intensity = isAlienDeck ? 0.96 : 0.12;
    this.rimLight.color.setHex(isAlienDeck ? 0xd8f3ff : 0x6c8cc4);
    this.rimLight.intensity = isAlienDeck ? 0.62 : 0.09;
    this.scene.environmentIntensity = isAlienDeck ? 0.45 : 0.07;
    this.heroLight.color.setHex(this.localHero.isMage() ? 0x9fe6ff : biome.torchColor);
  },
};
