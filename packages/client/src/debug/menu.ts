import { gameplay, roster } from '@pokeathlon/data';
import {
  analyzeRoster,
  bestTier,
  simTier,
  tierSnapshot,
  TIER_MEANING,
  TIERS,
  type BudgetPart,
  type FighterStats,
  type MoveStats,
  type Tier,
} from '@pokeathlon/data/analyze';
import {
  mvpScore,
  practiceClearCooldowns,
  practiceDamage,
  practiceDestroyTeam,
  practiceDisableBarriers,
  practiceKnockBack,
  practiceRemoveBall,
  practiceResetAll,
  practiceResetMeter,
  practiceRestoreBarriers,
  practiceSetEnergy,
  practiceSetOvertime,
  practiceSpawnBall,
  practiceSpawnEnemy,
  practiceStagger,
  TICK_RATE,
  type MoveTelemetry,
  type World,
} from '@pokeathlon/sim';

/** What the menu needs from the game loop. */
export interface DebugHooks {
  world(): World;
  /** The human player's id (−1 when spectating). */
  me: number;
  /** Call after players were added or removed (the client rebuilds sprites and nameplates). */
  playersChanged(): void;
  enemyMode: 'dummy' | 'bot';
  noCooldowns: boolean;
}

type Tab = 'meter' | 'practice' | 'kit' | 'tiers';
const TABS: [Tab, string][] = [
  ['meter', 'Meter'],
  ['practice', 'Practice'],
  ['kit', 'Kit'],
  ['tiers', 'Tiers'],
];
/** OS Core Stats colours: high / extreme ball speed. */
const HIGH_SPEED = 1300;
const EXTREME_SPEED = gameplay.ball.redThreshold;
const PART_NAMES: Record<BudgetPart, string> = {
  offense: 'offense',
  koThreat: 'KO threat',
  ball: 'ball',
  mobility: 'mobility',
  control: 'control',
  survivability: 'survival',
};

const nameOf = (id: string) => roster.find((r) => r.id === id)?.name ?? id;
const f0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '–');
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const tierBadge = (t: Tier | '–', extra = '') => `<b class="tier t-${t.replace('.', '_')}" title="${t === '–' ? 'no data' : TIER_MEANING[t]}">${t}${extra}</b>`;

/**
 * F3 debug menu (M4.3), modelled on OS's own tooling: Practice mode controls, Core Stats,
 * scoreboard / end-of-game stats and ability tooltips, plus PokéAthlon's tier list.
 */
export class DebugMenu {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private tab: Tab = 'meter';
  private focus = 0;
  private kitPokemon = '';
  private refresh = 0;
  private readonly kits: FighterStats[] = analyzeRoster();
  /** Per player: damage dealt samples for the rolling 5 s DPS. */
  private dmgHistory: { tick: number; dmg: number[] }[] = [];
  private enemyPick = 'lucario';

  constructor(
    root: HTMLElement,
    private readonly hooks: DebugHooks,
  ) {
    this.focus = Math.max(0, hooks.me);
    this.el = document.createElement('div');
    this.el.id = 'dbg';
    this.el.hidden = true;
    const tabs = document.createElement('div');
    tabs.className = 'dbg-tabs';
    for (const [id, label] of TABS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.tab = id;
      b.addEventListener('click', () => this.show(id));
      tabs.append(b);
    }
    this.body = document.createElement('div');
    this.body.className = 'dbg-body';
    this.el.append(tabs, this.body);
    // Clicks inside the menu (row focus, kit picker) are delegated.
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('change', (e) => this.onChange(e));
    root.append(this.el);
    this.show('meter');
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
    if (this.visible) this.render(0);
  }

  /** The player whose move rings the world overlay draws. */
  get focusId(): number {
    return this.focus;
  }

  private show(tab: Tab): void {
    this.tab = tab;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.dbg-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    if (this.visible) this.render(0);
  }

  /** Call every frame; redraws the live tabs ~5 times a second. */
  update(dt: number, fps: number): void {
    this.sample();
    if (!this.visible) return;
    this.refresh -= dt;
    if (this.refresh > 0) return;
    this.refresh = 0.2;
    if (this.tab === 'meter' || (this.tab === 'kit' && this.body.childElementCount === 0)) this.render(fps);
  }

  private sample(): void {
    const w = this.hooks.world();
    const last = this.dmgHistory[this.dmgHistory.length - 1];
    if (last && last.tick === w.tick) return;
    if (last && w.tick < last.tick) this.dmgHistory = []; // world restarted
    this.dmgHistory.push({ tick: w.tick, dmg: w.telemetry.players.map((p) => p.damageDealt) });
    while (this.dmgHistory.length > 2 && w.tick - this.dmgHistory[1]!.tick >= 5 * TICK_RATE) this.dmgHistory.shift();
  }

  private dps5(id: number): number {
    const w = this.hooks.world();
    const first = this.dmgHistory[0];
    const now = w.telemetry.players[id]?.damageDealt ?? 0;
    if (!first || w.tick === first.tick) return 0;
    return (now - (first.dmg[id] ?? 0)) / ((w.tick - first.tick) / TICK_RATE);
  }

  private render(fps: number): void {
    if (this.tab === 'meter') this.body.innerHTML = this.meterHtml(fps);
    else if (this.tab === 'practice') this.body.innerHTML = this.practiceHtml();
    else if (this.tab === 'kit') this.body.innerHTML = this.kitHtml();
    else this.body.innerHTML = this.tiersHtml();
  }

  // ---------- Meter ----------
  private meterHtml(fps: number): string {
    const w = this.hooks.world();
    const tel = w.telemetry;
    const playMin = tel.playTicks / TICK_RATE / 60;
    const speed = (v: number) => `<span class="${v >= EXTREME_SPEED ? 'spd-x' : v >= HIGH_SPEED ? 'spd-h' : ''}">${f0(v)}</span>`;
    const lastGoal = tel.ball.goalSpeeds[tel.ball.goalSpeeds.length - 1];
    const rows = tel.players
      .map((t) => {
        const p = w.players[t.id]!;
        const playS = Math.max(1, tel.playTicks) / TICK_RATE;
        const mvp = mvpScore(t);
        return `<tr data-focus="${t.id}" class="${t.id === this.focus ? 'sel' : ''}">
          <td class="team${t.team}">${esc(nameOf(t.pokemon))}${t.id === this.hooks.me ? ' ★' : ''}</td><td>${p.role === 'goalie' ? 'G' : 'F'}</td>
          <td>${t.goals}</td><td>${t.assists}</td><td>${t.kos}</td><td>${t.saves}</td><td>${t.shots}</td><td>${t.redirects}</td>
          <td>${f0(t.damageDealt)}</td><td>${f1(this.dps5(t.id))}</td><td>${f1(t.damageDealt / playS)}</td><td>${f0(t.damageTaken)}</td>
          <td>${t.ballTouches}</td><td>${pct(t.possessionTicks / Math.max(1, tel.playTicks))}</td><td>${f0(t.ballProgress)}</td>
          <td>${t.orbs}</td><td>${t.deaths}</td><td>${f1(p.role === 'goalie' ? mvp.goalie : mvp.forward)}</td></tr>`;
      })
      .join('');
    const fp = tel.players[this.focus];
    const kit = fp ? this.kits.find((k) => k.id === fp.pokemon) : undefined;
    const statics = new Map<string, MoveStats>(kit ? [kit.strike, ...kit.moves, kit.burst].map((m) => [m.id, m]) : []);
    const moveRows = fp
      ? Object.entries(fp.moves)
          .map(([id, m]: [string, MoveTelemetry]) => {
            const st = statics.get(id);
            const expected = m.casts * (st?.hitsPerCast ?? 0);
            return `<tr><td>${esc(st?.name ?? id)}</td><td>${m.casts}</td><td>${f1(m.casts / Math.max(playMin, 1 / 60))}</td>
              <td>${expected > 0 ? pct(m.playerHits / expected) : '–'}</td><td>${m.ballHits}</td><td>${f0(m.damage)}</td><td>${f0(m.knockback)}</td>
              <td>${m.kos}</td><td>${m.goals}</td><td>${tel.playTicks && id !== 'strike' && id !== 'burst' ? pct(m.readyTicks / tel.playTicks) : '–'}</td></tr>`;
          })
          .join('')
      : '';
    return `
      <div class="dbg-head">fps ${fps.toFixed(0)} · tick ${w.tick} · ${w.match.phase}${w.match.overtime ? ' (OT)' : ''} · live ${f1(playMin)} min</div>
      <h4>Core stats</h4>
      <div class="core">Avg ${speed(tel.ball.samples ? tel.ball.speedSum / tel.ball.samples : 0)} · Max ${speed(tel.ball.maxSpeed)} · Final ${lastGoal !== undefined ? speed(lastGoal) : '–'} <small>u/s</small></div>
      <h4>Scoreboard <small>(click a row to focus)</small></h4>
      <table class="num"><tr><th>Pokémon</th><th title="Role">R</th><th title="Goals">G</th><th title="Assists">A</th><th>KO</th><th title="Saves">Sv</th><th title="Shots on goal">Sh</th><th title="Redirects">Rd</th>
        <th>Dmg</th><th title="Damage per second, last 5 s">DPS5</th><th title="Damage per second of live play">DPS</th><th title="Damage taken">Taken</th>
        <th title="Ball touches">Tch</th><th title="Possession: time as last toucher">Poss</th><th title="Ball progress toward the enemy goal (units)">Prog</th>
        <th title="Orbs">Orb</th><th title="Deaths">D</th><th title="Set MVP score for this role">MVP</th></tr>${rows}</table>
      ${fp ? `<h4>${esc(nameOf(fp.pokemon))}: moves</h4>
      <table class="num"><tr><th>Move</th><th>Casts</th><th title="Casts per minute of live play">/min</th><th title="Player hits ÷ (casts × hits a cast can land)">Landed</th>
        <th title="Ball hits">Ball</th><th>Dmg</th><th>KB</th><th>KO</th><th title="Goals within 3 s of this touch">Goal</th><th title="Share of live time the move sat ready but unused">Idle ready</th></tr>${moveRows}</table>` : ''}`;
  }

  // ---------- Practice ----------
  private practiceHtml(): string {
    const w = this.hooks.world();
    const kitted = this.kits.map((k) => k.id);
    const enemy = w.players.find((p) => p.team !== (w.players[this.hooks.me]?.team ?? 0));
    const btn = (act: string, label: string) => `<button data-act="${act}">${label}</button>`;
    return `
      <div class="practice">
        <div><span>Core</span>${btn('ball-spawn', 'Spawn ball')}${btn('ball-remove', 'Remove ball')}</div>
        <div><span>Enemy</span><select data-pick="enemy">${kitted.map((id) => `<option value="${id}" ${id === this.enemyPick ? 'selected' : ''}>${esc(nameOf(id))}</option>`).join('')}</select>
          ${btn('enemy-spawn', enemy ? 'Swap enemy' : 'Spawn enemy')}${btn('enemy-destroy', 'Destroy enemy')}</div>
        <div><span>Enemy AI</span>
          <label><input type="radio" name="emode" data-mode="dummy" ${this.hooks.enemyMode === 'dummy' ? 'checked' : ''}> Dummy</label>
          <label><input type="radio" name="emode" data-mode="bot" ${this.hooks.enemyMode === 'bot' ? 'checked' : ''}> Bot</label></div>
        <div><span>Reset</span>${btn('reset-all', 'Reset all')}${btn('reset-meter', 'Reset meter')}</div>
        <div><span>Cooldowns</span>${btn('cd-clear', 'Clear cooldowns')}
          <label><input type="checkbox" data-opt="nocd" ${this.hooks.noCooldowns ? 'checked' : ''}> Always clear</label></div>
        <div><span>Energy</span>${btn('nrg-0', 'Zero')}${btn('nrg-50', 'Half')}${btn('nrg-100', 'Max')}</div>
        <div><span>Stagger</span>${btn('stg-self', 'Self')}${btn('stg-enemy', 'Enemy')}</div>
        <div><span>Damage 25%</span>${btn('dmg-self', 'Self')}${btn('dmg-enemy', 'Enemy')}</div>
        <div><span>Knock back</span>${btn('kb-self', 'Self')}${btn('kb-enemy', 'Enemy')}</div>
        <div><span>Barriers</span>${btn('bar-restore', 'Restore')}${btn('bar-disable', 'Disable')}</div>
        <div><span>Overtime</span>${btn('ot-on', 'Start')}${btn('ot-off', 'End')}</div>
      </div>
      <p class="note">Modelled on Omega Strikers' Practice mode. Open <code>?practice=1</code> for a sandbox with an enemy dummy.</p>`;
  }

  private practice(act: string): void {
    const w = this.hooks.world();
    const me = Math.max(0, this.hooks.me);
    const myTeam = w.players[me]?.team ?? 0;
    const enemy = () => w.players.find((p) => p.team !== myTeam)?.id ?? -1;
    switch (act) {
      case 'ball-spawn':
        practiceSpawnBall(w);
        break;
      case 'ball-remove':
        practiceRemoveBall(w);
        break;
      case 'enemy-spawn':
        practiceSpawnEnemy(w, this.enemyPick, myTeam);
        this.hooks.playersChanged();
        break;
      case 'enemy-destroy':
        this.destroyEnemies(myTeam);
        break;
      case 'reset-all':
        practiceResetAll(w);
        break;
      case 'reset-meter':
        practiceResetMeter(w);
        this.dmgHistory = [];
        break;
      case 'cd-clear':
        practiceClearCooldowns(w);
        break;
      case 'nrg-0':
      case 'nrg-50':
      case 'nrg-100':
        practiceSetEnergy(w, me, Number(act.slice(4)) / 100);
        break;
      case 'stg-self':
        practiceStagger(w, me);
        break;
      case 'stg-enemy':
        practiceStagger(w, enemy());
        break;
      case 'dmg-self':
        practiceDamage(w, me);
        break;
      case 'dmg-enemy':
        practiceDamage(w, enemy());
        break;
      case 'kb-self':
        practiceKnockBack(w, me);
        break;
      case 'kb-enemy':
        practiceKnockBack(w, enemy());
        break;
      case 'bar-restore':
        practiceRestoreBarriers(w);
        break;
      case 'bar-disable':
        practiceDisableBarriers(w);
        break;
      case 'ot-on':
        practiceSetOvertime(w, true);
        break;
      case 'ot-off':
        practiceSetOvertime(w, false);
        break;
    }
    if (this.tab === 'practice') this.render(0);
  }

  private destroyEnemies(myTeam: 0 | 1): void {
    const w = this.hooks.world();
    // Keep the human player: remove only the other team.
    practiceDestroyTeam(w, myTeam === 0 ? 1 : 0);
    if (this.focus >= w.players.length) this.focus = 0;
    this.hooks.playersChanged();
  }

  // ---------- Kit (OS ability-tooltip layout) ----------
  private kitHtml(): string {
    const w = this.hooks.world();
    const id = this.kitPokemon || w.telemetry.players[this.focus]?.pokemon || this.kits[0]!.id;
    const k = this.kits.find((f) => f.id === id) ?? this.kits[0]!;
    const live = w.telemetry.players.find((t) => t.pokemon === k.id);
    const card = (m: MoveStats) => {
      const type = { projectile: 'PROJECTILE', dash: 'MOVEMENT', wall: 'CREATION', buff: 'BUFF', area: 'AREA', strike: 'STRIKE', burst: 'BURST' }[m.kind.split('+')[0]!] ?? m.kind.toUpperCase();
      const hitType = m.hitsPerCast === 0 ? '–' : m.knockback === 0 ? 'LIGHT' : m.staggeredKnockback / 3.545 >= 300 ? 'HEAVY' : 'MEDIUM';
      const lm = live?.moves[m.id];
      const row = (k2: string, v: string) => (v && v !== '–' ? `<tr><th>${k2}</th><td>${v}</td></tr>` : '');
      return `<div class="kcard"><h5>${esc(m.name)} <small>${m.slot}</small></h5><table>
        ${row('Ability type', type)}${row('Hit type', hitType)}
        ${row('Cooldown', m.cooldown ? `${m.cooldown} s` : m.slot === 'burst' ? '75 Energy' : '')}
        ${row('Wind-up', m.castTime ? `${m.castTime} s` : '')}${row('Duration', m.duration ? `${m.duration.toFixed(2)} s` : '')}
        ${row('Reach', m.reach ? f0(m.reach) : '')}${row('Time to reach', m.hitsPerCast || m.ballPower ? `${m.timeToReach.toFixed(2)} s` : '')}
        ${row('Hit area', m.hitArea ? `${f0(m.hitArea / 1000)}k u²` : '')}
        ${row('Damage', m.damagePerCast ? `${f0(m.damagePerCast)}${m.hitsPerCast > 1 ? ` (${m.hitsPerCast} hits)` : ''}` : '')}
        ${row('DPS', m.dps ? f1(m.dps) : '')}
        ${row('Player knockback', m.knockback ? f0(m.knockback) : '')}${row('vs Staggered', m.staggeredKnockback ? `${f0(m.staggeredKnockback)} (KO reach ${pct(m.koReach)})` : '')}
        ${row('Core knockback', m.ballPower ? f0(m.ballPower) : '')}
        ${row('Stun', m.stun || m.ballStun ? [m.stun ? `${m.stun} s` : '', m.ballStun ? `ball ${m.ballStun} s` : ''].filter(Boolean).join(', ') : '')}
        ${row('Utility', [m.mobility ? `+${f0(m.mobility)} move` : '', m.heal ? `heal ${pct(m.heal)}` : '', m.banish ? `banish ${m.banish} s` : '', m.shield, m.notes].filter(Boolean).join(', '))}
        ${lm ? row('Live', `${lm.casts} casts, ${f0(lm.damage)} dmg, ${lm.ballHits} ball hits`) : ''}
      </table></div>`;
    };
    return `
      <div class="kit-pick"><select data-pick="kit">${this.kits.map((f) => `<option value="${f.id}" ${f.id === k.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
        ${tierBadge(k.theoryTier)} <small>theory tier · budget ${f0(k.budget)}</small></div>
      <div class="kstats">PWR ${k.power} · SPD ${k.speed} · STG ${f0(k.staggerL1)}→${f0(k.staggerL10)} · ${k.size}<br>
        Kit DPS ${f1(k.kitDps)} · combos to Stagger ${k.combosToStagger.toFixed(2)} · ball pressure ${f0(k.ballPressure)}/s · mobility ${f0(k.mobility)} · survive ${f1(k.survivability)} s</div>
      <div class="kcards">${[k.strike, ...k.moves, k.burst].map(card).join('')}</div>`;
  }

  // ---------- Tiers ----------
  private tiersHtml(): string {
    const snap = new Map(tierSnapshot.entries.map((e) => [e.pokemon, e]));
    const rows = this.kits
      .map((k) => {
        const e = snap.get(k.id);
        const fw = e && e.forward.games ? simTier(e.forward.wins, e.forward.games) : null;
        const gk = e && e.goalie.games ? simTier(e.goalie.wins, e.goalie.games) : null;
        const overall = fw && gk ? bestTier(fw.tier, gk.tier) : (fw ?? gk)?.tier;
        const cell = (s: ReturnType<typeof simTier> | null, rec?: { wins: number; games: number }) =>
          s ? `${tierBadge(s.tier, s.uncertain ? '?' : '')}<small> ${pct(s.winRate)} (${pct(s.ci[0])}–${pct(s.ci[1])}) n=${rec!.games}</small>` : tierBadge('–');
        // Strongest and weakest budget part relative to the roster average.
        const parts = (Object.entries(k.budgetParts) as [BudgetPart, number][]).sort((a, b) => b[1] - a[1]);
        const [hi, lo] = [parts[0]!, parts[parts.length - 1]!];
        const why = `▲ ${PART_NAMES[hi[0]]} ${f0(hi[1])}% · ▼ ${PART_NAMES[lo[0]]} ${f0(lo[1])}%`;
        const specialist = fw && gk && Math.abs(TIERS.indexOf(fw.tier) - TIERS.indexOf(gk.tier)) >= 2 ? ' <small class="spec">role-specialist</small>' : '';
        return `<tr><td>${esc(k.name)}${specialist}</td><td>${overall ? tierBadge(overall) : tierBadge('–')}</td><td>${cell(fw, e?.forward)}</td><td>${cell(gk, e?.goalie)}</td>
          <td>${tierBadge(k.theoryTier)}<small> ${f0(k.budget)}</small></td><td>${e?.impact !== undefined ? f1(e.impact) : '–'}</td><td><small>${why}</small></td></tr>`;
      })
      .join('');
    return `
      <table class="tiers"><tr><th>Pokémon</th><th>Overall</th><th>Forward</th><th>Goalie</th><th>Theory</th><th>Impact</th><th>Why (budget)</th></tr>${rows}</table>
      <p class="note">${
        tierSnapshot.generatedAt
          ? `Sim tiers from <code>npm run balance</code> (${esc(tierSnapshot.generatedAt)}, ${esc(tierSnapshot.difficulty)} bots).`
          : 'No sim tiers yet: they come from <code>npm run balance</code> (M4.6). Theory tiers come from the kit analyzer’s power budget.'
      } A <b>?</b> means the 95% interval spans more than one neighbouring tier.</p>
      <div class="legend">${TIERS.map((t) => `<div>${tierBadge(t)} ${TIER_MEANING[t]}</div>`).join('')}</div>`;
  }

  // ---------- Events ----------
  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) {
      this.practice(act);
      return;
    }
    const row = t.closest<HTMLElement>('[data-focus]');
    if (row) {
      this.focus = Number(row.dataset.focus);
      this.render(0);
    }
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.dataset.pick === 'kit') {
      this.kitPokemon = t.value;
      this.render(0);
    } else if (t.dataset.pick === 'enemy') this.enemyPick = t.value;
    else if (t.dataset.mode) this.hooks.enemyMode = t.dataset.mode as 'dummy' | 'bot';
    else if (t.dataset.opt === 'nocd') this.hooks.noCooldowns = t.checked;
  }
}
