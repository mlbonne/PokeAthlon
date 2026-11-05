import { getFrame, getTerrain, type Point } from '@pokeathlon/data';
import { polygonSegments, type Box, type Circle, type Segment } from './geometry';
import type { Vec2 } from './vec';

export type Team = 0 | 1;

/** One team's goal. Team 0 defends the left goal (x < 0). */
export interface Goal {
  /** The team that defends this goal. */
  team: Team;
  /** −1 for the left goal, +1 for the right. */
  side: -1 | 1;
  mouthX: number;
  /** Ball overlapping this box scores for the other team. */
  score: Box;
  /** Closed until all of this team's barriers are broken. */
  gate: Box;
  posts: Circle[];
  /** Goal Arc ellipse (defender buff zone). */
  arc: { x: number; y: number; rx: number; ry: number };
}

export interface TeamSpawns {
  forwards: Vec2[];
  goalie: Vec2;
  respawn: Vec2[];
}

/** Resolved, ready-to-simulate stage: shared frame + terrain. */
export interface Stage {
  id: string;
  name: string;
  /** Client art set (`plain`, `stadium`); visual only. */
  theme: string;
  /** Outline the ball bounces inside (includes both goal pockets). */
  ballOutline: Vec2[];
  ballWalls: Segment[];
  /** Outline players can't walk out of. A knocked player whose centre leaves it is KO'd. */
  playerOutline: Vec2[];
  playerWalls: Segment[];
  goals: [Goal, Goal];
  posts: Circle[];
  barriers: { team: Team; box: Box }[];
  spawns: [TeamSpawns, TeamSpawns];
  ballSpawns: Vec2[];
  orbMid: Vec2[];
  orbArc: [Vec2[], Vec2[]];
  /** Bounding extents for cameras. */
  halfLength: number;
  halfWidth: number;
}

const P = (x: number, y: number): Vec2 => ({ x, y });
/** Team 1 positions are the point mirror of team 0's. */
const mirror = (p: Point | Vec2): Vec2 => ({ x: -p.x, y: -p.y });
const copy = (p: Point | Vec2): Vec2 => ({ x: p.x, y: p.y });

/** Outline from the +x half description, mirrored to −x. Points run around the shape in order. */
function symmetricOutline(right: Vec2[]): Vec2[] {
  // `right` goes from the top-left join (−x side of the top edge) clockwise to the bottom edge.
  const left = right.map((p) => P(-p.x, -p.y));
  const all = [...right, ...left];
  // The mirror repeats the two join points; drop consecutive duplicates (and a closing duplicate).
  const out = all.filter((p, i) => {
    const q = all[(i + all.length - 1) % all.length]!;
    return p.x !== q.x || p.y !== q.y;
  });
  return out;
}

const cache = new Map<string, Stage>();

export function buildStage(terrainId: string): Stage {
  const hit = cache.get(terrainId);
  if (hit) return hit;
  const t = getTerrain(terrainId);
  const f = getFrame(t.frame);
  const F = f.field;
  const B = f.playerBounds;

  const ballOutline = symmetricOutline([
    P(-F.cornerStartX, F.sideY),
    P(F.cornerStartX, F.sideY),
    P(F.mouthX, F.pocketHalfWidth),
    P(F.backX, F.pocketHalfWidth),
    P(F.backX, -F.pocketHalfWidth),
    P(F.mouthX, -F.pocketHalfWidth),
    P(F.cornerStartX, -F.sideY),
  ]);
  const playerOutline = symmetricOutline([
    P(-B.cornerStartX, B.sideY),
    P(B.cornerStartX, B.sideY),
    P(B.cornerStartX, B.cornerSideY),
    P(F.mouthX, F.pocketHalfWidth),
    P(B.pocketBackX, F.pocketHalfWidth),
    P(B.pocketBackX, -F.pocketHalfWidth),
    P(F.mouthX, -F.pocketHalfWidth),
    P(B.cornerStartX, -B.cornerSideY),
    P(B.cornerStartX, -B.sideY),
  ]);

  const G = f.goal;
  const goal = (team: Team): Goal => {
    const side = team === 0 ? -1 : 1;
    return {
      team,
      side,
      mouthX: side * G.mouthX,
      score: { x: (side * (G.score.x0 + G.score.x1)) / 2, y: 0, hx: (G.score.x1 - G.score.x0) / 2, hy: G.score.halfWidth },
      gate: { x: (side * (G.gate.x0 + G.gate.x1)) / 2, y: 0, hx: (G.gate.x1 - G.gate.x0) / 2, hy: G.gate.halfWidth },
      posts: [
        { x: side * G.mouthX, y: G.postY, r: G.postRadius },
        { x: side * G.mouthX, y: -G.postY, r: G.postRadius },
      ],
      arc: { x: side * f.goalArc.centerX, y: 0, rx: f.goalArc.radiusX, ry: f.goalArc.radiusY },
    };
  };
  const goals: [Goal, Goal] = [goal(0), goal(1)];

  const S = t.spawns;
  const team0: TeamSpawns = { forwards: S.forwards.map(copy), goalie: copy(S.goalie), respawn: S.respawn.map(copy) };
  const team1: TeamSpawns = { forwards: S.forwards.map(mirror), goalie: mirror(S.goalie), respawn: S.respawn.map(mirror) };

  const stage: Stage = {
    id: t.id,
    name: t.name,
    theme: t.theme,
    ballOutline,
    ballWalls: polygonSegments(ballOutline),
    playerOutline,
    playerWalls: polygonSegments(playerOutline),
    goals,
    posts: [...goals[0].posts, ...goals[1].posts],
    barriers: [
      ...t.barriers.map((b) => ({ team: 0 as Team, box: { x: b.x, y: b.y, hx: b.hx, hy: b.hy } })),
      ...t.barriers.map((b) => ({ team: 1 as Team, box: { x: -b.x, y: -b.y, hx: b.hx, hy: b.hy } })),
    ],
    spawns: [team0, team1],
    ballSpawns: S.ball.map(copy),
    orbMid: t.orbs.mid.map(copy),
    orbArc: [t.orbs.arc.map(copy), t.orbs.arc.map(mirror)],
    halfLength: F.backX,
    halfWidth: Math.max(F.sideY, B.sideY),
  };
  cache.set(terrainId, stage);
  return stage;
}

/** Is `p` on team `team`'s own half (the half with its goal)? */
export function onOwnHalf(stage: Stage, team: Team, p: Vec2): boolean {
  return p.x * stage.goals[team].side > 0;
}

/** Is `p` inside team `team`'s Goal Arc? */
export function inGoalArc(stage: Stage, team: Team, p: Vec2): boolean {
  const a = stage.goals[team].arc;
  const dx = (p.x - a.x) / a.rx;
  const dy = (p.y - a.y) / a.ry;
  // Only the part of the ellipse inside the field (in front of the goal line) counts.
  return dx * dx + dy * dy <= 1 && Math.abs(p.x) <= Math.abs(stage.goals[team].mouthX);
}
