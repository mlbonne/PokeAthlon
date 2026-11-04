import { gameplay, scaled } from '@pokeathlon/data';
import { applyHit } from './combat';
import { ticks } from './constants';
import { Button, type PlayerInput } from './input';
import { frozenPhase } from './match';
import type { Player, World } from './world';

const E = gameplay.evade;
const BU = gameplay.burst;
const MAX = gameplay.energy.max;

/**
 * Evade (1 bar): untargetable for 1.5 s. At a full meter (3 bars) the same button is an
 * Energy Burst: knock nearby enemies away, freeze and hold the ball briefly if it's close,
 * and boost your next ball hit by +50 % (knockback and cap). Triggers on button press.
 */
export function stepEnergy(world: World, p: Player, inp: PlayerInput | undefined): void {
  const pressed = !!inp && (inp.buttons & Button.Evade) !== 0 && (p.prevButtons & Button.Evade) === 0;
  p.prevButtons = inp?.buttons ?? 0;
  if (!pressed) return;
  if (p.koTicks > 0 || p.knockTicks > 0 || p.stunTicks > 0 || frozenPhase(world)) return;
  if (p.evadeCooldown > 0) return;

  if (p.energy >= MAX) burst(world, p);
  else if (p.energy >= E.cost) {
    p.energy -= E.cost;
    p.elusiveTicks = ticks(E.elusive);
    p.evadeCooldown = ticks(E.cooldown);
    world.events.push({ type: 'evade', playerId: p.id });
  }
}

function burst(world: World, p: Player): void {
  p.energy = 0;
  p.elusiveTicks = ticks(BU.elusive);
  p.evadeCooldown = ticks(E.cooldown);
  p.burstBoostTicks = ticks(BU.boostWindow);

  for (const o of world.players) {
    if (o.team === p.team || o.koTicks > 0) continue;
    const dx = o.pos.x - p.pos.x;
    const dy = o.pos.y - p.pos.y;
    const reach = BU.radius + o.hurtRadius;
    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach) continue;
    const d = Math.sqrt(d2);
    const dir = d > 1e-6 ? { x: dx / d, y: dy / d } : { x: p.facing.x, y: p.facing.y };
    applyHit(world, p.id, o, {
      dir,
      knockback: scaled(BU.playerKnockback, p.power),
      damage: scaled(BU.damage, p.power),
      stun: BU.stun,
    });
  }

  const b = world.ball;
  const dx = b.pos.x - p.pos.x;
  const dy = b.pos.y - p.pos.y;
  const reach = BU.radius + b.radius;
  const grabbed = !b.scored && dx * dx + dy * dy <= reach * reach;
  if (grabbed) {
    b.vel = { x: 0, y: 0 };
    b.launchVel = { x: 0, y: 0 };
    b.hitstop = 0;
    b.controlBy = p.id;
    b.controlTicks = ticks(BU.ballControl);
  }
  world.events.push({ type: 'burst', playerId: p.id, pos: { ...p.pos }, grabbedBall: grabbed });
}
