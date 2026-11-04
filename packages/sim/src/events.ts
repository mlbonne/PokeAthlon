import type { Vec2 } from './vec';

/**
 * Things that happened during a tick. The client uses them for feedback
 * (VFX, sound, shake); later the server will stream them. Cleared every step.
 */
export type SimEvent =
  | { type: 'strike'; playerId: number; dir: Vec2 }
  | { type: 'ballHit'; playerId: number; pos: Vec2; speed: number; redirect: boolean; red: boolean }
  | { type: 'ballLaunch'; playerId: number; speed: number }
  | { type: 'ballWall'; pos: Vec2; impact: number }
  | { type: 'ballBody'; playerId: number; pos: Vec2; impact: number };
