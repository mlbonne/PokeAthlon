import { gameplay, scaled } from '@pokeathlon/data';
import { hitBall } from './ball';
import { ticks } from './constants';
import { AXIS_MAX, Button, type PlayerInput } from './input';
import type { Player, World } from './world';

const COOLDOWN = ticks(gameplay.strike.cooldown);
const ACTIVE = ticks(gameplay.strike.activeTime);

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

  p.strikeConnected = true;
  hitBall(world, p.id, p.strikeDir, scaled(gameplay.strike.ballKnockback, p.power));
}
