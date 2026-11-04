import { quantizeInput, type PlayerInput } from '@pokeathlon/sim';

const DEADZONE = 0.18;

/** Keyboard + first gamepad → quantized PlayerInput. */
export class InputSource {
  private keys = new Set<string>();
  /** Number keys pressed since the last poll (for roster switching). */
  private pendingDigits: number[] = [];
  private pendingToggles: string[] = [];

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) this.pendingDigits.push(Number(m[1]));
      if (e.code === 'F3') {
        this.pendingToggles.push('debug');
        e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  poll(): PlayerInput {
    let x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let y = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);

    const pad = navigator.getGamepads?.().find((g) => g?.connected);
    if (pad && x === 0 && y === 0) {
      const gx = pad.axes[0] ?? 0;
      const gy = -(pad.axes[1] ?? 0);
      const mag = Math.hypot(gx, gy);
      if (mag > DEADZONE) {
        // Rescale so the stick starts at 0 just outside the deadzone.
        const s = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag;
        x = gx * s;
        y = gy * s;
      }
    }
    return quantizeInput(x, y);
  }

  takeDigits(): number[] {
    const d = this.pendingDigits;
    this.pendingDigits = [];
    return d;
  }

  takeToggles(): string[] {
    const t = this.pendingToggles;
    this.pendingToggles = [];
    return t;
  }
}
