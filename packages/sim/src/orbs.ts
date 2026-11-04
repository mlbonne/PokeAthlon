import { gameplay } from '@pokeathlon/data';
import { gainEnergy } from './combat';
import { ticks } from './constants';
import { addXp } from './progression';
import type { Vec2 } from './vec';
import type { World } from './world';

const O = gameplay.orbs;

/**
 * Power Orbs (our "Berries"): first spawn 10 s into a round, then every 20 s; one at
 * midfield and one in each Goal Arc (one live orb per spot group). Picking one up heals
 * 7.5–30 % Stagger (more when hurt), gives XP and Energy.
 */
export function stepOrbs(world: World): void {
  const m = world.match;
  if (m.phase !== 'play') return;

  m.orbTimer--;
  if (m.orbTimer <= 0) {
    const s = world.stage;
    const pick = (list: Vec2[]): Vec2 => list[m.orbCycle % list.length]!;
    spawn(world, 'mid', pick(s.orbMid));
    spawn(world, 'arc0', pick(s.orbArc[0]));
    spawn(world, 'arc1', pick(s.orbArc[1]));
    m.orbCycle++;
    m.orbTimer = ticks(O.interval);
  }

  for (let i = world.orbs.length - 1; i >= 0; i--) {
    const orb = world.orbs[i]!;
    for (const p of world.players) {
      if (p.koTicks > 0) continue;
      const dx = p.pos.x - orb.pos.x;
      const dy = p.pos.y - orb.pos.y;
      const r = O.radius + p.radius;
      if (dx * dx + dy * dy > r * r) continue;
      const missing = 1 - p.stagger / p.maxStagger;
      p.stagger = Math.min(p.maxStagger, p.stagger + p.maxStagger * (O.healMin + (O.healMax - O.healMin) * missing));
      gainEnergy(p, O.energy);
      addXp(world, p, O.xp);
      world.orbs.splice(i, 1);
      world.events.push({ type: 'orb', id: orb.id, playerId: p.id, pos: { ...orb.pos } });
      break;
    }
  }
}

function spawn(world: World, group: string, pos: Vec2): void {
  if (world.orbs.some((o) => o.group === group)) return;
  const orb = { id: world.match.nextOrbId++, pos: { ...pos }, group };
  world.orbs.push(orb);
  world.events.push({ type: 'orbSpawn', id: orb.id, pos: { ...pos } });
}
