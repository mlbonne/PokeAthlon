import { defaultItem, getPokemon } from '@pokeathlon/data';
import { getBrain, type Brain } from './ai/index';
import { TICK_RATE } from './constants';
import { hashWorld } from './hash';
import type { Telemetry } from './telemetry';
import { createWorld, step, type PlayerSpawn, type World, type WorldOptions } from './world';

/**
 * Run a whole bot-vs-bot match with no rendering (Node, tests, batch balance tools).
 * Pure function of (lineup, options): the same seed always returns the same result and hash.
 */
export interface HeadlessOptions extends Pick<WorldOptions, 'terrain'> {
  seed?: number;
  /** Stop after this much game time even without a winner (default 30 min). */
  maxMinutes?: number;
  /** Stop condition (default: the match is over). */
  until?: 'goal' | 'set' | 'match';
  /** Brain per team (default `v2`, the M4 brain at balance difficulty). See `BRAINS`. */
  brains?: [string, string];
  /** Boost drafts (default off). */
  boosts?: boolean;
}

export interface HeadlessResult {
  seed: number;
  /** Winning team, or -1 if the time limit hit first. */
  winner: 0 | 1 | -1;
  sets: [number, number];
  ticks: number;
  minutes: number;
  /** Final world hash (determinism checks). */
  hash: string;
  telemetry: Telemetry;
}

export function runHeadless(lineup: PlayerSpawn[], opts: HeadlessOptions = {}): HeadlessResult {
  const seed = opts.seed ?? 0;
  const w: World = createWorld(lineup, { mode: 'match', seed, boosts: !!opts.boosts, ...(opts.terrain ? { terrain: opts.terrain } : {}) });
  const limit = TICK_RATE * 60 * (opts.maxMinutes ?? 30);
  const until = opts.until ?? 'match';
  const done = (): boolean => {
    const m = w.match;
    if (m.phase === 'matchOver') return true;
    if (until === 'set') return m.sets[0] + m.sets[1] > 0;
    if (until === 'goal') return w.telemetry.goals[0] + w.telemetry.goals[1] > 0;
    return false;
  };
  const names = opts.brains ?? ['v2', 'v2'];
  const brains: [Brain, Brain] = [getBrain(names[0]), getBrain(names[1])];
  while (!done() && w.tick < limit) step(w, w.players.map((p) => brains[p.team](w, p.id)));
  return {
    seed,
    winner: w.match.winner,
    sets: [w.match.sets[0], w.match.sets[1]],
    ticks: w.tick,
    minutes: w.tick / TICK_RATE / 60,
    hash: hashWorld(w),
    telemetry: w.telemetry,
  };
}

/** Give every spawn without an item its archetype's default item for its slot (CPUs, quick play). */
export function withDefaultItems(lineup: PlayerSpawn[]): PlayerSpawn[] {
  return lineup.map((s) => (s.item ? s : { ...s, item: defaultItem(getPokemon(s.pokemonId).archetype, s.role === 'goalie' ? 'goalie' : 'forward').id }));
}

/**
 * Parse a lineup like `pikachu,lucario,bronzong/togekiss,lucario,bronzong` (team 0 / team 1).
 * In 3v3 the third Pokémon of each team is the goalie; 1v1 and 2v2 are all forwards.
 */
export function parseLineup(spec: string): PlayerSpawn[] {
  const teams = spec.split(/[/:]/).map((t) => t.split(',').map((s) => s.trim()).filter(Boolean));
  if (teams.length !== 2 || !teams[0]!.length || teams[0]!.length !== teams[1]!.length) {
    throw new Error(`Lineup must be two equal teams like "pikachu/lucario" or "a,b,c/d,e,f", got "${spec}"`);
  }
  return teams.flatMap((ids, team) =>
    ids.map((pokemonId, i) =>
      ids.length >= 3 && i === ids.length - 1
        ? { pokemonId, team: team as 0 | 1, role: 'goalie' as const }
        : { pokemonId, team: team as 0 | 1, slot: i },
    ),
  );
}
