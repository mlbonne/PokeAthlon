import {
  hashWorldDeep,
  NEUTRAL_INPUT,
  restoreWorld,
  snapshotWorld,
  step,
  type PlayerInput,
  type SimEvent,
  type World,
  type WorldSnapshot,
} from '@pokeathlon/sim';

/**
 * Rollback netcode (M7.1). Every machine runs the same deterministic match; only inputs travel.
 *
 * - Your input for the current frame is scheduled `inputDelay` ticks ahead and sent at once.
 * - A remote input that hasn't arrived yet is predicted (that player's last known input).
 * - When a real input arrives that differs from the guess, the world is restored to the saved state
 *   before that tick and re-simulated up to the present.
 * - The match never runs more than `maxRollback` ticks ahead of the slowest remote player; past that
 *   it waits (a "stall"), like fighting games do.
 * - Bot seats are computed on every machine from the world, so they need no network at all.
 *
 * Inputs on the wire arrive in order and without loss (WebSocket/TCP), so per remote seat we only
 * need "inputs known up to tick N".
 */

export type SeatKind = 'local' | 'remote' | 'bot';
export type Brain = (world: World, id: number) => PlayerInput;

export interface SessionOptions {
  /** The match, created identically on every machine (same lineup, seed and options). */
  world: World;
  /** Who plays each player index. Exactly one `local` seat (or none for a spectator). */
  seats: SeatKind[];
  /** Brain for bot seats; must be the same on every machine. */
  bot: Brain;
  /** Ticks between pressing a button and it taking effect (default 2 = 33 ms). */
  inputDelay?: number;
  /** How far the game may run ahead of the slowest remote player before it waits (default 8). */
  maxRollback?: number;
  /** Publish this machine's input for `tick`. */
  send?: (tick: number, input: PlayerInput) => void;
  /** A deep state hash for a confirmed tick (desync check), every `hashEvery` ticks. */
  onHash?: (tick: number, hash: string) => void;
  hashEvery?: number;
}

export interface AdvanceResult {
  /** Ticks simulated for the first time this call (0 = waiting for a slow player, or 1). */
  stepped: number;
  /** Ticks re-simulated because a guess was wrong. */
  resimulated: number;
  /** New visual events: events from new ticks, plus events re-simulation produced that weren't shown yet. */
  events: SimEvent[];
}

export interface SessionStats {
  rollbacks: number;
  resimulatedTicks: number;
  stalls: number;
  /** Largest rollback so far, in ticks. */
  maxDepth: number;
}

const inputsEqual = (a: PlayerInput, b: PlayerInput): boolean =>
  a.moveX === b.moveX &&
  a.moveY === b.moveY &&
  a.aimX === b.aimX &&
  a.aimY === b.aimY &&
  a.buttons === b.buttons &&
  (a.aimDist ?? 0) === (b.aimDist ?? 0) &&
  (a.pick ?? -1) === (b.pick ?? -1);

/** Identity of an event, so one re-simulated a few ticks later isn't shown twice. */
const KEY_FIELDS = ['playerId', 'team', 'id', 'by', 'moveId', 'scorer', 'index', 'level', 'boostId', 'round', 'set', 'kind'] as const;
function eventKey(e: SimEvent): string {
  let k = e.type;
  const r = e as unknown as Record<string, unknown>;
  for (const f of KEY_FIELDS) if (r[f] !== undefined) k += `|${String(r[f])}`;
  return k;
}

export class RollbackSession {
  readonly world: World;
  readonly seats: SeatKind[];
  readonly local: number;
  readonly inputDelay: number;
  readonly maxRollback: number;
  readonly stats: SessionStats = { rollbacks: 0, resimulatedTicks: 0, stalls: 0, maxDepth: 0 };

  private readonly bot: Brain;
  private readonly send: ((tick: number, input: PlayerInput) => void) | undefined;
  private readonly onHash: ((tick: number, hash: string) => void) | undefined;
  private readonly hashEvery: number;
  /** Known inputs per seat, indexed by tick. Seats that are bots from tick T have no entries from T on. */
  private readonly inputs: PlayerInput[][];
  /** Tick from which a seat is played by a bot (Infinity = never). */
  private readonly botFrom: number[];
  /** Inputs actually used for each simulated, not yet confirmed tick (to detect wrong guesses). */
  private readonly used = new Map<number, PlayerInput[]>();
  /** State before stepping tick t, for ticks we may still roll back to (plus pending hash ticks). */
  private readonly snaps = new Map<number, WorldSnapshot>();
  /** Event keys already shown, per tick. */
  private readonly shown = new Map<number, Set<string>>();
  /** Earliest tick whose used input turned out wrong (Infinity = none). */
  private rollbackFrom = Infinity;
  /** Next tick the local player's input will be scheduled for. */
  private nextLocal: number;
  private lastHashed = 0;

  constructor(o: SessionOptions) {
    this.world = o.world;
    this.seats = [...o.seats];
    this.local = o.seats.indexOf('local');
    this.bot = o.bot;
    this.inputDelay = o.inputDelay ?? 2;
    this.maxRollback = o.maxRollback ?? 8;
    this.send = o.send;
    this.onHash = o.onHash;
    this.hashEvery = o.hashEvery ?? 120;
    this.botFrom = o.seats.map((s) => (s === 'bot' ? 0 : Infinity));
    // Ticks before the first possible input are neutral for every human seat, on every machine.
    const start = this.world.tick;
    this.inputs = o.seats.map(() => []);
    for (let s = 0; s < o.seats.length; s++) for (let t = start; t < start + this.inputDelay; t++) this.inputs[s]![t] = NEUTRAL_INPUT;
    this.nextLocal = start + this.inputDelay;
  }

  /** Number of ticks for which every human seat's input is known (the confirmed prefix). */
  get confirmed(): number {
    let c = Infinity;
    for (let s = 0; s < this.seats.length; s++) if (this.seats[s] !== 'bot') c = Math.min(c, Math.min(this.known(s), this.botFrom[s]!));
    return c === Infinity ? this.world.tick + this.maxRollback + 1 : c;
  }

  /** How many ticks the local game is ahead of the confirmed state. */
  get ahead(): number {
    return this.world.tick - Math.min(this.confirmed, this.world.tick);
  }

  /** Inputs of seat `s` are known for ticks below this. */
  private known(s: number): number {
    return this.inputs[s]!.length;
  }

  /** A remote seat's input for `tick` arrived. Inputs per seat must arrive in tick order. */
  receive(seat: number, tick: number, input: PlayerInput): void {
    const list = this.inputs[seat]!;
    if (tick !== list.length) {
      if (tick < list.length) return; // duplicate
      throw new Error(`net: seat ${seat} input for tick ${tick} arrived before tick ${list.length}`);
    }
    list.push(input);
    const used = this.used.get(tick)?.[seat];
    if (used && !inputsEqual(used, input)) this.rollbackFrom = Math.min(this.rollbackFrom, tick);
  }

  /**
   * Seat `seat` is played by a bot from `fromTick` on (a player dropped out). Every machine must
   * get the same tick; inputs the seat sent for later ticks are ignored.
   */
  setBot(seat: number, fromTick: number): void {
    this.botFrom[seat] = fromTick;
    this.seats[seat] = 'bot';
    this.inputs[seat]!.length = Math.min(this.inputs[seat]!.length, fromTick);
    if (fromTick < this.world.tick) this.rollbackFrom = Math.min(this.rollbackFrom, fromTick);
  }

  /** The input seat `s` uses at tick `t`: known, bot, or a guess. */
  private inputFor(s: number, t: number): PlayerInput {
    if (t >= this.botFrom[s]!) return this.bot(this.world, s);
    const list = this.inputs[s]!;
    if (t < list.length) return list[t]!;
    return list.length > 0 ? list[list.length - 1]! : NEUTRAL_INPUT;
  }

  private stepOnce(events: SimEvent[] | null, resim: boolean): void {
    const t = this.world.tick;
    const confirmed = this.confirmed;
    if (t >= confirmed || (t % this.hashEvery === 0 && t > this.lastHashed)) this.snaps.set(t, snapshotWorld(this.world));
    const inputs = this.seats.map((_, s) => this.inputFor(s, t));
    if (t >= confirmed) this.used.set(t, inputs);
    else this.used.delete(t);
    step(this.world, inputs);
    if (!events) return;
    let seen = this.shown.get(t);
    if (!seen) this.shown.set(t, (seen = new Set()));
    for (const e of this.world.events) {
      const k = eventKey(e);
      if (resim && seen.has(k)) continue;
      seen.add(k);
      events.push(e);
    }
  }

  /**
   * One frame: schedule the local input, fix any wrong guesses, then simulate one new tick unless
   * that would run too far ahead of the slowest remote player.
   */
  advance(localInput: PlayerInput = NEUTRAL_INPUT): AdvanceResult {
    const events: SimEvent[] = [];
    let resimulated = 0;

    // 1. Wrong guesses: restore the state before the first wrong tick and re-simulate.
    if (this.rollbackFrom < this.world.tick) {
      const from = this.rollbackFrom;
      const now = this.world.tick;
      restoreWorld(this.world, this.snaps.get(from)!);
      for (let t = from; t < now; t++) this.stepOnce(events, true);
      resimulated = now - from;
      this.stats.rollbacks++;
      this.stats.resimulatedTicks += resimulated;
      this.stats.maxDepth = Math.max(this.stats.maxDepth, resimulated);
    }
    this.rollbackFrom = Infinity;

    // 2. Desync check on confirmed ticks, then forget what can no longer be rolled back.
    this.hashConfirmed();
    this.prune();

    // 3. New tick, unless too far ahead.
    if (this.world.tick - this.confirmed >= this.maxRollback) {
      this.stats.stalls++;
      return { stepped: 0, resimulated, events };
    }
    if (this.local >= 0 && this.nextLocal < this.botFrom[this.local]!) {
      const tick = this.nextLocal++;
      this.inputs[this.local]![tick] = localInput;
      this.send?.(tick, localInput);
    }
    this.stepOnce(events, false);
    return { stepped: 1, resimulated, events };
  }

  private hashConfirmed(): void {
    if (!this.onHash) return;
    const c = Math.min(this.confirmed, this.world.tick);
    for (let t = this.lastHashed + this.hashEvery; t <= c; t += this.hashEvery) {
      const snap = this.snaps.get(t);
      if (snap) this.onHash(t, hashWorldDeep(snap as World));
      this.lastHashed = t;
    }
  }

  private prune(): void {
    const c = Math.min(this.confirmed, this.world.tick);
    for (const t of this.snaps.keys()) if (t < c) this.snaps.delete(t);
    for (const t of this.used.keys()) if (t < c) this.used.delete(t);
    for (const t of this.shown.keys()) if (t < c - 1) this.shown.delete(t);
  }
}
