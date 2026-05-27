import { emptyPlot, type Plot } from './plot';
import { ALL_UNITS } from './units';

const KEY = 'fictional-plot:v1';

export function loadPlot(): Plot {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyPlot();
    const parsed = JSON.parse(raw) as Partial<Plot>;
    const units = parsed.units && ALL_UNITS.includes(parsed.units)
      ? parsed.units
      : 'mm';
    return {
      points: parsed.points ?? {},
      shapes: parsed.shapes ?? {},
      measurements: parsed.measurements ?? {},
      anchorPointId: parsed.anchorPointId,
      orientationPointId: parsed.orientationPointId,
      units,
    };
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
