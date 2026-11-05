import { getPokemon } from '@pokeathlon/data';
import { mvpScore, type PlayerTelemetry, type SimEvent, type World } from '@pokeathlon/sim';
import { navigateButtons } from './nav';

/**
 * Results (M5.9): a set card during the set-end pause (set winner + Forward / Goalie MVP of that
 * set, OS rule), the full match results (scoreboard, set MVPs, accolades, Rematch / Back to picks),
 * and a hold-Tab scoreboard during play. Everything comes from sim telemetry; per-set numbers are
 * differences against a snapshot taken when the set starts.
 */
const STAT_KEYS = ['goals', 'assists', 'kos', 'saves', 'damageDealt', 'shots', 'redirects', 'orbs', 'deaths'] as const;
type StatKey = (typeof STAT_KEYS)[number];
type Stats = Record<StatKey, number>;

export interface SetSummary {
  set: number;
  winner: 0 | 1;
  /** Player ids of the set MVPs (−1 = none). */
  forward: number;
  goalie: number;
}

const TEAM = ['Blue', 'Red'] as const;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pick = (t: PlayerTelemetry): Stats => Object.fromEntries(STAT_KEYS.map((k) => [k, t[k]])) as Stats;
const minus = (a: Stats, b: Stats): Stats => Object.fromEntries(STAT_KEYS.map((k) => [k, a[k] - b[k]])) as Stats;

/** Set MVPs from per-set stats (OS: one for Forwards, one for Goalies). */
export function setMvps(world: World, stats: Stats[]): { forward: number; goalie: number } {
  let forward = -1;
  let goalie = -1;
  let bf = -Infinity;
  let bg = -Infinity;
  world.players.forEach((p, i) => {
    const s = mvpScore({ ...world.telemetry.players[i]!, ...stats[i]! });
    if (p.role === 'goalie' ? s.goalie > bg : s.forward > bf) {
      if (p.role === 'goalie') {
        bg = s.goalie;
        goalie = p.id;
      } else {
        bf = s.forward;
        forward = p.id;
      }
    }
  });
  return { forward, goalie };
}

const STREAK = ['', '', 'Double', 'Triple', 'Quadra', 'Penta', 'Hexa', 'Septa', 'Octa'];

/** OS-style accolades from match totals and goal streaks. */
export function accolades(world: World, streaks: number[]): string[][] {
  const tel = world.telemetry.players;
  const max = (k: StatKey) => Math.max(0, ...tel.map((t) => t[k]));
  const top = { damageDealt: max('damageDealt'), assists: max('assists'), saves: max('saves'), kos: max('kos') };
  return tel.map((t, i) => {
    const out: string[] = [];
    if (t.goals >= 3) out.push(`${t.goals} Goals`);
    else if (t.goals === 2) out.push('2 Goals');
    if ((streaks[i] ?? 0) >= 2) out.push(`${STREAK[Math.min(8, streaks[i]!)]} Goal Streak`);
    if (t.kos >= 3) out.push(`${t.kos >= 5 ? '5+' : t.kos >= 4 ? '4+' : '3+'} KOs`);
    if (t.saves >= 10) out.push(`${t.saves >= 30 ? '30+' : t.saves >= 20 ? '20+' : '10+'} Saves`);
    if (t.damageDealt > 0 && t.damageDealt === top.damageDealt) out.push(t.damageDealt >= 15000 ? 'Legendary Damage' : t.damageDealt >= 9000 ? 'Monstrous Damage' : 'Top Damage');
    if (t.assists >= 2 && t.assists === top.assists) out.push('Playmaker');
    if (t.saves >= 3 && t.saves === top.saves && world.players[i]!.role === 'goalie') out.push('Brick Wall');
    if (t.shots >= 5) out.push(`${t.shots} Shots on Goal`);
    return out;
  });
}

export class ResultsScreen {
  readonly el: HTMLElement;
  private readonly board: HTMLElement;
  private setStart: Stats[] = [];
  private sets: SetSummary[] = [];
  private streak = { by: -1, n: 0 };
  private bestStreak: number[] = [];
  private me = -1;
  private setCardTimer = 0;

  constructor(
    root: HTMLElement,
    private readonly actions: { rematch: () => void; picks: () => void },
  ) {
    this.el = document.createElement('div');
    this.el.id = 'results';
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]')?.dataset.act;
      if (a === 'rematch') this.actions.rematch();
      if (a === 'picks') this.actions.picks();
    });
    this.board = document.createElement('div');
    this.board.id = 'scoreboard-hold';
    this.board.hidden = true;
    root.append(this.el, this.board);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  navigate(dir: 'up' | 'down' | 'left' | 'right' | 'press'): void {
    navigateButtons(this.el, dir);
  }

  hide(): void {
    this.el.hidden = true;
    this.el.className = '';
  }

  /** A new match started. */
  reset(world: World, me: number): void {
    this.me = me;
    this.sets = [];
    this.streak = { by: -1, n: 0 };
    this.bestStreak = world.players.map(() => 0);
    this.setStart = world.telemetry.players.map(pick);
    this.hide();
  }

  onEvent(world: World, e: SimEvent): void {
    if (e.type === 'goal') {
      if (e.ownGoal || e.scorer < 0) this.streak = { by: -1, n: 0 };
      else {
        this.streak = this.streak.by === e.scorer ? { by: e.scorer, n: this.streak.n + 1 } : { by: e.scorer, n: 1 };
        this.bestStreak[e.scorer] = Math.max(this.bestStreak[e.scorer] ?? 0, this.streak.n);
      }
    } else if (e.type === 'setWon') {
      const now = world.telemetry.players.map(pick);
      const per = now.map((s, i) => minus(s, this.setStart[i] ?? s));
      const mvp = setMvps(world, per);
      this.sets.push({ set: this.sets.length + 1, winner: e.team, ...mvp });
      this.setStart = now;
      if (world.match.phase !== 'matchOver') this.showSetCard(world);
    } else if (e.type === 'matchWon') {
      this.showMatch(world);
    }
  }

  /** Per frame: hide the set card after its time; the hold-Tab scoreboard. */
  update(world: World, dt: number, holdBoard: boolean): void {
    if (this.setCardTimer > 0) {
      this.setCardTimer -= dt;
      if (this.setCardTimer <= 0 && this.el.classList.contains('setcard')) this.hide();
    }
    const show = holdBoard && !this.visible;
    if (show) this.board.innerHTML = `<div class="results-card">${this.scoreTable(world)}</div>`;
    this.board.hidden = !show;
  }

  private name(world: World, id: number): string {
    const p = world.players[id];
    return p ? `${esc(getPokemon(p.pokemonId).name)}${id === this.me ? ' (you)' : ''}` : '–';
  }

  private showSetCard(world: World): void {
    const s = this.sets[this.sets.length - 1]!;
    this.el.className = 'setcard';
    this.el.innerHTML = `<div class="results-card t${s.winner}">
      <h2>${TEAM[s.winner]} wins set ${s.set} <small>Sets ${world.match.sets[0]} – ${world.match.sets[1]}</small></h2>
      <p>⭐ Forward MVP: <b>${this.name(world, s.forward)}</b> · 🧤 Goalie MVP: <b>${this.name(world, s.goalie)}</b></p></div>`;
    this.el.hidden = false;
    this.setCardTimer = 4;
  }

  private showMatch(world: World): void {
    const w = world.match.winner as 0 | 1;
    const acc = accolades(world, this.bestStreak);
    const accRows = world.players
      .map((p, i) => (acc[i]!.length ? `<li class="team${p.team}"><b>${this.name(world, i)}</b> ${acc[i]!.map((a) => `<span class="acc">${esc(a)}</span>`).join('')}</li>` : ''))
      .join('');
    const mvps = this.sets
      .map((s) => `<li>Set ${s.set} · <span class="team${s.winner}">${TEAM[s.winner]}</span> · ⭐ ${this.name(world, s.forward)} · 🧤 ${this.name(world, s.goalie)}</li>`)
      .join('');
    const youWon = this.me >= 0 && world.players[this.me]?.team === w;
    this.el.className = 'final';
    this.el.innerHTML = `<div class="results-card t${w}">
      <h1>${TEAM[w]} wins the match! <small>Sets ${world.match.sets[0]} – ${world.match.sets[1]}${this.me >= 0 ? (youWon ? ' · Victory' : ' · Defeat') : ''}</small></h1>
      ${this.scoreTable(world)}
      <div class="rcols">
        <div><h3>Set MVPs</h3><ul class="mvps">${mvps}</ul></div>
        <div><h3>Accolades</h3><ul class="accs">${accRows || '<li class="muted">None this time.</li>'}</ul></div>
      </div>
      <div class="ractions"><button class="big" data-act="rematch">Rematch</button><button data-act="picks">Back to picks</button></div>
    </div>`;
    this.el.hidden = false;
    this.el.querySelector<HTMLElement>('[data-act="rematch"]')?.focus();
  }

  /** Scoreboard grouped by team (OS columns). */
  private scoreTable(world: World): string {
    const tel = world.telemetry.players;
    const mvpIds = new Set(this.sets.flatMap((s) => [s.forward, s.goalie]));
    const rows = (team: 0 | 1) =>
      world.players
        .filter((p) => p.team === team)
        .map((p) => {
          const t = tel[p.id]!;
          return `<tr class="team${team} ${p.id === this.me ? 'me' : ''}">
            <td><img src="portraits/${getPokemon(p.pokemonId).dex}/Normal.png" alt="">${this.name(world, p.id)}${mvpIds.has(p.id) ? ' ⭐' : ''}</td>
            <td>${p.role === 'goalie' ? 'G' : 'F'}</td><td class="sm">${p.item ? esc(p.item.name) : '–'}</td>
            <td class="sm" title="${esc(p.boosts.map((b) => b.name).join(', '))}">${p.boosts.length}</td>
            <td>${t.goals}</td><td>${t.assists}</td><td>${t.kos}</td><td>${t.saves}</td><td>${Math.round(t.damageDealt).toLocaleString('en-US')}</td>
            <td>${t.shots}</td><td>${t.redirects}</td><td>${t.orbs}</td></tr>`;
        })
        .join('');
    return `<table class="rtable"><tr><th>Pokémon</th><th title="Role">R</th><th>Item</th><th title="Boosts (hover for names)">Bst</th>
      <th title="Goals">G</th><th title="Assists">A</th><th>KO</th><th title="Saves">Sv</th><th>Damage</th><th title="Shots on goal">Sh</th><th title="Redirects">Rd</th><th title="Power Orbs">Orb</th></tr>
      ${rows(0)}<tr class="gap"><td colspan="12"></td></tr>${rows(1)}</table>`;
  }
}
