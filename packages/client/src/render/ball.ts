import * as THREE from 'three';
import { WORLD_TO_THREE } from './units';

/** Equirectangular Poké Ball texture drawn on a canvas (no external asset). */
function pokeBallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8402a';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 64, 256, 64);
  g.fillStyle = '#1d1d24';
  g.fillRect(0, 58, 256, 12);
  // Button on two opposite sides so it is visible while rolling.
  for (const u of [64, 192]) {
    g.beginPath();
    g.arc(u, 64, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f4f4f4';
    g.beginPath();
    g.arc(u, 64, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1d1d24';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TRAIL = 14;

export class BallView {
  readonly object = new THREE.Group();
  private readonly sphere: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly glow: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly trail: THREE.InstancedMesh;
  private readonly trailPts: THREE.Vector3[] = [];
  private readonly radius: number;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpAxis = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private pulse = 0;

  constructor(radiusWorld: number) {
    this.radius = radiusWorld * WORLD_TO_THREE;
    this.sphere = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 32, 16),
      new THREE.MeshStandardMaterial({ map: pokeBallTexture(), roughness: 0.35, metalness: 0.05 }),
    );
    this.sphere.position.y = this.radius;

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius * 1.05, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;

    // Ground ring that brightens with speed: the "core" readability cue.
    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(this.radius * 1.15, this.radius * 1.4, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.014;

    this.trail = new THREE.InstancedMesh(
      new THREE.CircleGeometry(this.radius * 0.8, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.35, depthWrite: false }),
      TRAIL,
    );
    this.trail.frustumCulled = false;
    this.trail.count = 0;

    this.object.add(this.shadow, this.glow, this.trail, this.sphere);
  }

  /** Visual punch when the ball is hit. */
  hit(): void {
    this.pulse = 1;
  }

  /**
   * @param x,z  position in Three units
   * @param vx,vz velocity in Three units / s
   * @param frozen true during hitstop (shake in place)
   */
  update(dt: number, x: number, z: number, vx: number, vz: number, frozen: boolean): void {
    const speed = Math.hypot(vx, vz);
    const shake = frozen ? 0.05 : 0;
    this.sphere.position.set(x + (Math.random() - 0.5) * shake, this.radius, z + (Math.random() - 0.5) * shake);
    this.shadow.position.set(x, 0.012, z);
    this.glow.position.set(x, 0.014, z);

    // Roll: rotate around (up × velocity).
    if (speed > 1e-4) {
      this.tmpAxis.set(vz, 0, -vx).normalize();
      this.tmpQ.setFromAxisAngle(this.tmpAxis, (speed * dt) / this.radius);
      this.sphere.quaternion.premultiply(this.tmpQ);
    }

    this.pulse = Math.max(0, this.pulse - dt * 6);
    const s = 1 + this.pulse * 0.35;
    this.sphere.scale.setScalar(s);

    const fast = Math.min(1, speed / 20); // ~2000 u/s → 1
    this.glow.material.opacity = 0.18 + fast * 0.5 + this.pulse * 0.4;

    // Trail of fading ground discs while fast.
    this.trailPts.unshift(new THREE.Vector3(x, 0.013, z));
    if (this.trailPts.length > TRAIL) this.trailPts.pop();
    let n = 0;
    if (speed > 7) {
      for (let i = 2; i < this.trailPts.length; i++) {
        const k = 1 - i / TRAIL;
        this.tmpM.compose(
          this.trailPts[i]!,
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
          new THREE.Vector3(k, k, k),
        );
        this.trail.setMatrixAt(n++, this.tmpM);
      }
    }
    this.trail.count = n;
    this.trail.instanceMatrix.needsUpdate = true;
  }
}
