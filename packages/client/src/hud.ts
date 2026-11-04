import { gameplay, roster } from '@pokeathlon/data';
import { TICK_RATE, type Player, type World } from '@pokeathlon/sim';

const TEAM_NAMES = ['Blue', 'Red'] as const;
const nameOf = (p: Player) => roster.find((r) => r.id === p.pokemonId)?.name ?? p.pokemonId;

/** HTML HUD layered over the canvas: scoreboard, banners, nameplates and floating text. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly score: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly plates: HTMLElement[] = [];
  private bannerUntil = 0;
  private now = 0;

  constructor(root: HTMLElement, world: World) {
    this.root = root;
    this.score = el('div', 'scoreboard');
    this.banner = el('div', 'banner');
    root.append(this.score, this.banner);
    for (const p of world.players) {
      const plate = el('div', `plate team${p.team}`);
      plate.innerHTML =
        `<div class="plate-top"><span class="lv"></span><span class="nm"></span></div>` +
        `<div class="bar"><div class="fill"></div></div><div class="pips"><i></i><i></i><i></i></div>`;
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

  /** Floating text at a screen position (e.g. "Blasted off!"). */
  pop(text: string, x: number, y: number, cls = ''): void {
    const p = el('div', `pop ${cls}`);
    p.textContent = text;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.root.append(p);
    setTimeout(() => p.remove(), 1200);
  }

  update(dt: number, world: World, project: (x: number, y: number, h: number) => { x: number; y: number; visible: boolean }): void {
    this.now += dt;
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
      plate.querySelector<HTMLElement>('.nm')!.textContent = out ? `${nameOf(p)} · ${Math.ceil(p.koTicks / TICK_RATE)}s` : nameOf(p);
      plate.querySelector<HTMLElement>('.fill')!.style.width = `${(100 * p.stagger) / p.maxStagger}%`;
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
