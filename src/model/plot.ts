import type { Vec2 } from '../physics/types';
import type { Units } from './units';

/**
 * Layer 1 — the drawn-features layer. Points belong to zero or more
 * shapes (a Shape is just an ordered list of point IDs with an open/
 * closed flag). Points not in any shape are "reference points".
 *
 * Layer 2 — the survey layer. Measurements are tape readings between
 * two points. The solver treats them as elastic distance constraints.
 *
 * All stored lengths and point coordinates are in millimetres; the
 * `units` field is the display / entry preference only. See
 * `model/units.ts`.
 *
 * Each point carries a `sketchPosition` alongside its solved
 * `position`. Sketch positions track what the user actually drew (and
 * are scaled in lock-step with the solved positions when the first
 * dimension is added) — the survey solver uses the implied sketch
 * edge-lengths as soft constraints so the plot retains its drawn shape
 * even when measurements are sparse. Drags in feature mode update both
 * positions; the survey solver only updates `position`.
 *
 * Points come in two kinds:
 *  - 'free' — an independently positioned point.
 *  - 'onEdge' — a point constrained to lie on the line between two
 *    parent points at a fixed parameter t in [0, 1]. The survey solver
 *    pins these points to that location so measurements taken to them
 *    are honoured but they cannot drift off the parent edge.
 */

export type PointKind = 'free' | 'onEdge';

export interface Point {
  readonly id: string;
  position: Vec2;
  /** Position from the rough sketch, scale-fitted to mm after the
   *  first measurement. Anchors the shape-cohesion soft constraints. */
  sketchPosition: Vec2;
  kind: PointKind;
  /** Two parent point IDs when kind === 'onEdge'. */
  parents?: [string, string];
  /** Parametric position along the parent edge, 0..1. */
  t?: number;
  label?: string;
}

export interface Shape {
  readonly id: string;
  pointIds: string[];
  closed: boolean;
  name?: string;
}

export interface Measurement {
  readonly id: string;
  pointIds: [string, string];
  /** Real-world length, in millimetres. */
  length: number;
  /** Optional weight — confidence in this measurement (default 1). */
  weight?: number;
}

export interface Plot {
  points: Record<string, Point>;
  shapes: Record<string, Shape>;
  measurements: Record<string, Measurement>;
  /** Two anchor points pin position + orientation of the solved survey. */
  anchorPointId?: string;
  orientationPointId?: string;
  /** Preferred display / entry unit. Storage is always in mm. */
  units: Units;
  /** Soft-constraint weight applied to each shape edge's sketch
   *  rest-length during the survey solve. 0 = sketch is ignored,
   *  ~1 = sketch strongly pulls measurements back toward the drawn
   *  shape. Default is small but non-zero so basic drawings retain
   *  their look even with sparse measurements. */
  shapeCohesion: number;
}

export const emptyPlot = (): Plot => ({
  points: {},
  shapes: {},
  measurements: {},
  units: 'mm',
  shapeCohesion: 0.1,
});

/** Pairs of point IDs implied by the edges of a shape's polyline/polygon. */
export function shapeSegments(shape: Shape): Array<[string, string]> {
  const ids = shape.pointIds;
  const segs: Array<[string, string]> = [];
  for (let i = 0; i < ids.length - 1; i++) segs.push([ids[i], ids[i + 1]]);
  if (shape.closed && ids.length > 2) segs.push([ids[ids.length - 1], ids[0]]);
  return segs;
}

export function shapeContainsPoint(shape: Shape, pointId: string): boolean {
  return shape.pointIds.includes(pointId);
}

/** Position derived from parents when kind === 'onEdge', else the
 *  point's own position. Pass the position field name to choose
 *  between solved positions and sketch positions. */
export function effectivePosition(
  point: Point,
  points: Record<string, Point>,
  field: 'position' | 'sketchPosition' = 'position',
): Vec2 {
  if (point.kind !== 'onEdge' || !point.parents || point.t == null) {
    return point[field];
  }
  const a = points[point.parents[0]];
  const b = points[point.parents[1]];
  if (!a || !b) return point[field];
  const t = point.t;
  return {
    x: a[field].x * (1 - t) + b[field].x * t,
    y: a[field].y * (1 - t) + b[field].y * t,
  };
}

/** Iterate every (a, b) point-id pair implied by a shape's edges. */
export function allShapeEdges(shapes: Record<string, Shape>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const s of Object.values(shapes)) {
    for (const seg of shapeSegments(s)) out.push(seg);
  }
  return out;
}
