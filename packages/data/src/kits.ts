import { z } from 'zod';
import lucario from '../kits/lucario.json' with { type: 'json' };
import pikachu from '../kits/pikachu.json' with { type: 'json' };
import snorlax from '../kits/snorlax.json' with { type: 'json' };
import togekiss from '../kits/togekiss.json' with { type: 'json' };

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
});
export type MoveHit = z.infer<typeof MoveHit>;

const Fx = z.object({
  /** Hex colour for the client's visuals. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const common = { delay: nonneg.default(0), fx: Fx };

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
  /** Heal allies inside (fraction of max Stagger). */
  allyHealPct: nonneg.default(0),
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

export const MoveAction = z.discriminatedUnion('type', [ProjectileAction, AreaAction, DashAction, BuffAction, WallAction]);
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
});
export type MoveDef = z.infer<typeof MoveDef>;

export const KitDef = z.object({
  pokemon: z.string(),
  moves: z.array(MoveDef).length(3),
});
export type KitDef = z.infer<typeof KitDef>;

export const kits: Record<string, KitDef> = Object.fromEntries(
  [pikachu, snorlax, lucario, togekiss].map((k) => {
    const kit = KitDef.parse(k);
    const slots = kit.moves.map((m) => m.slot).sort().join(',');
    if (slots !== 'primary,secondary,special') throw new Error(`Kit ${kit.pokemon} needs one move per slot`);
    return [kit.pokemon, kit];
  }),
);

export function getKit(pokemonId: string): KitDef | undefined {
  return kits[pokemonId];
}
