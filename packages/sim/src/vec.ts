export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const len = (v: Vec2): number => Math.sqrt(v.x * v.x + v.y * v.y);

/** Returns v scaled to at most `max` length (new object). */
export function clampLen(v: Vec2, max: number): Vec2 {
  const l = len(v);
  if (l <= max || l === 0) return { x: v.x, y: v.y };
  const s = max / l;
  return { x: v.x * s, y: v.y * s };
}

/** Move `cur` towards `target` by at most `maxDelta` (componentwise along the difference vector). */
export function approach(cur: Vec2, target: Vec2, maxDelta: number): Vec2 {
  const dx = target.x - cur.x;
  const dy = target.y - cur.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= maxDelta || d === 0) return { x: target.x, y: target.y };
  const s = maxDelta / d;
  return { x: cur.x + dx * s, y: cur.y + dy * s };
}
