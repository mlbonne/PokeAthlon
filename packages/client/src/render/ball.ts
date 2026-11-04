import * as THREE from 'three';
import { WORLD_TO_THREE } from './units';

/** Top-face print: a Poké Ball seen from above, drawn on a canvas (no external asset). */
function pokeBallPrint(): THREE.CanvasTexture {
  const n = 512;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d')!;
  const r = n / 2;
  g.translate(r, r);

  // Body: red top half, white bottom half.
  g.fillStyle = '#e8402a';
  g.beginPath();
  g.arc(0, 0, r, Math.PI, 0);
  g.fill();
  g.fillStyle = '#f5f5f2';
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI);
  g.fill();
  // Shading highlight on the red half.
  const hl = g.createRadialGradient(-r * 0.35, -r * 0.45, 0, -r * 0.35, -r * 0.45, r * 0.7);
  hl.addColorStop(0, 'rgba(255,255,255,0.35)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl;
  g.beginPath();
  g.arc(0, 0, r, Math.PI, 0);
  g.fill();
  // Centre band.
  g.fillStyle = '#1d1d24';
  g.fillRect(-r, -r * 0.075, n, r * 0.15);
  // Button.
  g.beginPath();
  g.arc(0, 0, r * 0.27, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f5f5f2';
  g.beginPath();
  g.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#c9c9c4';
  g.lineWidth = r * 0.03;
  g.beginPath();
  g.arc(0, 0, r * 0.12, 0, Math.PI * 2);
  g.stroke();
  // Outer rim.
  g.strokeStyle = '#1d1d24';
  g.lineWidth = r * 0.06;
  g.beginPath();
  g.arc(0, 0, r * 0.97, 0, Math.PI * 2);
  g.stroke();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const TRAIL = 16;
const GLOW_COLOR = new THREE.Color(0xffe066);
const RED_COLOR = new THREE.Color(0xff3b2f);

/** The ball as a sliding puck (OS Core) with a Poké Ball print on top. */
export class BallView {
  readonly object = new THREE.Group();
  private readonly puck = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly glow: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly trail: THREE.InstancedMesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly trailPts: THREE.Vector3[] = [];
  private readonly radius: number;
  private readonly height: number;
  private readonly tmpM = new THREE.Matrix4();
  private readonly flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private readonly tmpS = new THREE.Vector3();
  private pulse = 0;
  private spin = 0;

  /**
   * @param radiusWorld ball radius in world units
   * @param glowSpeedWorld speed (world u/s) above which the glow and trail show (OS: 700)
   */
  constructor(
    radiusWorld: number,
    private readonly glowSpeedWorld: number,
  ) {
    this.radius = radiusWorld * WORLD_TO_THREE;
    this.height = this.radius * 0.42;

    const side = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.45, metalness: 0.3 });
    const top = new THREE.MeshStandardMaterial({ map: pokeBallPrint(), roughness: 0.4 });
    const bottom = new THREE.MeshStandardMaterial({ color: 0x1d1d24, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(this.radius, this.radius, this.height, 48), [
      side,
      top,
      bottom,
    ]);
    body.position.y = this.height / 2;
    // Thin white stripe around the rim so the side reads at a distance.
    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(this.radius * 1.005, this.radius * 1.005, this.height * 0.18, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.5 }),
    );
    stripe.position.y = this.height / 2;
    this.puck.add(body, stripe);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius * 1.08, 40),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;

    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(this.radius * 1.12, this.radius * 1.45, 48),
      new THREE.MeshBasicMaterial({ color: GLOW_COLOR, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;

    this.trail = new THREE.InstancedMesh(
      new THREE.CircleGeometry(this.radius * 0.85, 24),
      new THREE.MeshBasicMaterial({ color: GLOW_COLOR, transparent: true, opacity: 0.32, depthWrite: false }),
      TRAIL,
    );
    this.trail.frustumCulled = false;
    this.trail.count = 0;

    this.object.add(this.shadow, this.glow, this.trail, this.puck);
  }

  /** Visual punch when the ball is hit; `turn` is the sign of the spin to add. */
  hit(turn: number): void {
    this.pulse = 1;
    this.spin += turn * 14;
  }

  /**
   * @param x,z  position in Three units
   * @param vx,vz velocity in Three units / s
   * @param frozen true during hitstop (shake in place)
   * @param red Red Core state
   */
  update(dt: number, x: number, z: number, vx: number, vz: number, frozen: boolean, red: boolean): void {
    const speedWorld = Math.hypot(vx, vz) / WORLD_TO_THREE;
    const shake = frozen ? 0.06 : 0;
    this.puck.position.set(x + (Math.random() - 0.5) * shake, 0, z + (Math.random() - 0.5) * shake);
    this.shadow.position.set(x + 0.08, 0.011, z + 0.08);
    this.glow.position.set(x, 0.014, z);

    // A sliding puck doesn't roll: it spins about its axis, more when moving fast.
    this.spin *= Math.exp(-dt * 1.5);
    this.puck.rotation.y += (this.spin + Math.sign(this.spin || 1) * speedWorld * 0.0015) * dt;

    this.pulse = Math.max(0, this.pulse - dt * 6);
    const s = 1 + this.pulse * 0.25;
    this.puck.scale.set(s, 1 + this.pulse * 0.5, s);

    const color = red ? RED_COLOR : GLOW_COLOR;
    this.glow.material.color.copy(color);
    this.trail.material.color.copy(color);
    const fast = speedWorld > this.glowSpeedWorld;
    const k = fast ? Math.min(1, (speedWorld - this.glowSpeedWorld) / 1300) : 0;
    this.glow.material.opacity = (fast ? 0.35 + k * 0.5 : 0) + this.pulse * 0.4 + (red ? 0.3 : 0);

    // Trail of fading ground discs while faster than the glow threshold (OS: yellow trail > 700).
    this.trailPts.unshift(new THREE.Vector3(x, 0.013, z));
    if (this.trailPts.length > TRAIL) this.trailPts.pop();
    let n = 0;
    if (fast) {
      for (let i = 2; i < this.trailPts.length; i++) {
        const f = 1 - i / TRAIL;
        this.tmpS.set(f, f, f);
        this.tmpM.compose(this.trailPts[i]!, this.flatQ, this.tmpS);
        this.trail.setMatrixAt(n++, this.tmpM);
      }
    }
    this.trail.count = n;
    this.trail.instanceMatrix.needsUpdate = true;
  }
}
