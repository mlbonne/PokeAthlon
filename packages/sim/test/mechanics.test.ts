import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gameplay, registerKit } from '@pokeathlon/data';
import {
  addXp,
  applyHit,
  Button,
  isTargetable,
  parseLineup,
  quantizeInput,
  runHeadless,
  step,
  type PlayerInput,
  type PlayerSpawn,
  type SimEvent,
  type World,
} from '../src/index';
import fixture from '../../data/test/fixtures/m51-kits.json' with { type: 'json' };
import { idle, run, sandbox, types } from './helpers';

/**
 * M5.1 move-system extensions, exercised through test kits (packages/data/test/fixtures/m51-kits.json)
 * installed on the four Pokémon that don't have real kits yet.
 */
const FIXTURE = fixture as Record<string, unknown>;
const TEST_IDS = ['alakazam', 'greninja', 'blastoise', 'machamp'];
beforeAll(() => {
  for (const id of TEST_IDS) registerKit(id, FIXTURE[id]);
});
afterAll(() => {
  for (const id of TEST_IDS) registerKit(id, null);
});

const FAR_BALL = { x: 0, y: -850 };

function world(spawns: PlayerSpawn[], ball = FAR_BALL): World {
  const w = sandbox(spawns, ball);
  for (const p of w.players) addXp(w, p, gameplay.xp.levelThresholds[1]!); // specials unlocked
  return w;
}

/** One tick with player `who` giving `inp`, everyone else idle. */
function tick(w: World, who: number, inp: PlayerInput): SimEvent[] {
  const inputs = w.players.map(() => idle);
  inputs[who] = inp;
  step(w, inputs);
  return w.events;
}
const press = (button: number, aim = { x: 1, y: 0 }, aimDist = 0, move = { x: 0, y: 0 }) => quantizeInput(move.x, move.y, aim.x, aim.y, button, aimDist);
const hits = (evs: SimEvent[]) => evs.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit');

describe('charge-and-release', () => {
  function chargeShot(holdTicks: number) {
    const w = world([
      { pokemonId: 'greninja', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'pikachu', team: 1, pos: { x: 0, y: 0 } },
    ]);
    const evs: SimEvent[] = [];
    for (let i = 0; i < holdTicks; i++) evs.push(...tick(w, 0, press(Button.Signature)));
    expect(w.players[0]!.moves[2]!.cooldown).toBe(0); // no cooldown while charging
    evs.push(...run(w, 30, [idle, idle]));
    return { w, evs };
  }

  it('a tap fires at the minimum, a full charge at 100 %; cooldown starts on release', () => {
    const tap = chargeShot(1);
    const full = chargeShot(61);
    const dTap = hits(tap.evs)[0]!.damage;
    const dFull = hits(full.evs)[0]!.damage;
    expect(dFull).toBeCloseTo(200, 5);
    expect(dTap).toBeLessThan(dFull * 0.5);
    expect(full.w.players[0]!.moves[2]!.cooldown).toBeGreaterThan(0);
    expect(types(full.evs)).toContain('cast');
  });

  it('slows the caster, blocks Strike, and fires by itself at max hold', () => {
    const w = world([{ pokemonId: 'greninja', team: 0, pos: { x: -400, y: 0 } }]);
    const walk = world([{ pokemonId: 'greninja', team: 0, pos: { x: -400, y: 0 } }]);
    const evs: SimEvent[] = [];
    for (let i = 0; i < 130; i++) {
      // (Strike resolves before moves, so it joins from the 2nd tick, once the charge has started.)
      evs.push(...tick(w, 0, press(Button.Signature | (i > 0 ? Button.Strike : 0), { x: 1, y: 0 }, 0, { x: 0, y: 1 })));
      if (i < 40) tick(walk, 0, press(0, { x: 1, y: 0 }, 0, { x: 0, y: 1 }));
      if (i === 39) expect(w.players[0]!.pos.y).toBeLessThan(walk.players[0]!.pos.y * 0.75);
    }
    expect(types(evs).filter((t) => t === 'strike')).toHaveLength(0);
    expect(types(evs)).toContain('cast'); // max hold (2 s) reached → fired
  });
});

describe('recast', () => {
  it('blink forward, hit along the path, recast to blink back to the mark', () => {
    const w = world([
      { pokemonId: 'greninja', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'pikachu', team: 1, pos: { x: -150, y: 20 } },
    ]);
    const evs = tick(w, 0, press(Button.Move2));
    expect(types(evs)).toContain('blink');
    expect(w.players[0]!.pos.x).toBeCloseTo(100, 0);
    expect(hits(evs)[0]?.target).toBe(1);
    tick(w, 0, idle);
    const back = tick(w, 0, press(Button.Move2, { x: 0, y: 1 }));
    expect(types(back)).toContain('recast');
    expect(w.players[0]!.pos.x).toBeCloseTo(-400, 0);
    expect(w.players[0]!.recast).toBeNull();
  });

  it('the window closes', () => {
    const w = world([{ pokemonId: 'greninja', team: 0, pos: { x: -400, y: 0 } }]);
    tick(w, 0, press(Button.Move2));
    run(w, 3 * 60 + 1, [idle]);
    expect(w.players[0]!.recast).toBeNull();
    expect(types(tick(w, 0, press(Button.Move2)))).not.toContain('recast');
  });
});

describe('ball grab and throw', () => {
  const setup = () =>
    world(
      [
        { pokemonId: 'alakazam', team: 0, pos: { x: -300, y: 0 } },
        { pokemonId: 'pikachu', team: 1, pos: { x: 400, y: 300 } },
      ],
      { x: -150, y: 0 },
    );

  it('holds the ball in front, follows the holder, and the recast throws it', () => {
    const w = setup();
    const evs = tick(w, 0, press(Button.Move1));
    expect(evs.find((e) => e.type === 'grab')).toMatchObject({ caught: true });
    expect(w.ball.heldBy).toBe(0);
    for (let i = 0; i < 10; i++) tick(w, 0, press(0, { x: 0, y: 1 }, 0, { x: 0, y: 1 }));
    const p = w.players[0]!;
    expect(Math.hypot(w.ball.pos.x - p.pos.x, w.ball.pos.y - p.pos.y)).toBeLessThan(140);
    expect(w.ball.pos.y).toBeGreaterThan(p.pos.y); // in front (facing +y)
    const thrown = tick(w, 0, press(Button.Move1, { x: 1, y: 0 }));
    expect(thrown.find((e) => e.type === 'release')).toMatchObject({ thrown: true });
    expect(w.ball.heldBy).toBe(-1);
    run(w, 6, [idle, idle]);
    expect(w.ball.vel.x).toBeGreaterThan(1000);
  });

  it('others cannot Strike a held ball; a hit on the holder drops it; time-out throws it', () => {
    const w = setup();
    tick(w, 0, press(Button.Move1));
    // An enemy right next to the ball swings: nothing.
    w.players[1]!.pos = { x: w.ball.pos.x + 80, y: w.ball.pos.y };
    const evs = tick(w, 1, press(Button.Strike, { x: -1, y: 0 }));
    expect(types(evs)).not.toContain('ballHit');
    expect(w.ball.heldBy).toBe(0);
    applyHit(w, 1, w.players[0]!, { dir: { x: 0, y: 1 }, knockback: 0, damage: 50 });
    expect(w.ball.heldBy).toBe(-1);

    const w2 = setup();
    tick(w2, 0, press(Button.Move1));
    const later = run(w2, 45, [idle, idle]);
    expect(later.find((e) => e.type === 'release')).toMatchObject({ thrown: true });
  });

  it('whiffs when the ball is out of reach', () => {
    const w = world([{ pokemonId: 'alakazam', team: 0, pos: { x: -300, y: 0 } }], { x: 300, y: 0 });
    expect(tick(w, 0, press(Button.Move1)).find((e) => e.type === 'grab')).toMatchObject({ caught: false });
    expect(w.ball.heldBy).toBe(-1);
  });
});

describe('teleport / swap', () => {
  it('swaps places with the ally nearest the aim', () => {
    const w = world([
      { pokemonId: 'alakazam', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'pikachu', team: 0, pos: { x: 200, y: 100 } },
      { pokemonId: 'pikachu', team: 0, pos: { x: -400, y: 600 } },
    ]);
    const evs = tick(w, 0, press(Button.Move2, { x: 1, y: 0 }));
    expect(evs.find((e) => e.type === 'blink')).toMatchObject({ swapWith: 1 });
    expect(w.players[0]!.pos).toEqual({ x: 200, y: 100 });
    expect(w.players[1]!.pos).toEqual({ x: -400, y: 0 });
  });

  it('a blink never leaves the arena', () => {
    const w = world([{ pokemonId: 'greninja', team: 0, pos: { x: 0, y: 700 } }]);
    tick(w, 0, press(Button.Move2, { x: 0, y: 1 }));
    expect(w.players[0]!.koTicks).toBe(0);
    run(w, 5, [idle]);
    expect(w.players[0]!.koTicks).toBe(0);
  });
});

describe('delayed area, telegraph and banish', () => {
  it('telegraphs, then banishes: untargetable, frozen, back in place', () => {
    const w = world([
      { pokemonId: 'alakazam', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'pikachu', team: 1, pos: { x: 100, y: 0 } },
    ]);
    const evs = tick(w, 0, press(Button.Signature, { x: 1, y: 0 }, 500));
    expect(evs.find((e) => e.type === 'telegraph')).toMatchObject({ shape: 'circle', time: 1 });
    const later = run(w, 60, [idle, idle]);
    expect(later.find((e) => e.type === 'banish')).toMatchObject({ playerId: 1, by: 0 });
    const o = w.players[1]!;
    expect(isTargetable(o)).toBe(false);
    const at = { ...o.pos };
    run(w, 30, [idle, quantizeInput(1, 0, 1, 0, Button.Strike | Button.Move1)]);
    expect(o.pos).toEqual(at); // frozen, can't act
    const back = run(w, 70, [idle, idle]);
    expect(back.find((e) => e.type === 'unbanish')).toBeTruthy();
    expect(isTargetable(o)).toBe(true);
    expect(o.pos).toEqual(at);
  });
});

describe('sweet spot', () => {
  it('the tip of the cone hits harder than the base', () => {
    const at = (x: number) => {
      const w = world([
        { pokemonId: 'greninja', team: 0, pos: { x: -400, y: 0 } },
        { pokemonId: 'pikachu', team: 1, pos: { x: -400 + x, y: 0 } },
      ]);
      return hits(tick(w, 0, press(Button.Move1)))[0]!;
    };
    const base = at(120);
    const tip = at(260);
    expect(base.damage).toBe(60);
    expect(tip.damage).toBe(120);
    expect(tip.knockback).toBeGreaterThan(base.knockback);
  });
});

describe('Strike-modifier passive', () => {
  it('stacks on move hits; the next Strike fires it and spends the stacks', () => {
    const w = world([
      { pokemonId: 'greninja', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'snorlax', team: 1, pos: { x: -150, y: 0 } },
    ]);
    const g = w.players[0]!;
    tick(w, 0, press(Button.Move1));
    expect(g.passiveStacks).toBe(1);
    run(w, 125, [idle, idle]);
    w.players[1]!.pos = { x: -150, y: 0 }; // knocked away by the first slash: bring it back
    w.players[1]!.knockTicks = 0;
    tick(w, 0, press(Button.Move1));
    expect(g.passiveStacks).toBe(2);
    run(w, 60, [idle, idle]);
    const evs = tick(w, 0, press(Button.Strike, { x: 0, y: -1 }));
    expect(types(evs)).toContain('passive');
    expect(g.passiveStacks).toBe(0);
    expect(w.projectiles.some((pr) => pr.moveId === 'passive')).toBe(true);
  });
});

describe('side condition', () => {
  it('a wall lasts 2× on your own half and 0.5× on the enemy half', () => {
    const wallTicks = (x: number) => {
      const w = world([{ pokemonId: 'blastoise', team: 0, pos: { x, y: 0 } }]);
      tick(w, 0, press(Button.Move1, { x: 0, y: 1 }));
      return w.creations[0]!.ticks;
    };
    const own = wallTicks(-600 * -Math.sign(sandbox([{ pokemonId: 'pikachu', team: 0 }]).stage.goals[0].side));
    const enemy = wallTicks(600 * -Math.sign(sandbox([{ pokemonId: 'pikachu', team: 0 }]).stage.goals[0].side));
    expect(own).toBe(240 - 1);
    expect(enemy).toBe(60 - 1);
  });
});

describe('guarded dash', () => {
  it('resists knockback and damage, and breaks after enough damage', () => {
    const w = world([
      { pokemonId: 'blastoise', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'pikachu', team: 1, pos: { x: 400, y: 400 } },
    ]);
    const b = w.players[0]!;
    tick(w, 0, press(Button.Move2));
    expect(b.dash?.guard).toBeTruthy();
    const before = b.stagger;
    applyHit(w, 1, b, { dir: { x: 0, y: 1 }, knockback: 250, damage: 40 });
    expect(b.knockTicks).toBe(0); // 250 < 300 resist
    expect(before - b.stagger).toBeCloseTo(20, 5); // −50 %
    expect(b.dash).not.toBeNull();
    applyHit(w, 1, b, { dir: { x: 0, y: 1 }, knockback: 0, damage: 400 });
    expect(b.dash).toBeNull();
    expect(types(w.events)).toContain('guardBreak');
  });
});

describe('channel', () => {
  it('pulses for its duration, blocks Strike, and a knock ends it', () => {
    const w = world([
      { pokemonId: 'blastoise', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'snorlax', team: 1, pos: { x: 0, y: 0 } },
    ]);
    const evs = [...tick(w, 0, press(Button.Signature))];
    for (let i = 0; i < 100; i++) evs.push(...tick(w, 0, press(Button.Strike)));
    const pulses = evs.filter((e) => e.type === 'area' && e.moveId === 't-pump');
    expect(pulses.length).toBe(6);
    expect(hits(evs).filter((h) => h.source === 't-pump').length).toBeGreaterThanOrEqual(3);
    expect(types(evs).filter((t) => t === 'strike')).toHaveLength(0);

    const w2 = world([
      { pokemonId: 'blastoise', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'snorlax', team: 1, pos: { x: 0, y: 0 } },
    ]);
    tick(w2, 0, press(Button.Signature));
    run(w2, 3, [idle, idle]);
    expect(w2.players[0]!.channel).not.toBeNull();
    applyHit(w2, 1, w2.players[0]!, { dir: { x: 0, y: 1 }, knockback: 300, damage: 0 });
    expect(w2.players[0]!.channel).toBeNull();
  });
});

describe('transform buff', () => {
  it('grows the body, adds power, Strike hits players, more knockback taken; all undone at the end', () => {
    const w = world([
      { pokemonId: 'machamp', team: 0, pos: { x: -400, y: 0 } },
      { pokemonId: 'pikachu', team: 1, pos: { x: -280, y: 0 } },
    ]);
    const m = w.players[0]!;
    const r0 = m.radius;
    const p0 = m.power;
    tick(w, 0, press(Button.Signature));
    expect(m.radius).toBeCloseTo(r0 * 1.3);
    expect(m.power).toBe(p0 + 20);
    const swing = tick(w, 0, press(Button.Strike));
    expect(hits(swing).find((h) => h.source === 't-noguard')?.target).toBe(1);
    // +25 % knockback taken.
    const w2 = world([{ pokemonId: 'machamp', team: 0, pos: { x: -400, y: 0 } }]);
    applyHit(w2, 0, w2.players[0]!, { dir: { x: 0, y: 1 }, knockback: 400, damage: 0 });
    const plain = w2.players[0]!.knockTicks;
    const kTransformed = (() => {
      const w3 = world([{ pokemonId: 'machamp', team: 0, pos: { x: -400, y: 0 } }]);
      tick(w3, 0, press(Button.Signature));
      applyHit(w3, 0, w3.players[0]!, { dir: { x: 0, y: 1 }, knockback: 400, damage: 0 });
      return w3.events.find((e) => e.type === 'hit') as Extract<SimEvent, { type: 'hit' }>;
    })();
    expect(plain).toBeGreaterThan(0);
    expect(kTransformed.knockback).toBeGreaterThan(400 - gameplay.knock.goalArcResist);
    run(w, 5 * 60 + 2, [idle, idle]);
    expect(m.radius).toBeCloseTo(r0);
    expect(m.power).toBe(p0);
  });
});

describe('bots and determinism with every mechanic', () => {
  it('a 3v3 between the test kits replays exactly and the bots use the new moves', () => {
    const lineup = 'greninja,machamp,blastoise/alakazam,greninja,blastoise';
    const a = runHeadless(parseLineup(lineup), { seed: 7, until: 'match', maxMinutes: 2, brains: ['v2-hard', 'v2-hard'] });
    const b = runHeadless(parseLineup(lineup), { seed: 7, until: 'match', maxMinutes: 2, brains: ['v2-hard', 'v2-hard'] });
    expect(a.hash).toBe(b.hash);
    const casts = new Map<string, number>();
    for (const p of a.telemetry.players) for (const [id, mt] of Object.entries(p.moves)) casts.set(id, (casts.get(id) ?? 0) + mt.casts);
    const used = [...casts].filter(([, n]) => n > 0).map(([id]) => id);
    // Charge, blink, channel, transform and guarded dash at least.
    for (const id of ['t-cannon', 't-sneak', 't-pump', 't-noguard', 't-spin']) expect(used, `${id} never cast; used: ${used.join(', ')}`).toContain(id);
  }, 120_000);
});
