import { describe, expect, it } from 'vitest';
import { createWorld, parseLineup } from '@pokeathlon/sim';
import { accolades, setMvps } from '../src/results';

const world = () => createWorld(parseLineup('pikachu,lucario,snorlax/togekiss,machamp,blastoise'), { mode: 'match' });
const zero = { goals: 0, assists: 0, kos: 0, saves: 0, damageDealt: 0, shots: 0, redirects: 0, orbs: 0, deaths: 0 };

describe('results', () => {
  it('set MVPs: one forward and one goalie, from that set\'s numbers', () => {
    const w = world();
    const stats = w.players.map(() => ({ ...zero }));
    stats[1]!.goals = 2; // Lucario, forward
    stats[4]!.kos = 3; // Machamp, forward
    stats[5]!.saves = 6; // Blastoise, goalie
    expect(setMvps(w, stats)).toEqual({ forward: 1, goalie: 5 });
  });

  it('accolades: goals, goal streaks, KOs, saves, top damage', () => {
    const w = world();
    const t = w.telemetry.players;
    t[0]!.goals = 3;
    t[4]!.kos = 5;
    t[2]!.saves = 21;
    t[3]!.damageDealt = 9500;
    const a = accolades(w, [3, 0, 0, 0, 0, 0]);
    expect(a[0]).toEqual(expect.arrayContaining(['3 Goals', 'Triple Goal Streak']));
    expect(a[4]).toContain('5+ KOs');
    expect(a[2]).toEqual(expect.arrayContaining(['20+ Saves', 'Brick Wall']));
    expect(a[3]).toContain('Monstrous Damage');
    expect(a[1]).toEqual([]);
  });
});
