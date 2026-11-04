/** World units (sim) → Three.js units. */
export const WORLD_TO_THREE = 1 / 100;
/** World units per sprite pixel. OS bodies are 92 wide; PMD Pikachu walk frame (32 px) ≈ 128 units. */
export const WORLD_PER_PIXEL = 4;
export const PIXEL = WORLD_PER_PIXEL * WORLD_TO_THREE;

/** Sim (x, y up the screen) → Three (x, z), with y as height. */
export const toThreeX = (x: number): number => x * WORLD_TO_THREE;
export const toThreeZ = (y: number): number => -y * WORLD_TO_THREE;
