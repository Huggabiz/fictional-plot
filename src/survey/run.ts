import type { Plot } from '../model/plot';
import { solveLeastSquares } from './solver';

/**
 * Runs the LM solver against the plot's current measurements and
 * returns a new plot with relaxed point positions, plus auto-picked
 * anchor / orientation points if they weren't set yet. Returns null
 * when there's nothing meaningful to solve.
 */
export function runSurveySolve(plot: Plot): Plot | null {
  const measurementList = Object.values(plot.measurements);
  if (measurementList.length === 0) return null;

  const ids = Object.keys(plot.points);
  if (ids.length < 2) return null;
  const idIndex = new Map<string, number>();
  ids.forEach((id, k) => idIndex.set(id, k));
  const positions = ids.map(id => ({ ...plot.points[id].position }));

  const measurements = [];
  for (const m of measurementList) {
    const i = idIndex.get(m.pointIds[0]);
    const j = idIndex.get(m.pointIds[1]);
    if (i === undefined || j === undefined) continue;
    measurements.push({ i, j, length: m.length, weight: m.weight });
  }
  if (measurements.length === 0) return null;

  // Pick anchor/orientation if not already chosen — first measurement's points.
  let anchorId = plot.anchorPointId;
  let orientationId = plot.orientationPointId;
  if (!anchorId || !orientationId || !plot.points[anchorId] || !plot.points[orientationId]) {
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
  });

  const newPoints = { ...plot.points };
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
