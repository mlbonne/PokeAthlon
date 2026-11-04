import { describe, expect, it } from 'vitest';
import { getPokemon, roster } from '../src/index';

describe('roster', () => {
  it('has 8 unique pokemon', () => {
    expect(roster).toHaveLength(8);
    expect(new Set(roster.map((p) => p.id)).size).toBe(8);
    expect(new Set(roster.map((p) => p.dex)).size).toBe(8);
  });

  it('looks up by id', () => {
    expect(getPokemon('pikachu').dex).toBe('0025');
    expect(() => getPokemon('missingno')).toThrow();
  });
});
