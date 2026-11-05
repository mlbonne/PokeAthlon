import { gameplay, getPokemon, SIZE_TABLE, type KitPassive } from '@pokeathlon/data';
import { stepBall } from './ball';
import { stepCombatTimers } from './combat';
import { ticks } from './constants';
import { stepEnergy } from './energy';
import type { SimEvent } from './events';
import type { PlayerInput } from './input';
import { beginKickoff, stepMatchEnd, stepMatchStart } from './match';
import {
  movesFor,
  passiveFor,
  refreshBody,
  stepCreations,
  stepMoves,
  stepPending,
  stepProjectiles,
  type Buff,
  type CastState,
  type ChannelState,
  type ChargeState,
  type Creation,
  type DashState,
  type MoveState,
  type PendingAction,
  type Projectile,
  type RecastState,
} from './moves';
import { stepMovement } from './movement';
import { stepOrbs } from './orbs';
import { stepPassiveXp } from './progression';
import type { BotMemory, TeamPlan } from './ai/memory';
import { mixSeed } from './rng';
import { buildStage, type Stage, type Team } from './stage';
import { stepStrike } from './strike';
import { collectTelemetry, createTelemetry, playerTelemetry, type Telemetry } from './telemetry';
import type { Vec2 } from './vec';

export type Role = 'forward' | 'goalie';

export interface Player {
  id: number;
  pokemonId: string;
  team: Team;
  role: Role;
  /** Spawn slot within the role (forwards 0/1). */
  slot: number;
  pos: Vec2;
  vel: Vec2;
  /** Last movement or strike direction (unit). Used for sprite facing and default aim. */
  facing: Vec2;
  /** Body (movement) radius. */
  radius: number;
  /** Hurtbox radius (where hits land). */
  hurtRadius: number;
  /** Max move speed, world units per second. */
  speed: number;
  /** Current power (base + transform buffs). */
  power: number;
  /** Base sizes and power from the Pokémon; `radius`, `hurtRadius`, `strikeRadius`, `power` = base + buffs. */
  basePower: number;
  baseRadius: number;
  baseHurtRadius: number;
  baseStrikeRadius: number;
  staggerGrowth: number;
  baseStagger: number;

  // Strike
  strikeRadius: number;
  strikeCooldown: number;
  strikeActive: number;
  strikeDir: Vec2;
  strikeConnected: boolean;
  /** Enemies this Strike already hit (transform Strikes). */
  strikeHitIds: number[];

  // Combat state
  stagger: number;
  maxStagger: number;
  staggered: boolean;
  /** Ticks until passive Stagger regen starts. */
  regenDelay: number;
  /** Current knockback slide (velocity decays linearly to 0 over knockTicks). */
  knockVel: Vec2;
  knockDecel: number;
  knockTicks: number;
  stunTicks: number;
  slowTicks: number;
  /** Untargetable/immune from Evade or Energy Burst. */
  elusiveTicks: number;
  /** Untargetable after respawn. */
  immuneTicks: number;
  /** Ticks until respawn; > 0 means knocked out (off the field). */
  koTicks: number;
  /** Ticks left banished: out of play, untargetable, frozen in place (M5.1). */
  banishTicks: number;
  /** Who last hit this player, and when (for KO credit). */
  lastHitBy: number;
  lastHitTick: number;

  // Energy
  energy: number;
  evadeCooldown: number;
  /** Buttons held last tick (edge detection for Evade). */
  prevButtons: number;
  /** Ticks left on the Energy Burst "next Core hit +50 %" boost. */
  burstBoostTicks: number;

  // Progression
  xp: number;
  level: number;
  xpTickAccumulator: number;
  /** Last tick this player touched the ball (assists). */
  lastBallTouchTick: number;
  stats: { goals: number; assists: number; kos: number; deaths: number; barriers: number };

  // Moves (M3)
  /** Primary, secondary, special (empty if the Pokémon has no kit yet). */
  moves: MoveState[];
  cast: CastState | null;
  dash: DashState | null;
  buffs: Buff[];
  // Move system extensions (M5.1)
  charging: ChargeState | null;
  recast: RecastState | null;
  channel: ChannelState | null;
  /** The kit's Strike-modifier passive and its stacks. */
  passive: KitPassive | null;
  passiveStacks: number;
}

export interface Ball {
  pos: Vec2;
  vel: Vec2;
  radius: number;
  /** Ticks of freeze left after a hit; `launchVel` is applied when it reaches 0. */
  hitstop: number;
  launchVel: Vec2;
  lastHitBy: number;
  /** Ticks left of Red Core friction immunity. */
  redTicks: number;
  /** Player holding exclusive control after an Energy Burst (−1 = none). */
  controlBy: number;
  controlTicks: number;
  /** True while the ball sits in a goal after scoring (hidden, inert). */
  scored: boolean;
  /** Ticks the ball is stunned (frozen, ignores knockback). OS "stun the Core". */
  stunTicks: number;
  /** Player holding the ball with a grab (-1 = none), ticks left, hold distance, holder slow %, auto-throw knockback (0 = drop). */
  heldBy: number;
  heldTicks: number;
  heldDist: number;
  heldSlow: number;
  heldThrow: number;
}

export interface Barrier {
  team: Team;
  box: { x: number; y: number; hx: number; hy: number };
  alive: boolean;
}

export interface Gate {
  team: Team;
  open: boolean;
  /** Ticks until the gate opens (−1 = not scheduled). */
  openTimer: number;
}

export interface Orb {
  id: number;
  pos: Vec2;
  /** Spawn group: 'mid', 'arc0' or 'arc1' (one live orb per group). */
  group: string;
}

export type Phase = 'kickoff' | 'play' | 'goal' | 'setOver' | 'matchOver';

export interface MatchState {
  phase: Phase;
  /** Ticks left in the current timed phase (kickoff/goal/setOver). */
  phaseTicks: number;
  /** Ticks of live play in this round (overtime clock). */
  roundTicks: number;
  goals: [number, number];
  sets: [number, number];
  setIndex: number;
  roundIndex: number;
  overtime: boolean;
  winner: Team | -1;
  /** Team that scored last (for between-round UI). */
  lastScoringTeam: Team | -1;
  orbTimer: number;
  orbCycle: number;
  nextOrbId: number;
  /** When false (sandbox), goals and phases are ignored. */
  rulesEnabled: boolean;
}

export interface World {
  tick: number;
  stage: Stage;
  players: Player[];
  ball: Ball;
  barriers: Barrier[];
  gates: [Gate, Gate];
  orbs: Orb[];
  match: MatchState;
  projectiles: Projectile[];
  creations: Creation[];
  pending: PendingAction[];
  nextEntityId: number;
  /** Events produced by the most recent step. */
  events: SimEvent[];
  /** The match seed. Only bots draw random numbers; the rules themselves never do. */
  seed: number;
  /**
   * Bot state: one seeded RNG stream per player (hashed, so replays stay exact), each bot's
   * memory and each team's job plan. Plain data, a pure function of the match so far.
   */
  ai: { rng: number[]; bots: (BotMemory | null)[]; teams: [TeamPlan | null, TeamPlan | null] };
  /** Balance telemetry, updated at the end of every step. */
  telemetry: Telemetry;
}

export interface PlayerSpawn {
  pokemonId: string;
  team: Team;
  role?: Role;
  slot?: number;
  /** Explicit start position (sandbox/tests). Defaults to the stage spawn for role/slot. */
  pos?: Vec2;
}

export interface WorldOptions {
  terrain?: string;
  /**
   * 'match' starts with a kickoff and runs the full rules.
   * 'sandbox' starts in live play with rules (goals, barriers) active but no kickoff; ball at `ballPos`.
   */
  mode?: 'match' | 'sandbox';
  /** Sandbox only: ball start (default centre). */
  ballPos?: Vec2;
  /** Seed for bot randomness (default 0). Same seed + same inputs = same match. */
  seed?: number;
}

export function createWorld(spawns: PlayerSpawn[], opts: WorldOptions = {}): World {
  const stage = buildStage(opts.terrain ?? 'viridian-pitch');
  const mode = opts.mode ?? 'sandbox';
  const world: World = {
    tick: 0,
    stage,
    players: spawns.map((s, i) => makePlayer(i, s, stage)),
    ball: {
      pos: { ...(opts.ballPos ?? { x: 0, y: 0 }) },
      vel: { x: 0, y: 0 },
      radius: gameplay.ball.radius,
      hitstop: 0,
      launchVel: { x: 0, y: 0 },
      lastHitBy: -1,
      redTicks: 0,
      controlBy: -1,
      controlTicks: 0,
      scored: false,
      stunTicks: 0,
      heldBy: -1,
      heldTicks: 0,
      heldDist: 0,
      heldSlow: 0,
      heldThrow: 0,
    },
    barriers: stage.barriers.map((b) => ({ team: b.team, box: { ...b.box }, alive: true })),
    gates: [
      { team: 0, open: false, openTimer: -1 },
      { team: 1, open: false, openTimer: -1 },
    ],
    orbs: [],
    match: {
      phase: 'play',
      phaseTicks: 0,
      roundTicks: 0,
      goals: [0, 0],
      sets: [0, 0],
      setIndex: 0,
      roundIndex: 0,
      overtime: false,
      winner: -1,
      lastScoringTeam: -1,
      orbTimer: ticks(gameplay.orbs.first),
      orbCycle: 0,
      nextOrbId: 1,
      rulesEnabled: true,
    },
    projectiles: [],
    creations: [],
    pending: [],
    nextEntityId: 1,
    events: [],
    seed: opts.seed ?? 0,
    ai: { rng: spawns.map((_, i) => mixSeed(((opts.seed ?? 0) * 16 + i) >>> 0)), bots: spawns.map(() => null), teams: [null, null] },
    telemetry: null as unknown as Telemetry,
  };
  world.telemetry = createTelemetry(world);
  if (mode === 'match') beginKickoff(world, false);
  return world;
}

/** Start position for a player from the stage spawns. */
export function spawnPosition(stage: Stage, team: Team, role: Role, slot: number): Vec2 {
  const s = stage.spawns[team];
  if (role === 'goalie') return { ...s.goalie };
  return { ...s.forwards[slot % s.forwards.length]! };
}

export function maxStaggerAt(p: Pick<Player, 'baseStagger' | 'staggerGrowth'>, level: number): number {
  return p.baseStagger + (p.staggerGrowth * (level - 1)) / 9;
}

function makePlayer(id: number, s: PlayerSpawn, stage: Stage): Player {
  const role = s.role ?? 'forward';
  const slot = s.slot ?? 0;
  const pos = s.pos ? { ...s.pos } : spawnPosition(stage, s.team, role, slot);
  const p: Player = {
    id,
    pokemonId: '',
    team: s.team,
    role,
    slot,
    pos,
    vel: { x: 0, y: 0 },
    facing: { x: s.team === 0 ? 1 : -1, y: 0 },
    radius: 0,
    hurtRadius: 0,
    speed: 0,
    power: 0,
    basePower: 0,
    baseRadius: 0,
    baseHurtRadius: 0,
    baseStrikeRadius: 0,
    staggerGrowth: 0,
    baseStagger: 0,
    strikeRadius: 0,
    strikeCooldown: 0,
    strikeActive: 0,
    strikeDir: { x: s.team === 0 ? 1 : -1, y: 0 },
    strikeConnected: false,
    strikeHitIds: [],
    stagger: 0,
    maxStagger: 0,
    staggered: false,
    regenDelay: 0,
    knockVel: { x: 0, y: 0 },
    knockDecel: 0,
    knockTicks: 0,
    stunTicks: 0,
    slowTicks: 0,
    elusiveTicks: 0,
    immuneTicks: 0,
    koTicks: 0,
    banishTicks: 0,
    lastHitBy: -1,
    lastHitTick: -1,
    energy: gameplay.energy.start,
    evadeCooldown: 0,
    prevButtons: 0,
    burstBoostTicks: 0,
    xp: 0,
    level: 1,
    xpTickAccumulator: 0,
    lastBallTouchTick: -1,
    stats: { goals: 0, assists: 0, kos: 0, deaths: 0, barriers: 0 },
    moves: [],
    cast: null,
    dash: null,
    buffs: [],
    charging: null,
    recast: null,
    channel: null,
    passive: null,
    passiveStacks: 0,
  };
  applyPokemon(p, s.pokemonId);
  p.stagger = p.maxStagger;
  return p;
}

function applyPokemon(p: Player, pokemonId: string): void {
  const def = getPokemon(pokemonId);
  const size = SIZE_TABLE[def.stats.size];
  p.pokemonId = def.id;
  p.baseRadius = size.radius;
  p.baseHurtRadius = size.hurtRadius;
  p.speed = def.stats.speed;
  p.basePower = def.stats.power;
  p.baseStrikeRadius = size.strikeWidth / 2;
  refreshBody(p);
  p.baseStagger = def.stats.stagger;
  p.staggerGrowth = def.stats.staggerGrowth;
  p.moves = movesFor(def.id);
  p.passive = passiveFor(def.id);
  p.passiveStacks = 0;
  p.cast = null;
  p.charging = null;
  p.recast = null;
  p.channel = null;
  const frac = p.maxStagger > 0 ? p.stagger / p.maxStagger : 1;
  p.maxStagger = maxStaggerAt(p, p.level);
  p.stagger = p.maxStagger * frac;
}

/** Swap a player's Pokémon in place (sandbox helper), keeping position and state. */
export function setPokemon(world: World, playerId: number, pokemonId: string): void {
  const p = world.players[playerId];
  if (!p) return;
  applyPokemon(p, pokemonId);
  const t = world.telemetry.players[playerId];
  if (t) t.pokemon = p.pokemonId;
}

/** Is this player on the field and able to act? */
export const isActive = (p: Player): boolean => p.koTicks === 0;
/** Can this player be hit right now? */
export const isTargetable = (p: Player): boolean => p.koTicks === 0 && p.elusiveTicks === 0 && p.immuneTicks === 0 && p.banishTicks === 0;

/**
 * Advance the world by one tick. `inputs[i]` belongs to `world.players[i]`;
 * missing entries count as neutral. Mutates and returns `world`.
 *
 * Order: match start-of-tick → timers → movement (incl. dashes) → strikes → moves → energy →
 * delayed actions → projectiles → ball → creations → orbs → passive XP → match end-of-tick.
 * (Moves and Strike read last tick's buttons for press detection; energy updates them.)
 */
export function step(world: World, inputs: readonly (PlayerInput | undefined)[]): World {
  world.events = [];
  const prevPos = world.players.map((p) => ({ x: p.pos.x, y: p.pos.y }));
  stepMatchStart(world);
  for (const p of world.players) stepCombatTimers(world, p);
  for (const p of world.players) stepMovement(world, p, inputs[p.id]);
  for (const p of world.players) stepStrike(world, p, inputs[p.id]);
  for (const p of world.players) stepMoves(world, p, inputs[p.id]);
  for (const p of world.players) stepEnergy(world, p, inputs[p.id]);
  stepPending(world);
  stepProjectiles(world);
  stepBall(world);
  stepCreations(world);
  stepOrbs(world);
  stepPassiveXp(world);
  stepMatchEnd(world);
  collectTelemetry(world, prevPos);
  world.tick++;
  return world;
}

/** Add a player mid-game (practice dummies). Returns the new player. */
export function addPlayer(world: World, spawn: PlayerSpawn): Player {
  const p = makePlayer(world.players.length, spawn, world.stage);
  world.players.push(p);
  world.ai.rng.push(mixSeed((world.seed * 16 + p.id) >>> 0));
  world.ai.bots.push(null);
  world.ai.teams = [null, null];
  world.telemetry.players.push(playerTelemetry(p));
  world.telemetry.lastHit.push(null);
  world.telemetry.lastBallSource.push(null);
  return p;
}

/**
 * Remove players (practice). Ids are re-numbered so `players[i].id === i` still holds;
 * in-flight projectiles, creations and delayed actions are cleared.
 */
export function removePlayers(world: World, keep: (p: Player) => boolean): void {
  const kept = world.players.map((p, i) => ({ p, i })).filter(({ p }) => keep(p));
  world.players = kept.map(({ p }, id) => Object.assign(p, { id }));
  world.ai.rng = kept.map(({ i }) => world.ai.rng[i]!);
  world.ai.bots = kept.map(() => null);
  world.ai.teams = [null, null];
  const tel = world.telemetry;
  tel.players = kept.map(({ i }, id) => Object.assign(tel.players[i]!, { id }));
  tel.lastHit = kept.map(() => null);
  tel.lastBallSource = kept.map(() => null);
  tel.lastTouch = null;
  tel.liveShot = null;
  world.projectiles = [];
  world.creations = [];
  world.pending = [];
  world.ball.lastHitBy = -1;
  world.ball.controlBy = -1;
  world.ball.controlTicks = 0;
  world.ball.heldBy = -1;
  world.ball.heldTicks = 0;
  for (const p of world.players) p.lastHitBy = -1;
}
