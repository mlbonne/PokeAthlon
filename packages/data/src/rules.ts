import { z } from 'zod';
import gameplayJson from '../rules/gameplay.json' with { type: 'json' };
import viridianJson from '../stages/viridian-pitch.json' with { type: 'json' };

const pos = z.number().positive();
const Scaling = z.object({ base: z.number().nonnegative(), powerRatio: z.number().nonnegative() });

export const GameplayRules = z.object({
  movement: z.object({ accelTime: pos, decelTime: pos }),
  /** The ball behaves like the OS Core (a sliding puck). */
  ball: z.object({
    radius: pos,
    /** Seconds for friction to halve the speed (OS: ~50 % lost per second → 1.0). */
    frictionHalfLife: pos,
    /** Below this speed the ball stops completely. */
    stopSpeed: z.number().nonnegative(),
    /** Max knockback a hit can apply (OS: 2000). Hits set speed = min(knockback, cap). */
    knockbackCap: pos,
    /** A hit whose direction has dot ≥ this with the current travel direction is a "redirect" (~90° cone → cos 45°). */
    redirectMinDot: z.number().min(-1).max(1),
    /** On redirect the ball keeps its speed and gains this fraction of the hit's knockback (OS: ~2.5 %). */
    redirectBonus: z.number().min(0).max(1),
    /** Each wall rebound changes speed by this much: + when slower than the pivot, − when faster (OS: ~100). */
    wallSpeedDelta: z.number().nonnegative(),
    wallSpeedPivot: pos,
    /** Hits above this knockback make a "Red Core" (OS: 1750). */
    redThreshold: pos,
    /** Red Core ignores friction for this long… */
    redDuration: z.number().nonnegative(),
    /** …while slower than this (OS: 2000). */
    redFrictionlessBelow: pos,
    /** Visual only: glow/trail above this speed (OS: 700). */
    glowSpeed: pos,
    /** Whether player bodies deflect the ball (OS: believed no). */
    bodyBlocking: z.boolean(),
    playerRestitution: z.number().min(0).max(1),
    /** Freeze on hit before launch (impact feel), seconds. */
    hitstop: z.number().nonnegative(),
  }),
  strike: z.object({
    cooldown: pos,
    activeTime: pos,
    ballKnockback: Scaling,
    /** How much of the ball radius counts toward Strike reach. */
    reachBallFraction: z.number().min(0).max(1),
  }),
});
export type GameplayRules = z.infer<typeof GameplayRules>;

const Point = z.object({ x: z.number(), y: z.number() });

export const StageDef = z.object({
  id: z.string(),
  name: z.string(),
  biome: z.string(),
  halfWidth: pos,
  halfHeight: pos,
  cornerCut: z.number().nonnegative(),
  goalHalfWidth: pos,
  barriersPerSide: z.number().int().min(1).max(5),
  spawns: z.object({
    ball: Point,
    team0: z.array(Point).length(3),
    team1: z.array(Point).length(3),
  }),
});
export type StageDef = z.infer<typeof StageDef>;

export const gameplay: GameplayRules = GameplayRules.parse(gameplayJson);
export const stages: Record<string, StageDef> = {
  'viridian-pitch': StageDef.parse(viridianJson),
};

export function getStage(id: string): StageDef {
  const s = stages[id];
  if (!s) throw new Error(`Unknown stage: ${id}`);
  return s;
}

/** Ability scaling: `base + powerRatio × power` (OS hit model). */
export const scaled = (s: { base: number; powerRatio: number }, power: number): number => s.base + s.powerRatio * power;
