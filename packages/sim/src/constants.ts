/** Simulation ticks per second. */
export const TICK_RATE = 60;
/** Seconds per tick. */
export const DT = 1 / TICK_RATE;

/** Seconds → whole ticks (rounded, at least 1 for positive durations). */
export function ticks(seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds * TICK_RATE));
}
