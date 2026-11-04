import { getPokemon, SIZE_TABLE } from '@pokeathlon/data';
import { ACCEL_TIME, DECEL_TIME, DEFAULT_ARENA, DT } from './constants';
import { AXIS_MAX, type PlayerInput } from './input';
import { approach, clampLen, type Vec2 } from './vec';

export interface Arena {
  halfWidth: number;
  halfHeight: number;
  cornerCut: number;
}

export interface Player {
  id: number;
  pokemonId: string;
  team: 0 | 1;
  pos: Vec2;
  vel: Vec2;
  /** Last non-zero movement direction (unit-ish); used for sprite facing. */
  facing: Vec2;
  radius: number;
  /** Max move speed, world units per second. */
  speed: number;
}

export interface World {
  tick: number;
  arena: Arena;
  players: Player[];
}

export interface PlayerSpawn {
  pokemonId: string;
  team: 0 | 1;
  pos: Vec2;
}

export function createWorld(spawns: PlayerSpawn[], arena: Arena = DEFAULT_ARENA): World {
  return {
    tick: 0,
    arena: { ...arena },
    players: spawns.map((s, i) => makePlayer(i, s)),
  };
}

function makePlayer(id: number, s: PlayerSpawn): Player {
  const def = getPokemon(s.pokemonId);
  return {
    id,
    pokemonId: def.id,
    team: s.team,
    pos: { x: s.pos.x, y: s.pos.y },
    vel: { x: 0, y: 0 },
    facing: { x: s.team === 0 ? 1 : -1, y: 0 },
    radius: SIZE_TABLE[def.stats.size].radius,
    speed: def.stats.speed,
  };
}

/** Swap a player's Pokémon in place (sandbox helper), keeping position. */
export function setPokemon(world: World, playerId: number, pokemonId: string): void {
  const p = world.players[playerId];
  if (!p) return;
  const def = getPokemon(pokemonId);
  p.pokemonId = def.id;
  p.radius = SIZE_TABLE[def.stats.size].radius;
  p.speed = def.stats.speed;
}

/**
 * Advance the world by one tick. `inputs[i]` belongs to `world.players[i]`;
 * missing entries count as neutral. Mutates and returns `world`.
 */
export function step(world: World, inputs: readonly (PlayerInput | undefined)[]): World {
  for (const p of world.players) {
    const inp = inputs[p.id];
    stepMovement(p, inp);
    confineToArena(p, world.arena);
  }
  world.tick++;
  return world;
}

function stepMovement(p: Player, inp: PlayerInput | undefined): void {
  const raw: Vec2 = inp ? { x: inp.moveX / AXIS_MAX, y: inp.moveY / AXIS_MAX } : { x: 0, y: 0 };
  // Analog stick: magnitude up to 1; diagonals on keyboard normalised.
  const dir = clampLen(raw, 1);
  const target = { x: dir.x * p.speed, y: dir.y * p.speed };
  const moving = dir.x !== 0 || dir.y !== 0;
  const rate = p.speed / (moving ? ACCEL_TIME : DECEL_TIME);
  p.vel = approach(p.vel, target, rate * DT);
  p.pos = { x: p.pos.x + p.vel.x * DT, y: p.pos.y + p.vel.y * DT };
  if (moving) p.facing = { x: dir.x, y: dir.y };
}

/**
 * M0: keep players inside the arena polygon (rectangle with cut corners).
 * M2 replaces this with KO edges.
 */
function confineToArena(p: Player, a: Arena): void {
  const r = p.radius;
  const maxX = a.halfWidth - r;
  const maxY = a.halfHeight - r;
  if (p.pos.x > maxX) { p.pos.x = maxX; p.vel.x = Math.min(0, p.vel.x); }
  if (p.pos.x < -maxX) { p.pos.x = -maxX; p.vel.x = Math.max(0, p.vel.x); }
  if (p.pos.y > maxY) { p.pos.y = maxY; p.vel.y = Math.min(0, p.vel.y); }
  if (p.pos.y < -maxY) { p.pos.y = -maxY; p.vel.y = Math.max(0, p.vel.y); }

  // Corner cuts: the line |x| + |y| = halfWidth + halfHeight - cornerCut. Push inwards along (±1, ±1)/√2.
  const limit = a.halfWidth + a.halfHeight - a.cornerCut - r * Math.SQRT2;
  const sx = p.pos.x >= 0 ? 1 : -1;
  const sy = p.pos.y >= 0 ? 1 : -1;
  const over = sx * p.pos.x + sy * p.pos.y - limit;
  if (over > 0) {
    p.pos.x -= (sx * over) / 2;
    p.pos.y -= (sy * over) / 2;
    const vn = (sx * p.vel.x + sy * p.vel.y) / 2;
    if (vn > 0) {
      p.vel.x -= sx * vn;
      p.vel.y -= sy * vn;
    }
  }
}
