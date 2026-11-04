import * as THREE from 'three';
import { gameplay, roster, type PokemonDef } from '@pokeathlon/data';
import {
  createWorld,
  DT,
  NEUTRAL_INPUT,
  resetBall,
  step,
  ticks,
  TICK_RATE,
  type PlayerInput,
  type SimEvent,
  type Vec2,
  type World,
} from '@pokeathlon/sim';
import { InputSource } from './input';
import { AimIndicator } from './render/aim';
import { buildArena } from './render/arena';
import { BallView } from './render/ball';
import { Effects } from './render/effects';
import { facingRow, PmdSprite } from './render/pmdSprite';
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

const CAMERA_PITCH = THREE.MathUtils.degToRad(52);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);

// ---------- Simulation ----------
// M1 sandbox: the whole roster stands on the pitch as obstacles; you control one at a time.
const world: World = createWorld(
  roster.map((p, i) => ({
    pokemonId: p.id,
    team: i < 4 ? 0 : 1,
    pos: i === 0 ? { x: -500, y: 0 } : { x: -1050 + (i % 4) * 700, y: i < 4 ? 550 : -550 },
  })),
);
scene.add(buildArena(world.arena));

const sprites = world.players.map((p) => {
  const s = new PmdSprite();
  scene.add(s.object);
  void s.load(roster.find((r) => r.id === p.pokemonId)!.dex);
  return s;
});
const ballView = new BallView(world.ball.radius, gameplay.ball.glowSpeed);
scene.add(ballView.object);
const effects = new Effects();
scene.add(effects.object);
const aim = new AimIndicator();
scene.add(aim.object);

let controlled = 0;
const prevPos: Vec2[] = world.players.map((p) => ({ ...p.pos }));
let prevBall: Vec2 = { ...world.ball.pos };

// ---------- HUD ----------
const $name = document.querySelector<HTMLDivElement>('#mon-name')!;
const $info = document.querySelector<HTMLDivElement>('#mon-info')!;
const $portrait = document.querySelector<HTMLImageElement>('#portrait')!;
const $debug = document.querySelector<HTMLDivElement>('#debug')!;

function showCard(def: PokemonDef): void {
  $name.textContent = `${def.name}  #${def.dex}`;
  const s = def.stats;
  $info.textContent =
    `${def.archetype.replace(/-/g, ' ')} · ${def.types.join('/')}\n` +
    `PWR ${s.power}  SPD ${s.speed}  STG ${s.stagger}  ${s.size}`;
  $portrait.src = `portraits/${def.dex}/Normal.png`;
}
function selectPlayer(i: number): void {
  controlled = i;
  const p = world.players[i]!;
  showCard(roster.find((r) => r.id === p.pokemonId)!);
  aim.setReach(p.strikeRadius * WORLD_TO_THREE);
}
selectPlayer(0);

// ---------- Feedback from sim events ----------
const STRIKE_COOLDOWN_TICKS = ticks(gameplay.strike.cooldown);
let peakBallSpeed = 0;

function onEvent(e: SimEvent): void {
  switch (e.type) {
    case 'strike':
      sprites[e.playerId]?.playOnce('Attack', 1.8);
      if (e.playerId === controlled) aim.strikeFlash();
      break;
    case 'ballHit': {
      // Spin direction from the hit's turn relative to the striker → ball line.
      const by = world.players[e.playerId];
      const turn = by ? Math.sign((e.pos.x - by.pos.x) * by.strikeDir.y - (e.pos.y - by.pos.y) * by.strikeDir.x) : 1;
      ballView.hit(turn || 1);
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), e.red ? 0xff3b2f : 0xffe066, 2.4, 0.28);
      effects.shake(0.06 + Math.min(1, e.speed / gameplay.ball.knockbackCap) * 0.18);
      break;
    }
    case 'ballLaunch':
      peakBallSpeed = Math.max(peakBallSpeed, e.speed);
      break;
    case 'ballWall':
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), 0xffffff, 0.6 + e.impact / 1200, 0.22);
      if (e.impact > 900) effects.shake(0.05);
      break;
    case 'ballBody':
      effects.ring(toThreeX(e.pos.x), toThreeZ(e.pos.y), 0x8fd3ff, 1.2, 0.22);
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

// ---------- Dev hook (stripped from production builds) ----------
if (import.meta.env.DEV) {
  Object.assign(window, {
    __sandbox: {
      world,
      /** Run `n` sim ticks with a fixed input for the controlled player (for scripted checks). */
      run(n: number, inp: Partial<PlayerInput> = {}): void {
        const mine: PlayerInput = { ...NEUTRAL_INPUT, ...inp };
        for (let i = 0; i < n; i++) {
          world.players.forEach((p, j) => (prevPos[j] = { ...p.pos }));
          prevBall = { ...world.ball.pos };
          step(world, world.players.map((p) => (p.id === controlled ? mine : NEUTRAL_INPUT)));
          for (const e of world.events) onEvent(e);
        }
      },
    },
  });
}

// ---------- Loop ----------
const input = new InputSource(window, canvas);
let acc = 0;
let last = performance.now();
let fps = 60;
let lastInput: PlayerInput = NEUTRAL_INPUT;

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;

  for (const d of input.takeDigits()) if (d <= world.players.length) selectPlayer(d - 1);
  for (const a of input.takeActions()) {
    if (a === 'debug') $debug.hidden = !$debug.hidden;
    if (a === 'resetBall') {
      resetBall(world);
      prevBall = { ...world.ball.pos };
    }
  }

  // Fixed-step simulation.
  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 5) {
    const me = world.players[controlled]!;
    const m = mouseWorld(input);
    lastInput = input.poll(m ? { x: m.x - me.pos.x, y: m.y - me.pos.y } : null);
    const inputs = world.players.map((p) => (p.id === controlled ? lastInput : NEUTRAL_INPUT));
    world.players.forEach((p, i) => (prevPos[i] = { ...p.pos }));
    prevBall = { ...world.ball.pos };
    step(world, inputs);
    for (const e of world.events) onEvent(e);
    acc -= DT;
    steps++;
  }
  if (steps === 5) acc = 0; // drop backlog after a stall
  const alpha = acc / DT;
  const lerp = (a: number, b: number) => a + (b - a) * alpha;

  // Players.
  world.players.forEach((p, i) => {
    const s = sprites[i]!;
    const a = prevPos[i]!;
    const x = lerp(a.x, p.pos.x);
    const y = lerp(a.y, p.pos.y);
    s.object.position.set(toThreeX(x), 0, toThreeZ(y));
    const speed = Math.hypot(p.vel.x, p.vel.y);
    s.play(speed > 20 ? 'Walk' : 'Idle');
    s.update(dt, facingRow(p.facing.x, p.facing.y), speed > 20 ? Math.max(0.6, speed / 300) : 1);
    if (i === controlled) {
      aim.update(
        dt,
        toThreeX(x),
        toThreeZ(y),
        lastInput.aimX,
        -lastInput.aimY,
        p.strikeCooldown / STRIKE_COOLDOWN_TICKS,
      );
    }
  });

  // Ball.
  const b = world.ball;
  ballView.update(
    dt,
    toThreeX(lerp(prevBall.x, b.pos.x)),
    toThreeZ(lerp(prevBall.y, b.pos.y)),
    toThreeX(b.vel.x),
    toThreeZ(b.vel.y),
    b.hitstop > 0,
    b.redTicks > 0,
  );
  effects.update(dt);

  // Camera: frame the arena, drift slightly towards the action.
  const me = world.players[controlled]!;
  const fx = toThreeX(me.pos.x * 0.07 + b.pos.x * 0.07);
  const fz = toThreeZ(me.pos.y * 0.05 + b.pos.y * 0.05);
  const fitW = ((toThreeX(world.arena.halfWidth) * 2 + 5) * 1.12) / camera.aspect;
  const fitH = toThreeX(world.arena.halfHeight) * 2 + 7;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const dist = Math.max(fitW, fitH) / 2 / Math.tan(halfFov);
  camera.position.set(fx, Math.sin(CAMERA_PITCH) * dist, fz + Math.cos(CAMERA_PITCH) * dist);
  camera.lookAt(fx, 0, fz);
  camera.position.add(effects.shakeOffset());
  for (const s of sprites) s.faceCamera(camera);

  if (!$debug.hidden) {
    $debug.textContent =
      `fps    ${fps.toFixed(0)}\ntick   ${world.tick} (${TICK_RATE} Hz)\n` +
      `me     ${me.pos.x.toFixed(0)}, ${me.pos.y.toFixed(0)}  ${Math.hypot(me.vel.x, me.vel.y).toFixed(0)} u/s\n` +
      `strike cd ${me.strikeCooldown}  aim ${input.lastAimSource}\n` +
      `ball   ${Math.hypot(b.vel.x, b.vel.y).toFixed(0)} u/s  peak ${peakBallSpeed.toFixed(0)}`;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
