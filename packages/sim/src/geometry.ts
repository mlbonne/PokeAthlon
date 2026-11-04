import type { Vec2 } from './vec';

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
export interface Circle {
  x: number;
  y: number;
  r: number;
}
/** Axis-aligned box: centre + half extents. */
export interface Box {
  x: number;
  y: number;
  hx: number;
  hy: number;
}

/** Closed polygon → its edges. */
export function polygonSegments(pts: readonly Vec2[]): Segment[] {
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  });
}

/** Even-odd point-in-polygon test (works for non-convex outlines). */
export function pointInPolygon(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function circleOverlapsBox(p: Vec2, r: number, b: Box): boolean {
  const cx = Math.max(b.x - b.hx, Math.min(p.x, b.x + b.hx));
  const cy = Math.max(b.y - b.hy, Math.min(p.y, b.y + b.hy));
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy < r * r;
}

/**
 * Push a circle out along `n` (unit, pointing away from the obstacle) to `depth`, and reflect the
 * velocity's inward component with `restitution`. Returns the inward speed (impact), 0 if separating.
 */
function resolve(pos: Vec2, vel: Vec2, nx: number, ny: number, depth: number, restitution: number): number {
  pos.x += nx * depth;
  pos.y += ny * depth;
  const vn = vel.x * nx + vel.y * ny;
  if (vn >= 0) return 0;
  const k = (1 + restitution) * vn;
  vel.x -= nx * k;
  vel.y -= ny * k;
  return -vn;
}

export function collideSegment(pos: Vec2, vel: Vec2, r: number, s: Segment, restitution: number): number {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? ((pos.x - s.ax) * ex + (pos.y - s.ay) * ey) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = s.ax + ex * t;
  const cy = s.ay + ey * t;
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return 0;
  const d = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else {
    // Exactly on the line: push against the velocity's side.
    const l = Math.sqrt(len2) || 1;
    nx = -ey / l;
    ny = ex / l;
    if (vel.x * nx + vel.y * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  return resolve(pos, vel, nx, ny, r - d, restitution);
}

export function collideCircle(pos: Vec2, vel: Vec2, r: number, c: Circle, restitution: number): number {
  const dx = pos.x - c.x;
  const dy = pos.y - c.y;
  const min = r + c.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return 0;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 1;
  const ny = d > 1e-9 ? dy / d : 0;
  return resolve(pos, vel, nx, ny, min - d, restitution);
}

export function collideBox(pos: Vec2, vel: Vec2, r: number, b: Box, restitution: number): number {
  const cx = Math.max(b.x - b.hx, Math.min(pos.x, b.x + b.hx));
  const cy = Math.max(b.y - b.hy, Math.min(pos.y, b.y + b.hy));
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return 0;
  if (d2 > 1e-18) {
    const d = Math.sqrt(d2);
    return resolve(pos, vel, dx / d, dy / d, r - d, restitution);
  }
  // Centre inside the box: leave through the nearest face.
  const px = b.hx - Math.abs(pos.x - b.x);
  const py = b.hy - Math.abs(pos.y - b.y);
  if (px < py) return resolve(pos, vel, pos.x >= b.x ? 1 : -1, 0, px + r, restitution);
  return resolve(pos, vel, 0, pos.y >= b.y ? 1 : -1, py + r, restitution);
}
