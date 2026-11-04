import { botInput } from '../bot';
import type { PlayerInput } from '../input';
import type { World } from '../world';
import { smartBotInput } from './brain';
import type { Difficulty } from './difficulty';

export { botLabel, smartBotInput, teamJobs } from './brain';
export { DIFFICULTY, type Difficulty, type DifficultyParams } from './difficulty';
export type { BotMemory, Job, TeamPlan } from './memory';
export { moveModels, type MoveModel } from './model';
export { bestShot, danger, evaluateShot, perceive, type Perception, type ShotEval } from './perceive';

export type Brain = (world: World, id: number) => PlayerInput;

/** Every bot brain by name: `v1` is the M2/M3 bot, `v2-<difficulty>` the M4 brain. */
export const BRAINS: Record<string, Brain> = {
  v1: botInput,
  v2: (w, id) => smartBotInput(w, id, 'balance'),
  ...Object.fromEntries((['easy', 'normal', 'hard', 'balance', 'crowd'] as Difficulty[]).map((d) => [`v2-${d}`, (w: World, id: number) => smartBotInput(w, id, d)])),
};

export function getBrain(name: string): Brain {
  const b = BRAINS[name];
  if (!b) throw new Error(`Unknown brain "${name}" (have: ${Object.keys(BRAINS).join(', ')})`);
  return b;
}
