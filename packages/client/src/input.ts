import { Button, quantizeInput, type PlayerInput } from '@pokeathlon/sim';

const DEADZONE = 0.18;
const AIM_DEADZONE = 0.35;

export type AimSource = 'stick' | 'mouse' | 'none';

/** Keyboard + mouse + first gamepad → quantized PlayerInput. */
export class InputSource {
  private keys = new Set<string>();
  private mouseDown = false;
  /** Mouse position in normalised device coords (-1..1). */
  readonly mouseNdc = { x: 0, y: 0 };
  private mouseActive = false;
  private pendingDigits: number[] = [];
  private pendingActions: string[] = [];
  lastAimSource: AimSource = 'none';

  constructor(target: Window, canvas: HTMLCanvasElement) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) this.pendingDigits.push(Number(m[1]));
      if (e.code === 'F3') {
        this.pendingActions.push('debug');
        e.preventDefault();
      }
      if (e.code === 'KeyR') this.pendingActions.push('restart');
      if (e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseNdc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseNdc.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.mouseActive = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      this.mouseActive = true;
    });
    target.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /**
   * @param mouseAim world-space vector from the player to the mouse's ground point (or null)
   */
  poll(mouseAim: { x: number; y: number } | null): PlayerInput {
    let x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let y = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    let ax = 0;
    let ay = 0;
    let buttons = 0;
    if (this.mouseDown || this.down('KeyJ', 'KeyK')) buttons |= Button.Strike;
    if (this.down('Space', 'ShiftLeft', 'KeyL')) buttons |= Button.Evade;

    const pad = navigator.getGamepads?.().find((g) => g?.connected);
    if (pad) {
      if (x === 0 && y === 0) {
        const gx = pad.axes[0] ?? 0;
        const gy = -(pad.axes[1] ?? 0);
        const mag = Math.hypot(gx, gy);
        if (mag > DEADZONE) {
          const s = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag;
          x = gx * s;
          y = gy * s;
        }
      }
      const rx = pad.axes[2] ?? 0;
      const ry = -(pad.axes[3] ?? 0);
      if (Math.hypot(rx, ry) > AIM_DEADZONE) {
        ax = rx;
        ay = ry;
        this.lastAimSource = 'stick';
        this.mouseActive = false;
      }
      // A, RB, RT strike; B, LB evade.
      if ([0, 5, 7].some((i) => pad.buttons[i]?.pressed)) buttons |= Button.Strike;
      if ([1, 4].some((i) => pad.buttons[i]?.pressed)) buttons |= Button.Evade;
    }

    if (ax === 0 && ay === 0 && this.mouseActive && mouseAim) {
      const l = Math.hypot(mouseAim.x, mouseAim.y);
      if (l > 1) {
        ax = mouseAim.x / l;
        ay = mouseAim.y / l;
        this.lastAimSource = 'mouse';
      }
    }
    if (ax === 0 && ay === 0 && !this.mouseActive) this.lastAimSource = 'none';

    return quantizeInput(x, y, ax, ay, buttons);
  }

  takeDigits(): number[] {
    const d = this.pendingDigits;
    this.pendingDigits = [];
    return d;
  }

  takeActions(): string[] {
    const t = this.pendingActions;
    this.pendingActions = [];
    return t;
  }
}
