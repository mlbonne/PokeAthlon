import { z } from 'zod';
import sfxJson from '../fx/sounds.json';

/**
 * Sound effects (docs/design/sfx-plan.md): which sound plays when, per move and moment. Client
 * only. Names are paths under assets/sfx without the extension: `pmd/Battle/DUN_Surf` (PMD: Origins
 * sounds) or `cries/<PokéAPI id>`. A sound is a name, or `{ "s": name, "vol": 0..2, "pitch": 0.5..2, "dur": seconds }`.
 */
export const Snd = z.union([
  z.string().transform((s): { s: string; vol: number; pitch: number; dur?: number } => ({ s, vol: 1, pitch: 1 })),
  z.object({
    s: z.string(),
    vol: z.number().min(0).max(2).default(1),
    pitch: z.number().min(0.5).max(2).default(1),
    /** Cut long sounds: fade out and stop after this many seconds. */
    dur: z.number().positive().optional(),
  }),
]);
export type Snd = z.infer<typeof Snd>;
const List = z.array(Snd).default([]);

/** Per move: cast, each player hit, each area landing, a blink arrival, a loop while it lasts, and its end. */
export const MoveSfx = z.object({
  cast: List,
  hit: List,
  area: List,
  arrive: List,
  loop: Snd.optional(),
  end: List,
});
export type MoveSfx = z.infer<typeof MoveSfx>;

export const SfxData = z.object({
  moves: z.record(z.string(), MoveSfx),
  /** Shared moments (strike, ballHit, goalUs, matchLost…). */
  shared: z.record(z.string(), List),
  /** Menus: click, confirm, cancel, select, toggle, error. */
  ui: z.record(z.string(), List),
  /** Pokémon id → its cry. */
  cries: z.record(z.string(), z.string()),
});
export type SfxData = z.infer<typeof SfxData>;

export const sfxData: SfxData = SfxData.parse(sfxJson);
export const moveSfx = (moveId: string): MoveSfx | undefined => sfxData.moves[moveId];
