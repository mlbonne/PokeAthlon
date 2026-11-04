import { gameplay, getKit, scaled, type MoveAction, type MoveDef, type MoveHit, type MoveSlot } from '@pokeathlon/data';
import { hitBall } from './ball';
import { applyHit, gainEnergy } from './combat';
import { DT, ticks } from './constants';
import { pointInPolygon } from './geometry';
import { AXIS_MAX, Button, type PlayerInput } from './input';
import { frozenPhase } from './match';
import { specialUnlocked } from './progression';
import { normalize, rotateDeg, type Vec2 } from './vec';
import { isTargetable, type Player, type World } from './world';

/**
 * M3 move engine. A cast (with optional wind-up) schedules the move's actions; each action
 * fires after its delay. Actions: projectile, area (circle / cone / line), dash, buff, wall.
 * Hits use the OS model through `applyHit` (players) and `hitBall` (ball).
 */

export const SLOTS: readonly MoveSlot[] = ['primary', 'secondary', 'special'];
const SLOT_BUTTONS = [Button.Move1, Button.Move2, Button.Signature] as const;

export interface MoveState {
  def: MoveDef;
  cooldown: number;
}

export interface CastState {
  slot: number;
  ticks: number;
  dir: Vec2;
  target: Vec2;
}

export interface DashState {
  moveId: string;
  vel: Vec2;
  ticks: number;
  hit: MoveHit | undefined;
  stopOnHit: boolean;
  castWhileDashing: boolean;
  hitIds: number[];
  ballHit: boolean;
}

export interface Buff {
  moveId: string;
  ticks: number;
  total: number;
  speedPct: number;
  decays: boolean;
  knockbackResist: number;
  damageReduction: number;
}

export interface Projectile {
  id: number;
  owner: number;
  team: 0 | 1;
  moveId: string;
  color: string;
  pos: Vec2;
  dir: Vec2;
  speed: number;
  decel: number;
  traveled: number;
  range: number;
  radius: number;
  pierce: boolean;
  hitsBall: boolean;
  hit: MoveHit;
  hitIds: number[];
  ballHit: boolean;
}

/** A creation wall: a capsule (segment + radius) that blocks players, the ball and projectiles. */
export interface Creation {
  id: number;
  owner: number;
  team: 0 | 1;
  moveId: string;
  color: string;
  a: Vec2;
  b: Vec2;
  r: number;
  ticks: number;
}

export interface PendingAction {
  owner: number;
  moveId: string;
  action: MoveAction;
  fireTick: number;
  dir: Vec2;
  target: Vec2;
  /** For multi-shot projectiles fired one at a time. */
  single: boolean;
}

/** Moves for a Pokémon (empty if it has no kit yet). */
export function movesFor(pokemonId: string): MoveState[] {
  const kit = getKit(pokemonId);
  if (!kit) return [];
  return SLOTS.map((slot) => ({ def: kit.moves.find((m) => m.slot === slot)!, cooldown: 0 }));
}

const canAct = (world: World, p: Player) =>
  p.koTicks === 0 && p.knockTicks === 0 && p.stunTicks === 0 && !frozenPhase(world);

/** Per tick: cooldowns, wind-ups and new casts from input. Call after movement. */
export function stepMoves(world: World, p: Player, inp: PlayerInput | undefined): void {
  for (const m of p.moves) if (m.cooldown > 0) m.cooldown--;

  if (p.cast) {
    if (!canAct(world, p)) p.cast = null; // interrupted
    else if (--p.cast.ticks <= 0) {
      const c = p.cast;
      p.cast = null;
      schedule(world, p, p.moves[c.slot]!.def, c.dir, c.target);
    }
  }
  if (!inp || !canAct(world, p) || p.cast) return;
  if (p.dash && !p.dash.castWhileDashing) return;

  for (let slot = 0; slot < p.moves.length; slot++) {
    const bit = SLOT_BUTTONS[slot]!;
    const pressed = (inp.buttons & bit) !== 0 && (p.prevButtons & bit) === 0;
    if (!pressed) continue;
    const m = p.moves[slot]!;
    if (m.cooldown > 0) continue;
    if (m.def.slot === 'special' && !specialUnlocked(p)) continue;
    startCast(world, p, slot, inp);
    break;
  }
}

function startCast(world: World, p: Player, slot: number, inp: PlayerInput): void {
  const m = p.moves[slot]!;
  const ax = inp.aimX / AXIS_MAX;
  const ay = inp.aimY / AXIS_MAX;
  const dir = Math.sqrt(ax * ax + ay * ay) > 0.05 ? normalize({ x: ax, y: ay }) : { ...p.facing };
  const range = m.def.range;
  const dist = range > 0 ? (inp.aimDist && inp.aimDist > 0 ? Math.min(inp.aimDist, range) : range) : 0;
  const target = { x: p.pos.x + dir.x * dist, y: p.pos.y + dir.y * dist };
  m.cooldown = ticks(m.def.cooldown);
  p.facing = { ...dir };
  if (gameplay.evade.cancelsOnStrike) p.elusiveTicks = 0;
  world.events.push({ type: 'cast', playerId: p.id, moveId: m.def.id, slot: m.def.slot });
  const wind = ticks(m.def.castTime);
  if (wind > 0) p.cast = { slot, ticks: wind, dir, target };
  else schedule(world, p, m.def, dir, target);
}

function schedule(world: World, p: Player, def: MoveDef, dir: Vec2, target: Vec2): void {
  for (const action of def.actions) {
    const base = world.tick + ticks(action.delay);
    if (action.type === 'projectile' && action.count > 1 && action.interval > 0) {
      for (let i = 0; i < action.count; i++) {
        world.pending.push({ owner: p.id, moveId: def.id, action, fireTick: base + ticks(action.interval * i), dir, target, single: true });
      }
    } else if (action.type === 'area' && action.repeat > 1) {
      for (let i = 0; i < action.repeat; i++) {
        world.pending.push({ owner: p.id, moveId: def.id, action, fireTick: base + ticks(action.repeatInterval * i), dir, target, single: false });
      }
    } else {
      world.pending.push({ owner: p.id, moveId: def.id, action, fireTick: base, dir, target, single: false });
    }
  }
  // Fire anything due this very tick.
  stepPending(world);
}

/** Fire due actions (in scheduling order). */
export function stepPending(world: World): void {
  for (let i = 0; i < world.pending.length; ) {
    const pa = world.pending[i]!;
    if (pa.fireTick > world.tick) {
      i++;
      continue;
    }
    world.pending.splice(i, 1);
    const p = world.players[pa.owner];
    if (!p || p.koTicks > 0 || frozenPhase(world)) continue;
    fire(world, p, pa);
  }
}

function fire(world: World, p: Player, pa: PendingAction): void {
  const a = pa.action;
  switch (a.type) {
    case 'projectile': {
      const n = pa.single ? 1 : a.count;
      for (let i = 0; i < n; i++) {
        const off = n > 1 ? -a.spreadDeg / 2 + (a.spreadDeg * i) / (n - 1) : 0;
        const d = off !== 0 ? rotateDeg(pa.dir, off) : pa.dir;
        world.projectiles.push({
          id: world.nextEntityId++,
          owner: p.id,
          team: p.team,
          moveId: pa.moveId,
          color: a.fx.color,
          pos: { x: p.pos.x + d.x * p.radius, y: p.pos.y + d.y * p.radius },
          dir: { ...d },
          speed: a.speed,
          decel: a.decel,
          traveled: 0,
          range: a.range,
          radius: a.radius,
          pierce: a.pierce,
          hitsBall: a.hitsBall,
          hit: a.hit,
          hitIds: [],
          ballHit: false,
        });
      }
      break;
    }
    case 'area':
      fireArea(world, p, pa, a);
      break;
    case 'dash': {
      const t = ticks(a.time);
      const v = a.distance / a.time;
      p.dash = {
        moveId: pa.moveId,
        vel: { x: pa.dir.x * v, y: pa.dir.y * v },
        ticks: t,
        hit: a.hit,
        stopOnHit: a.stopOnHit,
        castWhileDashing: a.castWhileDashing,
        hitIds: [],
        ballHit: false,
      };
      p.facing = { ...pa.dir };
      world.events.push({ type: 'dash', playerId: p.id, moveId: pa.moveId });
      break;
    }
    case 'buff': {
      const targets = a.target === 'self' ? [p] : world.players.filter((o) => o.team === p.team && o.koTicks === 0 && dist2(o.pos, p.pos) <= a.radius * a.radius);
      for (const t of targets) {
        const total = ticks(a.duration);
        t.buffs = t.buffs.filter((b) => b.moveId !== pa.moveId); // refresh, don't stack the same move
        t.buffs.push({ moveId: pa.moveId, ticks: total, total, speedPct: a.speedPct, decays: a.decays, knockbackResist: a.knockbackResist, damageReduction: a.damageReduction });
        if (a.healPct > 0) t.stagger = Math.min(t.maxStagger, t.stagger + t.maxStagger * a.healPct);
        world.events.push({ type: 'buff', playerId: t.id, moveId: pa.moveId });
      }
      break;
    }
    case 'wall': {
      const perp = (d: Vec2) => ({ x: -d.y, y: d.x });
      for (let i = 0; i < a.count; i++) {
        const off = a.count > 1 ? -a.spreadDeg / 2 + (a.spreadDeg * i) / (a.count - 1) : 0;
        const d = off !== 0 ? rotateDeg(pa.dir, off) : pa.dir;
        const c = { x: p.pos.x + d.x * a.distance, y: p.pos.y + d.y * a.distance };
        const n = perp(d);
        const h = a.length / 2;
        const wall: Creation = {
          id: world.nextEntityId++,
          owner: p.id,
          team: p.team,
          moveId: pa.moveId,
          color: a.fx.color,
          a: { x: c.x + n.x * h, y: c.y + n.y * h },
          b: { x: c.x - n.x * h, y: c.y - n.y * h },
          r: a.thickness / 2,
          ticks: ticks(a.duration),
        };
        world.creations.push(wall);
        if (a.hit) {
          const hitSpec = a.hit;
          for (const o of enemies(world, p)) {
            if (segDist2(o.pos, wall.a, wall.b) <= (wall.r + o.hurtRadius) ** 2) hitPlayer(world, p, o, hitSpec, d, c);
          }
          const b = world.ball;
          if (segDist2(b.pos, wall.a, wall.b) <= (wall.r + b.radius) ** 2) hitBallWith(world, p, hitSpec, d, c);
        }
      }
      world.events.push({ type: 'wall', playerId: p.id, moveId: pa.moveId });
      break;
    }
  }
}

function fireArea(world: World, p: Player, pa: PendingAction, a: Extract<MoveAction, { type: 'area' }>): void {
  const dir = pa.dir;
  const center = a.at === 'target' ? { ...pa.target } : { x: p.pos.x + dir.x * a.offset, y: p.pos.y + dir.y * a.offset };
  const cosHalf = a.shape === 'cone' ? coneCos(a.angleDeg) : -1;
  const inside = (q: Vec2, r: number): boolean => {
    const dx = q.x - center.x;
    const dy = q.y - center.y;
    if (a.shape === 'line') {
      const along = dx * dir.x + dy * dir.y;
      const perp = -dx * dir.y + dy * dir.x;
      return along >= -r && along <= a.length + r && Math.abs(perp) <= a.width / 2 + r;
    }
    const d2 = dx * dx + dy * dy;
    if (d2 > (a.radius + r) * (a.radius + r)) return false;
    if (a.shape === 'cone') {
      const d = Math.sqrt(d2);
      if (d <= r) return true; // touching the apex
      return (dx * dir.x + dy * dir.y) / d >= cosHalf;
    }
    return true;
  };

  if (a.hit) {
    for (const o of enemies(world, p)) if (inside(o.pos, o.hurtRadius)) hitPlayer(world, p, o, a.hit, dir, center);
    const b = world.ball;
    if (a.hitsBall && !b.scored && inside(b.pos, b.radius)) hitBallWith(world, p, a.hit, dir, center);
  }
  if (a.allyHealPct > 0) {
    for (const o of world.players) {
      if (o.team === p.team && o.koTicks === 0 && inside(o.pos, o.hurtRadius)) {
        o.stagger = Math.min(o.maxStagger, o.stagger + o.maxStagger * a.allyHealPct);
      }
    }
  }
  world.events.push({
    type: 'area',
    playerId: p.id,
    moveId: pa.moveId,
    shape: a.shape,
    pos: center,
    dir: { ...dir },
    radius: a.radius,
    angleDeg: a.angleDeg,
    length: a.length,
    width: a.width,
    color: a.fx.color,
  });
}

/** cos(angle/2) for a cone of `angleDeg`, computed deterministically. */
function coneCos(angleDeg: number): number {
  return rotateDeg({ x: 1, y: 0 }, angleDeg / 2).x;
}

function enemies(world: World, p: Player): Player[] {
  return world.players.filter((o) => o.team !== p.team && isTargetable(o));
}

function knockDir(hit: MoveHit, travel: Vec2, center: Vec2, owner: Player, target: Vec2): Vec2 {
  if (hit.direction === 'radial') return normalize({ x: target.x - center.x, y: target.y - center.y }, travel);
  if (hit.direction === 'pull') return normalize({ x: owner.pos.x - target.x, y: owner.pos.y - target.y }, travel);
  return travel;
}

/** Apply a move's hit to an enemy player. */
export function hitPlayer(world: World, owner: Player, target: Player, hit: MoveHit, travel: Vec2, center: Vec2): void {
  applyHit(world, owner.id, target, {
    dir: knockDir(hit, travel, center, owner, target.pos),
    knockback: hit.player ? scaled(hit.player, owner.power) : 0,
    damage: hit.damage ? scaled(hit.damage, owner.power) : 0,
    ...(hit.light ? { light: true } : {}),
    ...(hit.stun ? { stun: hit.stun } : {}),
  });
}

/** Apply a move's hit to the ball (knockback or stun). */
export function hitBallWith(world: World, owner: Player, hit: MoveHit, travel: Vec2, center: Vec2): void {
  const b = world.ball;
  if (b.scored || b.stunTicks > 0) return;
  if (b.controlBy >= 0 && b.controlBy !== owner.id) return;
  if (hit.ballStun) {
    b.stunTicks = ticks(hit.ballStun);
    b.vel = { x: 0, y: 0 };
    b.launchVel = { x: 0, y: 0 };
    b.hitstop = 0;
    owner.lastBallTouchTick = world.tick;
    world.events.push({ type: 'ballStun', playerId: owner.id, pos: { ...b.pos } });
    return;
  }
  if (!hit.ball) return;
  hitBall(world, owner.id, knockDir(hit, travel, center, owner, b.pos), scaled(hit.ball, owner.power));
  gainEnergy(owner, hit.light ? gameplay.energy.lightHit : gameplay.energy.normalHit);
}

/** Projectiles: fly, decelerate, hit the ball / enemies, die on walls, range or speed 0. */
export function stepProjectiles(world: World): void {
  const ball = world.ball;
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const pr = world.projectiles[i]!;
    const owner = world.players[pr.owner]!;
    const travel = pr.speed * DT;
    const n = Math.max(1, Math.min(6, Math.ceil(travel / pr.radius)));
    let dead = false;
    for (let s = 0; s < n && !dead; s++) {
      pr.pos = { x: pr.pos.x + (pr.dir.x * travel) / n, y: pr.pos.y + (pr.dir.y * travel) / n };
      if (!pointInPolygon(pr.pos, world.stage.ballOutline) || blocked(world, pr.pos, pr.radius)) {
        dead = true;
        break;
      }
      if (pr.hitsBall && !pr.ballHit && !ball.scored && dist2(pr.pos, ball.pos) <= (pr.radius + ball.radius) ** 2) {
        pr.ballHit = true;
        hitBallWith(world, owner, pr.hit, pr.dir, pr.pos);
        if (!pr.pierce) dead = true;
      }
      for (const o of world.players) {
        if (dead) break;
        if (o.team === pr.team || !isTargetable(o) || pr.hitIds.includes(o.id)) continue;
        if (dist2(pr.pos, o.pos) > (pr.radius + o.hurtRadius) ** 2) continue;
        pr.hitIds.push(o.id);
        hitPlayer(world, owner, o, pr.hit, pr.dir, pr.pos);
        if (!pr.pierce) dead = true;
      }
    }
    pr.traveled += travel;
    pr.speed = Math.max(0, pr.speed - pr.decel * DT);
    if (dead || pr.traveled >= pr.range || pr.speed <= 0) world.projectiles.splice(i, 1);
  }
}

/** Solid things projectiles stop on: standing barriers, closed gates, creation walls. */
function blocked(world: World, p: Vec2, r: number): boolean {
  for (const bar of world.barriers) {
    if (bar.alive && Math.abs(p.x - bar.box.x) <= bar.box.hx + r && Math.abs(p.y - bar.box.y) <= bar.box.hy + r) return true;
  }
  for (const g of world.gates) {
    const gb = world.stage.goals[g.team].gate;
    if (!g.open && Math.abs(p.x - gb.x) <= gb.hx + r && Math.abs(p.y - gb.y) <= gb.hy + r) return true;
  }
  for (const c of world.creations) if (segDist2(p, c.a, c.b) <= (c.r + r) ** 2) return true;
  return false;
}

/** Dash step: replaces walking. Hits enemies and the ball it touches (once each). */
export function stepDash(world: World, p: Player): void {
  const d = p.dash!;
  p.pos = { x: p.pos.x + d.vel.x * DT, y: p.pos.y + d.vel.y * DT };
  p.vel = { x: 0, y: 0 };
  const dir = normalize(d.vel);
  if (d.hit) {
    for (const o of enemies(world, p)) {
      if (d.hitIds.includes(o.id)) continue;
      if (dist2(o.pos, p.pos) > (p.radius + o.hurtRadius) ** 2) continue;
      d.hitIds.push(o.id);
      hitPlayer(world, p, o, d.hit, dir, p.pos);
      if (d.stopOnHit) d.ticks = 1;
    }
    const b = world.ball;
    if (!d.ballHit && !b.scored && dist2(b.pos, p.pos) <= (p.radius + b.radius) ** 2) {
      d.ballHit = true;
      hitBallWith(world, p, d.hit, dir, p.pos);
    }
  }
  if (--d.ticks <= 0) p.dash = null;
}

/** Creations expire. */
export function stepCreations(world: World): void {
  for (let i = world.creations.length - 1; i >= 0; i--) {
    if (--world.creations[i]!.ticks <= 0) world.creations.splice(i, 1);
  }
}

/** Speed multiplier from buffs with OS diminishing returns (750–900 at 50 %, above 900 at 25 %). */
export function effectiveSpeed(p: Player): number {
  let pct = 0;
  for (const b of p.buffs) pct += b.decays ? (b.speedPct * b.ticks) / b.total : b.speedPct;
  const total = p.speed * (1 + pct / 100);
  if (total <= 750) return total;
  if (total <= 900) return 750 + (total - 750) * 0.5;
  return 750 + 150 * 0.5 + (total - 900) * 0.25;
}

export function buffKnockbackResist(p: Player): number {
  let r = 0;
  for (const b of p.buffs) r += b.knockbackResist;
  return r;
}
export function buffDamageReduction(p: Player): number {
  let r = 0;
  for (const b of p.buffs) r += b.damageReduction;
  return Math.min(0.9, r);
}

/** Clear transient move state (between rounds). Cooldowns persist. */
export function resetMoveState(world: World): void {
  world.projectiles = [];
  world.creations = [];
  world.pending = [];
  for (const p of world.players) {
    p.cast = null;
    p.dash = null;
    p.buffs = [];
  }
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const l2 = ex * ex + ey * ey;
  let t = l2 > 0 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = p.x - (a.x + ex * t);
  const dy = p.y - (a.y + ey * t);
  return dx * dx + dy * dy;
}
