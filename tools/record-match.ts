/**
 * Record a CPU vs CPU match to an MP4 (H.264), plus a JSON balance report.
 *
 *   npm run record -- --a pikachu --b lucario [--fps 30] [--url http://localhost:5173] [--out recordings]
 *
 * Needs the dev server running (npm run dev) and Microsoft Edge (or Chrome via --browser).
 * How it works: the game runs in a headless browser in record mode (?cpu=a,b&record=1), where
 * nothing moves on its own. For every video frame the recorder advances the simulation by exactly
 * 60/fps ticks, renders, takes a screenshot (so the HTML HUD is included), and feeds it to the
 * browser's WebCodecs H.264 encoder; mp4-muxer packs the result and streams it to disk.
 * Video time therefore equals game time, however long the capture takes.
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
const A = arg('a', 'pikachu');
const B = arg('b', 'lucario');
const FPS = Number(arg('fps', '30'));
const URL_BASE = arg('url', 'http://localhost:5173');
const OUT_DIR = resolve(ROOT, arg('out', 'recordings'));
const BROWSER = arg('browser', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
const MAX_MIN = Number(arg('max-minutes', '15'));
const WIDTH = 1280;
const HEIGHT = 720;
const TICKS_PER_FRAME = Math.round(60 / FPS);
const TAIL_FRAMES = FPS * 4; // keep recording the winner banner

const stamp = new Date().toISOString().slice(0, 10);
mkdirSync(OUT_DIR, { recursive: true });
const base = join(OUT_DIR, `${stamp}_${A}-vs-${B}`);
const mp4Path = `${base}.mp4`;
const fd = openSync(mp4Path, 'w');

// Two separate browsers: the game must be the only page in its browser, otherwise its
// compositing gets throttled and screenshots come back stale.
const launch = () =>
  puppeteer.launch({
    executablePath: BROWSER,
    headless: true,
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
const browser = await launch();
const encBrowser = await launch();

try {
  // Encoder page: any localhost page works (WebCodecs needs a secure context).
  // tsx/esbuild wraps functions in a `__name` helper; define it in pages that receive our functions.
  const shim = 'globalThis.__name = (f) => f;';
  const enc = (await encBrowser.pages())[0] ?? (await encBrowser.newPage());
  await enc.evaluateOnNewDocument(shim);
  await enc.goto(`${URL_BASE}/sprites/0025/anim.json`);
  await enc.addScriptTag({ path: join(ROOT, 'node_modules/mp4-muxer/build/mp4-muxer.js') });
  await enc.exposeFunction('__writeChunk', (b64: string, position: number) => {
    const buf = Buffer.from(b64, 'base64');
    writeSync(fd, buf, 0, buf.length, position);
  });
  await enc.evaluate(
    async (w: number, h: number, fps: number) => {
      const g = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const toB64 = (u8: Uint8Array) => {
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const muxer = new g.Mp4Muxer.Muxer({
        target: new g.Mp4Muxer.StreamTarget({
          onData: (data: Uint8Array, position: number) => g.__writeChunk(toB64(data), position),
          chunked: true,
        }),
        video: { codec: 'avc', width: w, height: h, frameRate: fps },
        fastStart: false,
      });
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => (g.__encError = String(e)),
      });
      encoder.configure({ codec: 'avc1.640028', width: w, height: h, bitrate: 5_000_000, framerate: fps, avc: { format: 'avc' } });
      g.__addFrame = async (b64: string, i: number) => {
        const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const frame = new VideoFrame(bmp, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        bmp.close();
        while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
        if (g.__encError) throw new Error(g.__encError);
      };
      g.__finish = async () => {
        await encoder.flush();
        muxer.finalize();
      };
    },
    WIDTH,
    HEIGHT,
    FPS,
  );

  // Game page in record mode.
  const game = (await browser.pages())[0] ?? (await browser.newPage());
  await game.evaluateOnNewDocument(shim);
  game.on('pageerror', (e) => console.error('[game]', e));
  await game.goto(`${URL_BASE}/?cpu=${A},${B}&record=1`);
  await game.waitForFunction(() => '__rec' in window);
  await new Promise((r) => setTimeout(r, 2500)); // sprites and portraits
  await game.bringToFront(); // background tabs get throttled compositing → stale screenshots

  console.log(`Recording ${A} vs ${B} at ${FPS} fps → ${mp4Path}`);
  const t0 = Date.now();
  let frame = 0;
  let tail = -1;
  const maxFrames = MAX_MIN * 60 * FPS;
  type State = { tick: number; phase: string; goals: number[]; sets: number[]; winner: number };
  for (;;) {
    const s = (await game.evaluate((n: number) => (window as any).__rec.advance(n), TICKS_PER_FRAME)) as State; // eslint-disable-line @typescript-eslint/no-explicit-any
    const shot = (await game.screenshot({ type: 'jpeg', quality: 88, encoding: 'base64' })) as string;
    await enc.evaluate((b: string, i: number) => (window as any).__addFrame(b, i), shot, frame); // eslint-disable-line @typescript-eslint/no-explicit-any
    frame++;
    if (frame % (FPS * 30) === 0) {
      const gameMin = (s.tick / 3600).toFixed(1);
      console.log(`  ${gameMin} min game time · sets ${s.sets.join('-')} · goals ${s.goals.join('-')} · ${((Date.now() - t0) / 1000).toFixed(0)} s elapsed`);
    }
    if (s.phase === 'matchOver' && tail < 0) tail = TAIL_FRAMES;
    if (tail >= 0 && --tail <= 0) break;
    if (frame >= maxFrames) {
      console.log('  stopped at the time limit');
      break;
    }
  }
  await enc.evaluate(() => (window as any).__finish()); // eslint-disable-line @typescript-eslint/no-explicit-any
  const summary = await game.evaluate(() => (window as any).__rec.summary()); // eslint-disable-line @typescript-eslint/no-explicit-any
  writeFileSync(`${base}.json`, JSON.stringify({ matchup: `${A} vs ${B}`, fps: FPS, frames: frame, ...summary }, null, 2) + '\n');
  console.log(`Done: ${frame} frames (${(frame / FPS / 60).toFixed(1)} min) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(`  video:  ${mp4Path}\n  report: ${base}.json`);
} finally {
  closeSync(fd);
  await browser.close();
  await encBrowser.close();
}
