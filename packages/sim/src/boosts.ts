import { getBoost, type BoostDef, type BoostEffects } from '@pokeathlon/data';
import { TICK_RATE, ticks } from './constants';
import { pointInPolygon } from './geometry';
import type { Vec2 } from './vec';
import type { Player, World } from './world';

/**
 * Boosts (M5.6, OS Awakenings). Every effect is a generic hook driven by data/boosts/boosts.json:
 * - static stats (size, Power, max Stagger, speed, Cooldown Rate, Sparks) folded into the body by
 *   `refreshBody` / `boostStatics`;
 * - per tick (`stepBoosts`): Guts, Speed Boost, Run Away (edge), Moxie stacks into Power and speed;
 * - hit multipliers (`boostHitMul`), on-hit effects (`boostOnHit`: burn, Leftovers);
 * - KO hooks (`boostPreventKo` = Sturdy, `boostOnKo` = Moxie), set start (`boostsNewSet`).
 */

export interface BoostState {
  /** Ticks since last hit (Speed Boost). */
  unhit: number;
  moxie: number;
  sturdyUsed: boolean;
  /** XP at the start of this set (draft order). */
  setXpStart: number;
  /** Dynamic extras computed per tick. */
  power: number;
  speedPct: number;
  cooldownRate: number;
  /** Near an edge with Run Away: Power is 0. */
  edgeZero: boolean;
  /** A boost was granted since the last tick: the body needs a refresh. */
  dirty: boolean;
}

export const newBoostState = (): BoostState => ({ unhit: 0, moxie: 0, sturdyUsed: false, setXpStart: 0, power: 0, speedPct: 0, cooldownRate: 0, edgeZero: false, dirty: false });

export const hasBoost = (p: Player, id: string): boolean => p.boosts.some((b) => b.id === id);

/** Give a player a boost (once per boost). Returns false if already held. */
export function grantBoost(p: Player, id: string): boolean {
  if (hasBoost(p, id)) return false;
  const b = getBoost(id);
  p.boosts.push(b);
  p.boostState.dirty = true;
  if (b.effects.moxie) p.boostState.moxie = b.effects.moxie.start;
  return true;
}

const each = <K extends keyof BoostEffects>(p: Player, k: K): NonNullable<BoostEffects[K]>[] =>
  p.boosts.map((b) => b.effects[k]).filter((x): x is NonNullable<BoostEffects[K]> => x !== undefined);
const sum = (p: Player, k: 'sizePct' | 'powerAdd' | 'maxStaggerAdd' | 'speedPct' | 'cooldownRate' | 'dashHastePct' | 'projectileRangePct' | 'creationDurationPct' | 'creationSizePct' | 'primaryCooldownPct'): number =>
  p.boosts.reduce((s, b) => s + (b.effects[k] ?? 0), 0);

/** Sparks held. */
const sparks = (p: Player) => p.boosts.filter((b) => b.effects.spark).length;
function sparkStat(p: Player, stat: 'power' | 'speed' | 'cooldownRate'): number {
  const n = sparks(p);
  return each(p, 'spark')
    .filter((s) => s.stat === stat)
    .reduce((t, s) => t + s.base + s.perSpark * (n - 1), 0);
}

export interface BoostStatics {
  sizePct: number;
  power: number;
  bonusStagger: number;
  speedPct: number;
  cooldownRate: number;
}
const NO_STATICS: BoostStatics = { sizePct: 0, power: 0, bonusStagger: 0, speedPct: 0, cooldownRate: 0 };
/** Cache: recomputed only when the boosts or max Stagger change (hot path: speed, casts). */
const staticsCache = new WeakMap<Player, { n: number; maxStagger: number; v: BoostStatics }>();

/** Static boost bonuses (no per-tick state). */
export function boostStatics(p: Player): BoostStatics {
  if (!p.boosts.length) return NO_STATICS;
  const c = staticsCache.get(p);
  if (c && c.n === p.boosts.length && c.maxStagger === p.maxStagger) return c.v;
  const v = computeStatics(p);
  staticsCache.set(p, { n: p.boosts.length, maxStagger: p.maxStagger, v });
  return v;
}

function computeStatics(p: Player): BoostStatics {
  const sizePct = sum(p, 'sizePct');
  const bonusStagger = sum(p, 'maxStaggerAdd');
  let power = sum(p, 'powerAdd') + sparkStat(p, 'power');
  for (const e of p.boosts) {
    if (e.effects.powerPerSizePct) power += e.effects.powerPerSizePct * sizePct;
    if (e.effects.powerPer100Stagger) power += (e.effects.powerPer100Stagger * p.maxStagger) / 100;
  }
  return { sizePct, power, bonusStagger, speedPct: sum(p, 'speedPct') + sparkStat(p, 'speed'), cooldownRate: sum(p, 'cooldownRate') + sparkStat(p, 'cooldownRate') };
}

/** Per-tick dynamic boosts. Returns true when Power changed (body needs a refresh). */
export function stepBoosts(world: World, p: Player): boolean {
  if (!p.boosts.length) return false;
  const s = p.boostState;
  const before = s.power * 1000 + (s.edgeZero ? 1 : 0);
  s.unhit++;
  let power = 0;
  let speed = 0;
  let cdr = 0;
  for (const g of each(p, 'guts')) {
    const missing = p.staggered ? 1 : 1 - p.stagger / Math.max(1, p.maxStagger);
    power += g.powerMax * missing;
    cdr += g.cooldownRateMax * missing;
  }
  for (const sb of each(p, 'speedBoost')) {
    const stacks = Math.min(sb.maxStacks, Math.floor(s.unhit / ticks(sb.every)));
    power += sb.power * stacks;
    speed += sb.speedPct * stacks;
  }
  for (const m of each(p, 'moxie')) power += m.power * s.moxie;
  s.edgeZero = false;
  for (const e of each(p, 'edge')) {
    if (edgeDistance(world, p.pos) <= e.range) {
      speed += e.speedPct;
      s.edgeZero = true;
    }
  }
  s.power = power;
  s.speedPct = speed;
  s.cooldownRate = cdr;
  const dirty = s.dirty;
  s.dirty = false;
  return dirty || before !== s.power * 1000 + (s.edgeZero ? 1 : 0);
}

/** Distance from `pos` to the players' KO outline. */
export function edgeDistance(world: World, pos: Vec2): number {
  let best = Infinity;
  for (const w of world.stage.playerWalls) {
    const ex = w.bx - w.ax;
    const ey = w.by - w.ay;
    const l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((pos.x - w.ax) * ex + (pos.y - w.ay) * ey) / l2));
    const dx = w.ax + ex * t - pos.x;
    const dy = w.ay + ey * t - pos.y;
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
  }
  return best;
}

/** Range / haste / cooldown modifiers from boosts. */
export const boostDashHaste = (p: Player) => sum(p, 'dashHastePct');
export const boostProjectileRange = (p: Player) => sum(p, 'projectileRangePct');
export const boostPrimaryCooldown = (p: Player) => sum(p, 'primaryCooldownPct');
export const boostCreations = (p: Player) => ({ duration: sum(p, 'creationDurationPct'), size: sum(p, 'creationSizePct') });

/**
 * Multiplier for a move's hit: `core` = on the ball. `special`: from the special slot; `projectile`:
 * a projectile hit; `dist`: distance from the caster to what was hit.
 */
export function boostHitMul(p: Player, core: boolean, special: boolean, projectile: boolean, dist: number): number {
  if (!p.boosts.length) return 1;
  let pct = 0;
  const k = core ? 'core' : 'players';
  for (const h of each(p, 'moveHit')) pct += h[k];
  if (special) for (const h of each(p, 'specialHit')) pct += h[k];
  if (projectile) for (const h of each(p, 'projectileHit')) pct += h[k];
  for (const h of each(p, 'longRangeHit')) if (dist >= h.range) pct += h[k];
  return 1 + pct / 100;
}

/** After a hit on an enemy: burn (no heal), Leftovers; the target's Speed Boost resets. */
export function boostOnHit(world: World, attacker: Player | undefined, target: Player, light: boolean): void {
  target.boostState.unhit = 0;
  if (!attacker || !attacker.boosts.length) return;
  for (const b of each(attacker, 'burn')) {
    const n = ticks(b.duration);
    const total = target.maxStagger * (light ? b.lightPct : b.pct);
    target.poisons = target.poisons.filter((po) => !(po.by === attacker.id && po.heal === 0));
    target.poisons.push({ by: attacker.id, ticks: n, perTick: total / n, heal: 0 });
  }
  for (const l of each(attacker, 'leftovers')) {
    const heal = attacker.maxStagger * (light ? l.lightPct : l.pct);
    attacker.stagger = Math.min(attacker.maxStagger, attacker.stagger + heal);
    target.stagger = Math.max(0, target.stagger - heal * l.damageShare);
    if (target.stagger === 0 && !target.staggered) {
      target.staggered = true;
      world.events.push({ type: 'staggered', playerId: target.id, by: attacker.id });
    }
  }
}

/** Sturdy: the first KO each set is prevented; the player is put back inside, briefly immune. */
export function boostPreventKo(world: World, p: Player): boolean {
  if (p.boostState.sturdyUsed || !p.boosts.some((b) => b.effects.preventFirstKo)) return false;
  p.boostState.sturdyUsed = true;
  // Back toward the middle until well inside the outline.
  let pos = { ...p.pos };
  for (let i = 0; i < 40 && !pointInPolygon(pos, world.stage.playerOutline); i++) pos = { x: pos.x * 0.95, y: pos.y * 0.95 };
  pos = { x: pos.x * 0.9, y: pos.y * 0.9 };
  p.pos = pos;
  p.knockTicks = 0;
  p.knockVel = { x: 0, y: 0 };
  p.vel = { x: 0, y: 0 };
  p.immuneTicks = Math.max(p.immuneTicks, ticks(1));
  world.events.push({ type: 'sturdy', playerId: p.id, pos: { ...pos } });
  return true;
}

/** Moxie: the victim loses stacks, the credited attacker gains one. */
export function boostOnKo(victim: Player, by: Player | undefined): void {
  for (const m of each(victim, 'moxie')) victim.boostState.moxie = Math.max(0, victim.boostState.moxie - m.koLoss);
  if (by) for (const m of each(by, 'moxie')) by.boostState.moxie = Math.min(m.max, by.boostState.moxie + 1);
}

/** A new set starts: Sturdy recharges, Moxie back to its start, set XP mark. */
export function boostsNewSet(p: Player): void {
  p.boostState.sturdyUsed = false;
  for (const m of each(p, 'moxie')) p.boostState.moxie = m.start;
  p.boostState.setXpStart = p.xp;
}

/** Seconds → for tests/UI. */
export const boostTickRate = TICK_RATE;
export type { BoostDef };
