import { describe, expect, it } from 'vitest';
import { getItem } from '@pokeathlon/data';
import { createWorld } from '@pokeathlon/sim';
import { cpuBan, cpuPick, pickable, roleStrength, seededRand } from '../src/cpuDraft';
import { AUTO, buildConfig, resolvePicks, type Saved } from '../src/setup';

const base: Saved = {
  blue: ['pikachu', 'lucario', 'bronzong'],
  red: ['togekiss', '?', 'bronzong'],
  items: [AUTO, AUTO, AUTO],
  role: 'forward',
  diff: 'normal',
  bans: false,
  ban: '',
  seed: 1,
};
const fixed = (id: string) => (id === '?' ? 'lucario' : id);

describe('match setup', () => {
  it('3v3 as a forward: you are player 0, one goalie per team, randoms resolved, everyone holds a legal item', () => {
    const c = buildConfig(base, 'play', fixed);
    expect(c.me).toBe(0);
    expect(c.lineup).toHaveLength(6);
    expect(c.lineup[0]).toMatchObject({ pokemonId: 'pikachu', team: 0, slot: 0 });
    expect(c.lineup.filter((s) => s.role === 'goalie').map((s) => s.team)).toEqual([0, 1]);
    expect(c.lineup[4]!.pokemonId).toBe('lucario');
    for (const s of c.lineup) expect(getItem(s.item!).slot).toBe(s.role === 'goalie' ? 'goalie' : 'forward');
    const w = createWorld(c.lineup, { mode: 'match' });
    expect(w.players.map((p) => p.role)).toEqual(['forward', 'forward', 'goalie', 'forward', 'forward', 'goalie']);
  });

  it('3v3 as the goalie: you take goal, both teammates play forward', () => {
    const c = buildConfig({ ...base, role: 'goalie' }, 'play', fixed);
    expect(c.lineup[0]).toMatchObject({ team: 0, role: 'goalie' });
    expect(c.lineup.slice(1, 3).every((s) => s.role !== 'goalie')).toBe(true);
    expect(new Set(c.lineup.slice(1, 3).map((s) => s.slot)).size).toBe(2);
  });

  it('your item choice is used', () => {
    const c = buildConfig({ ...base, items: ['muscle-band', AUTO, AUTO] }, 'play', fixed);
    expect(c.lineup[0]!.item).toBe('muscle-band');
  });

  it('spectate and practice', () => {
    const spec = buildConfig(base, 'spectate', fixed);
    expect(spec.me).toBe(-1);
    expect(spec.diff).toBe('hard');
    const pr = buildConfig(base, 'practice', fixed);
    expect(pr.practice).toBe(true);
    expect(pr.lineup).toHaveLength(2);
  });
});

describe('CPU picks', () => {
  it('fill CPU slots without duplicates within a team, reproducibly per seed', () => {
    const s: Saved = { ...base, blue: ['pikachu', AUTO, AUTO], red: [AUTO, AUTO, AUTO] };
    const a = resolvePicks(s);
    expect(resolvePicks(s)).toEqual(a);
    expect(new Set(a.blue).size).toBe(3);
    expect(new Set(a.red).size).toBe(3);
    expect(a.blue[0]).toBe('pikachu');
  });

  it('Hard takes the strongest available for the role; Easy can take anything', () => {
    const best = pickable().sort((x, y) => roleStrength(y, 'goalie') - roleStrength(x, 'goalie'))[0]!;
    expect(cpuPick('goalie', [], [], 'hard', seededRand(1))).toBe(best);
    expect(cpuPick('goalie', [best], [], 'hard', seededRand(1))).not.toBe(best);
    const seen = new Set(Array.from({ length: 60 }, (_, i) => cpuPick('forward', [], [], 'easy', seededRand(i))));
    expect(seen.size).toBeGreaterThan(4);
  });

  it('bans: nobody can field a banned Pokémon', () => {
    const s: Saved = { ...base, blue: ['pikachu', AUTO, AUTO], red: [AUTO, AUTO, AUTO], bans: true, ban: 'bronzong', diff: 'hard' };
    const r = resolvePicks(s);
    expect(r.redBan).toBe(cpuBan('hard', ['bronzong'], seededRand(1)));
    for (const id of [...r.blue, ...r.red]) expect([s.ban, r.redBan]).not.toContain(id);
  });
});
