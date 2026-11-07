import { roster } from '@pokeathlon/data';

/** Lobby roles: Flex picks one at random for each match (OS role select). */
export type LobbyRole = 'forward' | 'flex' | 'goalie';
export type LobbyMode = 'quick' | 'custom' | 'practice' | 'watch' | 'online';

export interface MonRecord {
  games: number;
  wins: number;
  goals: number;
  kos: number;
  forward: number;
  goalie: number;
}

/** The player's profile, kept in this browser (non-commercial: progress is earned by playing only). */
export interface Profile {
  name: string;
  /** The Pokémon shown in the lobby and picked for you by default. */
  main: string;
  role: LobbyRole;
  mode: LobbyMode;
  diff: 'easy' | 'normal' | 'hard';
  bans: boolean;
  xp: number;
  /** Preferred held item per Pokémon and role ('auto' = recommended). */
  loadout: Record<string, { forward: string; goalie: string }>;
  records: Record<string, MonRecord>;
}

const STORE = 'pokeathlon.profile';

const DEFAULTS: Profile = {
  name: 'Trainer',
  main: 'pikachu',
  role: 'forward',
  mode: 'quick',
  diff: 'normal',
  bans: false,
  xp: 0,
  loadout: {},
  records: {},
};

export function loadProfile(): Profile {
  let p: Profile = structuredClone(DEFAULTS);
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Profile> | null;
    if (s) p = { ...p, ...s, loadout: { ...s.loadout }, records: { ...s.records } };
  } catch {
    /* storage blocked or corrupt: defaults */
  }
  if (!roster.some((r) => r.id === p.main)) p.main = roster[0]!.id;
  return p;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Trainer level from XP: each level needs 100 XP more than the last (100, 200, 300, …). */
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let need = 100;
  let left = Math.max(0, Math.floor(xp));
  while (left >= need) {
    left -= need;
    level++;
    need += 100;
  }
  return { level, into: left, need };
}

export const itemFor = (p: Profile, mon: string, role: 'forward' | 'goalie'): string => p.loadout[mon]?.[role] ?? 'auto';

/** XP for one finished match. */
export const matchXp = (won: boolean, goals: number, kos: number): number => 100 + (won ? 60 : 0) + goals * 25 + kos * 10;

/** Record a finished match for the Pokémon you played. Returns the XP gained. */
export function recordMatch(p: Profile, r: { mon: string; role: 'forward' | 'goalie'; won: boolean; goals: number; kos: number }): number {
  const rec = (p.records[r.mon] ??= { games: 0, wins: 0, goals: 0, kos: 0, forward: 0, goalie: 0 });
  rec.games++;
  if (r.won) rec.wins++;
  rec.goals += r.goals;
  rec.kos += r.kos;
  rec[r.role]++;
  const xp = matchXp(r.won, r.goals, r.kos);
  p.xp += xp;
  saveProfile(p);
  return xp;
}

export function totals(p: Profile): MonRecord {
  const t: MonRecord = { games: 0, wins: 0, goals: 0, kos: 0, forward: 0, goalie: 0 };
  for (const r of Object.values(p.records)) for (const k of Object.keys(t) as (keyof MonRecord)[]) t[k] += r[k];
  return t;
}
