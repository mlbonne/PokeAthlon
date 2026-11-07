import { describe, expect, it } from 'vitest';
import { gameplay } from '@pokeathlon/data';
import { addXp, Button, parseLineup, quantizeInput, runHeadless, step, type PlayerInput, type SimEvent, type World } from '../src/index';
import { idle, run, sandbox } from './helpers';

/** Hisuian Decidueye (OS Rasmus) and Alolan Ninetales (OS Estelle). */

function cast(w: World, who: number, button: number, aim = { x: 1, y: 0 }): SimEvent[] {
  const inputs: PlayerInput[] = w.players.map(() => idle);
  inputs[who] = quantizeInput(0, 0, aim.x, aim.y, button, 0);
  step(w, inputs);
  return [...w.events];
}
const hitsOn = (evs: SimEvent[], target: number, source: string) =>
  evs.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit' && e.target === target && e.source === source);
const unlock = (w: World) => {
  for (const p of w.players) addXp(w, p, gameplay.xp.levelThresholds[1]!);
};

describe('Hisuian Decidueye (Whip Fighter)', () => {
  it('Leaf Blade: the tip is a full hit, closer in is LIGHT', () => {
    const w = sandbox(
      [
        { pokemonId: 'decidueye-hisui', team: 0, pos: { x: -500, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: -120, y: 0 } }, // 380 away: tip (≥ 0.62 × 450)
        { pokemonId: 'machamp', team: 1, pos: { x: -380, y: 60 } }, // 120 away: close
      ],
      { x: 0, y: -850 },
    );
    const evs = [...cast(w, 0, Button.Move1), ...run(w, 40, [idle, idle, idle])];
    const tip = hitsOn(evs, 1, 'leaf-blade');
    const close = hitsOn(evs, 2, 'leaf-blade');
    expect(tip).toHaveLength(1);
    expect(close).toHaveLength(1);
    expect(tip[0]!.light).toBeFalsy();
    expect(close[0]!.light).toBe(true);
    expect(close[0]!.damage).toBeLessThan(tip[0]!.damage * 0.6);
  });

  it('Trailblaze: a speed buff, and the recast spins (LIGHT) around Decidueye', () => {
    const w = sandbox(
      [
        { pokemonId: 'decidueye-hisui', team: 0, pos: { x: -500, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: -330, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    cast(w, 0, Button.Move2);
    expect(w.players[0]!.buffs.map((b) => b.moveId)).toContain('trailblaze');
    run(w, 30, [idle, idle]); // past the recast lockout
    const evs = [...cast(w, 0, Button.Move2), ...run(w, 5, [idle, idle])];
    const spin = hitsOn(evs, 1, 'trailblaze');
    expect(spin).toHaveLength(1);
    expect(spin[0]!.light).toBe(true);
  });

  it('Spirit Shackle pulls the first enemy toward Decidueye, then spins where it stopped', () => {
    const w = sandbox(
      [
        { pokemonId: 'decidueye-hisui', team: 0, pos: { x: -500, y: 0 } },
        { pokemonId: 'lucario', team: 1, pos: { x: -200, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    unlock(w);
    const evs = [...cast(w, 0, Button.Signature), ...run(w, 20, [idle, idle])];
    const pull = hitsOn(evs, 1, 'spirit-shackle');
    expect(pull.length).toBeGreaterThanOrEqual(1);
    expect(w.players[1]!.pos.x).toBeLessThan(-260); // pulled toward Decidueye (−x), not pushed away
    evs.push(...run(w, 130, [idle, idle]));
    expect(evs.filter((e) => e.type === 'area' && e.moveId === 'spirit-shackle').length).toBeGreaterThanOrEqual(6); // the spin repeats
  });
});

describe('Alolan Ninetales (Tempo Sniper)', () => {
  it('Ice Beam hits every enemy in a long line', () => {
    const w = sandbox(
      [
        { pokemonId: 'ninetales-alola', team: 0, pos: { x: -600, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: -200, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: 300, y: 30 } },
        { pokemonId: 'machamp', team: 1, pos: { x: -200, y: 300 } }, // off the line
      ],
      { x: 0, y: -850 },
    );
    const evs = [...cast(w, 0, Button.Move1), ...run(w, 30, [idle, idle, idle, idle])];
    expect(hitsOn(evs, 1, 'ice-beam')).toHaveLength(1);
    expect(hitsOn(evs, 2, 'ice-beam')).toHaveLength(1);
    expect(hitsOn(evs, 3, 'ice-beam')).toHaveLength(0);
  });

  it('Ice Shard blinks, then its shard homes in on an enemy off to the side', () => {
    const w = sandbox(
      [
        { pokemonId: 'ninetales-alola', team: 0, pos: { x: -600, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: -150, y: 350 } }, // not where she aims
      ],
      { x: 0, y: -850 },
    );
    const evs = [...cast(w, 0, Button.Move2), ...run(w, 80, [idle, idle])];
    expect(evs.some((e) => e.type === 'blink')).toBe(true);
    expect(hitsOn(evs, 1, 'ice-shard')).toHaveLength(1);
  });

  it('Blizzard: 7 icicles, but each enemy is hit only once per volley', () => {
    const w = sandbox(
      [
        { pokemonId: 'ninetales-alola', team: 0, pos: { x: -600, y: 0 } },
        { pokemonId: 'bronzong', team: 1, pos: { x: -350, y: 0 } }, // big body in the middle of the fan
      ],
      { x: 0, y: -850 },
    );
    unlock(w);
    cast(w, 0, Button.Signature);
    const evs = run(w, 15, [idle, idle]);
    expect(w.projectiles.filter((p) => p.moveId === 'blizzard').length + hitsOn(evs, 1, 'blizzard').length).toBeGreaterThan(1);
    evs.push(...run(w, 40, [idle, idle]));
    expect(hitsOn(evs, 1, 'blizzard')).toHaveLength(1);
  });

  it('bots cast all six new moves over a match', () => {
    const r = runHeadless(parseLineup('decidueye-hisui,ninetales-alola,blastoise/ninetales-alola,decidueye-hisui,bronzong'), { seed: 7, until: 'match', maxMinutes: 6, brains: ['v2-hard', 'v2-hard'] });
    const casts = (id: string) => r.telemetry.players.reduce((s, p) => s + (p.moves[id]?.casts ?? 0), 0);
    for (const id of ['leaf-blade', 'trailblaze', 'spirit-shackle', 'ice-beam', 'ice-shard', 'blizzard']) expect(casts(id), id).toBeGreaterThan(0);
  }, 180_000);
});
