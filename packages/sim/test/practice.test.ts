import { describe, expect, it } from 'vitest';
import {
  Button,
  createWorld,
  parseLineup,
  practiceClearCooldowns,
  practiceDamage,
  practiceDestroyTeam,
  practiceDisableBarriers,
  practiceKnockBack,
  practiceRemoveBall,
  practiceResetAll,
  practiceRestoreBarriers,
  practiceSetEnergy,
  practiceSetOvertime,
  practiceSpawnBall,
  practiceSpawnEnemy,
  practiceStagger,
  predictBall,
  quantizeInput,
  runHeadless,
  step,
} from '../src/index';
import { idle, run, sandbox } from './helpers';

describe('ball prediction', () => {
  it('matches the real ball when nobody touches it, and leaves the world unchanged', () => {
    const w = sandbox([{ pokemonId: 'pikachu', team: 0, pos: { x: 0, y: 800 } }], { x: 0, y: 0 });
    w.ball.vel = { x: 1500, y: 300 };
    const before = JSON.stringify(w.ball);
    const pred = predictBall(w, 60);
    expect(JSON.stringify(w.ball)).toBe(before);
    run(w, 60, [idle]);
    const last = pred.path[59]!;
    expect(last.x).toBeCloseTo(w.ball.pos.x, 6);
    expect(last.y).toBeCloseTo(w.ball.pos.y, 6);
  });

  it('reports the goal a ball is heading into', () => {
    const w = sandbox([{ pokemonId: 'pikachu', team: 0, pos: { x: 0, y: 800 } }], { x: 1000, y: 0 });
    practiceDisableBarriers(w);
    w.ball.vel = { x: 2000, y: 0 };
    const pred = predictBall(w, 120);
    expect(pred.goalAgainst).toBe(1); // the +x goal belongs to team 1
    expect(pred.ticks).toBeLessThan(60);
  });
});

describe('shots, saves, redirects, ball speed', () => {
  it('a Strike at an open goal is a shot; the defender touching it is a save', () => {
    const w = sandbox(
      [
        { pokemonId: 'pikachu', team: 0, pos: { x: 780, y: 0 } },
        { pokemonId: 'lucario', team: 1, pos: { x: 1200, y: 0 } },
      ],
      { x: 900, y: 0 },
    );
    practiceDisableBarriers(w);
    w.gates[1].open = true;
    step(w, [quantizeInput(0, 0, 1, 0, Button.Strike), idle]);
    expect(w.telemetry.players[0]!.shots).toBe(1);
    expect(w.telemetry.liveShot).toEqual({ by: 0, against: 1 });
    // The goalie swings at it as it arrives.
    for (let i = 0; i < 20 && w.telemetry.players[1]!.ballTouches === 0; i++) step(w, [idle, quantizeInput(0, 0, -1, 0, Button.Strike)]);
    expect(w.telemetry.players[1]!.saves).toBe(1);
    expect(w.telemetry.ball.maxSpeed).toBeGreaterThan(1000);
  });

  it('a whole bot match records shots, saves and goal speeds consistently', () => {
    const r = runHeadless(parseLineup('pikachu/lucario'), { seed: 2, until: 'set' });
    const t = r.telemetry;
    const goals = t.players.reduce((s, p) => s + p.goals, 0);
    const shots = t.players.reduce((s, p) => s + p.shots, 0);
    expect(shots).toBeGreaterThan(0);
    expect(t.ball.goalSpeeds.length).toBe(t.goals[0] + t.goals[1]);
    expect(goals).toBeLessThanOrEqual(t.goals[0] + t.goals[1]);
    expect(t.ball.maxSpeed).toBeGreaterThanOrEqual(Math.max(...t.ball.goalSpeeds));
  });
});

describe('practice controls', () => {
  const duel = () => createWorld(parseLineup('pikachu/lucario'), { mode: 'sandbox' });

  it('spawns, swaps and destroys the enemy, keeping ids, telemetry and RNG in step', () => {
    const w = duel();
    practiceSpawnEnemy(w, 'snorlax');
    expect(w.players.map((p) => p.pokemonId)).toEqual(['pikachu', 'snorlax']);
    expect(w.telemetry.players.map((t) => t.pokemon)).toEqual(['pikachu', 'snorlax']);
    expect(w.ai.rng).toHaveLength(2);
    practiceDestroyTeam(w, 1);
    expect(w.players).toHaveLength(1);
    expect(w.telemetry.players).toHaveLength(1);
    practiceSpawnEnemy(w, 'togekiss');
    expect(w.players.map((p) => p.id)).toEqual([0, 1]);
    run(w, 30, [idle, idle]); // still steps fine
  });

  it('stagger, damage, knockback and energy', () => {
    const w = duel();
    practiceDamage(w, 1, 0.25);
    expect(w.players[1]!.stagger).toBeCloseTo(w.players[1]!.maxStagger * 0.75);
    practiceStagger(w, 1);
    expect(w.players[1]!.staggered).toBe(true);
    w.players[1]!.pos = { x: 300, y: 600 };
    practiceKnockBack(w, 1);
    run(w, 60, [idle, idle]);
    expect(w.players[1]!.koTicks).toBeGreaterThan(0); // Staggered knockback carries it off the side
    practiceSetEnergy(w, 0, 0.5);
    expect(w.players[0]!.energy).toBe(37.5);
  });

  it('cooldowns, ball, barriers, overtime and reset', () => {
    const w = duel();
    step(w, [quantizeInput(0, 0, 1, 0, Button.Move1), idle]);
    expect(w.players[0]!.moves[0]!.cooldown).toBeGreaterThan(0);
    practiceClearCooldowns(w);
    expect(w.players[0]!.moves[0]!.cooldown).toBe(0);
    practiceRemoveBall(w);
    expect(w.ball.scored).toBe(true);
    practiceSpawnBall(w, { x: 100, y: 50 });
    expect(w.ball.scored).toBe(false);
    expect(w.ball.pos).toEqual({ x: 100, y: 50 });
    practiceDisableBarriers(w);
    expect(w.barriers.every((b) => !b.alive)).toBe(true);
    practiceRestoreBarriers(w);
    expect(w.barriers.every((b) => b.alive)).toBe(true);
    practiceSetOvertime(w, true);
    expect(w.match.overtime).toBe(true);
    practiceSetOvertime(w, false);
    expect(w.match.overtime).toBe(false);
    w.players[0]!.pos = { x: 500, y: 500 };
    practiceResetAll(w);
    expect(w.match.phase).toBe('play');
    expect(w.players[0]!.pos.x).toBeLessThan(0);
  });
});
