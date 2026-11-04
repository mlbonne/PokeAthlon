import * as THREE from 'three';
import { roster, type PokemonDef } from '@pokeathlon/data';
import {
  createWorld,
  DT,
  NEUTRAL_INPUT,
  step,
  TICK_RATE,
  type PlayerInput,
  type Vec2,
  type World,
} from '@pokeathlon/sim';
import { InputSource } from './input';
import { buildArena } from './render/arena';
import { facingRow, PmdSprite } from './render/pmdSprite';
import { toThreeX, toThreeZ } from './render/units';

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
// M0 sandbox: the whole roster stands on the pitch; you control one at a time.
const world: World = createWorld(
  roster.map((p, i) => ({
    pokemonId: p.id,
    team: i < 4 ? 0 : 1,
    pos: { x: -1050 + (i % 4) * 700, y: i < 4 ? 350 : -350 },
  })),
);
buildArenaOnce(world);

const sprites = world.players.map((p) => {
  const s = new PmdSprite();
  scene.add(s.object);
  void s.load(roster.find((r) => r.id === p.pokemonId)!.dex);
  return s;
});

let controlled = 0;
const prevPos: Vec2[] = world.players.map((p) => ({ ...p.pos }));

function buildArenaOnce(w: World): void {
  scene.add(buildArena(w.arena));
}

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
showCard(roster[0]!);

// ---------- Loop ----------
const input = new InputSource(window);
let acc = 0;
let last = performance.now();
let fps = 0;

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

  for (const d of input.takeDigits()) {
    if (d <= world.players.length) {
      controlled = d - 1;
      showCard(roster.find((r) => r.id === world.players[controlled]!.pokemonId)!);
    }
  }
  for (const t of input.takeToggles()) if (t === 'debug') $debug.hidden = !$debug.hidden;

  // Fixed-step simulation.
  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 5) {
    const mine = input.poll();
    const inputs: PlayerInput[] = world.players.map((p) => (p.id === controlled ? mine : NEUTRAL_INPUT));
    world.players.forEach((p, i) => (prevPos[i] = { ...p.pos }));
    step(world, inputs);
    acc -= DT;
    steps++;
  }
  if (steps === 5) acc = 0; // drop backlog after a stall
  const alpha = acc / DT;

  // Render with interpolation.
  world.players.forEach((p, i) => {
    const s = sprites[i]!;
    const a = prevPos[i]!;
    const x = a.x + (p.pos.x - a.x) * alpha;
    const y = a.y + (p.pos.y - a.y) * alpha;
    s.object.position.set(toThreeX(x), 0, toThreeZ(y));
    const speed = Math.hypot(p.vel.x, p.vel.y);
    s.play(speed > 20 ? 'Walk' : 'Idle');
    s.update(dt, facingRow(p.facing.x, p.facing.y), speed > 20 ? Math.max(0.6, speed / 300) : 1);
  });

  // Camera: frame the arena, drift slightly towards the controlled Pokémon.
  const me = world.players[controlled]!;
  const fx = toThreeX(me.pos.x) * 0.12;
  const fz = toThreeZ(me.pos.y) * 0.1;
  // Fit the whole arena (+ margin for goals and the near edge's perspective growth).
  const fitW = (toThreeX(world.arena.halfWidth) * 2 + 5) * 1.12 / camera.aspect;
  const fitH = toThreeX(world.arena.halfHeight) * 2 + 7;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const dist = Math.max(fitW, fitH) / 2 / Math.tan(halfFov);
  camera.position.set(fx, Math.sin(CAMERA_PITCH) * dist, fz + Math.cos(CAMERA_PITCH) * dist);
  camera.lookAt(fx, 0, fz);
  for (const s of sprites) s.faceCamera(camera);

  if (!$debug.hidden) {
    $debug.textContent =
      `fps   ${fps.toFixed(0)}\ntick  ${world.tick} (${TICK_RATE} Hz)\n` +
      `pos   ${me.pos.x.toFixed(0)}, ${me.pos.y.toFixed(0)}\nvel   ${Math.hypot(me.vel.x, me.vel.y).toFixed(0)} u/s`;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
