import { z } from 'zod';
import itemsJson from '../items/items.json' with { type: 'json' };
import { ProjectileAction } from './kits';

/**
 * Held items (M5.5), the OS Gear layer: one per player, picked at select, locked to the role slot.
 * Effects are a fixed vocabulary of generic hooks (no per-item code): every number lives here.
 */
const pct = z.number().min(0).max(300);
const frac = z.number().min(0).max(1);
const pos = z.number().positive();

export const ItemEffects = z.object({
  /** A Strike that hits the ball: +pct speed for `duration` s. */
  speedOnBallStrike: z.object({ pct, duration: pos }).optional(),
  /** Player knockback you deal, +%. */
  knockbackDealtPct: pct.optional(),
  /** +% speed while your team has more players on the field. */
  speedWhenAheadPct: pct.optional(),
  /** Heal this fraction of the Stagger damage you deal. */
  lifesteal: frac.optional(),
  /** Crossing midfield on foot (or dashing): +pct speed for `duration` s. */
  speedOnMidfield: z.object({ pct, duration: pos }).optional(),
  /** Hits poison: `pct` (LIGHT: `lightPct`) of the target's max Stagger over `duration`; you heal `heal`× of it. */
  poison: z.object({ pct: frac, lightPct: frac, duration: pos, heal: z.number().min(0) }).optional(),
  /** Speed +basePct, building +perSecondPct per second up to +maxPct more on your half; reset when hit. */
  momentum: z.object({ basePct: pct, perSecondPct: pct, maxPct: pct }).optional(),
  /** Dash and blink distance +%. */
  dashRangePct: pct.optional(),
  /** Speed buffs from moves are this % stronger. */
  hastePct: pct.optional(),
  /** Secondary cooldown −%. */
  secondaryCooldownPct: z.number().min(0).max(90).optional(),
  /** After a secondary, press it again within `window` s to blink back to where you cast it. */
  blinkBack: z.object({ window: pos }).optional(),
  /** Projectile range and target cast range +%. */
  projectileRangePct: pct.optional(),
  /** Every `interval` s, a Strike also fires `projectile`. */
  strikeShot: z.object({ interval: pos, projectile: ProjectileAction }).optional(),
  sizePct: z.number().min(-50).max(100).optional(),
  powerAdd: z.number().optional(),
  damageReduction: frac.optional(),
});
export type ItemEffects = z.infer<typeof ItemEffects>;

export const ItemSlot = z.enum(['forward', 'goalie']);
export type ItemSlot = z.infer<typeof ItemSlot>;

export const ItemDef = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  slot: ItemSlot,
  /** The OS Gear it is modelled on. */
  os: z.string(),
  desc: z.string(),
  effects: ItemEffects,
});
export type ItemDef = z.infer<typeof ItemDef>;

const ItemsFile = z.object({
  items: z.array(ItemDef).min(1),
  /** Starting pick per archetype for each slot (CPUs, setup screen). */
  defaults: z.object({ forward: z.record(z.string(), z.string()), goalie: z.record(z.string(), z.string()) }),
});
const file = ItemsFile.parse(itemsJson);
export const items: readonly ItemDef[] = file.items;

export function getItem(id: string): ItemDef {
  const it = items.find((i) => i.id === id);
  if (!it) throw new Error(`Unknown item: ${id}`);
  return it;
}

export const itemsFor = (slot: ItemSlot): ItemDef[] => items.filter((i) => i.slot === slot);

/** The default item for an archetype in a slot (falls back to the slot's first item). */
export function defaultItem(archetype: string, slot: ItemSlot): ItemDef {
  const id = file.defaults[slot][archetype];
  return items.find((i) => i.id === id && i.slot === slot) ?? itemsFor(slot)[0]!;
}
