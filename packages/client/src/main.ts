import * as THREE from 'three';
import { gameplay, roster, type PokemonDef } from '@pokeathlon/data';
import {
  botLabel,
  getBrain,
  parseLineup,
  createWorld,
  DT,
  NEUTRAL_INPUT,
  practiceClearCooldowns,
  setPokemon,
  step,
  ticks,
  TICK_RATE,
  type PlayerInput,
  type SimEvent,
  type Vec2,
  type World,
} from '@pokeathlon/sim';
import { getKit } from '@pokeathlon/data';
import { AbilityBar } from './abilityBar';
import { SetupScreen, type MatchConfig } from './setup';
import { DebugMenu } from './debug/menu';
import type { FrameRecorder } from './recorder';
import { Hud, nameOf, TEAM_NAMES } from './hud';
import { InputSource } from './input';
import { AimIndicator } from './render/aim';
import { buildArena } from './render/arena';
import { BallView } from './render/ball';
import { DebugOverlay } from './render/debugOverlay';
import { Effects } from './render/effects';
import { facingRow, PmdSprite } from './render/pmdSprite';
import { MoveViews } from './render/moves';
import { Structures } from './render/structures';
import { toThreeX, toThreeZ, WORLD_TO_THREE } from './render/units';

// ---------- Three.js setup ----------
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1638);
scene.fog = new THREE.Fog(0x1b1638, 60, 120);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334433, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(-10, 25, 12);
scene.add(sun);

const CAMERA_PITCH = THREE.MathUtils.degToRad(55);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
const hudRoot = document.querySelector<HTMLElement>('#hud')!;

// ---------- Match ----------
// With no URL mode the game opens the match setup screen (Esc / Start returns to it).
// URL modes (skip the setup screen):
//   ?quick=1               straight into a 1v1 vs a CPU Lucario
//   ?cpu=pikachu,lucario   CPU vs CPU spectator match (both sides played by bots)
//   &record=1              no real-time loop; frames are advanced by window.__rec (match recorder)
//   &meter=1               open the F3 debug menu on start (also bakes it into recordings)
//   ?practice=1            practice sandbox: no kickoff, an idle enemy dummy (F3 → Practice)
const params = new URLSearchParams(location.search);
//   ?cpu=a,b,c/d,e,f       3v3 spectator match (last of each team is the goalie)
//   &diff=easy|normal|hard bot skill (default: normal when you play, hard when spectating)
//   &brain=v1              the old M2/M3 bot instead
const cpuSpec = params.get('cpu') ?? '';
const cpuLineup = (() => {
  try {
    const spec = cpuSpec.includes('/') ? cpuSpec : cpuSpec.split(',').slice(0, 2).join('/');
    const l = parseLineup(spec);
    return l.every((s) => roster.some((r) => r.id === s.pokemonId)) ? l : null;
  } catch {
    return null;
  }
})();
const RECORD = params.get('record') === '1';
const urlDiff = (params.get('diff') ?? '') as MatchConfig['diff'] | '';
const duel = (): MatchConfig['lineup'] => [
  { pokemonId: 'pikachu', team: 0 },
  { pokemonId: 'lucario', team: 1 },
];
const urlConfig: MatchConfig | null = cpuLineup
  ? { lineup: cpuLineup, me: -1, diff: urlDiff || 'hard', practice: false }
  : params.get('practice') === '1'
    ? { lineup: duel(), me: 0, diff: urlDiff || 'normal', practice: true }
    : params.get('quick') === '1'
      ? { lineup: duel(), me: 0, diff: urlDiff || 'normal', practice: false }
      : null;

// Current match settings (a placeholder duel runs behind the setup screen).
let config: MatchConfig = urlConfig ?? { lineup: duel(), me: 0, diff: 'normal', practice: false };
let SPECTATE = false;
let PRACTICE = false;
let ME = 0;
let DIFF: string = config.diff;
let brain = getBrain('v2');
let myPokemon = 'pikachu';

function applyConfig(c: MatchConfig): void {
  config = c;
  SPECTATE = c.me < 0;
  PRACTICE = c.practice;
  ME = Math.max(0, c.me);
  DIFF = c.diff;
  brain = getBrain(params.get('brain') ?? `v2-${DIFF}`);
  myPokemon = c.lineup[ME]!.pokemonId;
  document.body.classList.toggle('spectate', SPECTATE);
  debugHooks.enemyMode = PRACTICE ? 'dummy' : 'bot';
}

interface MatchView {
  world: World;
  group: THREE.Group;
  sprites: PmdSprite[];
  ball: BallView;
  structures: Structures;
  effects: Effects;
  aim: AimIndicator;
  hud: Hud;
  moves: MoveViews;
  overlay: DebugOverlay;
  bar: AbilityBar;
  prevPos: Vec2[];
  prevBall: Vec2;
}

let arena: THREE.Group | null = null;
let view!: MatchView;

function dexOf(id: string): string {
  return roster.find((r) => r.id === id)!.dex;
}

function startMatch(): void {
  if (view) {
    scene.remove(view.group);
    view.bar.remove();
    hudRoot.querySelectorAll('.scoreboard, .banner, .plate, .pop, .team-hud').forEach((e) => e.remove());
  }
  const world = createWorld(
    config.lineup.map((s) => ({ ...s })),
    { mode: PRACTICE ? 'sandbox' : 'match', ...(PRACTICE ? { ballPos: { x: -400, y: 0 } } : {}) },
  );
  document.body.classList.toggle('teams3', world.players.length > 2);
  if (!arena) {
    arena = buildArena(world.stage);
    scene.add(arena);
  }
  const group = new THREE.Group();
  const structures = new Structures(world);
  const effects = new Effects();
  const aim = new AimIndicator();
  const ball = new BallView(world.ball.radius, gameplay.ball.glowSpeed);
  const moves = new MoveViews(world);
  const overlay = new DebugOverlay();
  overlay.object.visible = menu.visible;
  group.add(structures.object, effects.object, aim.object, ball.object, moves.object, overlay.object);
  const sprites = makeSprites(world, group);
  scene.add(group);
  aim.setReach(world.players[ME]!.strikeRadius * WORLD_TO_THREE);
  view = {
    world,
    group,
    sprites,
    ball,
    structures,
    effects,
    aim,
    hud: new Hud(hudRoot, world, SPECTATE ? -1 : ME),
    moves,
    overlay,
    bar: new AbilityBar(hudRoot),
    prevPos: world.players.map((p) => ({ ...p.pos })),
    prevBall: { ...world.ball.pos },
  };
  if (SPECTATE) {
    const team = (t: number) => config.lineup.filter((s) => s.team === t).map((s) => roster.find((r) => r.id === s.pokemonId)!.name).join(', ');
    $name.textContent = `CPU vs CPU · ${DIFF}`;
    $info.textContent = `Blue ${team(0)}  vs  Red ${team(1)}`;
    $portrait.src = `portraits/${dexOf(myPokemon)}/Normal.png`;
  } else showCard(roster.find((r) => r.id === myPokemon)!);
}

function makeSprites(world: World, group: THREE.Group): PmdSprite[] {
  return world.players.map((p) => {
    const s = new PmdSprite();
    group.add(s.object);
    void s.load(dexOf(p.pokemonId));
    return s;
  });
}

/** Players were added or removed (practice): rebuild sprites and nameplates. */
function playersChanged(): void {
  const { world } = view;
  for (const s of view.sprites) view.group.remove(s.object);
  view.sprites = makeSprites(world, view.group);
  hudRoot.querySelectorAll('.scoreboard, .banner, .plate, .team-hud').forEach((e) => e.remove());
  view.hud = new Hud(hudRoot, world, SPECTATE ? -1 : ME);
  view.prevPos = world.players.map((p) => ({ ...p.pos }));
}

// ---------- Debug menu (F3) ----------
const debugHooks = {
  world: () => view.world,
  get me() {
    return SPECTATE ? -1 : ME;
  },
  playersChanged,
  enemyMode: 'bot' as 'dummy' | 'bot',
  noCooldowns: false,
};
const menu = new DebugMenu(hudRoot, debugHooks);

// ---------- Setup screen ----------
const setup = new SetupScreen(document.body, (c) => {
  applyConfig(c);
  setup.hide();
  startMatch();
});

let toastTimer = 0;
function toast(text: string): void {
  let t = hudRoot.querySelector<HTMLElement>('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    hudRoot.append(t);
  }
  t.textContent = text;
  t.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove('show'), 2500);
}

// ---------- Card ----------
const $name = document.querySelector<HTMLDivElement>('#mon-name')!;
const $info = document.querySelector<HTMLDivElement>('#mon-info')!;
const $portrait = document.querySelector<HTMLImageElement>('#portrait')!;
function showCard(def: PokemonDef): void {
  $name.textContent = `${def.name}  #${def.dex}`;
  const s = def.stats;
  $info.textContent =
    `${def.archetype.replace(/-/g, ' ')} · ${def.types.join('/')}\n` +
    `PWR ${s.power}  SPD ${s.speed}  STG ${s.stagger}  ${s.size}`;
  $portrait.src = `portraits/${def.dex}/Normal.png`;
}

// ---------- Projection ----------
const tmpV = new THREE.Vector3();
function project(x: number, y: number, h: number): { x: number; y: number; visible: boolean } {
  tmpV.set(toThreeX(x), h, toThreeZ(y)).project(camera);
  return {
    x: ((tmpV.x + 1) / 2) * window.innerWidth,
    y: ((1 - tmpV.y) / 2) * window.innerHeight,
    visible: tmpV.z < 1,
  };
}

// ---------- Feedback from sim events ----------
const STRIKE_COOLDOWN_TICKS = ticks(gameplay.strike.cooldown);
const teamColor = (t: number) => (t === 0 ? 0x3d7bff : 0xff4d5e);

function onEvent(e: SimEvent): void {
  const { world, effects, hud, sprites } = view;
  view.moves.onEvent(e);
  const at = (p: Vec2, h = 1.2) => project(p.x, p.y, h);
  switch (e.type) {
    case 'strike':
      sprites[e.playerId]?.playOnce('Attack', 1.8);
      if (e.playerId === ME) view.aim.strikeFlash();
      break;
    case 'ballHit': {
      const by = world.players[e.playerId];
      const turn = by ? Math.sign((e.pos.x - by.pos.x) * by.strikeDir.y - (e.pos.y - by.pos.y) * by.strikeDir.x) : 1;
      view.ball.hit(turn || 1);
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), e.boosted ? 0xffffff : e.red ? 0xff3b2f : 0xffe066, e.boosted ? 3.4 : 2.0, 0.28);
      effects.shake(0.05 + Math.min(1, e.speed / gameplay.ball.knockbackCap) * (e.boosted ? 0.3 : 0.15));
      break;
    }
    case 'ballWall':
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), 0xffffff, 0.5 + e.impact / 1500, 0.2);
      break;
    case 'barrierBreak': {
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), 0x5dff9a, 4, 0.45);
      effects.shake(0.18);
      const s = at(e.pos, 1);
      hud.pop('Protect broke!', s.x, s.y);
      break;
    }
    case 'gateOpen': {
      const g = world.stage.goals[e.team];
      const s = at({ x: g.mouthX, y: 0 }, 1);
      hud.pop('Gate open!', s.x, s.y, 'stg');
      break;
    }
    case 'goal': {
      const scorer = world.players[e.scorer];
      const who = e.ownGoal ? 'Own goal!' : scorer ? `${nameOf(scorer)} scores!` : '';
      hud.showBanner(`GOAL!<small>${TEAM_NAMES[e.team]} · ${who}</small>`, 2.6, `t${e.team}`);
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), teamColor(e.team), 7, 0.7);
      effects.shake(0.4);
      break;
    }
    case 'overtime':
      hud.showBanner('OVERTIME<small>Ball knockback +20 %</small>', 2, '');
      break;
    case 'setWon':
      hud.showBanner(`${TEAM_NAMES[e.team]} wins the set!<small>Sets ${e.sets[0]} – ${e.sets[1]}</small>`, 3.5, `t${e.team}`);
      break;
    case 'matchWon':
      hud.showBanner(`${TEAM_NAMES[e.team]} wins the match!<small>Press R to play again</small>`, 9999, `t${e.team}`);
      break;
    case 'hit':
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), 0xffffff, 1.4, 0.2);
      effects.shake(Math.min(0.25, e.knockback / 2500));
      break;
    case 'staggered': {
      const p = world.players[e.playerId]!;
      const s = at(p.pos, 2.2);
      hud.pop('Dizzy!', s.x, s.y, 'stg');
      break;
    }
    case 'ko': {
      const s = at(e.pos, 1);
      hud.pop('Blasted off!', s.x, s.y, 'ko');
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), 0xff4d5e, 3, 0.5);
      effects.shake(0.3);
      break;
    }
    case 'respawn':
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), teamColor(world.players[e.playerId]!.team), 1.6, 0.4);
      break;
    case 'burst':
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), 0xffffff, (gameplay.burst.radius * 2) / 100, 0.35);
      effects.shake(0.22);
      break;
    case 'orb':
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), 0x8fd3ff, 1.6, 0.35);
      break;
    case 'cast': {
      const p = world.players[e.playerId]!;
      const def = getKit(p.pokemonId)?.moves.find((m) => m.id === e.moveId);
      if (def) sprites[e.playerId]?.playOnce(def.anim, 1.4);
      if (e.slot === 'special') {
        const s = at(p.pos, 2.4);
        hud.pop(def?.name ?? '', s.x, s.y, 'lvl');
      }
      break;
    }
    case 'ballStun':
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), 0xc9b38a, 1.5, 0.4);
      break;
    case 'wall':
      effects.shake(0.15);
      break;
    case 'levelUp': {
      const p = world.players[e.playerId]!;
      const s = at(p.pos, 2.4);
      hud.pop(`Lv ${e.level}!`, s.x, s.y, 'lvl');
      break;
    }
    default:
      break;
  }
}

// ---------- Mouse → ground ----------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
function mouseWorld(input: InputSource): Vec2 | null {
  raycaster.setFromCamera(new THREE.Vector2(input.mouseNdc.x, input.mouseNdc.y), camera);
  if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
  return { x: hitPoint.x / WORLD_TO_THREE, y: -hitPoint.z / WORLD_TO_THREE };
}

// ---------- Simulation step ----------
const input = new InputSource(window, canvas);
let lastInput: PlayerInput = NEUTRAL_INPUT;

function simStep(mine: PlayerInput): void {
  const { world } = view;
  world.players.forEach((p, i) => (view.prevPos[i] = { ...p.pos }));
  view.prevBall = { ...world.ball.pos };
  const myTeam = world.players[ME]?.team ?? 0;
  step(
    world,
    world.players.map((p) =>
      p.id === ME && !SPECTATE ? mine : debugHooks.enemyMode === 'dummy' && p.team !== myTeam && !SPECTATE ? NEUTRAL_INPUT : brain(world, p.id),
    ),
  );
  if (debugHooks.noCooldowns) practiceClearCooldowns(world);
  for (const e of world.events) onEvent(e);
}

// ---------- Dev hook (stripped from production builds) ----------
if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: {
      get world() {
        return view.world;
      },
      /** Run `n` sim ticks with a fixed input for the human player (bots keep playing). */
      run(n: number, inp: Partial<PlayerInput> = {}): void {
        const mine: PlayerInput = { ...NEUTRAL_INPUT, ...inp };
        for (let i = 0; i < n; i++) simStep(mine);
      },
      restart: startMatch,
    },
  });
}

// ---------- Loop ----------
let acc = 0;
let last = performance.now();
let fps = 60;

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
applyConfig(config);
startMatch();
if (!urlConfig && !RECORD) setup.show();
if (params.get('meter') === '1') {
  menu.toggle();
  view.overlay.object.visible = true;
}

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;

  for (const d of input.takeDigits()) {
    const def = roster[d - 1];
    if (!def) continue;
    myPokemon = def.id;
    config.lineup[ME] = { ...config.lineup[ME]!, pokemonId: def.id };
    setPokemon(view.world, ME, def.id);
    void view.sprites[ME]!.load(def.dex);
    view.aim.setReach(view.world.players[ME]!.strikeRadius * WORLD_TO_THREE);
    showCard(def);
  }
  input.pollPad();
  for (const a of input.takeActions()) {
    if (a === 'debug') {
      menu.toggle();
      view.overlay.object.visible = menu.visible;
    }
    if (a === 'restart' && !setup.visible) startMatch();
    if (a === 'menu') {
      if (setup.visible) setup.hide();
      else setup.show();
    }
    if (a.startsWith('nav-') && setup.visible) setup.navigate(a.slice(4) as 'up' | 'down' | 'left' | 'right' | 'press');
    if (a.startsWith('pad-on:')) toast(`Controller connected: ${a.slice(7).split('(')[0]!.trim()}`);
    if (a.startsWith('pad-off:')) toast('Controller disconnected');
  }

  // Fixed-step simulation (paused while the setup screen is open).
  acc += setup.visible ? 0 : dt;
  let steps = 0;
  while (acc >= DT && steps < 5) {
    const me = view.world.players[ME]!;
    const m = mouseWorld(input);
    lastInput = input.poll(m ? { x: m.x - me.pos.x, y: m.y - me.pos.y } : null);
    simStep(lastInput);
    acc -= DT;
    steps++;
  }
  if (steps === 5) acc = 0;
  render(dt, now, acc / DT);
  requestAnimationFrame(frame);
}

const camFocus = { x: 0, y: 0 };

/** Draw one frame. `now` (ms) only drives cosmetic blinking; `alpha` interpolates between sim ticks. */
function render(dt: number, now: number, alpha: number): void {
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  const { world, sprites } = view;

  // Players.
  world.players.forEach((p, i) => {
    const s = sprites[i]!;
    const a = view.prevPos[i]!;
    const x = lerp(a.x, p.pos.x);
    const y = lerp(a.y, p.pos.y);
    s.object.visible = p.koTicks === 0;
    s.object.position.set(toThreeX(x), 0, toThreeZ(y));
    const speed = Math.hypot(p.vel.x, p.vel.y);
    if (p.knockTicks > 0 || p.stunTicks > 0) s.play('Hurt');
    else if (p.dash) s.play('Walk');
    else s.play(speed > 20 ? 'Walk' : 'Idle');
    s.update(dt, facingRow(p.facing.x, p.facing.y), speed > 20 ? Math.max(0.6, speed / 300) : 1);
    const blink = p.immuneTicks > 0 && Math.floor(now / 90) % 2 === 0;
    s.setOpacity(p.elusiveTicks > 0 ? 0.45 : blink ? 0.35 : 1);
    if (i === ME) {
      view.aim.object.visible = p.koTicks === 0 && !SPECTATE;
      view.aim.update(dt, toThreeX(x), toThreeZ(y), lastInput.aimX, -lastInput.aimY, p.strikeCooldown / STRIKE_COOLDOWN_TICKS);
    }
  });

  // Ball.
  const b = world.ball;
  view.ball.object.visible = !b.scored;
  view.ball.update(
    dt,
    toThreeX(lerp(view.prevBall.x, b.pos.x)),
    toThreeZ(lerp(view.prevBall.y, b.pos.y)),
    toThreeX(b.vel.x),
    toThreeZ(b.vel.y),
    b.hitstop > 0 || b.controlTicks > 0 || b.stunTicks > 0,
    b.redTicks > 0,
  );
  view.structures.update(dt, world);
  view.moves.update(dt, world);
  if (!SPECTATE) view.bar.update(world.players[ME]!, input.device);
  view.effects.update(dt);

  // Camera: frame the whole stage (every player of a 3v3 is always on screen) and drift gently
  // toward the action: mostly the ball, a little toward you. Smoothed so it never jerks.
  const me = SPECTATE ? null : world.players[ME];
  const tx = b.pos.x * 0.07 + (me && me.koTicks === 0 ? me.pos.x * 0.04 : 0);
  const ty = b.pos.y * 0.045 + (me && me.koTicks === 0 ? me.pos.y * 0.02 : 0);
  const k = 1 - Math.exp(-dt * 3);
  camFocus.x += (tx - camFocus.x) * k;
  camFocus.y += (ty - camFocus.y) * k;
  const fx = toThreeX(camFocus.x);
  const fz = toThreeZ(camFocus.y);
  const fitW = ((toThreeX(world.stage.halfLength) * 2 + 2) * 1.05) / camera.aspect;
  const fitH = toThreeX(world.stage.halfWidth) * 2 + 5;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const dist = Math.max(fitW, fitH) / 2 / Math.tan(halfFov);
  // Fog only hides the far void; keep it beyond the arena at any zoom.
  const fog = scene.fog as THREE.Fog;
  fog.near = dist * 1.1;
  fog.far = dist * 2.2;
  camera.far = dist * 3;
  camera.updateProjectionMatrix();
  camera.position.set(fx, Math.sin(CAMERA_PITCH) * dist, fz + Math.cos(CAMERA_PITCH) * dist);
  camera.lookAt(fx, 0, fz);
  camera.position.add(view.effects.shakeOffset());
  for (const s of sprites) s.faceCamera(camera);

  view.hud.update(dt, world, project, menu.visible ? (id) => botLabel(world, id) : null);
  view.overlay.update(world, menu.focusId);
  menu.update(dt, fps);

  renderer.render(scene, camera);
}

if (RECORD) {
  // Deterministic capture: the recorder advances the game exactly `ticks` per video frame.
  let simClock = 0;
  let recorder: FrameRecorder | null = null;
  Object.assign(window, {
    __rec: {
      /** Set up in-page H.264 capture; frames are streamed out via window.__writeChunk. */
      async startCapture(fps: number) {
        const { FrameRecorder } = await import('./recorder');
        const write = (window as unknown as { __writeChunk: (b64: string, pos: number) => void }).__writeChunk;
        recorder = new FrameRecorder(canvas.width, canvas.height, fps, write);
      },
      async advance(ticksPerFrame: number) {
        for (let i = 0; i < ticksPerFrame; i++) {
          simStep(NEUTRAL_INPUT);
        }
        simClock += ticksPerFrame * DT * 1000;
        render(ticksPerFrame * DT, simClock, 1);
        // Capture in the same task as the render (the WebGL buffer is only valid until it yields).
        if (recorder) await recorder.capture(canvas, hudRoot);
        const m = view.world.match;
        return { tick: view.world.tick, phase: m.phase, goals: m.goals, sets: m.sets, winner: m.winner };
      },
      async finishCapture() {
        return recorder ? recorder.finish() : 0;
      },
      summary() {
        const w = view.world;
        return {
          ticks: w.tick,
          minutes: +(w.tick / TICK_RATE / 60).toFixed(2),
          sets: w.match.sets,
          winner: w.match.winner,
          players: w.telemetry.players,
        };
      },
    },
  });
} else {
  requestAnimationFrame(frame);
}
