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

export function normalize(v: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
  const l = Math.sqrt(v.x * v.x + v.y * v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: fallback.x, y: fallback.y };
}

const PI = Math.PI;
const HALF_PI = PI / 2;
const TWO_PI = PI * 2;

/**
 * Deterministic sine using only + − × ÷ (Math.sin may differ in the last bit across JS engines,
 * which would break lockstep/replays). Max error ≈ 1e-10 — plenty for gameplay angles.
 */
export function dsin(x: number): number {
  // Reduce to [−π, π].
  x = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  // Reflect into [−π/2, π/2].
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  // Taylor series to x^15.
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

export const dcos = (x: number): number => dsin(x + HALF_PI);

/** Rotate a vector by `deg` degrees (counter-clockwise, +y up), deterministically. */
export function rotateDeg(v: Vec2, deg: number): Vec2 {
  const r = (deg * PI) / 180;
  const c = dcos(r);
  const s = dsin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
