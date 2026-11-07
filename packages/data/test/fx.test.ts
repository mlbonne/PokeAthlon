import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fxData } from '../src/fx';
import { kits } from '../src/kits';

/** Move animations (docs/design/vfx-plan.md): every move has some, and every sheet they name exists. */
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../../assets/fx/pmd/manifest.json', import.meta.url)), 'utf-8')) as Record<string, unknown>;

describe('move animations', () => {
  it('every move and passive has at least one effect', () => {
    for (const kit of Object.values(kits)) {
      for (const m of kit.moves) {
        const fx = fxData.moves[m.id];
        expect(fx, m.id).toBeTruthy();
        const n = fx!.cast.length + fx!.area.length + fx!.hit.length + fx!.body.length + fx!.end.length + fx!.arrive.length;
        expect(n, m.id).toBeGreaterThan(0);
      }
      if (kit.passive) expect(fxData.moves[`passive:${kit.pokemon}`], `passive:${kit.pokemon}`).toBeTruthy();
    }
  });

  it('every sprite named exists in the downloaded sheets (or is drawn in code)', () => {
    const all = [
      ...Object.values(fxData.moves).flatMap((m) => [...m.cast, ...m.area, ...m.hit, ...m.body, ...m.end, ...m.arrive]),
      ...Object.values(fxData.shared).flat(),
      ...Object.values(fxData.status).flat(),
    ];
    for (const l of all) if (!l.sprite.startsWith('@')) expect(manifest[l.sprite], l.sprite).toBeTruthy();
  });

  it('no sheet is the main animation of two moves', () => {
    const main = new Map<string, string>();
    for (const [id, m] of Object.entries(fxData.moves)) {
      const first = (m.body.find((l) => !l.emit) ?? m.area[0] ?? m.cast[0])?.sprite;
      if (!first || first.startsWith('@')) continue;
      expect(main.get(first), `${id} and ${main.get(first)} both use ${first}`).toBeUndefined();
      main.set(first, id);
    }
  });
});
