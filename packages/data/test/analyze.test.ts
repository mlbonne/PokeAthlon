import { describe, expect, it } from 'vitest';
import { analyzeMove, analyzeRoster, analyzeStrike, BUDGET_PART_CAP, KO_EDGE_DISTANCE } from '../src/analyze';
import { getPokemon, MoveDef, SIZE_TABLE } from '../src/index';
import { gameplay } from '../src/rules';

const pikachu = getPokemon('pikachu'); // power 95, normal size (body 46)
const BODY = SIZE_TABLE.normal.radius;
const P = pikachu.stats.power;

/** Build a validated move from a few fields. */
function move(actions: unknown[], extra: Record<string, unknown> = {}) {
  return MoveDef.parse({ id: 't', name: 'Test', slot: 'primary', cooldown: 10, desc: '', bot: 'engage', actions, ...extra });
}
const fx = { color: '#ffffff' };
const hit = { player: { base: 200, powerRatio: 1 }, damage: { base: 100, powerRatio: 1 }, ball: { base: 1000, powerRatio: 1 } };

describe('kit analyzer: shapes', () => {
  it('projectile: reach = body + range + radius, flight time, corridor area', () => {
    const m = analyzeMove(move([{ type: 'projectile', fx, speed: 1000, range: 600, radius: 30, hit }]), pikachu);
    expect(m.reach).toBe(BODY + 600 + 30);
    expect(m.timeToReach).toBeCloseTo(0.6);
    expect(m.hitArea).toBeCloseTo(Math.PI * 900);
    expect(m.sweptArea).toBeCloseTo(2 * 30 * 600 + Math.PI * 900);
    expect(m.damagePerCast).toBe(100 + P);
    expect(m.dps).toBeCloseTo((100 + P) / 10);
    expect(m.ballPower).toBe(1000 + P);
  });

  it('decelerating projectile stops early (v² / 2a)', () => {
    const m = analyzeMove(move([{ type: 'projectile', fx, speed: 1500, decel: 1500, range: 900, radius: 70, hit }]), pikachu);
    expect(m.reach).toBe(BODY + 750 + 70);
    expect(m.timeToReach).toBeCloseTo(1.0); // 750 = 1500 t − 750 t² → t = 1
  });

  it('a stream of shots hits one target count times; a fan only once', () => {
    const stream = analyzeMove(move([{ type: 'projectile', fx, count: 4, interval: 0.1, speed: 1000, range: 500, radius: 20, hit }]), pikachu);
    expect(stream.hitsPerCast).toBe(4);
    expect(stream.duration).toBeCloseTo(0.3 + 0.5);
    const fan = analyzeMove(move([{ type: 'projectile', fx, count: 3, spreadDeg: 30, speed: 1000, range: 500, radius: 20, hit }]), pikachu);
    expect(fan.hitsPerCast).toBe(1);
  });

  it('areas: circle, cone, line and target-placed', () => {
    const cone = analyzeMove(move([{ type: 'area', fx, shape: 'cone', radius: 200, angleDeg: 90, hit }]), pikachu);
    expect(cone.reach).toBe(200);
    expect(cone.hitArea).toBeCloseTo((Math.PI * 200 * 200) / 4);
    const line = analyzeMove(move([{ type: 'area', fx, shape: 'line', length: 300, width: 100, offset: 50, hit }]), pikachu);
    expect(line.reach).toBe(350);
    expect(line.hitArea).toBe(30000);
    const target = analyzeMove(move([{ type: 'area', fx, shape: 'circle', radius: 320, at: 'target', delay: 1, hit }], { range: 900, castTime: 0.2 }), pikachu);
    expect(target.reach).toBe(1220);
    expect(target.timeToReach).toBeCloseTo(1.2);
    expect(target.lockTime).toBeCloseTo(0.2);
  });

  it('repeats add hits; LIGHT hits only knock back Staggered targets', () => {
    const m = analyzeMove(
      move([{ type: 'area', fx, shape: 'circle', radius: 100, repeat: 4, repeatInterval: 0.1, hit: { ...hit, light: true } }]),
      pikachu,
    );
    expect(m.hitsPerCast).toBe(4);
    expect(m.damagePerCast).toBe(4 * (100 + P));
    expect(m.knockback).toBe(0);
    expect(m.staggeredKnockback).toBeCloseTo((200 + P) * gameplay.knock.staggeredKnockbackMultiplier);
    expect(m.koReach).toBeCloseTo(m.staggeredKnockback / KO_EDGE_DISTANCE);
  });

  it('dash: reach, mobility and lock time', () => {
    const m = analyzeMove(move([{ type: 'dash', fx, distance: 500, time: 0.25, hit }]), pikachu);
    expect(m.reach).toBe(500 + BODY);
    expect(m.mobility).toBe(500);
    expect(m.lockTime).toBeCloseTo(0.25);
    const free = analyzeMove(move([{ type: 'dash', fx, distance: 500, time: 0.25, castWhileDashing: true }]), pikachu);
    expect(free.lockTime).toBe(0);
    expect(free.hitsPerCast).toBe(0);
  });

  it('decaying speed buffs count half their bonus', () => {
    const m = analyzeMove(move([{ type: 'buff', fx, target: 'self', duration: 4, speedPct: 50, decays: true }]), pikachu);
    expect(m.mobility).toBeCloseTo(pikachu.stats.speed * 0.5 * 4 * 0.5);
  });

  it('Strike reach = Strike radius + the ball radius', () => {
    const s = analyzeStrike(pikachu);
    expect(s.reach).toBeCloseTo(SIZE_TABLE.normal.strikeWidth / 2 + gameplay.ball.radius);
    expect(s.cooldown).toBe(gameplay.strike.cooldown);
  });
});

describe('kit analyzer: roster', () => {
  const all = analyzeRoster();

  it('covers every Pokémon with a kit, with three moves each', () => {
    expect(all.map((f) => f.id).sort()).toEqual(['lucario', 'pikachu', 'snorlax', 'togekiss']);
    for (const f of all) expect(f.moves).toHaveLength(3);
  });

  it('budget parts are relative to the roster average and capped', () => {
    for (const f of all) for (const v of Object.values(f.budgetParts)) expect(v).toBeLessThanOrEqual(BUDGET_PART_CAP);
    const mobility = all.reduce((s, f) => s + f.budgetParts.mobility, 0) / all.length;
    expect(mobility).toBeCloseTo(100);
  });

  it('kit DPS is the sum of move DPS', () => {
    for (const f of all) expect(f.kitDps).toBeCloseTo(f.moves.reduce((s, m) => s + m.dps, 0));
  });
});
