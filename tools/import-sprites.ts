/**
 * Copies the roster's sprites and portraits from the local SpriteCollab checkout into /assets
 * and regenerates CREDITS.md.
 *
 *   npm run import-sprites                         # uses ./SpriteCollab-master
 *   npm run import-sprites -- --src <path>         # custom SpriteCollab location
 *
 * Output (committed):
 *   assets/sprites/<dex>/anim.json + <Anim>-Anim.png + <Anim>-Shadow.png
 *   assets/portraits/<dex>/<Emotion>.png
 *   CREDITS.md
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import {
  OPTIONAL_ANIMS,
  PORTRAIT_EMOTIONS,
  REQUIRED_ANIMS,
  roster,
  type SpriteAnim,
  type SpriteManifest,
} from '../packages/data/src/index';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argSrc = process.argv.indexOf('--src');
const SRC = resolve(argSrc > -1 ? process.argv[argSrc + 1]! : join(ROOT, 'SpriteCollab-master'));
const OUT_SPRITES = join(ROOT, 'assets', 'sprites');
const OUT_PORTRAITS = join(ROOT, 'assets', 'portraits');

if (!existsSync(join(SRC, 'sprite'))) {
  console.error(`SpriteCollab not found at ${SRC} (expected a "sprite" folder).`);
  process.exit(1);
}

// ---------- AnimData.xml ----------
interface RawAnim {
  Name: string;
  CopyOf?: string;
  FrameWidth?: number;
  FrameHeight?: number;
  RushFrame?: number;
  HitFrame?: number;
  ReturnFrame?: number;
  Durations?: { Duration: number | number[] };
}

function readAnimData(dex: string): { shadowSize: number; anims: Map<string, RawAnim> } {
  const xml = readFileSync(join(SRC, 'sprite', dex, 'AnimData.xml'), 'utf8');
  const doc = new XMLParser({ isArray: (name) => name === 'Anim' }).parse(xml) as {
    AnimData: { ShadowSize: number; Anims: { Anim: RawAnim[] } };
  };
  const anims = new Map<string, RawAnim>();
  for (const a of doc.AnimData.Anims.Anim) anims.set(a.Name, a);
  return { shadowSize: Number(doc.AnimData.ShadowSize), anims };
}

function resolveAnim(name: string, anims: Map<string, RawAnim>, depth = 0): RawAnim | undefined {
  const a = anims.get(name);
  if (!a || depth > 5) return undefined;
  return a.CopyOf ? resolveAnim(a.CopyOf, anims, depth + 1) : a;
}

// ---------- Credits ----------
interface Credit {
  name: string;
  contact: string;
  licenses: Set<string>;
}

function loadCreditNames(): Map<string, { name: string; contact: string }> {
  const map = new Map<string, { name: string; contact: string }>();
  const lines = readFileSync(join(SRC, 'credit_names.txt'), 'utf8').split(/\r?\n/).slice(1);
  for (const line of lines) {
    const [name, discord, contact] = line.split('\t');
    if (!name) continue;
    // Contacts that are only Discord mentions are not useful publicly.
    const c = contact && !contact.includes('<@') ? contact.trim() : '';
    const entry = { name: name.trim(), contact: c };
    map.set(name.trim(), entry);
    if (discord) map.set(discord.trim(), entry);
  }
  return map;
}

function readCredits(file: string, names: Map<string, { name: string; contact: string }>): Credit[] {
  if (!existsSync(file)) return [];
  const byName = new Map<string, Credit>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [, author, , license] = line.split('\t');
    if (!author) continue;
    const id = author.trim();
    const known = names.get(id);
    const name = known?.name ?? (id.startsWith('<@') ? 'Unknown contributor' : id);
    const c = byName.get(name) ?? { name, contact: known?.contact ?? '', licenses: new Set<string>() };
    if (license) c.licenses.add(license.trim());
    byName.set(name, c);
  }
  return [...byName.values()];
}

// ---------- Import ----------
const names = loadCreditNames();
const creditSections: string[] = [];
let problems = 0;

rmSync(OUT_SPRITES, { recursive: true, force: true });
rmSync(OUT_PORTRAITS, { recursive: true, force: true });

for (const mon of roster) {
  const spriteDir = join(SRC, 'sprite', mon.dex);
  const { shadowSize, anims } = readAnimData(mon.dex);
  const outDir = join(OUT_SPRITES, mon.dex);
  mkdirSync(outDir, { recursive: true });

  const manifest: SpriteManifest = { dex: mon.dex, shadowSize, anims: {}, portraits: [] };
  for (const name of [...REQUIRED_ANIMS, ...OPTIONAL_ANIMS]) {
    const raw = resolveAnim(name, anims);
    if (!raw) {
      if ((REQUIRED_ANIMS as readonly string[]).includes(name)) {
        console.error(`✗ ${mon.name} (${mon.dex}) is missing required anim ${name}`);
        problems++;
      }
      continue;
    }
    const file = `${raw.Name}-Anim.png`;
    if (!existsSync(join(spriteDir, file))) {
      console.error(`✗ ${mon.name}: ${file} not found`);
      problems++;
      continue;
    }
    copyFileSync(join(spriteDir, file), join(outDir, file));
    const shadow = `${raw.Name}-Shadow.png`;
    const hasShadow = existsSync(join(spriteDir, shadow));
    if (hasShadow) copyFileSync(join(spriteDir, shadow), join(outDir, shadow));

    const d = raw.Durations?.Duration ?? [];
    const anim: SpriteAnim = {
      frameWidth: Number(raw.FrameWidth),
      frameHeight: Number(raw.FrameHeight),
      durations: (Array.isArray(d) ? d : [d]).map(Number),
      file,
      ...(hasShadow ? { shadowFile: shadow } : {}),
      ...(raw.RushFrame !== undefined ? { rushFrame: Number(raw.RushFrame) } : {}),
      ...(raw.HitFrame !== undefined ? { hitFrame: Number(raw.HitFrame) } : {}),
      ...(raw.ReturnFrame !== undefined ? { returnFrame: Number(raw.ReturnFrame) } : {}),
    };
    manifest.anims[name] = anim;
  }

  const portraitSrc = join(SRC, 'portrait', mon.dex);
  const portraitOut = join(OUT_PORTRAITS, mon.dex);
  mkdirSync(portraitOut, { recursive: true });
  for (const emo of PORTRAIT_EMOTIONS) {
    const f = join(portraitSrc, `${emo}.png`);
    if (existsSync(f)) {
      copyFileSync(f, join(portraitOut, `${emo}.png`));
      manifest.portraits.push(emo);
    }
  }

  writeFileSync(join(outDir, 'anim.json'), JSON.stringify(manifest, null, 2) + '\n');

  const fmt = (cs: Credit[]) =>
    cs
      .map((c) => `  - ${c.name}${c.contact ? ` (${c.contact})` : ''} [${[...c.licenses].join(', ') || 'n/a'}]`)
      .join('\n') || '  - (none listed)';
  creditSections.push(
    `### ${mon.name} (#${mon.dex})\n` +
      `- Sprites:\n${fmt(readCredits(join(spriteDir, 'credits.txt'), names))}\n` +
      `- Portraits:\n${fmt(readCredits(join(portraitSrc, 'credits.txt'), names))}\n`,
  );
  console.log(`✓ ${mon.name.padEnd(10)} ${Object.keys(manifest.anims).length} anims, ${manifest.portraits.length} portraits`);
}

writeFileSync(
  join(ROOT, 'CREDITS.md'),
  `# Credits

> Generated by \`npm run import-sprites\`. Do not edit by hand.

PokéAthlon is a free, non-commercial fan game. Pokémon and all related names are trademarks of
Nintendo, The Pokémon Company, Game Freak and Creatures Inc. This project is not affiliated with them.

## Sprites & portraits: PMD Sprite Collab

Source: <https://sprites.pmdcollab.org/> · Repository: <https://github.com/PMDCollab/SpriteCollab>
License: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (non-commercial, attribution required).
"CHUNSOFT" entries are original *Pokémon Mystery Dungeon* assets by Spike Chunsoft.
The bracketed tags are the license labels recorded per contribution in SpriteCollab.

${creditSections.join('\n')}`,
);

if (problems > 0) {
  console.error(`\n${problems} problem(s). See above.`);
  process.exit(1);
}
console.log('\nCREDITS.md updated.');
