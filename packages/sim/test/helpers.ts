import { createWorld, quantizeInput, step, type PlayerInput, type PlayerSpawn, type SimEvent, type World } from '../src/index';

export const idle: PlayerInput = quantizeInput(0, 0);

/** Sandbox world (rules on, no kickoff) with players at explicit positions. */
export function sandbox(spawns: PlayerSpawn[], ballPos = { x: 0, y: 0 }): World {
  return createWorld(spawns, { mode: 'sandbox', ballPos });
}

/** Step `n` ticks with fixed inputs; returns every event produced. */
export function run(w: World, n: number, inputs: (PlayerInput | undefined)[] = []): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    step(w, inputs);
    all.push(...w.events);
  }
  return all;
}

export const types = (evs: SimEvent[]) => evs.map((e) => e.type);
export const speedOf = (w: World) => Math.hypot(w.ball.vel.x, w.ball.vel.y);
