import { z } from 'zod';
import boostsJson from '../boosts/boosts.json' with { type: 'json' };

/**
 * Boosts (M5.6), the OS Awakening layer: drafted at match start and after every set. Effects are a
 * fixed vocabulary of generic hooks; every number lives in boosts.json.
 */
const pct = z.number().min(0).max(300);
const frac = z.number().min(0).max(1);
const pos = z.number().positive();
const HitBonus = z.object({ players: pct, core: pct });

export const BoostEffects = z.object({
  sizePct: pct.optional(),
  powerAdd: z.number().optional(),
  maxStaggerAdd: z.number().optional(),
  speedPct: pct.optional(),
  cooldownRate: z.number().optional(),
  /** Power per 100 max Stagger (Bulk Up). */
  powerPer100Stagger: z.number().optional(),
  /** Power per 1 % bonus size (Growth). */
  powerPerSizePct: z.number().optional(),
  /** Dash / blink distance and haste +% (stacks with items). */
  dashHastePct: pct.optional(),
  projectileRangePct: pct.optional(),
  primaryCooldownPct: z.number().min(0).max(90).optional(),
  /** Move hits harder (+% on players, +% on the ball). */
  moveHit: HitBonus.optional(),
  specialHit: HitBonus.optional(),
  projectileHit: HitBonus.optional(),
  /** Hits from at least `range` away are harder. */
  longRangeHit: z.object({ range: pos, players: pct, core: pct }).optional(),
  /** Power and Cooldown Rate scaling with missing Stagger (full while Staggered). */
  guts: z.object({ powerMax: z.number(), cooldownRateMax: z.number() }).optional(),
  preventFirstKo: z.boolean().optional(),
  /** Takedown stacks of Power. */
  moxie: z.object({ start: z.number().int().min(0), power: z.number(), max: z.number().int().min(1), koLoss: z.number().int().min(0) }).optional(),
  /** Hits burn a share of the target's max Stagger over `duration` (no heal). */
  burn: z.object({ pct: frac, lightPct: frac, duration: pos }).optional(),
  /** Hitting heals a share of your max Stagger and deals `damageShare` of that to the target. */
  leftovers: z.object({ pct: frac, lightPct: frac, damageShare: z.number().min(0) }).optional(),
  /** Every `every` s unhit: +power, +speed %, up to `maxStacks`. */
  speedBoost: z.object({ every: pos, power: z.number(), speedPct: pct, maxStacks: z.number().int().min(1) }).optional(),
  /** Near the arena edge: +speed %, 0 Power. */
  edge: z.object({ range: pos, speedPct: pct }).optional(),
  creationDurationPct: pct.optional(),
  creationSizePct: pct.optional(),
  /** SPARK: base + perSpark × (other Sparks held). */
  spark: z.object({ stat: z.enum(['power', 'speed', 'cooldownRate']), base: z.number(), perSpark: z.number() }).optional(),
});
export type BoostEffects = z.infer<typeof BoostEffects>;

export const BoostDef = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  /** The OS Awakening it is modelled on. */
  os: z.string(),
  family: z.string(),
  /** Hints for CPU drafting. */
  tags: z.array(z.enum(['speed', 'power', 'tank', 'projectile', 'creation', 'special', 'cooldown', 'brawl', 'sustain', 'edge', 'spark'])),
  desc: z.string(),
  effects: BoostEffects,
});
export type BoostDef = z.infer<typeof BoostDef>;

const BoostsFile = z.object({
  draft: z.object({ startOffers: z.number().int().min(1), poolSize: z.number().int().min(1), pickTime: pos, startPickTime: pos }),
  boosts: z.array(BoostDef).min(8),
});
const file = BoostsFile.parse(boostsJson);
export const boosts: readonly BoostDef[] = file.boosts;
export const boostDraft = file.draft;

export function getBoost(id: string): BoostDef {
  const b = boosts.find((x) => x.id === id);
  if (!b) throw new Error(`Unknown boost: ${id}`);
  return b;
}
