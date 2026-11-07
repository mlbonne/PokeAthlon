import { z } from 'zod';
import arcanineHisui from '../kits/arcanine-hisui.json' with { type: 'json' };
import blastoise from '../kits/blastoise.json' with { type: 'json' };
import bronzong from '../kits/bronzong.json' with { type: 'json' };
import greninja from '../kits/greninja.json' with { type: 'json' };
import hoopa from '../kits/hoopa.json' with { type: 'json' };
import lucario from '../kits/lucario.json' with { type: 'json' };
import machamp from '../kits/machamp.json' with { type: 'json' };
import pikachu from '../kits/pikachu.json' with { type: 'json' };
import zeraora from '../kits/zeraora.json' with { type: 'json' };

/**
 * Data-driven moves (M3). A move is a list of actions built from a small vocabulary that covers
 * the OS kit patterns: projectiles, areas (circle / cone / line), dashes, buffs and walls.
 * Values use the OS hit model: each hit is `base + powerRatio × Power`.
 */
const nonneg = z.number().nonnegative();
const pos = z.number().positive();
const Scaling = z.object({ base: nonneg, powerRatio: nonneg });

export const MoveHit = z.object({
  /** Knockback applied to the ball (sets its speed, OS Core rules). */
  ball: Scaling.optional(),
  /** Knockback applied to enemy players. */
  player: Scaling.optional(),
  /** Stagger damage to enemy players. */
  damage: Scaling.optional(),
  /** LIGHT hit: chip + slow; knocks back only Staggered targets. */
  light: z.boolean().optional(),
  stun: nonneg.optional(),
  /** Freeze the ball (OS "stun Core") for this long; a stunned ball ignores knockback. */
  ballStun: nonneg.optional(),
  /**
   * Knockback direction: 'travel' (projectile / dash direction or the move's aim),
   * 'radial' (away from the action's centre), 'pull' (towards the caster).
   */
  direction: z.enum(['travel', 'radial', 'pull']).default('travel'),
  /** Banish (M5.1, OS Rune): removed from play this many seconds, untargetable, then back where it left. */
  banish: nonneg.optional(),
  /** Movement slow on players hit (OS Octavia's Sonic Boom). Replaces a LIGHT hit's default slow. */
  slow: z.object({ pct: z.number().min(0).max(90), time: pos }).optional(),
});
export type MoveHit = z.infer<typeof MoveHit>;

const Fx = z.object({
  /** Hex colour for the client's visuals. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const frac = z.number().min(0).max(1);

const common = {
  delay: nonneg.default(0),
  fx: Fx,
  /** Show the action's shape on the ground from the cast until it fires (delayed areas, delayed blinks). */
  telegraph: z.boolean().default(false),
  /**
   * Side-of-field condition (OS Asher): multiplies the action's power (hits) and duration (walls,
   * buffs, channels) depending on which half the caster stands on when it fires.
   */
  side: z.object({ own: pos.default(1), enemy: pos.default(1) }).optional(),
};

/** A stronger hit in part of an area (OS sweet spots: X's tip, Rasmus's tip, a centre). */
const SweetSpot = z.object({
  /** Band of the area's reach, as fractions of radius (circle/cone) or length (line). */
  from: frac.default(0),
  to: frac.default(1),
  /** Cones only: the band is also limited to this central angle. */
  angleDeg: pos.optional(),
  hit: MoveHit,
});

export const AreaAction = z.object({
  type: z.literal('area'),
  ...common,
  shape: z.enum(['circle', 'cone', 'line']),
  /** Circle/cone radius. */
  radius: nonneg.default(0),
  /** Cone full angle in degrees. */
  angleDeg: nonneg.default(90),
  /** Line length (forward) and width. */
  length: nonneg.default(0),
  width: nonneg.default(0),
  /** Where it's centred: on the caster (+ forward offset) or at the aimed target point. */
  at: z.enum(['self', 'target']).default('self'),
  offset: z.number().default(0),
  /** Repeat the hit several times (e.g. a flurry of jabs); each repeat can hit each target again. */
  repeat: z.number().int().min(1).default(1),
  repeatInterval: nonneg.default(0),
  hitsBall: z.boolean().default(true),
  hit: MoveHit.optional(),
  sweetSpot: SweetSpot.optional(),
  /** Heal allies inside (fraction of max Stagger). */
  allyHealPct: nonneg.default(0),
  /**
   * Target areas only: lock onto the enemy closest to the aim point (within radius + 200 of it) and
   * follow them at this speed (units/s) until it fires. 0 = stays where it was placed. Evade dodges it.
   */
  track: nonneg.default(0),
});

export const DashAction = z.object({
  type: z.literal('dash'),
  ...common,
  distance: pos,
  time: pos,
  /** Hit enemies (and the ball) touched along the way. */
  hit: MoveHit.optional(),
  stopOnHit: z.boolean().default(false),
  /** Other moves can be cast while dashing (OS Juliette). */
  castWhileDashing: z.boolean().default(false),
  /** Guarded dash (OS Asher's charge): knockback resist and damage reduction while dashing. */
  knockbackResist: nonneg.default(0),
  damageReduction: frac.default(0),
  /** The dash ends early once it has taken this fraction of max Stagger in damage (0 = never). */
  breakOnDamage: frac.default(0),
});

export const BuffAction = z.object({
  type: z.literal('buff'),
  ...common,
  target: z.enum(['self', 'allies']),
  /** For 'allies': radius around the caster (caster included). */
  radius: nonneg.default(0),
  duration: pos,
  speedPct: z.number().default(0),
  /** If true the speed bonus decays linearly to 0 over the duration (OS Era). */
  decays: z.boolean().default(false),
  knockbackResist: nonneg.default(0),
  damageReduction: z.number().min(0).max(1).default(0),
  healPct: nonneg.default(0),
  /** Transform buffs (OS X's "hulk out"): bigger body and Strike, more power, more knockback taken. */
  sizePct: z.number().min(-50).max(100).default(0),
  powerAdd: z.number().default(0),
  /** Extra knockback taken, % (a drawback). */
  knockbackTakenPct: z.number().min(-90).default(0),
  /** While active, Strike also hits enemy players with this hit. */
  strikeHit: MoveHit.optional(),
  /** Any hit the holder lands (players or the ball, Strike included) resets the duration (OS Flow State). */
  refreshOnHit: z.boolean().default(false),
  /** The move's cooldown only runs once the buff has worn off. */
  cooldownAfter: z.boolean().default(false),
});

export const WallAction = z.object({
  type: z.literal('wall'),
  ...common,
  count: z.number().int().min(1),
  /** Total arc angle the walls are spread across. */
  spreadDeg: nonneg,
  /** Distance from the caster to each wall's centre. */
  distance: pos,
  length: pos,
  thickness: pos,
  duration: pos,
  /** Hit enemies under a wall when it lands. */
  hit: MoveHit.optional(),
});

/**
 * Channel (M5.1): a cone or line in front of the caster that hits every `interval` for `duration`.
 * The caster is slowed and can't Strike or cast; a knock, stun or banish ends it.
 */
export const ChannelAction = z.object({
  type: z.literal('channel'),
  ...common,
  shape: z.enum(['cone', 'line']),
  radius: nonneg.default(0),
  angleDeg: nonneg.default(60),
  length: nonneg.default(0),
  width: nonneg.default(0),
  duration: pos,
  interval: pos,
  /** Aim follows the stick while channelling (otherwise fixed at the cast direction). */
  follows: z.boolean().default(false),
  slowPct: z.number().min(0).max(100).default(50),
  hitsBall: z.boolean().default(true),
  hit: MoveHit,
});

/**
 * Blink (M5.1): instant relocation.
 * - `aim`: toward the aim point, up to `distance`.
 * - `ally`: next to (or swapped with) the ally nearest the aim point, within `distance`.
 * - `mark`: back to where the caster stood when the move was first cast (recast blink-back).
 */
export const BlinkAction = z.object({
  type: z.literal('blink'),
  ...common,
  to: z.enum(['aim', 'ally', 'mark']),
  distance: pos,
  /** `ally`: swap places instead of landing beside them. */
  swap: z.boolean().default(false),
  /** Hit enemies (and the ball) along the path. */
  hit: MoveHit.optional(),
});

export const ProjectileAction = z.object({
  type: z.literal('projectile'),
  ...common,
  count: z.number().int().min(1).default(1),
  /** Seconds between shots when count > 1. */
  interval: nonneg.default(0),
  /** Total fan angle (degrees) across `count` shots fired at once (interval 0). */
  spreadDeg: nonneg.default(0),
  speed: pos,
  /** Speed lost per second (decelerating projectiles stop early). */
  decel: nonneg.default(0),
  range: pos,
  radius: pos,
  pierce: z.boolean().default(false),
  hitsBall: z.boolean().default(true),
  hit: MoveHit,
  /** Piercing projectiles: the hit used after the first player hit (OS "LIGHT hits to subsequent enemies"). */
  pierceHit: MoveHit.optional(),
  /**
   * Follow-up when the projectile stops (hits someone, a wall, or its range): these actions are
   * scheduled from that moment with the stop point as both the aim target and the mark, so a
   * `blink` to `mark` teleports the caster to it and an `area` at `target` lands there (Hoopa's
   * Hyperspace Hole). Delays count from the stop.
   */
  onEnd: z.array(z.discriminatedUnion('type', [AreaAction, BlinkAction])).optional(),
});

/**
 * Guardian (OS Atlas's Celestial Intervention): a zone placed on the caster (or the aimed point)
 * for `duration`. It heals allies inside by `healPct` of their max Stagger on cast and every
 * `interval`, and any ally of the caster who would be KO'd anywhere while it stands is rescued
 * instead: moved to the zone with `rescueHealPct` of their Stagger. Once per ally per cast.
 */
export const GuardianAction = z.object({
  type: z.literal('guardian'),
  ...common,
  at: z.enum(['self', 'target']).default('self'),
  radius: pos,
  duration: pos,
  interval: pos,
  healPct: nonneg.default(0),
  rescueHealPct: frac.default(0.75),
});

/**
 * Ball grab (M5.1): if the ball is within `radius`, hold it in front of the caster for `hold`
 * seconds (the only "hold" in the game). The caster is slowed; any hit on them drops it.
 * At the end it is dropped, or thrown with `throw` if set. A `throw` action (usually a recast) throws it early.
 */
export const GrabAction = z.object({
  type: z.literal('grab'),
  ...common,
  radius: pos,
  hold: pos,
  holdDistance: pos.default(90),
  slowPct: z.number().min(0).max(100).default(30),
  throw: Scaling.optional(),
});

/** Throw a ball this player is holding (grab), toward the aim. */
export const ThrowAction = z.object({
  type: z.literal('throw'),
  ...common,
  ball: Scaling,
});

export const MoveAction = z.discriminatedUnion('type', [
  ProjectileAction,
  AreaAction,
  DashAction,
  BuffAction,
  WallAction,
  ChannelAction,
  BlinkAction,
  GrabAction,
  ThrowAction,
  GuardianAction,
]);
export type MoveAction = z.infer<typeof MoveAction>;

export const MoveSlot = z.enum(['primary', 'secondary', 'special']);
export type MoveSlot = z.infer<typeof MoveSlot>;

export const MoveDef = z.object({
  id: z.string(),
  name: z.string(),
  slot: MoveSlot,
  cooldown: pos,
  /** Wind-up before the actions start (you can still move). */
  castTime: nonneg.default(0),
  /** Max cast distance for 'target' areas (aim distance is clamped to this). */
  range: nonneg.default(0),
  /** PMD animation to play on cast. */
  anim: z.string().default('Attack'),
  /** Short description for the HUD. */
  desc: z.string(),
  /** How bots use it. */
  bot: z.enum(['ballShot', 'engage', 'chase', 'defend', 'support']),
  actions: z.array(MoveAction).min(1),
  /**
   * Charge-and-release (M5.1, OS Vyce): hold the button to charge, release to fire. The cooldown
   * starts on release. At charge 0 the move has `min` of its power/range, at full charge 100 %.
   */
  charge: z
    .object({
      /** Seconds to full charge. */
      time: pos,
      /** Max hold; it fires by itself after this. */
      maxHold: pos,
      min: frac.default(0.4),
      /** Movement slow while charging, %. */
      slowPct: z.number().min(0).max(100).default(30),
      power: z.boolean().default(true),
      range: z.boolean().default(true),
    })
    .optional(),
  /**
   * Recast (M5.1): pressing the button again within `window` seconds of the cast fires `actions`
   * (throw, blink back, detonate…) with a fresh aim. The cooldown already runs.
   */
  recast: z.object({ window: pos, actions: z.array(MoveAction).min(1) }).optional(),
});
export type MoveDef = z.infer<typeof MoveDef>;

/**
 * Strike modifier passive (M5.1, OS Zentaro / Drum Oni): gain a stack on each `gainOn` event; at
 * `stacks`, the next Strike also fires `actions` in the Strike's direction and spends them.
 */
export const KitPassive = z.object({
  name: z.string(),
  desc: z.string(),
  stacks: z.number().int().min(1),
  /** moveHit: a move hits an enemy player. strikeBall: a Strike hits the ball. */
  gainOn: z.enum(['moveHit', 'strikeBall']),
  actions: z.array(MoveAction).min(1),
});
export type KitPassive = z.infer<typeof KitPassive>;

export const KitDef = z.object({
  pokemon: z.string(),
  passive: KitPassive.optional(),
  moves: z.array(MoveDef).length(3),
});
export type KitDef = z.infer<typeof KitDef>;

/** Parse and check a kit (one move per slot). */
export function parseKit(json: unknown): KitDef {
  const kit = KitDef.parse(json);
  const slots = kit.moves.map((m) => m.slot).sort().join(',');
  if (slots !== 'primary,secondary,special') throw new Error(`Kit ${kit.pokemon} needs one move per slot`);
  return kit;
}

export const kits: Record<string, KitDef> = Object.fromEntries(
  [zeraora, bronzong, lucario, greninja, machamp, hoopa, blastoise, arcanineHisui, pikachu].map((k) => {
    const kit = parseKit(k);
    return [kit.pokemon, kit];
  }),
);

export function getKit(pokemonId: string): KitDef | undefined {
  return kits[pokemonId];
}

/**
 * Install a kit at runtime (tests, kit drafts in tools). Returns the parsed kit. Pass `null` to
 * remove it again.
 */
export function registerKit(pokemonId: string, json: unknown | null): KitDef | undefined {
  if (json === null) {
    delete kits[pokemonId];
    return undefined;
  }
  const kit = parseKit({ ...(json as object), pokemon: pokemonId });
  kits[pokemonId] = kit;
  return kit;
}

type Scaling = z.infer<typeof Scaling>;
const scaleScaling = (s: Scaling, k: number): Scaling => ({ base: s.base * k, powerRatio: s.powerRatio * k });

/** A hit with its ball / player knockback and damage multiplied by `k`. */
export function scaleHit(h: MoveHit, k: number): MoveHit {
  if (k === 1) return h;
  return {
    ...h,
    ...(h.ball ? { ball: scaleScaling(h.ball, k) } : {}),
    ...(h.player ? { player: scaleScaling(h.player, k) } : {}),
    ...(h.damage ? { damage: scaleScaling(h.damage, k) } : {}),
  };
}

/**
 * An action with its hits × `power`, its reach (range, radius, length, distance) × `range` and its
 * duration (walls, buffs, channels) × `duration`. Used by charge-and-release and side conditions.
 */
export function scaleAction(a: MoveAction, power: number, range: number, duration: number): MoveAction {
  if (power === 1 && range === 1 && duration === 1) return a;
  const hit = <T extends { hit?: MoveHit | undefined }>(x: T): Partial<T> => (x.hit ? ({ hit: scaleHit(x.hit, power) } as Partial<T>) : {});
  switch (a.type) {
    case 'projectile':
      return { ...a, range: a.range * range, hit: scaleHit(a.hit, power), ...(a.pierceHit ? { pierceHit: scaleHit(a.pierceHit, power) } : {}) };
    case 'area':
      return {
        ...a,
        radius: a.radius * range,
        length: a.length * range,
        ...hit(a),
        ...(a.sweetSpot ? { sweetSpot: { ...a.sweetSpot, hit: scaleHit(a.sweetSpot.hit, power) } } : {}),
      };
    case 'dash':
      return { ...a, distance: a.distance * range, ...hit(a) };
    case 'buff':
      return { ...a, duration: a.duration * duration, ...(a.strikeHit ? { strikeHit: scaleHit(a.strikeHit, power) } : {}) };
    case 'wall':
      return { ...a, duration: a.duration * duration, ...hit(a) };
    case 'channel':
      return { ...a, radius: a.radius * range, length: a.length * range, duration: a.duration * duration, hit: scaleHit(a.hit, power) };
    case 'blink':
      return { ...a, distance: a.distance * range, ...hit(a) };
    case 'grab':
      return { ...a, ...(a.throw ? { throw: scaleScaling(a.throw, power) } : {}) };
    case 'throw':
      return { ...a, ball: scaleScaling(a.ball, power) };
    case 'guardian':
      return { ...a, radius: a.radius * range, duration: a.duration * duration };
  }
}

/** Charge multiplier at charge fraction `f` (0…1). */
export const chargeScale = (min: number, f: number): number => min + (1 - min) * Math.max(0, Math.min(1, f));
