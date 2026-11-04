/**
 * Balance report (M4.6): thousands of headless bot matches → win-rate matrix, per-role win rates,
 * impact scores, T0–F tiers and per-move numbers. Writes reports/balance-<date>.{json,html} and,
 * for an untouched baseline, the tier snapshot the F3 Tiers tab reads
 * (packages/data/balance/tiers.json).
 *
 *   npm run balance [-- --games 600] [--duel-games 60] [--seed 1] [--threads N]
 *                   [--only duel|3v3] [--set lucario.aura-sphere.cooldown=11 ...] [--no-snapshot]
 *
 * 3v3: every game draws a random comp (seeded) for both teams, so every Pokémon plays Forward and
 *      Goalie against every other. Games where a Pokémon is on both sides don't count for it.
 * duel: every 1v1 pairing, sides swapped every other game → matrix.
 * --set: what-if tuning (see packages/data/src/tuning.ts); the report shows the change against
 *      the last baseline run (reports/balance-baseline.json). No snapshot is written.
 * Bots play at `balance` difficulty (v2).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { applyTuning } from '@pokeathlon/data/tuning';
import { analyzeRoster, simTier, bestTier, TIERS, TIER_MEANING, type Tier } from '@pokeathlon/data/analyze';
import { fitImpact, impactOf, impactShares, IMPACT_FEATURES, mixSeed, parseLineup, randInt, runHeadless, type PlayerSpawn } from '@pokeathlon/sim';

// ---------------------------------------------------------------- worker side

interface Spec {
  kind: 'duel' | '3v3';
  seed: number;
  lineup: PlayerSpawn[];
}
interface PlayerOut {
  pokemon: string;
  team: 0 | 1;
  role: 'forward' | 'goalie';
  goals: number;
  assists: number;
  ballProgress: number;
  kos: number;
  deaths: number;
  barriers: number;
  saves: number;
  shots: number;
  damageDealt: number;
  ballTouches: number;
  moves: Record<string, { casts: number; playerHits: number; ballHits: number; damage: number; kos: number; goals: number }>;
}
interface GameOut {
  kind: Spec['kind'];
  seed: number;
  winner: 0 | 1 | -1;
  minutes: number;
  hash: string;
  players: PlayerOut[];
}

function play(spec: Spec): GameOut {
  const r = runHeadless(spec.lineup, { seed: spec.seed, brains: ['v2', 'v2'], maxMinutes: 20 });
  return {
    kind: spec.kind,
    seed: spec.seed,
    winner: r.winner,
    minutes: +r.minutes.toFixed(3),
    hash: r.hash,
    players: r.telemetry.players.map((t) => ({
      pokemon: t.pokemon,
      team: t.team,
      role: t.role,
      goals: t.goals,
      assists: t.assists,
      ballProgress: t.ballProgress,
      kos: t.kos,
      deaths: t.deaths,
      barriers: t.barriers,
      saves: t.saves,
      shots: t.shots,
      damageDealt: t.damageDealt,
      ballTouches: t.ballTouches,
      moves: Object.fromEntries(
        Object.entries(t.moves).map(([id, m]) => [id, { casts: m.casts, playerHits: m.playerHits, ballHits: m.ballHits, damage: m.damage, kos: m.kos, goals: m.goals }]),
      ),
    })),
  };
}


// ---------------------------------------------------------------- main

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  });
  return out;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function runAll(specs: Spec[], sets: string[], threads: number): Promise<GameOut[]> {
  const t0 = Date.now();
  const out: GameOut[] = [];
  const n = Math.max(1, Math.min(threads, specs.length));
  await Promise.all(
    Array.from({ length: n }, (_, t) => {
      const mine = specs.filter((_, i) => i % n === t);
      return new Promise<void>((done, fail) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { sets, specs: mine } });
        w.on('message', (g: GameOut) => {
          out.push(g);
          if (out.length % Math.max(1, Math.round(specs.length / 20)) === 0) {
            const el = (Date.now() - t0) / 1000;
            console.log(`  ${out.length}/${specs.length} games · ${el.toFixed(0)} s · ~${((el / out.length) * (specs.length - out.length)).toFixed(0)} s left`);
          }
        });
        w.on('error', fail);
        w.on('exit', (code) => (code === 0 ? done() : fail(new Error(`worker exited with ${code}`))));
      });
    }),
  );
  return out.sort((a, b) => (a.kind === b.kind ? a.seed - b.seed : a.kind < b.kind ? -1 : 1));
}

interface Rec {
  wins: number;
  games: number;
}
const rec = (): Rec => ({ wins: 0, games: 0 });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sets = args('set');
  const tuned = applyTuning(sets); // also in this thread, so the analyzer and replay see it
  const games3 = Number(arg('games', '600'));
  const duelGames = Number(arg('duel-games', '60'));
  const seed0 = Number(arg('seed', '1'));
  const threads = Number(arg('threads', String(Math.max(1, availableParallelism() - 1))));
  const only = arg('only', '');
  const kits = analyzeRoster().map((k) => k.id);

  // ---- Specs ----
  const specs: Spec[] = [];
  if (only !== 'duel') {
    for (let i = 0; i < games3; i++) {
      const seed = seed0 + i;
      const slot = { rng: [mixSeed(seed * 7919 + 13)] };
      const pick = () => kits[randInt(slot, 0, 0, kits.length - 1)]!;
      const spec = `${pick()},${pick()},${pick()}/${pick()},${pick()},${pick()}`;
      specs.push({ kind: '3v3', seed, lineup: parseLineup(spec) });
    }
  }
  if (only !== '3v3') {
    for (let a = 0; a < kits.length; a++) {
      for (let b = a + 1; b < kits.length; b++) {
        for (let i = 0; i < duelGames; i++) {
          const [x, y] = i % 2 === 0 ? [kits[a]!, kits[b]!] : [kits[b]!, kits[a]!];
          specs.push({ kind: 'duel', seed: seed0 + 100000 + a * 10000 + b * 1000 + i, lineup: parseLineup(`${x}/${y}`) });
        }
      }
    }
  }
  console.log(`Balance run: ${specs.filter((s) => s.kind === '3v3').length} 3v3 games (random comps) + ${specs.filter((s) => s.kind === 'duel').length} duels on ${threads} threads, v2 bots at balance difficulty`);
  if (tuned.length) console.log(`What-if tuning:\n  ${tuned.join('\n  ')}`);

  const t0 = Date.now();
  const games = await runAll(specs, sets, threads);
  const secs = (Date.now() - t0) / 1000;

  // Determinism spot check.
  const first = games[0]!;
  const again = play(specs.find((s) => s.kind === first.kind && s.seed === first.seed)!);
  const deterministic = again.hash === first.hash;

  // ---- Duel matrix ----
  const duel: Record<string, Record<string, Rec>> = Object.fromEntries(kits.map((a) => [a, Object.fromEntries(kits.map((b) => [b, rec()]))]));
  for (const g of games.filter((x) => x.kind === 'duel')) {
    if (g.winner < 0) continue;
    const [p0, p1] = g.players as [PlayerOut, PlayerOut];
    const w = g.winner === p0.team ? p0 : p1;
    const l = w === p0 ? p1 : p0;
    duel[w.pokemon]![l.pokemon]!.wins++;
    duel[w.pokemon]![l.pokemon]!.games++;
    duel[l.pokemon]![w.pokemon]!.games++;
  }

  // ---- 3v3 roles, impact ----
  const roles: Record<string, { forward: Rec; goalie: Rec; all: Rec }> = Object.fromEntries(kits.map((k) => [k, { forward: rec(), goalie: rec(), all: rec() }]));
  const xs: number[][] = [];
  const ys: number[] = [];
  const samples: { pokemon: string; role: string; shares: number[] }[] = [];
  const g3 = games.filter((x) => x.kind === '3v3');
  for (const g of g3) {
    if (g.winner < 0) continue;
    const shares = impactShares(g.players);
    g.players.forEach((p, i) => {
      xs.push(shares[i]!);
      ys.push(g.winner === p.team ? 1 : 0);
      samples.push({ pokemon: p.pokemon, role: p.role, shares: shares[i]! });
      // Mirror games (same Pokémon on both teams) say nothing about that Pokémon.
      if (g.players.some((o) => o.team !== p.team && o.pokemon === p.pokemon)) return;
      const r = roles[p.pokemon]!;
      for (const k of [p.role, 'all'] as const) {
        r[k].games++;
        if (g.winner === p.team) r[k].wins++;
      }
    });
  }
  const model = xs.length ? fitImpact(xs, ys) : null;
  const impact: Record<string, { forward: number; goalie: number; all: number }> = {};
  for (const k of kits) {
    const mine = samples.filter((s) => s.pokemon === k);
    const avg = (arr: typeof mine) => (arr.length && model ? arr.reduce((s, x) => s + impactOf(model, x.shares), 0) / arr.length : 0);
    impact[k] = { forward: avg(mine.filter((s) => s.role === 'forward')), goalie: avg(mine.filter((s) => s.role === 'goalie')), all: avg(mine) };
  }

  // ---- Per-move numbers (per game played) ----
  const moveStats: Record<string, Record<string, Record<string, number>>> = {};
  const gamesBy: Record<string, number> = {};
  for (const g of g3) {
    for (const p of g.players) {
      gamesBy[p.pokemon] = (gamesBy[p.pokemon] ?? 0) + 1;
      const ms = (moveStats[p.pokemon] ??= {});
      for (const [id, m] of Object.entries(p.moves)) {
        const acc = (ms[id] ??= {});
        for (const [f, v] of Object.entries(m)) acc[f] = (acc[f] ?? 0) + v;
      }
    }
  }

  // ---- Tiers ----
  const static_ = Object.fromEntries(analyzeRoster().map((f) => [f.id, f]));
  const rows = kits.map((k) => {
    const r = roles[k]!;
    const fw = r.forward.games ? simTier(r.forward.wins, r.forward.games) : null;
    const gk = r.goalie.games ? simTier(r.goalie.wins, r.goalie.games) : null;
    const overall: Tier | null = fw && gk ? bestTier(fw.tier, gk.tier) : (fw ?? gk)?.tier ?? null;
    return { pokemon: k, name: static_[k]!.name, roles: r, fw, gk, overall, theory: static_[k]!.theoryTier, budget: static_[k]!.budget, impact: impact[k]! };
  });

  // ---- Console ----
  console.log(`\nDone in ${(secs / 60).toFixed(1)} min · deterministic replay ${deterministic ? 'OK' : 'MISMATCH'}`);
  if (model) {
    console.log(`\nImpact model (${model.samples} player-games, ${pct(model.accuracy)} of outcomes predicted from stat shares):`);
    console.log('  ' + IMPACT_FEATURES.map((f, i) => `${f} ${model.weights[i]! >= 0 ? '+' : ''}${model.weights[i]!.toFixed(2)}`).join(' · '));
  }
  console.log('\nTiers (3v3, per role; win rate shrunk toward 50 %, 95 % CI):');
  for (const r of rows) {
    const cell = (s: ReturnType<typeof simTier> | null, x: Rec) => (s ? `${(s.tier + (s.uncertain ? '?' : '')).padEnd(5)} ${pct(x.wins / Math.max(1, x.games))} n=${x.games}` : '–').padEnd(22);
    console.log(`  ${r.name.padEnd(10)} overall ${(r.overall ?? '–').padEnd(5)} forward ${cell(r.fw, r.roles.forward)} goalie ${cell(r.gk, r.roles.goalie)} impact ${r.impact.all >= 0 ? '+' : ''}${r.impact.all.toFixed(1)} · theory ${r.theory}`);
  }
  if (only !== '3v3') {
    console.log('\nDuel matrix (row beats column):');
    console.log('  ' + ''.padEnd(10) + kits.map((k) => k.slice(0, 8).padStart(10)).join(''));
    for (const a of kits) console.log('  ' + a.padEnd(10) + kits.map((b) => (a === b ? '–' : pct(duel[a]![b]!.wins / Math.max(1, duel[a]![b]!.games))).padStart(10)).join(''));
  }

  // ---- Files ----
  const outDir = resolve(ROOT, arg('out', 'reports'));
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const tag = sets.length ? '_whatif' : '';
  const report = {
    generatedAt: new Date().toISOString(),
    difficulty: 'balance',
    seeds: seed0,
    tuning: tuned,
    games3v3: g3.length,
    duels: games.length - g3.length,
    minutes: +(secs / 60).toFixed(1),
    deterministic,
    draws: games.filter((g) => g.winner < 0).length,
    model,
    tiers: rows.map((r) => ({
      pokemon: r.pokemon,
      overall: r.overall,
      forward: { ...r.roles.forward, tier: r.fw?.tier ?? null, uncertain: r.fw?.uncertain ?? null, ci: r.fw?.ci ?? null },
      goalie: { ...r.roles.goalie, tier: r.gk?.tier ?? null, uncertain: r.gk?.uncertain ?? null, ci: r.gk?.ci ?? null },
      all: r.roles.all,
      impact: r.impact,
      theory: r.theory,
      budget: r.budget,
    })),
    duel,
    moves: Object.fromEntries(Object.entries(moveStats).map(([k, ms]) => [k, Object.fromEntries(Object.entries(ms).map(([id, m]) => [id, Object.fromEntries(Object.entries(m).map(([f, v]) => [f, +(v / gamesBy[k]!).toFixed(2)]))]))])),
  };
  const base = join(outDir, `balance-${stamp}${tag}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + '\n');
  const baselinePath = join(outDir, 'balance-baseline.json');
  const baseline = sets.length && existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as typeof report) : null;
  writeFileSync(`${base}.html`, html(report, kits, baseline));
  console.log(`\nReport: ${base}.html (+ .json)`);

  if (!sets.length && only !== 'duel' && !flag('no-snapshot')) {
    copyFileSync(`${base}.json`, baselinePath);
    const snap = {
      $comment: 'Sim tier snapshot, written by `npm run balance` (M4.6). Do not edit by hand.',
      generatedAt: report.generatedAt.slice(0, 16).replace('T', ' ') + ' UTC',
      difficulty: 'balance',
      entries: rows.map((r) => ({ pokemon: r.pokemon, forward: r.roles.forward, goalie: r.roles.goalie, impact: +r.impact.all.toFixed(2) })),
    };
    writeFileSync(resolve(ROOT, 'packages/data/balance/tiers.json'), JSON.stringify(snap, null, 2) + '\n');
    console.log('Tier snapshot: packages/data/balance/tiers.json (shown in the F3 Tiers tab)');
  }
  if (baseline) {
    console.log('\nChange vs baseline (3v3 win rate, all roles):');
    for (const t of report.tiers) {
      const b = baseline.tiers.find((x) => x.pokemon === t.pokemon);
      if (!b) continue;
      const now = t.all.wins / Math.max(1, t.all.games);
      const was = b.all.wins / Math.max(1, b.all.games);
      console.log(`  ${t.pokemon.padEnd(10)} ${pct(was)} → ${pct(now)} (${now >= was ? '+' : ''}${((now - was) * 100).toFixed(1)} pts)`);
    }
  }
  if (!deterministic) process.exitCode = 1;
}

// ---------------------------------------------------------------- HTML report

interface RoleOut extends Rec {
  tier: Tier | null;
  uncertain: boolean | null;
  ci: [number, number] | null;
}
interface ReportLike {
  generatedAt: string;
  difficulty: string;
  tuning: string[];
  games3v3: number;
  duels: number;
  minutes: number;
  deterministic: boolean;
  draws: number;
  model: { features: readonly string[]; weights: number[]; accuracy: number; samples: number } | null;
  tiers: { pokemon: string; overall: Tier | null; forward: RoleOut; goalie: RoleOut; all: Rec; impact: { forward: number; goalie: number; all: number }; theory: Tier; budget: number }[];
  duel: Record<string, Record<string, Rec>>;
  moves: Record<string, Record<string, Record<string, number>>>;
}

function html(r: ReportLike, kits: string[], baseline: ReportLike | null): string {
  const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const badge = (t: string | null, q = false) => `<b class="tier t-${(t ?? 'none').replace('.', '_')}" title="${t ? esc(TIER_MEANING[t as Tier]) : 'no data'}">${t ?? '–'}${q ? '?' : ''}</b>`;
  const p = (w: number, g: number) => (g ? `${((100 * w) / g).toFixed(1)}%` : '–');
  const ci = (c: [number, number] | null) => (c ? `${(c[0] * 100).toFixed(0)}–${(c[1] * 100).toFixed(0)}%` : '');
  const name = (k: string) => k[0]!.toUpperCase() + k.slice(1);
  const tierRows = r.tiers
    .map((t) => {
      const b = baseline?.tiers.find((x) => x.pokemon === t.pokemon);
      const delta = b ? ((t.all.wins / Math.max(1, t.all.games) - b.all.wins / Math.max(1, b.all.games)) * 100).toFixed(1) : null;
      return `<tr><th>${name(t.pokemon)}</th><td>${badge(t.overall)}</td>
        <td>${badge(t.forward.tier, !!t.forward.uncertain)} ${p(t.forward.wins, t.forward.games)} <small>${ci(t.forward.ci)} · n=${t.forward.games}</small></td>
        <td>${badge(t.goalie.tier, !!t.goalie.uncertain)} ${p(t.goalie.wins, t.goalie.games)} <small>${ci(t.goalie.ci)} · n=${t.goalie.games}</small></td>
        <td>${t.impact.all >= 0 ? '+' : ''}${t.impact.all.toFixed(1)} <small>F ${t.impact.forward.toFixed(1)} · G ${t.impact.goalie.toFixed(1)}</small></td>
        <td>${badge(t.theory)} <small>${Math.round(t.budget)}</small></td>${baseline ? `<td>${delta !== null ? `${Number(delta) >= 0 ? '+' : ''}${delta} pts` : '–'}</td>` : ''}</tr>`;
    })
    .join('');
  const matrix = `<tr><th></th>${kits.map((k) => `<th>${name(k)}</th>`).join('')}</tr>${kits
    .map(
      (a) =>
        `<tr><th>${name(a)}</th>${kits
          .map((b) => {
            if (a === b) return '<td class="dim">–</td>';
            const c = r.duel[a]![b]!;
            const v = c.games ? c.wins / c.games : 0.5;
            const hue = v >= 0.5 ? `rgba(80,200,120,${Math.min(0.6, (v - 0.5) * 2)})` : `rgba(230,80,90,${Math.min(0.6, (0.5 - v) * 2)})`;
            return `<td style="background:${hue}">${p(c.wins, c.games)} <small>n=${c.games}</small></td>`;
          })
          .join('')}</tr>`,
    )
    .join('')}`;
  const moves = Object.entries(r.moves)
    .map(
      ([k, ms]) =>
        `<h3>${name(k)}</h3><table><tr><th>Move</th><th>Casts</th><th>Player hits</th><th>Ball hits</th><th>Damage</th><th>KOs</th><th>Goals</th></tr>${Object.entries(ms)
          .map(([id, m]) => `<tr><th>${esc(id)}</th><td>${m.casts}</td><td>${m.playerHits}</td><td>${m.ballHits}</td><td>${Math.round(m.damage ?? 0)}</td><td>${m.kos}</td><td>${m.goals}</td></tr>`)
          .join('')}</table>`,
    )
    .join('');
  const weights = r.model
    ? r.model.features.map((f, i) => `<tr><th>${f}</th><td>${r.model!.weights[i]! >= 0 ? '+' : ''}${r.model!.weights[i]!.toFixed(2)}</td></tr>`).join('')
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PokéAthlon balance report</title><style>
:root{--bg:#14112a;--panel:#1f1a3d;--ink:#f4f2ff;--muted:#b9b4d6;--line:rgba(255,255,255,.12)}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,'Segoe UI',sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}
section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:14px 0;overflow-x:auto}
h1{margin:8px 0}h2{margin:4px 0 10px;font-size:18px}h3{margin:12px 0 4px;font-size:15px}
table{border-collapse:collapse;width:100%}th,td{padding:4px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child{text-align:left}small,.dim,.muted{color:var(--muted)}
.tier{display:inline-block;min-width:38px;padding:1px 6px;border-radius:6px;text-align:center;font-weight:800;color:#14112a}
.t-T0{background:#ff3b5c}.t-T0_5{background:#ff8a3d}.t-A{background:#ffd23f}.t-B{background:#7dff9a}.t-C{background:#5ad1ff}.t-D{background:#a98bff}.t-F{background:#8a8aa0}.t-none{background:rgba(255,255,255,.15);color:var(--muted)}
.legend{display:flex;flex-wrap:wrap;gap:10px}
</style></head><body><main>
<h1>PokéAthlon balance report</h1>
<p class="muted">${esc(r.generatedAt.slice(0, 16).replace('T', ' '))} UTC · ${r.games3v3} 3v3 games (random comps) + ${r.duels} duels · v2 bots at <b>${r.difficulty}</b> difficulty · ${r.minutes} min · replay ${r.deterministic ? 'deterministic' : 'MISMATCH'} · ${r.draws} time-limit draws
${r.tuning.length ? `<br><b>What-if tuning:</b> ${r.tuning.map(esc).join('; ')}${baseline ? ' — compared with the last baseline run' : ''}` : ''}</p>
<section><h2>Tier list (per role)</h2>
<table><tr><th>Pokémon</th><th>Overall</th><th>Forward</th><th>Goalie</th><th>Impact (pts)</th><th>Theory</th>${baseline ? '<th>Δ win rate</th>' : ''}</tr>${tierRows}</table>
<p class="muted">Win rates come from 3v3 games, leaving out games where the same Pokémon was on both teams. The tier uses the win rate pulled toward 50 % by 100 phantom games. "?" means the 95 % interval spans more than one neighbouring tier. Impact is the change in win probability that the Pokémon's average stat line predicts. Theory is the tier from the kit analyzer's power budget.</p>
<div class="legend">${TIERS.map((t) => `<span>${badge(t)} ${esc(TIER_MEANING[t])}</span>`).join('')}</div></section>
<section><h2>Duel matrix (1v1, row vs column)</h2><table>${matrix}</table></section>
<section><h2>Impact model</h2><p class="muted">Logistic regression of each player's share of the match total on whether their team won (${r.model?.samples ?? 0} player-games, ${r.model ? (r.model.accuracy * 100).toFixed(1) : 0}% of outcomes predicted). Weights are log-odds per standard deviation.</p><table>${weights}</table></section>
<section><h2>Moves (per 3v3 game played)</h2>${moves}</section>
<p class="muted">Caveat: these are bot games. Bot balance is not human balance, so human playtest notes have the final say.</p>
</main></body></html>`;
}

// ---------------------------------------------------------------- entry (last, after every declaration)

if (!isMainThread) {
  const { sets, specs } = workerData as { sets: string[]; specs: Spec[] };
  applyTuning(sets);
  for (const s of specs) parentPort!.postMessage(play(s));
} else {
  await main();
}
