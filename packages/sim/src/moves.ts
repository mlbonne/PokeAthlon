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
import { DT, TICK_RATE, ticks } from './constants';
import { pointInPolygon } from './geometry';
import { AXIS_MAX, Button, type PlayerInput } from './input';
import { frozenPhase } from './match';
import { specialUnlocked } from './progression';
import { boostCreations, boostDashHaste, boostHitMul, boostPrimaryCooldown, boostProjectileRange, boostStatics } from './boosts';
import { fx } from './items';
import { onOwnHalf } from './stage';
import { dcos, dsin, normalize, rotateDeg, type Vec2 } from './vec';
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
  refreshOnHit: boolean;
  /** The move's cooldown is held until this buff ends. */
  cooldownAfter: boolean;
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
  /** Hit after the first player hit (piercing), or null. */
  pierceHit: MoveHit | null;
  hitIds: number[];
  ballHit: boolean;
  /** Follow-up actions when it stops (Hyperspace Hole), or null. */
  onEnd: MoveAction[] | null;
  /** Homing: target player id, -2 = the ball, -1 = none (flies straight); turn rate in rad/tick. */
  targetId: number;
  turn: number;
  /** Volley id (shots of one cast share hits), -1 = none. */
  group: number;
  /** Ticks it hovers at the end of its range before vanishing (counts down once it gets there). */
  linger: number;
}

/** A ring on the ground (OS Atlas's Cosmic Expanse): grows, and if it hit an enemy, shrinks while bouncing out what enters. */
export interface Ring {
  id: number;
  owner: number;
  team: 0 | 1;
  moveId: string;
  color: string;
  pos: Vec2;
  /** Current radius. */
  radius: number;
  startRadius: number;
  fullRadius: number;
  minRadius: number;
  /** Ticks since it was cast. */
  age: number;
  growTicks: number;
  graceTicks: number;
  shrinkTicks: number;
  repeatTicks: number;
  /** Tick (age) it latched onto an enemy and started shrinking, or -1; its radius then. */
  latchedAt: number;
  latchedRadius: number;
  hitsBall: boolean;
  hit: MoveHit;
  followHit: MoveHit;
  /** Entities already given the first hit (player ids; -1 = the ball). */
  firstHit: number[];
  /** Entities inside last tick (player ids; -1 = the ball): only new arrivals are bounced. */
  inside: number[];
  done: boolean;
}

/** A guardian zone (OS Atlas's Celestial Intervention): heals allies inside, rescues allies from KOs. */
export interface Guardian {
  id: number;
  owner: number;
  team: 0 | 1;
  moveId: string;
  color: string;
  pos: Vec2;
  radius: number;
  ticks: number;
  total: number;
  interval: number;
  /** Ticks until the next heal pulse. */
  next: number;
  healPct: number;
  rescueHealPct: number;
  /** Allies already rescued by this guardian (once each). */
  rescued: number[];
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
  /** Tracking target areas: the enemy the target point follows (-1 = none). */
  trackId: number;
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
  for (const m of p.moves) if (m.cooldown > 0 && !p.buffs.some((b) => b.cooldownAfter && b.moveId === m.def.id)) m.cooldown--;
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

/** Dash / blink / haste bonus % from the item and boosts. */
function dashHastePct(p: Player): number {
  return (fx(p)?.dashRangePct ?? 0) + boostDashHaste(p);
}
function projectileRangePct(p: Player): number {
  return (fx(p)?.projectileRangePct ?? 0) + boostProjectileRange(p);
}

/** Eject Pack's blink back to where the secondary was cast. */
const BLINK_BACK: MoveAction = { type: 'blink', delay: 0, fx: { color: '#ffd166' }, telegraph: false, to: 'mark', distance: 100000, swap: false };

const chargeMods = (def: MoveDef, scale: number) =>
  def.charge && scale !== 1 ? { power: def.charge.power ? scale : 1, range: def.charge.range ? scale : 1 } : { power: 1, range: 1 };

function startCast(world: World, p: Player, slot: number, inp: PlayerInput | undefined, scale: number): void {
  const m = p.moves[slot]!;
  const e = fx(p);
  const castRange = m.def.range * (m.def.charge?.range ? scale : 1) * (1 + projectileRangePct(p) / 100);
  const aim = aimFrom(p, inp, castRange);
  let cd = m.def.cooldown;
  if (slot === 1 && e?.secondaryCooldownPct) cd *= 1 - e.secondaryCooldownPct / 100;
  if (slot === 0) cd *= 1 - boostPrimaryCooldown(p) / 100;
  // Cooldown Rate (OS): cd × 100 / (100 + CDR).
  const cdr = boostStatics(p).cooldownRate + p.boostState.cooldownRate;
  if (cdr !== 0) cd *= 100 / Math.max(10, 100 + cdr);
  m.cooldown = ticks(cd);
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
    const trackId = action.type === 'area' && action.at === 'target' && action.track > 0 ? trackTarget(world, p, target, action.radius + 200) : -1;
    const pa = { owner: p.id, moveId, action, dir, target: trackId >= 0 ? { ...target } : target, aimDist, mark, trackId };
    // A tracking area is drawn by the client from world.pending (it moves), not as a one-off flash.
    if (action.telegraph && action.delay > 0 && trackId < 0) telegraph(world, p, pa, action);
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

/** The targetable enemy closest to `at`, within `r`, or -1. */
function trackTarget(world: World, p: Player, at: Vec2, r: number): number {
  let best = -1;
  let bestD = r * r;
  for (const o of world.players) {
    if (o.team === p.team || !isTargetable(o)) continue;
    const d = dist2(o.pos, at);
    if (d <= bestD) {
      best = o.id;
      bestD = d;
    }
  }
  return best;
}

/** Tracking target areas (Future Sight) follow their enemy. Once per tick, before stepPending. */
export function stepTracking(world: World): void {
  for (const pa of world.pending) {
    if (pa.trackId < 0 || pa.action.type !== 'area') continue;
    const o = world.players[pa.trackId];
    if (!o || o.koTicks > 0 || o.banishTicks > 0) continue;
    const dx = o.pos.x - pa.target.x;
    const dy = o.pos.y - pa.target.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const step = pa.action.track / TICK_RATE;
    pa.target = d <= step ? { ...o.pos } : { x: pa.target.x + (dx / d) * step, y: pa.target.y + (dy / d) * step };
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
  // Items and boosts: longer dashes / blinks, longer projectiles, bigger longer-lasting walls.
  const dashPct = dashHastePct(p);
  if (dashPct && (a.type === 'dash' || (a.type === 'blink' && a.to === 'aim'))) a = scaleAction(a, 1, 1 + dashPct / 100, 1);
  const projPct = projectileRangePct(p);
  if (projPct && a.type === 'projectile') a = { ...a, range: a.range * (1 + projPct / 100) };
  const cr = boostCreations(p);
  if (a.type === 'wall' && (cr.duration || cr.size)) a = { ...a, duration: a.duration * (1 + cr.duration / 100), length: a.length * (1 + cr.size / 100) };
  switch (a.type) {
    case 'projectile': {
      const n = pa.single ? 1 : a.count;
      const group = a.volleyOnce && n > 1 ? world.nextEntityId++ : -1;
      // Homing: the nearest targetable enemy (or the ball) within radius of the caster.
      let targetId = -1;
      if (a.homing) {
        let best = a.homing.radius ** 2;
        for (const o of world.players) {
          if (o.team === p.team || !isTargetable(o)) continue;
          const d2 = dist2(o.pos, p.pos);
          if (d2 <= best) {
            best = d2;
            targetId = o.id;
          }
        }
        if (a.homing.ball && a.hitsBall && !world.ball.scored && dist2(world.ball.pos, p.pos) < best) targetId = -2;
      }
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
          pierceHit: a.pierceHit ?? null,
          hitIds: [],
          ballHit: false,
          onEnd: a.onEnd ? [...a.onEnd] : null,
          targetId,
          turn: a.homing ? (a.homing.turnDeg * Math.PI) / 180 / TICK_RATE : 0,
          group,
          linger: ticks(a.linger),
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
          refreshOnHit: a.refreshOnHit,
          cooldownAfter: a.cooldownAfter,
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
    case 'ring': {
      const start = a.radius * a.startPct;
      const r: Ring = {
        id: world.nextEntityId++,
        owner: p.id,
        team: p.team,
        moveId: pa.moveId,
        color: a.fx.color,
        pos: { ...p.pos },
        radius: start,
        startRadius: start,
        fullRadius: a.radius,
        minRadius: Math.min(a.minRadius, a.radius),
        age: 0,
        growTicks: Math.max(1, ticks(a.grow)),
        graceTicks: ticks(a.grace),
        shrinkTicks: Math.max(1, ticks(a.shrink)),
        repeatTicks: Math.max(1, ticks(a.repeatEvery)),
        latchedAt: -1,
        latchedRadius: start,
        hitsBall: a.hitsBall,
        hit: a.hit,
        followHit: a.followHit,
        firstHit: [],
        inside: [],
        done: false,
      };
      world.rings.push(r);
      world.events.push({ type: 'ring', playerId: p.id, moveId: pa.moveId, pos: { ...r.pos }, radius: a.radius, color: a.fx.color });
      ringHits(world, r);
      break;
    }
    case 'guardian': {
      const pos = a.at === 'target' ? clampInside(world, p.pos, pa.target) : { ...p.pos };
      const total = ticks(a.duration);
      const g: Guardian = {
        id: world.nextEntityId++,
        owner: p.id,
        team: p.team,
        moveId: pa.moveId,
        color: a.fx.color,
        pos,
        radius: a.radius,
        ticks: total,
        total,
        interval: Math.max(1, ticks(a.interval)),
        next: 0,
        healPct: a.healPct,
        rescueHealPct: a.rescueHealPct,
        rescued: [],
      };
      world.guardians.push(g);
      world.events.push({ type: 'guardian', playerId: p.id, moveId: pa.moveId, pos: { ...pos }, radius: a.radius, time: a.duration, color: a.fx.color });
      stepGuardian(world, g); // heals on activation
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
export function clampInside(world: World, from: Vec2, to: Vec2): Vec2 {
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
      track: 0,
    };
    fireArea(world, p, { owner: p.id, moveId: c.moveId, action: area, fireTick: world.tick, dir: c.dir, target: { ...p.pos }, aimDist: 0, mark: p.pos, single: false, trackId: -1 }, area);
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

const isSpecial = (p: Player, source: string) => p.moves[2]?.def.id === source;

/** Apply a move's hit to an enemy player. */
export function hitPlayer(world: World, owner: Player, target: Player, hit: MoveHit, travel: Vec2, center: Vec2, source: string, projectile = false): void {
  const mul = boostHitMul(owner, false, isSpecial(owner, source), projectile, Math.sqrt(dist2(owner.pos, target.pos)));
  const landed = applyHit(world, owner.id, target, {
    dir: knockDir(hit, travel, center, owner, target.pos),
    knockback: hit.player ? scaled(hit.player, owner.power) * mul : 0,
    damage: hit.damage ? scaled(hit.damage, owner.power) * mul : 0,
    ...(hit.light ? { light: true } : {}),
    ...(hit.stun ? { stun: hit.stun } : {}),
    ...(hit.banish ? { banish: hit.banish } : {}),
    ...(hit.slow ? { slowPct: hit.slow.pct, slowTime: hit.slow.time } : {}),
    source,
  });
  if (landed && source !== 'passive') gainPassive(owner, 'moveHit');
}

/** Apply a move's hit to the ball (knockback or stun). */
export function hitBallWith(world: World, owner: Player, hit: MoveHit, travel: Vec2, center: Vec2, source: string, projectile = false): void {
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
  const mul = boostHitMul(owner, true, isSpecial(owner, source), projectile, Math.sqrt(dist2(owner.pos, b.pos)));
  hitBall(world, owner.id, knockDir(hit, travel, center, owner, b.pos), scaled(hit.ball, owner.power) * mul, source);
  gainEnergy(owner, hit.light ? gameplay.energy.lightHit : gameplay.energy.normalHit);
}

/** Projectiles: fly, decelerate, hit the ball / enemies, die on walls, range or speed 0. */
export function stepProjectiles(world: World): void {
  const ball = world.ball;
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const pr = world.projectiles[i]!;
    const owner = world.players[pr.owner]!;
    const travel = pr.speed * DT;
    if (pr.targetId !== -1) steerHoming(world, pr);
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
        hitBallWith(world, owner, pr.pierceHit && pr.hitIds.length > 0 ? pr.pierceHit : pr.hit, pr.dir, pr.pos, pr.moveId, true);
        if (!pr.pierce) dead = true;
      }
      for (const o of world.players) {
        if (dead) break;
        if (o.team === pr.team || !isTargetable(o) || pr.hitIds.includes(o.id)) continue;
        if (dist2(pr.pos, o.pos) > (pr.radius + o.hurtRadius) ** 2) continue;
        hitPlayer(world, owner, o, pr.pierceHit && pr.hitIds.length > 0 ? pr.pierceHit : pr.hit, pr.dir, pr.pos, pr.moveId, true);
        pr.hitIds.push(o.id);
        // Volley: the other shots of this cast won't hit them again (but still stop on them).
        if (pr.group >= 0) for (const q of world.projectiles) if (q !== pr && q.group === pr.group && !q.hitIds.includes(o.id)) q.hitIds.push(o.id);
        if (!pr.pierce) dead = true;
      }
    }
    pr.traveled += travel;
    pr.speed = Math.max(0, pr.speed - pr.decel * DT);
    // Lingering shots stop at the end of their range and hover there, still hitting, until it runs out.
    if (!dead && pr.linger > 0 && (pr.traveled >= pr.range || pr.speed <= 0)) {
      pr.speed = 0;
      pr.traveled = pr.range;
      pr.linger--;
      continue;
    }
    if (dead || pr.traveled >= pr.range || pr.speed <= 0) {
      world.projectiles.splice(i, 1);
      if (pr.onEnd) {
        const end = { ...pr.pos };
        schedule(world, owner, pr.moveId, pr.onEnd, { dir: { ...pr.dir }, target: end, aimDist: 0 }, { power: 1, range: 1 }, end);
      }
    }
  }
}

/**
 * Turn a homing projectile toward its target (player or ball) by at most its turn rate per tick.
 * Deterministic: dot/cross products and the sim's own dsin/dcos (no Math trig in the sim).
 */
function steerHoming(world: World, pr: Projectile): void {
  const tp = pr.targetId === -2 ? null : world.players[pr.targetId];
  const t = pr.targetId === -2 ? (world.ball.scored ? null : world.ball.pos) : tp && tp.koTicks === 0 && tp.banishTicks === 0 ? tp.pos : null;
  if (!t) return;
  const w = normalize({ x: t.x - pr.pos.x, y: t.y - pr.pos.y }, pr.dir);
  const dot = pr.dir.x * w.x + pr.dir.y * w.y;
  if (dot >= dcos(pr.turn)) {
    pr.dir = w;
    return;
  }
  const sgn = pr.dir.x * w.y - pr.dir.y * w.x >= 0 ? 1 : -1;
  const c = dcos(pr.turn);
  const sn = dsin(pr.turn) * sgn;
  pr.dir = normalize({ x: pr.dir.x * c - pr.dir.y * sn, y: pr.dir.x * sn + pr.dir.y * c });
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

/** Creations expire; guardians heal on their pulse, then expire. */
export function stepCreations(world: World): void {
  for (let i = world.creations.length - 1; i >= 0; i--) {
    if (--world.creations[i]!.ticks <= 0) world.creations.splice(i, 1);
  }
  for (let i = world.guardians.length - 1; i >= 0; i--) {
    const g = world.guardians[i]!;
    stepGuardian(world, g);
    if (--g.ticks <= 0) world.guardians.splice(i, 1);
  }
  for (let i = world.rings.length - 1; i >= 0; i--) {
    const r = world.rings[i]!;
    stepRing(world, r);
    if (r.done) world.rings.splice(i, 1);
  }
}

/** One tick of a ring: size, then hits. */
function stepRing(world: World, r: Ring): void {
  r.age++;
  if (r.latchedAt < 0) {
    if (r.age >= r.growTicks + r.graceTicks) {
      r.done = true;
      return;
    }
    r.radius = r.startRadius + (r.fullRadius - r.startRadius) * Math.min(1, r.age / r.growTicks);
  } else {
    // Shrinks from the size it had when it latched.
    const t = (r.age - r.latchedAt) / r.shrinkTicks;
    if (t >= 1) {
      r.done = true;
      return;
    }
    const from = r.latchedRadius;
    r.radius = from + (r.minRadius - from) * t;
  }
  ringHits(world, r);
}

/** Hits for this tick: first hits while it hasn't latched, bounces for new arrivals once it has. */
function ringHits(world: World, r: Ring): void {
  const owner = world.players[r.owner];
  if (!owner) return;
  const now: number[] = [];
  const latched = r.latchedAt >= 0;
  const repeat = latched && (r.age - r.latchedAt) % r.repeatTicks === 0 && r.age > r.latchedAt;
  for (const o of world.players) {
    if (o.team === r.team || !isTargetable(o)) continue;
    if (dist2(o.pos, r.pos) > (r.radius + o.hurtRadius) ** 2) continue;
    now.push(o.id);
    const arrived = !r.inside.includes(o.id);
    if (!latched) {
      if (r.firstHit.includes(o.id)) continue;
      r.firstHit.push(o.id);
      hitPlayer(world, owner, o, r.hit, owner.facing, r.pos, r.moveId);
    } else if (arrived || repeat) {
      hitPlayer(world, owner, o, r.followHit, owner.facing, r.pos, r.moveId);
    }
  }
  // Latches as soon as it has hit an enemy.
  if (!latched && r.firstHit.length > 0) {
    r.latchedAt = r.age;
    r.latchedRadius = r.radius;
  }
  const b = world.ball;
  if (r.hitsBall && !b.scored && dist2(b.pos, r.pos) <= (r.radius + b.radius) ** 2) {
    now.push(-1);
    if (!latched && !r.firstHit.includes(-1)) {
      r.firstHit.push(-1);
      hitBallWith(world, owner, r.hit, owner.facing, r.pos, r.moveId);
    } else if (latched && !r.inside.includes(-1)) {
      hitBallWith(world, owner, r.followHit, owner.facing, r.pos, r.moveId); // bounces off it
    }
  }
  r.inside = now;
}

/** One tick of a guardian: a heal pulse every `interval` (Elusive allies count too). */
function stepGuardian(world: World, g: Guardian): void {
  if (g.next > 0) {
    g.next--;
    return;
  }
  g.next = g.interval - 1;
  if (g.healPct <= 0) return;
  for (const o of world.players) {
    if (o.team !== g.team || o.koTicks > 0 || o.banishTicks > 0) continue;
    if (dist2(o.pos, g.pos) > (g.radius + o.hurtRadius) ** 2) continue;
    o.stagger = Math.min(o.maxStagger, o.stagger + o.maxStagger * g.healPct);
  }
}

/**
 * An ally of a standing guardian is about to be KO'd: pull them to the guardian with
 * `rescueHealPct` of their Stagger instead. Once per ally per guardian. Returns true if rescued.
 */
export function guardianRescue(world: World, p: Player): boolean {
  const g = world.guardians.find((x) => x.team === p.team && x.rescueHealPct > 0 && !x.rescued.includes(p.id));
  if (!g) return false;
  g.rescued.push(p.id);
  const from = { ...p.pos };
  p.pos = { ...g.pos };
  p.vel = { x: 0, y: 0 };
  p.knockVel = { x: 0, y: 0 };
  p.knockTicks = 0;
  p.dash = null;
  p.stagger = p.maxStagger * g.rescueHealPct;
  p.staggered = false;
  world.events.push({ type: 'rescue', playerId: p.id, by: g.owner, from, to: { ...g.pos } });
  return true;
}

/** Speed multiplier from buffs with OS diminishing returns (750–900 at 50 %, above 900 at 25 %). */
export function effectiveSpeed(p: Player): number {
  let pct = p.itemSpeedPct + p.boostState.speedPct + (p.boosts.length ? boostStatics(p).speedPct : 0);
  const haste = 1 + dashHastePct(p) / 100;
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
  const bs = p.boosts.length ? boostStatics(p) : null;
  let size = (e?.sizePct ?? 0) + (bs?.sizePct ?? 0);
  let power = (e?.powerAdd ?? 0) + (bs?.power ?? 0) + p.boostState.power;
  for (const b of p.buffs) {
    size += b.sizePct;
    power += b.powerAdd;
  }
  const k = 1 + size / 100;
  p.radius = p.baseRadius * k;
  p.hurtRadius = p.baseHurtRadius * k;
  p.strikeRadius = p.baseStrikeRadius * k;
  // Run Away: 0 Power near the edge.
  p.power = p.boostState.edgeZero ? 0 : p.basePower + power;
}

/** Clear transient move state (between rounds). Cooldowns persist. */
export function resetMoveState(world: World): void {
  world.projectiles = [];
  world.creations = [];
  world.guardians = [];
  world.rings = [];
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
