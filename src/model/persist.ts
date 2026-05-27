import { emptyPlot, type Plot, type Point, type Underlay } from './plot';
import { ALL_UNITS, type Units } from './units';

const KEY = 'fictional-plot:v1';

export function loadPlot(): Plot {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyPlot();
    const parsed = JSON.parse(raw) as Partial<Plot>;
    return normalisePlot(parsed);
  } catch {
    return emptyPlot();
  }
}

export function savePlot(plot: Plot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(plot));
  } catch {
    // Out of quota or private-mode browser — ignore.
  }
}

/** Coerce a possibly-partial / older-shape plot into a current Plot. */
export function normalisePlot(parsed: Partial<Plot>): Plot {
  const units: Units = parsed.units && ALL_UNITS.includes(parsed.units)
    ? parsed.units
    : 'mm';

  const rawPoints = parsed.points ?? {};
  const points: Record<string, Point> = {};
  for (const [id, raw] of Object.entries(rawPoints)) {
    const p = raw as Partial<Point> & { id?: string; position?: { x: number; y: number } };
    if (!p.position) continue;
    points[id] = {
      id,
      position: { x: p.position.x, y: p.position.y },
      sketchPosition: p.sketchPosition
        ? { x: p.sketchPosition.x, y: p.sketchPosition.y }
        : { x: p.position.x, y: p.position.y },
      kind: p.kind === 'onEdge' ? 'onEdge' : 'free',
      parents: p.parents,
      t: p.t,
      label: p.label,
    };
  }

  const shapeCohesion = typeof parsed.shapeCohesion === 'number'
    ? Math.max(0, Math.min(1, parsed.shapeCohesion))
    : 0.1;

  return {
    points,
    shapes: parsed.shapes ?? {},
    measurements: parsed.measurements ?? {},
    anchorPointId: parsed.anchorPointId,
    orientationPointId: parsed.orientationPointId,
    units,
    shapeCohesion,
    underlay: normaliseUnderlay(parsed.underlay),
  };
}

function normaliseUnderlay(u: Partial<Underlay> | undefined): Underlay | undefined {
  if (!u || typeof u.dataUrl !== 'string') return undefined;
  return {
    dataUrl: u.dataUrl,
    naturalWidth: typeof u.naturalWidth === 'number' ? u.naturalWidth : 0,
    naturalHeight: typeof u.naturalHeight === 'number' ? u.naturalHeight : 0,
    center: u.center && typeof u.center.x === 'number' && typeof u.center.y === 'number'
      ? { x: u.center.x, y: u.center.y }
      : { x: 0, y: 0 },
    rotation: typeof u.rotation === 'number' ? u.rotation : 0,
    scale: typeof u.scale === 'number' && u.scale > 0 ? u.scale : 1,
    opacity: typeof u.opacity === 'number'
      ? Math.max(0, Math.min(1, u.opacity))
      : 0.6,
  };
}
