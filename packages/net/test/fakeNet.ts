import { createWorld, getBrain, quantizeInput, Button, withDefaultItems, type PlayerInput, type World } from '@pokeathlon/sim';
import { RollbackSession, type SeatKind } from '../src/index';

export const LINEUP = withDefaultItems(
  ['pikachu', 'lucario', 'bronzong', 'greninja', 'blastoise', 'machamp'].map((id, i) => ({ pokemonId: id, team: (i < 3 ? 0 : 1) as 0 | 1 })),
);
export const newMatch = (): World => createWorld(LINEUP.map((s) => ({ ...s })), { mode: 'match', seed: 11, boosts: true });
export const BOT = getBrain('v2-normal');

/** A "human" that mashes inputs from its own deterministic pattern. */
export function humanInput(seat: number, tick: number): PlayerInput {
  const a = ((tick >> 5) + seat * 7) % 16;
  const ang = (a / 16) * 2 * Math.PI;
  const buttons = (tick + seat * 13) % 40 === 0 ? Button.Strike : (tick + seat * 5) % 170 === 0 ? Button.Move1 : (tick + seat) % 230 === 0 ? Button.Evade : 0;
  return quantizeInput(Math.cos(ang), Math.sin(ang), Math.cos(ang), Math.sin(ang), buttons, 0);
}

interface Packet {
  at: number;
  to: Client;
  seat: number;
  tick: number;
  input: PlayerInput;
}

export interface Client {
  seat: number;
  session: RollbackSession;
  hashes: Map<number, string>;
  /** Disconnected: gets nothing, does nothing. */
  gone: boolean;
}

/**
 * Clients (one per human seat) linked by a fake network: `latency` frames each way, plus up to
 * `jitter` frames random extra delay (order is kept, like TCP). Every input sent is also logged,
 * like the real server does, so a player can rejoin.
 */
export function makeNet(humans: number[], o: { latency: number; jitter: number; seed?: number; maxRollback?: number; inputDelay?: number }) {
  let rng = o.seed ?? 1;
  const rand = () => (rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) / 2 ** 32;
  let frame = 0;
  const queue: Packet[] = [];
  const lastAt = new Map<string, number>();
  const log: { seat: number; tick: number; input: PlayerInput }[] = [];
  const clients: Client[] = [];

  const connect = (seat: number, seats: SeatKind[]): Client => {
    const hashes = new Map<number, string>();
    const c: Client = { seat, hashes, gone: false, session: null! };
    c.session = new RollbackSession({
      world: newMatch(),
      seats,
      bot: BOT,
      ...(o.maxRollback ? { maxRollback: o.maxRollback } : {}),
      ...(o.inputDelay !== undefined ? { inputDelay: o.inputDelay } : {}),
      onHash: (t, h) => hashes.set(t, h),
      send: (tick, input) => {
        log.push({ seat, tick, input });
        for (const to of clients) {
          if (to === c || to.gone) continue;
          const key = `${seat}>${to.seat}`;
          const at = Math.max(lastAt.get(key) ?? 0, frame + o.latency + Math.floor(rand() * (o.jitter + 1)));
          lastAt.set(key, at);
          queue.push({ at, to, seat, tick, input });
        }
      },
    });
    clients.push(c);
    return c;
  };
  for (const seat of humans) connect(seat, LINEUP.map((_, i) => (i === seat ? 'local' : humans.includes(i) ? 'remote' : 'bot')));

  /** One frame for everyone (clients whose seat is in `skip` don't advance this frame). */
  const tick = (skip: Set<number> = new Set()) => {
    frame++;
    const due = queue.filter((p) => p.at <= frame);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.at <= frame) queue.splice(i, 1);
    for (const p of due) if (!p.to.gone) p.to.session.receive(p.seat, p.tick, p.input);
    for (const c of clients) {
      if (c.gone || skip.has(c.seat)) continue;
      c.session.advance(humanInput(c.seat, c.session.world.tick));
    }
  };

  /** The player on `seat` disconnects; everyone else hands the seat to a bot (the server picks the tick). */
  const drop = (seat: number): number => {
    const c = clients.find((x) => x.seat === seat && !x.gone)!;
    c.gone = true;
    // The server's choice: one past the last input it relayed from that seat.
    const from = Math.max(o.inputDelay ?? 2, ...log.filter((l) => l.seat === seat).map((l) => l.tick + 1));
    // Deliver what's in flight first (TCP order), then the hand-over.
    for (const p of queue.filter((q) => q.seat === seat)) if (!p.to.gone) p.to.session.receive(p.seat, p.tick, p.input);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.seat === seat) queue.splice(i, 1);
    for (const x of clients) if (!x.gone) x.session.setBot(seat, from);
    return from;
  };

  /**
   * The player rejoins `seat`: a fresh client replays the server's input log, then everyone hands
   * the seat back at a tick nobody has reached yet. Returns that tick.
   */
  const rejoin = (seat: number, botFrom: number): { client: Client; from: number } => {
    const humansNow = clients.filter((x) => !x.gone).map((x) => x.seat);
    const seats: SeatKind[] = LINEUP.map((_, i) => (i === seat ? 'local' : humansNow.includes(i) ? 'remote' : 'bot'));
    const from = Math.max(...clients.filter((x) => !x.gone).map((x) => x.session.world.tick)) + 30;
    const c = connect(seat, seats);
    for (const l of log) if (l.seat !== seat || l.tick < botFrom) c.session.receive(l.seat, l.tick, l.input);
    c.session.setBot(seat, botFrom);
    for (const x of clients) if (!x.gone) x.session.setHuman(seat, from);
    // Catch up: simulate as fast as possible up to the hand-back tick.
    while (c.session.world.tick < from && c.session.advance().stepped > 0);
    return { client: c, from };
  };

  return { clients, tick, drop, rejoin, frame: () => frame };
}
