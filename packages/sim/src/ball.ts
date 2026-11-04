import { gameplay } from '@pokeathlon/data';
import { confine } from './arena';
import { DT } from './constants';
import type { World } from './world';

const B = gameplay.ball;
const DRAG_PER_TICK = B.dragPerSecond * DT;
const DECEL_PER_TICK = B.linearDecel * DT;
/** Ignore tiny bounces when emitting feedback events. */
const EVENT_MIN_IMPACT = 150;

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

  // Friction: proportional drag + constant deceleration, then a dead-stop threshold.
  const speed = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
  if (speed > 0) {
    const next = Math.max(0, speed - speed * DRAG_PER_TICK - DECEL_PER_TICK);
    const k = next < B.stopSpeed ? 0 : next / speed;
    b.vel = { x: b.vel.x * k, y: b.vel.y * k };
  }

  b.pos = { x: b.pos.x + b.vel.x * DT, y: b.pos.y + b.vel.y * DT };

  // Bodies block the ball (goalies can save with their body).
  for (const p of world.players) {
    const dx = b.pos.x - p.pos.x;
    const dy = b.pos.y - p.pos.y;
    const min = b.radius + p.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    const nx = d > 0 ? dx / d : 1;
    const ny = d > 0 ? dy / d : 0;
    // Push the ball out of the body.
    b.pos = { x: p.pos.x + nx * min, y: p.pos.y + ny * min };
    // Reflect the relative velocity (players are treated as immovable).
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

  const impact = confine(b.pos, b.vel, b.radius, world.arena, B.wallRestitution);
  if (impact > EVENT_MIN_IMPACT) world.events.push({ type: 'ballWall', pos: { ...b.pos }, impact });

  // Clamp after collisions (body pushes can add speed).
  const s2 = b.vel.x * b.vel.x + b.vel.y * b.vel.y;
  if (s2 > B.maxSpeed * B.maxSpeed) {
    const k = B.maxSpeed / Math.sqrt(s2);
    b.vel = { x: b.vel.x * k, y: b.vel.y * k };
  }
}
