import {
  chargeScale,
  gameplay,
  getKit,
  scaleAction,
  scaled,
  type KitPassive,
  type MoveAction,
  type MoveDef,
  type MoveHit,
  type MoveSlot,
} from '@pokeathlon/data';
import { hitBall, releaseBall } from './ball';
import { applyHit, gainEnergy } from './combat';
import { DT, ticks } from './constants';
import { pointInPolygon } from './geometry';
import { AXIS_MAX, Button, type PlayerInput } from './input';
import { frozenPhase } from './match';
import { specialUnlocked } from './progression';
import { fx, itemHaste } from './items';
import { onOwnHalf } from './stage';
import { normalize, rotateDeg, type Vec2 } from './vec';
import { isTargetable, type Player, type World } from './world';

/**
 * Move engine (M3, extended in M5.1). A cast (with optional wind-up) schedules the move's actions;
 * each action fires after its delay. Actions: projectile, area (circle / cone / line, optional sweet
 * spot), dash (optionally guarded), buff (incl. transforms), wall, channel, blink, grab, throw.
 * Move-level patterns: charge-and-release, recast. Kit-level: a Strike-modifier passive.
 * Hits use the OS model through `applyHit` (players) and `hitBall` (ball).
 */

export const SLOTS: readonly MoveSlot[] = ['primary', 'secondary', 'special'];
const SLOT_BUTTONS = [Button.Move1, Button.Move2, Button.Signature] as const;

type Area = Extract<MoveAction, { type: 'area' }>;
type Channel = Extract<MoveAction, { type: 'channel' }>;

export interface MoveState {
  def: MoveDef;
  cooldown: number;
}

export interface CastState {
  slot: number;
  ticks: number;
  dir: Vec2;
  target: Vec2;
  aimDist: number;
  /** Charge multiplier (1 for normal moves). */
  scale: number;
}

/** Holding a charge move's button (charge-and-release). */
export interface ChargeState {
  slot: number;
  ticks: number;
}

/** A recast window that is open. */
export interface RecastState {
  slot: number;
  ticks: number;
  /** Where the caster stood at the first cast (`mark` blinks). */
  mark: Vec2;
}

export interface ChannelState {
  moveId: string;
  action: Channel;
  ticks: number;
  /** Ticks to the next pulse. */
  next: number;
  dir: Vec2;
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
  /** Guarded dash: resist, damage reduction and the damage it can take before breaking. */
  guard: { resist: number; reduction: number; breakAt: number; taken: number } | null;
}

export interface Buff {
  moveId: string;
  ticks: number;
  total: number;
  speedPct: number;
  decays: boolean;
  knockbackResist: number;
  damageReduction: number;
  sizePct: number;
  powerAdd: number;
  knockbackTakenPct: number;
  /** Transform: Strike also hits players with this. */
  strikeHit: MoveHit | null;
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
  /** Aim distance at cast (0 = the stick wasn't pointing at a distance). */
  aimDist: number;
  /** Cast position (for `mark` blinks). */
  mark: Vec2;
  /** For multi-shot projectiles fired one at a time. */
  single: boolean;
}

/** Moves for a Pokémon (empty if it has no kit yet). */
export function movesFor(pokemonId: string): MoveState[] {
  const kit = getKit(pokemonId);
  if (!kit) return [];
  return SLOTS.map((slot) => ({ def: kit.moves.find((m) => m.slot === slot)!, cooldown: 0 }));
}

/** The kit's Strike-modifier passive, if any. */
export function passiveFor(pokemonId: string): KitPassive | null {
  return getKit(pokemonId)?.passive ?? null;
}

const canAct = (world: World, p: Player) =>
  p.koTicks === 0 && p.knockTicks === 0 && p.stunTicks === 0 && p.banishTicks === 0 && !frozenPhase(world);

interface Aim {
  dir: Vec2;
  target: Vec2;
  aimDist: number;
}

function aimFrom(p: Player, inp: PlayerInput | undefined, range: number): Aim {
  const ax = inp ? inp.aimX / AXIS_MAX : 0;
  const ay = inp ? inp.aimY / AXIS_MAX : 0;
  const dir = Math.sqrt(ax * ax + ay * ay) > 0.05 ? normalize({ x: ax, y: ay }) : { ...p.facing };
  const aimDist = inp?.aimDist && inp.aimDist > 0 ? inp.aimDist : 0;
  const dist = range > 0 ? (aimDist > 0 ? Math.min(aimDist, range) : range) : 0;
  return { dir, target: { x: p.pos.x + dir.x * dist, y: p.pos.y + dir.y * dist }, aimDist };
}

/** Per tick: cooldowns, wind-ups, charges, channels, recasts and new casts from input. Call after movement. */
export function stepMoves(world: World, p: Player, inp: PlayerInput | undefined): void {
  for (const m of p.moves) if (m.cooldown > 0) m.cooldown--;
  if (p.recast && --p.recast.ticks <= 0) p.recast = null;

  if (p.cast) {
    if (!canAct(world, p)) p.cast = null; // interrupted
    else if (--p.cast.ticks <= 0) {
      const c = p.cast;
      p.cast = null;
      const def = p.moves[c.slot]!.def;
      schedule(world, p, def.id, def.actions, c, chargeMods(def, c.scale));
    }
  }

  if (p.charging) {
    const c = p.charging;
    const m = p.moves[c.slot]!;
    const ch = m.def.charge!;
    if (!canAct(world, p)) {
      // Interrupted: the charge is lost and the move goes on cooldown.
      p.charging = null;
      m.cooldown = ticks(m.def.cooldown);
      return;
    }
    c.ticks++;
    const held = !!inp && (inp.buttons & SLOT_BUTTONS[c.slot]!) !== 0;
    if (inp) {
      const a = aimFrom(p, inp, 0);
      p.facing = a.dir;
    }
    if (!held || c.ticks >= ticks(ch.maxHold)) {
      p.charging = null;
      startCast(world, p, c.slot, inp, chargeScale(ch.min, c.ticks / ticks(ch.time)));
    }
    return;
  }

  if (p.channel) {
    stepChannel(world, p, inp);
    return;
  }

  if (!inp || !canAct(world, p) || p.cast) return;
  if (p.dash && !p.dash.castWhileDashing) return;

  for (let slot = 0; slot < p.moves.length; slot++) {
    const bit = SLOT_BUTTONS[slot]!;
    const pressed = (inp.buttons & bit) !== 0 && (p.prevButtons & bit) === 0;
    if (!pressed) continue;
    const m = p.moves[slot]!;
    if (p.recast && p.recast.slot === slot) {
      fireRecast(world, p, slot, inp);
      break;
    }
    const back = p.itemState.blinkBack;
    if (slot === 1 && back) {
      p.itemState.blinkBack = null;
      world.events.push({ type: 'recast', playerId: p.id, moveId: `item:${p.item?.id ?? ''}` });
      schedule(world, p, `item:${p.item?.id ?? ''}`, [BLINK_BACK], { dir: { ...p.facing }, target: { ...p.pos }, aimDist: 0 }, { power: 1, range: 1 }, back.mark);
      break;
    }
    if (m.cooldown > 0) continue;
    if (m.def.slot === 'special' && !specialUnlocked(p)) continue;
    if (m.def.charge) {
      p.charging = { slot, ticks: 0 };
      if (gameplay.evade.cancelsOnStrike) p.elusiveTicks = 0;
      world.events.push({ type: 'charge', playerId: p.id, moveId: m.def.id });
      break;
    }
    startCast(world, p, slot, inp, 1);
    break;
  }
}

/** Eject Pack's blink back to where the secondary was cast. */
const BLINK_BACK: MoveAction = { type: 'blink', delay: 0, fx: { color: '#ffd166' }, telegraph: false, to: 'mark', distance: 100000, swap: false };

const chargeMods = (def: MoveDef, scale: number) =>
  def.charge && scale !== 1 ? { power: def.charge.power ? scale : 1, range: def.charge.range ? scale : 1 } : { power: 1, range: 1 };

function startCast(world: World, p: Player, slot: number, inp: PlayerInput | undefined, scale: number): void {
  const m = p.moves[slot]!;
  const e = fx(p);
  const castRange = m.def.range * (m.def.charge?.range ? scale : 1) * (e?.projectileRangePct ? 1 + e.projectileRangePct / 100 : 1);
  const aim = aimFrom(p, inp, castRange);
  m.cooldown = ticks(m.def.cooldown * (slot === 1 && e?.secondaryCooldownPct ? 1 - e.secondaryCooldownPct / 100 : 1));
  if (slot === 1 && e?.blinkBack && !m.def.recast) p.itemState.blinkBack = { ticks: ticks(e.blinkBack.window), mark: { ...p.pos } };
  p.facing = { ...aim.dir };
  if (gameplay.evade.cancelsOnStrike) p.elusiveTicks = 0;
  world.events.push({ type: 'cast', playerId: p.id, moveId: m.def.id, slot: m.def.slot });
  if (m.def.recast) p.recast = { slot, ticks: ticks(m.def.recast.window), mark: { ...p.pos } };
  const wind = ticks(m.def.castTime);
  if (wind > 0) p.cast = { slot, ticks: wind, ...aim, scale };
  else schedule(world, p, m.def.id, m.def.actions, aim, chargeMods(m.def, scale));
}

function fireRecast(world: World, p: Player, slot: number, inp: PlayerInput): void {
  const def = p.moves[slot]!.def;
  const r = p.recast!;
  p.recast = null;
  const aim = aimFrom(p, inp, def.range);
  p.facing = { ...aim.dir };
  world.events.push({ type: 'recast', playerId: p.id, moveId: def.id });
  schedule(world, p, def.id, def.recast!.actions, aim, { power: 1, range: 1 }, r.mark);
}

/** Extra actions fired from a Strike (item Strike shots). */
export function fireExtra(world: World, p: Player, sourceId: string, actions: readonly MoveAction[], dir: Vec2): void {
  schedule(world, p, sourceId, actions, { dir, target: { ...p.pos }, aimDist: 0 }, { power: 1, range: 1 });
}

/** Strike-modifier passive: the charged Strike fires the passive's actions (called by Strike). */
export function firePassive(world: World, p: Player, dir: Vec2): void {
  if (!p.passive) return;
  p.passiveStacks = 0;
  world.events.push({ type: 'passive', playerId: p.id });
  schedule(world, p, 'passive', p.passive.actions, { dir, target: { ...p.pos }, aimDist: 0 }, { power: 1, range: 1 });
}

/** A move hit an enemy (or a Strike hit the ball): passive stacks. */
export function gainPassive(p: Player, on: 'moveHit' | 'strikeBall'): void {
  if (p.passive && p.passive.gainOn === on) p.passiveStacks = Math.min(p.passive.stacks, p.passiveStacks + 1);
}

function schedule(
  world: World,
  p: Player,
  moveId: string,
  actions: readonly MoveAction[],
  aim: Aim,
  mods: { power: number; range: number },
  mark: Vec2 = { ...p.pos },
): void {
  const { dir, target, aimDist } = aim;
  for (const raw of actions) {
    const action = scaleAction(raw, mods.power, mods.range, 1);
    const base = world.tick + ticks(action.delay);
    const pa = { owner: p.id, moveId, action, dir, target, aimDist, mark };
    if (action.telegraph && action.delay > 0) telegraph(world, p, pa, action);
    if (action.type === 'projectile' && action.count > 1 && action.interval > 0) {
      for (let i = 0; i < action.count; i++) world.pending.push({ ...pa, fireTick: base + ticks(action.interval * i), single: true });
    } else if (action.type === 'area' && action.repeat > 1) {
      for (let i = 0; i < action.repeat; i++) world.pending.push({ ...pa, fireTick: base + ticks(action.repeatInterval * i), single: false });
    } else {
      world.pending.push({ ...pa, fireTick: base, single: false });
    }
  }
  // Fire anything due this very tick.
  stepPending(world);
}

/** Show where a delayed action will land. */
function telegraph(world: World, p: Player, pa: { moveId: string; dir: Vec2; target: Vec2; aimDist: number }, a: MoveAction): void {
  const base = { type: 'telegraph' as const, playerId: p.id, moveId: pa.moveId, dir: { ...pa.dir }, time: a.delay, color: a.fx.color };
  if (a.type === 'area') {
    const pos = a.at === 'target' ? { ...pa.target } : { x: p.pos.x + pa.dir.x * a.offset, y: p.pos.y + pa.dir.y * a.offset };
    world.events.push({ ...base, shape: a.shape, pos, radius: a.radius, angleDeg: a.angleDeg, length: a.length, width: a.width });
  } else if (a.type === 'blink' && a.to === 'aim') {
    const len = pa.aimDist > 0 ? Math.min(pa.aimDist, a.distance) : a.distance;
    world.events.push({ ...base, shape: 'line', pos: { ...p.pos }, radius: 0, angleDeg: 0, length: len, width: p.hurtRadius * 2 });
  } else if (a.type === 'channel') {
    world.events.push({ ...base, shape: a.shape, pos: { ...p.pos }, radius: a.radius, angleDeg: a.angleDeg, length: a.length, width: a.width });
  }
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
    if (!p || p.koTicks > 0 || p.banishTicks > 0 || frozenPhase(world)) continue;
    fire(world, p, pa);
  }
}

function fire(world: World, p: Player, pa: PendingAction): void {
  let a = pa.action;
  if (a.side) {
    const k = onOwnHalf(world.stage, p.team, p.pos) ? a.side.own : a.side.enemy;
    a = scaleAction(a, k, 1, k);
  }
  // Items: longer dashes / blinks (Eject Pack), longer projectiles (Zoom Lens).
  const e = fx(p);
  if (e?.dashRangePct && (a.type === 'dash' || (a.type === 'blink' && a.to === 'aim'))) a = scaleAction(a, 1, 1 + e.dashRangePct / 100, 1);
  if (e?.projectileRangePct && a.type === 'projectile') a = { ...a, range: a.range * (1 + e.projectileRangePct / 100) };
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
      const guarded = a.knockbackResist > 0 || a.damageReduction > 0 || a.breakOnDamage > 0;
      p.dash = {
        moveId: pa.moveId,
        vel: { x: pa.dir.x * v, y: pa.dir.y * v },
        ticks: t,
        hit: a.hit,
        stopOnHit: a.stopOnHit,
        castWhileDashing: a.castWhileDashing,
        hitIds: [],
        ballHit: false,
        guard: guarded ? { resist: a.knockbackResist, reduction: a.damageReduction, breakAt: a.breakOnDamage, taken: 0 } : null,
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
        t.buffs.push({
          moveId: pa.moveId,
          ticks: total,
          total,
          speedPct: a.speedPct,
          decays: a.decays,
          knockbackResist: a.knockbackResist,
          damageReduction: a.damageReduction,
          sizePct: a.sizePct,
          powerAdd: a.powerAdd,
          knockbackTakenPct: a.knockbackTakenPct,
          strikeHit: a.strikeHit ?? null,
        });
        refreshBody(t);
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
            if (segDist2(o.pos, wall.a, wall.b) <= (wall.r + o.hurtRadius) ** 2) hitPlayer(world, p, o, hitSpec, d, c, pa.moveId);
          }
          const b = world.ball;
          if (segDist2(b.pos, wall.a, wall.b) <= (wall.r + b.radius) ** 2) hitBallWith(world, p, hitSpec, d, c, pa.moveId);
        }
      }
      world.events.push({ type: 'wall', playerId: p.id, moveId: pa.moveId });
      break;
    }
    case 'channel':
      p.channel = { moveId: pa.moveId, action: a, ticks: ticks(a.duration), next: 0, dir: { ...pa.dir } };
      p.facing = { ...pa.dir };
      world.events.push({ type: 'channel', playerId: p.id, moveId: pa.moveId, time: a.duration });
      break;
    case 'blink':
      fireBlink(world, p, pa, a);
      break;
    case 'grab': {
      const b = world.ball;
      const free = !b.scored && b.stunTicks === 0 && b.heldBy < 0 && (b.controlBy < 0 || b.controlBy === p.id);
      const caught = free && dist2(b.pos, p.pos) <= (a.radius + b.radius) ** 2;
      if (caught) {
        b.heldBy = p.id;
        b.heldTicks = ticks(a.hold);
        b.heldDist = a.holdDistance;
        b.heldSlow = a.slowPct;
        b.heldThrow = a.throw ? scaled(a.throw, p.power) : 0;
        b.vel = { x: 0, y: 0 };
        b.launchVel = { x: 0, y: 0 };
        b.hitstop = 0;
        b.controlBy = -1;
        b.controlTicks = 0;
        b.lastHitBy = p.id;
        p.lastBallTouchTick = world.tick;
      }
      world.events.push({ type: 'grab', playerId: p.id, moveId: pa.moveId, caught });
      break;
    }
    case 'throw':
      if (world.ball.heldBy === p.id) {
        releaseBall(world, pa.dir, scaled(a.ball, p.power), pa.moveId);
        gainEnergy(p, gameplay.energy.normalHit);
      }
      break;
  }
}

function fireBlink(world: World, p: Player, pa: PendingAction, a: Extract<MoveAction, { type: 'blink' }>): void {
  const from = { ...p.pos };
  let to: Vec2 | null = null;
  let swapWith = -1;
  if (a.to === 'aim') {
    const len = pa.aimDist > 0 ? Math.min(pa.aimDist, a.distance) : a.distance;
    to = { x: from.x + pa.dir.x * len, y: from.y + pa.dir.y * len };
  } else if (a.to === 'mark') {
    to = { ...pa.mark };
  } else {
    const len = pa.aimDist > 0 ? Math.min(pa.aimDist, a.distance) : a.distance;
    const aimPt = { x: from.x + pa.dir.x * len, y: from.y + pa.dir.y * len };
    let best: Player | null = null;
    for (const o of world.players) {
      if (o.team !== p.team || o.id === p.id || o.koTicks > 0 || o.banishTicks > 0) continue;
      if (dist2(o.pos, from) > a.distance * a.distance) continue;
      if (!best || dist2(o.pos, aimPt) < dist2(best.pos, aimPt)) best = o;
    }
    if (best) {
      if (a.swap) {
        to = { ...best.pos };
        best.pos = { ...from };
        best.vel = { x: 0, y: 0 };
        swapWith = best.id;
      } else {
        const away = normalize({ x: from.x - best.pos.x, y: from.y - best.pos.y }, { x: -pa.dir.x, y: -pa.dir.y });
        const r = best.radius + p.radius + 4;
        to = { x: best.pos.x + away.x * r, y: best.pos.y + away.y * r };
      }
    }
  }
  if (!to) {
    world.events.push({ type: 'blink', playerId: p.id, moveId: pa.moveId, from, to: from, swapWith: -1 });
    return;
  }
  to = clampInside(world, from, to);
  const dir = normalize({ x: to.x - from.x, y: to.y - from.y }, pa.dir);
  if (a.hit) {
    for (const o of enemies(world, p)) {
      if (segDist2(o.pos, from, to) <= (p.radius + o.hurtRadius) ** 2) hitPlayer(world, p, o, a.hit, dir, from, pa.moveId);
    }
    const b = world.ball;
    if (!b.scored && segDist2(b.pos, from, to) <= (p.radius + b.radius) ** 2) hitBallWith(world, p, a.hit, dir, from, pa.moveId);
  }
  p.pos = to;
  p.vel = { x: 0, y: 0 };
  p.dash = null;
  p.facing = dir;
  world.events.push({ type: 'blink', playerId: p.id, moveId: pa.moveId, from, to: { ...to }, swapWith });
}

/** The furthest point from `from` toward `to` that is still inside the players' outline. */
function clampInside(world: World, from: Vec2, to: Vec2): Vec2 {
  const poly = world.stage.playerOutline;
  if (pointInPolygon(to, poly)) return to;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (pointInPolygon({ x: from.x + (to.x - from.x) * mid, y: from.y + (to.y - from.y) * mid }, poly)) lo = mid;
    else hi = mid;
  }
  return { x: from.x + (to.x - from.x) * lo, y: from.y + (to.y - from.y) * lo };
}

/** Channel: pulse the area every interval while the caster can act. */
function stepChannel(world: World, p: Player, inp: PlayerInput | undefined): void {
  const c = p.channel!;
  if (!canAct(world, p)) {
    p.channel = null;
    return;
  }
  if (c.action.follows && inp) {
    c.dir = aimFrom(p, inp, 0).dir;
    p.facing = { ...c.dir };
  }
  if (c.next <= 0) {
    const a = c.action;
    const area: Area = {
      type: 'area',
      delay: 0,
      fx: a.fx,
      telegraph: false,
      shape: a.shape,
      radius: a.radius,
      angleDeg: a.angleDeg,
      length: a.length,
      width: a.width,
      at: 'self',
      offset: 0,
      repeat: 1,
      repeatInterval: 0,
      hitsBall: a.hitsBall,
      hit: a.hit,
      allyHealPct: 0,
    };
    fireArea(world, p, { owner: p.id, moveId: c.moveId, action: area, fireTick: world.tick, dir: c.dir, target: { ...p.pos }, aimDist: 0, mark: p.pos, single: false }, area);
    c.next = ticks(a.interval);
  }
  c.next--;
  if (--c.ticks <= 0) p.channel = null;
}

function fireArea(world: World, p: Player, pa: PendingAction, a: Area): void {
  const dir = pa.dir;
  const center = a.at === 'target' ? { ...pa.target } : { x: p.pos.x + dir.x * a.offset, y: p.pos.y + dir.y * a.offset };
  const cosHalf = a.shape === 'cone' ? coneCos(a.angleDeg) : -1;
  const reachOf = a.shape === 'line' ? a.length : a.radius;
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
  // Sweet spot: the band [from, to] of the reach (and a central angle for cones).
  const sweet = a.sweetSpot;
  const sweetCos = sweet?.angleDeg ? coneCos(sweet.angleDeg) : -1;
  const hitFor = (q: Vec2): MoveHit | undefined => {
    if (!sweet || reachOf <= 0) return a.hit;
    const dx = q.x - center.x;
    const dy = q.y - center.y;
    const along = a.shape === 'line' ? dx * dir.x + dy * dir.y : Math.sqrt(dx * dx + dy * dy);
    const f = along / reachOf;
    let ok = f >= sweet.from && f <= sweet.to + 0.05;
    if (ok && a.shape === 'cone' && sweetCos > -1 && along > 1) ok = (dx * dir.x + dy * dir.y) / along >= sweetCos;
    return ok ? sweet.hit : a.hit;
  };

  if (a.hit || sweet) {
    for (const o of enemies(world, p)) {
      if (!inside(o.pos, o.hurtRadius)) continue;
      const h = hitFor(o.pos);
      if (h) hitPlayer(world, p, o, h, dir, center, pa.moveId);
    }
    const b = world.ball;
    if (a.hitsBall && !b.scored && inside(b.pos, b.radius)) {
      const h = hitFor(b.pos);
      if (h) hitBallWith(world, p, h, dir, center, pa.moveId);
    }
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
export function hitPlayer(world: World, owner: Player, target: Player, hit: MoveHit, travel: Vec2, center: Vec2, source: string): void {
  const landed = applyHit(world, owner.id, target, {
    dir: knockDir(hit, travel, center, owner, target.pos),
    knockback: hit.player ? scaled(hit.player, owner.power) : 0,
    damage: hit.damage ? scaled(hit.damage, owner.power) : 0,
    ...(hit.light ? { light: true } : {}),
    ...(hit.stun ? { stun: hit.stun } : {}),
    ...(hit.banish ? { banish: hit.banish } : {}),
    source,
  });
  if (landed && source !== 'passive') gainPassive(owner, 'moveHit');
}

/** Apply a move's hit to the ball (knockback or stun). */
export function hitBallWith(world: World, owner: Player, hit: MoveHit, travel: Vec2, center: Vec2, source: string): void {
  const b = world.ball;
  if (b.scored || b.stunTicks > 0) return;
  if (b.controlBy >= 0 && b.controlBy !== owner.id) return;
  if (b.heldBy >= 0 && b.heldBy !== owner.id) return;
  if (hit.ballStun) {
    b.stunTicks = ticks(hit.ballStun);
    b.vel = { x: 0, y: 0 };
    b.launchVel = { x: 0, y: 0 };
    b.hitstop = 0;
    b.heldBy = -1;
    owner.lastBallTouchTick = world.tick;
    world.events.push({ type: 'ballStun', playerId: owner.id, pos: { ...b.pos }, source });
    return;
  }
  if (!hit.ball) return;
  hitBall(world, owner.id, knockDir(hit, travel, center, owner, b.pos), scaled(hit.ball, owner.power), source);
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
        hitBallWith(world, owner, pr.hit, pr.dir, pr.pos, pr.moveId);
        if (!pr.pierce) dead = true;
      }
      for (const o of world.players) {
        if (dead) break;
        if (o.team === pr.team || !isTargetable(o) || pr.hitIds.includes(o.id)) continue;
        if (dist2(pr.pos, o.pos) > (pr.radius + o.hurtRadius) ** 2) continue;
        pr.hitIds.push(o.id);
        hitPlayer(world, owner, o, pr.hit, pr.dir, pr.pos, pr.moveId);
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
      hitPlayer(world, p, o, d.hit, dir, p.pos, d.moveId);
      if (d.stopOnHit) d.ticks = 1;
    }
    const b = world.ball;
    if (!d.ballHit && !b.scored && dist2(b.pos, p.pos) <= (p.radius + b.radius) ** 2) {
      d.ballHit = true;
      hitBallWith(world, p, d.hit, dir, p.pos, d.moveId);
    }
  }
  if (p.dash && --d.ticks <= 0) p.dash = null;
}

/** Transform Strike: while a buff with `strikeHit` is up, an active Strike hits enemies it touches. */
export function stepStrikeHits(world: World, p: Player): void {
  const buff = p.buffs.find((b) => b.strikeHit);
  if (!buff || p.strikeActive === 0) return;
  for (const o of enemies(world, p)) {
    if (p.strikeHitIds.includes(o.id)) continue;
    if (dist2(o.pos, p.pos) > (p.strikeRadius + o.hurtRadius) ** 2) continue;
    p.strikeHitIds.push(o.id);
    hitPlayer(world, p, o, buff.strikeHit!, p.strikeDir, p.pos, buff.moveId);
  }
}

/** Creations expire. */
export function stepCreations(world: World): void {
  for (let i = world.creations.length - 1; i >= 0; i--) {
    if (--world.creations[i]!.ticks <= 0) world.creations.splice(i, 1);
  }
}

/** Speed multiplier from buffs with OS diminishing returns (750–900 at 50 %, above 900 at 25 %). */
export function effectiveSpeed(p: Player): number {
  let pct = p.itemSpeedPct;
  const haste = itemHaste(p);
  for (const b of p.buffs) {
    const v = b.decays ? (b.speedPct * b.ticks) / b.total : b.speedPct;
    pct += b.moveId.startsWith('item:') ? v : v * haste;
  }
  const total = p.speed * (1 + pct / 100);
  if (total <= 750) return total;
  if (total <= 900) return 750 + (total - 750) * 0.5;
  return 750 + 150 * 0.5 + (total - 900) * 0.25;
}

/** Movement slow (%) from what the player is doing: charging, channelling, holding the ball. */
export function actionSlowPct(world: World, p: Player): number {
  let s = 0;
  if (p.charging) s = Math.max(s, p.moves[p.charging.slot]!.def.charge!.slowPct);
  if (p.channel) s = Math.max(s, p.channel.action.slowPct);
  if (world.ball.heldBy === p.id) s = Math.max(s, world.ball.heldSlow);
  return s;
}

export function buffKnockbackResist(p: Player): number {
  let r = p.dash?.guard?.resist ?? 0;
  for (const b of p.buffs) r += b.knockbackResist;
  return r;
}
export function buffDamageReduction(p: Player): number {
  let r = (p.dash?.guard?.reduction ?? 0) + (fx(p)?.damageReduction ?? 0);
  for (const b of p.buffs) r += b.damageReduction;
  return Math.min(0.9, r);
}
/** Extra knockback taken from transforms, as a multiplier (≥ 0.1). */
export function buffKnockbackTaken(p: Player): number {
  let pct = 0;
  for (const b of p.buffs) pct += b.knockbackTakenPct;
  return Math.max(0.1, 1 + pct / 100);
}

/** Body size and power from the base stats plus transform buffs. */
export function refreshBody(p: Player): void {
  const e = fx(p);
  let size = e?.sizePct ?? 0;
  let power = e?.powerAdd ?? 0;
  for (const b of p.buffs) {
    size += b.sizePct;
    power += b.powerAdd;
  }
  const k = 1 + size / 100;
  p.radius = p.baseRadius * k;
  p.hurtRadius = p.baseHurtRadius * k;
  p.strikeRadius = p.baseStrikeRadius * k;
  p.power = p.basePower + power;
}

/** Clear transient move state (between rounds). Cooldowns persist. */
export function resetMoveState(world: World): void {
  world.projectiles = [];
  world.creations = [];
  world.pending = [];
  for (const p of world.players) {
    p.cast = null;
    p.dash = null;
    p.charging = null;
    p.recast = null;
    p.channel = null;
    p.buffs = [];
    p.banishTicks = 0;
    p.poisons = [];
    p.itemState.momentum = 0;
    p.itemState.blinkBack = null;
    refreshBody(p);
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
