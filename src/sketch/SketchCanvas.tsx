import { useCallback, useEffect, useRef, useState } from 'react';
import type { Vec2 } from '../physics/types';
import type { Plot, Point, Edge } from '../model/plot';
import {
  initialViewport,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  type Viewport,
} from './viewport';
import { findPointAt, hasEdgeBetween } from './hitTest';
import { nextId } from './ids';

interface Props {
  plot: Plot;
  setPlot: (updater: (plot: Plot) => Plot) => void;
}

interface PointerSnapshot {
  screen: Vec2;
}

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pending'; id: number; startScreen: Vec2 }
  | { kind: 'pan'; id: number; lastScreen: Vec2 }
  | {
      kind: 'pinch';
      idA: number;
      idB: number;
      startDist: number;
      startViewport: Viewport;
      startMidScreen: Vec2;
    };

const TAP_THRESHOLD_PX = 6;
const HIT_RADIUS_PX = 18;

export function SketchCanvas({ plot, setPlot }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const pointersRef = useRef(new Map<number, PointerSnapshot>());
  const gestureRef = useRef<Gesture>({ kind: 'idle' });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Initialise viewport origin to the centre of the canvas once we know the size.
  const didInitViewport = useRef(false);
  useEffect(() => {
    if (didInitViewport.current) return;
    if (size.w === 0 || size.h === 0) return;
    didInitViewport.current = true;
    setViewport({ tx: size.w / 2, ty: size.h / 2, scale: 1 });
  }, [size]);

  // Track container size.
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

  // Render.
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
    drawEdges(ctx, plot, viewport);
    drawPoints(ctx, plot, viewport, activePointId);
  }, [plot, viewport, activePointId, size]);

  // --- Gestures ---

  const performTap = useCallback(
    (screenPt: Vec2) => {
      const vp = viewportRef.current;
      const worldPt = screenToWorld(vp, screenPt);
      const hitRadius = HIT_RADIUS_PX / vp.scale;
      const hit = findPointAt(plot, worldPt, hitRadius);

      setPlot(prev => {
        if (hit) {
          if (activePointId === null) {
            setActivePointId(hit.id);
            return prev;
          }
          if (activePointId === hit.id) {
            setActivePointId(null);
            return prev;
          }
          if (hasEdgeBetween(prev, activePointId, hit.id)) {
            setActivePointId(hit.id);
            return prev;
          }
          const edge: Edge = {
            id: nextId('edge'),
            pointIds: [activePointId, hit.id],
            kind: 'sketch',
          };
          setActivePointId(hit.id);
          return { ...prev, edges: { ...prev.edges, [edge.id]: edge } };
        }

        const point: Point = { id: nextId('pt'), position: worldPt };
        const next: Plot = {
          ...prev,
          points: { ...prev.points, [point.id]: point },
        };
        if (activePointId && prev.points[activePointId]) {
          const edge: Edge = {
            id: nextId('edge'),
            pointIds: [activePointId, point.id],
            kind: 'sketch',
          };
          next.edges = { ...next.edges, [edge.id]: edge };
        }
        setActivePointId(point.id);
        return next;
      });
    },
    [activePointId, plot, setPlot],
  );

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
        kind: 'pinch',
        idA: a[0],
        idB: b[0],
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
        gestureRef.current = { kind: 'pan', id: e.pointerId, lastScreen: g.startScreen };
      }
    }
    const g2 = gestureRef.current;
    if (g2.kind === 'pan' && g2.id === e.pointerId) {
      const dx = screen.x - g2.lastScreen.x;
      const dy = screen.y - g2.lastScreen.y;
      setViewport(v => panBy(v, dx, dy));
      gestureRef.current = { ...g2, lastScreen: screen };
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

    if (wasTap) {
      performTap(screen);
    }

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

// --- Drawing ---

function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, size: { w: number; h: number }) {
  const baseStep = 50;
  let step = baseStep;
  // Keep grid cells between ~30 and ~120 screen px by switching decades.
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

function drawEdges(ctx: CanvasRenderingContext2D, plot: Plot, vp: Viewport) {
  ctx.strokeStyle = '#7aa2ff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const edge of Object.values(plot.edges)) {
    const a = plot.points[edge.pointIds[0]];
    const b = plot.points[edge.pointIds[1]];
    if (!a || !b) continue;
    const sa = worldToScreen(vp, a.position);
    const sb = worldToScreen(vp, b.position);
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
  }
  ctx.stroke();
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  vp: Viewport,
  activeId: string | null,
) {
  for (const p of Object.values(plot.points)) {
    const s = worldToScreen(vp, p.position);
    const isActive = p.id === activeId;
    if (isActive) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(122, 162, 255, 0.18)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? '#7aa2ff' : '#eaeaea';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1a1a1a';
    ctx.stroke();
  }
}
