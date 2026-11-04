/**
 * Playstyle metrics (brawling study): how fights, KOs, spacing and passing actually look in bot
 * 3v3s, and how rule changes move them. Random seeded comps, v2 bots at balance difficulty.
 *
 *   npm run playstyle [-- --games 40] [--threads N]
 *        [--variant "name:set;set" ...]      e.g. --variant "fast KOs:all.stagger*=0.7;rules.respawn.time=8"
 *
 * Every variant runs the same seeds and comps, so differences come from the rules, not the dice.
 * Sets use the what-if syntax of packages/data/src/tuning.ts (rules.*, all.*, <pokemon>.*).
 */
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { applyTuning } from '@pokeathlon/data/tuning';
import { analyzeRoster } from '@pokeathlon/data/analyze';
import { BRAINS, createWorld, mixSeed, parseLineup, randInt, step, TICK_RATE } from '@pokeathlon/sim';

const NEAR = 400; // "near the ball" radius
const PASS_WINDOW = 3 * TICK_RATE;
const CONTEST_WINDOW = TICK_RATE / 2;

interface Metrics {
  liveTicks: number;
  goals: number;
  kos: number;
  staggers: number;
  convertedStaggers: number;
  hits: number;
  damage: number;
  lifeSum: number;
  lives: number;
  koPlayerTicks: number;
  staggeredPlayerTicks: number;
  playerTicks: number;
  nearBallSum: number;
  crowdTicks: number;
  fwdBallDistSum: number;
  fwdSamples: number;
  mateSpreadSum: number;
  mateSamples: number;
  touches: number;
  passes: number;
  contested: number;
  minutes: number;
}
const zero = (): Metrics => ({
  liveTicks: 0, goals: 0, kos: 0, staggers: 0, convertedStaggers: 0, hits: 0, damage: 0, lifeSum: 0, lives: 0,
  koPlayerTicks: 0, staggeredPlayerTicks: 0, playerTicks: 0, nearBallSum: 0, crowdTicks: 0, fwdBallDistSum: 0,
  fwdSamples: 0, mateSpreadSum: 0, mateSamples: 0, touches: 0, passes: 0, contested: 0, minutes: 0,
});

function playOne(seed: number, kits: string[]): Metrics {
  const slot = { rng: [mixSeed(seed * 7919 + 13)] };
  const pick = () => kits[randInt(slot, 0, 0, kits.length - 1)]!;
  const w = createWorld(parseLineup(`${pick()},${pick()},${pick()}/${pick()},${pick()},${pick()}`), { mode: 'match', seed });
  const brain = BRAINS.v2!;
  const m = zero();
  const spawnTick = w.players.map(() => 0);
  const staggeredAt = w.players.map(() => -1e9);
  let lastTouch = { id: -1, tick: -1e9 };
  const limit = TICK_RATE * 60 * 20;
  while (w.match.phase !== 'matchOver' && w.tick < limit) {
    step(w, w.players.map((p) => brain(w, p.id)));
    for (const e of w.events) {
      if (e.type === 'kickoff') {
        w.players.forEach((_, i) => (spawnTick[i] = w.tick));
        lastTouch = { id: -1, tick: -1e9 };
      }
      if (e.type === 'respawn') spawnTick[e.playerId] = w.tick;
      if (e.type === 'goal') m.goals++;
      if (e.type === 'hit') {
        m.hits++;
        m.damage += e.damage;
      }
      if (e.type === 'staggered') {
        m.staggers++;
        staggeredAt[e.playerId] = w.tick;
      }
      if (e.type === 'ko') {
        m.kos++;
        m.lifeSum += (w.tick - spawnTick[e.playerId]!) / TICK_RATE;
        m.lives++;
        if (w.tick - staggeredAt[e.playerId]! <= 4 * TICK_RATE) m.convertedStaggers++;
      }
      if (e.type === 'ballHit') {
        m.touches++;
        const by = w.players[e.playerId]!;
        const prev = w.players[lastTouch.id];
        if (prev && prev.id !== by.id && w.tick - lastTouch.tick <= PASS_WINDOW && prev.team === by.team) m.passes++;
        if (prev && prev.team !== by.team && w.tick - lastTouch.tick <= CONTEST_WINDOW) m.contested++;
        lastTouch = { id: by.id, tick: w.tick };
      }
    }
    if (w.match.phase !== 'play' || w.ball.scored) continue;
    m.liveTicks++;
    const b = w.ball.pos;
    let near = 0;
    let fwdNear = 0;
    for (const p of w.players) {
      m.playerTicks++;
      if (p.koTicks > 0) {
        m.koPlayerTicks++;
        continue;
      }
      if (p.staggered) m.staggeredPlayerTicks++;
      const d = Math.hypot(p.pos.x - b.x, p.pos.y - b.y);
      if (d < NEAR) near++;
      if (p.role === 'forward') {
        m.fwdBallDistSum += d;
        m.fwdSamples++;
        if (d < NEAR) fwdNear++;
      }
    }
    m.nearBallSum += near;
    if (fwdNear >= 3) m.crowdTicks++;
    for (const team of [0, 1]) {
      const f = w.players.filter((p) => p.team === team && p.role === 'forward' && p.koTicks === 0);
      if (f.length === 2) {
        m.mateSpreadSum += Math.hypot(f[0]!.pos.x - f[1]!.pos.x, f[0]!.pos.y - f[1]!.pos.y);
        m.mateSamples++;
      }
    }
  }
  m.minutes = w.tick / TICK_RATE / 60;
  return m;
}

function add(a: Metrics, b: Metrics): Metrics {
  const out = zero();
  for (const k of Object.keys(out) as (keyof Metrics)[]) out[k] = a[k] + b[k];
  return out;
}

async function runVariant(sets: string[], seeds: number[], threads: number): Promise<Metrics> {
  const n = Math.max(1, Math.min(threads, seeds.length));
  let total = zero();
  await Promise.all(
    Array.from({ length: n }, (_, t) => {
      const mine = seeds.filter((_, i) => i % n === t);
      return new Promise<void>((done, fail) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { sets, seeds: mine } });
        w.on('message', (m: Metrics) => (total = add(total, m)));
        w.on('error', fail);
        w.on('exit', (c) => (c === 0 ? done() : fail(new Error(`worker exited with ${c}`))));
      });
    }),
  );
  return total;
}

function report(name: string, m: Metrics, games: number): Record<string, string> {
  const liveMin = m.liveTicks / TICK_RATE / 60;
  const f1 = (x: number) => x.toFixed(1);
  const pc = (x: number) => `${(x * 100).toFixed(0)}%`;
  return {
    variant: name,
    'match min': f1(m.minutes / games),
    'goals/live min': f1(m.goals / liveMin),
    'KOs/live min': f1(m.kos / liveMin),
    'avg life (s)': f1(m.lifeSum / Math.max(1, m.lives)),
    'time KO\'d': pc(m.koPlayerTicks / Math.max(1, m.playerTicks)),
    'staggers/min': f1(m.staggers / liveMin),
    'stagger→KO': pc(m.convertedStaggers / Math.max(1, m.staggers)),
    'time staggered': pc(m.staggeredPlayerTicks / Math.max(1, m.playerTicks)),
    'dmg/player/min': (m.damage / (liveMin * 6)).toFixed(0),
    'near ball (of 6)': (m.nearBallSum / Math.max(1, m.liveTicks)).toFixed(2),
    'crowd (3+ of 4 fwds)': pc(m.crowdTicks / Math.max(1, m.liveTicks)),
    'fwd↔ball dist': (m.fwdBallDistSum / Math.max(1, m.fwdSamples)).toFixed(0),
    'fwd spread': (m.mateSpreadSum / Math.max(1, m.mateSamples)).toFixed(0),
    'passes/live min': f1(m.passes / liveMin),
    'pass share': pc(m.passes / Math.max(1, m.touches)),
    'contested touches': pc(m.contested / Math.max(1, m.touches)),
  };
}

async function main(): Promise<void> {
  const arg = (n: string, d: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : d;
  };
  const games = Number(arg('games', '40'));
  const threads = Number(arg('threads', String(Math.max(1, availableParallelism() - 1))));
  const variants: [string, string[]][] = [['baseline', []]];
  process.argv.forEach((a, i) => {
    if (a !== '--variant' || !process.argv[i + 1]) return;
    const [name, sets] = process.argv[i + 1]!.split(':') as [string, string | undefined];
    variants.push([name, (sets ?? '').split(';').map((s) => s.trim()).filter(Boolean)]);
  });
  const seeds = Array.from({ length: games }, (_, i) => i + 1);
  const rows: Record<string, string>[] = [];
  for (const [name, sets] of variants) {
    const t0 = Date.now();
    const m = await runVariant(sets, seeds, threads);
    rows.push(report(name, m, games));
    console.log(`  ${name}: ${games} games in ${((Date.now() - t0) / 1000).toFixed(0)} s${sets.length ? ` (${sets.join('; ')})` : ''}`);
  }
  const keys = Object.keys(rows[0]!);
  console.log('');
  const width = Math.max(...keys.map((k) => k.length));
  for (const k of keys) console.log(`${k.padEnd(width)}  ${rows.map((r) => r[k]!.padStart(14)).join('')}`);
}

if (!isMainThread) {
  const { sets, seeds } = workerData as { sets: string[]; seeds: number[] };
  applyTuning(sets);
  const kits = analyzeRoster().map((k) => k.id);
  for (const s of seeds) parentPort!.postMessage(playOne(s, kits));
} else {
  await main();
}
