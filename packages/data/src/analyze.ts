import { roster, getPokemon, SIZE_TABLE, type PokemonDef } from './index';
import { getKit, scaleAction, type KitPassive, type MoveAction, type MoveDef, type MoveHit } from './kits';
import { gameplay, getFrame, scaled } from './rules';
import { theoryTier, type Tier } from './tiers';

export * from './tiers';

/**
 * Static kit analyzer (M4.2): numbers worked out from the data alone, before any match is played.
 * Pure functions of (roster stats, kit JSON, gameplay rules). Used by `npm run kits`, the F3 debug
 * meter's kit card and, later, the balance report.
 *
 * Conventions:
 * - Distances in world units (a normal Pokémon's body radius is 46), times in seconds.
 * - "Per cast" values assume every part of the move lands on one target (best case).
 * - Reach is measured from the caster's centre to the furthest point a hit can still touch:
 *   a target whose hurtbox edge is inside the reach can be hit.
 * - Knockback is in OS units: a hit of K pushes a normal target K units; ×3.545 on a Staggered one.
 */

const KB = gameplay.knock;
/** Distance from the field centre line to the side KO edge (players' bounds). */
export const KO_EDGE_DISTANCE = getFrame('standard').playerBounds.sideY;

export interface HitNumbers {
  /** Stagger damage of one hit. */
  damage: number;
  /** Player knockback of one hit (0 for LIGHT hits on non-Staggered targets). */
  knockback: number;
  /** Knockback on a Staggered target (LIGHT hits knock back Staggered targets too). */
  staggeredKnockback: number;
  /** Ball knockback (speed it sets, capped at the Core cap). */
  ball: number;
  light: boolean;
  stun: number;
  ballStun: number;
  banish: number;
}

export interface MoveStats {
  id: string;
  name: string;
  slot: MoveDef['slot'] | 'strike' | 'burst' | 'passive';
  /** Action types in order, e.g. "projectile", "area+area". */
  kind: string;
  cooldown: number;
  /** Wind-up before anything happens. */
  castTime: number;
  /** From the button press until the last part of the move has finished (incl. travel). */
  duration: number;
  /** Seconds the caster can't walk freely (wind-up + dashes). */
  lockTime: number;
  /** Seconds from the press until the first hit can land at max reach. */
  timeToReach: number;
  reach: number;
  /** Area of one hit (units²): circle/cone/line footprint, or a projectile/dash/wall body. */
  hitArea: number;
  /** Area covered over the whole move (projectile corridor, dash path, every repeat counted once). */
  sweptArea: number;
  /** Hits that can land on one target in one cast. */
  hitsPerCast: number;
  damagePerCast: number;
  /** Damage per second of cooldown (damagePerCast / cooldown). */
  dps: number;
  /** Largest single player knockback, normal and on a Staggered target. */
  knockback: number;
  staggeredKnockback: number;
  /** Fraction of the centre-to-edge distance one hit pushes a Staggered target (≥ 1: KO from the centre line). */
  koReach: number;
  /** Biggest ball knockback (0 if it can't hit the ball). */
  ballPower: number;
  stun: number;
  ballStun: number;
  /** Extra distance travelled thanks to this move (dash length, speed-buff bonus). */
  mobility: number;
  /** Stagger healed (fraction of max) and damage reduction / knockback resist granted. */
  heal: number;
  shield: string;
  /** Banish seconds (removed from play). */
  banish: number;
  /** Seconds the ball can be held (grab). */
  ballControl: number;
  /** Charge-and-release: seconds to full charge (numbers above are at full charge) and the minimum multiplier. */
  chargeTime: number;
  chargeMin: number;
  /** Recast window (s), 0 = none. */
  recastWindow: number;
  /** Short notes on the M5.1 mechanics this move uses (charge, recast, sweet spot, side, grab...). */
  notes: string;
}

export interface FighterStats {
  id: string;
  name: string;
  archetype: PokemonDef['archetype'];
  size: PokemonDef['stats']['size'];
  power: number;
  speed: number;
  staggerL1: number;
  staggerL10: number;
  strike: MoveStats;
  burst: MoveStats;
  moves: MoveStats[];
  /** Strike-modifier passive (its cooldown is an estimated trigger period), or null. */
  passive: MoveStats | null;
  /** Σ move DPS (Strike doesn't hurt players). */
  kitDps: number;
  /** All three moves landing on one target. */
  comboDamage: number;
  /** Hits of the full combo needed to Stagger an average roster target at level 1. */
  combosToStagger: number;
  /** Ball knockback per second available: Strike + every ball-hitting move over its cooldown. */
  ballPressure: number;
  maxBallPower: number;
  /** Walking speed plus average bonus speed from dashes and buffs (units/s). */
  mobility: number;
  /** Seconds of stun (players) per second of cooldown. */
  control: number;
  maxKoReach: number;
  /** Seconds an average kit needs (DPS only) to empty this Pokémon's Stagger at level 1. */
  survivability: number;
  /** Provisional power budget (100 = roster average) and its parts; weights get fitted in M4.6. */
  budget: number;
  budgetParts: Record<BudgetPart, number>;
  /** Theory tier from the budget (B6). */
  theoryTier: Tier;
}

export type BudgetPart = 'offense' | 'koThreat' | 'ball' | 'mobility' | 'control' | 'survivability';
/** Provisional weights (sum 1). Replaced by the regression fit from batch sims (M4.6). */
export const BUDGET_WEIGHTS: Record<BudgetPart, number> = {
  offense: 0.2,
  koThreat: 0.15,
  ball: 0.25,
  mobility: 0.15,
  control: 0.1,
  survivability: 0.15,
};

/** A budget part can't exceed this (% of the roster average). */
export const BUDGET_PART_CAP = 200;

function hitNumbers(hit: MoveHit | undefined, power: number): HitNumbers {
  if (!hit) return { damage: 0, knockback: 0, staggeredKnockback: 0, ball: 0, light: false, stun: 0, ballStun: 0, banish: 0 };
  const kb = hit.player ? scaled(hit.player, power) : 0;
  return {
    damage: hit.damage ? scaled(hit.damage, power) : 0,
    knockback: hit.light ? 0 : kb,
    staggeredKnockback: kb * KB.staggeredKnockbackMultiplier,
    ball: hit.ball ? Math.min(scaled(hit.ball, power), gameplay.ball.knockbackCap) : 0,
    light: !!hit.light,
    stun: hit.stun ?? 0,
    ballStun: hit.ballStun ?? 0,
    banish: hit.banish ?? 0,
  };
}

/** Field-by-field best of two hits (sweet spots: best case). */
function bestHit(a: HitNumbers, b: HitNumbers): HitNumbers {
  return {
    damage: Math.max(a.damage, b.damage),
    knockback: Math.max(a.knockback, b.knockback),
    staggeredKnockback: Math.max(a.staggeredKnockback, b.staggeredKnockback),
    ball: Math.max(a.ball, b.ball),
    light: a.light && b.light,
    stun: Math.max(a.stun, b.stun),
    ballStun: Math.max(a.ballStun, b.ballStun),
    banish: Math.max(a.banish, b.banish),
  };
}

/** How far a decelerating projectile actually flies. */
function projectileRange(a: Extract<MoveAction, { type: 'projectile' }>): number {
  return a.decel > 0 ? Math.min(a.range, (a.speed * a.speed) / (2 * a.decel)) : a.range;
}
function projectileFlightTime(a: Extract<MoveAction, { type: 'projectile' }>, dist: number): number {
  if (a.decel <= 0) return dist / a.speed;
  // dist = v t − ½ a t²  →  t = (v − √(v² − 2 a d)) / a
  const disc = Math.max(0, a.speed * a.speed - 2 * a.decel * dist);
  return (a.speed - Math.sqrt(disc)) / a.decel;
}

interface ActionStats {
  start: number;
  end: number;
  lock: number;
  reach: number;
  timeToReach: number;
  hitArea: number;
  sweptArea: number;
  hits: number;
  hit: HitNumbers;
  hitsBall: boolean;
  mobility: number;
  heal: number;
  shield: string[];
  ballControl: number;
  notes: string[];
}

function actionStats(raw: MoveAction, def: MoveDef, p: PokemonDef, offset = 0): ActionStats {
  const body = SIZE_TABLE[p.stats.size].radius;
  // Side conditions: numbers at the better side (best case), noted.
  const sideK = raw.side ? Math.max(raw.side.own, raw.side.enemy) : 1;
  const a = sideK !== 1 ? scaleAction(raw, sideK, 1, sideK) : raw;
  const start = def.castTime + (def.charge?.time ?? 0) + offset + a.delay;
  const base: ActionStats = {
    start,
    end: start,
    lock: 0,
    reach: 0,
    timeToReach: start,
    hitArea: 0,
    sweptArea: 0,
    hits: 0,
    hit: hitNumbers('hit' in a ? a.hit : undefined, p.stats.power),
    hitsBall: false,
    mobility: 0,
    heal: 0,
    shield: [],
    ballControl: 0,
    notes: [],
  };
  if (raw.side) base.notes.push(`own half ×${raw.side.own}, enemy half ×${raw.side.enemy}`);
  if (a.telegraph && a.delay > 0) base.notes.push(`telegraphed ${a.delay} s`);
  switch (a.type) {
    case 'projectile': {
      const range = projectileRange(a);
      const streamed = a.count > 1 && a.interval > 0;
      const last = streamed ? a.interval * (a.count - 1) : 0;
      base.reach = body + range + a.radius;
      base.timeToReach = start + projectileFlightTime(a, range);
      base.end = start + last + projectileFlightTime(a, range);
      base.hitArea = Math.PI * a.radius * a.radius;
      base.sweptArea = (2 * a.radius * range + base.hitArea) * (a.spreadDeg > 0 ? a.count : 1);
      base.hits = streamed ? a.count : 1; // a fan hits one target with one shot
      base.hitsBall = a.hitsBall && (!!a.hit.ball || !!a.hit.ballStun);
      break;
    }
    case 'area': {
      const reachFromCentre = a.shape === 'line' ? a.length : a.radius;
      const centreDist = a.at === 'target' ? def.range : a.offset;
      base.reach = centreDist + reachFromCentre;
      base.end = start + a.repeatInterval * (a.repeat - 1);
      base.hitArea =
        a.shape === 'circle' ? Math.PI * a.radius * a.radius : a.shape === 'cone' ? (Math.PI * a.radius * a.radius * a.angleDeg) / 360 : a.length * a.width;
      base.sweptArea = base.hitArea;
      base.hits = a.hit || a.sweetSpot ? a.repeat : 0;
      base.hitsBall = a.hitsBall && ((!!a.hit && (!!a.hit.ball || !!a.hit.ballStun)) || (!!a.sweetSpot && (!!a.sweetSpot.hit.ball || !!a.sweetSpot.hit.ballStun)));
      base.heal = a.allyHealPct;
      if (a.sweetSpot) {
        base.hit = bestHit(base.hit, hitNumbers(a.sweetSpot.hit, p.stats.power));
        base.notes.push(`sweet spot ${Math.round(a.sweetSpot.from * 100)}–${Math.round(a.sweetSpot.to * 100)} %${a.sweetSpot.angleDeg ? ` ${a.sweetSpot.angleDeg}°` : ''}`);
      }
      break;
    }
    case 'dash': {
      base.reach = a.distance + body;
      base.timeToReach = start + a.time;
      base.end = start + a.time;
      base.lock = a.castWhileDashing ? 0 : a.time;
      base.hitArea = Math.PI * body * body;
      base.sweptArea = 2 * body * a.distance + base.hitArea;
      base.hits = a.hit ? 1 : 0;
      base.hitsBall = !!a.hit && (!!a.hit.ball || !!a.hit.ballStun);
      base.mobility = a.distance;
      if (a.knockbackResist > 0) base.shield.push(`+${a.knockbackResist} kb resist (dash)`);
      if (a.damageReduction > 0) base.shield.push(`-${Math.round(a.damageReduction * 100)}% dmg (dash)`);
      if (a.breakOnDamage > 0) base.notes.push(`breaks at ${Math.round(a.breakOnDamage * 100)} % Stagger taken`);
      break;
    }
    case 'buff': {
      base.reach = a.target === 'allies' ? a.radius : 0;
      base.end = start + a.duration;
      // A decaying buff averages half its bonus over the duration.
      base.mobility = (p.stats.speed * a.speedPct * a.duration * (a.decays ? 0.5 : 1)) / 100;
      base.heal = a.healPct;
      if (a.damageReduction > 0) base.shield.push(`-${Math.round(a.damageReduction * 100)}% dmg ${a.duration}s`);
      if (a.knockbackResist > 0) base.shield.push(`+${a.knockbackResist} kb resist ${a.duration}s`);
      if (a.sizePct) base.notes.push(`size ${a.sizePct > 0 ? '+' : ''}${a.sizePct} %`);
      if (a.powerAdd) base.notes.push(`power ${a.powerAdd > 0 ? '+' : ''}${a.powerAdd}`);
      if (a.knockbackTakenPct) base.notes.push(`kb taken ${a.knockbackTakenPct > 0 ? '+' : ''}${a.knockbackTakenPct} %`);
      if (a.strikeHit) {
        // Best case: every Strike during the buff lands on one target.
        const k = 1 + a.sizePct / 100;
        base.hit = hitNumbers(a.strikeHit, p.stats.power + a.powerAdd);
        base.hits = Math.max(1, Math.floor(a.duration / gameplay.strike.cooldown));
        base.reach = (SIZE_TABLE[p.stats.size].strikeWidth / 2) * k;
        base.timeToReach = start;
        base.hitArea = Math.PI * base.reach * base.reach;
        base.sweptArea = base.hitArea;
        base.notes.push('Strike hits players');
      }
      break;
    }
    case 'wall': {
      const far = a.distance + a.thickness / 2;
      base.reach = Math.sqrt(far * far + (a.length / 2) * (a.length / 2));
      base.end = start + a.duration;
      base.hitArea = a.length * a.thickness;
      base.sweptArea = base.hitArea * a.count;
      base.hits = a.hit ? 1 : 0;
      base.hitsBall = !!a.hit && (!!a.hit.ball || !!a.hit.ballStun);
      base.shield.push(`${a.count} wall${a.count > 1 ? 's' : ''} ${a.duration}s`);
      break;
    }
    case 'channel': {
      const pulses = Math.max(1, Math.ceil(a.duration / a.interval - 1e-9));
      base.reach = a.shape === 'line' ? a.length : a.radius;
      base.end = start + a.duration;
      base.hitArea = a.shape === 'cone' ? (Math.PI * a.radius * a.radius * a.angleDeg) / 360 : a.length * a.width;
      base.sweptArea = base.hitArea;
      base.hits = pulses;
      base.hitsBall = a.hitsBall && (!!a.hit.ball || !!a.hit.ballStun);
      base.notes.push(`channel ${a.duration} s, ${pulses} pulses, slowed ${a.slowPct} %`);
      break;
    }
    case 'blink': {
      base.reach = a.distance + body;
      base.timeToReach = start;
      base.end = start;
      base.hitArea = Math.PI * body * body;
      base.sweptArea = 2 * body * a.distance + base.hitArea;
      base.hits = a.hit ? 1 : 0;
      base.hitsBall = !!a.hit && (!!a.hit.ball || !!a.hit.ballStun);
      base.mobility = a.to === 'aim' ? a.distance : 0;
      base.notes.push(a.to === 'ally' ? (a.swap ? 'swap with ally' : 'blink to ally') : a.to === 'mark' ? 'blink back' : 'blink');
      break;
    }
    case 'grab': {
      base.reach = a.radius + gameplay.ball.radius;
      base.end = start + a.hold;
      base.hitArea = Math.PI * a.radius * a.radius;
      base.sweptArea = base.hitArea;
      base.ballControl = a.hold;
      if (a.throw) {
        base.hit = { ...base.hit, ball: Math.min(scaled(a.throw, p.stats.power), gameplay.ball.knockbackCap) };
        base.hitsBall = true;
      }
      base.notes.push(`grab ball ${a.hold} s (slowed ${a.slowPct} %)`);
      break;
    }
    case 'throw': {
      base.hit = { ...base.hit, ball: Math.min(scaled(a.ball, p.stats.power), gameplay.ball.knockbackCap) };
      base.hitsBall = true;
      break;
    }
    case 'guardian': {
      const pulses = 1 + Math.floor(a.duration / a.interval + 1e-9);
      base.reach = (a.at === 'target' ? def.range : 0) + a.radius;
      base.end = start + a.duration;
      base.hitArea = Math.PI * a.radius * a.radius;
      base.sweptArea = base.hitArea;
      base.heal = a.healPct * pulses;
      if (a.rescueHealPct > 0) base.shield.push(`KO rescue ${a.duration}s (${Math.round(a.rescueHealPct * 100)} %)`);
      base.notes.push(`guardian ${a.duration} s, heals ${Math.round(a.healPct * 100)} % × ${pulses}`);
      break;
    }
  }
  return base;
}

/**
 * A projectile's follow-up (Hyperspace Hole): its actions start when the projectile stops, best case
 * at full range; a `target` area lands there and a `mark` blink travels there.
 */
function onEndParts(def: MoveDef, p: PokemonDef): ActionStats[] {
  return def.actions.flatMap((a) => {
    if (a.type !== 'projectile' || !a.onEnd) return [];
    const range = projectileRange(a);
    const at = { ...def, range };
    const offset = a.delay + projectileFlightTime(a, range);
    return a.onEnd.map((f) => {
      const s = actionStats(f, at, p, offset);
      if (f.type === 'blink' && f.to === 'mark') {
        s.mobility = range;
        s.reach = range;
        s.notes = s.notes.map((n) => (n === 'blink back' ? 'blink to the projectile' : n));
      }
      return s;
    });
  });
}

export function analyzeMove(def: MoveDef, p: PokemonDef): MoveStats {
  const first = def.actions.map((a) => actionStats(a, def, p));
  // Recast actions count as part of the move, after the first cast has played out.
  const after = Math.max(...first.map((a) => a.end)) - def.castTime - (def.charge?.time ?? 0);
  const parts = [...first, ...(def.recast?.actions ?? []).map((a) => actionStats(a, def, p, after)), ...onEndParts(def, p)];
  const notes = parts.flatMap((a) => a.notes);
  if (def.charge) notes.unshift(`charge ${def.charge.time} s (min ${Math.round(def.charge.min * 100)} %)`);
  if (def.recast) notes.push(`recast ${def.recast.window} s`);
  const hitting = parts.filter((s) => s.hits > 0);
  const damagePerCast = parts.reduce((s, a) => s + a.hits * a.hit.damage, 0);
  const knockback = Math.max(0, ...parts.map((a) => a.hit.knockback));
  const staggeredKnockback = Math.max(0, ...parts.map((a) => (a.hits > 0 ? a.hit.staggeredKnockback : 0)));
  return {
    id: def.id,
    name: def.name,
    slot: def.slot,
    kind: def.actions.map((a) => a.type).join('+') + (def.recast ? ` / ${def.recast.actions.map((a) => a.type).join('+')}` : ''),
    cooldown: def.cooldown,
    castTime: def.castTime,
    duration: Math.max(...parts.map((a) => a.end)),
    lockTime: def.castTime + parts.reduce((s, a) => s + a.lock, 0),
    timeToReach: hitting.length ? Math.min(...hitting.map((a) => a.timeToReach)) : 0,
    reach: Math.max(...parts.map((a) => a.reach)),
    hitArea: Math.max(0, ...parts.map((a) => a.hitArea)),
    sweptArea: parts.reduce((s, a) => s + a.sweptArea, 0),
    hitsPerCast: parts.reduce((s, a) => s + a.hits, 0),
    damagePerCast,
    dps: damagePerCast / def.cooldown,
    knockback,
    staggeredKnockback,
    koReach: staggeredKnockback / KO_EDGE_DISTANCE,
    ballPower: Math.max(0, ...parts.map((a) => (a.hitsBall ? a.hit.ball : 0))),
    stun: Math.max(0, ...parts.map((a) => (a.hits > 0 ? a.hit.stun : 0))),
    ballStun: Math.max(0, ...parts.map((a) => (a.hitsBall ? a.hit.ballStun : 0))),
    mobility: parts.reduce((s, a) => s + a.mobility, 0),
    heal: parts.reduce((s, a) => s + a.heal, 0),
    shield: parts.flatMap((a) => a.shield).join(', '),
    banish: Math.max(0, ...parts.map((a) => (a.hits > 0 ? a.hit.banish : 0))),
    ballControl: Math.max(0, ...parts.map((a) => a.ballControl)),
    chargeTime: def.charge?.time ?? 0,
    chargeMin: def.charge?.min ?? 0,
    recastWindow: def.recast?.window ?? 0,
    notes: [...new Set(notes)].join(', '),
  };
}

/**
 * Estimated seconds between passive triggers: stacks × a typical gap between stack events
 * (a Strike on the ball every ~2.5 s, a move hit every ~6 s). A heuristic for the budget only.
 */
export function passivePeriod(passive: KitPassive): number {
  return passive.stacks * (passive.gainOn === 'strikeBall' ? 2.5 : 6);
}

/** The kit's Strike-modifier passive as a pseudo-move. */
export function analyzePassive(passive: KitPassive, p: PokemonDef): MoveStats {
  const def: MoveDef = {
    id: 'passive',
    name: passive.name,
    slot: 'primary',
    cooldown: passivePeriod(passive),
    castTime: 0,
    range: 0,
    anim: 'Attack',
    desc: passive.desc,
    bot: 'ballShot',
    actions: passive.actions,
  };
  const m = analyzeMove(def, p);
  return { ...m, slot: 'passive', notes: [`${passive.stacks} stacks on ${passive.gainOn === 'moveHit' ? 'move hits' : 'Strikes on the ball'}`, m.notes].filter(Boolean).join(', ') };
}

/** The shared Strike: ball only, reach = Strike radius + the ball's radius. */
export function analyzeStrike(p: PokemonDef): MoveStats {
  const s = gameplay.strike;
  const reach = SIZE_TABLE[p.stats.size].strikeWidth / 2 + gameplay.ball.radius * s.reachBallFraction;
  const area = Math.PI * (SIZE_TABLE[p.stats.size].strikeWidth / 2) ** 2;
  return {
    ...emptyMove('strike', 'Strike', 'strike', 'strike'),
    cooldown: s.cooldown,
    duration: s.activeTime,
    timeToReach: 0,
    reach,
    hitArea: area,
    sweptArea: area,
    ballPower: Math.min(scaled(s.ballKnockback, p.stats.power), gameplay.ball.knockbackCap),
  };
}

/** Energy Burst (costs a full Energy bar rather than a cooldown; `cooldown` is 0). */
export function analyzeBurst(p: PokemonDef): MoveStats {
  const b = gameplay.burst;
  const kb = scaled(b.playerKnockback, p.stats.power);
  const dmg = scaled(b.damage, p.stats.power);
  const area = Math.PI * b.radius * b.radius;
  return {
    ...emptyMove('burst', 'Energy Burst', 'burst', 'burst'),
    duration: b.elusive,
    reach: b.radius,
    hitArea: area,
    sweptArea: area,
    hitsPerCast: 1,
    damagePerCast: dmg,
    knockback: kb,
    staggeredKnockback: kb * KB.staggeredKnockbackMultiplier,
    koReach: (kb * KB.staggeredKnockbackMultiplier) / KO_EDGE_DISTANCE,
    stun: b.stun,
  };
}

function emptyMove(id: string, name: string, slot: MoveStats['slot'], kind: string): MoveStats {
  return {
    id,
    name,
    slot,
    kind,
    cooldown: 0,
    castTime: 0,
    duration: 0,
    lockTime: 0,
    timeToReach: 0,
    reach: 0,
    hitArea: 0,
    sweptArea: 0,
    hitsPerCast: 0,
    damagePerCast: 0,
    dps: 0,
    knockback: 0,
    staggeredKnockback: 0,
    koReach: 0,
    ballPower: 0,
    stun: 0,
    ballStun: 0,
    mobility: 0,
    heal: 0,
    shield: '',
    banish: 0,
    ballControl: 0,
    chargeTime: 0,
    chargeMin: 0,
    recastWindow: 0,
    notes: '',
  };
}

const staggerAt = (p: PokemonDef, level: number) => p.stats.stagger + (p.stats.staggerGrowth * (level - 1)) / 9;

/** Raw per-fighter numbers (no roster-relative parts yet). */
function analyzeFighterRaw(p: PokemonDef): Omit<FighterStats, 'combosToStagger' | 'survivability' | 'budget' | 'budgetParts' | 'theoryTier'> {
  const kit = getKit(p.id);
  const moves = kit ? (['primary', 'secondary', 'special'] as const).map((slot) => analyzeMove(kit.moves.find((m) => m.slot === slot)!, p)) : [];
  const strike = analyzeStrike(p);
  const passive = kit?.passive ? analyzePassive(kit.passive, p) : null;
  const all = [strike, ...moves, ...(passive ? [passive] : [])];
  const fighting = [...moves, ...(passive ? [passive] : [])];
  return {
    id: p.id,
    name: p.name,
    archetype: p.archetype,
    size: p.stats.size,
    power: p.stats.power,
    speed: p.stats.speed,
    staggerL1: staggerAt(p, 1),
    staggerL10: staggerAt(p, 10),
    strike,
    burst: analyzeBurst(p),
    moves,
    passive,
    kitDps: fighting.reduce((s, m) => s + m.dps, 0),
    comboDamage: moves.reduce((s, m) => s + m.damagePerCast, 0),
    ballPressure: all.reduce((s, m) => s + (m.ballPower > 0 ? m.ballPower / m.cooldown : 0), 0),
    maxBallPower: Math.max(...all.map((m) => m.ballPower)),
    mobility: p.stats.speed + moves.reduce((s, m) => s + m.mobility / m.cooldown, 0),
    // Banish removes a player from play (≈ a stun); a grab is ball control like a ball stun.
    control: fighting.reduce((s, m) => s + (m.stun + m.banish + (m.ballStun + m.ballControl) * 0.5) / m.cooldown, 0),
    maxKoReach: Math.max(0, ...fighting.map((m) => m.koReach)),
  };
}

/**
 * Analyze Pokémon (default: every roster entry with a kit). Roster-relative values
 * (survivability, budget) compare against the analyzed set.
 */
export function analyzeRoster(ids?: string[]): FighterStats[] {
  const defs = (ids ?? roster.filter((r) => getKit(r.id)).map((r) => r.id)).map(getPokemon);
  const raw = defs.map(analyzeFighterRaw);
  const mean = (f: (r: (typeof raw)[number]) => number) => raw.reduce((s, r) => s + f(r), 0) / raw.length;
  const avgDps = mean((r) => r.kitDps);
  const avgStagger = mean((r) => r.staggerL1);
  const surv = (r: (typeof raw)[number]) => {
    // Bigger bodies are easier to hit: scale effective HP by the normal hurtbox / this hurtbox.
    const hurt = SIZE_TABLE[r.size].hurtRadius / SIZE_TABLE.normal.hurtRadius;
    return r.staggerL1 / hurt / Math.max(1e-9, avgDps);
  };
  const partOf: Record<BudgetPart, (r: (typeof raw)[number]) => number> = {
    offense: (r) => r.kitDps,
    koThreat: (r) => r.maxKoReach,
    ball: (r) => r.ballPressure,
    mobility: (r) => r.mobility,
    control: (r) => r.control,
    survivability: surv,
  };
  const means = Object.fromEntries((Object.keys(partOf) as BudgetPart[]).map((k) => [k, mean(partOf[k])])) as Record<BudgetPart, number>;
  return raw.map((r) => {
    const budgetParts = Object.fromEntries(
      // Capped at 2× the average so one unique trait (e.g. the only stun in the roster) can't dominate.
      (Object.keys(partOf) as BudgetPart[]).map((k) => [k, means[k] > 0 ? Math.min(BUDGET_PART_CAP, (100 * partOf[k](r)) / means[k]) : 100]),
    ) as Record<BudgetPart, number>;
    const budget = (Object.keys(BUDGET_WEIGHTS) as BudgetPart[]).reduce((s, k) => s + BUDGET_WEIGHTS[k] * budgetParts[k], 0);
    return {
      ...r,
      combosToStagger: r.comboDamage > 0 ? avgStagger / r.comboDamage : Infinity,
      survivability: surv(r),
      budget,
      budgetParts,
      theoryTier: theoryTier(budget),
    };
  });
}
