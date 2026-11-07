import './lobby.css';
import { creditsHtml } from './credits';
import { audio } from './audio';
import { sfxData } from '@pokeathlon/data/sfx';
import { getItem, getKit, getPokemon, itemsFor, type SpriteManifest } from '@pokeathlon/data';
import { analyzeRoster, simTier, tierSnapshot, type FighterStats } from '@pokeathlon/data/analyze';
import { pickable } from './cpuDraft';
import { navigateButtons } from './nav';
import { applyDisplay, DEFAULT_DISPLAY, itemFor, levelOf, loadProfile, saveProfile, totals, type LobbyMode, type LobbyRole, type Profile } from './profile';

/** Picking a new main: a short swap sound plus its cry. */
const sfxPick = sfxData.shared.pickMain;

/**
 * Main menu (design.md): a Pokémon UNITE-style lobby with Omega Strikers' menu items. Your main
 * Pokémon stands on a stage in the centre (drag to spin it); profile top-left, party and side menu
 * on the left, role + mode + Play bottom-right. Pages (Pokédex, Customize, Records, Settings) slide
 * over it. Non-commercial: no store or currency, progress comes from playing.
 */
export interface LobbyHooks {
  /** Start the chosen mode with these lobby choices. */
  go: (mode: LobbyMode, p: Profile, role: 'forward' | 'goalie') => void;
  online: () => void;
}

type Page = 'dex' | 'custom' | 'records' | 'settings' | null;

const ICON: Record<string, string> = {
  dex: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h6m6 0h6"/><circle cx="12" cy="12" r="3"/></svg>',
  custom: '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>',
  records: '<svg viewBox="0 0 24 24"><path d="M7 21h10M12 17v4M6 4h12v4a6 6 0 0 1-12 0zM6 6H3v1a3 3 0 0 0 3 3M18 6h3v1a3 3 0 0 1-3 3"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>',
};

const MODES: { id: LobbyMode; label: string; hint: string }[] = [
  { id: 'quick', label: 'Quick match', hint: 'vs CPU, teams picked for you' },
  { id: 'custom', label: 'Custom match', hint: 'pick both teams, bans, items' },
  { id: 'practice', label: 'Practice', hint: 'you and a training dummy' },
  { id: 'watch', label: 'Watch CPU', hint: 'CPU vs CPU' },
  { id: 'online', label: 'Online', hint: 'rooms with friends' },
];
const ROLES: { id: LobbyRole; label: string }[] = [
  { id: 'goalie', label: 'Goalie' },
  { id: 'flex', label: 'Flex' },
  { id: 'forward', label: 'Forward' },
];
const SLOT_LABEL: Record<string, string> = { primary: 'Primary · right-click', secondary: 'Secondary · Space', special: 'Special · R / F / side mouse button' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const portrait = (id: string) => `<img src="portraits/${getPokemon(id).dex}/Normal.png" alt="">`;
const pct = (w: number, g: number) => (g ? `${Math.round((100 * w) / g)} %` : '–');
function tierBadge(id: string, role: 'forward' | 'goalie'): string {
  const r = tierSnapshot.entries.find((x) => x.pokemon === id)?.[role];
  if (!r?.games) return '–';
  const t = simTier(r.wins, r.games);
  return `<b class="tier t-${t.tier.replace('.', '_')}">${t.tier}${t.uncertain ? '?' : ''}</b>`;
}

export class LobbyScreen {
  readonly el: HTMLElement;
  p: Profile = loadProfile();
  private page: Page = null;
  private dexSel = '';
  private readonly hero: HeroSprite;
  private readonly stats = new Map<string, FighterStats>(analyzeRoster().map((f) => [f.id, f]));

  constructor(
    root: HTMLElement,
    private readonly hooks: LobbyHooks,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'lobby';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="lobby-shade"></div><div class="lobby-ui"></div><div class="stage"><div class="platform"></div><canvas class="hero" width="360" height="360" title="Drag to spin"></canvas></div><div class="lobby-page" hidden></div>`;
    this.hero = new HeroSprite(this.el.querySelector('canvas')!);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
    this.el.addEventListener('input', (e) => this.onChange(e));
    root.append(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.p = loadProfile();
    this.el.hidden = false;
    document.body.classList.add('lobby-open');
    this.render();
    this.hero.start();
    this.el.querySelector<HTMLElement>('.play')?.focus();
  }

  hide(): void {
    this.el.hidden = true;
    document.body.classList.remove('lobby-open');
    this.hero.stop();
  }

  /** Esc / B: close an open page first. Returns true if it did. */
  back(): boolean {
    if (!this.page) return false;
    this.openPage(null);
    return true;
  }

  navigate(dir: 'up' | 'down' | 'left' | 'right' | 'press'): void {
    navigateButtons(this.page ? this.el.querySelector<HTMLElement>('.lobby-page')! : this.el.querySelector<HTMLElement>('.lobby-ui')!, dir);
  }

  // ---------------------------------------------------------------- lobby

  private render(): void {
    const p = this.p;
    const mon = getPokemon(p.main);
    const lv = levelOf(p.xp);
    const t = totals(p);
    const mode = MODES.find((m) => m.id === p.mode)!;
    const sideBtn = (id: Exclude<Page, null>, label: string) => `<button class="side-btn" data-page="${id}">${ICON[id]}<span>${label}</span></button>`;
    this.el.querySelector('.lobby-ui')!.innerHTML = `
      <div class="profile-card">
        <div class="avatar">${portrait(p.main)}</div>
        <div class="who">
          <div class="nm"><b class="lv">${lv.level}</b> ${esc(p.name)}</div>
          <div class="xp"><i style="width:${Math.round((100 * lv.into) / lv.need)}%"></i><span>${lv.into} / ${lv.need} XP</span></div>
        </div>
      </div>
      <div class="lobby-left">
        <div class="party" aria-label="Party">
          <div class="party-slot me" title="You">${portrait(p.main)}</div>
          <button class="party-slot add" data-act="online" title="Play with friends online">${ICON.plus}</button>
          <button class="party-slot add" data-act="online" title="Play with friends online">${ICON.plus}</button>
        </div>
        <nav class="side-menu">
          ${sideBtn('dex', 'Pokédex')}${sideBtn('custom', 'Customize')}${sideBtn('records', 'Records')}${sideBtn('settings', 'Settings')}
        </nav>
      </div>
      <div class="lobby-top">
        <div class="chip-stat" title="Matches won"><small>Wins</small><b>${t.wins}</b></div>
        <div class="chip-stat" title="Matches played"><small>Played</small><b>${t.games}</b></div>
        <button class="icon-btn" data-page="settings" title="Settings">${ICON.settings}</button>
      </div>
      <div class="hero-name">
        <button class="switch" data-page="custom" title="Change your main Pokémon">${ICON.swap}<b>${esc(mon.name)}</b></button>
        <small>${esc(mon.archetype.replace(/-/g, ' '))} · Forward ${tierBadge(mon.id, 'forward')} · Goalie ${tierBadge(mon.id, 'goalie')}</small>
      </div>
      <div class="play-block">
        <div class="seg roles">${ROLES.map((r) => `<button class="${p.role === r.id ? 'on' : ''}" data-role="${r.id}"><span>${r.label}</span></button>`).join('')}</div>
        <div class="seg modes">${MODES.map((m) => `<button class="${p.mode === m.id ? 'on' : ''}" data-mode="${m.id}" title="${m.hint}"><span>${m.label}</span></button>`).join('')}</div>
        <button class="play" data-act="play"><span>${p.mode === 'online' ? 'Go online' : 'Play'}</span><small>${esc(mode.hint)}${p.mode === 'watch' || p.mode === 'online' ? '' : ` · ${p.role === 'flex' ? 'Flex role' : p.role === 'goalie' ? 'Goalie' : 'Forward'} · CPU ${p.diff}`}</small></button>
      </div>`;
    void this.hero.load(mon.dex);
  }

  private openPage(page: Page): void {
    this.page = page;
    const box = this.el.querySelector<HTMLElement>('.lobby-page')!;
    box.hidden = !page;
    this.el.classList.toggle('paged', !!page);
    if (!page) {
      this.render();
      this.el.querySelector<HTMLElement>('.play')?.focus();
      return;
    }
    this.renderPage();
    box.querySelector<HTMLElement>('.on, button')?.focus();
  }

  private renderPage(): void {
    const box = this.el.querySelector<HTMLElement>('.lobby-page')!;
    const title = { dex: 'Pokédex', custom: 'Customize', records: 'Records', settings: 'Settings' }[this.page!];
    const body = this.page === 'dex' ? this.dexPage() : this.page === 'custom' ? this.customPage() : this.page === 'records' ? this.recordsPage() : this.settingsPage();
    box.innerHTML = `<header><button class="back" data-act="back" title="Back (Esc)">‹ Back</button><h1>${title}</h1></header><div class="page-body ${this.page}">${body}</div>`;
  }

  // ---------------------------------------------------------------- pages

  private monGrid(sel: string, attr: string): string {
    return `<div class="mon-grid">${pickable()
      .map((id) => `<button class="mon ${id === sel ? 'on' : ''}" data-${attr}="${id}">${portrait(id)}<small>${esc(getPokemon(id).name)}</small>${id === this.p.main ? '<i class="main-tag">Main</i>' : ''}</button>`)
      .join('')}</div>`;
  }

  private dexPage(): string {
    const id = this.dexSel || this.p.main;
    const mon = getPokemon(id);
    const kit = getKit(id);
    const f = this.stats.get(id);
    const rec = this.p.records[id];
    const n0 = (x: number) => (x ? Math.round(x).toLocaleString('en-US') : '–');
    const ms = (name: string) => f?.moves.find((m) => m.name === name);
    const moves = (kit?.moves ?? [])
      .map((m) => {
        const s = ms(m.name);
        return `<li><div class="mv-head"><b>${esc(m.name)}</b><small>${SLOT_LABEL[m.slot]} · ${m.cooldown} s</small></div>
          <p>${esc(m.desc ?? '')}</p>${s && (s.reach || s.ballPower || s.knockback) ? `<span class="nums">reach ${n0(s.reach)} · ball ${n0(s.ballPower)} · knockback ${n0(s.knockback)}${s.damagePerCast ? ` · damage ${n0(s.damagePerCast)}` : ''}</span>` : ''}</li>`;
      })
      .join('');
    const passive = kit?.passive ? `<li class="passive"><div class="mv-head"><b>${esc(kit.passive.name)}</b><small>Passive</small></div><p>${esc(kit.passive.desc)}</p></li>` : '';
    return `${this.monGrid(id, 'dex')}
      <article class="dex-card">
        <div class="dex-head">${portrait(id)}<div><h2>${esc(mon.name)}</h2><small>${esc(mon.archetype.replace(/-/g, ' '))} · ${mon.types.join(' / ')} · ${mon.stats.size}</small>
          <div class="statline"><span>Power <b>${mon.stats.power}</b></span><span>Speed <b>${mon.stats.speed}</b></span><span>Stagger <b>${mon.stats.stagger}</b> <small>+${mon.stats.staggerGrowth}/lv</small></span><span>Forward ${tierBadge(id, 'forward')}</span><span>Goalie ${tierBadge(id, 'goalie')}</span></div></div>
          ${id === this.p.main ? '<span class="main-tag big">Your main</span>' : `<button class="cta" data-main="${id}">Set as main</button>`}</div>
        <h3>Moves</h3><ul class="dex-moves">${passive}${moves}</ul>
        <h3>Your stats</h3>
        ${rec ? `<div class="statline big"><span>Played <b>${rec.games}</b></span><span>Won <b>${rec.wins}</b> <small>${pct(rec.wins, rec.games)}</small></span><span>Goals <b>${rec.goals}</b></span><span>KOs <b>${rec.kos}</b></span><span>Forward <b>${rec.forward}</b></span><span>Goalie <b>${rec.goalie}</b></span></div>` : '<p class="empty">No matches with this Pokémon yet.</p>'}
      </article>`;
  }

  private customPage(): string {
    const p = this.p;
    const mon = getPokemon(p.main);
    const itemRow = (role: 'forward' | 'goalie') => {
      const cur = itemFor(p, p.main, role);
      const opts = [{ id: 'auto', name: 'Recommended', desc: 'The usual pick for this Pokémon.' }, ...itemsFor(role)];
      const shown = cur === 'auto' ? null : getItem(cur);
      return `<div class="loadout"><h3>${role === 'goalie' ? 'Goalie' : 'Forward'} item <small>${role === 'goalie' ? 'works on your own half' : ''}</small></h3>
        <div class="item-row">${opts.map((it) => `<button class="item ${cur === it.id ? 'on' : ''}" data-item="${role}:${it.id}" title="${esc(it.desc)}">${esc(it.name)}</button>`).join('')}</div>
        <p class="item-desc">${esc(shown ? shown.desc : 'The CPU picks the usual item for this Pokémon and role.')}</p></div>`;
    };
    return `<h2>Main Pokémon</h2><p class="hint">Your main stands in the lobby and is picked for you in every match (you can still change it on the pick screen).</p>
      ${this.monGrid(p.main, 'main')}
      <h2>${esc(mon.name)}'s held items</h2>${itemRow('forward')}${itemRow('goalie')}`;
  }

  private recordsPage(): string {
    const p = this.p;
    const t = totals(p);
    const rows = Object.entries(p.records).sort((a, b) => b[1].games - a[1].games);
    if (!rows.length) return '<p class="empty">Play a match and your records show up here: wins and losses, goals and KOs for every Pokémon.</p>';
    const podium = rows
      .slice(0, 3)
      .map(([id, r], i) => `<div class="podium p${i + 1}">${portrait(id)}<b>${esc(getPokemon(id).name)}</b><small>${r.games} played · ${pct(r.wins, r.games)} won</small></div>`)
      .join('');
    return `<div class="statline big"><span>Played <b>${t.games}</b></span><span>Won <b>${t.wins}</b></span><span>Lost <b>${t.games - t.wins}</b></span><span>Win rate <b>${pct(t.wins, t.games)}</b></span><span>Goals <b>${t.goals}</b></span><span>KOs <b>${t.kos}</b></span><span>Level <b>${levelOf(p.xp).level}</b></span></div>
      <h2>Top Pokémon</h2><div class="podiums">${podium}</div>
      <table class="records"><thead><tr><th>Pokémon</th><th>Played</th><th>Won</th><th>Win rate</th><th>Goals</th><th>KOs</th><th>Forward</th><th>Goalie</th></tr></thead><tbody>
      ${rows.map(([id, r]) => `<tr><td>${portrait(id)} ${esc(getPokemon(id).name)}</td><td>${r.games}</td><td>${r.wins}</td><td>${pct(r.wins, r.games)}</td><td>${r.goals}</td><td>${r.kos}</td><td>${r.forward}</td><td>${r.goalie}</td></tr>`).join('')}
      </tbody></table><p class="hint">Records live in this browser only.</p>`;
  }

  private settingsPage(): string {
    const p = this.p;
    const d = p.display;
    const tog = (key: string, value: string, label: string, on: boolean) => `<button class="tog ${on ? 'on' : ''}" data-set="${key}:${value}">${label}</button>`;
    return `<section><h2>Profile</h2><label class="field">Trainer name <input name="name" maxlength="16" value="${esc(p.name)}"></label></section>
      <section><h2>Matches vs CPU</h2>
        <div class="group"><span>CPU skill</span>${(['easy', 'normal', 'hard'] as const).map((d) => tog('diff', d, d[0]!.toUpperCase() + d.slice(1), p.diff === d)).join('')}</div>
        <div class="group"><span>Bans (custom match)</span>${tog('bans', 'off', 'Off', !p.bans)}${tog('bans', 'on', 'On', p.bans)}</div></section>
      <section><h2>Sound</h2>
        ${(['master', 'sfx', 'voice', 'ui'] as const)
          .map((k) => {
            const label = { master: 'Master', sfx: 'Effects', voice: 'Pokémon cries', ui: 'Menus' }[k];
            const v = Math.round(p.audio[k] * 100);
            return `<div class="group"><span>${label}</span><input type="range" name="vol-${k}" min="0" max="100" step="5" value="${v}"><output>${v} %</output></div>`;
          })
          .join('')}
        <div class="group"><span>Mute</span>${tog('mute', 'off', 'Sound on', !p.audio.mute)}${tog('mute', 'on', 'Muted', p.audio.mute)}</div></section>
      <section><h2>Match display</h2>
        <div class="group"><span>Team auras</span>${tog('auras', 'on', 'On', d.auras)}${tog('auras', 'off', 'Off', !d.auras)}</div>
        <div class="group"><span>Aura opacity</span><input type="range" name="auraOpacity" min="10" max="100" step="5" value="${Math.round(d.auraOpacity * 100)}" ${d.auras ? '' : 'disabled'}><output>${Math.round(d.auraOpacity * 100)} %</output></div>
        <div class="group"><span>Names above players</span>${tog('names', 'pokemon', 'Pokémon', d.names === 'pokemon')}${tog('names', 'trainer', 'Trainer', d.names === 'trainer')}${tog('names', 'both', 'Both', d.names === 'both')}</div>
        <div class="group"><span>Your team's names</span><input type="color" name="allyColor" value="${d.allyColor}"></div>
        <div class="group"><span>Opponents' names</span><input type="color" name="enemyColor" value="${d.enemyColor}"></div>
        <div class="group"><span>Your arrow</span><input type="color" name="arrowColor" value="${d.arrowColor}"></div>
        <div class="preview-plates">
          <div class="plate-prev ally"><span class="nm">${esc(this.previewName(p.name, getPokemon(p.main).name))}</span><i class="me-arrow"></i></div>
          <div class="plate-prev ally"><span class="nm">${esc(this.previewName('CPU', 'Lucario'))}</span></div>
          <div class="plate-prev enemy"><span class="nm">${esc(this.previewName('CPU', getPokemon(p.main).name))}</span></div>
        </div>
        <button data-act="display-reset">Reset match display</button>
        <p class="hint">Trainer names: yours, the players' names in online rooms, and "CPU" for bots.</p></section>
      <section><h2>Controls</h2><ul class="controls">
        <li><b>Move</b> WASD · left stick</li><li><b>Aim</b> mouse · right stick</li><li><b>Strike</b> left click · A / RT</li>
        <li><b>Primary</b> right-click · X</li><li><b>Secondary</b> Space · Y</li><li><b>Special</b> R, F or side mouse button · LT</li>
        <li><b>Evade</b> Shift or Q (full meter = Burst) · B / LB</li>
        <li><b>Menu</b> Esc · Start</li><li><b>Scoreboard</b> hold Tab</li><li><b>Debug</b> F3 · Back</li></ul></section>
      <section><h2>Reset</h2><button class="danger" data-act="reset">Reset level and records</button></section>
      <section class="legal"><h2>Credits</h2>
        <p>PokéAthlon is a free, non-commercial fan game. Pokémon © Nintendo / Creatures / GAME FREAK; not affiliated with them.</p>
        <ul class="credit-sum">
          <li><b>Pokémon sprites and portraits:</b> PMD Sprite Collab (CC BY-NC 4.0)</li>
          <li><b>Move effects:</b> Pokémon Mystery Dungeon effect sheets via PMDCollab RawAsset / PMD: Origins</li>
          <li><b>Sounds:</b> Pokémon Mystery Dungeon sounds via PMD: Origins; Pokémon cries via PokeAPI</li>
          <li><b>Stadium:</b> models from Poly Pizza (CC0 / CC BY) and PokéBonk art by Charcher</li>
        </ul>
        <details class="credits-full"><summary>Full credits (every artist)</summary><div>${creditsHtml()}</div></details></section>`;
  }

  // ---------------------------------------------------------------- input

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const p = this.p;
    const d = t.dataset;
    if (d.page) return this.openPage(d.page as Page);
    if (d.act === 'back') return this.openPage(null);
    if (d.act === 'online') return this.hooks.online();
    if (d.act === 'play') {
      const role = p.role === 'flex' ? (Math.random() < 0.5 ? 'forward' : 'goalie') : p.role;
      return this.hooks.go(p.mode, p, role);
    }
    if (d.role) p.role = d.role as LobbyRole;
    if (d.mode) p.mode = d.mode as LobbyMode;
    if (d.dex) this.dexSel = d.dex;
    if (d.main) {
      if (p.main !== d.main) {
        audio.play(sfxPick);
        audio.cry(d.main, { force: true });
      }
      p.main = d.main;
      this.dexSel = d.main;
    }
    if (d.item) {
      const [role, id] = d.item.split(':') as ['forward' | 'goalie', string];
      (p.loadout[p.main] ??= { forward: 'auto', goalie: 'auto' })[role] = id;
    }
    if (d.set) {
      const [k, v] = d.set.split(':') as [string, string];
      if (k === 'diff') p.diff = v as Profile['diff'];
      if (k === 'bans') p.bans = v === 'on';
      if (k === 'auras') p.display.auras = v === 'on';
      if (k === 'names') p.display.names = v as Profile['display']['names'];
      if (k === 'mute') {
        p.audio.mute = v === 'on';
        audio.apply(p.audio);
      }
    }
    if (d.act === 'display-reset') {
      p.display = { ...DEFAULT_DISPLAY };
      applyDisplay(p.display);
    }
    if (d.act === 'reset') {
      if (!confirm('Reset your trainer level and all records? This cannot be undone.')) return;
      p.xp = 0;
      p.records = {};
    }
    saveProfile(p);
    const focus = Object.entries(d)
      .map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${v}"]`)
      .join('');
    if (this.page) this.renderPage();
    else this.render();
    this.el.querySelector<HTMLElement>(focus)?.focus();
  }

  private previewName(trainer: string, mon: string): string {
    const n = this.p.display.names;
    return n === 'trainer' ? trainer : n === 'both' ? `${trainer} · ${mon}` : mon;
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement;
    const d = this.p.display;
    if (t.name === 'auraOpacity') {
      d.auraOpacity = Math.min(1, Math.max(0.1, Number(t.value) / 100));
      const out = t.nextElementSibling;
      if (out) out.textContent = `${Math.round(d.auraOpacity * 100)} %`;
    }
    if (t.name === 'allyColor' || t.name === 'enemyColor' || t.name === 'arrowColor') {
      d[t.name] = t.value;
      applyDisplay(d);
    }
    if (t.name.startsWith('vol-')) {
      const k = t.name.slice(4) as 'master' | 'sfx' | 'voice' | 'ui';
      this.p.audio[k] = Math.min(1, Math.max(0, Number(t.value) / 100));
      const out = t.nextElementSibling;
      if (out) out.textContent = `${Math.round(this.p.audio[k] * 100)} %`;
      audio.apply(this.p.audio);
      if (e.type === 'change' && k !== 'ui') audio.play(k === 'voice' ? undefined : [{ s: 'pmd/Battle/DUN_Hit_Neutral', vol: 1, pitch: 1 }]);
      if (e.type === 'change' && k === 'voice') audio.cry(this.p.main, { force: true });
      if (e.type === 'change' && k === 'ui') audio.ui('click');
    }
    if (t.name === 'auraOpacity' || t.name.endsWith('Color') || t.name.startsWith('vol-')) {
      saveProfile(this.p);
      return;
    }
    if (t.name !== 'name' || e.type !== 'change') return;
    this.p.name = t.value.trim().slice(0, 16) || 'Trainer';
    saveProfile(this.p);
    // Online rooms use the same name.
    try {
      const o = JSON.parse(localStorage.getItem('pokeathlon.online') ?? '{}') as Record<string, unknown>;
      localStorage.setItem('pokeathlon.online', JSON.stringify({ ...o, name: this.p.name }));
    } catch {
      /* ignore */
    }
  }
}

/** The main Pokémon on the stage: its PMD Idle animation, big and pixelated. Drag to spin. */
class HeroSprite {
  private img: HTMLImageElement | null = null;
  private anim: SpriteManifest['anims'][string] | null = null;
  private dex = '';
  private row = 0;
  private raf = 0;
  private t0 = 0;
  private dragX: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => {
      this.dragX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      const steps = Math.trunc((e.clientX - this.dragX) / 36);
      if (steps) {
        this.row = (((this.row - steps) % 8) + 8) % 8;
        this.dragX += steps * 36;
      }
    });
    const end = () => (this.dragX = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  async load(dex: string): Promise<void> {
    if (dex === this.dex) return;
    this.dex = dex;
    this.row = 0;
    try {
      const m = (await (await fetch(`sprites/${dex}/anim.json`)).json()) as SpriteManifest;
      const anim = m.anims.Idle ?? Object.values(m.anims)[0]!;
      const img = new Image();
      img.src = `sprites/${dex}/${anim.file}`;
      await img.decode();
      if (this.dex !== dex) return;
      this.anim = anim;
      this.img = img;
    } catch {
      this.img = null;
    }
  }

  start(): void {
    if (this.raf) return;
    this.t0 = performance.now();
    const tick = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(now: number): void {
    const c = this.canvas;
    const ctx = c.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    const a = this.anim;
    const img = this.img;
    if (!a || !img || !w) return;
    const total = a.durations.reduce((s, x) => s + x, 0);
    let tick = Math.floor(((now - this.t0) / 1000) * 60) % total;
    let frame = 0;
    while (tick >= a.durations[frame]!) tick -= a.durations[frame++]!;
    const rows = Math.max(1, Math.round(img.height / a.frameHeight));
    const row = rows >= 8 ? this.row : 0;
    // Integer scale so the pixels stay crisp. PMD frames are centred on the body, so the frame centre
    // goes at 66 % of the height: the feet land on the platform (CSS) below it.
    const scale = Math.max(1, Math.floor(Math.min(w / a.frameWidth, (h * 0.6) / (a.frameHeight * 0.5), (h * 1.3) / a.frameHeight, (8 * h) / 360)));
    const dw = a.frameWidth * scale;
    const dh = a.frameHeight * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, frame * a.frameWidth, row * a.frameHeight, a.frameWidth, a.frameHeight, Math.round((w - dw) / 2), Math.round(h * 0.66 - dh / 2), dw, dh);
  }
}
