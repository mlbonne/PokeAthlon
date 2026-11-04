import { gameplay, scaled } from '@pokeathlon/data';
import { pointInPolygon } from '../geometry';
import { buffKnockbackResist } from '../moves';
import { inGoalArc } from '../stage';
import { normalize, type Vec2 } from '../vec';
import { isTargetable, type Player, type World } from '../world';
import { moveModels, type MoveModel } from './model';

/**
 * Brawling knowledge for the bots (brawling rework, docs/design/brawling-rework.md §3b).
 * OS fights are about edges, not damage: a KO happens when a knock carries a player past the arena
 * outline. These helpers predict where a hit pushes someone, find the spot to hit them from so the
 * push goes toward the nearest edge, and tell a bot when it is standing in someone else's kill line.
 */

/** Nearest point of the players' outline (the KO edge) to `pos`. */
export function nearestEdge(world: World, pos: Vec2): { point: Vec2; dist: number; dir: Vec2 } {
  let best = { point: pos, dist: Infinity };
  for (const s of world.stage.playerWalls) {
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((pos.x - s.ax) * ex + (pos.y - s.ay) * ey) / l2));
    const q = { x: s.ax + ex * t, y: s.ay + ey * t };
    const d = Math.sqrt((q.x - pos.x) ** 2 + (q.y - pos.y) ** 2);
    if (d < best.dist) best = { point: q, dist: d };
  }
  return { ...best, dir: normalize({ x: best.point.x - pos.x, y: best.point.y - pos.y }) };
}

/** Is `pos` outside the arena outline (a KO if a knocked player ends there)? */
export const outside = (world: World, pos: Vec2): boolean => !pointInPolygon(pos, world.stage.playerOutline);

/** Knockback distance a hit of `base` player knockback deals to `o` right now (Staggered, Goal Arc, buffs). */
export function knockOn(world: World, o: Player, base: number, light: boolean): number {
  const K = gameplay.knock;
  if (o.staggered) return base * K.staggeredKnockbackMultiplier * K.distancePerKnockback;
  if (light) return 0;
  let resist = buffKnockbackResist(o);
  if (inGoalArc(world.stage, o.team, o.pos)) resist += K.goalArcResist;
  return Math.max(0, base - resist) * K.distancePerKnockback;
}

/** Player knockback of one hit of a move (before target modifiers), and whether it is LIGHT. */
export function moveKnock(m: MoveModel): { base: number; light: boolean } {
  // The analyzer's staggeredKnockback = base × 3.545 also covers LIGHT hits.
  return { base: m.stats.staggeredKnockback / gameplay.knock.staggeredKnockbackMultiplier, light: m.stats.knockback === 0 };
}

/** Energy Burst knockback for `p`. */
export const burstKnock = (p: Player): number => scaled(gameplay.burst.playerKnockback, p.power);

/**
 * Value of pushing `o` a distance `kb` along `dir`: 1 = a KO, otherwise how close it leaves them
 * to an edge (0 … 0.8).
 */
export function pushValue(world: World, o: Player, dir: Vec2, kb: number): number {
  if (kb <= 0) return 0;
  const end = { x: o.pos.x + dir.x * kb, y: o.pos.y + dir.y * kb };
  if (outside(world, end)) return 1;
  const e = nearestEdge(world, end).dist;
  return Math.max(0, 0.8 * (1 - e / 450));
}

/** Push direction of move `m` cast by `p` aimed at point `aim`, onto a target at `t`. */
export function pushDir(m: MoveModel, p: Player, aim: Vec2, t: Vec2): Vec2 {
  const travel = normalize({ x: aim.x - p.pos.x, y: aim.y - p.pos.y }, p.facing);
  if (m.push === 'radial') {
    const c = m.delivery === 'targetArea' ? aim : p.pos;
    return normalize({ x: t.x - c.x, y: t.y - c.y }, travel);
  }
  if (m.push === 'pull') return normalize({ x: p.pos.x - t.x, y: p.pos.y - t.y }, travel);
  return travel;
}

/** Best ready move of `p` for knocking players, or null. */
export function bestKnockMove(p: Player): MoveModel | null {
  let best: MoveModel | null = null;
  for (const m of moveModels(p.pokemonId)) {
    const st = p.moves[m.slot];
    if (!st || st.cooldown > 0 || !m.hitsPlayers) continue;
    if (st.def.slot === 'special' && p.level < gameplay.xp.specialUnlockLevel) continue;
    if (!best || m.stats.staggeredKnockback > best.stats.staggeredKnockback) best = m;
  }
  return best;
}

/**
 * A finishing opportunity: an enemy that one hit from `p` can knock off the arena from the
 * field side. Returns where to stand and who, or null.
 */
export function finisherSpot(world: World, p: Player): { target: Player; spot: Vec2; value: number } | null {
  const m = bestKnockMove(p);
  const burst = p.energy >= gameplay.energy.max && p.evadeCooldown === 0;
  if (!m && !burst) return null;
  let best: { target: Player; spot: Vec2; value: number } | null = null;
  for (const o of world.players) {
    if (o.team === p.team || !isTargetable(o)) continue;
    const d = Math.sqrt((o.pos.x - p.pos.x) ** 2 + (o.pos.y - p.pos.y) ** 2);
    if (d > 900) continue;
    const edge = nearestEdge(world, o.pos);
    // Knock straight toward the nearest edge from the opposite side.
    const kbMove = m ? knockOn(world, o, moveKnock(m).base, moveKnock(m).light) : 0;
    const kbBurst = burst ? knockOn(world, o, burstKnock(p), false) : 0;
    const kb = Math.max(kbMove, kbBurst);
    if (kb <= 0) continue;
    const v = pushValue(world, o, edge.dir, kb * 0.9);
    if (v < 1) continue;
    const reach = kbMove >= kbBurst && m ? Math.min(m.stats.reach * 0.6, 260) : gameplay.burst.radius * 0.6;
    const spot = { x: o.pos.x - edge.dir.x * reach, y: o.pos.y - edge.dir.y * reach };
    if (outside(world, spot)) continue;
    const value = 100 - d / 20 + (o.staggered ? 20 : 0);
    if (!best || value > best.value) best = { target: o, spot, value };
  }
  return best;
}

/**
 * Is `p` standing in a kill line: could an enemy's ready knockback (or Burst) push it off the
 * arena from where they are? Returns the direction to step (toward safety), or null.
 */
export function killLine(world: World, p: Player): Vec2 | null {
  for (const o of world.players) {
    if (o.team === p.team || o.koTicks > 0 || o.knockTicks > 0 || o.stunTicks > 0) continue;
    const m = bestKnockMove(o);
    const burst = o.energy >= gameplay.energy.max && o.evadeCooldown === 0;
    const reachM = m ? m.stats.reach + p.hurtRadius : 0;
    const reachB = burst ? gameplay.burst.radius + p.hurtRadius : 0;
    const d = Math.sqrt((o.pos.x - p.pos.x) ** 2 + (o.pos.y - p.pos.y) ** 2);
    if (d > Math.max(reachM, reachB) + 120) continue;
    const dir = normalize({ x: p.pos.x - o.pos.x, y: p.pos.y - o.pos.y });
    const kb = Math.max(m ? knockOn(world, p, moveKnock(m).base, moveKnock(m).light) : 0, burst ? knockOn(world, p, burstKnock(o), false) : 0);
    if (kb <= 0) continue;
    const end = { x: p.pos.x + dir.x * kb * 1.1, y: p.pos.y + dir.y * kb * 1.1 };
    if (!outside(world, end)) continue;
    // Step inward, away from the edge and off the line.
    const edge = nearestEdge(world, p.pos);
    return normalize({ x: -edge.dir.x - dir.x * 0.5, y: -edge.dir.y - dir.y * 0.5 });
  }
  return null;
}
