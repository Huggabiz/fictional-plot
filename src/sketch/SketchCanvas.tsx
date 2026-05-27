import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Vec2 } from '../physics/types';
import type { Plot, Point, Shape, Measurement } from '../model/plot';
import { shapeSegments } from '../model/plot';
import {
  initialViewport,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  type Viewport,
} from './viewport';
import { findPointAt, findCandidateAt } from './hitTest';
import { nextId } from './ids';
import type { CandidateLine } from '../survey/candidates';
import { runSurveySolve } from '../survey/run';
import type { Layer, FeatureTool, SurveyTool } from '../App';

interface Props {
  plot: Plot;
  setPlot: (updater: (plot: Plot) => Plot) => void;
  layer: Layer;
  featureTool: FeatureTool;
  surveyTool: SurveyTool;
  candidates: CandidateLine[];
  nextBestKey: string | null;
  currentShapeId: string | null;
  setCurrentShapeId: (id: string | null) => void;
  activePointId: string | null;
  setActivePointId: (id: string | null) => void;
}

interface PointerSnapshot {
  screen: Vec2;
}

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pending'; id: number; startScreen: Vec2 }
  | { kind: 'pan'; id: number; lastScreen: Vec2 }
  | { kind: 'drag'; id: number; pointId: string; startScreen: Vec2 }
  | {
      kind: 'pinch';
      idA: number;
      idB: number;
      startDist: number;
      startViewport: Viewport;
      startMidScreen: Vec2;
    };

const TAP_THRESHOLD_PX = 6;
const POINT_HIT_RADIUS_PX = 18;
const LINE_HIT_RADIUS_PX = 14;
const CLOSE_FIRST_POINT_PX = 22;

export function SketchCanvas({
  plot,
  setPlot,
  layer,
  featureTool,
  surveyTool,
  candidates,
  nextBestKey,
  currentShapeId,
  setCurrentShapeId,
  activePointId,
  setActivePointId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const pointersRef = useRef(new Map<number, PointerSnapshot>());
  const gestureRef = useRef<Gesture>({ kind: 'idle' });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Keep current refs for use in pointer handlers.
  const propsRef = useRef({
    layer, featureTool, surveyTool, currentShapeId, activePointId, plot, candidates,
  });
  propsRef.current = {
    layer, featureTool, surveyTool, currentShapeId, activePointId, plot, candidates,
  };

  // Centre the world origin once we know the canvas size.
  const didInitViewport = useRef(false);
  useEffect(() => {
    if (didInitViewport.current) return;
    if (size.w === 0 || size.h === 0) return;
    didInitViewport.current = true;
    setViewport({ tx: size.w / 2, ty: size.h / 2, scale: 1 });
  }, [size]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ w: cr.width, h: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Per-measurement residuals (computed from current positions vs target).
  const residuals = useMemo(() => {
    const out = new Map<string, number>();
    for (const m of Object.values(plot.measurements)) {
      const a = plot.points[m.pointIds[0]];
      const b = plot.points[m.pointIds[1]];
      if (!a || !b) continue;
      const cur = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
      out.set(m.id, cur - m.length);
    }
    return out;
  }, [plot]);

  const measurementByKey = useMemo(() => {
    const out = new Map<string, Measurement>();
    for (const m of Object.values(plot.measurements)) {
      const k = edgeKey(m.pointIds[0], m.pointIds[1]);
      out.set(k, m);
    }
    return out;
  }, [plot.measurements]);

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    drawGrid(ctx, viewport, size);

    if (layer === 'features') {
      drawShapes(ctx, plot, viewport, 1.0);
      drawPoints(ctx, plot, viewport, activePointId, currentShapeId, 1.0);
    } else {
      drawShapes(ctx, plot, viewport, 0.35);
      drawCandidates(ctx, plot, viewport, candidates, nextBestKey, measurementByKey, residuals);
      drawPoints(ctx, plot, viewport, null, null, 0.7);
    }
  }, [
    plot, viewport, activePointId, currentShapeId, size, layer,
    candidates, nextBestKey, measurementByKey, residuals,
  ]);

  // --- Tool dispatchers ---

  const handleFeatureTap = useCallback((worldPt: Vec2, hitPoint: Point | null) => {
    const tool = propsRef.current.featureTool;
    if (tool === 'draw') {
      handleDrawTap(worldPt, hitPoint);
    } else if (tool === 'point') {
      handleAddPointTap(worldPt, hitPoint);
    } else if (tool === 'delete') {
      handleDeleteTap(hitPoint);
    }
    // 'edit' uses drag, not tap.
  }, []);

  const handleDrawTap = useCallback((worldPt: Vec2, hitPoint: Point | null) => {
    setPlot(prev => {
      const curShapeId = propsRef.current.currentShapeId;
      const curShape = curShapeId ? prev.shapes[curShapeId] : null;

      // Tap existing point.
      if (hitPoint) {
        // Closing the current open shape by tapping its first point.
        if (curShape && !curShape.closed && curShape.pointIds.length >= 3
            && curShape.pointIds[0] === hitPoint.id) {
          const closed: Shape = { ...curShape, closed: true };
          setCurrentShapeId(null);
          setActivePointId(null);
          return { ...prev, shapes: { ...prev.shapes, [closed.id]: closed } };
        }
        // Extending current shape to an existing point (no duplicate consecutive).
        if (curShape && !curShape.closed) {
          const last = curShape.pointIds[curShape.pointIds.length - 1];
          if (last === hitPoint.id) return prev;
          if (curShape.pointIds.includes(hitPoint.id)) {
            // Skip — joining mid-shape would make a non-simple polyline.
            setActivePointId(hitPoint.id);
            return prev;
          }
          const extended: Shape = { ...curShape, pointIds: [...curShape.pointIds, hitPoint.id] };
          setActivePointId(hitPoint.id);
          return { ...prev, shapes: { ...prev.shapes, [extended.id]: extended } };
        }
        // No current shape — start one anchored at this point.
        const shape: Shape = { id: nextId('shape'), pointIds: [hitPoint.id], closed: false };
        setCurrentShapeId(shape.id);
        setActivePointId(hitPoint.id);
        return { ...prev, shapes: { ...prev.shapes, [shape.id]: shape } };
      }

      // Tap empty: create a new point.
      const point: Point = { id: nextId('pt'), position: worldPt };
      const points = { ...prev.points, [point.id]: point };
      if (curShape && !curShape.closed) {
        const extended: Shape = { ...curShape, pointIds: [...curShape.pointIds, point.id] };
        setActivePointId(point.id);
        return { ...prev, points, shapes: { ...prev.shapes, [extended.id]: extended } };
      }
      const shape: Shape = { id: nextId('shape'), pointIds: [point.id], closed: false };
      setCurrentShapeId(shape.id);
      setActivePointId(point.id);
      return { ...prev, points, shapes: { ...prev.shapes, [shape.id]: shape } };
    });
  }, [setPlot, setCurrentShapeId, setActivePointId]);

  const handleAddPointTap = useCallback((worldPt: Vec2, hitPoint: Point | null) => {
    if (hitPoint) return;
    setPlot(prev => {
      const point: Point = { id: nextId('pt'), position: worldPt };
      return { ...prev, points: { ...prev.points, [point.id]: point } };
    });
  }, [setPlot]);

  const handleDeleteTap = useCallback((hitPoint: Point | null) => {
    if (!hitPoint) return;
    setPlot(prev => removePoint(prev, hitPoint.id));
    if (propsRef.current.activePointId === hitPoint.id) setActivePointId(null);
  }, [setPlot, setActivePointId]);

  const handleSurveyTap = useCallback((worldPt: Vec2) => {
    const { surveyTool: tool, plot: curPlot, candidates: cands } = propsRef.current;
    const vp = viewportRef.current;
    const hit = findCandidateAt(curPlot, cands, worldPt, LINE_HIT_RADIUS_PX / vp.scale);
    if (!hit) return;
    const existingId = measurementIdForPair(curPlot, hit.pointIds[0], hit.pointIds[1]);

    if (tool === 'delete') {
      if (!existingId) return;
      setPlot(prev => removeMeasurement(prev, existingId));
      return;
    }

    // tool === 'measure'
    const existing = existingId ? curPlot.measurements[existingId] : null;
    const suggested = existing ? existing.length : Number(hit.worldLength.toFixed(2));
    const input = window.prompt(
      existing
        ? `Update tape reading (current ${existing.length}):`
        : `Tape reading between these points:`,
      String(suggested),
    );
    if (input == null) return;
    const trimmed = input.trim();
    if (trimmed === '') {
      if (existingId) setPlot(prev => removeMeasurement(prev, existingId));
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value <= 0) {
      alert('Enter a positive number.');
      return;
    }
    setPlot(prev => {
      const measurements = { ...prev.measurements };
      if (existingId) {
        measurements[existingId] = { ...measurements[existingId], length: value };
      } else {
        const m: Measurement = {
          id: nextId('meas'),
          pointIds: [hit.pointIds[0], hit.pointIds[1]],
          length: value,
        };
        measurements[m.id] = m;
      }
      const withMeasurement: Plot = { ...prev, measurements };
      return runSurveySolve(withMeasurement) ?? withMeasurement;
    });
  }, [setPlot]);

  // --- Pointer pipeline ---

  const performTap = useCallback((screenPt: Vec2) => {
    const vp = viewportRef.current;
    const worldPt = screenToWorld(vp, screenPt);
    const { layer: curLayer, plot: curPlot, currentShapeId: curShapeId } = propsRef.current;
    if (curLayer === 'features') {
      const hitR = POINT_HIT_RADIUS_PX / vp.scale;
      // Tighter close-shape radius via the standard hit radius works fine.
      const hit = findPointAt(curPlot, worldPt, hitR);
      // If drawing and pointing close to the first point of an open shape, snap to it for closing.
      if (!hit && curShapeId) {
        const s = curPlot.shapes[curShapeId];
        if (s && !s.closed && s.pointIds.length >= 3) {
          const first = curPlot.points[s.pointIds[0]];
          if (first) {
            const dx = first.position.x - worldPt.x;
            const dy = first.position.y - worldPt.y;
            if (Math.hypot(dx, dy) <= CLOSE_FIRST_POINT_PX / vp.scale) {
              handleFeatureTap(worldPt, first);
              return;
            }
          }
        }
      }
      handleFeatureTap(worldPt, hit);
    } else {
      handleSurveyTap(worldPt);
    }
  }, [handleFeatureTap, handleSurveyTap]);

  const tryStartDrag = useCallback((pointerId: number, screen: Vec2): boolean => {
    if (propsRef.current.layer !== 'features' || propsRef.current.featureTool !== 'edit') return false;
    const vp = viewportRef.current;
    const worldPt = screenToWorld(vp, screen);
    const hit = findPointAt(propsRef.current.plot, worldPt, POINT_HIT_RADIUS_PX / vp.scale);
    if (!hit) return false;
    gestureRef.current = { kind: 'drag', id: pointerId, pointId: hit.id, startScreen: screen };
    return true;
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const screen = clientToCanvas(e, canvasRef.current);
    pointersRef.current.set(e.pointerId, { screen });
    (e.target as Element).setPointerCapture(e.pointerId);

    if (pointersRef.current.size === 1) {
      gestureRef.current = { kind: 'pending', id: e.pointerId, startScreen: screen };
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.entries()];
      const dist = vDist(a[1].screen, b[1].screen);
      const mid = vMid(a[1].screen, b[1].screen);
      gestureRef.current = {
        kind: 'pinch', idA: a[0], idB: b[0],
        startDist: Math.max(dist, 1),
        startViewport: viewportRef.current,
        startMidScreen: mid,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const screen = clientToCanvas(e, canvasRef.current);
    pointersRef.current.set(e.pointerId, { screen });

    const g = gestureRef.current;
    if (g.kind === 'pending' && g.id === e.pointerId) {
      const dx = screen.x - g.startScreen.x;
      const dy = screen.y - g.startScreen.y;
      if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX) {
        if (!tryStartDrag(e.pointerId, g.startScreen)) {
          gestureRef.current = { kind: 'pan', id: e.pointerId, lastScreen: g.startScreen };
        }
      }
    }
    const g2 = gestureRef.current;
    if (g2.kind === 'pan' && g2.id === e.pointerId) {
      const dx = screen.x - g2.lastScreen.x;
      const dy = screen.y - g2.lastScreen.y;
      setViewport(v => panBy(v, dx, dy));
      gestureRef.current = { ...g2, lastScreen: screen };
    } else if (g2.kind === 'drag' && g2.id === e.pointerId) {
      const vp = viewportRef.current;
      const worldPt = screenToWorld(vp, screen);
      setPlot(prev => {
        const pt = prev.points[g2.pointId];
        if (!pt) return prev;
        return {
          ...prev,
          points: { ...prev.points, [g2.pointId]: { ...pt, position: worldPt } },
        };
      });
    } else if (g2.kind === 'pinch') {
      const a = pointersRef.current.get(g2.idA);
      const b = pointersRef.current.get(g2.idB);
      if (!a || !b) return;
      const dist = Math.max(vDist(a.screen, b.screen), 1);
      const mid = vMid(a.screen, b.screen);
      const factor = dist / g2.startDist;
      const zoomed = zoomAt(g2.startViewport, g2.startMidScreen, factor);
      const panX = mid.x - g2.startMidScreen.x;
      const panY = mid.y - g2.startMidScreen.y;
      setViewport({ ...zoomed, tx: zoomed.tx + panX, ty: zoomed.ty + panY });
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasTap = (() => {
      const g = gestureRef.current;
      return g.kind === 'pending' && g.id === e.pointerId;
    })();
    const screen = clientToCanvas(e, canvasRef.current);
    pointersRef.current.delete(e.pointerId);

    if (wasTap) performTap(screen);

    if (pointersRef.current.size === 0) {
      gestureRef.current = { kind: 'idle' };
    } else if (pointersRef.current.size === 1) {
      const [[id, snap]] = [...pointersRef.current.entries()];
      gestureRef.current = { kind: 'pan', id, lastScreen: snap.screen };
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const screen = clientToCanvas(e, canvasRef.current);
    const factor = Math.exp(-e.deltaY * 0.0015);
    setViewport(v => zoomAt(v, screen, factor));
  };

  return (
    <div ref={containerRef} className="sketch-container">
      <canvas
        ref={canvasRef}
        className="sketch-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
      />
    </div>
  );
}

function clientToCanvas(e: { clientX: number; clientY: number }, canvas: HTMLCanvasElement | null): Vec2 {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

const vDist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);
const vMid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function measurementIdForPair(plot: Plot, a: string, b: string): string | null {
  const k = edgeKey(a, b);
  for (const m of Object.values(plot.measurements)) {
    if (edgeKey(m.pointIds[0], m.pointIds[1]) === k) return m.id;
  }
  return null;
}

function removePoint(plot: Plot, id: string): Plot {
  const points = { ...plot.points };
  delete points[id];

  const shapes: Record<string, Shape> = {};
  for (const s of Object.values(plot.shapes)) {
    const remainingIds = s.pointIds.filter(pid => pid !== id);
    if (remainingIds.length < 2) continue; // drop shapes that collapse
    shapes[s.id] = { ...s, pointIds: remainingIds, closed: s.closed && remainingIds.length >= 3 };
  }

  const measurements: Record<string, Measurement> = {};
  for (const m of Object.values(plot.measurements)) {
    if (m.pointIds[0] === id || m.pointIds[1] === id) continue;
    measurements[m.id] = m;
  }

  const anchor = plot.anchorPointId === id ? undefined : plot.anchorPointId;
  const orient = plot.orientationPointId === id ? undefined : plot.orientationPointId;

  return { points, shapes, measurements, anchorPointId: anchor, orientationPointId: orient };
}

function removeMeasurement(plot: Plot, id: string): Plot {
  const measurements = { ...plot.measurements };
  delete measurements[id];
  const next: Plot = { ...plot, measurements };
  const solved = runSurveySolve(next);
  return solved ?? next;
}

// --- Drawing ---

function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, size: { w: number; h: number }) {
  const baseStep = 50;
  let step = baseStep;
  while (step * vp.scale < 30) step *= 5;
  while (step * vp.scale > 200) step /= 5;
  const screenStep = step * vp.scale;
  const offX = ((vp.tx % screenStep) + screenStep) % screenStep;
  const offY = ((vp.ty % screenStep) + screenStep) % screenStep;
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = offX; x < size.w; x += screenStep) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size.h);
  }
  for (let y = offY; y < size.h; y += screenStep) {
    ctx.moveTo(0, y);
    ctx.lineTo(size.w, y);
  }
  ctx.stroke();
}

function drawShapes(ctx: CanvasRenderingContext2D, plot: Plot, vp: Viewport, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of Object.values(plot.shapes)) {
    if (s.pointIds.length < 2) continue;
    const segs = shapeSegments(s);
    ctx.strokeStyle = s.closed ? '#9bb6ff' : '#7aa2ff';
    ctx.beginPath();
    for (const [aId, bId] of segs) {
      const a = plot.points[aId];
      const b = plot.points[bId];
      if (!a || !b) continue;
      const sa = worldToScreen(vp, a.position);
      const sb = worldToScreen(vp, b.position);
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
    ctx.stroke();
    if (s.closed) {
      ctx.fillStyle = 'rgba(122, 162, 255, 0.06)';
      ctx.beginPath();
      const first = plot.points[s.pointIds[0]];
      if (first) {
        const sf = worldToScreen(vp, first.position);
        ctx.moveTo(sf.x, sf.y);
        for (let i = 1; i < s.pointIds.length; i++) {
          const p = plot.points[s.pointIds[i]];
          if (!p) continue;
          const sp = worldToScreen(vp, p.position);
          ctx.lineTo(sp.x, sp.y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawCandidates(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  vp: Viewport,
  candidates: CandidateLine[],
  nextBestKey: string | null,
  measurementByKey: Map<string, Measurement>,
  residuals: Map<string, number>,
) {
  ctx.save();
  ctx.lineCap = 'round';

  // Pass 1: unmeasured candidates (grey or blue).
  for (const c of candidates) {
    if (c.measured) continue;
    const a = plot.points[c.pointIds[0]];
    const b = plot.points[c.pointIds[1]];
    if (!a || !b) continue;
    const sa = worldToScreen(vp, a.position);
    const sb = worldToScreen(vp, b.position);
    if (c.key === nextBestKey) {
      ctx.strokeStyle = '#7aa2ff';
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.95;
    } else {
      ctx.strokeStyle = c.improvesRigidity ? '#4a4a4a' : '#3a3a3a';
      ctx.lineWidth = 5;
      ctx.globalAlpha = c.improvesRigidity ? 0.65 : 0.35;
    }
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
  }

  // Pass 2: measured candidates (stress-coloured) + dimension label.
  ctx.globalAlpha = 1;
  for (const c of candidates) {
    if (!c.measured) continue;
    const a = plot.points[c.pointIds[0]];
    const b = plot.points[c.pointIds[1]];
    if (!a || !b) continue;
    const m = measurementByKey.get(c.key);
    if (!m) continue;
    const sa = worldToScreen(vp, a.position);
    const sb = worldToScreen(vp, b.position);
    const r = residuals.get(m.id) ?? 0;
    const tol = Math.max(m.length * 0.01, 1); // 1 % of length, min 1 unit
    const stress = Math.min(1, Math.abs(r) / (tol * 5));
    ctx.strokeStyle = stressColour(stress);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();

    // Dimension label.
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    const label = formatLength(m.length);
    drawLabel(ctx, mid, label);
  }
  ctx.restore();
}

function stressColour(stress: number): string {
  // 0 → green, 1 → red.
  const r = Math.round(92 + (255 - 92) * stress);
  const g = Math.round(214 + (108 - 214) * stress);
  const b = Math.round(160 + (108 - 160) * stress);
  return `rgb(${r}, ${g}, ${b})`;
}

function drawLabel(ctx: CanvasRenderingContext2D, at: Vec2, text: string) {
  ctx.save();
  ctx.font = '600 11px -apple-system, system-ui, sans-serif';
  const metrics = ctx.measureText(text);
  const pad = 4;
  const w = metrics.width + pad * 2;
  const h = 16;
  ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
  ctx.fillRect(at.x - w / 2, at.y - h / 2, w, h);
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 1;
  ctx.strokeRect(at.x - w / 2, at.y - h / 2, w, h);
  ctx.fillStyle = '#eaeaea';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y);
  ctx.restore();
}

function formatLength(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  vp: Viewport,
  activeId: string | null,
  currentShapeId: string | null,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Identify which points belong to the current shape's first node for the "close" affordance.
  const currentFirstId =
    currentShapeId && plot.shapes[currentShapeId]?.pointIds[0]
      ? plot.shapes[currentShapeId].pointIds[0]
      : null;
  for (const p of Object.values(plot.points)) {
    const s = worldToScreen(vp, p.position);
    const isActive = p.id === activeId;
    const isCloseTarget = p.id === currentFirstId && !plot.shapes[currentShapeId!]?.closed
      && (plot.shapes[currentShapeId!]?.pointIds.length ?? 0) >= 3;
    if (isActive) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(122, 162, 255, 0.18)';
      ctx.fill();
    }
    if (isCloseTarget) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(154, 196, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? '#7aa2ff' : '#eaeaea';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1a1a1a';
    ctx.stroke();
  }
  ctx.restore();
}
