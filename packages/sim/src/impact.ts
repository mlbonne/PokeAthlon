/**
 * Impact score (M4.6, docs/design/M4-3v3-patch.md B5): how much a player's stat line moves the
 * chance of winning, with weights *fitted* to batch results rather than guessed.
 *
 * Each player-game becomes a sample: the player's share of the match total (both teams) for each
 * feature, and whether their team won. A logistic regression on standardized features gives one
 * weight per feature. A player-game's impact is its predicted win probability minus 50 %, so
 * "+6" means "this stat line is typical of a side that wins 56 % of the time".
 */
export const IMPACT_FEATURES = ['goals', 'assists', 'ballProgress', 'kos', 'deaths', 'barriers', 'saves'] as const;
export type ImpactFeature = (typeof IMPACT_FEATURES)[number];
export type ImpactStats = Record<ImpactFeature, number>;

export interface ImpactModel {
  features: readonly ImpactFeature[];
  /** Weight per standardized feature (log-odds per standard deviation). */
  weights: number[];
  bias: number;
  mean: number[];
  std: number[];
  /** Fit quality: share of the training samples predicted on the right side of 50 %. */
  accuracy: number;
  samples: number;
}

/** Shares of the match total for each player (players of both teams of one match). */
export function impactShares(players: ImpactStats[]): number[][] {
  const totals = IMPACT_FEATURES.map((f) => players.reduce((s, p) => s + Math.abs(p[f]), 0));
  return players.map((p) => IMPACT_FEATURES.map((f, i) => (totals[i]! > 0 ? p[f] / totals[i]! : 0)));
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Logistic regression by full-batch gradient descent (deterministic, no dependencies). */
export function fitImpact(x: number[][], y: number[], iters = 600, lr = 0.5, l2 = 1e-3): ImpactModel {
  const n = x.length;
  const k = IMPACT_FEATURES.length;
  const mean = Array.from({ length: k }, (_, j) => x.reduce((s, r) => s + r[j]!, 0) / Math.max(1, n));
  const std = Array.from({ length: k }, (_, j) => Math.sqrt(x.reduce((s, r) => s + (r[j]! - mean[j]!) ** 2, 0) / Math.max(1, n)) || 1);
  const z = x.map((r) => r.map((v, j) => (v - mean[j]!) / std[j]!));
  const w = new Array<number>(k).fill(0);
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array<number>(k).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(z[i]!.reduce((s, v, j) => s + v * w[j]!, b));
      const e = p - y[i]!;
      for (let j = 0; j < k; j++) gw[j]! += e * z[i]![j]!;
      gb += e;
    }
    for (let j = 0; j < k; j++) w[j]! -= lr * (gw[j]! / n + l2 * w[j]!);
    b -= lr * (gb / n);
  }
  let right = 0;
  for (let i = 0; i < n; i++) if (sigmoid(z[i]!.reduce((s, v, j) => s + v * w[j]!, b)) >= 0.5 === (y[i] === 1)) right++;
  return { features: IMPACT_FEATURES, weights: w, bias: b, mean, std, accuracy: n ? right / n : 0, samples: n };
}

/** Impact of one player-game's shares, in percentage points of win probability above 50 %. */
export function impactOf(model: ImpactModel, shares: number[]): number {
  const zsum = shares.reduce((s, v, j) => s + ((v - model.mean[j]!) / model.std[j]!) * model.weights[j]!, model.bias);
  return (sigmoid(zsum) - 0.5) * 100;
}
