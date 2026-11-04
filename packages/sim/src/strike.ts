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
 * Strike: the shared basic action (OS GA_Strike). It only affects the ball. The hit volume is a
 * circle centred on the player (diameter 250/265/285 by size) that stays active for 0.15 s;
 * it connects when it overlaps the ball. The ball is sent in the *aimed* direction, even if
 * it is slightly behind the player.
 *
 * Input (OS "Hold To Strike Mode"): pressing Strike always swings (a whiff still costs the
 * 0.9 s cooldown). Holding it auto-strikes the moment the ball comes into reach, so a held
 * button never whiffs.
 */
export function stepStrike(world: World, p: Player, inp: PlayerInput | undefined): void {
  if (p.strikeCooldown > 0) p.strikeCooldown--;
  if (p.strikeActive > 0) p.strikeActive--;
  if (p.koTicks > 0 || p.knockTicks > 0 || p.stunTicks > 0 || frozenPhase(world)) return;

  const held = !!inp && (inp.buttons & Button.Strike) !== 0;
  const pressed = held && (p.prevButtons & Button.Strike) === 0;
  const autoStrike = held && !pressed && gameplay.strike.holdToStrike && ballInReach(world, p);
  if (inp && (pressed || autoStrike) && p.strikeCooldown === 0) {
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

/** Can this player's Strike hit volume touch the ball right now? */
function ballInReach(world: World, p: Player): boolean {
  const b = world.ball;
  if (b.scored) return false;
  if (b.controlBy >= 0 && b.controlBy !== p.id) return false; // another player's Energy Burst owns it
  const dx = b.pos.x - p.pos.x;
  const dy = b.pos.y - p.pos.y;
  const reach = p.strikeRadius + b.radius * gameplay.strike.reachBallFraction;
  return dx * dx + dy * dy <= reach * reach;
}

function tryHitBall(world: World, p: Player): void {
  if (!ballInReach(world, p)) return;

  p.strikeConnected = true;
  hitBall(world, p.id, p.strikeDir, scaled(gameplay.strike.ballKnockback, p.power), 'strike');
  // Strike is a LIGHT hit for energy purposes (OS: +1).
  gainEnergy(p, gameplay.energy.lightHit);
  addXp(world, p, gameplay.xp.strikeBall);
}
