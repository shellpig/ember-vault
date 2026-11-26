import * as THREE from 'three';
import { BiomeConfig, EnemyKind, ProjectileKind, TerrainTheme } from './types';
import { RelicRarity } from './relics';
import { DungeonTextureSet } from './textures';

export interface HeroRig {
  root: THREE.Group;
  body: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  swordGroup: THREE.Object3D;
  cape: THREE.Object3D;
  lanternCore: THREE.Mesh;
  lanternPivot: THREE.Object3D;
  flashMaterials: THREE.MeshStandardMaterial[];
}

export interface EnemyRig {
  root: THREE.Group;
  body: THREE.Group;
  leftLeg?: THREE.Object3D;
  rightLeg?: THREE.Object3D;
  leftArm?: THREE.Object3D;
  weaponArm?: THREE.Object3D;
  coreMesh?: THREE.Mesh;
  auraRing?: THREE.Mesh;
  nameTag?: THREE.Sprite;
  stunStars?: THREE.Group;
  flashMaterials: THREE.MeshStandardMaterial[];
}

export interface BossTelegraphRig {
  group: THREE.Group;
  outerRing: THREE.Mesh;
  fillDisk: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

export function createBossTelegraph(color: number): BossTelegraphRig {
  const group = new THREE.Group();
  group.visible = false;

  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const outerRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 32), ringMat);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.048;
  group.add(outerRing);

  const fillMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const fillDisk = new THREE.Mesh(new THREE.CircleGeometry(0.92, 32), fillMat);
  fillDisk.rotation.x = -Math.PI / 2;
  fillDisk.position.y = 0.044;
  fillDisk.scale.setScalar(0.1);
  group.add(fillDisk);

  return { group, outerRing, fillDisk, fillMat, ringMat };
}

export interface GateRig {
  root: THREE.Group;
  leftPivot: THREE.Group;
  rightPivot: THREE.Group;
  lockGlow: THREE.Mesh;
}

export interface SpikeTrapRig {
  root: THREE.Group;
  spikesGroup: THREE.Group;
  warningMat: THREE.MeshStandardMaterial;
}

function addContactShadow(parent: THREE.Group, shadowMap: THREE.Texture, radius: number): void {
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
  const mat = new THREE.MeshBasicMaterial({
    map: shadowMap,
    transparent: true,
    depthWrite: false,
    opacity: 0.7,
  });
  const disc = new THREE.Mesh(geo, mat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.025;
  parent.add(disc);
}

export function createHeroModel(shadowMap: THREE.Texture): HeroRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  addContactShadow(root, shadowMap, 0.62);

  const flashMaterials: THREE.MeshStandardMaterial[] = [];
  const makeMat = (params: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial(params);
    flashMaterials.push(m);
    return m;
  };

  const armorMat = makeMat({ color: 0x3b4454, metalness: 0.65, roughness: 0.35 });
  const darkIronMat = makeMat({ color: 0x222630, metalness: 0.5, roughness: 0.55 });
  const cloakMat = makeMat({ color: 0x1b5a5e, metalness: 0.08, roughness: 0.85 });
  const brassMat = makeMat({ color: 0xd4a94e, metalness: 0.88, roughness: 0.22 });
  const bladeMat = makeMat({ color: 0xdbe6f2, metalness: 0.92, roughness: 0.16 });
  const woodMat = makeMat({ color: 0x5c3a21, metalness: 0.05, roughness: 0.88 });

  // Legs (articulated at hip Y=0.42)
  const legGeo = new THREE.BoxGeometry(0.18, 0.42, 0.2);
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.14, 0.42, 0);
  const leftLegMesh = new THREE.Mesh(legGeo, darkIronMat);
  leftLegMesh.position.y = -0.21;
  leftLegMesh.castShadow = true;
  leftLeg.add(leftLegMesh);
  body.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.14, 0.42, 0);
  const rightLegMesh = new THREE.Mesh(legGeo, darkIronMat);
  rightLegMesh.position.y = -0.21;
  rightLegMesh.castShadow = true;
  rightLeg.add(rightLegMesh);
  body.add(rightLeg);

  // Armored torso + brass belt
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.3), armorMat);
  torso.position.y = 0.68;
  torso.castShadow = true;
  body.add(torso);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.1, 0.33), brassMat);
  belt.position.y = 0.48;
  body.add(belt);

  // Shoulder pauldrons (asymmetric brass crest on sword arm)
  const pauldronR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.34), brassMat);
  pauldronR.position.set(0.32, 0.88, 0);
  pauldronR.castShadow = true;
  body.add(pauldronR);

  const pauldronL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.32), cloakMat);
  pauldronL.position.set(-0.31, 0.87, 0);
  pauldronL.castShadow = true;
  body.add(pauldronL);

  // Hooded Warden Helm + Visor Eyes
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), cloakMat);
  head.position.y = 1.13;
  head.castShadow = true;
  body.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.1), darkIronMat);
  visor.position.set(0, 1.12, 0.17);
  body.add(visor);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd27d });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.04), eyeMat);
  eyeL.position.set(-0.07, 1.13, 0.21);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.04), eyeMat);
  eyeR.position.set(0.07, 1.13, 0.21);
  body.add(eyeL, eyeR);

  // Brass helm crest
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.42), brassMat);
  crest.position.set(0, 1.34, 0);
  body.add(crest);

  // Flowing Warden Cloak behind back
  const cape = new THREE.Group();
  cape.position.set(0, 0.92, -0.16);
  const capeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.72, 0.08), cloakMat);
  capeMesh.position.set(0, -0.34, -0.04);
  capeMesh.rotation.x = 0.16;
  capeMesh.castShadow = true;
  cape.add(capeMesh);
  const capeTrim = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.07, 0.09), brassMat);
  capeTrim.position.set(0, -0.66, -0.09);
  capeTrim.rotation.x = 0.16;
  cape.add(capeTrim);
  body.add(cape);

  // Right Arm + Runed Greatsword
  const rightArm = new THREE.Group();
  rightArm.position.set(0.33, 0.82, 0.02);
  const rArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.38, 0.16), armorMat);
  rArmMesh.position.y = -0.16;
  rArmMesh.castShadow = true;
  rightArm.add(rArmMesh);

  const swordGroup = new THREE.Group();
  swordGroup.position.set(0, -0.32, 0.12);
  swordGroup.rotation.x = Math.PI * 0.42;

  const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.07), woodMat);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.09), brassMat);
  guard.position.y = 0.12;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.88, 0.045), bladeMat);
  blade.position.y = 0.58;
  blade.castShadow = true;
  const bladeTip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 4), bladeMat);
  bladeTip.position.y = 1.1;
  bladeTip.rotation.y = Math.PI / 4;
  swordGroup.add(hilt, guard, blade, bladeTip);
  rightArm.add(swordGroup);
  body.add(rightArm);

  // Left Arm + Crooked Soul Lantern Staff
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.33, 0.82, 0.05);
  const lArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.36, 0.16), armorMat);
  lArmMesh.position.y = -0.14;
  lArmMesh.castShadow = true;
  leftArm.add(lArmMesh);

  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.88, 6), woodMat);
  staff.position.set(0, 0.14, 0.22);
  staff.rotation.x = 0.22;
  leftArm.add(staff);

  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.24), darkIronMat);
  hook.position.set(0, 0.56, 0.38);
  leftArm.add(hook);

  // Hanging swinging lantern cage + glowing amber heart
  const lanternPivot = new THREE.Group();
  lanternPivot.position.set(0, 0.54, 0.48);

  const lanternCap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.12, 4), darkIronMat);
  lanternCap.position.y = -0.07;
  lanternCap.rotation.y = Math.PI / 4;
  const lanternBase = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.18), darkIronMat);
  lanternBase.position.y = -0.32;

  const lanternCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.13, 0),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0 })
  );
  lanternCore.position.y = -0.2;

  const lanternHalo = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 10),
    new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  lanternHalo.position.y = -0.2;

  lanternPivot.add(lanternCap, lanternBase, lanternCore, lanternHalo);
  leftArm.add(lanternPivot);
  body.add(leftArm);

  return {
    root,
    body,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    swordGroup,
    cape,
    lanternCore,
    lanternPivot,
    flashMaterials,
  };
}

export function createEnemyModel(
  kind: EnemyKind,
  biome: BiomeConfig,
  shadowMap: THREE.Texture
): EnemyRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const flashMaterials: THREE.MeshStandardMaterial[] = [];

  const makeMat = (params: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial(params);
    flashMaterials.push(m);
    return m;
  };

  // === ALIEN SPACESHIP BOSSES (Depths 31-40) ===
  if (kind === 'boss_mothership_ai') {
    addContactShadow(root, shadowMap, 1.32);
    const auraRing = new THREE.Mesh(
      new THREE.RingGeometry(1.02, 1.28, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff4757,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.032;
    root.add(auraRing);

    // High-contrast Obsidian-Titanium Chassis, Gold Trim & Crimson Optical AI Eye
    const hullMat = makeMat({ color: 0x1e293b, roughness: 0.24, metalness: 0.85 });
    const chromeMat = makeMat({ color: 0xdcebf7, roughness: 0.18, metalness: 0.92 });
    const goldMat = makeMat({ color: 0xe6b43c, roughness: 0.28, metalness: 0.88 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b4e });
    const energyMat = new THREE.MeshBasicMaterial({ color: 0xffa62b });

    // Central faceted obsidian AI octahedron chassis
    const coreShell = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 1), hullMat);
    coreShell.position.y = 1.22;
    coreShell.castShadow = true;
    body.add(coreShell);

    // Equatorial chrome armor collar + vertical gold fin blades
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.16, 8), chromeMat);
    collar.position.y = 1.22;
    collar.castShadow = true;
    body.add(collar);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.72, 0.26), goldMat);
      fin.position.set(Math.cos(a) * 0.56, 1.22, Math.sin(a) * 0.56);
      fin.rotation.y = -a;
      fin.castShadow = true;
      body.add(fin);
    }

    // Glowing Crimson Optical Lens facing forward
    const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 6, 16), goldMat);
    lensRing.position.set(0, 1.22, 0.58);
    const lensEye = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 10), eyeMat);
    lensEye.position.set(0, 1.22, 0.55);
    body.add(lensRing, lensEye);

    // Spinning outer quantum containment ring (animated as coreMesh)
    const coreMesh = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.055, 6, 20), energyMat);
    coreMesh.position.y = 1.22;
    coreMesh.rotation.x = Math.PI * 0.34;
    body.add(coreMesh);

    // Twin levitating plasma weapon pods
    const buildPod = (side: -1 | 1) => {
      const arm = new THREE.Group();
      arm.position.set(side * 0.92, 1.12, 0.08);
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.38, 0.52), hullMat);
      pod.castShadow = true;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.44, 6), chromeMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, -0.02, 0.38);
      const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eyeMat);
      muzzle.position.set(0, -0.02, 0.62);
      arm.add(pod, barrel, muzzle);
      return arm;
    };
    const leftArm = buildPod(-1);
    const weaponArm = buildPod(1);
    body.add(leftArm, weaponArm);

    body.scale.setScalar(1.48);
    return { root, body, leftArm, weaponArm, coreMesh, auraRing, flashMaterials };
  }

  if (kind === 'boss_xeno_commander') {
    addContactShadow(root, shadowMap, 1.25);
    const auraRing = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1.2, 24),
      new THREE.MeshBasicMaterial({
        color: 0x39ff7a,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.032;
    root.add(auraRing);

    // Dark-Emerald Obsidian Exo-Armor, Gold Sovereign Trim & Electric Lime Plasma Weapons
    const armorMat = makeMat({ color: 0x162925, roughness: 0.28, metalness: 0.82 });
    const plateMat = makeMat({ color: 0x264d42, roughness: 0.32, metalness: 0.72 });
    const goldMat = makeMat({ color: 0xf2c14e, roughness: 0.25, metalness: 0.9 });
    const plasmaMat = new THREE.MeshBasicMaterial({ color: 0x4dff88 });
    const visorMat = new THREE.MeshBasicMaterial({ color: 0xffee52 });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.22, 0.54, 0);
    const ll = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.54, 0.22), armorMat);
    ll.position.y = -0.27;
    ll.castShadow = true;
    leftLeg.add(ll);
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.22, 0.54, 0);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.54, 0.22), armorMat);
    rl.position.y = -0.27;
    rl.castShadow = true;
    rightLeg.add(rl);
    body.add(leftLeg, rightLeg);

    // Armored Torso & Sovereign Reactor Chest
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.68, 0.4), armorMat);
    torso.position.y = 0.9;
    torso.castShadow = true;
    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.44), plateMat);
    chestPlate.position.y = 0.94;
    const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), plasmaMat);
    coreMesh.position.set(0, 0.96, 0.24);
    body.add(torso, chestPlate, coreMesh);

    // Winged sci-fi pauldrons with gold trim
    for (const side of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.42), plateMat);
      sh.position.set(side * 0.48, 1.2, 0);
      sh.rotation.z = -side * 0.26;
      sh.castShadow = true;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.44), goldMat);
      trim.position.set(side * 0.48, 1.32, 0);
      trim.rotation.z = -side * 0.26;
      body.add(sh, trim);
    }

    // Elongated Alien Warlord Helm + Crown Crest + Glowing Visor
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.46), armorMat);
    head.position.set(0, 1.46, -0.02);
    head.castShadow = true;
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.58), goldMat);
    crest.position.set(0, 1.66, -0.08);
    crest.rotation.x = -0.24;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.08), visorMat);
    visor.position.set(0, 1.46, 0.2);
    body.add(head, crest, visor);

    // Left Energy Shield Arm
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.48, 1.04, 0);
    const la = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.44, 0.16), armorMat);
    la.position.y = -0.18;
    const holoShield = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.68, 0.46),
      new THREE.MeshBasicMaterial({
        color: 0x39ff7a,
        transparent: true,
        opacity: 0.55,
      })
    );
    holoShield.position.set(-0.14, -0.22, 0.16);
    leftArm.add(la, holoShield);
    body.add(leftArm);

    // Right Plasma Halberd-Lance Arm
    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.48, 1.04, 0);
    const ra = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.44, 0.16), armorMat);
    ra.position.y = -0.18;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.55, 6), goldMat);
    shaft.position.set(0, -0.22, 0.48);
    shaft.rotation.x = Math.PI * 0.45;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.24), plasmaMat);
    blade.position.set(0, -0.12, 1.18);
    blade.rotation.x = Math.PI * 0.45;
    weaponArm.add(ra, shaft, blade);
    body.add(weaponArm);

    body.scale.setScalar(1.6);
    return { root, body, leftLeg, rightLeg, leftArm, weaponArm, coreMesh, auraRing, flashMaterials };
  }

  // === ALIEN SPACESHIP MOBS (Depths 31-40) ===
  if (kind === 'alien_trooper') {
    addContactShadow(root, shadowMap, 0.5);
    // Dark Indigo-Slate Exo-Trooper with Bright Plasma-Orange Visor & Energy Blade
    const suitMat = makeMat({ color: 0x22293e, roughness: 0.34, metalness: 0.72 });
    const armorMat = makeMat({ color: 0x3b486b, roughness: 0.28, metalness: 0.8 });
    const visorMat = new THREE.MeshBasicMaterial({ color: 0xff7a21 });
    const bladeMat = new THREE.MeshBasicMaterial({ color: 0xff9436 });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.12, 0.42, 0);
    const ll = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.13), suitMat);
    ll.position.y = -0.21;
    ll.castShadow = true;
    leftLeg.add(ll);
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.12, 0.42, 0);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.13), suitMat);
    rl.position.y = -0.21;
    rl.castShadow = true;
    rightLeg.add(rl);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.46, 0.26), armorMat);
    torso.position.y = 0.68;
    torso.castShadow = true;
    const chestCore = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.28), visorMat);
    chestCore.position.y = 0.72;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.32), armorMat);
    head.position.y = 1.08;
    head.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.08), visorMat);
    visor.position.set(0, 1.08, 0.15);
    body.add(torso, chestCore, head, visor);

    const leftArm = new THREE.Group();
    leftArm.position.set(-0.27, 0.82, 0);
    const la = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.36, 0.12), suitMat);
    la.position.y = -0.14;
    leftArm.add(la);
    body.add(leftArm);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.27, 0.82, 0);
    const ra = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.34, 0.12), suitMat);
    ra.position.y = -0.14;
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.12), armorMat);
    hilt.position.set(0, -0.3, 0.14);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.62), bladeMat);
    blade.position.set(0, -0.3, 0.48);
    weaponArm.add(ra, hilt, blade);
    body.add(weaponArm);

    return { root, body, leftLeg, rightLeg, leftArm, weaponArm, flashMaterials };
  }

  if (kind === 'alien_probe') {
    addContactShadow(root, shadowMap, 0.5);
    // Hovering Gunmetal Security Drone Orb with Glowing Amber Scanner Ring
    const shellMat = makeMat({ color: 0x263142, roughness: 0.22, metalness: 0.88 });
    const trimMat = makeMat({ color: 0x8ea9c9, roughness: 0.24, metalness: 0.86 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffb829 });

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), shellMat);
    sphere.position.y = 0.82;
    sphere.castShadow = true;
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.1, 8), trimMat);
    capTop.position.y = 1.12;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), eyeMat);
    eye.position.set(0, 0.82, 0.28);
    const coreMesh = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.04, 6, 16), eyeMat);
    coreMesh.position.y = 0.82;
    coreMesh.rotation.x = Math.PI * 0.42;
    body.add(sphere, capTop, eye, coreMesh);

    return { root, body, coreMesh, flashMaterials };
  }

  if (kind === 'alien_saucer') {
    addContactShadow(root, shadowMap, 0.54);
    // Agile Miniature Scout UFO Saucer with Emerald Dome & Rim Lights
    const hullMat = makeMat({ color: 0x2b364a, roughness: 0.2, metalness: 0.9 });
    const rimMat = makeMat({ color: 0xc2d8ed, roughness: 0.22, metalness: 0.88 });
    const domeMat = makeMat({
      color: 0x22d976,
      emissive: 0x16a856,
      emissiveIntensity: 0.5,
      roughness: 0.14,
      metalness: 0.2,
    });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x5eff9e });

    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.56, 0.16, 12), hullMat);
    disc.position.y = 1.02;
    disc.castShadow = true;
    const lowerDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.22, 0.12, 12), rimMat);
    lowerDisc.position.y = 0.9;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), domeMat);
    dome.scale.set(1, 0.72, 1);
    dome.position.y = 1.14;
    const coreMesh = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.032, 6, 16), lightMat);
    coreMesh.position.y = 0.96;
    coreMesh.rotation.x = Math.PI / 2;
    body.add(disc, lowerDisc, dome, coreMesh);

    return { root, body, coreMesh, flashMaterials };
  }

  if (kind === 'alien_gunner') {
    addContactShadow(root, shadowMap, 0.48);
    // Classic Tall Grey-Green Alien Marksman in Charcoal Flight Suit with Lime Plasma Rifle
    const suitMat = makeMat({ color: 0x1f2533, roughness: 0.42, metalness: 0.55 });
    const skinMat = makeMat({ color: 0x76b87b, roughness: 0.48, metalness: 0.08 });
    const gunMat = makeMat({ color: 0x414f66, roughness: 0.28, metalness: 0.82 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0b0f17 });
    const plasmaMat = new THREE.MeshBasicMaterial({ color: 0x5eff6b });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.11, 0.42, 0);
    const ll = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.11), suitMat);
    ll.position.y = -0.21;
    ll.castShadow = true;
    leftLeg.add(ll);
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.11, 0.42, 0);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.11), suitMat);
    rl.position.y = -0.21;
    rl.castShadow = true;
    rightLeg.add(rl);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.44, 0.2), suitMat);
    torso.position.y = 0.66;
    torso.castShadow = true;
    // Iconic bulbous alien head with large slanted black almond eyes
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), skinMat);
    head.scale.set(0.95, 1.18, 1.05);
    head.position.y = 1.1;
    head.castShadow = true;
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.05), eyeMat);
    eyeL.position.set(-0.09, 1.08, 0.21);
    eyeL.rotation.z = -0.32;
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.05), eyeMat);
    eyeR.position.set(0.09, 1.08, 0.21);
    eyeR.rotation.z = 0.32;
    body.add(torso, head, eyeL, eyeR);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.22, 0.78, 0.04);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.32), suitMat);
    arm.position.z = 0.12;
    const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.54), gunMat);
    rifle.position.set(0, 0.02, 0.38);
    const coreMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.32), plasmaMat);
    coreMesh.position.set(0, 0.06, 0.46);
    weaponArm.add(arm, rifle, coreMesh);
    body.add(weaponArm);

    return { root, body, leftLeg, rightLeg, weaponArm, coreMesh, flashMaterials };
  }

  if (kind === 'alien_psion') {
    addContactShadow(root, shadowMap, 0.5);
    // Levitating High-Mind Alien Psion in Deep Violet Robes, Gold Collar & Magenta Ion Ring
    const robeMat = makeMat({ color: 0x3b1d5e, roughness: 0.48, metalness: 0.35 });
    const goldMat = makeMat({ color: 0xf2c14e, roughness: 0.25, metalness: 0.88 });
    const skinMat = makeMat({ color: 0xa495d6, roughness: 0.42, metalness: 0.12 });
    const psiMat = new THREE.MeshBasicMaterial({ color: 0xff5ce6 });

    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.36, 0.62, 7), robeMat);
    robe.position.y = 0.62;
    robe.castShadow = true;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 6, 12), goldMat);
    collar.position.y = 0.94;
    collar.rotation.x = Math.PI / 2;
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 10), skinMat);
    cranium.scale.set(1.02, 1.28, 1.12);
    cranium.position.y = 1.24;
    cranium.castShadow = true;
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.05), psiMat);
    eyeL.position.set(-0.09, 1.2, 0.25);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.05), psiMat);
    eyeR.position.set(0.09, 1.2, 0.25);
    body.add(robe, collar, cranium, eyeL, eyeR);

    const coreMesh = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.032, 6, 16), psiMat);
    coreMesh.position.y = 1.28;
    coreMesh.rotation.x = Math.PI * 0.38;
    body.add(coreMesh);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.28, 0.88, 0.12);
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), psiMat);
    orb.position.set(0.08, 0.04, 0.22);
    weaponArm.add(orb);
    body.add(weaponArm);

    return { root, body, weaponArm, coreMesh, flashMaterials };
  }

  if (kind === 'alien_mech') {
    addContactShadow(root, shadowMap, 0.8);
    // Heavy Crimson & Gunmetal Starship Security Mech Guardian
    const chassisMat = makeMat({ color: 0x262c3a, roughness: 0.3, metalness: 0.86 });
    const crimsonMat = makeMat({ color: 0xb8293d, roughness: 0.28, metalness: 0.72 });
    const chromeMat = makeMat({ color: 0xcfe2f5, roughness: 0.2, metalness: 0.9 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.22, 0.46, 0);
    const ll = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.46, 0.24), chassisMat);
    ll.position.y = -0.23;
    ll.castShadow = true;
    leftLeg.add(ll);
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.22, 0.46, 0);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.46, 0.24), chassisMat);
    rl.position.y = -0.23;
    rl.castShadow = true;
    rightLeg.add(rl);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.62, 0.46), crimsonMat);
    torso.position.y = 0.82;
    torso.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.08), glowMat);
    visor.position.set(0, 0.94, 0.24);
    const podL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.32), chassisMat);
    podL.position.set(-0.42, 1.18, 0);
    const podR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.32), chassisMat);
    podR.position.set(0.42, 1.18, 0);
    body.add(torso, visor, podL, podR);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.44, 0.88, 0);
    const piston = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.16), chromeMat);
    piston.position.y = -0.16;
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.42), chassisMat);
    hammer.position.set(0, -0.34, 0.34);
    hammer.castShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.1), glowMat);
    edge.position.set(0, -0.34, 0.55);
    weaponArm.add(piston, hammer, edge);
    body.add(weaponArm);

    body.scale.setScalar(1.34);
    return { root, body, leftLeg, rightLeg, weaponArm, flashMaterials };
  }

  // === CAVERN BOSSES (Depths 11-20) ===
  if (kind === 'boss_crystal_wyrm') {
    addContactShadow(root, shadowMap, 1.38);
    const auraRing = new THREE.Mesh(
      new THREE.RingGeometry(1.06, 1.32, 24),
      new THREE.MeshBasicMaterial({
        color: 0x3be8ff,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.04;
    root.add(auraRing);

    const basaltMat = makeMat({ color: 0x2a2d36, roughness: 0.88, metalness: 0.14 });
    const prismMat = makeMat({
      color: 0x3fd8ff,
      emissive: 0x1a9ac4,
      emissiveIntensity: 0.65,
      roughness: 0.18,
      metalness: 0.32,
      flatShading: true,
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xa6f9ff });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.24, 0.44, 0);
    const lStump = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.46, 0.3), basaltMat);
    lStump.position.y = -0.22;
    lStump.castShadow = true;
    leftLeg.add(lStump);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.24, 0.44, 0);
    const rStump = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.46, 0.3), basaltMat);
    rStump.position.y = -0.22;
    rStump.castShadow = true;
    rightLeg.add(rStump);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(0.46, 0), basaltMat);
    torso.scale.set(1.22, 1.15, 0.96);
    torso.position.y = 0.86;
    torso.castShadow = true;
    body.add(torso);

    const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), glowMat);
    coreMesh.position.set(0, 0.88, 0.36);
    body.add(coreMesh);

    const shL = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.62, 5), prismMat);
    shL.position.set(-0.48, 1.24, -0.04);
    shL.rotation.z = 0.45;
    shL.castShadow = true;
    const shR = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.62, 5), prismMat);
    shR.position.set(0.48, 1.24, -0.04);
    shR.rotation.z = -0.45;
    shR.castShadow = true;
    body.add(shL, shR);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.4), basaltMat);
    head.position.set(0, 1.38, 0.08);
    head.castShadow = true;
    const crownShard = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.44, 4), prismMat);
    crownShard.position.set(0, 1.66, 0.06);
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.05), glowMat);
    eyeL.position.set(-0.1, 1.4, 0.28);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.05), glowMat);
    eyeR.position.set(0.1, 1.4, 0.28);
    body.add(head, crownShard, eyeL, eyeR);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.54, 1.0, 0);
    const rArmRock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.44, 0.22), basaltMat);
    rArmRock.position.y = -0.2;
    const rBlade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.72, 4), prismMat);
    rBlade.position.set(0, -0.42, 0.28);
    rBlade.rotation.x = Math.PI * 0.46;
    rBlade.castShadow = true;
    weaponArm.add(rArmRock, rBlade);

    const leftArm = new THREE.Group();
    leftArm.position.set(-0.54, 1.0, 0);
    const lArmRock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.44, 0.22), basaltMat);
    lArmRock.position.y = -0.2;
    const lBlade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.72, 4), prismMat);
    lBlade.position.set(0, -0.42, 0.28);
    lBlade.rotation.x = Math.PI * 0.46;
    lBlade.castShadow = true;
    leftArm.add(lArmRock, lBlade);
    body.add(weaponArm, leftArm);

    body.scale.setScalar(1.68);
    return { root, body, leftLeg, rightLeg, leftArm, weaponArm, coreMesh, auraRing, flashMaterials };
  }

  if (kind === 'boss_fungal_king') {
    addContactShadow(root, shadowMap, 1.38);
    const auraRing = new THREE.Mesh(
      new THREE.RingGeometry(1.06, 1.34, 24),
      new THREE.MeshBasicMaterial({
        color: 0x4ef58a,
        transparent: true,
        opacity: 0.58,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.04;
    root.add(auraRing);

    const stalkMat = makeMat({ color: 0xc2b89a, roughness: 0.85, metalness: 0.04 });
    const capMat = makeMat({ color: 0x1d5c46, roughness: 0.58, metalness: 0.08 });
    const mossMat = makeMat({ color: 0x334733, roughness: 0.9, metalness: 0.05 });
    const sporeMat = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.22, 0.4, 0);
    const lRoot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.42, 6), stalkMat);
    lRoot.position.y = -0.2;
    lRoot.castShadow = true;
    leftLeg.add(lRoot);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.22, 0.4, 0);
    const rRoot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.42, 6), stalkMat);
    rRoot.position.y = -0.2;
    rRoot.castShadow = true;
    rightLeg.add(rRoot);
    body.add(leftLeg, rightLeg);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.44, 0.78, 8), stalkMat);
    trunk.position.y = 0.78;
    trunk.castShadow = true;
    body.add(trunk);

    const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), sporeMat);
    coreMesh.position.set(0, 0.84, 0.34);
    body.add(coreMesh);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.76, 0.54, 10), capMat);
    cap.position.y = 1.46;
    cap.castShadow = true;
    const gills = new THREE.Mesh(
      new THREE.CylinderGeometry(0.68, 0.42, 0.1, 10),
      new THREE.MeshBasicMaterial({ color: 0x45e88a })
    );
    gills.position.y = 1.18;
    body.add(cap, gills);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), sporeMat);
      spot.position.set(Math.cos(a) * 0.46, 1.38 + (i % 2) * 0.08, Math.sin(a) * 0.46);
      body.add(spot);
    }

    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), sporeMat);
    eyeL.position.set(-0.12, 1.04, 0.34);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), sporeMat);
    eyeR.position.set(0.12, 1.04, 0.34);
    body.add(eyeL, eyeR);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.46, 0.92, 0);
    const rVine = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.56, 6), mossMat);
    rVine.position.y = -0.24;
    const rBulb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), sporeMat);
    rBulb.position.set(0, -0.52, 0.16);
    weaponArm.add(rVine, rBulb);

    const leftArm = new THREE.Group();
    leftArm.position.set(-0.46, 0.92, 0);
    const lVine = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.56, 6), mossMat);
    lVine.position.y = -0.24;
    const lBulb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), sporeMat);
    lBulb.position.set(0, -0.52, 0.16);
    leftArm.add(lVine, lBulb);
    body.add(weaponArm, leftArm);

    body.scale.setScalar(1.64);
    return { root, body, leftLeg, rightLeg, leftArm, weaponArm, coreMesh, auraRing, flashMaterials };
  }

  // === MONSTER INTERIOR BOSSES (Depths 21-30, Pink & Purple) ===
  if (kind === 'boss_leviathan_heart') {
    addContactShadow(root, shadowMap, 1.42);
    const auraRing = new THREE.Mesh(
      new THREE.RingGeometry(1.08, 1.36, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff8826,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.04;
    root.add(auraRing);

    // Arterial Scarlet-Crimson & Molten Gold-Ivory (contrasts sharply with purple flesh walls)
    const muscleMat = makeMat({ color: 0xb81f1f, roughness: 0.4, metalness: 0.08 });
    const veinMat = makeMat({ color: 0x5c1410, roughness: 0.48, metalness: 0.1 });
    const boneMat = makeMat({ color: 0xf7efd8, roughness: 0.64, metalness: 0.06 });
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffc83b });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.24, 0.44, 0);
    const lLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.46, 7), veinMat);
    lLeg.position.y = -0.22;
    lLeg.castShadow = true;
    leftLeg.add(lLeg);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.24, 0.44, 0);
    const rLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.46, 7), veinMat);
    rLeg.position.y = -0.22;
    rLeg.castShadow = true;
    rightLeg.add(rLeg);
    body.add(leftLeg, rightLeg);

    const heartBody = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48, 1), muscleMat);
    heartBody.scale.set(1.12, 1.24, 0.98);
    heartBody.position.y = 0.94;
    heartBody.castShadow = true;
    body.add(heartBody);

    const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), pulseMat);
    coreMesh.position.set(0, 0.96, 0.36);
    body.add(coreMesh);

    // Protruding Ivory Ribcage Armor
    for (let i = 0; i < 3; i++) {
      const y = 0.72 + i * 0.2;
      const ribL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.14), boneMat);
      ribL.position.set(-0.34, y, 0.2);
      ribL.rotation.y = 0.45;
      const ribR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.14), boneMat);
      ribR.position.set(0.34, y, 0.2);
      ribR.rotation.y = -0.45;
      body.add(ribL, ribR);
    }

    // Crown of Aortic Vessels
    for (let i = -1; i <= 1; i++) {
      const vessel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.38, 6), veinMat);
      vessel.position.set(i * 0.2, 1.56, 0);
      vessel.rotation.z = -i * 0.25;
      body.add(vessel);
    }

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.54, 1.02, 0);
    const rSinew = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.56, 0.24), muscleMat);
    rSinew.position.y = -0.24;
    const rClaw = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.52, 5), boneMat);
    rClaw.position.set(0, -0.52, 0.18);
    rClaw.rotation.x = Math.PI * 0.4;
    rClaw.castShadow = true;
    weaponArm.add(rSinew, rClaw);

    const leftArm = new THREE.Group();
    leftArm.position.set(-0.54, 1.02, 0);
    const lSinew = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.56, 0.24), muscleMat);
    lSinew.position.y = -0.24;
    const lClaw = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.52, 5), boneMat);
    lClaw.position.set(0, -0.52, 0.18);
    lClaw.rotation.x = Math.PI * 0.4;
    lClaw.castShadow = true;
    leftArm.add(lSinew, lClaw);
    body.add(weaponArm, leftArm);

    body.scale.setScalar(1.7);
    return { root, body, leftLeg, rightLeg, leftArm, weaponArm, coreMesh, auraRing, flashMaterials };
  }

  if (kind === 'boss_abyssal_brain') {
    addContactShadow(root, shadowMap, 1.38);
    const auraRing = new THREE.Mesh(
      new THREE.RingGeometry(1.06, 1.36, 24),
      new THREE.MeshBasicMaterial({
        color: 0x36f5d4,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.04;
    root.add(auraRing);

    // Bioluminescent Jade-Teal & Electric Lime-Gold (high contrast against pink-purple viscera)
    const cortexMat = makeMat({ color: 0x42b5a2, roughness: 0.34, metalness: 0.08 });
    const nerveMat = makeMat({ color: 0x154d59, roughness: 0.48, metalness: 0.12 });
    const psiMat = new THREE.MeshBasicMaterial({ color: 0xc8ff4d });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x091c22 });

    // Twin Sculpted Cerebral Lobes
    const lobeL = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 1), cortexMat);
    lobeL.scale.set(0.95, 1.05, 1.24);
    lobeL.position.set(-0.24, 1.18, 0);
    lobeL.castShadow = true;
    const lobeR = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 1), cortexMat);
    lobeR.scale.set(0.95, 1.05, 1.24);
    lobeR.position.set(0.24, 1.18, 0);
    lobeR.castShadow = true;
    body.add(lobeL, lobeR);

    // Central Psychic Eye
    const eyeSocket = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), psiMat);
    eyeSocket.position.set(0, 1.06, 0.36);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, 0.08), pupilMat);
    pupil.position.set(0, 1.06, 0.56);
    body.add(eyeSocket, pupil);

    const coreMesh = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.045, 6, 18), psiMat);
    coreMesh.rotation.x = Math.PI * 0.42;
    coreMesh.position.y = 1.24;
    body.add(coreMesh);

    // Hanging Optic Nerve Tendrils
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tendril = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.025, 0.62, 5), nerveMat);
      tendril.position.set(Math.cos(a) * 0.28, 0.56, Math.sin(a) * 0.28);
      tendril.rotation.z = Math.cos(a) * 0.2;
      body.add(tendril);
    }

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.58, 0.96, 0);
    const rNerve = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 0.56, 6), nerveMat);
    rNerve.position.y = -0.22;
    const rOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), psiMat);
    rOrb.position.set(0, -0.5, 0.14);
    weaponArm.add(rNerve, rOrb);

    const leftArm = new THREE.Group();
    leftArm.position.set(-0.58, 0.96, 0);
    const lNerve = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 0.56, 6), nerveMat);
    lNerve.position.y = -0.22;
    const lOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), psiMat);
    lOrb.position.set(0, -0.5, 0.14);
    leftArm.add(lNerve, lOrb);
    body.add(weaponArm, leftArm);

    body.scale.setScalar(1.66);
    return { root, body, leftArm, weaponArm, coreMesh, auraRing, flashMaterials };
  }

  // === CAVERN MOBS (Depths 11-20) ===
  if (kind === 'cavern_beetle') {
    addContactShadow(root, shadowMap, 0.6);
    const shellMat = makeMat({ color: 0x2c3442, roughness: 0.38, metalness: 0.45 });
    const crystalMat = makeMat({
      color: 0x3be0ff,
      emissive: 0x178cb5,
      emissiveIntensity: 0.55,
      roughness: 0.2,
      metalness: 0.3,
      flatShading: true,
    });
    const legMat = makeMat({ color: 0x1d222b, roughness: 0.72, metalness: 0.2 });

    const carapace = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.36, 0.82), shellMat);
    carapace.position.y = 0.34;
    carapace.castShadow = true;
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.64), shellMat);
    ridge.position.y = 0.56;
    ridge.castShadow = true;
    body.add(carapace, ridge);

    // Glowing dorsal crystal spikes
    const coreMesh = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 4), crystalMat);
    coreMesh.position.set(0, 0.78, -0.05);
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), crystalMat);
    c2.position.set(-0.18, 0.68, -0.14);
    c2.rotation.z = 0.35;
    const c3 = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), crystalMat);
    c3.position.set(0.18, 0.68, -0.14);
    c3.rotation.z = -0.35;
    body.add(coreMesh, c2, c3);

    // Mandibles & glowing eyes
    const mandL = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.26, 4), crystalMat);
    mandL.rotation.x = Math.PI * 0.45;
    mandL.position.set(-0.16, 0.26, 0.5);
    const mandR = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.26, 4), crystalMat);
    mandR.rotation.x = Math.PI * 0.45;
    mandR.position.set(0.16, 0.26, 0.5);
    body.add(mandL, mandR);

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.36, 0.22, 0);
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.36, 0.22, 0);
    for (let i = -1; i <= 1; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), legMat);
      l.position.set(-0.08, -0.1, i * 0.24);
      leftLeg.add(l);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), legMat);
      r.position.set(0.08, -0.1, i * 0.24);
      rightLeg.add(r);
    }
    body.add(leftLeg, rightLeg);
    return { root, body, leftLeg, rightLeg, coreMesh, flashMaterials };
  }

  if (kind === 'cavern_golem') {
    addContactShadow(root, shadowMap, 0.64);
    const rockMat = makeMat({ color: 0x4c4743, roughness: 0.92, metalness: 0.08 });
    const crystalMat = makeMat({
      color: 0x46f0d2,
      emissive: 0x1ca68f,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      flatShading: true,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9effec });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.18, 0.4, 0);
    const lFoot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.24), rockMat);
    lFoot.position.y = -0.2;
    lFoot.castShadow = true;
    leftLeg.add(lFoot);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.18, 0.4, 0);
    const rFoot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.24), rockMat);
    rFoot.position.y = -0.2;
    rFoot.castShadow = true;
    rightLeg.add(rFoot);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(0.38, 0), rockMat);
    torso.scale.set(1.18, 1.05, 0.92);
    torso.position.y = 0.78;
    torso.castShadow = true;
    body.add(torso);

    const coreMesh = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.36, 4), crystalMat);
    coreMesh.position.set(-0.28, 1.12, -0.06);
    coreMesh.rotation.z = 0.35;
    const shardR = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), crystalMat);
    shardR.position.set(0.26, 1.08, -0.06);
    shardR.rotation.z = -0.3;
    body.add(coreMesh, shardR);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.32), rockMat);
    head.position.set(0, 1.18, 0.06);
    head.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), eyeMat);
    visor.position.set(0, 1.19, 0.22);
    body.add(head, visor);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.42, 0.88, 0);
    const rFist = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.48, 0.24), rockMat);
    rFist.position.y = -0.22;
    rFist.castShadow = true;
    weaponArm.add(rFist);

    const lFist = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.46, 0.22), rockMat);
    lFist.position.set(-0.42, 0.66, 0.04);
    lFist.castShadow = true;
    body.add(weaponArm, lFist);

    return { root, body, leftLeg, rightLeg, weaponArm, coreMesh, flashMaterials };
  }

  if (kind === 'cavern_bat') {
    addContactShadow(root, shadowMap, 0.46);
    const furMat = makeMat({ color: 0x3b2d4a, roughness: 0.78, metalness: 0.06 });
    const wingMat = makeMat({ color: 0x261d33, roughness: 0.72, metalness: 0.1, side: THREE.DoubleSide });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffc84a });

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), furMat);
    torso.scale.set(0.95, 1.15, 0.9);
    torso.position.y = 0.95;
    torso.castShadow = true;
    body.add(torso);

    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 4), furMat);
    earL.position.set(-0.12, 1.24, 0.04);
    const earR = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 4), furMat);
    earR.position.set(0.12, 1.24, 0.04);
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), eyeMat);
    eyeL.position.set(-0.08, 1.0, 0.21);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), eyeMat);
    eyeR.position.set(0.08, 1.0, 0.21);
    body.add(earL, earR, eyeL, eyeR);

    const leftArm = new THREE.Group();
    leftArm.position.set(-0.18, 0.98, 0);
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.34), wingMat);
    wingL.position.set(-0.29, 0, -0.04);
    wingL.castShadow = true;
    leftArm.add(wingL);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.18, 0.98, 0);
    const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.34), wingMat);
    wingR.position.set(0.29, 0, -0.04);
    wingR.castShadow = true;
    weaponArm.add(wingR);
    body.add(leftArm, weaponArm);

    return { root, body, leftArm, weaponArm, flashMaterials };
  }

  if (kind === 'cavern_spitter') {
    addContactShadow(root, shadowMap, 0.5);
    const scaleMat = makeMat({ color: 0x2d4a52, roughness: 0.65, metalness: 0.14 });
    const bellyMat = makeMat({ color: 0x456870, roughness: 0.78 });
    const shardMat = new THREE.MeshBasicMaterial({ color: 0x5cf5ff });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.14, 0.38, 0);
    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.14), scaleMat);
    lLeg.position.y = -0.19;
    leftLeg.add(lLeg);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.14, 0.38, 0);
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.14), scaleMat);
    rLeg.position.y = -0.19;
    rightLeg.add(rLeg);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.44, 0.36), scaleMat);
    torso.position.y = 0.64;
    torso.rotation.x = 0.22;
    torso.castShadow = true;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.12), bellyMat);
    chest.position.set(0, 0.62, 0.16);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.44, 5), scaleMat);
    tail.rotation.x = -Math.PI * 0.42;
    tail.position.set(0, 0.44, -0.32);
    body.add(torso, chest, tail);

    // Glowing dorsal crystal spines
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 4), shardMat);
      sp.position.set(0, 0.92 - i * 0.12, -0.12 - i * 0.08);
      sp.rotation.x = -0.45;
      body.add(sp);
    }

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.34), scaleMat);
    head.position.set(0, 0.98, 0.16);
    head.castShadow = true;
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), shardMat);
    eyeL.position.set(-0.1, 1.01, 0.32);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), shardMat);
    eyeR.position.set(0.1, 1.01, 0.32);
    body.add(head, eyeL, eyeR);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.24, 0.78, 0.12);
    const launcher = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.36), scaleMat);
    launcher.position.z = 0.16;
    const coreMesh = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 4), shardMat);
    coreMesh.rotation.x = Math.PI / 2;
    coreMesh.position.set(0, 0, 0.36);
    weaponArm.add(launcher, coreMesh);
    body.add(weaponArm);

    return { root, body, leftLeg, rightLeg, weaponArm, coreMesh, flashMaterials };
  }

  if (kind === 'cavern_shaman') {
    addContactShadow(root, shadowMap, 0.52);
    const robeMat = makeMat({ color: 0x2b3b36, roughness: 0.85 });
    const capMat = makeMat({ color: 0x226952, roughness: 0.56 });
    const woodMat = makeMat({ color: 0x5c422c, roughness: 0.88 });
    const sporeMat = new THREE.MeshBasicMaterial({ color: 0x6ef7a2 });

    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.88, 7), robeMat);
    robe.position.y = 0.44;
    robe.castShadow = true;
    body.add(robe);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.34, 8), capMat);
    cap.position.y = 1.12;
    cap.castShadow = true;
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), sporeMat);
    eyeL.position.set(-0.08, 0.9, 0.2);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), sporeMat);
    eyeR.position.set(0.08, 0.9, 0.2);
    body.add(cap, eyeL, eyeR);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 5), sporeMat);
      dot.position.set(Math.cos(a) * 0.26, 1.08, Math.sin(a) * 0.26);
      body.add(dot);
    }

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.3, 0.78, 0.06);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.15, 6), woodMat);
    staff.position.y = 0.05;
    const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), sporeMat);
    coreMesh.position.y = 0.68;
    weaponArm.add(staff, coreMesh);
    body.add(weaponArm);

    return { root, body, weaponArm, coreMesh, flashMaterials };
  }

  if (kind === 'cavern_warden') {
    addContactShadow(root, shadowMap, 0.78);
    const stoneMat = makeMat({ color: 0x262933, roughness: 0.78, metalness: 0.28 });
    const crystalMat = makeMat({
      color: 0x3be0ff,
      emissive: 0x168db8,
      emissiveIntensity: 0.6,
      roughness: 0.22,
      flatShading: true,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x99f8ff });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.18, 0.42, 0);
    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.2), stoneMat);
    lLeg.position.y = -0.2;
    leftLeg.add(lLeg);
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.18, 0.42, 0);
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.2), stoneMat);
    rLeg.position.y = -0.2;
    rightLeg.add(rLeg);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.36), stoneMat);
    torso.position.y = 0.74;
    torso.castShadow = true;
    const shL = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 4), crystalMat);
    shL.position.set(-0.34, 1.08, 0);
    shL.rotation.z = 0.4;
    const shR = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 4), crystalMat);
    shR.position.set(0.34, 1.08, 0);
    shR.rotation.z = -0.4;
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.34), stoneMat);
    helm.position.y = 1.2;
    helm.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.05), eyeMat);
    visor.position.set(0, 1.2, 0.18);
    body.add(torso, shL, shR, helm, visor);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.36, 0.88, 0);
    const club = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.86, 5), crystalMat);
    club.position.set(0, -0.34, 0.3);
    club.rotation.x = Math.PI * 0.44;
    club.castShadow = true;
    weaponArm.add(club);
    body.add(weaponArm);

    body.scale.setScalar(1.34);
    return { root, body, leftLeg, rightLeg, weaponArm, flashMaterials };
  }

  // === MONSTER INTERIOR MOBS (Depths 21-30, High-Contrast Non-Purple Biological Palettes) ===
  if (kind === 'flesh_cell') {
    addContactShadow(root, shadowMap, 0.58);
    // Acid Bile Lime-Green cell (contrasts starkly with purple flesh terrain)
    const membraneMat = makeMat({
      color: 0x8ae635,
      emissive: 0x3b8c14,
      emissiveIntensity: 0.3,
      roughness: 0.22,
      metalness: 0.06,
      transparent: true,
      opacity: 0.86,
    });
    const nucleusMat = new THREE.MeshBasicMaterial({ color: 0xf2ff7a });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x172b09 });

    const dome = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 1), membraneMat);
    dome.scale.set(1.08, 0.86, 1.08);
    dome.position.y = 0.4;
    dome.castShadow = true;
    body.add(dome);

    const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), nucleusMat);
    coreMesh.position.y = 0.42;
    body.add(coreMesh);

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
    eyeL.position.set(-0.14, 0.46, 0.39);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
    eyeR.position.set(0.14, 0.46, 0.39);
    body.add(eyeL, eyeR);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      const nub = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), membraneMat);
      nub.position.set(Math.cos(a) * 0.42, 0.26, Math.sin(a) * 0.42);
      body.add(nub);
    }

    return { root, body, coreMesh, flashMaterials };
  }

  if (kind === 'flesh_tendril') {
    addContactShadow(root, shadowMap, 0.56);
    // Gastric Amber-Orange & Rust Stalker
    const muscleMat = makeMat({ color: 0xd96b20, roughness: 0.44, metalness: 0.08 });
    const darkMat = makeMat({ color: 0x6e2c10, roughness: 0.52 });
    const toothMat = makeMat({ color: 0xf5ebd6, roughness: 0.65 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffe054 });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.15, 0.4, 0);
    const lLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.42, 6), darkMat);
    lLeg.position.y = -0.2;
    leftLeg.add(lLeg);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.15, 0.4, 0);
    const rLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.42, 6), darkMat);
    rLeg.position.y = -0.2;
    rightLeg.add(rLeg);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.6, 7), muscleMat);
    torso.position.y = 0.72;
    torso.castShadow = true;
    const maw = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 6, 10), darkMat);
    maw.position.set(0, 1.06, 0.12);
    const mawGlow = new THREE.Mesh(new THREE.CircleGeometry(0.14, 8), glowMat);
    mawGlow.position.set(0, 1.06, 0.13);
    body.add(torso, maw, mawGlow);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), toothMat);
      tooth.position.set(Math.cos(a) * 0.15, 1.06 + Math.sin(a) * 0.15, 0.18);
      tooth.rotation.x = Math.PI / 2;
      body.add(tooth);
    }

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.28, 0.86, 0);
    const whipR = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.66, 5), darkMat);
    whipR.position.set(0, -0.26, 0.2);
    whipR.rotation.x = Math.PI * 0.4;
    weaponArm.add(whipR);

    const whipL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.58, 5), darkMat);
    whipL.position.set(-0.28, 0.64, 0.14);
    whipL.rotation.x = Math.PI * 0.35;
    body.add(weaponArm, whipL);

    return { root, body, leftLeg, rightLeg, weaponArm, flashMaterials };
  }

  if (kind === 'flesh_parasite') {
    addContactShadow(root, shadowMap, 0.46);
    // Deep Bio-Teal Chitin & Translucent Cyan-Mint Wings
    const chitinMat = makeMat({ color: 0x1a5c66, roughness: 0.34, metalness: 0.28 });
    const wingMat = makeMat({
      color: 0x6ef7e8,
      transparent: true,
      opacity: 0.75,
      roughness: 0.2,
      side: THREE.DoubleSide,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe44d });

    const bodySeg = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), chitinMat);
    bodySeg.scale.set(0.9, 0.85, 1.45);
    bodySeg.position.y = 0.96;
    bodySeg.castShadow = true;
    const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 5), chitinMat);
    stinger.rotation.x = -Math.PI * 0.65;
    stinger.position.set(0, 0.82, -0.34);
    const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 6), eyeMat);
    coreMesh.position.set(0, 1.0, 0.26);
    body.add(bodySeg, stinger, coreMesh);

    const leftArm = new THREE.Group();
    leftArm.position.set(-0.16, 1.06, 0);
    const wL = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.03, 0.24), wingMat);
    wL.position.x = -0.26;
    leftArm.add(wL);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.16, 1.06, 0);
    const wR = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.03, 0.24), wingMat);
    wR.position.x = 0.26;
    weaponArm.add(wR);
    body.add(leftArm, weaponArm);

    return { root, body, leftArm, weaponArm, coreMesh, flashMaterials };
  }

  if (kind === 'flesh_spiner') {
    addContactShadow(root, shadowMap, 0.5);
    // Calcified Sandstone-Ochre & Stark Ivory Bone Spiner
    const fleshMat = makeMat({ color: 0xb88b54, roughness: 0.45, metalness: 0.08 });
    const boneMat = makeMat({ color: 0xf7f2df, roughness: 0.64 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x42ffe8 });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.14, 0.38, 0);
    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.38, 0.12), fleshMat);
    lLeg.position.y = -0.19;
    leftLeg.add(lLeg);
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.14, 0.38, 0);
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.38, 0.12), fleshMat);
    rLeg.position.y = -0.19;
    rightLeg.add(rLeg);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.32), fleshMat);
    torso.position.y = 0.66;
    torso.rotation.x = 0.2;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.28), fleshMat);
    head.position.set(0, 1.0, 0.1);
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.05), eyeMat);
    eyeL.position.set(-0.08, 1.02, 0.24);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.05), eyeMat);
    eyeR.position.set(0.08, 1.02, 0.24);
    body.add(torso, head, eyeL, eyeR);

    // Protruding bone spines along back
    for (let i = 0; i < 3; i++) {
      const spine = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.28, 4), boneMat);
      spine.position.set(0, 0.94 - i * 0.13, -0.16 - i * 0.04);
      spine.rotation.x = -0.55;
      body.add(spine);
    }

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.24, 0.78, 0.08);
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.34), fleshMat);
    armMesh.position.z = 0.14;
    const coreMesh = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.34, 4), boneMat);
    coreMesh.rotation.x = Math.PI / 2;
    coreMesh.position.set(0, 0, 0.36);
    weaponArm.add(armMesh, coreMesh);
    body.add(weaponArm);

    return { root, body, leftLeg, rightLeg, weaponArm, coreMesh, flashMaterials };
  }

  if (kind === 'flesh_eye') {
    addContactShadow(root, shadowMap, 0.5);
    // Pale Mint-Ivory Sclera & Electric Emerald-Cyan Iris
    const scleraMat = makeMat({ color: 0xe6f7ec, roughness: 0.26, metalness: 0.05 });
    const nerveMat = makeMat({ color: 0x155752, roughness: 0.48 });
    const irisMat = new THREE.MeshBasicMaterial({ color: 0x26f5b8 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x072129 });

    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 12), scleraMat);
    orb.position.y = 1.02;
    orb.castShadow = true;
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), irisMat);
    iris.position.set(0, 1.02, 0.355);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.04), pupilMat);
    pupil.position.set(0, 1.02, 0.365);
    body.add(orb, iris, pupil);

    const coreMesh = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 6, 16), irisMat);
    coreMesh.position.y = 1.02;
    body.add(coreMesh);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0, 0.72, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.44, 5), nerveMat);
      tail.position.set(Math.cos(a) * 0.16, -0.18, Math.sin(a) * 0.16);
      weaponArm.add(tail);
    }
    body.add(weaponArm);

    return { root, body, weaponArm, coreMesh, flashMaterials };
  }

  if (kind === 'flesh_brute') {
    addContactShadow(root, shadowMap, 0.78);
    // Olive-Bronze Carapace & Calcified Ivory Rib Armor
    const muscleMat = makeMat({ color: 0x5c5326, roughness: 0.44, metalness: 0.14 });
    const boneMat = makeMat({ color: 0xf5eedc, roughness: 0.62 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffaa2b });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.2, 0.44, 0);
    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.44, 0.22), muscleMat);
    lLeg.position.y = -0.22;
    leftLeg.add(lLeg);
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.2, 0.44, 0);
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.44, 0.22), muscleMat);
    rLeg.position.y = -0.22;
    rightLeg.add(rLeg);
    body.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.38), muscleMat);
    torso.position.y = 0.76;
    torso.castShadow = true;
    const ribL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.42), boneMat);
    ribL.position.set(-0.34, 1.0, 0);
    const ribR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.42), boneMat);
    ribR.position.set(0.34, 1.0, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.32, 0.34), muscleMat);
    head.position.y = 1.2;
    head.castShadow = true;
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.05), eyeMat);
    eyeL.position.set(-0.09, 1.22, 0.17);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.05), eyeMat);
    eyeR.position.set(0.09, 1.22, 0.17);
    body.add(torso, ribL, ribR, head, eyeL, eyeR);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.38, 0.9, 0);
    const cleaver = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.86, 0.08), boneMat);
    cleaver.position.set(0, -0.34, 0.3);
    cleaver.rotation.x = Math.PI * 0.44;
    cleaver.castShadow = true;
    weaponArm.add(cleaver);
    body.add(weaponArm);

    body.scale.setScalar(1.34);
    return { root, body, leftLeg, rightLeg, weaponArm, flashMaterials };
  }

  if (kind === 'slime') {
    addContactShadow(root, shadowMap, 0.58);
    const slimeColor = biome.id === 'ossuary' ? 0x9b5de5 : 0x45d66b;
    const coreColor = biome.id === 'ossuary' ? 0xf2c6ff : 0xdcff78;

    const outerMat = makeMat({
      color: slimeColor,
      emissive: slimeColor,
      emissiveIntensity: 0.22,
      roughness: 0.18,
      metalness: 0.05,
      transparent: true,
      opacity: 0.84,
    });

    const dome = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.66, 0.84), outerMat);
    dome.position.y = 0.34;
    dome.castShadow = true;
    body.add(dome);

    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.22, 0.64), outerMat);
    crown.position.y = 0.72;
    crown.castShadow = true;
    body.add(crown);

    const coreMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshBasicMaterial({ color: coreColor })
    );
    coreMesh.position.y = 0.36;
    body.add(coreMesh);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x101418 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.06), eyeMat);
    eyeL.position.set(-0.18, 0.42, 0.42);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.06), eyeMat);
    eyeR.position.set(0.18, 0.42, 0.42);
    body.add(eyeL, eyeR);

    return { root, body, coreMesh, flashMaterials };
  }

  if (kind === 'wisp') {
    addContactShadow(root, shadowMap, 0.42);
    const obsidianMat = makeMat({ color: 0x26212e, roughness: 0.45, metalness: 0.4 });
    const hornMat = makeMat({ color: 0x5c3028, roughness: 0.6, metalness: 0.2 });

    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), obsidianMat);
    head.position.y = 0.92;
    head.castShadow = true;
    body.add(head);

    const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 4), hornMat);
    hornL.position.set(-0.22, 1.18, 0);
    hornL.rotation.z = 0.45;
    const hornR = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 4), hornMat);
    hornR.position.set(0.22, 1.18, 0);
    hornR.rotation.z = -0.45;
    body.add(hornL, hornR);

    const coreMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.24, 0.24),
      new THREE.MeshBasicMaterial({ color: 0xff7b29 })
    );
    coreMesh.position.y = 0.92;
    body.add(coreMesh);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff08a });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), eyeMat);
    eyeL.position.set(-0.1, 0.96, 0.26);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), eyeMat);
    eyeR.position.set(0.1, 0.96, 0.26);
    body.add(eyeL, eyeR);

    return { root, body, coreMesh, flashMaterials };
  }

  // =========================================================================
  // RANGED 1: CRYPT ARCHER (Hooded Ranger with Recurve Bow & Quiver)
  // =========================================================================
  if (kind === 'archer') {
    addContactShadow(root, shadowMap, 0.48);

    const cloakMat = makeMat({ color: 0x2a4a36, roughness: 0.86, metalness: 0.06 });
    const leatherMat = makeMat({ color: 0x5c3c24, roughness: 0.82, metalness: 0.08 });
    const boneMat = makeMat({ color: 0xd9d2c0, roughness: 0.68, metalness: 0.05 });
    const bowMat = makeMat({ color: 0x8a5b2e, roughness: 0.72, metalness: 0.12 });
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.11, 0.36, 0);
    const ll = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.36, 0.12), leatherMat);
    ll.position.y = -0.18;
    ll.castShadow = true;
    leftLeg.add(ll);
    body.add(leftLeg);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.11, 0.36, 0);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.36, 0.12), leatherMat);
    rl.position.y = -0.18;
    rl.castShadow = true;
    rightLeg.add(rl);
    body.add(rightLeg);

    // Ranger tunic & scarf
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.24), cloakMat);
    torso.position.y = 0.62;
    torso.castShadow = true;
    body.add(torso);

    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.09, 0.27), leatherMat);
    belt.position.y = 0.46;
    body.add(belt);

    // Back quiver with fletched arrows
    const quiver = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.12), leatherMat);
    quiver.position.set(-0.08, 0.72, -0.16);
    quiver.rotation.z = 0.24;
    body.add(quiver);
    const fletch = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xf0ead6 })
    );
    fletch.position.set(-0.12, 0.92, -0.16);
    body.add(fletch);

    // Hooded skull head + keen emerald-amber eyes
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), cloakMat);
    hood.position.y = 1.02;
    hood.castShadow = true;
    body.add(hood);

    const face = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.08), boneMat);
    face.position.set(0, 1.0, 0.14);
    body.add(face);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x8dff66 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), eyeMat);
    eyeL.position.set(-0.06, 1.03, 0.18);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), eyeMat);
    eyeR.position.set(0.06, 1.03, 0.18);
    body.add(eyeL, eyeR);

    // Bow Arm (holds recurve bow & glowing nocked arrow)
    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.24, 0.76, 0.04);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), cloakMat);
    arm.position.set(0, -0.12, 0.1);
    arm.rotation.x = Math.PI * 0.35;

    const bowUpper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.06), bowMat);
    bowUpper.position.set(0, 0.14, 0.34);
    bowUpper.rotation.x = -0.32;
    const bowLower = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.06), bowMat);
    bowLower.position.set(0, -0.16, 0.34);
    bowLower.rotation.x = 0.32;
    const bowString = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.62, 0.018),
      new THREE.MeshBasicMaterial({ color: 0xd8d2c0 })
    );
    bowString.position.set(0, -0.01, 0.24);
    const nockedArrow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.44), tipMat);
    nockedArrow.position.set(0, 0.0, 0.42);
    weaponArm.add(arm, bowUpper, bowLower, bowString, nockedArrow);
    body.add(weaponArm);

    return { root, body, leftLeg, rightLeg, weaponArm, coreMesh: nockedArrow, flashMaterials };
  }

  // =========================================================================
  // RANGED 2: ARCANE MAGE (Violet-Robed Warlock with Floating Staff Crystal)
  // =========================================================================
  if (kind === 'mage') {
    addContactShadow(root, shadowMap, 0.5);

    const robeMat = makeMat({ color: 0x351e59, roughness: 0.8, metalness: 0.14 });
    const trimMat = makeMat({ color: 0xd1a447, roughness: 0.3, metalness: 0.84 });
    const shadowFaceMat = makeMat({ color: 0x120d1c, roughness: 0.95, metalness: 0.05 });
    const arcaneMat = new THREE.MeshBasicMaterial({ color: 0x6ef2ff });

    // Flowing robe skirt & torso
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 0.52, 6), robeMat);
    skirt.position.y = 0.32;
    skirt.castShadow = true;
    body.add(skirt);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.24), robeMat);
    torso.position.y = 0.72;
    torso.castShadow = true;
    body.add(torso);

    const mantle = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.11, 0.3), trimMat);
    mantle.position.y = 0.88;
    body.add(mantle);

    // Shadowed face under pointed wizard hat/hood
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), shadowFaceMat);
    head.position.y = 1.06;
    body.add(head);

    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), arcaneMat);
    eyeL.position.set(-0.06, 1.07, 0.14);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), arcaneMat);
    eyeR.position.set(0.06, 1.07, 0.14);
    body.add(eyeL, eyeR);

    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.05, 8), robeMat);
    hatBrim.position.y = 1.22;
    const hatCone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.46, 6), robeMat);
    hatCone.position.set(0, 1.46, -0.03);
    hatCone.rotation.x = -0.15;
    hatCone.castShadow = true;
    body.add(hatBrim, hatCone);

    // Staff Arm with floating luminous arcane orb
    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.27, 0.78, 0);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12), robeMat);
    sleeve.position.y = -0.14;
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.15, 6), trimMat);
    staff.position.set(0.02, 0.02, 0.22);
    staff.rotation.x = Math.PI * 0.12;
    const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), arcaneMat);
    coreMesh.position.set(0.02, 0.62, 0.32);
    weaponArm.add(sleeve, staff, coreMesh);
    body.add(weaponArm);

    return { root, body, weaponArm, coreMesh, flashMaterials };
  }

  // =========================================================================
  // BOSS 1: IRONCLAD WARDEN (Towering Dread Juggernaut with Obsidian Greathammer)
  // =========================================================================
  if (kind === 'boss_juggernaut') {
    addContactShadow(root, shadowMap, 1.15);

    const auraRing = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 1.08, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff4238,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.032;
    root.add(auraRing);

    const armorMat = makeMat({ color: 0x262936, roughness: 0.36, metalness: 0.78 });
    const trimMat = makeMat({ color: 0xb88940, roughness: 0.28, metalness: 0.86 });
    const capeMat = makeMat({ color: 0x7a1622, roughness: 0.88, metalness: 0.05 });
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff4c38 });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.2, 0.5, 0);
    const ll = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.24), armorMat);
    ll.position.y = -0.25;
    ll.castShadow = true;
    leftLeg.add(ll);
    body.add(leftLeg);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.2, 0.5, 0);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.24), armorMat);
    rl.position.y = -0.25;
    rl.castShadow = true;
    rightLeg.add(rl);
    body.add(rightLeg);

    // Massive armored torso & breastplate trim
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.62, 0.44), armorMat);
    torso.position.y = 0.84;
    torso.castShadow = true;
    body.add(torso);

    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.48), trimMat);
    chestPlate.position.y = 0.92;
    body.add(chestPlate);

    const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), emberMat);
    coreMesh.position.set(0, 0.92, 0.25);
    body.add(coreMesh);

    const cape = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.82, 0.08), capeMat);
    cape.position.set(0, 0.68, -0.28);
    cape.rotation.x = 0.16;
    cape.castShadow = true;
    body.add(cape);

    // Giant spiked pauldrons
    const pauldronL = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.38), armorMat);
    pauldronL.position.set(-0.46, 1.08, 0);
    pauldronL.castShadow = true;
    const pauldronR = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.38), armorMat);
    pauldronR.position.set(0.46, 1.08, 0);
    pauldronR.castShadow = true;
    const spikeL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), trimMat);
    spikeL.position.set(-0.52, 1.3, 0);
    spikeL.rotation.z = 0.32;
    const spikeR = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), trimMat);
    spikeR.position.set(0.52, 1.3, 0);
    spikeR.rotation.z = -0.32;
    body.add(pauldronL, pauldronR, spikeL, spikeR);

    // Horned Greathelm + Crimson Visor
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.4), armorMat);
    helm.position.y = 1.36;
    helm.castShadow = true;
    body.add(helm);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.08), emberMat);
    visor.position.set(0, 1.38, 0.19);
    body.add(visor);

    const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.38, 5), trimMat);
    hornL.position.set(-0.24, 1.62, 0.04);
    hornL.rotation.z = 0.52;
    const hornR = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.38, 5), trimMat);
    hornR.position.set(0.24, 1.62, 0.04);
    hornR.rotation.z = -0.52;
    body.add(hornL, hornR);

    // Left Arm (Tower Shield)
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.48, 0.96, 0);
    const la = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.44, 0.18), armorMat);
    la.position.y = -0.18;
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.72, 0.48), armorMat);
    shield.position.set(-0.1, -0.22, 0.14);
    shield.castShadow = true;
    const shieldTrim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.54, 0.08), trimMat);
    shieldTrim.position.set(-0.11, -0.22, 0.14);
    leftArm.add(la, shield, shieldTrim);
    body.add(leftArm);

    // Right Weapon Arm (Colossal Obsidian Greathammer)
    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.48, 0.98, 0);
    const ra = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.46, 0.18), armorMat);
    ra.position.y = -0.18;
    const haft = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.35, 0.09), trimMat);
    haft.position.set(0, -0.28, 0.48);
    haft.rotation.x = Math.PI * 0.44;
    const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.34, 0.34), armorMat);
    hammerHead.position.set(0, -0.14, 1.02);
    hammerHead.castShadow = true;
    const hammerRune = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.1, 0.12), emberMat);
    hammerRune.position.set(0, -0.14, 1.02);
    weaponArm.add(ra, haft, hammerHead, hammerRune);
    body.add(weaponArm);

    body.scale.setScalar(1.65);
    return { root, body, leftLeg, rightLeg, leftArm, weaponArm, coreMesh, auraRing, flashMaterials };
  }

  // =========================================================================
  // BOSS 2: OSSUARY ARCHLICH (Hovering Crowned Necromancer Sovereign)
  // =========================================================================
  if (kind === 'boss_lich') {
    addContactShadow(root, shadowMap, 1.1);

    const auraRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.12, 24),
      new THREE.MeshBasicMaterial({
        color: 0xc25cff,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.032;
    root.add(auraRing);

    const robeMat = makeMat({ color: 0x2a183b, roughness: 0.78, metalness: 0.14 });
    const goldMat = makeMat({ color: 0xd9ad4e, roughness: 0.25, metalness: 0.88 });
    const boneMat = makeMat({ color: 0xe6decb, roughness: 0.65, metalness: 0.08 });
    const arcaneMat = new THREE.MeshBasicMaterial({ color: 0xd975ff });

    // Layered hovering tattered mantle robe
    const lowerRobe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.56, 0.84, 7), robeMat);
    lowerRobe.position.y = 0.54;
    lowerRobe.castShadow = true;
    body.add(lowerRobe);

    const upperTorso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.52, 0.34), robeMat);
    upperTorso.position.y = 1.04;
    upperTorso.castShadow = true;
    body.add(upperTorso);

    // Gilded collar + floating phylactery core
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.18, 0.42), goldMat);
    collar.position.y = 1.24;
    body.add(collar);

    const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), arcaneMat);
    coreMesh.position.set(0, 1.04, 0.24);
    body.add(coreMesh);

    // Crowned Skull
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.36), boneMat);
    skull.position.y = 1.5;
    skull.castShadow = true;
    body.add(skull);

    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.06), arcaneMat);
    eyeL.position.set(-0.09, 1.52, 0.18);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.06), arcaneMat);
    eyeR.position.set(0.09, 1.52, 0.18);
    body.add(eyeL, eyeR);

    const crownBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), goldMat);
    crownBase.position.y = 1.72;
    body.add(crownBase);
    for (const cx of [-0.16, 0, 0.16]) {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.06, cx === 0 ? 0.34 : 0.24, 4), goldMat);
      spire.position.set(cx, cx === 0 ? 1.92 : 1.87, 0.12);
      body.add(spire);
    }

    // Left Casting Arm
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.42, 1.15, 0);
    const laSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.46, 0.18), robeMat);
    laSleeve.position.y = -0.18;
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), arcaneMat);
    orb.position.set(0, -0.44, 0.18);
    leftArm.add(laSleeve, orb);
    body.add(leftArm);

    // Right Staff Arm (Towering Runic Grimoire Staff)
    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.42, 1.15, 0);
    const raSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.46, 0.18), robeMat);
    raSleeve.position.y = -0.18;
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.6, 6), goldMat);
    staff.position.set(0.04, -0.1, 0.32);
    staff.rotation.x = Math.PI * 0.16;
    const staffGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), arcaneMat);
    staffGem.position.set(0.04, 0.68, 0.56);
    weaponArm.add(raSleeve, staff, staffGem);
    body.add(weaponArm);

    body.scale.setScalar(1.62);
    return { root, body, leftArm, weaponArm, coreMesh, auraRing, flashMaterials };
  }

  // =========================================================================
  // BOSS 3: MOLTEN COLOSSUS (Abyssal Furnace Golem with Twin Siege Fists)
  // =========================================================================
  if (kind === 'boss_colossus') {
    addContactShadow(root, shadowMap, 1.25);

    const auraRing = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.18, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff6e24,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.032;
    root.add(auraRing);

    const basaltMat = makeMat({ color: 0x262228, roughness: 0.72, metalness: 0.42 });
    const ironMat = makeMat({ color: 0x4a3d3b, roughness: 0.42, metalness: 0.82 });
    const magmaMat = new THREE.MeshBasicMaterial({ color: 0xff7e24 });
    const hotCoreMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.26, 0.48, 0);
    const ll = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.48, 0.3), basaltMat);
    ll.position.y = -0.24;
    ll.castShadow = true;
    leftLeg.add(ll);
    body.add(leftLeg);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.26, 0.48, 0);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.48, 0.3), basaltMat);
    rl.position.y = -0.24;
    rl.castShadow = true;
    rightLeg.add(rl);
    body.add(rightLeg);

    // Massive furnace chest + glowing molten core behind iron ribs
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.74, 0.56), basaltMat);
    chest.position.y = 0.88;
    chest.castShadow = true;
    body.add(chest);

    const coreMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.6), magmaMat);
    coreMesh.position.y = 0.9;
    body.add(coreMesh);

    const innerHot = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), hotCoreMat);
    innerHot.position.set(0, 0.9, 0.31);
    body.add(innerHot);

    for (const ry of [0.78, 0.9, 1.02]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.63), ironMat);
      rib.position.y = ry;
      body.add(rib);
    }

    // Jagged basalt shoulder boulders
    const shL = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.44), basaltMat);
    shL.position.set(-0.54, 1.18, 0);
    shL.rotation.z = 0.22;
    shL.castShadow = true;
    const shR = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.44), basaltMat);
    shR.position.set(0.54, 1.18, 0);
    shR.rotation.z = -0.22;
    shR.castShadow = true;
    body.add(shL, shR);

    // Monolith Head + Ember Visor
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.4), basaltMat);
    head.position.y = 1.4;
    head.castShadow = true;
    body.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.08), hotCoreMat);
    visor.position.set(0, 1.42, 0.19);
    body.add(visor);

    // Twin Colossal Siege Fists
    const buildSiegeArm = (side: -1 | 1) => {
      const arm = new THREE.Group();
      arm.position.set(side * 0.58, 1.04, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.44, 0.24), basaltMat);
      upper.position.y = -0.18;
      upper.castShadow = true;
      const fist = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.38), ironMat);
      fist.position.set(0, -0.52, 0.1);
      fist.castShadow = true;
      const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.14), magmaMat);
      knuckle.position.set(0, -0.54, 0.26);
      arm.add(upper, fist, knuckle);
      return arm;
    };

    const leftArm = buildSiegeArm(-1);
    const weaponArm = buildSiegeArm(1);
    body.add(leftArm, weaponArm);

    body.scale.setScalar(1.7);
    return { root, body, leftLeg, rightLeg, leftArm, weaponArm, coreMesh, auraRing, flashMaterials };
  }

  // Skeleton Sentinel or towering Crypt Guardian
  const isBoss = kind === 'guardian';
  const scale = isBoss ? 1.32 : 1.0;
  addContactShadow(root, shadowMap, isBoss ? 0.72 : 0.48);

  const boneMat = makeMat({
    color: isBoss ? 0xd9cdb8 : 0xe8e2d0,
    roughness: 0.72,
    metalness: 0.05,
  });
  const ironMat = makeMat({
    color: isBoss ? 0x6b4d2a : 0x454952,
    roughness: 0.38,
    metalness: 0.78,
  });
  const clothMat = makeMat({
    color: isBoss ? 0x6e1f2d : 0x3b3538,
    roughness: 0.9,
    metalness: 0.05,
  });

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.13, 0.44, 0);
  const llMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.44, 0.11), boneMat);
  llMesh.position.y = -0.22;
  llMesh.castShadow = true;
  leftLeg.add(llMesh);
  body.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.13, 0.44, 0);
  const rlMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.44, 0.11), boneMat);
  rlMesh.position.y = -0.22;
  rlMesh.castShadow = true;
  rightLeg.add(rlMesh);
  body.add(rightLeg);

  // Ribcage / Torso
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 0.22), isBoss ? ironMat : boneMat);
  spine.position.y = 0.68;
  spine.castShadow = true;
  body.add(spine);

  const tunic = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.26), clothMat);
  tunic.position.y = 0.5;
  body.add(tunic);

  // Skull
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), boneMat);
  skull.position.y = 1.1;
  skull.castShadow = true;
  body.add(skull);

  const eyeColor = isBoss ? 0xff3b3b : 0xffaa44;
  const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.05), eyeMat);
  eyeL.position.set(-0.08, 1.12, 0.16);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.05), eyeMat);
  eyeR.position.set(0.08, 1.12, 0.16);
  body.add(eyeL, eyeR);

  if (isBoss) {
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.38), ironMat);
    crown.position.y = 1.3;
    body.add(crown);
    const spikeL = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 4), ironMat);
    spikeL.position.set(-0.18, 1.44, 0);
    const spikeR = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 4), ironMat);
    spikeR.position.set(0.18, 1.44, 0);
    body.add(spikeL, spikeR);
  }

  // Weapon Arm
  const weaponArm = new THREE.Group();
  weaponArm.position.set(0.28, 0.82, 0);
  const armBone = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.1), boneMat);
  armBone.position.y = -0.15;
  weaponArm.add(armBone);

  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(isBoss ? 0.14 : 0.08, isBoss ? 0.85 : 0.62, 0.04),
    ironMat
  );
  blade.position.set(0, -0.3, 0.28);
  blade.rotation.x = Math.PI * 0.45;
  blade.castShadow = true;
  weaponArm.add(blade);
  body.add(weaponArm);

  // Off-hand Buckler
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.38, 0.34), ironMat);
  shield.position.set(-0.28, 0.7, 0.12);
  shield.castShadow = true;
  body.add(shield);

  body.scale.setScalar(scale);

  return { root, body, leftLeg, rightLeg, weaponArm, flashMaterials };
}

export function createKeyPedestal(
  shadowMap: THREE.Texture,
  glowMap: THREE.Texture
): {
  root: THREE.Group;
  keyMesh: THREE.Group;
  halo: THREE.Sprite;
} {
  const root = new THREE.Group();
  addContactShadow(root, shadowMap, 0.85);

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x30333d, roughness: 0.82, metalness: 0.12 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.78, 0.22, 8), stoneMat);
  base.position.y = 0.11;
  base.receiveShadow = true;
  base.castShadow = true;
  root.add(base);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.48, 0.05, 6, 20),
    new THREE.MeshBasicMaterial({ color: 0xffe680 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.24;
  root.add(ring);

  // Ornate hovering Golden Relic Key
  const keyMesh = new THREE.Group();
  keyMesh.position.y = 1.05;
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffe670,
    emissive: 0xffb229,
    emissiveIntensity: 1.25,
    metalness: 0.88,
    roughness: 0.15,
  });

  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 6, 12), goldMat);
  bow.position.y = 0.25;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.52, 0.09), goldMat);
  shaft.position.y = -0.18;
  const tooth1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), goldMat);
  tooth1.position.set(0.12, -0.38, 0);
  const tooth2 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.08), goldMat);
  tooth2.position.set(0.1, -0.24, 0);

  keyMesh.add(bow, shaft, tooth1, tooth2);
  root.add(keyMesh);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: 0xffd252,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(2.4, 2.4, 1);
  halo.position.y = 1.05;
  root.add(halo);

  return { root, keyMesh, halo };
}

export function createBrazier(
  glowMap: THREE.Texture,
  accentColor = 0xff9c38,
  theme: TerrainTheme = 'dungeon'
): {
  root: THREE.Group;
  flame: THREE.Group;
} {
  const root = new THREE.Group();

  if (theme === 'alien') {
    // Sleek Brushed-Silver Starship Plasma Reactor Pylon
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xbcd4eb, roughness: 0.22, metalness: 0.88 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x223b59, roughness: 0.32, metalness: 0.8 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.22, 8), darkMat);
    base.position.y = 0.11;
    base.castShadow = true;
    root.add(base);

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.56, 8), chromeMat);
    pedestal.position.y = 0.48;
    pedestal.castShadow = true;
    root.add(pedestal);

    const emitterRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 6, 12), chromeMat);
    emitterRing.rotation.x = Math.PI / 2;
    emitterRing.position.y = 0.8;
    root.add(emitterRing);

    const flame = new THREE.Group();
    flame.position.y = 0.96;
    const coreOrb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshBasicMaterial({ color: 0xc2fbff })
    );
    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.032, 6, 14),
      new THREE.MeshBasicMaterial({ color: accentColor })
    );
    outerRing.rotation.x = Math.PI * 0.35;
    flame.add(coreOrb, outerRing);
    root.add(flame);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap,
        color: accentColor,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.scale.set(2.4, 2.4, 1);
    halo.position.y = 1.04;
    root.add(halo);

    return { root, flame };
  }

  const ironMat = new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.45, metalness: 0.78 });

  // Tripod legs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.68, 0.09), ironMat);
    leg.position.set(Math.cos(a) * 0.24, 0.34, Math.sin(a) * 0.24);
    leg.rotation.z = Math.cos(a) * 0.22;
    leg.rotation.x = -Math.sin(a) * 0.22;
    leg.castShadow = true;
    root.add(leg);
  }

  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.26, 0.28, 6), ironMat);
  bowl.position.y = 0.68;
  bowl.castShadow = true;
  root.add(bowl);

  const coreTint = new THREE.Color(accentColor).lerp(new THREE.Color(0xffffff), 0.48);
  const coals = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.3, 0.08, 6),
    new THREE.MeshBasicMaterial({ color: accentColor })
  );
  coals.position.y = 0.82;
  root.add(coals);

  const flame = new THREE.Group();
  flame.position.y = 0.88;
  const f1 = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 0.56, 5),
    new THREE.MeshBasicMaterial({ color: accentColor })
  );
  f1.position.y = 0.24;
  const f2 = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.4, 4),
    new THREE.MeshBasicMaterial({ color: coreTint })
  );
  f2.position.y = 0.22;
  flame.add(f1, f2);
  root.add(flame);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: accentColor,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(2.5, 2.5, 1);
  halo.position.y = 1.18;
  root.add(halo);

  return { root, flame };
}

export function createWallTorch(
  glowMap: THREE.Texture,
  accentColor = 0xffa43d,
  theme: TerrainTheme = 'dungeon'
): {
  root: THREE.Group;
  flame: THREE.Mesh;
} {
  const root = new THREE.Group();

  if (theme === 'alien') {
    // Sleek Sci-Fi Bulkhead LED Wall Sconce
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc2d9f0, metalness: 0.88, roughness: 0.2 });
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.64, 0.1), chromeMat);
    mount.position.set(0, 1.66, 0.02);
    root.add(mount);

    const flame = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.52, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xccfaff })
    );
    flame.position.set(0, 1.66, 0.1);
    root.add(flame);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap,
        color: accentColor,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.scale.set(2.2, 2.2, 1);
    halo.position.set(0, 1.66, 0.22);
    root.add(halo);

    return { root, flame };
  }

  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.75, roughness: 0.42 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 });

  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.14), ironMat);
  bracket.position.set(0, 1.48, 0);
  root.add(bracket);

  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.44, 0.09), woodMat);
  stick.position.set(0, 1.62, 0.16);
  stick.rotation.x = 0.36;
  root.add(stick);

  const coreTint = new THREE.Color(accentColor).lerp(new THREE.Color(0xffffff), 0.42);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.32, 4),
    new THREE.MeshBasicMaterial({ color: coreTint })
  );
  flame.position.set(0, 1.94, 0.24);
  root.add(flame);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: accentColor,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(2.1, 2.1, 1);
  halo.position.set(0, 1.98, 0.32);
  root.add(halo);

  return { root, flame };
}

export function createRuneWell(
  biome: BiomeConfig,
  textures: DungeonTextureSet
): {
  root: THREE.Group;
  crystal: THREE.Mesh;
  decal: THREE.Mesh;
  pool: THREE.Mesh;
  halo: THREE.Sprite;
} {
  const root = new THREE.Group();

  // Subtle soft arcane floor light pool that doesn't wash out the rune sigil lines
  const poolMat = new THREE.MeshBasicMaterial({
    map: textures.glowMap,
    color: biome.runeColor,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.026;
  root.add(pool);

  const decalMat = new THREE.MeshBasicMaterial({
    map: textures.runeMap,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(2.65, 2.65), decalMat);
  decal.rotation.x = -Math.PI / 2;
  decal.position.y = 0.036;
  root.add(decal);

  // Faceted glowing 3D crystal clearly readable above the rune circle
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.25, 0),
    new THREE.MeshStandardMaterial({
      color: biome.runeColor,
      emissive: biome.runeColor,
      emissiveIntensity: 0.85,
      roughness: 0.16,
      metalness: 0.28,
      flatShading: true,
    })
  );
  crystal.position.y = 0.78;
  root.add(crystal);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textures.glowMap,
      color: biome.runeColor,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(1.15, 1.15, 1);
  halo.position.y = 0.78;
  root.add(halo);

  return { root, crystal, decal, pool, halo };
}

export function createCrateProp(
  kind: 'crate' | 'urn',
  textures: DungeonTextureSet
): THREE.Group {
  const root = new THREE.Group();
  if (kind === 'crate') {
    const mat = new THREE.MeshStandardMaterial({
      map: textures.crateMap,
      roughness: 0.85,
      metalness: 0.1,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.82, 0.82), mat);
    box.position.y = 0.41;
    box.castShadow = true;
    box.receiveShadow = true;
    root.add(box);
  } else {
    const urnMat = new THREE.MeshStandardMaterial({
      color: 0x6b4738,
      roughness: 0.65,
      metalness: 0.25,
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0xd4a94e,
      roughness: 0.28,
      metalness: 0.82,
    });
    const vessel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.66, 7), urnMat);
    vessel.position.y = 0.33;
    vessel.castShadow = true;
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.14, 7), bandMat);
    lip.position.y = 0.7;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 5, 10), bandMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.36;
    root.add(vessel, lip, ring);
  }
  return root;
}

export function createSpikeTrap(): SpikeTrapRig {
  const root = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.72, roughness: 0.45 });
  const warningMat = new THREE.MeshStandardMaterial({
    color: 0x452020,
    emissive: 0x801818,
    emissiveIntensity: 0.25,
    roughness: 0.7,
  });

  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 1.5), warningMat);
  plate.position.y = 0.03;
  plate.receiveShadow = true;
  root.add(plate);

  const border = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.05, 1.64), frameMat);
  border.position.y = 0.025;
  root.add(border);

  const spikesGroup = new THREE.Group();
  const spikeGeo = new THREE.ConeGeometry(0.08, 0.54, 4);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xc2ccd6, metalness: 0.9, roughness: 0.2 });

  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      const s = new THREE.Mesh(spikeGeo, spikeMat);
      s.position.set(ix * 0.44, 0.24, iz * 0.44);
      s.castShadow = true;
      spikesGroup.add(s);
    }
  }
  spikesGroup.position.y = -0.45;
  root.add(spikesGroup);

  return { root, spikesGroup, warningMat };
}

export function createLockedGate(
  horizontal: boolean,
  textures: DungeonTextureSet
): GateRig {
  const root = new THREE.Group();
  if (!horizontal) {
    root.rotation.y = Math.PI / 2;
  }

  const stoneMat = new THREE.MeshStandardMaterial({
    map: textures.pillarMap,
    roughness: 0.85,
    metalness: 0.1,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    map: textures.doorMap,
    roughness: 0.6,
    metalness: 0.35,
  });

  // Heavy Stone Archway
  const postL = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.35, 0.56), stoneMat);
  postL.position.set(-0.92, 1.175, 0);
  postL.castShadow = true;
  const postR = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.35, 0.56), stoneMat);
  postR.position.set(0.92, 1.175, 0);
  postR.castShadow = true;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.38, 0.62), stoneMat);
  lintel.position.set(0, 2.32, 0);
  lintel.castShadow = true;
  root.add(postL, postR, lintel);

  // Twin swinging oak-bronze doors
  const leftPivot = new THREE.Group();
  leftPivot.position.set(-0.76, 0, 0);
  const leftLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.76, 2.1, 0.24), doorMat);
  leftLeaf.position.set(0.38, 1.05, 0);
  leftLeaf.castShadow = true;
  leftLeaf.receiveShadow = true;
  leftPivot.add(leftLeaf);

  const rightPivot = new THREE.Group();
  rightPivot.position.set(0.76, 0, 0);
  const rightLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.76, 2.1, 0.24), doorMat);
  rightLeaf.position.set(-0.38, 1.05, 0);
  rightLeaf.castShadow = true;
  rightLeaf.receiveShadow = true;
  rightPivot.add(rightLeaf);

  // Glowing Golden Seal Emblem
  const lockGlow = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.18, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd966 })
  );
  lockGlow.position.set(0, 1.12, 0);
  root.add(leftPivot, rightPivot, lockGlow);

  return { root, leftPivot, rightPivot, lockGlow };
}

export function createStairwell(textures: DungeonTextureSet): {
  root: THREE.Group;
} {
  const root = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    map: textures.pillarMap,
    roughness: 0.85,
    metalness: 0.1,
  });

  // Recessed black pit + glowing descending steps
  const pit = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.1, 1.7),
    new THREE.MeshBasicMaterial({ color: 0x050508 })
  );
  pit.position.y = 0.02;
  root.add(pit);

  for (let i = 0; i < 4; i++) {
    const shade = 1 - i * 0.2;
    const stepMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.55 * shade, 0.52 * shade, 0.46 * shade),
      emissive: new THREE.Color(0.65 * (1 - i * 0.18), 0.45 * (1 - i * 0.18), 0.12),
      roughness: 0.8,
    });
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 0.34), stepMat);
    step.position.set(0, 0.1 - i * 0.08, 0.55 - i * 0.34);
    root.add(step);
  }

  // Stone Archway framing the stairwell
  const postL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.34), stoneMat);
  postL.position.set(-0.88, 1.1, -0.68);
  postL.castShadow = true;
  const postR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.34), stoneMat);
  postR.position.set(0.88, 1.1, -0.68);
  postR.castShadow = true;
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.34, 0.42), stoneMat);
  topBar.position.set(0, 2.24, -0.68);
  topBar.castShadow = true;
  root.add(postL, postR, topBar);

  // Twin archway glow gems
  const gemMat = new THREE.MeshBasicMaterial({ color: 0xffe896 });
  const gemL = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), gemMat);
  gemL.position.set(-0.88, 1.72, -0.45);
  const gemR = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), gemMat);
  gemR.position.set(0.88, 1.72, -0.45);
  root.add(gemL, gemR);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textures.glowMap,
      color: 0xffd26e,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(3.2, 3.2, 1);
  halo.position.set(0, 1.2, -0.2);
  root.add(halo);

  return { root };
}

export function createLootMesh(type: 'gold' | 'potion'): THREE.Group {
  const g = new THREE.Group();
  if (type === 'gold') {
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xffd24a,
      emissive: 0xc27b10,
      emissiveIntensity: 0.45,
      metalness: 0.92,
      roughness: 0.16,
    });
    const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 8), coinMat);
    c1.rotation.x = Math.PI / 2;
    c1.position.y = 0.24;
    g.add(c1);
  } else {
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xff2e4c,
      emissive: 0xd11738,
      emissiveIntensity: 0.7,
      roughness: 0.18,
      metalness: 0.2,
    });
    const corkMat = new THREE.MeshStandardMaterial({ color: 0xb88b58, roughness: 0.85 });
    const flask = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), glassMat);
    flask.position.y = 0.24;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 6), corkMat);
    neck.position.y = 0.44;
    g.add(flask, neck);
  }
  return g;
}

export function createUpgradeAltar(glowMap: THREE.Texture): {
  root: THREE.Group;
  crystal: THREE.Group;
  ring: THREE.Mesh;
  halo: THREE.Sprite;
} {
  const root = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d38,
    roughness: 0.78,
    metalness: 0.18,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xe6be5c,
    emissive: 0x9c6d1a,
    emissiveIntensity: 0.45,
    roughness: 0.24,
    metalness: 0.88,
  });

  // Glowing golden-amber floor sanctum ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1.04, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffd35c,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.036;
  root.add(ring);

  // Subtle radial golden floor light pool
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshBasicMaterial({
      map: glowMap,
      color: 0xffc64a,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.025;
  root.add(pool);

  // Stepped octagonal obsidian & gilded-gold altar pedestal
  const step1 = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.86, 0.18, 8), stoneMat);
  step1.position.y = 0.09;
  step1.castShadow = true;
  step1.receiveShadow = true;
  const step2 = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.56, 0.56, 8), stoneMat);
  step2.position.y = 0.46;
  step2.castShadow = true;
  step2.receiveShadow = true;
  const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.08, 8), goldMat);
  trim.position.y = 0.76;
  root.add(step1, step2, trim);

  // Floating golden ascension emblem (diamond core + orbiting gilded halo ring)
  const crystal = new THREE.Group();
  crystal.position.y = 1.32;
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.24, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffe680,
      emissive: 0xffb830,
      emissiveIntensity: 1.0,
      roughness: 0.15,
      metalness: 0.35,
      flatShading: true,
    })
  );
  const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 16), goldMat);
  orbitRing.rotation.x = Math.PI * 0.36;
  crystal.add(core, orbitRing);
  root.add(crystal);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: 0xffd25c,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(1.45, 1.45, 1);
  halo.position.y = 1.32;
  root.add(halo);

  return { root, crystal, ring, halo };
}

export function createPotionShop(glowMap: THREE.Texture): {
  root: THREE.Group;
  crystal: THREE.Group;
  ring: THREE.Mesh;
  halo: THREE.Sprite;
} {
  const root = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x5c3924,
    roughness: 0.84,
    metalness: 0.08,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x382419,
    roughness: 0.88,
    metalness: 0.12,
  });
  const clothMat = new THREE.MeshStandardMaterial({
    color: 0xa62646,
    emissive: 0x450d1c,
    emissiveIntensity: 0.35,
    roughness: 0.65,
  });
  const rubyGlassMat = new THREE.MeshStandardMaterial({
    color: 0xff4568,
    emissive: 0xd92348,
    emissiveIntensity: 0.95,
    roughness: 0.16,
    metalness: 0.18,
  });
  const corkMat = new THREE.MeshStandardMaterial({
    color: 0xd6b078,
    roughness: 0.85,
  });

  // Glowing rose-ruby shop floor ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.84, 1.0, 24),
    new THREE.MeshBasicMaterial({
      color: 0xff5a7e,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.036;
  root.add(ring);

  // Soft warm crimson floor glow pool
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 3.8),
    new THREE.MeshBasicMaterial({
      map: glowMap,
      color: 0xff476e,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.025;
  root.add(pool);

  // Apothecary wooden counter stall with crimson runner cloth
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.56, 0.72), woodMat);
  base.position.y = 0.28;
  base.castShadow = true;
  base.receiveShadow = true;
  const topSlab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.84), trimMat);
  topSlab.position.y = 0.6;
  topSlab.castShadow = true;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.44, 0.86), clothMat);
  cloth.position.y = 0.4;
  root.add(base, topSlab, cloth);

  // Three small elixir vials displayed on the counter
  for (let i = -1; i <= 1; i++) {
    const vial = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), rubyGlassMat);
    vial.position.set(i * 0.34, 0.76, i === 0 ? 0.06 : -0.05);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.07, 6), corkMat);
    cap.position.set(i * 0.34, 0.89, i === 0 ? 0.06 : -0.05);
    root.add(vial, cap);
  }

  // Floating giant glowing crimson elixir emblem above the shop counter
  const crystal = new THREE.Group();
  crystal.position.y = 1.38;
  const flaskBody = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), rubyGlassMat);
  const flaskNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.14, 6), corkMat);
  flaskNeck.position.y = 0.25;
  const gleamRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.028, 6, 16),
    new THREE.MeshBasicMaterial({ color: 0xffa6bc })
  );
  gleamRing.rotation.x = Math.PI * 0.4;
  crystal.add(flaskBody, flaskNeck, gleamRing);
  root.add(crystal);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: 0xff5a7e,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(1.38, 1.38, 1);
  halo.position.y = 1.38;
  root.add(halo);

  return { root, crystal, ring, halo };
}

export function createProjectileMesh(kind: ProjectileKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'arrow') {
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.045, 0.56),
      new THREE.MeshBasicMaterial({ color: 0xd9a760 })
    );
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.18, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe875 })
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 0.34;
    const fletch = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.02, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xf5f2e6 })
    );
    fletch.position.z = -0.24;
    g.add(shaft, tip, fletch);
  } else if (kind === 'crystal_shard') {
    const shard = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.58, 4),
      new THREE.MeshBasicMaterial({ color: 0x62f5ff })
    );
    shard.rotation.x = Math.PI / 2;
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xd4feff })
    );
    g.add(shard, core);
  } else if (kind === 'bone_dart') {
    const dart = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.54, 4),
      new THREE.MeshBasicMaterial({ color: 0xf7f2df })
    );
    dart.rotation.x = Math.PI / 2;
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.03, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xffb833 })
    );
    fin.position.z = -0.2;
    g.add(dart, fin);
  } else if (kind === 'spore_orb') {
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.15, 0),
      new THREE.MeshBasicMaterial({ color: 0xbaff94 })
    );
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0x3be676,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    g.add(core, aura);
  } else if (kind === 'bio_orb') {
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.15, 0),
      new THREE.MeshBasicMaterial({ color: 0xd9ff7a })
    );
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0x2ee69a,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    g.add(core, aura);
  } else if (kind === 'plasma_bolt') {
    const bolt = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.66),
      new THREE.MeshBasicMaterial({ color: 0xd6ffdb })
    );
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.15, 0.72),
      new THREE.MeshBasicMaterial({
        color: 0x39ff6a,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    g.add(bolt, glow);
  } else if (kind === 'ion_orb') {
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: 0xffc7f8 })
    );
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff42d6,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    g.add(core, aura);
  } else {
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.15, 0),
      new THREE.MeshBasicMaterial({ color: 0xb8fbff })
    );
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xb05cff,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    g.add(core, aura);
  }
  return g;
}

export function createEliteNameSprite(label: string, isSpecial = false): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 460;
  canvas.height = 104;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const displayLabel = isSpecial ? `★ ${label}` : label;
    // Measure text so plate hugs the Chinese name cleanly at 1.2x scale
    ctx.font = '700 38px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';
    const textWidth = Math.min(404, Math.ceil(ctx.measureText(displayLabel).width));
    const padX = 28;
    const boxW = Math.min(450, Math.max(180, textWidth + padX * 2));
    const boxH = 66;
    const bx = Math.round((canvas.width - boxW) / 2);
    const by = Math.round((canvas.height - boxH) / 2);

    // Dark obsidian backing plate (warmer crimson-obsidian tint for special named elites)
    ctx.fillStyle = isSpecial ? 'rgba(24, 10, 14, 0.88)' : 'rgba(10, 12, 18, 0.84)';
    ctx.fillRect(bx, by, boxW, boxH);

    // Crisp gilded border (amber-orange flare for special elites, classic gold for regular elites)
    ctx.strokeStyle = isSpecial ? 'rgba(255, 158, 64, 0.96)' : 'rgba(245, 198, 78, 0.92)';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(bx + 1.75, by + 1.75, boxW - 3.5, boxH - 3.5);

    // Inner hairline accent
    ctx.strokeStyle = isSpecial ? 'rgba(255, 212, 130, 0.42)' : 'rgba(255, 232, 150, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(bx + 6, by + 6, boxW - 12, boxH - 12);

    // Crisp text with strong drop shadow
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = isSpecial ? '#ffd17a' : '#ffe58a';
    ctx.fillText(displayLabel, canvas.width / 2, canvas.height / 2 + 1, 404);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  // 1.2x larger than previous (2.35, 0.55) -> scaled cleanly to canvas aspect ratio (460x104)
  sprite.scale.set(2.92, 0.66, 1);
  sprite.position.y = 2.66;
  sprite.renderOrder = 14;
  return sprite;
}

export function createStunStars(): THREE.Group {
  const group = new THREE.Group();
  // Slight tilt so orbiting stars read cleanly from isometric camera
  group.rotation.x = 0.22;

  const starMat = new THREE.MeshBasicMaterial({
    color: 0xffe44d,
    transparent: true,
    opacity: 0.96,
  });
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd24d,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Subtle orbiting halo ring
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.36, 20), ringMat);
  halo.rotation.x = -Math.PI / 2;
  group.add(halo);

  // 4 orbiting golden 4-point star crystals
  const starCount = 4;
  const radius = 0.35;
  const starGeoA = new THREE.OctahedronGeometry(0.085, 0);
  const starGeoB = new THREE.BoxGeometry(0.15, 0.036, 0.036);
  const starGeoC = new THREE.BoxGeometry(0.036, 0.036, 0.15);

  for (let i = 0; i < starCount; i++) {
    const angle = (i / starCount) * Math.PI * 2;
    const starPivot = new THREE.Group();
    starPivot.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle * 2) * 0.04,
      Math.sin(angle) * radius
    );

    const gem = new THREE.Mesh(starGeoA, i % 2 === 0 ? starMat : coreMat);
    gem.scale.set(0.7, 1.15, 0.7);
    const barX = new THREE.Mesh(starGeoB, starMat);
    const barZ = new THREE.Mesh(starGeoC, starMat);
    starPivot.add(gem, barX, barZ);
    group.add(starPivot);
  }

  return group;
}

export function applyEliteVisuals(
  rig: EnemyRig,
  label?: string,
  isSpecial = false
): void {
  rig.body.scale.multiplyScalar(isSpecial ? 1.38 : 1.32);

  const auraRing = new THREE.Mesh(
    new THREE.RingGeometry(0.58, 0.78, 20),
    new THREE.MeshBasicMaterial({
      color: isSpecial ? 0xff7e2e : 0xffb830,
      transparent: true,
      opacity: isSpecial ? 0.78 : 0.68,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  auraRing.rotation.x = -Math.PI / 2;
  auraRing.position.y = 0.034;
  rig.root.add(auraRing);
  rig.auraRing = auraRing;

  if (label) {
    const nameTag = createEliteNameSprite(label, isSpecial);
    rig.root.add(nameTag);
    rig.nameTag = nameTag;
  }
}

export interface RelicLootRig {
  root: THREE.Group;
  artifact: THREE.Group;
  beam?: THREE.Group;
  ring: THREE.Mesh;
}

export function createRelicLootMesh(
  rarity: RelicRarity,
  glowMap?: THREE.Texture
): RelicLootRig {
  const root = new THREE.Group();

  const palette: Record<
    RelicRarity,
    { main: number; emissive: number; bright: number; hasBeam: boolean }
  > = {
    blue: { main: 0x4da6ff, emissive: 0x1c63b8, bright: 0x99d1ff, hasBeam: false },
    yellow: { main: 0xffd84d, emissive: 0xb88614, bright: 0xfff0a3, hasBeam: false },
    orange: { main: 0xff7b1c, emissive: 0xd9480f, bright: 0xffc278, hasBeam: true },
    green: { main: 0x38f27c, emissive: 0x14a84e, bright: 0xa6ffcb, hasBeam: true },
  };
  const pal = palette[rarity];

  // Glowing floor circle under the relic
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(pal.hasBeam ? 0.34 : 0.24, pal.hasBeam ? 0.52 : 0.34, 20),
    new THREE.MeshBasicMaterial({
      color: pal.main,
      transparent: true,
      opacity: pal.hasBeam ? 0.88 : 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.036;
  root.add(ring);

  // Composite rotating 3D Relic Artifact (gemstone core + metal bezel ring + crown pins)
  const artifact = new THREE.Group();
  artifact.position.y = 0.36;

  const coreMat = new THREE.MeshStandardMaterial({
    color: pal.main,
    emissive: pal.emissive,
    emissiveIntensity: pal.hasBeam ? 1.15 : 0.72,
    roughness: 0.16,
    metalness: 0.38,
    flatShading: true,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: rarity === 'green' ? 0xd9f7e3 : rarity === 'blue' ? 0xcbd8eb : 0xf0ca68,
    roughness: 0.22,
    metalness: 0.9,
  });

  const gem = new THREE.Mesh(
    pal.hasBeam ? new THREE.OctahedronGeometry(0.22, 0) : new THREE.OctahedronGeometry(0.18, 0),
    coreMat
  );
  gem.scale.set(0.92, 1.24, 0.92);

  const bezel = new THREE.Mesh(
    new THREE.TorusGeometry(pal.hasBeam ? 0.27 : 0.22, 0.032, 6, 16),
    metalMat
  );
  bezel.rotation.x = Math.PI * 0.26;

  const accent = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.08),
    new THREE.MeshBasicMaterial({ color: pal.bright })
  );
  accent.position.y = pal.hasBeam ? 0.3 : 0.24;
  accent.rotation.y = Math.PI / 4;

  artifact.add(gem, bezel, accent);
  root.add(artifact);

  if (glowMap) {
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap,
        color: pal.main,
        transparent: true,
        opacity: pal.hasBeam ? 0.65 : 0.38,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    const hs = pal.hasBeam ? 1.25 : 0.78;
    halo.scale.set(hs, hs, 1);
    halo.position.y = 0.38;
    root.add(halo);
  }

  let beam: THREE.Group | undefined;
  if (pal.hasBeam) {
    // Soaring Diablo-style vertical light pillar for Orange (Unique) and Green (Set) drops
    beam = new THREE.Group();

    const beamHeight = 7.2;
    const outerBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.36, beamHeight, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: pal.main,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    outerBeam.position.y = beamHeight * 0.5;

    const innerBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.14, beamHeight * 0.92, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: pal.bright,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    innerBeam.position.y = beamHeight * 0.46;

    const baseFlare = new THREE.Mesh(
      new THREE.CircleGeometry(0.76, 18),
      new THREE.MeshBasicMaterial({
        color: pal.main,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    baseFlare.rotation.x = -Math.PI / 2;
    baseFlare.position.y = 0.032;

    beam.add(outerBeam, innerBeam, baseFlare);
    root.add(beam);
  }

  return { root, artifact, beam, ring };
}

export function createHeroSetAura(): {
  group: THREE.Group;
  outerRing: THREE.Mesh;
  innerRing: THREE.Mesh;
  outerMat: THREE.MeshBasicMaterial;
  innerMat: THREE.MeshBasicMaterial;
} {
  const group = new THREE.Group();
  group.visible = false;

  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xff6229,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const outerRing = new THREE.Mesh(new THREE.RingGeometry(0.76, 0.94, 24), outerMat);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.04;

  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffcf70,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.64, 6), innerMat);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.042;

  group.add(outerRing, innerRing);
  return { group, outerRing, innerRing, outerMat, innerMat };
}
