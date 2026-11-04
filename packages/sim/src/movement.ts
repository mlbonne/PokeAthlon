import { gameplay } from '@pokeathlon/data';
import { knockOut } from './combat';
import { DT } from './constants';
import { collideBox, collideCircle, collideSegment, pointInPolygon } from './geometry';
import { AXIS_MAX, type PlayerInput } from './input';
import { frozenPhase } from './match';
import { effectiveSpeed, stepDash } from './moves';
import { approach, clampLen, type Vec2 } from './vec';
import type { Player, World } from './world';

/** Bounciness of a knocked player hitting posts, gates or barriers. */
const KNOCK_RESTITUTION = 0.3;

export function stepMovement(world: World, p: Player, inp: PlayerInput | undefined): void {
  if (p.koTicks > 0) return;

  if (p.knockTicks > 0) {
    stepKnock(world, p);
    return;
  }

  if (p.dash) {
    stepDash(world, p);
    for (const s of world.stage.playerWalls) collideSegment(p.pos, p.vel, p.radius, s, 0);
    collideTerrain(world, p, 0);
    return;
  }

  const frozen = frozenPhase(world) || p.stunTicks > 0;
  const raw: Vec2 = !frozen && inp ? { x: inp.moveX / AXIS_MAX, y: inp.moveY / AXIS_MAX } : { x: 0, y: 0 };
  const dir = clampLen(raw, 1);
  const top = effectiveSpeed(p);
  const speed = top * (p.slowTicks > 0 ? 1 - gameplay.knock.lightSlow : 1);
  const target = { x: dir.x * speed, y: dir.y * speed };
  const moving = dir.x !== 0 || dir.y !== 0;
  const rate = top / (moving ? gameplay.movement.accelTime : gameplay.movement.decelTime);
  p.vel = frozen && frozenPhase(world) ? { x: 0, y: 0 } : approach(p.vel, target, rate * DT);
  p.pos = { x: p.pos.x + p.vel.x * DT, y: p.pos.y + p.vel.y * DT };
  if (moving && p.strikeActive === 0) {
    const l = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
    p.facing = { x: dir.x / l, y: dir.y / l };
  }

  // Walking can't take you off the arena: the outline is a wall.
  for (const s of world.stage.playerWalls) collideSegment(p.pos, p.vel, p.radius, s, 0);
  collideTerrain(world, p, 0);
}

/** Knockback slide: control is lost and the arena outline is NOT a wall. Leaving it = KO. */
function stepKnock(world: World, p: Player): void {
  p.pos = { x: p.pos.x + p.knockVel.x * DT, y: p.pos.y + p.knockVel.y * DT };
  collideTerrain(world, p, KNOCK_RESTITUTION, p.knockVel);
  const s = Math.sqrt(p.knockVel.x * p.knockVel.x + p.knockVel.y * p.knockVel.y);
  const next = Math.max(0, s - p.knockDecel);
  const k = s > 0 ? next / s : 0;
  p.knockVel = { x: p.knockVel.x * k, y: p.knockVel.y * k };
  p.knockTicks--;
  if (p.knockTicks === 0) p.knockVel = { x: 0, y: 0 };

  if (world.match.rulesEnabled && !pointInPolygon(p.pos, world.stage.playerOutline)) knockOut(world, p);
}

/** Solid terrain for players: goal posts, closed gates, standing barriers, creation walls. */
function collideTerrain(world: World, p: Player, restitution: number, vel: Vec2 = p.vel): void {
  for (const c of world.stage.posts) collideCircle(p.pos, vel, p.radius, c, restitution);
  for (const g of world.gates) {
    if (!g.open) collideBox(p.pos, vel, p.radius, world.stage.goals[g.team].gate, restitution);
  }
  for (const b of world.barriers) if (b.alive) collideBox(p.pos, vel, p.radius, b.box, restitution);
  for (const c of world.creations) {
    collideSegment(p.pos, vel, p.radius + c.r, { ax: c.a.x, ay: c.a.y, bx: c.b.x, by: c.b.y }, restitution);
  }
}
