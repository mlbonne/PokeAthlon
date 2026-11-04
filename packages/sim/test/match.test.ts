import { describe, expect, it } from 'vitest';
import { gameplay } from '@pokeathlon/data';
import { buildStage, createWorld, hitBall, inGoalArc, pointInPolygon, ticks, TICK_RATE, type World } from '../src/index';
import { scoreGoal } from '../src/match';
import { idle, run, sandbox, types } from './helpers';

const M = gameplay.match;

describe('stage', () => {
  const s = buildStage('viridian-pitch');

  it('builds the OS frame: field, goal pockets, player outline', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, s.ballOutline)).toBe(true);
    expect(pointInPolygon({ x: 1600, y: 0 }, s.ballOutline)).toBe(true); // inside the right pocket
    expect(pointInPolygon({ x: -1600, y: 300 }, s.ballOutline)).toBe(true);
    expect(pointInPolygon({ x: 1600, y: 700 }, s.ballOutline)).toBe(false); // beside the pocket
    expect(pointInPolygon({ x: 0, y: 950 }, s.ballOutline)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 950 }, s.playerOutline)).toBe(true); // players reach 970
    expect(pointInPolygon({ x: 1580, y: 0 }, s.playerOutline)).toBe(false); // pocket back for players: 1535
  });

  it('team 0 defends the left goal; spawns mirror through the origin', () => {
    expect(s.goals[0].side).toBe(-1);
    expect(s.goals[0].score.x).toBe(-1560);
    expect(s.goals[1].score.x).toBe(1560);
    expect(s.spawns[1].goalie).toEqual({ x: 1100, y: -0 });
    expect(s.barriers.filter((b) => b.team === 1).map((b) => b.box.x)).toEqual([1300, 1300]);
  });

  it('Goal Arc only counts in front of the goal line', () => {
    expect(inGoalArc(s, 0, { x: -1100, y: 0 })).toBe(true);
    expect(inGoalArc(s, 0, { x: -800, y: 0 })).toBe(false);
    expect(inGoalArc(s, 1, { x: 1100, y: 300 })).toBe(true);
    expect(inGoalArc(s, 1, { x: -1100, y: 0 })).toBe(false);
  });
});

/** Team 0 striker far away; ball wherever the test puts it. */
function attackWorld(ball = { x: 0, y: 0 }): World {
  return sandbox(
    [
      { pokemonId: 'pikachu', team: 0, pos: { x: -900, y: -800 } },
      { pokemonId: 'snorlax', team: 1, pos: { x: -900, y: 800 } },
    ],
    ball,
  );
}

describe('barriers, gates and goals', () => {
  it('the ball breaks a barrier on contact and bounces back', () => {
    const w = attackWorld({ x: 1000, y: 300 });
    hitBall(w, 0, { x: 1, y: 0 }, 1500);
    const evs = run(w, 40, [idle, idle]);
    const brk = evs.find((e) => e.type === 'barrierBreak');
    expect(brk && brk.type === 'barrierBreak' && brk.team).toBe(1);
    expect(w.ball.vel.x).toBeLessThan(0);
    expect(w.barriers.filter((b) => b.team === 1 && b.alive)).toHaveLength(1);
    expect(w.players[0]!.stats.barriers).toBe(1);
  });

  it('a closed gate blocks the ball even with the barriers gone', () => {
    const w = attackWorld({ x: 1250, y: 0 });
    for (const b of w.barriers) b.alive = false;
    hitBall(w, 0, { x: 1, y: 0 }, 1500);
    const evs = run(w, 40, [idle, idle]);
    expect(types(evs)).not.toContain('goal');
    expect(w.ball.vel.x).toBeLessThan(0);
  });

  it('last barrier → gate opens after the delay → ball scores', () => {
    const w = attackWorld({ x: 1000, y: 300 });
    hitBall(w, 0, { x: 1, y: 0 }, 1500);
    run(w, 30, [idle, idle]);
    w.ball.pos = { x: 1000, y: -300 };
    w.ball.vel = { x: 0, y: 0 };
    hitBall(w, 0, { x: 1, y: 0 }, 1500);
    let evs = run(w, 20, [idle, idle]);
    expect(evs.filter((e) => e.type === 'barrierBreak')).toHaveLength(1);
    expect(w.gates[1].open).toBe(false);
    evs = run(w, ticks(M.gateOpenDelay), [idle, idle]);
    expect(types(evs)).toContain('gateOpen');
    expect(w.gates[1].open).toBe(true);

    w.ball.pos = { x: 1200, y: 0 };
    w.ball.vel = { x: 0, y: 0 };
    hitBall(w, 0, { x: 1, y: 0 }, 1500);
    evs = run(w, 30, [idle, idle]);
    const goal = evs.find((e) => e.type === 'goal');
    expect(goal && goal.type === 'goal' && goal.team).toBe(0);
    expect(goal && goal.type === 'goal' && goal.scorer).toBe(0);
    expect(w.match.goals).toEqual([1, 0]);
    expect(w.match.phase).toBe('goal');
    expect(w.ball.scored).toBe(true);
    expect(w.players[0]!.stats.goals).toBe(1);
  });
});

/** Match-mode world ready for live play. */
function liveMatch(): World {
  const w = createWorld(
    [
      { pokemonId: 'pikachu', team: 0 },
      { pokemonId: 'lucario', team: 1 },
    ],
    { mode: 'match' },
  );
  run(w, ticks(M.kickoff));
  expect(w.match.phase).toBe('play');
  return w;
}

describe('match flow', () => {
  it('kickoff: players at their starts, ball on a side spot, then play', () => {
    const w = createWorld([{ pokemonId: 'pikachu', team: 0 }], { mode: 'match' });
    expect(w.match.phase).toBe('kickoff');
    expect(w.players[0]!.pos).toEqual(w.stage.spawns[0].forwards[0]);
    expect(w.ball.pos).toEqual(w.stage.ballSpawns[0]);
    const evs = run(w, ticks(M.kickoff));
    expect(types(evs)).toContain('play');
  });

  it('after a goal: pause, then a fresh round with barriers restored and the ball on the other spot', () => {
    const w = liveMatch();
    w.barriers[0]!.alive = false;
    w.players[0]!.pos = { x: 500, y: 500 };
    scoreGoal(w, 0);
    expect(w.match.phase).toBe('goal');
    const evs = run(w, ticks(M.goalPause));
    expect(types(evs)).toContain('kickoff');
    expect(w.match.phase).toBe('kickoff');
    expect(w.barriers.every((b) => b.alive)).toBe(true);
    expect(w.players[0]!.pos).toEqual(w.stage.spawns[0].forwards[0]);
    expect(w.ball.pos).toEqual(w.stage.ballSpawns[1]);
  });

  it(`first to ${M.goalsPerSet} goals wins a set; first to ${M.setsToWin} sets wins the match`, () => {
    const w = liveMatch();
    const all: string[] = [];
    for (let set = 0; set < M.setsToWin; set++) {
      for (let g = 0; g < M.goalsPerSet; g++) {
        scoreGoal(w, 1);
        all.push(...types(run(w, ticks(M.goalPause) + ticks(M.setPause) + ticks(M.kickoff) + 2)));
      }
    }
    expect(all.filter((t) => t === 'setWon')).toHaveLength(M.setsToWin);
    expect(all).toContain('matchWon');
    expect(w.match.phase).toBe('matchOver');
    expect(w.match.winner).toBe(1);
  });

  it('energy resets to 25 at the start of a new set', () => {
    const w = liveMatch();
    w.players[0]!.energy = 70;
    for (let g = 0; g < M.goalsPerSet; g++) {
      scoreGoal(w, 0);
      run(w, ticks(M.goalPause) + ticks(M.setPause) + ticks(M.kickoff) + 2);
    }
    expect(w.match.sets).toEqual([1, 0]);
    expect(w.players[0]!.energy).toBe(gameplay.energy.start);
  });

  it(`overtime starts after ${M.overtimeAfter} s of play`, () => {
    const w = liveMatch();
    const evs = run(w, ticks(M.overtimeAfter) + 1);
    expect(types(evs)).toContain('overtime');
    expect(w.match.overtime).toBe(true);
  });

  it('own goals count for the other team and credit no scorer', () => {
    const w = liveMatch();
    w.ball.lastHitBy = 1; // team 1 touched it last…
    scoreGoal(w, 0); // …but it went into team 1's goal
    const g = w.events.find((e) => e.type === 'goal');
    expect(g && g.type === 'goal' && g.ownGoal).toBe(true);
    expect(w.players[1]!.stats.goals).toBe(0);
  });

  it('assists: teammates who touched the ball in the last 3 s', () => {
    const w = createWorld(
      [
        { pokemonId: 'pikachu', team: 0, slot: 0 },
        { pokemonId: 'greninja', team: 0, slot: 1 },
        { pokemonId: 'snorlax', team: 1, role: 'goalie' },
      ],
      { mode: 'match' },
    );
    run(w, ticks(M.kickoff));
    w.players[1]!.lastBallTouchTick = w.tick - TICK_RATE;
    w.ball.lastHitBy = 0;
    scoreGoal(w, 0);
    const g = w.events.find((e) => e.type === 'goal');
    expect(g && g.type === 'goal' && g.assists).toEqual([1]);
  });
});
