import * as THREE from 'three';
import { getPokemon } from '@pokeathlon/data';
import { analyzeRoster, type FighterStats } from '@pokeathlon/data/analyze';
import { predictBall, type World } from '@pokeathlon/sim';
import { toThreeX, toThreeZ } from './units';

const BALL_LOOKAHEAD = 150; // 2.5 s
const MOVE_COLORS = [0x5aa9ff, 0x7dff9a, 0xff8f5a];

/**
 * F3 world view: hurtboxes, Strike reach, every move's reach ring (from the kit analyzer) for the
 * selected Pokémon, live projectile hitboxes and the predicted ball path. Thin lines on the ground.
 */
export class DebugOverlay {
  readonly object = new THREE.Group();
  private readonly circles: THREE.LineLoop[] = [];
  private used = 0;
  private readonly ballPath: THREE.Line;
  private readonly kits = new Map<string, FighterStats>();

  constructor() {
    this.object.position.y = 0.03;
    this.object.visible = false;
    this.ballPath = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(BALL_LOOKAHEAD * 3), 3)),
      new THREE.LineDashedMaterial({ color: 0xffe066, dashSize: 0.25, gapSize: 0.15, transparent: true, opacity: 0.9 }),
    );
    this.object.add(this.ballPath);
    for (const f of analyzeRoster()) this.kits.set(f.id, f);
  }

  private makeCircle(): THREE.LineLoop {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const c = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ transparent: true }));
    this.object.add(c);
    return c;
  }

  private circle(x: number, y: number, r: number, color: number, opacity: number): void {
    const c = this.circles[this.used] ?? (this.circles[this.used] = this.makeCircle());
    this.used++;
    c.visible = true;
    c.position.set(toThreeX(x), 0, toThreeZ(y));
    c.scale.setScalar(toThreeX(r));
    const m = c.material as THREE.LineBasicMaterial;
    m.color.setHex(color);
    m.opacity = opacity;
  }

  /** @param focus player whose move reach rings are drawn (−1 = none). */
  update(world: World, focus: number): void {
    if (!this.object.visible) return;
    this.used = 0;
    for (const p of world.players) {
      if (p.koTicks > 0) continue;
      const team = p.team === 0 ? 0x3d7bff : 0xff4d5e;
      this.circle(p.pos.x, p.pos.y, p.hurtRadius, team, 0.9);
      this.circle(p.pos.x, p.pos.y, p.strikeRadius + world.ball.radius, 0xffffff, p.strikeActive > 0 ? 0.9 : 0.25);
      if (p.id !== focus) continue;
      const kit = this.kits.get(getPokemon(p.pokemonId).id);
      kit?.moves.forEach((m, i) => {
        const ready = (p.moves[i]?.cooldown ?? 1) === 0;
        if (m.reach > 0) this.circle(p.pos.x, p.pos.y, m.reach, MOVE_COLORS[i]!, ready ? 0.55 : 0.15);
      });
    }
    for (const pr of world.projectiles) this.circle(pr.pos.x, pr.pos.y, pr.radius, 0xffffff, 0.9);
    this.circle(world.ball.pos.x, world.ball.pos.y, world.ball.radius, 0xffe066, world.ball.scored ? 0 : 0.9);

    // Predicted ball path (ball alone, real physics).
    const pred = world.ball.scored ? null : predictBall(world, BALL_LOOKAHEAD);
    const attr = this.ballPath.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = pred ? pred.path.length : 0;
    for (let i = 0; i < n; i++) attr.setXYZ(i, toThreeX(pred!.path[i]!.x), 0, toThreeZ(pred!.path[i]!.y));
    attr.needsUpdate = true;
    this.ballPath.geometry.setDrawRange(0, n);
    this.ballPath.computeLineDistances();
    this.ballPath.visible = n > 1;
    if (pred && n > 0) {
      const end = pred.path[n - 1]!;
      this.circle(end.x, end.y, world.ball.radius, pred.goalAgainst >= 0 ? 0xff3b2f : 0xffe066, 0.8);
    }
    for (let i = this.used; i < this.circles.length; i++) this.circles[i]!.visible = false;
  }
}
