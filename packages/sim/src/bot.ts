import { gameplay } from '@pokeathlon/data';
import { Button, NEUTRAL_INPUT, quantizeInput, type PlayerInput } from './input';
import type { Vec2 } from './vec';
import type { World } from './world';

/**
 * A simple, deterministic opponent (good enough for M2 1v1s and full-match tests; M4 replaces it).
 * - Attacking: get behind the ball relative to the target and Strike it at the target.
 *   The target is the nearest standing enemy barrier, else the enemy goal.
 * - Defending: if the ball is heading for our goal on our half, cut it off.
 * - Energy Burst when full and an enemy is close.
 */
export function botInput(world: World, id: number): PlayerInput {
  const p = world.players[id];
  const b = world.ball;
  if (!p || p.koTicks > 0 || b.scored) return NEUTRAL_INPUT;

  const enemy = (p.team === 0 ? 1 : 0) as 0 | 1;
  const ownGoal = world.stage.goals[p.team];
  const enemyGoal = world.stage.goals[enemy];

  // Target: closest standing barrier in front of the enemy goal, else the goal itself.
  let target: Vec2 = { x: enemyGoal.score.x, y: 0 };
  let best = Infinity;
  for (const bar of world.barriers) {
    if (!bar.alive || bar.team !== enemy) continue;
    const d = (bar.box.x - b.pos.x) ** 2 + (bar.box.y - b.pos.y) ** 2;
    if (d < best) {
      best = d;
      target = { x: bar.box.x, y: bar.box.y };
    }
  }
  const tx = target.x - b.pos.x;
  const ty = target.y - b.pos.y;
  const tl = Math.sqrt(tx * tx + ty * ty) || 1;
  const aim = { x: tx / tl, y: ty / tl };

  // Where to stand: behind the ball on the line to the target.
  let goal: Vec2 = { x: b.pos.x - aim.x * p.strikeRadius * 0.7, y: b.pos.y - aim.y * p.strikeRadius * 0.7 };

  // Defend: ball on our half and moving towards our goal.
  const towardOwn = ownGoal.side * b.vel.x;
  if (ownGoal.side * b.pos.x > 0 && towardOwn > 300) {
    goal = { x: (b.pos.x + ownGoal.mouthX) / 2, y: b.pos.y * 0.5 };
  }

  const mx = goal.x - p.pos.x;
  const my = goal.y - p.pos.y;
  const ml = Math.sqrt(mx * mx + my * my);
  const move = ml > 20 ? { x: mx / ml, y: my / ml } : { x: 0, y: 0 };

  let buttons = 0;
  const dx = b.pos.x - p.pos.x;
  const dy = b.pos.y - p.pos.y;
  const reach = p.strikeRadius + b.radius * gameplay.strike.reachBallFraction - 5;
  if (p.strikeCooldown === 0 && dx * dx + dy * dy <= reach * reach) buttons |= Button.Strike;

  // Energy Burst when full and an enemy is within reach (press on alternate ticks for edge detection).
  if (p.energy >= gameplay.energy.max && (p.prevButtons & Button.Evade) === 0) {
    const near = world.players.some(
      (o) => o.team !== p.team && o.koTicks === 0 && (o.pos.x - p.pos.x) ** 2 + (o.pos.y - p.pos.y) ** 2 < gameplay.burst.radius ** 2,
    );
    if (near) buttons |= Button.Evade;
  }

  return quantizeInput(move.x, move.y, aim.x, aim.y, buttons);
}
