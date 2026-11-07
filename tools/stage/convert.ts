import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/**
 * Pokémon Stadium 2 (Super Smash Bros. Brawl) → GLB converter.
 *
 * Run through the dev-only Vite app:
 *   npx vite --config tools/stage/vite.config.ts
 *   http://localhost:5199/convert.html?run=1
 *
 * The source files are BrawlBox COLLADA exports. They are already skinned to one bone per vertex,
 * so the bind pose can be baked exactly and every triangle assigned to its dominant bone. The
 * converter keeps the source's model units (centimetres); the renderer applies the 0.18 scale.
 */

const SOURCES = [
  'StgStadium00.dae',
  'StgStadium00AshibaL.dae',
  'StgStadium00AshibaR.dae',
  'StgStadium00AuroraVision.dae',
  'StgStadium00Conveyor.dae',
  'StgStadium00Denki.dae',
  'StgStadium00DenkiRing.dae',
  'StgStadium00Hikou.dae',
  'StgStadium00Koori.dae',
  'StgStadium00SeachLight.dae',
  'StgStadium00Tuchi.dae',
  'EffStgStadiumKemuri.dae',
  'gr2_StgStadium00Denki_ashiba.dae',
  'gr2_StgStadium00Koori_ashiba.dae',
] as const;

const MARKS = ['MarkNormal01.png', 'MarkDenki01.png', 'MarkKouri01.png', 'MarkHikou01.png', 'MarkZimen01.png'] as const;

/** Materials that are alpha cut-outs in the source textures. */
const CUTOUT = [/^alpha\d/i, /^light\d/i, /^ami\d/i, /kazeami/i];
/** Glass panels: the DAE has no <transparent>, but the textures carry an alpha edge. */
const GLASS = [/^glass/i];
/** The soft blob shadow under the floor. */
const SHADOW = [/shadow/i];

const Y_GROUND = 2;

/** BrawlBox names bones from the node sid, which carries a "-ID" suffix (e.g. "StudiumMain-ID"). */
function boneName(name: string): string {
  return name.replace(/-ID$/, '');
}

interface BakedMesh {
  source: string;
  bone: string;
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
}

interface BakedScene {
  source: string;
  meshes: BakedMesh[];
  anchors: Record<string, [number, number, number]>;
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

const logEl = document.getElementById('log') as HTMLPreElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;

function log(message: string): void {
  logEl.textContent += `${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function boundsOf(object: THREE.Object3D): Bounds | null {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

function footprintOf(bounds: Bounds | null): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (!bounds) return null;
  return { minX: bounds.min[0], maxX: bounds.max[0], minZ: bounds.min[2], maxZ: bounds.max[2] };
}

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function attrComponent(attr: AnyAttribute, index: number, component: number): number {
  switch (component) {
    case 0:
      return attr.getX(index);
    case 1:
      return attr.getY(index);
    case 2:
      return attr.getZ(index);
    default:
      return attr.getW(index);
  }
}

/** The source has one weight per vertex; still handle up to four influences. */
function dominantBone(mesh: THREE.SkinnedMesh, index: number): number {
  const skinIndex = mesh.geometry.getAttribute('skinIndex');
  const skinWeight = mesh.geometry.getAttribute('skinWeight');
  if (!skinIndex || !skinWeight) return -1;
  let best = -1;
  let bestWeight = -1;
  for (let k = 0; k < 4; k++) {
    const weight = attrComponent(skinWeight, index, k);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = attrComponent(skinIndex, index, k);
    }
  }
  return best;
}

function prepareMaterial(source: THREE.Material, cache: Map<string, THREE.Material>): THREE.Material {
  const hit = cache.get(source.uuid);
  if (hit) return hit;
  const material = source.clone();
  const name = source.name || '';
  const textured = material as THREE.MeshPhongMaterial;
  if (textured.map) {
    textured.map.colorSpace = THREE.SRGBColorSpace;
    textured.map.wrapS = THREE.RepeatWrapping;
    textured.map.wrapT = THREE.RepeatWrapping;
    textured.map.magFilter = THREE.LinearFilter;
    textured.map.minFilter = THREE.LinearMipmapLinearFilter;
    textured.map.needsUpdate = true;
  }
  if (CUTOUT.some((re) => re.test(name))) {
    material.transparent = true;
    material.alphaTest = 0.5;
    material.depthWrite = true;
  } else if (GLASS.some((re) => re.test(name))) {
    material.transparent = true;
    material.opacity = Math.min(material.opacity, 0.55);
    material.depthWrite = false;
  } else if (SHADOW.some((re) => re.test(name))) {
    material.transparent = true;
    material.alphaTest = 0.01;
    material.depthWrite = false;
  }
  cache.set(source.uuid, material);
  return material;
}

/** Build a new indexed geometry from a subset of triangles of a baked geometry. */
function subGeometry(geometry: THREE.BufferGeometry, triangles: number[]): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const color = geometry.getAttribute('color');
  const index = geometry.getIndex();
  if (!position || !index) throw new Error('baked geometry must be indexed');
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const old of triangles) {
    let next = remap.get(old);
    if (next === undefined) {
      next = remap.size;
      remap.set(old, next);
      positions.push(position.getX(old), position.getY(old), position.getZ(old));
      if (uv) uvs.push(uv.getX(old), uv.getY(old));
      if (color) {
        colors.push(color.getX(old), color.getY(old), color.getZ(old));
        if (color.itemSize === 4) colors.push(color.getW(old));
      }
    }
    indices.push(next);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (color) out.setAttribute('color', new THREE.Float32BufferAttribute(colors, color.itemSize));
  out.setIndex(indices);
  out.computeVertexNormals();
  return out;
}

function triangleIndices(geometry: THREE.BufferGeometry): number[] {
  const index = geometry.getIndex();
  if (!index) throw new Error('baked geometry must be indexed');
  const out: number[] = [];
  for (let i = 0; i < index.count; i++) out.push(index.getX(i));
  return out;
}

/** Split one baked bone piece into ground (centroid y < 2) and props (the rest). */
function splitByY(mesh: BakedMesh, threshold: number): { ground: THREE.BufferGeometry | null; props: THREE.BufferGeometry | null } {
  const position = mesh.geometry.getAttribute('position');
  if (!position) return { ground: null, props: null };
  const tris = triangleIndices(mesh.geometry);
  const ground: number[] = [];
  const props: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i]!;
    const b = tris[i + 1]!;
    const c = tris[i + 2]!;
    const y = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    (y < threshold ? ground : props).push(a, b, c);
  }
  return {
    ground: ground.length ? subGeometry(mesh.geometry, ground) : null,
    props: props.length ? subGeometry(mesh.geometry, props) : null,
  };
}

async function bake(file: string): Promise<BakedScene> {
  const manager = new THREE.LoadingManager();
  let resolveLoaded!: () => void;
  const allLoaded = new Promise<void>((resolve) => {
    resolveLoaded = resolve;
  });
  manager.onLoad = () => resolveLoaded();

  const loader = new ColladaLoader(manager);
  loader.setResourcePath('/');
  log(`  load /_dae14/${file}`);
  const result = await loader.loadAsync(`/_dae14/${file}`);
  if (!result) throw new Error(`${file}: ColladaLoader returned null`);
  await allLoaded;

  const root = result.scene;
  // ColladaLoader applies <unit meter="0.01">. Undo it: keep the source's centimetre coordinates.
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const anchors: Record<string, [number, number, number]> = {};
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone) {
      const p = new THREE.Vector3();
      object.getWorldPosition(p);
      anchors[boneName(object.name)] = [p.x, p.y, p.z];
    }
  });

  const meshes: BakedMesh[] = [];
  const materialCache = new Map<string, THREE.Material>();
  const vertex = new THREE.Vector3();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return;
    const uv = geometry.getAttribute('uv');
    const color = geometry.getAttribute('color');
    const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!sourceMaterial) return;
    const material = prepareMaterial(sourceMaterial, materialCache);

    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
    const skinnedMesh = mesh as THREE.SkinnedMesh;
    const boneNames = skinned ? skinnedMesh.skeleton.bones.map((bone) => bone.name) : [];

    const positions = new Float32Array(position.count * 3);
    const uvs = uv ? new Float32Array(uv.count * 2) : null;
    const colors = color ? new Float32Array(color.count * color.itemSize) : null;
    const boneOf = new Int32Array(position.count);

    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      if (skinned) skinnedMesh.applyBoneTransform(i, vertex);
      vertex.applyMatrix4(mesh.matrixWorld);
      positions[i * 3] = vertex.x;
      positions[i * 3 + 1] = vertex.y;
      positions[i * 3 + 2] = vertex.z;
      if (uvs && uv) {
        uvs[i * 2] = uv.getX(i);
        uvs[i * 2 + 1] = uv.getY(i);
      }
      if (colors && color) {
        for (let k = 0; k < color.itemSize; k++) colors[i * color.itemSize + k] = attrComponent(color, i, k);
      }
      boneOf[i] = skinned ? dominantBone(skinnedMesh, i) : -1;
    }

    const index = geometry.getIndex();
    const triangleCount = index ? index.count / 3 : position.count / 3;
    const groups = new Map<string, number[]>();
    for (let t = 0; t < triangleCount; t++) {
      const a = index ? index.getX(t * 3) : t * 3;
      const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const votes = new Map<string, number>();
      for (const v of [a, b, c]) {
        const boneIndex = boneOf[v]!;
        const name = boneIndex >= 0 ? boneName(boneNames[boneIndex] ?? 'bone') : mesh.name || 'mesh';
        votes.set(name, (votes.get(name) ?? 0) + 1);
      }
      let bone = '';
      let best = -1;
      for (const [name, count] of votes) {
        if (count > best) {
          best = count;
          bone = name;
        }
      }
      let triangles = groups.get(bone);
      if (!triangles) {
        triangles = [];
        groups.set(bone, triangles);
      }
      triangles.push(a, b, c);
    }

    for (const [bone, triangles] of groups) {
      const baked = new THREE.BufferGeometry();
      baked.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      if (uvs) baked.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      if (colors) baked.setAttribute('color', new THREE.Float32BufferAttribute(colors, color!.itemSize));
      baked.setIndex(triangles);
      const piece = subGeometry(baked, triangles);
      meshes.push({ source: file, bone, material, geometry: piece });
      baked.dispose();
    }

    geometry.dispose();
  });

  return { source: file, meshes, anchors };
}

function meshOf(piece: BakedMesh): THREE.Mesh {
  const mesh = new THREE.Mesh(piece.geometry, piece.material);
  mesh.name = piece.bone;
  mesh.userData.bone = piece.bone;
  mesh.userData.source = piece.source;
  return mesh;
}

function collect(baked: Map<string, BakedScene>, sources: readonly string[], bones?: readonly string[]): BakedMesh[] {
  const out: BakedMesh[] = [];
  for (const source of sources) {
    const scene = baked.get(source);
    if (!scene) throw new Error(`not baked: ${source}`);
    for (const piece of scene.meshes) {
      if (bones && !bones.includes(piece.bone)) continue;
      out.push(piece);
    }
  }
  return out;
}

function floorGroup(name: string, pieces: BakedMesh[], forceProps: readonly string[]): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  const ground = new THREE.Group();
  ground.name = 'ground';
  const props = new THREE.Group();
  props.name = 'props';
  for (const piece of pieces) {
    if (forceProps.includes(piece.bone)) {
      props.add(meshOf(piece));
      continue;
    }
    const split = splitByY(piece, Y_GROUND);
    if (split.ground) {
      const mesh = new THREE.Mesh(split.ground, piece.material);
      mesh.name = piece.bone;
      mesh.userData.bone = piece.bone;
      mesh.userData.source = piece.source;
      ground.add(mesh);
    }
    if (split.props) {
      const mesh = new THREE.Mesh(split.props, piece.material);
      mesh.name = piece.bone;
      mesh.userData.bone = piece.bone;
      mesh.userData.source = piece.source;
      props.add(mesh);
    }
  }
  root.add(ground, props);
  return root;
}

async function writeFile(path: string, data: ArrayBuffer | string): Promise<void> {
  const response = await fetch(`/__stage/write?path=${encodeURIComponent(path)}`, { method: 'POST', body: data });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
}

async function exportGroup(group: THREE.Group, path: string): Promise<FileInfo> {
  const exporter = new GLTFExporter();
  const data = await exporter.parseAsync(group, { binary: true, onlyVisible: false, trs: false });
  if (!(data instanceof ArrayBuffer)) throw new Error(`${path}: expected binary GLB`);
  await writeFile(path, data);
  const groups: FileInfo['groups'] = {};
  for (const child of group.children) {
    if (!child.name) continue;
    const bounds = boundsOf(child);
    groups[child.name] = { bounds, footprint: footprintOf(bounds) };
  }
  log(`  wrote ${path} (${(data.byteLength / 1024).toFixed(0)} kB)`);
  return {
    url: path,
    bytes: data.byteLength,
    bounds: boundsOf(group),
    ...(Object.keys(groups).length ? { groups } : {}),
  };
}

async function copyMarks(): Promise<string[]> {
  for (const name of MARKS) {
    const response = await fetch(`/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    await writeFile(`marks/${name}`, await response.arrayBuffer());
    log(`  wrote marks/${name}`);
  }
  return [...MARKS];
}

async function run(): Promise<void> {
  runBtn.disabled = true;
  const started = performance.now();
  try {
    log(`Pokémon Stadium 2 converter — ${SOURCES.length} COLLADA files`);
    const baked = new Map<string, BakedScene>();
    for (const file of SOURCES) {
      baked.set(file, await bake(file));
      log(`  baked ${file} (${baked.get(file)!.meshes.length} bone pieces)`);
    }

    const files: Record<string, FileInfo> = {};
    const floors: Record<string, { file: string; ground: GroupInfo | null; props: GroupInfo | null }> = {};

    // The static stadium shell: stands and roof. The floor (and its blob shadow) is a separate variant.
    const stadium = new THREE.Group();
    stadium.name = 'stadium';
    for (const piece of collect(baked, ['StgStadium00.dae'], ['StudiumMain', 'StudiumDoom'])) stadium.add(meshOf(piece));
    files['stadium.glb'] = await exportGroup(stadium, 'stadium.glb');

    const sky = new THREE.Group();
    sky.name = 'sky';
    for (const piece of collect(baked, ['StgStadium00.dae'], ['SkyMain'])) sky.add(meshOf(piece));
    files['sky.glb'] = await exportGroup(sky, 'sky.glb');

    const screen = new THREE.Group();
    screen.name = 'screen';
    const frame = new THREE.Group();
    frame.name = 'frame';
    for (const piece of collect(baked, ['StgStadium00.dae'], ['MoniterMain'])) frame.add(meshOf(piece));
    screen.add(frame);
    const aurora = new THREE.Group();
    aurora.name = 'aurora';
    for (const piece of collect(baked, ['StgStadium00AuroraVision.dae'])) aurora.add(meshOf(piece));
    screen.add(aurora);
    files['screen.glb'] = await exportGroup(screen, 'screen.glb');

    const searchlights = new THREE.Group();
    searchlights.name = 'searchlights';
    for (const piece of collect(baked, ['StgStadium00SeachLight.dae'])) searchlights.add(meshOf(piece));
    files['searchlights.glb'] = await exportGroup(searchlights, 'searchlights.glb');

    const platforms = new THREE.Group();
    platforms.name = 'platforms';
    for (const source of ['StgStadium00AshibaL.dae', 'StgStadium00AshibaR.dae'] as const) {
      const group = new THREE.Group();
      group.name = source.includes('AshibaL') ? 'AshibaL' : 'AshibaR';
      for (const piece of collect(baked, [source])) group.add(meshOf(piece));
      platforms.add(group);
    }
    files['platforms.glb'] = await exportGroup(platforms, 'platforms.glb');

    const smoke = new THREE.Group();
    smoke.name = 'smoke';
    for (const piece of collect(baked, ['EffStgStadiumKemuri.dae'])) smoke.add(meshOf(piece));
    files['smoke.glb'] = await exportGroup(smoke, 'smoke.glb');

    const floorDefs = [
      { name: 'normal', sources: ['StgStadium00.dae'] as const, bones: ['StageMain'] as const, forceProps: [] as const },
      {
        name: 'electric',
        sources: ['StgStadium00Denki.dae', 'StgStadium00DenkiRing.dae', 'StgStadium00Conveyor.dae', 'gr2_StgStadium00Denki_ashiba.dae'] as const,
        bones: undefined,
        forceProps: ['EnbanMain', 'EnbanSub', 'conveyor01', 'conveyor02'] as const,
      },
      {
        name: 'ice',
        sources: ['StgStadium00Koori.dae', 'gr2_StgStadium00Koori_ashiba.dae'] as const,
        bones: undefined,
        forceProps: [] as const,
      },
      {
        name: 'flying',
        sources: ['StgStadium00Hikou.dae'] as const,
        bones: undefined,
        forceProps: [
          'HikouHusya1',
          'HikouHusya2',
          'HikouHusya3',
          'Hane01',
          'Hane01_1',
          'Hane01_2',
          'kazeBA01',
          'kazeBA02',
          'kazeBA03',
          'kazeBA04',
          'puroperaB02',
          'puroperaB03',
          'puroperaB04',
          'puroperaB05',
        ] as const,
      },
      {
        name: 'ground',
        sources: ['StgStadium00Tuchi.dae'] as const,
        bones: undefined,
        forceProps: [
          'TuchiItaA01',
          'TuchiItaB01',
          'TuchiItaC01',
          'TuchiItaC02',
          'sunayama',
          'tetuitaA01',
          'Dugtorio1',
          'Dugtorio2',
          'Karakara1',
          'Karakara2',
        ] as const,
      },
    ];

    for (const def of floorDefs) {
      const pieces = collect(baked, def.sources, def.bones);
      const group = floorGroup(def.name, pieces, def.forceProps);
      const file = `floor-${def.name}.glb`;
      files[file] = await exportGroup(group, file);
      const info = files[file]!;
      floors[def.name] = { file, ground: info.groups?.ground ?? null, props: info.groups?.props ?? null };
    }

    const marks = await copyMarks();

    const manifest = {
      source: 'Pokémon Stadium 2, Super Smash Bros. Brawl (Nintendo / HAL Laboratory). BrawlBox COLLADA export.',
      units: 'centimetres (model units); renderer scale 0.18 three.js units per model unit',
      scale: 0.18,
      groundThreshold: Y_GROUND,
      files,
      floors,
      marks,
      anchors: Object.fromEntries([...baked].map(([file, scene]) => [file, scene.anchors])),
    };
    await writeFile('manifest.json', JSON.stringify(manifest, null, 2));
    log(`  wrote manifest.json`);
    log(`\nDone in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
  } catch (error) {
    console.error(error);
    log(`\nERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener('click', () => void run());
if (new URLSearchParams(location.search).has('run')) void run();
