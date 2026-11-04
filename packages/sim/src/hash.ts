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
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
