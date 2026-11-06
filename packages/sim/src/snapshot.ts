import { forgetPerception } from './ai/perceive';
import type { World } from './world';

// Available in every browser and Node 17+; the sim's ES-only lib doesn't declare it.
declare function structuredClone<T>(value: T): T;

/** A saved copy of everything in a world that changes during a match (the stage is static and shared). */
export type WorldSnapshot = Omit<World, 'stage'>;

/** Copy the world's state (M7 rollback). About 0.5 ms for a 3v3 match. */
export function snapshotWorld(w: World): WorldSnapshot {
  const state: Partial<World> = { ...w };
  delete state.stage;
  return structuredClone(state as WorldSnapshot);
}

/**
 * Put a snapshot back into `w` in place, so every holder of the `w` reference sees the restored
 * state. The snapshot itself is not consumed and can be restored again.
 */
export function restoreWorld(w: World, snap: WorldSnapshot): void {
  Object.assign(w, structuredClone(snap));
  // Caches keyed by the world object would otherwise still describe the abandoned timeline.
  forgetPerception(w);
}
