/**
 * Balance report (M4.6): thousands of headless 3v3 bot matches → matchup matrix, per-role win rates,
 * impact scores, T0–F tiers and per-move numbers. Writes reports/balance-<date>.{json,html} and,
 * for an untouched baseline, the tier snapshot the F3 Tiers tab reads
 * (packages/data/balance/tiers.json).
 *
 *   npm run balance [-- --games 600] [--seed 1] [--threads N] [--set lucario.aura-sphere.cooldown=11 ...] [--no-snapshot]
 *
 * 3v3 is the only mode. Every game draws a random comp (seeded) for both teams, so every Pokémon
 * plays Forward and Goalie against every other. Games where a Pokémon is on both sides don't count
 * for it. Matchups: the win rate of teams fielding Pokémon A against teams fielding Pokémon B.
 * --set: what-if tuning (see packages/data/src/tuning.ts); the report shows the change against
 *      the last baseline run (reports/balance-baseline.json). No snapshot is written.
 * Bots play at `balance` difficulty (v2).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { getPokemon, itemsFor } from '@pokeathlon/data';
import { applyTuning } from '@pokeathlon/data/tuning';
import { analyzeRoster, simTier, bestTier, TIERS, TIER_MEANING, type Tier } from '@pokeathlon/data/analyze';
import { fitImpact, impactOf, impactShares, IMPACT_FEATURES, mixSeed, parseLineup, randInt, runHeadless, type PlayerSpawn } from '@pokeathlon/sim';

// ---------------------------------------------------------------- worker side

interface Spec {
  kind: '3v3';
  seed: number;
  lineup: PlayerSpawn[];
  boosts: boolean;
}
interface PlayerOut {
  pokemon: string;
  item: string;
  boosts: string[];
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
  const r = runHeadless(spec.lineup, { seed: spec.seed, brains: ['v2', 'v2'], maxMinutes: 20, boosts: spec.boosts });
  return {
    kind: spec.kind,
    seed: spec.seed,
    winner: r.winner,
    minutes: +r.minutes.toFixed(3),
    hash: r.hash,
    players: r.telemetry.players.map((t) => ({
      pokemon: t.pokemon,
      item: t.item,
      boosts: t.boosts,
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
  const seed0 = Number(arg('seed', '1'));
  const threads = Number(arg('threads', String(Math.max(1, availableParallelism() - 1))));
  const kits = analyzeRoster().map((k) => k.id);
  const noItems = arg('items', 'on') === 'off';
  const noBoosts = arg('boosts', 'on') === 'off';

  // ---- Specs ----
  const specs: Spec[] = [];
  {
    for (let i = 0; i < games3; i++) {
      const seed = seed0 + i;
      const slot = { rng: [mixSeed(seed * 7919 + 13)] };
      const pick = () => kits[randInt(slot, 0, 0, kits.length - 1)]!;
      // Brawlers (bestRole 'forward') never keep goal: the last of each team is the goalie.
      const keepers = kits.filter((k) => getPokemon(k).bestRole !== 'forward');
      const pickGk = () => keepers[randInt(slot, 0, 0, keepers.length - 1)]!;
      const spec = `${pick()},${pick()},${pickGk()}/${pick()},${pick()},${pickGk()}`;
      // Held items (M5.5): a random item of the player's slot, unless --items off.
      const lineup = parseLineup(spec).map((s) => {
        if (noItems) return s;
        const pool = itemsFor(s.role === 'goalie' ? 'goalie' : 'forward');
        return { ...s, item: pool[randInt(slot, 0, 0, pool.length - 1)]!.id };
      });
      specs.push({ kind: '3v3', seed, lineup, boosts: !noBoosts });
    }
  }
  console.log(`Balance run: ${specs.length} 3v3 games (random comps${noItems ? ', no items' : ', random items'}${noBoosts ? ', no boosts' : ', boost drafts'}) on ${threads} threads, v2 bots at balance difficulty`);
  if (tuned.length) console.log(`What-if tuning:\n  ${tuned.join('\n  ')}`);

  const t0 = Date.now();
  const games = await runAll(specs, sets, threads);
  const secs = (Date.now() - t0) / 1000;

  // Determinism spot check.
  const first = games[0]!;
  const again = play(specs.find((s) => s.kind === first.kind && s.seed === first.seed)!);
  const deterministic = again.hash === first.hash;

  // ---- Matchups (3v3): teams fielding A vs teams fielding B (A on one side only) ----
  const matchups: Record<string, Record<string, Rec>> = Object.fromEntries(kits.map((a) => [a, Object.fromEntries(kits.map((b) => [b, rec()]))]));
  for (const g of games) {
    if (g.winner < 0) continue;
    for (const t of [0, 1] as const) {
      const mine = new Set(g.players.filter((p) => p.team === t).map((p) => p.pokemon));
      const theirs = new Set(g.players.filter((p) => p.team !== t).map((p) => p.pokemon));
      for (const a of mine) {
        if (theirs.has(a)) continue;
        for (const b of theirs) {
          if (mine.has(b)) continue;
          matchups[a]![b]!.games++;
          if (g.winner === t) matchups[a]![b]!.wins++;
        }
      }
    }
  }

  // ---- 3v3 roles, impact ----
  const roles: Record<string, { forward: Rec; goalie: Rec; all: Rec }> = Object.fromEntries(kits.map((k) => [k, { forward: rec(), goalie: rec(), all: rec() }]));
  const xs: number[][] = [];
  const ys: number[] = [];
  const samples: { pokemon: string; role: string; shares: number[] }[] = [];
  const g3 = games;
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

  // ---- Held items: win rate of players holding item X when the other team doesn't hold it ----
  const itemRecs: Record<string, Rec> = {};
  for (const g of g3) {
    if (g.winner < 0) continue;
    for (const p of g.players) {
      if (!p.item || g.players.some((o) => o.team !== p.team && o.item === p.item)) continue;
      const r = (itemRecs[p.item] ??= rec());
      r.games++;
      if (g.winner === p.team) r.wins++;
    }
  }

  // ---- Boosts: win rate of players holding X when the other team doesn't; picks per game ----
  const boostRecs: Record<string, Rec & { picks: number }> = {};
  for (const g of g3) {
    for (const p of g.players) for (const b of p.boosts) (boostRecs[b] ??= { ...rec(), picks: 0 }).picks++;
    if (g.winner < 0) continue;
    for (const p of g.players) {
      for (const b of p.boosts) {
        if (g.players.some((o) => o.team !== p.team && o.boosts.includes(b))) continue;
        boostRecs[b]!.games++;
        if (g.winner === p.team) boostRecs[b]!.wins++;
      }
    }
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
  if (Object.keys(itemRecs).length) {
    console.log('\nHeld items (win rate when only one team holds it):');
    for (const slot of ['forward', 'goalie'] as const) {
      for (const it of itemsFor(slot)) {
        const r = itemRecs[it.id];
        if (r) console.log(`  ${slot.padEnd(8)} ${it.name.padEnd(14)} ${pct(r.wins / Math.max(1, r.games))} n=${r.games}`);
      }
    }
  }
  if (Object.keys(boostRecs).length) {
    console.log('\nBoosts (win rate when only one team holds it · picks per game):');
    for (const [id, r] of Object.entries(boostRecs).sort((a, b) => b[1].wins / Math.max(1, b[1].games) - a[1].wins / Math.max(1, a[1].games))) {
      console.log(`  ${id.padEnd(14)} ${pct(r.wins / Math.max(1, r.games))} n=${String(r.games).padEnd(5)} picks/game ${(r.picks / g3.length).toFixed(2)}`);
    }
  }
  console.log('\nMatchups (3v3: win rate of teams with the row Pokémon vs teams with the column Pokémon):');
  console.log('  ' + ''.padEnd(10) + kits.map((k) => k.slice(0, 8).padStart(10)).join(''));
  for (const a of kits) console.log('  ' + a.padEnd(10) + kits.map((b) => (a === b ? '–' : pct(matchups[a]![b]!.wins / Math.max(1, matchups[a]![b]!.games))).padStart(10)).join(''));

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
    matchups,
    items: itemRecs,
    boosts: boostRecs,
    moves: Object.fromEntries(Object.entries(moveStats).map(([k, ms]) => [k, Object.fromEntries(Object.entries(ms).map(([id, m]) => [id, Object.fromEntries(Object.entries(m).map(([f, v]) => [f, +(v / gamesBy[k]!).toFixed(2)]))]))])),
  };
  const base = join(outDir, `balance-${stamp}${tag}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + '\n');
  const baselinePath = join(outDir, 'balance-baseline.json');
  const baseline = sets.length && existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as typeof report) : null;
  writeFileSync(`${base}.html`, html(report, kits, baseline));
  console.log(`\nReport: ${base}.html (+ .json)`);

  if (!sets.length && !flag('no-snapshot')) {
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
  minutes: number;
  deterministic: boolean;
  draws: number;
  model: { features: readonly string[]; weights: number[]; accuracy: number; samples: number } | null;
  tiers: { pokemon: string; overall: Tier | null; forward: RoleOut; goalie: RoleOut; all: Rec; impact: { forward: number; goalie: number; all: number }; theory: Tier; budget: number }[];
  matchups: Record<string, Record<string, Rec>>;
  items?: Record<string, Rec>;
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
            const c = r.matchups[a]![b]!;
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
<p class="muted">${esc(r.generatedAt.slice(0, 16).replace('T', ' '))} UTC · ${r.games3v3} 3v3 games (random comps) · v2 bots at <b>${r.difficulty}</b> difficulty · ${r.minutes} min · replay ${r.deterministic ? 'deterministic' : 'MISMATCH'} · ${r.draws} time-limit draws
${r.tuning.length ? `<br><b>What-if tuning:</b> ${r.tuning.map(esc).join('; ')}${baseline ? ' — compared with the last baseline run' : ''}` : ''}</p>
<section><h2>Tier list (per role)</h2>
<table><tr><th>Pokémon</th><th>Overall</th><th>Forward</th><th>Goalie</th><th>Impact (pts)</th><th>Theory</th>${baseline ? '<th>Δ win rate</th>' : ''}</tr>${tierRows}</table>
<p class="muted">Win rates come from 3v3 games, leaving out games where the same Pokémon was on both teams. The tier uses the win rate pulled toward 50 % by 100 phantom games. "?" means the 95 % interval spans more than one neighbouring tier. Impact is the change in win probability that the Pokémon's average stat line predicts. Theory is the tier from the kit analyzer's power budget.</p>
<div class="legend">${TIERS.map((t) => `<span>${badge(t)} ${esc(TIER_MEANING[t])}</span>`).join('')}</div></section>
${r.items && Object.keys(r.items).length ? `<section><h2>Held items</h2><p class="muted">Win rate of players holding the item when the other team doesn't hold it.</p><table><tr><th>Item</th><th>Win rate</th><th>n</th></tr>${Object.entries(r.items).sort((x, y) => y[1].wins / y[1].games - x[1].wins / x[1].games).map(([id, x]) => `<tr><th>${esc(id)}</th><td>${p(x.wins, x.games)}</td><td>${x.games}</td></tr>`).join('')}</table></section>` : ''}<section><h2>Matchups (3v3)</h2><p class="muted">Win rate of teams fielding the row Pokémon against teams fielding the column Pokémon (neither on both sides).</p><table>${matrix}</table></section>
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
