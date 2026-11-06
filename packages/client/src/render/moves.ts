import * as THREE from 'three';
import type { SimEvent, World } from '@pokeathlon/sim';
import { toThreeX, toThreeZ, WORLD_TO_THREE } from './units';

const W = WORLD_TO_THREE;

interface Flash {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
  /** Telegraphs fade in (warning) instead of out. */
  rising?: boolean;
}

/** Ground shape of an area / telegraph. */
function shapeGeometry(e: { shape: 'circle' | 'cone' | 'line'; dir: { x: number; y: number }; radius: number; angleDeg: number; length: number; width: number }): THREE.BufferGeometry {
  const angle = Math.atan2(e.dir.y, e.dir.x);
  if (e.shape === 'circle') return new THREE.CircleGeometry(Math.max(1, e.radius) * W, 48);
  if (e.shape === 'cone') {
    const half = ((e.angleDeg / 2) * Math.PI) / 180;
    return new THREE.CircleGeometry(e.radius * W, 32, angle - half, half * 2);
  }
  const geo = new THREE.PlaneGeometry(Math.max(1, e.length) * W, Math.max(1, e.width) * W);
  geo.translate((e.length * W) / 2, 0, 0);
  geo.rotateZ(angle);
  return geo;
}

/** Visuals for M3 moves: projectiles, area flashes, creation walls and buff auras. */
export class MoveViews {
  readonly object = new THREE.Group();
  private readonly projectiles = new Map<number, THREE.Group>();
  private readonly walls = new Map<number, THREE.Mesh>();
  private readonly guardians = new Map<number, THREE.Group>();
  private readonly auras: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private flashes: Flash[] = [];
  private time = 0;

  constructor(world: World) {
    for (let i = 0; i < world.players.length; i++) {
      const aura = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.8, 40),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
      );
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.02;
      this.object.add(aura);
      this.auras.push(aura);
    }
  }

  /** Area moves flash their exact shape on the ground; telegraphs warn before delayed actions; blinks flash both ends. */
  onEvent(e: SimEvent): void {
    if (e.type === 'area') this.flash(shapeGeometry(e), e.color, e.pos, 0.35, false);
    else if (e.type === 'telegraph') this.flash(shapeGeometry(e), e.color, e.pos, Math.max(0.1, e.time), true);
    else if (e.type === 'blink') {
      const ring = { shape: 'circle' as const, dir: { x: 1, y: 0 }, radius: 70, angleDeg: 0, length: 0, width: 0 };
      this.flash(shapeGeometry(ring), '#d9c2ff', e.from, 0.3, false);
      this.flash(shapeGeometry(ring), '#d9c2ff', e.to, 0.3, false);
    }
  }

  private flash(geo: THREE.BufferGeometry, color: string, pos: { x: number; y: number }, life: number, rising: boolean): void {
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: rising ? 0.1 : 0.55, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(toThreeX(pos.x), rising ? 0.025 : 0.03, toThreeZ(pos.y));
    this.object.add(mesh);
    this.flashes.push({ mesh, age: 0, life, rising });
  }

  update(dt: number, world: World): void {
    this.time += dt;

    // Projectiles.
    const live = new Set<number>();
    for (const pr of world.projectiles) {
      live.add(pr.id);
      let g = this.projectiles.get(pr.id);
      if (!g) {
        g = new THREE.Group();
        const color = new THREE.Color(pr.color);
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(pr.radius * W, 16, 10),
          new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.4) }),
        );
        const glow = new THREE.Mesh(
          new THREE.SphereGeometry(pr.radius * W * 1.7, 16, 10),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
        );
        g.add(core, glow);
        this.projectiles.set(pr.id, g);
        this.object.add(g);
      }
      g.position.set(toThreeX(pr.pos.x), 0.45, toThreeZ(pr.pos.y));
      g.scale.setScalar(1 + Math.sin(this.time * 30 + pr.id) * 0.08);
    }
    for (const [id, g] of this.projectiles) {
      if (!live.has(id)) {
        this.object.remove(g);
        this.projectiles.delete(id);
      }
    }

    // Creation walls.
    const liveW = new Set<number>();
    for (const c of world.creations) {
      liveW.add(c.id);
      let m = this.walls.get(c.id);
      if (!m) {
        const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) * W;
        m = new THREE.Mesh(
          new THREE.BoxGeometry(len + c.r * 2 * W, 0.7, c.r * 2 * W),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(c.color), roughness: 0.8 }),
        );
        m.position.set(toThreeX((c.a.x + c.b.x) / 2), 0.35, toThreeZ((c.a.y + c.b.y) / 2));
        m.rotation.y = -Math.atan2(toThreeZ(c.b.y) - toThreeZ(c.a.y), toThreeX(c.b.x) - toThreeX(c.a.x));
        this.walls.set(c.id, m);
        this.object.add(m);
      }
      // Sink into the ground over the last 0.3 s.
      m.position.y = 0.35 - Math.max(0, 1 - c.ticks / 18) * 0.7;
    }
    for (const [id, m] of this.walls) {
      if (!liveW.has(id)) {
        this.object.remove(m);
        this.walls.delete(id);
      }
    }

    // Guardian zones: a soft disc with a bright rim that pulses on each heal and fades out at the end.
    const liveG = new Set<number>();
    for (const g of world.guardians) {
      liveG.add(g.id);
      let grp = this.guardians.get(g.id);
      if (!grp) {
        grp = new THREE.Group();
        const color = new THREE.Color(g.color);
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(g.radius * W, 48),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }),
        );
        const rim = new THREE.Mesh(
          new THREE.RingGeometry(g.radius * W * 0.93, g.radius * W, 48),
          new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.5), transparent: true, opacity: 0.8, depthWrite: false }),
        );
        disc.rotation.x = rim.rotation.x = -Math.PI / 2;
        grp.add(disc, rim);
        grp.position.set(toThreeX(g.pos.x), 0.04, toThreeZ(g.pos.y));
        this.guardians.set(g.id, grp);
        this.object.add(grp);
      }
      const fade = Math.min(1, g.ticks / 15);
      const pulse = 1 - g.next / Math.max(1, g.interval);
      (grp.children[0] as THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>).material.opacity = (0.12 + 0.12 * pulse) * fade;
      (grp.children[1] as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.8 * fade;
    }
    for (const [id, grp] of this.guardians) {
      if (!liveG.has(id)) {
        this.object.remove(grp);
        this.guardians.delete(id);
      }
    }

    // Buff auras; a growing orange ring while charging a move.
    world.players.forEach((p, i) => {
      const aura = this.auras[i]!;
      const charge = p.charging ? p.moves[p.charging.slot]?.def.charge : undefined;
      const active = (p.buffs.length > 0 || !!charge || !!p.channel) && p.koTicks === 0 && p.banishTicks === 0;
      aura.material.opacity = active ? 0.55 + Math.sin(this.time * 8) * 0.15 : 0;
      aura.position.set(toThreeX(p.pos.x), 0.02, toThreeZ(p.pos.y));
      const body = p.radius / 46;
      if (charge && p.charging) {
        const f = Math.min(1, p.charging.ticks / (charge.time * 60));
        aura.material.color.set(f >= 1 ? 0xffffff : 0xffa64d);
        aura.scale.setScalar(body * (0.6 + 0.8 * f));
      } else {
        if (p.channel) aura.material.color.set(0x8fd3ff);
        else if (active) aura.material.color.set(0xbfe8ff);
        aura.scale.setScalar(body);
      }
      aura.rotation.z = this.time * 2;
    });

    // Area flashes.
    this.flashes = this.flashes.filter((f) => {
      f.age += dt;
      const t = f.age / f.life;
      f.mesh.material.opacity = f.rising ? 0.1 + 0.35 * t : 0.55 * (1 - t);
      if (t >= 1) {
        this.object.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        return false;
      }
      return true;
    });
  }
}
