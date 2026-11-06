import { afterEach, describe, expect, it } from 'vitest';
import { hashWorldDeep, quantizeInput, Button, type PlayerSpawn } from '@pokeathlon/sim';
import { NetClient, type Socket } from '@pokeathlon/net';
import { startServer, type Started } from '../src/index';

const LINEUP: PlayerSpawn[] = ['pikachu', 'lucario', 'snorlax', 'greninja', 'blastoise', 'machamp'].map((id, i) => ({ pokemonId: id, team: (i < 3 ? 0 : 1) as 0 | 1 }));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(5);
  }
}

let server: Started | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

function join(port: number, hello: ConstructorParameters<typeof NetClient>[2]) {
  const errors: string[] = [];
  const ws = new WebSocket(`ws://localhost:${port}`) as unknown as Socket;
  const c = new NetClient(ws, { error: (m) => errors.push(m) }, hello);
  return { c, errors };
}

const mash = (seat: number, t: number) => quantizeInput(Math.sin(t / 30 + seat), Math.cos(t / 40), 1, 0, t % 45 === seat ? Button.Strike : 0);

/** Run every client (as fast as the network allows) until each has simulated `ticks` more ticks. */
async function play(clients: NetClient[], ticks: number): Promise<void> {
  const goal = clients.map((c) => c.session!.world.tick + ticks);
  const end = Date.now() + 20_000;
  while (clients.some((c, i) => c.session!.world.tick < goal[i]!)) {
    if (Date.now() > end) throw new Error(`play timed out at ${clients.map((c) => c.session!.world.tick).join('/')}`);
    for (const c of clients) if (c.session!.world.tick < goal[clients.indexOf(c)]!) c.advance(mash(c.seat ?? 0, c.session!.world.tick));
    await wait(0);
  }
}

describe('room server (M7.2)', () => {
  it('creates a room, seats players, starts a match and keeps everyone in sync', async () => {
    server = await startServer();
    const a = join(server.port, { name: 'Ash', create: true });
    await until(() => a.c.room !== null);
    const code = a.c.room!.code;
    expect(code).toMatch(/^[A-Z]{4}$/);
    const b = join(server.port, { name: 'Misty', code });
    await until(() => a.c.room!.members.length === 2 && b.c.room !== null);
    // Seats: first free, Blue first.
    expect(a.c.room!.members.map((m) => m.seat)).toEqual([0, 1]);
    b.c.send({ t: 'seat', seat: 4 });
    await until(() => a.c.room!.members[1]!.seat === 4);
    a.c.send({ t: 'start', lineup: LINEUP });
    await until(() => !!a.c.session && !!b.c.session);
    expect(a.c.seat).toBe(0);
    expect(b.c.seat).toBe(4);
    expect(a.c.session!.seats).toEqual(['local', 'bot', 'bot', 'bot', 'remote', 'bot']);
    await play([a.c, b.c], 900);
    await wait(100);
    // Both reported state hashes for the same ticks, and they matched.
    expect(server.rooms.room(code)!.match!.hashes.size).toBeGreaterThanOrEqual(6);
    expect(a.c.desyncAt).toBe(-1);
    expect(b.c.desyncAt).toBe(-1);
    expect(a.errors.concat(b.errors)).toEqual([]);
    a.c.close();
    b.c.close();
  });

  it('a dropped player is replaced by a bot and can rejoin their seat', async () => {
    server = await startServer();
    const a = join(server.port, { name: 'Ash', create: true });
    await until(() => a.c.room !== null);
    const code = a.c.room!.code;
    const b = join(server.port, { name: 'Brock', code });
    await until(() => a.c.room!.members.length === 2);
    a.c.send({ t: 'start', lineup: LINEUP });
    await until(() => !!a.c.session && !!b.c.session);
    await play([a.c, b.c], 300);
    const ticket = b.c.ticket!;
    b.c.close();
    await until(() => a.c.room!.members.find((m) => m.name === 'Brock')?.away === true);
    expect(a.c.session!.seats[1]).toBe('bot');
    await play([a.c], 300);
    // Rejoin with the ticket: same seat, the match so far replayed, the seat handed back.
    const b2 = join(server.port, { name: 'Brock', code: ticket.code, token: ticket.token });
    await until(() => !!b2.c.session);
    expect(b2.c.seat).toBe(1);
    await until(() => a.c.session!.seats[1] === 'remote');
    await play([a.c, b2.c], 900);
    // Both computed hashes for the same ticks after the hand-back, and the server saw no mismatch.
    await wait(50);
    expect(a.c.desyncAt).toBe(-1);
    expect(b2.c.desyncAt).toBe(-1);
    expect(hashWorldDeep(a.c.session!.world)).toBeTypeOf('string');
    a.c.close();
    b2.c.close();
  });

  it('reports a desync when two players disagree', async () => {
    server = await startServer();
    const a = join(server.port, { name: 'A', create: true });
    await until(() => a.c.room !== null);
    const b = join(server.port, { name: 'B', code: a.c.room!.code });
    await until(() => a.c.room!.members.length === 2);
    a.c.send({ t: 'start', lineup: LINEUP });
    await until(() => !!a.c.session && !!b.c.session);
    // Corrupt one machine's state.
    b.c.session!.world.players[2]!.energy += 1;
    await play([a.c, b.c], 400);
    await until(() => a.c.desyncAt >= 0 && b.c.desyncAt >= 0);
    a.c.close();
    b.c.close();
  });
});
