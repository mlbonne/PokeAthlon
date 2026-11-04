import { z } from 'zod';
import gameplayJson from '../rules/gameplay.json' with { type: 'json' };
import viridianJson from '../stages/viridian-pitch.json' with { type: 'json' };

const pos = z.number().positive();
const Scaling = z.object({ base: z.number().nonnegative(), powerRatio: z.number().nonnegative() });

export const GameplayRules = z.object({
  movement: z.object({ accelTime: pos, decelTime: pos }),
  ball: z.object({
    radius: pos,
    /** Fraction of current speed lost per second (applied linearly per tick). */
    dragPerSecond: z.number().min(0).max(5),
    /** Constant deceleration, units/s². */
    linearDecel: z.number().nonnegative(),
    /** Below this speed the ball stops completely. */
    stopSpeed: z.number().nonnegative(),
    maxSpeed: pos,
    wallRestitution: z.number().min(0).max(1),
    playerRestitution: z.number().min(0).max(1),
    /** Freeze on hit before launch (impact feel), seconds. */
    hitstop: z.number().nonnegative(),
    /** Fraction of the ball's incoming speed added to a hit's launch speed. */
    momentumCarry: z.number().min(0).max(1),
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
