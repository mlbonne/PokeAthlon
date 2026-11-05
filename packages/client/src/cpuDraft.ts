import { defaultItem, getKit, getPokemon, roster } from '@pokeathlon/data';
import { tierSnapshot } from '@pokeathlon/data/analyze';

/**
 * CPU picks for the pick screen (M5.7): fill a team's empty slots with Pokémon (no duplicates within
 * a team, nothing banned) and give each its role's item. Uses the tier snapshot (per-role win rates
 * from `npm run balance`). Easy picks at random, Normal favours strong picks, Hard takes the best
 * available for the role. `rand` is injected (0 ≤ x < 1) so tests and the screen are reproducible.
 */
export type Skill = 'easy' | 'normal' | 'hard';
export type Role = 'forward' | 'goalie';

const PRIOR = 100; // phantom 50 % games, same shrinkage as the tier list

/** Shrunk win rate of a Pokémon in a role from the snapshot (0.5 when unknown). */
export function roleStrength(id: string, role: Role): number {
  const e = tierSnapshot.entries.find((x) => x.pokemon === id);
  const r = e?.[role];
  return r ? (r.wins + PRIOR / 2) / (r.games + PRIOR) : 0.5;
}

export const pickable = (): string[] => roster.filter((r) => getKit(r.id)).map((r) => r.id);

/** One CPU pick for `role`, avoiding `taken` (own team) and `banned`. */
export function cpuPick(role: Role, taken: string[], banned: string[], skill: Skill, rand: () => number): string {
  const pool = pickable().filter((id) => !taken.includes(id) && !banned.includes(id));
  if (!pool.length) return pickable()[0]!;
  if (skill === 'easy') return pool[Math.floor(rand() * pool.length)]!;
  const scored = pool.map((id) => ({ id, s: roleStrength(id, role) })).sort((a, b) => b.s - a.s);
  if (skill === 'hard') return scored[0]!.id;
  // Normal: weighted toward strong picks (weight = strength² among the top 5).
  const top = scored.slice(0, 5);
  const w = top.map((x) => x.s * x.s);
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) {
    r -= w[i]!;
    if (r <= 0) return top[i]!.id;
  }
  return top[0]!.id;
}

/** CPU ban: the strongest Pokémon overall (Hard/Normal), or a random one (Easy). */
export function cpuBan(skill: Skill, banned: string[], rand: () => number): string {
  const pool = pickable().filter((id) => !banned.includes(id));
  if (skill === 'easy') return pool[Math.floor(rand() * pool.length)]!;
  return pool.map((id) => ({ id, s: Math.max(roleStrength(id, 'forward'), roleStrength(id, 'goalie')) })).sort((a, b) => b.s - a.s)[0]!.id;
}

/** The item a CPU takes for a Pokémon in a role. */
export const cpuItem = (id: string, role: Role): string => defaultItem(getPokemon(id).archetype, role).id;

/** A small seeded random (mulberry32) for reproducible screens. */
export function seededRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
