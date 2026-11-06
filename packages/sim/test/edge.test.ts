import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../src/geometry';
import { idle, run, sandbox } from './helpers';

/** Regression: a player got stuck outside the arena after dashing through the edge. */
describe('arena edge', () => {
  const dashAt = (dir: { x: number; y: number }, speed: number) => {
    const w = sandbox([{ pokemonId: 'zeraora', team: 0, pos: { x: 0, y: 0 } }], { x: 0, y: -850 });
    const p = w.players[0]!;
    const sideY = Math.max(...w.stage.playerOutline.map((v) => v.y));
    p.pos = { x: dir.x * (sideY - 40), y: dir.y * (sideY - 40) };
    p.dash = {
      moveId: 'test',
      vel: { x: dir.x * speed, y: dir.y * speed },
      ticks: 6,
      hit: undefined,
      stopOnHit: false,
      castWhileDashing: false,
      hitIds: [],
      ballHit: false,
      guard: null,
    };
    run(w, 10, [idle]);
    return { w, p };
  };

  it('a dash fast enough to cross the edge in one tick stops inside (no KO, not stuck outside)', () => {
    for (const speed of [3000, 12000, 40000]) {
      const { w, p } = dashAt({ x: 0, y: 1 }, speed);
      expect(p.koTicks).toBe(0);
      expect(pointInPolygon(p.pos, w.stage.playerOutline)).toBe(true);
    }
  });

  it('a player already outside while walking is pulled back in', () => {
    const w = sandbox([{ pokemonId: 'zeraora', team: 0, pos: { x: 0, y: 0 } }], { x: 0, y: -850 });
    const p = w.players[0]!;
    p.pos = { x: -1200, y: 900 };
    run(w, 2, [idle]);
    expect(pointInPolygon(p.pos, w.stage.playerOutline)).toBe(true);
  });
});
