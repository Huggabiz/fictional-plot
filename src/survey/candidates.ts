import type { Plot } from '../model/plot';
import { effectivePosition } from '../model/plot';
import { delaunayEdges } from './delaunay';
import { rigidityRank } from './rigidity';

export interface CandidateLine {
  /** Stable key (sorted pair of point IDs). */
  key: string;
  pointIds: [string, string];
  /** True if a Measurement already exists for this pair. */
  measured: boolean;
  /** True if adding a measurement on this line would increase rigidity rank. */
  improvesRigidity: boolean;
  /** Pixel length in world units (used as a tie-breaker). */
  worldLength: number;
}

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Compute the Layer-2 candidate survey lines: Delaunay edges over all
 * plot points, annotated with whether each is already measured and
 * whether measuring it would increase rigidity rank.
 */
export function computeCandidates(plot: Plot): CandidateLine[] {
  const ids = Object.keys(plot.points);
  if (ids.length < 2) return [];
  const positions = ids.map(id => effectivePosition(plot.points[id], plot.points));
  const indexOf = new Map<string, number>();
  ids.forEach((id, k) => indexOf.set(id, k));

  const measuredKeys = new Set(
    Object.values(plot.measurements).map(m => edgeKey(m.pointIds[0], m.pointIds[1])),
  );
  const measuredIndexPairs: Array<[number, number]> = [];
  for (const m of Object.values(plot.measurements)) {
    const i = indexOf.get(m.pointIds[0]);
    const j = indexOf.get(m.pointIds[1]);
    if (i !== undefined && j !== undefined) measuredIndexPairs.push([i, j]);
  }

  const delEdges =
    ids.length >= 3
      ? delaunayEdges(positions)
      : [[0, 1] as [number, number]];

  const baseRank = rigidityRank(positions, measuredIndexPairs);

  const out: CandidateLine[] = [];
  for (const [i, j] of delEdges) {
    const aId = ids[i];
    const bId = ids[j];
    const key = edgeKey(aId, bId);
    const measured = measuredKeys.has(key);
    let improvesRigidity = false;
    if (!measured) {
      const trial = measuredIndexPairs.concat([[i, j]]);
      improvesRigidity = rigidityRank(positions, trial) > baseRank;
    }
    const dx = positions[i].x - positions[j].x;
    const dy = positions[i].y - positions[j].y;
    out.push({
      key,
      pointIds: [aId, bId],
      measured,
      improvesRigidity,
      worldLength: Math.hypot(dx, dy),
    });
  }
  return out;
}

/** Pick the single "best next measurement to take" — shortest improving edge. */
export function bestNextCandidate(candidates: CandidateLine[]): CandidateLine | null {
  let best: CandidateLine | null = null;
  for (const c of candidates) {
    if (c.measured || !c.improvesRigidity) continue;
    if (!best || c.worldLength < best.worldLength) best = c;
  }
  return best;
}

/** Quick lookup of measurement IDs by candidate key. */
export function measurementByKey(plot: Plot): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of Object.values(plot.measurements)) {
    out.set(edgeKey(m.pointIds[0], m.pointIds[1]), m.id);
  }
  return out;
}
