import { describe, expect, it } from 'vitest';
import { getKit, getPokemon } from '@pokeathlon/data';
import { applyTuning } from '@pokeathlon/data/tuning';
import { fitImpact, impactOf, impactShares, IMPACT_FEATURES, type ImpactStats } from '../src/index';

describe('what-if tuning', () => {
  it('sets, multiplies and adds stats and move fields', () => {
    const before = getPokemon('lucario').stats.power;
    const cd = getKit('lucario')!.moves.find((m) => m.id === 'aura-sphere')!.cooldown;
    const out = applyTuning(['lucario.power+=5', 'lucario.aura-sphere.cooldown=7']);
    expect(getPokemon('lucario').stats.power).toBe(before + 5);
    expect(getKit('lucario')!.moves.find((m) => m.id === 'aura-sphere')!.cooldown).toBe(7);
    expect(out).toHaveLength(2);
    applyTuning([`lucario.power=${before}`, `lucario.aura-sphere.cooldown=${cd}`]); // restore
  });

  it('scales every hit of a move with a shortcut, and paths reach nested fields', () => {
    const cc = () => getKit('lucario')!.moves.find((m) => m.id === 'close-combat')!;
    const hits = () => cc().actions.map((a) => ('hit' in a && a.hit?.damage ? a.hit.damage.base : 0));
    const was = hits();
    applyTuning(['lucario.close-combat.damage*=0.5']);
    hits().forEach((v, i) => expect(v).toBeCloseTo(was[i]! * 0.5));
    applyTuning(['lucario.close-combat.damage*=2']);
    const r = (cc().actions[1] as { radius: number }).radius;
    applyTuning(['lucario.close-combat.actions.1.radius=240']);
    expect((cc().actions[1] as { radius: number }).radius).toBe(240);
    applyTuning([`lucario.close-combat.actions.1.radius=${r}`]);
  });

  it('rejects unknown Pokémon, moves and malformed specs', () => {
    expect(() => applyTuning(['mew.power=100'])).toThrow();
    expect(() => applyTuning(['lucario.hyper-beam.cooldown=5'])).toThrow();
    expect(() => applyTuning(['lucario power 100'])).toThrow();
  });
});

describe('impact model', () => {
  const zero = (): ImpactStats => Object.fromEntries(IMPACT_FEATURES.map((f) => [f, 0])) as ImpactStats;

  it('shares are a fraction of the match total', () => {
    const a = { ...zero(), goals: 3 };
    const b = { ...zero(), goals: 1 };
    const s = impactShares([a, b]);
    expect(s[0]![0]).toBeCloseTo(0.75);
    expect(s[1]![0]).toBeCloseTo(0.25);
  });

  it('learns that a bigger share of goals wins, and scores it as positive impact', () => {
    const x: number[][] = [];
    const y: number[] = [];
    // Synthetic games: the side with more goals wins; deaths are noise.
    for (let i = 0; i < 200; i++) {
      const g = (i % 10) / 10;
      const row = IMPACT_FEATURES.map((f) => (f === 'goals' ? g : f === 'deaths' ? ((i * 7) % 10) / 10 : 0.1));
      x.push(row);
      y.push(g > 0.45 ? 1 : 0);
    }
    const m = fitImpact(x, y);
    expect(m.weights[IMPACT_FEATURES.indexOf('goals')]!).toBeGreaterThan(1);
    expect(m.accuracy).toBeGreaterThan(0.9);
    const hi = IMPACT_FEATURES.map((f) => (f === 'goals' ? 0.9 : 0.1));
    const lo = IMPACT_FEATURES.map((f) => (f === 'goals' ? 0.05 : 0.1));
    expect(impactOf(m, hi)).toBeGreaterThan(20);
    expect(impactOf(m, lo)).toBeLessThan(-20);
  });
});
