import { afterEach, describe, expect, it } from 'vitest';
import { hashWorldDeep, quantizeInput, Button, type PlayerSpawn } from '@pokeathlon/sim';
import { NetClient, type Socket } from '@pokeathlon/net';
import { startServer, type Started } from '../src/index';

const LINEUP: PlayerSpawn[] = ['pikachu', 'lucario', 'bronzong', 'greninja', 'blastoise', 'machamp'].map((id, i) => ({ pokemonId: id, team: (i < 3 ? 0 : 1) as 0 | 1 }));
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
    // Only the host can end the match; everyone is back in the room afterwards.
    b.c.send({ t: 'lobby' });
    await wait(50);
    expect(a.c.room!.phase).toBe('match');
    a.c.send({ t: 'lobby' });
    await until(() => a.c.room!.phase === 'lobby' && b.c.room!.phase === 'lobby');
    expect(a.c.session).toBeNull();
    expect(b.c.session).toBeNull();
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

describe('background tabs (M7.4)', () => {
  it("a player who stops sending gets a bot, and takes the seat back when they return", async () => {
    server = await startServer();
    const a = join(server.port, { name: 'A', create: true });
    await until(() => a.c.room !== null);
    const b = join(server.port, { name: 'B', code: a.c.room!.code });
    await until(() => a.c.room!.members.length === 2);
    a.c.send({ t: 'start', lineup: LINEUP });
    await until(() => !!a.c.session && !!b.c.session);
    await play([a.c, b.c], 120);
    // B's tab goes to the background: only A plays. A stalls until the server benches B.
    const end = Date.now() + 8000;
    while (a.c.session!.seats[1] !== 'bot') {
      if (Date.now() > end) throw new Error('B was never benched');
      a.c.advance(mash(0, a.c.session!.world.tick));
      server.rooms.tickSync();
      await wait(2);
    }
    await play([a.c], 300);
    // B comes back: asks for the seat, gets the match replayed, and plays on in sync.
    expect(b.c.benched).toBe(true);
    b.c.ticksThisFrame();
    await until(() => a.c.session!.seats[1] === 'remote' && !b.c.benched);
    await play([a.c, b.c], 600);
    await wait(50);
    expect(a.c.desyncAt).toBe(-1);
    expect(b.c.desyncAt).toBe(-1);
    a.c.close();
    b.c.close();
  });
});

describe('one-port hosting (M7.5)', () => {
  it('serves the built game and the rooms on the same port, and never leaves the game folder', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { gameServer } = await import('../src/static');
    const dir = mkdtempSync(join(tmpdir(), 'pa-dist-'));
    writeFileSync(join(dir, 'index.html'), '<title>PokéAthlon</title>');
    writeFileSync(join(dir, 'app.js'), 'console.log(1)');
    const http = gameServer(dir);
    server = await startServer({ server: http });
    await new Promise<void>((r) => http.listen(0, r));
    const port = (http.address() as { port: number }).port;
    const page = await fetch(`http://localhost:${port}/?online=1`);
    expect(await page.text()).toContain('PokéAthlon');
    const js = await fetch(`http://localhost:${port}/app.js`);
    expect(js.headers.get('content-type')).toContain('javascript');
    const sneaky = await fetch(`http://localhost:${port}/..%2F..%2Fpackage.json`);
    expect(await sneaky.text()).not.toContain('"name"');
    // The rooms answer on the same port.
    const a = join_(port);
    await until(() => a.c.room !== null);
    a.c.close();
    await new Promise<void>((r) => http.close(() => r()));
  });
});
const join_ = (port: number) => join(port, { name: 'Host', create: true });
