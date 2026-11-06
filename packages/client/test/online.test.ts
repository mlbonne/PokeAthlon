import { describe, expect, it } from 'vitest';
import { itemsFor } from '@pokeathlon/data';
import { resolveRoomLineup, SEAT_ROLES } from '../src/online';

describe('online room lineup (M7.3)', () => {
  it('fills CPU picks without duplicates in a team and gives every seat a valid item', () => {
    const picks = [
      { pokemon: 'pikachu', item: 'auto' },
      { pokemon: 'auto', item: 'auto' },
      { pokemon: 'auto', item: 'auto' },
      { pokemon: 'pikachu', item: 'auto' },
      { pokemon: 'auto', item: 'auto' },
      { pokemon: 'auto', item: 'auto' },
    ];
    for (let seed = 1; seed < 40; seed++) {
      const l = resolveRoomLineup(picks, 'normal', seed);
      expect(l).toHaveLength(6);
      for (const team of [0, 1]) {
        const ids = l.filter((s) => s.team === team).map((s) => s.pokemonId);
        expect(new Set(ids).size).toBe(3);
      }
      l.forEach((s, i) => {
        expect(s.team).toBe(i < 3 ? 0 : 1);
        expect(itemsFor(SEAT_ROLES[i]!).some((it) => it.id === s.item)).toBe(true);
        expect(s.role === 'goalie').toBe(SEAT_ROLES[i] === 'goalie');
      });
      expect(l[0]!.pokemonId).toBe('pikachu');
    }
  });

  it('keeps a chosen item that fits the role and replaces one that does not', () => {
    const fwd = itemsFor('forward')[1]!.id;
    const goalieItem = itemsFor('goalie')[0]!.id;
    const picks = Array.from({ length: 6 }, () => ({ pokemon: 'auto', item: 'auto' }));
    picks[0] = { pokemon: 'lucario', item: fwd };
    picks[1] = { pokemon: 'bronzong', item: goalieItem }; // a forward seat
    const l = resolveRoomLineup(picks, 'hard', 3);
    expect(l[0]!.item).toBe(fwd);
    expect(itemsFor('forward').some((it) => it.id === l[1]!.item)).toBe(true);
  });
});
