import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gameplay } from '@pokeathlon/data';
import { TICK_RATE, type SimEvent, type Stage, type World } from '@pokeathlon/sim';
import { toThreeX } from './units';

/**
 * Pokémon Stadium 2 from Super Smash Bros. Brawl (Nintendo / HAL Laboratory).
 *
 * The source models are baked to their bind pose and split by bone by `tools/stage/convert.ts`;
 * see `assets/stadium/brawl/CREDITS.md`. Everything here only arranges, lights and animates the
 * ripped stage. Model units stay centimetres and the whole set is scaled by 0.18 so the arena
 * floor matches our ball outline.
 */

const SCALE = 0.18;
const FLOOR_MARKS: Record<string, string> = {
  normal: 'MarkNormal01.png',
  electric: 'MarkDenki01.png',
  ice: 'MarkKouri01.png',
  flying: 'MarkHikou01.png',
  ground: 'MarkZimen01.png',
};

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

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}
interface GroupInfo {
  bounds: Bounds | null;
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
}
interface FileInfo {
  url: string;
  bytes: number;
  bounds: Bounds | null;
  groups?: Record<string, GroupInfo>;
}
interface Manifest {
  files: Record<string, FileInfo>;
  floors: Record<string, { file: string; ground: GroupInfo | null; props: GroupInfo | null }>;
  marks: string[];
  anchors: Record<string, Record<string, [number, number, number]>>;
}

/** Crisp pixel textures, alpha cut-outs and the glass/shadow tweaks from the converter. */
function prepare(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Brawl's NShadow1 planes reuse the character blob-shadow texture stretched across the whole
    // ground, so they read as a giant Pokémon silhouette instead of a stage shadow. Skip them.
    if (materials.length && materials.every((m) => /shadow/i.test(m.name))) {
      mesh.visible = false;
      return;
    }
    for (const material of materials) {
      const m = material as THREE.MeshStandardMaterial;
      if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace;
        m.map.magFilter = THREE.NearestFilter;
        m.map.minFilter = THREE.NearestMipmapNearestFilter;
        m.map.wrapS = THREE.RepeatWrapping;
        m.map.wrapT = THREE.RepeatWrapping;
        m.map.needsUpdate = true;
      }
      const name = m.name;
      if (/^(alpha|light|ami)/i.test(name) || /kazeami/i.test(name)) {
        m.transparent = true;
        m.alphaTest = 0.5;
        m.depthWrite = true;
      } else if (/^glass/i.test(name)) {
        m.transparent = true;
        m.opacity = Math.min(m.opacity, 0.55);
        m.depthWrite = false;
      } else if (/shadow/i.test(name)) {
        // Brawl's blob shadows are white silhouettes on black, meant to darken what is behind them:
        // dst = dst * (1 - src). The alpha channel is fully opaque, so alpha blending will not work.
        m.transparent = true;
        m.blending = THREE.CustomBlending;
        m.blendSrc = THREE.ZeroFactor;
        m.blendDst = THREE.OneMinusSrcColorFactor;
        m.depthWrite = false;
        m.alphaTest = 0;
        m.needsUpdate = true;
      } else if (/^thunder/i.test(name)) {
        // Electric-floor lightning: additive glow, black background leaves the floor untouched.
        m.transparent = true;
        m.blending = THREE.AdditiveBlending;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
    }
  });
}

/** Stretch a mesh's UVs across the whole 0..1 range so a canvas maps once, not tiled. */
function remapUv(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const du = maxU - minU || 1;
  const dv = maxV - minV || 1;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - minU) / du, (uv.getY(i) - minV) / dv);
  uv.needsUpdate = true;
}

/**
 * Brawl bakes its lighting into vertex colours, which are very dark (0.02–0.4). Scale them up so the
 * stands and roof read under our lights without losing the baked shading.
 */
function brighten(root: THREE.Object3D, factor: number): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const color = mesh.geometry.getAttribute('color');
    if (!color) return;
    for (let i = 0; i < color.count; i++) {
      color.setXYZ(
        i,
        Math.min(1, color.getX(i) * factor),
        Math.min(1, color.getY(i) * factor),
        Math.min(1, color.getZ(i) * factor),
      );
    }
    color.needsUpdate = true;
  });
}

/** Move a mesh into a pivot at its own centre so it can spin without orbiting the world origin. */
function pivotize(mesh: THREE.Mesh): THREE.Group {
  mesh.geometry = mesh.geometry.clone();
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox ?? new THREE.Box3();
  const center = box.getCenter(new THREE.Vector3());
  mesh.geometry.translate(-center.x, -center.y, -center.z);
  const pivot = new THREE.Group();
  pivot.name = `${mesh.name}_pivot`;
  pivot.position.copy(center);
  pivot.add(mesh);
  return pivot;
}

interface Spinner {
  object: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  speed: number;
}
interface Scroller {
  map: THREE.Texture;
  speed: number;
}

export class StadiumBrawlView {
  readonly object = new THREE.Group();
  private manifest: Manifest | null = null;
  private floor: THREE.Group | null = null;
  private props: THREE.Group | null = null;
  private floorName = 'normal';
  private floorIndex = 0;
  private spinners: Spinner[] = [];
  private scrollers: Scroller[] = [];
  private beams: { mesh: THREE.Mesh; base: number; speed: number; phase: number }[] = [];
  private smoke: THREE.Group | null = null;
  private smokeTime = 0;
  private cheer = 0;
  private time = 0;
  private readonly screenCanvas = document.createElement('canvas');
  private readonly screenTex: THREE.CanvasTexture;
  private screenKey = '';
  private goalFlash = 0;
  private goalTeam = 0;
  private readonly ballIcon = new Image();
  private readonly markIcons = new Map<string, HTMLImageElement>();

  constructor(private readonly stage: Stage) {
    this.screenCanvas.width = 512;
    this.screenCanvas.height = 224;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.magFilter = THREE.NearestFilter;
    this.ballIcon.src = 'stadium/pokebonk/poke-ball.png';
    for (const [floor, file] of Object.entries(FLOOR_MARKS)) {
      const image = new Image();
      image.src = `stadium/brawl/marks/${file}`;
      this.markIcons.set(floor, image);
    }
    const cycle = stage.floorCycle.length ? stage.floorCycle : [stage.floor];
    this.floorIndex = Math.max(0, cycle.indexOf(stage.floor));
    this.floorName = stage.floor;
    void this.build();
  }

  private async build(): Promise<void> {
    const S = this.stage;
    const halfW = toThreeX(S.halfWidth);

    this.manifest = await fetch('stadium/brawl/manifest.json').then((r) => r.json() as Promise<Manifest>);

    // Static shell: stands, roof, blob shadow.
    const shell = await load('stadium/brawl/stadium.glb');
    shell.scale.setScalar(SCALE);
    prepare(shell);
    brighten(shell, 4.2);
    this.object.add(shell);

    // Sky: a wide backdrop band, kept far behind the stands.
    const sky = await load('stadium/brawl/sky.glb');
    prepare(sky);
    const skyBox = new THREE.Box3().setFromObject(sky);
    const skySize = skyBox.getSize(new THREE.Vector3());
    const skyScale = 900 / Math.max(1, skySize.x);
    sky.scale.setScalar(skyScale);
    skyBox.setFromObject(sky);
    const skyCenter = skyBox.getCenter(new THREE.Vector3());
    sky.position.set(-skyCenter.x, -skyBox.min.y + 2, -30 - skyBox.max.z);
    this.object.add(sky);

    // Big screen: the Brawl frame moved onto the strip above the far side so it is on camera.
    // The frame is ~68 units wide at source scale, so scale it to a 12-unit scoreboard.
    const screen = await load('stadium/brawl/screen.glb');
    prepare(screen);
    const frame = screen.getObjectByName('frame');
    if (frame) {
      const native = new THREE.Box3().setFromObject(frame);
      const nativeWidth = native.getSize(new THREE.Vector3()).x;
      screen.scale.setScalar(12 / Math.max(1, nativeWidth));
      screen.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(frame);
      screen.position.x -= (box.min.x + box.max.x) / 2;
      screen.position.y += 0.1 - box.min.y;
      screen.position.z += -10.5 - box.max.z;
      screen.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (!materials.some((m) => m.name === 'moniter2')) return;
        remapUv(mesh.geometry);
        mesh.material = new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false, fog: false });
      });
    }
    this.object.add(screen);

    // Searchlight beams sweeping behind the far stands.
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xbfd8ff,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const beamGeo = new THREE.ConeGeometry(4, 120, 18, 1, true);
    beamGeo.translate(0, -60, 0);
    beamGeo.rotateX(Math.PI);
    for (let i = 0; i < 6; i++) {
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set((i - 2.5) * 34, 4, -halfW - 70);
      this.object.add(beam);
      this.beams.push({ mesh: beam, base: (i - 2.5) * 0.16, speed: 0.11 + i * 0.02, phase: i * 1.7 });
    }

    // Smoke puff for floor changes.
    const smoke = await load('stadium/brawl/smoke.glb');
    prepare(smoke);
    smoke.scale.setScalar(SCALE);
    smoke.visible = false;
    smoke.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = 0;
    });
    this.smoke = smoke;
    this.object.add(smoke);

    await this.setFloor(this.floorName, false);
  }

  private async setFloor(name: string, announce: boolean): Promise<void> {
    if (this.floor) {
      this.object.remove(this.floor);
      this.floor = null;
    }
    this.spinners = [];
    this.scrollers = [];
    this.props = null;

    const group = await load(`stadium/brawl/floor-${name}.glb`);
    group.scale.setScalar(SCALE);
    prepare(group);
    brighten(group, 2.4);
    this.floor = group;
    this.floorName = name;
    this.object.add(group);

    const props = group.getObjectByName('props');
    this.props = (props as THREE.Group | undefined) ?? null;
    if (this.props) this.setupProps(this.props);
    if (announce) this.puff();
  }

  private setupProps(props: THREE.Group): void {
    const animated = new Set([
      'EnbanMain',
      'EnbanSub',
      'HikouHusya1',
      'HikouHusya2',
      'HikouHusya3',
      'Hane01',
      'Hane01_1',
      'Hane01_2',
      'puroperaB02',
      'puroperaB03',
      'puroperaB04',
      'puroperaB05',
    ]);
    const scrolling = new Set(['conveyor01', 'conveyor02']);
    const meshes: THREE.Mesh[] = [];
    props.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });
    for (const mesh of meshes) {
      if (scrolling.has(mesh.name)) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const m = material as THREE.MeshStandardMaterial;
          if (!m.map) continue;
          const map = m.map.clone();
          map.wrapS = map.wrapT = THREE.RepeatWrapping;
          map.needsUpdate = true;
          m.map = map;
          this.scrollers.push({ map, speed: 0.35 });
        }
        continue;
      }
      if (!animated.has(mesh.name)) continue;
      const parent = mesh.parent;
      if (!parent) continue;
      const pivot = pivotize(mesh);
      parent.add(pivot);
      const axis: Spinner['axis'] = mesh.name.startsWith('Hane') ? 'z' : 'y';
      const speed = mesh.name.startsWith('Enban') ? 0.55 : mesh.name.startsWith('puropera') ? 2.4 : 1.1;
      this.spinners.push({ object: pivot, axis, speed });
    }
  }

  private puff(): void {
    this.smokeTime = 1.4;
    if (!this.smoke) return;
    this.smoke.visible = true;
    this.smoke.scale.setScalar(SCALE * 0.4);
    this.smoke.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.opacity = 0.7;
    });
  }

  onEvent(e: SimEvent): void {
    if (e.type === 'goal') {
      this.cheer = 3.5;
      this.goalFlash = 3.5;
      this.goalTeam = e.team;
    } else if (e.type === 'ko' || e.type === 'barrierBreak') {
      this.cheer = Math.max(this.cheer, 1.2);
    } else if (e.type === 'setWon') {
      const cycle = this.stage.floorCycle;
      if (cycle.length > 1) {
        this.floorIndex = (this.floorIndex + 1) % cycle.length;
        const next = cycle[this.floorIndex]!;
        void this.setFloor(next, true);
      }
    }
  }

  update(dt: number, world: World): void {
    this.time += dt;
    for (const s of this.spinners) {
      s.object.rotation[s.axis] += dt * s.speed;
    }
    for (const s of this.scrollers) {
      s.map.offset.x = (s.map.offset.x + dt * s.speed) % 1;
    }
    for (const b of this.beams) {
      b.mesh.rotation.z = b.base + Math.sin(this.time * b.speed + b.phase) * 0.3;
      b.mesh.rotation.x = -0.2 + Math.sin(this.time * b.speed * 0.7 + b.phase) * 0.1;
    }
    if (this.smokeTime > 0) {
      this.smokeTime = Math.max(0, this.smokeTime - dt);
      if (this.smoke) {
        const k = 1 - this.smokeTime / 1.4;
        this.smoke.scale.setScalar(SCALE * (0.4 + k * 1.6));
        this.smoke.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          const m = mesh.material as THREE.MeshStandardMaterial;
          m.opacity = 0.7 * (1 - k);
        });
        if (this.smokeTime === 0) this.smoke.visible = false;
      }
    }
    this.cheer = Math.max(0, this.cheer - dt);
    this.goalFlash = Math.max(0, this.goalFlash - dt);
    this.drawScreen(world);
  }

  /** The big screen: Poké Ball + score + clock, GOAL! flash, and the current floor mark. */
  private drawScreen(world: World): void {
    const m = world.match;
    const secs = Math.floor(m.roundTicks / TICK_RATE);
    const flash = this.goalFlash > 0 ? Math.floor(this.goalFlash * 4) % 2 : -1;
    const key = `${m.goals[0]}-${m.goals[1]}-${m.sets[0]}-${m.sets[1]}-${secs}-${m.overtime}-${flash}-${this.floorName}-${this.ballIcon.complete}`;
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
      g.fillStyle = flash ? ['#3d7bff', '#ff4d5e'][this.goalTeam]! : '#ffffff';
      g.font = 'bold 110px system-ui, sans-serif';
      g.fillText('GOAL!', c.width / 2, c.height / 2 + 6);
      return;
    }
    if (this.ballIcon.complete && this.ballIcon.naturalWidth) g.drawImage(this.ballIcon, c.width / 2 - 30, 14, 60, 60);
    const mark = this.markIcons.get(this.floorName);
    if (mark?.complete && mark.naturalWidth) g.drawImage(mark, 18, c.height - 74, 56, 56);
    g.font = 'bold 84px system-ui, sans-serif';
    g.fillStyle = '#3d7bff';
    g.fillText(String(m.goals[0]), c.width / 2 - 120, 112);
    g.fillStyle = '#ff4d5e';
    g.fillText(String(m.goals[1]), c.width / 2 + 120, 112);
    g.fillStyle = '#ffffff';
    g.font = 'bold 40px system-ui, sans-serif';
    g.fillText(`${m.overtime ? 'OT ' : ''}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, c.width / 2, 112);
    const pip = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, gameplay.match.setsToWin - n));
    g.font = 'bold 30px system-ui, sans-serif';
    g.fillStyle = '#3d7bff';
    g.fillText(pip(m.sets[0]), c.width / 2 - 120, 176);
    g.fillStyle = '#ff4d5e';
    g.fillText(pip(m.sets[1]), c.width / 2 + 120, 176);
    g.fillStyle = '#c9d2ef';
    g.font = 'bold 22px system-ui, sans-serif';
    g.fillText('POKéMON STADIUM 2', c.width / 2, 176);
    this.screenTex.needsUpdate = true;
  }
}

/** Night lighting for the Brawl stadium. */
export function brawlLighting(scene: THREE.Scene, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight): void {
  const sky = 0x0a1230;
  scene.background = new THREE.Color(sky);
  (scene.fog as THREE.Fog).color.set(sky);
  hemi.color.set(0xdbe6ff);
  hemi.groundColor.set(0x1c2440);
  hemi.intensity = 1.6;
  sun.color.set(0xfff1d6);
  sun.intensity = 2.3;
  sun.position.set(-18, 38, 26);
}

export const isBrawl = (stage: Stage): boolean => stage.theme === 'stadium-brawl';
