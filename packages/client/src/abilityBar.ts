import { gameplay } from '@pokeathlon/data';
import { TICK_RATE, type Player } from '@pokeathlon/sim';

const KEYS = ['Q', 'E', 'R'];

/** Bottom-centre ability bar: Strike, the three moves and Evade, with cooldowns. */
export class AbilityBar {
  private readonly el: HTMLElement;
  private signature = '';

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'abilities';
    root.append(this.el);
  }

  remove(): void {
    this.el.remove();
  }

  update(p: Player): void {
    const sig = p.pokemonId + p.moves.map((m) => m.def.id).join();
    if (sig !== this.signature) {
      this.signature = sig;
      const slots = [
        `<div class="ab" data-k="strike"><b>LMB</b><span>Strike</span><i></i></div>`,
        ...p.moves.map((m, i) => `<div class="ab" data-k="m${i}" title="${m.def.desc}"><b>${KEYS[i]}</b><span>${m.def.name}</span><i></i></div>`),
        `<div class="ab" data-k="evade"><b>Space</b><span>Evade</span><i></i></div>`,
      ];
      if (p.moves.length === 0) slots.splice(1, 0, `<div class="ab none"><span>No kit yet</span></div>`);
      this.el.innerHTML = slots.join('');
    }
    const set = (k: string, cd: number, total: number, locked = false, label?: string) => {
      const box = this.el.querySelector<HTMLElement>(`[data-k="${k}"]`);
      if (!box) return;
      box.classList.toggle('locked', locked);
      box.classList.toggle('cd', cd > 0);
      const shade = box.querySelector<HTMLElement>('i')!;
      shade.style.height = `${total > 0 ? (100 * cd) / total : 0}%`;
      shade.textContent = locked ? 'Lv 2' : cd > 0 ? (cd / TICK_RATE).toFixed(cd > TICK_RATE ? 0 : 1) : '';
      if (label) box.querySelector('span')!.textContent = label;
    };
    set('strike', p.strikeCooldown, gameplay.strike.cooldown * TICK_RATE);
    p.moves.forEach((m, i) => set(`m${i}`, m.cooldown, m.def.cooldown * TICK_RATE, m.def.slot === 'special' && p.level < gameplay.xp.specialUnlockLevel));
    const full = p.energy >= gameplay.energy.max;
    set('evade', p.evadeCooldown, gameplay.evade.cooldown * TICK_RATE, false, full ? 'BURST!' : 'Evade');
    this.el.querySelector('[data-k="evade"]')?.classList.toggle('full', full);
  }
}
