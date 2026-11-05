import { roster } from './index';
import { gameplay } from './rules';
import { getKit, type MoveDef } from './kits';
import { items } from './items';

/**
 * What-if tuning (M4.6, `npm run balance -- --set …`): change kit and stat numbers in memory, for
 * this process only, before any match is simulated. The JSON files are never touched.
 *
 *   lucario.power=100                      a roster stat (power, speed, stagger, staggerGrowth)
 *   lucario.aura-sphere.cooldown=11         a move field (cooldown, castTime, range)
 *   lucario.aura-sphere.damage*=0.8         every hit of the move: damage, knockback (players),
 *                                           ball, stun (both base and Power ratio for scalings)
 *   lucario.close-combat.actions.1.radius=240   any field by its path inside the move
 *   all.stagger*=0.8                       a stat or move field for every Pokémon (moves: all that have it)
 *   lucario.*.damage*=1.2 / all.*.damage*=1.2   every move of one / every Pokémon
 *   rules.respawn.time=8                   any number in rules/gameplay.json, by path
 *   item.muscle-band.knockbackDealtPct=15  any number in a held item's effects, by path
 *
 * `=` sets, `*=` multiplies, `+=` adds. Returns a normalized description of what changed.
 */
export function applyTuning(sets: string[]): string[] {
  return sets.map(applyOne);
}

const SHORTCUTS: Record<string, string[]> = {
  damage: ['damage'],
  knockback: ['player'],
  ball: ['ball'],
};

function applyOne(spec: string): string {
  const m = /^([a-z0-9-]+)\.([A-Za-z0-9.*-]+?)\s*(\*=|\+=|=)\s*(-?[0-9.]+)$/.exec(spec.trim());
  if (!m) throw new Error(`Bad --set "${spec}". Use e.g. lucario.aura-sphere.cooldown=11 or lucario.power*=0.95`);
  const [, mon, path, op, raw] = m as unknown as [string, string, string, string, string];
  const value = Number(raw);
  const apply = (cur: number) => (op === '=' ? value : op === '*=' ? cur * value : cur + value);
  if (mon === 'rules') return setPath(gameplay as unknown as Record<string, unknown>, path.split('.'), apply, spec, 'rules');
  if (mon === 'item') {
    const [id, ...rest] = path.split('.');
    const it = items.find((i) => i.id === id);
    if (!it) throw new Error(`--set: unknown item "${id}"`);
    return setPath(it.effects as unknown as Record<string, unknown>, rest, apply, spec, `item.${id}`);
  }
  if (mon === 'all') {
    const done: string[] = [];
    for (const r of roster) {
      try {
        done.push(applyOne(`${r.id}.${path}${op}${raw}`));
      } catch {
        /* this Pokémon has no such stat / move */
      }
    }
    if (!done.length) throw new Error(`--set: nothing matches "${spec}"`);
    return `all (${done.length}): ${path} ${op} ${value}`;
  }
  const def = roster.find((r) => r.id === mon);
  if (!def) throw new Error(`--set: unknown Pokémon "${mon}"`);

  const parts = path.split('.');
  // Roster stat.
  if (parts.length === 1 && parts[0]! in def.stats && parts[0] !== 'size') {
    const k = parts[0] as 'power' | 'speed' | 'stagger' | 'staggerGrowth';
    def.stats[k] = Math.round(apply(def.stats[k]));
    return `${mon}.${k} = ${def.stats[k]}`;
  }
  const kit = getKit(mon);
  // `*` = every move of this Pokémon (only those the change applies to).
  if (parts[0] === '*' && kit) {
    const done = kit.moves.flatMap((mv) => {
      try {
        return [applyOne(`${mon}.${mv.id}.${parts.slice(1).join('.')}${op}${raw}`)];
      } catch {
        return [];
      }
    });
    if (!done.length) throw new Error(`--set: no move of ${mon} matches "${spec}"`);
    return `${mon}.* (${done.length} moves): ${parts.slice(1).join('.')} ${op} ${value}`;
  }
  const move = kit?.moves.find((x) => x.id === parts[0]);
  if (!move) throw new Error(`--set: ${mon} has no move "${parts[0]}"`);
  const rest = parts.slice(1);
  if (rest.length === 0) throw new Error(`--set: say which field of ${mon}.${parts[0]} to change`);

  // Shortcut: scale/set every hit of the move.
  const short = rest.length === 1 ? SHORTCUTS[rest[0]!] : undefined;
  if (short || (rest.length === 1 && rest[0] === 'stun')) {
    let n = 0;
    for (const a of move.actions) {
      const hit = 'hit' in a ? a.hit : undefined;
      if (!hit) continue;
      if (rest[0] === 'stun') {
        if (hit.stun !== undefined) {
          hit.stun = apply(hit.stun);
          n++;
        }
        continue;
      }
      for (const key of short!) {
        const sc = (hit as unknown as Record<string, { base: number; powerRatio: number } | undefined>)[key];
        if (!sc) continue;
        if (op === '*=') {
          sc.base *= value;
          sc.powerRatio *= value;
        } else {
          sc.base = apply(sc.base);
        }
        n++;
      }
    }
    if (n === 0) throw new Error(`--set: ${mon}.${parts[0]} has no "${rest[0]}" to change`);
    return `${mon}.${move.id}.${rest[0]} ${op} ${value} (${n} hit${n > 1 ? 's' : ''})`;
  }

  // Any numeric field by path.
  return setPath(move as unknown as Record<string, unknown>, rest, apply, spec, `${mon}.${move.id}`);
}

function setPath(root: Record<string, unknown>, keys: string[], apply: (cur: number) => number, spec: string, label: string): string {
  let obj = root;
  for (const key of keys.slice(0, -1)) {
    const next = obj[key];
    if (typeof next !== 'object' || next === null) throw new Error(`--set: no "${key}" in ${spec}`);
    obj = next as Record<string, unknown>;
  }
  const last = keys[keys.length - 1]!;
  if (typeof obj[last] !== 'number') throw new Error(`--set: ${spec} is not a number field`);
  obj[last] = apply(obj[last] as number);
  return `${label}.${keys.join('.')} = ${obj[last] as number}`;
}

/** Deep copy of the current tuned move (for reports). */
export const moveSnapshot = (m: MoveDef): MoveDef => JSON.parse(JSON.stringify(m)) as MoveDef;
