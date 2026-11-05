/** Max magnitude of a quantized axis. */
export const AXIS_MAX = 127;

/** Button bits. */
export const Button = {
  Strike: 1 << 0,
  Move1: 1 << 1,
  Move2: 1 << 2,
  Signature: 1 << 3,
  Evade: 1 << 4,
} as const;

/**
 * One player's input for one tick. All fields are integers so the stream is
 * exactly reproducible (replays, rollback, network).
 */
export interface PlayerInput {
  /** Movement, each axis in [-127, 127]. +y = up the screen. */
  moveX: number;
  moveY: number;
  /** Aim direction, each axis in [-127, 127]. */
  aimX: number;
  aimY: number;
  /** Bitmask of {@link Button}. */
  buttons: number;
  /** Aim distance in world units (0 = use the move's max range). Integer, clamped to [0, 4000]. */
  aimDist?: number;
  /** Boost draft pick (M5.6): index into the draft's offers; absent or -1 = no pick. */
  pick?: number;
}

export const NEUTRAL_INPUT: Readonly<PlayerInput> = Object.freeze({
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  buttons: 0,
});

const q = (v: number): number => {
  const c = Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));
  return Math.round(c * AXIS_MAX);
};

/** Quantize float axes (e.g. from a gamepad) into a PlayerInput. */
export function quantizeInput(moveX: number, moveY: number, aimX = 0, aimY = 0, buttons = 0, aimDist = 0): PlayerInput {
  const d = Math.round(Math.max(0, Math.min(4000, Number.isFinite(aimDist) ? aimDist : 0)));
  return { moveX: q(moveX), moveY: q(moveY), aimX: q(aimX), aimY: q(aimY), buttons: buttons | 0, aimDist: d };
}
