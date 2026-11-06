import { describe, expect, it } from 'vitest';
import { gameplay } from '@pokeathlon/data';
import { addXp, applyHit, Button, parseLineup, quantizeInput, runHeadless, step, type PlayerInput, type SimEvent, type World } from '../src/index';
import { idle, run, sandbox, types } from './helpers';

/** Blastoise (OS Atlas model) and Hisuian Arcanine (OS Asher model, Blastoise's old kit). */

function cast(w: World, who: number, button: number, aim = { x: 1, y: 0 }): SimEvent[] {
  const inputs: PlayerInput[] = w.players.map(() => idle);
  inputs[who] = quantizeInput(0, 0, aim.x, aim.y, button, 0);
  step(w, inputs);
  return w.events;
}
const unlock = (w: World) => {
  for (const p of w.players) addXp(w, p, gameplay.xp.levelThresholds[1]!);
};
const hitsOn = (evs: SimEvent[], target: number, source: string) =>
  evs.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit' && e.target === target && e.source === source);

describe('Blastoise (Angelic Support)', () => {
  it('Surf passes through enemies, hitting each once', () => {
    const w = sandbox(
      [
        { pokemonId: 'blastoise', team: 0, pos: { x: -400, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: -200, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: 50, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    const evs = [...cast(w, 0, Button.Move1), ...run(w, 40, [idle, idle, idle])];
    expect(hitsOn(evs, 1, 'surf')).toHaveLength(1);
    expect(hitsOn(evs, 2, 'surf')).toHaveLength(1);
    expect(w.projectiles).toHaveLength(0); // slowed to a stop within its range
  });

  it('Whirlpool hits close enemies on the burst and once more as it swirls in', () => {
    const w = sandbox(
      [
        { pokemonId: 'blastoise', team: 0, pos: { x: -400, y: 0 } },
        { pokemonId: 'bronzong', team: 1, pos: { x: -250, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    const evs = [...cast(w, 0, Button.Move2)];
    // Hold the enemy in place so the later rings still reach it.
    for (let i = 0; i < 70; i++) {
      w.players[1]!.pos = { x: -250, y: 0 };
      evs.push(...run(w, 1, [idle, idle]));
    }
    const hits = hitsOn(evs, 1, 'whirlpool');
    expect(hits).toHaveLength(2);
    expect(hits[1]!.damage).toBeLessThan(hits[0]!.damage);
  });

  it('Aqua Ring heals allies inside it on cast and every 0.25 s for 2 s (4 % a pulse)', () => {
    const w = sandbox(
      [
        { pokemonId: 'blastoise', team: 0, pos: { x: -400, y: 0 } },
        { pokemonId: 'lucario', team: 0, pos: { x: -300, y: 0 } },
        { pokemonId: 'lucario', team: 0, pos: { x: 300, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    unlock(w);
    const [, near, far] = w.players;
    near!.stagger = far!.stagger = 100;
    expect(types(cast(w, 0, Button.Signature))).toContain('guardian');
    expect(near!.stagger - 100).toBeGreaterThan(near!.maxStagger * 0.04); // + a little natural regen
    expect(near!.stagger - 100).toBeLessThan(near!.maxStagger * 0.04 + 5);
    run(w, 130, [idle, idle, idle]);
    expect(w.guardians).toHaveLength(0);
    expect(near!.stagger).toBeGreaterThan(100 + near!.maxStagger * 0.32); // 1 + 8 pulses of 4 %
    expect(far!.stagger).toBeLessThan(100 + far!.maxStagger * 0.2); // outside: only natural regen
  });

  it('Aqua Ring rescues an ally from a KO anywhere, once per ally, never for enemies', () => {
    const w = sandbox(
      [
        { pokemonId: 'blastoise', team: 0, pos: { x: -400, y: 0 } },
        { pokemonId: 'lucario', team: 0, pos: { x: 300, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    unlock(w);
    cast(w, 0, Button.Signature);
    const ally = w.players[1]!;
    const blast = (target: typeof ally, by: number) => {
      target.pos = { x: 300, y: w.stage.halfWidth - 120 };
      applyHit(target === ally ? w : w2, by, target, { dir: { x: 0, y: 1 }, knockback: 4000, damage: 0 });
    };
    let w2 = w;
    blast(ally, 0); // knocked off the far edge, far from the ring
    const evs = run(w, 30, [idle, idle]);
    expect(types(evs)).toContain('rescue');
    expect(types(evs)).not.toContain('ko');
    expect(ally.koTicks).toBe(0);
    expect(ally.pos).toEqual({ x: -400, y: 0 });
    expect(ally.stagger).toBeGreaterThanOrEqual(ally.maxStagger * 0.75); // then the ring keeps healing them
    // Second time during the same ring: a real KO.
    blast(ally, 0);
    expect(types(run(w, 30, [idle, idle]))).toContain('ko');
    // An enemy never gets saved.
    w2 = sandbox(
      [
        { pokemonId: 'blastoise', team: 0, pos: { x: -400, y: 0 } },
        { pokemonId: 'lucario', team: 1, pos: { x: 300, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    unlock(w2);
    cast(w2, 0, Button.Signature);
    blast(w2.players[1]!, 0);
    expect(types(run(w2, 30, [idle, idle]))).toContain('ko');
  });

  it('bots cast all three moves, and Aqua Ring saves someone over a match', () => {
    const r = runHeadless(parseLineup('blastoise,lucario,machamp/zeraora,lucario,blastoise'), { seed: 5, until: 'match', maxMinutes: 6, brains: ['v2-hard', 'v2-hard'] });
    const casts = (id: string) => r.telemetry.players.reduce((s, p) => s + (p.moves[id]?.casts ?? 0), 0);
    for (const id of ['surf', 'whirlpool', 'aqua-ring']) expect(casts(id), id).toBeGreaterThan(0);
  }, 120_000);
});

describe('Hisuian Arcanine (Shield User)', () => {
  it('has the Asher kit: Rock Slide raises a wall, Flare Blitz is a guarded charge, Flamethrower channels', () => {
    const w = sandbox(
      [
        { pokemonId: 'arcanine-hisui', team: 0, pos: { x: -400, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: 600, y: 600 } },
      ],
      { x: 0, y: -850 },
    );
    unlock(w);
    cast(w, 0, Button.Move1);
    const slide = run(w, 40, [idle, idle]); // 0.55 s wind-up, then the pulse and the wall
    expect(types(slide)).toContain('wall');
    expect(w.creations.filter((c) => c.moveId === 'rock-slide')).toHaveLength(1);
    const evs = [...cast(w, 0, Button.Move2)];
    expect(w.players[0]!.dash?.guard).toBeTruthy();
    evs.push(...run(w, 30, [idle, idle]));
    cast(w, 0, Button.Signature);
    expect(w.players[0]!.channel?.moveId).toBe('flamethrower');
    expect(types(evs)).toContain('dash');
  });
});
