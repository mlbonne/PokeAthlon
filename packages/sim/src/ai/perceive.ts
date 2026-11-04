import { gameplay, scaled } from '@pokeathlon/data';
import { predictBall, type BallPrediction } from '../ball';
import { TICK_RATE } from '../constants';
import { effectiveSpeed } from '../moves';
import type { Team } from '../stage';
import { normalize, type Vec2 } from '../vec';
import type { Player, World } from '../world';

/**
 * What every bot sees this tick (A1): the ball's path on its own, and how soon each player can
 * reach it. Computed once per tick and shared (cached per world + tick); a pure function of the
 * world, so it never breaks determinism.
 */
export interface Perception {
  tick: number;
  pred: BallPrediction;
  /** Ball position `t` ticks from now (t = 0: now). Clamped to the end of the prediction. */
  ballAt(t: number): Vec2;
  /** Per player: earliest tick they can touch the ball, and where. Infinity if they can't. */
  intercept: { t: number; pos: Vec2 }[];
}

/** Longest look-ahead any difficulty uses. */
export const MAX_LOOKAHEAD = 120;
/** Margin inside the Strike reach a bot aims for (units). */
const REACH_MARGIN = 12;

const cache = new WeakMap<World, Perception>();

/** Events after which last tick's ball prediction no longer holds. */
const INVALIDATES = new Set(['ballHit', 'ballStun', 'burst', 'wall', 'kickoff', 'goal', 'play', 'overtime']);

export function perceive(world: World): Perception {
  const hit = cache.get(world);
  if (hit && hit.tick === world.tick) return hit;
  const b = world.ball;
  const pred = b.scored ? { path: [], goalAgainst: -1 as const, ticks: 0, barriersBroken: [] } : reusePrediction(world, hit) ?? predictBall(world, MAX_LOOKAHEAD);
  const ballAt = (t: number): Vec2 => (t <= 0 || pred.path.length === 0 ? b.pos : pred.path[Math.min(t, pred.path.length) - 1]!);
  const intercept = world.players.map((p) => interceptFor(world, p, ballAt, pred.path.length));
  const perc: Perception = { tick: world.tick, pred, ballAt, intercept };
  cache.set(world, perc);
  return perc;
}

/**
 * Nobody but the players touches the ball, and players only change it through the events above,
 * so an untouched ball follows last tick's prediction exactly: shift it by one tick instead of
 * re-simulating (keeps headless batches fast). Re-simulate when it gets short.
 */
function reusePrediction(world: World, prev: Perception | undefined): BallPrediction | null {
  if (!prev || prev.tick !== world.tick - 1 || prev.pred.path.length < MAX_LOOKAHEAD / 2) return null;
  if (world.events.some((e) => INVALIDATES.has(e.type)) || world.creations.length > 0) return null;
  const q = prev.pred.path[0];
  if (!q || q.x !== world.ball.pos.x || q.y !== world.ball.pos.y) return null;
  const p = prev.pred;
  const broken = p.barriersBroken.filter((i) => world.barriers[i]!.alive);
  return { path: p.path.slice(1), goalAgainst: p.goalAgainst, ticks: Math.max(0, p.ticks - 1), barriersBroken: broken };
}

/** Strike reach to the ball centre. */
export const strikeReach = (world: World, p: Player): number => p.strikeRadius + world.ball.radius * gameplay.strike.reachBallFraction;

function interceptFor(world: World, p: Player, ballAt: (t: number) => Vec2, n: number): { t: number; pos: Vec2 } {
  if (p.koTicks > 0 || world.ball.scored) return { t: Infinity, pos: world.ball.pos };
  const speed = effectiveSpeed(p) / TICK_RATE;
  const reach = strikeReach(world, p) - REACH_MARGIN;
  // Can't act while knocked back / stunned: count that time as lost.
  const lost = Math.max(p.knockTicks, p.stunTicks);
  for (let t = 0; t <= n; t++) {
    const q = ballAt(t);
    const d = Math.sqrt((q.x - p.pos.x) ** 2 + (q.y - p.pos.y) ** 2) - reach;
    if (d <= speed * Math.max(0, t - lost)) return { t, pos: q };
  }
  // Ball still moving at the end: estimate from its last known spot.
  const q = ballAt(n);
  const d = Math.sqrt((q.x - p.pos.x) ** 2 + (q.y - p.pos.y) ** 2) - reach;
  return { t: n + lost + d / Math.max(1e-6, speed), pos: q };
}

/** Speed the ball leaves at if `p` hits it with `kb` knockback in direction `dir` (OS Core rules, as hitBall). */
export function launchSpeed(world: World, p: Player, kb: number, dir: Vec2, ballVel: Vec2): number {
  const B = gameplay.ball;
  let k = kb;
  let cap = B.knockbackCap;
  if (world.match.overtime) k *= gameplay.match.overtimeBallKnockback;
  if (p.burstBoostTicks > 0) {
    k *= gameplay.burst.boostMultiplier;
    cap *= gameplay.burst.boostMultiplier;
  }
  const capped = Math.min(k, cap);
  const cur = Math.sqrt(ballVel.x * ballVel.x + ballVel.y * ballVel.y);
  if (cur > capped && (dir.x * ballVel.x + dir.y * ballVel.y) / cur >= B.redirectMinDot) return cur + capped * B.redirectBonus;
  return capped;
}

export const strikeKnockback = (p: Player): number => scaled(gameplay.strike.ballKnockback, p.power);

/** A candidate direction for hitting the ball, and how good it is for `team`. */
export interface ShotEval {
  dir: Vec2;
  score: number;
  /** What it does: 'goal', 'barrier', 'pass', 'clear', 'advance', 'own-goal'. */
  kind: string;
}

const SHOT_LOOKAHEAD = 150;

/**
 * Score hitting the ball from `from` along `dir` at `speed` for `team` (A3 "Shoot / Pass / Clear"):
 * goals and broken enemy barriers are worth most, then progress toward the enemy goal; a path an
 * enemy can cut off early loses value; own goals and own barriers are heavily negative.
 */
export function evaluateShot(world: World, team: Team, from: Vec2, dir: Vec2, speed: number, passer = -1): ShotEval {
  const pred = predictBall(world, SHOT_LOOKAHEAD, { pos: from, vel: { x: dir.x * speed, y: dir.y * speed } });
  const enemy: Team = team === 0 ? 1 : 0;
  const enemySide = world.stage.goals[enemy].side;
  const n = pred.path.length;
  const end = n ? pred.path[n - 1]! : from;
  let score = 0;
  let kind = 'advance';
  // Ticks until the shot "pays off" (goal / barrier) — interceptions after that don't matter.
  let payoff = n;
  if (pred.goalAgainst === enemy) {
    score += 120 - pred.ticks * 0.25;
    kind = 'goal';
    payoff = pred.ticks;
  } else if (pred.goalAgainst === team) {
    return { dir, score: -300, kind: 'own-goal' };
  }
  for (const i of pred.barriersBroken) {
    if (world.barriers[i]!.team === enemy) {
      score += 45;
      if (kind === 'advance') kind = 'barrier';
    } else score -= 70;
  }
  // Progress toward the enemy goal (≈ ±45 over the whole pitch).
  score += ((end.x - from.x) * enemySide) / 60;
  // Ending near our own goal is dangerous.
  const ownSide = world.stage.goals[team].side;
  if (end.x * ownSide > world.stage.halfLength * 0.55) score -= 25;

  // Interceptions: the earliest an enemy (or a teammate, for passes) reaches the path.
  let enemyCut = Infinity;
  let mateCut = Infinity;
  for (const o of world.players) {
    if (o.koTicks > 0 || o.id === passer) continue;
    const spd = effectiveSpeed(o) / TICK_RATE;
    const reach = strikeReach(world, o);
    for (let t = 2; t < Math.min(n, payoff + 1); t += 2) {
      const q = pred.path[t]!;
      if (Math.sqrt((q.x - o.pos.x) ** 2 + (q.y - o.pos.y) ** 2) - reach <= spd * t) {
        if (o.team === team) mateCut = Math.min(mateCut, t);
        else enemyCut = Math.min(enemyCut, t);
        break;
      }
    }
  }
  if (enemyCut < payoff) {
    // Cut off early = mostly wasted; late = only a small loss.
    const early = Math.max(0, 1 - enemyCut / 90);
    score -= (kind === 'goal' ? 70 : kind === 'barrier' ? 30 : 15) * (0.4 + 0.6 * early);
  }
  if (mateCut < enemyCut && mateCut < 70 && kind === 'advance') {
    score += 18;
    kind = 'pass';
  }
  if (kind === 'advance' && ((end.x - from.x) * enemySide < 0 || from.x * ownSide > 0)) kind = 'clear';
  return { dir, score, kind };
}

/** Candidate Strike directions from `from` for `team`: goal mouth, enemy barriers, bank shots, teammates, clears. */
export function shotCandidates(world: World, team: Team, from: Vec2, self: number): Vec2[] {
  const enemy: Team = team === 0 ? 1 : 0;
  const g = world.stage.goals[enemy];
  const own = world.stage.goals[team];
  const targets: Vec2[] = [];
  const postY = Math.abs(g.posts[0]!.y);
  const gateOpen = world.gates[enemy].open;
  for (const y of gateOpen ? [0, postY * 0.55, -postY * 0.55] : [0]) targets.push({ x: g.score.x, y });
  for (const bar of world.barriers) if (bar.alive && bar.team === enemy) targets.push({ x: bar.box.x, y: bar.box.y });
  // Bank shots: mirror each target across the side walls (ball centre bounces at ±(wall − r)).
  const wallY = ballWallY(world) - world.ball.radius;
  const direct = targets.length;
  for (let i = 0; i < direct; i++) {
    const t = targets[i]!;
    targets.push({ x: t.x, y: 2 * wallY - t.y }, { x: t.x, y: -2 * wallY - t.y });
  }
  for (const m of world.players) {
    if (m.team === team && m.id !== self && m.koTicks === 0) targets.push({ x: m.pos.x + m.vel.x * 0.4, y: m.pos.y + m.vel.y * 0.4 });
  }
  // Clears: up the sides, away from our goal.
  targets.push({ x: -own.side * 700, y: 850 }, { x: -own.side * 700, y: -850 });
  return targets.map((t) => normalize({ x: t.x - from.x, y: t.y - from.y }));
}

/** Best Strike (or ball-move) direction for player `p` hitting the ball at `from`. */
export function bestShot(world: World, p: Player, from: Vec2, ballVel: Vec2, kb: number): ShotEval {
  let best: ShotEval | null = null;
  for (const dir of shotCandidates(world, p.team, from, p.id)) {
    const e = evaluateShot(world, p.team, from, dir, launchSpeed(world, p, kb, dir, ballVel), p.id);
    if (!best || e.score > best.score) best = e;
  }
  return best!;
}

/** How close a player is to being KO'd by a hit: 0 (safe) … 1+ (one hit sends them off an edge). */
export function danger(world: World, p: Player): number {
  const edge = world.stage.halfWidth + 60 - Math.abs(p.pos.y);
  const stag = p.staggered ? 1 : 1 - p.stagger / Math.max(1, p.maxStagger);
  const push = p.staggered ? 900 : 300;
  return Math.max(0, (push / Math.max(60, edge)) * (0.4 + 0.6 * stag));
}

const wallYCache = new WeakMap<object, number>();
/** Distance from the centre line to the side walls the ball bounces off. */
export function ballWallY(world: World): number {
  let y = wallYCache.get(world.stage);
  if (y === undefined) {
    y = 0;
    for (const q of world.stage.ballOutline) if (Math.abs(q.x) < 900) y = Math.max(y, Math.abs(q.y));
    wallYCache.set(world.stage, y);
  }
  return y;
}
