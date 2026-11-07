import * as THREE from 'three';

/**
 * Ground aura under a player that tells sides apart even in mirror matches: white for your team,
 * red for opponents. A soft glowing disc plus a thin pulsing rim, sized to the body.
 */
let glowTexture: THREE.Texture | null = null;
function glow(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.0)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export const AURA_ALLY = 0xffffff;
export const AURA_ENEMY = 0xff2a3d;

export class TeamAura {
  readonly object = new THREE.Group();
  private readonly disc: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly rim: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private phase = Math.random() * Math.PI * 2;

  /** @param radius ground radius in three.js units */
  constructor(color: number, radius: number) {
    this.disc = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: glow(), color, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    this.rim = new THREE.Mesh(
      new THREE.RingGeometry(0.84, 1, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    for (const m of [this.disc, this.rim]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
    }
    this.disc.position.y = 0.012;
    this.rim.position.y = 0.014;
    this.object.add(this.disc, this.rim);
    this.object.scale.setScalar(radius);
  }

  setColor(color: number): void {
    this.disc.material.color.setHex(color);
    this.rim.material.color.setHex(color);
  }

  update(dt: number): void {
    this.phase += dt * 3;
    this.rim.material.opacity = 0.75 + 0.2 * Math.sin(this.phase);
  }
}
