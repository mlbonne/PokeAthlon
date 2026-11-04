import { gameplay, getPokemon, getStage, SIZE_TABLE } from '@pokeathlon/data';
import { arenaFromStage, type Arena } from './arena';
import { stepBall } from './ball';
import type { SimEvent } from './events';
import type { PlayerInput } from './input';
import { stepMovement } from './movement';
import { stepStrike } from './strike';
import type { Vec2 } from './vec';

export interface Player {
  id: number;
  pokemonId: string;
  team: 0 | 1;
  pos: Vec2;
  vel: Vec2;
  /** Last movement or strike direction (unit). Used for sprite facing and default aim. */
  facing: Vec2;
  radius: number;
  /** Max move speed, world units per second. */
  speed: number;
  power: number;
  /** Strike reach (circle radius around the player). */
  strikeRadius: number;
  /** Ticks until Strike is ready again. */
  strikeCooldown: number;
  /** Ticks the current Strike hitbox stays active. */
  strikeActive: number;
  strikeDir: Vec2;
  /** The current Strike already connected with the ball. */
  strikeConnected: boolean;
}

export interface Ball {
  pos: Vec2;
  vel: Vec2;
  radius: number;
  /** Ticks of freeze left after a hit; `launchVel` is applied when it reaches 0. */
  hitstop: number;
  launchVel: Vec2;
  lastHitBy: number;
  /** Ticks left of Red Core friction immunity. */
  redTicks: number;
}

export interface World {
  tick: number;
  stageId: string;
  arena: Arena;
  players: Player[];
  ball: Ball;
  /** Events produced by the most recent step. */
  events: SimEvent[];
}

export interface PlayerSpawn {
  pokemonId: string;
  team: 0 | 1;
  pos: Vec2;
}

export function createWorld(spawns: PlayerSpawn[], stageId = 'viridian-pitch'): World {
  const stage = getStage(stageId);
  return {
    tick: 0,
    stageId,
    arena: arenaFromStage(stage),
    players: spawns.map((s, i) => makePlayer(i, s)),
    ball: {
      pos: { ...stage.spawns.ball },
      vel: { x: 0, y: 0 },
      radius: gameplay.ball.radius,
      hitstop: 0,
      launchVel: { x: 0, y: 0 },
      lastHitBy: -1,
      redTicks: 0,
    },
    events: [],
  };
}

function makePlayer(id: number, s: PlayerSpawn): Player {
  const p: Player = {
    id,
    pokemonId: '',
    team: s.team,
    pos: { x: s.pos.x, y: s.pos.y },
    vel: { x: 0, y: 0 },
    facing: { x: s.team === 0 ? 1 : -1, y: 0 },
    radius: 0,
    speed: 0,
    power: 0,
    strikeRadius: 0,
    strikeCooldown: 0,
    strikeActive: 0,
    strikeDir: { x: 1, y: 0 },
    strikeConnected: false,
  };
  applyPokemon(p, s.pokemonId);
  return p;
}

function applyPokemon(p: Player, pokemonId: string): void {
  const def = getPokemon(pokemonId);
  const size = SIZE_TABLE[def.stats.size];
  p.pokemonId = def.id;
  p.radius = size.radius;
  p.speed = def.stats.speed;
  p.power = def.stats.power;
  p.strikeRadius = size.strikeWidth / 2;
}

/** Swap a player's Pokémon in place (sandbox helper), keeping position. */
export function setPokemon(world: World, playerId: number, pokemonId: string): void {
  const p = world.players[playerId];
  if (p) applyPokemon(p, pokemonId);
}

/** Put the ball back on its spawn, at rest. */
export function resetBall(world: World): void {
  const b = world.ball;
  b.pos = { ...getStage(world.stageId).spawns.ball };
  b.vel = { x: 0, y: 0 };
  b.hitstop = 0;
  b.launchVel = { x: 0, y: 0 };
  b.lastHitBy = -1;
  b.redTicks = 0;
}

/**
 * Advance the world by one tick. `inputs[i]` belongs to `world.players[i]`;
 * missing entries count as neutral. Mutates and returns `world`.
 *
 * Order: movement → strikes → ball. Strikes see this tick's positions; the ball
 * moves last so a hit and its hitstop start on the same tick.
 */
export function step(world: World, inputs: readonly (PlayerInput | undefined)[]): World {
  world.events = [];
  for (const p of world.players) stepMovement(world, p, inputs[p.id]);
  for (const p of world.players) stepStrike(world, p, inputs[p.id]);
  stepBall(world);
  world.tick++;
  return world;
}
