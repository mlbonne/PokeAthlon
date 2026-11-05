import { boostDraft, boosts as ALL_BOOSTS } from '@pokeathlon/data';
import { chooseBoost } from './ai/draft';
import { boostsNewSet, grantBoost } from './boosts';
import { ticks } from './constants';
import type { PlayerInput } from './input';
import { beginKickoff } from './match';
import { refreshBody } from './moves';
import { mixSeed, randInt } from './rng';
import type { Team } from './stage';
import { maxStaggerAt, type Player, type World } from './world';

/**
 * Boost draft (M5.6, OS Awakening draft).
 * - `start`: before the first kickoff, everyone sees the same `startOffers` boosts and takes one
 *   (simultaneously; two players may take the same one).
 * - `set`: after each set, a shared pool of `poolSize`, picked one at a time and only once each.
 *   Order: top XP that set on the winning team, then top XP on the losing team, alternating down.
 * A pick is part of the player's input (`PlayerInput.pick` = index into `offers`), so replays stay
 * exact. A pick that doesn't come in time is made automatically (CPU drafting logic).
 */
export interface DraftState {
  kind: 'start' | 'set';
  /** Boost ids still on offer. */
  offers: string[];
  /** Pick order (player ids). For `start`, everyone at once. */
  order: number[];
  /** `set`: index into `order`. */
  turn: number;
  /** Ticks left for the current pick (start: for everyone). */
  ticks: number;
  /** Ticks since the current pick began. */
  elapsed: number;
  /** Boost picked by each player in this draft (null = not yet). */
  picked: (string | null)[];
}

/** Draw `n` distinct boost ids, seeded by the match seed and set. */
function drawOffers(world: World, n: number): string[] {
  const slot = { rng: [mixSeed((world.seed * 977 + world.match.setIndex * 31 + 7) >>> 0)] };
  const pool = ALL_BOOSTS.map((b) => b.id);
  const out: string[] = [];
  while (out.length < Math.min(n, pool.length)) {
    const i = randInt(slot, 0, 0, pool.length - 1);
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}

/** OS order: winners' top XP, losers' top XP, alternating. */
function pickOrder(world: World, winner: Team): number[] {
  const setXp = (p: Player) => p.xp - p.boostState.setXpStart;
  const team = (t: number) => world.players.filter((p) => p.team === t).sort((a, b) => setXp(b) - setXp(a) || a.id - b.id);
  const w = team(winner);
  const l = team(winner === 0 ? 1 : 0);
  const out: number[] = [];
  for (let i = 0; i < Math.max(w.length, l.length); i++) {
    if (w[i]) out.push(w[i]!.id);
    if (l[i]) out.push(l[i]!.id);
  }
  return out;
}

export function beginDraft(world: World, kind: 'start' | 'set'): void {
  const winner = (world.match.lastScoringTeam === 1 ? 1 : 0) as Team;
  world.draft = {
    kind,
    offers: drawOffers(world, kind === 'start' ? boostDraft.startOffers : boostDraft.poolSize),
    order: kind === 'start' ? world.players.map((p) => p.id) : pickOrder(world, winner),
    turn: 0,
    ticks: ticks(kind === 'start' ? boostDraft.startPickTime : boostDraft.pickTime),
    elapsed: 0,
    picked: world.players.map(() => null),
  };
  world.match.phase = 'draft';
  world.events.push({ type: 'draftStart', kind, offers: [...world.draft.offers], order: [...world.draft.order] });
}

/** Whose pick it is (`set` drafts), or -1. */
export const currentPicker = (world: World): number => (world.draft?.kind === 'set' ? (world.draft.order[world.draft.turn] ?? -1) : -1);

function give(world: World, p: Player, id: string, auto: boolean): void {
  grantBoost(p, id);
  const prev = p.maxStagger;
  p.bonusStagger = p.boosts.reduce((s, b) => s + (b.effects.maxStaggerAdd ?? 0), 0);
  p.maxStagger = maxStaggerAt(p, p.level);
  p.stagger = Math.max(1, p.stagger + p.maxStagger - prev);
  refreshBody(p);
  world.draft!.picked[p.id] = id;
  world.telemetry.players[p.id]?.boosts.push(id);
  world.events.push({ type: 'boostPick', playerId: p.id, boostId: id, auto });
}

const autoPick = (world: World, p: Player, later: Player[]) => chooseBoost(world, p, world.draft!.offers, later, { deny: false, random: false });

/** Per tick while `phase === 'draft'`. */
export function stepDraft(world: World, inputs: readonly (PlayerInput | undefined)[]): void {
  const d = world.draft;
  if (!d) return;
  d.ticks--;
  d.elapsed++;
  if (d.kind === 'start') {
    for (const p of world.players) {
      if (d.picked[p.id]) continue;
      const i = inputs[p.id]?.pick ?? -1;
      const id = d.offers[i];
      if (id !== undefined && !p.boosts.some((b) => b.id === id)) give(world, p, id, false);
      else if (d.ticks <= 0) {
        const j = autoPick(world, p, []);
        if (j >= 0) give(world, p, d.offers[j]!, true);
        else d.picked[p.id] = '';
      }
    }
    if (world.players.every((p) => d.picked[p.id] !== null)) endDraft(world);
    return;
  }
  // Set draft: one picker at a time; skip players who hold every boost left.
  while (d.turn < d.order.length) {
    const p = world.players[d.order[d.turn]!]!;
    if (d.offers.some((id) => !p.boosts.some((b) => b.id === id))) break;
    d.turn++;
  }
  if (d.turn >= d.order.length || !d.offers.length) {
    endDraft(world);
    return;
  }
  const p = world.players[d.order[d.turn]!]!;
  const i = inputs[p.id]?.pick ?? -1;
  let id = d.offers[i];
  let auto = false;
  if (id === undefined || p.boosts.some((b) => b.id === id)) {
    if (d.ticks > 0) return;
    const later = d.order.slice(d.turn + 1).map((x) => world.players[x]!);
    const j = autoPick(world, p, later);
    id = d.offers[j]!;
    auto = true;
  }
  d.offers.splice(d.offers.indexOf(id), 1);
  give(world, p, id, auto);
  d.turn++;
  d.ticks = ticks(boostDraft.pickTime);
  d.elapsed = 0;
}

function endDraft(world: World): void {
  const kind = world.draft!.kind;
  world.draft = null;
  world.events.push({ type: 'draftEnd' });
  for (const p of world.players) boostsNewSet(p);
  beginKickoff(world, kind === 'set');
}
