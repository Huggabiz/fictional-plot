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
import { findPointAt, findCandidateAt, findShapeEdgeAt, type ShapeEdgeHit } from './hitTest';
import { nextId } from './ids';
import { NumberPad } from './NumberPad';
import { formatNumber, fromMm, type Units } from '../model/units';
import { effectivePosition, type Underlay } from '../model/plot';
import type { CandidateLine } from '../survey/candidates';
import { runSurveySolve } from '../survey/run';
import type { Layer, FeatureTool, SurveyTool } from '../App';

interface PendingMeasurement {
  pointIds: [string, string];
  worldLength: number;
  existingId: string | null;
  existingLength: number | null;
}

interface Props {
  plot: Plot;
  setPlot: (updater: (plot: Plot) => Plot) => void;
  pushHistory: () => void;
  layer: Layer;
  featureTool: FeatureTool;
  surveyTool: SurveyTool;
  candidates: CandidateLine[];
  nextBestKey: string | null;
  currentShapeId: string | null;
  setCurrentShapeId: (id: string | null) => void;
  activePointId: string | null;
  setActivePointId: (id: string | null) => void;
  units: Units;
  setUnits: (u: Units) => void;
  onUnderlayChange: (updater: (u: Underlay) => Underlay) => void;
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
    }
  | { kind: 'imagePan'; id: number; lastScreen: Vec2 }
  | {
      kind: 'imagePinch';
      idA: number;
      idB: number;
      startDist: number;
      startAngle: number;
      startCenter: Vec2;
      startScale: number;
      startRotation: number;
      pivotWorld: Vec2;
    };

const TAP_THRESHOLD_PX = 6;
const POINT_HIT_RADIUS_PX = 18;
const LINE_HIT_RADIUS_PX = 14;
const CLOSE_FIRST_POINT_PX = 22;

export function SketchCanvas({
  plot,
  setPlot,
  pushHistory,
  layer,
  featureTool,
  surveyTool,
  candidates,
  nextBestKey,
  currentShapeId,
  setCurrentShapeId,
  activePointId,
  setActivePointId,
  units,
  setUnits,
  onUnderlayChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pendingMeasurement, setPendingMeasurement] = useState<PendingMeasurement | null>(null);

  const pointersRef = useRef(new Map<number, PointerSnapshot>());
  const gestureRef = useRef<Gesture>({ kind: 'idle' });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Cache the decoded underlay image so we're not re-decoding every
  // frame. Re-decode only when the dataUrl changes (i.e. the user
  // imports a new image).
  const underlayImgRef = useRef<{ dataUrl: string; img: HTMLImageElement; ready: boolean } | null>(null);
  const [imgReady, setImgReady] = useState(0);
  useEffect(() => {
    const u = plot.underlay;
    if (!u) {
      underlayImgRef.current = null;
      return;
    }
    if (underlayImgRef.current?.dataUrl === u.dataUrl) return;
    const img = new Image();
    const entry = { dataUrl: u.dataUrl, img, ready: false };
    underlayImgRef.current = entry;
    img.onload = () => {
      entry.ready = true;
      setImgReady(x => x + 1);
    };
    img.src = u.dataUrl;
  }, [plot.underlay]);

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
      const pa = effectivePosition(a, plot.points);
      const pb = effectivePosition(b, plot.points);
      const cur = Math.hypot(pa.x - pb.x, pa.y - pb.y);
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

    if (plot.underlay && underlayImgRef.current?.ready && underlayImgRef.current.dataUrl === plot.underlay.dataUrl) {
      drawUnderlay(ctx, plot.underlay, underlayImgRef.current.img, viewport);
    }

    if (layer === 'features') {
      drawShapes(ctx, plot, viewport, 1.0);
      drawPoints(ctx, plot, viewport, activePointId, currentShapeId, 1.0);
      if (featureTool === 'adjustImage' && plot.underlay) {
        drawUnderlayHandles(ctx, plot.underlay, viewport);
      }
    } else {
      // Lattice is the visual focus on layer 2: draw thick translucent
      // racetracks first, then crisp black shape lines and points on top.
      drawCandidates(ctx, plot, viewport, candidates, nextBestKey, measurementByKey, residuals, units);
      drawShapes(ctx, plot, viewport, 1.0);
      drawPoints(ctx, plot, viewport, null, null, 1.0);
    }
  }, [
    plot, viewport, activePointId, currentShapeId, size, layer, featureTool,
    candidates, nextBestKey, measurementByKey, residuals, units, imgReady,
  ]);

  // --- Tool dispatchers ---

  const handleFeatureTap = useCallback((
    worldPt: Vec2,
    hitPoint: Point | null,
    edgeHit: ShapeEdgeHit | null,
  ) => {
    const tool = propsRef.current.featureTool;
    if (tool === 'draw') {
      pushHistory();
      handleDrawTap(worldPt, hitPoint, edgeHit);
    } else if (tool === 'point') {
      if (!hitPoint) pushHistory();
      handleAddPointTap(worldPt, hitPoint);
    } else if (tool === 'onEdge') {
      if (edgeHit) pushHistory();
      handleOnEdgeTap(edgeHit);
    } else if (tool === 'delete') {
      if (hitPoint) pushHistory();
      handleDeleteTap(hitPoint);
    }
    // 'edit' uses drag, not tap.
  }, [pushHistory]);

  const handleDrawTap = useCallback((
    worldPt: Vec2,
    hitPoint: Point | null,
    edgeHit: ShapeEdgeHit | null,
  ) => {
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

      // Tap on an existing edge (and not currently extending a shape):
      // insert a new vertex into that shape, splitting the edge.
      if (edgeHit && !curShape) {
        const target = prev.shapes[edgeHit.shapeId];
        if (target) {
          const point: Point = newFreePointAt(edgeHit.pointOnEdge, prev, edgeHit);
          const insertAt = edgeHit.segmentIndex + 1;
          const newIds = target.pointIds.slice();
          // For a closed-shape closing segment, segmentIndex === len - 1
          // and we want to insert at the end (just before wrapping).
          newIds.splice(insertAt, 0, point.id);
          const updatedShape: Shape = { ...target, pointIds: newIds };
          setActivePointId(point.id);
          return {
            ...prev,
            points: { ...prev.points, [point.id]: point },
            shapes: { ...prev.shapes, [updatedShape.id]: updatedShape },
          };
        }
      }

      // Tap empty: create a new point.
      const point: Point = newFreePointAt(worldPt, prev, null);
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
      const point = newFreePointAt(worldPt, prev, null);
      return { ...prev, points: { ...prev.points, [point.id]: point } };
    });
  }, [setPlot]);

  const handleOnEdgeTap = useCallback((edgeHit: ShapeEdgeHit | null) => {
    if (!edgeHit) return;
    setPlot(prev => {
      const a = prev.points[edgeHit.pointAId];
      const b = prev.points[edgeHit.pointBId];
      if (!a || !b) return prev;
      const t = edgeHit.t;
      const pos = { x: a.position.x * (1 - t) + b.position.x * t, y: a.position.y * (1 - t) + b.position.y * t };
      const sketchPos = {
        x: a.sketchPosition.x * (1 - t) + b.sketchPosition.x * t,
        y: a.sketchPosition.y * (1 - t) + b.sketchPosition.y * t,
      };
      const point: Point = {
        id: nextId('pt'),
        position: pos,
        sketchPosition: sketchPos,
        kind: 'onEdge',
        parents: [edgeHit.pointAId, edgeHit.pointBId],
        t,
      };
      setActivePointId(point.id);
      return { ...prev, points: { ...prev.points, [point.id]: point } };
    });
  }, [setPlot, setActivePointId]);

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
      pushHistory();
      setPlot(prev => removeMeasurement(prev, existingId));
      return;
    }

    // tool === 'measure' — open the on-screen number pad.
    const existing = existingId ? curPlot.measurements[existingId] : null;
    setPendingMeasurement({
      pointIds: [hit.pointIds[0], hit.pointIds[1]],
      worldLength: hit.worldLength,
      existingId,
      existingLength: existing ? existing.length : null,
    });
  }, [pushHistory]);

  const commitPendingMeasurement = useCallback((value: number) => {
    const pending = pendingMeasurement;
    if (!pending) return;
    setPendingMeasurement(null);
    pushHistory();
    setPlot(prev => {
      const measurements = { ...prev.measurements };
      if (pending.existingId) {
        measurements[pending.existingId] = {
          ...measurements[pending.existingId],
          length: value,
        };
      } else {
        const m: Measurement = {
          id: nextId('meas'),
          pointIds: pending.pointIds,
          length: value,
        };
        measurements[m.id] = m;
      }
      const withMeasurement: Plot = { ...prev, measurements };
      return runSurveySolve(withMeasurement) ?? withMeasurement;
    });
  }, [pendingMeasurement, setPlot, pushHistory]);

  const deletePendingMeasurement = useCallback(() => {
    const pending = pendingMeasurement;
    if (!pending || !pending.existingId) return;
    const existingId = pending.existingId;
    setPendingMeasurement(null);
    pushHistory();
    setPlot(prev => removeMeasurement(prev, existingId));
  }, [pendingMeasurement, setPlot, pushHistory]);

  // --- Pointer pipeline ---

  const performTap = useCallback((screenPt: Vec2) => {
    const vp = viewportRef.current;
    const worldPt = screenToWorld(vp, screenPt);
    const { layer: curLayer, featureTool: tool, plot: curPlot, currentShapeId: curShapeId } = propsRef.current;
    if (curLayer === 'features') {
      const hitR = POINT_HIT_RADIUS_PX / vp.scale;
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
              handleFeatureTap(worldPt, first, null);
              return;
            }
          }
        }
      }
      // For draw / on-edge tools, also look for a shape edge under the tap.
      let edgeHit: ShapeEdgeHit | null = null;
      if (!hit && (tool === 'draw' || tool === 'onEdge')) {
        edgeHit = findShapeEdgeAt(curPlot, worldPt, LINE_HIT_RADIUS_PX / vp.scale);
      }
      handleFeatureTap(worldPt, hit, edgeHit);
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
    if (hit.kind === 'onEdge') return false; // can't drag a constrained point
    pushHistory();
    gestureRef.current = { kind: 'drag', id: pointerId, pointId: hit.id, startScreen: screen };
    return true;
  }, [pushHistory]);

  const isImageMode = (): boolean => {
    return propsRef.current.layer === 'features'
      && propsRef.current.featureTool === 'adjustImage'
      && !!propsRef.current.plot.underlay;
  };

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
      if (isImageMode()) {
        const u = propsRef.current.plot.underlay!;
        pushHistory();
        const angle = Math.atan2(b[1].screen.y - a[1].screen.y, b[1].screen.x - a[1].screen.x);
        gestureRef.current = {
          kind: 'imagePinch',
          idA: a[0], idB: b[0],
          startDist: Math.max(dist, 1),
          startAngle: angle,
          startCenter: { x: u.center.x, y: u.center.y },
          startScale: u.scale,
          startRotation: u.rotation,
          pivotWorld: screenToWorld(viewportRef.current, mid),
        };
      } else {
        gestureRef.current = {
          kind: 'pinch', idA: a[0], idB: b[0],
          startDist: Math.max(dist, 1),
          startViewport: viewportRef.current,
          startMidScreen: mid,
        };
      }
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
        if (isImageMode()) {
          pushHistory();
          gestureRef.current = { kind: 'imagePan', id: e.pointerId, lastScreen: g.startScreen };
        } else if (!tryStartDrag(e.pointerId, g.startScreen)) {
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
        // Drags in feature mode update both the solved position and
        // the sketch position so the cohesion soft constraints reflect
        // the user's latest intent.
        return {
          ...prev,
          points: {
            ...prev.points,
            [g2.pointId]: { ...pt, position: worldPt, sketchPosition: worldPt },
          },
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
    } else if (g2.kind === 'imagePan' && g2.id === e.pointerId) {
      const vp = viewportRef.current;
      const dx = (screen.x - g2.lastScreen.x) / vp.scale;
      const dy = (screen.y - g2.lastScreen.y) / vp.scale;
      onUnderlayChange(u => ({ ...u, center: { x: u.center.x + dx, y: u.center.y + dy } }));
      gestureRef.current = { ...g2, lastScreen: screen };
    } else if (g2.kind === 'imagePinch') {
      const a = pointersRef.current.get(g2.idA);
      const b = pointersRef.current.get(g2.idB);
      if (!a || !b) return;
      const dist = Math.max(vDist(a.screen, b.screen), 1);
      const angle = Math.atan2(b.screen.y - a.screen.y, b.screen.x - a.screen.x);
      const factor = dist / g2.startDist;
      const dRot = angle - g2.startAngle;
      const cos = Math.cos(dRot);
      const sin = Math.sin(dRot);
      // Rotate and scale the starting centre around the world pivot.
      const ox = g2.startCenter.x - g2.pivotWorld.x;
      const oy = g2.startCenter.y - g2.pivotWorld.y;
      const rx = (cos * ox - sin * oy) * factor;
      const ry = (sin * ox + cos * oy) * factor;
      const newCenter = { x: g2.pivotWorld.x + rx, y: g2.pivotWorld.y + ry };
      onUnderlayChange(u => ({
        ...u,
        scale: g2.startScale * factor,
        rotation: g2.startRotation + dRot,
        center: newCenter,
      }));
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
      gestureRef.current = isImageMode()
        ? { kind: 'imagePan', id, lastScreen: snap.screen }
        : { kind: 'pan', id, lastScreen: snap.screen };
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const screen = clientToCanvas(e, canvasRef.current);
    const factor = Math.exp(-e.deltaY * 0.0015);
    if (isImageMode()) {
      onUnderlayChange(u => ({ ...u, scale: u.scale * factor }));
      return;
    }
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
      {pendingMeasurement ? (
        <NumberPad
          title={pendingMeasurement.existingId ? 'Update dimension' : 'Enter dimension'}
          subtitle={
            pendingMeasurement.existingLength != null
              ? `Currently ${formatNumber(fromMm(pendingMeasurement.existingLength, units), units)} ${units}`
              : `Sketch length ~${formatNumber(fromMm(pendingMeasurement.worldLength, units), units)} ${units}`
          }
          initialValueMm={pendingMeasurement.existingLength ?? undefined}
          unit={units}
          onUnitChange={setUnits}
          allowDelete={pendingMeasurement.existingId != null}
          onCommit={commitPendingMeasurement}
          onDelete={deletePendingMeasurement}
          onCancel={() => setPendingMeasurement(null)}
        />
      ) : null}
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

function newFreePointAt(world: Vec2, _plot: Plot, _edge: ShapeEdgeHit | null): Point {
  return {
    id: nextId('pt'),
    position: { ...world },
    sketchPosition: { ...world },
    kind: 'free',
  };
}

function removePoint(plot: Plot, id: string): Plot {
  const points = { ...plot.points };
  delete points[id];

  // Cascade: on-edge points whose parents were deleted lose their
  // constraint. Convert them into free points at their last known
  // position so they don't crash the solver.
  for (const [pid, p] of Object.entries(points)) {
    if (p.kind !== 'onEdge' || !p.parents) continue;
    const [aId, bId] = p.parents;
    if (!points[aId] || !points[bId]) {
      points[pid] = { ...p, kind: 'free', parents: undefined, t: undefined };
    }
  }

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

  return {
    points, shapes, measurements,
    anchorPointId: anchor,
    orientationPointId: orient,
    units: plot.units,
    shapeCohesion: plot.shapeCohesion,
  };
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
  ctx.strokeStyle = '#e3e6ee';
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

function drawUnderlay(
  ctx: CanvasRenderingContext2D,
  u: Underlay,
  img: HTMLImageElement,
  vp: Viewport,
) {
  if (u.naturalWidth === 0 || u.naturalHeight === 0) return;
  // Compose: screen ← world ← image local. screen = vp.scale·world + vp.t.
  // World transform of image: translate(center) · rotate · scale.
  // We draw centred at origin in image-local coords, so:
  //   ctx.translate(screenCenter); rotate; scale(vp.scale * u.scale);
  //   drawImage(img, -w/2, -h/2)
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, u.opacity));
  const sx = vp.tx + u.center.x * vp.scale;
  const sy = vp.ty + u.center.y * vp.scale;
  ctx.translate(sx, sy);
  ctx.rotate(u.rotation);
  const k = vp.scale * u.scale;
  ctx.scale(k, k);
  ctx.drawImage(img, -u.naturalWidth / 2, -u.naturalHeight / 2);
  ctx.restore();
}

function drawUnderlayHandles(
  ctx: CanvasRenderingContext2D,
  u: Underlay,
  vp: Viewport,
) {
  if (u.naturalWidth === 0 || u.naturalHeight === 0) return;
  ctx.save();
  const sx = vp.tx + u.center.x * vp.scale;
  const sy = vp.ty + u.center.y * vp.scale;
  ctx.translate(sx, sy);
  ctx.rotate(u.rotation);
  const k = vp.scale * u.scale;
  const w = u.naturalWidth * k;
  const h = u.naturalHeight * k;
  ctx.strokeStyle = '#3b5bdb';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#3b5bdb';
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  // Up-indicator: a short tick pointing toward -y so the image's
  // current orientation is visible at a glance.
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(0, -h / 2 - 14);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawShapes(ctx: CanvasRenderingContext2D, plot: Plot, vp: Viewport, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const s of Object.values(plot.shapes)) {
    if (s.pointIds.length < 2) continue;
    const segs = shapeSegments(s);
    ctx.strokeStyle = '#0d1117';
    ctx.beginPath();
    for (const [aId, bId] of segs) {
      const a = plot.points[aId];
      const b = plot.points[bId];
      if (!a || !b) continue;
      const sa = worldToScreen(vp, effectivePosition(a, plot.points));
      const sb = worldToScreen(vp, effectivePosition(b, plot.points));
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
    ctx.stroke();
    if (s.closed) {
      ctx.fillStyle = 'rgba(13, 17, 23, 0.04)';
      ctx.beginPath();
      const first = plot.points[s.pointIds[0]];
      if (first) {
        const sf = worldToScreen(vp, effectivePosition(first, plot.points));
        ctx.moveTo(sf.x, sf.y);
        for (let i = 1; i < s.pointIds.length; i++) {
          const p = plot.points[s.pointIds[i]];
          if (!p) continue;
          const sp = worldToScreen(vp, effectivePosition(p, plot.points));
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
  units: Units,
) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Pass 1: unmeasured candidates — thick translucent racetracks.
  for (const c of candidates) {
    if (c.measured) continue;
    const a = plot.points[c.pointIds[0]];
    const b = plot.points[c.pointIds[1]];
    if (!a || !b) continue;
    const sa = worldToScreen(vp, effectivePosition(a, plot.points));
    const sb = worldToScreen(vp, effectivePosition(b, plot.points));
    if (c.key === nextBestKey) {
      ctx.strokeStyle = '#3b5bdb';
      ctx.lineWidth = 18;
      ctx.globalAlpha = 0.42;
    } else if (c.improvesRigidity) {
      ctx.strokeStyle = '#7a8398';
      ctx.lineWidth = 16;
      ctx.globalAlpha = 0.22;
    } else {
      ctx.strokeStyle = '#7a8398';
      ctx.lineWidth = 14;
      ctx.globalAlpha = 0.12;
    }
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
  }

  // Pass 2: measured candidates — stress-coloured racetracks + dimension label.
  for (const c of candidates) {
    if (!c.measured) continue;
    const a = plot.points[c.pointIds[0]];
    const b = plot.points[c.pointIds[1]];
    if (!a || !b) continue;
    const m = measurementByKey.get(c.key);
    if (!m) continue;
    const sa = worldToScreen(vp, effectivePosition(a, plot.points));
    const sb = worldToScreen(vp, effectivePosition(b, plot.points));
    const r = residuals.get(m.id) ?? 0;
    const tol = Math.max(m.length * 0.01, 1); // 1 % of length, min 1 unit
    const stress = Math.min(1, Math.abs(r) / (tol * 5));
    ctx.strokeStyle = stressColour(stress);
    ctx.lineWidth = 16;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();

    // Dimension label.
    ctx.globalAlpha = 1;
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    const label = `${formatNumber(fromMm(m.length, units), units)} ${units}`;
    drawLabel(ctx, mid, label);
  }
  ctx.restore();
}

function stressColour(stress: number): string {
  // 0 → green, 1 → red.
  const r = Math.round(60 + (200 - 60) * stress);
  const g = Math.round(170 + (60 - 170) * stress);
  const b = Math.round(110 + (60 - 110) * stress);
  return `rgb(${r}, ${g}, ${b})`;
}

function drawLabel(ctx: CanvasRenderingContext2D, at: Vec2, text: string) {
  ctx.save();
  ctx.font = '600 12px -apple-system, system-ui, sans-serif';
  const metrics = ctx.measureText(text);
  const pad = 5;
  const w = metrics.width + pad * 2;
  const h = 18;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(at.x - w / 2, at.y - h / 2, w, h);
  ctx.strokeStyle = '#d8dce6';
  ctx.lineWidth = 1;
  ctx.strokeRect(at.x - w / 2, at.y - h / 2, w, h);
  ctx.fillStyle = '#1a1f2b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y);
  ctx.restore();
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
    const s = worldToScreen(vp, effectivePosition(p, plot.points));
    const isActive = p.id === activeId;
    const isCloseTarget = p.id === currentFirstId && !plot.shapes[currentShapeId!]?.closed
      && (plot.shapes[currentShapeId!]?.pointIds.length ?? 0) >= 3;
    if (isActive) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59, 91, 219, 0.18)';
      ctx.fill();
    }
    if (isCloseTarget) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(59, 91, 219, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (p.kind === 'onEdge') {
      // Distinct glyph for constrained midpoints — a hollow diamond.
      const r = 4.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y);
      ctx.lineTo(s.x, s.y + r);
      ctx.lineTo(s.x - r, s.y);
      ctx.closePath();
      ctx.fillStyle = isActive ? '#3b5bdb' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0d1117';
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#3b5bdb' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0d1117';
      ctx.stroke();
    }
  }
  ctx.restore();
}
