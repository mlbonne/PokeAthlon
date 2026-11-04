import { Button, quantizeInput, type PlayerInput } from '@pokeathlon/sim';

const DEADZONE = 0.18;
const AIM_DEADZONE = 0.35;

export type AimSource = 'stick' | 'mouse' | 'none';

/** Standard-mapping gamepad buttons used outside the match input. */
const PAD = { A: 0, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** Keyboard + mouse + first gamepad → quantized PlayerInput. */
export class InputSource {
  private keys = new Set<string>();
  private mouseDown = false;
  private mouseRight = false;
  /** Mouse position in normalised device coords (-1..1). */
  readonly mouseNdc = { x: 0, y: 0 };
  private mouseActive = false;
  private pendingDigits: number[] = [];
  private pendingActions: string[] = [];
  lastAimSource: AimSource = 'none';
  /** Last device the player touched (switches on-screen button prompts). */
  device: 'keyboard' | 'pad' = 'keyboard';
  private padPrev: boolean[] = [];

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
      if (e.code === 'Backspace') this.pendingActions.push('restart');
      if (e.code === 'Escape') this.pendingActions.push('menu');
      const nav = { ArrowUp: 'nav-up', ArrowDown: 'nav-down', ArrowLeft: 'nav-left', ArrowRight: 'nav-right' }[e.code];
      if (nav) this.pendingActions.push(nav);
      this.device = 'keyboard';
      if (e.code === 'Space' || e.code === 'Backspace') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.mouseRight = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseNdc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseNdc.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.mouseActive = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.mouseRight = true;
      this.mouseActive = true;
    });
    target.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.mouseRight = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Hot-plugging: announce controllers as they come and go.
    target.addEventListener('gamepadconnected', (e) => {
      this.pendingActions.push(`pad-on:${(e as GamepadEvent).gamepad.id}`);
      this.device = 'pad';
    });
    target.addEventListener('gamepaddisconnected', (e) => {
      this.pendingActions.push(`pad-off:${(e as GamepadEvent).gamepad.id}`);
      this.padPrev = [];
      if (!navigator.getGamepads?.().some((g) => g?.connected)) this.device = 'keyboard';
    });
  }

  /**
   * Per frame (also while the setup screen is open): gamepad edges for Start (menu), Back (debug)
   * and D-pad / A (menu navigation), and which device is in use.
   */
  pollPad(): void {
    const pad = navigator.getGamepads?.().find((g) => g?.connected);
    if (!pad) return;
    const now = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => now[i] && !this.padPrev[i];
    if (edge(PAD.START)) this.pendingActions.push('menu');
    if (edge(PAD.BACK)) this.pendingActions.push('debug');
    if (edge(PAD.UP)) this.pendingActions.push('nav-up');
    if (edge(PAD.DOWN)) this.pendingActions.push('nav-down');
    if (edge(PAD.LEFT)) this.pendingActions.push('nav-left');
    if (edge(PAD.RIGHT)) this.pendingActions.push('nav-right');
    if (edge(PAD.A)) this.pendingActions.push('nav-press');
    if (now.some(Boolean) || pad.axes.some((a) => Math.abs(a) > 0.5)) this.device = 'pad';
    this.padPrev = now;
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
    if (this.down('Space', 'ShiftLeft', 'KeyF')) buttons |= Button.Evade;
    if (this.mouseRight || this.down('KeyQ', 'KeyU')) buttons |= Button.Move1;
    if (this.down('KeyE', 'KeyI')) buttons |= Button.Move2;
    if (this.down('KeyR', 'KeyO')) buttons |= Button.Signature;

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
      // A, RB, RT strike; B, LB evade; X, Y, LT moves. Triggers count from half-way (analog).
      const trig = (i: number) => (pad.buttons[i]?.value ?? 0) > 0.4 || !!pad.buttons[i]?.pressed;
      if (pad.buttons[0]?.pressed || pad.buttons[5]?.pressed || trig(7)) buttons |= Button.Strike;
      if ([1, 4].some((i) => pad.buttons[i]?.pressed)) buttons |= Button.Evade;
      if (pad.buttons[2]?.pressed) buttons |= Button.Move1;
      if (pad.buttons[3]?.pressed) buttons |= Button.Move2;
      if (trig(6)) buttons |= Button.Signature;
    }

    let aimDist = 0;
    if (ax === 0 && ay === 0 && this.mouseActive && mouseAim) {
      const l = Math.hypot(mouseAim.x, mouseAim.y);
      if (l > 1) {
        ax = mouseAim.x / l;
        ay = mouseAim.y / l;
        aimDist = l;
        this.lastAimSource = 'mouse';
      }
    }
    if (ax === 0 && ay === 0 && !this.mouseActive) this.lastAimSource = 'none';

    return quantizeInput(x, y, ax, ay, buttons, aimDist);
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
