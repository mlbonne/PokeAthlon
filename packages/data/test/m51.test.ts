import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeRoster } from '../src/analyze';
import { chargeScale, getKit, parseKit, registerKit, scaleAction, type MoveAction } from '../src/index';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/m51-kits.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const TEST_IDS = ['alakazam', 'greninja', 'blastoise', 'machamp'];

describe('M5.1 move-system schema', () => {
  afterAll(() => {
    for (const id of TEST_IDS) registerKit(id, null);
  });

  it('a test kit using every new feature passes validation', () => {
    for (const id of TEST_IDS) expect(() => parseKit({ ...(FIXTURE[id] as object), pokemon: id })).not.toThrow();
  });

  it('rejects bad values', () => {
    const bad = structuredClone(FIXTURE.greninja) as { moves: { charge?: { min: number } }[] };
    bad.moves[2]!.charge!.min = 1.5;
    expect(() => parseKit({ ...bad, pokemon: 'greninja' })).toThrow();
  });

  it('registerKit installs and removes a kit', () => {
    registerKit('greninja', FIXTURE.greninja);
    expect(getKit('greninja')?.passive?.stacks).toBe(2);
    registerKit('greninja', null);
    expect(getKit('greninja')).toBeUndefined();
  });

  it('scaleAction scales hits, reach and duration', () => {
    const a: MoveAction = parseKit({ ...(FIXTURE.blastoise as object), pokemon: 'blastoise' }).moves[2]!.actions[0]!;
    const s = scaleAction(a, 2, 0.5, 3);
    expect(s.type).toBe('channel');
    if (s.type !== 'channel' || a.type !== 'channel') return;
    expect(s.hit.ball!.base).toBe(a.hit.ball!.base * 2);
    expect(s.length).toBe(a.length * 0.5);
    expect(s.duration).toBe(a.duration * 3);
    expect(chargeScale(0.4, 0)).toBeCloseTo(0.4);
    expect(chargeScale(0.4, 0.5)).toBeCloseTo(0.7);
    expect(chargeScale(0.4, 2)).toBe(1);
  });

  it('the analyzer reports charge, recast, grab, banish, channel, sweet spot, side, transform and passive', () => {
    for (const id of TEST_IDS) registerKit(id, FIXTURE[id]);
    const f = Object.fromEntries(analyzeRoster().map((x) => [x.id, x]));
    const [grab, swap, banish] = f.alakazam!.moves;
    expect(grab!.ballControl).toBe(0.6);
    expect(grab!.recastWindow).toBe(0.6);
    expect(grab!.ballPower).toBe(1600); // the recast throw
    expect(swap!.notes).toContain('swap with ally');
    expect(banish!.banish).toBe(1.5);
    expect(banish!.notes).toContain('telegraphed');
    expect(f.alakazam!.control).toBeGreaterThan(0);

    const [slash, sneak, cannon] = f.greninja!.moves;
    expect(slash!.knockback).toBe(400); // sweet spot, best case
    expect(slash!.notes).toContain('sweet spot 70–100 %');
    expect(sneak!.mobility).toBe(500);
    expect(sneak!.kind).toBe('blink / blink');
    expect(cannon!.chargeTime).toBe(1);
    expect(cannon!.chargeMin).toBe(0.4);
    expect(cannon!.timeToReach).toBeGreaterThan(1); // includes the charge
    expect(f.greninja!.passive?.slot).toBe('passive');
    expect(f.greninja!.passive?.cooldown).toBe(12);

    const [pulse, spin, pump] = f.blastoise!.moves;
    expect(pulse!.notes).toContain('own half ×2');
    expect(pulse!.shield).toContain('4s'); // wall duration at the better side
    expect(spin!.shield).toContain('kb resist');
    expect(pump!.hitsPerCast).toBe(6);
    expect(pump!.notes).toContain('channel 1.5 s');

    const noGuard = f.machamp!.moves[2]!;
    expect(noGuard.hitsPerCast).toBeGreaterThan(1);
    expect(noGuard.notes).toContain('Strike hits players');
    expect(noGuard.reach).toBeCloseTo((265 / 2) * 1.3);
  });
});
