import * as THREE from 'three';
import { fxData, moveFx, type FxLayer } from '@pokeathlon/data/fx';
import type { SimEvent, Vec2, World } from '@pokeathlon/sim';
import { facingRow } from './pmdSprite';
import { PIXEL, toThreeX, toThreeZ, WORLD_TO_THREE } from './units';

/**
 * Move animations (docs/design/vfx-plan.md): PMD effect sheets (assets/fx/pmd, from PMDCollab
 * RawAsset) played as small pixelated sprites or ground decals, driven by sim events and world
 * state. Client only. Plain sprites: normal blending, no glow or bloom (by design).
 */
const MAX_INSTANCES = 320;
/** Effects are drawn smaller than the sheets' native size (small particles, not big flashes). */
const FX_SCALE = 0.6;

interface SheetDef {
  file?: string;
  kind: string;
  fw?: number;
  fh?: number;
  frames: number;
  rows?: number;
  head?: { file: string; w: number; h: number };
  body?: { file: string; w: number; h: number };
  tail?: { file: string; w: number; h: number };
}
interface Sheet {
  tex: THREE.Texture;
  fw: number;
  fh: number;
  frames: number;
  rows: number;
  kind: string;
  /** Beams: the body strip (frames side by side) and the head. */
  body?: THREE.Texture;
  bodyW?: number;
  bodyH?: number;
}

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `uniform sampler2D map; uniform vec2 rep; uniform vec2 off; uniform vec3 tint; uniform float alpha; uniform float flipX;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(flipX > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  vec4 c = texture2D(map, uv * rep + off);
  c.rgb *= tint; c.a *= alpha;
  if (c.a < 0.02) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}`;

function material(tex: THREE.Texture, layer: FxLayer): THREE.ShaderMaterial {
  const tint = new THREE.Color(layer.tint ?? '#ffffff');
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      rep: { value: new THREE.Vector2(1, 1) },
      off: { value: new THREE.Vector2(0, 0) },
      tint: { value: new THREE.Vector3(tint.r, tint.g, tint.b) },
      alpha: { value: layer.alpha },
      flipX: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
}

/** Where an effect sits and how it is oriented. */
export interface FxAt {
  pos: Vec2;
  /** Direction (world, +y up the screen) for `rotate` layers. */
  dir?: Vec2 | undefined;
  /** World radius for `fit` layers. */
  radius?: number | undefined;
  /** For `follow` layers: the current position (null = the thing is gone). */
  follow?: (() => Vec2 | null) | undefined;
  /** Beams: where the beam starts. */
  origin?: Vec2 | undefined;
}

interface Inst {
  obj: THREE.Object3D;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  extra?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
  sheet: Sheet;
  layer: FxLayer;
  at: FxAt;
  age: number;
  /** Seconds it lives; Infinity while attached. */
  life: number;
  persistent: boolean;
  offset: Vec2;
  w: number;
  h: number;
  dead: boolean;
}

interface Attachment {
  insts: Inst[];
  emitAt: number[];
  seen: boolean;
  at: FxAt;
  layers: FxLayer[];
  end: FxLayer[];
}

const geo = new THREE.PlaneGeometry(1, 1);
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();

export class FxDirector {
  readonly object = new THREE.Group();
  private sheets = new Map<string, Sheet>();
  private insts: Inst[] = [];
  private attached = new Map<string, Attachment>();
  /** Last grab move per player (the held ball's body). */
  private grabMove = new Map<number, string>();
  private ready = false;

  constructor(private readonly camera: THREE.Camera) {}

  async load(base = 'fx/pmd/'): Promise<void> {
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok) return;
    const manifest = (await res.json()) as Record<string, SheetDef>;
    const loader = new THREE.TextureLoader();
    const tex = async (file: string) => {
      const t = await loader.loadAsync(base + file);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    await Promise.all(
      Object.entries(manifest).map(async ([name, d]) => {
        try {
          if (d.kind === 'beam') {
            const [head, body] = await Promise.all([tex(d.head!.file), tex(d.body!.file)]);
            const fw = d.head!.w / d.frames;
            this.sheets.set(name, { tex: head, fw, fh: d.head!.h, frames: d.frames, rows: 1, kind: 'beam', body, bodyW: d.body!.w / d.frames, bodyH: d.body!.h });
          } else {
            this.sheets.set(name, { tex: await tex(d.file!), fw: d.fw!, fh: d.fh!, frames: d.frames, rows: d.rows ?? 1, kind: d.kind });
          }
        } catch {
          /* a missing sheet just doesn't draw */
        }
      }),
    );
    for (const [name, draw] of Object.entries(PROCEDURAL)) {
      const t = new THREE.CanvasTexture(draw());
      t.colorSpace = THREE.SRGBColorSpace;
      this.sheets.set(name, { tex: t, fw: 64, fh: 64, frames: 1, rows: 1, kind: 'None' });
    }
    this.ready = true;
  }

  /** Clear everything (new match). */
  reset(): void {
    for (const i of this.insts) this.object.remove(i.obj);
    this.insts = [];
    this.attached.clear();
    this.grabMove.clear();
  }

  // ---------------------------------------------------------------- spawning

  play(layers: readonly FxLayer[] | undefined, at: FxAt, persistent = false): Inst[] {
    if (!this.ready || !layers) return [];
    const out: Inst[] = [];
    for (const layer of layers) {
      if (persistent && layer.emit) continue; // emitters spawn one-shots from update()
      for (let k = 0; k < layer.count; k++) {
        const inst = this.spawn(layer, at, persistent);
        if (inst) out.push(inst);
      }
    }
    return out;
  }

  private spawn(layer: FxLayer, at: FxAt, persistent: boolean): Inst | null {
    const sheet = this.sheets.get(layer.sprite);
    if (!sheet) return null;
    if (this.insts.length >= MAX_INSTANCES) {
      const old = this.insts.findIndex((i) => !i.persistent);
      if (old < 0) return null;
      this.kill(this.insts[old]!);
      this.insts.splice(old, 1);
    }
    const mat = material(sheet.tex, layer);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = layer.plane === 'ground' ? 1 : 3;
    const obj = new THREE.Group();
    obj.add(mesh);
    let extra: Inst['extra'];
    if (sheet.kind === 'beam' && sheet.body) {
      extra = new THREE.Mesh(geo, material(sheet.body, layer));
      extra.renderOrder = mesh.renderOrder;
      obj.add(extra);
    }
    // Size: `fit` stretches to the move's radius, else the sheet's pixels at the sprites' pixel size.
    const px = PIXEL * layer.scale * FX_SCALE;
    let w = sheet.fw * px;
    let h = sheet.fh * px;
    if (layer.fit && at.radius) {
      const s = (2 * at.radius * WORLD_TO_THREE * layer.fit) / sheet.fw;
      w = sheet.fw * s;
      h = sheet.fh * s;
    }
    const ang = Math.random() * Math.PI * 2;
    const r = layer.spread * Math.sqrt(Math.random()) * (layer.spread === 1 && at.radius ? at.radius : 1);
    const frames = sheet.frames * layer.ticks;
    const animLife = frames / 60;
    const life = persistent ? Infinity : layer.life ?? (layer.loop ? animLife * 2 : animLife);
    const inst: Inst = {
      obj,
      mesh,
      extra,
      sheet,
      layer,
      at: layer.follow || persistent ? at : { ...at, pos: { ...at.pos }, follow: undefined },
      age: -layer.delay,
      life,
      persistent,
      offset: { x: Math.cos(ang) * r, y: Math.sin(ang) * r },
      w,
      h,
      dead: false,
    };
    obj.visible = false;
    this.object.add(obj);
    this.insts.push(inst);
    return inst;
  }

  private kill(i: Inst): void {
    i.dead = true;
    this.object.remove(i.obj);
    i.mesh.material.dispose();
    i.extra?.material.dispose();
  }

  // ---------------------------------------------------------------- events

  onEvent(e: SimEvent, world: World): void {
    if (!this.ready) return;
    const S = fxData.shared;
    const player = (id: number) => world.players[id];
    const follow = (id: number) => () => {
      const p = player(id);
      return p && p.koTicks === 0 ? p.pos : null;
    };
    const key = (playerId: number, moveId: string) => (moveId === 'passive' ? `passive:${player(playerId)?.pokemonId}` : moveId);
    switch (e.type) {
      case 'cast': {
        const p = player(e.playerId);
        if (p) this.play(moveFx(key(e.playerId, e.moveId))?.cast, { pos: p.pos, dir: p.facing, follow: follow(e.playerId) });
        break;
      }
      case 'passive': {
        const p = player(e.playerId);
        if (p) this.play(moveFx(key(e.playerId, 'passive'))?.cast, { pos: p.pos, dir: p.facing, follow: follow(e.playerId) });
        break;
      }
      case 'area':
        this.play(moveFx(key(e.playerId, e.moveId))?.area, { pos: e.pos, dir: e.dir, radius: e.shape === 'line' ? e.length / 2 : e.radius });
        break;
      case 'hit': {
        if (e.source === 'strike') break;
        const fx = moveFx(key(e.attacker, e.source));
        this.play(fx?.hit.length ? fx.hit : S.hit, { pos: e.pos, dir: { x: e.pos.x - (player(e.attacker)?.pos.x ?? 0), y: e.pos.y - (player(e.attacker)?.pos.y ?? 0) } });
        break;
      }
      case 'ballHit':
        if (e.source === 'strike' || !moveFx(e.source)?.hit.length) this.play(e.boosted ? S.ballHitBoosted : S.ballHit, { pos: e.pos });
        else this.play(moveFx(e.source)!.hit, { pos: e.pos });
        break;
      case 'ring':
      case 'guardian':
        this.play(moveFx(key(e.playerId, e.moveId))?.area, { pos: e.pos, radius: e.radius });
        break;
      case 'blink':
        this.play(moveFx(key(e.playerId, e.moveId))?.arrive, { pos: e.to, follow: follow(e.playerId) });
        break;
      case 'grab':
        if (e.caught) this.grabMove.set(e.playerId, e.moveId);
        break;
      case 'ko':
        this.play(S.ko, { pos: e.pos });
        break;
      case 'respawn':
        this.play(S.respawn, { pos: e.pos, follow: follow(e.playerId) });
        break;
      case 'evade': {
        const p = player(e.playerId);
        if (p) this.play(S.evade, { pos: p.pos });
        break;
      }
      case 'burst':
        this.play(S.burst, { pos: e.pos });
        break;
      case 'levelUp': {
        const p = player(e.playerId);
        if (p) this.play(S.levelUp, { pos: p.pos, follow: follow(e.playerId) });
        break;
      }
      case 'orb':
        this.play(S.orb, { pos: e.pos });
        break;
      case 'barrierBreak':
        this.play(S.barrierBreak, { pos: e.pos });
        break;
      case 'goal':
        this.play(S.goal, { pos: e.pos });
        break;
      case 'rescue':
        this.play(S.rescue, { pos: e.to, follow: follow(e.playerId) });
        break;
      case 'banish': {
        const p = player(e.playerId);
        if (p) this.play(S.banish, { pos: p.pos });
        break;
      }
      case 'ballStun':
        this.play(S.ballStun, { pos: e.pos, follow: () => (world.ball.scored ? null : world.ball.pos) });
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- attachments

  /** Keep a body attached while the thing exists; `end` plays where it disappears. */
  private attach(id: string, layers: FxLayer[] | undefined, end: FxLayer[] | undefined, at: FxAt): void {
    if (!layers?.length && !end?.length) return;
    let a = this.attached.get(id);
    if (!a) {
      a = { insts: this.play(layers ?? [], at, true), emitAt: (layers ?? []).map(() => 0), seen: true, at, layers: layers ?? [], end: end ?? [] };
      this.attached.set(id, a);
    }
    a.seen = true;
    // Live values (position, direction, radius) for the attached instances.
    a.at.pos = at.pos;
    a.at.dir = at.dir;
    a.at.radius = at.radius;
    a.at.origin = at.origin ?? a.at.origin;
  }

  private syncAttachments(dt: number, world: World): void {
    for (const a of this.attached.values()) a.seen = false;
    const fx = (id: string) => moveFx(id);

    for (const pr of world.projectiles) {
      const f = fx(pr.moveId === 'passive' ? `passive:${world.players[pr.owner]?.pokemonId}` : pr.moveId);
      const origin = { x: pr.pos.x - pr.dir.x * pr.traveled, y: pr.pos.y - pr.dir.y * pr.traveled };
      this.attach(`p:${pr.id}`, f?.body, f?.end, { pos: { ...pr.pos }, dir: pr.dir, radius: pr.radius, origin });
    }
    for (const p of world.players) {
      if (p.koTicks > 0 || p.banishTicks > 0) continue;
      if (p.dash) {
        const f = fx(p.dash.moveId);
        const len = Math.hypot(p.dash.vel.x, p.dash.vel.y) || 1;
        this.attach(`d:${p.id}:${p.dash.moveId}`, f?.body, f?.end, { pos: { ...p.pos }, dir: { x: p.dash.vel.x / len, y: p.dash.vel.y / len }, radius: p.radius });
      }
      if (p.channel) {
        const f = fx(p.channel.moveId);
        this.attach(`c:${p.id}:${p.channel.moveId}`, f?.body, f?.end, { pos: { ...p.pos }, dir: p.channel.dir, radius: p.radius });
      }
      for (const b of p.buffs) {
        const f = fx(b.moveId);
        if (f) this.attach(`b:${p.id}:${b.moveId}`, f.body, f.end, { pos: { ...p.pos }, dir: p.facing, radius: p.radius });
      }
      // Status overlays.
      const st = fxData.status;
      const at = { pos: { ...p.pos }, radius: p.radius };
      if (p.stunTicks > 0) this.attach(`s:${p.id}:stun`, st.stun, undefined, at);
      if (p.slowFrac > 0) this.attach(`s:${p.id}:slow`, st.slow, undefined, at);
      if (p.staggered) this.attach(`s:${p.id}:staggered`, st.staggered, undefined, at);
      const own = new Set(p.buffs.map((b) => b.moveId));
      if (p.buffs.some((b) => b.speedPct > 0 && !fx(b.moveId)?.body.length) && !own.has('agility')) this.attach(`s:${p.id}:speed`, st.speed, undefined, at);
      if (p.buffs.some((b) => (b.sizePct > 0 || b.powerAdd > 0) && !fx(b.moveId)?.body.length)) this.attach(`s:${p.id}:power`, st.power, undefined, at);
    }
    for (const r of world.rings) {
      const f = fx(r.moveId);
      if (r.latchedAt >= 0) this.attach(`r:${r.id}`, f?.body, f?.end, { pos: r.pos, radius: r.radius });
    }
    for (const g of world.guardians) {
      const f = fx(g.moveId);
      this.attach(`g:${g.id}`, f?.body, f?.end, { pos: g.pos, radius: g.radius });
    }
    for (const c of world.creations) {
      const f = fx(c.moveId);
      const mid = { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 };
      const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) || 1;
      this.attach(`w:${c.id}`, f?.body, f?.end, { pos: mid, dir: { x: (c.b.x - c.a.x) / len, y: (c.b.y - c.a.y) / len }, radius: len / 2 });
    }
    const ball = world.ball;
    if (ball.heldBy >= 0) {
      const f = fx(this.grabMove.get(ball.heldBy) ?? '');
      this.attach(`h:${ball.heldBy}`, f?.body, f?.end, { pos: { ...ball.pos }, radius: ball.radius });
    }

    for (const [id, a] of this.attached) {
      if (!a.seen) {
        for (const i of a.insts) if (!i.dead) this.kill(i);
        this.play(a.end, { pos: { ...a.at.pos }, dir: a.at.dir, radius: a.at.radius });
        this.attached.delete(id);
        continue;
      }
      // Emitters (trails): drop a one-shot copy every `emit` seconds.
      a.layers.forEach((l, k) => {
        if (!l.emit) return;
        a.emitAt[k]! -= dt;
        if (a.emitAt[k]! <= 0) {
          a.emitAt[k] = l.emit;
          this.spawn({ ...l, emit: undefined }, { pos: { ...a.at.pos }, dir: a.at.dir, radius: a.at.radius }, false);
        }
      });
    }
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, world: World): void {
    if (!this.ready) return;
    this.syncAttachments(dt, world);
    let w = 0;
    for (const i of this.insts) {
      if (i.dead) continue;
      i.age += dt;
      if (i.age < 0) continue;
      const followed = i.at.follow ? i.at.follow() : i.at.pos;
      if ((!i.persistent && i.age >= i.life) || !followed) {
        this.kill(i);
        continue;
      }
      this.draw(i, followed);
      this.insts[w++] = i;
    }
    this.insts.length = w;
  }

  private draw(i: Inst, pos: Vec2): void {
    const { layer, sheet, mesh, obj } = i;
    obj.visible = true;
    const u = mesh.material.uniforms;
    // Frame.
    const tick = (i.age * 60) / layer.ticks;
    let frame = Math.floor(tick);
    frame = layer.loop || i.persistent ? frame % sheet.frames : Math.min(sheet.frames - 1, frame);
    // Direction row (Dir8 / Dir5 / Dir2 sheets).
    const dir = i.at.dir ?? { x: 0, y: -1 };
    let row = 0;
    let flip = 0;
    if (sheet.rows > 1) {
      const r8 = facingRow(dir.x, dir.y);
      if (sheet.rows === 8) row = r8;
      else if (sheet.rows === 5) {
        row = r8 > 4 ? 8 - r8 : r8;
        flip = r8 > 4 ? 1 : 0;
      } else row = r8 % 2;
    } else if (sheet.kind === 'Flip' && dir.x < 0) flip = 1;
    u.flipX!.value = flip;
    const cols = sheet.frames;
    u.rep!.value.set(1 / cols, 1 / sheet.rows);
    u.off!.value.set(frame / cols, 1 - (row + 1) / sheet.rows);
    // Fade: one-frame decals and anything with a set life fade over their last 40 %.
    const fade = Number.isFinite(i.life) && (sheet.frames === 1 || layer.life) ? Math.min(1, (i.life - i.age) / (i.life * 0.4)) : 1;
    u.alpha!.value = layer.alpha * Math.max(0, fade);

    const x = toThreeX(pos.x + i.offset.x);
    const z = toThreeZ(pos.y + i.offset.y);
    const radius = i.at.radius;
    let w = i.w;
    let h = i.h;
    if (layer.fit && radius) {
      const s = (2 * radius * WORLD_TO_THREE * layer.fit) / sheet.fw;
      w = sheet.fw * s;
      h = sheet.fh * s;
    }
    const angle = Math.atan2(dir.y, dir.x); // world angle, +y up the screen

    // Beams.
    if (sheet.kind === 'beam' && i.extra) {
      const eu = i.extra.material.uniforms;
      const bf = frame % sheet.frames;
      eu.rep!.value.set(1 / sheet.frames, 1);
      eu.off!.value.set(bf / sheet.frames, 0);
      eu.alpha!.value = u.alpha!.value;
      if (layer.plane === 'ground' && i.at.origin) {
        // Beam along the ground from the origin to here: the body strip stretched, the head at the tip.
        const o = i.at.origin;
        const len = Math.hypot(pos.x - o.x, pos.y - o.y) * WORLD_TO_THREE;
        const bw = (sheet.bodyW ?? 32) * PIXEL * layer.scale;
        obj.position.set(toThreeX((o.x + pos.x) / 2), 0.05, toThreeZ((o.y + pos.y) / 2));
        obj.rotation.set(-Math.PI / 2, 0, angle - Math.PI / 2);
        i.extra.scale.set(bw, Math.max(0.01, len), 1);
        i.extra.position.set(0, 0, 0);
        mesh.visible = false;
      } else {
        // Lightning: a tall bolt standing on the spot, its head flashing on the ground.
        const bw = (sheet.bodyW ?? 32) * PIXEL * layer.scale;
        const bh = (sheet.bodyH ?? 128) * PIXEL * layer.scale * 2.5;
        obj.position.set(x, 0, z);
        obj.quaternion.copy(this.cameraYaw());
        i.extra.scale.set(bw, bh, 1);
        i.extra.position.set(0, bh / 2, 0);
        mesh.scale.set(w, h, 1);
        mesh.position.set(0, h / 2, 0.01);
      }
      return;
    }

    if (layer.plane === 'ground') {
      obj.position.set(x, 0.03 + (mesh.renderOrder === 1 ? 0 : 0.01), z);
      obj.rotation.set(-Math.PI / 2, 0, layer.rotate ? angle : 0);
      mesh.scale.set(w, h, 1);
      mesh.position.set(0, 0, 0);
    } else {
      obj.position.set(x, layer.y * PIXEL + h / 2, z);
      obj.quaternion.copy(this.camera.quaternion);
      if (layer.rotate && sheet.rows === 1) obj.rotateZ(this.screenAngle(pos, dir) + (sheet.kind === 'Dir1' ? Math.PI / 2 : 0));
      mesh.scale.set(w, h, 1);
      mesh.position.set(0, 0, 0);
    }
  }

  /** Camera rotation about the vertical axis only (bolts stand upright). */
  private cameraYaw(): THREE.Quaternion {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    return tmpQ.setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
  }

  /** On-screen angle of a world direction at `pos` (for rotated billboards). */
  private screenAngle(pos: Vec2, dir: Vec2): number {
    tmpV.set(toThreeX(pos.x), 0.3, toThreeZ(pos.y)).project(this.camera);
    tmpW.set(toThreeX(pos.x + dir.x * 100), 0.3, toThreeZ(pos.y + dir.y * 100)).project(this.camera);
    return Math.atan2(tmpW.y - tmpV.y, tmpW.x - tmpV.x);
  }
}

/** Effects drawn in code (64 × 64, one frame). */
const PROCEDURAL: Record<string, () => HTMLCanvasElement> = {
  '@crater': () =>
    canvasOf((g) => {
      const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
      grad.addColorStop(0, 'rgba(40,28,18,0.85)');
      grad.addColorStop(0.6, 'rgba(70,50,30,0.55)');
      grad.addColorStop(1, 'rgba(70,50,30,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(30,20,12,0.9)';
      g.lineWidth = 2;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.4;
        g.beginPath();
        g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
        g.lineTo(32 + Math.cos(a + 0.2) * 18, 32 + Math.sin(a + 0.2) * 18);
        g.lineTo(32 + Math.cos(a - 0.1) * 29, 32 + Math.sin(a - 0.1) * 29);
        g.stroke();
      }
    }),
  '@scorch': () =>
    canvasOf((g) => {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      grad.addColorStop(0, 'rgba(20,14,10,0.8)');
      grad.addColorStop(0.5, 'rgba(45,30,20,0.5)');
      grad.addColorStop(1, 'rgba(45,30,20,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
};

function canvasOf(draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d')!);
  return c;
}
