import { describe, expect, it } from 'vitest';
import { DEFAULT_TERRAIN, getTerrain, terrains } from '../src/rules';

describe('stages (M6)', () => {
  it('Pokémon Stadium is the default stage and uses the stadium art set', () => {
    expect(DEFAULT_TERRAIN).toBe('pokemon-stadium');
    expect(getTerrain(DEFAULT_TERRAIN).theme).toBe('stadium');
  });

  it('Pokémon Stadium plays exactly like Viridian Pitch (neutral map, art only)', () => {
    const play = (id: string) => {
      const t = terrains[id]!;
      return { frame: t.frame, spawns: t.spawns, orbs: t.orbs, barriers: t.barriers };
    };
    expect(play('pokemon-stadium')).toEqual(play('viridian-pitch'));
  });

  it('stages without a theme fall back to the plain arena', () => {
    expect(getTerrain('viridian-pitch').theme).toBe('plain');
  });
});
