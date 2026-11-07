import { describe, expect, it } from 'vitest';
import { gameplay } from '@pokeathlon/data';
import { addXp, Button, effectiveSpeed, parseLineup, quantizeInput, runHeadless, step, type PlayerInput, type SimEvent, type World } from '../src/index';
import { idle, run, sandbox } from './helpers';

/** Pikachu (OS Octavia model): Electroweb / Charge / Thunder. */

function cast(w: World, who: number, button: number, aim = { x: 1, y: 0 }): SimEvent[] {
  const inputs: PlayerInput[] = w.players.map(() => idle);
  inputs[who] = quantizeInput(0, 0, aim.x, aim.y, button, 0);
  step(w, inputs);
  return [...w.events];
}
const hitsOn = (evs: SimEvent[], target: number, source: string) =>
  evs.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit' && e.target === target && e.source === source);

describe('Pikachu (Ramping Speedster)', () => {
  it('Electroweb: a full hit and a 35 % slow on the first enemy, LIGHT hits on the rest', () => {
    const w = sandbox(
      [
        { pokemonId: 'pikachu', team: 0, pos: { x: -500, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: -250, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: 50, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    const evs = [...cast(w, 0, Button.Move1), ...run(w, 50, [idle, idle, idle])];
    const first = hitsOn(evs, 1, 'electroweb');
    const second = hitsOn(evs, 2, 'electroweb');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]!.light).toBeFalsy();
    expect(second[0]!.light).toBe(true);
    expect(second[0]!.damage).toBeLessThan(first[0]!.damage * 0.6);
  });

  it('Electroweb slows the first enemy by 35 % for about 1 s', () => {
    const w = sandbox(
      [
        { pokemonId: 'pikachu', team: 0, pos: { x: -500, y: 0 } },
        { pokemonId: 'machamp', team: 1, pos: { x: -250, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    cast(w, 0, Button.Move1);
    run(w, 20, [idle, idle]);
    const o = w.players[1]!;
    expect(o.slowTicks).toBeGreaterThan(30);
    expect(o.slowFrac).toBeCloseTo(0.35);
  });

  it('Charge: +20 % speed, every hit resets it, and the cooldown waits until it ends', () => {
    const w = sandbox([{ pokemonId: 'pikachu', team: 0, pos: { x: -500, y: 0 } }], { x: 0, y: -850 });
    const p = w.players[0]!;
    const base = effectiveSpeed(p);
    cast(w, 0, Button.Move2);
    expect(effectiveSpeed(p)).toBeGreaterThan(base * 1.15);
    const buff = p.buffs.find((b) => b.moveId === 'charge')!;
    const slot = p.moves.findIndex((m) => m.def.id === 'charge');
    const cd0 = p.moves[slot]!.cooldown;
    run(w, 60, [idle]);
    expect(p.moves[slot]!.cooldown).toBe(cd0); // held while the buff runs
    expect(buff.ticks).toBeLessThan(buff.total);
    // A Strike on the ball resets it.
    w.ball.pos = { x: p.pos.x + 120, y: p.pos.y };
    w.ball.vel = { x: 0, y: 0 };
    step(w, [quantizeInput(0, 0, 1, 0, Button.Strike, 0)]);
    run(w, 3, [idle]);
    expect(buff.ticks).toBeGreaterThan(buff.total - 10);
    run(w, 200, [idle]);
    expect(p.buffs.some((b) => b.moveId === 'charge')).toBe(false);
    expect(p.moves[slot]!.cooldown).toBeLessThan(cd0);
  });

  it('Thunder: after 1 s, 5 pulses around Pikachu that follow it', () => {
    const w = sandbox(
      [
        { pokemonId: 'pikachu', team: 0, pos: { x: -500, y: 0 } },
        { pokemonId: 'bronzong', team: 1, pos: { x: 200, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    addXp(w, w.players[0]!, gameplay.xp.levelThresholds[1]!);
    const evs = cast(w, 0, Button.Signature);
    // Walk toward the enemy during the wind-up, then keep it in range of every pulse.
    const walk = quantizeInput(1, 0, 0, 0, 0, 0);
    for (let i = 0; i < 60; i++) evs.push(...run(w, 1, [walk, idle]));
    for (let i = 0; i < 70; i++) {
      w.players[1]!.pos = { x: w.players[0]!.pos.x + 150, y: 0 };
      evs.push(...run(w, 1, [idle, idle]));
    }
    expect(w.players[0]!.pos.x).toBeGreaterThan(-300); // moved freely meanwhile
    expect(hitsOn(evs, 1, 'thunder')).toHaveLength(5);
  });

  it('bots cast all three moves', () => {
    const r = runHeadless(parseLineup('pikachu,lucario,machamp/pikachu,lucario,blastoise'), { seed: 3, until: 'match', maxMinutes: 6, brains: ['v2-hard', 'v2-hard'] });
    const casts = (id: string) => r.telemetry.players.reduce((s, p) => s + (p.moves[id]?.casts ?? 0), 0);
    for (const id of ['electroweb', 'charge', 'thunder']) expect(casts(id), id).toBeGreaterThan(0);
  }, 120_000);
});
