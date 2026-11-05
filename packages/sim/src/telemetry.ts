import { gameplay } from '@pokeathlon/data';
import { predictBall } from './ball';
import { TICK_RATE } from './constants';
import type { Team } from './stage';
import type { Player, Role, World } from './world';

/**
 * Balance telemetry, collected inside the sim from each tick's events (deterministic, JSON-safe).
 * Read it from `world.telemetry` at any time; the debug meter, recorder and batch tools all use it.
 */

/** Per move (or `strike` / `burst`) per player. */
export interface MoveTelemetry {
  /** Times used (Strike: swings). */
  casts: number;
  playerHits: number;
  ballHits: number;
  damage: number;
  knockback: number;
  /** Enemies this player KO'd within 2 s of hitting them with this move. */
  kos: number;
  /** Sum of ball launch speeds given. */
  ballSpeed: number;
  /** Goals scored within 3 s of this move being the scorer's last ball touch. */
  goals: number;
  /** Ticks of live play this move sat off cooldown, unused (Strike: not tracked). */
  readyTicks: number;
}

export interface PlayerTelemetry {
  id: number;
  pokemon: string;
  /** Held item id ('' = none). */
  item: string;
  team: Team;
  role: Role;
  damageDealt: number;
  damageTaken: number;
  knockbackDealt: number;
  knockbackTaken: number;
  hitsLanded: number;
  hitsTaken: number;
  /** Times this player was Staggered / Staggered an enemy. */
  staggered: number;
  staggersCaused: number;
  kos: number;
  deaths: number;
  goals: number;
  ownGoals: number;
  assists: number;
  barriers: number;
  /** OS "Shots": touches after which the ball, alone, would roll into the enemy goal. */
  shots: number;
  /** OS "Saves": touching an enemy shot that was on target for our goal. */
  saves: number;
  /** OS "Redirects": hits that kept the ball's speed and turned it (≤ 45° off its path). */
  redirects: number;
  ballTouches: number;
  /** Ticks of live play while this player was the last to touch the ball. */
  possessionTicks: number;
  /** Ball distance gained toward the enemy goal between this player's touch and the next touch or goal (world units, can be negative). */
  ballProgress: number;
  orbs: number;
  evades: number;
  bursts: number;
  /** World units walked/dashed/knocked while on the field. */
  distance: number;
  aliveTicks: number;
  koTicks: number;
  maxLevel: number;
  moves: Record<string, MoveTelemetry>;
}

export interface Telemetry {
  /** Ticks of live play (phase `play`). */
  playTicks: number;
  goals: [number, number];
  overtimes: number;
  players: PlayerTelemetry[];
  /** OS Core Stats: ball speed during live play, and its speed when each goal went in. */
  ball: { speedSum: number; samples: number; maxSpeed: number; goalSpeeds: number[] };
  /** The shot currently on target: who shot it and whose goal it is heading for. */
  liveShot: { by: number; against: Team } | null;
  lastBallSpeed: number;
  /** Bookkeeping (kept in the object so the collector stays a pure function of world state). */
  lastTouch: { player: number; x: number } | null;
  /** Per target: who hit them last, with what, when. */
  lastHit: ({ by: number; source: string; tick: number } | null)[];
  /** Per player: source and tick of their last ball touch. */
  lastBallSource: ({ source: string; tick: number } | null)[];
}

const KO_CREDIT_TICKS = 2 * TICK_RATE;
/** How far ahead a touch is projected to decide whether it is a shot on goal. */
const SHOT_LOOKAHEAD_TICKS = 3 * TICK_RATE;
const GOAL_CREDIT_TICKS = 3 * TICK_RATE;

export function emptyMoveTelemetry(): MoveTelemetry {
  return { casts: 0, playerHits: 0, ballHits: 0, damage: 0, knockback: 0, kos: 0, ballSpeed: 0, goals: 0, readyTicks: 0 };
}

export function playerTelemetry(p: Pick<Player, 'id' | 'pokemonId' | 'team' | 'role' | 'level'> & { item?: { id: string } | null }): PlayerTelemetry {
  return {
    id: p.id,
    pokemon: p.pokemonId,
    item: p.item?.id ?? '',
    team: p.team,
    role: p.role,
    damageDealt: 0,
    damageTaken: 0,
    knockbackDealt: 0,
    knockbackTaken: 0,
    hitsLanded: 0,
    hitsTaken: 0,
    staggered: 0,
    staggersCaused: 0,
    kos: 0,
    deaths: 0,
    goals: 0,
    ownGoals: 0,
    assists: 0,
    barriers: 0,
    shots: 0,
    saves: 0,
    redirects: 0,
    ballTouches: 0,
    possessionTicks: 0,
    ballProgress: 0,
    orbs: 0,
    evades: 0,
    bursts: 0,
    distance: 0,
    aliveTicks: 0,
    koTicks: 0,
    maxLevel: p.level,
    moves: {},
  };
}

export function createTelemetry(world: Pick<World, 'players'>): Telemetry {
  return {
    playTicks: 0,
    goals: [0, 0],
    overtimes: 0,
    players: world.players.map(playerTelemetry),
    ball: { speedSum: 0, samples: 0, maxSpeed: 0, goalSpeeds: [] },
    liveShot: null,
    lastBallSpeed: 0,
    lastTouch: null,
    lastHit: world.players.map(() => null),
    lastBallSource: world.players.map(() => null),
  };
}

function move(t: PlayerTelemetry, source: string): MoveTelemetry {
  return (t.moves[source] ??= emptyMoveTelemetry());
}

/** Ball progress toward the toucher's enemy goal, credited to the last toucher. */
function closeTouch(world: World, tel: Telemetry, endX: number): void {
  const lt = tel.lastTouch;
  if (!lt) return;
  const p = world.players[lt.player];
  const t = tel.players[lt.player];
  if (p && t) {
    const enemySide = world.stage.goals[p.team === 0 ? 1 : 0].side;
    t.ballProgress += (endX - lt.x) * enemySide;
  }
  tel.lastTouch = null;
}

/**
 * Fold this tick's events and per-tick state into the telemetry. Called at the end of `step()`.
 * `prevPos` holds each player's position at the start of the tick (for distance travelled).
 */
export function collectTelemetry(world: World, prevPos: readonly { x: number; y: number }[]): void {
  const tel = world.telemetry;
  const tick = world.tick;
  const shotBefore = tel.liveShot;
  let toucher = -1;
  for (const e of world.events) {
    switch (e.type) {
      case 'strike':
        move(tel.players[e.playerId]!, 'strike').casts++;
        break;
      case 'cast':
        move(tel.players[e.playerId]!, e.moveId).casts++;
        break;
      case 'ballHit': {
        const t = tel.players[e.playerId];
        if (!t) break;
        t.ballTouches++;
        if (e.redirect) t.redirects++;
        toucher = e.playerId;
        const m = move(t, e.source);
        m.ballHits++;
        m.ballSpeed += e.speed;
        tel.lastBallSource[e.playerId] = { source: e.source, tick };
        closeTouch(world, tel, e.pos.x);
        tel.lastTouch = { player: e.playerId, x: e.pos.x };
        break;
      }
      case 'ballStun': {
        const t = tel.players[e.playerId];
        if (t) move(t, e.source).ballHits++;
        break;
      }
      case 'hit': {
        const a = tel.players[e.attacker];
        const d = tel.players[e.target];
        if (a) {
          a.damageDealt += e.damage;
          a.knockbackDealt += e.knockback;
          a.hitsLanded++;
          const m = move(a, e.source);
          m.playerHits++;
          m.damage += e.damage;
          m.knockback += e.knockback;
        }
        if (d) {
          d.damageTaken += e.damage;
          d.knockbackTaken += e.knockback;
          d.hitsTaken++;
        }
        tel.lastHit[e.target] = { by: e.attacker, source: e.source, tick };
        break;
      }
      case 'staggered': {
        tel.players[e.playerId]!.staggered++;
        const by = tel.players[e.by];
        if (by) by.staggersCaused++;
        break;
      }
      case 'ko': {
        tel.players[e.playerId]!.deaths++;
        const by = tel.players[e.by];
        if (by && e.by !== e.playerId) {
          by.kos++;
          const lh = tel.lastHit[e.playerId];
          if (lh && lh.by === e.by && tick - lh.tick <= KO_CREDIT_TICKS) move(by, lh.source).kos++;
        }
        break;
      }
      case 'barrierBreak': {
        const t = tel.players[e.by];
        if (t) t.barriers++;
        break;
      }
      case 'goal': {
        tel.goals[e.team]++;
        tel.ball.goalSpeeds.push(tel.lastBallSpeed);
        tel.liveShot = null;
        toucher = -1;
        closeTouch(world, tel, e.pos.x);
        const s = tel.players[e.scorer];
        if (s) {
          if (e.ownGoal) s.ownGoals++;
          else {
            s.goals++;
            const src = tel.lastBallSource[e.scorer];
            if (src && tick - src.tick <= GOAL_CREDIT_TICKS) move(s, src.source).goals++;
          }
        }
        for (const a of e.assists) {
          const t = tel.players[a];
          if (t) t.assists++;
        }
        break;
      }
      case 'kickoff':
        tel.lastTouch = null;
        tel.liveShot = null;
        toucher = -1;
        break;
      case 'overtime':
        tel.overtimes++;
        break;
      case 'orb':
        tel.players[e.playerId]!.orbs++;
        break;
      case 'evade':
        tel.players[e.playerId]!.evades++;
        break;
      case 'burst':
        tel.players[e.playerId]!.bursts++;
        break;
      case 'levelUp': {
        const t = tel.players[e.playerId]!;
        t.maxLevel = Math.max(t.maxLevel, e.level);
        break;
      }
      default:
        break;
    }
  }

  // Shots and saves: judge the last touch of this tick by where the ball would go on its own.
  if (toucher >= 0) {
    const p = world.players[toucher]!;
    const t = tel.players[toucher]!;
    if (shotBefore && shotBefore.against === p.team) t.saves++;
    const enemy = p.team === 0 ? 1 : 0;
    const pred = predictBall(world, SHOT_LOOKAHEAD_TICKS);
    if (pred.goalAgainst === enemy) {
      t.shots++;
      tel.liveShot = { by: toucher, against: enemy };
    } else tel.liveShot = null;
  }

  const live = world.match.phase === 'play';
  if (live) tel.playTicks++;
  const b = world.ball;
  if (live && !b.scored) {
    const v = b.hitstop > 0 ? b.launchVel : b.vel;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y);
    tel.ball.speedSum += speed;
    tel.ball.samples++;
    if (speed > tel.ball.maxSpeed) tel.ball.maxSpeed = speed;
    tel.lastBallSpeed = speed;
  }
  for (const p of world.players) {
    const t = tel.players[p.id]!;
    if (p.koTicks > 0) {
      t.koTicks++;
      continue;
    }
    t.aliveTicks++;
    const prev = prevPos[p.id];
    if (prev) {
      const dx = p.pos.x - prev.x;
      const dy = p.pos.y - prev.y;
      // Respawns teleport; don't count jumps larger than any real movement in one tick.
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 200) t.distance += d;
    }
    if (live && world.ball.lastHitBy === p.id) t.possessionTicks++;
    if (live) {
      for (const m of p.moves) {
        if (m.cooldown === 0 && (m.def.slot !== 'special' || p.level >= gameplay.xp.specialUnlockLevel)) move(t, m.def.id).readyTicks++;
      }
    }
  }
}

/** Per-role set-MVP score (OS awards one MVP per role). Weights are provisional. */
export function mvpScore(t: PlayerTelemetry): { forward: number; goalie: number } {
  const attack = t.goals * 3 + t.assists * 2 + t.kos * 1.5 + t.shots * 0.5 + t.damageDealt / 1000;
  return { forward: attack, goalie: t.saves * 2 + attack * 0.5 };
}
