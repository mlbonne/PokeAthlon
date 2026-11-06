import { describe, expect, it } from 'vitest';
import {
  botInput,
  collideSegment,
  createWorld,
  hashWorld,
  pointInPolygon,
  quantizeInput,
  step,
  TICK_RATE,
} from '../src/index';
import { run, sandbox } from './helpers';

const spawn = () => sandbox([{ pokemonId: 'zeraora', team: 0, pos: { x: -600, y: 0 } }], { x: 0, y: 600 });

describe('movement', () => {
  it('reaches the pokemon top speed and travels about speed × time', () => {
    const w = spawn();
    run(w, TICK_RATE, [quantizeInput(1, 0)]);
    const p = w.players[0]!;
    expect(p.vel.x).toBeCloseTo(465, 6);
    expect(p.pos.x + 600).toBeGreaterThan(440);
    expect(p.pos.x + 600).toBeLessThan(465);
  });

  it('normalises diagonal movement', () => {
    const w = spawn();
    run(w, TICK_RATE, [quantizeInput(1, 1)]);
    const v = w.players[0]!.vel;
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(465, 3);
  });

  it('stops when input is released', () => {
    const w = spawn();
    run(w, 30, [quantizeInput(0, 1)]);
    run(w, 30);
    expect(w.players[0]!.vel).toEqual({ x: 0, y: 0 });
  });

  it('walking into any edge or corner never leaves the arena (and never KOs)', () => {
    for (const dir of [
      [1, 1],
      [-1, 1],
      [0, -1],
      [1, -0.2],
    ] as const) {
      const w = spawn();
      const evs = run(w, TICK_RATE * 12, [quantizeInput(dir[0], dir[1])]);
      const p = w.players[0]!;
      expect(evs.some((e) => e.type === 'ko')).toBe(false);
      expect(pointInPolygon(p.pos, w.stage.playerOutline)).toBe(true);
      // Not overlapping any wall.
      for (const s of w.stage.playerWalls) {
        const probe = { x: p.pos.x, y: p.pos.y };
        expect(collideSegment(probe, { x: 0, y: 0 }, p.radius - 1e-6, s, 0)).toBe(0);
      }
    }
  });

  it('players are frozen during the kickoff countdown', () => {
    const w = createWorld([{ pokemonId: 'zeraora', team: 0 }], { mode: 'match' });
    const start = { ...w.players[0]!.pos };
    run(w, 60, [quantizeInput(1, 0)]);
    expect(w.match.phase).toBe('kickoff');
    expect(w.players[0]!.pos).toEqual(start);
  });
});

describe('determinism', () => {
  it('bot vs bot match: same inputs → identical state hash, and the ball gets played', () => {
    const play = () => {
      const w = createWorld(
        [
          { pokemonId: 'zeraora', team: 0 },
          { pokemonId: 'bronzong', team: 1 },
        ],
        { mode: 'match' },
      );
      let hits = 0;
      for (let i = 0; i < TICK_RATE * 40; i++) {
        step(w, [botInput(w, 0), botInput(w, 1)]);
        hits += w.events.filter((e) => e.type === 'ballHit').length;
      }
      return { hash: hashWorld(w), hits };
    };
    const a = play();
    expect(a.hits).toBeGreaterThan(5);
    expect(play()).toEqual(a);
  });
});
