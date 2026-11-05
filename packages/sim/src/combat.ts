import { gameplay } from '@pokeathlon/data';
import { TICK_RATE, ticks } from './constants';
import { addXp } from './progression';
import { releaseBall } from './ball';
import { itemKnockbackDealt, itemOnHit } from './items';
import { buffDamageReduction, buffKnockbackResist, buffKnockbackTaken, refreshBody } from './moves';
import { inGoalArc } from './stage';
import type { Vec2 } from './vec';
import { isTargetable, type Player, type World } from './world';

const K = gameplay.knock;
const S = gameplay.stagger;
const E = gameplay.energy;
/** A KO counts as a takedown for whoever hit the player within this window. */
const TAKEDOWN_WINDOW = ticks(5);

export interface HitSpec {
  /** Unit direction of the knockback. */
  dir: Vec2;
  /** Player knockback (already scaled by Power). */
  knockback: number;
  /** Stagger damage (already scaled by Power). */
  damage: number;
  /** LIGHT hit: chip damage + brief slow, knockback only if the target is Staggered. */
  light?: boolean;
  /** Stun seconds (in addition to the knockback slide). */
  stun?: number;
  /** Banish seconds (replaces the knockback slide). */
  banish?: number;
  /** What caused the hit: a move id, `strike` or `burst` (telemetry). */
  source?: string;
}

/**
 * Apply an OS-style hit to a player. Returns false if the target couldn't be hit
 * (KO'd, elusive or immune).
 */
export function applyHit(world: World, attackerId: number, target: Player, hit: HitSpec): boolean {
  if (!isTargetable(target)) return false;
  const wasStaggered = target.staggered;

  const damage = hit.damage * (wasStaggered ? K.staggeredDamageTaken : 1) * (1 - buffDamageReduction(target));
  const attacker0 = world.players[attackerId];
  let knockback = (hit.light && !wasStaggered ? 0 : hit.knockback) * itemKnockbackDealt(attacker0);
  if (wasStaggered) knockback *= K.staggeredKnockbackMultiplier;
  else if (knockback > 0) {
    let resist = buffKnockbackResist(target);
    if (inGoalArc(world.stage, target.team, target.pos)) resist += K.goalArcResist;
    knockback = Math.max(0, knockback - resist);
  }
  knockback *= buffKnockbackTaken(target);

  // Stagger.
  target.stagger = Math.max(0, target.stagger - damage);
  target.regenDelay = ticks(wasStaggered ? S.staggeredRegenDelayOnHit : hit.light ? S.regenDelayLight : S.regenDelay);
  if (!wasStaggered && target.stagger === 0) {
    target.staggered = true;
    world.events.push({ type: 'staggered', playerId: target.id, by: attackerId });
  }
  // Guarded dash: breaks after taking enough damage.
  const guard = target.dash?.guard;
  if (guard && guard.breakAt > 0) {
    guard.taken += damage;
    if (guard.taken >= guard.breakAt * target.maxStagger) {
      target.dash = null;
      world.events.push({ type: 'guardBreak', playerId: target.id });
    }
  }
  itemOnHit(attacker0, target, damage, !!hit.light);
  // Any real hit makes a grabbing player drop the ball.
  if (world.ball.heldBy === target.id && (damage > 0 || knockback > 0 || hit.stun || hit.banish)) releaseBall(world, null, 0, 'drop');

  if (hit.light) target.slowTicks = Math.max(target.slowTicks, ticks(K.lightSlowTime));
  if (hit.banish) banish(world, target, attackerId, hit.banish);
  else if (knockback > 0) startKnock(target, hit.dir, knockback);
  if (hit.stun) target.stunTicks = Math.max(target.stunTicks, ticks(hit.stun));

  target.lastHitBy = attackerId;
  target.lastHitTick = world.tick;
  const attacker = world.players[attackerId];
  if (attacker) gainEnergy(attacker, hit.light ? E.lightHit : E.normalHit);

  world.events.push({
    type: 'hit',
    attacker: attackerId,
    target: target.id,
    knockback,
    damage,
    light: !!hit.light,
    pos: { ...target.pos },
    source: hit.source ?? 'other',
    staggered: wasStaggered,
  });
  return true;
}

/** Take a player out of play for `seconds`: frozen, untargetable, back in the same place. */
export function banish(world: World, p: Player, by: number, seconds: number): void {
  p.banishTicks = Math.max(p.banishTicks, ticks(seconds));
  p.knockTicks = 0;
  p.knockVel = { x: 0, y: 0 };
  p.vel = { x: 0, y: 0 };
  p.dash = null;
  p.cast = null;
  p.charging = null;
  p.channel = null;
  world.events.push({ type: 'banish', playerId: p.id, by });
}

/** Start a decelerating knockback slide that covers ~knockback × distancePerKnockback units. */
export function startKnock(p: Player, dir: Vec2, knockback: number): void {
  const dist = knockback * K.distancePerKnockback;
  const time = Math.min(K.maxTime, Math.max(K.minTime, K.minTime + dist * K.timePerUnit));
  const n = ticks(time);
  const v0 = (2 * dist) / time;
  p.knockVel = { x: dir.x * v0, y: dir.y * v0 };
  p.knockDecel = v0 / n;
  p.knockTicks = n;
  p.vel = { x: 0, y: 0 };
  p.dash = null; // knockback interrupts dashes
  p.cast = null;
  p.charging = null;
  p.channel = null;
}

export function gainEnergy(p: Player, amount: number): void {
  p.energy = Math.min(E.max, p.energy + amount);
}

/** Remove a player from the field (knocked past an edge). */
export function knockOut(world: World, p: Player): void {
  p.koTicks = ticks(world.match.overtime ? gameplay.respawn.overtimeTime : gameplay.respawn.time);
  p.knockTicks = 0;
  p.dash = null;
  p.cast = null;
  p.charging = null;
  p.channel = null;
  p.recast = null;
  p.banishTicks = 0;
  p.buffs = [];
  refreshBody(p);
  p.knockVel = { x: 0, y: 0 };
  p.vel = { x: 0, y: 0 };
  p.stunTicks = 0;
  p.slowTicks = 0;
  p.stats.deaths++;
  let by = -1;
  if (p.lastHitBy >= 0 && world.tick - p.lastHitTick <= TAKEDOWN_WINDOW) {
    const attacker = world.players[p.lastHitBy];
    if (attacker && attacker.team !== p.team) {
      by = attacker.id;
      attacker.stats.kos++;
      addXp(world, attacker, gameplay.xp.takedown);
    }
  }
  world.events.push({ type: 'ko', playerId: p.id, by, pos: { ...p.pos } });
}

/** Bring a KO'd player back at their team's respawn point. */
export function respawn(world: World, p: Player): void {
  const spots = world.stage.spawns[p.team].respawn;
  const at = spots[(p.slot + (p.role === 'goalie' ? 1 : 0)) % spots.length]!;
  p.pos = { ...at };
  p.vel = { x: 0, y: 0 };
  p.koTicks = 0;
  p.immuneTicks = ticks(gameplay.respawn.immune);
  p.energy = E.start;
  p.stagger = p.maxStagger;
  p.staggered = false;
  p.regenDelay = 0;
  world.events.push({ type: 'respawn', playerId: p.id, pos: { ...p.pos } });
}

/** Per-tick timers: cooldowns, statuses, Stagger regeneration, respawn countdown. */
export function stepCombatTimers(world: World, p: Player): void {
  if (p.koTicks > 0) {
    p.koTicks--;
    if (p.koTicks === 0) respawn(world, p);
    return;
  }
  if (p.stunTicks > 0) p.stunTicks--;
  if (p.slowTicks > 0) p.slowTicks--;
  if (p.elusiveTicks > 0) p.elusiveTicks--;
  if (p.immuneTicks > 0) p.immuneTicks--;
  if (p.evadeCooldown > 0) p.evadeCooldown--;
  if (p.burstBoostTicks > 0) p.burstBoostTicks--;
  if (p.banishTicks > 0 && --p.banishTicks === 0) world.events.push({ type: 'unbanish', playerId: p.id, pos: { ...p.pos } });
  let expired = false;
  for (let i = p.buffs.length - 1; i >= 0; i--) {
    if (--p.buffs[i]!.ticks <= 0) {
      p.buffs.splice(i, 1);
      expired = true;
    }
  }
  if (expired) refreshBody(p);

  if (p.regenDelay > 0) {
    p.regenDelay--;
    return;
  }
  if (p.staggered) {
    p.stagger = Math.min(p.maxStagger, p.stagger + (p.maxStagger * S.staggeredRegenPerSecond) / TICK_RATE);
    if (p.stagger >= p.maxStagger * S.recoverAt) {
      p.staggered = false;
      world.events.push({ type: 'recovered', playerId: p.id });
    }
  } else if (p.stagger < p.maxStagger) {
    p.stagger = Math.min(p.maxStagger, p.stagger + (p.maxStagger * S.regenPerSecond) / TICK_RATE);
  }
}
