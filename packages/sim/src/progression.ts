import { gameplay } from '@pokeathlon/data';
import { TICK_RATE } from './constants';
import { isActive, maxStaggerAt, type Player, type World } from './world';

const X = gameplay.xp;
const MAX_LEVEL = X.levelThresholds.length;

/** Add XP and apply any level-ups (each level raises max Stagger by growth/9, current too). */
export function addXp(world: World, p: Player, amount: number): void {
  if (amount <= 0) return;
  p.xp += amount;
  while (p.level < MAX_LEVEL && p.xp >= X.levelThresholds[p.level]!) {
    p.level++;
    const prevMax = p.maxStagger;
    p.maxStagger = maxStaggerAt(p, p.level);
    p.stagger += p.maxStagger - prevMax;
    world.events.push({ type: 'levelUp', playerId: p.id, level: p.level });
  }
}

/** Specials unlock at level 2 (OS). Used by M3 abilities. */
export const specialUnlocked = (p: Player): boolean => p.level >= X.specialUnlockLevel;

/** Passive XP trickle during live play. */
export function stepPassiveXp(world: World): void {
  if (world.match.phase !== 'play') return;
  for (const p of world.players) {
    if (!isActive(p)) continue;
    p.xpTickAccumulator++;
    if (p.xpTickAccumulator >= TICK_RATE) {
      p.xpTickAccumulator = 0;
      addXp(world, p, X.passivePerSecond);
    }
  }
}
