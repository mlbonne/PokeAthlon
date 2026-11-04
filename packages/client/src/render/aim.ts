import * as THREE from 'three';

/**
 * Ground UI under the controlled Pokémon (OS-style):
 * - size ring showing Strike reach, with a sweep that refills during cooldown
 * - aim arrow pointing where Strike will send the ball
 */
export class AimIndicator {
  readonly object = new THREE.Group();
  private readonly reach: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private cooldown: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly arrow: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private reachRadius = 1;
  private flash = 0;

  constructor() {
    this.reach = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.cooldown = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64, 1, 0, Math.PI * 2),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    const s = new THREE.Shape();
    s.moveTo(0, -0.12);
    s.lineTo(0.55, -0.12);
    s.lineTo(0.55, -0.26);
    s.lineTo(0.9, 0);
    s.lineTo(0.55, 0.26);
    s.lineTo(0.55, 0.12);
    s.lineTo(0, 0.12);
    s.closePath();
    this.arrow = new THREE.Mesh(
      new THREE.ShapeGeometry(s),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    for (const m of [this.reach, this.cooldown]) m.rotation.x = -Math.PI / 2;
    this.object.add(this.reach, this.cooldown, this.arrow);
    this.object.position.y = 0.015;
  }

  setReach(radiusThree: number): void {
    this.reachRadius = radiusThree;
    this.reach.scale.setScalar(radiusThree);
    this.cooldown.scale.setScalar(radiusThree);
  }

  strikeFlash(): void {
    this.flash = 1;
  }

  /**
   * @param aimX,aimZ aim direction in Three space (any length; 0 = hide arrow)
   * @param cooldownFrac 0 = ready, 1 = just used
   */
  update(dt: number, x: number, z: number, aimX: number, aimZ: number, cooldownFrac: number): void {
    this.object.position.set(x, 0.015, z);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.reach.material.opacity = 0.3 + this.flash * 0.6;
    this.reach.material.color.setHex(this.flash > 0 ? 0xffe066 : 0xffffff);

    const ready = cooldownFrac <= 0;
    this.cooldown.visible = !ready;
    if (!ready) {
      this.cooldown.geometry.dispose();
      this.cooldown.geometry = new THREE.RingGeometry(0.9, 1, 64, 1, Math.PI / 2, Math.PI * 2 * (1 - cooldownFrac));
    }

    const l = Math.hypot(aimX, aimZ);
    this.arrow.visible = l > 1e-3;
    if (this.arrow.visible) {
      // Arrow shape points along +x in its local XY plane; lay it flat and rotate to the aim.
      const angle = Math.atan2(-aimZ, aimX);
      this.arrow.rotation.set(-Math.PI / 2, 0, angle);
      this.arrow.position.set((aimX / l) * this.reachRadius * 1.05, 0, (aimZ / l) * this.reachRadius * 1.05);
      this.arrow.material.opacity = ready ? 0.75 : 0.3;
    }
  }
}
