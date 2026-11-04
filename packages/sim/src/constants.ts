/** Simulation ticks per second. */
export const TICK_RATE = 60;
/** Seconds per tick. */
export const DT = 1 / TICK_RATE;

/**
 * Placeholder arena (world units, OS-like scale: player speed ~450 u/s, strike width ~250 u).
 * Origin at the centre; +x towards the right goal, +y towards the top edge.
 * M1 moves this into stage data files.
 */
export const DEFAULT_ARENA = {
  halfWidth: 1800,
  halfHeight: 1000,
  /** Size of the diagonal corner cuts. */
  cornerCut: 320,
} as const;

/** Seconds to reach full speed from standstill / to stop from full speed. */
export const ACCEL_TIME = 0.08;
export const DECEL_TIME = 0.1;
