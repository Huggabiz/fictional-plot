import type { Vec2 } from '../physics/types';
import type { Plot, Point } from '../model/plot';
import { distance, distToSegment } from '../physics/math/vec2';
import type { CandidateLine } from '../survey/candidates';

export function findPointAt(plot: Plot, worldPt: Vec2, hitRadius: number): Point | null {
  let best: Point | null = null;
  let bestD = hitRadius;
  for (const p of Object.values(plot.points)) {
    const d = distance(p.position, worldPt);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function findCandidateAt(
  plot: Plot,
  candidates: CandidateLine[],
  worldPt: Vec2,
  hitRadius: number,
): CandidateLine | null {
  let best: CandidateLine | null = null;
  let bestD = hitRadius;
  for (const c of candidates) {
    const a = plot.points[c.pointIds[0]];
    const b = plot.points[c.pointIds[1]];
    if (!a || !b) continue;
    const d = distToSegment(worldPt, a.position, b.position);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
