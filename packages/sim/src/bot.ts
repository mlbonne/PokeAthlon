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

  // Moves: pick at most one per tick by its data hint; it overrides the aim for this tick.
  const cast = chooseMove(world, p.id, aim);
  if (cast) return quantizeInput(move.x, move.y, cast.aim.x, cast.aim.y, (buttons & ~Button.Strike) | cast.button, cast.dist);

  return quantizeInput(move.x, move.y, aim.x, aim.y, buttons);
}

const MOVE_BUTTONS = [Button.Move1, Button.Move2, Button.Signature] as const;

/** Bot move use, driven by each move's `bot` hint from the kit data. */
function chooseMove(world: World, id: number, shotAim: Vec2): { button: number; aim: Vec2; dist: number } | null {
  const p = world.players[id]!;
  if (p.cast || p.knockTicks > 0 || p.stunTicks > 0) return null;
  const b = world.ball;
  const d2 = (a: Vec2, c: Vec2) => (a.x - c.x) ** 2 + (a.y - c.y) ** 2;
  const dirTo = (q: Vec2) => {
    const l = Math.sqrt(d2(q, p.pos)) || 1;
    return { x: (q.x - p.pos.x) / l, y: (q.y - p.pos.y) / l };
  };
  const enemy = world.players
    .filter((o) => o.team !== p.team && o.koTicks === 0)
    .sort((a, c) => d2(a.pos, p.pos) - d2(c.pos, p.pos))[0];
  const ownGoal = world.stage.goals[p.team];

  for (let slot = 0; slot < p.moves.length; slot++) {
    const m = p.moves[slot]!;
    const bit = MOVE_BUTTONS[slot]!;
    if (m.cooldown > 0 || (p.prevButtons & bit) !== 0) continue;
    if (m.def.slot === 'special' && p.level < gameplay.xp.specialUnlockLevel) continue;
    const ballDist = Math.sqrt(d2(b.pos, p.pos));
    switch (m.def.bot) {
      case 'ballShot': {
        // Ball ahead and roughly on the line to our target: shoot it from range.
        const toBall = dirTo(b.pos);
        if (!b.scored && ballDist > 220 && ballDist < 650 && toBall.x * shotAim.x + toBall.y * shotAim.y > 0.9) {
          return { button: bit, aim: toBall, dist: 0 };
        }
        break;
      }
      case 'engage':
        if (enemy && d2(enemy.pos, p.pos) < 380 * 380) return { button: bit, aim: dirTo(enemy.pos), dist: 0 };
        break;
      case 'chase':
        if (!b.scored && ballDist > 800) return { button: bit, aim: dirTo(b.pos), dist: 0 };
        break;
      case 'defend':
        if (!b.scored && ownGoal.side * b.pos.x > 300 && ownGoal.side * b.vel.x > 500 && ballDist < 700) {
          return { button: bit, aim: dirTo(b.pos), dist: 0 };
        }
        break;
      case 'support': {
        // Heal a hurt teammate (or ourselves), otherwise drop it on a close enemy.
        const hurt = world.players.find((o) => o.team === p.team && o.koTicks === 0 && o.stagger < o.maxStagger * 0.6);
        if (hurt) return { button: bit, aim: dirTo(hurt.pos), dist: Math.max(1, Math.sqrt(d2(hurt.pos, p.pos))) };
        if (enemy && d2(enemy.pos, p.pos) < 600 * 600) return { button: bit, aim: dirTo(enemy.pos), dist: Math.sqrt(d2(enemy.pos, p.pos)) };
        break;
      }
    }
  }
  return null;
}
