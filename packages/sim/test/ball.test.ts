import { describe, expect, it } from 'vitest';
import { gameplay } from '@pokeathlon/data';
import { Button, hitBall, pointInPolygon, quantizeInput, step, ticks, TICK_RATE, type World } from '../src/index';
import { idle, run, sandbox, speedOf } from './helpers';

const STRIKE = (aimX: number, aimY: number) => quantizeInput(0, 0, aimX, aimY, Button.Strike);
const PIKACHU_KB = 1230 + 1.25 * 95;

/** Pikachu (power 95) standing `dx` from a ball at (0, by). */
function setup(dx = -130, by = 0): World {
  return sandbox([{ pokemonId: 'pikachu', team: 0, pos: { x: dx, y: by } }], { x: 0, y: by });
}

describe('strike', () => {
  it('launches the ball instantly in the aimed direction at base + ratio × power (OS: no hit freeze)', () => {
    const w = setup();
    step(w, [STRIKE(0, 1)]);
    expect(w.events.map((e) => e.type)).toEqual(['strike', 'ballHit', 'ballLaunch']);
    expect(w.ball.vel.x).toBeCloseTo(0, 9);
    expect(speedOf(w)).toBeCloseTo(PIKACHU_KB, 6);
    expect(w.ball.lastHitBy).toBe(0);
  });

  it('can hit a ball slightly behind the player', () => {
    const w = setup(130);
    step(w, [STRIKE(1, 0)]);
    expect(w.events.some((e) => e.type === 'ballHit')).toBe(true);
  });

  it('reach = hit-volume radius + full ball radius (OS overlap): 125 + 47.5 for Normal', () => {
    const hit = setup(-172);
    step(hit, [STRIKE(1, 0)]);
    expect(hit.events.some((e) => e.type === 'ballHit')).toBe(true);
    const miss = setup(-174);
    step(miss, [STRIKE(1, 0)]);
    expect(miss.events.map((e) => e.type)).toEqual(['strike']);
  });

  it('Very Large strikers (Snorlax) get the OS Large Strike: diameter 285', () => {
    const w = sandbox([{ pokemonId: 'snorlax', team: 0, pos: { x: -189, y: 0 } }], { x: 0, y: 0 });
    expect(w.players[0]!.strikeRadius).toBe(142.5);
    step(w, [STRIKE(1, 0)]);
    expect(w.events.some((e) => e.type === 'ballHit')).toBe(true);
  });

  it('a press always swings: a whiff costs the 0.9 s cooldown', () => {
    const w = setup(-400);
    const evs = [];
    for (let i = 0; i < TICK_RATE; i++) {
      step(w, [i % 2 === 0 ? STRIKE(1, 0) : idle]); // mash: press, release, press…
      evs.push(...w.events);
    }
    // 0.9 s cooldown → swings at tick 0 and tick 54 only.
    expect(evs.filter((e) => e.type === 'strike')).toHaveLength(2);
    expect(evs.some((e) => e.type === 'ballHit')).toBe(false);
  });

  it('holding Strike never whiffs and auto-strikes the moment the ball comes into reach', () => {
    const w = setup(-600);
    w.players[0]!.prevButtons = Button.Strike; // already holding from before
    w.ball.vel = { x: -800, y: 0 }; // ball rolling towards the player
    const evs = run(w, TICK_RATE, [STRIKE(0, 1)]);
    const strikes = evs.filter((e) => e.type === 'strike');
    expect(strikes).toHaveLength(1);
    expect(evs.some((e) => e.type === 'ballHit')).toBe(true);
    expect(w.ball.vel.y).toBeGreaterThan(0); // sent where we aimed
  });

  it('uses facing when there is no aim input', () => {
    const w = setup();
    step(w, [quantizeInput(0, 0, 0, 0, Button.Strike)]);
    expect(w.players[0]!.strikeDir).toEqual({ x: 1, y: 0 });
  });

  it('gives +1 Energy and XP for touching the ball', () => {
    const w = setup();
    const e0 = w.players[0]!.energy;
    step(w, [STRIKE(0, 1)]);
    expect(w.players[0]!.energy).toBe(e0 + 1);
    expect(w.players[0]!.xp).toBe(gameplay.xp.strikeBall);
  });
});

describe('ball physics', () => {
  it('slows down and eventually stops', () => {
    const w = setup(-130, -500);
    step(w, [STRIKE(0, 1)]);
    let prev = Infinity;
    let stopped = false;
    for (let i = 0; i < TICK_RATE * 10; i++) {
      step(w, [idle]);
      const s = speedOf(w);
      const bounced = w.events.some((e) => e.type === 'ballWall');
      if (w.ball.hitstop === 0 && i > 10 && !bounced) expect(s).toBeLessThanOrEqual(prev + 1e-9);
      if (w.ball.hitstop === 0) prev = s;
      if (s === 0 && i > 10) stopped = true;
    }
    expect(stopped).toBe(true);
  });

  it('bounces off walls and never leaves the ball outline', () => {
    const w = setup(-130, 300);
    step(w, [STRIKE(0.3, 1)]);
    let walls = 0;
    for (let i = 0; i < TICK_RATE * 6; i++) {
      step(w, [idle]);
      walls += w.events.filter((e) => e.type === 'ballWall').length;
      expect(pointInPolygon(w.ball.pos, w.stage.ballOutline)).toBe(true);
    }
    expect(walls).toBeGreaterThan(0);
  });

  it('passes through player bodies (OS: no body blocking)', () => {
    expect(gameplay.ball.bodyBlocking).toBe(false);
    const w = sandbox(
      [
        { pokemonId: 'pikachu', team: 0, pos: { x: -130, y: -600 } },
        { pokemonId: 'snorlax', team: 1, pos: { x: 500, y: -600 } },
      ],
      { x: 0, y: -600 },
    );
    step(w, [STRIKE(1, 0), idle]);
    const evs = run(w, TICK_RATE, [idle, idle]);
    expect(evs.some((e) => e.type === 'ballBody')).toBe(false);
    expect(w.ball.pos.x).toBeGreaterThan(500);
  });
});

/** Put the ball in motion directly (no hitstop) for physics checks. */
function moving(vx: number, vy: number, x = 0, y = 0): World {
  const w = sandbox([{ pokemonId: 'pikachu', team: 0, pos: { x: -900, y: 800 } }], { x, y });
  w.ball.vel = { x: vx, y: vy };
  return w;
}

describe('OS Core rules', () => {
  it('friction halves the speed in about one second', () => {
    const w = moving(1600, 0, -900);
    run(w, TICK_RATE, [idle]);
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
    hitBall(w, 0, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 1300);
    const last = w.events.at(-1)!;
    expect(last.type === 'ballHit' && last.redirect).toBe(true);
    expect(Math.hypot(w.ball.launchVel.x, w.ball.launchVel.y)).toBeCloseTo(1800 + 0.025 * 1300, 6);

    const w2 = moving(1800, 0);
    hitBall(w2, 0, { x: 0, y: 1 }, 1300);
    expect(Math.hypot(w2.ball.launchVel.x, w2.ball.launchVel.y)).toBeCloseTo(1300, 9);
  });

  it('wall rebounds speed up a slow ball and slow down a fast one by ~100', () => {
    const slow = moving(0, 600, 0, 855);
    run(slow, 2, [idle]);
    expect(slow.ball.vel.y).toBeLessThan(0);
    expect(speedOf(slow)).toBeGreaterThan(600 - 25 + 90);

    const fast = moving(0, 1900, 0, 855);
    run(fast, 2, [idle]);
    expect(fast.ball.vel.y).toBeLessThan(0);
    expect(speedOf(fast)).toBeLessThan(1900 - 90);
  });

  it('hits over 1750 make a Red Core that ignores friction for 1 s', () => {
    const w = moving(0, 0, -900, -600);
    hitBall(w, 0, { x: 1, y: 0 }, 1900);
    expect(w.ball.redTicks).toBeGreaterThan(0);
    run(w, ticks(gameplay.ball.hitstop) + 1, [idle]);
    const launched = speedOf(w);
    run(w, 30, [idle]);
    expect(speedOf(w)).toBeCloseTo(launched, 6);
    run(w, TICK_RATE, [idle]);
    expect(speedOf(w)).toBeLessThan(launched * 0.9);
  });

  it('overtime adds 20 % to ball knockback', () => {
    const w = moving(0, 0);
    w.match.overtime = true;
    hitBall(w, 0, { x: 1, y: 0 }, 1000);
    expect(w.ball.launchVel.x).toBeCloseTo(1200, 9);
  });
});

describe('ball containment', () => {
  it('a wall created on top of the ball near a corner cannot push it out of the arena', async () => {
    const { pointInPolygon, practiceDisableBarriers } = await import('../src/index');
    const w = sandbox([{ pokemonId: 'snorlax', team: 1, pos: { x: 700, y: 650 } }], { x: 1025, y: 797 });
    practiceDisableBarriers(w);
    // Snorlax's Block (3 walls, 330 out) aimed at the ball in the corner — the M4.4 escape case.
    step(w, [quantizeInput(0, 0, 0.9, 0.42, Button.Signature)]);
    w.players[0]!.level = 2;
    w.players[0]!.moves[2]!.cooldown = 0;
    step(w, [quantizeInput(0, 0, 0.9, 0.42, 0)]);
    step(w, [quantizeInput(0, 0, 0.9, 0.42, Button.Signature)]);
    for (let i = 0; i < 120; i++) {
      step(w, [quantizeInput(0, 0)]);
      expect(pointInPolygon(w.ball.pos, w.stage.ballOutline)).toBe(true);
    }
  });
});
