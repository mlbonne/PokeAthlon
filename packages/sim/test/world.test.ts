import { describe, expect, it } from 'vitest';
import { createWorld, DEFAULT_ARENA, hashWorld, quantizeInput, step, TICK_RATE, type PlayerInput } from '../src/index';

const spawn = () => createWorld([{ pokemonId: 'pikachu', team: 0, pos: { x: 0, y: 0 } }]);

/** Deterministic pseudo-random input stream (LCG), independent of Math.random. */
function scriptedInputs(n: number, seed: number): PlayerInput[] {
  let s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000) * 2 - 1;
  const out: PlayerInput[] = [];
  let cur = quantizeInput(0, 0);
  for (let i = 0; i < n; i++) {
    if (i % 20 === 0) cur = quantizeInput(r(), r());
    out.push(cur);
  }
  return out;
}

describe('movement', () => {
  it('reaches the pokemon top speed and travels about speed × time', () => {
    const w = spawn();
    const right = quantizeInput(1, 0);
    for (let i = 0; i < TICK_RATE; i++) step(w, [right]);
    const p = w.players[0]!;
    expect(p.vel.x).toBeCloseTo(465, 6);
    // 1 s at 465 u/s minus a short acceleration ramp.
    expect(p.pos.x).toBeGreaterThan(440);
    expect(p.pos.x).toBeLessThan(465);
  });

  it('normalises diagonal movement', () => {
    const w = spawn();
    for (let i = 0; i < TICK_RATE; i++) step(w, [quantizeInput(1, 1)]);
    const v = w.players[0]!.vel;
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(465, 3);
  });

  it('stops when input is released', () => {
    const w = spawn();
    for (let i = 0; i < 30; i++) step(w, [quantizeInput(0, 1)]);
    for (let i = 0; i < 30; i++) step(w, []);
    expect(w.players[0]!.vel).toEqual({ x: 0, y: 0 });
  });

  it('stays inside the arena, including the cut corners', () => {
    const w = spawn();
    for (let i = 0; i < TICK_RATE * 20; i++) step(w, [quantizeInput(1, 1)]);
    const p = w.players[0]!;
    const a = DEFAULT_ARENA;
    expect(p.pos.x).toBeLessThanOrEqual(a.halfWidth - p.radius + 1e-9);
    expect(p.pos.y).toBeLessThanOrEqual(a.halfHeight - p.radius + 1e-9);
    expect(p.pos.x + p.pos.y).toBeLessThanOrEqual(a.halfWidth + a.halfHeight - a.cornerCut - p.radius * Math.SQRT2 + 1e-6);
  });
});

describe('determinism', () => {
  it('same input stream → identical state hash', () => {
    const inputs = scriptedInputs(TICK_RATE * 30, 42);
    const run = () => {
      const w = createWorld([
        { pokemonId: 'pikachu', team: 0, pos: { x: -500, y: 0 } },
        { pokemonId: 'snorlax', team: 1, pos: { x: 500, y: 0 } },
      ]);
      for (const inp of inputs) step(w, [inp, { ...inp, moveX: -inp.moveX }]);
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });

  it('different inputs → different hash', () => {
    const a = spawn();
    const b = spawn();
    step(a, [quantizeInput(1, 0)]);
    step(b, [quantizeInput(0, 1)]);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});
