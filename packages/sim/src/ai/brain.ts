import { gameplay } from '@pokeathlon/data';
import { TICK_RATE } from '../constants';
import { Button, NEUTRAL_INPUT, quantizeInput, type PlayerInput } from '../input';
import { frozenPhase } from '../match';
import { randInt } from '../rng';
import type { Team } from '../stage';
import { normalize, rotateDeg, type Vec2 } from '../vec';
import { isTargetable, type Player, type World } from '../world';
import { DIFFICULTY, type Difficulty, type DifficultyParams } from './difficulty';
import type { BotMemory, Job } from './memory';
import { attacksPlayers, moveModels, type MoveModel } from './model';
import { bestKnockMove, burstKnock, finisherSpot, killLine, knockOn, moveKnock, nearestEdge, pushDir, pushValue } from './brawl';
import { bestShot, danger, evaluateShot, launchSpeed, perceive, strikeKnockback, strikeReach, type Perception } from './perceive';

/**
 * Bot brain v2 (M4.4, docs/design/M4-3v3-patch.md Part A). One brain for every Pokémon:
 * kit knowledge comes only from the move data (ai/model.ts).
 *
 * Each tick: perceive (shared ball prediction + intercept times) → team job (striker / support /
 * goalie) → where to stand → best Strike aim (goal, barrier, bank shot, pass, clear) → whether a
 * move beats a Strike right now → dodge / Energy Burst. Strike is held down all the time so it
 * auto-fires the moment the ball comes into reach (OS hold-to-strike), with the best aim.
 */
export function smartBotInput(world: World, id: number, difficulty: Difficulty = 'balance'): PlayerInput {
  const p = world.players[id];
  if (!p || p.koTicks > 0) return NEUTRAL_INPUT;
  const D = DIFFICULTY[difficulty];
  const mem = memory(world, id);
  // Hold Strike through kickoffs so live play never starts with a whiffed press.
  if (frozenPhase(world)) return quantizeInput(0, 0, p.facing.x, p.facing.y, Button.Strike);

  const perc = perceive(world);
  if (world.tick >= mem.nextDecision) {
    mem.nextDecision = world.tick + D.decisionTicks;
    mem.aimNoise = D.aimErrorDeg > 0 ? randInt(world.ai, id, -D.aimErrorDeg, D.aimErrorDeg) : 0;
    mem.patience = randInt(world.ai, id, 8, 24);
  }
  const job = teamJobs(world, p.team, perc, D)[id] ?? 'striker';

  // ---- Where to go ----
  let { target, action } = positionFor(world, p, job, perc, D);
  // Low on Stagger near an edge with enemies around: back off toward the middle.
  const near = enemies(world, p).filter((o) => dist(o.pos, p.pos) < 450);
  if (danger(world, p) > 0.9 && near.length > 0 && perc.intercept[id]!.t > 20) {
    target = { x: p.pos.x, y: p.pos.y * 0.3 };
    action = 'retreat';
  }
  // Standing where an enemy's ready knockback would send us off the arena: step off that line.
  if (action !== 'finish' && perc.intercept[id]!.t > 12) {
    const safe = killLine(world, p, D.moveSlots);
    if (safe) {
      target = { x: p.pos.x + safe.x * 260, y: p.pos.y + safe.y * 260 };
      action = `${action}·avoid`;
    }
  }

  // ---- Strike aim: re-evaluated as a touch gets close ----
  const it = perc.intercept[id]!;
  let aim = mem.aim;
  if (it.t <= 14 && !world.ball.scored) {
    const from = perc.ballAt(it.t);
    const moved = dist(from, mem.aimFrom) > 45;
    if (moved || world.tick - mem.aimTick >= 5) {
      const prev = perc.ballAt(Math.max(0, it.t - 1));
      const vel = it.t > 0 ? { x: (from.x - prev.x) * TICK_RATE, y: (from.y - prev.y) * TICK_RATE } : world.ball.vel;
      const shot = bestShot(world, p, from, vel, strikeKnockback(p));
      mem.aim = shot.dir;
      mem.aimFrom = from;
      mem.aimTick = world.tick;
      mem.aimScore = shot.score;
      action = `${action}→${shot.kind}`;
    }
    aim = mem.aim;
  }
  let strikeAim = rotateDeg(aim, mem.aimNoise);

  // ---- Strike timing (OS scrums: whoever swings second wins) ----
  // An enemy can hit the ball right now with Strike ready: don't swing first unless it's a clean
  // goal or the ball is going into our goal anyway. Wait goal-side and counter after they swing.
  const reach = strikeReach(world, p);
  const contested = enemies(world, p).some(
    (o) => o.knockTicks === 0 && o.stunTicks === 0 && o.strikeCooldown <= 3 && dist(o.pos, world.ball.pos) <= strikeReach(world, o) + 20,
  );
  const urgent = perc.pred.goalAgainst === p.team || mem.aimScore >= 100;
  // Only matters when the ball is (about to be) in our reach; otherwise holding is harmless.
  // Patience runs out (otherwise two waiting bots stare at the ball forever).
  const wantWait = contested && !urgent && p.strikeCooldown === 0 && dist(world.ball.pos, p.pos) <= reach + 30;
  if (!wantWait) mem.waitSince = -1;
  else if (mem.waitSince < 0) mem.waitSince = world.tick;
  const wait = wantWait && world.tick - mem.waitSince < mem.patience;
  let strikeBit = 0;
  if (wait) {
    mem.holding = false;
    target = goalSide(world, p, world.ball.pos, reach * 0.55);
    action = `${action}·wait`;
  } else if (mem.holding) strikeBit = Button.Strike;
  else if (dist(world.ball.pos, p.pos) <= reach - 25 || it.t > 60) {
    // Resume: press while the ball is surely in reach (a press out of reach whiffs), or re-arm when
    // the ball is so far away that the whiff's cooldown is over before it arrives.
    strikeBit = Button.Strike;
    mem.holding = true;
  }
  // Transformed (Strike hits players): brawl with Strike. Close in on the nearest enemy and swing so
  // the hit pushes them toward their nearest edge (a press needs a released button the tick before).
  if (job !== 'goalie' && p.buffs.some((b) => b.strikeHit)) {
    let foe: Player | null = null;
    for (const o of enemies(world, p)) if (isTargetable(o) && (!foe || dist(o.pos, p.pos) < dist(foe.pos, p.pos))) foe = o;
    const d = foe ? dist(foe.pos, p.pos) : Infinity;
    if (foe && d <= p.strikeRadius + foe.hurtRadius + 220 && perc.intercept[id]!.t > 10) {
      target = { x: foe.pos.x + foe.vel.x * 0.15, y: foe.pos.y + foe.vel.y * 0.15 };
      action = `${action}·maul`;
      if (d <= p.strikeRadius + foe.hurtRadius - 10 && p.strikeCooldown === 0) {
        strikeAim = nearestEdge(world, foe.pos).dir;
        strikeBit = (p.prevButtons & Button.Strike) !== 0 ? 0 : Button.Strike;
        mem.holding = false;
      }
    }
  }
  const holdingBall = world.ball.heldBy === p.id;
  if (holdingBall) {
    strikeBit = 0;
    mem.holding = false;
  }
  let buttons = strikeBit;
  let castAim: Vec2 | null = null;
  let castDist = 0;
  const SLOT_BIT = [Button.Move1, Button.Move2, Button.Signature] as const;

  // ---- Moves ----
  const inReach = dist(world.ball.pos, p.pos) <= strikeReach(world, p) + 10;
  if (p.charging && mem.chargeSlot === p.charging.slot) {
    // Charge-and-release: keep holding until full charge, re-aiming at what it was meant for.
    if (world.tick < mem.chargeUntil) {
      buttons |= SLOT_BIT[p.charging.slot]!;
      action = `${action}+charge`;
    }
    castAim = chargeAim(world, p, mem, perc) ?? mem.aim;
  } else if (holdingBall && p.recast) {
    // Grab: throw (recast) once there is a good shot, or before the hold runs out.
    const throwKb = moveModels(p.pokemonId)[p.recast.slot]?.stats.ballPower ?? 0;
    const shot = bestShot(world, p, world.ball.pos, { x: 0, y: 0 }, throwKb);
    if (shot.score > 40 || world.ball.heldTicks <= 6) {
      buttons |= SLOT_BIT[p.recast.slot]!;
      castAim = shot.dir;
      action = `${action}+throw-${shot.kind}`;
    } else castAim = shot.dir;
  } else if (D.moveSlots > 0 && !inReach && canCast(world, p)) {
    const cast = chooseCast(world, p, job, perc, D);
    if (cast) {
      buttons |= SLOT_BIT[cast.slot]!;
      castAim = rotateDeg(cast.aim, mem.aimNoise);
      castDist = cast.dist;
      action = `${action}+${cast.label}`;
      const m = moveModels(p.pokemonId)[cast.slot];
      if (m && m.charge > 0) {
        mem.chargeSlot = cast.slot;
        mem.chargeUntil = world.tick + Math.round(m.charge * TICK_RATE);
        mem.chargeKind = cast.label.includes(':ball') ? 'ball' : cast.label.includes(':hit') ? 'hit' : 'other';
      }
    }
  }

  // ---- Evade / Energy Burst ----
  const evade = D.dodges ? wantsEvade(world, p, mem, D, perc) : null;
  if (evade && (p.prevButtons & Button.Evade) === 0) {
    buttons |= Button.Evade;
    action = `${action}+${evade}`;
  } else if (!evade) {
    const out = D.dodges ? telegraphEscape(world, p) : null;
    const threat = sidestep(world, p);
    if (out) {
      target = out;
      action = `${action}·dodge-telegraph`;
    } else if (threat && D.dodges) target = threat;
  }

  mem.action = `${job}:${action}`;
  mem.target = target;
  const d = { x: target.x - p.pos.x, y: target.y - p.pos.y };
  const l = Math.sqrt(d.x * d.x + d.y * d.y);
  const mv = l > 18 ? { x: d.x / l, y: d.y / l } : { x: 0, y: 0 };
  const a = castAim ?? strikeAim;
  return quantizeInput(mv.x, mv.y, a.x, a.y, buttons, castDist);
}

// ---------------------------------------------------------------- memory & jobs

function memory(world: World, id: number): BotMemory {
  const bots = world.ai.bots;
  while (bots.length < world.players.length) bots.push(null);
  let m = bots[id];
  if (!m) {
    const p = world.players[id]!;
    const enemyGoal = world.stage.goals[p.team === 0 ? 1 : 0];
    m = {
      nextDecision: 0,
      action: '',
      target: { ...p.pos },
      aim: normalize({ x: enemyGoal.score.x - p.pos.x, y: -p.pos.y }),
      aimFrom: { x: 1e9, y: 0 },
      aimTick: -100,
      aimScore: 0,
      aimNoise: 0,
      threatSeen: -1,
      holding: true,
      waitSince: -1,
      patience: 12,
      chargeSlot: -1,
      chargeUntil: 0,
      chargeKind: 'other',
    };
    bots[id] = m;
  }
  return m;
}

/** Job per player id for `team`, refreshed every decision interval with hysteresis (A2). */
export function teamJobs(world: World, team: Team, perc: Perception, D: DifficultyParams): (Job | null)[] {
  const prev = world.ai.teams[team];
  if (prev && world.tick < prev.nextTick && prev.jobs.length === world.players.length) return prev.jobs;
  const jobs: (Job | null)[] = world.players.map(() => null);
  const members = world.players.filter((p) => p.team === team);
  const active = members.filter((p) => p.koTicks === 0);
  const t = (p: Player) => perc.intercept[p.id]!.t;
  const ownSide = world.stage.goals[team].side;
  const ballOwnHalf = world.ball.pos.x * ownSide > 0;
  const enemyBest = Math.min(Infinity, ...world.players.filter((o) => o.team !== team && o.koTicks === 0).map(t));
  const was = (p: Player, j: Job) => prev?.jobs[p.id] === j;

  if (members.length === 1) {
    const m = members[0]!;
    // Chase unless the enemy clearly gets there first while the ball is on our half.
    const slack = was(m, 'striker') ? 30 : 12;
    jobs[m.id] = !ballOwnHalf || t(m) <= enemyBest + slack ? 'striker' : 'goalie';
  } else if (active.length > 0) {
    let goalie = active.find((p) => p.role === 'goalie') ?? null;
    if (!goalie && members.length >= 3) {
      // No assigned goalie: the deepest forward guards.
      goalie = active.reduce((a, b) => (a.pos.x * ownSide > b.pos.x * ownSide ? a : b));
    }
    const forwards = active.filter((p) => p !== goalie);
    let striker = forwards.length ? forwards.reduce((a, b) => (t(a) <= t(b) ? a : b)) : null;
    const keep = forwards.find((p) => was(p, 'striker'));
    if (striker && keep && t(keep) <= t(striker) + 10) striker = keep;
    // The goalie steps up for a ball on our half it can reach clearly first; the nearest forward covers.
    if (goalie && ballOwnHalf && (!striker || t(goalie) + 20 < t(striker))) {
      const cover = striker;
      jobs[goalie.id] = 'striker';
      if (cover) jobs[cover.id] = 'goalie';
      for (const f of forwards) if (f !== cover) jobs[f.id] = 'support';
    } else {
      if (goalie) jobs[goalie.id] = 'goalie';
      for (const f of forwards) jobs[f.id] = f === striker ? 'striker' : 'support';
    }
    // In a 2-player team without a goalie, the support drops back when our goal is under threat.
    if (!goalie && members.length === 2 && perc.pred.goalAgainst === team) {
      for (const f of forwards) if (jobs[f.id] === 'support') jobs[f.id] = 'goalie';
    }
  }
  // KO'd players get no striker or goalie job (they could respawn into a stale one before the next plan).
  for (const m of members) if (jobs[m.id] === null) jobs[m.id] = m.koTicks > 0 ? 'support' : (prev?.jobs[m.id] ?? 'support');
  world.ai.teams[team] = { nextTick: world.tick + D.decisionTicks, jobs };
  return jobs;
}

// ---------------------------------------------------------------- positioning

function positionFor(world: World, p: Player, job: Job, perc: Perception, D: DifficultyParams): { target: Vec2; action: string } {
  const it = perc.intercept[p.id]!;
  const ball = world.ball;
  if (ball.scored) return { target: homeSpot(world, p), action: 'reset' };
  const enemyT = Math.min(Infinity, ...enemies(world, p).map((o) => perc.intercept[o.id]!.t));

  // Finish: an enemy one hit from going off the edge. Forwards go to the field side of them.
  // (Not when a man down, unless they're Staggered; never the goalie; never right before our touch.)
  // The striker stays on the ball unless it is far away.
  if (job !== 'goalie' && it.t > (job === 'striker' ? 60 : 25)) {
    const fin = finisherSpot(world, p, D.moveSlots);
    const short = onField(world, p.team) < onField(world, p.team === 0 ? 1 : 0);
    if (fin && (!short || fin.target.staggered)) return { target: fin.spot, action: 'finish' };
  }

  if (job === 'striker') {
    // The enemy gets there clearly first: stand goal-side of where they'll touch it, so their
    // shot runs into our Strike, instead of arriving late at the same spot.
    if (enemyT + 8 < it.t) {
      const q = perc.ballAt(Math.min(enemyT, MAX_T));
      return { target: goalSide(world, p, q, 170), action: 'shadow' };
    }
    return { target: it.pos, action: 'chase' };
  }

  if (job === 'goalie') {
    // A shot is coming: get to its path before it reaches the goal.
    if (perc.pred.goalAgainst === p.team && it.t < perc.pred.ticks) return { target: it.pos, action: 'save' };
    // A slow ball close to us that nobody else will reach first: clear it.
    if (it.t < 25 && it.t <= enemyT) return { target: it.pos, action: 'clear' };
    const orb = orbNearby(world, p, 350, it.t);
    if (orb) return { target: orb, action: 'orb' };
    return { target: guardSpot(world, p, perc), action: 'guard' };
  }

  // Support. Take the ball only when it comes to us clearly before our own striker gets it.
  const mates = world.players.filter((m) => m.team === p.team && m.id !== p.id && m.koTicks === 0);
  const mateT = Math.min(Infinity, ...mates.map((m) => perc.intercept[m.id]!.t));
  if (it.t < 22 && it.t <= enemyT + 5 && (!D.spacing || it.t + 10 < mateT)) return { target: it.pos, action: 'take' };
  const orb = orbNearby(world, p, 450, it.t);
  if (orb) return { target: orb, action: 'orb' };
  // Peel: an enemy is about to contest the ball near our striker and we can hit them.
  const contester = enemies(world, p)
    .filter((o) => perc.intercept[o.id]!.t < 40)
    .sort((a, b) => perc.intercept[a.id]!.t - perc.intercept[b.id]!.t)[0];
  if (contester && hasEngage(p, D.moveSlots) && dist(contester.pos, p.pos) < 700) {
    // Hit them from the field side so the push goes toward their nearest edge, from the move's
    // range: the support fights from outside the scrum instead of joining it.
    const edge = nearestEdge(world, contester.pos);
    const km = bestKnockMove(p, D.moveSlots);
    const standOff = D.spacing ? Math.max(230, Math.min(520, (km?.stats.reach ?? 300) * 0.75)) : 160;
    return { target: { x: contester.pos.x - edge.dir.x * standOff, y: contester.pos.y - edge.dir.y * standOff }, action: 'peel' };
  }
  // Punish a clump: two or more enemies bunched up and we hold an area hit or a Burst.
  if (D.spacing) {
    const clump = enemyClump(world, p, D.moveSlots);
    if (clump) return { target: clump, action: 'punish' };
  }
  // Spacing discipline: hold a lane well away from the scrum.
  let spot = supportSpot(world, p, perc, D.spacing);
  if (!D.spacing) return { target: spot, action: 'support' };
  const q = perc.ballAt(10);
  if (dist(spot, q) < SUPPORT_GAP) {
    const v = normalize({ x: spot.x - q.x, y: spot.y - q.y }, { x: -world.stage.goals[p.team].side, y: q.y > 0 ? -1 : 1 });
    spot = { x: clamp(q.x + v.x * SUPPORT_GAP, 1150), y: clamp(q.y + v.y * SUPPORT_GAP, 760) };
  }
  // Walk around the scrum, not through it.
  return { target: detour(p.pos, spot, q, SUPPORT_GAP - 60), action: 'support' };
}

const MAX_T = 120;
/** How far the support keeps from the ball (spacing discipline). */
const SUPPORT_GAP = 560;

/** If the straight walk from `from` to `to` passes within `r` of `obstacle`, aim for a point beside it instead. */
function detour(from: Vec2, to: Vec2, obstacle: Vec2, r: number): Vec2 {
  const ex = to.x - from.x;
  const ey = to.y - from.y;
  const l2 = ex * ex + ey * ey;
  if (l2 < 1) return to;
  const t = ((obstacle.x - from.x) * ex + (obstacle.y - from.y) * ey) / l2;
  if (t <= 0 || t >= 1) return to;
  const c = { x: from.x + ex * t, y: from.y + ey * t };
  if (dist(c, obstacle) >= r) return to;
  const side = normalize({ x: c.x - obstacle.x, y: c.y - obstacle.y }, { x: -ey, y: ex });
  return { x: clamp(obstacle.x + side.x * (r + 40), 1150), y: clamp(obstacle.y + side.y * (r + 40), 760) };
}

/** Where to stand to hit 2+ bunched enemies with a ready area move or Burst (or null). */
function enemyClump(world: World, p: Player, slots: number): Vec2 | null {
  const area = moveModels(p.pokemonId).find(
    (m) => m.slot < slots && m.delivery === 'selfArea' && m.hitsPlayers && (p.moves[m.slot]?.cooldown ?? 1) === 0 && (m.slot < 2 || p.level >= gameplay.xp.specialUnlockLevel),
  );
  const burst = p.energy >= gameplay.energy.max && p.evadeCooldown === 0;
  if (!area && !burst) return null;
  const radius = Math.max(area ? area.radius : 0, burst ? gameplay.burst.radius : 0);
  const foes = world.players.filter((o) => o.team !== p.team && isTargetable(o));
  for (const a of foes) {
    const group = foes.filter((b) => dist(a.pos, b.pos) < radius * 1.1);
    if (group.length < 2) continue;
    const c = { x: group.reduce((s, b) => s + b.pos.x, 0) / group.length, y: group.reduce((s, b) => s + b.pos.y, 0) / group.length };
    if (dist(c, p.pos) > 900) continue;
    return c;
  }
  return null;
}

const onField = (world: World, team: Team) => world.players.filter((o) => o.team === team && o.koTicks === 0).length;

/** A point `d` units from `ball` toward our own goal mouth. */
function goalSide(world: World, p: Player, ball: Vec2, d: number): Vec2 {
  const own = world.stage.goals[p.team];
  const v = normalize({ x: own.mouthX - ball.x, y: -ball.y * 0.6 }, { x: own.side, y: 0 });
  return { x: ball.x + v.x * d, y: ball.y + v.y * d };
}

/** Between the coming ball and our goal mouth, inside the Goal Arc. */
function guardSpot(world: World, p: Player, perc: Perception): Vec2 {
  const own = world.stage.goals[p.team];
  const postY = Math.abs(own.posts[0]!.y);
  const q = perc.ballAt(30);
  const mouth = { x: own.mouthX, y: 0 };
  const v = normalize({ x: q.x - mouth.x, y: q.y - mouth.y }, { x: -own.side, y: 0 });
  const out = world.gates[p.team].open ? 230 : 420;
  let x = mouth.x + v.x * out;
  // Always in front of the goal line.
  if (x * own.side > Math.abs(own.mouthX) - 140) x = own.side * (Math.abs(own.mouthX) - 140);
  const y = Math.max(-(postY - 40), Math.min(postY - 40, mouth.y + v.y * out));
  return { x, y };
}

/** Open space ahead of the ball, on the other side from the striker, for passes and rebounds. */
function supportSpot(world: World, p: Player, perc: Perception, wide = true): Vec2 {
  const enemyGoal = world.stage.goals[p.team === 0 ? 1 : 0];
  const ownSide = world.stage.goals[p.team].side;
  const q = perc.ballAt(20);
  const mates = world.players.filter((m) => m.team === p.team && m.id !== p.id && m.koTicks === 0);
  const striker = mates.reduce<Player | null>((a, m) => (!a || perc.intercept[m.id]!.t < perc.intercept[a.id]!.t ? m : a), null);
  const side = striker && striker.pos.y > q.y ? -1 : 1;
  // Power play: a man up, push higher; a man down, stay home.
  const diff = onField(world, p.team) - onField(world, p.team === 0 ? 1 : 0);
  if (q.x * ownSide > 300 || diff < 0) {
    // Ball deep on our half: cover the middle between it and our goal.
    const own = world.stage.goals[p.team];
    return { x: (q.x + own.mouthX) / 2, y: clamp(q.y * 0.5 + side * 250, 700) };
  }
  const x = q.x + (enemyGoal.score.x - q.x) * (diff > 0 ? 0.45 : 0.3);
  return { x: clamp(x, 1150), y: clamp(q.y + side * (wide ? 520 : 380), 720) };
}

function homeSpot(world: World, p: Player): Vec2 {
  const s = world.stage.spawns[p.team];
  return p.role === 'goalie' ? { ...s.goalie } : { ...s.forwards[p.slot % s.forwards.length]! };
}

function orbNearby(world: World, p: Player, range: number, myBallT: number): Vec2 | null {
  if (myBallT < 45) return null;
  let best: Vec2 | null = null;
  for (const o of world.orbs) if (dist(o.pos, p.pos) < range && (!best || dist(o.pos, p.pos) < dist(best, p.pos))) best = o.pos;
  return best;
}

// ---------------------------------------------------------------- moves

/** Aim for a charge being held: the ball, or the nearest enemy, wherever they are now. */
function chargeAim(world: World, p: Player, mem: BotMemory, perc: Perception): Vec2 | null {
  if (mem.chargeKind === 'ball' && !world.ball.scored) {
    const it = perc.intercept[p.id]!;
    const q = perc.ballAt(Math.min(20, it.t));
    return normalize({ x: q.x - p.pos.x, y: q.y - p.pos.y });
  }
  if (mem.chargeKind === 'hit') {
    let best: Player | null = null;
    for (const o of enemies(world, p)) if (isTargetable(o) && (!best || dist(o.pos, p.pos) < dist(best.pos, p.pos))) best = o;
    if (best) return normalize({ x: best.pos.x - p.pos.x, y: best.pos.y - p.pos.y });
  }
  return null;
}

function canCast(world: World, p: Player): boolean {
  if (p.cast || p.charging || p.channel || p.banishTicks > 0 || p.knockTicks > 0 || p.stunTicks > 0) return false;
  if (p.dash) return moveModels(p.pokemonId).some((m) => m.castWhile && m.id === p.dash!.moveId);
  return true;
}

const hasEngage = (p: Player, slots = 3) => moveModels(p.pokemonId).some((m, i) => i < slots && attacksPlayers(m) && (p.moves[i]?.cooldown ?? 1) === 0);

interface Cast {
  slot: number;
  aim: Vec2;
  dist: number;
  value: number;
  label: string;
}

/** Best move to use right now, or null if a Strike / walking is better (A4). */
function chooseCast(world: World, p: Player, job: Job, perc: Perception, D: DifficultyParams): Cast | null {
  let best: Cast | null = null;
  const consider = (c: Cast) => {
    if (!best || c.value > best.value) best = c;
  };
  const models = moveModels(p.pokemonId);
  const it = perc.intercept[p.id]!;
  const ball = world.ball;
  const ballDist = dist(ball.pos, p.pos);
  const foes = enemies(world, p).filter(isTargetable);
  const enemyT = Math.min(Infinity, ...enemies(world, p).map((o) => perc.intercept[o.id]!.t));

  for (const m of models) {
    if (m.slot >= D.moveSlots) continue;
    const st = p.moves[m.slot];
    if (!st || st.cooldown > 0) continue;
    if (st.def.slot === 'special' && p.level < gameplay.xp.specialUnlockLevel) continue;
    const reach = m.stats.reach;

    // Hitting the ball with the move: worth it if the push line is a good shot and a Strike isn't close.
    if (m.hitsBall && !ball.scored && it.t > 14 && (m.delivery === 'projectile' || m.delivery === 'dash' || (m.delivery === 'blink' && m.blinkTo === 'aim'))) {
      if (ballDist < reach - 30) {
        const travel = (m.speed > 0 ? ballDist / m.speed : 0) + m.delay;
        const q = perc.ballAt(Math.round(travel * TICK_RATE));
        const dir = normalize({ x: q.x - p.pos.x, y: q.y - p.pos.y });
        const prev = perc.ballAt(Math.max(0, Math.round(travel * TICK_RATE) - 1));
        const vel = { x: (q.x - prev.x) * TICK_RATE, y: (q.y - prev.y) * TICK_RATE };
        const e = evaluateShot(world, p.team, q, dir, launchSpeed(world, p, m.stats.ballPower, dir, vel), p.id);
        if (e.score > 30) consider({ slot: m.slot, aim: dir, dist: 0, value: e.score, label: `${m.id}:ball-${e.kind}` });
      }
    }

    // Hitting enemies.
    if (m.hitsPlayers && (m.delivery === 'projectile' || m.delivery === 'dash' || m.delivery === 'selfArea' || (m.delivery === 'blink' && m.blinkTo === 'aim'))) {
      let value = 0;
      let aimAt: Vec2 | null = null;
      for (const o of foes) {
        const travel = (m.speed > 0 ? dist(o.pos, p.pos) / m.speed : 0) + m.delay;
        const q = { x: o.pos.x + o.vel.x * travel, y: o.pos.y + o.vel.y * travel };
        const d = dist(q, p.pos);
        const r = m.delivery === 'selfArea' ? m.radius + o.hurtRadius - 20 : reach - 25;
        if (d > r) continue;
        const v = m.delivery === 'selfArea' ? areaValue(world, m, p, q, foes) : hitValue(world, m, p, o, q);
        if (v > value) {
          value = v;
          aimAt = q;
        }
      }
      if (aimAt && value > 0) {
        const dir = normalize({ x: aimAt.x - p.pos.x, y: aimAt.y - p.pos.y });
        // Don't knock the ball somewhere bad by accident.
        if (m.hitsBall && ballDist < reach) {
          const e = evaluateShot(world, p.team, ball.pos, dir, launchSpeed(world, p, m.stats.ballPower, dir, ball.vel), p.id);
          if (e.score < -20) value = 0;
          else value += Math.max(0, e.score) * 0.3;
        }
        if (value >= 26) consider({ slot: m.slot, aim: dir, dist: 0, value, label: `${m.id}:hit` });
      }
    }

    // Dash to close a lost race to the ball (no ball contact on the way).
    if (m.delivery === 'dash' && job === 'striker' && it.t > 45 && ballDist > reach + 60 && it.t > enemyT - 10) {
      const dir = normalize({ x: it.pos.x - p.pos.x, y: it.pos.y - p.pos.y });
      consider({ slot: m.slot, aim: dir, dist: 0, value: 30, label: `${m.id}:chase` });
    }

    // Target-placed areas: heal hurt allies, or land on enemies.
    if (m.delivery === 'targetArea') {
      for (const a of world.players) {
        if (a.team !== p.team || a.koTicks > 0 || m.heal <= 0) continue;
        const frac = a.stagger / Math.max(1, a.maxStagger);
        if (frac > 0.6 || dist(a.pos, p.pos) > m.range + m.radius * 0.5) continue;
        const q = { x: a.pos.x + a.vel.x * m.delay * 0.5, y: a.pos.y + a.vel.y * m.delay * 0.5 };
        consider({ slot: m.slot, aim: normalize({ x: q.x - p.pos.x, y: q.y - p.pos.y }), dist: Math.max(1, dist(q, p.pos)), value: 30 + 50 * (0.6 - frac), label: `${m.id}:heal` });
      }
      if (m.hitsPlayers) {
        for (const o of foes) {
          // Long delays only land on slow or Staggered targets.
          const slow = Math.sqrt(o.vel.x * o.vel.x + o.vel.y * o.vel.y) < 150 || o.staggered || o.stunTicks > 0;
          if (m.delay > 0.5 && !slow) continue;
          const q = { x: o.pos.x + o.vel.x * m.delay, y: o.pos.y + o.vel.y * m.delay };
          if (dist(q, p.pos) > m.range + m.radius * 0.6) continue;
          consider({ slot: m.slot, aim: normalize({ x: q.x - p.pos.x, y: q.y - p.pos.y }), dist: Math.max(1, dist(q, p.pos)), value: hitValue(world, m, p, o, q), label: `${m.id}:area` });
        }
      }
    }

    // Blinks: aimed ones close a lost race like a dash; ally swaps rescue a teammate in danger.
    if (m.delivery === 'blink' && m.blinkTo === 'aim' && job === 'striker' && it.t > 45 && ballDist > m.range * 0.6 && it.t > enemyT - 10) {
      const dir = normalize({ x: it.pos.x - p.pos.x, y: it.pos.y - p.pos.y });
      consider({ slot: m.slot, aim: dir, dist: Math.min(m.range, dist(it.pos, p.pos)), value: 30, label: `${m.id}:chase` });
    }
    if (m.delivery === 'blink' && m.blinkTo === 'ally') {
      for (const a of world.players) {
        if (a.team !== p.team || a.id === p.id || a.koTicks > 0 || dist(a.pos, p.pos) > m.range) continue;
        const threatened = enemies(world, a).some((o) => isTargetable(o) && dist(o.pos, a.pos) < 450);
        const aim = normalize({ x: a.pos.x - p.pos.x, y: a.pos.y - p.pos.y });
        if (danger(world, a) > 0.9 && threatened && danger(world, p) < 0.6) {
          consider({ slot: m.slot, aim, dist: Math.max(1, dist(a.pos, p.pos)), value: 45, label: `${m.id}:rescue` });
        }
        // Escape: we are the one in trouble and this ally is safe.
        const meThreatened = foes.some((o) => dist(o.pos, p.pos) < 400);
        if (danger(world, p) > 0.9 && meThreatened && !threatened && danger(world, a) < 0.5) {
          consider({ slot: m.slot, aim, dist: Math.max(1, dist(a.pos, p.pos)), value: 40, label: `${m.id}:escape` });
        }
      }
    }

    // Grab the ball: stop a shot on our goal, or take a contested ball.
    if (m.delivery === 'grab' && m.hold > 0 && !ball.scored && ball.heldBy < 0 && ballDist <= m.radius + ball.radius - 10) {
      const save = perc.pred.goalAgainst === p.team;
      const contested = enemyT < 15;
      const aim = normalize({ x: ball.pos.x - p.pos.x, y: ball.pos.y - p.pos.y });
      if (save || contested) {
        consider({ slot: m.slot, aim, dist: 0, value: save ? 85 : 45, label: `${m.id}:grab` });
      } else if (job !== 'goalie' && it.t > 20) {
        // Out of Strike range but in grab range: take it and throw if a good shot will be there.
        const shot = bestShot(world, p, ball.pos, { x: 0, y: 0 }, m.stats.ballPower);
        if (shot.score > 50) consider({ slot: m.slot, aim, dist: 0, value: 35, label: `${m.id}:grab-shot` });
      }
    }

    // Transforms (Strike hits players): when a fight is close.
    if (m.delivery === 'buff' && m.strikeBuff && job !== 'goalie') {
      const close = foes.filter((o) => dist(o.pos, p.pos) < 420);
      if (close.length > 0) consider({ slot: m.slot, aim: p.facing, dist: 0, value: close.some((o) => o.staggered) ? 60 : 36, label: `${m.id}:transform` });
    }

    // Speed buffs: win a race, or get out of trouble.
    if (m.delivery === 'buff' && m.speedPct > 0) {
      if (job === 'striker' && it.t > 40 && it.t > enemyT) consider({ slot: m.slot, aim: p.facing, dist: 0, value: 32, label: `${m.id}:race` });
      else if (danger(world, p) > 0.8 && foes.some((o) => dist(o.pos, p.pos) < 500)) consider({ slot: m.slot, aim: p.facing, dist: 0, value: 30, label: `${m.id}:escape` });
    }

    // Walls: block a shot that is heading into our goal.
    if (m.delivery === 'wall' && perc.pred.goalAgainst === p.team) {
      for (let t = 6; t < Math.min(45, perc.pred.path.length); t += 3) {
        const q = perc.pred.path[t]!;
        if (Math.abs(dist(q, p.pos) - m.wallDistance) < m.radius) {
          consider({ slot: m.slot, aim: normalize({ x: q.x - p.pos.x, y: q.y - p.pos.y }), dist: 0, value: 90, label: `${m.id}:block` });
          break;
        }
      }
    }
  }
  return best;
}

/**
 * Value of a self-centred area (circle or cone) aimed at `aim`: the sum over every enemy it covers.
 * This is what makes a clump of enemies a gift to a brawler.
 */
function areaValue(world: World, m: MoveModel, p: Player, aim: Vec2, foes: Player[]): number {
  const dir = normalize({ x: aim.x - p.pos.x, y: aim.y - p.pos.y }, p.facing);
  const cosHalf = m.angleDeg >= 360 ? -1 : rotateDeg({ x: 1, y: 0 }, m.angleDeg / 2).x;
  let v = 0;
  for (const o of foes) {
    const dx = o.pos.x - p.pos.x;
    const dy = o.pos.y - p.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > m.radius + o.hurtRadius - 20) continue;
    if (d > 1 && (dx * dir.x + dy * dir.y) / d < cosHalf) continue;
    v += hitValue(world, m, p, o, o.pos);
  }
  return v;
}

/**
 * How much hitting enemy `o` (predicted at `at`) with move `m` is worth. Edges, not damage, decide
 * fights: the value is mostly where the push leaves them (a KO is worth more than anything but a
 * goal), plus a little for damage that builds toward a Stagger.
 */
function hitValue(world: World, m: MoveModel, p: Player, o: Player, at: Vec2): number {
  const st = m.stats;
  const k = moveKnock(m);
  const kb = knockOn(world, o, k.base, k.light);
  const pv = pushValue(world, { ...o, pos: at }, pushDir(m, p, at, at), kb);
  let v = st.damagePerCast / 18 + pv * 95;
  // Pressure: damage that Staggers them (the KO setup), or adds to a fight already going.
  if (!o.staggered) {
    if (st.damagePerCast >= o.stagger) v += 40;
    else v += (30 * st.damagePerCast) / Math.max(1, o.maxStagger) + 20 * (1 - o.stagger / Math.max(1, o.maxStagger));
  }
  if (o.staggered) v += 10;
  if (st.stun > 0) v += 8;
  // Banish: takes them out of the play (more when they are near the ball).
  if (st.banish > 0) v += 18 * st.banish + (dist(o.pos, world.ball.pos) < 500 ? 20 : 0);
  return v;
}

// ---------------------------------------------------------------- evade & burst

function wantsEvade(world: World, p: Player, mem: BotMemory, D: DifficultyParams, perc: Perception): string | null {
  if (p.evadeCooldown > 0) return null;
  const E = gameplay.energy;
  // Energy Burst: several enemies close, an enemy close to an edge, or a contested ball.
  if (p.energy >= E.max) {
    const r = gameplay.burst.radius;
    const close = enemies(world, p).filter((o) => isTargetable(o) && dist(o.pos, p.pos) < r + o.hurtRadius);
    if (close.length >= 2) return 'burst';
    const kos = close.filter((o) => {
      const dir = normalize({ x: o.pos.x - p.pos.x, y: o.pos.y - p.pos.y });
      return pushValue(world, o, dir, knockOn(world, o, burstKnock(p), false)) >= 1;
    });
    if (kos.length > 0) return 'burst-ko';
    const contested = enemies(world, p).some((o) => perc.intercept[o.id]!.t < 12);
    if (dist(world.ball.pos, p.pos) < r && contested && p.strikeCooldown > 0) return 'burst-ball';
  }
  // Evade a hit that is about to land (after the reaction delay).
  const threat = incomingThreat(world, p);
  if (!threat) {
    mem.threatSeen = -1;
    return null;
  }
  if (mem.threatSeen < 0) mem.threatSeen = world.tick;
  if (world.tick - mem.threatSeen < D.reactionTicks) return null;
  const hurt = p.stagger / Math.max(1, p.maxStagger) < 0.5 || danger(world, p) > 0.5;
  if (p.energy >= E.max || (p.energy >= gameplay.evade.cost && (threat.heavy || hurt))) return 'evade';
  return null;
}

interface Threat {
  heavy: boolean;
  /** Direction the danger travels (for sidesteps). */
  dir: Vec2;
}

function incomingThreat(world: World, p: Player): Threat | null {
  for (const pr of world.projectiles) {
    if (pr.team === p.team) continue;
    const rx = p.pos.x - pr.pos.x;
    const ry = p.pos.y - pr.pos.y;
    const along = rx * pr.dir.x + ry * pr.dir.y;
    if (along <= 0 || along > pr.speed * 0.35 + 60) continue;
    const perp = Math.abs(-rx * pr.dir.y + ry * pr.dir.x);
    if (perp < pr.radius + p.hurtRadius + 15) return { heavy: !pr.hit.light, dir: pr.dir };
  }
  for (const pa of world.pending) {
    const o = world.players[pa.owner];
    if (!o || o.team === p.team || pa.action.type !== 'area' || !pa.action.hit) continue;
    if (pa.fireTick - world.tick > 14) continue;
    const a = pa.action;
    const c = a.at === 'target' ? pa.target : { x: o.pos.x + pa.dir.x * a.offset, y: o.pos.y + pa.dir.y * a.offset };
    const r = (a.shape === 'line' ? a.length : a.radius) + p.hurtRadius;
    if (dist(c, p.pos) < r) return { heavy: !a.hit?.light, dir: normalize({ x: p.pos.x - c.x, y: p.pos.y - c.y }) };
  }
  for (const o of enemies(world, p)) {
    if (!o.cast) continue;
    const m = moveModels(o.pokemonId)[o.cast.slot];
    if (m && m.hitsPlayers && dist(o.pos, p.pos) < m.stats.reach + p.hurtRadius) return { heavy: m.stats.knockback > 0, dir: o.cast.dir };
  }
  return null;
}

/**
 * Walk out of a telegraphed enemy area (visible on the ground, like a player sees it): the nearest
 * way out of the shape, as soon as it appears. Returns where to go, or null.
 */
function telegraphEscape(world: World, p: Player): Vec2 | null {
  for (const pa of world.pending) {
    const o = world.players[pa.owner];
    const a = pa.action;
    if (!o || o.team === p.team || !a.telegraph || a.type !== 'area' || !a.hit) continue;
    const c = a.at === 'target' ? pa.target : { x: o.pos.x + pa.dir.x * a.offset, y: o.pos.y + pa.dir.y * a.offset };
    if (a.shape === 'line') continue; // lines are dodged by the sidestep
    const r = a.radius + p.hurtRadius + 40;
    const d = dist(c, p.pos);
    if (d >= r) continue;
    const away = normalize({ x: p.pos.x - c.x, y: p.pos.y - c.y }, { x: 0, y: p.pos.y > 0 ? -1 : 1 });
    return { x: c.x + away.x * (r + 30), y: c.y + away.y * (r + 30) };
  }
  return null;
}

/** Step sideways out of a projectile's line. */
function sidestep(world: World, p: Player): Vec2 | null {
  const t = incomingThreat(world, p);
  if (!t) return null;
  const side = { x: -t.dir.y, y: t.dir.x };
  const s = side.x * p.pos.x + side.y * p.pos.y > 0 ? -1 : 1; // toward the middle
  return { x: p.pos.x + side.x * s * 200, y: p.pos.y + side.y * s * 200 };
}

// ---------------------------------------------------------------- helpers

const dist = (a: Vec2, b: Vec2) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
const enemies = (world: World, p: Player) => world.players.filter((o) => o.team !== p.team && o.koTicks === 0);

/** Current plan label for a bot (debug overlay). */
export function botLabel(world: World, id: number): string {
  return world.ai.bots[id]?.action ?? '';
}
