import { moveSfx, sfxData, type Snd } from '@pokeathlon/data/sfx';
import type { SimEvent, Vec2, World } from '@pokeathlon/sim';

/**
 * Sound effects (docs/design/sfx-plan.md). Web Audio: each sound is decoded once; every play is a
 * source → gain → stereo pan → channel gain (effects / voices / interface) → master. Nothing plays
 * before the first click or key (browser autoplay rule). Client only; the sim never sounds.
 */
export type Channel = 'sfx' | 'voice' | 'ui';
export interface AudioPrefs {
  master: number;
  sfx: number;
  voice: number;
  ui: number;
  mute: boolean;
}
export const DEFAULT_AUDIO: AudioPrefs = { master: 0.8, sfx: 0.15, voice: 0.6, ui: 0.6, mute: false };

const BASE = 'sfx/';
/** Same sound again within this many seconds is skipped (hit storms). */
const MIN_GAP = 0.05;
const MAX_SAME = 4;
const MAX_TOTAL = 24;
/** One cry per Pokémon every this many seconds. */
const CRY_GAP = 4;

interface Voice {
  name: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
}
interface Loop {
  /** Null for marker loops: no sound, only an `end` sound when the thing disappears. */
  voice: Voice | null;
  seen: boolean;
  end: Snd[];
  at: { pan?: number; vol?: number };
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private duck!: GainNode;
  private channels = {} as Record<Channel, GainNode>;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private ready = new Map<string, AudioBuffer>();
  private lastPlay = new Map<string, number>();
  private playing: Voice[] = [];
  private loops = new Map<string, Loop>();
  private lastCry = new Map<string, number>();
  private prefs: AudioPrefs = { ...DEFAULT_AUDIO };

  /** Create the context on the first user gesture and preload every sound named in the data. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.duck = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.duck.connect(this.master);
    for (const ch of ['sfx', 'voice', 'ui'] as Channel[]) {
      const g = this.ctx.createGain();
      g.connect(ch === 'ui' ? this.master : this.duck);
      this.channels[ch] = g;
    }
    this.apply(this.prefs);
    for (const n of allNames()) void this.load(n);
  }

  /** Volumes from Settings (live). */
  apply(p: AudioPrefs): void {
    this.prefs = { ...p };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(p.mute ? 0 : p.master, t, 0.02);
    this.channels.sfx.gain.setTargetAtTime(p.sfx, t, 0.02);
    this.channels.voice.gain.setTargetAtTime(p.voice, t, 0.02);
    this.channels.ui.gain.setTargetAtTime(p.ui, t, 0.02);
  }

  private load(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      const ctx = this.ctx!;
      p = fetch(`${BASE}${name}.ogg`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(name))))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => {
          this.ready.set(name, buf);
          return buf;
        })
        .catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }

  /**
   * Play sounds. `pan` −1…1 (left…right), `vol` scales them (distance). Returns the voices (for loops).
   */
  play(list: readonly Snd[] | undefined, channel: Channel = 'sfx', o: { pan?: number; vol?: number; loop?: boolean } = {}): Voice[] {
    const ctx = this.ctx;
    if (!ctx || !list?.length || this.prefs.mute) return [];
    const out: Voice[] = [];
    const now = ctx.currentTime;
    for (const snd of list) {
      const buf = this.ready.get(snd.s);
      if (!buf) {
        void this.load(snd.s);
        continue;
      }
      if (!o.loop) {
        if (now - (this.lastPlay.get(snd.s) ?? -1) < MIN_GAP) continue;
        if (this.playing.filter((v) => v.name === snd.s).length >= MAX_SAME) continue;
        if (this.playing.length >= MAX_TOTAL) this.stopVoice(this.playing[0]!);
      }
      this.lastPlay.set(snd.s, now);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = !!o.loop;
      // ±4 % pitch so repeats don't sound robotic.
      src.playbackRate.value = snd.pitch * (o.loop ? 1 : 0.96 + Math.random() * 0.08);
      const gain = ctx.createGain();
      gain.gain.value = snd.vol * (o.vol ?? 1);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
      src.connect(gain).connect(pan).connect(this.channels[channel]);
      const voice: Voice = { name: snd.s, src, gain };
      src.onended = () => {
        this.playing = this.playing.filter((v) => v !== voice);
      };
      src.start();
      if (snd.dur && !o.loop) {
        // Long sounds (applause, wind) are cut: fade over the last 0.4 s.
        gain.gain.setValueAtTime(gain.gain.value, now + Math.max(0, snd.dur - 0.4));
        gain.gain.linearRampToValueAtTime(0, now + snd.dur);
        src.stop(now + snd.dur + 0.05);
      }
      this.playing.push(voice);
      out.push(voice);
    }
    return out;
  }

  private stopVoice(v: Voice, fade = 0.03): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0, t, fade / 3);
    try {
      v.src.stop(t + fade);
    } catch {
      /* already stopped */
    }
    this.playing = this.playing.filter((x) => x !== v);
  }

  /** A Pokémon's cry (throttled per Pokémon). */
  cry(pokemonId: string, o: { pan?: number; vol?: number; force?: boolean } = {}): void {
    const name = sfxData.cries[pokemonId];
    if (!name || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (!o.force && now - (this.lastCry.get(pokemonId) ?? -99) < CRY_GAP) return;
    this.lastCry.set(pokemonId, now);
    this.play([{ s: name, vol: 1, pitch: 1 }], 'voice', o);
  }

  ui(kind: string): void {
    this.play(sfxData.ui[kind], 'ui');
  }

  /** Lower effects and voices for `seconds` (goal moment). */
  duckFor(seconds: number, to = 0.4): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(to, t, 0.05);
    this.duck.gain.setTargetAtTime(1, t + seconds, 0.25);
  }

  // ---------------------------------------------------------------- loops

  beginFrame(): void {
    for (const l of this.loops.values()) l.seen = false;
  }
  keepLoop(id: string, snd: Snd | undefined, end: Snd[], o: { pan?: number; vol?: number }): void {
    if (!this.ctx) return;
    let l = this.loops.get(id);
    if (!l) {
      if (!snd && !end.length) return;
      const voice = snd ? (this.play([snd], 'sfx', { ...o, loop: true })[0] ?? null) : null;
      if (snd && !voice) return; // not decoded yet: try again next frame
      l = { voice, seen: true, end, at: o };
      this.loops.set(id, l);
    }
    l.seen = true;
    l.at = o;
    if (l.voice && snd) l.voice.gain.gain.value = snd.vol * (o.vol ?? 1);
  }
  endFrame(): void {
    for (const [id, l] of this.loops) {
      if (l.seen) continue;
      if (l.voice) this.stopVoice(l.voice, 0.15);
      this.play(l.end, 'sfx', l.at);
      this.loops.delete(id);
    }
  }
  stopAll(): void {
    for (const l of this.loops.values()) if (l.voice) this.stopVoice(l.voice, 0.1);
    this.loops.clear();
  }
}

export const audio = new AudioEngine();

function allNames(): string[] {
  const set = new Set<string>();
  const add = (l: readonly Snd[] | undefined) => l?.forEach((s) => set.add(s.s));
  for (const m of Object.values(sfxData.moves)) {
    add(m.cast);
    add(m.hit);
    add(m.area);
    add(m.arrive);
    add(m.end);
    if (m.loop) set.add(m.loop.s);
  }
  Object.values(sfxData.shared).forEach(add);
  Object.values(sfxData.ui).forEach(add);
  Object.values(sfxData.cries).forEach((c) => set.add(c));
  return [...set];
}

// ---------------------------------------------------------------- match sounds

/** Where a world point is for the ear: stereo pan from the screen, volume from distance to the camera focus. */
export type Locate = (pos: Vec2) => { pan: number; vol: number };

/**
 * Turns sim events and world state into sounds. `me` = your player id (−1 spectating); your own
 * moves always play at full volume.
 */
export class MatchSounds {
  private stunned = new Set<number>();
  private slowed = new Set<number>();
  private grabMove = new Map<number, string>();

  constructor(
    private readonly locate: Locate,
    private me: () => number,
  ) {}

  reset(): void {
    this.stunned.clear();
    this.slowed.clear();
    this.grabMove.clear();
    audio.stopAll();
  }

  onEvent(e: SimEvent, world: World): void {
    const S = sfxData.shared;
    const P = (id: number) => world.players[id];
    const at = (pos: Vec2, owner = -1) => (owner >= 0 && owner === this.me() ? { pan: this.locate(pos).pan, vol: 1 } : this.locate(pos));
    const key = (pid: number, moveId: string) => (moveId === 'passive' ? `passive:${P(pid)?.pokemonId}` : moveId);
    const myTeam = P(this.me())?.team ?? 0;
    switch (e.type) {
      case 'cast': {
        const p = P(e.playerId);
        if (!p) break;
        const s = moveSfx(key(e.playerId, e.moveId));
        audio.play(s?.cast.length ? s.cast : undefined, 'sfx', at(p.pos, p.id));
        if (e.slot === 'special') audio.cry(p.pokemonId, at(p.pos, p.id));
        break;
      }
      case 'passive': {
        const p = P(e.playerId);
        if (p) audio.play(moveSfx(key(e.playerId, 'passive'))?.cast, 'sfx', at(p.pos, p.id));
        break;
      }
      case 'buff':
        if (!moveSfx(e.moveId)?.cast.length) {
          const p = P(e.playerId);
          if (p) audio.play(S.buff, 'sfx', at(p.pos, p.id));
        }
        break;
      case 'area':
        audio.play(moveSfx(key(e.playerId, e.moveId))?.area, 'sfx', at(e.pos, e.playerId));
        break;
      case 'blink':
        audio.play(moveSfx(key(e.playerId, e.moveId))?.arrive, 'sfx', at(e.to, e.playerId));
        break;
      case 'grab':
        if (e.caught) this.grabMove.set(e.playerId, e.moveId);
        break;
      case 'release': {
        const id = this.grabMove.get(e.playerId);
        if (id && e.thrown) audio.play(moveSfx(id)?.end, 'sfx', at(world.ball.pos, e.playerId));
        this.grabMove.delete(e.playerId);
        break;
      }
      case 'hit': {
        if (e.source === 'strike') {
          audio.play(S.hit, 'sfx', at(e.pos, e.attacker));
          break;
        }
        const s = moveSfx(key(e.attacker, e.source));
        audio.play(s?.hit.length ? s.hit : e.light ? S.hitLight : S.hit, 'sfx', at(e.pos, e.attacker));
        break;
      }
      case 'strike': {
        const p = P(e.playerId);
        if (p) audio.play(S.strike, 'sfx', at(p.pos, p.id));
        break;
      }
      case 'ballHit': {
        const own = moveSfx(e.source)?.hit;
        audio.play(e.boosted || e.red ? S.ballHitBoosted : e.source !== 'strike' && own?.length ? own : S.ballHit, 'sfx', at(e.pos, e.playerId));
        break;
      }
      case 'ballWall':
        if (e.impact > 400) audio.play(S.ballWall, 'sfx', { ...this.locate(e.pos), vol: this.locate(e.pos).vol * Math.min(1, e.impact / 1500) });
        break;
      case 'ko': {
        const p = P(e.playerId);
        audio.play(S.ko, 'sfx', this.locate(e.pos));
        if (p) audio.cry(p.pokemonId, { ...this.locate(e.pos), force: true });
        break;
      }
      case 'respawn':
        if (e.playerId === this.me()) audio.play(S.respawn, 'sfx');
        break;
      case 'evade': {
        const p = P(e.playerId);
        if (p) audio.play(S.evade, 'sfx', at(p.pos, p.id));
        break;
      }
      case 'burst':
        audio.play(S.burst, 'sfx', at(e.pos, e.playerId));
        break;
      case 'levelUp':
        if (e.playerId === this.me()) audio.play(S.levelUp, 'sfx');
        break;
      case 'orb':
        audio.play(S.orb, 'sfx', at(e.pos, e.playerId));
        break;
      case 'barrierBreak':
        audio.play(S.barrierBreak, 'sfx', this.locate(e.pos));
        break;
      case 'gateOpen':
        audio.play(S.gateOpen, 'sfx');
        break;
      case 'rescue':
        audio.play(S.rescue, 'sfx', at(e.to, e.by));
        break;
      case 'kickoff':
        audio.play(S.kickoff, 'sfx');
        break;
      case 'play':
        audio.play(S.play, 'sfx');
        break;
      case 'goal':
        audio.duckFor(1.2);
        audio.play(e.team === myTeam ? S.goalUs : S.goalThem, 'sfx');
        break;
      case 'setWon':
        audio.play(S.setWon, 'sfx');
        break;
      case 'matchWon':
        audio.play(this.me() < 0 || e.team === myTeam ? S.matchWon : S.matchLost, 'sfx');
        break;
      default:
        break;
    }
  }

  /** Per frame: loops (channels, charges) and status starts (stun, slow). */
  update(world: World): void {
    audio.beginFrame();
    for (const p of world.players) {
      const o = p.id === this.me() ? { pan: this.locate(p.pos).pan, vol: 1 } : this.locate(p.pos);
      if (p.channel) {
        const s = moveSfx(p.channel.moveId);
        audio.keepLoop(`c:${p.id}`, s?.loop, s?.end ?? [], o);
      }
      if (p.charging) {
        const id = p.moves[p.charging.slot]?.def.id ?? '';
        const s = moveSfx(id);
        audio.keepLoop(`h:${p.id}`, s?.loop, [], o);
      }
      const stun = p.stunTicks > 0 && p.koTicks === 0;
      if (stun && !this.stunned.has(p.id)) audio.play(sfxData.shared.stun, 'sfx', o);
      if (stun) this.stunned.add(p.id);
      else this.stunned.delete(p.id);
      const slow = p.slowFrac > 0 && p.koTicks === 0;
      if (slow && !this.slowed.has(p.id)) audio.play(sfxData.shared.slow, 'sfx', o);
      if (slow) this.slowed.add(p.id);
      else this.slowed.delete(p.id);
    }
    // Lingering things that end with a sound (walls, zones).
    for (const c of world.creations) {
      const s = moveSfx(c.moveId);
      if (s?.end.length) audio.keepLoop(`w:${c.id}`, undefined, s.end, this.locate(c.a));
    }
    for (const g of world.guardians) {
      const s = moveSfx(g.moveId);
      if (s?.end.length) audio.keepLoop(`g:${g.id}`, undefined, s.end, this.locate(g.pos));
    }
    audio.endFrame();
  }
}
