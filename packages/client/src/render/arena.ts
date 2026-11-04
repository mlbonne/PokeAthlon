import * as THREE from 'three';
import { getFrame } from '@pokeathlon/data';
import type { Stage, Vec2 } from '@pokeathlon/sim';
import { toThreeX, toThreeZ, WORLD_TO_THREE } from './units';

const v2 = (p: Vec2) => new THREE.Vector2(toThreeX(p.x), -toThreeZ(p.y));
const flat = (m: THREE.Object3D, y: number) => {
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
};

function shapeOf(pts: Vec2[]): THREE.Shape {
  return new THREE.Shape(pts.map(v2));
}

function lineLoop(pts: Vec2[], color: number, y: number, opacity = 1): THREE.LineLoop {
  const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(toThreeX(p.x), y, toThreeZ(p.y))));
  return new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

/** Static arena: floor, KO edge, ball rails, goal pockets, posts, Goal Arcs, field markings. */
export function buildArena(stage: Stage): THREE.Group {
  const g = new THREE.Group();

  // Floor where players can stand (outline = KO edge).
  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(shapeOf(stage.playerOutline)),
    new THREE.MeshStandardMaterial({ color: 0x4f9d52, roughness: 1 }),
  );
  g.add(flat(floor, 0));

  // Goal pockets (net floor) — the ball can go deeper than players.
  const F = getFrame('standard').field;
  for (const goal of stage.goals) {
    const s = goal.side;
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry((F.backX - F.mouthX) * WORLD_TO_THREE, F.pocketHalfWidth * 2 * WORLD_TO_THREE),
      new THREE.MeshStandardMaterial({ color: s < 0 ? 0x26407a : 0x7a2633, roughness: 1 }),
    );
    flat(net, 0.003).position.set(toThreeX((s * (F.mouthX + F.backX)) / 2), 0.003, 0);
    g.add(net);
    // Score volume tint.
    const sc = new THREE.Mesh(
      new THREE.PlaneGeometry(goal.score.hx * 2 * WORLD_TO_THREE, goal.score.hy * 2 * WORLD_TO_THREE),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    flat(sc, 0.006).position.set(toThreeX(goal.score.x), 0.006, 0);
    g.add(sc);
  }

  // Mowing stripes, clipped roughly to the field.
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x58a85a, roughness: 1 });
  const hl = toThreeX(F.cornerStartX);
  const hw = toThreeX(F.sideY);
  for (let i = 0; i < 8; i += 2) {
    const sw = (2 * hl) / 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, 2 * hw), stripeMat);
    flat(m, 0.002).position.set(-hl + sw * (i + 0.5), 0.002, 0);
    g.add(m);
  }

  // Markings.
  const white = 0xeaf5e4;
  const mid = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, -hw), new THREE.Vector3(0, 0.01, hw)]);
  g.add(new THREE.Line(mid, new THREE.LineBasicMaterial({ color: white })));
  const circle: Vec2[] = [];
  for (let i = 0; i < 48; i++) circle.push({ x: Math.cos((i / 48) * Math.PI * 2) * 300, y: Math.sin((i / 48) * Math.PI * 2) * 300 });
  g.add(lineLoop(circle, white, 0.01, 0.7));

  // Goal Arcs (team tint), only the part in front of the goal line.
  for (const goal of stage.goals) {
    const a = goal.arc;
    const pts: Vec2[] = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const p = { x: a.x + Math.cos(t) * a.rx, y: a.y + Math.sin(t) * a.ry };
      if (Math.abs(p.x) <= Math.abs(goal.mouthX)) pts.push(p);
    }
    pts.sort((p, q) => Math.atan2(p.y - a.y, p.x - a.x) - Math.atan2(q.y - a.y, q.x - a.x));
    const color = goal.team === 0 ? 0x3d7bff : 0xff4d5e;
    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shapeOf(pts)),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    g.add(flat(fill, 0.008));
    g.add(lineLoop(pts, color, 0.012, 0.8));
  }

  // KO edge: glowing line along the player outline.
  g.add(lineLoop(stage.playerOutline, 0xffd23f, 0.015));

  // Ball rails: low walls along the ball outline.
  const railMat = new THREE.MeshStandardMaterial({ color: 0xf0eef8, roughness: 0.5, transparent: true, opacity: 0.85 });
  for (const s of stage.ballWalls) {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len = Math.hypot(dx, dy) * WORLD_TO_THREE;
    if (len < 1e-3) continue;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.08), railMat);
    rail.position.set(toThreeX((s.ax + s.bx) / 2), 0.09, toThreeZ((s.ay + s.by) / 2));
    rail.rotation.y = -Math.atan2(toThreeZ(s.by) - toThreeZ(s.ay), toThreeX(s.bx) - toThreeX(s.ax));
    g.add(rail);
  }

  // Goal posts.
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.2 });
  for (const c of stage.posts) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(c.r * WORLD_TO_THREE, c.r * WORLD_TO_THREE, 1.4, 16), postMat);
    post.position.set(toThreeX(c.x), 0.7, toThreeZ(c.y));
    g.add(post);
  }

  // Slab + void so the KO edge reads as a drop.
  const slab = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shapeOf(stage.playerOutline), { depth: 1.5, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 1 }),
  );
  slab.rotation.x = Math.PI / 2;
  slab.position.y = -0.05;
  g.add(slab);
  const voidMesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x1b1638 }));
  g.add(flat(voidMesh, -2));
  return g;
}
