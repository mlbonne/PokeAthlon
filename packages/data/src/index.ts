import { z } from 'zod';
import rosterJson from '../pokemon/roster.json' with { type: 'json' };

export const SizeClass = z.enum(['normal', 'large', 'very-large']);
export type SizeClass = z.infer<typeof SizeClass>;

/** Hurtbox radius / strike width per size class, in world units (OS: strike width 250/265/270). */
export const SIZE_TABLE: Record<SizeClass, { radius: number; strikeWidth: number }> = {
  normal: { radius: 60, strikeWidth: 250 },
  large: { radius: 72, strikeWidth: 265 },
  'very-large': { radius: 85, strikeWidth: 270 },
};

export const Archetype = z.enum([
  'speedy-skirmisher',
  'flashy-swordsman',
  'manipulating-mastermind',
  'empowering-enchanter',
  'stalwart-protector',
  'shield-user',
  'flexible-brawler',
  'hulking-beast',
]);

export const PokemonDef = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  dex: z.string().regex(/^\d{4}$/),
  name: z.string().min(1),
  archetype: Archetype,
  types: z.array(z.string()).min(1).max(2),
  stats: z.object({
    power: z.number().int().min(50).max(200),
    speed: z.number().int().min(300).max(700),
    stagger: z.number().int().min(500).max(3000),
    staggerGrowth: z.number().int().min(0).max(1000),
    size: SizeClass,
  }),
});
export type PokemonDef = z.infer<typeof PokemonDef>;

export const Roster = z.object({
  pokemon: z.array(PokemonDef).min(1),
});

/** Validated roster. Throws at import time if roster.json is malformed. */
export const roster: readonly PokemonDef[] = Roster.parse(rosterJson).pokemon;

export function getPokemon(id: string): PokemonDef {
  const p = roster.find((r) => r.id === id);
  if (!p) throw new Error(`Unknown pokemon: ${id}`);
  return p;
}

/** Sprite animations every roster entry is expected to ship. */
export const REQUIRED_ANIMS = ['Idle', 'Walk', 'Attack', 'Hurt', 'Charge', 'Swing'] as const;
/** Imported when present. */
export const OPTIONAL_ANIMS = ['Shoot', 'Strike', 'Hop', 'Rotate', 'Double', 'Pose', 'Faint', 'QuickStrike'] as const;
/** Portrait emotions imported when present. */
export const PORTRAIT_EMOTIONS = ['Normal', 'Happy', 'Determined', 'Pain', 'Angry', 'Surprised', 'Dizzy', 'Joyous'] as const;

/** Shape of the generated assets/sprites/<dex>/anim.json. */
export interface SpriteAnim {
  frameWidth: number;
  frameHeight: number;
  /** Per-frame durations in PMD ticks (1/60 s). */
  durations: number[];
  rushFrame?: number;
  hitFrame?: number;
  returnFrame?: number;
  file: string;
  shadowFile?: string;
}
export interface SpriteManifest {
  dex: string;
  shadowSize: number;
  anims: Record<string, SpriteAnim>;
  portraits: string[];
}
