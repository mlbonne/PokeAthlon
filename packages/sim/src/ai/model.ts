import { getKit, getPokemon, type KitDef, type MoveDef } from '@pokeathlon/data';
import { analyzeMove, type MoveStats } from '@pokeathlon/data/analyze';

/**
 * How a bot understands a move: built from the kit JSON and the static analyzer, never from
 * per-Pokémon code (docs/design/M4-3v3-patch.md, A4). Any new kit works with the same brain.
 */
export interface MoveModel {
  slot: number;
  id: string;
  stats: MoveStats;
  /** Main delivery: what the bot has to aim. */
  delivery: 'projectile' | 'dash' | 'selfArea' | 'targetArea' | 'buff' | 'wall' | 'blink' | 'grab';
  /** Cone or line (aimed at a target) vs circle around the caster. */
  aimed: boolean;
  /** Projectile / dash speed (units/s) for leading the target; 0 = instant. */
  speed: number;
  /** Seconds from the press until the effect lands (wind-up + delay). */
  delay: number;
  /** Max aim distance for target-placed areas. */
  range: number;
  /** Area radius around the caster or the target point. */
  radius: number;
  hitsBall: boolean;
  hitsPlayers: boolean;
  /** Fraction of an ally's Stagger it heals (target areas). */
  heal: number;
  /** Speed buff % (self or allies). */
  speedPct: number;
  /** Wall distance in front of the caster. */
  wallDistance: number;
  /** Can other moves be cast during it (dash). */
  castWhile: boolean;
  /** Which way its hit pushes players: along the aim, away from the centre, or toward the caster. */
  push: 'travel' | 'radial' | 'pull';
  /** Cone full angle (cone areas), 360 for circles, 0 otherwise. */
  angleDeg: number;
  // ---- M5.1 mechanics ----
  /** Seconds to hold for a full charge (0 = not a charge move). */
  charge: number;
  /** Has a recast. */
  recast: boolean;
  /** Blink destination kind (blinks only). */
  blinkTo: 'aim' | 'ally' | 'mark' | null;
  /** Ally blinks swap places. */
  swap: boolean;
  /** Seconds a grab holds the ball. */
  hold: number;
  /** Transform buff: Strike hits players while it is up. */
  strikeBuff: boolean;
  /** A channel (the caster keeps casting for `duration`). */
  channel: boolean;
}

/** Keyed by the kit object, so a kit installed at runtime (tests, drafts) gets fresh models. */
const cache = new WeakMap<KitDef, MoveModel[]>();
const NONE: MoveModel[] = [];

/** Move models for a Pokémon, in slot order (empty if it has no kit). */
export function moveModels(pokemonId: string): MoveModel[] {
  const kit = getKit(pokemonId);
  if (!kit) return NONE;
  const hit = cache.get(kit);
  if (hit) return hit;
  const def = getPokemon(pokemonId);
  const slots = ['primary', 'secondary', 'special'] as const;
  const models = slots.map((slot, i) => model(kit.moves.find((m) => m.slot === slot)!, i, def));
  cache.set(kit, models);
  return models;
}

function model(def: MoveDef, slot: number, p: ReturnType<typeof getPokemon>): MoveModel {
  const stats = analyzeMove(def, p);
  // The action that decides how to aim: the first one that hits something, else the first.
  const main = def.actions.find((a) => 'hit' in a && a.hit) ?? def.actions[0]!;
  const m: MoveModel = {
    slot,
    id: def.id,
    stats,
    delivery: 'buff',
    aimed: true,
    speed: 0,
    delay: def.castTime + (def.charge?.time ?? 0) + main.delay,
    range: def.range,
    radius: 0,
    hitsBall: stats.ballPower > 0 || stats.ballStun > 0,
    hitsPlayers: stats.hitsPerCast > 0,
    heal: stats.heal,
    speedPct: 0,
    wallDistance: 0,
    castWhile: false,
    push: ('hit' in main && main.hit?.direction) || 'travel',
    angleDeg:
      main.type === 'area' || main.type === 'channel' ? (main.shape === 'cone' ? main.angleDeg : main.shape === 'circle' ? 360 : 0) : 0,
    charge: def.charge?.time ?? 0,
    recast: !!def.recast,
    blinkTo: null,
    swap: false,
    hold: 0,
    strikeBuff: false,
    channel: false,
  };
  switch (main.type) {
    case 'projectile':
      m.delivery = 'projectile';
      m.speed = main.speed;
      m.radius = main.radius;
      break;
    case 'dash':
      m.delivery = 'dash';
      m.speed = main.distance / main.time;
      m.castWhile = main.castWhileDashing;
      m.radius = stats.reach - main.distance;
      break;
    case 'area':
      m.delivery = main.at === 'target' ? 'targetArea' : 'selfArea';
      m.aimed = main.at === 'target' || main.shape !== 'circle';
      m.radius = main.shape === 'line' ? main.length : main.radius;
      break;
    case 'wall':
      m.delivery = 'wall';
      m.wallDistance = main.distance;
      m.radius = main.length / 2;
      break;
    case 'buff':
      m.delivery = 'buff';
      m.aimed = false;
      m.speedPct = main.speedPct;
      m.radius = main.radius;
      m.strikeBuff = !!main.strikeHit;
      m.hitsPlayers = m.hitsPlayers || m.strikeBuff;
      break;
    case 'channel':
      // Aimed like a self area; a line counts as a narrow cone (small-angle width / length).
      m.delivery = 'selfArea';
      m.aimed = true;
      m.channel = true;
      m.radius = main.shape === 'line' ? main.length : main.radius;
      m.angleDeg = main.shape === 'line' ? Math.max(6, (main.width / Math.max(1, main.length)) * 57.3) : main.angleDeg;
      break;
    case 'blink':
      m.delivery = 'blink';
      m.range = main.distance;
      m.blinkTo = main.to;
      m.swap = main.swap;
      m.radius = stats.reach - main.distance;
      break;
    case 'grab':
      m.delivery = 'grab';
      m.radius = main.radius;
      m.hold = main.hold;
      m.hitsBall = true;
      break;
    case 'throw':
      m.delivery = 'grab';
      break;
  }
  // A dash followed by an area (e.g. a slam) lands where the dash ends.
  const dash = def.actions.find((a) => a.type === 'dash');
  if (dash && main.type === 'area' && dash.type === 'dash') {
    m.range = dash.distance;
    m.delay = def.castTime + main.delay;
  }
  return m;
}
