import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gameplay, roster } from '@pokeathlon/data';
import { TICK_RATE, type SimEvent, type Stage, type World } from '@pokeathlon/sim';
import { loadManifest } from './pmdSprite';
import { PIXEL, toThreeX, toThreeZ } from './units';

/**
 * Pokémon Stadium (M6 stage 1): everything around the platform. All art is downloaded (see CREDITS.md):
 * stands, floodlight trusses, spotlights, big screen, skyline and towers from poly.pizza (CC0 / CC BY 3.0),
 * the Poké Balls from Pokébonk, and the crowd from our PMD sprites. We only arrange, tint and light them.
 *
 * Rendering follows Pokébonk: toon materials with a 3-step ramp, crisp pixel textures, inverted-hull outlines
 * on the props closest to the camera. Layout follows OS: the camera frames the field tightly, so detail goes to
 * the corners and the strip above the far side; the far background is cheap silhouettes.
 */

const gltf = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
function load(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = gltf.loadAsync(url).then((g) => g.scene);
    cache.set(url, p);
  }
  return p.then((s) => s.clone(true));
}

/** Pokébonk's toon ramp: 3 flat bands. */
const RAMP = (() => {
  const t = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const OUTLINE = (() => {
  const m = new THREE.MeshBasicMaterial({ color: 0x1d1530, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * 0.045;');
  };
  return m;
})();

interface ToonOpts {
  /** Multiply every colour (night tint). */
  tint?: number;
  /** Per material name: emissive colour (lit windows, lamp faces). */
  glow?: Record<string, number>;
  /** Per material name: replacement base colour. */
  recolor?: Record<string, number>;
  /** Pokébonk-style inverted hull. Only for models stored near real size (offset is in model units). */
  outline?: boolean;
}

/** Swap every material for a toon one (Pokébonk), keeping colour and texture. */
function toon(root: THREE.Object3D, o: ToonOpts = {}): THREE.Object3D {
  const made = new Map<THREE.Material, THREE.Material>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });
  for (const mesh of meshes) {
    const swap = (src: THREE.Material): THREE.Material => {
      let t = made.get(src);
      if (!t) {
        const s = src as THREE.MeshStandardMaterial;
        if (s.map) {
          s.map.magFilter = THREE.NearestFilter;
          s.map.minFilter = THREE.NearestFilter;
          s.map.colorSpace = THREE.SRGBColorSpace;
        }
        const glow = o.glow?.[s.name];
        const color = new THREE.Color(o.recolor?.[s.name] ?? s.color ?? 0xffffff);
        if (o.tint !== undefined && glow === undefined) color.multiply(new THREE.Color(o.tint));
        t = new THREE.MeshToonMaterial({
          name: s.name,
          map: s.map ?? null,
          color,
          gradientMap: RAMP,
          emissive: glow ?? 0x000000,
          emissiveIntensity: glow ? 1 : 0,
          transparent: s.transparent,
          opacity: s.opacity,
          side: s.side,
        });
        made.set(src, t);
      }
      return t;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    if (o.outline) {
      const hull = new THREE.Mesh(mesh.geometry, OUTLINE);
      hull.raycast = () => {};
      mesh.add(hull);
    }
  }
  return root;
}

/** Scale a model so its bounding box has height (or width, if `axis` = 'x') `size`, sitting on y = 0, centred. */
function fit(root: THREE.Object3D, size: number, axis: 'x' | 'y' | 'z' = 'y'): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(root);
  const s = size / box.getSize(new THREE.Vector3())[axis];
  root.scale.multiplyScalar(s);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
  const pivot = new THREE.Group();
  root.position.set(-c.x, -box.min.y * s, -c.z);
  pivot.add(root);
  return pivot;
}

/** Soft additive glow sprite (floodlight heads). */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.3, 'rgba(220,235,255,0.55)');
  r.addColorStop(1, 'rgba(200,220,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface CrowdGroup {
  mesh: THREE.InstancedMesh;
  base: THREE.Vector3[];
  phase: number[];
  tex: THREE.Texture;
  columns: number;
  durations: number[];
  total: number;
  t: number;
  w: number;
  h: number;
}

const TEAM_HEX = ['#3d7bff', '#ff4d5e'];
const SPECIES_DEX = () => [...new Set(roster.map((r) => r.dex))];

export class StadiumView {
  readonly object = new THREE.Group();
  private stands: THREE.Object3D[] = [];
  private crowd: CrowdGroup[] = [];
  private cheer = 0;
  private beams: { mesh: THREE.Mesh; base: number; speed: number; phase: number }[] = [];
  private time = 0;
  private readonly screenCanvas = document.createElement('canvas');
  private readonly screenTex: THREE.CanvasTexture;
  private screenKey = '';
  private goalFlash = 0;
  private goalTeam = 0;
  private readonly ballIcon = new Image();
  private readonly camQuat = new THREE.Quaternion();
  private readonly tmp = new THREE.Object3D();

  constructor(private readonly stage: Stage) {
    this.screenCanvas.width = 512;
    this.screenCanvas.height = 224;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.magFilter = THREE.NearestFilter;
    this.ballIcon.src = 'stadium/pokebonk/poke-ball.png';
    void this.build();
  }

  private async build(): Promise<void> {
    const S = this.stage;
    const halfL = toThreeX(S.halfLength);
    const halfW = toThreeX(S.halfWidth);
    const NIGHT = 0x8a93b8;

    // Supports under the floating platform (lighting trusses used as legs).
    load('stadium/poly/light_truss_large_simcoe.glb').then((m) => {
      const leg = fit(toon(m, { tint: 0x7a8296 }), 24);
      for (const [x, z] of [
        [-0.55, -0.6],
        [0.55, -0.6],
        [-0.55, 0.6],
        [0.55, 0.6],
        [0, -0.6],
        [0, 0.6],
      ] as const) {
        const l = leg.clone();
        l.position.set(x * halfL * 2 * 0.62, -28, z * halfW * 1.1);
        l.scale.x = l.scale.z = 3;
        this.object.add(l);
      }
    });

    // Stands: two U-shaped seat bowls facing each other along the long axis → a full ring.
    const standsP = load('stadium/poly/seats_zsky.glb').then((m) => {
      toon(m, { recolor: { Blue_StadiumSits3: 0x3f63c4, Gray_StadiumSits3: 0xb9bfcc }, tint: NIGHT });
      // Native bowl: opening toward −z, pit 19 (x) × 22 (z). Two of them ×1.6 → a 71 × 30 pit around the platform.
      const scale = 1.6;
      for (const side of [-1, 1]) {
        const s = new THREE.Group();
        const inner = m.clone();
        inner.scale.setScalar(scale);
        // Turn the opening toward the field centre along x.
        inner.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
        s.add(inner);
        const box = new THREE.Box3().setFromObject(s);
        // Open edge on x = 0; the top row sits below the platform, like Smash's raised stage, so the near
        // stands never hide the field from our high camera.
        s.position.set(side < 0 ? -box.max.x : -box.min.x, -2.6 - box.max.y, -(box.min.z + box.max.z) / 2);
        this.object.add(s);
        this.stands.push(s);
      }
    });

    // Big screen above the far stands (Google Poly billboard, CC BY 3.0) with our live score canvas.
    load('stadium/poly/billboard_google.glb').then((m) => {
      const bb = fit(toon(m, { tint: 0x8890a8 }), 22, 'z');
      // Its panel faces ±x; turn it to face the field (+z).
      bb.rotation.y = -Math.PI / 2;
      bb.position.set(0, 2, -halfW - 21);
      this.object.add(bb);
      const box = new THREE.Box3().setFromObject(bb);
      const h = box.max.y - box.min.y;
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry((box.max.x - box.min.x) * 0.94, h * 0.42),
        new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false, fog: false }),
      );
      panel.position.set(0, box.min.y + h * 0.73, box.max.z + 0.05);
      this.object.add(panel);
    });

    // Floodlight towers at the 4 corners of the stands: a tall truss with a cluster of spotlights (CC0) + glow.
    Promise.all([load('stadium/poly/light_truss_large_simcoe.glb'), load('stadium/poly/spotlight_ipoly3d.glb')]).then(([t, sp]) => {
      const truss = fit(toon(t, { tint: 0xc8cedc }), 30);
      truss.scale.x = truss.scale.z = 2.6;
      // No outline: the hull offset is in model units and this model is stored tiny, so it would balloon.
      const lamp = fit(toon(sp, { glow: { LightGrey: 0xfff4d6 } }), 1.6);
      const glow = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xeaf2ff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        const tower = new THREE.Group();
        tower.add(truss.clone());
        for (let i = 0; i < 6; i++) {
          const l = lamp.clone();
          l.position.set(((i % 3) - 1) * 1.7, 30 + Math.floor(i / 3) * 1.8, 0);
          tower.add(l);
          const g = new THREE.Sprite(glow);
          g.scale.setScalar(4.5);
          g.position.set(((i % 3) - 1) * 1.7, 30.8 + Math.floor(i / 3) * 1.8, 0.6);
          tower.add(g);
        }
        tower.position.set(sx * (halfL + 15), -6, sz * (halfW + 13));
        tower.lookAt(0, -6, 0);
        tower.children.slice(1).forEach((c) => c.rotateX(0.5));
        this.object.add(tower);
      }
    });

    // Corner Poké Balls (Pokébonk ball.glb) on the 4 cut corners: our take on OS's corner engines.
    load('stadium/pokebonk/ball.glb').then((m) => {
      const ball = fit(toon(m, { outline: true }), 1.7);
      const pts = S.playerOutline;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) < 50 || Math.abs(dy) < 50) continue; // only the diagonal corner cuts
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const out = Math.hypot(mx, my);
        const x = toThreeX(mx + (mx / out) * 140);
        const z = toThreeZ(my + (my / out) * 140);
        const c = ball.clone();
        c.position.set(x, -0.35, z);
        c.lookAt(0, -0.35, 0);
        this.object.add(c);
      }
    });

    // City skyline at night: a far silhouette (CC BY 3.0) and Kenney towers (CC0) with lit windows.
    load('stadium/poly/blocks_skyline_annadreambrush.glb').then((m) => {
      const city = fit(toon(m, { recolor: { mat23: 0x1a2040, mat8: 0x222a50 } }), 150, 'x');
      city.position.set(0, -14, -110);
      this.object.add(city);
    });
    const towers = ['a', 'b', 'c', 'd', 'e', 'f'];
    Promise.all(towers.map((k) => load(`stadium/poly/skyscraper_kenney_${k}.glb`))).then((ms) => {
      const lit = ms.map((m) => toon(m, { tint: 0x5a6488, glow: { window: 0xffcf7a } }));
      for (let i = 0; i < 22; i++) {
        const t = lit[i % lit.length]!.clone();
        const a = Math.PI * (0.08 + (0.84 * i) / 21);
        const r = 78 + ((i * 37) % 17);
        t.scale.setScalar(7 + ((i * 13) % 5));
        t.position.set(-Math.cos(a) * r * 1.3, -14, -Math.sin(a) * r);
        t.rotation.y = (i * 1.7) % (Math.PI * 2);
        this.object.add(t);
      }
    });

    // Searchlight beams behind the far stands (additive cones).
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xbfd8ff,
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const beamGeo = new THREE.ConeGeometry(3.2, 70, 20, 1, true);
    beamGeo.translate(0, -35, 0);
    beamGeo.rotateX(Math.PI);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(beamGeo, beamMat);
      b.position.set((i - 1.5) * 26, -4, -halfW - 34);
      this.object.add(b);
      this.beams.push({ mesh: b, base: (i - 1.5) * 0.25, speed: 0.13 + i * 0.03, phase: i * 1.9 });
    }

    // Pokémon crowd: our PMD idle sprites, one instanced mesh per species, standing on the blue seats.
    await standsP;
    await this.buildCrowd();
  }

  private async buildCrowd(): Promise<void> {
    this.object.updateMatrixWorld(true);
    const seats: THREE.Mesh[] = [];
    for (const s of this.stands) {
      s.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material && (m.material as THREE.Material).name === 'Blue_StadiumSits3') seats.push(m);
      });
    }
    if (!seats.length) return;
    const box = new THREE.Box3();
    for (const s of seats) box.expandByObject(s);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const spots: THREE.Vector3[] = [];
    const step = 1.15;
    let n = 0;
    for (let x = box.min.x; x <= box.max.x; x += step) {
      for (let z = box.min.z; z <= box.max.z; z += step) {
        n++;
        // Deterministic gaps so it doesn't look like a grid.
        if ((Math.sin(n * 12.9898) * 43758.5453) % 1 > 0.62) continue;
        ray.set(new THREE.Vector3(x + ((n * 7) % 5) * 0.08, box.max.y + 5, z), down);
        const hit = ray.intersectObjects(seats, false)[0];
        if (hit && hit.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > 0.6) spots.push(hit.point.clone());
      }
    }
    const dexes = SPECIES_DEX();
    const per = dexes.map(() => [] as THREE.Vector3[]);
    spots.forEach((p, i) => per[(i * 5 + Math.abs(Math.floor(p.x * 3))) % dexes.length]!.push(p));
    await Promise.all(
      dexes.map(async (dex, k) => {
        const base = per[k]!;
        if (!base.length) return;
        const man = await loadManifest(dex);
        const def = man.anims.Idle;
        if (!def) return;
        const tex = await new THREE.TextureLoader().loadAsync(`sprites/${dex}/${def.file}`);
        tex.magFilter = tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        const columns = Math.round((tex.image as HTMLImageElement).width / def.frameWidth);
        tex.repeat.set(1 / columns, 1 / 8);
        tex.offset.set(0, 1 - 1 / 8); // row 0 = facing down (toward the camera)
        const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, color: 0xc9d2ef });
        const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, base.length);
        const w = def.frameWidth * PIXEL * 0.55;
        const h = def.frameHeight * PIXEL * 0.55;
        this.crowd.push({
          mesh,
          base,
          phase: base.map((_, i) => (i * 0.37) % 1),
          tex,
          columns,
          durations: def.durations,
          total: def.durations.reduce((a, b) => a + b, 0),
          t: k * 13,
          w,
          h,
        });
        this.object.add(mesh);
      }),
    );
    this.layoutCrowd();
  }

  private layoutCrowd(): void {
    const t = this.tmp;
    for (const g of this.crowd) {
      g.base.forEach((p, i) => {
        const jump = this.cheer > 0 ? Math.max(0, Math.sin((this.time * 9 + g.phase[i]! * 6.28) % 6.28)) * 0.5 * Math.min(1, this.cheer) : 0;
        t.position.set(p.x, p.y + g.h * 0.32 + jump, p.z);
        t.quaternion.copy(this.camQuat);
        t.scale.set(g.w, g.h, 1);
        t.updateMatrix();
        g.mesh.setMatrixAt(i, t.matrix);
      });
      g.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  onEvent(e: SimEvent): void {
    if (e.type === 'goal') {
      this.cheer = 3.5;
      this.goalFlash = 3.5;
      this.goalTeam = e.team;
    } else if (e.type === 'ko' || e.type === 'barrierBreak') {
      this.cheer = Math.max(this.cheer, 1.2);
    }
  }

  update(dt: number, world: World, camera: THREE.Camera): void {
    this.time += dt;
    const camMoved = !this.camQuat.equals(camera.quaternion);
    if (camMoved) this.camQuat.copy(camera.quaternion);
    for (const g of this.crowd) {
      g.t = (g.t + dt * 60 * (this.cheer > 0 ? 2.2 : 1)) % g.total;
      let r = g.t;
      let f = 0;
      for (; f < g.durations.length - 1; f++) {
        r -= g.durations[f]!;
        if (r < 0) break;
      }
      g.tex.offset.x = Math.min(f, g.columns - 1) / g.columns;
    }
    if (this.cheer > 0 || camMoved) this.layoutCrowd();
    this.cheer = Math.max(0, this.cheer - dt);
    for (const b of this.beams) {
      b.mesh.rotation.z = b.base + Math.sin(this.time * b.speed + b.phase) * 0.35;
      b.mesh.rotation.x = -0.25 + Math.sin(this.time * b.speed * 0.7 + b.phase) * 0.12;
    }
    this.goalFlash = Math.max(0, this.goalFlash - dt);
    this.drawScreen(world);
  }

  /** The big screen: idle Poké Ball + score + clock, or GOAL! after a goal. Redrawn only when it changes. */
  private drawScreen(world: World): void {
    const m = world.match;
    const secs = Math.floor(m.roundTicks / TICK_RATE);
    const flash = this.goalFlash > 0 ? Math.floor(this.goalFlash * 4) % 2 : -1;
    const key = `${m.goals[0]}-${m.goals[1]}-${m.sets[0]}-${m.sets[1]}-${secs}-${m.overtime}-${flash}-${this.ballIcon.complete}`;
    if (key === this.screenKey) return;
    this.screenKey = key;
    const c = this.screenCanvas;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#0b1230';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 6;
    g.strokeRect(3, 3, c.width - 6, c.height - 6);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (flash >= 0) {
      g.fillStyle = flash ? TEAM_HEX[this.goalTeam]! : '#ffffff';
      g.font = 'bold 110px system-ui, sans-serif';
      g.fillText('GOAL!', c.width / 2, c.height / 2 + 6);
      return;
    }
    if (this.ballIcon.complete && this.ballIcon.naturalWidth) g.drawImage(this.ballIcon, c.width / 2 - 30, 14, 60, 60);
    g.font = 'bold 84px system-ui, sans-serif';
    g.fillStyle = TEAM_HEX[0]!;
    g.fillText(String(m.goals[0]), c.width / 2 - 120, 112);
    g.fillStyle = TEAM_HEX[1]!;
    g.fillText(String(m.goals[1]), c.width / 2 + 120, 112);
    g.fillStyle = '#ffffff';
    g.font = 'bold 40px system-ui, sans-serif';
    g.fillText(`${m.overtime ? 'OT ' : ''}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, c.width / 2, 112);
    const pip = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, gameplay.match.setsToWin - n));
    g.font = 'bold 30px system-ui, sans-serif';
    g.fillStyle = TEAM_HEX[0]!;
    g.fillText(pip(m.sets[0]), c.width / 2 - 120, 176);
    g.fillStyle = TEAM_HEX[1]!;
    g.fillText(pip(m.sets[1]), c.width / 2 + 120, 176);
    g.fillStyle = '#c9d2ef';
    g.font = 'bold 22px system-ui, sans-serif';
    g.fillText('POKéMON STADIUM', c.width / 2, 176);
    this.screenTex.needsUpdate = true;
  }
}

/** Night lighting for the stadium (floodlit field, dark blue sky). */
export function stadiumLighting(scene: THREE.Scene, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight): void {
  const sky = 0x0a1230;
  scene.background = new THREE.Color(sky);
  (scene.fog as THREE.Fog).color.set(sky);
  hemi.color.set(0xc8d6ff);
  hemi.groundColor.set(0x1c2440);
  hemi.intensity = 1.5;
  sun.color.set(0xfff6e6);
  sun.intensity = 1.7;
  sun.position.set(0, 30, 8);
}

export const isStadium = (stage: Stage): boolean => stage.theme === 'stadium';
