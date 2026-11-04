/**
 * Seeded, integer-only random numbers (mulberry32 + splitmix32 seeding).
 * Only `Math.imul`, shifts and xor, so every JS engine produces the same stream.
 * State is a plain uint32 kept in the world, so it is hashed and replays exactly.
 */

/** Mix a seed into a well-spread uint32 (splitmix32 finalizer). */
export function mixSeed(seed: number): number {
  let z = (seed + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** Advance `state` and return [newState, uint32 output]. */
export function nextU32(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [s, (t ^ (t >>> 14)) >>> 0];
}

/** A stream stored in an object slot (e.g. `world.ai.rng[i]`). */
export interface RngSlot {
  rng: number[];
}

/** Uniform integer in [lo, hi] from stream `i` of `slot`. */
export function randInt(slot: RngSlot, i: number, lo: number, hi: number): number {
  const [s, out] = nextU32(slot.rng[i] ?? 0);
  slot.rng[i] = s;
  return lo + (out % (hi - lo + 1));
}

/** Uniform float in [0, 1) from stream `i` of `slot` (exact: uint32 / 2^32). */
export function randFloat(slot: RngSlot, i: number): number {
  const [s, out] = nextU32(slot.rng[i] ?? 0);
  slot.rng[i] = s;
  return out / 4294967296;
}
