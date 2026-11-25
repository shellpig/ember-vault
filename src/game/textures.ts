import * as THREE from 'three';
import { BiomeConfig } from './types';

export interface DungeonTextureSet {
  floorMap: THREE.CanvasTexture;
  floorBump: THREE.CanvasTexture;
  floorVariants?: THREE.CanvasTexture[];
  wallMap: THREE.CanvasTexture;
  wallBump: THREE.CanvasTexture;
  wallVariants?: THREE.CanvasTexture[];
  pillarMap: THREE.CanvasTexture;
  crateMap: THREE.CanvasTexture;
  doorMap: THREE.CanvasTexture;
  bannerMap: THREE.CanvasTexture;
  runeMap: THREE.CanvasTexture;
  glowMap: THREE.CanvasTexture;
  shadowMap: THREE.CanvasTexture;
  dispose: () => void;
}

const CAVERN_CRYSTAL_PALETTE: Array<{ main: string; core: string; rim: string }> = [
  { main: '#38db7c', core: '#c8ffdf', rim: '#164d30' }, // Green
  { main: '#f2c938', core: '#fff5bf', rim: '#5c4610' }, // Yellow
  { main: '#b964f5', core: '#efd4ff', rim: '#431a61' }, // Purple
  { main: '#3ea8f5', core: '#ccebff', rim: '#143d61' }, // Blue
];

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

function shiftColor(rgb: [number, number, number], delta: number): string {
  const r = Math.max(0, Math.min(255, rgb[0] + delta));
  const g = Math.max(0, Math.min(255, rgb[1] + delta));
  const b = Math.max(0, Math.min(255, rgb[2] + delta));
  return `rgb(${r},${g},${b})`;
}

function finalizePixelTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  anisotropy: number,
  repeat = false
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.anisotropy = anisotropy;
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

export function createDungeonTextures(
  biome: BiomeConfig,
  maxAnisotropy: number,
  seed: number
): DungeonTextureSet {
  const rand = seededRand(seed);
  const aniso = Math.min(maxAnisotropy, 8);

  const theme = biome.terrainTheme;

  // 1. Floor Texture + Matching Bump (64x64)
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 64;
  floorCanvas.height = 64;
  const fctx = floorCanvas.getContext('2d')!;

  const floorBumpCanvas = document.createElement('canvas');
  floorBumpCanvas.width = 64;
  floorBumpCanvas.height = 64;
  const fbctx = floorBumpCanvas.getContext('2d')!;

  const baseRgb = hexToRgb(biome.floorBase);
  const accentRgb = hexToRgb(biome.floorAccent);

  fctx.fillStyle = biome.floorMortar;
  fctx.fillRect(0, 0, 64, 64);
  fbctx.fillStyle = '#202020';
  fbctx.fillRect(0, 0, 64, 64);

  if (theme === 'cavern') {
    // Subterranean Cavern Floor: rough packed cave earth, irregular rock slabs, pebbles & mineral flecks
    fctx.fillStyle = shiftColor(baseRgb, -16);
    fctx.fillRect(0, 0, 64, 64);
    fbctx.fillStyle = '#7a7a7a';
    fbctx.fillRect(0, 0, 64, 64);

    // Coarse gritty cave soil noise
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const d = Math.floor((rand() - 0.5) * 30);
        fctx.fillStyle = shiftColor(rand() < 0.35 ? accentRgb : baseRgb, d - 8);
        fctx.fillRect(x, y, 2, 2);
        const bv = 95 + Math.floor(rand() * 55);
        fbctx.fillStyle = `rgb(${bv},${bv},${bv})`;
        fbctx.fillRect(x, y, 2, 2);
      }
    }

    // Irregular rough cave rock flagstones & rounded pebbles
    for (let i = 0; i < 16; i++) {
      const rx = Math.floor(rand() * 56);
      const ry = Math.floor(rand() * 56);
      const rw = 6 + Math.floor(rand() * 10);
      const rh = 5 + Math.floor(rand() * 9);
      const rgb = rand() < 0.42 ? accentRgb : baseRgb;
      const shade = Math.floor((rand() - 0.5) * 24) + 8;

      fctx.fillStyle = biome.floorMortar;
      fctx.fillRect(rx, ry, rw, rh);
      fctx.fillStyle = shiftColor(rgb, shade);
      fctx.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
      fctx.fillStyle = shiftColor(rgb, shade + 18);
      fctx.fillRect(rx + 1, ry + 1, rw - 3, 1);
      fctx.fillStyle = shiftColor(rgb, shade - 18);
      fctx.fillRect(rx + 2, ry + rh - 2, rw - 3, 1);

      fbctx.fillStyle = '#d8d8d8';
      fbctx.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
      fbctx.fillStyle = '#ffffff';
      fbctx.fillRect(rx + 1, ry + 1, rw - 3, 1);
    }

    // Dark rocky fissures
    fctx.fillStyle = biome.floorMortar;
    for (let c = 0; c < 4; c++) {
      let cx = Math.floor(rand() * 54) + 4;
      let cy = Math.floor(rand() * 54) + 4;
      for (let s = 0; s < 7; s++) {
        fctx.fillRect(cx, cy, 2, 1);
        fbctx.fillStyle = '#181818';
        fbctx.fillRect(cx, cy, 2, 1);
        cx = (cx + (rand() < 0.5 ? 2 : 1)) & 63;
        cy = (cy + (rand() < 0.5 ? 1 : -1) + 64) & 63;
      }
    }

    // Base cavern floor stays clean rock; multicolor crystal flecks (~1/5 density) are added in floorVariants below
  } else if (theme === 'flesh') {
    // Monster Interior Floor: pink & purple organic cellular flesh, pulsing veins & moist tissue blisters
    fctx.fillStyle = shiftColor(accentRgb, -14);
    fctx.fillRect(0, 0, 64, 64);
    fbctx.fillStyle = '#484848';
    fbctx.fillRect(0, 0, 64, 64);

    // Organic cellular membrane lobes
    const cells = 18;
    for (let i = 0; i < cells; i++) {
      const cx = Math.floor(rand() * 64);
      const cy = Math.floor(rand() * 64);
      const rad = 5 + Math.floor(rand() * 7);
      const rgb = i % 3 === 0 ? accentRgb : baseRgb;
      const shade = Math.floor((rand() - 0.5) * 24);

      // Wrap around tile edges so texture tiles seamlessly
      for (const ox of [-64, 0, 64]) {
        for (const oy of [-64, 0, 64]) {
          const px = cx + ox;
          const py = cy + oy;
          if (px + rad < 0 || px - rad > 64 || py + rad < 0 || py - rad > 64) continue;
          fctx.fillStyle = biome.floorMortar;
          fctx.beginPath();
          fctx.arc(px, py, rad + 1, 0, Math.PI * 2);
          fctx.fill();

          fctx.fillStyle = shiftColor(rgb, shade);
          fctx.beginPath();
          fctx.arc(px, py, rad, 0, Math.PI * 2);
          fctx.fill();

          // Moist inner highlight blister
          fctx.fillStyle = shiftColor(rgb, shade + 28);
          fctx.fillRect(px - Math.floor(rad * 0.4), py - Math.floor(rad * 0.4), 3, 2);

          fbctx.fillStyle = '#d4d4d4';
          fbctx.beginPath();
          fbctx.arc(px, py, rad - 1, 0, Math.PI * 2);
          fbctx.fill();
          fbctx.fillStyle = '#ffffff';
          fbctx.fillRect(px - 2, py - 2, 3, 3);
        }
      }
    }

    // Branching pulsing pink-magenta capillary veins
    for (let v = 0; v < 5; v++) {
      let vx = Math.floor(rand() * 64);
      let vy = Math.floor(rand() * 64);
      const col = v % 2 === 0 ? '#e364b8' : '#b25cff';
      for (let s = 0; s < 14; s++) {
        fctx.fillStyle = col;
        fctx.fillRect(vx & 63, vy & 63, 2, 2);
        if (s % 4 === 0) {
          fctx.fillStyle = '#ffb8ec';
          fctx.fillRect(vx & 63, vy & 63, 1, 1);
        }
        vx += rand() < 0.65 ? 2 : 1;
        vy += rand() < 0.5 ? 1 : -1;
      }
    }
  } else {
    // Classic Stone Dungeon Flagstone Floor (Depths 1-10)
    const rows = 4;
    const rowH = 16;
    for (let row = 0; row < rows; row++) {
      let x = (row % 2) * -8;
      while (x < 64) {
        const w = 14 + Math.floor(rand() * 10);
        const sx = x + 1;
        const sy = row * rowH + 1;
        const sw = w - 2;
        const sh = rowH - 2;

        const useAccent = rand() < 0.28;
        const rgb = useAccent ? accentRgb : baseRgb;
        const shade = Math.floor((rand() - 0.5) * 26);

        fctx.fillStyle = shiftColor(rgb, shade);
        fctx.fillRect(sx, sy, sw, sh);

        fctx.fillStyle = shiftColor(rgb, shade + 18);
        fctx.fillRect(sx, sy, sw, 1);
        fctx.fillRect(sx, sy, 1, sh);

        fctx.fillStyle = shiftColor(rgb, shade - 18);
        fctx.fillRect(sx, sy + sh - 1, sw, 1);
        fctx.fillRect(sx + sw - 1, sy, 1, sh);

        for (let p = 0; p < 10; p++) {
          const px = sx + 1 + Math.floor(rand() * Math.max(1, sw - 2));
          const py = sy + 1 + Math.floor(rand() * Math.max(1, sh - 2));
          fctx.fillStyle = shiftColor(rgb, shade + (rand() > 0.5 ? 12 : -14));
          fctx.fillRect(px, py, 1, 1);
        }

        if (rand() < 0.25) {
          fctx.fillStyle = biome.id === 'forge' ? '#5c3322' : '#2d4739';
          fctx.fillRect(sx, sy + sh - 1, 2, 1);
        }

        const bVal = 170 + Math.floor((rand() - 0.5) * 40);
        fbctx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
        fbctx.fillRect(sx, sy, sw, sh);
        fbctx.fillStyle = '#ffffff';
        fbctx.fillRect(sx, sy, sw, 1);

        x += w;
      }
    }
  }

  // 2. Wall Texture + Bump (64x64)
  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = 64;
  wallCanvas.height = 64;
  const wctx = wallCanvas.getContext('2d')!;

  const wallBumpCanvas = document.createElement('canvas');
  wallBumpCanvas.width = 64;
  wallBumpCanvas.height = 64;
  const wbctx = wallBumpCanvas.getContext('2d')!;

  const wallRgb = hexToRgb(biome.wallBase);
  const wallAccRgb = hexToRgb(biome.wallAccent);

  wctx.fillStyle = biome.floorMortar;
  wctx.fillRect(0, 0, 64, 64);
  wbctx.fillStyle = '#181818';
  wbctx.fillRect(0, 0, 64, 64);

  if (theme === 'cavern') {
    // Stratified natural cavern cliff rock with jagged strata & glowing ore crystal seams
    for (let y = 0; y < 64; y += 2) {
      const bandShade = Math.round(Math.sin(y * 0.28) * 14);
      const useAcc = y % 14 >= 8;
      const rgb = useAcc ? wallAccRgb : wallRgb;
      for (let x = 0; x < 64; x += 2) {
        const wave = Math.round(Math.sin(x * 0.22 + y * 0.14) * 10);
        const grain = Math.floor((rand() - 0.5) * 18);
        const shade = bandShade + wave + grain - (y > 54 ? 18 : 0);
        wctx.fillStyle = shiftColor(rgb, shade);
        wctx.fillRect(x, y, 2, 2);
        const bv = Math.max(40, Math.min(240, 145 + shade * 2));
        wbctx.fillStyle = `rgb(${bv},${bv},${bv})`;
        wbctx.fillRect(x, y, 2, 2);
      }
    }
    // Deep irregular cave rock ledges & vertical fractures
    for (let l = 0; l < 6; l++) {
      const ly = 6 + l * 10 + Math.floor(rand() * 3);
      for (let x = 0; x < 64; x += 2) {
        const jitter = Math.round(Math.sin(x * 0.35 + l * 2.1) * 1.5);
        wctx.fillStyle = biome.floorMortar;
        wctx.fillRect(x, ly + jitter, 2, 2);
        wctx.fillStyle = shiftColor(wallRgb, 22);
        wctx.fillRect(x, ly + jitter + 2, 2, 1);
        wbctx.fillStyle = '#151515';
        wbctx.fillRect(x, ly + jitter, 2, 2);
      }
    }
    // Multicolor crystal ore pockets (1/2 density across 4 wall variants) are drawn onto wallVariants below
  } else if (theme === 'flesh') {
    // Organic ribbed pink-and-purple sinew chamber walls with muscular striations & bio-nodules
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const rib = Math.sin(x * 0.32 + Math.sin(y * 0.15) * 1.8);
        const strand = Math.sin(y * 0.45 + x * 0.12);
        const rgb = rib > 0.15 ? wallAccRgb : wallRgb;
        const shade = Math.round(rib * 22 + strand * 10 + (rand() - 0.5) * 10) - (y > 54 ? 18 : 0);
        wctx.fillStyle = shiftColor(rgb, shade);
        wctx.fillRect(x, y, 2, 2);
        const bv = Math.max(30, Math.min(245, 140 + Math.round(rib * 75)));
        wbctx.fillStyle = `rgb(${bv},${bv},${bv})`;
        wbctx.fillRect(x, y, 2, 2);
      }
    }
    // Curved dark-plum sinew grooves + glistening lavender highlights
    for (let gx = 4; gx < 64; gx += 16) {
      for (let y = 0; y < 64; y += 2) {
        const off = Math.round(Math.sin(y * 0.16 + gx) * 2.5);
        wctx.fillStyle = biome.floorMortar;
        wctx.fillRect((gx + off) & 63, y, 2, 2);
        wctx.fillStyle = '#e88ac9';
        wctx.fillRect((gx + off + 3) & 63, y, 1, 2);
        wbctx.fillStyle = '#141414';
        wbctx.fillRect((gx + off) & 63, y, 2, 2);
      }
    }
    // Glowing magenta/violet bioluminescent organ nodules
    for (let n = 0; n < 5; n++) {
      const nx = 6 + Math.floor(rand() * 52);
      const ny = 10 + Math.floor(rand() * 42);
      wctx.fillStyle = '#5c1854';
      wctx.fillRect(nx - 1, ny - 1, 6, 6);
      wctx.fillStyle = biome.runeCss;
      wctx.fillRect(nx, ny, 4, 4);
      wctx.fillStyle = '#ffd9fa';
      wctx.fillRect(nx + 1, ny + 1, 2, 2);
    }
  } else {
    // Classic Ashlar Wall Brick (Depths 1-10)
    const brickRows = 8;
    const brickH = 8;
    for (let r = 0; r < brickRows; r++) {
      let x = (r % 2) * -8;
      while (x < 64) {
        const bw = 16;
        const bx = x + 1;
        const by = r * brickH + 1;
        const rgb = rand() < 0.22 ? wallAccRgb : wallRgb;
        const shade = Math.floor((rand() - 0.5) * 24) - (r === 7 ? 16 : 0);

        wctx.fillStyle = shiftColor(rgb, shade);
        wctx.fillRect(bx, by, bw - 2, brickH - 2);
        wctx.fillStyle = shiftColor(rgb, shade + 16);
        wctx.fillRect(bx, by, bw - 2, 1);
        wctx.fillStyle = shiftColor(rgb, shade - 18);
        wctx.fillRect(bx, by + brickH - 3, bw - 2, 1);

        if (rand() < 0.18) {
          wctx.fillStyle = shiftColor(rgb, shade - 26);
          wctx.fillRect(bx + 4 + Math.floor(rand() * 6), by + 2, 1, 3);
        }

        const bVal = 185 + Math.floor((rand() - 0.5) * 30);
        wbctx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
        wbctx.fillRect(bx, by, bw - 2, brickH - 2);

        x += bw;
      }
    }
    wctx.fillStyle = shiftColor(wallRgb, 20);
    wctx.fillRect(0, 0, 64, 3);
    wctx.fillStyle = shiftColor(wallRgb, -22);
    wctx.fillRect(0, 3, 64, 1);
  }

  // 3. Pillar Texture (32x64)
  const pillarCanvas = document.createElement('canvas');
  pillarCanvas.width = 32;
  pillarCanvas.height = 64;
  const pctx = pillarCanvas.getContext('2d')!;
  if (theme === 'cavern') {
    // Natural rocky stalagmite column with crystal flecks
    pctx.fillStyle = shiftColor(wallRgb, -8);
    pctx.fillRect(0, 0, 32, 64);
    for (let fy = 0; fy < 64; fy += 4) {
      pctx.fillStyle = shiftColor(fy % 8 === 0 ? wallAccRgb : wallRgb, Math.floor((rand() - 0.5) * 24));
      pctx.fillRect(0, fy, 32, 4);
      pctx.fillStyle = biome.floorMortar;
      pctx.fillRect(0, fy + 3, 32, 1);
    }
    for (let c = 0; c < 3; c++) {
      const pal = CAVERN_CRYSTAL_PALETTE[(c + Math.floor(rand() * 4)) % CAVERN_CRYSTAL_PALETTE.length];
      const px = 4 + Math.floor(rand() * 22);
      const py = 8 + Math.floor(rand() * 48);
      pctx.fillStyle = pal.rim;
      pctx.fillRect(px - 1, py - 1, 5, 6);
      pctx.fillStyle = pal.main;
      pctx.fillRect(px, py, 3, 4);
      pctx.fillStyle = pal.core;
      pctx.fillRect(px + 1, py + 1, 1, 2);
    }
  } else if (theme === 'flesh') {
    // Ivory bone-cartilage rib column wrapped in pulsing pink-purple sinew
    pctx.fillStyle = '#c9a6ba';
    pctx.fillRect(0, 0, 32, 64);
    for (let fy = 0; fy < 64; fy += 8) {
      pctx.fillStyle = '#8a356e';
      pctx.fillRect(0, fy, 32, 3);
      pctx.fillStyle = '#d96cb8';
      pctx.fillRect(0, fy + 1, 32, 1);
    }
    for (let fx = 4; fx < 32; fx += 8) {
      pctx.fillStyle = '#73285e';
      pctx.fillRect(fx, 0, 2, 64);
    }
  } else {
    pctx.fillStyle = shiftColor(wallRgb, -6);
    pctx.fillRect(0, 0, 32, 64);
    for (let fx = 2; fx < 32; fx += 6) {
      pctx.fillStyle = shiftColor(wallRgb, -20);
      pctx.fillRect(fx, 6, 2, 52);
      pctx.fillStyle = shiftColor(wallRgb, 14);
      pctx.fillRect(fx + 2, 6, 1, 52);
    }
    for (let fy = 12; fy < 60; fy += 14) {
      pctx.fillStyle = biome.floorMortar;
      pctx.fillRect(0, fy, 32, 1);
    }
    pctx.fillStyle = '#9d7c3f';
    pctx.fillRect(0, 5, 32, 2);
    pctx.fillStyle = '#d4b26a';
    pctx.fillRect(0, 5, 32, 1);
  }

  // 4. Breakable Crate / Bio-Sac Texture (32x32)
  const crateCanvas = document.createElement('canvas');
  crateCanvas.width = 32;
  crateCanvas.height = 32;
  const cctx = crateCanvas.getContext('2d')!;
  if (theme === 'flesh') {
    cctx.fillStyle = '#752b63';
    cctx.fillRect(0, 0, 32, 32);
    cctx.fillStyle = '#ad4989';
    cctx.fillRect(4, 4, 24, 24);
    cctx.fillStyle = '#e882cc';
    cctx.fillRect(8, 8, 12, 10);
    cctx.fillStyle = '#47133b';
    cctx.fillRect(0, 14, 32, 3);
    cctx.fillRect(14, 0, 3, 32);
    cctx.fillStyle = '#ff94eb';
    cctx.fillRect(10, 10, 4, 4);
  } else {
    cctx.fillStyle = theme === 'cavern' ? '#524436' : '#5c3c24';
    cctx.fillRect(0, 0, 32, 32);
    for (let py = 0; py < 32; py += 6) {
      cctx.fillStyle = theme === 'cavern' ? '#3b3127' : '#472d1a';
      cctx.fillRect(0, py, 32, 1);
      cctx.fillStyle = theme === 'cavern' ? '#695847' : '#6f4a2e';
      cctx.fillRect(0, py + 1, 32, 1);
    }
    cctx.strokeStyle = theme === 'cavern' ? '#2c2620' : '#3b2514';
    cctx.lineWidth = 4;
    cctx.strokeRect(2, 2, 28, 28);
    cctx.strokeStyle = theme === 'cavern' ? '#5e4f3e' : '#6b472b';
    cctx.lineWidth = 3;
    cctx.beginPath();
    cctx.moveTo(4, 4);
    cctx.lineTo(28, 28);
    cctx.stroke();
    cctx.fillStyle = theme === 'cavern' ? biome.runeCss : '#c9a65a';
    cctx.fillRect(2, 2, 2, 2);
    cctx.fillRect(28, 2, 2, 2);
    cctx.fillRect(2, 28, 2, 2);
    cctx.fillRect(28, 28, 2, 2);
  }

  // 5. Locked Gate Texture (64x64)
  const doorCanvas = document.createElement('canvas');
  doorCanvas.width = 64;
  doorCanvas.height = 64;
  const dctx = doorCanvas.getContext('2d')!;
  if (theme === 'flesh') {
    dctx.fillStyle = '#4a1842';
    dctx.fillRect(0, 0, 64, 64);
    for (let px = 4; px < 64; px += 10) {
      dctx.fillStyle = '#d6b6c8';
      dctx.fillRect(px, 2, 4, 60);
      dctx.fillStyle = '#87336e';
      dctx.fillRect(px + 4, 2, 2, 60);
    }
    dctx.fillStyle = '#a1387d';
    dctx.fillRect(0, 12, 64, 6);
    dctx.fillRect(0, 46, 64, 6);
    dctx.fillStyle = '#ff70df';
    dctx.fillRect(24, 24, 16, 16);
    dctx.fillStyle = '#ffd9fa';
    dctx.fillRect(28, 28, 8, 8);
  } else {
    dctx.fillStyle = theme === 'cavern' ? '#2e3238' : '#3b2518';
    dctx.fillRect(0, 0, 64, 64);
    for (let px = 0; px < 64; px += 8) {
      dctx.fillStyle = theme === 'cavern' ? '#1e2126' : '#2a190f';
      dctx.fillRect(px, 0, 1, 64);
      dctx.fillStyle = theme === 'cavern' ? '#40454f' : '#4c3221';
      dctx.fillRect(px + 1, 0, 2, 64);
    }
    dctx.fillStyle = '#7d6232';
    dctx.fillRect(0, 10, 64, 6);
    dctx.fillRect(0, 48, 64, 6);
    dctx.fillStyle = theme === 'cavern' ? biome.runeCss : '#c8a355';
    dctx.fillRect(0, 10, 64, 2);
    dctx.fillRect(0, 48, 64, 2);
    dctx.fillStyle = '#c89b3c';
    dctx.fillRect(24, 24, 16, 18);
    dctx.fillStyle = '#ffe58a';
    dctx.fillRect(26, 26, 12, 14);
    dctx.fillStyle = '#1d1208';
    dctx.fillRect(30, 29, 4, 4);
    dctx.fillRect(31, 33, 2, 5);
  }

  // 6. Wall Tapestry / Hanging Crystal / Organic Tendril Drape (32x48)
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 32;
  bannerCanvas.height = 48;
  const bctx = bannerCanvas.getContext('2d')!;
  bctx.clearRect(0, 0, 32, 48);
  if (theme === 'flesh') {
    // Organic magenta/violet hanging tendril membrane
    bctx.fillStyle = '#7d286b';
    bctx.fillRect(4, 0, 24, 24);
    bctx.fillStyle = biome.bannerColor;
    bctx.fillRect(6, 2, 20, 22);
    bctx.fillRect(4, 22, 6, 18);
    bctx.fillRect(13, 22, 6, 24);
    bctx.fillRect(22, 22, 6, 15);
    bctx.fillStyle = '#ff8de6';
    bctx.fillRect(14, 10, 4, 14);
    bctx.fillRect(15, 28, 2, 12);
  } else {
    bctx.fillStyle = biome.bannerColor;
    bctx.fillRect(2, 2, 28, 38);
    bctx.fillRect(2, 40, 11, 6);
    bctx.fillRect(19, 40, 11, 6);
    bctx.fillRect(2, 44, 6, 3);
    bctx.fillRect(24, 44, 6, 3);
    bctx.fillStyle = theme === 'cavern' ? biome.runeCss : '#d4af5a';
    bctx.fillRect(4, 4, 24, 2);
    bctx.fillRect(4, 4, 2, 34);
    bctx.fillRect(26, 4, 2, 34);
    bctx.fillStyle = theme === 'cavern' ? '#d8ffff' : '#f2d382';
    bctx.fillRect(15, 13, 2, 16);
    bctx.fillRect(11, 18, 10, 6);
    bctx.fillStyle = biome.bannerColor;
    bctx.fillRect(14, 19, 4, 4);
  }

  // 7. Octagonal Arcane Rune Seal (128x128 crisp luminous geometry on translucent tint)
  const runeCanvas = document.createElement('canvas');
  runeCanvas.width = 128;
  runeCanvas.height = 128;
  const rctx = runeCanvas.getContext('2d')!;
  rctx.clearRect(0, 0, 128, 128);

  // Subtle translucent inner aura so dark stone shows through and rune lines stay razor-sharp
  const grad = rctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, `${biome.runeCss}40`);
  grad.addColorStop(0.45, `${biome.runeCss}22`);
  grad.addColorStop(0.82, `${biome.runeCss}10`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  rctx.fillStyle = grad;
  rctx.fillRect(0, 0, 128, 128);

  // Soft outer halo stroke helper for crisp neon-like rune clarity
  rctx.shadowColor = biome.runeCss;
  rctx.shadowBlur = 4;

  // Outer radiant ring + concentric inner channel
  rctx.strokeStyle = biome.runeCss;
  rctx.lineWidth = 3.0;
  rctx.beginPath();
  rctx.arc(64, 64, 54, 0, Math.PI * 2);
  rctx.stroke();

  rctx.strokeStyle = '#d8ffff';
  rctx.lineWidth = 1.4;
  rctx.beginPath();
  rctx.arc(64, 64, 54, 0, Math.PI * 2);
  rctx.stroke();

  // Octagonal rune frame
  rctx.strokeStyle = biome.runeCss;
  rctx.lineWidth = 2.2;
  rctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const rx = 64 + Math.cos(a) * 48;
    const ry = 64 + Math.sin(a) * 48;
    if (i === 0) rctx.moveTo(rx, ry);
    else rctx.lineTo(rx, ry);
  }
  rctx.stroke();

  // Inner circle + crisp 8-point star
  rctx.strokeStyle = '#c8ffff';
  rctx.lineWidth = 1.8;
  rctx.beginPath();
  rctx.arc(64, 64, 36, 0, Math.PI * 2);
  rctx.stroke();

  rctx.strokeStyle = biome.runeCss;
  rctx.lineWidth = 2.0;
  for (let k = 0; k < 2; k++) {
    rctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * Math.PI * 2 + (k * Math.PI) / 4;
      const rx = 64 + Math.cos(a) * 35;
      const ry = 64 + Math.sin(a) * 35;
      if (i === 0) rctx.moveTo(rx, ry);
      else rctx.lineTo(rx, ry);
    }
    rctx.stroke();
  }

  // Center core ring around crystal projection
  rctx.strokeStyle = '#e0ffff';
  rctx.lineWidth = 1.5;
  rctx.beginPath();
  rctx.arc(64, 64, 15, 0, Math.PI * 2);
  rctx.stroke();

  // Glowing glyph pips around outer channel
  rctx.shadowBlur = 2;
  rctx.fillStyle = '#e6ffff';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const gx = Math.round(64 + Math.cos(a) * 43);
    const gy = Math.round(64 + Math.sin(a) * 43);
    rctx.fillRect(gx - 1.5, gy - 1.5, 3, 3);
  }
  rctx.shadowBlur = 0;

  // 8. Soft Radial Additive Bloom Glow (64x64)
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64;
  glowCanvas.height = 64;
  const gctx = glowCanvas.getContext('2d')!;
  const ggrad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  ggrad.addColorStop(0, 'rgba(255,255,255,1)');
  ggrad.addColorStop(0.25, 'rgba(255,255,255,0.72)');
  ggrad.addColorStop(0.58, 'rgba(255,255,255,0.22)');
  ggrad.addColorStop(1, 'rgba(255,255,255,0)');
  gctx.fillStyle = ggrad;
  gctx.fillRect(0, 0, 64, 64);

  // 9. Soft Radial Contact Shadow (64x64)
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 64;
  shadowCanvas.height = 64;
  const sctx = shadowCanvas.getContext('2d')!;
  const sgrad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  sgrad.addColorStop(0, 'rgba(0,0,0,0.62)');
  sgrad.addColorStop(0.6, 'rgba(0,0,0,0.28)');
  sgrad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = sgrad;
  sctx.fillRect(0, 0, 64, 64);

  const floorMap = finalizePixelTexture(floorCanvas, true, aniso, true);
  const floorBump = finalizePixelTexture(floorBumpCanvas, false, aniso, true);

  let floorVariants: THREE.CanvasTexture[] | undefined;
  let wallVariants: THREE.CanvasTexture[] | undefined;
  let wallMap: THREE.CanvasTexture;

  if (theme === 'cavern') {
    // 5 cavern floor textures: variant 0 is clean cave rock (floorMap), variants 1..4 each have 2 crystals
    // from Green/Yellow/Purple/Blue. With 6 tile buckets (2 clean + 4 crystal), avg = 8/6 = 1.33 vs 6 (~1/5).
    const floorColorPairs: Array<[number, number]> = [
      [0, 1], // Green + Yellow
      [1, 2], // Yellow + Purple
      [2, 3], // Purple + Blue
      [3, 0], // Blue + Green
    ];
    floorVariants = [floorMap];
    for (let v = 0; v < floorColorPairs.length; v++) {
      const vc = document.createElement('canvas');
      vc.width = 64;
      vc.height = 64;
      const vctx = vc.getContext('2d')!;
      vctx.drawImage(floorCanvas, 0, 0);
      const pair = floorColorPairs[v];
      for (let g = 0; g < 2; g++) {
        const pal = CAVERN_CRYSTAL_PALETTE[pair[g]];
        const gx = 5 + ((v * 17 + g * 29 + Math.floor(rand() * 14)) % 52);
        const gy = 5 + ((v * 23 + g * 31 + Math.floor(rand() * 14)) % 52);
        vctx.fillStyle = pal.rim;
        vctx.fillRect(gx - 1, gy - 1, 4, 4);
        vctx.fillStyle = pal.main;
        vctx.fillRect(gx, gy, 2, 2);
        vctx.fillStyle = pal.core;
        vctx.fillRect(gx, gy, 1, 1);
      }
      floorVariants.push(finalizePixelTexture(vc, true, aniso, true));
    }

    // 4 cavern wall textures: varied large/medium/small crystals in Green/Yellow/Purple/Blue,
    // kept sparse (1-2 per tile) so natural cave cliff rock remains clearly dominant
    const drawWallCrystal = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      size: 'large' | 'medium' | 'small',
      pal: { main: string; core: string; rim: string },
      flip: boolean
    ) => {
      const dir = flip ? -1 : 1;
      if (size === 'large') {
        // Large clustered crystal spire (~8x12 px) with dark mineral recess & side shard
        ctx.fillStyle = pal.rim;
        ctx.fillRect(cx - 2, cy - 5, 6, 11);
        ctx.fillRect(cx - 3, cy - 2, 8, 7);
        ctx.fillRect(cx + dir * 3, cy - 1, 4, 6);

        ctx.fillStyle = pal.main;
        ctx.fillRect(cx - 1, cy - 4, 4, 9);
        ctx.fillRect(cx - 2, cy - 1, 6, 5);
        ctx.fillRect(cx, cy - 6, 2, 2);
        // Side crystal prong
        ctx.fillRect(cx + dir * 3, cy, 2, 4);
        ctx.fillRect(cx + dir * 4, cy - 1, 1, 3);

        ctx.fillStyle = pal.core;
        ctx.fillRect(cx, cy - 4, 2, 4);
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
        ctx.fillRect(cx + dir * 3, cy + 1, 1, 2);
      } else if (size === 'medium') {
        // Medium faceted crystal (~5x8 px)
        ctx.fillStyle = pal.rim;
        ctx.fillRect(cx - 2, cy - 3, 6, 7);
        ctx.fillRect(cx - 1, cy - 4, 4, 9);

        ctx.fillStyle = pal.main;
        ctx.fillRect(cx - 1, cy - 2, 4, 5);
        ctx.fillRect(cx, cy - 3, 2, 7);
        if (flip) {
          ctx.fillRect(cx - 2, cy, 2, 3);
        } else {
          ctx.fillRect(cx + 2, cy, 2, 3);
        }

        ctx.fillStyle = pal.core;
        ctx.fillRect(cx, cy - 2, 2, 3);
      } else {
        // Small mineral crystal gleam (~3x4 px)
        ctx.fillStyle = pal.rim;
        ctx.fillRect(cx - 1, cy - 1, 5, 6);
        ctx.fillStyle = pal.main;
        ctx.fillRect(cx, cy, 3, 4);
        ctx.fillStyle = pal.core;
        ctx.fillRect(cx + 1, cy + 1, 1, 2);
      }
    };

    const wallSpecs: Array<Array<{ colorIdx: number; size: 'large' | 'medium' | 'small' }>> = [
      [
        { colorIdx: 3, size: 'large' },  // Large Blue
        { colorIdx: 1, size: 'small' },  // Small Yellow
      ],
      [
        { colorIdx: 0, size: 'medium' }, // Medium Green
        { colorIdx: 2, size: 'medium' }, // Medium Purple
      ],
      [
        { colorIdx: 1, size: 'large' },  // Large Yellow (mostly bare rock)
      ],
      [
        { colorIdx: 2, size: 'small' },  // Small Purple
        { colorIdx: 0, size: 'medium' }, // Medium Green
        { colorIdx: 3, size: 'small' },  // Small Blue
      ],
    ];
    wallVariants = [];
    for (let v = 0; v < wallSpecs.length; v++) {
      const wc = document.createElement('canvas');
      wc.width = 64;
      wc.height = 64;
      const wvctx = wc.getContext('2d')!;
      wvctx.drawImage(wallCanvas, 0, 0);
      const specs = wallSpecs[v];
      for (let k = 0; k < specs.length; k++) {
        const spec = specs[k];
        const pal = CAVERN_CRYSTAL_PALETTE[spec.colorIdx];
        const sectorW = Math.floor(48 / specs.length);
        const kx = 10 + k * sectorW + Math.floor(rand() * Math.max(4, sectorW - 10));
        const ky = 14 + Math.floor(rand() * 32);
        drawWallCrystal(wvctx, kx, ky, spec.size, pal, (v + k) % 2 === 1);
      }
      wallVariants.push(finalizePixelTexture(wc, true, aniso, true));
    }
    wallMap = wallVariants[0];
  } else {
    wallMap = finalizePixelTexture(wallCanvas, true, aniso, true);
  }

  const wallBump = finalizePixelTexture(wallBumpCanvas, false, aniso, true);
  const pillarMap = finalizePixelTexture(pillarCanvas, true, aniso, false);
  const crateMap = finalizePixelTexture(crateCanvas, true, aniso, false);
  const doorMap = finalizePixelTexture(doorCanvas, true, aniso, false);
  const bannerMap = finalizePixelTexture(bannerCanvas, true, aniso, false);

  const runeMap = new THREE.CanvasTexture(runeCanvas);
  runeMap.colorSpace = THREE.SRGBColorSpace;
  runeMap.anisotropy = aniso;

  const glowMap = new THREE.CanvasTexture(glowCanvas);
  glowMap.colorSpace = THREE.SRGBColorSpace;

  const shadowMap = new THREE.CanvasTexture(shadowCanvas);

  return {
    floorMap,
    floorBump,
    floorVariants,
    wallMap,
    wallBump,
    wallVariants,
    pillarMap,
    crateMap,
    doorMap,
    bannerMap,
    runeMap,
    glowMap,
    shadowMap,
    dispose: () => {
      floorMap.dispose();
      floorBump.dispose();
      if (floorVariants) {
        for (let i = 1; i < floorVariants.length; i++) {
          floorVariants[i].dispose();
        }
      }
      wallMap.dispose();
      wallBump.dispose();
      if (wallVariants) {
        for (let i = 1; i < wallVariants.length; i++) {
          wallVariants[i].dispose();
        }
      }
      pillarMap.dispose();
      crateMap.dispose();
      doorMap.dispose();
      bannerMap.dispose();
      runeMap.dispose();
      glowMap.dispose();
      shadowMap.dispose();
    },
  };
}
