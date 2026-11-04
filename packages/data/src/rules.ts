import { z } from 'zod';
import gameplayJson from '../rules/gameplay.json' with { type: 'json' };
import frameStandardJson from '../stages/frame-standard.json' with { type: 'json' };
import viridianJson from '../stages/viridian-pitch.json' with { type: 'json' };

const pos = z.number().positive();
const nonneg = z.number().nonnegative();
const frac = z.number().min(0).max(1);
const Scaling = z.object({ base: nonneg, powerRatio: nonneg });

export const GameplayRules = z.object({
  unverified: z.array(z.string()),
  movement: z.object({ accelTime: pos, decelTime: pos }),
  /** The ball behaves like the OS Core (a sliding puck). */
  ball: z.object({
    radius: pos,
    /** Seconds for friction to halve the speed (OS: ~50 % lost per second → 1.0). */
    frictionHalfLife: pos,
    /** Below this speed the ball stops completely. */
    stopSpeed: nonneg,
    /** Max knockback a hit can apply (OS: 2000). Hits set speed = min(knockback, cap). */
    knockbackCap: pos,
    /** A hit whose direction has dot ≥ this with the current travel direction is a "redirect" (~90° cone → cos 45°). */
    redirectMinDot: z.number().min(-1).max(1),
    /** On redirect the ball keeps its speed and gains this fraction of the hit's knockback (OS: ~2.5 %). */
    redirectBonus: frac,
    /** Each wall rebound changes speed by this much: + when slower than the pivot, − when faster (OS: ~100). */
    wallSpeedDelta: nonneg,
    wallSpeedPivot: pos,
    /** Hits above this knockback make a "Red Core" (OS: 1750)… */
    redThreshold: pos,
    /** …that ignores friction for this long… */
    redDuration: nonneg,
    /** …while slower than this (OS: 2000). */
    redFrictionlessBelow: pos,
    /** Visual only: glow/trail above this speed (OS: 700). */
    glowSpeed: pos,
    /** Whether player bodies deflect the ball (OS: believed no). */
    bodyBlocking: z.boolean(),
    playerRestitution: frac,
    /** Freeze on hit before launch, seconds. OS: none (0) — the Core redirects instantly. */
    hitstop: nonneg,
  }),
  strike: z.object({
    cooldown: pos,
    activeTime: pos,
    ballKnockback: Scaling,
    /** How much of the ball radius counts toward Strike reach (OS: hit volume overlaps the Core → 1.0). */
    reachBallFraction: frac,
    /** OS "Hold To Strike Mode": holding Strike auto-strikes the moment the ball is in reach (no whiff). */
    holdToStrike: z.boolean(),
  }),
  /** Player knockback model. */
  knock: z.object({
    distancePerKnockback: pos,
    minTime: pos,
    maxTime: pos,
    timePerUnit: nonneg,
    /** Staggered targets take +254.5 % knockback (×3.545)… */
    staggeredKnockbackMultiplier: pos,
    /** …and 75 % less damage (×0.25). */
    staggeredDamageTaken: frac,
    /** Flat knockback reduction inside your own Goal Arc (OS: 125), not while Staggered. */
    goalArcResist: nonneg,
    /** Light hits slow by this fraction for this long (OS: 50 % for 0.25 s). */
    lightSlow: frac,
    lightSlowTime: nonneg,
  }),
  stagger: z.object({
    regenDelay: nonneg,
    regenDelayLight: nonneg,
    /** Fraction of max Stagger regenerated per second (OS: 4 %). */
    regenPerSecond: nonneg,
    staggeredRegenPerSecond: nonneg,
    staggeredRegenDelayOnHit: nonneg,
    /** Staggered ends when Stagger refills to this fraction (OS: 50 %). */
    recoverAt: frac,
  }),
  energy: z.object({ start: nonneg, max: pos, lightHit: nonneg, normalHit: nonneg }),
  evade: z.object({ cost: nonneg, cooldown: nonneg, elusive: nonneg, cancelsOnStrike: z.boolean() }),
  burst: z.object({
    radius: pos,
    playerKnockback: Scaling,
    damage: Scaling,
    elusive: nonneg,
    stun: nonneg,
    /** Seconds the bursting player holds exclusive control of a frozen ball. */
    ballControl: nonneg,
    /** The next ball hit within this window gets `boostMultiplier` knockback and cap. */
    boostWindow: nonneg,
    boostMultiplier: pos,
  }),
  respawn: z.object({ time: nonneg, immune: nonneg }),
  orbs: z.object({
    first: nonneg,
    interval: pos,
    radius: pos,
    healMin: frac,
    healMax: frac,
    xp: nonneg,
    energy: nonneg,
  }),
  xp: z.object({
    /** Cumulative XP needed for levels 1..10. */
    levelThresholds: z.array(nonneg).length(10),
    passivePerSecond: nonneg,
    strikeBall: nonneg,
    barrier: nonneg,
    goal: nonneg,
    assist: nonneg,
    takedown: nonneg,
    specialUnlockLevel: z.number().int().min(1).max(10),
  }),
  match: z.object({
    goalsPerSet: z.number().int().positive(),
    setsToWin: z.number().int().positive(),
    kickoff: nonneg,
    goalPause: nonneg,
    setPause: nonneg,
    overtimeAfter: pos,
    overtimeBallKnockback: pos,
    gateOpenDelay: nonneg,
    assistWindow: nonneg,
  }),
});
export type GameplayRules = z.infer<typeof GameplayRules>;

const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

/** Shared arena frame (walls, goals). Describes the +x half; mirrored for −x. */
export const FrameDef = z.object({
  id: z.string(),
  field: z.object({ sideY: pos, cornerStartX: pos, mouthX: pos, pocketHalfWidth: pos, backX: pos }),
  playerBounds: z.object({ sideY: pos, cornerStartX: pos, cornerSideY: pos, pocketBackX: pos }),
  goal: z.object({
    mouthX: pos,
    postY: pos,
    postRadius: pos,
    score: z.object({ x0: pos, x1: pos, halfWidth: pos }),
    gate: z.object({ x0: pos, x1: pos, halfWidth: pos }),
  }),
  goalArc: z.object({ centerX: pos, radiusX: pos, radiusY: pos }),
});
export type FrameDef = z.infer<typeof FrameDef>;

const Rect = z.object({ x: z.number(), y: z.number(), hx: pos, hy: pos });

/** Per-map terrain: spawns, orbs, barriers. Positions for team 0 (left); team 1 is the point mirror. */
export const TerrainDef = z.object({
  id: z.string(),
  name: z.string(),
  biome: z.string(),
  frame: z.string(),
  spawns: z.object({
    forwards: z.array(Point).length(2),
    goalie: Point,
    respawn: z.array(Point).min(1),
    ball: z.array(Point).min(1),
  }),
  orbs: z.object({ mid: z.array(Point).min(1), arc: z.array(Point).min(1) }),
  barriers: z.array(Rect).min(1),
});
export type TerrainDef = z.infer<typeof TerrainDef>;

export const gameplay: GameplayRules = GameplayRules.parse(gameplayJson);
export const frames: Record<string, FrameDef> = { standard: FrameDef.parse(frameStandardJson) };
export const terrains: Record<string, TerrainDef> = { 'viridian-pitch': TerrainDef.parse(viridianJson) };

export function getTerrain(id: string): TerrainDef {
  const t = terrains[id];
  if (!t) throw new Error(`Unknown stage: ${id}`);
  return t;
}
export function getFrame(id: string): FrameDef {
  const f = frames[id];
  if (!f) throw new Error(`Unknown frame: ${id}`);
  return f;
}

/** Ability scaling: `base + powerRatio × power` (OS hit model). */
export const scaled = (s: { base: number; powerRatio: number }, power: number): number => s.base + s.powerRatio * power;
