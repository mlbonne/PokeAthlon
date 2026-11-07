import { describe, expect, it } from 'vitest';
import { getPokemon, roster } from '../src/index';

describe('roster', () => {
  it('has 9 unique pokemon', () => {
    expect(roster).toHaveLength(9);
    expect(new Set(roster.map((p) => p.id)).size).toBe(9);
    expect(new Set(roster.map((p) => p.dex)).size).toBe(9);
  });

  it('looks up by id', () => {
    expect(getPokemon('zeraora').dex).toBe('0807');
    expect(() => getPokemon('missingno')).toThrow();
  });
});
