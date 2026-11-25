import { BiomeConfig, DungeonData, DungeonPropData, RoomRect, TileType } from './types';

export const TILE_SIZE = 2.0;

export const DUNGEON_BIOMES: BiomeConfig[] = [
  {
    id: 'catacombs',
    terrainTheme: 'dungeon',
    name: 'Sunken Catacombs',
    fogColor: 0x070910,
    floorBase: '#575c6c',
    floorAccent: '#485061',
    floorMortar: '#1b1d26',
    wallBase: '#6c6763',
    wallAccent: '#565b69',
    bannerColor: '#1f7076',
    runeColor: 0x42f5ee,
    runeCss: '#42f5ee',
    torchColor: 0xffaa44,
    hemiSky: 0x4e6691,
    hemiGround: 0x241710,
  },
  {
    id: 'ossuary',
    terrainTheme: 'dungeon',
    name: 'Gilded Ossuary',
    fogColor: 0x0b080e,
    floorBase: '#665a4f',
    floorAccent: '#544840',
    floorMortar: '#1e1714',
    wallBase: '#786754',
    wallAccent: '#615245',
    bannerColor: '#872940',
    runeColor: 0xc98cff,
    runeCss: '#c98cff',
    torchColor: 0xffb34d,
    hemiSky: 0x624d7a,
    hemiGround: 0x26180f,
  },
  {
    id: 'forge',
    terrainTheme: 'dungeon',
    name: 'Abyssal Forge',
    fogColor: 0x0a0708,
    floorBase: '#504d56',
    floorAccent: '#5e4e49',
    floorMortar: '#171417',
    wallBase: '#5e5553',
    wallAccent: '#70564c',
    bannerColor: '#2c694b',
    runeColor: 0x57ffab,
    runeCss: '#57ffab',
    torchColor: 0xff9238,
    hemiSky: 0x425e59,
    hemiGround: 0x2b160d,
  },
];

export const CAVERN_BIOMES: BiomeConfig[] = [
  {
    id: 'cavern_crystal',
    terrainTheme: 'cavern',
    name: 'Crystal Cavern',
    fogColor: 0x070c12,
    floorBase: '#5b5247',
    floorAccent: '#46525c',
    floorMortar: '#1c1814',
    wallBase: '#574e46',
    wallAccent: '#3d5966',
    bannerColor: '#256c78',
    runeColor: 0x45f0ff,
    runeCss: '#45f0ff',
    torchColor: 0xffb85c,
    hemiSky: 0x48768f,
    hemiGround: 0x291e14,
  },
  {
    id: 'cavern_fungal',
    terrainTheme: 'cavern',
    name: 'Glowcap Grotto',
    fogColor: 0x070d0a,
    floorBase: '#585344',
    floorAccent: '#425446',
    floorMortar: '#191a14',
    wallBase: '#544d40',
    wallAccent: '#3e5c4c',
    bannerColor: '#2d7552',
    runeColor: 0x5eff9e,
    runeCss: '#5eff9e',
    torchColor: 0xffc166,
    hemiSky: 0x4b7d65,
    hemiGround: 0x261f14,
  },
];

export const FLESH_BIOMES: BiomeConfig[] = [
  {
    id: 'flesh_maw',
    terrainTheme: 'flesh',
    name: "Leviathan's Maw",
    fogColor: 0x160714,
    floorBase: '#9c4e75',
    floorAccent: '#733875',
    floorMortar: '#2e0f29',
    wallBase: '#873d6c',
    wallAccent: '#b55686',
    bannerColor: '#b8377c',
    runeColor: 0xff70df,
    runeCss: '#ff70df',
    torchColor: 0xff7fd4,
    hemiSky: 0xa65ca3,
    hemiGround: 0x421432,
  },
  {
    id: 'flesh_heart',
    terrainTheme: 'flesh',
    name: 'Abyssal Viscera',
    fogColor: 0x130616,
    floorBase: '#854082',
    floorAccent: '#b05482',
    floorMortar: '#260b29',
    wallBase: '#723175',
    wallAccent: '#a84a80',
    bannerColor: '#913299',
    runeColor: 0xe375ff,
    runeCss: '#e375ff',
    torchColor: 0xeb82ff,
    hemiSky: 0x914fa8,
    hemiGround: 0x3b1130,
  },
];

export const ALIEN_BIOMES: BiomeConfig[] = [
  {
    id: 'alien_deck',
    terrainTheme: 'alien',
    name: 'Starship Cryo-Deck',
    fogColor: 0x0f2036,
    floorBase: '#b8cce0',
    floorAccent: '#8fb2d6',
    floorMortar: '#1c3554',
    wallBase: '#a6bfd9',
    wallAccent: '#78a2cc',
    bannerColor: '#1f7fb8',
    runeColor: 0x3de8ff,
    runeCss: '#3de8ff',
    torchColor: 0x7aefff,
    hemiSky: 0xd6f0ff,
    hemiGround: 0x45668c,
  },
  {
    id: 'alien_core',
    terrainTheme: 'alien',
    name: 'Quantum Command Deck',
    fogColor: 0x10223b,
    floorBase: '#c2d6e8',
    floorAccent: '#85b0de',
    floorMortar: '#1b385c',
    wallBase: '#aec8e0',
    wallAccent: '#6d9ed1',
    bannerColor: '#1a68c7',
    runeColor: 0x57f0ff,
    runeCss: '#57f0ff',
    torchColor: 0x8af4ff,
    hemiSky: 0xe0f5ff,
    hemiGround: 0x4a6f99,
  },
];

export const BIOMES: BiomeConfig[] = [
  ...DUNGEON_BIOMES,
  ...CAVERN_BIOMES,
  ...FLESH_BIOMES,
  ...ALIEN_BIOMES,
];

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function generateDungeon(depth: number): DungeonData {
  // Expand dungeon dimensions by ~20% after every 5 completed floors (34 -> 41 -> 49 -> 59 -> 68 max)
  const tier = Math.floor((depth - 1) / 5);
  const size = Math.min(68, Math.round(34 * Math.pow(1.2, tier)));
  const width = size;
  const height = size;
  // Terrain changes every 10 floors: 1-10 Stone Dungeon, 11-20 Cavern, 21-30 Monster Interior, 31-40 Alien Spaceship
  const zoneIndex = Math.floor((depth - 1) / 10) % 4;
  const zonePool =
    zoneIndex === 0
      ? DUNGEON_BIOMES
      : zoneIndex === 1
      ? CAVERN_BIOMES
      : zoneIndex === 2
      ? FLESH_BIOMES
      : ALIEN_BIOMES;
  const biome = zonePool[Math.floor(((depth - 1) % 10) / 2) % zonePool.length];
  const rand = createRng(depth * 7919 + Math.floor(Math.random() * 100000));

  const tiles: TileType[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0 as TileType)
  );
  const explored: boolean[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => false)
  );

  const rooms: RoomRect[] = [];

  const overlaps = (x: number, z: number, w: number, h: number, pad = 2) => {
    return rooms.some(
      (r) =>
        x - pad < r.x + r.w &&
        x + w + pad > r.x &&
        z - pad < r.z + r.h &&
        z + h + pad > r.z
    );
  };

  // Scale room count proportionally with dungeon area (6..8 at 34x34 up to 20..24 at 68x68)
  const areaRatio = (width * height) / (34 * 34);
  const withinTierBonus = Math.floor(((depth - 1) % 5) / 2);
  const targetRooms = Math.min(24, Math.round(6 * areaRatio) + withinTierBonus);
  const maxAttempts = Math.round(300 * areaRatio);
  const roomSpanRange = tier >= 2 ? 5 : 4; // 5..8 early, up to 5..9 in grand deep floors

  for (let attempt = 0; attempt < maxAttempts && rooms.length < targetRooms; attempt++) {
    const w = 5 + Math.floor(rand() * roomSpanRange);
    const h = 5 + Math.floor(rand() * roomSpanRange);
    const x = 3 + Math.floor(rand() * (width - w - 6));
    const z = 3 + Math.floor(rand() * (height - h - 6));

    if (!overlaps(x, z, w, h, 2)) {
      rooms.push({
        id: rooms.length,
        x,
        z,
        w,
        h,
        cx: Math.floor(x + w / 2),
        cz: Math.floor(z + h / 2),
        role: 'combat',
      });
    }
  }

  // Fallback deterministic grid if random placement yielded < 4 rooms
  if (rooms.length < 4) {
    rooms.length = 0;
    const presets = [
      { x: 4, z: 4, w: 6, h: 6 },
      { x: 14, z: 4, w: 6, h: 6 },
      { x: 24, z: 4, w: 6, h: 6 },
      { x: 4, z: 16, w: 6, h: 6 },
      { x: 14, z: 16, w: 6, h: 6 },
      { x: 24, z: 18, w: 6, h: 6 },
    ];
    presets.forEach((p, id) =>
      rooms.push({
        id,
        ...p,
        cx: Math.floor(p.x + p.w / 2),
        cz: Math.floor(p.z + p.h / 2),
        role: 'combat',
      })
    );
  }

  // Assign roles: Room 0 = start, farthest = exit (locked), second-farthest = key vault, one middle = shrine
  rooms[0].role = 'start';
  const distFromStart = (r: RoomRect) =>
    Math.hypot(r.cx - rooms[0].cx, r.cz - rooms[0].cz);

  const sortedByDist = [...rooms.slice(1)].sort((a, b) => distFromStart(b) - distFromStart(a));
  const exitRoom = sortedByDist[0];
  exitRoom.role = 'exit';

  const keyRoom = sortedByDist[1] ?? rooms[rooms.length - 1];
  keyRoom.role = 'key';

  const shrineRoom = sortedByDist[Math.floor(sortedByDist.length / 2)];
  if (shrineRoom && shrineRoom.role === 'combat') {
    shrineRoom.role = 'shrine';
  }

  // Carve rooms
  const carveRect = (x: number, z: number, w: number, h: number) => {
    for (let gz = z; gz < z + h; gz++) {
      for (let gx = x; gx < x + w; gx++) {
        if (gx > 1 && gx < width - 2 && gz > 1 && gz < height - 2) {
          tiles[gz][gx] = 1;
        }
      }
    }
  };

  for (const r of rooms) {
    carveRect(r.x, r.z, r.w, r.h);
  }

  // Connect non-exit rooms in a clean spanning tree (so exit room has ONLY ONE corridor entrance!)
  const nonExitRooms = rooms.filter((r) => r !== exitRoom);
  const connected: RoomRect[] = [rooms[0]];
  const remaining = nonExitRooms.filter((r) => r !== rooms[0]);

  const carveCorridor = (x1: number, z1: number, x2: number, z2: number, wide = true) => {
    let cx = x1;
    let cz = z1;
    const stepX = x2 >= x1 ? 1 : -1;
    while (cx !== x2) {
      tiles[cz][cx] = 1;
      if (wide && cz + 1 < height - 2) tiles[cz + 1][cx] = 1;
      cx += stepX;
    }
    const stepZ = z2 >= z1 ? 1 : -1;
    while (cz !== z2) {
      tiles[cz][cx] = 1;
      if (wide && cx + 1 < width - 2) tiles[cz][cx + 1] = 1;
      cz += stepZ;
    }
    tiles[cz][cx] = 1;
  };

  while (remaining.length > 0) {
    let bestDist = Infinity;
    let bestA = connected[0];
    let bestBIdx = 0;
    for (const a of connected) {
      remaining.forEach((b, idx) => {
        const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
        if (d < bestDist) {
          bestDist = d;
          bestA = a;
          bestBIdx = idx;
        }
      });
    }
    const target = remaining.splice(bestBIdx, 1)[0];
    carveCorridor(bestA.cx, bestA.cz, target.cx, target.cz, true);
    connected.push(target);
  }

  // Add extra loop corridors between non-exit rooms so larger dungeons feel sprawling & interconnected
  const corridorCrossesExit = (x1: number, z1: number, x2: number, z2: number) => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);
    const ex0 = exitRoom.x - 1;
    const ex1 = exitRoom.x + exitRoom.w;
    const ez0 = exitRoom.z - 1;
    const ez1 = exitRoom.z + exitRoom.h;
    // Check horizontal leg (z1, minX..maxX) and vertical leg (x2, minZ..maxZ)
    const horizHits = z1 >= ez0 && z1 <= ez1 && maxX >= ex0 && minX <= ex1;
    const vertHits = x2 >= ex0 && x2 <= ex1 && maxZ >= ez0 && minZ <= ez1;
    return horizHits || vertHits;
  };

  if (connected.length >= 4) {
    const loopCount = Math.min(4, Math.floor(connected.length / 4));
    for (let l = 0; l < loopCount; l++) {
      const idxA = (1 + l * 3) % connected.length;
      const idxB = (connected.length - 1 - l * 2 + connected.length) % connected.length;
      if (idxA === idxB) continue;
      const a = connected[idxA];
      const b = connected[idxB];
      if (!corridorCrossesExit(a.cx, a.cz, b.cx, b.cz)) {
        carveCorridor(a.cx, a.cz, b.cx, b.cz, false);
      }
    }
  }

  // Connect exitRoom to its single nearest non-exit room via a 1-tile narrow doorway so the Locked Gate seals it cleanly
  let nearestToExit = nonExitRooms[0];
  let bestExitDist = Infinity;
  for (const r of nonExitRooms) {
    const d = Math.hypot(r.cx - exitRoom.cx, r.cz - exitRoom.cz);
    if (d < bestExitDist) {
      bestExitDist = d;
      nearestToExit = r;
    }
  }

  // Trace path from exitRoom center toward nearestToExit center and find the exact tile on exitRoom border for the Locked Gate
  let doorPos = { gx: exitRoom.cx, gz: exitRoom.z - 1, horizontal: true };
  {
    const pathTiles: Array<{ gx: number; gz: number; horiz: boolean }> = [];
    let cx = exitRoom.cx;
    let cz = exitRoom.cz;
    const dx = nearestToExit.cx - cx;
    const dz = nearestToExit.cz - cz;

    const carveStep = (nx: number, nz: number, horiz: boolean) => {
      const inExit =
        nx >= exitRoom.x &&
        nx < exitRoom.x + exitRoom.w &&
        nz >= exitRoom.z &&
        nz < exitRoom.z + exitRoom.h;
      if (!inExit) {
        pathTiles.push({ gx: nx, gz: nz, horiz });
      }
      tiles[nz][nx] = 1;
    };

    // Move along the dominant axis first out of exitRoom so the doorway sits cleanly perpendicular to its wall
    if (Math.abs(dx) >= Math.abs(dz)) {
      const sx = dx >= 0 ? 1 : -1;
      while (cx !== nearestToExit.cx) {
        cx += sx;
        carveStep(cx, cz, false); // vertical gate across horizontal corridor
      }
      const sz = dz >= 0 ? 1 : -1;
      while (cz !== nearestToExit.cz) {
        cz += sz;
        carveStep(cx, cz, true);
      }
    } else {
      const sz = dz >= 0 ? 1 : -1;
      while (cz !== nearestToExit.cz) {
        cz += sz;
        carveStep(cx, cz, true); // horizontal gate across vertical corridor
      }
      const sx = dx >= 0 ? 1 : -1;
      while (cx !== nearestToExit.cx) {
        cx += sx;
        carveStep(cx, cz, false);
      }
    }

    if (pathTiles.length > 0) {
      const first = pathTiles[0];
      doorPos = { gx: first.gx, gz: first.gz, horizontal: first.horiz };
    }
  }

  // Surround every floor tile with Wall (2) on all 8 neighbors
  for (let gz = 1; gz < height - 1; gz++) {
    for (let gx = 1; gx < width - 1; gx++) {
      if (tiles[gz][gx] !== 0) continue;
      let touchesFloor = false;
      for (let dz = -1; dz <= 1 && !touchesFloor; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (tiles[gz + dz][gx + dx] === 1) {
            touchesFloor = true;
            break;
          }
        }
      }
      if (touchesFloor) {
        tiles[gz][gx] = 2;
      }
    }
  }

  // Mark Locked Gate tile (3) and ensure flanking walls on its sides
  tiles[doorPos.gz][doorPos.gx] = 3;

  // Place Descending Stairs (4) in exitRoom center
  const stairsPos = { gx: exitRoom.cx, gz: exitRoom.cz };
  tiles[stairsPos.gz][stairsPos.gx] = 4;

  const spawn = { gx: rooms[0].cx, gz: rooms[0].cz };
  const keyPos = { gx: keyRoom.cx, gz: keyRoom.cz };

  // Place architectural props: pillars, rune wells, wall torches, braziers, crates, banners, spike traps
  const props: DungeonPropData[] = [];
  const occupied = new Set<string>([
    `${spawn.gx},${spawn.gz}`,
    `${keyPos.gx},${keyPos.gz}`,
    `${doorPos.gx},${doorPos.gz}`,
    `${stairsPos.gx},${stairsPos.gz}`,
  ]);

  const isOpenFloor = (gx: number, gz: number) =>
    gx > 1 &&
    gx < width - 2 &&
    gz > 1 &&
    gz < height - 2 &&
    tiles[gz][gx] === 1 &&
    !occupied.has(`${gx},${gz}`);

  // Pre-Boss Altar of Ascension on floors 4, 9, 14, 19... (depth % 5 === 4)
  let altarPos: { gx: number; gz: number } | undefined;
  if (depth % 5 === 4) {
    const startRoom = rooms[0];
    const candidates = [
      { gx: startRoom.cx + 1, gz: startRoom.cz - 1 },
      { gx: startRoom.cx + 1, gz: startRoom.cz },
      { gx: startRoom.cx - 1, gz: startRoom.cz - 1 },
      { gx: startRoom.cx, gz: startRoom.cz - 1 },
      { gx: startRoom.cx - 1, gz: startRoom.cz },
    ];
    for (const c of candidates) {
      if (isOpenFloor(c.gx, c.gz)) {
        altarPos = c;
        occupied.add(`${c.gx},${c.gz}`);
        break;
      }
    }
  }

  // Dedicated Elixir Potion Shop on every 3rd floor (Depth 3, 6, 9, 12, 15...)
  let shopPos: { gx: number; gz: number } | undefined;
  if (depth % 3 === 0) {
    const startRoom = rooms[0];
    const shopCandidates = [
      { gx: startRoom.cx - 1, gz: startRoom.cz + 1 },
      { gx: startRoom.cx + 1, gz: startRoom.cz + 1 },
      { gx: startRoom.cx - 1, gz: startRoom.cz },
      { gx: startRoom.cx, gz: startRoom.cz + 1 },
      { gx: startRoom.cx - 1, gz: startRoom.cz - 1 },
      { gx: startRoom.cx + 1, gz: startRoom.cz - 1 },
      { gx: startRoom.cx + 1, gz: startRoom.cz },
      { gx: startRoom.cx, gz: startRoom.cz - 1 },
    ];
    for (const c of shopCandidates) {
      if (isOpenFloor(c.gx, c.gz)) {
        shopPos = c;
        occupied.add(`${c.gx},${c.gz}`);
        break;
      }
    }
  }

  for (const r of rooms) {
    // Pillars in inner corners of larger rooms: require ALL 8 surrounding tiles to be open floor so hero never wedges between a pillar and a wall corner
    if (r.w >= 6 && r.h >= 6 && r.role !== 'exit' && !(r.role === 'key' && depth % 5 === 0)) {
      const corners = [
        [r.x + 1, r.z + 1],
        [r.x + r.w - 2, r.z + 1],
        [r.x + 1, r.z + r.h - 2],
        [r.x + r.w - 2, r.z + r.h - 2],
      ];
      for (const [px, pz] of corners) {
        let all8Open = true;
        for (let dz = -1; dz <= 1 && all8Open; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            if (tiles[pz + dz]?.[px + dx] !== 1) {
              all8Open = false;
              break;
            }
          }
        }
        if (all8Open && isOpenFloor(px, pz)) {
          tiles[pz][px] = 5;
          occupied.add(`${px},${pz}`);
        }
      }
    }

    // Arcane Rune Well in start room, shrine room, and select combat halls for rich cool-vs-warm contrast
    if (r.role === 'shrine' || r.role === 'start' || (r.role === 'combat' && r.id % 2 === 1)) {
      const rx = r.role === 'start' ? r.x + 1 : r.cx;
      const rz = r.role === 'start' ? r.cz : r.cz;
      if (isOpenFloor(rx, rz)) {
        props.push({ type: 'rune_well', gx: rx, gz: rz });
        occupied.add(`${rx},${rz}`);
      }
    }

    // Standing Fire Brazier in key room, exit room, and combat rooms
    if (r.role === 'key' || r.role === 'exit' || rand() < 0.65) {
      const bx = r.x + (r.w > 5 ? 1 : 0);
      const bz = r.z + (r.h > 5 ? r.h - 2 : r.h - 1);
      if (isOpenFloor(bx, bz)) {
        props.push({ type: 'brazier', gx: bx, gz: bz });
        occupied.add(`${bx},${bz}`);
      }
    }

    // Breakable Crates & Gilded Urns along walls
    const crateCount = r.role === 'start' ? 2 : 2 + Math.floor(rand() * 2);
    for (let c = 0; c < crateCount; c++) {
      const cx = r.x + (rand() < 0.5 ? 0 : r.w - 1);
      const cz = r.z + Math.floor(rand() * r.h);
      if (isOpenFloor(cx, cz)) {
        props.push({ type: rand() < 0.55 ? 'crate' : 'urn', gx: cx, gz: cz });
        occupied.add(`${cx},${cz}`);
      }
    }

    // Pressure-plate Spike Trap in combat rooms (never blocking spawn/key/exit)
    if (r.role === 'combat' && rand() < 0.6) {
      const sx = r.cx + (rand() < 0.5 ? -1 : 1);
      const sz = r.cz;
      if (isOpenFloor(sx, sz)) {
        tiles[sz][sx] = 6;
        props.push({ type: 'spike', gx: sx, gz: sz });
        occupied.add(`${sx},${sz}`);
      }
    }

    // Wall torches & guild banners on north and west walls (visible to isometric camera looking from +X/+Z toward -X/-Z)
    for (let wx = r.x + 1; wx < r.x + r.w - 1; wx += 2) {
      if (tiles[r.z - 1]?.[wx] === 2 && tiles[r.z][wx] === 1) {
        if ((wx + r.id) % 4 === 0) {
          props.push({ type: 'torch', gx: wx, gz: r.z, facing: 0 });
        } else if ((wx + r.id) % 2 === 0) {
          props.push({ type: 'banner', gx: wx, gz: r.z, facing: 0 });
        }
      }
    }
    for (let wz = r.z + 1; wz < r.z + r.h - 1; wz += 2) {
      if (tiles[wz]?.[r.x - 1] === 2 && tiles[wz][r.x] === 1) {
        if ((wz + r.id) % 4 === 1) {
          props.push({ type: 'torch', gx: r.x, gz: wz, facing: Math.PI / 2 });
        } else if ((wz + r.id) % 2 === 1) {
          props.push({ type: 'banner', gx: r.x, gz: wz, facing: Math.PI / 2 });
        }
      }
    }
  }

  return {
    width,
    height,
    tiles,
    explored,
    rooms,
    props,
    spawn,
    keyPos,
    doorPos,
    stairsPos,
    altarPos,
    shopPos,
    biome,
  };
}

export function gridToWorld(gx: number, gz: number): { x: number; z: number } {
  return { x: gx * TILE_SIZE, z: gz * TILE_SIZE };
}

export function worldToGrid(x: number, z: number): { gx: number; gz: number } {
  return { gx: Math.round(x / TILE_SIZE), gz: Math.round(z / TILE_SIZE) };
}

export function isTileWalkable(
  dungeon: DungeonData,
  gx: number,
  gz: number,
  canPassDoor: boolean
): boolean {
  if (gx < 0 || gz < 0 || gx >= dungeon.width || gz >= dungeon.height) return false;
  const t = dungeon.tiles[gz][gx];
  if (t === 1 || t === 4 || t === 6) return true;
  if (t === 3 && canPassDoor) return true;
  return false;
}

/** Convert world coordinates to the nearest walkable grid cell (prevents pillar-edge actors snapping to the wrong side). */
export function worldToWalkableGrid(
  dungeon: DungeonData,
  x: number,
  z: number,
  canPassDoor: boolean
): { gx: number; gz: number } {
  const base = worldToGrid(x, z);
  if (isTileWalkable(dungeon, base.gx, base.gz, canPassDoor)) {
    return base;
  }
  let best = base;
  let bestDistSq = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = base.gx + dx;
      const nz = base.gz + dz;
      if (!isTileWalkable(dungeon, nx, nz, canPassDoor)) continue;
      const wx = nx * TILE_SIZE;
      const wz = nz * TILE_SIZE;
      const dSq = (wx - x) * (wx - x) + (wz - z) * (wz - z);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = { gx: nx, gz: nz };
      }
    }
  }
  return best;
}

/** Check if a body-width corridor between two world points is free of walls, pillars, and closed doors. */
export function hasLineOfSight(
  dungeon: DungeonData,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  canPassDoor: boolean,
  clearance = 0.42
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return true;

  const perpX = (-dz / dist) * clearance;
  const perpZ = (dx / dist) * clearance;
  const offsets: Array<[number, number]> =
    clearance > 0
      ? [
          [0, 0],
          [perpX, perpZ],
          [-perpX, -perpZ],
        ]
      : [[0, 0]];

  const steps = Math.max(2, Math.ceil(dist / 0.4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const bx = x1 + dx * t;
    const bz = z1 + dz * t;
    for (let o = 0; o < offsets.length; o++) {
      const sx = bx + offsets[o][0];
      const sz = bz + offsets[o][1];
      const { gx, gz } = worldToGrid(sx, sz);
      if (gx < 0 || gz < 0 || gx >= dungeon.width || gz >= dungeon.height) return false;
      const tile = dungeon.tiles[gz][gx];
      if (tile === 0 || tile === 2) return false;
      if (tile === 3 && !canPassDoor) return false;
      if (tile === 5) {
        const px = gx * TILE_SIZE;
        const pz = gz * TILE_SIZE;
        if (Math.hypot(sx - px, sz - pz) < 0.82) return false;
      }
    }
  }
  return true;
}

function snapToWalkable(
  dungeon: DungeonData,
  gx: number,
  gz: number,
  canPassDoor: boolean
): { gx: number; gz: number } {
  if (isTileWalkable(dungeon, gx, gz, canPassDoor)) return { gx, gz };
  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (const [dx, dz] of offsets) {
    if (isTileWalkable(dungeon, gx + dx, gz + dz, canPassDoor)) {
      return { gx: gx + dx, gz: gz + dz };
    }
  }
  return { gx, gz };
}

/** Fast grid A* pathfinder returning tile coordinates excluding the start tile. */
export function findGridPath(
  dungeon: DungeonData,
  rawStartGx: number,
  rawStartGz: number,
  rawGoalGx: number,
  rawGoalGz: number,
  canPassDoor: boolean
): Array<{ gx: number; gz: number }> {
  const s = snapToWalkable(dungeon, rawStartGx, rawStartGz, canPassDoor);
  const g = snapToWalkable(dungeon, rawGoalGx, rawGoalGz, canPassDoor);
  const startGx = s.gx;
  const startGz = s.gz;
  const goalGx = g.gx;
  const goalGz = g.gz;

  if (startGx === goalGx && startGz === goalGz) return [];
  if (!isTileWalkable(dungeon, goalGx, goalGz, canPassDoor)) return [];

  const w = dungeon.width;
  const h = dungeon.height;
  const total = w * h;
  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const inOpen = new Uint8Array(total);

  const key = (x: number, z: number) => z * w + x;
  const startKey = key(startGx, startGz);
  const goalKey = key(goalGx, goalGz);

  gScore[startKey] = 0;
  fScore[startKey] = Math.abs(goalGx - startGx) + Math.abs(goalGz - startGz);

  const open: number[] = [startKey];
  inOpen[startKey] = 1;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (open.length > 0) {
    let bestIdx = 0;
    let bestF = fScore[open[0]];
    for (let i = 1; i < open.length; i++) {
      const f = fScore[open[i]];
      if (f < bestF) {
        bestF = f;
        bestIdx = i;
      }
    }

    const current = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();
    inOpen[current] = 0;

    if (current === goalKey) {
      const path: Array<{ gx: number; gz: number }> = [];
      let curr = current;
      while (curr !== -1 && curr !== startKey) {
        path.push({ gx: curr % w, gz: Math.floor(curr / w) });
        curr = cameFrom[curr];
      }
      path.reverse();
      return path;
    }

    closed[current] = 1;
    const cx = current % w;
    const cz = Math.floor(current / w);

    for (let d = 0; d < 4; d++) {
      const nx = cx + dirs[d][0];
      const nz = cz + dirs[d][1];
      if (!isTileWalkable(dungeon, nx, nz, canPassDoor)) continue;
      const nKey = key(nx, nz);
      if (closed[nKey]) continue;

      // Slightly penalize spike traps so AI walks around them when possible
      const stepCost = dungeon.tiles[nz][nx] === 6 ? 3.5 : 1.0;
      const tentativeG = gScore[current] + stepCost;
      if (tentativeG < gScore[nKey]) {
        cameFrom[nKey] = current;
        gScore[nKey] = tentativeG;
        fScore[nKey] = tentativeG + Math.abs(goalGx - nx) + Math.abs(goalGz - nz);
        if (!inOpen[nKey]) {
          open.push(nKey);
          inOpen[nKey] = 1;
        }
      }
    }
  }

  return [];
}
