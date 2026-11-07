import * as THREE from 'three';
import type { MoveDef } from '@pokeathlon/data';
import type { Player, SimEvent, Vec2, World } from '@pokeathlon/sim';
import { toThreeX, toThreeZ, WORLD_TO_THREE } from './units';

/**
 * Move shapes on the ground, in the Pokémon's colour:
 * - **aim preview**: while you hold a move key (hold-to-aim), where it will go;
 * - **cast aura**: when anyone casts, the same shape stays on the ground through the wind-up and a
 *   moment after, so moves are readable beyond their animation.
 * Shapes come from the move's actions (lines for projectiles and dashes, cones, circles…), so new
 * moves get one for free.
 */

/** Pokémon type colours (the main type colours the Pokémon its moves). */
const TYPE_COLOR: Record<string, string> = {
  normal: '#c6c6a7', fire: '#f5ac78', water: '#9db7f5', grass: '#a7db8d', electric: '#fae078', ice: '#bce6e6',
  fighting: '#d67873', poison: '#c183c1', ground: '#ebd69d', flying: '#c6b7f5', psychic: '#fa92b2', bug: '#c6d16e',
  rock: '#d1c17d', ghost: '#a292bc', dragon: '#a27dfa', dark: '#a29288', steel: '#d1d1e0', fairy: '#f4bdc9',
};
export const pokemonColor = (types: readonly string[]): string => TYPE_COLOR[types[0] ?? ''] ?? '#ffffff';

type Prim =
  | { kind: 'line'; from: number; length: number; width: number }
  | { kind: 'cone'; from: number; radius: number; angleDeg: number }
  | { kind: 'circle'; at: 'self' | 'target'; offset: number; radius: number };

/** The ground shapes of a move, relative to the caster and its aim (world units). */
export function moveShapes(def: MoveDef, body: number): Prim[] {
  const out: Prim[] = [];
  let ahead = 0; // dashes and blinks move the caster forward: later self-centred actions follow
  const add = (a: MoveDef['actions'][number]) => {
    switch (a.type) {
      case 'projectile':
        if (a.count > 1 && a.spreadDeg > 0) out.push({ kind: 'cone', from: ahead, radius: a.range, angleDeg: a.spreadDeg + 8 });
        else out.push({ kind: 'line', from: ahead, length: a.range, width: Math.max(40, a.radius * 2) });
        for (const e of a.onEnd ?? []) if (e.type === 'area') out.push({ kind: 'circle', at: 'self', offset: ahead + a.range, radius: e.radius });
        break;
      case 'area':
        if (a.shape === 'cone') out.push({ kind: 'cone', from: ahead + a.offset, radius: a.radius, angleDeg: a.angleDeg });
        else if (a.shape === 'line') out.push({ kind: 'line', from: ahead + a.offset, length: a.length, width: a.width });
        else out.push({ kind: 'circle', at: a.at, offset: a.at === 'self' ? ahead + a.offset : 0, radius: a.radius });
        break;
      case 'dash':
        out.push({ kind: 'line', from: ahead, length: a.distance, width: body * 2 });
        ahead += a.distance;
        break;
      case 'blink':
        if (a.to === 'aim') {
          out.push({ kind: 'line', from: ahead, length: a.distance, width: 36 });
          out.push({ kind: 'circle', at: 'self', offset: ahead + a.distance, radius: body });
          ahead += a.distance;
        }
        break;
      case 'channel':
        if (a.shape === 'cone') out.push({ kind: 'cone', from: ahead, radius: a.radius, angleDeg: a.angleDeg });
        else out.push({ kind: 'line', from: ahead, length: a.length, width: a.width });
        break;
      case 'ring':
      case 'guardian':
      case 'grab':
        out.push({ kind: 'circle', at: a.type === 'guardian' ? a.at : 'self', offset: ahead, radius: a.radius });
        break;
      case 'wall':
        out.push({ kind: 'cone', from: Math.max(0, a.distance - a.thickness), radius: a.distance + a.thickness, angleDeg: Math.max(12, a.spreadDeg + (a.length / a.distance) * 57) });
        break;
      case 'buff':
        out.push({ kind: 'circle', at: 'self', offset: ahead, radius: a.target === 'allies' && a.radius > 0 ? a.radius : body * 1.6 });
        break;
      default:
        break;
    }
  };
  def.actions.forEach(add);
  return out;
}

function primMesh(p: Prim, color: THREE.Color, fill: number, edge: number): THREE.Group {
  const g = new THREE.Group();
  const W = WORLD_TO_THREE;
  const mat = (o: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
  let geo: THREE.BufferGeometry;
  let outline: THREE.BufferGeometry;
  if (p.kind === 'line') {
    geo = new THREE.PlaneGeometry(p.length * W, p.width * W);
    geo.translate(((p.from + p.length / 2) * W), 0, 0);
    const w = p.width * W;
    const l = p.length * W;
    const x0 = p.from * W;
    outline = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x0, -w / 2, 0),
      new THREE.Vector3(x0 + l, -w / 2, 0),
      new THREE.Vector3(x0 + l, w / 2, 0),
      new THREE.Vector3(x0, w / 2, 0),
      new THREE.Vector3(x0, -w / 2, 0),
    ]);
  } else if (p.kind === 'cone') {
    const a = (p.angleDeg * Math.PI) / 180;
    geo = new THREE.RingGeometry(p.from * W, p.radius * W, 40, 1, -a / 2, a);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = -a / 2 + (a * i) / 24;
      pts.push(new THREE.Vector3(Math.cos(t) * p.radius * W, Math.sin(t) * p.radius * W, 0));
    }
    pts.unshift(new THREE.Vector3(Math.cos(-a / 2) * p.from * W, Math.sin(-a / 2) * p.from * W, 0));
    pts.push(new THREE.Vector3(Math.cos(a / 2) * p.from * W, Math.sin(a / 2) * p.from * W, 0));
    outline = new THREE.BufferGeometry().setFromPoints(pts);
  } else {
    geo = new THREE.CircleGeometry(p.radius * W, 40);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) pts.push(new THREE.Vector3(Math.cos((i / 40) * Math.PI * 2) * p.radius * W, Math.sin((i / 40) * Math.PI * 2) * p.radius * W, 0));
    outline = new THREE.BufferGeometry().setFromPoints(pts);
  }
  const fillMesh = new THREE.Mesh(geo, mat(fill));
  const line = new THREE.Line(outline, new THREE.LineBasicMaterial({ color, transparent: true, opacity: edge, depthWrite: false }));
  g.add(fillMesh, line);
  g.rotation.x = -Math.PI / 2;
  g.userData.prim = p;
  return g;
}

interface Aura {
  group: THREE.Group;
  age: number;
  life: number;
}

export class AimPreview {
  readonly object = new THREE.Group();
  private preview: { key: string; group: THREE.Group } | null = null;
  private auras: Aura[] = [];

  /** Place a shape set at a caster position, aimed along `dir`; target circles at `target`. */
  private build(def: MoveDef, p: Player, color: string, fill: number, edge: number): THREE.Group {
    const g = new THREE.Group();
    const c = new THREE.Color(color);
    for (const prim of moveShapes(def, p.radius)) g.add(primMesh(prim, c, fill, edge));
    return g;
  }

  private place(g: THREE.Group, pos: Vec2, dir: Vec2, target: Vec2 | null): void {
    g.position.set(toThreeX(pos.x), 0.035, toThreeZ(pos.y));
    // Ground plane: world +y maps to three −z, so the heading angle flips sign.
    const angle = Math.atan2(dir.y, dir.x);
    for (const child of g.children) {
      const prim = child.userData.prim as Prim | undefined;
      if (prim?.kind === 'circle' && prim.at === 'target' && target) {
        child.position.set(toThreeX(target.x) - g.position.x, 0, toThreeZ(target.y) - g.position.z);
        child.rotation.set(-Math.PI / 2, 0, 0);
      } else if (prim?.kind === 'circle') {
        child.position.set(Math.cos(angle) * prim.offset * WORLD_TO_THREE, 0, -Math.sin(angle) * prim.offset * WORLD_TO_THREE);
        child.rotation.set(-Math.PI / 2, 0, 0);
      } else {
        child.position.set(0, 0, 0);
        child.rotation.set(-Math.PI / 2, 0, angle);
      }
    }
  }

  /**
   * Your aim preview while a move key is held (`slot` −1 = none). `aimPoint` = where the stick or
   * mouse points (world), used by target-point moves (clamped to the move's range).
   */
  updatePreview(p: Player | undefined, slot: number, aimDir: Vec2, aimPoint: Vec2 | null, color: string): void {
    const def = p && slot >= 0 && p.koTicks === 0 ? p.moves[slot]?.def : undefined;
    const ready = def && p!.moves[slot]!.cooldown === 0;
    const key = def ? `${p!.id}:${def.id}:${ready ? 1 : 0}` : '';
    if (!def) {
      if (this.preview) this.object.remove(this.preview.group);
      this.preview = null;
      return;
    }
    if (this.preview?.key !== key) {
      if (this.preview) this.object.remove(this.preview.group);
      // On cooldown: a dim grey preview, so you still see the shape but know it won't fire.
      const g = this.build(def, p!, ready ? color : '#8a8a99', ready ? 0.16 : 0.06, ready ? 0.85 : 0.35);
      this.object.add(g);
      this.preview = { key, group: g };
    }
    const target = aimPoint && def.range > 0 ? clampTo(p!.pos, aimPoint, def.range) : aimPoint;
    this.place(this.preview.group, p!.pos, aimDir, target);
  }

  /** Cast aura: on any cast, the move's shape stays through its wind-up and fades out. */
  onEvent(e: SimEvent, world: World, colorOf: (p: Player) => string): void {
    if (e.type !== 'cast') return;
    const p = world.players[e.playerId];
    const def = p?.moves.find((m) => m.def.id === e.moveId)?.def;
    if (!p || !def) return;
    const g = this.build(def, p, colorOf(p), 0.12, 0.7);
    const pending = world.pending.find((pa) => pa.owner === p.id && pa.moveId === e.moveId);
    this.place(g, p.pos, p.facing, pending ? pending.target : null);
    this.object.add(g);
    this.auras.push({ group: g, age: 0, life: def.castTime + 0.45 });
  }

  update(dt: number): void {
    this.auras = this.auras.filter((a) => {
      a.age += dt;
      const fade = Math.max(0, 1 - Math.max(0, a.age - (a.life - 0.3)) / 0.3);
      a.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material & { opacity: number; userData: { base?: number } };
        if (!m || m.opacity === undefined) return;
        m.userData.base ??= m.opacity;
        m.opacity = m.userData.base * fade;
      });
      if (a.age >= a.life) {
        this.object.remove(a.group);
        return false;
      }
      return true;
    });
  }

  reset(): void {
    for (const a of this.auras) this.object.remove(a.group);
    this.auras = [];
    if (this.preview) this.object.remove(this.preview.group);
    this.preview = null;
  }
}

function clampTo(from: Vec2, to: Vec2, max: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d <= max || d === 0) return to;
  return { x: from.x + (dx / d) * max, y: from.y + (dy / d) * max };
}
