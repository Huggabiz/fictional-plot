import type { Vec2 } from '../physics/types';

/**
 * Layer 1 — the drawn-features layer. Points belong to zero or more
 * shapes (a Shape is just an ordered list of point IDs with an open/
 * closed flag). Points not in any shape are "reference points".
 *
 * Layer 2 — the survey layer. Measurements are tape readings between
 * two points. The solver treats them as elastic distance constraints.
 */

export interface Point {
  readonly id: string;
  position: Vec2;
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
  /** Real-world length, in the user's chosen units. */
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
}

export const emptyPlot = (): Plot => ({
  points: {},
  shapes: {},
  measurements: {},
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
