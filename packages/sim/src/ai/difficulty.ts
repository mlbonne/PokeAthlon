/**
 * Bot skill levels (docs/design/M4-3v3-patch.md, A5). `balance` is max skill with a little
 * noise kept on purpose so every seed plays a different game; it is the level used for tiers.
 */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'balance' | 'crowd';

export interface DifficultyParams {
  /** Ticks between noticing a threat and reacting to it. */
  reactionTicks: number;
  /** Max aim error either side, degrees. */
  aimErrorDeg: number;
  /** Ticks between plan updates. */
  decisionTicks: number;
  /** How far ahead the bot predicts the ball, ticks. */
  lookAheadTicks: number;
  /** Which move slots it uses: 1 = primary only, 2 = + secondary, 3 = all. */
  moveSlots: number;
  /** Uses Evade / Energy Burst defensively. */
  dodges: boolean;
  /**
   * Spacing discipline (brawling rework): the support holds a lane away from the ball and walks around
   * scrums. `crowd` turns it off: the pre-rework positioning, kept as an experiment control.
   */
  spacing: boolean;
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: { reactionTicks: 18, aimErrorDeg: 12, decisionTicks: 24, lookAheadTicks: 40, moveSlots: 1, dodges: false, spacing: true },
  normal: { reactionTicks: 11, aimErrorDeg: 6, decisionTicks: 15, lookAheadTicks: 75, moveSlots: 2, dodges: true, spacing: true },
  hard: { reactionTicks: 6, aimErrorDeg: 2, decisionTicks: 9, lookAheadTicks: 120, moveSlots: 3, dodges: true, spacing: true },
  balance: { reactionTicks: 6, aimErrorDeg: 2, decisionTicks: 9, lookAheadTicks: 120, moveSlots: 3, dodges: true, spacing: true },
  crowd: { reactionTicks: 6, aimErrorDeg: 2, decisionTicks: 9, lookAheadTicks: 120, moveSlots: 3, dodges: true, spacing: false },
};
