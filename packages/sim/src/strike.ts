import { gameplay, scaled } from '@pokeathlon/data';
import { ticks } from './constants';
import { AXIS_MAX, Button, type PlayerInput } from './input';
import type { Player, World } from './world';

const COOLDOWN = ticks(gameplay.strike.cooldown);
const ACTIVE = ticks(gameplay.strike.activeTime);
const HITSTOP = ticks(gameplay.ball.hitstop);

/**
 * Strike: the shared basic action. It only affects the ball (OS rule). The hitbox is a circle
 * around the player that stays active briefly. The ball is sent in the *aimed* direction,
 * even if it is slightly behind the player.
 */
export function stepStrike(world: World, p: Player, inp: PlayerInput | undefined): void {
  if (p.strikeCooldown > 0) p.strikeCooldown--;
  if (p.strikeActive > 0) p.strikeActive--;

  if (inp && (inp.buttons & Button.Strike) !== 0 && p.strikeCooldown === 0) {
    const ax = inp.aimX / AXIS_MAX;
    const ay = inp.aimY / AXIS_MAX;
    const al = Math.sqrt(ax * ax + ay * ay);
    p.strikeDir = al > 0.05 ? { x: ax / al, y: ay / al } : { x: p.facing.x, y: p.facing.y };
    p.facing = { x: p.strikeDir.x, y: p.strikeDir.y };
    p.strikeCooldown = COOLDOWN;
    p.strikeActive = ACTIVE;
    p.strikeConnected = false;
    world.events.push({ type: 'strike', playerId: p.id, dir: { ...p.strikeDir } });
  }

  if (p.strikeActive > 0 && !p.strikeConnected) tryHitBall(world, p);
}

function tryHitBall(world: World, p: Player): void {
  const b = world.ball;
  const dx = b.pos.x - p.pos.x;
  const dy = b.pos.y - p.pos.y;
  const reach = p.strikeRadius + b.radius * gameplay.strike.reachBallFraction;
  if (dx * dx + dy * dy > reach * reach) return;

  // Speed the ball already has: from a pending launch if it is mid-hitstop.
  const cur = b.hitstop > 0 ? b.launchVel : b.vel;
  const incoming = Math.sqrt(cur.x * cur.x + cur.y * cur.y);
  const speed = Math.min(
    gameplay.ball.maxSpeed,
    scaled(gameplay.strike.ballKnockback, p.power) + incoming * gameplay.ball.momentumCarry,
  );

  p.strikeConnected = true;
  b.launchVel = { x: p.strikeDir.x * speed, y: p.strikeDir.y * speed };
  b.vel = { x: 0, y: 0 };
  // +1: the ball steps later in this same tick, which consumes one hitstop tick immediately.
  b.hitstop = HITSTOP + 1;
  b.lastHitBy = p.id;
  world.events.push({ type: 'ballHit', playerId: p.id, pos: { ...b.pos }, speed });
}
