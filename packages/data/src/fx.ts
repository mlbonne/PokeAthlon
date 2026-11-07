import { z } from 'zod';
import fxJson from '../fx/moves.json';

/**
 * Move animations (docs/design/vfx-plan.md): which effect sheets play when, per move. Client only;
 * the simulation never reads this. Sprites are PMD effect sheets in assets/fx/pmd (see its
 * manifest.json), procedural ones start with '@' (@crater, @scorch). Effects are plain sprites: no glow or bloom.
 */
export const FxLayer = z.object({
  sprite: z.string(),
  /** Stand up facing the camera, or lie flat on the pitch. */
  plane: z.enum(['billboard', 'ground']).default('billboard'),
  /** Size multiplier (1 = the sheet's pixels at the Pokémon sprites' pixel size). */
  scale: z.number().positive().default(1),
  /** Stretch the frame width to the move's radius × fit (areas, rings, zones) instead of `scale`. */
  fit: z.number().positive().optional(),
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Game ticks (1/60 s) per frame. */
  ticks: z.number().positive().default(2),
  loop: z.boolean().default(false),
  /** Turn to the move's direction (aim, travel). */
  rotate: z.boolean().default(false),
  /** Height above the ground in sprite pixels (billboards). */
  y: z.number().default(0),
  alpha: z.number().min(0).max(1).default(1),
  /** Seconds a one-shot lives when it isn't a whole animation (loops in one-shot phases), or a fade-out for decals. */
  life: z.number().positive().optional(),
  /** Persistent (body) layers: also drop a one-shot copy every `emit` seconds (trails). */
  emit: z.number().positive().optional(),
  /** Several copies scattered within `spread` world units. */
  count: z.number().int().min(1).default(1),
  spread: z.number().nonnegative().default(0),
  /** Areas: scatter the copies along the move's direction (±radius) instead of around it; `spread` = sideways jitter. */
  along: z.boolean().default(false),
  /** Seconds before it starts. */
  delay: z.number().nonnegative().default(0),
  /** Follow the anchor (caster, projectile…) instead of staying where it started. */
  follow: z.boolean().default(false),
});
export type FxLayer = z.infer<typeof FxLayer>;

const Layers = z.array(FxLayer).default([]);

/**
 * Phases of a move:
 * - cast: on the cast, at the caster
 * - area: each area hit lands (at its centre, `fit` uses its radius)
 * - hit: on each player the move hits
 * - body: while the move's thing exists (projectile, dash, buff, channel, ring, guardian zone, wall, held ball)
 * - end: where that thing ends (projectile stops, wall falls…)
 * - arrive: where a blink lands
 * - mark: on a delayed area's target until it fires (follows a tracked enemy)
 */
export const MoveFx = z.object({
  cast: Layers,
  area: Layers,
  hit: Layers,
  body: Layers,
  end: Layers,
  arrive: Layers,
  mark: Layers,
});
export type MoveFx = z.infer<typeof MoveFx>;

export const FxData = z.object({
  moves: z.record(z.string(), MoveFx),
  /** Shared moments (strike, ballHit, ko, evade, burst, levelUp, respawn, orb, barrierBreak, gateOpen, goal, rescue, banish). */
  shared: z.record(z.string(), Layers),
  /** Status overlays while a player has them (stun, slow, speed, power, heal, staggered). */
  status: z.record(z.string(), Layers),
});
export type FxData = z.infer<typeof FxData>;

export const fxData: FxData = FxData.parse(fxJson);
export const moveFx = (moveId: string): MoveFx | undefined => fxData.moves[moveId];
