import { describe, expect, it } from 'vitest';
import { createWorld, getBrain, hashWorldDeep, restoreWorld, snapshotWorld, step, type World } from '../src/index';

const LINEUP = ['pikachu', 'lucario', 'bronzong', 'greninja', 'blastoise', 'machamp'].map((id, i) => ({ pokemonId: id, team: (i < 3 ? 0 : 1) as 0 | 1 }));
const brain = getBrain('v2');
const tickBots = (w: World) => step(w, w.players.map((p) => brain(w, p.id)));

describe('snapshot and restore (M7 rollback)', () => {
  it('re-running from a restored snapshot reproduces the match bit for bit', () => {
    const w = createWorld(LINEUP, { mode: 'match', seed: 7, boosts: true });
    for (let i = 0; i < 900; i++) tickBots(w);
    const snap = snapshotWorld(w);
    const first: string[] = [];
    for (let i = 0; i < 1200; i++) {
      tickBots(w);
      if (i % 60 === 0) first.push(hashWorldDeep(w));
    }
    const end = hashWorldDeep(w);
    restoreWorld(w, snap);
    const again: string[] = [];
    for (let i = 0; i < 1200; i++) {
      tickBots(w);
      if (i % 60 === 0) again.push(hashWorldDeep(w));
    }
    expect(again).toEqual(first);
    expect(hashWorldDeep(w)).toBe(end);
  });

  it('a snapshot can be restored many times and is not changed by playing on', () => {
    const w = createWorld(LINEUP, { mode: 'match', seed: 3 });
    for (let i = 0; i < 300; i++) tickBots(w);
    const snap = snapshotWorld(w);
    const at = hashWorldDeep(w);
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 50; i++) tickBots(w);
      restoreWorld(w, snap);
      expect(hashWorldDeep(w)).toBe(at);
    }
  });

  it('the deep hash notices a one-bit change anywhere in the state', () => {
    const w = createWorld(LINEUP, { mode: 'match', seed: 1 });
    for (let i = 0; i < 200; i++) tickBots(w);
    const a = hashWorldDeep(w);
    w.players[4]!.energy += 1e-12;
    expect(hashWorldDeep(w)).not.toBe(a);
  });
});
