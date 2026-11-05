import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getKit, getPokemon, kits } from '../src/index';

describe('kits', () => {
  it('the kits exist with one move per slot', () => {
    expect(Object.keys(kits).sort()).toEqual(['alakazam', 'blastoise', 'greninja', 'lucario', 'machamp', 'pikachu', 'snorlax', 'togekiss']);
    for (const k of Object.values(kits)) {
      expect(k.moves.map((m) => m.slot).sort()).toEqual(['primary', 'secondary', 'special']);
      expect(() => getPokemon(k.pokemon)).not.toThrow();
    }
  });

  it('every move animation exists in the imported sprite sheet', () => {
    for (const k of Object.values(kits)) {
      const dex = getPokemon(k.pokemon).dex;
      const anims = Object.keys(JSON.parse(readFileSync(new URL(`../../../assets/sprites/${dex}/anim.json`, import.meta.url), 'utf8')).anims);
      for (const m of k.moves) expect(anims, `${k.pokemon}/${m.id}`).toContain(m.anim);
    }
  });

  it('unknown Pokémon have no kit', () => {
    expect(getKit('missingno')).toBeUndefined();
  });
});
