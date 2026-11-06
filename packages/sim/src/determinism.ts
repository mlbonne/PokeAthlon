import { getBrain } from './ai/index';
import { hashWorldDeep } from './hash';
import { withDefaultItems } from './headless';
import { createWorld, step } from './world';

/**
 * A fixed 3v3 bot match with boosts, the same on every machine. Returns the deep state hash every
 * `every` ticks. Netcode only works if every browser produces the same list (M7.0): compare the
 * output of `npm run determinism` with the browser page `determinism.html`.
 */
export function determinismProbe(ticks = 3600 * 3, every = 600): string[] {
  const lineup = ['pikachu', 'lucario', 'snorlax', 'greninja', 'blastoise', 'machamp'].map((id, i) => ({ pokemonId: id, team: (i < 3 ? 0 : 1) as 0 | 1 }));
  const w = createWorld(withDefaultItems(lineup), { mode: 'match', seed: 2026, boosts: true });
  const brain = getBrain('v2-hard');
  const out: string[] = [];
  for (let t = 1; t <= ticks; t++) {
    step(w, w.players.map((p) => brain(w, p.id)));
    if (t % every === 0) out.push(hashWorldDeep(w));
  }
  return out;
}
