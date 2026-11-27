// Alien spaceship (depths 31-40) pixel textures: deck floor variants, bulkhead wall variants, pillar, cargo crate
// and floor decals. Pure canvas drawing; textures.ts wraps the canvases into THREE textures.
// Style rules: dark bulkheads, mid-tone deck, small accent pixels only (no large glowing areas; the soft light
// strips on the floor are separate meshes, see levelBuild.ts), and no red so boss telegraphs stay readable.

type Rgb = [number, number, number];

export interface AlienPalette {
  /** Command Deck (alien_core): amber accents, more grates. Cryo-Deck: ice-cyan accents, frost. */
  isCore: boolean;
  floor: Rgb;
  floorAcc: Rgb;
  mortar: string;
  wall: Rgb;
  wallAcc: Rgb;
  accent: Rgb;
}

export type AlienFloorKind = 'plates' | 'platesFrost' | 'tread' | 'grate' | 'hex' | 'trench' | 'scorched';

/** Floor variant lists per biome; index 0 is the main floor map (drawn with a bump map). */
export function alienFloorKinds(isCore: boolean): AlienFloorKind[] {
  return isCore
    ? ['plates', 'tread', 'grate', 'grate', 'hex', 'scorched']
    : ['plates', 'platesFrost', 'tread', 'grate', 'hex', 'trench'];
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(rgb: Rgb, d: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + d)));
  return `rgb(${c(rgb[0])},${c(rgb[1])},${c(rgb[2])})`;
}

function rgba(rgb: Rgb, a: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

const HAZARD_AMBER: Rgb = [176, 132, 44];
const HAZARD_DARK = '#1b1d22';

/** One bevelled deck plate with faint brushed streaks and corner bolts. */
function drawPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: Rgb,
  r: () => number,
  bolts = true
): void {
  ctx.fillStyle = shade(rgb, 0);
  ctx.fillRect(x, y, w, h);
  for (let sy = y + 2; sy < y + h - 2; sy += 2) {
    ctx.fillStyle = shade(rgb, Math.floor((r() - 0.5) * 10));
    ctx.fillRect(x + 2, sy, w - 4, 1);
  }
  ctx.fillStyle = shade(rgb, 20);
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = shade(rgb, -28);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
  if (bolts) {
    for (const [bx, by] of [
      [x + 2, y + 2],
      [x + w - 4, y + 2],
      [x + 2, y + h - 4],
      [x + w - 4, y + h - 4],
    ]) {
      ctx.fillStyle = shade(rgb, -34);
      ctx.fillRect(bx, by, 2, 2);
      ctx.fillStyle = shade(rgb, 26);
      ctx.fillRect(bx, by, 1, 1);
    }
  }
}

function drawFrost(ctx: CanvasRenderingContext2D, r: () => number, size: number, density: number): void {
  for (let i = 0; i < density; i++) {
    // Frost hugs the plate edges
    const edge = Math.floor(r() * 4);
    const t = Math.floor(r() * size);
    const d = Math.floor(Math.pow(r(), 2.2) * 9);
    const x = edge === 0 ? d : edge === 1 ? size - 1 - d : t;
    const y = edge === 2 ? d : edge === 3 ? size - 1 - d : t;
    ctx.fillStyle = r() < 0.3 ? 'rgba(236,248,255,0.55)' : 'rgba(196,226,246,0.35)';
    ctx.fillRect(x, y, 1, 1);
  }
}

export function drawAlienFloorVariant(
  ctx: CanvasRenderingContext2D,
  bctx: CanvasRenderingContext2D | null,
  kind: AlienFloorKind,
  seed: number,
  pal: AlienPalette
): void {
  const r = rng(seed);
  const S = 64;
  ctx.fillStyle = pal.mortar;
  ctx.fillRect(0, 0, S, S);
  if (bctx) {
    bctx.fillStyle = '#303030';
    bctx.fillRect(0, 0, S, S);
  }

  const plates2x2 = () => {
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        const rgb = (gx + gy) % 2 === 1 ? pal.floorAcc : pal.floor;
        drawPlate(ctx, gx * 32 + 1, gy * 32 + 1, 30, 30, rgb, r);
        if (bctx) {
          bctx.fillStyle = '#d0d0d0';
          bctx.fillRect(gx * 32 + 1, gy * 32 + 1, 30, 30);
          bctx.fillStyle = '#f0f0f0';
          bctx.fillRect(gx * 32 + 1, gy * 32 + 1, 30, 1);
        }
      }
    }
    // One recessed grip pad on a random plate
    const gx = Math.floor(r() * 2);
    const gy = Math.floor(r() * 2);
    const px = gx * 32 + 8;
    const py = gy * 32 + 9;
    ctx.fillStyle = shade(pal.floor, -22);
    ctx.fillRect(px, py, 16, 14);
    ctx.fillStyle = shade(pal.floor, 6);
    for (let ry = py + 2; ry < py + 13; ry += 3) ctx.fillRect(px + 2, ry, 12, 1);
    if (bctx) {
      bctx.fillStyle = '#7a7a7a';
      bctx.fillRect(px, py, 16, 14);
    }
  };

  if (kind === 'plates' || kind === 'platesFrost' || kind === 'scorched') {
    plates2x2();
    if (kind === 'platesFrost') drawFrost(ctx, r, S, 150);
    if (kind === 'scorched') {
      const cx = 20 + r() * 24;
      const cy = 20 + r() * 24;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const d = Math.hypot(x - cx, y - cy) / 17 + (r() - 0.5) * 0.35;
          if (d < 1) {
            ctx.fillStyle = `rgba(10,9,10,${(0.72 * (1 - d)).toFixed(3)})`;
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      // Two dent / gouge lines
      for (let k = 0; k < 2; k++) {
        let x = cx + (r() - 0.5) * 10;
        let y = cy + (r() - 0.5) * 10;
        const dx = r() - 0.5;
        const dy = r() - 0.5;
        for (let i = 0; i < 9; i++) {
          ctx.fillStyle = 'rgba(8,8,10,0.85)';
          ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
          ctx.fillStyle = rgba(pal.floor, 0.5);
          ctx.fillRect(Math.round(x), Math.round(y) - 1, 2, 1);
          x += dx * 4;
          y += dy * 4;
        }
      }
    }
  } else if (kind === 'tread') {
    drawPlate(ctx, 1, 1, 62, 62, pal.floor, r);
    // Diamond tread: alternating short diagonal dashes
    for (let y = 5; y < 59; y += 4) {
      for (let x = 5; x < 59; x += 6) {
        const flip = ((x / 6) | 0) % 2 === ((y / 4) | 0) % 2;
        ctx.fillStyle = shade(pal.floor, 18);
        ctx.fillRect(x, y + (flip ? 0 : 1), 2, 1);
        ctx.fillRect(x + 2, y + (flip ? 1 : 0), 1, 1);
        ctx.fillStyle = shade(pal.floor, -22);
        ctx.fillRect(x, y + (flip ? 1 : 2), 2, 1);
      }
    }
  } else if (kind === 'grate') {
    // Heavy frame around an open grate (dark void under the bars)
    drawPlate(ctx, 0, 0, S, S, pal.floorAcc, r, true);
    ctx.fillStyle = '#06090d';
    ctx.fillRect(6, 6, 52, 52);
    for (let x = 6; x < 58; x += 4) {
      ctx.fillStyle = shade(pal.floorAcc, -6);
      ctx.fillRect(x, 6, 2, 52);
      ctx.fillStyle = shade(pal.floorAcc, 14);
      ctx.fillRect(x, 6, 1, 52);
    }
    for (let y = 6; y < 58; y += 10) {
      ctx.fillStyle = shade(pal.floorAcc, -14);
      ctx.fillRect(6, y, 52, 2);
      ctx.fillStyle = shade(pal.floorAcc, 8);
      ctx.fillRect(6, y, 52, 1);
    }
    // Faint machinery glint far below
    if (r() < 0.6) {
      ctx.fillStyle = rgba(pal.accent, 0.35);
      ctx.fillRect(9 + Math.floor(r() * 10) * 4 + 2, 12 + Math.floor(r() * 4) * 10, 1, 4);
    }
  } else if (kind === 'hex') {
    ctx.fillStyle = shade(pal.floor, -40);
    ctx.fillRect(0, 0, S, S);
    // Pixel hex cells: 12 wide, 10 tall, odd columns offset by half a cell
    for (let col = -1; col < 7; col++) {
      for (let row = -1; row < 8; row++) {
        const cx = col * 10;
        const cy = row * 10 + (col % 2 === 0 ? 0 : 5);
        const rgb = r() < 0.5 ? pal.floor : pal.floorAcc;
        const d = Math.floor((r() - 0.5) * 12);
        ctx.fillStyle = shade(rgb, d);
        ctx.fillRect(cx + 3, cy + 1, 6, 8);
        ctx.fillRect(cx + 1, cy + 3, 10, 4);
        ctx.fillStyle = shade(rgb, d + 18);
        ctx.fillRect(cx + 3, cy + 1, 6, 1);
        ctx.fillStyle = shade(rgb, d - 24);
        ctx.fillRect(cx + 3, cy + 8, 6, 1);
      }
    }
  } else {
    // trench: two plates with a ribbed cable-trench cover running across the middle
    drawPlate(ctx, 1, 1, 62, 22, pal.floor, r);
    drawPlate(ctx, 1, 41, 62, 22, pal.floor, r);
    ctx.fillStyle = '#080b10';
    ctx.fillRect(0, 24, S, 16);
    // Cables glimpsed between the slats
    ctx.fillStyle = rgba(pal.accent, 0.4);
    ctx.fillRect(0, 29, S, 2);
    ctx.fillStyle = pal.isCore ? 'rgba(120,200,220,0.28)' : 'rgba(150,170,190,0.4)';
    ctx.fillRect(0, 34, S, 2);
    for (let x = 0; x < S; x += 3) {
      ctx.fillStyle = shade(pal.floorAcc, -8);
      ctx.fillRect(x, 25, 2, 14);
      ctx.fillStyle = shade(pal.floorAcc, 12);
      ctx.fillRect(x, 25, 1, 14);
    }
  }
}

/**
 * Bulkhead wall face (the 64x64 texture spans one tile wide and the full wall height):
 * header rail, a variant middle section, and a kickplate with a muted hazard stripe.
 * 0 server rack with LED dots, 1 vent grille, 2 pipes, 3 riveted plates with a small screen.
 */
export function drawAlienWallVariant(
  ctx: CanvasRenderingContext2D,
  bctx: CanvasRenderingContext2D | null,
  variant: number,
  seed: number,
  pal: AlienPalette
): void {
  const r = rng(seed);
  const S = 64;
  ctx.fillStyle = shade(pal.wall, -16);
  ctx.fillRect(0, 0, S, S);

  // Header rail
  ctx.fillStyle = shade(pal.wallAcc, 14);
  ctx.fillRect(0, 0, S, 6);
  ctx.fillStyle = shade(pal.wallAcc, 34);
  ctx.fillRect(0, 0, S, 1);
  ctx.fillStyle = shade(pal.wall, -30);
  ctx.fillRect(0, 6, S, 1);

  const panelTop = 8;
  const panelBot = 50;

  if (variant === 0) {
    // Two server-rack columns: rack units with tiny LED dots
    for (const cx of [3, 34]) {
      ctx.fillStyle = shade(pal.wall, -26);
      ctx.fillRect(cx, panelTop, 27, panelBot - panelTop);
      for (let uy = panelTop + 1; uy < panelBot - 4; uy += 6) {
        ctx.fillStyle = shade(pal.wall, 2);
        ctx.fillRect(cx + 1, uy, 25, 5);
        ctx.fillStyle = shade(pal.wall, 16);
        ctx.fillRect(cx + 1, uy, 25, 1);
        // Vent slits
        ctx.fillStyle = shade(pal.wall, -22);
        for (let sx = cx + 12; sx < cx + 24; sx += 2) ctx.fillRect(sx, uy + 2, 1, 2);
        // LEDs
        if (r() < 0.55) {
          ctx.fillStyle = shade(pal.accent, 0);
          ctx.fillRect(cx + 3, uy + 2, 1, 1);
        }
        if (r() < 0.35) {
          ctx.fillStyle = pal.isCore ? 'rgb(120,210,230)' : 'rgb(170,230,200)';
          ctx.fillRect(cx + 6, uy + 2, 1, 1);
        }
      }
    }
  } else if (variant === 1) {
    // Large recessed vent grille with louvers
    ctx.fillStyle = shade(pal.wall, 4);
    ctx.fillRect(2, panelTop, 60, panelBot - panelTop);
    ctx.fillStyle = shade(pal.wall, 18);
    ctx.fillRect(2, panelTop, 60, 1);
    ctx.fillStyle = '#080b10';
    ctx.fillRect(8, panelTop + 5, 48, 32);
    for (let ly = panelTop + 6; ly < panelTop + 37; ly += 4) {
      ctx.fillStyle = shade(pal.wallAcc, 6);
      ctx.fillRect(9, ly, 46, 2);
      ctx.fillStyle = shade(pal.wallAcc, 22);
      ctx.fillRect(9, ly, 46, 1);
    }
    for (const [bx, by] of [
      [4, panelTop + 2],
      [58, panelTop + 2],
      [4, panelBot - 4],
      [58, panelBot - 4],
    ]) {
      ctx.fillStyle = shade(pal.wall, -30);
      ctx.fillRect(bx, by, 2, 2);
    }
  } else if (variant === 2) {
    // Dark service panel with two vertical pipes and one cross pipe
    ctx.fillStyle = shade(pal.wall, -22);
    ctx.fillRect(0, panelTop, S, panelBot - panelTop);
    const pipe = (x: number, w: number, rgb: Rgb) => {
      ctx.fillStyle = shade(rgb, 0);
      ctx.fillRect(x, panelTop, w, panelBot - panelTop);
      ctx.fillStyle = shade(rgb, 26);
      ctx.fillRect(x + 1, panelTop, 1, panelBot - panelTop);
      ctx.fillStyle = shade(rgb, -30);
      ctx.fillRect(x + w - 1, panelTop, 1, panelBot - panelTop);
      for (let cy = panelTop + 6; cy < panelBot; cy += 13) {
        ctx.fillStyle = shade(pal.wall, -36);
        ctx.fillRect(x - 1, cy, w + 2, 2);
      }
    };
    const metal: Rgb = [pal.wallAcc[0] + 34, pal.wallAcc[1] + 38, pal.wallAcc[2] + 44];
    pipe(11, 6, metal);
    pipe(45, 5, metal);
    // Cross pipe (coolant: a hint of the accent colour)
    const coolant: Rgb = [
      Math.round(metal[0] * 0.7 + pal.accent[0] * 0.3),
      Math.round(metal[1] * 0.7 + pal.accent[1] * 0.3),
      Math.round(metal[2] * 0.7 + pal.accent[2] * 0.3),
    ];
    ctx.fillStyle = shade(coolant, -6);
    ctx.fillRect(0, 30, S, 4);
    ctx.fillStyle = shade(coolant, 20);
    ctx.fillRect(0, 30, S, 1);
    ctx.fillStyle = shade(coolant, -34);
    ctx.fillRect(0, 33, S, 1);
  } else {
    // Riveted bulkhead plates with a small dim status screen
    for (const px of [1, 33]) {
      ctx.fillStyle = shade(pal.wall, 0);
      ctx.fillRect(px, panelTop, 30, panelBot - panelTop);
      ctx.fillStyle = shade(pal.wall, 16);
      ctx.fillRect(px, panelTop, 30, 1);
      ctx.fillStyle = shade(pal.wall, -26);
      ctx.fillRect(px + 29, panelTop, 1, panelBot - panelTop);
      for (let ry = panelTop + 3; ry < panelBot - 2; ry += 6) {
        ctx.fillStyle = shade(pal.wall, -30);
        ctx.fillRect(px + 2, ry, 1, 1);
        ctx.fillRect(px + 26, ry, 1, 1);
      }
    }
    const sx = 39;
    const sy = panelTop + 7;
    ctx.fillStyle = shade(pal.wall, -34);
    ctx.fillRect(sx - 1, sy - 1, 18, 13);
    ctx.fillStyle = '#0a1016';
    ctx.fillRect(sx, sy, 16, 11);
    for (let ly = sy + 1; ly < sy + 11; ly += 2) {
      const w = 4 + Math.floor(r() * 10);
      ctx.fillStyle = rgba(pal.accent, 0.55);
      ctx.fillRect(sx + 1, ly, w, 1);
    }
  }

  // Kickplate with a muted hazard stripe
  ctx.fillStyle = shade(pal.wall, -22);
  ctx.fillRect(0, 51, S, 13);
  ctx.fillStyle = shade(pal.wall, -6);
  ctx.fillRect(0, 51, S, 1);
  ctx.fillStyle = HAZARD_DARK;
  ctx.fillRect(0, 54, S, 6);
  for (let x = -6; x < S; x += 8) {
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = shade(HAZARD_AMBER, -10);
      ctx.fillRect(x + k, 54 + k, 4, 1);
    }
  }

  if (!pal.isCore && variant % 2 === 0) {
    // Frost creeping down from the header rail
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * S);
      const y = 6 + Math.floor(Math.pow(r(), 2.4) * 16);
      ctx.fillStyle = r() < 0.3 ? 'rgba(236,248,255,0.5)' : 'rgba(190,222,244,0.32)';
      ctx.fillRect(x, y, 1, 1);
    }
  }

  if (bctx) {
    bctx.fillStyle = '#909090';
    bctx.fillRect(0, 0, S, S);
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, S, 6);
    bctx.fillStyle = '#c8c8c8';
    bctx.fillRect(2, panelTop, 60, panelBot - panelTop);
    bctx.fillStyle = '#6a6a6a';
    bctx.fillRect(8, panelTop + 5, 48, 32);
    bctx.fillStyle = '#b4b4b4';
    bctx.fillRect(0, 51, S, 13);
  }
}

/** Square machined column (32x64): graphite panels with seams and rivets; the thin glow ring is geometry. */
export function drawAlienPillar(ctx: CanvasRenderingContext2D, seed: number, pal: AlienPalette): void {
  const r = rng(seed);
  ctx.fillStyle = shade(pal.wall, -4);
  ctx.fillRect(0, 0, 32, 64);
  for (let y = 0; y < 64; y += 2) {
    ctx.fillStyle = shade(pal.wall, -4 + Math.floor((r() - 0.5) * 8));
    ctx.fillRect(1, y, 30, 1);
  }
  ctx.fillStyle = shade(pal.wall, 18);
  ctx.fillRect(0, 0, 2, 64);
  ctx.fillStyle = shade(pal.wall, -30);
  ctx.fillRect(15, 0, 2, 64);
  for (const sy of [18, 46]) {
    ctx.fillStyle = shade(pal.wall, -32);
    ctx.fillRect(0, sy, 32, 2);
    ctx.fillStyle = shade(pal.wall, 14);
    ctx.fillRect(0, sy + 2, 32, 1);
  }
  for (const [x, y] of [
    [4, 4],
    [27, 4],
    [4, 58],
    [27, 58],
  ]) {
    ctx.fillStyle = shade(pal.wall, -34);
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.fillStyle = shade(pal.accent, -40);
  ctx.fillRect(6, 8, 2, 1);
}

/** Cargo container face (32x32): ribbed steel, hazard tape band, one status light. */
export function drawAlienCrate(ctx: CanvasRenderingContext2D, pal: AlienPalette): void {
  ctx.fillStyle = shade(pal.wall, 8);
  ctx.fillRect(0, 0, 32, 32);
  for (let x = 4; x < 28; x += 5) {
    ctx.fillStyle = shade(pal.wall, 22);
    ctx.fillRect(x, 3, 1, 26);
    ctx.fillStyle = shade(pal.wall, -14);
    ctx.fillRect(x + 1, 3, 1, 26);
  }
  ctx.fillStyle = shade(pal.wall, -30);
  ctx.fillRect(0, 0, 32, 3);
  ctx.fillRect(0, 29, 32, 3);
  ctx.fillRect(0, 0, 3, 32);
  ctx.fillRect(29, 0, 3, 32);
  // Hazard tape
  ctx.fillStyle = HAZARD_DARK;
  ctx.fillRect(3, 13, 26, 5);
  for (let x = -4; x < 30; x += 6) {
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = shade(HAZARD_AMBER, 0);
      ctx.fillRect(Math.max(3, x + k), 13 + k, 3, 1);
    }
  }
  ctx.fillStyle = shade(pal.accent, 0);
  ctx.fillRect(25, 5, 2, 2);
}

/** 32x32 transparent decals: 0 hazard chevrons (wall-side only), 1 scorch mark, 2 coolant leak. */
export function drawAlienDecal(ctx: CanvasRenderingContext2D, idx: number, seed: number): void {
  const r = rng(seed);
  ctx.clearRect(0, 0, 32, 32);
  if (idx === 0) {
    ctx.fillStyle = 'rgba(20,20,24,0.5)';
    ctx.fillRect(2, 11, 28, 11);
    for (const x0 of [5, 13, 21]) {
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = rgba(HAZARD_AMBER, 0.78);
        ctx.fillRect(x0 + k, 12 + k, 2, 1);
        ctx.fillRect(x0 + k, 20 - k, 2, 1);
      }
    }
  } else if (idx === 1) {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const d = Math.hypot(x - 16, y - 16) / 13 + (r() - 0.5) * 0.4;
        if (d < 1) {
          ctx.fillStyle = `rgba(12,10,10,${(0.7 * (1 - d)).toFixed(3)})`;
          ctx.fillRect(x, y, 1, 1);
        } else if (d < 1.12 && r() < 0.4) {
          ctx.fillStyle = 'rgba(70,52,34,0.3)';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  } else {
    const blobs: Array<[number, number, number, number]> = [
      [7, 11, 12, 8],
      [14, 14, 11, 9],
      [10, 19, 8, 5],
      [20, 9, 6, 5],
    ];
    for (const [bx, by, bw, bh] of blobs) {
      ctx.fillStyle = 'rgba(110,200,225,0.2)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(150,225,245,0.18)';
      ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
    }
    ctx.fillStyle = 'rgba(210,248,255,0.4)';
    ctx.fillRect(12, 13, 3, 1);
    ctx.fillRect(18, 17, 2, 1);
  }
}
