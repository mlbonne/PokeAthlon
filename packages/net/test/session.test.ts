import { describe, expect, it } from 'vitest';
import { hashWorldDeep, step } from '@pokeathlon/sim';
import { BOT, humanInput, makeNet, newMatch } from './fakeNet';

/** All clients agree on every confirmed hash they both computed. Returns how many were compared. */
function agree(clients: { hashes: Map<number, string> }[]): number {
  let n = 0;
  const [a, ...rest] = clients;
  for (const [t, h] of a!.hashes) {
    for (const b of rest) {
      const hb = b.hashes.get(t);
      if (hb === undefined) continue;
      expect(hb, `tick ${t}`).toBe(h);
      n++;
    }
  }
  return n;
}

describe('rollback session (M7.1)', () => {
  it('two humans + four bots at 150 ms ping stay in sync', () => {
    const net = makeNet([0, 4], { latency: 5, jitter: 4 });
    for (let f = 0; f < 3600; f++) net.tick();
    const compared = agree(net.clients);
    expect(compared).toBeGreaterThan(20);
    const s = net.clients[0]!.session.stats;
    expect(s.rollbacks).toBeGreaterThan(10); // guesses were wrong and fixed
    expect(s.maxDepth).toBeLessThanOrEqual(8);
  });

  it('six humans with jitter stay in sync', () => {
    const net = makeNet([0, 1, 2, 3, 4, 5], { latency: 3, jitter: 6, seed: 9 });
    for (let f = 0; f < 2400; f++) net.tick();
    expect(agree(net.clients)).toBeGreaterThan(50);
  });

  it('the online result equals an offline replay of the same inputs', () => {
    const net = makeNet([1, 3], { latency: 4, jitter: 3, seed: 5 });
    for (let f = 0; f < 1800; f++) net.tick();
    // Let everything arrive: a few frames without new ticks would stall, so just compare a confirmed hash.
    const [tick, hash] = [...net.clients[0]!.hashes].at(-1)!;
    const w = newMatch();
    while (w.tick < tick) {
      const t = w.tick;
      step(w, w.players.map((p) => (p.id === 1 || p.id === 3 ? (t < 2 ? { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 } : humanInputAt(p.id, t)) : BOT(w, p.id))));
    }
    expect(hashWorldDeep(w)).toBe(hash);
  });

  it('waits for a player who falls behind instead of running away', () => {
    const net = makeNet([0, 5], { latency: 2, jitter: 0, maxRollback: 8 });
    for (let f = 0; f < 300; f++) net.tick(f % 2 === 0 ? new Set([5]) : new Set());
    const [a, b] = net.clients;
    expect(a!.session.world.tick - b!.session.world.tick).toBeLessThanOrEqual(8 + 2 + 2);
    expect(a!.session.stats.stalls).toBeGreaterThan(0);
  });

  it('a player who drops out is replaced by a bot, everywhere at the same tick', () => {
    const net = makeNet([0, 2, 4], { latency: 3, jitter: 2, seed: 3 });
    for (let f = 0; f < 600; f++) net.tick();
    const from = net.drop(2);
    for (let f = 0; f < 900; f++) net.tick();
    const rest = net.clients.filter((c) => !c.gone);
    const after = rest.map((c) => ({ hashes: new Map([...c.hashes].filter(([t]) => t > from)) }));
    expect(agree(after)).toBeGreaterThan(5);
  });

  it('a player can rejoin their seat and everyone stays in sync', () => {
    const net = makeNet([0, 3], { latency: 4, jitter: 2, seed: 8 });
    for (let f = 0; f < 500; f++) net.tick();
    const botFrom = net.drop(3);
    for (let f = 0; f < 400; f++) net.tick();
    const { client, from } = net.rejoin(3, botFrom);
    expect(client.session.world.tick).toBeGreaterThan(800);
    for (let f = 0; f < 900; f++) net.tick();
    const live = net.clients.filter((c) => !c.gone);
    expect(live).toHaveLength(2);
    const after = live.map((c) => ({ hashes: new Map([...c.hashes].filter(([t]) => t > from)) }));
    expect(agree(after)).toBeGreaterThan(5);
    // The rejoined player's inputs really drive the seat again.
    expect(client.session.seats[3]).toBe('local');
  });
});

/**
 * The input a human seat scheduled for tick t: the fake human uses its world tick at the time of
 * the frame, which is tick − inputDelay when it never stalled. The test above uses a network fast
 * enough that it never stalls, so this holds.
 */
function humanInputAt(seat: number, t: number) {
  return humanInput(seat, t - 2);
}
