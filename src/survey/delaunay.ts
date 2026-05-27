import type { Vec2 } from '../physics/types';

/**
 * Bowyer–Watson incremental Delaunay triangulation. Returns the
 * unordered set of edges (as pairs of input indices). Good enough for
 * the few-hundred-points surveys this app is aimed at.
 */
export interface Triangle {
  a: number;
  b: number;
  c: number;
}

export function delaunayEdges(points: Vec2[]): Array<[number, number]> {
  const tris = delaunayTriangles(points);
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  const add = (i: number, j: number) => {
    if (i === j) return;
    const key = i < j ? `${i}|${j}` : `${j}|${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([Math.min(i, j), Math.max(i, j)]);
  };
  for (const t of tris) {
    add(t.a, t.b);
    add(t.b, t.c);
    add(t.c, t.a);
  }
  return out;
}

export function delaunayTriangles(points: Vec2[]): Triangle[] {
  if (points.length < 3) return [];

  // Super-triangle large enough to contain all input points.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const dmax = Math.max(dx, dy) * 20;
  const midx = (minX + maxX) / 2;
  const midy = (minY + maxY) / 2;

  const ext: Vec2[] = points.slice();
  const i0 = ext.length;
  ext.push({ x: midx - dmax, y: midy - dmax });
  ext.push({ x: midx + dmax, y: midy - dmax });
  ext.push({ x: midx, y: midy + dmax });

  let triangles: Triangle[] = [{ a: i0, b: i0 + 1, c: i0 + 2 }];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const bad: Triangle[] = [];
    const good: Triangle[] = [];
    for (const t of triangles) {
      if (inCircumcircle(p, ext[t.a], ext[t.b], ext[t.c])) bad.push(t);
      else good.push(t);
    }
    // Find boundary of the "polygonal hole" left by removing bad triangles.
    const edgeCount = new Map<string, [number, number]>();
    const edgeOrder: Array<[number, number]> = [];
    const addEdge = (u: number, v: number) => {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (edgeCount.has(key)) {
        edgeCount.delete(key);
      } else {
        edgeCount.set(key, [u, v]);
        edgeOrder.push([u, v]);
      }
    };
    for (const t of bad) {
      addEdge(t.a, t.b);
      addEdge(t.b, t.c);
      addEdge(t.c, t.a);
    }
    triangles = good;
    for (const [u, v] of edgeOrder) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (!edgeCount.has(key)) continue;
      triangles.push({ a: u, b: v, c: i });
    }
  }

  // Strip triangles touching the super-triangle vertices.
  return triangles.filter(t => t.a < i0 && t.b < i0 && t.c < i0);
}

function inCircumcircle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const ax = a.x - p.x;
  const ay = a.y - p.y;
  const bx = b.x - p.x;
  const by = b.y - p.y;
  const cx = c.x - p.x;
  const cy = c.y - p.y;
  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);
  // Orient super-triangle CCW so sign is consistent.
  const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return ccw > 0 ? det > 0 : det < 0;
}
