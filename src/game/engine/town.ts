import type { EmbervaultEngine } from '../engine';
import { TILE_SIZE, gridToWorld } from '../dungeon';
import { TOWN_ALTAR_GRID, TOWN_SHOP_GRID, TOWN_STASH_GRID } from './data';
import { _camTarget, _color, _mat4, _pos, _quat, _scale } from './scratch';
import { createAngelModel, createCentralWell, createPotionShop, createStashChest, createTownHouse, createTownPortal, createUpgradeAltar, createVillageLampPost, createVillageTree } from '../models';
import { createDungeonTextures } from '../textures';
import { BiomeConfig, TileType } from '../types';
import * as THREE from 'three';

export const townMethods = {
  /** Disposes the town scene (the town's level fields must be the active ones). Safe when no town exists. */
  clearTown(this: EmbervaultEngine): void {
    this.disposeGroupContents(this.townGroup);
    if (this.textures) {
      this.textures.dispose();
      this.textures = null;
    }
    if (this.extraTextures.length > 0) {
      this.extraTextures.forEach((t) => t.dispose());
      this.extraTextures = [];
    }
    this.lightProps = [];
    this.altarRig = null;
    this.shopRig = null;
    this.angelRig = null;
    this.townPortalRig = null;
    this.townGatePos = null;
    this.angelPos = null;
    this.stashPos = null;
    this.stashRig = null;
    for (const h of this.heroes) h.stashOpen = false;
    this.townBuilt = false;
  },

  /**
   * Leaves the town view for good (new floor / new run): disposes the town, then disposes (or re-activates, so the
   * caller can dispose) the parked dungeon. Afterwards the dungeon's fields are the active ones.
   */
  leaveTownScene(this: EmbervaultEngine): void {
    if (this.townBuilt) {
      this.clearTown();
      if (this.dungeonCtx) {
        this.applyCtx(this.dungeonCtx);
        this.dungeonCtx = null;
      } else {
        this.applyCtx(this.blankCtx());
      }
    }
    this.inTown = false;
    // Room games: a teammate standing in their own town stays there while my camera leaves mine (P5-C fix: this used
    // to flag them as back in the dungeon, so the host simulated a ghost and sent them a level they never asked for)
    for (const h of this.heroes) if (!h.isRemote) h.inTown = false;
    this.setViewGroups(false);
  },

  /** Moody dusk-night town atmosphere: low ambient lighting so facility & lantern lights drive the mood. */
  applyTownAtmosphere(this: EmbervaultEngine): void {
    this.scene.background = new THREE.Color(0x090c14);
    this.scene.fog = new THREE.Fog(0x090c14, 36, 72);
    this.hemiLight.color.setHex(0x6c88b8);
    this.hemiLight.groundColor.setHex(0x201a14);
    this.hemiLight.intensity = 0.18;
    this.rimLight.color.setHex(0x9eb8df);
    this.rimLight.intensity = 0.14;
    this.scene.environmentIntensity = 0.08;
    this.heroLight.color.setHex(0xffbe66);
  },

  buildTown(this: EmbervaultEngine): void {
    // The caller has already parked or disposed the dungeon and activated an empty level field set for the town.
    for (const pet of this.pets.values()) pet.rig.root.visible = false;
    this.townBuilt = true;
    this.inTown = true;

    // 4x total plaza area (2x width x 2x length: 23x23 walkable tiles vs previous 11x11)
    const W = 27;
    const H = 27;
    const tiles: TileType[][] = Array.from({ length: H }, () => new Array<TileType>(W).fill(2));
    const explored: boolean[][] = Array.from({ length: H }, () => new Array<boolean>(W).fill(true));

    // Expansive village plaza (gx 2..24, gz 2..24), exact center at (13, 13)
    for (let gz = 2; gz <= 24; gz++) {
      for (let gx = 2; gx <= 24; gx++) {
        tiles[gz][gx] = 1;
      }
    }

    // Solid non-enterable footprints:
    // - Left Grand Timber & Brick Tavern (gx 4..6, gz 9..12 -> 3x4 tiles, non-square)
    // - Right Stone Watch-Turret Guildhouse (gx 9..12, gz 4..6 -> 4x3 tiles, non-square)
    // - Central Stone Well (13, 13)
    for (let gz = 9; gz <= 12; gz++) {
      for (let gx = 4; gx <= 6; gx++) {
        tiles[gz][gx] = 2;
      }
    }
    for (let gz = 4; gz <= 6; gz++) {
      for (let gx = 9; gx <= 12; gx++) {
        tiles[gz][gx] = 2;
      }
    }
    tiles[13][13] = 2; // Central stone well

    const townBiome: BiomeConfig = {
      id: 'catacombs',
      name: '庇護小鎮',
      terrainTheme: 'dungeon',
      fogColor: 0x090c14,
      floorBase: '#3c4048',
      floorAccent: '#484d57',
      floorMortar: '#1c1f26',
      wallBase: '#423c36',
      wallAccent: '#544d45',
      bannerColor: '#2d5770',
      runeColor: 0x35a8db,
      runeCss: '#35a8db',
      torchColor: 0xffb24c,
      hemiSky: 0x6c88b8,
      hemiGround: 0x201a14,
    };

    this.dungeon = {
      width: W,
      height: H,
      tiles,
      explored,
      rooms: [{ id: 0, x: 2, z: 2, w: 23, h: 23, cx: 13, cz: 13, role: 'start' }],
      spawn: { gx: 15, gz: 15 },
      keyPos: { gx: -10, gz: -10 },
      doorPos: { gx: -10, gz: -10, horizontal: true },
      stairsPos: { gx: 19, gz: 11 }, // Town Portal on screen RIGHT (cyan blip on minimap)
      shopPos: { ...TOWN_SHOP_GRID }, // Potion Shop on screen LEFT
      altarPos: { ...TOWN_ALTAR_GRID }, // Upgrade Altar on screen LEFT (same side as Potion Shop)
      props: [],
      biome: townBiome,
    };

    this.applyTownAtmosphere();

    this.textures = createDungeonTextures(
      townBiome,
      this.renderer.capabilities.getMaxAnisotropy(),
      777
    );

    // 1. Dark twilight forest meadow surrounding the 4x village plaza
    const grassCanvas = document.createElement('canvas');
    grassCanvas.width = 256;
    grassCanvas.height = 256;
    const gctx = grassCanvas.getContext('2d')!;
    gctx.fillStyle = '#121e16';
    gctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 650; i++) {
      gctx.fillStyle = i % 3 === 0 ? '#18281d' : i % 3 === 1 ? '#0e1811' : '#1e3023';
      gctx.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 4, 3 + Math.random() * 4);
    }
    const grassTex = new THREE.CanvasTexture(grassCanvas);
    grassTex.colorSpace = THREE.SRGBColorSpace;
    grassTex.wrapS = THREE.RepeatWrapping;
    grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(26, 26);
    this.extraTextures.push(grassTex);

    const meadow = new THREE.Mesh(
      new THREE.PlaneGeometry(130, 130),
      new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.96, metalness: 0.02 })
    );
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.set(13 * TILE_SIZE, -0.06, 13 * TILE_SIZE);
    meadow.receiveShadow = true;
    this.townGroup.add(meadow);

    // 2. Dark Weathered Slate-Gray Cobblestone Village Plaza (gx 2..24, gz 2..24)
    const cobbleCanvas = document.createElement('canvas');
    cobbleCanvas.width = 256;
    cobbleCanvas.height = 256;
    const cctx = cobbleCanvas.getContext('2d')!;
    cctx.fillStyle = '#1a1d24';
    cctx.fillRect(0, 0, 256, 256);
    const rows = 6;
    const cols = 6;
    const cw = 256 / cols;
    const ch = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const offsetX = (r % 2) * (cw * 0.5);
      for (let c = -1; c <= cols; c++) {
        const shade = 54 + (((r * 19 + c * 37) & 15) * 1.15);
        const s = Math.round(shade);
        cctx.fillStyle = `rgb(${s}, ${s + 2}, ${s + 6})`;
        cctx.fillRect(c * cw + offsetX + 3, r * ch + 3, cw - 6, ch - 6);
        cctx.fillStyle = 'rgba(205,215,232,0.04)';
        cctx.fillRect(c * cw + offsetX + 4, r * ch + 4, cw - 10, 4);
      }
    }
    const cobbleTex = new THREE.CanvasTexture(cobbleCanvas);
    cobbleTex.colorSpace = THREE.SRGBColorSpace;
    this.extraTextures.push(cobbleTex);

    const plazaCoords: Array<[number, number]> = [];
    for (let gz = 2; gz <= 24; gz++) {
      for (let gx = 2; gx <= 24; gx++) {
        plazaCoords.push([gx, gz]);
      }
    }
    const plazaGeo = new THREE.BoxGeometry(TILE_SIZE, 0.24, TILE_SIZE);
    const plazaMat = new THREE.MeshStandardMaterial({
      map: cobbleTex,
      roughness: 0.92,
      metalness: 0.06,
    });
    const plazaMesh = new THREE.InstancedMesh(plazaGeo, plazaMat, plazaCoords.length);
    plazaMesh.receiveShadow = true;
    plazaMesh.frustumCulled = false;
    plazaCoords.forEach(([gx, gz], i) => {
      _pos.set(gx * TILE_SIZE, -0.12, gz * TILE_SIZE);
      _quat.identity();
      _scale.set(1, 1, 1);
      _mat4.compose(_pos, _quat, _scale);
      plazaMesh.setMatrixAt(i, _mat4);
      const tint = 0.86 + ((gx * 13 + gz * 29) % 11) * 0.012;
      _color.setRGB(tint, tint, tint);
      plazaMesh.setColorAt(i, _color);
    });
    plazaMesh.instanceMatrix.needsUpdate = true;
    if (plazaMesh.instanceColor) plazaMesh.instanceColor.needsUpdate = true;
    this.townGroup.add(plazaMesh);

    // Low weathered wooden fence edging the 4x plaza perimeter
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x453120, roughness: 0.92 });
    const postGeo = new THREE.BoxGeometry(0.16, 0.72, 0.16);
    const railGeo = new THREE.BoxGeometry(TILE_SIZE, 0.1, 0.08);
    for (let i = 2; i <= 24; i++) {
      const edges: Array<[number, number, number]> = [
        [i * TILE_SIZE, 1.5 * TILE_SIZE, 0],
        [i * TILE_SIZE, 24.5 * TILE_SIZE, 0],
        [1.5 * TILE_SIZE, i * TILE_SIZE, Math.PI / 2],
        [24.5 * TILE_SIZE, i * TILE_SIZE, Math.PI / 2],
      ];
      for (const [fx, fz, rot] of edges) {
        const post = new THREE.Mesh(postGeo, fenceMat);
        post.position.set(fx, 0.36, fz);
        post.castShadow = true;
        const rail = new THREE.Mesh(railGeo, fenceMat);
        rail.position.set(fx, 0.48, fz);
        rail.rotation.y = rot;
        this.townGroup.add(post, rail);
      }
    }

    // 3. Two Distinct ~2x Larger Non-Square Exterior Houses
    // Left: Grand Timber & Red-Brown Brick Tavern (no white walls) at gx 4..6, gz 9..12
    const tavern = createTownHouse('tavern', this.textures.glowMap);
    tavern.position.set(4.6 * TILE_SIZE, 0, 10.5 * TILE_SIZE);
    tavern.rotation.y = Math.PI / 2; // Long timber porch, barrels & tavern sign face +X into the plaza
    this.townGroup.add(tavern);
    this.lightProps.push({
      color: 0xffaa44,
      baseIntensity: 52,
      distance: 13.5,
      decay: 2.0,
      phase: 0.5,
      x: 6.45 * TILE_SIZE,
      y: 2.35,
      z: 10.5 * TILE_SIZE,
      kind: 'lamp',
    });

    // Right: Asymmetrical Stone Watch-Turret Guildhouse at gx 9..12, gz 4..6
    const cottage = createTownHouse('cottage', this.textures.glowMap);
    cottage.position.set(10.5 * TILE_SIZE, 0, 4.65 * TILE_SIZE);
    cottage.rotation.y = 0; // Stone portico & turret face +Z into the plaza
    this.townGroup.add(cottage);
    this.lightProps.push({
      color: 0xffb454,
      baseIntensity: 48,
      distance: 13.0,
      decay: 2.0,
      phase: 1.4,
      x: 10.5 * TILE_SIZE,
      y: 2.35,
      z: 6.45 * TILE_SIZE,
      kind: 'lamp',
    });

    // 4. Central Stone Water Well at exact plaza center (13, 13)
    const well = createCentralWell();
    well.position.set(13 * TILE_SIZE, 0, 13 * TILE_SIZE);
    well.rotation.y = Math.PI / 4;
    this.townGroup.add(well);

    // 5. Beautiful White-Robed Female Angel at (10, 10) framed between the two buildings & well
    const angel = createAngelModel(this.sharedShadowMap, this.textures.glowMap);
    const angelW = gridToWorld(10, 10);
    angel.root.position.set(angelW.x, 0, angelW.z);
    angel.root.rotation.y = Math.PI / 4;
    this.townGroup.add(angel.root);
    this.angelRig = angel;
    this.angelPos = { x: angelW.x, z: angelW.z };
    this.lightProps.push({
      color: 0xffe296,
      baseIntensity: 42,
      distance: 11.5,
      decay: 2.0,
      phase: 0.2,
      x: angelW.x,
      y: 2.2,
      z: angelW.z,
      kind: 'angel',
    });

    // 6. Outdoor Potion Shop on screen LEFT (TOWN_SHOP_GRID)
    {
      const sw = gridToWorld(TOWN_SHOP_GRID.gx, TOWN_SHOP_GRID.gz);
      const shop = createPotionShop(this.textures.glowMap);
      shop.root.position.set(sw.x, 0, sw.z);
      this.townGroup.add(shop.root);
      this.shopRig = shop;
      this.lightProps.push({
        color: 0xff5a7e,
        baseIntensity: 52,
        distance: 11.5,
        decay: 2.0,
        phase: 1.9,
        x: sw.x,
        y: 1.75,
        z: sw.z,
        crystal: shop.crystal,
        decal: shop.ring,
        halo: shop.halo,
        kind: 'shop',
      });
    }

    // 7. Outdoor Upgrade Altar on screen LEFT (same side as Potion Shop) (TOWN_ALTAR_GRID)
    {
      const aw = gridToWorld(TOWN_ALTAR_GRID.gx, TOWN_ALTAR_GRID.gz);
      const altar = createUpgradeAltar(this.textures.glowMap);
      altar.root.position.set(aw.x, 0, aw.z);
      this.townGroup.add(altar.root);
      this.altarRig = altar;
      this.lightProps.push({
        color: 0xffd25c,
        baseIntensity: 54,
        distance: 11.8,
        decay: 2.0,
        phase: 0.7,
        x: aw.x,
        y: 1.8,
        z: aw.z,
        crystal: altar.crystal,
        decal: altar.ring,
        halo: altar.halo,
        kind: 'altar',
      });
    }

    // 8. Return-to-Dungeon Town Portal on opposite side (screen RIGHT) at (19, 11) with halved brightness
    {
      const pw = gridToWorld(19, 11);
      const portal = createTownPortal(this.textures.glowMap);
      portal.root.position.set(pw.x, 0, pw.z);
      portal.root.rotation.y = Math.PI / 4;
      this.townGroup.add(portal.root);
      this.townPortalRig = portal;
      this.townGatePos = { x: pw.x, z: pw.z };
      this.lightProps.push({
        color: 0x35a8db,
        baseIntensity: 24,
        distance: 9.0,
        decay: 2.0,
        phase: 2.5,
        x: pw.x,
        y: 1.5,
        z: pw.z,
        kind: 'portal',
      });
    }

    // 8b. Stash chest (town warehouse) at TOWN_STASH_GRID: open plaza area, clear of portal, altar and shop
    {
      const cg = TOWN_STASH_GRID;
      const cw = gridToWorld(cg.gx, cg.gz);
      const chest = createStashChest(this.textures.glowMap);
      chest.root.position.set(cw.x, 0, cw.z);
      chest.root.rotation.y = Math.PI / 4; // front faces the camera side
      this.townGroup.add(chest.root);
      this.stashRig = chest;
      this.stashPos = { x: cw.x, z: cw.z };
      tiles[cg.gz][cg.gx] = 2; // solid footprint so the hero walks around it
      this.lightProps.push({
        color: 0xffc060,
        baseIntensity: 30,
        distance: 9.5,
        decay: 2.0,
        phase: 3.1,
        x: cw.x,
        y: 1.5,
        z: cw.z,
        halo: chest.halo,
        decal: chest.glowRing,
        kind: 'stash',
      });
    }

    // 9. Atmospheric Village Lamp Posts & Perimeter Forest Pine Trees across the 4x square
    const lampCoords: Array<[number, number]> = [
      [3.5, 3.5],
      [22.5, 3.5],
      [3.5, 22.5],
      [22.5, 22.5],
      [14.5, 11.5],
      [11.5, 14.5],
      [7.2, 13.5],
      [18.2, 16.2],
    ];
    for (const [lx, lz] of lampCoords) {
      const lamp = createVillageLampPost(this.textures.glowMap);
      lamp.position.set(lx * TILE_SIZE, 0, lz * TILE_SIZE);
      this.townGroup.add(lamp);
      this.lightProps.push({
        color: 0xffb24c,
        baseIntensity: 42,
        distance: 11.2,
        decay: 2.0,
        phase: lx + lz,
        x: lx * TILE_SIZE,
        y: 2.35,
        z: lz * TILE_SIZE,
        kind: 'lamp',
      });
    }

    const treeCoords: Array<[number, number, number]> = [
      [0.5, 1.2, 1.2],
      [0.9, 5.0, 1.0],
      [0.6, 9.2, 1.25],
      [1.0, 13.5, 1.05],
      [0.7, 17.8, 1.18],
      [0.8, 22.2, 1.1],
      [2.8, 0.6, 1.15],
      [6.6, 0.8, 0.96],
      [10.8, 0.6, 1.22],
      [15.2, 0.8, 1.05],
      [19.6, 0.6, 1.18],
      [23.8, 0.9, 1.08],
      [25.6, 3.8, 1.2],
      [25.8, 8.0, 1.02],
      [25.5, 12.6, 1.18],
      [25.7, 17.2, 1.06],
      [25.4, 21.8, 1.22],
      [24.2, 25.6, 1.12],
      [19.8, 25.8, 1.04],
      [15.0, 25.5, 1.18],
      [10.4, 25.7, 1.08],
      [5.8, 25.5, 1.16],
      [1.6, 25.4, 1.02],
    ];
    for (const [tx, tz, sc] of treeCoords) {
      const tree = createVillageTree(sc);
      tree.position.set(tx * TILE_SIZE, 0, tz * TILE_SIZE);
      tree.rotation.y = (tx * 1.7 + tz * 2.3) % (Math.PI * 2);
      this.townGroup.add(tree);
    }

    // 10. Place Hero in front of Central Well facing the Angel & Buildings
    const heroStart = gridToWorld(15, 15);
    this.hero.x = heroStart.x;
    this.hero.z = heroStart.z;
    this.hero.vx = 0;
    this.hero.vz = 0;
    this.hero.facing = -Math.PI * 0.75;
    this.hero.rig.root.position.set(this.hero.x, 0, this.hero.z);
    this.hero.rig.body.rotation.y = this.hero.facing;
    this.heroLight.position.set(this.hero.x, 2.0, this.hero.z);
    const camOffset = 14.5 * this.camZoom;
    this.camera.position.set(this.hero.x + camOffset, camOffset * 1.16, this.hero.z + camOffset);
    _camTarget.set(this.hero.x, 0.7, this.hero.z);
    this.camera.lookAt(_camTarget);

    this.pushBanner('庇護小鎮', '左側補給藥水與祭壇強化、向天使祈福，或走入右側傳送門返回地下城');
    this.emitHud();
    this.emitMinimap();
  },
};
