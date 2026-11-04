import * as THREE from 'three';
import type { SimEvent, World } from '@pokeathlon/sim';
import { toThreeX, toThreeZ, WORLD_TO_THREE } from './units';

const W = WORLD_TO_THREE;

interface Flash {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
}

/** Visuals for M3 moves: projectiles, area flashes, creation walls and buff auras. */
export class MoveViews {
  readonly object = new THREE.Group();
  private readonly projectiles = new Map<number, THREE.Group>();
  private readonly walls = new Map<number, THREE.Mesh>();
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

  /** Area moves flash their exact shape on the ground. */
  onEvent(e: SimEvent): void {
    if (e.type !== 'area') return;
    const color = new THREE.Color(e.color);
    let geo: THREE.BufferGeometry;
    const angle = Math.atan2(e.dir.y, e.dir.x);
    if (e.shape === 'circle') geo = new THREE.CircleGeometry(e.radius * W, 48);
    else if (e.shape === 'cone') {
      const half = ((e.angleDeg / 2) * Math.PI) / 180;
      geo = new THREE.CircleGeometry(e.radius * W, 32, angle - half, half * 2);
    } else {
      geo = new THREE.PlaneGeometry(e.length * W, e.width * W);
      geo.translate((e.length * W) / 2, 0, 0);
      geo.rotateZ(angle);
    }
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(toThreeX(e.pos.x), 0.03, toThreeZ(e.pos.y));
    this.object.add(mesh);
    this.flashes.push({ mesh, age: 0, life: 0.35 });
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

    // Buff auras.
    world.players.forEach((p, i) => {
      const aura = this.auras[i]!;
      const active = p.buffs.length > 0 && p.koTicks === 0;
      aura.material.opacity = active ? 0.55 + Math.sin(this.time * 8) * 0.15 : 0;
      aura.position.set(toThreeX(p.pos.x), 0.02, toThreeZ(p.pos.y));
      if (active) aura.material.color.set(0xbfe8ff);
      aura.rotation.z = this.time * 2;
    });

    // Area flashes.
    this.flashes = this.flashes.filter((f) => {
      f.age += dt;
      const t = f.age / f.life;
      f.mesh.material.opacity = 0.55 * (1 - t);
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
