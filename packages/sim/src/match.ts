import { gameplay } from '@pokeathlon/data';
import { ticks } from './constants';
import { resetMoveState } from './moves';
import { addXp } from './progression';
import type { Team } from './stage';
import { spawnPosition, type World } from './world';

const M = gameplay.match;

/**
 * Reset everything that resets between rounds (OS): barriers, gates, positions, Stagger,
 * statuses, orbs, the ball. Energy resets only between sets. Then start the kickoff countdown.
 */
export function beginKickoff(world: World, nextRound: boolean): void {
  const m = world.match;
  if (nextRound) m.roundIndex++;
  for (const b of world.barriers) b.alive = true;
  for (const g of world.gates) {
    g.open = false;
    g.openTimer = -1;
  }
  const spot = world.stage.ballSpawns[m.roundIndex % world.stage.ballSpawns.length]!;
  const b = world.ball;
  b.pos = { ...spot };
  b.vel = { x: 0, y: 0 };
  b.launchVel = { x: 0, y: 0 };
  b.hitstop = 0;
  b.redTicks = 0;
  b.controlBy = -1;
  b.controlTicks = 0;
  b.scored = false;
  b.lastHitBy = -1;

  for (const p of world.players) {
    p.pos = spawnPosition(world.stage, p.team, p.role, p.slot);
    p.vel = { x: 0, y: 0 };
    p.facing = { x: p.team === 0 ? 1 : -1, y: 0 };
    p.koTicks = 0;
    p.knockTicks = 0;
    p.knockVel = { x: 0, y: 0 };
    p.stunTicks = 0;
    p.slowTicks = 0;
    p.elusiveTicks = 0;
    p.immuneTicks = 0;
    p.strikeActive = 0;
    p.strikeCooldown = 0;
    p.burstBoostTicks = 0;
    p.stagger = p.maxStagger;
    p.staggered = false;
    p.regenDelay = 0;
    p.lastHitBy = -1;
  }
  world.orbs = [];
  resetMoveState(world);
  b.stunTicks = 0;
  m.orbTimer = ticks(gameplay.orbs.first);
  m.roundTicks = 0;
  m.overtime = false;
  m.phase = 'kickoff';
  m.phaseTicks = ticks(M.kickoff);
  world.events.push({ type: 'kickoff', round: m.roundIndex, set: m.setIndex });
}

/** Called by the ball when it overlaps a score volume. */
export function scoreGoal(world: World, team: Team): void {
  const m = world.match;
  if (!m.rulesEnabled || m.phase !== 'play') return;
  const b = world.ball;
  m.goals[team]++;
  m.lastScoringTeam = team;
  b.scored = true;
  b.vel = { x: 0, y: 0 };
  b.launchVel = { x: 0, y: 0 };
  b.hitstop = 0;

  const last = world.players[b.lastHitBy];
  const ownGoal = !last || last.team !== team;
  const scorer = last ? last.id : -1;
  const window = ticks(M.assistWindow);
  const assists = world.players
    .filter((p) => p.team === team && p.id !== scorer && p.lastBallTouchTick >= 0 && world.tick - p.lastBallTouchTick <= window)
    .map((p) => p.id);
  if (last && !ownGoal) {
    last.stats.goals++;
    addXp(world, last, gameplay.xp.goal);
  }
  for (const id of assists) {
    const p = world.players[id]!;
    p.stats.assists++;
    addXp(world, p, gameplay.xp.assist);
  }
  world.events.push({ type: 'goal', team, scorer, assists, pos: { ...b.pos }, ownGoal });
  m.phase = 'goal';
  m.phaseTicks = ticks(M.goalPause);
}

/** Start-of-tick: gate timers and kickoff countdown. */
export function stepMatchStart(world: World): void {
  for (const g of world.gates) {
    if (g.openTimer > 0) {
      g.openTimer--;
      if (g.openTimer === 0) {
        g.open = true;
        g.openTimer = -1;
        world.events.push({ type: 'gateOpen', team: g.team });
      }
    }
  }
  const m = world.match;
  if (m.phase === 'kickoff') {
    m.phaseTicks--;
    if (m.phaseTicks <= 0) {
      m.phase = 'play';
      world.events.push({ type: 'play' });
    }
  }
}

/** End-of-tick: overtime clock and post-goal / post-set transitions. */
export function stepMatchEnd(world: World): void {
  const m = world.match;
  if (!m.rulesEnabled) return;
  if (m.phase === 'play') {
    m.roundTicks++;
    if (!m.overtime && m.roundTicks >= ticks(M.overtimeAfter)) {
      m.overtime = true;
      world.events.push({ type: 'overtime' });
    }
    return;
  }
  if (m.phase === 'goal') {
    m.phaseTicks--;
    if (m.phaseTicks > 0) return;
    const team = m.lastScoringTeam as Team;
    if (m.goals[team] >= M.goalsPerSet) {
      m.sets[team]++;
      world.events.push({ type: 'setWon', team, sets: [m.sets[0], m.sets[1]] });
      if (m.sets[team] >= M.setsToWin) {
        m.phase = 'matchOver';
        m.winner = team;
        world.events.push({ type: 'matchWon', team });
      } else {
        m.phase = 'setOver';
        m.phaseTicks = ticks(M.setPause);
      }
    } else {
      beginKickoff(world, true);
    }
    return;
  }
  if (m.phase === 'setOver') {
    m.phaseTicks--;
    if (m.phaseTicks > 0) return;
    m.goals = [0, 0];
    m.setIndex++;
    for (const p of world.players) p.energy = gameplay.energy.start;
    beginKickoff(world, true);
  }
}

/** Phases where players can't act (frozen). */
export const frozenPhase = (world: World): boolean =>
  world.match.phase === 'kickoff' || world.match.phase === 'setOver' || world.match.phase === 'matchOver';
