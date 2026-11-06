import { getItem, getPokemon, itemsFor } from '@pokeathlon/data';
import { DEFAULT_PORT, NetClient, type RejoinTicket, type RoomState, type SeatPick, type Socket } from '@pokeathlon/net';
import type { PlayerSpawn, Role, World } from '@pokeathlon/sim';
import { cpuItem, cpuPick, pickable, seededRand } from './cpuDraft';
import { navigateButtons } from './nav';

/** Seat roles: 0–2 Blue, 3–5 Red; two forwards then the goalie. */
export const SEAT_ROLES: Role[] = ['forward', 'forward', 'goalie', 'forward', 'forward', 'goalie'];
const AUTO = 'auto';
const STORE = 'pokeathlon.online';
const TICKET = 'pokeathlon.rejoin';

interface Prefs {
  name: string;
  server: string;
}

/**
 * The room server's address: the page's own host when the game is served by `npm run host` (one
 * port, works through a tunnel, wss on https), else port 8787 next to the Vite dev server.
 */
const defaultServer = (): string => {
  if (location.protocol === 'https:') return `wss://${location.host}`;
  if (location.protocol === 'http:' && location.port !== '5173') return `ws://${location.host}`;
  return `ws://${location.hostname || 'localhost'}:${DEFAULT_PORT}`;
};

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Prefs> | null;
    return { name: p?.name ?? '', server: p?.server || defaultServer() };
  } catch {
    return { name: '', server: defaultServer() };
  }
}
function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
/** The rejoin ticket lives for the tab session (a reload rejoins; a new tab is a new player). */
function loadTicket(): RejoinTicket | null {
  try {
    return JSON.parse(sessionStorage.getItem(TICKET) ?? 'null') as RejoinTicket | null;
  } catch {
    return null;
  }
}
function saveTicket(t: RejoinTicket | null): void {
  try {
    if (t) sessionStorage.setItem(TICKET, JSON.stringify(t));
    else sessionStorage.removeItem(TICKET);
  } catch {
    /* ignore */
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const seatName = (s: number) => `${s < 3 ? 'Blue' : 'Red'} ${SEAT_ROLES[s] === 'goalie' ? 'Goalie' : `Forward ${(s % 3) + 1}`}`;

/**
 * The 6 Pokémon of a room's picks: chosen ones as they are, 'auto' filled by the CPU drafting logic
 * (goalies first, no duplicates within a team), items by the role's recommendation.
 * Runs on the host only; everyone else receives the result.
 */
export function resolveRoomLineup(picks: SeatPick[], diff: RoomState['settings']['diff'], seed: number): PlayerSpawn[] {
  const rand = seededRand(seed);
  const ids = picks.map((p) => (p.pokemon !== AUTO && pickable().includes(p.pokemon) ? p.pokemon : AUTO));
  for (const team of [0, 1]) {
    const seats = [2, 0, 1].map((i) => team * 3 + i); // goalie first
    for (const s of seats) {
      if (ids[s] !== AUTO) continue;
      const taken = [0, 1, 2].map((i) => ids[team * 3 + i]!).filter((x) => x !== AUTO);
      ids[s] = cpuPick(SEAT_ROLES[s]!, taken, [], diff, rand);
    }
  }
  return ids.map((pokemonId, s) => {
    const role = SEAT_ROLES[s]!;
    const want = picks[s]!.item;
    const item = want !== AUTO && itemsFor(role).some((i) => i.id === want) ? want : cpuItem(pokemonId, role);
    const team = (s < 3 ? 0 : 1) as 0 | 1;
    return role === 'goalie' ? { pokemonId: pokemonId!, team, role: 'goalie', item } : { pokemonId: pokemonId!, team, slot: s % 3, item };
  });
}

export interface OnlineHooks {
  /** A match started or resumed. */
  match(world: World, seat: number | null, net: NetClient): void;
  /** The host returned everyone to the room. */
  lobby(): void;
  /** Left online play. */
  back(): void;
  toast(text: string): void;
}

/**
 * Online screen (M7.3): connect, create or join a room by code, take a seat, pick your Pokémon and
 * item. The host sets CPU skill and boosts, picks for CPU seats and starts the match.
 */
export class OnlineScreen {
  readonly el: HTMLElement;
  net: NetClient | null = null;
  private prefs = loadPrefs();
  private code = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  private status = '';
  private inMatch = false;

  constructor(
    root: HTMLElement,
    private readonly hooks: OnlineHooks,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'online';
    this.el.className = 'overlay';
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a name or code must not move your Pokémon
      if (e.key === 'Enter' && (e.target as HTMLElement).matches('input[name="code"]')) this.join(false);
    });
    root.append(this.el);
    // A reload during a match rejoins the same seat.
    const t = loadTicket();
    if (t) this.connect({ code: t.code, token: t.token });
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.el.hidden = false;
    this.render();
  }

  hide(): void {
    this.el.hidden = true;
  }

  navigate(dir: 'up' | 'down' | 'left' | 'right' | 'press'): void {
    navigateButtons(this.el, dir);
  }

  get room(): RoomState | null {
    return this.net?.room ?? null;
  }

  private get isHost(): boolean {
    return !!this.net && this.room?.host === this.net.you;
  }

  // ------------------------------------------------------------ connection

  private connect(hello: { create?: boolean; code?: string; token?: string }): void {
    this.net?.close();
    this.status = 'Connecting…';
    let ws: Socket;
    try {
      ws = new WebSocket(this.prefs.server) as unknown as Socket;
    } catch {
      this.status = 'That server address is not valid (it looks like ws://host:8787).';
      this.render();
      return;
    }
    const net = new NetClient(
      ws,
      {
        room: (room) => {
          this.status = '';
          saveTicket(net.ticket);
          if (room.phase === 'lobby' && this.inMatch) {
            this.inMatch = false;
            this.hooks.lobby();
            this.show();
          }
          this.render();
        },
        match: (world, seat) => {
          this.inMatch = true;
          this.hide();
          this.hooks.match(world, seat, net);
        },
        desync: (k) => {
          this.hooks.toast(`Out of sync at tick ${k}. The host can return everyone to the room.`);
        },
        error: (msg) => {
          this.status = msg;
          // A stale rejoin ticket (the room is gone): forget it.
          if (hello.token) saveTicket(null);
          this.render();
        },
        closed: () => {
          if (this.net !== net) return;
          this.status = this.inMatch ? 'Connection lost. Reload the page to rejoin your seat.' : 'Disconnected from the server.';
          if (this.inMatch) this.hooks.toast('Connection lost: a CPU plays your seat. Reload to rejoin.');
          this.net = null;
          this.inMatch = false;
          this.render();
        },
      },
      { name: this.prefs.name, ...hello },
    );
    this.net = net;
    this.render();
  }

  private join(create: boolean): void {
    const name = this.el.querySelector<HTMLInputElement>('input[name="name"]')?.value.trim() ?? '';
    const server = this.el.querySelector<HTMLInputElement>('input[name="server"]')?.value.trim() ?? '';
    const code = (this.el.querySelector<HTMLInputElement>('input[name="code"]')?.value ?? '').trim().toUpperCase();
    this.prefs = { name, server: server || defaultServer() };
    savePrefs(this.prefs);
    if (!create && !/^[A-Z]{4}$/.test(code)) {
      this.status = 'Room codes are 4 letters.';
      this.render();
      return;
    }
    this.code = code;
    this.connect(create ? { create: true } : { code });
  }

  leave(): void {
    saveTicket(null);
    const net = this.net;
    this.net = null;
    this.inMatch = false;
    net?.close();
    this.status = '';
    this.render();
  }

  // ------------------------------------------------------------ render

  render(): void {
    if (this.el.hidden) return;
    const room = this.room;
    this.el.innerHTML = room ? this.roomView(room) : this.connectView();
    if (!room) this.el.querySelector<HTMLInputElement>(this.prefs.name ? 'input[name="code"]' : 'input[name="name"]')?.focus();
  }

  private connectView(): string {
    const p = this.prefs;
    return `<div class="setup-card online">
      <h1>PokéAthlon <small>play online</small></h1>
      <div class="online-form">
        <label>Your name <input name="name" maxlength="16" value="${esc(p.name)}" placeholder="Trainer"></label>
        <label>Server <input name="server" value="${esc(p.server)}" spellcheck="false"></label>
      </div>
      <div class="row">
        <button class="big" data-act="create">Create a room</button>
        <span class="or">or</span>
        <input name="code" class="code" maxlength="4" value="${esc(this.code)}" placeholder="CODE" autocomplete="off" spellcheck="false">
        <button class="big" data-act="join">Join</button>
      </div>
      ${this.status ? `<p class="status">${esc(this.status)}</p>` : ''}
      <p class="hint">The server runs on one PC with <code>npm run server</code>. Friends on the same network use that PC's address,
        for example <code>ws://192.168.0.10:${DEFAULT_PORT}</code>. Friends elsewhere need a tunnel (see the M7 plan).</p>
      <div class="row"><button data-act="back">Back</button></div>
    </div>`;
  }

  private roomView(room: RoomState): string {
    const net = this.net!;
    const host = this.isHost;
    const mine = room.members.find((m) => m.id === net.you);
    const owner = (s: number) => room.members.find((m) => m.seat === s);
    const pokemonOpts = (cur: string) =>
      [`<option value="${AUTO}" ${cur === AUTO ? 'selected' : ''}>CPU picks</option>`, ...pickable().map((id) => `<option value="${id}" ${cur === id ? 'selected' : ''}>${esc(getPokemon(id).name)}</option>`)].join('');
    const itemOpts = (s: number, cur: string) =>
      [`<option value="${AUTO}" ${cur === AUTO ? 'selected' : ''}>Recommended</option>`, ...itemsFor(SEAT_ROLES[s]!).map((it) => `<option value="${it.id}" ${cur === it.id ? 'selected' : ''}>${esc(it.name)}</option>`)].join('');
    const seat = (s: number) => {
      const o = owner(s);
      const pick = room.picks[s]!;
      const editable = room.phase === 'lobby' && (o ? o.id === net.you : host);
      const who = o ? `${esc(o.name)}${o.id === net.you ? ' (you)' : ''}${o.id === room.host ? ' ★' : ''}${o.away ? ' <i>away</i>' : ''}` : '<i>CPU</i>';
      const dex = pick.pokemon !== AUTO ? getPokemon(pick.pokemon).dex : '';
      const act =
        room.phase !== 'lobby' ? '' : !o ? `<button data-sit="${s}">Sit here</button>` : o.id === net.you ? `<button data-sit="-1">Stand up</button>` : '';
      return `<div class="seat ${s < 3 ? 'blue' : 'red'} ${o?.id === net.you ? 'me' : ''}">
        ${dex ? `<img src="portraits/${dex}/Normal.png" alt="">` : '<span class="rnd">?</span>'}
        <div class="seat-body"><span class="who">${seatName(s)} · ${who}</span>
          <select data-seat="${s}" data-kind="pokemon" ${editable ? '' : 'disabled'}>${pokemonOpts(pick.pokemon)}</select>
          <select data-seat="${s}" data-kind="item" ${editable ? '' : 'disabled'}>${itemOpts(s, pick.item)}</select>
          ${pick.item !== AUTO ? `<small>${esc(getItem(pick.item).desc)}</small>` : ''}
        </div>${act}</div>`;
    };
    const watchers = room.members.filter((m) => m.seat === null);
    const tog = (key: string, value: string, label: string, on: boolean) =>
      `<button class="tog ${on ? 'on' : ''}" data-set="${key}:${value}" ${host && room.phase === 'lobby' ? '' : 'disabled'}>${label}</button>`;
    const link = `${location.origin}${location.pathname}?online=1&room=${room.code}`;
    return `<div class="setup-card online">
      <h1>Room <span class="code-big">${room.code}</span> <small>${room.members.length} here · ${Math.round(net.rtt)} ms</small></h1>
      <p class="hint">Share the code, or this link: <code class="link">${esc(link)}</code> <button data-act="copy">Copy</button></p>
      <div class="row">
        <div class="group"><span>CPU skill</span>${(['easy', 'normal', 'hard'] as const).map((d) => tog('diff', d, d[0]!.toUpperCase() + d.slice(1), room.settings.diff === d)).join('')}</div>
        <div class="group"><span>Boosts</span>${tog('boosts', 'on', 'On', room.settings.boosts)}${tog('boosts', 'off', 'Off', !room.settings.boosts)}</div>
      </div>
      <div class="teams">
        <div class="team blue"><h2>Blue team</h2>${[0, 1, 2].map(seat).join('')}</div>
        <div class="team red"><h2>Red team</h2>${[3, 4, 5].map(seat).join('')}</div>
      </div>
      ${watchers.length ? `<p class="hint">Watching: ${watchers.map((m) => esc(m.name)).join(', ')}</p>` : ''}
      ${this.status ? `<p class="status">${esc(this.status)}</p>` : ''}
      <div class="row go">
        ${
          room.phase === 'match'
            ? `${this.inMatch ? '<button class="big" data-act="resume">Back to the match</button>' : ''}${host ? '<button data-act="lobby">End match for everyone</button>' : ''}`
            : host
              ? '<button class="big" data-act="start">Start match</button>'
              : '<span class="hint">Waiting for the host (★) to start…</span>'
        }
        <button data-act="leave">Leave room</button>
      </div>
      <p class="hint">Empty seats are played by CPUs. ${mine?.seat === null ? 'You are watching: pick a free seat to play.' : ''}</p>
    </div>`;
  }

  // ------------------------------------------------------------ input

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || t.hasAttribute('disabled')) return;
    const net = this.net;
    const room = this.room;
    const act = t.dataset.act;
    if (act === 'create') return this.join(true);
    if (act === 'join') return this.join(false);
    if (act === 'back') {
      this.hide();
      this.hooks.back();
      return;
    }
    if (act === 'leave') {
      this.leave();
      return;
    }
    if (act === 'copy' && room) {
      void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?online=1&room=${room.code}`).then(() => this.hooks.toast('Link copied'));
      return;
    }
    if (act === 'resume') {
      this.hide();
      return;
    }
    if (!net || !room) return;
    if (act === 'lobby') return net.send({ t: 'lobby' });
    if (act === 'start') {
      const lineup = resolveRoomLineup(room.picks, room.settings.diff, Math.floor(Math.random() * 2 ** 31));
      net.send({ t: 'start', lineup });
      return;
    }
    if (t.dataset.sit !== undefined) {
      const s = Number(t.dataset.sit);
      net.send({ t: 'seat', seat: s < 0 ? null : s });
      return;
    }
    if (t.dataset.set) {
      const [key, value] = t.dataset.set.split(':') as [string, string];
      const settings = { ...room.settings };
      if (key === 'diff') settings.diff = value as typeof settings.diff;
      if (key === 'boosts') settings.boosts = value === 'on';
      net.send({ t: 'settings', settings });
    }
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLSelectElement;
    const net = this.net;
    const room = this.room;
    if (!net || !room || t.dataset.seat === undefined) return;
    const s = Number(t.dataset.seat);
    const pick = { ...room.picks[s]! };
    if (t.dataset.kind === 'pokemon') pick.pokemon = t.value;
    else pick.item = t.value;
    net.send({ t: 'pick', seat: s, pick });
  }
}
