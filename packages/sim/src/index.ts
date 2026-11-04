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
export { hitBall, predictBall, type BallLaunch, type BallPrediction } from './ball';
export * from './ai/index';
export { botInput } from './bot';
export { applyHit, knockOut, respawn, startKnock, type HitSpec } from './combat';
export * from './constants';
export * from './events';
export * from './geometry';
export * from './hash';
export * from './headless';
export * from './impact';
export * from './input';
export { effectiveSpeed, movesFor, SLOTS, type Buff, type Creation, type MoveState, type Projectile } from './moves';
export { beginKickoff, frozenPhase, scoreGoal } from './match';
export { addXp, specialUnlocked } from './progression';
export * from './practice';
export * from './rng';
export * from './stage';
export * from './telemetry';
export * from './vec';
export * from './world';
