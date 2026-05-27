import type { Plot, Point } from '../model/plot';
import { allShapeEdges } from '../model/plot';
import { solveLeastSquares, type SolverInput } from './solver';

/**
 * Runs the LM solver against the plot's current measurements and
 * returns a new plot with relaxed point positions. Returns null when
 * there's nothing meaningful to solve.
 *
 * With only one measurement the system is under-constrained, so we
 * skip the solver and uniformly scale every point around the anchor
 * so the single measured distance matches the tape reading. Sketch
 * positions are scaled in lock-step so the implied sketch lengths
 * stay coherent in mm for subsequent solves.
 *
 * On-edge points (kind === 'onEdge') are kept on their parent edge by
 * a stiff linear pin in the solver — their position remains a function
 * of the parents at their fixed parameter t.
 *
 * Shape edges contribute soft distance constraints with rest-lengths
 * taken from the sketch positions, weighted by plot.shapeCohesion.
 * That's how the survey retains its drawn shape even when tape
 * measurements are sparse: bumping the slider pulls the solution back
 * toward the original sketch geometry.
 */
export function runSurveySolve(plot: Plot): Plot | null {
  const measurementList = Object.values(plot.measurements);
  if (measurementList.length === 0) return null;

  const ids = Object.keys(plot.points);
  if (ids.length < 2) return null;

  if (measurementList.length === 1) {
    return scaleToFitFirstMeasurement(plot, measurementList[0]);
  }

  const idIndex = new Map<string, number>();
  ids.forEach((id, k) => idIndex.set(id, k));
  const positions = ids.map(id => ({ ...plot.points[id].position }));

  // Tape-measurement constraints (weight 1 by default).
  const measurements: SolverInput['measurements'] = [];
  for (const m of measurementList) {
    const i = idIndex.get(m.pointIds[0]);
    const j = idIndex.get(m.pointIds[1]);
    if (i === undefined || j === undefined) continue;
    measurements.push({ i, j, length: m.length, weight: m.weight });
  }
  if (measurements.length === 0) return null;

  // Shape-cohesion soft constraints: every shape edge becomes a soft
  // distance constraint with rest length taken from the sketch
  // positions. Heavy duplicates (same pair appearing twice in a
  // closed-shape segment list) are de-duped so the weight balance
  // stays predictable.
  const cohesion = Math.max(0, plot.shapeCohesion ?? 0);
  if (cohesion > 0) {
    const seen = new Set<string>();
    for (const [aId, bId] of allShapeEdges(plot.shapes)) {
      const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const i = idIndex.get(aId);
      const j = idIndex.get(bId);
      if (i === undefined || j === undefined) continue;
      const a = plot.points[aId];
      const b = plot.points[bId];
      const dx = a.sketchPosition.x - b.sketchPosition.x;
      const dy = a.sketchPosition.y - b.sketchPosition.y;
      const restLength = Math.hypot(dx, dy);
      if (restLength < 1e-6) continue;
      measurements.push({ i, j, length: restLength, weight: cohesion });
    }
  }

  // Pin on-edge points to (1-t)·A + t·B via the solver's linearPins.
  const linearPins: NonNullable<SolverInput['linearPins']> = [];
  for (const id of ids) {
    const p = plot.points[id];
    if (p.kind !== 'onEdge' || !p.parents || p.t == null) continue;
    const targetIndex = idIndex.get(id);
    const aIdx = idIndex.get(p.parents[0]);
    const bIdx = idIndex.get(p.parents[1]);
    if (targetIndex === undefined || aIdx === undefined || bIdx === undefined) continue;
    const t = p.t;
    linearPins.push({
      targetIndex,
      indices: [aIdx, bIdx],
      weights: [1 - t, t],
    });
  }

  // Anchor / orientation: prefer a free point so pinning doesn't fight
  // an on-edge constraint. Fall back to any point if necessary.
  const pickAnchor = (preferred?: string): string | undefined => {
    if (preferred && plot.points[preferred] && plot.points[preferred].kind === 'free') return preferred;
    for (const id of ids) if (plot.points[id].kind === 'free') return id;
    return ids[0];
  };
  let anchorId = pickAnchor(plot.anchorPointId);
  let orientationId = pickAnchor(
    plot.orientationPointId && plot.orientationPointId !== anchorId
      ? plot.orientationPointId
      : ids.find(id => id !== anchorId && plot.points[id].kind === 'free') ?? ids.find(id => id !== anchorId),
  );
  if (!anchorId || !orientationId || anchorId === orientationId) {
    // Fallback to measurement endpoints.
    const first = measurementList[0];
    anchorId = first.pointIds[0];
    orientationId = first.pointIds[1];
  }
  const anchorIndex = idIndex.get(anchorId);
  const orientationIndex = idIndex.get(orientationId);
  if (anchorIndex === undefined || orientationIndex === undefined) return null;

  const result = solveLeastSquares({
    positions,
    measurements,
    anchorIndex,
    orientationIndex,
    linearPins,
  });

  const newPoints: Record<string, Point> = { ...plot.points };
  ids.forEach((id, k) => {
    newPoints[id] = { ...newPoints[id], position: result.positions[k] };
  });
  return {
    ...plot,
    points: newPoints,
    anchorPointId: anchorId,
    orientationPointId: orientationId,
  };
}

function scaleToFitFirstMeasurement(
  plot: Plot,
  m: { pointIds: [string, string]; length: number },
): Plot | null {
  const a = plot.points[m.pointIds[0]];
  const b = plot.points[m.pointIds[1]];
  if (!a || !b) return null;

  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const current = Math.hypot(dx, dy);
  if (current < 1e-6) return null;
  const scale = m.length / current;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  // Scale around point a (in both position and sketchPosition) so it
  // stays put, and so the implied sketch lengths used by future solves
  // share the same mm units.
  const newPoints: Record<string, Point> = {};
  for (const [id, p] of Object.entries(plot.points)) {
    newPoints[id] = {
      ...p,
      position: {
        x: a.position.x + (p.position.x - a.position.x) * scale,
        y: a.position.y + (p.position.y - a.position.y) * scale,
      },
      sketchPosition: {
        x: a.sketchPosition.x + (p.sketchPosition.x - a.sketchPosition.x) * scale,
        y: a.sketchPosition.y + (p.sketchPosition.y - a.sketchPosition.y) * scale,
      },
    };
  }
  return {
    ...plot,
    points: newPoints,
    anchorPointId: m.pointIds[0],
    orientationPointId: m.pointIds[1],
  };
}
