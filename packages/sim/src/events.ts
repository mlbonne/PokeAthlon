import type { Team } from './stage';
import type { Vec2 } from './vec';

/**
 * Things that happened during a tick. The client uses them for feedback
 * (VFX, sound, HUD); later the server will stream them. Cleared every step.
 */
export type SimEvent =
  // Ball & Strike
  | { type: 'strike'; playerId: number; dir: Vec2 }
  | { type: 'ballHit'; playerId: number; pos: Vec2; speed: number; redirect: boolean; red: boolean; boosted: boolean; source: string }
  | { type: 'ballLaunch'; playerId: number; speed: number }
  | { type: 'ballWall'; pos: Vec2; impact: number }
  | { type: 'ballBody'; playerId: number; pos: Vec2; impact: number }
  // Goal structure
  | { type: 'barrierBreak'; team: Team; index: number; pos: Vec2; by: number }
  | { type: 'gateOpen'; team: Team }
  | { type: 'goal'; team: Team; scorer: number; assists: number[]; pos: Vec2; ownGoal: boolean }
  // Match flow
  | { type: 'kickoff'; round: number; set: number }
  | { type: 'play' }
  | { type: 'overtime' }
  | { type: 'setWon'; team: Team; sets: [number, number] }
  | { type: 'matchWon'; team: Team }
  // Combat
  | {
      type: 'hit';
      attacker: number;
      target: number;
      knockback: number;
      damage: number;
      light: boolean;
      pos: Vec2;
      /** Move id, `strike`, `burst` or `other`. */
      source: string;
      /** The target was already Staggered (took boosted knockback). */
      staggered: boolean;
    }
  | { type: 'staggered'; playerId: number; by: number }
  | { type: 'recovered'; playerId: number }
  | { type: 'ko'; playerId: number; by: number; pos: Vec2 }
  | { type: 'respawn'; playerId: number; pos: Vec2 }
  | { type: 'evade'; playerId: number }
  | { type: 'burst'; playerId: number; pos: Vec2; grabbedBall: boolean }
  // Orbs & progression
  | { type: 'orbSpawn'; id: number; pos: Vec2 }
  | { type: 'orb'; id: number; playerId: number; pos: Vec2 }
  | { type: 'levelUp'; playerId: number; level: number }
  // Moves (M3)
  | { type: 'cast'; playerId: number; moveId: string; slot: string }
  | {
      type: 'area';
      playerId: number;
      moveId: string;
      shape: 'circle' | 'cone' | 'line';
      pos: Vec2;
      dir: Vec2;
      radius: number;
      angleDeg: number;
      length: number;
      width: number;
      color: string;
    }
  | { type: 'dash'; playerId: number; moveId: string }
  | { type: 'buff'; playerId: number; moveId: string }
  | { type: 'wall'; playerId: number; moveId: string }
  | { type: 'ballStun'; playerId: number; pos: Vec2; source: string }
  // Move system extensions (M5.1)
  | { type: 'charge'; playerId: number; moveId: string }
  | { type: 'recast'; playerId: number; moveId: string }
  | { type: 'channel'; playerId: number; moveId: string; time: number }
  | { type: 'blink'; playerId: number; moveId: string; from: Vec2; to: Vec2; swapWith: number }
  | { type: 'grab'; playerId: number; moveId: string; caught: boolean }
  | { type: 'release'; playerId: number; thrown: boolean }
  | { type: 'banish'; playerId: number; by: number }
  | { type: 'guardian'; playerId: number; moveId: string; pos: Vec2; radius: number; time: number; color: string }
  | { type: 'ring'; playerId: number; moveId: string; pos: Vec2; radius: number; color: string }
  | { type: 'rescue'; playerId: number; by: number; from: Vec2; to: Vec2 }
  | { type: 'unbanish'; playerId: number; pos: Vec2 }
  | { type: 'guardBreak'; playerId: number }
  | { type: 'passive'; playerId: number }
  // Boosts (M5.6)
  | { type: 'draftStart'; kind: 'start' | 'set'; offers: string[]; order: number[] }
  | { type: 'boostPick'; playerId: number; boostId: string; auto: boolean }
  | { type: 'draftEnd' }
  | { type: 'sturdy'; playerId: number; pos: Vec2 }
  | {
      type: 'telegraph';
      playerId: number;
      moveId: string;
      shape: 'circle' | 'cone' | 'line';
      pos: Vec2;
      dir: Vec2;
      radius: number;
      angleDeg: number;
      length: number;
      width: number;
      /** Seconds until it fires. */
      time: number;
      color: string;
    };
