import * as THREE from 'three';
import { BiomeConfig } from './types';

export interface DungeonTextureSet {
  floorMap: THREE.CanvasTexture;
  floorBump: THREE.CanvasTexture;
  floorVariants?: THREE.CanvasTexture[];
  floorDecalMaps?: THREE.CanvasTexture[];
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

  const drawCavernFloorVariant = (
    ctx: CanvasRenderingContext2D,
    bctx: CanvasRenderingContext2D | null,
    variantIdx: number,
    vSeed: number
  ) => {
    const vrand = seededRand(vSeed);
    const isFungal = biome.id === 'cavern_fungal';
    const mossDark = isFungal ? '#234231' : '#263f47';
    const mossMid = isFungal ? '#36694a' : '#355c66';
    const mossBright = isFungal ? '#529968' : '#4d828f';

    ctx.fillStyle = shiftColor(baseRgb, -18 + (variantIdx % 3) * 3);
    ctx.fillRect(0, 0, 64, 64);
    if (bctx) {
      bctx.fillStyle = '#787878';
      bctx.fillRect(0, 0, 64, 64);
    }

    // Coarse gritty cave earth base
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const d = Math.floor((vrand() - 0.5) * 28);
        const useAcc = vrand() < (variantIdx === 1 ? 0.45 : 0.32);
        ctx.fillStyle = shiftColor(useAcc ? accentRgb : baseRgb, d - 9);
        ctx.fillRect(x, y, 2, 2);
        if (bctx) {
          const bv = 92 + Math.floor(vrand() * 54);
          bctx.fillStyle = `rgb(${bv},${bv},${bv})`;
          bctx.fillRect(x, y, 2, 2);
        }
      }
    }

    // Variant-specific rock flagstone geometry
    const slabCount = variantIdx === 1 ? 9 : variantIdx === 4 ? 11 : 15;
    for (let i = 0; i < slabCount; i++) {
      const rw = variantIdx === 1 ? 12 + Math.floor(vrand() * 14) : 6 + Math.floor(vrand() * 10);
      const rh = variantIdx === 1 ? 10 + Math.floor(vrand() * 12) : 5 + Math.floor(vrand() * 9);
      const rx = Math.floor(vrand() * (64 - rw));
      const ry = Math.floor(vrand() * (64 - rh));
      const rgb = vrand() < 0.44 ? accentRgb : baseRgb;
      const shade = Math.floor((vrand() - 0.5) * 24) + (variantIdx === 1 ? 10 : 6);

      ctx.fillStyle = biome.floorMortar;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.fillStyle = shiftColor(rgb, shade);
      ctx.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
      ctx.fillStyle = shiftColor(rgb, shade + 17);
      ctx.fillRect(rx + 1, ry + 1, Math.max(1, rw - 3), 1);
      ctx.fillStyle = shiftColor(rgb, shade - 18);
      ctx.fillRect(rx + 2, ry + rh - 2, Math.max(1, rw - 3), 1);

      if (bctx) {
        bctx.fillStyle = '#d6d6d6';
        bctx.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
        bctx.fillStyle = '#ffffff';
        bctx.fillRect(rx + 1, ry + 1, Math.max(1, rw - 3), 1);
      }
    }

    if (variantIdx === 2) {
      // Diagonal rugged cave fracture line + fine gravel
      let fx = 6 + Math.floor(vrand() * 14);
      let fy = 4 + Math.floor(vrand() * 12);
      for (let s = 0; s < 22; s++) {
        ctx.fillStyle = biome.floorMortar;
        ctx.fillRect(fx & 63, fy & 63, 2, 2);
        ctx.fillStyle = shiftColor(baseRgb, 20);
        ctx.fillRect((fx + 2) & 63, fy & 63, 1, 1);
        if (bctx) {
          bctx.fillStyle = '#181818';
          bctx.fillRect(fx & 63, fy & 63, 2, 2);
        }
        fx += vrand() < 0.72 ? 2 : 1;
        fy += vrand() < 0.72 ? 2 : 1;
      }
    } else if (variantIdx === 3) {
      // Crevice moss / lichen patches hugging stone joints
      for (let m = 0; m < 5; m++) {
        const mx = 6 + Math.floor(vrand() * 48);
        const my = 6 + Math.floor(vrand() * 48);
        const mw = 6 + Math.floor(vrand() * 8);
        const mh = 4 + Math.floor(vrand() * 6);
        ctx.fillStyle = mossDark;
        ctx.fillRect(mx, my, mw, mh);
        ctx.fillStyle = mossMid;
        ctx.fillRect(mx + 1, my + 1, mw - 2, mh - 2);
        ctx.fillStyle = mossBright;
        ctx.fillRect(mx + 2, my + 1, Math.max(1, Math.floor(mw * 0.4)), 1);
      }
    } else if (variantIdx === 4) {
      // Shallow stratified stone depression + mineral dust streak
      const px = 14 + Math.floor(vrand() * 18);
      const py = 14 + Math.floor(vrand() * 18);
      ctx.fillStyle = biome.floorMortar;
      ctx.fillRect(px, py, 20, 16);
      ctx.fillStyle = shiftColor(accentRgb, -16);
      ctx.fillRect(px + 2, py + 2, 16, 12);
      ctx.fillStyle = shiftColor(baseRgb, -24);
      ctx.fillRect(px + 4, py + 4, 12, 8);
      ctx.fillStyle = shiftColor(baseRgb, 16);
      ctx.fillRect(px + 2, py + 15, 16, 1);
    } else if (variantIdx === 5) {
      // Subtle embedded mineral flecks (low density, non-distracting)
      for (let g = 0; g < 2; g++) {
        const pal = CAVERN_CRYSTAL_PALETTE[(g * 2 + Math.floor(vrand() * 4)) % CAVERN_CRYSTAL_PALETTE.length];
        const gx = 8 + Math.floor(vrand() * 46);
        const gy = 8 + Math.floor(vrand() * 46);
        ctx.fillStyle = pal.rim;
        ctx.fillRect(gx - 1, gy - 1, 4, 4);
        ctx.fillStyle = pal.main;
        ctx.fillRect(gx, gy, 2, 2);
        ctx.fillStyle = pal.core;
        ctx.fillRect(gx, gy, 1, 1);
      }
    }

    // Small scattered pebbles for tactile scale
    for (let p = 0; p < 7; p++) {
      const px = 3 + Math.floor(vrand() * 58);
      const py = 3 + Math.floor(vrand() * 58);
      ctx.fillStyle = biome.floorMortar;
      ctx.fillRect(px, py + 1, 3, 2);
      ctx.fillStyle = shiftColor(baseRgb, 14 + Math.floor(vrand() * 12));
      ctx.fillRect(px, py, 2, 2);
    }
  };

  const drawFleshFloorVariant = (
    ctx: CanvasRenderingContext2D,
    bctx: CanvasRenderingContext2D | null,
    variantIdx: number,
    vSeed: number
  ) => {
    const vrand = seededRand(vSeed);
    ctx.fillStyle = shiftColor(accentRgb, -18 + (variantIdx % 2) * 4);
    ctx.fillRect(0, 0, 64, 64);
    if (bctx) {
      bctx.fillStyle = '#4c4c4c';
      bctx.fillRect(0, 0, 64, 64);
    }

    // Subtle organic pixel grain
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const d = Math.floor((vrand() - 0.5) * 18);
        ctx.fillStyle = shiftColor(vrand() < 0.45 ? accentRgb : baseRgb, d - 12);
        ctx.fillRect(x, y, 2, 2);
      }
    }

    if (variantIdx === 0 || variantIdx === 1) {
      // Organic cellular tissue cobblestones (distinct layout & sizes per variant)
      const cells = variantIdx === 0 ? 18 : 13;
      for (let i = 0; i < cells; i++) {
        const cx = Math.floor(vrand() * 64);
        const cy = Math.floor(vrand() * 64);
        const rad = variantIdx === 0 ? 4 + Math.floor(vrand() * 6) : 6 + Math.floor(vrand() * 7);
        const rgb = i % 3 === 0 ? accentRgb : baseRgb;
        const shade = Math.floor((vrand() - 0.5) * 24) - 4;
        for (const ox of [-64, 0, 64]) {
          for (const oy of [-64, 0, 64]) {
            const px = cx + ox;
            const py = cy + oy;
            if (px + rad < 0 || px - rad > 64 || py + rad < 0 || py - rad > 64) continue;
            ctx.fillStyle = biome.floorMortar;
            ctx.fillRect(px - rad, py - rad + 1, rad * 2, rad * 2 - 2);
            ctx.fillRect(px - rad + 1, py - rad, rad * 2 - 2, rad * 2);

            ctx.fillStyle = shiftColor(rgb, shade);
            ctx.fillRect(px - rad + 1, py - rad + 1, rad * 2 - 2, rad * 2 - 2);
            ctx.fillStyle = shiftColor(rgb, shade + 22);
            ctx.fillRect(px - Math.floor(rad * 0.45), py - Math.floor(rad * 0.45), 3, 2);

            if (bctx) {
              bctx.fillStyle = '#cfcfcf';
              bctx.fillRect(px - rad + 1, py - rad + 1, rad * 2 - 2, rad * 2 - 2);
              bctx.fillStyle = '#f5f5f5';
              bctx.fillRect(px - 2, py - 2, 3, 3);
            }
          }
        }
      }
    } else if (variantIdx === 2) {
      // Cross-woven dark-plum & crimson muscular fiber bands
      for (let y = 0; y < 64; y += 2) {
        for (let x = 0; x < 64; x += 2) {
          const wave = Math.sin(x * 0.25 + y * 0.18) + Math.sin(y * 0.34 - x * 0.08) * 0.5;
          const rgb = wave > 0.2 ? baseRgb : accentRgb;
          const shade = Math.round(wave * 18) - 4;
          ctx.fillStyle = shiftColor(rgb, shade);
          ctx.fillRect(x, y, 2, 2);
          if (bctx) {
            const bv = Math.max(40, Math.min(235, 130 + Math.round(wave * 55)));
            bctx.fillStyle = `rgb(${bv},${bv},${bv})`;
            bctx.fillRect(x, y, 2, 2);
          }
        }
      }
      // Deep dark sinew trenches
      for (let t = 0; t < 3; t++) {
        let tx = 4 + t * 20;
        for (let ty = 0; ty < 64; ty += 2) {
          const off = Math.round(Math.sin(ty * 0.16 + t * 2.3) * 3);
          ctx.fillStyle = biome.floorMortar;
          ctx.fillRect((tx + off) & 63, ty, 2, 2);
          ctx.fillStyle = shiftColor(baseRgb, 20);
          ctx.fillRect((tx + off + 2) & 63, ty, 1, 2);
        }
      }
    } else if (variantIdx === 3) {
      // Matte tissue pads with branching muted capillary veins
      for (let i = 0; i < 10; i++) {
        const rx = Math.floor(vrand() * 52);
        const ry = Math.floor(vrand() * 52);
        const rw = 8 + Math.floor(vrand() * 10);
        const rh = 7 + Math.floor(vrand() * 9);
        ctx.fillStyle = biome.floorMortar;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.fillStyle = shiftColor(baseRgb, -6 + Math.floor(vrand() * 14));
        ctx.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
      }
      for (let v = 0; v < 4; v++) {
        let vx = Math.floor(vrand() * 64);
        let vy = Math.floor(vrand() * 64);
        const col = v % 2 === 0 ? '#c94c9c' : '#8e45b8';
        for (let s = 0; s < 16; s++) {
          ctx.fillStyle = col;
          ctx.fillRect(vx & 63, vy & 63, 2, 2);
          if (s % 5 === 0) {
            ctx.fillStyle = '#eb9cd8';
            ctx.fillRect(vx & 63, vy & 63, 1, 1);
          }
          vx += vrand() < 0.65 ? 2 : 1;
          vy += vrand() < 0.5 ? 1 : -1;
        }
      }
    } else if (variantIdx === 4) {
      // Flesh membrane with embedded pale cartilage / bone splinters
      for (let i = 0; i < 12; i++) {
        const rx = Math.floor(vrand() * 54);
        const ry = Math.floor(vrand() * 54);
        const rw = 7 + Math.floor(vrand() * 8);
        const rh = 6 + Math.floor(vrand() * 7);
        ctx.fillStyle = biome.floorMortar;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.fillStyle = shiftColor(accentRgb, Math.floor((vrand() - 0.5) * 18));
        ctx.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
      }
      // Embedded pale ivory bone fragments
      for (let b = 0; b < 3; b++) {
        const bx = 8 + Math.floor(vrand() * 44);
        const by = 8 + Math.floor(vrand() * 44);
        const horiz = b % 2 === 0;
        ctx.fillStyle = biome.floorMortar;
        ctx.fillRect(bx - 1, by - 1, horiz ? 10 : 5, horiz ? 5 : 10);
        ctx.fillStyle = '#c4b0b8';
        ctx.fillRect(bx, by, horiz ? 8 : 3, horiz ? 3 : 8);
        ctx.fillStyle = '#e8dde0';
        ctx.fillRect(bx + 1, by, horiz ? 5 : 1, horiz ? 1 : 5);
      }
    } else {
      // Dimpled organic floor with recessed pores and soft highlight rims
      for (let i = 0; i < 14; i++) {
        const rx = Math.floor(vrand() * 54);
        const ry = Math.floor(vrand() * 54);
        const rw = 6 + Math.floor(vrand() * 9);
        const rh = 6 + Math.floor(vrand() * 8);
        ctx.fillStyle = biome.floorMortar;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.fillStyle = shiftColor(baseRgb, -4 + Math.floor(vrand() * 16));
        ctx.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
      }
      for (let p = 0; p < 5; p++) {
        const px = 6 + Math.floor(vrand() * 50);
        const py = 6 + Math.floor(vrand() * 50);
        ctx.fillStyle = '#330d2b';
        ctx.fillRect(px, py, 5, 5);
        ctx.fillStyle = '#521844';
        ctx.fillRect(px + 1, py + 1, 3, 3);
        ctx.fillStyle = '#cf6db5';
        ctx.fillRect(px, py, 2, 1);
      }
    }
  };

  if (theme === 'cavern') {
    drawCavernFloorVariant(fctx, fbctx, 0, seed * 17 + 101);
  } else if (theme === 'flesh') {
    drawFleshFloorVariant(fctx, fbctx, 0, seed * 19 + 203);
  } else if (theme === 'alien') {
    // Bright Blue-Silver Sci-Fi Starship Deck Plating with recessed grip treads, rivets & glowing cyan conduits
    fctx.fillStyle = '#1b3554';
    fctx.fillRect(0, 0, 64, 64);
    fbctx.fillStyle = '#252525';
    fbctx.fillRect(0, 0, 64, 64);

    // 2x2 brushed titanium deck tiles
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        const px = gx * 32 + 2;
        const py = gy * 32 + 2;
        const pw = 28;
        const ph = 28;
        const isAcc = (gx + gy) % 2 === 1;
        const rgb = isAcc ? accentRgb : baseRgb;

        fctx.fillStyle = shiftColor(rgb, 8);
        fctx.fillRect(px, py, pw, ph);

        // Brushed metallic micro-streaks
        for (let sy = py + 2; sy < py + ph - 2; sy += 2) {
          const streak = Math.floor((rand() - 0.5) * 14);
          fctx.fillStyle = shiftColor(rgb, 8 + streak);
          fctx.fillRect(px + 2, sy, pw - 4, 1);
        }

        // Crisp chrome bevel highlight & dark lower seam
        fctx.fillStyle = '#e8f5ff';
        fctx.fillRect(px, py, pw, 1);
        fctx.fillRect(px, py, 1, ph);
        fctx.fillStyle = '#537396';
        fctx.fillRect(px, py + ph - 1, pw, 1);
        fctx.fillRect(px + pw - 1, py, 1, ph);

        // Corner titanium bolts
        fctx.fillStyle = '#38587a';
        fctx.fillRect(px + 2, py + 2, 2, 2);
        fctx.fillRect(px + pw - 4, py + 2, 2, 2);
        fctx.fillRect(px + 2, py + ph - 4, 2, 2);
        fctx.fillRect(px + pw - 4, py + ph - 4, 2, 2);
        fctx.fillStyle = '#f0faff';
        fctx.fillRect(px + 2, py + 2, 1, 1);
        fctx.fillRect(px + pw - 4, py + 2, 1, 1);

        // Central recessed deck grip ribs
        fctx.fillStyle = shiftColor(rgb, -18);
        fctx.fillRect(px + 7, py + 8, 14, 12);
        fctx.fillStyle = shiftColor(rgb, 24);
        for (let ry = 10; ry <= 16; ry += 3) {
          fctx.fillRect(px + 9, py + ry, 10, 1);
        }

        // Bump map
        fbctx.fillStyle = '#dcdcdc';
        fbctx.fillRect(px, py, pw, ph);
        fbctx.fillStyle = '#ffffff';
        fbctx.fillRect(px, py, pw, 2);
        fbctx.fillStyle = '#888888';
        fbctx.fillRect(px + 7, py + 8, 14, 12);
      }
    }

    // Glowing cyan energy conduits along tile seam crosshairs
    fctx.fillStyle = '#29c8f2';
    fctx.fillRect(31, 0, 2, 64);
    fctx.fillRect(0, 31, 64, 2);
    fctx.fillStyle = '#b8f7ff';
    fctx.fillRect(31, 10, 2, 12);
    fctx.fillRect(31, 42, 2, 12);
    fctx.fillRect(10, 31, 12, 2);
    fctx.fillRect(42, 31, 12, 2);
    // Central glowing circuit node
    fctx.fillStyle = '#75f2ff';
    fctx.fillRect(29, 29, 6, 6);
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(31, 31, 2, 2);
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

  const drawCavernWallVariant = (
    ctx: CanvasRenderingContext2D,
    bctx: CanvasRenderingContext2D | null,
    variantIdx: number,
    vSeed: number
  ) => {
    const vrand = seededRand(vSeed);
    const isFungal = biome.id === 'cavern_fungal';
    const mossCol = isFungal ? '#2e5e40' : '#2c535e';
    const mossHi = isFungal ? '#49875c' : '#457682';
    const slope = variantIdx === 2 ? 0.22 : variantIdx === 1 ? -0.14 : 0.08;
    const bandFreq = 0.22 + (variantIdx % 3) * 0.06;

    for (let y = 0; y < 64; y += 2) {
      const bandShade = Math.round(Math.sin(y * bandFreq + variantIdx * 1.7) * 14);
      const useAcc = ((y + variantIdx * 5) % 16) >= 9;
      const rgb = useAcc ? wallAccRgb : wallRgb;
      for (let x = 0; x < 64; x += 2) {
        const wave = Math.round(Math.sin(x * 0.2 + y * slope + variantIdx) * 11);
        const grain = Math.floor((vrand() - 0.5) * 18);
        const bottomAo = y > 54 ? -18 : y < 6 ? 10 : 0;
        const shade = bandShade + wave + grain + bottomAo;
        ctx.fillStyle = shiftColor(rgb, shade);
        ctx.fillRect(x, y, 2, 2);
        if (bctx) {
          const bv = Math.max(36, Math.min(242, 145 + shade * 2));
          bctx.fillStyle = `rgb(${bv},${bv},${bv})`;
          bctx.fillRect(x, y, 2, 2);
        }
      }
    }

    // Distinct rock ledges, fractured blocks, or recessed pockets per variant
    const ledgeCount = variantIdx === 1 ? 4 : 5;
    for (let l = 0; l < ledgeCount; l++) {
      const ly = 7 + l * (variantIdx === 1 ? 13 : 11) + Math.floor(vrand() * 4);
      for (let x = 0; x < 64; x += 2) {
        const jitter = Math.round(Math.sin(x * 0.28 + l * 2.3 + variantIdx) * 2.0 + x * slope * 0.35);
        const yy = Math.max(2, Math.min(60, ly + jitter));
        ctx.fillStyle = biome.floorMortar;
        ctx.fillRect(x, yy, 2, 2);
        ctx.fillStyle = shiftColor(wallRgb, 20);
        ctx.fillRect(x, Math.min(62, yy + 2), 2, 1);
        if (bctx) {
          bctx.fillStyle = '#141414';
          bctx.fillRect(x, yy, 2, 2);
        }
      }
    }

    if (variantIdx === 1 || variantIdx === 3) {
      // Vertical cliff fracture & mossy hanging edge (pure natural cave rock, no bright crystals)
      const vx = 14 + Math.floor(vrand() * 36);
      for (let y = 4; y < 58; y += 2) {
        const jx = vx + Math.round(Math.sin(y * 0.24 + variantIdx) * 2.5);
        ctx.fillStyle = biome.floorMortar;
        ctx.fillRect(jx & 63, y, 2, 2);
        ctx.fillStyle = shiftColor(wallRgb, 18);
        ctx.fillRect((jx + 2) & 63, y, 1, 2);
      }
      // Subtle top-edge cave moss drips
      for (let m = 0; m < 6; m++) {
        const mx = 4 + Math.floor(vrand() * 54);
        const mh = 5 + Math.floor(vrand() * 11);
        ctx.fillStyle = mossCol;
        ctx.fillRect(mx, 0, 4, mh);
        ctx.fillStyle = mossHi;
        ctx.fillRect(mx + 1, 1, 2, Math.max(2, mh - 4));
      }
    }
    if (variantIdx === 3) {
      // Deep shadowed rock recess pocket
      const rx = 18 + Math.floor(vrand() * 22);
      const ry = 22 + Math.floor(vrand() * 16);
      ctx.fillStyle = biome.floorMortar;
      ctx.fillRect(rx, ry, 14, 10);
      ctx.fillStyle = shiftColor(wallRgb, -24);
      ctx.fillRect(rx + 2, ry + 2, 10, 6);
      ctx.fillStyle = shiftColor(wallRgb, 22);
      ctx.fillRect(rx, ry + 10, 14, 1);
    }
  };

  const drawFleshWallVariant = (
    ctx: CanvasRenderingContext2D,
    bctx: CanvasRenderingContext2D | null,
    variantIdx: number,
    vSeed: number
  ) => {
    const vrand = seededRand(vSeed);
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const diag = variantIdx === 1 ? x * 0.26 + y * 0.14 : x * 0.24;
        const rib = Math.sin(diag + Math.sin(y * 0.16 + variantIdx) * 1.9);
        const strand = Math.sin(y * 0.36 - x * 0.12 + variantIdx * 1.3);
        const rgb = rib > 0.12 ? wallAccRgb : wallRgb;
        const bottomAo = y > 54 ? -20 : y < 5 ? -10 : 0;
        const shade = Math.round(rib * 20 + strand * 10 + (vrand() - 0.5) * 10) + bottomAo;
        ctx.fillStyle = shiftColor(rgb, shade);
        ctx.fillRect(x, y, 2, 2);
        if (bctx) {
          const bv = Math.max(30, Math.min(245, 138 + Math.round(rib * 72)));
          bctx.fillStyle = `rgb(${bv},${bv},${bv})`;
          bctx.fillRect(x, y, 2, 2);
        }
      }
    }

    if (variantIdx === 0) {
      // Organic cellular webbing + dark-plum vein network (inspired by reference image 2)
      for (let i = 0; i < 12; i++) {
        const cx = Math.floor(vrand() * 58) + 3;
        const cy = Math.floor(vrand() * 50) + 6;
        const cw = 8 + Math.floor(vrand() * 8);
        const ch = 7 + Math.floor(vrand() * 8);
        ctx.fillStyle = biome.floorMortar;
        ctx.fillRect(cx, cy, cw, ch);
        ctx.fillStyle = shiftColor(i % 2 === 0 ? wallRgb : wallAccRgb, -8 + Math.floor(vrand() * 16));
        ctx.fillRect(cx + 1, cy + 1, cw - 2, ch - 2);
        ctx.fillStyle = '#cf6db5';
        ctx.fillRect(cx + 1, cy + 1, Math.max(2, cw - 4), 1);
      }
    } else if (variantIdx === 1) {
      // Curved diagonal sinew trenches
      for (let gx = 6; gx < 64; gx += 16) {
        for (let y = 0; y < 64; y += 2) {
          const off = Math.round(Math.sin(y * 0.15 + gx) * 3.5 + y * 0.18);
          ctx.fillStyle = biome.floorMortar;
          ctx.fillRect((gx + off) & 63, y, 2, 2);
          ctx.fillStyle = '#d97aba';
          ctx.fillRect((gx + off + 2) & 63, y, 1, 2);
          if (bctx) {
            bctx.fillStyle = '#141414';
            bctx.fillRect((gx + off) & 63, y, 2, 2);
          }
        }
      }
    } else if (variantIdx === 2) {
      // Embedded curved ivory bone ribs peeking through torn purple tissue
      for (let r = 0; r < 3; r++) {
        const rx = 8 + r * 20 + Math.floor(vrand() * 4);
        for (let y = 6; y < 56; y += 2) {
          const bend = Math.round(Math.sin((y / 64) * Math.PI) * 4);
          ctx.fillStyle = biome.floorMortar;
          ctx.fillRect((rx + bend - 1) & 63, y, 6, 2);
          ctx.fillStyle = '#c4acb8';
          ctx.fillRect((rx + bend) & 63, y, 4, 2);
          ctx.fillStyle = '#ebe0e4';
          ctx.fillRect((rx + bend) & 63, y, 2, 2);
        }
      }
    } else {
      // Knotted sinew with 2-3 muted bioluminescent organ nodules
      for (let gx = 10; gx < 64; gx += 22) {
        for (let y = 0; y < 64; y += 2) {
          const off = Math.round(Math.sin(y * 0.18 + gx) * 2.5);
          ctx.fillStyle = biome.floorMortar;
          ctx.fillRect((gx + off) & 63, y, 2, 2);
        }
      }
      for (let n = 0; n < 3; n++) {
        const nx = 8 + Math.floor(vrand() * 46);
        const ny = 12 + Math.floor(vrand() * 38);
        ctx.fillStyle = '#471240';
        ctx.fillRect(nx - 1, ny - 1, 6, 6);
        ctx.fillStyle = biome.runeCss;
        ctx.fillRect(nx, ny, 4, 4);
        ctx.fillStyle = '#ffd9fa';
        ctx.fillRect(nx + 1, ny + 1, 2, 2);
      }
    }
  };

  if (theme === 'cavern') {
    drawCavernWallVariant(wctx, wbctx, 0, seed * 23 + 307);
  } else if (theme === 'flesh') {
    drawFleshWallVariant(wctx, wbctx, 0, seed * 29 + 409);
  } else if (theme === 'alien') {
    // Bright Silver-Blue Starship Bulkhead Wall with chrome trim, air vents & glowing cyan LED strips
    wctx.fillStyle = '#233f5e';
    wctx.fillRect(0, 0, 64, 64);
    wbctx.fillStyle = '#303030';
    wbctx.fillRect(0, 0, 64, 64);

    // Top structural header rail
    wctx.fillStyle = '#d4e8fa';
    wctx.fillRect(0, 0, 64, 8);
    wctx.fillStyle = '#7ba3cc';
    wctx.fillRect(0, 8, 64, 2);
    wbctx.fillStyle = '#ffffff';
    wbctx.fillRect(0, 0, 64, 8);

    // Main twin brushed-silver bulkhead panels
    for (let px = 0; px < 64; px += 32) {
      wctx.fillStyle = shiftColor(wallRgb, 14);
      wctx.fillRect(px + 2, 12, 28, 34);
      wctx.fillStyle = '#eaf6ff';
      wctx.fillRect(px + 2, 12, 28, 2);
      wctx.fillRect(px + 2, 12, 1, 34);
      wctx.fillStyle = '#5579a0';
      wctx.fillRect(px + 2, 45, 28, 1);

      // Recessed blue-steel tech bay inside panel
      wctx.fillStyle = shiftColor(wallAccRgb, -8);
      wctx.fillRect(px + 6, 18, 20, 22);
      wctx.fillStyle = '#2e4e73';
      for (let vy = 21; vy <= 33; vy += 4) {
        wctx.fillRect(px + 9, vy, 14, 2);
      }
      // Small cyan telemetry indicator lights
      wctx.fillStyle = '#47f0ff';
      wctx.fillRect(px + 6, 14, 6, 2);
      wctx.fillStyle = '#e0ffff';
      wctx.fillRect(px + 14, 14, 2, 2);

      wbctx.fillStyle = '#d8d8d8';
      wbctx.fillRect(px + 2, 12, 28, 34);
      wbctx.fillStyle = '#787878';
      wbctx.fillRect(px + 6, 18, 20, 22);
    }

    // Horizontal luminous cyan light bar
    wctx.fillStyle = '#1ca8e8';
    wctx.fillRect(0, 48, 64, 4);
    wctx.fillStyle = '#9cf8ff';
    wctx.fillRect(2, 49, 60, 2);
    wbctx.fillStyle = '#ffffff';
    wbctx.fillRect(0, 48, 64, 4);

    // Heavy titanium base kickplate
    wctx.fillStyle = '#537396';
    wctx.fillRect(0, 53, 64, 11);
    wctx.fillStyle = '#89aed4';
    wctx.fillRect(0, 53, 64, 2);
    wbctx.fillStyle = '#c8c8c8';
    wbctx.fillRect(0, 53, 64, 11);
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
    // Natural rocky stalagmite column with stratified ledges, dripstone ribs & moss base
    pctx.fillStyle = shiftColor(wallRgb, -10);
    pctx.fillRect(0, 0, 32, 64);
    for (let fy = 0; fy < 64; fy += 4) {
      const shade = Math.floor((rand() - 0.5) * 22) + (fy > 48 ? -14 : 0);
      pctx.fillStyle = shiftColor(fy % 12 === 0 ? wallAccRgb : wallRgb, shade);
      pctx.fillRect(0, fy, 32, 4);
      pctx.fillStyle = biome.floorMortar;
      pctx.fillRect(0, fy + 3, 32, 1);
    }
    // Vertical rough dripstone ridges
    for (let fx = 3; fx < 30; fx += 7) {
      pctx.fillStyle = shiftColor(wallRgb, 16);
      pctx.fillRect(fx, 4, 2, 54);
      pctx.fillStyle = biome.floorMortar;
      pctx.fillRect(fx + 2, 4, 1, 54);
    }
    // Mossy damp base accent
    const mossCol = biome.id === 'cavern_fungal' ? '#336143' : '#2d525c';
    pctx.fillStyle = mossCol;
    pctx.fillRect(0, 56, 32, 8);
    for (let c = 0; c < 2; c++) {
      const pal = CAVERN_CRYSTAL_PALETTE[(c + Math.floor(rand() * 4)) % CAVERN_CRYSTAL_PALETTE.length];
      const px = 5 + Math.floor(rand() * 20);
      const py = 10 + Math.floor(rand() * 38);
      pctx.fillStyle = pal.rim;
      pctx.fillRect(px - 1, py - 1, 5, 6);
      pctx.fillStyle = pal.main;
      pctx.fillRect(px, py, 3, 4);
      pctx.fillStyle = pal.core;
      pctx.fillRect(px + 1, py + 1, 1, 2);
    }
  } else if (theme === 'flesh') {
    // Ivory bone-cartilage rib column tightly wrapped in dark-plum & magenta sinew
    pctx.fillStyle = '#bda0b0';
    pctx.fillRect(0, 0, 32, 64);
    for (let fx = 2; fx < 32; fx += 8) {
      pctx.fillStyle = '#e3d0da';
      pctx.fillRect(fx, 0, 3, 64);
      pctx.fillStyle = '#5c1f4c';
      pctx.fillRect(fx + 4, 0, 2, 64);
    }
    for (let fy = 4; fy < 64; fy += 10) {
      pctx.fillStyle = '#3b0f30';
      pctx.fillRect(0, fy, 32, 4);
      pctx.fillStyle = '#993473';
      pctx.fillRect(0, fy + 1, 32, 2);
      pctx.fillStyle = '#e07ac4';
      pctx.fillRect(2, fy + 1, 24, 1);
    }
  } else if (theme === 'alien') {
    // Brushed chrome & silver-blue reactor support column with glowing cyan plasma bands
    pctx.fillStyle = '#b4cde6';
    pctx.fillRect(0, 0, 32, 64);
    pctx.fillStyle = '#e6f5ff';
    pctx.fillRect(3, 0, 5, 64);
    pctx.fillStyle = '#6287b0';
    pctx.fillRect(22, 0, 8, 64);
    for (const py of [12, 30, 48]) {
      pctx.fillStyle = '#1f3b5c';
      pctx.fillRect(0, py - 1, 32, 6);
      pctx.fillStyle = '#38e8ff';
      pctx.fillRect(0, py, 32, 4);
      pctx.fillStyle = '#e0ffff';
      pctx.fillRect(2, py + 1, 28, 2);
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
  } else if (theme === 'alien') {
    // Sealed silver-white sci-fi energy supply canister with cyan core strip
    cctx.fillStyle = '#3c5a7d';
    cctx.fillRect(0, 0, 32, 32);
    cctx.fillStyle = '#cfe2f5';
    cctx.fillRect(2, 2, 28, 28);
    cctx.fillStyle = '#f2faff';
    cctx.fillRect(3, 3, 26, 3);
    cctx.fillStyle = '#6d94bd';
    cctx.fillRect(4, 11, 24, 10);
    cctx.fillStyle = '#2de4ff';
    cctx.fillRect(6, 14, 20, 4);
    cctx.fillStyle = '#e6ffff';
    cctx.fillRect(10, 15, 12, 2);
    // Corner clamps
    cctx.fillStyle = '#243c59';
    cctx.fillRect(0, 0, 6, 6);
    cctx.fillRect(26, 0, 6, 6);
    cctx.fillRect(0, 26, 6, 6);
    cctx.fillRect(26, 26, 6, 6);
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
  } else if (theme === 'alien') {
    // Reinforced titanium blast door with cyan plasma containment bars & holographic lock core
    dctx.fillStyle = '#294466';
    dctx.fillRect(0, 0, 64, 64);
    dctx.fillStyle = '#a9c6e3';
    dctx.fillRect(4, 4, 56, 56);
    dctx.fillStyle = '#3d6087';
    dctx.fillRect(10, 10, 44, 44);
    for (let px = 14; px < 52; px += 9) {
      dctx.fillStyle = '#2ee6ff';
      dctx.fillRect(px, 12, 3, 40);
      dctx.fillStyle = '#dffeff';
      dctx.fillRect(px + 1, 12, 1, 40);
    }
    dctx.fillStyle = '#d4e9fc';
    dctx.fillRect(0, 26, 64, 12);
    dctx.fillStyle = '#1b3554';
    dctx.fillRect(22, 22, 20, 20);
    dctx.fillStyle = '#47f0ff';
    dctx.fillRect(26, 26, 12, 12);
    dctx.fillStyle = '#ffffff';
    dctx.fillRect(30, 30, 4, 4);
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
    // Organic dark-plum sinew web & torn hanging fleshy tendrils with bone anchor hooks
    bctx.fillStyle = '#401136';
    bctx.fillRect(2, 0, 28, 12);
    bctx.fillStyle = '#ccb6c0';
    bctx.fillRect(5, 1, 4, 5);
    bctx.fillRect(23, 1, 4, 5);
    bctx.fillStyle = '#7d286b';
    bctx.fillRect(4, 6, 24, 16);
    bctx.fillStyle = biome.bannerColor;
    bctx.fillRect(5, 8, 6, 28);
    bctx.fillRect(13, 8, 6, 36);
    bctx.fillRect(22, 8, 5, 24);
    bctx.fillStyle = '#4f1542';
    bctx.fillRect(10, 14, 4, 4);
    bctx.fillRect(18, 18, 5, 3);
    bctx.fillStyle = '#f28ce0';
    bctx.fillRect(7, 14, 2, 14);
    bctx.fillRect(15, 12, 2, 22);
    bctx.fillRect(24, 14, 1, 10);
    bctx.fillStyle = '#ffd9fa';
    bctx.fillRect(15, 26, 2, 2);
  } else if (theme === 'cavern') {
    // Natural hanging cave moss vines & slender mineral icicle clusters (replaces medieval flag)
    const isFungal = biome.id === 'cavern_fungal';
    const vineDark = isFungal ? '#1c3b29' : '#1d363e';
    const vineMid = isFungal ? '#2f6142' : '#2d5763';
    const vineBright = isFungal ? '#529c6a' : '#4fa3b8';
    const crystalCol = biome.runeCss;

    // Rocky top ledge overhang
    bctx.fillStyle = biome.floorMortar;
    bctx.fillRect(2, 0, 28, 6);
    bctx.fillStyle = shiftColor(wallRgb, 12);
    bctx.fillRect(4, 1, 24, 4);

    // Asymmetric hanging moss curtains
    const strands: Array<[number, number, number]> = [
      [4, 4, 24],
      [9, 5, 34],
      [15, 4, 41],
      [20, 5, 28],
      [25, 3, 20],
    ];
    for (const [sx, sw, sh] of strands) {
      bctx.fillStyle = vineDark;
      bctx.fillRect(sx, 4, sw, sh);
      bctx.fillStyle = vineMid;
      bctx.fillRect(sx + 1, 5, Math.max(1, sw - 2), sh - 3);
      bctx.fillStyle = vineBright;
      bctx.fillRect(sx + 1, 8, 1, Math.max(4, Math.floor(sh * 0.45)));
    }
    // Small hanging mineral / glowcap flecks
    bctx.fillStyle = crystalCol;
    bctx.fillRect(10, 18, 2, 4);
    bctx.fillRect(16, 26, 2, 5);
    bctx.fillRect(21, 14, 2, 3);
    bctx.fillStyle = '#e6ffff';
    bctx.fillRect(10, 19, 1, 2);
    bctx.fillRect(16, 28, 1, 2);
  } else if (theme === 'alien') {
    // Glowing cyan holographic starship telemetry display screen
    bctx.fillStyle = '#1a3c63';
    bctx.fillRect(2, 2, 28, 42);
    bctx.fillStyle = '#3ceaff';
    bctx.fillRect(2, 2, 28, 2);
    bctx.fillRect(2, 42, 28, 2);
    bctx.fillRect(2, 2, 2, 42);
    bctx.fillRect(28, 2, 2, 42);
    // Holographic scanlines & star-chart rings
    bctx.fillStyle = '#2498d6';
    for (let hy = 6; hy < 40; hy += 4) {
      bctx.fillRect(5, hy, 22, 1);
    }
    bctx.fillStyle = '#99f8ff';
    bctx.fillRect(12, 12, 8, 8);
    bctx.fillStyle = '#1a3c63';
    bctx.fillRect(14, 14, 4, 4);
    bctx.fillStyle = '#e0ffff';
    bctx.fillRect(15, 15, 2, 2);
    bctx.fillRect(7, 27, 14, 2);
    bctx.fillRect(7, 32, 18, 2);
    bctx.fillRect(7, 37, 10, 2);
  } else {
    bctx.fillStyle = biome.bannerColor;
    bctx.fillRect(2, 2, 28, 38);
    bctx.fillRect(2, 40, 11, 6);
    bctx.fillRect(19, 40, 11, 6);
    bctx.fillRect(2, 44, 6, 3);
    bctx.fillRect(24, 44, 6, 3);
    bctx.fillStyle = '#d4af5a';
    bctx.fillRect(4, 4, 24, 2);
    bctx.fillRect(4, 4, 2, 34);
    bctx.fillRect(26, 4, 2, 34);
    bctx.fillStyle = '#f2d382';
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
  let floorDecalMaps: THREE.CanvasTexture[] | undefined;
  let wallVariants: THREE.CanvasTexture[] | undefined;
  let wallMap: THREE.CanvasTexture;

  if (theme === 'cavern') {
    // 6 genuinely distinct cavern floor variants (independent rock slab layouts, cracks, moss, shallow pits, sparse flecks)
    floorVariants = [floorMap];
    for (let v = 1; v < 6; v++) {
      const vc = document.createElement('canvas');
      vc.width = 64;
      vc.height = 64;
      const vctx = vc.getContext('2d')!;
      drawCavernFloorVariant(vctx, null, v, seed * 31 + v * 997 + 17);
      floorVariants.push(finalizePixelTexture(vc, true, aniso, true));
    }

    // 4 genuinely distinct cavern wall variants; only variants 0 & 2 include sparse mineral crystals
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
        ctx.fillStyle = pal.rim;
        ctx.fillRect(cx - 2, cy - 5, 6, 11);
        ctx.fillRect(cx - 3, cy - 2, 8, 7);
        ctx.fillRect(cx + dir * 3, cy - 1, 4, 6);
        ctx.fillStyle = pal.main;
        ctx.fillRect(cx - 1, cy - 4, 4, 9);
        ctx.fillRect(cx - 2, cy - 1, 6, 5);
        ctx.fillRect(cx, cy - 6, 2, 2);
        ctx.fillRect(cx + dir * 3, cy, 2, 4);
        ctx.fillRect(cx + dir * 4, cy - 1, 1, 3);
        ctx.fillStyle = pal.core;
        ctx.fillRect(cx, cy - 4, 2, 4);
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
        ctx.fillRect(cx + dir * 3, cy + 1, 1, 2);
      } else if (size === 'medium') {
        ctx.fillStyle = pal.rim;
        ctx.fillRect(cx - 2, cy - 3, 6, 7);
        ctx.fillRect(cx - 1, cy - 4, 4, 9);
        ctx.fillStyle = pal.main;
        ctx.fillRect(cx - 1, cy - 2, 4, 5);
        ctx.fillRect(cx, cy - 3, 2, 7);
        ctx.fillRect(flip ? cx - 2 : cx + 2, cy, 2, 3);
        ctx.fillStyle = pal.core;
        ctx.fillRect(cx, cy - 2, 2, 3);
      } else {
        ctx.fillStyle = pal.rim;
        ctx.fillRect(cx - 1, cy - 1, 5, 6);
        ctx.fillStyle = pal.main;
        ctx.fillRect(cx, cy, 3, 4);
        ctx.fillStyle = pal.core;
        ctx.fillRect(cx + 1, cy + 1, 1, 2);
      }
    };

    wallVariants = [];
    for (let v = 0; v < 4; v++) {
      const wc = document.createElement('canvas');
      wc.width = 64;
      wc.height = 64;
      const wvctx = wc.getContext('2d')!;
      if (v === 0) {
        wvctx.drawImage(wallCanvas, 0, 0);
        drawWallCrystal(wvctx, 20, 26, 'large', CAVERN_CRYSTAL_PALETTE[3], false);
        drawWallCrystal(wvctx, 46, 38, 'small', CAVERN_CRYSTAL_PALETTE[1], true);
      } else {
        drawCavernWallVariant(wvctx, null, v, seed * 37 + v * 613 + 53);
        if (v === 2) {
          drawWallCrystal(wvctx, 24, 30, 'medium', CAVERN_CRYSTAL_PALETTE[0], false);
          drawWallCrystal(wvctx, 44, 22, 'small', CAVERN_CRYSTAL_PALETTE[2], true);
        }
      }
      wallVariants.push(finalizePixelTexture(wc, true, aniso, true));
    }
    wallMap = wallVariants[0];

    // 3 clean, crisp low-res floor decals (rock crack, moss tuft, pebble scatter) for cross-tile seam breakup
    const isFungal = biome.id === 'cavern_fungal';
    floorDecalMaps = [0, 1, 2].map((dIdx) => {
      const dc = document.createElement('canvas');
      dc.width = 32;
      dc.height = 32;
      const dctx = dc.getContext('2d')!;
      dctx.clearRect(0, 0, 32, 32);
      if (dIdx === 0) {
        // Branching dark floor crack with subtle pale stone lip
        const pts: Array<[number, number]> = [
          [4, 15], [7, 14], [10, 16], [13, 15], [16, 17], [20, 16], [24, 18], [27, 17],
          [13, 15], [15, 11], [17, 8], [16, 17], [18, 21], [21, 24],
        ];
        for (const [px, py] of pts) {
          dctx.fillStyle = 'rgba(18, 16, 14, 0.85)';
          dctx.fillRect(px, py, 2, 2);
          dctx.fillStyle = 'rgba(150, 142, 128, 0.35)';
          dctx.fillRect(px, py - 1, 2, 1);
        }
      } else if (dIdx === 1) {
        // Clustered mossy / lichen pixel patch
        const dark = isFungal ? 'rgba(28, 60, 40, 0.78)' : 'rgba(30, 56, 64, 0.72)';
        const mid = isFungal ? 'rgba(54, 108, 70, 0.82)' : 'rgba(52, 92, 104, 0.78)';
        const hi = isFungal ? 'rgba(92, 166, 110, 0.85)' : 'rgba(84, 138, 152, 0.8)';
        const blobs: Array<[number, number, number, number]> = [
          [7, 10, 10, 8], [15, 13, 11, 9], [10, 18, 8, 6], [20, 9, 6, 5],
        ];
        for (const [bx, by, bw, bh] of blobs) {
          dctx.fillStyle = dark;
          dctx.fillRect(bx, by, bw, bh);
          dctx.fillStyle = mid;
          dctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
          dctx.fillStyle = hi;
          dctx.fillRect(bx + 2, by + 1, Math.max(1, bw - 5), 2);
        }
      } else {
        // Scattered pebbles & mineral dust
        const stones: Array<[number, number, number, number]> = [
          [6, 10, 4, 3], [14, 7, 5, 4], [22, 14, 4, 3], [10, 20, 5, 3], [19, 22, 3, 3], [14, 15, 3, 2],
        ];
        for (const [sx, sy, sw, sh] of stones) {
          dctx.fillStyle = 'rgba(16, 14, 12, 0.7)';
          dctx.fillRect(sx, sy + 1, sw, sh);
          dctx.fillStyle = shiftColor(baseRgb, 12);
          dctx.fillRect(sx, sy, sw - 1, sh - 1);
          dctx.fillStyle = shiftColor(baseRgb, 28);
          dctx.fillRect(sx, sy, Math.max(1, sw - 2), 1);
        }
      }
      return finalizePixelTexture(dc, true, aniso, false);
    });
  } else if (theme === 'flesh') {
    // 6 genuinely distinct monster interior floor variants (cellular, muscle fibers, veins, bone splinters, dimples)
    floorVariants = [floorMap];
    for (let v = 1; v < 6; v++) {
      const vc = document.createElement('canvas');
      vc.width = 64;
      vc.height = 64;
      const vctx = vc.getContext('2d')!;
      drawFleshFloorVariant(vctx, null, v, seed * 41 + v * 881 + 29);
      floorVariants.push(finalizePixelTexture(vc, true, aniso, true));
    }

    // 4 genuinely distinct monster interior wall variants (cellular web, diagonal sinew, embedded ribs, bio-nodules)
    wallVariants = [];
    for (let v = 0; v < 4; v++) {
      const wc = document.createElement('canvas');
      wc.width = 64;
      wc.height = 64;
      const wvctx = wc.getContext('2d')!;
      if (v === 0) {
        wvctx.drawImage(wallCanvas, 0, 0);
      } else {
        drawFleshWallVariant(wvctx, null, v, seed * 43 + v * 733 + 61);
      }
      wallVariants.push(finalizePixelTexture(wc, true, aniso, true));
    }
    wallMap = wallVariants[0];

    // 3 clean, readable flesh floor decals (membrane crease, subtle muted bile/moss-like stain, dark vein tuft)
    floorDecalMaps = [0, 1, 2].map((dIdx) => {
      const dc = document.createElement('canvas');
      dc.width = 32;
      dc.height = 32;
      const dctx = dc.getContext('2d')!;
      dctx.clearRect(0, 0, 32, 32);
      if (dIdx === 0) {
        // Dark-plum organic membrane fold / crease
        const pts: Array<[number, number]> = [
          [4, 14], [7, 13], [11, 15], [15, 16], [19, 15], [23, 17], [27, 16],
          [15, 16], [17, 20], [19, 24], [11, 15], [10, 10],
        ];
        for (const [px, py] of pts) {
          dctx.fillStyle = 'rgba(34, 8, 30, 0.82)';
          dctx.fillRect(px, py, 2, 2);
          dctx.fillStyle = 'rgba(220, 120, 190, 0.34)';
          dctx.fillRect(px, py - 1, 2, 1);
        }
      } else if (dIdx === 1) {
        // Muted dusky-olive / plum organic stain (subtle nod to reference image 2 without glaring reflections)
        const blobs: Array<[number, number, number, number]> = [
          [6, 9, 12, 9], [14, 12, 12, 10], [9, 18, 11, 7], [18, 8, 7, 6],
        ];
        for (const [bx, by, bw, bh] of blobs) {
          dctx.fillStyle = 'rgba(54, 72, 62, 0.42)';
          dctx.fillRect(bx, by, bw, bh);
          dctx.fillStyle = 'rgba(84, 108, 88, 0.45)';
          dctx.fillRect(bx + 2, by + 2, Math.max(2, bw - 4), Math.max(2, bh - 4));
        }
      } else {
        // Branching capillary vein + tiny pale cartilage flecks
        const pts: Array<[number, number]> = [
          [5, 16], [8, 15], [11, 14], [14, 16], [18, 17], [22, 15], [26, 14],
          [14, 16], [16, 12], [18, 9], [18, 17], [20, 21],
        ];
        for (const [px, py] of pts) {
          dctx.fillStyle = 'rgba(195, 72, 158, 0.65)';
          dctx.fillRect(px, py, 2, 2);
        }
        dctx.fillStyle = 'rgba(224, 206, 214, 0.72)';
        dctx.fillRect(10, 21, 3, 2);
        dctx.fillRect(21, 10, 2, 3);
      }
      return finalizePixelTexture(dc, true, aniso, false);
    });
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
    floorDecalMaps,
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
      if (floorDecalMaps) {
        for (const d of floorDecalMaps) {
          d.dispose();
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
