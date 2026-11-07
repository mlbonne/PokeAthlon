import { gameplay, roster } from '@pokeathlon/data';
import { TICK_RATE, type Player, type World } from '@pokeathlon/sim';

const TEAM_NAMES = ['Blue', 'Red'] as const;
const nameOf = (p: Player) => roster.find((r) => r.id === p.pokemonId)?.name ?? p.pokemonId;

const dexOf = (p: Player) => roster.find((r) => r.id === p.pokemonId)?.dex ?? roster[0]!.dex;

/**
 * HTML HUD layered over the canvas: scoreboard, team panels (portrait, level, Stagger, Energy and
 * KO timer for every player, up to 3v3), banners, nameplates and floating text.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly score: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly plates: HTMLElement[] = [];
  private readonly chips: HTMLElement[] = [];
  private bannerUntil = 0;
  private now = 0;
  /** Nameplate text: Pokémon, trainer (from `trainers`) or both. Set by the game from Settings. */
  names: 'pokemon' | 'trainer' | 'both' = 'pokemon';
  /** Trainer name per player id (you, room players, "CPU"). */
  trainers: string[] = [];

  /** @param me the human player's id (highlighted), −1 when spectating. */
  constructor(root: HTMLElement, world: World, me = -1) {
    this.root = root;
    this.score = el('div', 'scoreboard');
    this.banner = el('div', 'banner');
    root.append(this.score, this.banner);
    for (const team of [0, 1] as const) {
      const panel = el('div', `team-hud t${team}`);
      for (const p of world.players.filter((q) => q.team === team)) {
        const chip = el('div', `tchip${p.id === me ? ' me' : ''}`);
        chip.innerHTML =
          `<img src="portraits/${dexOf(p)}/Normal.png" alt=""><div class="tinfo">` +
          `<div class="tname"><span class="tlv"></span> ${nameOf(p)}${p.role === 'goalie' ? ' <em>G</em>' : ''}${p.id === me ? ' <em>YOU</em>' : ''}</div>` +
          `<div class="tbar"><div class="fill"></div></div><div class="pips"><i></i><i></i><i></i></div></div><div class="tko"></div>`;
        panel.append(chip);
        this.chips[p.id] = chip;
      }
      root.append(panel);
    }
    const myTeam = world.players[me]?.team ?? 0;
    for (const p of world.players) {
      const plate = el('div', `plate team${p.team}${p.id === me ? ' me' : ''}${p.team !== myTeam ? ' enemy' : ' ally'}`);
      plate.innerHTML =
        (p.id === me ? `<div class="me-arrow" aria-label="You"></div>` : '') +
        `<div class="plate-top"><span class="lv"></span><span class="nm"></span></div>` +
        `<div class="bar"><div class="fill"></div></div><div class="pips"><i></i><i></i><i></i></div><div class="ai"></div>`;
      root.append(plate);
      this.plates.push(plate);
    }
  }

  /** Big centre text for `seconds`. */
  showBanner(html: string, seconds: number, cls = ''): void {
    this.banner.innerHTML = html;
    this.banner.className = `banner show ${cls}`;
    this.bannerUntil = this.now + seconds;
  }

  private pops: { el: HTMLElement; age: number }[] = [];

  /** Floating text at a screen position (e.g. "Blasted off!"). Animated in game time. */
  pop(text: string, x: number, y: number, cls = ''): void {
    const p = el('div', `pop ${cls}`);
    p.textContent = text;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.root.append(p);
    this.pops.push({ el: p, age: 0 });
  }

  /** @param aiLabel when given (F3 open), shows each bot's current job and action under its plate. */
  update(
    dt: number,
    world: World,
    project: (x: number, y: number, h: number) => { x: number; y: number; visible: boolean },
    aiLabel: ((id: number) => string) | null = null,
  ): void {
    this.now += dt;
    this.pops = this.pops.filter((p) => {
      p.age += dt;
      const t = Math.min(1, p.age / 1.2);
      p.el.style.opacity = String(1 - t * t);
      p.el.style.marginTop = `${-60 * (1 - (1 - t) * (1 - t))}px`;
      if (t >= 1) p.el.remove();
      return t < 1;
    });
    const m = world.match;

    // Scoreboard.
    const t = Math.floor(m.roundTicks / TICK_RATE);
    const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const pips = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, gameplay.match.setsToWin - n));
    this.score.innerHTML =
      `<span class="t0">${TEAM_NAMES[0]} <b>${m.goals[0]}</b> <small>${pips(m.sets[0])}</small></span>` +
      `<span class="clock ${m.overtime ? 'ot' : ''}">${m.overtime ? 'OVERTIME ' : ''}${clock}<small>Set ${m.setIndex + 1}</small></span>` +
      `<span class="t1"><small>${pips(m.sets[1])}</small> <b>${m.goals[1]}</b> ${TEAM_NAMES[1]}</span>`;

    // Kickoff countdown overrides other banners.
    if (m.phase === 'kickoff') {
      const n = Math.ceil(m.phaseTicks / TICK_RATE);
      this.banner.innerHTML = n > 0 ? String(n) : 'GO!';
      this.banner.className = 'banner show count';
      this.bannerUntil = this.now + 0.4;
    } else if (this.now > this.bannerUntil) {
      this.banner.className = 'banner';
    }

    // Nameplates.
    world.players.forEach((p, i) => {
      const plate = this.plates[i]!;
      const s = project(p.pos.x, p.pos.y, 1.9);
      const out = p.koTicks > 0;
      plate.style.display = s.visible ? '' : 'none';
      plate.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      plate.classList.toggle('ko', out);
      plate.classList.toggle('staggered', p.staggered);
      plate.querySelector<HTMLElement>('.lv')!.textContent = `Lv${p.level}`;
      const trainer = this.trainers[p.id] || 'CPU';
      const label = this.names === 'trainer' ? trainer : this.names === 'both' ? `${trainer} · ${nameOf(p)}` : nameOf(p);
      plate.querySelector<HTMLElement>('.nm')!.textContent = out ? `${label} · ${Math.ceil(p.koTicks / TICK_RATE)}s` : label;
      plate.querySelector<HTMLElement>('.fill')!.style.width = `${(100 * p.stagger) / p.maxStagger}%`;
      plate.querySelector<HTMLElement>('.ai')!.textContent = aiLabel ? aiLabel(p.id) : '';

      // Team panel chip.
      const chip = this.chips[p.id];
      if (chip) {
        chip.classList.toggle('ko', out);
        chip.classList.toggle('staggered', p.staggered);
        chip.querySelector<HTMLElement>('.tlv')!.textContent = `Lv${p.level}`;
        chip.querySelector<HTMLElement>('.fill')!.style.width = `${(100 * p.stagger) / p.maxStagger}%`;
        chip.querySelector<HTMLElement>('.tko')!.textContent = out ? `${Math.ceil(p.koTicks / TICK_RATE)}` : '';
        const nrg = p.energy / (gameplay.energy.max / 3);
        chip.querySelectorAll<HTMLElement>('.pips i').forEach((pip, k) => {
          pip.style.setProperty('--f', String(Math.max(0, Math.min(1, nrg - k))));
          pip.classList.toggle('full', p.energy >= gameplay.energy.max);
        });
      }
      const bars = p.energy / (gameplay.energy.max / 3);
      plate.querySelectorAll<HTMLElement>('.pips i').forEach((pip, k) => {
        const f = Math.max(0, Math.min(1, bars - k));
        pip.style.setProperty('--f', String(f));
        pip.classList.toggle('full', p.energy >= gameplay.energy.max);
      });
    });
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export { TEAM_NAMES, nameOf };
