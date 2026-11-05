import { getBoost, getPokemon } from '@pokeathlon/data';
import { TICK_RATE, type World } from '@pokeathlon/sim';
import { navigateButtons } from './nav';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const FAMILY_ICON: Record<string, string> = {
  movement: '💨',
  stats: '💪',
  cooldowns: '⏱',
  impact: '💥',
  sustain: '❤',
  edge: '⚠',
  creations: '🧱',
  spark: '✨',
};

/**
 * Boost draft screen (M5.8, OS Awakening draft). Shown while the match is in its `draft` phase:
 * - start of match: the 2 shared offers, everyone picks at once;
 * - after each set: the shared pool, the pick order down the side (current picker highlighted),
 *   what everyone has taken, and the timer.
 * Your pick goes into your next input (`onPick`), so it is replayed like any input. CPU picks show up
 * as they happen. Mouse, keyboard or gamepad (D-pad + A).
 */
export class DraftScreen {
  readonly el: HTMLElement;
  private key = '';

  constructor(
    root: HTMLElement,
    private readonly onPick: (index: number) => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'draft';
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-offer]');
      if (b && !b.disabled) this.onPick(Number(b.dataset.offer));
    });
    root.append(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  navigate(dir: 'up' | 'down' | 'left' | 'right' | 'press'): void {
    navigateButtons(this.el, dir);
  }

  /** Call every frame. `me` = the human's player id (−1 = spectating). */
  update(world: World, me: number): void {
    const d = world.draft;
    if (!d || world.match.phase !== 'draft') {
      if (!this.el.hidden) {
        this.el.hidden = true;
        this.key = '';
      }
      return;
    }
    const secs = Math.max(0, Math.ceil(d.ticks / TICK_RATE));
    const key = `${d.kind}|${d.offers.join(',')}|${d.turn}|${d.picked.join(',')}|${me}`;
    if (key !== this.key) {
      this.key = key;
      this.render(world, me);
    }
    const t = this.el.querySelector('.dtimer');
    if (t) t.textContent = `${secs}s`;
    const bar = this.el.querySelector<HTMLElement>('.dbar > i');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (100 * d.ticks) / (d.ticks + d.elapsed)))}%`;
    this.el.hidden = false;
  }

  private render(world: World, me: number): void {
    const d = world.draft!;
    const p = me >= 0 ? world.players[me] : undefined;
    const myTurn = !!p && (d.kind === 'start' ? d.picked[p.id] === null : d.order[d.turn] === p.id);
    const current = d.kind === 'set' ? world.players[d.order[d.turn] ?? -1] : undefined;
    const holds = (id: string) => !!p && p.boosts.some((b) => b.id === id);
    const cards = d.offers
      .map((id, i) => {
        const b = getBoost(id);
        const off = !myTurn || holds(id);
        return `<button class="boost" data-offer="${i}" ${off ? 'disabled' : ''} title="Modelled on OS ${esc(b.os)}">
          <span class="bicon">${FAMILY_ICON[b.family] ?? '★'}</span><b>${esc(b.name)}</b><small>${esc(b.family)}</small>
          <span class="bdesc">${esc(b.desc)}</span>${holds(id) ? '<i>You have it</i>' : ''}</button>`;
      })
      .join('');
    const who = (pid: number) => {
      const q = world.players[pid]!;
      const mon = getPokemon(q.pokemonId);
      const taken = d.picked[pid];
      return `<li class="team${q.team} ${current?.id === pid ? 'now' : ''} ${pid === me ? 'me' : ''}">
        <img src="portraits/${mon.dex}/Normal.png" alt=""><span>${esc(mon.name)}${pid === me ? ' (you)' : ''}</span>
        <small>${taken ? esc(getBoost(taken).name) : current?.id === pid || d.kind === 'start' ? 'picking…' : ''}</small>
        <em>${q.boosts.filter((b) => b.id !== taken).map((b) => esc(b.name)).join(', ')}</em></li>`;
    };
    const title =
      d.kind === 'start'
        ? 'Pick a starting boost'
        : `Boost draft · after set ${world.match.setIndex} · Blue ${world.match.sets[0]} – ${world.match.sets[1]} Red`;
    const status =
      me < 0 ? 'Spectating' : myTurn ? '<b>Your pick!</b>' : d.kind === 'start' ? 'Waiting for the others…' : `${esc(current ? getPokemon(current.pokemonId).name : '')} is picking…`;
    this.el.innerHTML = `<div class="draft-card">
        <h1>${title} <span class="dtimer"></span></h1>
        <div class="dbar"><i></i></div>
        <p class="dstatus">${status}</p>
        <div class="dmain">
          <div class="boosts">${cards}</div>
          <ol class="order">${d.order.map(who).join('')}</ol>
        </div>
        <p class="hint">${d.kind === 'start' ? 'Everyone sees the same boosts.' : 'Each boost can be taken once. Pick order: top XP this set on the winning team, then the losing team, alternating.'} If time runs out, a boost is picked for you.</p>
      </div>`;
    if (myTurn) this.el.querySelector<HTMLElement>('button[data-offer]:not([disabled])')?.focus();
  }
}
