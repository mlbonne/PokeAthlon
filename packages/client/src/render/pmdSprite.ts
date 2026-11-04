import * as THREE from 'three';
import type { SpriteAnim, SpriteManifest } from '@pokeathlon/data';
import { PIXEL } from './units';

/**
 * PMD sprite sheets have 8 rows, one per facing, in this order:
 * Down, DownRight, Right, UpRight, Up, UpLeft, Left, DownLeft.
 */
const DIRECTIONS = 8;

/** Facing vector (+y = up the screen) → PMD row. */
export function facingRow(fx: number, fy: number): number {
  if (fx === 0 && fy === 0) return 0;
  const octant = Math.round(Math.atan2(fy, fx) / (Math.PI / 4)); // -4..4, 0 = right
  return (((2 + octant) % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
}

const loader = new THREE.TextureLoader();
const textureCache = new Map<string, Promise<THREE.Texture>>();

function loadTexture(url: string): Promise<THREE.Texture> {
  let p = textureCache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((t) => {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    textureCache.set(url, p);
  }
  return p;
}

const manifestCache = new Map<string, Promise<SpriteManifest>>();
export function loadManifest(dex: string): Promise<SpriteManifest> {
  let p = manifestCache.get(dex);
  if (!p) {
    p = fetch(`sprites/${dex}/anim.json`).then((r) => {
      if (!r.ok) throw new Error(`Missing sprite manifest for ${dex}`);
      return r.json() as Promise<SpriteManifest>;
    });
    manifestCache.set(dex, p);
  }
  return p;
}

interface LoadedAnim {
  def: SpriteAnim;
  texture: THREE.Texture;
  columns: number;
  totalTicks: number;
}

/**
 * A camera-facing PMD sprite. Owns its own texture clones so frame offsets
 * are per-instance; the image data is shared through the cache.
 */
export class PmdSprite {
  readonly object = new THREE.Group();
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly shadow: THREE.Mesh;
  private anims = new Map<string, LoadedAnim>();
  private current: LoadedAnim | undefined;
  private currentName = '';
  private ticks = 0;
  private oneShot = false;
  private oneShotRate = 1;
  dex = '';

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, depthWrite: true });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.renderOrder = 2;
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.object.add(this.shadow, this.mesh);
  }

  async load(dex: string): Promise<void> {
    this.dex = dex;
    const manifest = await loadManifest(dex);
    const entries = await Promise.all(
      Object.entries(manifest.anims).map(async ([name, def]) => {
        const base = await loadTexture(`sprites/${dex}/${def.file}`);
        const texture = base.clone();
        const sheetWidth = (base.image as HTMLImageElement).width;
        texture.repeat.set(def.frameWidth / sheetWidth, 1 / DIRECTIONS);
        const columns = Math.round(sheetWidth / def.frameWidth);
        const totalTicks = def.durations.reduce((a, b) => a + b, 0);
        return [name, { def, texture, columns, totalTicks }] as const;
      }),
    );
    if (this.dex !== dex) return; // a newer load() superseded this one
    this.anims = new Map(entries);
    // Shadow size classes 0/1/2 → small/medium/large ellipse.
    const r = [10, 14, 20][manifest.shadowSize] ?? 14;
    this.shadow.scale.set(r * PIXEL, r * PIXEL * 0.55, 1);
    this.currentName = '';
    this.play('Idle');
  }

  /** True while a one-shot animation (e.g. Attack) is playing. */
  get busy(): boolean {
    return this.oneShot;
  }

  /** Play an animation once at `rate`, then fall back to whatever `play()` asks for next. */
  playOnce(name: string, rate = 1): void {
    if (!this.anims.has(name)) return;
    this.oneShot = false; // allow restarting over a running one-shot
    this.currentName = '';
    this.play(name);
    this.oneShot = true;
    this.oneShotRate = rate;
  }

  play(name: string): void {
    if (this.oneShot) return;
    if (name === this.currentName) return;
    const a = this.anims.get(name) ?? this.anims.get('Idle');
    if (!a) return;
    this.currentName = name;
    this.current = a;
    this.ticks = 0;
    this.mesh.material.map = a.texture;
    this.mesh.material.needsUpdate = true;
    this.mesh.scale.set(a.def.frameWidth * PIXEL, a.def.frameHeight * PIXEL, 1);
    // PMD frames are centred on the body; lift so the body centre sits ~8 px above the ground.
    this.mesh.position.y = 8 * PIXEL;
  }

  /** Advance animation by `dtSeconds` (scaled by `rate`) and show `row`. */
  update(dtSeconds: number, row: number, rate = 1): void {
    const a = this.current;
    if (!a) return;
    if (this.oneShot) {
      this.ticks += dtSeconds * 60 * this.oneShotRate;
      if (this.ticks >= a.totalTicks) {
        this.oneShot = false;
        this.currentName = '';
        this.ticks = a.totalTicks - 1e-6; // hold last frame until the next play()
      }
    } else {
      this.ticks = (this.ticks + dtSeconds * 60 * rate) % a.totalTicks;
    }
    let t = this.ticks;
    let frame = 0;
    for (; frame < a.def.durations.length - 1; frame++) {
      t -= a.def.durations[frame]!;
      if (t < 0) break;
    }
    const col = Math.min(frame, a.columns - 1);
    a.texture.offset.set(col / a.columns, 1 - (row + 1) / DIRECTIONS);
  }

  /** Fade (Evade/immunity) and hide (KO). */
  setOpacity(alpha: number): void {
    const mat = this.mesh.material;
    mat.opacity = alpha;
    mat.alphaTest = alpha < 1 ? 0.05 : 0.5;
    mat.depthWrite = alpha >= 1;
  }

  /** Face the camera (full billboard, like most 2.5D sprite games). */
  faceCamera(camera: THREE.Camera): void {
    this.mesh.quaternion.copy(camera.quaternion);
  }
}
