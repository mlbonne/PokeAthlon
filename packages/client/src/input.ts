import { Button, quantizeInput, type PlayerInput } from '@pokeathlon/sim';

const DEADZONE = 0.18;
const AIM_DEADZONE = 0.35;

export type AimSource = 'stick' | 'mouse' | 'none';

/** Standard-mapping gamepad buttons used outside the match input. */
const PAD = { A: 0, B: 1, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** Keyboard + mouse + first gamepad → quantized PlayerInput. */
export class InputSource {
  private keys = new Set<string>();
  /** Is a key held right now (e.g. Tab for the scoreboard)? */
  isHeld(code: string): boolean {
    return this.keys.has(code);
  }
  private mouseDown = false;
  private mouseRight = false;
  /** Side (thumb) mouse buttons: Back = 3, Forward = 4. */
  private mouseSide = false;
  /** Mouse position in normalised device coords (-1..1). */
  readonly mouseNdc = { x: 0, y: 0 };
  private mouseActive = false;
  private pendingActions: string[] = [];
  lastAimSource: AimSource = 'none';
  /** Last device the player touched (switches on-screen button prompts). */
  device: 'keyboard' | 'pad' = 'keyboard';
  private padPrev: boolean[] = [];
  /** Hold-to-aim: move buttons held last poll, and quick taps seen between polls (pressed and released). */
  private prevHeld = [false, false, false];
  private tapped = [false, false, false];
  /** The move slot being aimed (held, not yet cast), or −1. */
  aiming = -1;

  constructor(target: Window, canvas: HTMLCanvasElement) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Typing in a text field (trainer name, room code): only Esc reaches the game.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        if (e.code === 'Escape') this.pendingActions.push('menu');
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'Space') this.tapped[1] = true;
      if (e.code === 'KeyR' || e.code === 'KeyF') this.tapped[2] = true;
      if (e.code === 'F3') {
        this.pendingActions.push('debug');
        e.preventDefault();
      }
      if (e.code === 'Backspace') this.pendingActions.push('restart');
      if (e.code === 'Escape') this.pendingActions.push('menu');
      const nav = { ArrowUp: 'nav-up', ArrowDown: 'nav-down', ArrowLeft: 'nav-left', ArrowRight: 'nav-right' }[e.code];
      if (nav) this.pendingActions.push(nav);
      this.device = 'keyboard';
      if (e.code === 'Space' || e.code === 'Backspace' || e.code === 'Tab' || e.code === 'KeyF') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.mouseRight = false;
      this.mouseSide = false;
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
      if (e.button === 3 || e.button === 4) this.mouseSide = true;
      if (e.button === 2) this.tapped[0] = true;
      if (e.button === 3 || e.button === 4) this.tapped[2] = true;
      this.mouseActive = true;
    });
    target.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.mouseRight = false;
      if (e.button === 3 || e.button === 4) this.mouseSide = false;
    });
    // The side buttons would otherwise navigate the browser back / forward.
    for (const ev of ['mousedown', 'mouseup', 'auxclick'] as const) {
      canvas.addEventListener(ev, (e) => {
        if (e.button === 3 || e.button === 4) e.preventDefault();
      });
    }
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
    if (edge(PAD.B)) this.pendingActions.push('nav-back');
    if (now.some(Boolean) || pad.axes.some((a) => Math.abs(a) > 0.5)) this.device = 'pad';
    this.padPrev = now;
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /**
   * @param mouseAim world-space vector from the player to the mouse's ground point (or null)
   */
  /**
   * @param aim hold-to-aim: when `holdToAim`, a move button only reaches the game when it is
   * released (one tick), so the player aims while holding (the client shows a preview). Slots in
   * `passThrough` (charge moves: hold to charge) keep the held button as before.
   */
  poll(mouseAim: { x: number; y: number } | null, aim: { holdToAim: boolean; passThrough: ReadonlySet<number> } = { holdToAim: false, passThrough: new Set() }): PlayerInput {
    let x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let y = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    let ax = 0;
    let ay = 0;
    let buttons = 0;
    // Keyboard + mouse (OS-style): LMB Strike · RMB Primary · Space Secondary · R / F / side mouse
    // button Special · Shift / Q Evade (Burst when the meter is full).
    if (this.mouseDown) buttons |= Button.Strike;
    const held = [this.mouseRight, this.down('Space'), this.mouseSide || this.down('KeyR', 'KeyF')];
    if (this.down('ShiftLeft', 'ShiftRight', 'KeyQ')) buttons |= Button.Evade;

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
      if (pad.buttons[2]?.pressed) held[0] = true;
      if (pad.buttons[3]?.pressed) held[1] = true;
      if (trig(6)) held[2] = true;
    }

    // Moves: cast on press (classic) or, with hold-to-aim, on release.
    const bits = [Button.Move1, Button.Move2, Button.Signature];
    this.aiming = -1;
    for (let s = 0; s < 3; s++) {
      const h = held[s]!;
      const was = this.prevHeld[s]!;
      if (!aim.holdToAim || aim.passThrough.has(s)) {
        if (h || this.tapped[s]) buttons |= bits[s]!;
      } else {
        if (h) this.aiming = s;
        if (!h && (was || this.tapped[s])) buttons |= bits[s]!;
      }
      this.prevHeld[s] = h;
      this.tapped[s] = false;
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

  takeActions(): string[] {
    const t = this.pendingActions;
    this.pendingActions = [];
    return t;
  }
}
