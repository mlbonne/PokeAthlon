import { describe, expect, it } from 'vitest';
import { boostDraft, boosts, gameplay } from '@pokeathlon/data';
import {
  addXp,
  applyHit,
  Button,
  createWorld,
  effectiveSpeed,
  grantBoost,
  knockOut,
  parseLineup,
  quantizeInput,
  runHeadless,
  step,
  ticks,
  type PlayerInput,
  type PlayerSpawn,
  type SimEvent,
  type World,
} from '../src/index';
import { idle, run, sandbox } from './helpers';

/** M5.6 boosts and the boost draft. */
const FAR_BALL = { x: 0, y: -850 };
function world(spawns: PlayerSpawn[], ball = FAR_BALL): World {
  const w = sandbox(spawns, ball);
  for (const p of w.players) addXp(w, p, gameplay.xp.levelThresholds[1]!);
  return w;
}
/** Grant and fold into the body like the draft does. */
function give(w: World, who: number, id: string): void {
  const p = w.players[who]!;
  grantBoost(p, id);
  p.bonusStagger = p.boosts.reduce((s, b) => s + (b.effects.maxStaggerAdd ?? 0), 0);
  p.maxStagger = p.baseStagger + (p.staggerGrowth * (p.level - 1)) / 9 + p.bonusStagger;
  step(w, w.players.map(() => idle)); // stepBoosts + refreshBody
}
const pick = (i: number): PlayerInput => ({ ...quantizeInput(0, 0), pick: i });
const lineup = () => parseLineup('pikachu,lucario,bronzong/togekiss,machamp,blastoise');

describe('boost data', () => {
  it('19 boosts with unique ids; draft settings', () => {
    expect(boosts.length).toBe(19);
    expect(new Set(boosts.map((b) => b.id)).size).toBe(19);
    expect(boostDraft).toMatchObject({ startOffers: 2, poolSize: 8 });
  });
});

describe('draft', () => {
  it('match start: everyone takes one of the same 2 offers, then kickoff; idle players get one automatically', () => {
    const w = createWorld(lineup(), { mode: 'match', boosts: true, seed: 3 });
    expect(w.match.phase).toBe('draft');
    expect(w.draft!.offers).toHaveLength(2);
    const inputs = w.players.map((_, i) => (i < 5 ? pick(i % 2) : idle));
    step(w, inputs);
    expect(w.players.slice(0, 5).every((p) => p.boosts.length === 1)).toBe(true);
    expect(w.players[5]!.boosts).toHaveLength(0);
    const evs: SimEvent[] = [];
    for (let i = 0; i < ticks(boostDraft.startPickTime) + 2; i++) {
      step(w, w.players.map(() => idle));
      evs.push(...w.events);
    }
    expect(w.players[5]!.boosts).toHaveLength(1);
    expect(evs.find((e) => e.type === 'boostPick')).toMatchObject({ playerId: 5, auto: true });
    expect(['kickoff', 'play']).toContain(w.match.phase);
  });

  it('after a set: a shared pool of 8, picked once each in XP order (winners first, alternating)', () => {
    const w = createWorld(lineup(), { mode: 'match', boosts: false, seed: 5 });
    w.boostsOn = true;
    w.players.forEach((p, i) => (p.xp = [300, 100, 200, 50, 400, 10][i]!));
    const m = w.match;
    m.phase = 'setOver';
    m.phaseTicks = 1;
    m.lastScoringTeam = 1;
    step(w, w.players.map(() => idle));
    expect(m.phase).toBe('draft');
    const d = w.draft!;
    expect(d.offers).toHaveLength(8);
    // Team 1 won: its top XP (id 4: 400) first, then team 0's top (id 0: 300), …
    expect(d.order).toEqual([4, 0, 3, 2, 5, 1]);
    const taken: string[] = [];
    for (const who of d.order) {
      const id = d.offers[0]!;
      const inputs = w.players.map((_, i) => (i === who ? pick(0) : idle));
      step(w, inputs);
      expect(w.players[who]!.boosts.map((b) => b.id)).toContain(id);
      taken.push(id);
    }
    expect(new Set(taken).size).toBe(6);
    run(w, 2, []);
    expect(['kickoff', 'play']).toContain(m.phase);
  });

  it('a whole bot match with drafts replays exactly and everyone ends with 2+ boosts', () => {
    const a = runHeadless(lineup(), { seed: 11, boosts: true, brains: ['v2-hard', 'v2-normal'], maxMinutes: 25 });
    const b = runHeadless(lineup(), { seed: 11, boosts: true, brains: ['v2-hard', 'v2-normal'], maxMinutes: 25 });
    expect(a.hash).toBe(b.hash);
    expect(a.winner).toBeGreaterThanOrEqual(0);
    for (const p of a.telemetry.players) expect(p.boosts.length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});

describe('boost effects', () => {
  it('Bulk Up: +300 max Stagger and +1.3 Power per 100 max Stagger', () => {
    const w = world([{ pokemonId: 'bronzong', team: 0, pos: { x: -400, y: 0 } }]);
    const p = w.players[0]!;
    const s0 = p.maxStagger;
    const p0 = p.power;
    give(w, 0, 'bulk-up');
    expect(p.maxStagger).toBeCloseTo(s0 + 300);
    expect(p.power).toBeCloseTo(p0 + (1.3 * p.maxStagger) / 100, 0);
  });

  it('Quick Draw: primary −25 %; Calm Mind: +7 Cooldown Rate', () => {
    const cd = (ids: string[]) => {
      const w = world([{ pokemonId: 'lucario', team: 0, pos: { x: -400, y: 0 } }]);
      for (const id of ids) give(w, 0, id);
      step(w, [quantizeInput(0, 0, 1, 0, Button.Move1)]);
      return w.players[0]!.moves[0]!.cooldown;
    };
    const base = cd([]);
    expect(cd(['quick-draw'])).toBe(Math.round(base * 0.75) - 0);
    expect(cd(['calm-mind'])).toBe(Math.round((base * 100) / 107));
  });

  it('Sparks get stronger per Spark held', () => {
    const w = world([{ pokemonId: 'pikachu', team: 0, pos: { x: -400, y: 0 } }]);
    const p = w.players[0]!;
    const p0 = p.power;
    give(w, 0, 'swords-dance');
    expect(p.power).toBe(p0 + 8);
    give(w, 0, 'rock-polish');
    expect(p.power).toBe(p0 + 8 + 16);
  });

  it('Sturdy prevents the first KO each set', () => {
    const w = world([{ pokemonId: 'pikachu', team: 0, pos: { x: -400, y: 0 } }]);
    const p = w.players[0]!;
    give(w, 0, 'sturdy');
    p.pos = { x: 0, y: 2000 };
    knockOut(w, p);
    expect(p.koTicks).toBe(0);
    expect(w.events.some((e) => e.type === 'sturdy')).toBe(true);
    knockOut(w, p);
    expect(p.koTicks).toBeGreaterThan(0);
  });

  it('Guts scales Power with missing Stagger; Speed Boost builds while unhit and resets on a hit', () => {
    const w = world([{ pokemonId: 'machamp', team: 0, pos: { x: -400, y: 0 } }]);
    const p = w.players[0]!;
    const p0 = p.power;
    give(w, 0, 'guts');
    p.stagger = p.maxStagger / 2;
    p.regenDelay = 600;
    run(w, 1, [idle]);
    expect(p.power).toBeCloseTo(p0 + 40, 0);

    const w2 = world([{ pokemonId: 'pikachu', team: 0, pos: { x: -400, y: 0 } }]);
    const q = w2.players[0]!;
    const s0 = effectiveSpeed(q);
    give(w2, 0, 'speed-boost');
    run(w2, 13 * 60, [idle]);
    expect(effectiveSpeed(q)).toBeCloseTo(s0 * 1.12, 0);
    applyHit(w2, 0, q, { dir: { x: 0, y: 1 }, knockback: 0, damage: 1 });
    run(w2, 1, [idle]);
    expect(effectiveSpeed(q)).toBeCloseTo(s0, 0);
  });

  it('Run Away: +40 % speed and 0 Power near the edge', () => {
    const w = world([{ pokemonId: 'pikachu', team: 0, pos: { x: -400, y: 0 } }]);
    const p = w.players[0]!;
    give(w, 0, 'run-away');
    const s0 = effectiveSpeed(p);
    p.pos = { x: -400, y: w.stage.halfWidth - 150 };
    run(w, 1, [idle]);
    expect(p.power).toBe(0);
    expect(effectiveSpeed(p)).toBeCloseTo(s0 * 1.4, 0);
  });

  it('Mega Launcher: projectiles fly 70 % farther and hit 17.5 % harder; Tough Claws +15 %', () => {
    const shot = (ids: string[]) => {
      const w = world([
        { pokemonId: 'lucario', team: 0, pos: { x: -400, y: 0 } },
        { pokemonId: 'bronzong', team: 1, pos: { x: -100, y: 0 } },
      ]);
      for (const id of ids) give(w, 0, id);
      const evs: SimEvent[] = [];
      step(w, [quantizeInput(0, 0, 1, 0, Button.Move1), idle]);
      evs.push(...w.events);
      const range = w.projectiles[0]?.range ?? 0;
      evs.push(...run(w, 20, [idle, idle]));
      return { range, dmg: (evs.find((e) => e.type === 'hit') as Extract<SimEvent, { type: 'hit' }>).damage };
    };
    const base = shot([]);
    const ml = shot(['mega-launcher']);
    expect(ml.range).toBeCloseTo(base.range * 1.7);
    expect(ml.dmg).toBeCloseTo(base.dmg * 1.175);
    expect(shot(['tough-claws']).dmg).toBeCloseTo(base.dmg * 1.15);
  });

  it('Moxie: +1 stack per takedown, −2 when KO\'d', () => {
    const w = world([
      { pokemonId: 'lucario', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'pikachu', team: 1, pos: { x: 0, y: 2000 } },
    ]);
    give(w, 0, 'moxie');
    const p = w.players[0]!;
    const p0 = p.power;
    const o = w.players[1]!;
    o.lastHitBy = 0;
    o.lastHitTick = w.tick;
    knockOut(w, o);
    run(w, 1, [idle, idle]);
    expect(p.power).toBe(p0 + 20);
  });

  it('Leftovers heals on hit and hurts the target; Poison Touch burns', () => {
    const w = world([
      { pokemonId: 'lucario', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'bronzong', team: 1, pos: { x: 0, y: 0 } },
    ]);
    give(w, 0, 'leftovers');
    give(w, 0, 'poison-touch');
    const me = w.players[0]!;
    const o = w.players[1]!;
    me.stagger = me.maxStagger / 2;
    const s0 = o.stagger;
    applyHit(w, 0, o, { dir: { x: 1, y: 0 }, knockback: 0, damage: 100 });
    expect(me.stagger).toBeCloseTo(me.maxStagger / 2 + me.maxStagger * 0.075);
    expect(s0 - o.stagger).toBeCloseTo(100 + me.maxStagger * 0.075 * 0.4);
    expect(o.poisons).toHaveLength(1);
  });
});
