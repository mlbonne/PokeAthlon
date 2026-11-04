import { gameplay } from '@pokeathlon/data';
import { confine } from './arena';
import { DT, ticks } from './constants';
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
 */
const B = gameplay.ball;
/** Linearised per-tick retention for the configured half-life (IEEE-exact ops only). */
const FRICTION_PER_TICK = (Math.LN2 / B.frictionHalfLife) * DT;
const HITSTOP = ticks(B.hitstop);
const RED_TICKS = ticks(B.redDuration);
/** Ignore tiny bounces when emitting feedback events. */
const EVENT_MIN_IMPACT = 150;

/**
 * Apply a knockback hit to the ball. `dir` must be a unit vector.
 * The ball freezes for the hitstop, then launches. Returns the launch speed.
 */
export function hitBall(world: World, playerId: number, dir: Vec2, knockback: number): number {
  const b = world.ball;
  const cur = b.hitstop > 0 ? b.launchVel : b.vel;
  const curSpeed = Math.sqrt(cur.x * cur.x + cur.y * cur.y);
  const kb = Math.min(knockback, B.knockbackCap);

  let speed = kb;
  let redirect = false;
  if (curSpeed > kb) {
    const dot = (dir.x * cur.x + dir.y * cur.y) / curSpeed;
    if (dot >= B.redirectMinDot) {
      speed = curSpeed + kb * B.redirectBonus;
      redirect = true;
    }
  }

  b.launchVel = { x: dir.x * speed, y: dir.y * speed };
  b.vel = { x: 0, y: 0 };
  // +1: the ball steps later in this same tick, which consumes one hitstop tick immediately.
  b.hitstop = HITSTOP + 1;
  b.lastHitBy = playerId;
  b.redTicks = knockback > B.redThreshold ? RED_TICKS : 0;
  world.events.push({ type: 'ballHit', playerId, pos: { ...b.pos }, speed, redirect, red: b.redTicks > 0 });
  return speed;
}

export function stepBall(world: World): void {
  const b = world.ball;

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

  b.pos = { x: b.pos.x + b.vel.x * DT, y: b.pos.y + b.vel.y * DT };

  if (B.bodyBlocking) collideBodies(world);

  // Elastic rebound, then OS's speed nudge towards the middle.
  const impact = confine(b.pos, b.vel, b.radius, world.arena, 1);
  if (impact > 0) {
    const s = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
    if (s > 0) {
      const target = s < B.wallSpeedPivot ? s + B.wallSpeedDelta : Math.max(B.wallSpeedPivot, s - B.wallSpeedDelta);
      const k = target / s;
      b.vel = { x: b.vel.x * k, y: b.vel.y * k };
    }
    if (impact > EVENT_MIN_IMPACT) world.events.push({ type: 'ballWall', pos: { ...b.pos }, impact });
  }
}

function collideBodies(world: World): void {
  const b = world.ball;
  for (const p of world.players) {
    const dx = b.pos.x - p.pos.x;
    const dy = b.pos.y - p.pos.y;
    const min = b.radius + p.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    const nx = d > 0 ? dx / d : 1;
    const ny = d > 0 ? dy / d : 0;
    b.pos = { x: p.pos.x + nx * min, y: p.pos.y + ny * min };
    const rvx = b.vel.x - p.vel.x;
    const rvy = b.vel.y - p.vel.y;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const k = (1 + B.playerRestitution) * vn;
      b.vel = { x: b.vel.x - nx * k, y: b.vel.y - ny * k };
      if (-vn > EVENT_MIN_IMPACT) {
        world.events.push({ type: 'ballBody', playerId: p.id, pos: { ...b.pos }, impact: -vn });
      }
    }
  }
}
