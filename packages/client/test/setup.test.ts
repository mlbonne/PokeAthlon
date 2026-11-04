import { describe, expect, it } from 'vitest';
import { createWorld } from '@pokeathlon/sim';
import { buildConfig, type Saved } from '../src/setup';

const base: Saved = { blue: ['pikachu', 'lucario', 'snorlax'], red: ['togekiss', '?', 'snorlax'], role: 'forward', diff: 'normal' };
const fixed = (id: string) => (id === '?' ? 'lucario' : id);

describe('match setup', () => {
  it('3v3 as a forward: you are player 0, one goalie per team, randoms resolved', () => {
    const c = buildConfig(base, 'play', fixed);
    expect(c.me).toBe(0);
    expect(c.lineup).toHaveLength(6);
    expect(c.lineup[0]).toMatchObject({ pokemonId: 'pikachu', team: 0, slot: 0 });
    expect(c.lineup.filter((s) => s.role === 'goalie').map((s) => s.team)).toEqual([0, 1]);
    expect(c.lineup[4]!.pokemonId).toBe('lucario');
    const w = createWorld(c.lineup, { mode: 'match' });
    expect(w.players.map((p) => p.role)).toEqual(['forward', 'forward', 'goalie', 'forward', 'forward', 'goalie']);
  });

  it('3v3 as the goalie: you take goal, both teammates play forward', () => {
    const c = buildConfig({ ...base, role: 'goalie' }, 'play', fixed);
    expect(c.lineup[0]).toMatchObject({ team: 0, role: 'goalie' });
    expect(c.lineup.slice(1, 3).every((s) => s.role !== 'goalie')).toBe(true);
    // Distinct forward spawn slots, so nobody spawns on top of each other.
    expect(new Set(c.lineup.slice(1, 3).map((s) => s.slot)).size).toBe(2);
  });

  it('spectate and practice', () => {
    expect(buildConfig(base, 'play', fixed).lineup).toHaveLength(6);
    const spec = buildConfig(base, 'spectate', fixed);
    expect(spec.me).toBe(-1);
    expect(spec.diff).toBe('hard');
    const pr = buildConfig(base, 'practice', fixed);
    expect(pr.practice).toBe(true);
    expect(pr.lineup).toHaveLength(2);
  });
});
