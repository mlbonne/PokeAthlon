import { gameplay } from '@pokeathlon/data';
import { confine } from './arena';
import { DT } from './constants';
import { AXIS_MAX, type PlayerInput } from './input';
import { approach, clampLen, type Vec2 } from './vec';
import type { Player, World } from './world';

export function stepMovement(world: World, p: Player, inp: PlayerInput | undefined): void {
  const raw: Vec2 = inp ? { x: inp.moveX / AXIS_MAX, y: inp.moveY / AXIS_MAX } : { x: 0, y: 0 };
  // Analog stick: magnitude up to 1; keyboard diagonals normalised.
  const dir = clampLen(raw, 1);
  const target = { x: dir.x * p.speed, y: dir.y * p.speed };
  const moving = dir.x !== 0 || dir.y !== 0;
  const rate = p.speed / (moving ? gameplay.movement.accelTime : gameplay.movement.decelTime);
  p.vel = approach(p.vel, target, rate * DT);
  p.pos = { x: p.pos.x + p.vel.x * DT, y: p.pos.y + p.vel.y * DT };
  // Facing follows movement unless a Strike is in progress.
  if (moving && p.strikeActive === 0) {
    const l = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
    p.facing = { x: dir.x / l, y: dir.y / l };
  }
  // M1: players slide along the arena edge. M2 turns edges into KO lines.
  confine(p.pos, p.vel, p.radius, world.arena, 0);
}
