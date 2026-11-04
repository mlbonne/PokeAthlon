import { gameplay } from '@pokeathlon/data';
import { TICK_RATE, type Player } from '@pokeathlon/sim';

/** Button prompts per input device (keyboard + mouse, or an Xbox-layout gamepad). */
const PROMPTS = {
  keyboard: { strike: 'LMB', moves: ['Q', 'E', 'R'], evade: 'Space' },
  pad: { strike: 'A / RT', moves: ['X', 'Y', 'LT'], evade: 'B / LB' },
} as const;
export type InputDevice = keyof typeof PROMPTS;

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

  update(p: Player, device: InputDevice = 'keyboard'): void {
    const sig = p.pokemonId + p.moves.map((m) => m.def.id).join() + device;
    if (sig !== this.signature) {
      this.signature = sig;
      const k = PROMPTS[device];
      const slots = [
        `<div class="ab" data-k="strike"><b>${k.strike}</b><span>Strike</span><i></i></div>`,
        ...p.moves.map((m, i) => `<div class="ab" data-k="m${i}" title="${m.def.desc}"><b>${k.moves[i]}</b><span>${m.def.name}</span><i></i></div>`),
        `<div class="ab" data-k="evade"><b>${k.evade}</b><span>Evade</span><i></i></div>`,
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
