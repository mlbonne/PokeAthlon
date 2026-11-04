import type { StageDef } from '@pokeathlon/data';
import type { Vec2 } from './vec';

/** Half-plane `n · p <= d`, with unit normal n pointing out of the arena. */
export interface HalfPlane {
  nx: number;
  ny: number;
  d: number;
}

export interface Arena {
  halfWidth: number;
  halfHeight: number;
  cornerCut: number;
  goalHalfWidth: number;
  /** Convex boundary: 4 sides + 4 corner cuts. */
  planes: HalfPlane[];
}

const S = Math.SQRT1_2;

export function arenaFromStage(s: StageDef): Arena {
  const diag = (s.halfWidth + s.halfHeight - s.cornerCut) * S;
  return {
    halfWidth: s.halfWidth,
    halfHeight: s.halfHeight,
    cornerCut: s.cornerCut,
    goalHalfWidth: s.goalHalfWidth,
    planes: [
      { nx: 1, ny: 0, d: s.halfWidth },
      { nx: -1, ny: 0, d: s.halfWidth },
      { nx: 0, ny: 1, d: s.halfHeight },
      { nx: 0, ny: -1, d: s.halfHeight },
      { nx: S, ny: S, d: diag },
      { nx: -S, ny: S, d: diag },
      { nx: S, ny: -S, d: diag },
      { nx: -S, ny: -S, d: diag },
    ],
  };
}

/**
 * Keep a circle inside the arena. Velocity into a wall is reflected with `restitution`
 * (0 = slide along the wall). Mutates pos/vel. Returns the largest impact speed (0 if none).
 */
export function confine(pos: Vec2, vel: Vec2, radius: number, arena: Arena, restitution: number): number {
  let impact = 0;
  for (const pl of arena.planes) {
    const pen = pl.nx * pos.x + pl.ny * pos.y + radius - pl.d;
    if (pen <= 0) continue;
    pos.x -= pl.nx * pen;
    pos.y -= pl.ny * pen;
    const vn = pl.nx * vel.x + pl.ny * vel.y;
    if (vn > 0) {
      const k = (1 + restitution) * vn;
      vel.x -= pl.nx * k;
      vel.y -= pl.ny * k;
      if (vn > impact) impact = vn;
    }
  }
  return impact;
}
