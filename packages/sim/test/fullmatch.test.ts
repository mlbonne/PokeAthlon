import { describe, expect, it } from 'vitest';
import { botInput, createWorld, step, TICK_RATE, type PlayerSpawn, type SimEvent } from '../src/index';

function playMatch(lineup: PlayerSpawn[], maxMinutes: number) {
  const w = createWorld(lineup, { mode: 'match' });
  const counts: Record<string, number> = {};
  const limit = TICK_RATE * 60 * maxMinutes;
  while (w.match.phase !== 'matchOver' && w.tick < limit) {
    step(w, w.players.map((p) => botInput(w, p.id)));
    for (const e of w.events as SimEvent[]) counts[e.type] = (counts[e.type] ?? 0) + 1;
  }
  return { w, counts, minutes: w.tick / TICK_RATE / 60 };
}

describe('full match (bots)', () => {
  it('a 1v1 bot match is played to a winner', () => {
    const { w, counts, minutes } = playMatch(
      [
        { pokemonId: 'pikachu', team: 0 },
        { pokemonId: 'machamp', team: 1 },
      ],
      30,
    );
    expect(w.match.phase).toBe('matchOver');
    expect(minutes).toBeLessThan(20);
    expect(counts.barrierBreak).toBeGreaterThan(0);
    expect(counts.gateOpen).toBeGreaterThan(0);
    expect(counts.goal).toBeGreaterThanOrEqual(4);
  });

  it('a 3v3 bot match is played to a winner', () => {
    const { w, counts, minutes } = playMatch(
      [
        { pokemonId: 'pikachu', team: 0, slot: 0 },
        { pokemonId: 'lucario', team: 0, slot: 1 },
        { pokemonId: 'snorlax', team: 0, role: 'goalie' },
        { pokemonId: 'greninja', team: 1, slot: 0 },
        { pokemonId: 'machamp', team: 1, slot: 1 },
        { pokemonId: 'blastoise', team: 1, role: 'goalie' },
      ],
      30,
    );
    expect(w.match.phase).toBe('matchOver');
    expect(minutes).toBeLessThan(20);
    expect(counts.hit).toBeGreaterThan(0); // Energy Bursts land
  });
});
