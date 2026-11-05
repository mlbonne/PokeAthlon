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

/** Pixel-art texture (Pokébonk-style crisp pixels), tiled. */
function tex(url: string, repeat: number): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

/** Same pixel texture, desaturated in the shader (Pokébonk's tower bricks are purple; the stadium rim is grey). */
function greyed(m: THREE.MeshStandardMaterial, amount: number): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), ${amount.toFixed(2)});`,
    );
  };
  return m;
}

/** Offset a convex-ish polygon outward by `d` (miter joins). */
function offsetOutline(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    area += a.x * b.y - b.x * a.y;
  }
  const sgn = area > 0 ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n]!;
    const b = pts[(i + 1) % n]!;
    const n1 = norm(p.y - a.y, -(p.x - a.x), sgn);
    const n2 = norm(b.y - p.y, -(b.x - p.x), sgn);
    const k = 1 + n1.x * n2.x + n1.y * n2.y;
    return { x: p.x + ((n1.x + n2.x) / k) * d, y: p.y + ((n1.y + n2.y) / k) * d };
  });
}
function norm(x: number, y: number, sgn: number): Vec2 {
  const l = Math.hypot(x, y) || 1;
  return { x: (x / l) * sgn, y: (y / l) * sgn };
}

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
  const stadium = stage.theme === 'stadium';

  // Floor where players can stand (outline = KO edge). Stadium: Pokébonk's pixel grass tile.
  const grass = stadium ? tex('stadium/pokebonk/grass.png', 0.55) : null;
  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(shapeOf(stage.playerOutline)),
    new THREE.MeshStandardMaterial(grass ? { map: grass, color: 0xd8ecd0, roughness: 1 } : { color: 0x4f9d52, roughness: 1 }),
  );
  g.add(flat(floor, 0));

  // Goal pockets (net floor) — the ball can go deeper than players.
  const F = getFrame('standard').field;
  for (const goal of stage.goals) {
    const s = goal.side;
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry((F.backX - F.mouthX) * WORLD_TO_THREE, F.pocketHalfWidth * 2 * WORLD_TO_THREE),
      new THREE.MeshStandardMaterial({ color: s < 0 ? 0x26407a : 0x7a2633, roughness: 1, ...(stadium ? { emissive: s < 0 ? 0x10224a : 0x4a1018 } : {}) }),
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
  const stripeMat = grass
    ? new THREE.MeshStandardMaterial({ map: grass, color: 0xb4cfa8, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false })
    : new THREE.MeshStandardMaterial({ color: 0x58a85a, roughness: 1 });
  const hl = toThreeX(F.cornerStartX);
  const hw = toThreeX(F.sideY);
  for (let i = 0; i < 8; i += 2) {
    const sw = (2 * hl) / 8;
    const pg = new THREE.PlaneGeometry(sw, 2 * hw);
    if (grass) {
      // World-aligned UVs so the stripe's grass lines up with the floor's.
      const uv = pg.attributes.uv!;
      const pos = pg.attributes.position!;
      const x0 = -hl + sw * (i + 0.5);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, pos.getX(k) + x0, pos.getY(k));
    }
    const m = new THREE.Mesh(pg, stripeMat);
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

  // Stadium: the Poké Ball emblem in the centre circle (Pokébonk's Poké Ball item icon, crisp pixels).
  if (stadium) {
    const t = new THREE.TextureLoader().load('stadium/pokebonk/poke-ball.png');
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    const emblem = new THREE.Mesh(
      new THREE.PlaneGeometry(5.4, 5.4),
      new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.5, opacity: 0.9, roughness: 1, depthWrite: false }),
    );
    g.add(flat(emblem, 0.006));
  }

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
  if (!stadium) {
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

  // Stadium platform (Smash's floating stage): a grey brick rim a step below the KO edge, then a deep basalt body.
  // Covers the player outline and the goal pockets (ball outline).
  const rimMat = greyed(new THREE.MeshStandardMaterial({ map: tex('stadium/pokebonk/rim.png', 0.9), color: 0xc9ccd6, roughness: 1 }), 0.85);
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex('stadium/pokebonk/basalt.png', 0.45), color: 0x9aa3b5, roughness: 1 });
  for (const [outline, y] of [
    [stage.playerOutline, -0.06],
    [stage.ballOutline, -0.07],
  ] as const) {
    const rim = offsetOutline(outline, 55);
    const top = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(rim), { depth: 0.5, bevelEnabled: false }), [rimMat, rimMat]);
    top.rotation.x = Math.PI / 2;
    top.position.y = y;
    g.add(top);
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shapeOf(offsetOutline(outline, 25)), { depth: 4.5, bevelEnabled: false }),
      [bodyMat, bodyMat],
    );
    body.rotation.x = Math.PI / 2;
    body.position.y = y - 0.5;
    g.add(body);
  }
  return g;
}
