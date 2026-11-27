import type { EmbervaultEngine } from '../engine';
import { FROST_MAGE } from '../classes';
import { TILE_SIZE, findGridPath, gridToWorld, hasLineOfSight, isTileWalkable, worldToGrid, worldToWalkableGrid } from '../dungeon';

export const movementMethods = {
  isPointInWall(this: EmbervaultEngine, x: number, z: number): boolean {
    const g = worldToGrid(x, z);
    return !isTileWalkable(this.dungeon, g.gx, g.gz, this.doorUnlocked);
  },

  canMoveTo(this: EmbervaultEngine, wx: number, wz: number, radius = 0.38): boolean {
    const checks = [
      [wx - radius, wz - radius],
      [wx + radius, wz - radius],
      [wx - radius, wz + radius],
      [wx + radius, wz + radius],
    ];
    for (let i = 0; i < 4; i++) {
      const cx = checks[i][0];
      const cz = checks[i][1];
      const { gx, gz } = worldToGrid(cx, cz);
      if (gx < 0 || gz < 0 || gx >= this.dungeon.width || gz >= this.dungeon.height) {
        return false;
      }
      const t = this.dungeon.tiles[gz][gx];
      if (t === 0 || t === 2) return false;
      if (t === 3 && !this.doorUnlocked) return false;
    }

    // Smooth circular collision against nearby stone pillars (tile 5) so actors glide around pillars
    const centerG = worldToGrid(wx, wz);
    const pillarBlockDist = 0.48 + radius;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = centerG.gx + dx;
        const gz = centerG.gz + dz;
        if (this.dungeon.tiles[gz]?.[gx] === 5) {
          const px = gx * TILE_SIZE;
          const pz = gz * TILE_SIZE;
          if (Math.hypot(wx - px, wz - pz) < pillarBlockDist) {
            return false;
          }
        }
      }
    }
    return true;
  },

  moveWithSlide(
    this: EmbervaultEngine,
    x: number,
    z: number,
    dx: number,
    dz: number,
    radius = 0.38
  ): { x: number; z: number } {
    if (this.canMoveTo(x + dx, z + dz, radius)) {
      return { x: x + dx, z: z + dz };
    }

    let nx = x;
    let nz = z;
    if (this.canMoveTo(x + dx, z, radius)) {
      nx = x + dx;
    }
    if (this.canMoveTo(nx, z + dz, radius)) {
      nz = z + dz;
    }

    // If blocked head-on by a circular pillar, slide tangentially around it!
    const movedDist = Math.hypot(nx - x, nz - z);
    const wantDist = Math.hypot(dx, dz);
    if (wantDist > 0.0001 && movedDist < wantDist * 0.25) {
      const centerG = worldToGrid(x + dx, z + dz);
      for (let pzOff = -1; pzOff <= 1; pzOff++) {
        for (let pxOff = -1; pxOff <= 1; pxOff++) {
          const gx = centerG.gx + pxOff;
          const gz = centerG.gz + pzOff;
          if (this.dungeon.tiles[gz]?.[gx] === 5) {
            const px = gx * TILE_SIZE;
            const pz = gz * TILE_SIZE;
            const rx = x - px;
            const rz = z - pz;
            const rLen = Math.hypot(rx, rz) || 1;
            if (rLen < 1.35) {
              // Two tangent directions around pillar; pick the one aligned with movement
              const t1x = -rz / rLen;
              const t1z = rx / rLen;
              const dot = t1x * dx + t1z * dz;
              const sign = dot >= 0 ? 1 : -1;
              const sx = t1x * sign * wantDist * 0.9;
              const sz = t1z * sign * wantDist * 0.9;
              if (this.canMoveTo(x + sx, z + sz, radius)) {
                return { x: x + sx, z: z + sz };
              }
            }
          }
        }
      }

      // Wall-corner doorway centering nudge: if snagged on a 1-tile corridor lip, glide toward tile center
      const curG = worldToGrid(x, z);
      const centerW = gridToWorld(curG.gx, curG.gz);
      const toCx = centerW.x - x;
      const toCz = centerW.z - z;
      const toCDist = Math.hypot(toCx, toCz);
      if (toCDist > 0.08) {
        const nudgeX = (toCx / toCDist) * wantDist * 0.85;
        const nudgeZ = (toCz / toCDist) * wantDist * 0.85;
        if (this.canMoveTo(x + nudgeX, z + nudgeZ, radius)) {
          return { x: x + nudgeX, z: z + nudgeZ };
        }
        if (this.canMoveTo(x + nudgeX, z, radius)) {
          return { x: x + nudgeX, z };
        }
        if (this.canMoveTo(x, z + nudgeZ, radius)) {
          return { x, z: z + nudgeZ };
        }
      }
    }

    return { x: nx, z: nz };
  },

  buildSafeGridPath(
    this: EmbervaultEngine,
    goalGx: number,
    goalGz: number
  ): Array<{ gx: number; gz: number }> {
    const start = worldToWalkableGrid(this.dungeon, this.hero.x, this.hero.z, this.doorUnlocked);
    const path = findGridPath(
      this.dungeon,
      start.gx,
      start.gz,
      goalGx,
      goalGz,
      this.doorUnlocked
    );
    if (path.length > 0) {
      // If hero is off-center and straight line to path[0] clips a doorway wall corner, center on current tile first!
      const firstW = gridToWorld(path[0].gx, path[0].gz);
      const curW = gridToWorld(start.gx, start.gz);
      if (
        Math.hypot(this.hero.x - curW.x, this.hero.z - curW.z) > 0.3 &&
        !hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, firstW.x, firstW.z, this.doorUnlocked, 0.42)
      ) {
        path.unshift({ gx: start.gx, gz: start.gz });
      }
    }
    return path;
  },

  followGridPath(
    this: EmbervaultEngine,
    path: Array<{ gx: number; gz: number }>
  ): { moveX: number; moveZ: number } | null {
    while (path.length > 0) {
      const nextTile = path[0];
      const targetW = gridToWorld(nextTile.gx, nextTile.gz);
      const dx = targetW.x - this.hero.x;
      const dz = targetW.z - this.hero.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.36) {
        path.shift();
      } else {
        return { moveX: dx / dist, moveZ: dz / dist };
      }
    }
    return null;
  },

  nudgeHeroToClearTile(this: EmbervaultEngine): void {
    const cur = worldToGrid(this.hero.x, this.hero.z);
    const targetTile =
      this.hero.ai.path.length > 0 && isTileWalkable(this.dungeon, this.hero.ai.path[0].gx, this.hero.ai.path[0].gz, this.doorUnlocked)
        ? this.hero.ai.path[0]
        : null;

    const candidates: Array<{ gx: number; gz: number }> = [];
    if (targetTile) candidates.push(targetTile);
    candidates.push(cur);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const nx = cur.gx + dx;
      const nz = cur.gz + dz;
      if (isTileWalkable(this.dungeon, nx, nz, this.doorUnlocked)) {
        candidates.push({ gx: nx, gz: nz });
      }
    }

    for (const c of candidates) {
      const cw = gridToWorld(c.gx, c.gz);
      if (this.canMoveTo(cw.x, cw.z, 0.36)) {
        const dx = cw.x - this.hero.x;
        const dz = cw.z - this.hero.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const step = Math.min(d, 0.55);
          this.hero.x += (dx / d) * step;
          this.hero.z += (dz / d) * step;
          return;
        }
      }
    }
  },

  tryAutoTravelDash(this: EmbervaultEngine, moveX: number, moveZ: number, distToGoal: number): void {
    // Warrior dash travels ~2.15 units; the mage's Blink teleports 5 units, so every
    // safety check below scales with the actual travel distance.
    const mage = this.hero.isMage();
    const travel = mage ? FROST_MAGE.blinkDistance : 2.15;
    if (
      this.hero.dashCooldown > 0 ||
      this.hero.dashTimer > 0 ||
      this.hero.ai.forcePathTimer > 0 ||
      distToGoal < (mage ? travel + 1.5 : 3.4) // never blink past the key / altar / stairs
    ) {
      return;
    }

    const len = Math.hypot(moveX, moveZ);
    if (len < 0.2) return;
    const nx = moveX / len;
    const nz = moveZ / len;

    // Mage: only blink when already heading that way (within ~15°), so it never zig-zags
    if (mage) {
      let diff = Math.atan2(nx, nz) - this.hero.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 0.26) return;
    }

    // Only dash in confirmed safe zones (no nearby enemies or active projectiles)
    for (const e of this.enemies) {
      if (!e.dead && Math.hypot(e.x - this.hero.x, e.z - this.hero.z) < 9.0) {
        return;
      }
    }
    for (const p of this.projectiles) {
      if (Math.hypot(p.x - this.hero.x, p.z - this.hero.z) < 8.0) {
        return;
      }
    }

    // Ensure a completely clear straight corridor ahead for the whole travel distance
    const checkEndX = this.hero.x + nx * (travel + 0.4);
    const checkEndZ = this.hero.z + nz * (travel + 0.4);
    const landX = this.hero.x + nx * travel;
    const landZ = this.hero.z + nz * travel;
    if (
      !hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, checkEndX, checkEndZ, this.doorUnlocked, 0.44) ||
      !this.canMoveTo(landX, landZ, 0.42)
    ) {
      return;
    }

    // Avoid dashing straight onto a spike trap
    for (const sp of this.spikes) {
      if (Math.hypot(sp.x - landX, sp.z - landZ) < 1.25) {
        return;
      }
    }

    this.hero.facing = Math.atan2(nx, nz);
    this.performDash();
  },

  getPathDashDirection(
    this: EmbervaultEngine,
    path: Array<{ gx: number; gz: number }>,
    fallback: { moveX: number; moveZ: number }
  ): { moveX: number; moveZ: number; distToGoal: number } {
    if (path.length === 0) {
      return { moveX: fallback.moveX, moveZ: fallback.moveZ, distToGoal: 0 };
    }
    const endW = gridToWorld(path[path.length - 1].gx, path[path.length - 1].gz);
    const distToGoal = Math.hypot(endW.x - this.hero.x, endW.z - this.hero.z);

    // Look up to 3 tiles ahead along the A* path for a clean straight dash vector
    const maxLook = Math.min(path.length - 1, 2);
    for (let i = maxLook; i >= 0; i--) {
      const tw = gridToWorld(path[i].gx, path[i].gz);
      const dx = tw.x - this.hero.x;
      const dz = tw.z - this.hero.z;
      const d = Math.hypot(dx, dz);
      if (
        d > 1.2 &&
        hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, tw.x, tw.z, this.doorUnlocked, 0.44)
      ) {
        const dirX = dx / d;
        const dirZ = dz / d;
        if (!this.hero.isMage()) return { moveX: dirX, moveZ: dirZ, distToGoal };
        // Mage: Blink only along a genuinely straight stretch of the path. Report how far the
        // path keeps going in this exact direction (waypoints within 0.6 of the line, in LOS),
        // so tryAutoTravelDash refuses to blink around bends.
        let straightRun = 0;
        for (const wp of path) {
          const ww = gridToWorld(wp.gx, wp.gz);
          const vx = ww.x - this.hero.x;
          const vz = ww.z - this.hero.z;
          const along = vx * dirX + vz * dirZ;
          const off = Math.abs(vx * dirZ - vz * dirX);
          if (along < 0) continue;
          if (off > 0.6) break;
          if (!hasLineOfSight(this.dungeon, this.hero.x, this.hero.z, ww.x, ww.z, this.doorUnlocked, 0.44)) break;
          straightRun = Math.max(straightRun, along);
        }
        return { moveX: dirX, moveZ: dirZ, distToGoal: Math.min(distToGoal, straightRun) };
      }
    }
    return { moveX: fallback.moveX, moveZ: fallback.moveZ, distToGoal };
  },
};
