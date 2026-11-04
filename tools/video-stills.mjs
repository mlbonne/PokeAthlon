/**
 * Extract JPEG stills from a recorded MP4 at given timestamps (decoded by headless Edge),
 * e.g. to check a recording without a video player:
 *   node tools/video-stills.mjs recordings/<file>.mp4 out/still 5 60 120
 * Needs the built game served on :4173 (vite preview) for a secure localhost page.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
const [file, outPrefix, ...times] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const p = await b.newPage();
await p.goto('http://localhost:4173/sprites/0025/anim.json');
const b64 = readFileSync(file).toString('base64');
const info = await p.evaluate(async (data, ts) => {
  const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const v = document.createElement('video');
  v.muted = true;
  v.src = URL.createObjectURL(new Blob([bin], { type: 'video/mp4' }));
  await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('decode failed')); });
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  const out = [];
  for (const t of ts) {
    v.currentTime = Math.min(Number(t), v.duration - 0.05);
    await new Promise((r) => (v.onseeked = r));
    c.getContext('2d').drawImage(v, 0, 0);
    out.push(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
  }
  return { w: v.videoWidth, h: v.videoHeight, duration: v.duration, frames: out };
}, b64, times);
console.log(JSON.stringify({ w: info.w, h: info.h, duration: info.duration }));
info.frames.forEach((f, i) => writeFileSync(`${outPrefix}_${times[i]}.jpg`, Buffer.from(f, 'base64')));
await b.close();
