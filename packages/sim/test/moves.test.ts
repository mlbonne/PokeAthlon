import { describe, expect, it } from 'vitest';
import { gameplay } from '@pokeathlon/data';
import {
  addXp,
  applyHit,
  Button,
  dsin,
  effectiveSpeed,
  movesFor,
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
    const w = sandbox([{ pokemonId: 'zeraora', team: 0, pos: { x: -500, y: 0 } }], { x: 0, y: -850 });
    expect(types(cast(w, 0, Button.Signature))).not.toContain('cast'); // Lv 1: locked
    expect(types(cast(w, 0, Button.Move2))).toContain('cast'); // Agility: no wind-up
    expect(w.players[0]!.moves[1]!.cooldown).toBeGreaterThan(0);
    run(w, 5, [idle]);
    expect(types(cast(w, 0, Button.Move2))).not.toContain('cast'); // on cooldown
    addXp(w, w.players[0]!, gameplay.xp.levelThresholds[1]!);
    expect(types(cast(w, 0, Button.Signature))).toContain('cast');
  });

  it('Pokémon without a kit simply have no moves', () => {
    const w = sandbox([{ pokemonId: 'hoopa', team: 0, pos: { x: 0, y: 0 } }]);
    w.players[0]!.moves = movesFor('missingno');
    expect(w.players[0]!.moves).toHaveLength(0);
    expect(types(cast(w, 0, Button.Move1))).not.toContain('cast');
  });
});

describe('Zeraora (Speedy Skirmisher)', () => {
  it('Discharge fires 5 bolts over time (OS Kai Barrage); a bolt nudges the ball with a LIGHT hit', () => {
    const w = duel('zeraora', { x: -500, y: 0 }, 'machamp', { x: 600, y: 600 }, { x: -200, y: 0 });
    cast(w, 0, Button.Move1);
    const ids = new Set(w.projectiles.map((p) => p.id));
    for (let i = 0; i < 70; i++) {
      step(w, [idle, idle]);
      for (const p of w.projectiles) ids.add(p.id);
    }
    expect(ids.size).toBe(5);
    expect(w.ball.lastHitBy).toBe(0);
    expect(speedOf(w)).toBeGreaterThan(400);
  });

  it('bolts are LIGHT on players: slow, no knockback', () => {
    const w = duel('zeraora', { x: -300, y: 0 }, 'machamp', { x: 100, y: 0 });
    cast(w, 0, Button.Move1);
    const evs = run(w, 40, [idle, idle]);
    const hits = evs.filter((e) => e.type === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.type === 'hit' && h.light && h.knockback === 0)).toBe(true);
    expect(w.players[1]!.knockTicks).toBe(0);
  });

  it('Agility: +30 % speed for 5 s', () => {
    const w = duel('zeraora', { x: -300, y: 0 });
    const base = effectiveSpeed(w.players[0]!);
    cast(w, 0, Button.Move2);
    expect(effectiveSpeed(w.players[0]!)).toBeCloseTo(base * 1.3, 6);
    run(w, ticks(5), [idle, idle]);
    expect(effectiveSpeed(w.players[0]!)).toBeCloseTo(base, 6);
  });

  it('Wild Charge dashes through an enemy and knocks it away', () => {
    const w = duel('zeraora', { x: -400, y: 0 }, 'machamp', { x: -50, y: 0 });
    cast(w, 0, Button.Signature);
    const evs = run(w, 40, [idle, idle]);
    expect(types(evs)).toContain('dash');
    expect(types(evs)).toContain('hit');
    expect(w.players[0]!.pos.x).toBeGreaterThan(100);
    expect(w.players[1]!.pos.x).toBeGreaterThan(0);
  });
});

describe('Bronzong (Stalwart Protector)', () => {
  it('Gyro Ball winds up 0.5 s, then rolls a decelerating body that stops short of the range', () => {
    const w = duel('bronzong', { x: -700, y: 0 }, 'machamp', { x: 700, y: 700 });
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

  it('Heavy Slam hops in and stuns nearby enemies and the ball', () => {
    const w = duel('bronzong', { x: -400, y: 0 }, 'machamp', { x: 100, y: 0 }, { x: 80, y: -120 });
    cast(w, 0, Button.Move2);
    const evs = run(w, ticks(0.35) + 2, [idle, idle]);
    expect(types(evs)).toContain('area');
    expect(types(evs)).toContain('ballStun');
    expect(w.ball.stunTicks).toBeGreaterThan(0);
    const before = w.ball.vel;
    expect(before).toEqual({ x: 0, y: 0 });
  });

  it('Block raises 3 walls that the ball bounces off and players can’t cross, then expire', () => {
    const w = duel('bronzong', { x: -800, y: 0 }, 'machamp', { x: 700, y: 700 }, { x: -300, y: 0 });
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
    // Player knockback 319 + 143.5 % Power (brawling rework, then −15 % in the 2026-11 balance pass).
    expect(hit && hit.type === 'hit' && hit.knockback).toBeCloseTo(319 + 1.435 * 105, 6);
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

describe('Hoopa (Manipulating Mastermind)', () => {
  const holeHits = (evs: ReturnType<typeof run>) =>
    evs.filter((e): e is Extract<typeof e, { type: 'hit' }> => e.type === 'hit' && e.source === 'hyperspace-hole' && e.target === 1);

  it('Hyperspace Hole: the portal chips the enemy, then Hoopa comes out beside them and bursts', () => {
    const w = duel('hoopa', { x: -400, y: 0 }, 'machamp', { x: 200, y: 0 });
    const evs = [...cast(w, 0, Button.Move2)];
    evs.push(...run(w, 30, [idle, idle]));
    const first = holeHits(evs);
    expect(first).toHaveLength(1);
    expect(first[0]!.light).toBe(true);
    expect(w.players[0]!.pos.x).toBeLessThan(-300); // not there yet: 0.35 s to come out
    expect(evs.find((e) => e.type === 'telegraph')).toBeTruthy(); // the exit is shown
    evs.push(...run(w, 30, [idle, idle]));
    const blink = evs.find((e) => e.type === 'blink');
    expect(blink).toBeTruthy();
    expect(w.players[0]!.pos.x).toBeGreaterThan(0); // came out at the portal
    const all = holeHits(evs);
    expect(all).toHaveLength(2);
    expect(all[1]!.knockback).toBeGreaterThan(0);
  });

  it('evading before Hoopa comes out dodges the burst', () => {
    const w = duel('hoopa', { x: -400, y: 0 }, 'machamp', { x: 200, y: 0 });
    w.players[1]!.energy = gameplay.evade.cost;
    const evs = [...cast(w, 0, Button.Move2)];
    evs.push(...run(w, 30, [idle, idle]));
    expect(holeHits(evs)).toHaveLength(1);
    evs.push(...run(w, 1, [idle, quantizeInput(0, 0, 0, 0, Button.Evade, 0)]));
    expect(evs.find((e) => e.type === 'evade')).toBeTruthy();
    evs.push(...run(w, 30, [idle, idle]));
    expect(evs.find((e) => e.type === 'blink')).toBeTruthy(); // Hoopa still travels
    expect(holeHits(evs)).toHaveLength(1); // but the burst misses
  });

  it('Future Sight locks onto the enemy, follows them and banishes them; Evade dodges it', () => {
    const fsHits = (evs: ReturnType<typeof run>) =>
      evs.filter((e): e is Extract<typeof e, { type: 'hit' }> => e.type === 'hit' && e.source === 'future-sight' && e.target === 1);
    const away = quantizeInput(1, 0, 0, 0, 0, 0); // the enemy walks straight away
    const w = duel('hoopa', { x: -400, y: 0 }, 'machamp', { x: 0, y: 0 });
    const evs = [...cast(w, 0, Button.Signature, { x: 1, y: 0 }, 400)];
    expect(w.pending.some((pa) => pa.trackId === 1)).toBe(true);
    evs.push(...run(w, 70, [idle, away]));
    expect(w.players[1]!.pos.x).toBeGreaterThan(350); // it walked well out of where it was marked
    expect(fsHits(evs)).toHaveLength(1);
    expect(w.players[1]!.banishTicks).toBeGreaterThan(0);

    const w2 = duel('hoopa', { x: -400, y: 0 }, 'machamp', { x: 0, y: 0 });
    w2.players[1]!.energy = gameplay.evade.cost;
    const evs2 = [...cast(w2, 0, Button.Signature, { x: 1, y: 0 }, 400)];
    evs2.push(...run(w2, 50, [idle, away]));
    evs2.push(...run(w2, 1, [idle, quantizeInput(1, 0, 0, 0, Button.Evade, 0)]));
    evs2.push(...run(w2, 30, [idle, away]));
    expect(fsHits(evs2)).toHaveLength(0);
  });

  it('a portal that hits nothing still takes Hoopa to where it stopped', () => {
    const w = duel('hoopa', { x: -400, y: 0 }, 'machamp', { x: 600, y: 600 });
    cast(w, 0, Button.Move2);
    run(w, 60, [idle, idle]);
    expect(w.players[0]!.pos.x).toBeGreaterThan(300);
    expect(w.players[0]!.koTicks).toBe(0);
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
    const w = duel('zeraora', { x: -130, y: 0 }, 'machamp', { x: 600, y: 600 }, { x: 0, y: 0 });
    w.ball.stunTicks = 30;
    step(w, [quantizeInput(0, 0, 1, 0, Button.Strike), idle]);
    expect(w.ball.vel).toEqual({ x: 0, y: 0 });
  });

  it('projectiles, walls and dashes are cleared between rounds', () => {
    const w = duel('bronzong', { x: -800, y: 0 });
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

describe('lingering projectiles (OS Kai Barrage)', () => {
  it('a Discharge bolt hovers at the end of its range before vanishing, and still hits there', () => {
    const w = sandbox([{ pokemonId: 'zeraora', team: 0, pos: { x: -500, y: 0 } }], { x: 0, y: -850 });
    cast(w, 0, Button.Move1);
    let hovered = 0;
    for (let i = 0; i < 90; i++) {
      step(w, [idle]);
      if (w.projectiles.some((p) => p.speed === 0)) hovered++;
    }
    expect(hovered).toBeGreaterThanOrEqual(12); // ~0.25 s of hovering per bolt
    expect(w.projectiles).toHaveLength(0);
  });
});
