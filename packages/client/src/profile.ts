import { roster } from '@pokeathlon/data';
import { DEFAULT_AUDIO, type AudioPrefs } from './audio';

/** Lobby roles: Flex picks one at random for each match (OS role select). */
export type LobbyRole = 'forward' | 'flex' | 'goalie';
export type LobbyMode = 'quick' | 'custom' | 'practice' | 'watch' | 'online';

/** How matches look (lobby Settings → Match display). */
export interface DisplayPrefs {
  /** White ground aura under your team. */
  auras: boolean;
  /** Aura opacity, 0.1–1. */
  auraOpacity: number;
  /** Nameplates: the Pokémon's name, the trainer's (you, room players, "CPU"), or both. */
  names: 'pokemon' | 'trainer' | 'both';
  /** Name colours for your team and the opponents, and your arrow's colour. */
  allyColor: string;
  enemyColor: string;
  arrowColor: string;
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  auras: true,
  auraOpacity: 0.4,
  names: 'pokemon',
  allyColor: '#b9cfff',
  enemyColor: '#ff3b4a',
  arrowColor: '#ff2a3d',
};

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
  display: DisplayPrefs;
  /** Volumes (Settings → Sound). */
  audio: AudioPrefs;
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
  display: { ...DEFAULT_DISPLAY },
  audio: { ...DEFAULT_AUDIO },
};

export function loadProfile(): Profile {
  let p: Profile = structuredClone(DEFAULTS);
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Profile> | null;
    if (s) p = { ...p, ...s, loadout: { ...s.loadout }, records: { ...s.records }, display: { ...DEFAULT_DISPLAY, ...s.display }, audio: { ...DEFAULT_AUDIO, ...s.audio } };
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

const HEX = /^#[0-9a-f]{6}$/i;
/** Push the display colours to CSS variables (nameplates and the arrow read them). */
export function applyDisplay(d: DisplayPrefs): void {
  const root = document.documentElement.style;
  root.setProperty('--name-ally', HEX.test(d.allyColor) ? d.allyColor : DEFAULT_DISPLAY.allyColor);
  root.setProperty('--name-enemy', HEX.test(d.enemyColor) ? d.enemyColor : DEFAULT_DISPLAY.enemyColor);
  root.setProperty('--me-arrow', HEX.test(d.arrowColor) ? d.arrowColor : DEFAULT_DISPLAY.arrowColor);
}
