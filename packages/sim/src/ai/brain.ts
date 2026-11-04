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
import { moveModels, type MoveModel } from './model';
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
  let { target, action } = positionFor(world, p, job, perc);
  // Low on Stagger near an edge with enemies around: back off toward the middle.
  const near = enemies(world, p).filter((o) => dist(o.pos, p.pos) < 450);
  if (danger(world, p) > 0.9 && near.length > 0 && perc.intercept[id]!.t > 20) {
    target = { x: p.pos.x, y: p.pos.y * 0.3 };
    action = 'retreat';
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
  const strikeAim = rotateDeg(aim, mem.aimNoise);

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
  let buttons = strikeBit;
  let castAim: Vec2 | null = null;
  let castDist = 0;

  // ---- Moves ----
  const inReach = dist(world.ball.pos, p.pos) <= strikeReach(world, p) + 10;
  if (D.moveSlots > 0 && !inReach && canCast(world, p)) {
    const cast = chooseCast(world, p, job, perc, D);
    if (cast) {
      buttons |= [Button.Move1, Button.Move2, Button.Signature][cast.slot]!;
      castAim = rotateDeg(cast.aim, mem.aimNoise);
      castDist = cast.dist;
      action = `${action}+${cast.label}`;
    }
  }

  // ---- Evade / Energy Burst ----
  const evade = D.dodges ? wantsEvade(world, p, mem, D, perc) : null;
  if (evade && (p.prevButtons & Button.Evade) === 0) {
    buttons |= Button.Evade;
    action = `${action}+${evade}`;
  } else if (!evade) {
    const threat = sidestep(world, p);
    if (threat && D.dodges) target = threat;
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
  for (const m of members) if (jobs[m.id] === null) jobs[m.id] = prev?.jobs[m.id] ?? 'support';
  world.ai.teams[team] = { nextTick: world.tick + D.decisionTicks, jobs };
  return jobs;
}

// ---------------------------------------------------------------- positioning

function positionFor(world: World, p: Player, job: Job, perc: Perception): { target: Vec2; action: string } {
  const it = perc.intercept[p.id]!;
  const ball = world.ball;
  if (ball.scored) return { target: homeSpot(world, p), action: 'reset' };
  const enemyT = Math.min(Infinity, ...enemies(world, p).map((o) => perc.intercept[o.id]!.t));

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

  // Support.
  if (it.t < 22 && it.t <= enemyT + 5) return { target: it.pos, action: 'take' };
  const orb = orbNearby(world, p, 450, it.t);
  if (orb) return { target: orb, action: 'orb' };
  // Peel: an enemy is about to contest the ball near our striker and we can hit them.
  const contester = enemies(world, p)
    .filter((o) => perc.intercept[o.id]!.t < 40)
    .sort((a, b) => perc.intercept[a.id]!.t - perc.intercept[b.id]!.t)[0];
  if (contester && hasEngage(p) && dist(contester.pos, p.pos) < 700) {
    const toward = normalize({ x: p.pos.x - contester.pos.x, y: p.pos.y - contester.pos.y });
    return { target: { x: contester.pos.x + toward.x * 160, y: contester.pos.y + toward.y * 160 }, action: 'peel' };
  }
  return { target: supportSpot(world, p, perc), action: 'support' };
}

const MAX_T = 120;

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
function supportSpot(world: World, p: Player, perc: Perception): Vec2 {
  const enemyGoal = world.stage.goals[p.team === 0 ? 1 : 0];
  const ownSide = world.stage.goals[p.team].side;
  const q = perc.ballAt(20);
  const mates = world.players.filter((m) => m.team === p.team && m.id !== p.id && m.koTicks === 0);
  const striker = mates.reduce<Player | null>((a, m) => (!a || perc.intercept[m.id]!.t < perc.intercept[a.id]!.t ? m : a), null);
  const side = striker && striker.pos.y > q.y ? -1 : 1;
  if (q.x * ownSide > 300) {
    // Ball deep on our half: cover the middle between it and our goal.
    const own = world.stage.goals[p.team];
    return { x: (q.x + own.mouthX) / 2, y: clamp(q.y * 0.5 + side * 250, 700) };
  }
  const x = q.x + (enemyGoal.score.x - q.x) * 0.3;
  return { x: clamp(x, 1150), y: clamp(q.y + side * 380, 720) };
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

function canCast(world: World, p: Player): boolean {
  if (p.cast || p.knockTicks > 0 || p.stunTicks > 0) return false;
  if (p.dash) return moveModels(p.pokemonId).some((m) => m.castWhile && m.id === p.dash!.moveId);
  return true;
}

const hasEngage = (p: Player) => moveModels(p.pokemonId).some((m, i) => m.hitsPlayers && (p.moves[i]?.cooldown ?? 1) === 0);

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
    if (m.hitsBall && !ball.scored && it.t > 14 && (m.delivery === 'projectile' || m.delivery === 'dash')) {
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
    if (m.hitsPlayers && (m.delivery === 'projectile' || m.delivery === 'dash' || m.delivery === 'selfArea')) {
      let value = 0;
      let aimAt: Vec2 | null = null;
      for (const o of foes) {
        const travel = (m.speed > 0 ? dist(o.pos, p.pos) / m.speed : 0) + m.delay;
        const q = { x: o.pos.x + o.vel.x * travel, y: o.pos.y + o.vel.y * travel };
        const d = dist(q, p.pos);
        const r = m.delivery === 'selfArea' ? m.radius + o.hurtRadius - 20 : reach - 25;
        if (d > r) continue;
        const v = hitValue(world, m, o);
        if (m.aimed || m.delivery !== 'selfArea') {
          if (v > value) {
            value = v;
            aimAt = q;
          }
        } else {
          value += v; // circles hit everyone inside
          aimAt ??= q;
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
        if (value >= 28) consider({ slot: m.slot, aim: dir, dist: 0, value, label: `${m.id}:hit` });
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
          consider({ slot: m.slot, aim: normalize({ x: q.x - p.pos.x, y: q.y - p.pos.y }), dist: Math.max(1, dist(q, p.pos)), value: hitValue(world, m, o), label: `${m.id}:area` });
        }
      }
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

/** How much hitting enemy `o` with move `m` is worth (damage, KO chance, Stagger). */
function hitValue(world: World, m: MoveModel, o: Player): number {
  const st = m.stats;
  // Damage alone rarely wins; it matters when it sets up a KO.
  let v = st.damagePerCast / 18;
  if (st.knockback > 0 || o.staggered) v += danger(world, o) * 45;
  if (o.staggered) v += 15;
  if (st.stun > 0) v += 8;
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
    if (close.some((o) => danger(world, o) > 0.6)) return 'burst-ko';
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
