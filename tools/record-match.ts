/**
 * Record a CPU vs CPU match to an MP4 (H.264), plus a JSON balance report.
 *
 *   npm run record -- [--lineup pikachu,lucario,bronzong/togekiss,lucario,bronzong] [--until goal|set|match] [--fps 30] [--meter] [--url http://localhost:4173] [--out recordings]
 *
 * --meter  bake the F3 debug menu (Meter tab, hitbox / reach / ball-path overlay) into the video.
 *
 * Needs the game served (best: `npm run build` + `vite preview` on :4173, which never hot-reloads)
 * and Microsoft Edge (or Chrome via --browser).
 *
 * How it works: the game runs in a headless browser in record mode (?cpu=<3v3 lineup>&record=1), where
 * nothing moves on its own. For every video frame the recorder advances the simulation by exactly
 * 60/fps ticks; the page renders, then captures that very frame in-page (3D canvas + HUD painted
 * on top) and encodes it with WebCodecs (H.264). mp4-muxer streams the MP4 to disk through an
 * exposed function. Video time therefore equals game time, however long the capture takes.
 */
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : def;
};
/** 3v3 is the only mode: `a,b,c/d,e,f`, last of each team is the goalie. */
const LINEUP = arg('lineup', 'pikachu,lucario,bronzong/togekiss,lucario,bronzong');
const [A, B] = LINEUP.split('/').map((t) => t.replace(/,/g, '+')) as [string, string];
const FPS = Number(arg('fps', '30'));
const URL_BASE = arg('url', 'http://localhost:4173');
const OUT_DIR = resolve(ROOT, arg('out', 'recordings'));
const BROWSER = arg('browser', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
const MAX_MIN = Number(arg('max-minutes', '15'));
/** Stop after the first 'goal', the first finished 'set', or the whole 'match' (default). */
const UNTIL = arg('until', 'match');
const METER = process.argv.includes('--meter');
const WIDTH = 1280;
const HEIGHT = 720;
const TICKS_PER_FRAME = Math.round(60 / FPS);
const TAIL_FRAMES = FPS * 4; // keep recording the goal / winner banner

const stamp = new Date().toISOString().slice(0, 10);
mkdirSync(OUT_DIR, { recursive: true });
const base = join(OUT_DIR, `${stamp}_${A}-vs-${B}${UNTIL === 'match' ? '' : `_${UNTIL}`}${METER ? '_meter' : ''}`);
const mp4Path = `${base}.mp4`;
const fd = openSync(mp4Path, 'w');

type State = { tick: number; phase: string; goals: number[]; sets: number[]; winner: number };
type Rec = {
  startCapture(fps: number): Promise<void>;
  advance(n: number): Promise<State>;
  finishCapture(): Promise<number>;
  summary(): object;
};
type RecWindow = { __rec: Rec };

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
});

try {
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  // tsx/esbuild wraps functions in a `__name` helper; define it in the page that receives them.
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  page.on('pageerror', (e) => console.error('[game]', e));
  await page.exposeFunction('__writeChunk', (b64: string, position: number) => {
    const buf = Buffer.from(b64, 'base64');
    writeSync(fd, buf, 0, buf.length, position);
  });
  await page.goto(`${URL_BASE}/?cpu=${LINEUP}&record=1${METER ? '&meter=1' : ''}`);
  await page.waitForFunction(() => '__rec' in window);
  await new Promise((r) => setTimeout(r, 2500)); // sprites and portraits
  await page.evaluate((fps: number) => (window as unknown as RecWindow).__rec.startCapture(fps), FPS);

  console.log(`Recording ${A} vs ${B} (until ${UNTIL}) at ${FPS} fps → ${mp4Path}`);
  const t0 = Date.now();
  let frame = 0;
  let tail = -1;
  const maxFrames = MAX_MIN * 60 * FPS;
  for (;;) {
    const s = await page.evaluate((n: number) => (window as unknown as RecWindow).__rec.advance(n), TICKS_PER_FRAME);
    frame++;
    if (frame % (FPS * 30) === 0) {
      console.log(
        `  ${(s.tick / 3600).toFixed(1)} min game time · sets ${s.sets.join('-')} · goals ${s.goals.join('-')} · ${((Date.now() - t0) / 1000).toFixed(0)} s elapsed`,
      );
    }
    const done =
      s.phase === 'matchOver' ||
      (UNTIL === 'goal' && s.goals[0]! + s.goals[1]! + s.sets[0]! + s.sets[1]! > 0) ||
      (UNTIL === 'set' && s.sets[0]! + s.sets[1]! > 0);
    if (done && tail < 0) tail = TAIL_FRAMES;
    if (tail >= 0 && --tail <= 0) break;
    if (frame >= maxFrames) {
      console.log('  stopped at the time limit');
      break;
    }
  }
  await page.evaluate(() => (window as unknown as RecWindow).__rec.finishCapture());
  const summary = await page.evaluate(() => (window as unknown as RecWindow).__rec.summary());
  writeFileSync(`${base}.json`, JSON.stringify({ matchup: `${A} vs ${B}`, until: UNTIL, fps: FPS, frames: frame, ...summary }, null, 2) + '\n');
  console.log(`Done: ${frame} frames (${(frame / FPS / 60).toFixed(1)} min) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(`  video:  ${mp4Path}\n  report: ${base}.json`);
} finally {
  closeSync(fd);
  await browser.close();
}
