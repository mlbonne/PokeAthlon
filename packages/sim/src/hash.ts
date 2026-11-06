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
    mixU32(p.banishTicks);
    mixU32(p.passiveStacks);
    mixU32(p.charging ? p.charging.ticks + 1 : 0);
    mixU32(p.channel ? p.channel.ticks + 1 : 0);
    mixU32(p.recast ? p.recast.ticks + 1 : 0);
    mixF64(p.power);
    mixF64(p.radius);
    mixF64(p.itemSpeedPct);
    mixU32(p.itemState.momentum);
    mixU32(p.itemState.strikeShotCd);
    mixU32(p.poisons.length);
    mixU32(p.itemActive ? 1 : 0);
    mixU32(p.boosts.length);
    mixU32(p.boostState.moxie);
    mixU32(p.boostState.unhit);
    mixF64(p.maxStagger);
  }
  if (w.draft) {
    mixU32(w.draft.turn);
    mixU32(w.draft.ticks);
    mixU32(w.draft.offers.length);
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
  mixU32(b.heldBy + 1);
  mixU32(b.heldTicks);
  for (const bar of w.barriers) mixU32(bar.alive ? 1 : 0);
  for (const g of w.gates) mixU32(g.open ? 1 : 0);
  for (const o of w.orbs) mixU32(o.id);
  for (const pr of w.projectiles) {
    mixU32(pr.id);
    mixF64(pr.pos.x);
    mixF64(pr.pos.y);
  }
  for (const c of w.creations) mixU32(c.id + c.ticks);
  mixU32(b.stunTicks);
  for (const p of w.players) for (const m of p.moves) mixU32(m.cooldown);
  const m = w.match;
  mixU32(m.goals[0]);
  mixU32(m.goals[1]);
  mixU32(m.sets[0]);
  mixU32(m.sets[1]);
  mixU32(m.roundTicks);
  for (const r of w.ai.rng) mixU32(r);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Hash of the WHOLE match state (everything but the static stage and last tick's events), for
 * netcode desync checks. Slower than {@link hashWorld} (about 1 ms), so it runs about once a second.
 * Numbers are written in their shortest exact form, so equal hashes mean bit-equal states.
 */
export function hashWorldDeep(w: World): string {
  const json = JSON.stringify(w, (k, v: unknown) => (k === 'stage' || k === 'events' ? undefined : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
