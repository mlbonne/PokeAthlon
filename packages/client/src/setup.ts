import { getItem, getPokemon, itemsFor, type PokemonDef } from '@pokeathlon/data';
import { analyzeRoster, simTier, tierSnapshot, type FighterStats } from '@pokeathlon/data/analyze';
import type { PlayerSpawn } from '@pokeathlon/sim';
import { cpuBan, cpuItem, cpuPick, pickable, seededRand, type Role } from './cpuDraft';

/** Everything needed to start a match. */
export interface MatchConfig {
  lineup: PlayerSpawn[];
  /** Index of the human player in `lineup` (−1 = spectate, all bots). */
  me: number;
  diff: 'easy' | 'normal' | 'hard';
  practice: boolean;
}

/** Slot values: a Pokémon id, '?' (random) or 'auto' (the CPU picks). */
export interface Saved {
  /** You, then your 2 teammates. */
  blue: string[];
  red: string[];
  /** Items for Blue's slots: an item id or 'auto'. */
  items: string[];
  role: 'forward' | 'goalie';
  diff: MatchConfig['diff'];
  /** Bans (OS Competitive): each team bans one Pokémon before picks. */
  bans: boolean;
  /** Blue's ban ('' = none yet). */
  ban: string;
  /** Seed for the CPU picks shown on screen (Reroll changes it). */
  seed: number;
}

/** CPU picks resolved for display and play. */
export interface Resolved {
  blue: string[];
  red: string[];
  blueItems: string[];
  redItems: string[];
  redBan: string;
}

const STORE = 'pokeathlon.pick';
export const RANDOM = '?';
export const AUTO = 'auto';

const DEFAULTS: Saved = {
  blue: ['pikachu', AUTO, AUTO],
  red: [AUTO, AUTO, AUTO],
  items: [AUTO, AUTO, AUTO],
  role: 'forward',
  diff: 'normal',
  bans: false,
  ban: '',
  seed: 1,
};

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Saved | null;
    if (s && s.blue?.length === 3 && s.red?.length === 3 && s.items?.length === 3) return { ...DEFAULTS, ...s };
  } catch {
    /* storage blocked or corrupt: use defaults */
  }
  return structuredClone(DEFAULTS);
}

function save(s: Saved): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Roles of Blue's slots (you first) and Red's slots. */
export const blueRoles = (s: Pick<Saved, 'role'>): Role[] => (s.role === 'goalie' ? ['goalie', 'forward', 'forward'] : ['forward', 'forward', 'goalie']);
export const RED_ROLES: Role[] = ['forward', 'forward', 'goalie'];

/** Fill 'auto' slots with CPU picks (goalies first), bans and items. Pure given `s`. */
export function resolvePicks(s: Saved): Resolved {
  const rand = seededRand(s.seed * 7919 + (s.bans ? 1 : 0));
  const redBan = s.bans ? cpuBan(s.diff, s.ban ? [s.ban] : [], rand) : '';
  const banned = s.bans ? [s.ban, redBan].filter(Boolean) : [];
  const fill = (slots: string[], roles: Role[]): string[] => {
    const out = slots.map((x) => (x !== AUTO && banned.includes(x) ? AUTO : x));
    const order = roles.map((r, i) => ({ r, i })).sort((a, b) => (a.r === 'goalie' ? -1 : 0) - (b.r === 'goalie' ? -1 : 0));
    for (const { r, i } of order) {
      if (out[i] !== AUTO) continue;
      out[i] = cpuPick(r, out.filter((x) => x !== AUTO && x !== RANDOM), banned, s.diff, rand);
    }
    return out;
  };
  const bRoles = blueRoles(s);
  const blue = fill(s.blue, bRoles);
  const red = fill(s.red, RED_ROLES);
  return {
    blue,
    red,
    blueItems: blue.map((id, i) => (s.items[i] && s.items[i] !== AUTO ? s.items[i]! : id === RANDOM ? AUTO : cpuItem(id, bRoles[i]!))),
    redItems: red.map((id, i) => (id === RANDOM ? AUTO : cpuItem(id, RED_ROLES[i]!))),
    redBan,
  };
}

const TIER_CLASS = (t: string) => `t-${t.replace('.', '_')}`;
function tierOf(id: string, role: Role): { tier: string; uncertain: boolean } | null {
  const e = tierSnapshot.entries.find((x) => x.pokemon === id);
  const r = e?.[role];
  if (!r || !r.games) return null;
  const t = simTier(r.wins, r.games);
  return { tier: t.tier, uncertain: t.uncertain };
}
const tierBadge = (id: string, role: Role) => {
  const t = tierOf(id, role);
  return t ? `<b class="tier ${TIER_CLASS(t.tier)}" title="${role} tier from bot matches">${t.tier}${t.uncertain ? '?' : ''}</b>` : '';
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const portrait = (p: PokemonDef | null) => (p ? `<img src="portraits/${p.dex}/Normal.png" alt="">` : '<span class="rnd">?</span>');
const nameOf = (id: string) => (id === RANDOM ? 'Random' : id === AUTO ? 'CPU picks' : getPokemon(id).name);

type Sel = { team: 'blue' | 'red'; i: number } | { team: 'ban'; i: 0 };

/**
 * Pick screen (M5.7, OS Striker Select). Your role, then for each of the 6 slots a Pokémon (and an
 * item for Blue). CPU slots show what the CPU will pick before you play (Reroll to change). No
 * duplicates within a team; mirrors across teams are allowed. Optional bans: one per team.
 * Mouse, keyboard (Tab / Enter) and gamepad (D-pad + A via `navigate`).
 */
export class SetupScreen {
  readonly el: HTMLElement;
  private s: Saved = load();
  private sel: Sel = { team: 'blue', i: 0 };
  /** Pokémon shown in the detail card (hover / focus), else the selected slot's. */
  private look: string | null = null;
  private readonly stats = new Map<string, FighterStats>(analyzeRoster().map((f) => [f.id, f]));

  constructor(
    root: HTMLElement,
    private readonly onStart: (c: MatchConfig) => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'setup';
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => this.onClick(e));
    const peek = (e: Event) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-mon]')?.dataset.mon;
      if (id && id !== this.look) {
        this.look = id;
        this.renderDetail();
      }
    };
    this.el.addEventListener('mouseover', peek);
    this.el.addEventListener('focusin', peek);
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
    const items = [...this.el.querySelectorAll<HTMLElement>('button:not([disabled])')];
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
      const d = dir === 'up' || dir === 'down' ? Math.abs(dy) + Math.abs(dx) * 0.4 : Math.abs(dx) + Math.abs(dy) * 2;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    best?.focus();
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    const s = this.s;
    const res = resolvePicks(s);
    const bRoles = blueRoles(s);
    const banned = s.bans ? [s.ban, res.redBan].filter(Boolean) : [];
    const isSel = (team: string, i: number) => this.sel.team === team && this.sel.i === i;
    const slotCard = (team: 'blue' | 'red', i: number) => {
      const raw = (team === 'blue' ? s.blue : s.red)[i]!;
      const id = (team === 'blue' ? res.blue : res.red)[i]!;
      const role = (team === 'blue' ? bRoles : RED_ROLES)[i]!;
      const item = team === 'blue' ? res.blueItems[i]! : res.redItems[i]!;
      const who = team === 'blue' ? (i === 0 ? 'You' : 'Teammate (CPU)') : 'CPU';
      const p = id === RANDOM ? null : getPokemon(id);
      const cpu = raw === AUTO ? '<i class="cpu">CPU pick</i>' : '';
      const itemName = item === AUTO ? '' : getItem(item).name;
      return `<button class="slotcard ${team} ${isSel(team, i) ? 'sel' : ''}" data-slot="${team}:${i}" ${p ? `data-mon="${p.id}"` : ''}>
        ${portrait(p)}<span class="who">${who} · ${role === 'goalie' ? 'Goalie' : 'Forward'}</span>
        <span class="nm"><b>${esc(nameOf(id))}</b> ${p ? tierBadge(p.id, role) : ''} ${cpu}</span><small>${esc(itemName)}</small></button>`;
    };
    const banCard = () =>
      s.bans
        ? `<div class="bans"><button class="slotcard ban ${isSel('ban', 0) ? 'sel' : ''}" data-slot="ban:0" ${s.ban ? `data-mon="${s.ban}"` : ''}>
            ${portrait(s.ban ? getPokemon(s.ban) : null)}<span class="who">Your ban</span><b>${s.ban ? esc(getPokemon(s.ban).name) : 'Pick one'}</b></button>
            <div class="slotcard ban cpu-ban" data-mon="${res.redBan}">${portrait(getPokemon(res.redBan))}<span class="who">Red's ban (CPU)</span><b>${esc(getPokemon(res.redBan).name)}</b></div></div>`
        : '';

    // Grid: what the selected slot can take.
    const selRole: Role = this.sel.team === 'blue' ? bRoles[this.sel.i]! : this.sel.team === 'red' ? RED_ROLES[this.sel.i]! : 'forward';
    const team = this.sel.team === 'red' ? res.red : res.blue;
    const grid = pickable()
      .map((id) => {
        const p = getPokemon(id);
        const isBanned = this.sel.team !== 'ban' && banned.includes(id);
        const mine = this.sel.team !== 'ban' && team.includes(id) && team[this.sel.i] !== id;
        const on = this.sel.team === 'ban' ? s.ban === id : team[this.sel.i] === id;
        return `<button class="chip ${on ? 'on' : ''} ${mine ? 'taken' : ''}" data-pick="${id}" data-mon="${id}" ${isBanned ? 'disabled title="Banned"' : ''}>
          ${portrait(p)}<small>${esc(p.name)}</small>${tierBadge(id, selRole)}</button>`;
      })
      .join('');
    const extra =
      this.sel.team === 'ban'
        ? ''
        : `${this.sel.team === 'blue' && this.sel.i === 0 ? '' : `<button class="chip" data-pick="${AUTO}"><span class="rnd">CPU</span><small>CPU picks</small></button>`}
           <button class="chip" data-pick="${RANDOM}"><span class="rnd">?</span><small>Random</small></button>`;

    // Items for a Blue slot.
    const items =
      this.sel.team === 'blue'
        ? (() => {
            const i = this.sel.i;
            const cur = s.items[i]!;
            const role = bRoles[i]!;
            const opts = [{ id: AUTO, name: 'Recommended', desc: 'The usual pick for this Pokémon.' }, ...itemsFor(role)];
            return `<div class="items"><h3>Held item <small>(${role} items${role === 'goalie' ? ' work on your own half only' : ''})</small></h3>
              ${opts.map((it) => `<button class="item ${cur === it.id ? 'on' : ''}" data-item="${it.id}" title="${esc(it.desc)}">${esc(it.name)}</button>`).join('')}
              <p class="item-desc">${esc(cur === AUTO ? (res.blueItems[i] === AUTO ? 'Recommended item for the random pick.' : `${getItem(res.blueItems[i]!).name}: ${getItem(res.blueItems[i]!).desc}`) : getItem(cur).desc)}</p></div>`;
          })()
        : '';

    const toggle = (key: string, value: string, label: string, on: boolean) => `<button class="tog ${on ? 'on' : ''}" data-set="${key}:${value}">${label}</button>`;
    this.el.innerHTML = `
      <div class="setup-card pick">
        <h1>PokéAthlon <small>pick your team</small></h1>
        <div class="row">
          <div class="group"><span>Your role</span>${toggle('role', 'forward', 'Forward', s.role === 'forward')}${toggle('role', 'goalie', 'Goalie', s.role === 'goalie')}</div>
          <div class="group"><span>CPU skill</span>${(['easy', 'normal', 'hard'] as const).map((d) => toggle('diff', d, d[0]!.toUpperCase() + d.slice(1), s.diff === d)).join('')}</div>
          <div class="group"><span>Bans</span>${toggle('bans', 'off', 'Off', !s.bans)}${toggle('bans', 'on', 'On', s.bans)}</div>
          <button data-set="reroll:1" title="New CPU picks">Reroll CPU picks</button>
        </div>
        ${banCard()}
        <div class="pick-main">
          <div class="team blue"><h2>Blue team</h2>${[0, 1, 2].map((i) => slotCard('blue', i)).join('')}</div>
          <div class="pick-center">
            <h2>${this.sel.team === 'ban' ? 'Ban a Pokémon' : `Pick for ${this.sel.team === 'blue' && this.sel.i === 0 ? 'you' : `${this.sel.team === 'blue' ? 'Blue' : 'Red'} slot ${this.sel.i + 1}`} <small>(${selRole})</small>`}</h2>
            <div class="chips grid">${grid}${extra}</div>
            ${items}
            <div class="detail"></div>
          </div>
          <div class="team red"><h2>Red team (CPU)</h2>${[0, 1, 2].map((i) => slotCard('red', i)).join('')}</div>
        </div>
        <div class="row go">
          <button class="big" data-go="play">Play</button>
          <button data-go="spectate">Watch CPU vs CPU</button>
          <button data-go="practice">Practice</button>
        </div>
        <p class="hint">Click a slot, then a Pokémon. Mouse, keyboard or controller (D-pad + A). In a match: Esc / Start returns here · F3 / Back debug menu.</p>
      </div>`;
    this.renderDetail();
  }

  /** Detail card: stats, tiers, passive and moves with the analyzer's numbers. */
  private renderDetail(): void {
    const box = this.el.querySelector<HTMLElement>('.detail');
    if (!box) return;
    const res = resolvePicks(this.s);
    const fallback = this.sel.team === 'ban' ? this.s.ban : (this.sel.team === 'blue' ? res.blue : res.red)[this.sel.i];
    const id = this.look ?? fallback;
    if (!id || id === RANDOM || id === AUTO) {
      box.innerHTML = '';
      return;
    }
    const p = getPokemon(id);
    const f = this.stats.get(id);
    if (!f) {
      box.innerHTML = '';
      return;
    }
    const n0 = (x: number) => (x ? Math.round(x).toLocaleString('en-US') : '–');
    const move = (m: FighterStats['moves'][number]) =>
      `<li><b>${esc(m.name)}</b> <small>${m.slot === 'passive' ? 'passive' : `${m.slot} · ${m.cooldown} s`}</small>
        <span class="nums">reach ${n0(m.reach)} · ball ${n0(m.ballPower)} · KB ${n0(m.knockback)}${m.damagePerCast ? ` · dmg ${n0(m.damagePerCast)}` : ''}</span>
        ${m.notes ? `<span class="notes">${esc(m.notes)}</span>` : ''}</li>`;
    box.innerHTML = `<div class="dhead"><img src="portraits/${p.dex}/Normal.png" alt=""><div><b>${esc(p.name)}</b> <small>${esc(p.archetype.replace(/-/g, ' '))}</small><br>
        <small>Power ${p.stats.power} · Speed ${p.stats.speed} · Stagger ${p.stats.stagger} · ${p.stats.size}</small><br>
        Forward ${tierBadge(id, 'forward') || '–'} Goalie ${tierBadge(id, 'goalie') || '–'}</div></div>
      <ul class="moves">${[...(f.passive ? [f.passive] : []), ...f.moves].map(move).join('')}</ul>`;
  }

  // ---------------------------------------------------------------- input

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const s = this.s;
    let focus: string | null = null;
    if (t.dataset.slot) {
      const [team, i] = t.dataset.slot.split(':') as ['blue' | 'red' | 'ban', string];
      this.sel = team === 'ban' ? { team, i: 0 } : { team, i: Number(i) };
      this.look = null;
      focus = `[data-slot="${t.dataset.slot}"]`;
    } else if (t.dataset.pick) {
      this.assign(t.dataset.pick);
      focus = `[data-pick="${t.dataset.pick}"]`;
    } else if (t.dataset.item && this.sel.team === 'blue') {
      s.items[this.sel.i] = t.dataset.item;
      focus = `[data-item="${t.dataset.item}"]`;
    } else if (t.dataset.set) {
      const [key, value] = t.dataset.set.split(':') as [string, string];
      if (key === 'role') {
        s.role = value as Saved['role'];
        s.items = [AUTO, AUTO, AUTO]; // items are role-locked
      }
      if (key === 'diff') s.diff = value as Saved['diff'];
      if (key === 'bans') {
        s.bans = value === 'on';
        this.sel = s.bans ? { team: 'ban', i: 0 } : { team: 'blue', i: 0 };
      }
      if (key === 'reroll') s.seed = (s.seed * 48271 + 11) % 2147483647;
      focus = `[data-set="${t.dataset.set}"]`;
    } else if (t.dataset.go) {
      save(s);
      this.onStart(this.config(t.dataset.go as 'play' | 'spectate' | 'practice'));
      return;
    }
    save(s);
    this.render();
    if (focus) this.el.querySelector<HTMLElement>(focus)?.focus();
  }

  /** Put a Pokémon (or CPU / random) in the selected slot; swaps within a team, never duplicates. */
  private assign(id: string): void {
    const s = this.s;
    if (this.sel.team === 'ban') {
      s.ban = id === RANDOM || id === AUTO ? '' : id;
      for (const team of [s.blue, s.red]) team.forEach((x, i) => x === s.ban && (team[i] = i === 0 && team === s.blue ? RANDOM : AUTO));
      return;
    }
    const team = this.sel.team === 'blue' ? s.blue : s.red;
    const i = this.sel.i;
    if (id === AUTO && this.sel.team === 'blue' && i === 0) return;
    const j = team.findIndex((x, k) => k !== i && x === id && id !== AUTO && id !== RANDOM);
    if (j >= 0) team[j] = team[i]!; // swap
    team[i] = id;
    if (this.sel.team === 'blue') s.items[i] = AUTO; // the recommended item follows the Pokémon
  }

  private config(go: 'play' | 'spectate' | 'practice'): MatchConfig {
    const ids = pickable();
    return buildConfig(this.s, go, (id, taken) => {
      if (id !== RANDOM) return id;
      const free = ids.filter((x) => !taken.includes(x));
      return free[Math.floor(Math.random() * free.length)] ?? ids[0]!;
    });
  }
}

/**
 * The match a pick screen produces. `pick` resolves '?' (random) picks, avoiding `taken` (the rest
 * of that team); random choice happens here in the client, never inside the deterministic sim.
 * You are always player 0 on Blue. Every player gets an item.
 */
export function buildConfig(s: Saved, go: 'play' | 'spectate' | 'practice', pick: (id: string, taken: string[]) => string): MatchConfig {
  const res = resolvePicks(s);
  const fin = (ids: string[]) => {
    const out = [...ids];
    out.forEach((x, i) => (out[i] = pick(x, out.filter((y, k) => k !== i))));
    return out;
  };
  const blue = fin(res.blue);
  const red = fin(res.red);
  const bRoles = blueRoles(s);
  const blueItem = (i: number) => (res.blueItems[i] === AUTO ? cpuItem(blue[i]!, bRoles[i]!) : res.blueItems[i]!);
  const redItem = (i: number) => (res.redItems[i] === AUTO ? cpuItem(red[i]!, RED_ROLES[i]!) : res.redItems[i]!);
  if (go === 'practice') {
    return { lineup: [{ pokemonId: blue[0]!, team: 0 }, { pokemonId: red[0]!, team: 1 }], me: 0, diff: s.diff, practice: true };
  }
  // Your role decides who keeps goal for Blue.
  const youGoalie = s.role === 'goalie';
  const spawn = (pokemonId: string, team: 0 | 1, role: Role, slot: number, item: string): PlayerSpawn =>
    role === 'goalie' ? { pokemonId, team, role: 'goalie', item } : { pokemonId, team, slot, item };
  const lineup: PlayerSpawn[] = [
    spawn(blue[0]!, 0, bRoles[0]!, 0, blueItem(0)),
    spawn(blue[1]!, 0, bRoles[1]!, youGoalie ? 0 : 1, blueItem(1)),
    spawn(blue[2]!, 0, bRoles[2]!, 1, blueItem(2)),
    spawn(red[0]!, 1, 'forward', 0, redItem(0)),
    spawn(red[1]!, 1, 'forward', 1, redItem(1)),
    spawn(red[2]!, 1, 'goalie', 0, redItem(2)),
  ];
  return { lineup, me: go === 'spectate' ? -1 : 0, diff: go === 'spectate' ? 'hard' : s.diff, practice: false };
}

