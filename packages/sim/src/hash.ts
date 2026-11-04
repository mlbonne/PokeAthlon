import type { World } from './world';

/**
 * FNV-1a hash over the exact bit patterns of the world state.
 * Used by determinism tests (and later by netcode desync checks).
 */
export function hashWorld(w: World): string {
  const buf = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  const mixU32 = (n: number): void => {
    for (let i = 0; i < 4; i++) {
      h ^= (n >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  };
  const mixF64 = (f: number): void => {
    buf.setFloat64(0, f);
    mixU32(buf.getUint32(0));
    mixU32(buf.getUint32(4));
  };
  mixU32(w.tick);
  for (const p of w.players) {
    mixU32(p.id);
    mixF64(p.pos.x);
    mixF64(p.pos.y);
    mixF64(p.vel.x);
    mixF64(p.vel.y);
    mixU32(p.strikeCooldown);
    mixU32(p.strikeActive);
    mixF64(p.stagger);
    mixF64(p.energy);
    mixU32(p.knockTicks);
    mixU32(p.koTicks);
    mixU32(p.xp);
    mixU32(p.level);
  }
  const b = w.ball;
  mixF64(b.pos.x);
  mixF64(b.pos.y);
  mixF64(b.vel.x);
  mixF64(b.vel.y);
  mixU32(b.hitstop);
  mixU32(b.lastHitBy + 1);
  mixU32(b.redTicks);
  mixU32(b.controlTicks);
  for (const bar of w.barriers) mixU32(bar.alive ? 1 : 0);
  for (const g of w.gates) mixU32(g.open ? 1 : 0);
  for (const o of w.orbs) mixU32(o.id);
  const m = w.match;
  mixU32(m.goals[0]);
  mixU32(m.goals[1]);
  mixU32(m.sets[0]);
  mixU32(m.sets[1]);
  mixU32(m.roundTicks);
  return (h >>> 0).toString(16).padStart(8, '0');
}
