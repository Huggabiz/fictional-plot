import type { Vec2 } from '../physics/types';

/**
 * Domain model for the survey app. The "Rough Plot" is a sketch
 * the user makes by tapping points and connecting them with edges.
 * Measurements are taken between points and act as elastic distance
 * constraints when the plot is solved.
 */

export interface Point {
  readonly id: string;
  position: Vec2;
  label?: string;
}

export interface Edge {
  readonly id: string;
  pointIds: [string, string];
  kind: 'sketch' | 'wall';
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
  edges: Record<string, Edge>;
  measurements: Record<string, Measurement>;
  /** Two anchor points pin position + orientation of the solved survey. */
  anchorPointId?: string;
  orientationPointId?: string;
}

export const emptyPlot = (): Plot => ({
  points: {},
  edges: {},
  measurements: {},
});
