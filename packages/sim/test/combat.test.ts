import { describe, expect, it } from 'vitest';
import { gameplay, getPokemon } from '@pokeathlon/data';
import { addXp, applyHit, Button, quantizeInput, step, ticks, TICK_RATE, type World } from '../src/index';
import { idle, run, sandbox, types } from './helpers';

const K = gameplay.knock;
const EVADE = quantizeInput(0, 0, 0, 0, Button.Evade);

/** Zeraora (team 0) at `a`, Lucario (team 1) at `b`. Ball parked out of the way. */
function duel(a = { x: -200, y: 0 }, b = { x: 200, y: 0 }): World {
  return sandbox(
    [
      { pokemonId: 'zeraora', team: 0, pos: a },
      { pokemonId: 'lucario', team: 1, pos: b },
    ],
    { x: 0, y: -800 },
  );
}

describe('knockback and Stagger', () => {
  it('a hit of K knockback pushes about K units and deals Stagger damage', () => {
    const w = duel();
    const t = w.players[1]!;
    const s0 = t.stagger;
    applyHit(w, 0, t, { dir: { x: 1, y: 0 }, knockback: 300, damage: 200 });
    run(w, TICK_RATE, [idle, idle]);
    expect(t.pos.x - 200).toBeGreaterThan(300 * 0.9);
    expect(t.pos.x - 200).toBeLessThan(300 * 1.1);
    expect(t.stagger).toBeLessThan(s0); // regen hasn't fully restored it after 1 s
    expect(t.lastHitBy).toBe(0);
  });

  it('emptying Stagger → Staggered: ×3.545 knockback, ×0.25 damage, recovers at 50 %', () => {
    const w = duel();
    const t = w.players[1]!;
    applyHit(w, 0, t, { dir: { x: 1, y: 0 }, knockback: 0, damage: 99999 });
    expect(w.events.some((e) => e.type === 'staggered')).toBe(true);
    expect(t.staggered).toBe(true);

    const before = t.pos.x;
    applyHit(w, 0, t, { dir: { x: 0, y: 1 }, knockback: 100, damage: 100 });
    const hit = w.events.filter((e) => e.type === 'hit').at(-1)!;
    expect(hit.type === 'hit' && hit.knockback).toBeCloseTo(100 * K.staggeredKnockbackMultiplier, 6);
    expect(hit.type === 'hit' && hit.damage).toBeCloseTo(25, 6);
    expect(t.pos.x).toBe(before);

    const evs = run(w, TICK_RATE * 4, [idle, idle]);
    expect(types(evs)).toContain('recovered');
    expect(t.staggered).toBe(false);
  });

  it('LIGHT hits slow and chip, but only knock back a Staggered target', () => {
    const w = duel();
    const t = w.players[1]!;
    applyHit(w, 0, t, { dir: { x: 1, y: 0 }, knockback: 300, damage: 50, light: true });
    expect(t.knockTicks).toBe(0);
    expect(t.slowTicks).toBeGreaterThan(0);
  });

  it('Goal Arc gives 125 flat knockback resistance (not while Staggered)', () => {
    const w = duel({ x: -200, y: 0 }, { x: 1100, y: 0 }); // Lucario (team 1) in its own arc
    applyHit(w, 0, w.players[1]!, { dir: { x: -1, y: 0 }, knockback: 300, damage: 10 });
    const hit = w.events.find((e) => e.type === 'hit')!;
    expect(hit.type === 'hit' && hit.knockback).toBe(300 - K.goalArcResist);
  });

  it('passive Stagger regen: 4 %/s after the delay', () => {
    const w = duel();
    const t = w.players[1]!;
    applyHit(w, 0, t, { dir: { x: 1, y: 0 }, knockback: 0, damage: 300 });
    const hurt = t.stagger;
    run(w, ticks(gameplay.stagger.regenDelay), [idle, idle]);
    expect(t.stagger).toBeCloseTo(hurt, 6);
    run(w, TICK_RATE, [idle, idle]);
    expect(t.stagger - hurt).toBeCloseTo(t.maxStagger * 0.04, 3);
  });
});

describe('KO and respawn', () => {
  it('knocked past an edge → KO, takedown credit, respawn after the timer with immunity', () => {
    const w = duel({ x: -200, y: 700 }, { x: 0, y: 800 });
    const t = w.players[1]!;
    t.staggered = true;
    applyHit(w, 0, t, { dir: { x: 0, y: 1 }, knockback: 200, damage: 0 });
    const evs = run(w, TICK_RATE, [idle, idle]);
    const ko = evs.find((e) => e.type === 'ko');
    expect(ko && ko.type === 'ko' && ko.by).toBe(0);
    expect(t.koTicks).toBeGreaterThan(0);
    expect(w.players[0]!.stats.kos).toBe(1);
    expect(w.players[0]!.xp).toBeGreaterThanOrEqual(gameplay.xp.takedown);
    expect(w.players[0]!.xp).toBeLessThan(gameplay.xp.takedown + 3); // + passive XP during the slide

    const back = run(w, ticks(gameplay.respawn.time), [idle, idle]);
    expect(types(back)).toContain('respawn');
    expect(t.koTicks).toBe(0);
    expect(t.pos).toEqual(w.stage.spawns[1].respawn[0]);
    expect(t.immuneTicks).toBeGreaterThan(0);
    expect(applyHit(w, 0, t, { dir: { x: 1, y: 0 }, knockback: 100, damage: 100 })).toBe(false);
  });

  it('knocked into the goal pocket is a KO too (OS: any edge)', () => {
    const w = duel({ x: -200, y: 0 }, { x: 1400, y: 0 });
    for (const b of w.barriers) b.alive = false;
    for (const g of w.gates) g.open = true;
    const t = w.players[1]!;
    applyHit(w, 0, t, { dir: { x: 1, y: 0 }, knockback: 300, damage: 0 });
    expect(types(run(w, TICK_RATE, [idle, idle]))).toContain('ko');
  });

  it('a knocked player bounces off solid terrain (barriers) instead of passing through', () => {
    const w = duel({ x: -200, y: 0 }, { x: 1150, y: 370 });
    const t = w.players[1]!;
    applyHit(w, 0, t, { dir: { x: 1, y: 0 }, knockback: 400, damage: 0 });
    const evs = run(w, TICK_RATE, [idle, idle]);
    expect(types(evs)).not.toContain('ko');
    expect(t.pos.x).toBeLessThan(1230);
  });
});

describe('Energy: Evade and Energy Burst', () => {
  it('Evade costs 25 Energy and makes you untargetable for 1.5 s (press, not hold)', () => {
    const w = duel();
    const p = w.players[0]!;
    expect(p.energy).toBe(25);
    step(w, [EVADE, idle]);
    expect(types(w.events)).toContain('evade');
    expect(p.energy).toBe(0);
    expect(applyHit(w, 1, p, { dir: { x: -1, y: 0 }, knockback: 300, damage: 300 })).toBe(false);
    run(w, ticks(gameplay.evade.elusive), [EVADE, idle]); // holding doesn't re-trigger
    expect(applyHit(w, 1, p, { dir: { x: -1, y: 0 }, knockback: 300, damage: 300 })).toBe(true);
  });

  it('Striking cancels Evade', () => {
    const w = duel();
    const p = w.players[0]!;
    step(w, [EVADE, idle]);
    step(w, [idle, idle]);
    step(w, [quantizeInput(0, 0, 1, 0, Button.Strike), idle]);
    expect(p.elusiveTicks).toBe(0);
  });

  it('full meter → Energy Burst: knocks nearby enemies, freezes and grabs the ball, boosts the next hit', () => {
    const w = sandbox(
      [
        { pokemonId: 'zeraora', team: 0, pos: { x: -200, y: 0 } },
        { pokemonId: 'lucario', team: 1, pos: { x: 0, y: 0 } },
      ],
      { x: -200, y: 150 },
    );
    const p = w.players[0]!;
    p.energy = gameplay.energy.max;
    w.ball.vel = { x: 300, y: 0 };
    step(w, [EVADE, idle]);
    const burst = w.events.find((e) => e.type === 'burst');
    expect(burst && burst.type === 'burst' && burst.grabbedBall).toBe(true);
    expect(types(w.events)).toContain('hit');
    expect(p.energy).toBeGreaterThan(0); // spent all, then +3 for the hit
    expect(w.players[1]!.knockTicks).toBeGreaterThan(0);
    expect(w.ball.controlBy).toBe(0);

    // The opponent can't touch the held ball; the burster's next Strike is +50 %.
    step(w, [quantizeInput(0, 1, 0, 1, Button.Strike), idle]);
    const hit = w.events.find((e) => e.type === 'ballHit');
    expect(hit && hit.type === 'ballHit' && hit.boosted).toBe(true);
    expect(hit && hit.type === 'ballHit' && hit.speed).toBeCloseTo((1230 + 1.25 * getPokemon('zeraora').stats.power) * 1.5, 6);
  });
});

describe('orbs and levels', () => {
  it('orbs spawn 10 s into play (mid + both arcs) and heal / energise / give XP', () => {
    const w = duel({ x: -600, y: 0 }, { x: 600, y: 0 });
    let evs = run(w, ticks(gameplay.orbs.first), [idle, idle]);
    expect(evs.filter((e) => e.type === 'orbSpawn')).toHaveLength(3);
    const mid = w.orbs.find((o) => o.group === 'mid')!;
    const p = w.players[0]!;
    p.stagger = p.maxStagger / 2;
    const e0 = p.energy;
    const xp0 = p.xp;
    p.pos = { ...mid.pos };
    evs = run(w, 1, [idle, idle]);
    expect(types(evs)).toContain('orb');
    expect(p.energy).toBe(e0 + gameplay.orbs.energy);
    expect(p.xp).toBeGreaterThanOrEqual(xp0 + gameplay.orbs.xp);
    expect(p.stagger).toBeGreaterThan(p.maxStagger / 2 + p.maxStagger * 0.15);
    expect(w.orbs).toHaveLength(2);
  });

  it('levelling up raises max Stagger by growth / 9 per level', () => {
    const w = duel();
    const p = w.players[0]!; // Zeraora: 1150 + 250 growth
    addXp(w, p, gameplay.xp.levelThresholds[1]!);
    expect(p.level).toBe(2);
    expect(p.maxStagger).toBeCloseTo(1150 + 250 / 9, 6);
    addXp(w, p, 100000);
    expect(p.level).toBe(10);
    expect(p.maxStagger).toBeCloseTo(1400, 6);
  });
});
