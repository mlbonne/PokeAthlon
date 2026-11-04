/**
 * Static kit report: every move's reach, area, timing, damage, DPS, knockback and ball power, plus a
 * per-Pokémon summary and provisional power budget. Pure data, no matches played.
 *
 *   npm run kits [-- --only pikachu,lucario] [--out reports]
 *
 * Prints Markdown tables and writes reports/kits-<date>.md and .json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRoster, BUDGET_WEIGHTS, KO_EDGE_DISTANCE, type FighterStats, type MoveStats } from '@pokeathlon/data/analyze';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : def;
};
const only = arg('only', '');
const fighters = analyzeRoster(only ? only.split(',') : undefined);

const n0 = (x: number) => (x ? Math.round(x).toLocaleString('en-US') : '–');
const n1 = (x: number) => (x ? x.toFixed(1) : '–');
const n2 = (x: number) => (x ? x.toFixed(2) : '–');
const s = (x: number) => (x ? `${x.toFixed(2)} s` : '–');
const k = (x: number) => (x ? `${(x / 1000).toFixed(0)}k` : '–');
const pct = (x: number) => (x ? `${Math.round(x * 100)} %` : '–');

function table(head: string[], rows: string[][]): string {
  const align = head.map((_, i) => (i === 0 ? '---' : '---:'));
  return [head, align, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

const moveRow = (m: MoveStats): string[] => [
  `${m.name} (${m.slot})`,
  m.kind,
  m.cooldown ? `${m.cooldown} s` : m.slot === 'burst' ? '75 nrg' : '–',
  s(m.castTime),
  s(m.duration),
  s(m.lockTime),
  n0(m.reach),
  m.hitsPerCast || m.ballPower ? `${m.timeToReach.toFixed(2)} s` : '–',
  k(m.hitArea),
  k(m.sweptArea),
  m.hitsPerCast ? String(m.hitsPerCast) : '–',
  n0(m.damagePerCast),
  n1(m.dps),
  n0(m.knockback),
  n0(m.staggeredKnockback),
  pct(m.koReach),
  n0(m.ballPower),
  m.stun || m.ballStun ? [m.stun ? `${m.stun} s` : '', m.ballStun ? `ball ${m.ballStun} s` : ''].filter(Boolean).join(', ') : '–',
  [m.mobility ? `+${n0(m.mobility)} move` : '', m.heal ? `heal ${pct(m.heal)}` : '', m.shield].filter(Boolean).join(', ') || '–',
];
const MOVE_HEAD = [
  'Move',
  'Kind',
  'CD',
  'Wind-up',
  'Duration',
  'Locked',
  'Reach',
  'Time to reach',
  'Hit area',
  'Swept area',
  'Hits',
  'Dmg/cast',
  'DPS',
  'KB',
  'KB vs Staggered',
  'KO reach',
  'Ball power',
  'Stun',
  'Utility',
];

const summary = table(
  ['Pokémon', 'Size', 'Power', 'Speed', 'Stagger L1→L10', 'Kit DPS', 'Combo dmg', 'Combos to Stagger', 'Ball pressure /s', 'Max ball', 'Mobility', 'Control', 'Max KO reach', 'Survive (s)', 'Budget', 'Theory tier'],
  fighters.map((f) => [
    `**${f.name}**`,
    f.size,
    String(f.power),
    String(f.speed),
    `${n0(f.staggerL1)}→${n0(f.staggerL10)}`,
    n1(f.kitDps),
    n0(f.comboDamage),
    n2(f.combosToStagger),
    n0(f.ballPressure),
    n0(f.maxBallPower),
    n0(f.mobility),
    n2(f.control),
    pct(f.maxKoReach),
    n1(f.survivability),
    `**${f.budget.toFixed(0)}**`,
    `**${f.theoryTier}**`,
  ]),
);

const budgetTable = table(
  ['Pokémon', ...Object.keys(BUDGET_WEIGHTS).map((p) => `${p} (×${BUDGET_WEIGHTS[p as keyof typeof BUDGET_WEIGHTS]})`), 'Budget'],
  fighters.map((f) => [f.name, ...Object.values(f.budgetParts).map((v) => v.toFixed(0)), `**${f.budget.toFixed(0)}**`]),
);

const perFighter = fighters
  .map((f: FighterStats) => `### ${f.name} (${f.archetype})\n\n${table(MOVE_HEAD, [f.strike, ...f.moves, f.burst].map(moveRow))}`)
  .join('\n\n');

const md = `# Kit analysis (${new Date().toISOString().slice(0, 10)})

Static numbers from the data (no matches played): \`npm run kits\`. Per-cast values assume every part lands on one target.

## Summary

${summary}

- **Kit DPS**: Σ (damage per cast ÷ cooldown) over the three moves. Strike only hits the ball.
- **Combos to Stagger**: full combos needed to empty an average level-1 Stagger bar.
- **Ball pressure**: ball knockback per second available from Strike + ball-hitting moves.
- **Mobility**: walk speed + average bonus speed from dashes and speed buffs (units/s).
- **Control**: stun seconds (ball stun counts half) per second of cooldown.
- **KO reach**: one hit's push on a Staggered target ÷ the ${KO_EDGE_DISTANCE}-unit centre-to-side-edge distance (≥ 100 % KOs from the middle).
- **Survive**: seconds the average kit DPS needs to empty this Stagger bar (bigger hurtboxes count as less).

## Power budget (100 = roster average, provisional weights)

${budgetTable}

## Moves

${perFighter}
`;

console.log(md);
const outDir = resolve(ROOT, arg('out', 'reports'));
mkdirSync(outDir, { recursive: true });
const base = join(outDir, `kits-${new Date().toISOString().slice(0, 10)}`);
writeFileSync(`${base}.md`, md);
writeFileSync(`${base}.json`, JSON.stringify(fighters, null, 2) + '\n');
console.log(`Written ${base}.md and .json`);
