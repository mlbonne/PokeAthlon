import { describe, expect, it } from 'vitest';
import { defaultItem, gameplay, getPokemon, items, itemsFor } from '@pokeathlon/data';
import { addXp, applyHit, Button, effectiveSpeed, quantizeInput, step, type PlayerInput, type PlayerSpawn, type SimEvent, type World } from '../src/index';
import { idle, run, sandbox } from './helpers';

/** M5.5 held items: one test per effect, through the real items.json. */
const FAR_BALL = { x: 0, y: -850 };
function world(spawns: PlayerSpawn[], ball = FAR_BALL): World {
  const w = sandbox(spawns, ball);
  for (const p of w.players) addXp(w, p, gameplay.xp.levelThresholds[1]!);
  return w;
}
function tick(w: World, who: number, inp: PlayerInput): SimEvent[] {
  const inputs = w.players.map(() => idle);
  inputs[who] = inp;
  step(w, inputs);
  return w.events;
}
const press = (button: number, aim = { x: 1, y: 0 }, move = { x: 0, y: 0 }) => quantizeInput(move.x, move.y, aim.x, aim.y, button);
/** x on team 0's own half. */
const ownX = (w: World) => -600 * Math.sign(w.stage.goals[1].side);

describe('item data', () => {
  it('9 items, 5 forward and 4 goalie; defaults exist for every archetype', () => {
    expect(items).toHaveLength(9);
    expect(itemsFor('forward')).toHaveLength(5);
    expect(itemsFor('goalie')).toHaveLength(4);
    for (const id of ['zeraora', 'greninja', 'hoopa', 'arcanine-hisui', 'bronzong', 'blastoise', 'lucario', 'machamp', 'pikachu']) {
      const a = getPokemon(id).archetype;
      expect(defaultItem(a, 'forward').slot).toBe('forward');
      expect(defaultItem(a, 'goalie').slot).toBe('goalie');
    }
  });

  it('items are locked to the role slot', () => {
    expect(() => sandbox([{ pokemonId: 'zeraora', team: 0, item: 'rocky-helmet' }])).toThrow(/goalie item/);
    expect(() => sandbox([{ pokemonId: 'zeraora', team: 0, role: 'goalie', item: 'rocky-helmet' }])).not.toThrow();
  });
});

describe('forward items', () => {
  it('Choice Scarf: a Strike on the ball gives +25 % speed for 1.25 s', () => {
    const w = world([{ pokemonId: 'zeraora', team: 0, pos: { x: -300, y: 0 }, item: 'choice-scarf' }], { x: -200, y: 0 });
    const p = w.players[0]!;
    const base = effectiveSpeed(p);
    tick(w, 0, press(Button.Strike));
    expect(effectiveSpeed(p)).toBeCloseTo(base * 1.25);
    run(w, 80, [idle]);
    expect(effectiveSpeed(p)).toBeCloseTo(base);
  });

  it('Muscle Band: +10 % knockback dealt; +30 % speed with a player advantage', () => {
    const kb = (item?: string) => {
      const w = world([
        { pokemonId: 'lucario', team: 0, pos: { x: -300, y: 0 }, ...(item ? { item } : {}) },
        { pokemonId: 'zeraora', team: 1, pos: { x: 0, y: 0 } },
      ]);
      applyHit(w, 0, w.players[1]!, { dir: { x: 1, y: 0 }, knockback: 300, damage: 0 });
      return (w.events.find((e) => e.type === 'hit') as Extract<SimEvent, { type: 'hit' }>).knockback;
    };
    expect(kb('muscle-band')).toBeCloseTo(kb() * 1.1);
    const w = world([
      { pokemonId: 'lucario', team: 0, pos: { x: -300, y: 0 }, item: 'muscle-band' },
      { pokemonId: 'zeraora', team: 1, pos: { x: 0, y: 0 } },
    ]);
    const p = w.players[0]!;
    run(w, 1, [idle, idle]);
    const even = effectiveSpeed(p);
    w.players[1]!.koTicks = 600;
    run(w, 1, [idle, idle]);
    expect(effectiveSpeed(p)).toBeGreaterThan(even * 1.2);
  });

  it('Shell Bell heals 100 % of damage dealt; Poison Barb poisons 6 % over 2.4 s and heals 125 % of it', () => {
    const w = world([
      { pokemonId: 'lucario', team: 0, pos: { x: -300, y: 0 }, item: 'shell-bell' },
      { pokemonId: 'zeraora', team: 1, pos: { x: 0, y: 0 } },
    ]);
    const me = w.players[0]!;
    me.stagger = me.maxStagger - 500;
    applyHit(w, 0, w.players[1]!, { dir: { x: 1, y: 0 }, knockback: 0, damage: 200 });
    expect(me.stagger).toBeCloseTo(me.maxStagger - 500 + 200);

    const w2 = world([
      { pokemonId: 'greninja', team: 0, pos: { x: -300, y: 0 }, item: 'poison-barb' },
      { pokemonId: 'bronzong', team: 1, pos: { x: 0, y: 0 } },
    ]);
    const g = w2.players[0]!;
    const o = w2.players[1]!;
    g.stagger = g.maxStagger - 500;
    applyHit(w2, 0, o, { dir: { x: 1, y: 0 }, knockback: 0, damage: 100 });
    const after = o.stagger;
    run(w2, 150, [idle, idle]);
    // Regen is paused by the hit for 3 s, so the drop is all poison.
    expect(after - o.stagger).toBeCloseTo(o.maxStagger * 0.06, 0);
    expect(g.stagger - (g.maxStagger - 500)).toBeGreaterThan(o.maxStagger * 0.06 * 1.25 - 1);
  });

  it('Quick Powder: crossing midfield on foot gives +18 % speed', () => {
    const w = world([{ pokemonId: 'zeraora', team: 0, pos: { x: -30, y: 0 }, item: 'quick-powder' }]);
    const p = w.players[0]!;
    const base = effectiveSpeed(p);
    for (let i = 0; i < 20 && p.pos.x < 0; i++) tick(w, 0, press(0, { x: 1, y: 0 }, { x: 1, y: 0 }));
    expect(p.pos.x).toBeGreaterThan(0);
    tick(w, 0, idle); // items read the crossing on the next tick
    expect(effectiveSpeed(p)).toBeCloseTo(base * 1.18);
  });
});

describe('goalie items', () => {
  it('Rocky Helmet: +30 % size, +10 power, −10 % damage, only on your own half', () => {
    const w = world([{ pokemonId: 'bronzong', team: 0, role: 'goalie', pos: { x: -600, y: 0 }, item: 'rocky-helmet' }]);
    const p = w.players[0]!;
    p.pos = { x: ownX(w), y: 0 };
    run(w, 1, [idle]);
    expect(p.itemActive).toBe(true);
    expect(p.radius).toBeCloseTo(p.baseRadius * 1.3);
    expect(p.power).toBe(p.basePower + 10);
    const s0 = p.stagger;
    applyHit(w, 0, p, { dir: { x: 0, y: 1 }, knockback: 0, damage: 100 });
    expect(s0 - p.stagger).toBeCloseTo(90);
    p.pos = { x: -ownX(w), y: 0 };
    run(w, 1, [idle]);
    expect(p.itemActive).toBe(false);
    expect(p.radius).toBeCloseTo(p.baseRadius);
    expect(p.power).toBe(p.basePower);
  });

  it('Quick Claw: speed builds on your half (+2 % → +16 %) and resets when hit', () => {
    const w = world([{ pokemonId: 'hoopa', team: 0, role: 'goalie', pos: { x: -600, y: 0 }, item: 'quick-claw' }]);
    const p = w.players[0]!;
    p.pos = { x: ownX(w), y: 0 };
    run(w, 1, [idle]);
    expect(p.itemSpeedPct).toBeCloseTo(2, 0);
    run(w, 11 * 60, [idle]);
    expect(p.itemSpeedPct).toBeCloseTo(16);
    applyHit(w, 0, p, { dir: { x: 0, y: 1 }, knockback: 0, damage: 1 });
    run(w, 1, [idle]);
    expect(p.itemSpeedPct).toBeLessThan(3);
  });

  it('Eject Pack: −35 % secondary cooldown, +50 % dash, and recast blinks back', () => {
    const w = world([{ pokemonId: 'lucario', team: 0, role: 'goalie', pos: { x: -600, y: 0 }, item: 'eject-pack' }]);
    const p = w.players[0]!;
    p.pos = { x: ownX(w), y: 0 };
    run(w, 1, [idle]);
    const start = { ...p.pos };
    const dir = { x: 0, y: 1 };
    tick(w, 0, press(Button.Move2, dir));
    expect(p.moves[1]!.cooldown).toBe(Math.round(p.moves[1]!.def.cooldown * 0.65 * 60));
    run(w, 30, [idle]);
    expect(p.pos.y - start.y).toBeGreaterThan(520 * 1.4);
    tick(w, 0, idle);
    tick(w, 0, press(Button.Move2, dir));
    expect(p.pos).toEqual(start);
  });

  it('Zoom Lens: every 11 s a Strike also fires a projectile; projectiles fly 35 % farther', () => {
    const w = world([{ pokemonId: 'zeraora', team: 0, role: 'goalie', pos: { x: -600, y: 0 }, item: 'zoom-lens' }]);
    const p = w.players[0]!;
    p.pos = { x: ownX(w), y: 0 };
    run(w, 1, [idle]);
    tick(w, 0, press(Button.Strike, { x: 0, y: 1 }));
    expect(w.projectiles.filter((pr) => pr.moveId === 'item:zoom-lens')).toHaveLength(1);
    run(w, 60, [idle]);
    tick(w, 0, press(Button.Strike, { x: 0, y: 1 }));
    expect(w.projectiles.filter((pr) => pr.moveId === 'item:zoom-lens')).toHaveLength(0); // on cooldown
    run(w, 60, [idle]);
    tick(w, 0, press(Button.Move1, { x: 0, y: 1 }));
    run(w, 12, [idle]); // Discharge's 0.15 s wind-up
    expect(w.projectiles.find((pr) => pr.moveId === 'discharge')?.range).toBeCloseTo(900 * 1.35);
  });
});
