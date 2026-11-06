import { describe, expect, it } from 'vitest';
import {
  createWorld,
  DIFFICULTY,
  evaluateShot,
  moveModels,
  parseLineup,
  perceive,
  practiceDisableBarriers,
  predictBall,
  runHeadless,
  smartBotInput,
  step,
  teamJobs,
  type World,
} from '../src/index';
import { sandbox } from './helpers';

const trio = parseLineup('pikachu,lucario,bronzong/togekiss,lucario,bronzong');

describe('bot brain v2', () => {
  it('is deterministic: same seed, same match', () => {
    const a = runHeadless(parseLineup('pikachu/lucario'), { seed: 5, until: 'goal' });
    const b = runHeadless(parseLineup('pikachu/lucario'), { seed: 5, until: 'goal' });
    expect(a.hash).toBe(b.hash);
  });

  it('beats the v1 bot in mirror matches (sides swapped)', () => {
    let v2 = 0;
    for (let s = 1; s <= 4; s++) {
      const swap = s % 2 === 0;
      const r = runHeadless(parseLineup('pikachu/pikachu'), { seed: s, brains: swap ? ['v1', 'v2'] : ['v2', 'v1'], until: 'set', maxMinutes: 10 });
      if (r.sets[swap ? 1 : 0] === 1) v2++; // `until: 'set'` → whoever took the first set
    }
    expect(v2).toBeGreaterThanOrEqual(3);
  });

  it('3v3 teams have one striker and one goalie each, and jobs rotate during play', () => {
    const w = createWorld(trio, { mode: 'match', seed: 2 });
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 60; i++) {
      step(w, w.players.map((p) => smartBotInput(w, p.id)));
      if (w.match.phase !== 'play') continue;
      const perc = perceive(w);
      for (const team of [0, 1] as const) {
        const jobs = teamJobs(w, team, perc, DIFFICULTY.balance).filter((j, id) => j && w.players[id]!.team === team && w.players[id]!.koTicks === 0);
        expect(jobs.filter((j) => j === 'striker').length).toBeLessThanOrEqual(1);
        expect(jobs.filter((j) => j === 'goalie').length).toBeLessThanOrEqual(1);
      }
      w.players.forEach((p, id) => seen.add(`${p.role}:${w.ai.bots[id]?.action.split(':')[0]}`));
    }
    // Forwards take turns at striker and support; goalies guard (and sometimes step up).
    expect(seen.has('forward:striker')).toBe(true);
    expect(seen.has('forward:support')).toBe(true);
    expect(seen.has('goalie:goalie')).toBe(true);
  });

  it('hardly ever whiffs a Strike (hold-to-strike timing)', () => {
    const r = runHeadless(trio, { seed: 3, until: 'set' });
    for (const p of r.telemetry.players) {
      const s = p.moves.strike;
      if (!s) continue;
      expect(s.ballHits / s.casts).toBeGreaterThan(0.85);
    }
  });

  it('every kit gets a move model, and bots use their moves', () => {
    for (const id of ['pikachu', 'lucario', 'bronzong', 'togekiss']) expect(moveModels(id)).toHaveLength(3);
    const r = runHeadless(trio, { seed: 4, until: 'set' });
    const casts = r.telemetry.players.reduce((s, p) => s + Object.entries(p.moves).filter(([k]) => k !== 'strike').reduce((a, [, m]) => a + m.casts, 0), 0);
    expect(casts).toBeGreaterThan(20);
  });

  it('difficulty levels exist and get stricter', () => {
    expect(DIFFICULTY.easy.reactionTicks).toBeGreaterThan(DIFFICULTY.hard.reactionTicks);
    expect(DIFFICULTY.easy.aimErrorDeg).toBeGreaterThan(DIFFICULTY.hard.aimErrorDeg);
  });
});

describe('shot evaluation', () => {
  const open = (): World => {
    const w = sandbox(
      [
        { pokemonId: 'pikachu', team: 0, pos: { x: 600, y: 0 } },
        { pokemonId: 'lucario', team: 1, pos: { x: -900, y: 600 } },
      ],
      { x: 700, y: 0 },
    );
    practiceDisableBarriers(w);
    return w;
  };

  it('a shot at the open enemy goal scores high; one into our own goal is terrible', () => {
    const w = open();
    const goal = evaluateShot(w, 0, w.ball.pos, { x: 1, y: 0 }, 1500);
    const own = evaluateShot(w, 0, w.ball.pos, { x: -1, y: 0 }, 2000);
    expect(goal.kind).toBe('goal');
    expect(goal.score).toBeGreaterThan(80);
    expect(own.score).toBeLessThan(goal.score);
  });

  it('predictBall can launch a hypothetical hit and reports broken barriers', () => {
    const w = sandbox([{ pokemonId: 'pikachu', team: 0, pos: { x: 0, y: 0 } }], { x: 900, y: 370 });
    const pred = predictBall(w, 60, { vel: { x: 1500, y: 0 } });
    expect(pred.barriersBroken.length).toBeGreaterThan(0);
    expect(w.barriers.every((b) => b.alive)).toBe(true); // the real world is untouched
  });
});
