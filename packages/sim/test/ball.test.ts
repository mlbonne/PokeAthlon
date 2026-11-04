import { describe, expect, it } from 'vitest';
import { gameplay, getStage } from '@pokeathlon/data';
import { Button, createWorld, quantizeInput, step, ticks, TICK_RATE, type World } from '../src/index';
import { hitBall } from '../src/ball';

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
      const bounced = w.events.some((e) => e.type === 'ballWall');
      // Friction only ever slows it; wall rebounds may nudge a slow ball faster (OS rule).
      if (w.ball.hitstop === 0 && i > 10 && !bounced) expect(s).toBeLessThanOrEqual(prev + 1e-9);
      if (w.ball.hitstop === 0) prev = s;
      if (s === 0 && i > 10 && stoppedAt < 0) stoppedAt = i;
    }
    expect(stoppedAt).toBeGreaterThan(0);
  });

  it('bounces off walls and never leaves the arena', () => {
    const w = setup(650, 0);
    w.ball.pos = { x: 800, y: 0 };
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

  it('passes through player bodies (OS: no body blocking) when bodyBlocking is off', () => {
    expect(gameplay.ball.bodyBlocking).toBe(false);
    const w = createWorld([
      { pokemonId: 'pikachu', team: 0, pos: { x: -150, y: 0 } },
      { pokemonId: 'snorlax', team: 1, pos: { x: 600, y: 0 } },
    ]);
    step(w, [STRIKE(1, 0), idle]);
    for (let i = 0; i < TICK_RATE; i++) {
      step(w, [idle, idle]);
      expect(w.events.some((e) => e.type === 'ballBody')).toBe(false);
    }
    expect(w.ball.pos.x).toBeGreaterThan(600); // went straight past Snorlax
  });
});

/** Put the ball in motion directly (no hitstop) for physics checks. */
function moving(vx: number, vy: number, x = 0, y = 0): World {
  const w = createWorld([{ pokemonId: 'pikachu', team: 0, pos: { x: -1500, y: 900 } }]);
  w.ball.pos = { x, y };
  w.ball.vel = { x: vx, y: vy };
  return w;
}

describe('OS Core rules', () => {
  it('friction halves the speed in about one second', () => {
    const w = moving(1600, 0, -1500);
    for (let i = 0; i < TICK_RATE; i++) step(w, [idle]);
    expect(speedOf(w)).toBeGreaterThan(1600 * 0.48);
    expect(speedOf(w)).toBeLessThan(1600 * 0.52);
  });

  it('a hit sets the speed to its knockback, even against a faster ball coming the other way', () => {
    const w = moving(-1800, 0);
    hitBall(w, 0, { x: 1, y: 0 }, 1300);
    expect(Math.hypot(w.ball.launchVel.x, w.ball.launchVel.y)).toBeCloseTo(1300, 9);
  });

  it('knockback is capped at 2000', () => {
    const w = moving(0, 0);
    hitBall(w, 0, { x: 1, y: 0 }, 5000);
    expect(w.ball.launchVel.x).toBeCloseTo(2000, 9);
  });

  it('redirecting within the ~90° cone keeps a faster ball’s speed and adds 2.5 % of the hit', () => {
    const w = moving(1800, 0);
    hitBall(w, 0, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 1300); // 45° off the path: edge of the cone
    const last = w.events.at(-1)!;
    expect(last.type === 'ballHit' && last.redirect).toBe(true);
    expect(Math.hypot(w.ball.launchVel.x, w.ball.launchVel.y)).toBeCloseTo(1800 + 0.025 * 1300, 6);

    const w2 = moving(1800, 0);
    hitBall(w2, 0, { x: 0, y: 1 }, 1300); // 90° off the path: outside the cone
    expect(Math.hypot(w2.ball.launchVel.x, w2.ball.launchVel.y)).toBeCloseTo(1300, 9);
  });

  it('wall rebounds speed up a slow ball and slow down a fast one by ~100', () => {
    const slow = moving(600, 0, 1725);
    step(slow, [idle]);
    expect(slow.ball.vel.x).toBeLessThan(0); // bounced
    expect(speedOf(slow)).toBeGreaterThan(600 - 15 + 90);

    const fast = moving(1900, 0, 1725);
    step(fast, [idle]);
    expect(fast.ball.vel.x).toBeLessThan(0);
    expect(speedOf(fast)).toBeLessThan(1900 - 90);
  });

  it('hits over 1750 make a Red Core that ignores friction for 1 s', () => {
    const w = moving(0, 0, -1500);
    hitBall(w, 0, { x: 1, y: 0 }, 1900);
    expect(w.ball.redTicks).toBeGreaterThan(0);
    for (let i = 0; i < ticks(gameplay.ball.hitstop) + 1; i++) step(w, [idle]);
    const launched = speedOf(w);
    for (let i = 0; i < 30; i++) step(w, [idle]);
    expect(speedOf(w)).toBeCloseTo(launched, 6); // no friction yet
    for (let i = 0; i < TICK_RATE; i++) step(w, [idle]);
    expect(speedOf(w)).toBeLessThan(launched * 0.9); // friction back on
  });

  it('normal Strikes do not make a Red Core', () => {
    const w = setup();
    step(w, [STRIKE(1, 0)]);
    expect(w.ball.redTicks).toBe(0);
  });
});
