import type { PlayerInput, PlayerSpawn } from '@pokeathlon/sim';

/**
 * Messages between the game and the room server (M7.2). JSON over WebSocket.
 * Inputs travel as short arrays to keep them small: [tick, moveX, moveY, aimX, aimY, buttons, aimDist, pick].
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8787;
export const SEATS = 6;
/** Ticks between pressing a button and it taking effect online (33 ms). Same on every machine. */
export const INPUT_DELAY = 2;

export type WireInput = [number, number, number, number, number, number, number, number];

export const packInput = (tick: number, i: PlayerInput): WireInput => [tick, i.moveX, i.moveY, i.aimX, i.aimY, i.buttons, i.aimDist ?? 0, i.pick ?? -1];

export function unpackInput(w: WireInput): { tick: number; input: PlayerInput } {
  const input: PlayerInput = { moveX: w[1], moveY: w[2], aimX: w[3], aimY: w[4], buttons: w[5], aimDist: w[6] };
  if (w[7] >= 0) input.pick = w[7];
  return { tick: w[0], input };
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** A seat's pick in the room: a Pokémon id or 'auto', and an item id or 'auto'. */
export interface SeatPick {
  pokemon: string;
  item: string;
}

export interface RoomSettings {
  diff: Difficulty;
  boosts: boolean;
}

export interface Member {
  id: number;
  name: string;
  seat: number | null;
  /** Lost connection (their seat is reserved and played by a bot until they rejoin). */
  away: boolean;
}

export interface RoomState {
  code: string;
  host: number;
  members: Member[];
  /** Per seat (0–2 Blue, 3–5 Red; the last of each team is the goalie). */
  picks: SeatPick[];
  settings: RoomSettings;
  phase: 'lobby' | 'match';
}

/** Who plays each seat at a tick: a human (`bot: false`) or a bot. */
export interface SeatControl {
  seat: number;
  tick: number;
  bot: boolean;
}

export interface MatchStart {
  lineup: PlayerSpawn[];
  seed: number;
  settings: RoomSettings;
  /** Seats played by a human at tick 0. */
  humans: boolean[];
}

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; create?: boolean; code?: string; token?: string }
  | { t: 'seat'; seat: number | null }
  | { t: 'pick'; seat: number; pick: SeatPick }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'start'; lineup: PlayerSpawn[] }
  | { t: 'lobby' }
  | { t: 'in'; i: WireInput }
  | { t: 'hash'; k: number; h: string }
  | { t: 'ping'; c: number };

export type ServerMsg =
  | { t: 'welcome'; you: number; token: string }
  | { t: 'room'; room: RoomState }
  | { t: 'start'; match: MatchStart; you: number | null }
  /** Rejoining a match in progress: everything sent so far, then live messages follow. */
  | { t: 'resume'; match: MatchStart; you: number; inputs: WireInput[][]; control: SeatControl[] }
  | { t: 'in'; s: number; i: WireInput }
  | { t: 'ctl'; c: SeatControl }
  /** Latest input tick the server has from each seat (-1 = none / bot), for pacing. */
  | { t: 'sync'; k: number[] }
  | { t: 'desync'; k: number }
  | { t: 'pong'; c: number }
  | { t: 'err'; msg: string };
