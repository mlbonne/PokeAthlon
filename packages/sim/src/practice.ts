import { gameplay } from '@pokeathlon/data';
import { startKnock } from './combat';
import { ticks } from './constants';
import { beginKickoff } from './match';
import { createTelemetry } from './telemetry';
import { addPlayer, removePlayers, spawnPosition, type Player, type World } from './world';

/**
 * Practice-mode controls (modelled on OS Practice mode, docs/research/omega-strikers.md §7a).
 * Plain functions on the world, so the F3 debug menu, tests and scripts all use the same code
 * and replays stay deterministic when they are applied at the same tick.
 */

/** Put the ball back (at `pos`, default centre), still and in play. */
export function practiceSpawnBall(world: World, pos = { x: 0, y: 0 }): void {
  const b = world.ball;
  b.pos = { ...pos };
  b.vel = { x: 0, y: 0 };
  b.launchVel = { x: 0, y: 0 };
  b.hitstop = 0;
  b.redTicks = 0;
  b.stunTicks = 0;
  b.controlBy = -1;
  b.controlTicks = 0;
  b.lastHitBy = -1;
  b.scored = false;
  if (world.match.phase === 'goal' || world.match.phase === 'kickoff') world.match.phase = 'play';
}

/** Take the ball out of play (hidden and inert, like after a goal). */
export function practiceRemoveBall(world: World): void {
  const b = world.ball;
  b.scored = true;
  b.vel = { x: 0, y: 0 };
  b.launchVel = { x: 0, y: 0 };
  b.hitstop = 0;
}

/**
 * Spawn an enemy dummy (team opposite `forTeam`), or swap the existing one's Pokémon.
 * Returns the dummy. The client decides whether it stands still or plays as a bot.
 */
export function practiceSpawnEnemy(world: World, pokemonId: string, forTeam: 0 | 1 = 0): Player {
  const team = forTeam === 0 ? 1 : 0;
  const existing = world.players.filter((p) => p.team === team);
  if (existing.length) removePlayers(world, (p) => p.team !== team);
  return addPlayer(world, { pokemonId, team });
}

/** Remove every player on `team`. */
export function practiceDestroyTeam(world: World, team: 0 | 1): void {
  removePlayers(world, (p) => p.team !== team);
}

/** All move, Strike and Evade cooldowns to zero (`ids` default: everyone). */
export function practiceClearCooldowns(world: World, ids?: number[]): void {
  for (const p of world.players) {
    if (ids && !ids.includes(p.id)) continue;
    for (const m of p.moves) m.cooldown = 0;
    p.strikeCooldown = 0;
    p.evadeCooldown = 0;
  }
}

/** Set a player's Energy to a fraction of the max (0, 0.5, 1 in OS). */
export function practiceSetEnergy(world: World, id: number, fraction: number): void {
  const p = world.players[id];
  if (p) p.energy = gameplay.energy.max * Math.max(0, Math.min(1, fraction));
}

/** Empty a player's Stagger bar: they become Staggered (OS "Stagger Self / Enemy"). */
export function practiceStagger(world: World, id: number): void {
  const p = world.players[id];
  if (!p || p.koTicks > 0) return;
  p.stagger = 0;
  if (!p.staggered) {
    p.staggered = true;
    world.events.push({ type: 'staggered', playerId: p.id, by: -1 });
  }
  p.regenDelay = ticks(gameplay.stagger.staggeredRegenDelayOnHit);
}

/** Deal `fraction` of max Stagger as damage (OS "Damage Self / Enemy"). */
export function practiceDamage(world: World, id: number, fraction = 0.25): void {
  const p = world.players[id];
  if (!p || p.koTicks > 0) return;
  p.stagger = Math.max(0, p.stagger - p.maxStagger * fraction);
  p.regenDelay = ticks(gameplay.stagger.regenDelay);
  if (p.stagger === 0) practiceStagger(world, id);
}

/**
 * Knock a player toward the nearest side edge (OS "Knock Back Self / Enemy").
 * Uses the normal knockback rules: ×3.545 if they are Staggered.
 */
export function practiceKnockBack(world: World, id: number, knockback = 400): void {
  const p = world.players[id];
  if (!p || p.koTicks > 0) return;
  const kb = p.staggered ? knockback * gameplay.knock.staggeredKnockbackMultiplier : knockback;
  startKnock(p, { x: 0, y: p.pos.y < 0 ? -1 : 1 }, kb);
  p.lastHitBy = -1;
}

/** Bring every barrier back and close both gates. */
export function practiceRestoreBarriers(world: World): void {
  for (const b of world.barriers) b.alive = true;
  for (const g of world.gates) {
    g.open = false;
    g.openTimer = -1;
  }
}

/** Remove every barrier and open both gates. */
export function practiceDisableBarriers(world: World): void {
  for (const b of world.barriers) b.alive = false;
  for (const g of world.gates) {
    g.open = true;
    g.openTimer = -1;
  }
}

export function practiceSetOvertime(world: World, on: boolean): void {
  if (world.match.overtime === on) return;
  world.match.overtime = on;
  if (on) world.events.push({ type: 'overtime' });
  else world.match.roundTicks = 0;
}

/**
 * OS "Reset All": everyone back to their spawn with full Stagger, start Energy and no cooldowns,
 * ball and barriers reset, straight into live play (no kickoff countdown).
 */
export function practiceResetAll(world: World): void {
  beginKickoff(world, false);
  world.match.phase = 'play';
  world.match.phaseTicks = 0;
  for (const p of world.players) {
    p.energy = gameplay.energy.start;
    p.evadeCooldown = 0;
    p.pos = spawnPosition(world.stage, p.team, p.role, p.slot);
  }
  practiceClearCooldowns(world);
}

/** Start the telemetry (debug meter numbers) from zero. */
export function practiceResetMeter(world: World): void {
  world.telemetry = createTelemetry(world);
}
