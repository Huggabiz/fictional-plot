import type { Vec2 } from '../physics/types';

/**
 * Rank of the rigidity matrix for a set of distance measurements
 * between 2D points. Used to decide whether adding a candidate edge
 * would increase the constraint rank (= reduce remaining freedom).
 *
 * Each measurement contributes one row of length 2N. For the edge
 * between points i and j with direction d = (p_i - p_j)/||p_i - p_j||,
 * the row has d at the i-block and -d at the j-block.
 *
 * For full rigidity in 2D, rank must reach 2N - 3 (one anchor pins
 * translation, the orientation point pins rotation).
 */
export function rigidityRank(
  points: Vec2[],
  edges: Array<[number, number]>,
): number {
  if (edges.length === 0 || points.length === 0) return 0;
  const cols = points.length * 2;
  const rows: number[][] = edges.map(([i, j]) => {
    const dx = points[i].x - points[j].x;
    const dy = points[i].y - points[j].y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const row = new Array<number>(cols).fill(0);
    row[i * 2] = ux;
    row[i * 2 + 1] = uy;
    row[j * 2] = -ux;
    row[j * 2 + 1] = -uy;
    return row;
  });
  return matrixRank(rows);
}

/** Gaussian elimination with partial pivoting, returns numerical rank. */
function matrixRank(rows: number[][]): number {
  const m = rows.length;
  if (m === 0) return 0;
  const n = rows[0].length;
  const A = rows.map(r => r.slice());
  const EPS = 1e-8;
  let rank = 0;
  let col = 0;
  for (let r = 0; r < m && col < n; col++) {
    // Pivot: row with largest |A[k][col]| for k >= r.
    let piv = r;
    let pivAbs = Math.abs(A[r][col]);
    for (let k = r + 1; k < m; k++) {
      const v = Math.abs(A[k][col]);
      if (v > pivAbs) {
        piv = k;
        pivAbs = v;
      }
    }
    if (pivAbs < EPS) continue;
    if (piv !== r) {
      const tmp = A[r];
      A[r] = A[piv];
      A[piv] = tmp;
    }
    // Eliminate below.
    const pivVal = A[r][col];
    for (let k = r + 1; k < m; k++) {
      const f = A[k][col] / pivVal;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[k][c] -= f * A[r][c];
    }
    rank++;
    r++;
  }
  return rank;
}
