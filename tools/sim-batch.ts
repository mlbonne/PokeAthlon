/**
 * Headless bot-vs-bot batch runner: many seeded matches, no browser, spread over worker threads.
 *
 *   npm run sim -- --lineup pikachu/lucario [--games 100] [--seed 1] [--swap] [--until match|set|goal]
 *                  [--brains v2,v2] [--threads N] [--max-minutes 30] [--out reports]
 *   npm run ladder [-- --games 60 --brains v2,v1]
 *
 * --lineup  "a/b" for 1v1, "a,b,c/d,e,f" for 3v3 (last of each team is the goalie).
 * --swap    every other game the two lineups swap sides, so map side doesn't bias the result.
 * --brains  bot brain for lineup A and lineup B (default v2,v2). See BRAINS: v1, v2, v2-easy … v2-balance.
 * --ladder  quality gate for bot brains (A6): mirror matches for every kit plus a 3v3 mirror,
 *           brain A vs brain B (default v2 vs v1), sides swapped; passes at >= 80 % for A overall.
 *
 * Prints win rates (95 % Wilson intervals) and per-Pokémon averages, and writes the full report
 * (every game's seed, winner, length and hash, plus averaged telemetry) to reports/.
 * Seed `s` always gives the same game: the first game is replayed on the main thread to verify it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { parseLineup, runHeadless, type HeadlessOptions, type PlayerSpawn, type PlayerTelemetry } from '@pokeathlon/sim';

interface Job {
  lineupA: string;
  lineupB: string;
  seeds: number[];
  swap: boolean;
  opts: HeadlessOptions;
  /** Brain for lineup A and lineup B (they follow their lineup when sides swap). */
  brains: [string, string];
}

/** One game, reported from lineup A's point of view. */
interface GameResult {
  seed: number;
  /** Did lineup A play on team 1 (right side)? */
  swapped: boolean;
  /** 'A', 'B' or 'draw' (time limit). */
  winner: 'A' | 'B' | 'draw';
  minutes: number;
  hash: string;
  /** Players in lineup order: A's slots, then B's slots. */
  players: Omit<PlayerTelemetry, 'id' | 'team'>[];
}

function playGame(job: Job, seed: number): GameResult {
  const swapped = job.swap && seed % 2 === 1;
  const spec = swapped ? `${job.lineupB}/${job.lineupA}` : `${job.lineupA}/${job.lineupB}`;
  const lineup: PlayerSpawn[] = parseLineup(spec);
  const brains: [string, string] = swapped ? [job.brains[1], job.brains[0]] : job.brains;
  const r = runHeadless(lineup, { ...job.opts, seed, brains });
  const teamA = swapped ? 1 : 0;
  const order = [...r.telemetry.players.filter((p) => p.team === teamA), ...r.telemetry.players.filter((p) => p.team !== teamA)];
  return {
    seed,
    swapped,
    winner: r.winner === -1 ? 'draw' : r.winner === teamA ? 'A' : 'B',
    minutes: +r.minutes.toFixed(3),
    hash: r.hash,
    players: order.map((p) => {
      const { id, team, ...rest } = p;
      void id;
      void team;
      return rest;
    }),
  };
}

if (!isMainThread) {
  const job = workerData as Job;
  for (const seed of job.seeds) parentPort!.postMessage(playGame(job, seed));
} else {
  await main();
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function defaultThreads(): number {
  return Math.max(1, availableParallelism() - 1);
}

/** Run `seeds` games of `job` across worker threads. */
async function runBatch(job: Omit<Job, 'seeds'>, seeds: number[], threads: number, progress = true): Promise<GameResult[]> {
  const t0 = Date.now();
  const results: GameResult[] = [];
  const n = Math.max(1, Math.min(threads, seeds.length));
  await Promise.all(
    Array.from({ length: n }, (_, t) => {
      const mine = seeds.filter((_, i) => i % n === t);
      return new Promise<void>((done, fail) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { ...job, seeds: mine } satisfies Job });
        w.on('message', (g: GameResult) => {
          results.push(g);
          if (progress && results.length % Math.max(1, Math.round(seeds.length / 10)) === 0) {
            console.log(`  ${results.length}/${seeds.length} games · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
          }
        });
        w.on('error', fail);
        w.on('exit', (code) => (code === 0 ? done() : fail(new Error(`worker exited with ${code}`))));
      });
    }),
  );
  return results.sort((a, b) => a.seed - b.seed);
}

/** A6 bot ladder: brain A vs brain B in mirror matches for every kit and a 3v3 mirror. */
async function ladder(): Promise<void> {
  const [a, b] = arg('brains', 'v2,v1').split(',') as [string, string];
  const games = Number(arg('games', '60'));
  const threads = Number(arg('threads', String(defaultThreads())));
  const { analyzeRoster } = await import('@pokeathlon/data/analyze');
  const kits = analyzeRoster().map((k) => k.id);
  const trio = kits.slice(0, 3).join(',');
  const lineups: [string, string][] = [...kits.map((k) => [k, k] as [string, string]), [trio, trio]];
  console.log(`Bot ladder: ${a} vs ${b}, ${games} games per lineup, sides swapped every other game\n`);
  let wins = 0;
  let total = 0;
  const t0 = Date.now();
  for (const [la, lb] of lineups) {
    const seeds = Array.from({ length: games }, (_, i) => i + 1);
    const res = await runBatch({ lineupA: la, lineupB: lb, swap: true, opts: { maxMinutes: 20 }, brains: [a, b] }, seeds, threads, false);
    const w = res.filter((g) => g.winner === 'A').length;
    const d = res.filter((g) => g.winner === 'draw').length;
    wins += w;
    total += res.length;
    console.log(`  ${`${la} mirror`.padEnd(34)} ${a} ${pct(w, res.length)}  ${wilson(w, res.length)}${d ? `  draws ${d}` : ''}`);
  }
  const [lo] = wilsonRange(wins, total);
  const pass = wins / total >= 0.8;
  console.log(`\n  Overall ${a} ${pct(wins, total)}  ${wilson(wins, total)} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`  Gate (>= 80 % for ${a}): ${pass ? 'PASS' : 'FAIL'}${pass && lo < 0.8 ? ' (point estimate; CI still overlaps 80 %)' : ''}`);
  if (!pass) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (flag('ladder')) return ladder();
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  const lineupSpec = arg('lineup', 'pikachu/lucario');
  const [lineupA, lineupB] = lineupSpec.split(/[/:]/) as [string, string];
  parseLineup(lineupSpec); // validate early
  const games = Number(arg('games', '100'));
  const seed0 = Number(arg('seed', '1'));
  const threads = Math.max(1, Math.min(Number(arg('threads', String(defaultThreads()))), games));
  const until = arg('until', 'match') as HeadlessOptions['until'];
  const opts: HeadlessOptions = { maxMinutes: Number(arg('max-minutes', '30')), ...(until ? { until } : {}) };
  const brains = arg('brains', 'v2,v2').split(',') as [string, string];
  const job: Omit<Job, 'seeds'> = { lineupA, lineupB, swap: flag('swap'), opts, brains };

  console.log(`Simulating ${games} × ${lineupA} (${brains[0]}) vs ${lineupB} (${brains[1]}) (until ${until}${job.swap ? ', sides swapped every other game' : ''}) on ${threads} threads…`);
  const t0 = Date.now();
  const seeds = Array.from({ length: games }, (_, i) => seed0 + i);
  const results = await runBatch(job, seeds, threads);
  const secs = (Date.now() - t0) / 1000;

  // Determinism: replay the first game here and compare.
  const replay = playGame({ ...job, seeds: [] }, results[0]!.seed);
  const deterministic = replay.hash === results[0]!.hash;

  const winsA = results.filter((g) => g.winner === 'A').length;
  const winsB = results.filter((g) => g.winner === 'B').length;
  const draws = games - winsA - winsB;
  const totalMinutes = results.reduce((s, g) => s + g.minutes, 0);
  const distinct = new Set(results.map((g) => g.hash)).size;

  const slots = results[0]!.players.map((p, i) => ({ side: i < results[0]!.players.length / 2 ? 'A' : 'B', pokemon: p.pokemon, avg: average(results.map((g) => g.players[i]!)) }));

  console.log(`\nDone in ${secs.toFixed(1)} s: ${totalMinutes.toFixed(0)} game-minutes (${((totalMinutes * 60) / secs).toFixed(0)}× real time)`);
  console.log(`Deterministic replay of seed ${results[0]!.seed}: ${deterministic ? 'OK' : 'MISMATCH'} · ${distinct}/${games} distinct games`);
  console.log(`Average length ${(totalMinutes / games).toFixed(2)} min\n`);
  console.log(`  A  ${lineupA.padEnd(28)} ${pct(winsA, games)}  ${wilson(winsA, games)}`);
  console.log(`  B  ${lineupB.padEnd(28)} ${pct(winsB, games)}  ${wilson(winsB, games)}`);
  if (draws) console.log(`     time-limit draws            ${pct(draws, games)}`);

  console.log('\nPer match averages:');
  const cols: [string, (a: Avg) => string][] = [
    ['goals', (a) => a.goals.toFixed(2)],
    ['kos', (a) => a.kos.toFixed(2)],
    ['deaths', (a) => a.deaths.toFixed(2)],
    ['dmg out', (a) => a.damageDealt.toFixed(0)],
    ['dmg in', (a) => a.damageTaken.toFixed(0)],
    ['touches', (a) => a.ballTouches.toFixed(1)],
    ['progress', (a) => a.ballProgress.toFixed(0)],
    ['barriers', (a) => a.barriers.toFixed(2)],
  ];
  console.log(`  ${'side'.padEnd(5)}${'pokemon'.padEnd(11)}${cols.map(([n]) => n.padStart(10)).join('')}`);
  for (const s of slots) console.log(`  ${s.side.padEnd(5)}${s.pokemon.padEnd(11)}${cols.map(([, f]) => f(s.avg).padStart(10)).join('')}`);

  const outDir = resolve(ROOT, arg('out', 'reports'));
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `sim-${new Date().toISOString().slice(0, 10)}_${lineupSpec.replace(/[/:]/g, '-vs-').replace(/,/g, '+')}_${games}g.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        lineupA,
        lineupB,
        games,
        seeds: [seed0, seed0 + games - 1],
        swap: job.swap,
        brains,
        options: opts,
        seconds: +secs.toFixed(1),
        deterministic,
        distinctGames: distinct,
        wins: { A: winsA, B: winsB, draw: draws },
        winRateA: { value: winsA / games, ci95: wilsonRange(winsA, games) },
        averageMinutes: totalMinutes / games,
        slots,
        results: results.map((g) => ({ seed: g.seed, swapped: g.swapped, winner: g.winner, minutes: g.minutes, hash: g.hash })),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nReport: ${file}`);
  if (!deterministic) process.exitCode = 1;
}

type Avg = Omit<PlayerTelemetry, 'id' | 'team' | 'pokemon' | 'moves'> & { pokemon: string; moves: Record<string, Record<string, number>> };

/** Mean of every numeric field (and of every per-move field) over games. */
function average(ps: GameResult['players']): Avg {
  const out: Record<string, unknown> = { pokemon: ps[0]!.pokemon };
  const moves: Record<string, Record<string, number>> = {};
  for (const p of ps) {
    for (const [k, v] of Object.entries(p)) if (typeof v === 'number') out[k] = ((out[k] as number) ?? 0) + v / ps.length;
    for (const [id, m] of Object.entries(p.moves)) {
      const acc = (moves[id] ??= {});
      for (const [k, v] of Object.entries(m)) acc[k] = (acc[k] ?? 0) + v / ps.length;
    }
  }
  out.moves = moves;
  return out as Avg;
}

function pct(k: number, n: number): string {
  return `${((100 * k) / n).toFixed(1).padStart(5)} %`;
}

/** 95 % Wilson score interval for k successes in n trials. */
function wilsonRange(k: number, n: number): [number, number] {
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [+(c - h).toFixed(4), +(c + h).toFixed(4)];
}
function wilson(k: number, n: number): string {
  const [lo, hi] = wilsonRange(k, n);
  return `(95 % CI ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)} %)`;
}
