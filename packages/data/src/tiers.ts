import { z } from 'zod';
import snapshotJson from '../balance/tiers.json' with { type: 'json' };

/**
 * PokéAthlon tier list (docs/design/M4-3v3-patch.md, B6): T0, T0.5, A, B, C, D, F.
 * Ranked per role like OS community lists (Forward / Goalie); Overall = the better role.
 * Sim tiers come from batch win rates; theory tiers from the static power budget.
 */
export const TIERS = ['T0', 'T0.5', 'A', 'B', 'C', 'D', 'F'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_MEANING: Record<Tier, string> = {
  T0: 'Warps the game; must be nerfed',
  'T0.5': 'Clearly best; watch it',
  A: 'Strong',
  B: 'Healthy (the target)',
  C: 'Weak',
  D: 'Clearly worst; buff',
  F: 'Unplayable; must be buffed',
};

/** Lower bounds (win rate) for each tier, best first; anything lower is F. */
export const WIN_RATE_BANDS: [Tier, number][] = [
  ['T0', 0.56],
  ['T0.5', 0.54],
  ['A', 0.52],
  ['B', 0.48],
  ['C', 0.46],
  ['D', 0.44],
];
/** Lower bounds (power budget, 100 = roster average) for theory tiers. */
export const BUDGET_BANDS: [Tier, number][] = [
  ['T0', 118],
  ['T0.5', 112],
  ['A', 106],
  ['B', 94],
  ['C', 88],
  ['D', 82],
];
/** Phantom 50 % games added to every sample so a few games can't swing a tier. */
export const PRIOR_GAMES = 100;

function band(value: number, bands: [Tier, number][]): Tier {
  for (const [tier, lo] of bands) if (value >= lo) return tier;
  return 'F';
}

export const theoryTier = (budget: number): Tier => band(budget, BUDGET_BANDS);

/** Win rate shrunk toward 50 %: (wins + prior/2) / (games + prior). */
export const shrunkWinRate = (wins: number, games: number): number => (wins + PRIOR_GAMES / 2) / (games + PRIOR_GAMES);

/** 95 % Wilson interval. */
export function wilson(wins: number, games: number): [number, number] {
  if (games === 0) return [0, 1];
  const z = 1.96;
  const p = wins / games;
  const d = 1 + (z * z) / games;
  const c = (p + (z * z) / (2 * games)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games))) / d;
  return [c - h, c + h];
}

export interface SimTier {
  tier: Tier;
  winRate: number;
  ci: [number, number];
  /** The interval spans more than this tier and one neighbour: more games needed. */
  uncertain: boolean;
}

export function simTier(wins: number, games: number): SimTier {
  const winRate = shrunkWinRate(wins, games);
  const ci = wilson(wins, games);
  const tier = band(winRate, WIN_RATE_BANDS);
  const lo = TIERS.indexOf(band(ci[1], WIN_RATE_BANDS));
  const hi = TIERS.indexOf(band(ci[0], WIN_RATE_BANDS));
  return { tier, winRate, ci, uncertain: hi - lo > 1 };
}

/** The better of two tiers (lower index = better). */
export const bestTier = (a: Tier, b: Tier): Tier => (TIERS.indexOf(a) <= TIERS.indexOf(b) ? a : b);

const RoleRecord = z.object({ wins: z.number().int().nonnegative(), games: z.number().int().nonnegative() });
export const TierSnapshot = z.object({
  generatedAt: z.string().nullable(),
  difficulty: z.string(),
  entries: z.array(
    z.object({
      pokemon: z.string(),
      forward: RoleRecord,
      goalie: RoleRecord,
      /** B5 impact score (M4.6). */
      impact: z.number().optional(),
    }),
  ),
});
export type TierSnapshot = z.infer<typeof TierSnapshot>;

/** The committed sim-tier snapshot (empty until `npm run balance` has run). */
export const tierSnapshot: TierSnapshot = TierSnapshot.parse(snapshotJson);
