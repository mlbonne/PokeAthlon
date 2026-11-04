import { getKit, roster, type PokemonDef } from '@pokeathlon/data';
import type { PlayerSpawn } from '@pokeathlon/sim';

/** Everything needed to start a match. */
export interface MatchConfig {
  lineup: PlayerSpawn[];
  /** Index of the human player in `lineup` (−1 = spectate, all bots). */
  me: number;
  diff: 'easy' | 'normal' | 'hard';
  practice: boolean;
}

type Mode = '1v1' | '3v3';
export interface Saved {
  mode: Mode;
  /** Your Pokémon, then your 2 teammates (3v3), then the enemies; '?' = random. */
  blue: string[];
  red: string[];
  role: 'forward' | 'goalie';
  diff: MatchConfig['diff'];
}

const STORE = 'pokeathlon.setup';
const RANDOM = '?';
const kitted = (): PokemonDef[] => roster.filter((r) => getKit(r.id));

const DEFAULTS: Saved = {
  mode: '3v3',
  blue: ['pikachu', 'lucario', 'snorlax'],
  red: ['togekiss', 'lucario', 'snorlax'],
  role: 'forward',
  diff: 'normal',
};

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Saved | null;
    if (s && s.blue?.length === 3 && s.red?.length === 3) return { ...DEFAULTS, ...s };
  } catch {
    /* storage blocked or corrupt: use defaults */
  }
  return { ...DEFAULTS, blue: [...DEFAULTS.blue], red: [...DEFAULTS.red] };
}

function save(s: Saved): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/**
 * Pre-match setup (M4.5): 1v1 or 3v3, your Pokémon and role, your two bot teammates, the three
 * enemy bots, and bot difficulty. Also starts a spectator match or the practice sandbox.
 * Works with mouse, keyboard (Tab / Enter) and gamepad (D-pad + A, via `navigate`).
 */
export class SetupScreen {
  readonly el: HTMLElement;
  private s: Saved = load();

  constructor(
    root: HTMLElement,
    private readonly onStart: (c: MatchConfig) => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'setup';
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => this.onClick(e));
    root.append(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.el.hidden = false;
    this.render();
    this.el.querySelector<HTMLElement>('[data-go="play"]')?.focus();
  }

  hide(): void {
    this.el.hidden = true;
  }

  /** Gamepad / arrow-key focus movement between the screen's buttons. */
  navigate(dir: 'up' | 'down' | 'left' | 'right' | 'press'): void {
    const items = [...this.el.querySelectorAll<HTMLElement>('button')];
    const cur = document.activeElement as HTMLElement | null;
    const i = cur ? items.indexOf(cur) : -1;
    if (dir === 'press') {
      cur?.click();
      return;
    }
    if (i < 0) {
      items[0]?.focus();
      return;
    }
    // Pick the nearest button in that direction.
    const r = cur!.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const b of items) {
      if (b === cur) continue;
      const q = b.getBoundingClientRect();
      const dx = q.left + q.width / 2 - cx;
      const dy = q.top + q.height / 2 - cy;
      const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
      if (!ok) continue;
      const d = dir === 'up' || dir === 'down' ? Math.abs(dy) * 1 + Math.abs(dx) * 0.4 : Math.abs(dx) + Math.abs(dy) * 2;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    best?.focus();
  }

  private render(): void {
    const s = this.s;
    const n = s.mode === '3v3' ? 3 : 1;
    const picker = (team: 'blue' | 'red', slot: number, label: string) => {
      const cur = s[team][slot]!;
      const chips = [...kitted(), null]
        .map((p) => {
          const id = p ? p.id : RANDOM;
          const img = p ? `<img src="portraits/${p.dex}/Normal.png" alt="">` : '<span class="rnd">?</span>';
          return `<button class="chip ${cur === id ? 'on' : ''}" data-pick="${team}:${slot}:${id}" title="${p ? p.name : 'Random'}">${img}<small>${p ? p.name : 'Random'}</small></button>`;
        })
        .join('');
      return `<div class="slot"><div class="slot-label">${label}</div><div class="chips">${chips}</div></div>`;
    };
    const goalieSlot = n - 1;
    const blueLabel = (i: number) => {
      if (i === 0) return `You${n === 3 ? ` · ${s.role === 'goalie' ? 'Goalie' : 'Forward'}` : ''}`;
      // With you in goal, the last bot slot plays forward instead.
      const role = s.role === 'goalie' ? 'Forward' : i === goalieSlot ? 'Goalie' : 'Forward';
      return `Teammate (CPU) · ${role}`;
    };
    const toggle = (key: string, value: string, label: string, on: boolean) =>
      `<button class="tog ${on ? 'on' : ''}" data-set="${key}:${value}">${label}</button>`;
    this.el.innerHTML = `
      <div class="setup-card">
        <h1>PokéAthlon <small>match setup</small></h1>
        <div class="row">
          <div class="group"><span>Mode</span>${toggle('mode', '1v1', '1 vs 1', s.mode === '1v1')}${toggle('mode', '3v3', '3 vs 3', s.mode === '3v3')}</div>
          ${n === 3 ? `<div class="group"><span>Your role</span>${toggle('role', 'forward', 'Forward', s.role === 'forward')}${toggle('role', 'goalie', 'Goalie', s.role === 'goalie')}</div>` : ''}
          <div class="group"><span>CPU skill</span>${(['easy', 'normal', 'hard'] as const).map((d) => toggle('diff', d, d[0]!.toUpperCase() + d.slice(1), s.diff === d)).join('')}</div>
        </div>
        <div class="teams">
          <div class="team blue"><h2>Blue team</h2>${Array.from({ length: n }, (_, i) => picker('blue', i, blueLabel(i))).join('')}</div>
          <div class="team red"><h2>Red team (CPU)</h2>${Array.from({ length: n }, (_, i) =>
            picker('red', i, n === 3 && i === goalieSlot ? 'Goalie' : 'Forward'),
          ).join('')}</div>
        </div>
        <div class="row go">
          <button class="big" data-go="play">Play</button>
          <button data-go="spectate">Watch CPU vs CPU</button>
          <button data-go="practice">Practice</button>
        </div>
        <p class="hint">Mouse, keyboard or controller (D-pad + A). In a match: Esc / Start returns here · F3 / Back debug menu.</p>
      </div>`;
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const s = this.s;
    if (t.dataset.pick) {
      const [team, slot, id] = t.dataset.pick.split(':') as ['blue' | 'red', string, string];
      s[team][Number(slot)] = id;
    } else if (t.dataset.set) {
      const [key, value] = t.dataset.set.split(':') as [string, string];
      if (key === 'mode') s.mode = value as Mode;
      if (key === 'role') s.role = value as Saved['role'];
      if (key === 'diff') s.diff = value as Saved['diff'];
    } else if (t.dataset.go) {
      save(s);
      this.onStart(this.config(t.dataset.go as 'play' | 'spectate' | 'practice'));
      return;
    }
    save(s);
    const focus = t.dataset.pick ?? t.dataset.set;
    this.render();
    if (focus) this.el.querySelector<HTMLElement>(`[data-pick="${focus}"], [data-set="${focus}"]`)?.focus();
  }

  private config(go: 'play' | 'spectate' | 'practice'): MatchConfig {
    const ids = kitted().map((p) => p.id);
    return buildConfig(this.s, go, (id) => (id === RANDOM ? ids[Math.floor(Math.random() * ids.length)]! : id));
  }
}

/**
 * The match a setup produces. `pick` resolves '?' (random) picks; random choice happens here, in
 * the client, never inside the deterministic sim. You are always player 0 on Blue.
 */
export function buildConfig(s: Saved, go: 'play' | 'spectate' | 'practice', pick: (id: string) => string): MatchConfig {
  if (go === 'practice') {
    return { lineup: [{ pokemonId: pick(s.blue[0]!), team: 0 }, { pokemonId: pick(s.red[0]!), team: 1 }], me: 0, diff: s.diff, practice: true };
  }
  const lineup: PlayerSpawn[] = [];
  if (s.mode === '1v1') {
    lineup.push({ pokemonId: pick(s.blue[0]!), team: 0 }, { pokemonId: pick(s.red[0]!), team: 1 });
  } else {
    // Your role decides who keeps goal for Blue.
    const youGoalie = s.role === 'goalie';
    lineup.push(youGoalie ? { pokemonId: pick(s.blue[0]!), team: 0, role: 'goalie' } : { pokemonId: pick(s.blue[0]!), team: 0, slot: 0 });
    lineup.push({ pokemonId: pick(s.blue[1]!), team: 0, slot: youGoalie ? 0 : 1 });
    lineup.push(youGoalie ? { pokemonId: pick(s.blue[2]!), team: 0, slot: 1 } : { pokemonId: pick(s.blue[2]!), team: 0, role: 'goalie' });
    lineup.push({ pokemonId: pick(s.red[0]!), team: 1, slot: 0 }, { pokemonId: pick(s.red[1]!), team: 1, slot: 1 }, { pokemonId: pick(s.red[2]!), team: 1, role: 'goalie' });
  }
  return { lineup, me: go === 'spectate' ? -1 : 0, diff: go === 'spectate' ? 'hard' : s.diff, practice: false };
}
