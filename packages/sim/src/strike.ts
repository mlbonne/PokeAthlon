import { gameplay, scaled } from '@pokeathlon/data';
import { hitBall } from './ball';
import { gainEnergy } from './combat';
import { ticks } from './constants';
import { AXIS_MAX, Button, type PlayerInput } from './input';
import { frozenPhase } from './match';
import { addXp } from './progression';
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
  if (p.koTicks > 0 || p.knockTicks > 0 || p.stunTicks > 0 || frozenPhase(world)) return;

  if (inp && (inp.buttons & Button.Strike) !== 0 && p.strikeCooldown === 0) {
    const ax = inp.aimX / AXIS_MAX;
    const ay = inp.aimY / AXIS_MAX;
    const al = Math.sqrt(ax * ax + ay * ay);
    p.strikeDir = al > 0.05 ? { x: ax / al, y: ay / al } : { x: p.facing.x, y: p.facing.y };
    p.facing = { x: p.strikeDir.x, y: p.strikeDir.y };
    p.strikeCooldown = COOLDOWN;
    p.strikeActive = ACTIVE;
    p.strikeConnected = false;
    // Casting cancels Evade's untargetability (OS: "using any ability ends it early").
    if (gameplay.evade.cancelsOnStrike) p.elusiveTicks = 0;
    world.events.push({ type: 'strike', playerId: p.id, dir: { ...p.strikeDir } });
  }

  if (p.strikeActive > 0 && !p.strikeConnected) tryHitBall(world, p);
}

function tryHitBall(world: World, p: Player): void {
  const b = world.ball;
  if (b.scored) return;
  if (b.controlBy >= 0 && b.controlBy !== p.id) return; // another player's Energy Burst owns it
  const dx = b.pos.x - p.pos.x;
  const dy = b.pos.y - p.pos.y;
  const reach = p.strikeRadius + b.radius * gameplay.strike.reachBallFraction;
  if (dx * dx + dy * dy > reach * reach) return;

  p.strikeConnected = true;
  hitBall(world, p.id, p.strikeDir, scaled(gameplay.strike.ballKnockback, p.power));
  // Strike is a LIGHT hit for energy purposes (OS: +1).
  gainEnergy(p, gameplay.energy.lightHit);
  addXp(world, p, gameplay.xp.strikeBall);
}
