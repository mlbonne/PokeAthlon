import { describe, expect, it } from 'vitest';
import { gameplay } from '@pokeathlon/data';
import {
  addXp,
  applyHit,
  Button,
  dsin,
  effectiveSpeed,
  quantizeInput,
  rotateDeg,
  step,
  ticks,
  TICK_RATE,
  type PlayerInput,
  type World,
} from '../src/index';
import { idle, run, sandbox, speedOf, types } from './helpers';

/** Press a move button for one tick (aim → x/y), then release. */
function cast(w: World, who: number, button: number, aim = { x: 1, y: 0 }, aimDist = 0, others: PlayerInput[] = []) {
  const inputs: PlayerInput[] = w.players.map((_, i) => others[i] ?? idle);
  inputs[who] = quantizeInput(0, 0, aim.x, aim.y, button, aimDist);
  step(w, inputs);
  return w.events;
}

/** Caster (team 0) at `a`, enemy (team 1) at `b`, ball parked far away unless given. */
function duel(caster: string, a: { x: number; y: number }, enemy = 'machamp', b = { x: 400, y: 0 }, ball = { x: 0, y: -850 }) {
  const w = sandbox(
    [
      { pokemonId: caster, team: 0, pos: a },
      { pokemonId: enemy, team: 1, pos: b },
    ],
    ball,
  );
  addXp(w, w.players[0]!, gameplay.xp.levelThresholds[1]!); // unlock specials (Lv 2)
  return w;
}

describe('deterministic trig', () => {
  it('dsin matches Math.sin to 1e-9 across angles', () => {
    for (let a = -20; a <= 20; a += 0.37) expect(dsin(a)).toBeCloseTo(Math.sin(a), 9);
  });
  it('rotateDeg rotates counter-clockwise', () => {
    const v = rotateDeg({ x: 1, y: 0 }, 90);
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(1, 9);
  });
});

describe('casting rules', () => {
  it('moves cast on press, go on cooldown, and specials need level 2', () => {
    const w = sandbox([{ pokemonId: 'pikachu', team: 0, pos: { x: -500, y: 0 } }], { x: 0, y: -850 });
    expect(types(cast(w, 0, Button.Signature))).not.toContain('cast'); // Lv 1: locked
    expect(types(cast(w, 0, Button.Move1))).toContain('cast');
    expect(w.players[0]!.moves[0]!.cooldown).toBeGreaterThan(0);
    run(w, 5, [idle]);
    expect(types(cast(w, 0, Button.Move1))).not.toContain('cast'); // on cooldown
    addXp(w, w.players[0]!, gameplay.xp.levelThresholds[1]!);
    expect(types(cast(w, 0, Button.Signature))).toContain('cast');
  });

  it('Pokémon without a kit simply have no moves', () => {
    const w = sandbox([{ pokemonId: 'machamp', team: 0, pos: { x: 0, y: 0 } }]);
    expect(w.players[0]!.moves).toHaveLength(0);
    expect(types(cast(w, 0, Button.Move1))).not.toContain('cast');
  });
});

describe('Pikachu (Speedy Skirmisher)', () => {
  it('Thunder Shock fires 4 bolts over time; a bolt nudges the ball with a LIGHT hit', () => {
    const w = duel('pikachu', { x: -500, y: 0 }, 'machamp', { x: 600, y: 600 }, { x: -200, y: 0 });
    cast(w, 0, Button.Move1);
    const ids = new Set(w.projectiles.map((p) => p.id));
    for (let i = 0; i < 30; i++) {
      step(w, [idle, idle]);
      for (const p of w.projectiles) ids.add(p.id);
    }
    expect(ids.size).toBe(4);
    expect(w.ball.lastHitBy).toBe(0);
    expect(speedOf(w)).toBeGreaterThan(400);
  });

  it('bolts are LIGHT on players: slow, no knockback', () => {
    const w = duel('pikachu', { x: -300, y: 0 }, 'machamp', { x: 100, y: 0 });
    cast(w, 0, Button.Move1);
    const evs = run(w, 15, [idle, idle]);
    const hits = evs.filter((e) => e.type === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.type === 'hit' && h.light && h.knockback === 0)).toBe(true);
    expect(w.players[1]!.knockTicks).toBe(0);
  });

  it('Agility: +30 % speed for 5 s', () => {
    const w = duel('pikachu', { x: -300, y: 0 });
    const base = effectiveSpeed(w.players[0]!);
    cast(w, 0, Button.Move2);
    expect(effectiveSpeed(w.players[0]!)).toBeCloseTo(base * 1.3, 6);
    run(w, ticks(5), [idle, idle]);
    expect(effectiveSpeed(w.players[0]!)).toBeCloseTo(base, 6);
  });

  it('Volt Tackle dashes through an enemy and knocks it away', () => {
    const w = duel('pikachu', { x: -400, y: 0 }, 'machamp', { x: -50, y: 0 });
    cast(w, 0, Button.Signature);
    const evs = run(w, 40, [idle, idle]);
    expect(types(evs)).toContain('dash');
    expect(types(evs)).toContain('hit');
    expect(w.players[0]!.pos.x).toBeGreaterThan(100);
    expect(w.players[1]!.pos.x).toBeGreaterThan(0);
  });
});

describe('Snorlax (Stalwart Protector)', () => {
  it('Rollout winds up 0.5 s, then rolls a decelerating body that stops short of the range', () => {
    const w = duel('snorlax', { x: -700, y: 0 }, 'machamp', { x: 700, y: 700 });
    cast(w, 0, Button.Move1);
    expect(w.projectiles).toHaveLength(0);
    run(w, ticks(0.5), [idle, idle]);
    expect(w.projectiles).toHaveLength(1);
    let last = 0;
    for (let i = 0; i < TICK_RATE * 2 && w.projectiles.length; i++) {
      step(w, [idle, idle]);
      if (w.projectiles[0]) last = w.projectiles[0].traveled;
    }
    expect(w.projectiles).toHaveLength(0);
    expect(last).toBeLessThan(900);
    expect(last).toBeGreaterThan(600);
  });

  it('Body Slam hops in and stuns nearby enemies and the ball', () => {
    const w = duel('snorlax', { x: -400, y: 0 }, 'machamp', { x: 100, y: 0 }, { x: 80, y: -120 });
    cast(w, 0, Button.Move2);
    const evs = run(w, ticks(0.35) + 2, [idle, idle]);
    expect(types(evs)).toContain('area');
    expect(types(evs)).toContain('ballStun');
    expect(w.ball.stunTicks).toBeGreaterThan(0);
    const before = w.ball.vel;
    expect(before).toEqual({ x: 0, y: 0 });
  });

  it('Block raises 3 walls that the ball bounces off and players can’t cross, then expire', () => {
    const w = duel('snorlax', { x: -800, y: 0 }, 'machamp', { x: 700, y: 700 }, { x: -300, y: 0 });
    cast(w, 0, Button.Signature);
    expect(w.creations).toHaveLength(3);
    w.ball.pos = { x: 0, y: 0 };
    w.ball.vel = { x: -1200, y: 0 };
    run(w, 40, [idle, idle]);
    expect(w.ball.pos.x).toBeGreaterThan(-470); // walls at ~-470 stopped it
    run(w, ticks(2.5), [idle, idle]);
    expect(w.creations).toHaveLength(0);
  });
});

describe('Lucario (Flexible Brawler)', () => {
  it('Aura Sphere hits the first enemy hard', () => {
    const w = duel('lucario', { x: -400, y: 0 }, 'machamp', { x: 0, y: 0 });
    cast(w, 0, Button.Move1);
    const evs = run(w, 20, [idle, idle]);
    const hit = evs.find((e) => e.type === 'hit');
    expect(hit && hit.type === 'hit' && hit.knockback).toBeCloseTo(200 + 0.9 * 105, 6);
  });

  it('Extreme Speed dashes ~520 and Aura Sphere can be cast mid-dash', () => {
    const w = duel('lucario', { x: -600, y: -500 }, 'machamp', { x: 700, y: 700 });
    cast(w, 0, Button.Move2);
    step(w, [idle, idle]);
    expect(types(cast(w, 0, Button.Move1))).toContain('cast');
    run(w, 20, [idle, idle]);
    expect(w.players[0]!.pos.x + 600).toBeGreaterThan(480);
  });

  it('Close Combat: LIGHT jabs then a heavy final kick', () => {
    const w = duel('lucario', { x: -100, y: 0 }, 'machamp', { x: 80, y: 0 });
    cast(w, 0, Button.Signature);
    const evs = run(w, TICK_RATE, [idle, idle]);
    const hits = evs.filter((e) => e.type === 'hit');
    expect(hits.some((h) => h.type === 'hit' && h.light)).toBe(true);
    expect(hits.some((h) => h.type === 'hit' && !h.light && h.knockback > 300)).toBe(true);
  });
});

describe('Togekiss (Empowering Enchanter)', () => {
  it('Air Slash pierces: hits the ball and the enemy behind it', () => {
    const w = duel('togekiss', { x: -600, y: 0 }, 'machamp', { x: 0, y: 0 }, { x: -300, y: 0 });
    cast(w, 0, Button.Move1);
    const evs = run(w, 40, [idle, idle]);
    expect(types(evs)).toContain('ballHit');
    expect(types(evs)).toContain('hit');
  });

  it('Tailwind speeds up nearby allies and fades over 3 s', () => {
    const w = sandbox([
      { pokemonId: 'togekiss', team: 0, pos: { x: -300, y: 0 } },
      { pokemonId: 'pikachu', team: 0, slot: 1, pos: { x: -100, y: 0 } },
      { pokemonId: 'machamp', team: 1, pos: { x: 600, y: 600 } },
    ]);
    const base = effectiveSpeed(w.players[1]!);
    cast(w, 0, Button.Move2);
    expect(effectiveSpeed(w.players[1]!)).toBeCloseTo(base * 1.4, 1);
    run(w, ticks(1.5), [idle, idle, idle]);
    expect(effectiveSpeed(w.players[1]!)).toBeCloseTo(base * 1.2, 0);
  });

  it('Wish lands after 1 s at the target: heals allies, blasts enemies', () => {
    const w = sandbox(
      [
        { pokemonId: 'togekiss', team: 0, pos: { x: -600, y: 0 } },
        { pokemonId: 'pikachu', team: 0, slot: 1, pos: { x: 0, y: 100 } },
        { pokemonId: 'machamp', team: 1, pos: { x: 100, y: -100 } },
      ],
      { x: 0, y: -850 },
    );
    addXp(w, w.players[0]!, gameplay.xp.levelThresholds[1]!);
    const ally = w.players[1]!;
    applyHit(w, 2, ally, { dir: { x: 1, y: 0 }, knockback: 0, damage: 500 });
    const hurt = ally.stagger;
    cast(w, 0, Button.Signature, { x: 1, y: 0 }, 600);
    run(w, ticks(0.2) + ticks(1) + 2, [idle, idle, idle]);
    expect(ally.stagger).toBeGreaterThan(hurt + ally.maxStagger * 0.2);
    expect(w.players[2]!.lastHitBy).toBe(0);
  });
});

describe('interactions', () => {
  it('a knockback interrupts a dash', () => {
    const w = duel('lucario', { x: -400, y: 0 }, 'machamp', { x: 600, y: 600 });
    cast(w, 0, Button.Move2);
    expect(w.players[0]!.dash).not.toBeNull();
    applyHit(w, 1, w.players[0]!, { dir: { x: 0, y: 1 }, knockback: 200, damage: 0 });
    expect(w.players[0]!.dash).toBeNull();
  });

  it('a stunned ball ignores knockback', () => {
    const w = duel('pikachu', { x: -130, y: 0 }, 'machamp', { x: 600, y: 600 }, { x: 0, y: 0 });
    w.ball.stunTicks = 30;
    step(w, [quantizeInput(0, 0, 1, 0, Button.Strike), idle]);
    expect(w.ball.vel).toEqual({ x: 0, y: 0 });
  });

  it('projectiles, walls and dashes are cleared between rounds', () => {
    const w = duel('snorlax', { x: -800, y: 0 });
    cast(w, 0, Button.Signature);
    expect(w.creations.length).toBe(3);
    w.match.lastScoringTeam = 0;
    w.match.phase = 'goal';
    w.match.phaseTicks = 1;
    run(w, 2, [idle, idle]);
    expect(w.creations).toHaveLength(0);
    expect(w.players[0]!.moves[2]!.cooldown).toBeGreaterThan(0); // cooldowns persist
  });
});
