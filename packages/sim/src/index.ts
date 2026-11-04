/**
 * @pokeathlon/sim: deterministic game simulation.
 *
 * Rules for this package:
 *  - No DOM, no Three.js, no wall-clock time, no Math.random. Time only advances through `step()`.
 *  - Only IEEE-exact float ops (+ - * / sqrt). No Math.sin/cos/atan2 in sim logic, because engines
 *    may differ in the last bit, which would break lockstep/replays later.
 *  - Inputs are quantized integers so the same input stream always reproduces the same state.
 *  - All tuning numbers come from @pokeathlon/data JSON, not from code.
 */
export * from './arena';
export * from './constants';
export * from './events';
export * from './hash';
export * from './input';
export * from './vec';
export * from './world';
