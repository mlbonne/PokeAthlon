import { getItem, type ItemDef } from '@pokeathlon/data';
import { TICK_RATE, ticks } from './constants';
import { onOwnHalf } from './stage';
import type { Vec2 } from './vec';
import type { Player, World } from './world';

/**
 * Held items (M5.5, OS Gear). Every effect is a generic hook driven by the item's numbers in
 * data/items/items.json:
 * - per tick (`stepItems`): on/off (goalie items only work on your own half), momentum speed,
 *   speed while ahead, midfield crossing, poison ticks, timers;
 * - on hits (`itemOnHit`, from applyHit): knockback dealt, lifesteal, poison, momentum reset;
 * - on Strike (`itemOnBallStrike`, `strikeShotReady`), on casts (secondary cooldown, blink back),
 *   and as stats (size, power, damage reduction, dash / projectile range, haste).
 */

export interface Poison {
  by: number;
  ticks: number;
  perTick: number;
  /** Stagger the poisoner heals per tick. */
  heal: number;
}

export interface ItemState {
  /** Ticks of momentum built (Quick Claw). */
  momentum: number;
  /** Ticks until the Strike shot is ready again (Zoom Lens). */
  strikeShotCd: number;
  /** Open blink-back window after a secondary (Eject Pack). */
  blinkBack: { ticks: number; mark: Vec2 } | null;
  /** x last tick (midfield crossing). */
  lastX: number;
}

export const newItemState = (x: number): ItemState => ({ momentum: 0, strikeShotCd: 0, blinkBack: null, lastX: x });

/** Resolve a spawn's item id, enforcing the role lock. */
export function itemForSpawn(id: string | undefined, role: 'forward' | 'goalie'): ItemDef | null {
  if (!id) return null;
  const it = getItem(id);
  if (it.slot !== role) throw new Error(`Item ${id} is a ${it.slot} item and can't be held by a ${role}`);
  return it;
}

/** Is the player's item working right now? Goalie items stop on the enemy half (OS rule). */
export function itemWorks(world: World, p: Player): boolean {
  if (!p.item) return false;
  return p.item.slot === 'forward' || onOwnHalf(world.stage, p.team, p.pos);
}

/** Effects of the player's item if it is on, else null. */
export const fx = (p: Player) => (p.item && p.itemActive ? p.item.effects : null);

const onField = (world: World, team: number) => world.players.filter((o) => o.team === team && o.koTicks === 0).length;

/** Add (refresh) a short speed buff from the item. */
function itemSpeedBuff(p: Player, pct: number, seconds: number): void {
  const id = `item:${p.item!.id}`;
  p.buffs = p.buffs.filter((b) => b.moveId !== id);
  const n = ticks(seconds);
  p.buffs.push({
    moveId: id,
    ticks: n,
    total: n,
    speedPct: pct,
    decays: false,
    knockbackResist: 0,
    damageReduction: 0,
    sizePct: 0,
    powerAdd: 0,
    knockbackTakenPct: 0,
    strikeHit: null,
    refreshOnHit: false,
    cooldownAfter: false,
  });
}

/** Per tick, after combat timers. Returns true if the item switched on or off (body stats change). */
export function stepItems(world: World, p: Player): boolean {
  // Poison ticks on this player.
  for (let i = p.poisons.length - 1; i >= 0; i--) {
    const po = p.poisons[i]!;
    if (p.koTicks > 0) {
      p.poisons.splice(i, 1);
      continue;
    }
    p.stagger = Math.max(0, p.stagger - po.perTick);
    const by = world.players[po.by];
    if (by && by.koTicks === 0) by.stagger = Math.min(by.maxStagger, by.stagger + po.heal);
    if (p.stagger === 0 && !p.staggered) {
      p.staggered = true;
      world.events.push({ type: 'staggered', playerId: p.id, by: po.by });
    }
    if (--po.ticks <= 0) p.poisons.splice(i, 1);
  }

  const s = p.itemState;
  if (s.strikeShotCd > 0) s.strikeShotCd--;
  if (s.blinkBack && --s.blinkBack.ticks <= 0) s.blinkBack = null;
  if (!p.item || p.koTicks > 0) {
    p.itemSpeedPct = 0;
    s.lastX = p.pos.x;
    return false;
  }
  const was = p.itemActive;
  p.itemActive = itemWorks(world, p);
  const e = p.itemActive ? p.item.effects : null;

  let speed = 0;
  if (e?.momentum) {
    if (onOwnHalf(world.stage, p.team, p.pos)) s.momentum++;
    speed += e.momentum.basePct + Math.min(e.momentum.maxPct, (e.momentum.perSecondPct * s.momentum) / TICK_RATE);
  }
  if (e?.speedWhenAheadPct && onField(world, p.team) > onField(world, p.team === 0 ? 1 : 0)) speed += e.speedWhenAheadPct;
  p.itemSpeedPct = speed;

  // Midfield crossing on foot or dashing (a blink jumps further than this in one tick).
  if (e?.speedOnMidfield && s.lastX * p.pos.x < 0 && Math.abs(p.pos.x - s.lastX) < 120) {
    itemSpeedBuff(p, e.speedOnMidfield.pct, e.speedOnMidfield.duration);
  }
  s.lastX = p.pos.x;
  return was !== p.itemActive;
}

/** A Strike hit the ball. */
export function itemOnBallStrike(p: Player): void {
  const e = fx(p);
  if (e?.speedOnBallStrike) itemSpeedBuff(p, e.speedOnBallStrike.pct, e.speedOnBallStrike.duration);
}

/** Zoom Lens: is a Strike shot ready? (Spends it.) */
export function takeStrikeShot(p: Player): boolean {
  const e = fx(p);
  if (!e?.strikeShot || p.itemState.strikeShotCd > 0) return false;
  p.itemState.strikeShotCd = ticks(e.strikeShot.interval);
  return true;
}

/** Attacker's knockback multiplier from items. */
export function itemKnockbackDealt(attacker: Player | undefined): number {
  const e = attacker ? fx(attacker) : null;
  return e?.knockbackDealtPct ? 1 + e.knockbackDealtPct / 100 : 1;
}

/** After a hit landed: lifesteal, poison, momentum reset. `source` 'poison' never re-poisons. */
export function itemOnHit(attacker: Player | undefined, target: Player, damage: number, light: boolean): void {
  // Getting hit resets momentum (Quick Claw), active or not.
  target.itemState.momentum = 0;
  const e = attacker ? fx(attacker) : null;
  if (!attacker || !e) return;
  if (e.lifesteal && damage > 0) attacker.stagger = Math.min(attacker.maxStagger, attacker.stagger + damage * e.lifesteal);
  if (e.poison) {
    const n = ticks(e.poison.duration);
    const total = target.maxStagger * (light ? e.poison.lightPct : e.poison.pct);
    target.poisons = target.poisons.filter((po) => po.by !== attacker.id); // refresh, don't stack
    target.poisons.push({ by: attacker.id, ticks: n, perTick: total / n, heal: (total * e.poison.heal) / n });
  }
}

/** Speed buffs from moves are stronger with haste (Eject Pack). */
export const itemHaste = (p: Player): number => {
  const e = fx(p);
  return e?.hastePct ? 1 + e.hastePct / 100 : 1;
};
