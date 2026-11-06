import { createWorld, getBrain, quantizeInput, Button, withDefaultItems, type PlayerInput, type World } from '@pokeathlon/sim';
import { RollbackSession, type SeatKind } from '../src/index';

export const LINEUP = withDefaultItems(
  ['pikachu', 'lucario', 'snorlax', 'greninja', 'blastoise', 'machamp'].map((id, i) => ({ pokemonId: id, team: (i < 3 ? 0 : 1) as 0 | 1 })),
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
  to: number;
  seat: number;
  tick: number;
  input: PlayerInput;
}

export interface Client {
  seat: number;
  session: RollbackSession;
  hashes: Map<number, string>;
}

/**
 * Clients (one per human seat) linked by a fake network: `latency` frames each way, plus up to
 * `jitter` frames random extra delay (order is kept, like TCP). `slow` lists clients that skip frames.
 */
export function makeNet(humans: number[], o: { latency: number; jitter: number; seed?: number; maxRollback?: number; inputDelay?: number }) {
  let rng = o.seed ?? 1;
  const rand = () => ((rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) / 2 ** 32);
  let frame = 0;
  const queue: Packet[] = [];
  const lastAt = new Map<string, number>();
  const clients: Client[] = humans.map((seat) => {
    const seats: SeatKind[] = LINEUP.map((_, i) => (i === seat ? 'local' : humans.includes(i) ? 'remote' : 'bot'));
    const hashes = new Map<number, string>();
    const c: Client = {
      seat,
      hashes,
      session: new RollbackSession({
        world: newMatch(),
        seats,
        bot: BOT,
        ...(o.maxRollback ? { maxRollback: o.maxRollback } : {}),
        ...(o.inputDelay !== undefined ? { inputDelay: o.inputDelay } : {}),
        onHash: (t, h) => hashes.set(t, h),
        send: (tick, input) => {
          for (let to = 0; to < humans.length; to++) {
            if (humans[to] === seat) continue;
            const key = `${seat}>${to}`;
            const at = Math.max(lastAt.get(key) ?? 0, frame + o.latency + Math.floor(rand() * (o.jitter + 1)));
            lastAt.set(key, at);
            queue.push({ at, to, seat, tick, input });
          }
        },
      }),
    };
    return c;
  });
  /** One frame for everyone (clients in `skip` don't advance this frame). */
  const tick = (skip: Set<number> = new Set()) => {
    frame++;
    for (let i = queue.length - 1; i >= 0; i--) {
      const p = queue[i]!;
      if (p.at > frame) continue;
    }
    const due = queue.filter((p) => p.at <= frame).sort((a, b) => a.tick - b.tick);
    for (const p of due) clients[p.to]!.session.receive(p.seat, p.tick, p.input);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.at <= frame) queue.splice(i, 1);
    for (const c of clients) {
      if (skip.has(c.seat)) continue;
      c.session.advance(humanInput(c.seat, c.session.world.tick));
    }
  };
  return { clients, tick, frame: () => frame };
}
