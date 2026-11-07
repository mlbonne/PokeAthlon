import { describe, expect, it } from 'vitest';
import { itemFor, levelOf, loadProfile, matchXp, recordMatch, totals } from '../src/profile';

describe('lobby profile', () => {
  it('levels need 100 XP more each time', () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelOf(99).level).toBe(1);
    expect(levelOf(100)).toEqual({ level: 2, into: 0, need: 200 });
    expect(levelOf(350)).toEqual({ level: 3, into: 50, need: 300 });
  });

  it('defaults to a real Pokémon and the recommended item when storage is empty', () => {
    const p = loadProfile();
    expect(p.main).toBeTruthy();
    expect(itemFor(p, p.main, 'goalie')).toBe('auto');
    expect(totals(p).games).toBe(0);
  });

  it('records matches per Pokémon and role, and grants XP', () => {
    const p = loadProfile();
    const xp = recordMatch(p, { mon: 'pikachu', role: 'forward', won: true, goals: 2, kos: 1 });
    expect(xp).toBe(matchXp(true, 2, 1));
    recordMatch(p, { mon: 'pikachu', role: 'goalie', won: false, goals: 0, kos: 0 });
    recordMatch(p, { mon: 'bronzong', role: 'goalie', won: true, goals: 0, kos: 3 });
    expect(p.records.pikachu).toEqual({ games: 2, wins: 1, goals: 2, kos: 1, forward: 1, goalie: 1 });
    expect(totals(p)).toMatchObject({ games: 3, wins: 2, goals: 2, kos: 4 });
    expect(p.xp).toBe(matchXp(true, 2, 1) + matchXp(false, 0, 0) + matchXp(true, 0, 3));
  });
});
