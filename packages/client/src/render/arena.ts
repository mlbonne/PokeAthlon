import * as THREE from 'three';
import type { Arena } from '@pokeathlon/sim';
import { WORLD_TO_THREE } from './units';

/** Arena outline (rectangle with cut corners) in Three units, on the XZ plane. */
function outline(a: Arena, inset = 0): THREE.Vector2[] {
  const w = (a.halfWidth - inset) * WORLD_TO_THREE;
  const h = (a.halfHeight - inset) * WORLD_TO_THREE;
  const c = a.cornerCut * WORLD_TO_THREE;
  // Shape coords: (x, y) where y maps to -z after rotation.
  return [
    new THREE.Vector2(-w + c, h),
    new THREE.Vector2(w - c, h),
    new THREE.Vector2(w, h - c),
    new THREE.Vector2(w, -h + c),
    new THREE.Vector2(w - c, -h),
    new THREE.Vector2(-w + c, -h),
    new THREE.Vector2(-w, -h + c),
    new THREE.Vector2(-w, h - c),
  ];
}

function flatLine(points: THREE.Vector2[], color: number, closed = false): THREE.Line {
  const pts = points.map((p) => new THREE.Vector3(p.x, 0.005, -p.y));
  if (closed && pts[0]) pts.push(pts[0].clone());
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
}

function circle(cx: number, cy: number, r: number, from = 0, to = Math.PI * 2, n = 48): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    out.push(new THREE.Vector2(cx + Math.cos(t) * r, cy + Math.sin(t) * r));
  }
  return out;
}

/** Placeholder "Viridian Pitch" floor: grass, field markings, goal mouths, KO-edge lines. */
export function buildArena(a: Arena): THREE.Group {
  const g = new THREE.Group();
  const w = a.halfWidth * WORLD_TO_THREE;
  const h = a.halfHeight * WORLD_TO_THREE;

  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape(outline(a))),
    new THREE.MeshStandardMaterial({ color: 0x4f9d52, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // Mowing stripes.
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x58a85a, roughness: 1 });
  const stripes = 9;
  for (let i = 0; i < stripes; i += 2) {
    const sw = (2 * w) / stripes;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, 2 * h - 2 * a.cornerCut * WORLD_TO_THREE), stripeMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(-w + sw * (i + 0.5), 0.002, 0);
    g.add(m);
  }

  // Markings.
  const white = 0xeaf5e4;
  g.add(flatLine([new THREE.Vector2(0, h), new THREE.Vector2(0, -h)], white));
  g.add(flatLine(circle(0, 0, 3), white, true));
  // Goal arcs ("Home Turf").
  g.add(flatLine(circle(-w, 0, 4.2, -Math.PI / 2, Math.PI / 2), white));
  g.add(flatLine(circle(w, 0, 4.2, Math.PI / 2, (3 * Math.PI) / 2), white));
  // KO edge: yellow.
  g.add(flatLine(outline(a), 0xffd23f, true));

  // Goal mouths (decorative until M2).
  const goalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 5), goalMat);
    post.position.set(side * (w + 0.2), 0.6, 0);
    g.add(post);
    const team = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 5),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0x3d7bff : 0xff4d5e, transparent: true, opacity: 0.5 }),
    );
    team.rotation.x = -Math.PI / 2;
    team.position.set(side * (w - 0.6), 0.004, 0);
    g.add(team);
  }

  // Void below the arena so KO edges read as a drop.
  const voidMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({ color: 0x1b1638 }),
  );
  voidMesh.rotation.x = -Math.PI / 2;
  voidMesh.position.y = -2;
  g.add(voidMesh);

  // Arena slab edge for depth.
  const slab = new THREE.Mesh(
    new THREE.ExtrudeGeometry(new THREE.Shape(outline(a)), { depth: 1.5, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 1 }),
  );
  slab.rotation.x = Math.PI / 2;
  // Keep the slab's top cap well below the grass to avoid z-fighting at grazing angles.
  slab.position.y = -0.05;
  g.add(slab);

  return g;
}
