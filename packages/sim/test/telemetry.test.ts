import { describe, expect, it } from 'vitest';
import { SIZE_TABLE } from '@pokeathlon/data';
import { analyzeRoster } from '@pokeathlon/data/analyze';
import { Button, createWorld, hashWorld, parseLineup, quantizeInput, randFloat, randInt, runHeadless, step, type PlayerInput } from '../src/index';
import { idle, run, sandbox } from './helpers';

describe('seeded RNG', () => {
  it('is reproducible per seed and differs between seeds', () => {
    const a = createWorld(parseLineup('pikachu/lucario'), { seed: 7 });
    const b = createWorld(parseLineup('pikachu/lucario'), { seed: 7 });
    const c = createWorld(parseLineup('pikachu/lucario'), { seed: 8 });
    const draw = (w: typeof a) => Array.from({ length: 20 }, () => randInt(w.ai, 0, 0, 1000));
    expect(draw(a)).toEqual(draw(b));
    expect(draw(c)).not.toEqual(draw(a));
    // Each player has an independent stream.
    expect(a.ai.rng[0]).not.toBe(a.ai.rng[1]);
  });

  it('floats are in [0, 1) and roughly uniform', () => {
    const w = createWorld(parseLineup('pikachu/lucario'), { seed: 1 });
    const xs = Array.from({ length: 4000 }, () => randFloat(w.ai, 0));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.47);
    expect(mean).toBeLessThan(0.53);
  });
});

describe('telemetry', () => {
  it('credits a Strike on the ball to the strike source', () => {
    const w = sandbox([{ pokemonId: 'pikachu', team: 0, pos: { x: -120, y: 0 } }], { x: 0, y: 0 });
    const press: PlayerInput = quantizeInput(0, 0, 1, 0, Button.Strike);
    run(w, 1, [press]);
    run(w, 5, [idle]);
    const t = w.telemetry.players[0]!;
    expect(t.moves.strike?.casts).toBe(1);
    expect(t.moves.strike?.ballHits).toBe(1);
    expect(t.ballTouches).toBe(1);
    expect(t.moves.strike!.ballSpeed).toBeGreaterThan(0);
  });

  it('credits a move hit (damage, knockback) to that move on both sides', () => {
    const w = sandbox(
      [
        { pokemonId: 'lucario', team: 0, pos: { x: 0, y: 0 } },
        { pokemonId: 'snorlax', team: 1, pos: { x: 400, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    step(w, [quantizeInput(0, 0, 1, 0, Button.Move1), idle]);
    run(w, 40, [idle, idle]);
    const a = w.telemetry.players[0]!;
    const d = w.telemetry.players[1]!;
    const m = a.moves['aura-sphere']!;
    expect(m.casts).toBe(1);
    expect(m.playerHits).toBe(1);
    expect(m.damage).toBeGreaterThan(0);
    expect(m.knockback).toBeGreaterThan(0);
    expect(a.damageDealt).toBeCloseTo(m.damage);
    expect(d.damageTaken).toBeCloseTo(m.damage);
    expect(d.hitsTaken).toBe(1);
  });

  it('counts time alive and distance moved', () => {
    const w = sandbox([{ pokemonId: 'pikachu', team: 0, pos: { x: 0, y: 0 } }], { x: 0, y: -850 });
    run(w, 60, [quantizeInput(1, 0)]);
    const t = w.telemetry.players[0]!;
    expect(t.aliveTicks).toBe(60);
    expect(t.distance).toBeGreaterThan(200);
    expect(t.distance).toBeCloseTo(w.players[0]!.pos.x, 0);
  });
});

describe('headless runner', () => {
  it('same seed → same match; different seed → different match', () => {
    const lineup = parseLineup('pikachu/lucario');
    const a = runHeadless(lineup, { seed: 3, until: 'goal' });
    const b = runHeadless(lineup, { seed: 3, until: 'goal' });
    const c = runHeadless(lineup, { seed: 4, until: 'goal' });
    expect(a.hash).toBe(b.hash);
    expect(a.ticks).toBe(b.ticks);
    expect(c.hash).not.toBe(a.hash);
    expect(a.telemetry.goals[0] + a.telemetry.goals[1]).toBe(1);
  });

  it('telemetry totals agree with the match stats', () => {
    const r = runHeadless(parseLineup('pikachu,lucario,snorlax/togekiss,lucario,snorlax'), { seed: 1, until: 'set' });
    const ps = r.telemetry.players;
    const dealt = ps.reduce((s, p) => s + p.damageDealt, 0);
    const taken = ps.reduce((s, p) => s + p.damageTaken, 0);
    expect(dealt).toBeCloseTo(taken);
    expect(ps.reduce((s, p) => s + p.kos, 0)).toBeLessThanOrEqual(ps.reduce((s, p) => s + p.deaths, 0));
    const goals = ps.reduce((s, p) => s + p.goals + p.ownGoals, 0);
    expect(goals).toBe(r.telemetry.goals[0] + r.telemetry.goals[1]);
    // Per-move damage adds up to each player's total.
    for (const p of ps) {
      const byMove = Object.values(p.moves).reduce((s, m) => s + m.damage, 0);
      expect(byMove).toBeCloseTo(p.damageDealt);
    }
  });

  it('parses 1v1 and 3v3 lineups (last of each 3v3 team is the goalie)', () => {
    expect(parseLineup('pikachu/lucario').map((s) => s.team)).toEqual([0, 1]);
    const l = parseLineup('a,b,c/d,e,f');
    expect(l.filter((s) => s.role === 'goalie').map((s) => s.pokemonId)).toEqual(['c', 'f']);
    expect(() => parseLineup('a,b/c')).toThrow();
  });

  it('the hash covers bot RNG state', () => {
    const w = createWorld(parseLineup('pikachu/lucario'), { seed: 1 });
    const h = hashWorld(w);
    randInt(w.ai, 0, 0, 9);
    expect(hashWorld(w)).not.toBe(h);
  });
});

describe('analyzer vs sim', () => {
  it("the analyzer's damage and reach match what the sim does", () => {
    const sphere = analyzeRoster(['lucario'])[0]!.moves.find((m) => m.id === 'aura-sphere')!;
    const hurt = SIZE_TABLE['very-large'].hurtRadius;
    // Target's hurtbox edge just inside the reach: hit, for exactly the predicted damage.
    const inside = sandbox(
      [
        { pokemonId: 'lucario', team: 0, pos: { x: 0, y: 0 } },
        { pokemonId: 'snorlax', team: 1, pos: { x: sphere.reach + hurt - 10, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    step(inside, [quantizeInput(0, 0, 1, 0, Button.Move1), idle]);
    run(inside, 60, [idle, idle]);
    expect(inside.telemetry.players[0]!.moves['aura-sphere']!.damage).toBeCloseTo(sphere.damagePerCast);
    // Well outside (more than one tick of projectile travel past the reach): miss.
    const outside = sandbox(
      [
        { pokemonId: 'lucario', team: 0, pos: { x: 0, y: 0 } },
        { pokemonId: 'snorlax', team: 1, pos: { x: sphere.reach + hurt + 60, y: 0 } },
      ],
      { x: 0, y: -850 },
    );
    step(outside, [quantizeInput(0, 0, 1, 0, Button.Move1), idle]);
    run(outside, 60, [idle, idle]);
    expect(outside.telemetry.players[0]!.moves['aura-sphere']!.playerHits).toBe(0);
  });
});
