import { getBoost, getPokemon } from '@pokeathlon/data';
import { randInt } from '../rng';
import type { Player, World } from '../world';
import { moveModels } from './model';

/**
 * CPU boost drafting (M5.6). Value of a boost for a player from the boost's tags and the player's
 * kit and role (data, no per-Pokémon code), plus a little per-bot noise so drafts vary.
 */
const BRAWLERS = new Set(['flexible-brawler', 'hulking-beast', 'flashy-swordsman']);

export function draftValue(world: World, p: Player, boostId: string): number {
  const b = getBoost(boostId);
  const models = moveModels(p.pokemonId);
  const forward = p.role === 'forward';
  const projectile = models.some((m) => m.delivery === 'projectile');
  const walls = models.some((m) => m.delivery === 'wall');
  const brawler = BRAWLERS.has(getPokemon(p.pokemonId).archetype);
  const sparksHeld = p.boosts.filter((x) => x.effects.spark).length;
  let v = 50;
  for (const t of b.tags) {
    switch (t) {
      case 'speed':
        v += forward ? 12 : 4;
        break;
      case 'power':
        v += forward ? 10 : 6;
        break;
      case 'tank':
        v += forward ? 5 : 14;
        break;
      case 'projectile':
        v += projectile ? 18 : -40;
        break;
      case 'creation':
        v += walls ? 22 : -45;
        break;
      case 'special':
        v += 8;
        break;
      case 'cooldown':
        v += 8;
        break;
      case 'brawl':
        v += forward && brawler ? 14 : 4;
        break;
      case 'sustain':
        v += 6;
        break;
      case 'edge':
        v += forward ? 2 : -25;
        break;
      case 'spark':
        v += 4 + 12 * sparksHeld;
        break;
    }
  }
  return v;
}

/**
 * Pick one of `offers` (indices into it). `deny`: also consider taking what a later enemy picker
 * wants much more than our own best (OS denial drafting). `random`: Easy bots pick at random.
 */
export function chooseBoost(world: World, p: Player, offers: string[], later: Player[], opts: { deny: boolean; random: boolean }): number {
  const legal = offers.map((id, i) => ({ id, i })).filter((o) => !p.boosts.some((b) => b.id === o.id));
  if (!legal.length) return -1;
  if (opts.random) return legal[randInt(world.ai, p.id, 0, legal.length - 1)]!.i;
  const noise = () => randInt(world.ai, p.id, 0, 6);
  let best = legal[0]!;
  let bestV = -Infinity;
  for (const o of legal) {
    const v = draftValue(world, p, o.id) + noise();
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  if (opts.deny) {
    for (const e of later) {
      if (e.team === p.team) continue;
      for (const o of legal) {
        if (e.boosts.some((b) => b.id === o.id)) continue;
        if (draftValue(world, e, o.id) > bestV + 15) return o.i;
      }
      break; // only the next enemy picker matters
    }
  }
  return best.i;
}
