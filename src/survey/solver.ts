import type { Vec2 } from '../physics/types';
import { solveLU } from '../physics/math/linalg';

export interface SolverInput {
  /** Initial positions, indexed 0..N-1. */
  positions: Vec2[];
  /** Distance constraints: indices into positions and target length. */
  measurements: Array<{ i: number; j: number; length: number; weight?: number }>;
  /** Index of the anchor point (its x,y are pinned to initial values). */
  anchorIndex: number;
  /** Index of the orientation point (its y is pinned to anchor's y). */
  orientationIndex: number;
  /**
   * Linear coordinate pins: each pin asserts
   *   positions[targetIndex] = Σ weights[k] · positions[indices[k]]
   * per axis. Used to pin on-edge points to (1-t)·A + t·B without
   * adding new degrees of freedom. Emits two residuals (x and y) per
   * pin with the supplied pin weight (default = PIN_WEIGHT).
   */
  linearPins?: Array<{
    targetIndex: number;
    indices: number[];
    weights: number[];
    pinWeight?: number;
  }>;
}

export interface SolverResult {
  positions: Vec2[];
  /** Per-measurement residual ||p_i - p_j|| - target. */
  residuals: number[];
  /** Iterations taken. */
  iterations: number;
  /** Final sum-of-squared residuals. */
  cost: number;
  /** True if the solver converged below the tolerance. */
  converged: boolean;
}

const PIN_WEIGHT = 1000;
const MAX_ITERS = 60;
const COST_TOL = 1e-10;
const STEP_TOL = 1e-10;

/**
 * Levenberg–Marquardt least-squares fit of point positions to a set of
 * distance measurements. Translation and rotation are removed by pinning
 * the anchor point's coordinates and the orientation point's y to the
 * anchor's y, via stiff penalty residuals.
 */
export function solveLeastSquares(input: SolverInput): SolverResult {
  const N = input.positions.length;
  if (N === 0) {
    return { positions: [], residuals: [], iterations: 0, cost: 0, converged: true };
  }

  // Work with a flat parameter vector p of length 2N: [x0, y0, x1, y1, ...].
  let params = new Float64Array(2 * N);
  for (let i = 0; i < N; i++) {
    params[2 * i] = input.positions[i].x;
    params[2 * i + 1] = input.positions[i].y;
  }
  const anchorX0 = params[2 * input.anchorIndex];
  const anchorY0 = params[2 * input.anchorIndex + 1];

  const measurements = input.measurements;
  const M = measurements.length;
  const linearPins = input.linearPins ?? [];
  const LP = linearPins.length;
  // Residuals: M measurements + 2 anchor pins + 1 orientation pin
  //          + 2 residuals (x and y) per linear pin.
  const R = M + 3 + 2 * LP;

  const residualsAt = (p: Float64Array): number[] => {
    const r = new Array<number>(R);
    for (let k = 0; k < M; k++) {
      const { i, j, length, weight } = measurements[k];
      const dx = p[2 * i] - p[2 * j];
      const dy = p[2 * i + 1] - p[2 * j + 1];
      const w = weight ?? 1;
      r[k] = w * (Math.hypot(dx, dy) - length);
    }
    const ai = input.anchorIndex;
    const oi = input.orientationIndex;
    r[M] = PIN_WEIGHT * (p[2 * ai] - anchorX0);
    r[M + 1] = PIN_WEIGHT * (p[2 * ai + 1] - anchorY0);
    r[M + 2] = PIN_WEIGHT * (p[2 * oi + 1] - p[2 * ai + 1]);
    for (let q = 0; q < LP; q++) {
      const pin = linearPins[q];
      const pw = pin.pinWeight ?? PIN_WEIGHT;
      let sumX = 0;
      let sumY = 0;
      for (let s = 0; s < pin.indices.length; s++) {
        const w = pin.weights[s];
        const idx = pin.indices[s];
        sumX += w * p[2 * idx];
        sumY += w * p[2 * idx + 1];
      }
      r[M + 3 + 2 * q] = pw * (p[2 * pin.targetIndex] - sumX);
      r[M + 3 + 2 * q + 1] = pw * (p[2 * pin.targetIndex + 1] - sumY);
    }
    return r;
  };

  const costOf = (r: number[]): number => {
    let c = 0;
    for (let k = 0; k < r.length; k++) c += r[k] * r[k];
    return c;
  };

  // Jacobian J: R x 2N (dense small matrix).
  const jacobianAt = (p: Float64Array): number[][] => {
    const J: number[][] = [];
    for (let k = 0; k < M; k++) {
      const row = new Array<number>(2 * N).fill(0);
      const { i, j, weight } = measurements[k];
      const dx = p[2 * i] - p[2 * j];
      const dy = p[2 * i + 1] - p[2 * j + 1];
      const len = Math.hypot(dx, dy) || 1e-12;
      const ux = dx / len;
      const uy = dy / len;
      const w = weight ?? 1;
      row[2 * i] = w * ux;
      row[2 * i + 1] = w * uy;
      row[2 * j] = -w * ux;
      row[2 * j + 1] = -w * uy;
      J.push(row);
    }
    const ai = input.anchorIndex;
    const oi = input.orientationIndex;
    const rowAX = new Array<number>(2 * N).fill(0);
    rowAX[2 * ai] = PIN_WEIGHT;
    J.push(rowAX);
    const rowAY = new Array<number>(2 * N).fill(0);
    rowAY[2 * ai + 1] = PIN_WEIGHT;
    J.push(rowAY);
    const rowO = new Array<number>(2 * N).fill(0);
    rowO[2 * oi + 1] = PIN_WEIGHT;
    rowO[2 * ai + 1] = -PIN_WEIGHT;
    J.push(rowO);
    for (let q = 0; q < LP; q++) {
      const pin = linearPins[q];
      const pw = pin.pinWeight ?? PIN_WEIGHT;
      const rowX = new Array<number>(2 * N).fill(0);
      const rowY = new Array<number>(2 * N).fill(0);
      rowX[2 * pin.targetIndex] = pw;
      rowY[2 * pin.targetIndex + 1] = pw;
      for (let s = 0; s < pin.indices.length; s++) {
        const w = pin.weights[s];
        const idx = pin.indices[s];
        rowX[2 * idx] = -pw * w;
        rowY[2 * idx + 1] = -pw * w;
      }
      J.push(rowX);
      J.push(rowY);
    }
    return J;
  };

  let r = residualsAt(params);
  let cost = costOf(r);
  let lambda = 1e-3;
  let iter = 0;
  let converged = false;

  for (; iter < MAX_ITERS; iter++) {
    const J = jacobianAt(params);
    // Normal equations: (J^T J + lambda diag(J^T J)) Δ = -J^T r.
    const JtJ = matMulTransposed(J);
    const Jtr = matVecTransposed(J, r);
    const n = 2 * N;
    // LM damping: add lambda * diag.
    const A: number[][] = JtJ.map(row => row.slice());
    for (let i = 0; i < n; i++) A[i][i] += lambda * (Math.abs(JtJ[i][i]) + 1e-12);
    const b = Jtr.map(v => -v);
    const Acopy = A.map(row => row.slice());
    const ok = solveLU(Acopy, b);
    if (!ok) {
      lambda *= 10;
      if (lambda > 1e12) break;
      continue;
    }
    const step = b;
    const trial = new Float64Array(params);
    let stepNorm = 0;
    for (let i = 0; i < n; i++) {
      trial[i] += step[i];
      stepNorm += step[i] * step[i];
    }
    stepNorm = Math.sqrt(stepNorm);
    const rTrial = residualsAt(trial);
    const costTrial = costOf(rTrial);
    if (costTrial < cost) {
      params = trial;
      r = rTrial;
      const dCost = cost - costTrial;
      cost = costTrial;
      lambda = Math.max(lambda * 0.5, 1e-8);
      if (dCost < COST_TOL || stepNorm < STEP_TOL) {
        converged = true;
        break;
      }
    } else {
      lambda *= 5;
      if (lambda > 1e12) break;
    }
  }

  const positions: Vec2[] = new Array(N);
  for (let i = 0; i < N; i++) {
    positions[i] = { x: params[2 * i], y: params[2 * i + 1] };
  }
  // Raw (un-weighted) per-measurement residuals.
  const residuals = measurements.map(m => {
    const dx = positions[m.i].x - positions[m.j].x;
    const dy = positions[m.i].y - positions[m.j].y;
    return Math.hypot(dx, dy) - m.length;
  });
  return { positions, residuals, iterations: iter, cost, converged };
}

function matMulTransposed(J: number[][]): number[][] {
  const m = J.length;
  if (m === 0) return [];
  const n = J[0].length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k][i] * J[k][j];
      out[i][j] = s;
      out[j][i] = s;
    }
  }
  return out;
}

function matVecTransposed(J: number[][], r: number[]): number[] {
  const m = J.length;
  if (m === 0) return [];
  const n = J[0].length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += J[k][i] * r[k];
    out[i] = s;
  }
  return out;
}
