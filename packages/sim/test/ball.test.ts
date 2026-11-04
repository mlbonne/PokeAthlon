import { describe, expect, it } from 'vitest';
import { gameplay, getStage } from '@pokeathlon/data';
import { Button, createWorld, quantizeInput, step, ticks, TICK_RATE, type World } from '../src/index';

const STRIKE = (aimX: number, aimY: number) => quantizeInput(0, 0, aimX, aimY, Button.Strike);
const idle = quantizeInput(0, 0);
const speedOf = (w: World) => Math.hypot(w.ball.vel.x, w.ball.vel.y);

/** Pikachu (power 95) standing just left of the ball at the centre. */
function setup(dx = -150, dy = 0): World {
  return createWorld([{ pokemonId: 'pikachu', team: 0, pos: { x: dx, y: dy } }]);
}

describe('strike', () => {
  it('launches the ball in the aimed direction at base + ratio × power, after hitstop', () => {
    const w = setup();
    step(w, [STRIKE(0, 1)]); // aim straight up, ball is to the right: direction comes from aim
    expect(w.events.map((e) => e.type)).toEqual(['strike', 'ballHit']);
    expect(w.ball.vel).toEqual({ x: 0, y: 0 }); // frozen during hitstop

    for (let i = 0; i < ticks(gameplay.ball.hitstop); i++) step(w, [idle]);
    expect(w.events.some((e) => e.type === 'ballLaunch')).toBe(true);

    const expected = 1230 + 1.25 * 95;
    expect(w.ball.vel.x).toBeCloseTo(0, 9);
    // One tick of friction may already be applied on the launch tick's successor.
    expect(speedOf(w)).toBeCloseTo(expected, 6);
    expect(w.ball.lastHitBy).toBe(0);
  });

  it('can hit a ball slightly behind the player', () => {
    const w = setup(150, 0); // ball is behind (to the left), facing right
    step(w, [STRIKE(1, 0)]);
    expect(w.events.some((e) => e.type === 'ballHit')).toBe(true);
  });

  it('misses when the ball is out of reach', () => {
    const w = setup(-400, 0);
    step(w, [STRIKE(1, 0)]);
    expect(w.events.map((e) => e.type)).toEqual(['strike']);
  });

  it('respects the 0.9 s cooldown and connects once per strike', () => {
    const w = setup();
    let strikes = 0;
    let hits = 0;
    for (let i = 0; i < TICK_RATE; i++) {
      step(w, [STRIKE(1, 0)]);
      strikes += w.events.filter((e) => e.type === 'strike').length;
      hits += w.events.filter((e) => e.type === 'ballHit').length;
    }
    // 60 ticks, cooldown 54 ticks → strikes on tick 0 and tick 54.
    expect(strikes).toBe(2);
    expect(hits).toBe(1); // the ball is long gone before the second swing
  });

  it('uses facing when there is no aim input', () => {
    const w = setup();
    step(w, [quantizeInput(0, 0, 0, 0, Button.Strike)]);
    expect(w.players[0]!.strikeDir).toEqual({ x: 1, y: 0 }); // team 0 faces right
  });
});

describe('ball physics', () => {
  it('slows down and eventually stops', () => {
    const w = setup();
    step(w, [STRIKE(0, 1)]);
    let prev = Infinity;
    let stoppedAt = -1;
    for (let i = 0; i < TICK_RATE * 10; i++) {
      step(w, [idle]);
      const s = speedOf(w);
      if (w.ball.hitstop === 0 && i > 10) expect(s).toBeLessThanOrEqual(prev + 1e-9);
      if (w.ball.hitstop === 0) prev = s;
      if (s === 0 && i > 10 && stoppedAt < 0) stoppedAt = i;
    }
    expect(stoppedAt).toBeGreaterThan(0);
  });

  it('bounces off walls and never leaves the arena', () => {
    const w = setup();
    step(w, [STRIKE(1, 0.37)]);
    const a = getStage('viridian-pitch');
    let walls = 0;
    for (let i = 0; i < TICK_RATE * 6; i++) {
      step(w, [idle]);
      walls += w.events.filter((e) => e.type === 'ballWall').length;
      expect(Math.abs(w.ball.pos.x)).toBeLessThanOrEqual(a.halfWidth - w.ball.radius + 1e-6);
      expect(Math.abs(w.ball.pos.y)).toBeLessThanOrEqual(a.halfHeight - w.ball.radius + 1e-6);
    }
    expect(walls).toBeGreaterThan(0);
  });

  it('is blocked by player bodies', () => {
    const w = createWorld([
      { pokemonId: 'pikachu', team: 0, pos: { x: -150, y: 0 } },
      { pokemonId: 'snorlax', team: 1, pos: { x: 600, y: 0 } },
    ]);
    step(w, [STRIKE(1, 0), idle]);
    let blocked = false;
    for (let i = 0; i < TICK_RATE; i++) {
      step(w, [idle, idle]);
      if (w.events.some((e) => e.type === 'ballBody' && e.playerId === 1)) blocked = true;
    }
    expect(blocked).toBe(true);
    expect(w.ball.pos.x).toBeLessThan(600); // bounced back, never passed through Snorlax
  });

  it('momentum carry makes return hits faster than the base launch', () => {
    const w = setup();
    step(w, [STRIKE(1, 0)]);
    for (let i = 0; i < ticks(gameplay.ball.hitstop) + 1; i++) step(w, [idle]);
    // Teleport the ball back into reach while it is moving fast, then strike again.
    w.ball.pos = { x: -100, y: 0 };
    w.players[0]!.strikeCooldown = 0;
    step(w, [STRIKE(1, 0)]);
    const hit = w.events.find((e) => e.type === 'ballHit');
    expect(hit && hit.type === 'ballHit' && hit.speed).toBeGreaterThan(1230 + 1.25 * 95);
  });
});
