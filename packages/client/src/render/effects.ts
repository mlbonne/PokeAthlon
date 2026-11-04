import * as THREE from 'three';

interface Burst {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
  maxScale: number;
}

/** Short-lived ground effects (impact rings) and camera shake. */
export class Effects {
  readonly object = new THREE.Group();
  private bursts: Burst[] = [];
  private shakeAmp = 0;
  private readonly geo = new THREE.RingGeometry(0.85, 1, 48);

  /** Expanding ring on the ground at (x, z) Three units. */
  ring(x: number, z: number, color: number, size: number, life = 0.3): void {
    const mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    mesh.scale.setScalar(0.2);
    this.object.add(mesh);
    this.bursts.push({ mesh, age: 0, life, maxScale: size });
  }

  /** Add camera shake (Three units of amplitude). */
  shake(amount: number): void {
    this.shakeAmp = Math.min(0.45, Math.max(this.shakeAmp, amount));
  }

  update(dt: number): void {
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.6);
    this.bursts = this.bursts.filter((b) => {
      b.age += dt;
      const t = Math.min(1, b.age / b.life);
      const ease = 1 - (1 - t) * (1 - t);
      b.mesh.scale.setScalar(0.2 + (b.maxScale - 0.2) * ease);
      b.mesh.material.opacity = 0.9 * (1 - t);
      if (t >= 1) {
        this.object.remove(b.mesh);
        b.mesh.material.dispose();
        return false;
      }
      return true;
    });
  }

  /** Offset to add to the camera position this frame. */
  shakeOffset(): THREE.Vector3 {
    const a = this.shakeAmp;
    return new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.5, (Math.random() - 0.5) * a);
  }
}
