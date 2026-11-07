import { describe, expect, it } from 'vitest';
import { getPokemon, roster } from '../src/index';

describe('roster', () => {
  it('has 11 unique pokemon', () => {
    expect(roster).toHaveLength(11);
    expect(new Set(roster.map((p) => p.id)).size).toBe(11);
    expect(new Set(roster.map((p) => p.dex)).size).toBe(11);
  });

  it('looks up by id', () => {
    expect(getPokemon('zeraora').dex).toBe('0807');
    expect(() => getPokemon('missingno')).toThrow();
  });
});
