import { randomBytes } from 'node:crypto';
import {
  INPUT_DELAY,
  PROTOCOL_VERSION,
  SEATS,
  type ClientMsg,
  type MatchStart,
  type Member,
  type RoomState,
  type SeatControl,
  type SeatPick,
  type ServerMsg,
  type WireInput,
} from '@pokeathlon/net';

/**
 * Room server logic (M7.2), independent of sockets so it can be tested directly.
 *
 * The server never runs the game. It keeps rooms and seats, relays every input to everyone in the
 * room, keeps the full input log (so a player can rejoin), hands a dropped player's seat to a bot,
 * and compares the state hashes the players report (desync check).
 */

export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

interface Client {
  conn: Conn;
  member: Member;
  token: string;
  room: Room | null;
}

interface Match {
  start: MatchStart;
  /** Per seat: every input received, by tick (index = tick; bot ticks hold null). */
  inputs: (WireInput | null)[][];
  control: SeatControl[];
  /** Who sits where at the match start, by member id. */
  owners: (number | null)[];
  hashes: Map<number, string>;
  desynced: boolean;
}

/** Codes avoid letters that read alike (I/L/O/0). */
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const MAX_NAME = 16;
/** How far ahead a rejoining player takes their seat back (90 ticks = 1.5 s). */
export const REJOIN_LEAD = 90;
/** Hashes kept for comparison. */
const HASH_WINDOW = 64;

export class Room {
  readonly code: string;
  host = 0;
  readonly clients: Client[] = [];
  picks: SeatPick[] = Array.from({ length: SEATS }, () => ({ pokemon: 'auto', item: 'auto' }));
  settings: RoomState['settings'] = { diff: 'normal', boosts: true };
  match: Match | null = null;

  constructor(code: string) {
    this.code = code;
  }

  state(): RoomState {
    return {
      code: this.code,
      host: this.host,
      members: this.clients.map((c) => ({ ...c.member })),
      picks: this.picks.map((p) => ({ ...p })),
      settings: { ...this.settings },
      phase: this.match ? 'match' : 'lobby',
    };
  }

  broadcast(msg: ServerMsg, except?: Client): void {
    for (const c of this.clients) if (c !== except && !c.member.away) c.conn.send(msg);
  }

  sendState(): void {
    this.broadcast({ t: 'room', room: this.state() });
  }

  /** Is `seat` played by a human right now? */
  humanNow(seat: number): boolean {
    const m = this.match!;
    let human = m.start.humans[seat]!;
    for (const c of m.control) if (c.seat === seat) human = !c.bot;
    return human;
  }

  /** Latest tick the server has an input for, per seat (-1 if none or a bot). */
  latest(): number[] {
    const m = this.match!;
    return m.inputs.map((l, s) => (this.humanNow(s) ? l.length - 1 : -1));
  }
}

export class RoomServer {
  private readonly rooms = new Map<string, Room>();
  private readonly clients = new Set<Client>();
  private nextId = 1;

  constructor(private readonly rand: () => number = Math.random) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  room(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  connect(conn: Conn): Client {
    const c: Client = { conn, member: { id: this.nextId++, name: '', seat: null, away: false }, token: randomBytes(12).toString('hex'), room: null };
    this.clients.add(c);
    return c;
  }

  /** Pacing: every room in a match gets the latest input tick per seat (call about twice a second). */
  tickSync(): void {
    for (const r of this.rooms.values()) if (r.match) r.broadcast({ t: 'sync', k: r.latest() });
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(this.rand() * CODE_LETTERS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  handle(c: Client, msg: ClientMsg): void {
    if (msg.t === 'hello') return this.hello(c, msg);
    const r = c.room;
    if (!r) return c.conn.send({ t: 'err', msg: 'Not in a room.' });
    const isHost = r.host === c.member.id;
    switch (msg.t) {
      case 'ping':
        c.conn.send({ t: 'pong', c: msg.c });
        return;
      case 'seat': {
        if (r.match) return;
        const s = msg.seat;
        if (s !== null && (!Number.isInteger(s) || s < 0 || s >= SEATS)) return;
        if (s !== null && r.clients.some((o) => o !== c && o.member.seat === s)) return c.conn.send({ t: 'err', msg: 'That seat is taken.' });
        c.member.seat = s;
        r.sendState();
        return;
      }
      case 'pick': {
        if (r.match || !Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat >= SEATS) return;
        const owner = r.clients.find((o) => o.member.seat === msg.seat);
        // Your own seat, or a bot seat if you are the host.
        if (owner ? owner !== c : !isHost) return;
        r.picks[msg.seat] = { pokemon: String(msg.pick.pokemon).slice(0, 32), item: String(msg.pick.item).slice(0, 32) };
        r.sendState();
        return;
      }
      case 'settings':
        if (!isHost || r.match) return;
        r.settings = { diff: ['easy', 'normal', 'hard'].includes(msg.settings.diff) ? msg.settings.diff : 'normal', boosts: !!msg.settings.boosts };
        r.sendState();
        return;
      case 'start':
        return this.start(c, r, msg.lineup);
      case 'lobby':
        if (!isHost || !r.match) return;
        r.match = null;
        // Players who left during the match free their seat now.
        for (const o of [...r.clients]) if (o.member.away) this.removeFromRoom(o, r);
        r.sendState();
        return;
      case 'in':
        return this.input(c, r, msg.i);
      case 'hash':
        return this.hash(r, msg.k, msg.h);
    }
  }

  private hello(c: Client, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (msg.v !== PROTOCOL_VERSION) return c.conn.send({ t: 'err', msg: 'Your game version is different from the server. Reload the page.' });
    const name = String(msg.name ?? '').trim().slice(0, MAX_NAME) || `Trainer ${c.member.id}`;
    // Rejoin: same token, same room.
    if (msg.code && msg.token) {
      const r = this.rooms.get(msg.code.toUpperCase());
      const old = r?.clients.find((o) => o.token === msg.token);
      if (r && old) {
        this.clients.delete(c);
        old.conn = c.conn;
        old.member.away = false;
        old.member.name = name;
        Object.assign(c, old);
        c.conn.send({ t: 'welcome', you: old.member.id, token: old.token });
        if (r.match && old.member.seat !== null && r.match.owners[old.member.seat] === old.member.id) this.resume(old, r);
        r.sendState();
        return;
      }
    }
    c.member.name = name;
    let r: Room | undefined;
    if (msg.create) {
      r = new Room(this.newCode());
      r.host = c.member.id;
      this.rooms.set(r.code, r);
    } else {
      r = this.rooms.get(String(msg.code ?? '').toUpperCase());
      if (!r) return c.conn.send({ t: 'err', msg: `No room "${String(msg.code ?? '').toUpperCase()}".` });
      if (r.clients.length >= 12) return c.conn.send({ t: 'err', msg: 'That room is full.' });
    }
    c.room = r;
    r.clients.push(c);
    // First free seat, Blue first (spectate if full or a match is running).
    if (!r.match) {
      for (let s = 0; s < SEATS && c.member.seat === null; s++) if (!r.clients.some((o) => o.member.seat === s)) c.member.seat = s;
    }
    c.conn.send({ t: 'welcome', you: c.member.id, token: c.token });
    r.sendState();
  }

  private start(c: Client, r: Room, lineup: MatchStart['lineup']): void {
    if (r.host !== c.member.id || r.match) return;
    if (!Array.isArray(lineup) || lineup.length !== SEATS) return c.conn.send({ t: 'err', msg: 'A match needs 6 Pokémon.' });
    const owners = Array.from({ length: SEATS }, (_, s) => r.clients.find((o) => o.member.seat === s && !o.member.away)?.member.id ?? null);
    const start: MatchStart = {
      lineup: lineup.map((s, i) => ({
        pokemonId: String(s.pokemonId),
        team: (i < 3 ? 0 : 1) as 0 | 1,
        ...(s.item ? { item: String(s.item) } : {}),
        ...(s.role ? { role: s.role } : {}),
        ...(s.slot !== undefined ? { slot: s.slot } : {}),
      })),
      seed: Math.floor(this.rand() * 2 ** 31),
      settings: { ...r.settings },
      humans: owners.map((o) => o !== null),
    };
    // Ticks before INPUT_DELAY are neutral on every machine: the first real input is for tick INPUT_DELAY.
    r.match = { start, inputs: Array.from({ length: SEATS }, () => Array<WireInput | null>(INPUT_DELAY).fill(null)), control: [], owners, hashes: new Map(), desynced: false };
    for (const o of r.clients) o.conn.send({ t: 'start', match: start, you: o.member.seat !== null && owners[o.member.seat] === o.member.id ? o.member.seat : null });
    r.sendState();
  }

  private input(c: Client, r: Room, w: WireInput): void {
    const m = r.match;
    const s = c.member.seat;
    if (!m || s === null || m.owners[s] !== c.member.id || !r.humanNow(s)) return;
    if (!Array.isArray(w) || w.length !== 8 || !w.every((n) => Number.isInteger(n))) return;
    const list = m.inputs[s]!;
    if (w[0] !== list.length) return; // out of order or for a tick the bot already played
    list.push(w);
    r.broadcast({ t: 'in', s, i: w }, c);
  }

  private hash(r: Room, k: number, h: string): void {
    const m = r.match;
    if (!m || m.desynced || !Number.isInteger(k)) return;
    const prev = m.hashes.get(k);
    if (prev === undefined) {
      m.hashes.set(k, String(h));
      if (m.hashes.size > HASH_WINDOW) m.hashes.delete(m.hashes.keys().next().value!);
    } else if (prev !== h) {
      m.desynced = true;
      r.broadcast({ t: 'desync', k });
    }
  }

  /** A connection closed. */
  disconnect(c: Client): void {
    this.clients.delete(c);
    const r = c.room;
    if (!r) return;
    const m = r.match;
    const s = c.member.seat;
    if (m && s !== null && m.owners[s] === c.member.id) {
      // Keep the seat for a rejoin; a bot plays it from the next tick the server has no input for.
      c.member.away = true;
      if (r.humanNow(s)) {
        const ctl: SeatControl = { seat: s, tick: m.inputs[s]!.length, bot: true };
        m.control.push(ctl);
        r.broadcast({ t: 'ctl', c: ctl });
      }
      if (r.host === c.member.id) this.passHost(r);
      if (r.clients.every((o) => o.member.away)) this.rooms.delete(r.code);
      else r.sendState();
      return;
    }
    this.removeFromRoom(c, r);
  }

  private removeFromRoom(c: Client, r: Room): void {
    r.clients.splice(r.clients.indexOf(c), 1);
    c.room = null;
    if (r.clients.length === 0 || r.clients.every((o) => o.member.away)) {
      this.rooms.delete(r.code);
      return;
    }
    if (r.host === c.member.id) this.passHost(r);
    r.sendState();
  }

  private passHost(r: Room): void {
    const next = r.clients.find((o) => !o.member.away);
    if (next) r.host = next.member.id;
  }

  /** Send a rejoining player everything so far, then give them their seat back a little ahead. */
  private resume(c: Client, r: Room): void {
    const m = r.match!;
    const s = c.member.seat!;
    const latest = Math.max(...m.inputs.map((l) => l.length));
    const ctl: SeatControl = { seat: s, tick: latest + REJOIN_LEAD, bot: false };
    m.control.push(ctl);
    const inputs = m.inputs.map((l) => l.filter((w): w is WireInput => w !== null));
    c.conn.send({ t: 'resume', match: m.start, you: s, inputs, control: [...m.control] });
    r.broadcast({ t: 'ctl', c: ctl }, c);
    // The log for this seat continues at the hand-back tick.
    const list = m.inputs[s]!;
    while (list.length < ctl.tick) list.push(null);
  }
}
