/** Gamepad / arrow-key focus movement between the enabled buttons inside `root`. */
export function navigateButtons(root: HTMLElement, dir: 'up' | 'down' | 'left' | 'right' | 'press'): void {
  const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled])')];
  const cur = document.activeElement as HTMLElement | null;
  const i = cur ? items.indexOf(cur) : -1;
  if (dir === 'press') {
    if (i >= 0) cur!.click();
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
