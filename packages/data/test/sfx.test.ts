import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { roster } from '../src/index';
import { kits } from '../src/kits';
import { sfxData } from '../src/sfx';

/** Sound effects (docs/design/sfx-plan.md): every move has some, every file exists, every Pokémon has a cry. */
const file = (name: string) => fileURLToPath(new URL(`../../../assets/sfx/${name}.ogg`, import.meta.url));

describe('sound effects', () => {
  it('every move and passive has at least one sound', () => {
    for (const kit of Object.values(kits)) {
      for (const m of kit.moves) {
        const s = sfxData.moves[m.id];
        expect(s, m.id).toBeTruthy();
        expect(s!.cast.length + s!.hit.length + s!.area.length + s!.arrive.length + s!.end.length + (s!.loop ? 1 : 0), m.id).toBeGreaterThan(0);
      }
      if (kit.passive) expect(sfxData.moves[`passive:${kit.pokemon}`], `passive:${kit.pokemon}`).toBeTruthy();
    }
  });

  it('every sound named exists in assets/sfx', () => {
    const names = [
      ...Object.values(sfxData.moves).flatMap((m) => [...m.cast, ...m.hit, ...m.area, ...m.arrive, ...m.end, ...(m.loop ? [m.loop] : [])].map((x) => x.s)),
      ...Object.values(sfxData.shared).flat().map((x) => x.s),
      ...Object.values(sfxData.ui).flat().map((x) => x.s),
      ...Object.values(sfxData.cries),
    ];
    for (const n of names) expect(existsSync(file(n)), n).toBe(true);
  });

  it('every Pokémon in the roster has a cry', () => {
    for (const r of roster) expect(sfxData.cries[r.id], r.id).toBeTruthy();
  });
});
