import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TERRAIN, FLOORS, getTerrain, terrains } from '../src/rules';

const BRAWL = fileURLToPath(new URL('../../../assets/stadium/brawl/', import.meta.url));

describe('stages (M6)', () => {
  it('Pokémon Stadium is the default stage and uses the Brawl art set', () => {
    expect(DEFAULT_TERRAIN).toBe('pokemon-stadium');
    expect(getTerrain(DEFAULT_TERRAIN).theme).toBe('stadium-brawl');
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

  it('Pokémon Stadium uses valid Brawl floors and ships their GLBs', () => {
    const t = getTerrain('pokemon-stadium');
    expect(FLOORS).toContain(t.floor);
    for (const floor of [t.floor, ...t.floorCycle]) {
      expect(FLOORS).toContain(floor);
      expect(existsSync(`${BRAWL}floor-${floor}.glb`)).toBe(true);
    }
    for (const file of ['stadium.glb', 'sky.glb', 'screen.glb', 'platforms.glb', 'smoke.glb', 'manifest.json']) {
      expect(existsSync(`${BRAWL}${file}`)).toBe(true);
    }
  });
});
