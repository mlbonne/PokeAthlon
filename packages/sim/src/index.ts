/**
 * @pokeathlon/sim: deterministic game simulation.
 *
 * Rules for this package:
 *  - No DOM, no Three.js, no wall-clock time, no Math.random. Time only advances through `step()`.
 *  - Only IEEE-exact float ops (+ - * / sqrt). No Math.sin/cos/atan2 in sim logic, because engines
 *    may differ in the last bit, which would break lockstep/replays later.
 *  - Inputs are quantized integers so the same input stream always reproduces the same state.
 */
export * from './constants';
export * from './input';
export * from './vec';
export * from './world';
export * from './hash';
