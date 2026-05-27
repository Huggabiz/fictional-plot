import { emptyPlot, type Plot, type Point } from './plot';
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
  };
}
