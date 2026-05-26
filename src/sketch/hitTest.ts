import type { Vec2 } from '../physics/types';
import type { Plot, Point } from '../model/plot';
import { distance } from '../physics/math/vec2';

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

export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function hasEdgeBetween(plot: Plot, a: string, b: string): boolean {
  const key = edgeKey(a, b);
  for (const e of Object.values(plot.edges)) {
    if (edgeKey(e.pointIds[0], e.pointIds[1]) === key) return true;
  }
  return false;
}
