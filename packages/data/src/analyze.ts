import { roster, getPokemon, SIZE_TABLE, type PokemonDef } from './index';
import { getKit, type MoveAction, type MoveDef, type MoveHit } from './kits';
import { gameplay, getFrame, scaled } from './rules';

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
}

export interface MoveStats {
  id: string;
  name: string;
  slot: MoveDef['slot'] | 'strike' | 'burst';
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
  if (!hit) return { damage: 0, knockback: 0, staggeredKnockback: 0, ball: 0, light: false, stun: 0, ballStun: 0 };
  const kb = hit.player ? scaled(hit.player, power) : 0;
  return {
    damage: hit.damage ? scaled(hit.damage, power) : 0,
    knockback: hit.light ? 0 : kb,
    staggeredKnockback: kb * KB.staggeredKnockbackMultiplier,
    ball: hit.ball ? Math.min(scaled(hit.ball, power), gameplay.ball.knockbackCap) : 0,
    light: !!hit.light,
    stun: hit.stun ?? 0,
    ballStun: hit.ballStun ?? 0,
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
}

function actionStats(a: MoveAction, def: MoveDef, p: PokemonDef): ActionStats {
  const body = SIZE_TABLE[p.stats.size].radius;
  const start = def.castTime + a.delay;
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
  };
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
      base.hits = a.hit ? a.repeat : 0;
      base.hitsBall = !!a.hit && a.hitsBall && (!!a.hit.ball || !!a.hit.ballStun);
      base.heal = a.allyHealPct;
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
  }
  return base;
}

export function analyzeMove(def: MoveDef, p: PokemonDef): MoveStats {
  const parts = def.actions.map((a) => actionStats(a, def, p));
  const hitting = parts.filter((s) => s.hits > 0);
  const damagePerCast = parts.reduce((s, a) => s + a.hits * a.hit.damage, 0);
  const knockback = Math.max(0, ...parts.map((a) => a.hit.knockback));
  const staggeredKnockback = Math.max(0, ...parts.map((a) => (a.hits > 0 ? a.hit.staggeredKnockback : 0)));
  return {
    id: def.id,
    name: def.name,
    slot: def.slot,
    kind: def.actions.map((a) => a.type).join('+'),
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
  };
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
  };
}

const staggerAt = (p: PokemonDef, level: number) => p.stats.stagger + (p.stats.staggerGrowth * (level - 1)) / 9;

/** Raw per-fighter numbers (no roster-relative parts yet). */
function analyzeFighterRaw(p: PokemonDef): Omit<FighterStats, 'combosToStagger' | 'survivability' | 'budget' | 'budgetParts'> {
  const kit = getKit(p.id);
  const moves = kit ? (['primary', 'secondary', 'special'] as const).map((slot) => analyzeMove(kit.moves.find((m) => m.slot === slot)!, p)) : [];
  const strike = analyzeStrike(p);
  const all = [strike, ...moves];
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
    kitDps: moves.reduce((s, m) => s + m.dps, 0),
    comboDamage: moves.reduce((s, m) => s + m.damagePerCast, 0),
    ballPressure: all.reduce((s, m) => s + (m.ballPower > 0 ? m.ballPower / m.cooldown : 0), 0),
    maxBallPower: Math.max(...all.map((m) => m.ballPower)),
    mobility: p.stats.speed + moves.reduce((s, m) => s + m.mobility / m.cooldown, 0),
    control: moves.reduce((s, m) => s + (m.stun + m.ballStun * 0.5) / m.cooldown, 0),
    maxKoReach: Math.max(0, ...moves.map((m) => m.koReach)),
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
    };
  });
}
