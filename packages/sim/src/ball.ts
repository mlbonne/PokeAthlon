import { gameplay } from '@pokeathlon/data';
import { DT, ticks } from './constants';
import { circleOverlapsBox, collideBox, collideCircle, collideSegment } from './geometry';
import { scoreGoal } from './match';
import { addXp } from './progression';
import type { Vec2 } from './vec';
import type { World } from './world';

/**
 * The ball is a sliding puck that behaves like the Omega Strikers Core
 * (omegastrikers.wiki.gg/wiki/Core):
 *  - a hit SETS the speed to the hit's knockback (capped at 2000)…
 *  - …unless it redirects the puck within ~90° of its path while the puck is already faster:
 *    then it keeps its speed and gains ~2.5 % of the hit
 *  - friction halves the speed every second
 *  - each wall rebound nudges speed by ~100 towards a middle value
 *  - hits over 1750 make a "Red Core" that ignores friction (below 2000) for 1 s
 *  - overtime: +20 % knockback; Energy Burst: next hit +50 % knockback and cap
 */
const B = gameplay.ball;
/** Linearised per-tick retention for the configured half-life (IEEE-exact ops only). */
const FRICTION_PER_TICK = (Math.LN2 / B.frictionHalfLife) * DT;
const HITSTOP = ticks(B.hitstop);
const RED_TICKS = ticks(B.redDuration);
/** Ignore tiny bounces when emitting feedback events. */
const EVENT_MIN_IMPACT = 150;
/** Max ball travel per collision substep, as a fraction of its radius (prevents tunnelling). */
const SUBSTEP_FRACTION = 0.5;

/**
 * Apply a knockback hit to the ball. `dir` must be a unit vector.
 * The ball freezes for the hitstop, then launches. Returns the launch speed.
 */
export function hitBall(world: World, playerId: number, dir: Vec2, knockback: number, source = 'other'): number {
  const b = world.ball;
  const p = world.players[playerId];
  let kb = knockback;
  let cap = B.knockbackCap;
  if (world.match.overtime) kb *= gameplay.match.overtimeBallKnockback;
  const boosted = !!p && p.burstBoostTicks > 0;
  if (p && boosted) {
    kb *= gameplay.burst.boostMultiplier;
    cap *= gameplay.burst.boostMultiplier;
    p.burstBoostTicks = 0;
  }
  if (b.stunTicks > 0) return 0; // a stunned ball ignores knockback (OS)
  const cur = b.hitstop > 0 ? b.launchVel : b.vel;
  const curSpeed = Math.sqrt(cur.x * cur.x + cur.y * cur.y);
  const capped = Math.min(kb, cap);

  let speed = capped;
  let redirect = false;
  if (curSpeed > capped) {
    const dot = (dir.x * cur.x + dir.y * cur.y) / curSpeed;
    if (dot >= B.redirectMinDot) {
      speed = curSpeed + capped * B.redirectBonus;
      redirect = true;
    }
  }

  b.launchVel = { x: dir.x * speed, y: dir.y * speed };
  b.vel = { x: 0, y: 0 };
  // +1: the ball steps later in this same tick, which consumes one hitstop tick immediately.
  b.hitstop = HITSTOP + 1;
  b.lastHitBy = playerId;
  b.redTicks = kb > B.redThreshold ? RED_TICKS : 0;
  b.controlBy = -1;
  b.controlTicks = 0;
  if (p) p.lastBallTouchTick = world.tick;
  world.events.push({ type: 'ballHit', playerId, pos: { ...b.pos }, speed, redirect, red: b.redTicks > 0, boosted, source });
  return speed;
}

export function stepBall(world: World): void {
  const b = world.ball;
  if (b.scored) return;

  if (b.stunTicks > 0) {
    b.stunTicks--;
    return; // frozen in place
  }

  if (b.controlTicks > 0) {
    b.controlTicks--;
    if (b.controlTicks === 0) b.controlBy = -1;
    return; // held still by an Energy Burst
  }

  if (b.hitstop > 0) {
    b.hitstop--;
    if (b.hitstop === 0) {
      b.vel = { x: b.launchVel.x, y: b.launchVel.y };
      const s = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
      world.events.push({ type: 'ballLaunch', playerId: b.lastHitBy, speed: s });
    }
    return;
  }

  // Friction (skipped while a Red Core is still below its frictionless ceiling).
  const speed = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
  const red = b.redTicks > 0;
  if (red) b.redTicks--;
  if (speed > 0 && !(red && speed < B.redFrictionlessBelow)) {
    const next = speed - speed * FRICTION_PER_TICK;
    const k = next < B.stopSpeed ? 0 : next / speed;
    b.vel = { x: b.vel.x * k, y: b.vel.y * k };
  }

  // Move in substeps so a fast ball can't tunnel through thin barriers or gates.
  const travel = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y) * DT;
  const n = Math.max(1, Math.min(8, Math.ceil(travel / (b.radius * SUBSTEP_FRACTION))));
  for (let i = 0; i < n; i++) {
    b.pos = { x: b.pos.x + (b.vel.x * DT) / n, y: b.pos.y + (b.vel.y * DT) / n };
    collideBall(world);
    if (b.scored) return;
  }
}

function collideBall(world: World): void {
  const b = world.ball;
  const stage = world.stage;

  if (B.bodyBlocking) collideBodies(world);

  // Barriers: rebound and break.
  for (let i = 0; i < world.barriers.length; i++) {
    const bar = world.barriers[i]!;
    if (!bar.alive) continue;
    const impact = collideBox(b.pos, b.vel, b.radius, bar.box, 1);
    if (impact > 0 || circleOverlapsBox(b.pos, b.radius, bar.box)) breakBarrier(world, i);
  }

  // Walls, posts and closed gates: elastic rebound + OS speed nudge.
  let impact = 0;
  for (const s of stage.ballWalls) impact = Math.max(impact, collideSegment(b.pos, b.vel, b.radius, s, 1));
  for (const c of stage.posts) impact = Math.max(impact, collideCircle(b.pos, b.vel, b.radius, c, 1));
  for (const g of world.gates) {
    if (!g.open) impact = Math.max(impact, collideBox(b.pos, b.vel, b.radius, stage.goals[g.team].gate, 1));
  }
  for (const c of world.creations) {
    const seg = { ax: c.a.x, ay: c.a.y, bx: c.b.x, by: c.b.y };
    impact = Math.max(impact, collideSegment(b.pos, b.vel, b.radius + c.r, seg, 1));
  }
  if (impact > 0) {
    nudgeWallSpeed(b.vel);
    if (impact > EVENT_MIN_IMPACT) world.events.push({ type: 'ballWall', pos: { ...b.pos }, impact });
  }

  // Goals.
  for (const goal of stage.goals) {
    if (circleOverlapsBox(b.pos, b.radius, goal.score)) {
      scoreGoal(world, goal.team === 0 ? 1 : 0);
      return;
    }
  }
}

/** OS: each rebound changes speed by ~100, towards the pivot. */
function nudgeWallSpeed(vel: Vec2): void {
  const s = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
  if (s <= 0) return;
  const target = s < B.wallSpeedPivot ? s + B.wallSpeedDelta : Math.max(B.wallSpeedPivot, s - B.wallSpeedDelta);
  const k = target / s;
  vel.x *= k;
  vel.y *= k;
}

function breakBarrier(world: World, index: number): void {
  const bar = world.barriers[index]!;
  bar.alive = false;
  const by = world.ball.lastHitBy;
  const p = world.players[by];
  if (p && p.team !== bar.team) {
    p.stats.barriers++;
    addXp(world, p, gameplay.xp.barrier);
  }
  world.events.push({ type: 'barrierBreak', team: bar.team, index, pos: { x: bar.box.x, y: bar.box.y }, by });
  // Last barrier of a side gone → its gate opens after a short delay.
  if (!world.barriers.some((o) => o.alive && o.team === bar.team)) {
    const gate = world.gates[bar.team];
    if (!gate.open && gate.openTimer < 0) gate.openTimer = Math.max(1, ticks(gameplay.match.gateOpenDelay));
  }
}

function collideBodies(world: World): void {
  const b = world.ball;
  for (const p of world.players) {
    if (p.koTicks > 0) continue;
    const before = { x: b.vel.x - p.vel.x, y: b.vel.y - p.vel.y };
    const rel = { ...before };
    const hit = collideCircle(b.pos, rel, b.radius, { x: p.pos.x, y: p.pos.y, r: p.radius }, B.playerRestitution);
    if (hit > 0) {
      b.vel = { x: rel.x + p.vel.x, y: rel.y + p.vel.y };
      if (hit > EVENT_MIN_IMPACT) world.events.push({ type: 'ballBody', playerId: p.id, pos: { ...b.pos }, impact: hit });
    }
  }
}

/** Result of a ball-only look-ahead. */
export interface BallPrediction {
  /** Ball centre per tick (index 0 = after the first tick). */
  path: Vec2[];
  /** Team whose goal the ball enters within the look-ahead (−1 = none). */
  goalAgainst: -1 | 0 | 1;
  /** Ticks until that goal, or the full look-ahead. */
  ticks: number;
}

/**
 * Run the ball alone forward with the real physics (friction, walls, posts, gates, creations,
 * barriers) but no players, and report where it goes. Pure: the world is not changed.
 * Used by telemetry (shots/saves), the debug overlay and, later, the bots.
 */
export function predictBall(world: World, lookAhead: number): BallPrediction {
  const b = world.ball;
  const ghost: World = {
    ...world,
    players: [],
    ball: { ...b, pos: { ...b.pos }, vel: { ...b.vel }, launchVel: { ...b.launchVel }, lastHitBy: -1 },
    barriers: world.barriers.map((x) => ({ ...x })),
    gates: [{ ...world.gates[0] }, { ...world.gates[1] }],
    match: { ...world.match, phase: 'play', rulesEnabled: true, goals: [0, 0] },
    events: [],
  };
  const path: Vec2[] = [];
  for (let t = 0; t < lookAhead; t++) {
    for (const g of ghost.gates) {
      if (g.openTimer > 0 && --g.openTimer === 0) {
        g.open = true;
        g.openTimer = -1;
      }
    }
    stepBall(ghost);
    path.push({ ...ghost.ball.pos });
    if (ghost.ball.scored) {
      // goals[team] counts goals FOR team, so the goal is against the other one.
      return { path, goalAgainst: ghost.match.goals[0] > 0 ? 1 : 0, ticks: t + 1 };
    }
    if (ghost.ball.vel.x === 0 && ghost.ball.vel.y === 0 && ghost.ball.hitstop === 0 && ghost.ball.stunTicks === 0) break;
  }
  return { path, goalAgainst: -1, ticks: lookAhead };
}
