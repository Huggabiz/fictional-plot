/** Solve Ax = b using LU decomposition with partial pivoting. Mutates b in-place. */
export function solveLU(A: number[][], b: number[]): boolean {
  const n = b.length;
  const pivot = new Array<number>(n);

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(A[k][k]);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const val = Math.abs(A[i][k]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = i;
      }
    }

    if (maxVal < 1e-14) return false;

    pivot[k] = maxRow;

    if (maxRow !== k) {
      const tmpRow = A[k];
      A[k] = A[maxRow];
      A[maxRow] = tmpRow;
      const tmpB = b[k];
      b[k] = b[maxRow];
      b[maxRow] = tmpB;
    }

    for (let i = k + 1; i < n; i++) {
      const factor = A[i][k] / A[k][k];
      A[i][k] = factor;
      for (let j = k + 1; j < n; j++) {
        A[i][j] -= factor * A[k][j];
      }
      b[i] -= factor * b[k];
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) {
      b[i] -= A[i][j] * b[j];
    }
    b[i] /= A[i][i];
  }

  return true;
}

/** Create n x m matrix filled with zeros */
export function createMatrix(rows: number, cols: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < rows; i++) {
    m.push(new Array(cols).fill(0));
  }
  return m;
}
