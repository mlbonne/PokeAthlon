import * as THREE from 'three';
import type { World } from '@pokeathlon/sim';
import { toThreeX, toThreeZ, WORLD_TO_THREE } from './units';

const W = WORLD_TO_THREE;

/**
 * Dynamic goal structures and pickups:
 * - barriers: translucent green "Protect" blocks that vanish when broken
 * - gates: two orange slabs per goal that slide apart when opened
 * - orbs: floating berries
 */
export class Structures {
  readonly object = new THREE.Group();
  private readonly barriers: THREE.Group[] = [];
  private readonly gates: { left: THREE.Mesh; right: THREE.Mesh; open: number; halfWidth: number }[] = [];
  private readonly orbs = new Map<number, THREE.Group>();
  private time = 0;

  constructor(world: World) {
    const protect = new THREE.MeshStandardMaterial({
      color: 0x5dff9a,
      emissive: 0x1d8a4a,
      transparent: true,
      opacity: 0.55,
      roughness: 0.2,
    });
    for (const b of world.barriers) {
      const grp = new THREE.Group();
      const geo = new THREE.BoxGeometry(b.box.hx * 2 * W, 0.9, b.box.hy * 2 * W);
      const mesh = new THREE.Mesh(geo, protect);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xc8ffd9 }));
      grp.add(mesh, edges);
      grp.position.set(toThreeX(b.box.x), 0.45, toThreeZ(b.box.y));
      this.object.add(grp);
      this.barriers.push(grp);
    }

    const gateMat = new THREE.MeshStandardMaterial({ color: 0xff9a3a, emissive: 0x7a3a00, metalness: 0.4, roughness: 0.35 });
    for (const goal of world.stage.goals) {
      const gb = goal.gate;
      const half = gb.hy * W;
      const mk = (sign: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(gb.hx * 2 * W, 1.0, half), gateMat);
        m.position.set(toThreeX(gb.x), 0.5, sign * (half / 2));
        this.object.add(m);
        return m;
      };
      this.gates.push({ left: mk(-1), right: mk(1), open: 0, halfWidth: half });
    }
  }

  private makeOrb(): THREE.Group {
    const grp = new THREE.Group();
    const berry = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 20, 12),
      new THREE.MeshStandardMaterial({ color: 0x4aa3ff, emissive: 0x123a80, roughness: 0.35 }),
    );
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0x3ddc84, roughness: 0.6 }),
    );
    leaf.position.y = 0.3;
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.48, 32),
      new THREE.MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.4;
    grp.add(berry, leaf, glow);
    return grp;
  }

  update(dt: number, world: World): void {
    this.time += dt;
    world.barriers.forEach((b, i) => (this.barriers[i]!.visible = b.alive));

    world.gates.forEach((g, i) => {
      const gv = this.gates[i]!;
      gv.open += ((g.open ? 1 : 0) - gv.open) * Math.min(1, dt * 6);
      const shift = gv.open * gv.halfWidth * 1.05;
      gv.left.position.z = -(gv.halfWidth / 2) - shift;
      gv.right.position.z = gv.halfWidth / 2 + shift;
      gv.left.visible = gv.right.visible = gv.open < 0.98;
    });

    const live = new Set<number>();
    for (const o of world.orbs) {
      live.add(o.id);
      let m = this.orbs.get(o.id);
      if (!m) {
        m = this.makeOrb();
        this.orbs.set(o.id, m);
        this.object.add(m);
      }
      m.position.set(toThreeX(o.pos.x), 0.55 + Math.sin(this.time * 3 + o.id) * 0.08, toThreeZ(o.pos.y));
      m.rotation.y = this.time * 1.5;
    }
    for (const [id, m] of this.orbs) {
      if (!live.has(id)) {
        this.object.remove(m);
        this.orbs.delete(id);
      }
    }
  }
}
