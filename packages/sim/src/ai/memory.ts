import type { Vec2 } from '../vec';

/** What a bot is doing this moment (shown over its head by the debug overlay). */
export type Job = 'striker' | 'support' | 'goalie';

/** One bot's memory between ticks (plain data inside `world.ai`, so it replays exactly). */
export interface BotMemory {
  /** Next tick the bot re-thinks its plan (decision interval). */
  nextDecision: number;
  /** Current plan. */
  action: string;
  target: Vec2;
  /** Best aim for a Strike, and the ball position it was worked out for. */
  aim: Vec2;
  aimFrom: Vec2;
  aimTick: number;
  aimScore: number;
  /** Degrees of aim error for this decision (difficulty). */
  aimNoise: number;
  /** First tick a threat was seen (reaction time), −1 = none. */
  threatSeen: number;
  /** Strike button held down (auto-strike on contact); false while waiting out a contest. */
  holding: boolean;
  /** Tick a contest wait started (−1 = not waiting), and how long this bot will wait. */
  waitSince: number;
  patience: number;
}

/** A team's job assignment, refreshed every decision interval. */
export interface TeamPlan {
  nextTick: number;
  /** Job per player id (null for players not on this team). */
  jobs: (Job | null)[];
}
