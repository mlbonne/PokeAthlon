import { createWorld, getBrain, type PlayerInput, type World } from '@pokeathlon/sim';
import {
  INPUT_DELAY,
  packInput,
  PROTOCOL_VERSION,
  unpackInput,
  type ClientMsg,
  type MatchStart,
  type RoomState,
  type SeatControl,
  type ServerMsg,
  type WireInput,
} from './protocol';
import { RollbackSession, type SeatKind } from './session';

/** The bits of a WebSocket the client needs (the browser's and Node's both fit). */
export interface Socket {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface NetEvents {
  room?(room: RoomState, you: number): void;
  /** A match started (or resumed): the world to show and your seat (null = watching). */
  match?(world: World, seat: number | null, session: RollbackSession): void;
  desync?(tick: number): void;
  error?(msg: string): void;
  closed?(): void;
}

/** Remembered so a dropped player can rejoin the same seat. */
export interface RejoinTicket {
  code: string;
  token: string;
}

/** Build the match every machine plays, from the server's start message. */
export function worldFor(start: MatchStart): World {
  return createWorld(
    start.lineup.map((s) => ({ ...s })),
    { mode: 'match', seed: start.seed, boosts: start.settings.boosts },
  );
}

/**
 * One player's connection to a room (M7.3). Owns the rollback session during a match.
 * The game calls {@link NetClient.frame} once per 60 Hz tick with the local input.
 */
export class NetClient {
  you = -1;
  token = '';
  room: RoomState | null = null;
  session: RollbackSession | null = null;
  seat: number | null = null;
  /** Round-trip time to the server, ms (smoothed). */
  rtt = 0;
  desyncAt = -1;
  private latest: number[] = [];
  private skipCount = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ws: Socket,
    private readonly on: NetEvents,
    hello: { name: string; create?: boolean; code?: string; token?: string },
  ) {
    ws.onopen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, ...hello });
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: Date.now() }), 1000);
    };
    ws.onmessage = (ev) => this.message(JSON.parse(String(ev.data)) as ServerMsg);
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.on.closed?.();
    };
    ws.onerror = () => {};
  }

  get ticket(): RejoinTicket | null {
    return this.room && this.token ? { code: this.room.code, token: this.token } : null;
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
  }

  private message(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.you = m.you;
        this.token = m.token;
        return;
      case 'room':
        this.room = m.room;
        if (m.room.phase === 'lobby') this.session = null;
        this.on.room?.(m.room, this.you);
        return;
      case 'start':
        this.begin(m.match, m.you, null);
        return;
      case 'resume':
        this.begin(m.match, m.you, { inputs: m.inputs, control: m.control });
        return;
      case 'in': {
        const { tick, input } = unpackInput(m.i);
        this.session?.receive(m.s, tick, input);
        return;
      }
      case 'ctl':
        if (!this.session) return;
        if (m.c.bot) this.session.setBot(m.c.seat, m.c.tick);
        else this.session.setHuman(m.c.seat, m.c.tick);
        return;
      case 'sync':
        this.latest = m.k;
        return;
      case 'desync':
        this.desyncAt = m.k;
        this.on.desync?.(m.k);
        return;
      case 'pong':
        this.rtt = this.rtt === 0 ? Date.now() - m.c : this.rtt * 0.8 + (Date.now() - m.c) * 0.2;
        return;
      case 'err':
        this.on.error?.(m.msg);
        return;
    }
  }

  private begin(start: MatchStart, you: number | null, resume: { inputs: WireInput[][]; control: SeatControl[] } | null): void {
    const world = worldFor(start);
    // Who played each seat at tick 0; later hand-overs (drops, rejoins) are replayed below.
    const seats: SeatKind[] = start.humans.map((h, s) => (s === you ? 'local' : h ? 'remote' : 'bot'));
    const session = new RollbackSession({
      world,
      seats,
      bot: getBrain(`v2-${start.settings.diff}`),
      inputDelay: INPUT_DELAY,
      send: (tick, input) => this.send({ t: 'in', i: packInput(tick, input) }),
      onHash: (k, h) => this.send({ t: 'hash', k, h }),
    });
    if (resume) {
      // Replay each seat's log in tick order, with its hand-overs in between.
      for (let s = 0; s < seats.length; s++) {
        const list = resume.inputs[s] ?? [];
        const ctl = resume.control.filter((c) => c.seat === s).sort((a, b) => a.tick - b.tick);
        let i = 0;
        for (const c of ctl) {
          while (i < list.length && list[i]![0] < c.tick) {
            const { tick, input } = unpackInput(list[i++]!);
            session.receive(s, tick, input);
          }
          if (c.bot) session.setBot(s, c.tick);
          else session.setHuman(s, c.tick);
        }
        while (i < list.length) {
          const { tick, input } = unpackInput(list[i++]!);
          session.receive(s, tick, input);
        }
      }
      // Catch up as far as the inputs allow (the game keeps catching up frame by frame after).
      for (let n = 0; n < 200_000 && session.advance().stepped > 0; n++);
    }
    this.session = session;
    this.seat = you;
    this.desyncAt = -1;
    this.on.match?.(world, you, session);
  }

  /**
   * Ticks to run this frame. Normally 1. 0 now and then while this machine is ahead of the
   * others, and more than 1 while catching up after a rejoin.
   */
  ticksThisFrame(): number {
    const s = this.session;
    if (!s) return 0;
    const others = this.latest.filter((k, i) => k >= 0 && i !== this.seat);
    if (others.length === 0) return 1;
    const target = Math.max(...others) - INPUT_DELAY;
    const gap = s.world.tick - target;
    // Far behind (rejoined, or the tab was in the background): catch up quickly.
    if (gap < -30) return 4;
    // Ahead of everyone: skip every 6th tick until level (the others catch up without stalling).
    if (gap > INPUT_DELAY + 2 && ++this.skipCount % 6 === 0) return 0;
    return 1;
  }

  /** Run one tick with your input; returns the session's result. */
  advance(input: PlayerInput) {
    return this.session!.advance(input);
  }
}
