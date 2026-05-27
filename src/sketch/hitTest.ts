import type { Vec2 } from '../physics/types';
import type { Plot, Point } from '../model/plot';
import { effectivePosition, shapeSegments } from '../model/plot';
import { distance, distToSegment } from '../physics/math/vec2';
import type { CandidateLine } from '../survey/candidates';

export function findPointAt(plot: Plot, worldPt: Vec2, hitRadius: number): Point | null {
  let best: Point | null = null;
  let bestD = hitRadius;
  for (const p of Object.values(plot.points)) {
    const d = distance(effectivePosition(p, plot.points), worldPt);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export interface ShapeEdgeHit {
  shapeId: string;
  /** Index of the segment within shape.pointIds: edge connects
   *  pointIds[segmentIndex] and pointIds[segmentIndex + 1] (mod len
   *  for closed shapes). */
  segmentIndex: number;
  pointAId: string;
  pointBId: string;
  /** Closest point on the segment, in world coords. */
  pointOnEdge: Vec2;
  /** Parametric position along the segment, 0 at A, 1 at B. */
  t: number;
}

/** Find the shape edge nearest to a world point, within hitRadius. */
export function findShapeEdgeAt(
  plot: Plot,
  worldPt: Vec2,
  hitRadius: number,
): ShapeEdgeHit | null {
  let best: ShapeEdgeHit | null = null;
  let bestD = hitRadius;
  for (const shape of Object.values(plot.shapes)) {
    const segs = shapeSegments(shape);
    segs.forEach(([aId, bId], idx) => {
      const a = plot.points[aId];
      const b = plot.points[bId];
      if (!a || !b) return;
      const pa = effectivePosition(a, plot.points);
      const pb = effectivePosition(b, plot.points);
      const d = distToSegment(worldPt, pa, pb);
      if (d > bestD) return;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len2 = dx * dx + dy * dy;
      let t = 0;
      if (len2 > 1e-12) {
        t = ((worldPt.x - pa.x) * dx + (worldPt.y - pa.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      best = {
        shapeId: shape.id,
        segmentIndex: idx,
        pointAId: aId,
        pointBId: bId,
        pointOnEdge: { x: pa.x + t * dx, y: pa.y + t * dy },
        t,
      };
      bestD = d;
    });
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
    const pa = effectivePosition(a, plot.points);
    const pb = effectivePosition(b, plot.points);
    const d = distToSegment(worldPt, pa, pb);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
